// The vulnerabilities gate's base comparison (osv design, item 1.3, section 3).
//
// On a pull-request run whose head scan blocked, osv-scanner is also run on
// the BASE copies of the lockfiles that carry findings, and each head finding
// is labelled `introduced` or `present-on-base` by a key that names the
// advisory, the ecosystem, the package, the installed version and the
// repository-relative lockfile path. The vulnerabilities gate's own policy
// key (present-on-base, read from the base policy) then decides whether a
// present-on-base finding blocks.
//
// Every failure here labels toward `introduced`: an unreadable base, a base
// run that did not finish, output that would not parse, a path that cannot be
// made relative. The base run never makes the gate could-not-run and never
// removes a head finding. Nothing the pull request controls can move a
// finding from introduced to present-on-base except making the head lockfile
// byte-equal to the base's at the same path, in which case the label is true.

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Diagnostic, Finding } from './envelope.js';
import { realPathInside, runGit } from './git.js';
import { normalizeOsvScanner } from './normalize.js';
import { ABSENT_ON_BASE, baseReader, packageCounts } from './osv-coverage.js';
import type { PresentOnBase } from './policy.js';
import { osvLockfileKind, sameOsvFamily } from './products.js';
import { checkRequirementsPins } from './requirements-pin.js';
import { readFileAtRefBytes, treeEntryAt } from './trust-base.js';

export type BaselineLabel = 'introduced' | 'present-on-base';

/**
 * What the comparison did, carried on the gate's outcome so a report (and the
 * exit-code exception) never needs the policy file to explain itself.
 * Present only when a comparison ran (section 3.1).
 */
export interface BaseComparison {
  /** The trust base the copies were read from. */
  ref: string;
  /** The base policy's present-on-base value, block when it said nothing. */
  policy: PresentOnBase;
  introduced: number;
  presentOnBase: number;
  /** Lockfiles whose findings all count as introduced because no comparison was possible, with why. */
  unavailable: Array<{ path: string; reason: string }>;
  /**
   * Verdicts in the head run's raw output that are not advisories (licence
   * violations, deprecated packages, any unmapped package-level field). Read
   * by condition (f) of gateExitBlocks.
   */
  otherVerdicts: string[];
}

/** The comparison key: advisory id, ecosystem, package, installed version, lockfile path. */
export function comparisonKey(finding: Finding): string | null {
  if (finding.subject.kind !== 'package') {
    return null;
  }
  const id = finding.ruleId.startsWith('osv-scanner/') ? finding.ruleId.slice('osv-scanner/'.length) : finding.ruleId;
  const ecosystem = typeof finding.details.ecosystem === 'string' ? finding.details.ecosystem : '';
  const version = typeof finding.details.version === 'string' ? finding.details.version : '';
  return JSON.stringify([id, ecosystem, finding.subject.name, version, finding.subject.manifest]);
}

/**
 * Labels head findings against base findings. Pure, so the comparison can be
 * tested without spawning anything.
 *
 * A finding in a lockfile in `unchanged` (byte-equal to the base, its whole
 * include closure too) is present-on-base without a base scan: identical
 * input, config and database. A finding in a lockfile in `unavailable` is
 * introduced whatever the base said. Otherwise it is present-on-base exactly
 * when a base finding has the same key.
 */
export function labelAgainstBase(
  head: readonly Finding[],
  base: readonly Finding[],
  unavailable: ReadonlySet<string>,
  unchanged: ReadonlySet<string>
): Finding[] {
  const baseKeys = new Set(base.map(comparisonKey).filter((key): key is string => key !== null));
  return head.map((finding) => {
    const manifest = finding.subject.kind === 'package' ? finding.subject.manifest : null;
    let label: BaselineLabel = 'introduced';
    if (manifest !== null && !unavailable.has(manifest)) {
      const key = comparisonKey(finding);
      if (unchanged.has(manifest) || (key !== null && baseKeys.has(key))) {
        label = 'present-on-base';
      }
    }
    return { ...finding, details: { ...finding.details, baseline: label } };
  });
}

export interface BaseSpawnResult {
  status: number | null;
  stdout: string;
  error: Error | undefined;
}

