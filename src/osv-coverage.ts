// Which tracked files the vulnerabilities gate hands osv-scanner (osv design,
// item 1.1, sections 2.1 to 2.4).
//
// Selection only. Nothing here raises a finding: a file left out is named in
// a diagnostic, the way the basename list has always decided what is handed
// over without judging anything. The verdict is still osv-scanner's own.

import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Diagnostic } from './envelope.js';
import { runGit } from './git.js';
import { osvLockfileKind } from './products.js';
import {
  checkRequirementsPins,
  describePinProblem,
  type IncludeRead,
  type PinCheck,
} from './requirements-pin.js';
import { readFileAtRefBytes } from './trust-base.js';

export interface OsvSelection {
  /** Every file handed over, repository-relative, sorted. */
  handed: string[];
  /** Requirements files left out, in candidate order. */
  notScanned: string[];
  /** The umbrella's own diagnostics: not-scanned and not-pinned. */
  diagnostics: Diagnostic[];
  /** Run notes, one per scanned requirements file: direct requirements only. */
  notes: Diagnostic[];
  /**
   * For each scanned requirements file, the head include closure when the
   * head copy passed the pin check, else null. The unchanged shortcut
   * (section 3.2) compares the whole closure, and a head closure that did
   * not pass is never taken as complete.
   */
  closures: Map<string, string[] | null>;
}

/**
 * A reader over the head: a TRACKED regular file on disk. On disk because
 * that is the copy osv-scanner reads; tracked because an untracked file is
 * not part of what is being judged.
 */
export function headReader(repoRoot: string, tracked: ReadonlySet<string>): (file: string) => IncludeRead {
  return (file) => {
    const full = path.join(repoRoot, file);
    let stats;
    try {
      stats = lstatSync(full);
    } catch {
      return { kind: 'missing', why: tracked.has(file) ? 'is tracked but not on disk' : 'does not exist' };
    }
    if (!tracked.has(file)) {
      return { kind: 'missing', why: 'is not tracked' };
    }
    if (!stats.isFile()) {
      return { kind: 'missing', why: 'is not a regular file' };
    }
    return { kind: 'file', text: readFileSync(full, 'utf8') };
  };
}

/** Why a base reader found nothing: the base tree has no such path. */
export const ABSENT_ON_BASE = 'does not exist on the base';

/**
 * A reader over the trust base, through the one reader (readFileAtRef's byte
 * variant). Every byte it hands out is kept in `bytes`, so a base copy that is
 * written out later is exactly the blob that was checked, never a re-read.
 */
export function baseReader(
  repoRoot: string,
  ref: string,
  bytes: Map<string, Buffer> = new Map()
): (file: string) => IncludeRead {
  return (file) => {
    const read = readFileAtRefBytes(repoRoot, ref, file);
    if (read.kind === 'absent') {
      return { kind: 'missing', why: ABSENT_ON_BASE };
    }
    if (read.kind === 'error') {
      return { kind: 'missing', why: `could not be read from the base (${read.detail})` };
    }
    bytes.set(file, read.bytes);
    return { kind: 'file', text: read.bytes.toString('utf8') };
  };
}

const DIRECT_ONLY = 'direct requirements only; no lockfile, so transitive packages are not scanned.';

/** The not-scanned sentence for one requirements file. */
function notScannedMessage(file: string, check: PinCheck): string {
  return `${file} not scanned: ${describePinProblem(file, check.problems[0]!)}.`;
}

/**
 * Picks what osv-scanner is handed from the tracked files.
 *
 * `decidedRef` is the trust base on a pull-request run, and switches the
 * ratchet on (section 2.3): a requirements file whose head copy fails the pin
 * check is still handed over when its base copy, and the base include
 * closure, passes. A base copy that exists and cannot be read is handed over
 * too: leaving it out would let an unreadable base drop a file from the scan,
 * which is the direction this gate does not fail in.
 */
