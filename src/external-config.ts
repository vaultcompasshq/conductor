// An external tool's config, read from the base ref on a pull request.
//
// Both external tools auto-load a config file out of the tree they scan:
// gitleaks reads .gitleaks.toml (and .gitleaksignore), osv-scanner reads
// osv-scanner.toml. On a pull request that tree is the head, so without this
// a pull request could add an allowlist entry for exactly the secret or the
// advisory it introduces, and the gate would read that entry and pass. The
// umbrella's own policy is read from the base ref for the same reason
// (src/trust-base.ts); this does the same for the files the external tools
// would otherwise pick up themselves.
//
// The umbrella ALWAYS hands over a path on a pull request. When the base has
// no config, the tool gets a neutral one (gitleaks' defaults, an empty
// osv-scanner config), because handing it nothing would let it find the
// head's file on its own. A head-side difference is not an error: it is
// reported as a proposal, which takes effect once it merges and the base
// carries it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ProductProfile } from './products.js';
import { readFileAtRef, unreadableBaseRemedy } from './trust-base.js';

export interface MaterializedIgnore {
  /** A directory holding the base's ignore file (or an empty one). */
  dir: string;
  proposal: string | null;
}

export interface MaterializedConfig {
  path: string;
  proposal: string | null;
  source: 'base' | 'neutral';
  /** The tool's ignore file, for a tool that auto-loads one; null otherwise. */
  ignore: MaterializedIgnore | null;
  /**
   * The directory to run the tool from. Every relative path the base config
   * names ([extend] path, a baseline) was materialised here from the base
   * ref, so it resolves here and never in the head tree.
   */
  cwd: string;
  /** Head-side differences in those materialised files, one line each. */
  extendProposals: string[];
}

/** The base ref's config cannot be materialised; the gate cannot run safely. */
export class ExternalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalConfigError';
  }
}

/**
 * The `[extend] path` a gitleaks config names, or null when it names none.
 *
 * A deliberately small reader rather than a TOML parser: it looks for the
 * `path` key inside an `[extend]` table, or a top-level `extend.path`, and
 * accepts a basic or literal string. A config that names an extend path in
 * any other spelling is refused rather than guessed at, because a missed
 * extend is exactly a file read from the head.
 */
export function extendPath(config: string): string | null {
  let inExtend = false;
  let beforeAnyTable = true;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.replace(/^\s+/, '');
    if (line.startsWith('#') || line === '') {
      continue;
    }
    if (line.startsWith('[')) {
      beforeAnyTable = false;
      inExtend = /^\[\s*extend\s*\]\s*(#.*)?$/.test(line);
      continue;
    }
    const key = inExtend ? /^path\s*=/ : beforeAnyTable ? /^extend\.path\s*=/ : null;
    if (key === null || !key.test(line)) {
      continue;
    }
    const value = /=\s*(?:"([^"\\]*)"|'([^']*)')\s*(#.*)?$/.exec(line);
    if (value === null) {
      throw new ExternalConfigError(
        `the base ref's config names an [extend] path in a form conductor does not read (${line.trim()}); ` +
          'write it as a plain quoted string.'
      );
    }
    return value[1] ?? value[2] ?? null;
  }
  return null;
}

/**
 * A file's contents at the base ref, or null when the base does not carry
 * it. A read git could not make THROWS: it is never null, because null
 * selects the neutral config, and a trusted file that exists but could not
 * be read must not be replaced by a default (src/trust-base.ts,
 * readFileAtRef).
 */
function baseCopy(repoRoot: string, ref: string, file: string): string | null {
  const read = readFileAtRef(repoRoot, ref, file);
  if (read.kind === 'error') {
    throw new ExternalConfigError(
      `${file} could not be read from the base ref: ${read.detail}. Nothing was checked by this ` +
        `gate. ${unreadableBaseRemedy(file)}`
    );
  }
  return read.kind === 'file' ? read.text : null;
}

