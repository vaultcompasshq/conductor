// The stated reason a gate that could not run gives: which stderr line is
// quoted as "gate said". Built from captured real bytes (colour codes kept,
// tests/fixtures/stated-reason-captures.json) and a few constructed cases,
// each named so. Reporting only: the second half proves the rule decides
// nothing.

import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GATE_SAID_MAX_CHARS, gateStatedReason, runGate } from '../src/gate-runner.js';
import { normalizeFailedGate } from '../src/normalize.js';
import { stubGate } from './helpers/stub-gate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAPTURES = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'stated-reason-captures.json'), 'utf8')) as Record<
  string,
  { stderr: string }
>;
const captured = (name: string): string => {
  const entry = CAPTURES[name];
  if (entry === undefined) {
    throw new Error(`no capture ${name}`);
  }
  return entry.stderr;
};

const VAULT_INCOMPLETE = captured('vault-guard-1.10.0-incomplete');
const VAULT_NOTE_INCOMPLETE = captured('vault-guard-1.10.0-note-then-incomplete');
const GITLEAKS_OWN_TIMEOUT = captured('gitleaks-8.30.1-own-timeout');
const GITLEAKS_RENAMES = captured('gitleaks-8.30.1-rename-limit');
/** The two rename warnings alone, cut from the capture. */
const RENAME_LINES_ONLY = GITLEAKS_RENAMES.split('\n').slice(0, 2).join('\n') + '\n';
/** vault-guard's upgrade note, its three captured lines, colour codes kept. */
const VAULT_NOTE_ONLY = VAULT_NOTE_INCOMPLETE.split('\n').slice(0, 3).join('\n') + '\n';

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-stated-'));
  temps.push(dir);
  return dir;
}

describe('gateStatedReason names the cause, not the first line', () => {
  it('captured vault-guard 1.10.0 INCOMPLETE: joins the file lines across the colour-only blank line', () => {
    const said = gateStatedReason(VAULT_INCOMPLETE, null, true) ?? '';
    expect(said.startsWith(
      'INCOMPLETE: 1 file(s) or target(s) could not be read and were not scanned sub/locked.txt ' +
        "Error: EACCES: permission denied, open '<repo>/sub/locked.txt'"
    )).toBe(true);
    expect(said.length).toBe(GATE_SAID_MAX_CHARS);
    expect(said.endsWith('...')).toBe(true);
  });

  it('captured vault-guard 1.10.0 upgrade note before INCOMPLETE: the note block is skipped', () => {
    const said = gateStatedReason(VAULT_NOTE_INCOMPLETE, null, true) ?? '';
    expect(said.startsWith('INCOMPLETE: 1 file(s) or target(s) could not be read')).toBe(true);
    expect(said).not.toContain('note:');
    expect(said).not.toContain('would have failed before');
  });

  it('the captured note block then a plain reason (constructed): the continuation lines are skipped too', () => {
    const said = gateStatedReason(`${VAULT_NOTE_ONLY}error: the baseline file could not be read\n`, null, true);
    expect(said).toBe('error: the baseline file could not be read');
  });

  it('a note block, a blank line, then an indented real reason (constructed): the reason is chosen', () => {
    expect(gateStatedReason('note: something informational\n\n   the real reason is here\n', null, false)).toBe(
      'the real reason is here'
    );
  });

  it('the same with CRLF line ends (constructed): a carriage-return-only line is blank', () => {
    expect(gateStatedReason('note: something informational\r\n\r\n   the real reason is here\r\n', null, false)).toBe(
      'the real reason is here'
    );
  });

  it('captured gitleaks rename warnings then an INF line: the INF line, never the warning', () => {
    expect(gateStatedReason(GITLEAKS_RENAMES, null, false)).toBe('10:19AM INF 2 commits scanned.');
  });

  it('the captured rename warnings then another WRN line (constructed): only the rename warnings are skipped', () => {
    expect(gateStatedReason(`${RENAME_LINES_ONLY}10:19AM WRN the git log could not be read\n`, null, false)).toBe(
      '10:19AM WRN the git log could not be read'
    );
  });

  it("captured gitleaks own --timeout: the ERR line, after the INF line before it", () => {
    expect(gateStatedReason(GITLEAKS_OWN_TIMEOUT, null, false)).toBe(
      "10:19AM ERR failed to scan Git repository error='context deadline exceeded'"
    );
  });

  it('an ERR line after an INF line (constructed): the ERR line', () => {
    expect(
      gateStatedReason("10:00AM INF 3 commits scanned.\n10:00AM ERR [git] fatal: bad revision 'x'\n", null, false)
    ).toBe("10:00AM ERR [git] fatal: bad revision 'x'");
  });

  it('only informational lines, with a JSON reason on stdout: the stdout reason', () => {
    expect(gateStatedReason(RENAME_LINES_ONLY, JSON.stringify({ reason: 'from stdout' }), true)).toBe('from stdout');
    expect(gateStatedReason(VAULT_NOTE_ONLY, JSON.stringify({ run: { reason: 'nested' } }), true)).toBe('nested');
  });

  it('only informational lines and no stdout: no excerpt at all', () => {
    expect(gateStatedReason(RENAME_LINES_ONLY, null, false)).toBeNull();
    expect(gateStatedReason(VAULT_NOTE_ONLY, '', true)).toBeNull();
  });

  it('a plain first line: unchanged from the first-line rule', () => {
    expect(
      gateStatedReason("error: unknown option '--timeout'\nUsage: intent-guard check [options]\n", null, true)
    ).toBe("error: unknown option '--timeout'");
  });
});