export interface CompareArgs {
  repoRoot: string;
  ref: string;
  workDir: string;
  policy: PresentOnBase;
  version: string | null;
  headFindings: readonly Finding[];
  /** Every file the head run was handed, repository-relative. */
  headLockfiles: readonly string[];
  /** For each requirements file, the head include closure when the head copy passed the pin check. */
  closures: ReadonlyMap<string, readonly string[] | null>;
  otherVerdicts: readonly string[];
  /** The head run's full argv. */
  headArgv: readonly string[];
  /** The base run's full argv for these absolute copy paths, built by the same gateArgs. */
  baseArgv: (copies: readonly string[]) => string[];
  /** Runs the same binary, with the same timeout, from `cwd`. */
  spawn: (argv: readonly string[], cwd: string) => BaseSpawnResult;
  /** Every spelling of a directory a child could print it in. */
  rootSpellings: (dir: string) => string[];
}

export interface CompareResult {
  findings: Finding[];
  comparison: BaseComparison;
  diagnostics: Diagnostic[];
}

/** The argv with every --lockfile pair removed, for the symmetry check. */
function withoutLockfiles(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--lockfile') {
      i += 1;
      continue;
    }
    out.push(argv[i]!);
  }
  return out;
}

/** The first token where two argvs differ, for the unavailable note. */
function firstDifference(a: readonly string[], b: readonly string[]): string {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] ?? b[i] ?? '(end)';
    }
  }
  return '(none)';
}

/**
 * Head object ids for files on disk, with filters OFF: a clean filter comes
 * from the head's own .gitattributes, so a filtered id would let the head
 * decide what "equal to the base" means. One git call for all of them. Null
 * when git could not answer, which disables the shortcut and never enables it.
 */
function headObjectIds(repoRoot: string, files: readonly string[]): Map<string, string> | null {
  if (files.length === 0) {
    return new Map();
  }
  const out = runGit(repoRoot, ['hash-object', '--no-filters', '--stdin-paths'], {
    input: `${files.join('\n')}\n`,
  });
  if (out.error !== undefined || out.status !== 0) {
    return null;
  }
  const ids = out.stdout.split('\n').filter((line) => line !== '');
  if (ids.length !== files.length) {
    return null;
  }
  return new Map(files.map((file, i) => [file, ids[i]!]));
}