export function selectOsvInputs(args: {
  repoRoot: string;
  tracked: readonly string[];
  decidedRef?: string;
}): OsvSelection {
  const trackedSet = new Set(args.tracked);
  const candidates = args.tracked
    // Never a vendored copy under node_modules: that is a dependency's own
    // lockfile, not a statement about what this repository resolves.
    .filter((file) => !file.split('/').includes('node_modules'))
    .filter((file) => osvLockfileKind(path.posix.basename(file)) !== null)
    .sort();

  const head = headReader(args.repoRoot, trackedSet);
  const base = args.decidedRef === undefined ? null : baseReader(args.repoRoot, args.decidedRef);

  const handed: string[] = [];
  const notScanned: string[] = [];
  const diagnostics: Diagnostic[] = [];
  const notes: Diagnostic[] = [];
  const closures = new Map<string, string[] | null>();

  for (const file of candidates) {
    if (osvLockfileKind(path.posix.basename(file)) === 'bare') {
      handed.push(file);
      continue;
    }
    const headCheck = checkRequirementsPins(file, head);
    if (headCheck.pinned) {
      handed.push(file);
      closures.set(file, headCheck.files);
      let suffix = '';
      if (base !== null) {
        const baseCheck = checkRequirementsPins(file, base);
        if (!baseCheck.pinned && baseCheck.topMissing !== ABSENT_ON_BASE) {
          suffix = ' Newly pinned in this pull request.';
        }
      }
      notes.push({ code: 'conductor/requirements-direct-only', message: `${file}: ${DIRECT_ONLY}${suffix}` });
      continue;
    }
    if (base !== null) {
      const baseCheck = checkRequirementsPins(file, base);
      const topUnreadable = baseCheck.topMissing !== null && baseCheck.topMissing !== ABSENT_ON_BASE;
      if (baseCheck.pinned || topUnreadable) {
        handed.push(file);
        closures.set(file, null);
        const lines = headCheck.problems.map((problem) => describePinProblem(file, problem)).join('; ');
        const why = baseCheck.pinned
          ? 'Its copy on the base is pinned, so the file stays scanned under the ratchet; the lines named are read as written.'
          : 'Its copy on the base could not be read, so the file stays scanned; the lines named are read as written.';
        diagnostics.push({
          code: 'conductor/requirements-not-pinned',
          message: `${file} is scanned although ${lines}. ${why}`,
        });
        notes.push({
          code: 'conductor/requirements-direct-only',
          message: `${file}: ${DIRECT_ONLY} ${baseCheck.pinned ? 'Pinned on the base; scanned under the ratchet.' : 'Base copy unreadable; scanned under the ratchet.'}`,
        });
        continue;
      }
    }
    notScanned.push(file);
    diagnostics.push({ code: 'conductor/requirements-not-scanned', message: notScannedMessage(file, headCheck) });
  }

  return { handed: handed.sort(), notScanned, diagnostics, notes, closures };
}

/**
 * Notes for every basename-matched file tracked on the base and absent from
 * the head (section 3.2): deleted, moved, or renamed to a name the matcher
 * does not take. Such a file is not scanned on either side, and saying so is
 * all this does: it never blocks. A base listing git could not make yields no
 * note rather than a guess.
 */
export function noLongerScanned(repoRoot: string, ref: string, tracked: ReadonlySet<string>): Diagnostic[] {
  if (ref.startsWith('-')) {
    return [];
  }
  const listing = runGit(repoRoot, ['ls-tree', '-r', '-z', '--name-only', ref], { maxBuffer: 64 * 1024 * 1024 });
  if (listing.error !== undefined || listing.status !== 0) {
    return [];
  }
  return listing.stdout
    .split('\0')
    .filter((file) => file !== '' && !file.split('/').includes('node_modules'))
    .filter((file) => osvLockfileKind(path.posix.basename(file)) !== null && !tracked.has(file))
    .sort()
    .map((file) => ({
      code: 'conductor/lockfile-no-longer-scanned',
      message:
        `${file} is tracked on the base and not in this pull request, so it is no longer scanned ` +
        '(by either run). Its removal is visible in the diff.',
    }));
}

/** The nothing-to-scan sentence when every candidate was a requirements file left out. */
export function nothingScannableMessage(notScanned: readonly string[]): string {
  return (
    `osv-scanner had nothing it could scan: ${notScanned.length} requirements file(s) not pinned ` +
    `(${notScanned.join(', ')}).`
  );
}

/** The run detail beside `lockfiles`: how many requirements files were left out, and which. */
export function notScannedDetail(notScanned: readonly string[]): string {
  return `${notScanned.length} (${notScanned.join(', ')})`;
}

/** The note when a policy's no-resolve was dropped from an invocation. */
export const NO_RESOLVE_OVERRIDDEN =
  'options.no-resolve in .guardrails.yaml was not passed: requirements files are always scanned ' +
  'with --no-resolve (direct requirements only).';
