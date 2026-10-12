// The pin check for pip requirements files.
//
// osv-scanner reads a requirements file as a list of packages at the versions
// written in it. A line pinned with == names one version, and an advisory
// against that version is a statement about what this repository installs.
// Any other line (>=, ~=, a range, no version at all) names a set of versions,
// and whatever osv-scanner reports for it is a guess: with its default
// resolution it is the registry's latest, with --no-resolve it is the lower
// bound. So a requirements file is handed over only when every requirement in
// it, and in every file it includes with -r, is pinned with ==.
//
// This SELECTS what the tool is handed, like the basename list beside it in
// src/products.ts, and raises no finding of its own: a file left out is named
// on the coverage line with the line that stopped it (src/gate-runner.ts).
//
// Includes are followed here rather than left to osv-scanner, because
// osv-scanner 2.4.0 follows -r and swallows a missing include (one stderr
// line, the rest scanned, exit decided by what it did read): a top file whose
// include is absent would be scanned and silently under-read. It resolves an
// include relative to the including file's directory and survives a cycle,
// and so does this.

import path from 'node:path';

/** One file the check asked for: its text, or why there is none. */
export type IncludeRead = { kind: 'file'; text: string } | { kind: 'missing'; why: string };

export interface PinProblem {
  /** The file the problem is in, repository-relative. */
  file: string;
  /** The physical line a logical line starts on; null for a problem with an include itself. */
  line: number | null;
  /** The logical line as written, cleaned for printing; for an include, the path as written. */
  text: string;
  kind: 'unpinned' | 'arbitrary-equality' | 'unrecognised' | 'include';
  /** For an include: why it cannot be read ("which is outside the repository"). */
  why?: string;
}

export interface PinCheck {
  pinned: boolean;
  /** Every file read, the top file first, repository-relative. */
  files: string[];
  /** Direct references (-e, paths, URLs, name @ url) left out of the check. */
  excluded: number;
  problems: PinProblem[];
  /** Why the top file itself could not be read, or null when it was. */
  topMissing: string | null;
}

/** The deepest include chain followed. A deeper one leaves the top file unscanned. */
export const MAX_INCLUDE_DEPTH = 8;

/** Options that take a value and say nothing about which packages are installed. */
const IGNORED_WITH_VALUE = [
  '-c',
  '--constraint',
  '-i',
  '--index-url',
  '--extra-index-url',
  '-f',
  '--find-links',
  '--trusted-host',
  '--only-binary',
  '--no-binary',
  '--use-feature',
];

/** Flags with no value that say nothing about which packages are installed. */
const IGNORED_FLAGS = ['--pre', '--prefer-binary', '--require-hashes'];

const NAME = '[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?';
const EXTRAS = '\\[[^\\]]*\\]';
const REQUIREMENT = new RegExp(`^(${NAME})\\s*(${EXTRAS})?\\s*(.*)$`);
const NAME_AT_URL = new RegExp(`^${NAME}\\s*(${EXTRAS})?\\s*@\\s*\\S`);
const URL = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const HASH_OPTION = /\s+--hash(?:=|\s+)\S+/g;

/** A logical line: continuation joined, comment removed, trimmed, never empty. */
interface LogicalLine {
  line: number;
  text: string;
}