function headCopy(repoRoot: string, file: string): string | null {
  const full = path.join(repoRoot, file);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

/**
 * The proposal line for a head-side difference, or null. It says which copy
 * was actually used: the base's own, or, when the base carries none, the
 * stand-in the umbrella wrote. Saying "the base's copy" for a stand-in would
 * claim a file the base does not have.
 */
function differs(
  file: string,
  base: string | null,
  head: string | null,
  standIn = "conductor's neutral stand-in"
): string | null {
  if (head === null || head === base) {
    return null;
  }
  return base === null
    ? `${file} is not on the base ref; ${standIn} was used and this file takes effect after merge.`
    : `${file} differs from the base ref; the base's copy was used and this change takes effect after merge.`;
}

/**
 * Copies one relative file from the base ref into the run directory, at the
 * same relative path, and returns its base contents. Refuses a path that is
 * absolute or climbs out of the run directory, and a file the base ref does
 * not have: either way the tool would read something no ref approved.
 */
function materializeRelative(
  repoRoot: string,
  trustBase: string,
  cwd: string,
  file: string,
  what: string
): string {
  const target = path.resolve(cwd, file);
  if (path.isAbsolute(file) || !target.startsWith(`${cwd}${path.sep}`)) {
    throw new ExternalConfigError(
      `${what} ${file} is not a path inside the repository, so conductor cannot read it from ` +
        'the base ref; name it relative to the repository root.'
    );
  }
  const base = baseCopy(repoRoot, trustBase, path.relative(cwd, target).split(path.sep).join('/'));
  if (base === null) {
    throw new ExternalConfigError(
      `${what} ${file} does not exist on the base ref ${trustBase}, so there is no approved copy ` +
        'to read; commit it to the base branch or remove the reference.'
    );
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, base);
  return base;
}

/**
 * Proposals for config files in subdirectories that differ from the base.
 *
 * osv-scanner loads an osv-scanner.toml from each lockfile's own directory
 * when no --config is given. On a pull request --config is always given, so
 * a nested file added or edited by the pull request has no effect on the run
 * (measured against 2.6.0: a nested file ignoring lodash passes without
 * --config and blocks with it). It is still a change to how the tool behaves
 * once merged, so it is reported the way the root config is. A base copy git
 * could not read throws ExternalConfigError, like every other base read here.
 */
export function nestedConfigProposals(
  repoRoot: string,
  trustBase: string,
  trackedFiles: readonly string[],
  configFile: string
): string[] {
  return trackedFiles
    .filter((file) => file !== configFile && path.posix.basename(file) === configFile)
    .map((file) =>
      differs(file, baseCopy(repoRoot, trustBase, file), headCopy(repoRoot, file), 'the root config')
    )
    .filter((proposal): proposal is string => proposal !== null);
}

export function materializeExternalConfig(args: {
  repoRoot: string;
  trustBase: string;
  profile: ProductProfile;
  tempRoot: string;
  /** Further relative files the tool will read from its working directory, such as a baseline. */
  extraFiles?: readonly string[];
}): MaterializedConfig | null {
  const { repoRoot, trustBase, profile, tempRoot } = args;
  if (profile.configFile === null) {
    return null;
  }

  // Only an ABSENT base config selects the neutral one. An unreadable one has
  // already thrown, so the tool never runs under a default in its place.
  const base = baseCopy(repoRoot, trustBase, profile.configFile);
  const ext = path.extname(profile.configFile) || '.toml';
  const out = path.join(tempRoot, `${profile.product}-config${ext}`);
  writeFileSync(out, base ?? profile.neutralConfig ?? '');

  // The run directory. gitleaks resolves a relative [extend] path against
  // its working directory, which would otherwise be the head tree: a base
  // config extending gl-extra.toml would read the pull request's copy of it.
  const cwd = path.join(tempRoot, 'cwd');
  mkdirSync(cwd, { recursive: true });
  const extendProposals: string[] = [];
  const recordDifference = (file: string, baseCopy: string): void => {
    const proposal = differs(file, baseCopy, headCopy(repoRoot, file));
    if (proposal !== null) {
      extendProposals.push(proposal);
    }
  };
  if (profile.followsConfigExtend && base !== null) {
    // An extended file may extend again. Followed to a small fixed depth,
    // each hop from the base ref; a longer chain is refused, not truncated.
    let next = extendPath(base);
    for (let depth = 0; next !== null; depth += 1) {
      if (depth >= 4) {
        throw new ExternalConfigError('the base config [extend] chain is longer than four files.');
      }
      const copy = materializeRelative(repoRoot, trustBase, cwd, next, 'the [extend] path');
      recordDifference(next, copy);
      next = extendPath(copy);
    }
  }
  for (const file of args.extraFiles ?? []) {
    recordDifference(file, materializeRelative(repoRoot, trustBase, cwd, file, 'the file'));
  }

  let ignore: MaterializedIgnore | null = null;
  if (profile.ignoreFile !== null) {
    const name = profile.ignoreFile.name;
    const baseIgnore = baseCopy(repoRoot, trustBase, name);
    const dir = path.join(tempRoot, `${profile.product}-ignore`);
    mkdirSync(dir, { recursive: true });
    // An empty file when the base has none, for the reason the neutral
    // config exists: pointing the tool anywhere else lets it find the head's.
    writeFileSync(path.join(dir, name), baseIgnore ?? '');
    ignore = { dir, proposal: differs(name, baseIgnore, headCopy(repoRoot, name), 'an empty one') };
  }

  return {
    path: out,
    proposal: differs(profile.configFile, base, headCopy(repoRoot, profile.configFile)),
    source: base === null ? 'neutral' : 'base',
    ignore,
    cwd,
    extendProposals,
  };
}
