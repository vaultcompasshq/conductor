// A stub gate binary: prints a canned payload on stdout, optionally records
// the argv it was given, and exits with a canned code. Real subprocess, real
// argv, real exit code, no real scanner.
//
// The payloads go in sibling files and are cat-ed rather than embedded in
// the script. Embedding them means the shell's own quoting rules get a vote
// on what the gate "printed", and a JSON payload is exactly the kind of
// string that loses that argument.

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// An absolute path to cat, resolved once. The stub is deliberately run with
// a PATH containing only the stub directory in some tests -- that is how a
// missing gate binary is simulated -- and a bare "cat" in the script would
// then not resolve either, so every stub would print nothing and every test
// would exercise the unparseable-output path by accident.
const CAT = execFileSync('sh', ['-c', 'command -v cat'], { encoding: 'utf8' }).trim();

export interface StubOptions {
  stdout?: string;
  stderr?: string;
  exit?: number;
  /** File to append each non-version invocation's arguments to. */
  argvLog?: string;
  /** Version string printed for --version. */
  version?: string;
}

export function stubGate(binDir: string, name: string, options: StubOptions = {}): string {
  mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, name);
  const outFile = `${file}.stdout`;
  const errFile = `${file}.stderr`;
  writeFileSync(outFile, options.stdout ?? '');
  writeFileSync(errFile, options.stderr ?? '');

  const lines = ['#!/bin/sh'];
  if (options.argvLog !== undefined) {
    lines.push(`if [ "$1" != "--version" ]; then printf '%s\\n' "$*" >> ${options.argvLog}; fi`);
  }
  lines.push(`if [ "$1" = "--version" ]; then echo "${options.version ?? '9.9.9'}"; exit 0; fi`);
  lines.push(`${CAT} ${JSON.stringify(errFile)} >&2`);
  lines.push(`${CAT} ${JSON.stringify(outFile)}`);
  lines.push(`exit ${options.exit ?? 0}`);
  writeFileSync(file, `${lines.join('\n')}\n`);
  chmodSync(file, 0o755);
  return file;
}

/** Minimal well-formed output for each gate, for the gates a test is not testing. */
export const CLEAN_DEP_GUARD = JSON.stringify({
  findings: [],
  suppressed: 0,
  ignored: 0,
  run: {
    mode: 'staged',
    failOn: 'medium',
    blockingMatches: 0,
    durationMs: 1,
    corpusBuiltAt: '2026-08-19T06:10:37.074Z',
    lockfileFormat: 'none',
    diagnostics: [],
  },
  exitCode: 0,
});

export const CLEAN_VAULT_GUARD = JSON.stringify({
  version: '1',
  scannedAt: '2026-09-02T00:00:00.000Z',
  summary: { files: 0, secrets: 0 },
  run: {
    duration_ms: 1,
    files_scanned: 0,
    bytes_scanned: 0,
    patterns_active: 59,
    diagnostics_count: 0,
    fail_on: 'medium',
    blocking_matches: 0,
  },
  results: [],
});

export const CLEAN_INTENT_GUARD = JSON.stringify({
  status: 'ok',
  exitCode: 0,
  reasons: [],
  contractFound: true,
  contractFrozen: true,
});
