import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { POLICY_FILE_NAME, parsePolicy } from '../src/policy.js';
import { runAll } from '../src/run.js';
import {
  CLEAN_DEP_GUARD,
  CLEAN_INTENT_GUARD,
  CLEAN_VAULT_GUARD,
  stubGate,
} from './helpers/stub-gate.js';

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compass-run-'));
  temps.push(dir);
  return dir;
}

const ALL_THREE = parsePolicy(
  [
    'version: 1',
    'gates:',
    '  dependencies:',
    '    product: dep-guard',
    '  secrets:',
    '    product: vault-guard',
    '  intent:',
    '    product: intent-guard',
  ].join('\n'),
  POLICY_FILE_NAME
);

function runWith(binDir: string) {
  return runAll(ALL_THREE, { repoRoot: tempDir(), staged: true, pathValue: binDir });
}

describe('a gate whose output parses but has drifted shape', () => {
  // The reviewer's scratch run: dep-guard emits findings: [null] and exits 0.
  // Before the fix this threw a TypeError out of the normalizer, past the
  // gate runner's NormalizeError-only catch, out of runAll's map, and out of
  // the CLI as a stack trace with exit 1 -- which the hook reports as "a
  // gate blocked". The remaining gates never ran.
  const DRIFTED = JSON.stringify({
    findings: [null],
    suppressed: 0,
    ignored: 0,
    run: { failOn: 'medium', blockingMatches: 0, diagnostics: [] },
    exitCode: 0,
  });

  function driftedRun() {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: DRIFTED, exit: 0 });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0 });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, exit: 0 });
    return runWith(bin);
  }

  it('does not throw', () => {
    expect(() => driftedRun()).not.toThrow();
  });

  it('composes to 2, not to 1', () => {
    // 1 would tell the hook a gate blocked. Nothing blocked: a gate broke.
    expect(driftedRun().exitCode).toBe(2);
  });

  it('raises a blocking umbrella finding naming the problem', () => {
    const result = driftedRun();
    const finding = result.findings.find(
      (entry) => entry.ruleId === 'compass/gate-output-unparseable'
    );
    expect(finding).toBeDefined();
    expect(finding?.blocking).toBe(true);
    expect(finding?.product).toBe('compass');
    expect(String(finding?.details.detail)).toMatch(/dep-guard/);
  });

  it('still runs and reports the other two gates', () => {
    const result = driftedRun();
    expect(result.gates.map((gate) => gate.role)).toEqual([
      'dependencies',
      'secrets',
      'intent',
    ]);
    expect(result.gates[1].couldNotRun).toBeNull();
    expect(result.gates[1].exitCode).toBe(0);
    expect(result.gates[2].couldNotRun).toBeNull();
    expect(result.gates[2].exitCode).toBe(0);
  });

  it('carries no stack frame anywhere in the outcome', () => {
    const serialized = JSON.stringify(driftedRun());
    expect(serialized).not.toMatch(/\bat [A-Za-z_$][\w$]*\s*\(/);
  });
});

describe('a gate that throws from a malformed nested field', () => {
  // A shape the top-level check accepts and an inner one does not: results
  // is an array, its entry is an object, and matches is a string.
  const NESTED = JSON.stringify({
    version: '1',
    summary: { files: 1, secrets: 1 },
    run: { fail_on: 'medium', blocking_matches: 1 },
    results: [{ file: 'a.js', matches: 'not-an-array' }],
  });

  it('is could-not-run for that gate and leaves the others alone', () => {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, exit: 0 });
    stubGate(bin, 'vault-guard', { stdout: NESTED, exit: 1 });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, exit: 0 });

    const result = runWith(bin);

    expect(result.exitCode).toBe(2);
    expect(result.gates[1].couldNotRun?.reason).toBe('unparseable-output');
    expect(result.gates[0].couldNotRun).toBeNull();
    expect(result.gates[2].couldNotRun).toBeNull();
    expect(
      result.findings.some((finding) => finding.ruleId === 'compass/gate-output-unparseable')
    ).toBe(true);
  });

  it('does the same for a drifted intent gate', () => {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, exit: 0 });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0 });
    stubGate(bin, 'intent-guard', {
      stdout: JSON.stringify({
        status: 'blocked',
        exitCode: 1,
        reasons: [],
        contractFound: true,
        contractFrozen: true,
        budget: { ok: false, action: 'hard_block', violations: [null] },
      }),
      exit: 1,
    });

    const result = runWith(bin);

    expect(result.exitCode).toBe(2);
    expect(result.gates[2].couldNotRun?.reason).toBe('unparseable-output');
  });
});

describe('a gate that could not run for a reason other than its output', () => {
  it('is visible as an umbrella finding, so it reaches the published format too', () => {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: '', stderr: 'corpus unreadable', exit: 2 });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0 });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, exit: 0 });

    const result = runWith(bin);

    expect(result.exitCode).toBe(2);
    const finding = result.findings.find((entry) => entry.ruleId === 'compass/gate-failed');
    expect(finding?.blocking).toBe(true);
    expect(String(finding?.details.detail)).toMatch(/exited 2/);
  });
});

describe('a run with no enabled gates', () => {
  it('exits 0 and reports nothing rather than pretending to be clean', () => {
    const policy = parsePolicy(
      'version: 1\ngates:\n  secrets:\n    product: vault-guard\n    enabled: false\n',
      POLICY_FILE_NAME
    );
    const result = runAll(policy, { repoRoot: tempDir(), staged: true, pathValue: tempDir() });
    expect(result.gates).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});