describe('the stated reason decides nothing', () => {
  const SRC = path.join(HERE, '..', 'src');

  it('gateSaid is read nowhere in the exit code, the run composition or the verdict token', () => {
    for (const file of ['exit-codes.ts', 'run.ts']) {
      expect({ file, reads: readFileSync(path.join(SRC, file), 'utf8').includes('gateSaid') }).toEqual({
        file,
        reads: false,
      });
    }
    const text = readFileSync(path.join(SRC, 'output-text.ts'), 'utf8');
    const start = text.indexOf('export function verdictToken(');
    const end = text.indexOf('\n}\n', start);
    expect(start).toBeGreaterThan(-1);
    expect(text.slice(start, end).includes('gateSaid')).toBe(false);
  });

  it('a gate-error outcome over every captured input is the first-line rule outcome, gateSaid aside', () => {
    const inputs = [
      VAULT_INCOMPLETE,
      VAULT_NOTE_INCOMPLETE,
      GITLEAKS_OWN_TIMEOUT,
      GITLEAKS_RENAMES,
      RENAME_LINES_ONLY,
      `${VAULT_NOTE_ONLY}error: the baseline file could not be read\n`,
    ];
    for (const stderr of inputs) {
      const bin = tempDir();
      stubGate(bin, 'vault-guard', { stdout: '', stderr, exit: 2, version: '1.10.0' });
      const outcome = runGate(
        { role: 'secrets', product: 'vault-guard', enabled: true, stage: 'commit', enforce: true, excludedByCli: false, options: {} },
        { repoRoot: tempDir(), staged: true, pathValue: bin }
      );
      const stripped = stderr.replace(/\u001b\[[0-9;]*m/g, '');
      const detail = 'the gate exited 2, which it uses for "could not run".';
      // What the first-line rule produced, field for field, with gateSaid left out.
      expect({
        exitCode: outcome.exitCode,
        couldNotRun: { reason: outcome.couldNotRun?.reason, detail: outcome.couldNotRun?.detail },
        findings: outcome.findings,
        run: outcome.run,
        diagnostics: outcome.diagnostics,
        stderr: outcome.stderr,
        enforce: outcome.enforce,
      }).toEqual({
        exitCode: 2,
        couldNotRun: { reason: 'gate-error', detail },
        findings: [normalizeFailedGate('secrets', 'vault-guard', detail, stripped)],
        run: { failOn: null, suppressed: 0, ignored: 0, diagnostics: [], details: {} },
        diagnostics: [],
        stderr: stripped,
        enforce: true,
      });
      expect(Object.keys(outcome.couldNotRun ?? {}).filter((key) => key !== 'gateSaid').sort()).toEqual([
        'detail',
        'reason',
      ]);
    }
  });
});
