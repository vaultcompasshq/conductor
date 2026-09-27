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

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ProductProfile } from './products.js';

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
}

/** A file's contents at a ref, or null when the ref does not have it. */
function showAtRef(repoRoot: string, ref: string, file: string): string | null {
  const child = spawnSync('git', ['show', `${ref}:${file}`], { cwd: repoRoot, encoding: 'utf8' });
  return child.status === 0 && typeof child.stdout === 'string' ? child.stdout : null;
}

function headCopy(repoRoot: string, file: string): string | null {
  const full = path.join(repoRoot, file);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

function differs(file: string, base: string | null, head: string | null): string | null {
  if (head === null || head === base) {
    return null;
  }
  return `${file} differs from the base ref; the base's copy was used and this change takes effect after merge.`;
}

export function materializeExternalConfig(args: {
  repoRoot: string;
  trustBase: string;
  profile: ProductProfile;
  tempRoot: string;
}): MaterializedConfig | null {
  const { repoRoot, trustBase, profile, tempRoot } = args;
  if (profile.configFile === null) {
    return null;
  }

  const base = showAtRef(repoRoot, trustBase, profile.configFile);
  const ext = path.extname(profile.configFile) || '.toml';
  const out = path.join(tempRoot, `${profile.product}-config${ext}`);
  writeFileSync(out, base ?? profile.neutralConfig ?? '');

  let ignore: MaterializedIgnore | null = null;
  if (profile.ignoreFile !== null) {
    const name = profile.ignoreFile.name;
    const baseIgnore = showAtRef(repoRoot, trustBase, name);
    const dir = path.join(tempRoot, `${profile.product}-ignore`);
    mkdirSync(dir, { recursive: true });
    // An empty file when the base has none, for the reason the neutral
    // config exists: pointing the tool anywhere else lets it find the head's.
    writeFileSync(path.join(dir, name), baseIgnore ?? '');
    ignore = { dir, proposal: differs(name, baseIgnore, headCopy(repoRoot, name)) };
  }

  return {
    path: out,
    proposal: differs(profile.configFile, base, headCopy(repoRoot, profile.configFile)),
    source: base === null ? 'neutral' : 'base',
    ignore,
  };
}