/** Writes one base copy under `dir`, refusing an absolute or climbing path. */
function placeCopy(dir: string, file: string, bytes: Buffer): string {
  const target = path.resolve(dir, file);
  if (path.isAbsolute(file) || !target.startsWith(`${dir}${path.sep}`)) {
    throw new Error(`${file} is not a path inside the repository`);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return target;
}

function unavailableNotes(unavailable: Array<{ path: string; reason: string }>): Diagnostic[] {
  const byReason = new Map<string, string[]>();
  for (const entry of unavailable) {
    byReason.set(entry.reason, [...(byReason.get(entry.reason) ?? []), entry.path]);
  }
  return [...byReason].map(([reason, paths]) => ({
    code: 'conductor/base-comparison-unavailable',
    message:
      `base comparison unavailable for ${paths.join(', ')}: ${reason}; every finding there counts ` +
      'as introduced.',
  }));
}

/**
 * The result when the comparison itself failed in a way compareWithBase did
 * not anticipate: every lockfile with findings is unavailable and every
 * finding is introduced. Never could-not-run.
 */
export function comparisonFailed(args: CompareArgs, reason: string): CompareResult {
  const unavailable = [
    ...new Set(
      args.headFindings
        .map((finding) => (finding.subject.kind === 'package' ? finding.subject.manifest : null))
        .filter((manifest): manifest is string => manifest !== null)
    ),
  ]
    .sort()
    .map((file) => ({ path: file, reason }));
  const findings = labelAgainstBase(args.headFindings, [], new Set(unavailable.map((u) => u.path)), new Set());
  return {
    findings,
    comparison: {
      ref: args.ref,
      policy: args.policy,
      introduced: findings.length,
      presentOnBase: 0,
      unavailable,
      otherVerdicts: [...args.otherVerdicts],
    },
    diagnostics: unavailableNotes(unavailable),
  };
}

/** How the emptied-lockfile check's one spawn went, classified by the caller's spawnFailure. */
export interface EmptiedSpawnResult {
  status: number | null;
  stderr: string;
  failure: null | { reason: 'timed-out'; signal: string | null } | { reason: 'spawn-failed'; message: string };
}

export interface EmptiedCheckArgs {
  repoRoot: string;
  ref: string;
  workDir: string;
  /** Repository-relative: the emptied handed lockfiles, or every handed one on exit 128. */
  emptied: readonly string[];
  /** Repository-relative: base lockfiles the head no longer tracks (deleted or moved). */
  removed: readonly string[];
  /** The head run's package count for each handed lockfile, for the same-directory replacement rule. */
  headCounts: ReadonlyMap<string, number>;
  /** Null when nothing was handed and the head was never spawned: no symmetry check. */
  headArgv: readonly string[] | null;
  baseArgv: (copies: readonly string[]) => string[];
  /** What is left of the gate's time limit after the head scan. */
  budgetMs: number;
  spawn: (argv: readonly string[], cwd: string, timeoutMs: number) => EmptiedSpawnResult;
}

export type EmptiedCheckResult =
  | { kind: 'clear' }
  | { kind: 'emptied'; files: Array<{ path: string; packages: number; removed: boolean }> }
  | { kind: 'unverified'; detail: string }
  | { kind: 'timed-out'; elapsedMs: number; signal: string | null };

/**
 * Whether `file` is a regular file (mode 100644 or 100755, stage 0) in the
 * head's index: the listing the gate's handed files come from (`git
 * ls-files`). A symbolic link (120000), a submodule, a conflicted or missing
 * entry, and an index git cannot read are all false (fail closed). The path
 * is passed as a literal pathspec, so no character in it is a glob.
 */
export function regularInHeadIndex(repoRoot: string, file: string): boolean {
  const out = runGit(repoRoot, ['ls-files', '--stage', '-z', '--', `:(literal)${file}`]);
  if (out.error !== undefined || out.status !== 0) {
    return false;
  }
  const entries = out.stdout.split('\0').filter((entry) => entry !== '');
  if (entries.length !== 1) {
    return false;
  }
  const match = /^(\d{6}) [0-9a-f]+ (\d)\t(.*)$/s.exec(entries[0]!);
  return (
    match !== null &&
    (match[1] === '100644' || match[1] === '100755') &&
    match[2] === '0' &&
    match[3] === file
  );
}

/**
 * The emptied-lockfile base check (design
 * docs/superpowers/specs/2026-10-18-emptied-lockfile-under-trust-base.md,
 * audit 2026-10-18 N1). On a decided trust base, a handed lockfile that read
 * no packages at the head, and a base lockfile the head deleted or moved,
 * is copied from the base and osv-scanner is run once on those copies; a
 * copy with packages means the head removed what the gate judges. A removed
 * file is cleared only by a head-handed lockfile in the SAME directory that
 * read packages, is not a requirements file, is absent from the base tree,
 * is of the removed file's ecosystem family, and is a regular file in the
 * head's index (a migration, say npm to pnpm, beside the same manifest).
 *
 * FAIL CLOSED, unlike compareWithBase, whose labels only ever move toward
 * introduced. This check exists only to stop a head from removing what the
 * gate judges, so anything that keeps it from clearing the head (a base
 * copy that cannot be read, an asymmetric command line, a base run that
 * fails, times out or prints no count for a copy) is a failure the caller
 * turns into could-not-run. Requirements files are not checked (known-open).
 */
export function checkEmptiedAgainstBase(args: EmptiedCheckArgs): EmptiedCheckResult {
  const baseDir = path.join(args.workDir, 'osv-base', 'emptied');
  const removed = new Set(args.removed);
  const candidates = [...new Set([...args.emptied, ...args.removed])].filter(
    (file) => osvLockfileKind(path.posix.basename(file)) !== 'requirements'
  );
  const copies: string[] = [];
  const copied: string[] = [];
  for (const file of candidates) {
    const read = readFileAtRefBytes(args.repoRoot, args.ref, file);
    if (read.kind === 'absent') {
      continue;
    }
    if (read.kind === 'error') {
      return { kind: 'unverified', detail: `the base copy of ${file} cannot be read (${read.detail})` };
    }
    if (realPathInside(args.repoRoot, args.workDir)) {
      return {
        kind: 'unverified',
        detail:
          'the temporary directory is inside the repository, so no base copy can be kept outside the ' +
          'tree being judged',
      };
    }
    try {
      copies.push(placeCopy(baseDir, file, read.bytes));
    } catch (err) {
      return { kind: 'unverified', detail: err instanceof Error ? err.message : String(err) };
    }
    copied.push(file);
  }
  if (copies.length === 0) {
    return { kind: 'clear' };
  }

  const baseArgv = args.baseArgv(copies);
  const headRest = args.headArgv === null ? null : withoutLockfiles(args.headArgv);
  const baseRest = withoutLockfiles(baseArgv);
  if (headRest !== null && JSON.stringify(headRest) !== JSON.stringify(baseRest)) {
    return {
      kind: 'unverified',
      detail: `the base run's command line would differ from the head run's at ${firstDifference(headRest, baseRest)}`,
    };
  }
  if (args.budgetMs <= 0) {
    return { kind: 'timed-out', elapsedMs: 0, signal: null };
  }

  const started = Date.now();
  const child = args.spawn(baseArgv, baseDir, args.budgetMs);
  if (child.failure !== null) {
    return child.failure.reason === 'timed-out'
      ? { kind: 'timed-out', elapsedMs: Date.now() - started, signal: child.failure.signal }
      : { kind: 'unverified', detail: `osv-scanner could not be run on the base copies (${child.failure.message})` };
  }
  if (child.status === null) {
    return { kind: 'unverified', detail: 'osv-scanner did not finish on the base copies' };
  }
  // Exit 128: every copy parsed to nothing, so the base had nothing either.
  if (child.status === 128) {
    return { kind: 'clear' };
  }
  if (child.status !== 0 && child.status !== 1) {
    return { kind: 'unverified', detail: `osv-scanner exited ${child.status} on the base copies` };
  }
  const counts = packageCounts(child.stderr, copies, baseDir);
  const unread = copied.filter((_, index) => !counts.has(copies[index]!));
  if (unread.length > 0) {
    return {
      kind: 'unverified',
      detail: `osv-scanner printed no package count for the base copy of ${unread.join(', ')}`,
    };
  }
  // A removed file is replaced only by a head-handed lockfile in the same
  // directory that read packages, that is not a requirements file, and that
  // the base tree does not have: one elsewhere, or one the base already had
  // (a Cargo.lock beside the deleted package-lock.json), carries another
  // manifest's packages. A base listing that errors is not absent, so that
  // file does not count (fail closed).
  //
  // 0.13.0, operator ruling of 2026-10-18: also of the removed file's
  // ecosystem family (a NEW Cargo.lock carries a Rust manifest's packages,
  // not the npm ones the head removed; an unknown family matches nothing),
  // and a regular file in the head's index (a symbolic link to a populated
  // lockfile elsewhere reads that file's packages). The cheap checks first,
  // so git is asked only about a candidate that could otherwise count.
  const newOnHead = (other: string): boolean => treeEntryAt(args.repoRoot, args.ref, other).kind === 'absent';
  const replaced = (file: string): boolean =>
    [...args.headCounts].some(
      ([other, count]) =>
        other !== file &&
        count > 0 &&
        path.posix.dirname(other) === path.posix.dirname(file) &&
        osvLockfileKind(path.posix.basename(other)) !== 'requirements' &&
        sameOsvFamily(other, file) &&
        regularInHeadIndex(args.repoRoot, other) &&
        newOnHead(other)
    );
  const emptied = copied
    .map((file, index) => ({ path: file, packages: counts.get(copies[index]!) ?? 0, removed: removed.has(file) }))
    .filter((entry) => entry.packages > 0 && !(entry.removed && replaced(entry.path)));
  return emptied.length === 0 ? { kind: 'clear' } : { kind: 'emptied', files: emptied };
}

/**
 * Runs the comparison. Assumes the caller has established section 3.1: a
 * decided trust base, a head run that exited blocked, at least one finding.
 * Never throws for anything it anticipated; the caller still wraps it, and
 * any throw becomes "every finding introduced", never could-not-run.
 */
export function compareWithBase(args: CompareArgs): CompareResult {
  const unavailable: Array<{ path: string; reason: string }> = [];
  const unchanged = new Set<string>();
  const handed = new Set(args.headLockfiles);
  const withFindings = [
    ...new Set(
      args.headFindings
        .map((finding) => (finding.subject.kind === 'package' ? finding.subject.manifest : null))
        .filter((manifest): manifest is string => manifest !== null && handed.has(manifest))
    ),
  ].sort();

  const baseDir = path.join(args.workDir, 'osv-base');
  let baseFindings: Finding[] = [];

  const finish = (): CompareResult => {
    const unavailablePaths = new Set(unavailable.map((entry) => entry.path));
    const labelled = labelAgainstBase(args.headFindings, baseFindings, unavailablePaths, unchanged).map(
      (finding) =>
        args.policy === 'report' && finding.details.baseline === 'present-on-base'
          ? { ...finding, blocking: false }
          : finding
    );
    const present = labelled.filter((finding) => finding.details.baseline === 'present-on-base').length;
    return {
      findings: labelled,
      comparison: {
        ref: args.ref,
        policy: args.policy,
        introduced: labelled.length - present,
        presentOnBase: present,
        unavailable,
        otherVerdicts: [...args.otherVerdicts],
      },
      diagnostics: unavailableNotes(unavailable),
    };
  };

  // The work directory must be outside the repository, or a base copy would
  // sit inside the tree being judged (a TMPDIR set inside the checkout).
  if (realPathInside(args.repoRoot, args.workDir)) {
    for (const file of withFindings) {
      unavailable.push({
        path: file,
        reason:
          'the temporary directory is inside the repository, so no base copy can be kept outside ' +
          'the tree being judged',
      });
    }
    return finish();
  }

  // 1. The unchanged shortcut: object ids, filters off, the whole closure.
  const closureOf = (file: string): readonly string[] | null =>
    osvLockfileKind(path.posix.basename(file)) === 'requirements' ? (args.closures.get(file) ?? null) : [file];
  const shortcutFiles = [
    ...new Set(withFindings.flatMap((file) => closureOf(file) ?? [])),
  ].sort();
  const headIds = headObjectIds(args.repoRoot, shortcutFiles);
  const toCopy: string[] = [];
  for (const file of withFindings) {
    const closure = closureOf(file);
    if (closure !== null && headIds !== null) {
      const same = closure.every((member) => {
        const entry = treeEntryAt(args.repoRoot, args.ref, member);
        return (
          entry.kind === 'entry' &&
          entry.type === 'blob' &&
          (entry.mode === '100644' || entry.mode === '100755') &&
          entry.sha === headIds.get(member)
        );
      });
      if (same) {
        unchanged.add(file);
        continue;
      }
    }
    toCopy.push(file);
  }

  // 2 to 4. Absent, unreadable, or copied byte for byte from the base.
  const copies: string[] = [];
  const copied: string[] = [];
  for (const file of toCopy) {
    const kind = osvLockfileKind(file);
    if (kind === 'requirements') {
      const bytes = new Map<string, Buffer>();
      const check = checkRequirementsPins(file, baseReader(args.repoRoot, args.ref, bytes));
      if (check.topMissing === ABSENT_ON_BASE) {
        continue;
      }
      if (!check.pinned) {
        unavailable.push({
          path: file,
          reason:
            'its base copy, or a file it includes there, is not pinned with == or cannot be read, so ' +
            'it cannot be compared',
        });
        continue;
      }
      try {
        for (const member of check.files) {
          placeCopy(baseDir, member, bytes.get(member)!);
        }
      } catch (err) {
        unavailable.push({ path: file, reason: err instanceof Error ? err.message : String(err) });
        continue;
      }
    } else {
      const read = readFileAtRefBytes(args.repoRoot, args.ref, file);
      if (read.kind === 'absent') {
        continue;
      }
      if (read.kind === 'error') {
        unavailable.push({ path: file, reason: `the base copy cannot be read (${read.detail})` });
        continue;
      }
      try {
        placeCopy(baseDir, file, read.bytes);
      } catch (err) {
        unavailable.push({ path: file, reason: err instanceof Error ? err.message : String(err) });
        continue;
      }
    }
    copies.push(path.join(baseDir, file));
    copied.push(file);
  }

  if (copies.length === 0) {
    return finish();
  }

  const failAll = (reason: string): CompareResult => {
    for (const file of copied) {
      unavailable.push({ path: file, reason });
    }
    baseFindings = [];
    return finish();
  };

  // The symmetry check: the base command line is the head's with only the
  // lockfile arguments replaced. Any other difference (a resolution mode, a
  // call-analysis flag, a config) would compare two different scans.
  const baseArgv = args.baseArgv(copies);
  const headRest = withoutLockfiles(args.headArgv);
  const baseRest = withoutLockfiles(baseArgv);
  if (JSON.stringify(headRest) !== JSON.stringify(baseRest)) {
    return failAll(
      `the base run's command line would differ from the head run's at ${firstDifference(headRest, baseRest)}`
    );
  }

  const child = args.spawn(baseArgv, baseDir);
  if (child.error !== undefined || child.status === null) {
    return failAll('osv-scanner did not finish on the base copies (it timed out, was killed or could not start)');
  }
  if (child.status === 128) {
    // The copies parsed to no packages: nothing on the base to match.
    baseFindings = [];
    return finish();
  }
  if (child.status !== 0 && child.status !== 1) {
    return failAll(`osv-scanner exited ${child.status} on the base copies`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(child.stdout);
  } catch {
    return failAll('osv-scanner printed no valid JSON for the base copies');
  }
  try {
    let roots: string[];
    try {
      roots = args.rootSpellings(realpathSync(baseDir));
    } catch {
      roots = [];
    }
    roots = [...new Set([...args.rootSpellings(baseDir), ...roots])];
    baseFindings = normalizeOsvScanner(parsed, args.version, child.status === 1, roots, copied).findings;
  } catch (err) {
    return failAll(`the base output could not be read (${err instanceof Error ? err.message : String(err)})`);
  }
  return finish();
}