function logicalLines(text: string): LogicalLine[] {
  const physical = text.split(/\r?\n/);
  const out: LogicalLine[] = [];
  let buffer: string | null = null;
  let start = 0;
  const flush = (): void => {
    if (buffer === null) {
      return;
    }
    // A # that starts the line or follows whitespace starts a comment; one
    // inside a token (a URL fragment, #egg=) does not.
    const stripped = buffer.replace(/(^|\s)#.*$/, '').trim();
    if (stripped !== '') {
      out.push({ line: start, text: stripped });
    }
    buffer = null;
  };
  for (const [index, raw] of physical.entries()) {
    if (buffer === null) {
      buffer = '';
      start = index + 1;
    }
    if (raw.endsWith('\\')) {
      buffer += `${raw.slice(0, -1)} `;
      continue;
    }
    buffer += raw;
    flush();
  }
  flush();
  return out;
}

/** Splits a leading option into its name and value: "-rfoo", "-r foo", "--x=foo", "--x foo". */
function option(text: string): { name: string; value: string } | null {
  const long = /^(--[A-Za-z0-9-]+)(?:=|\s+|$)(.*)$/.exec(text);
  if (long !== null) {
    return { name: long[1]!, value: long[2]!.trim() };
  }
  const short = /^(-[A-Za-z])\s*(.*)$/.exec(text);
  if (short !== null) {
    return { name: short[1]!, value: short[2]!.trim() };
  }
  return null;
}

/** Printable, one line, no double quotes, capped: the line goes into a report. */
function printable(text: string): string {
  const flat = text.replace(/[^\x20-\x7e]/g, '?').replace(/"/g, "'");
  return flat.length > 120 ? `${flat.slice(0, 117)}...` : flat;
}

function isDirectReference(text: string): boolean {
  if (URL.test(text) || NAME_AT_URL.test(text)) {
    return true;
  }
  // A local path: anything that starts like one or has a path separator in
  // the part before a version specifier, or names an archive.
  const head = text.split(/[\s;=<>!~]/)[0] ?? '';
  return (
    head.startsWith('.') ||
    head.startsWith('/') ||
    head.startsWith('~') ||
    head.includes('/') ||
    head.includes('\\') ||
    /\.(whl|zip|tar\.gz|tgz|tar\.bz2)$/i.test(head)
  );
}

type LineVerdict =
  | { kind: 'pinned' }
  | { kind: 'ignored' }
  | { kind: 'excluded' }
  | { kind: 'include'; target: string }
  | { kind: 'unpinned' }
  | { kind: 'arbitrary-equality' }
  | { kind: 'unrecognised' };

function classify(text: string): LineVerdict {
  if (text.startsWith('-')) {
    const opt = option(text);
    if (opt === null) {
      return { kind: 'unrecognised' };
    }
    if (opt.name === '-r' || opt.name === '--requirement') {
      return opt.value === '' ? { kind: 'unrecognised' } : { kind: 'include', target: opt.value };
    }
    if (opt.name === '-e' || opt.name === '--editable') {
      return { kind: 'excluded' };
    }
    if (IGNORED_WITH_VALUE.includes(opt.name) && opt.value !== '') {
      return { kind: 'ignored' };
    }
    if (IGNORED_FLAGS.includes(opt.name) && opt.value === '') {
      return { kind: 'ignored' };
    }
    return { kind: 'unrecognised' };
  }
  if (isDirectReference(text)) {
    return { kind: 'excluded' };
  }
  // Hash options may follow a requirement; nothing else may.
  const withoutHashes = text.replace(HASH_OPTION, '');
  const [spec = '', ...marker] = withoutHashes.split(';');
  if (marker.join(';').includes(' --') || /\s--?[A-Za-z]/.test(spec)) {
    return { kind: 'unrecognised' };
  }
  const match = REQUIREMENT.exec(spec.trim());
  if (match === null) {
    return { kind: 'unrecognised' };
  }
  const specifier = match[3]!.trim();
  if (specifier.startsWith('===')) {
    return { kind: 'arbitrary-equality' };
  }
  if (/^==\s*[^\s,=<>!~*$;]+$/.test(specifier)) {
    return { kind: 'pinned' };
  }
  if (specifier === '' || /^[=<>!~]/.test(specifier)) {
    return { kind: 'unpinned' };
  }
  return { kind: 'unrecognised' };
}

/**
 * Checks one requirements file and everything it includes.
 *
 * `read` is asked for each file by repository-relative path and decides what
 * "there" means: on the head, a tracked regular file on disk; on the base,
 * the blob at the trust base. Every problem is collected, not only the first,
 * so the ratchet's diagnostic can name each unpinned line; `pinned` is true
 * only when there are none.
 */
export function checkRequirementsPins(
  top: string,
  read: (file: string) => IncludeRead
): PinCheck {
  const files: string[] = [];
  const problems: PinProblem[] = [];
  let excluded = 0;
  let topMissing: string | null = null;
  const visited = new Set<string>();

  const visit = (file: string, depth: number, from: string | null, written: string): void => {
    if (visited.has(file)) {
      return;
    }
    if (depth > MAX_INCLUDE_DEPTH) {
      problems.push({
        file: from ?? file,
        line: null,
        text: written,
        kind: 'include',
        why: `more than ${MAX_INCLUDE_DEPTH} includes deep`,
      });
      return;
    }
    visited.add(file);
    const got = read(file);
    if (got.kind === 'missing') {
      // For the top file itself the sentence would read "includes
      // requirements.txt, which ...", which no caller prints: the head copy
      // is a tracked file, and callers of a base check read topMissing.
      if (from === null) {
        topMissing = got.why;
      }
      problems.push({ file: from ?? file, line: null, text: written, kind: 'include', why: `which ${got.why}` });
      return;
    }
    files.push(file);
    for (const logical of logicalLines(got.text)) {
      const verdict = classify(logical.text);
      switch (verdict.kind) {
        case 'pinned':
        case 'ignored':
          break;
        case 'excluded':
          excluded += 1;
          break;
        case 'include': {
          const target = verdict.target;
          const fail = (why: string): void => {
            problems.push({ file, line: null, text: printable(target), kind: 'include', why });
          };
          if (URL.test(target)) {
            fail('which is a URL');
            break;
          }
          if (path.posix.isAbsolute(target) || path.win32.isAbsolute(target)) {
            fail('which is an absolute path');
            break;
          }
          const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
          if (resolved === '..' || resolved.startsWith('../')) {
            fail('which is outside the repository');
            break;
          }
          visit(resolved, depth + 1, file, printable(target));
          break;
        }
        default:
          problems.push({ file, line: logical.line, text: printable(logical.text), kind: verdict.kind });
      }
    }
  };

  visit(top, 0, null, top);
  return { pinned: problems.length === 0, files, excluded, problems, topMissing };
}

/**
 * One problem as the reason clause of a diagnostic about `top`, with no
 * trailing full stop: `line 4 "flask>=2.0" is not pinned with ==, so any
 * version osv-scanner reported would be a guess`.
 */
export function describePinProblem(top: string, problem: PinProblem): string {
  const guess = 'so any version osv-scanner reported would be a guess';
  const where = problem.file === top ? '' : ` of ${problem.file}`;
  switch (problem.kind) {
    case 'unpinned':
      return `line ${problem.line ?? '?'}${where} "${problem.text}" is not pinned with ==, ${guess}`;
    case 'arbitrary-equality':
      return `line ${problem.line ?? '?'}${where} "${problem.text}" is pinned with ===, not ==, ${guess}`;
    case 'unrecognised':
      return (
        `line ${problem.line ?? '?'}${where} "${problem.text}" is not a line conductor recognises, ` +
        'so it cannot tell what osv-scanner would read there'
      );
    case 'include': {
      const from = problem.file === top ? '' : ` (from ${problem.file})`;
      return `includes ${problem.text}${from}, ${problem.why ?? 'which could not be read'}`;
    }
  }
}
