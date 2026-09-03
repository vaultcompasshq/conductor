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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-run-'));
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
      (entry) => entry.ruleId === 'conductor/gate-output-unparseable'
    );
    expect(finding).toBeDefined();
    expect(finding?.blocking).toBe(true);
    expect(finding?.product).toBe('conductor');
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
      result.findings.some((finding) => finding.ruleId === 'conductor/gate-output-unparseable')
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
    const finding = result.findings.find((entry) => entry.ruleId === 'conductor/gate-failed');
    expect(finding?.blocking).toBe(true);
    expect(String(finding?.details.detail)).toMatch(/exited 2/);
  });
});

describe('stage filtering', () => {
  // Every gate present, every gate installed, and only the stage deciding
  // which of them runs. The defaults are the interesting part: dependencies
  // and secrets at commit, intent at ci.
  const DEFAULT_STAGES = parsePolicy(
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

  function allThreeInstalled(): string {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, exit: 0 });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0 });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, exit: 0 });
    return bin;
  }

  function rolesAt(stage: 'commit' | 'push' | 'ci' | undefined) {
    const result = runAll(DEFAULT_STAGES, {
      repoRoot: tempDir(),
      staged: true,
      pathValue: allThreeInstalled(),
      ...(stage === undefined ? {} : { stage }),
    });
    return {
      ran: result.gates.map((gate) => gate.role),
      deferred: result.deferred.map((gate) => gate.role),
      exitCode: result.exitCode,
    };
  }

  it('runs every enabled gate when no stage was asked for, exactly as v0.1 did', () => {
    expect(rolesAt(undefined).ran).toEqual(['dependencies', 'secrets', 'intent']);
    expect(rolesAt(undefined).deferred).toEqual([]);
  });

  it('runs only the commit gates at commit, and defers the rest', () => {
    expect(rolesAt('commit').ran).toEqual(['dependencies', 'secrets']);
    expect(rolesAt('commit').deferred).toEqual(['intent']);
  });

  it('still runs the commit gates at push, because stages are cumulative', () => {
    expect(rolesAt('push').ran).toEqual(['dependencies', 'secrets']);
    expect(rolesAt('push').deferred).toEqual(['intent']);
  });

  it('runs everything at ci, which is the last stage', () => {
    expect(rolesAt('ci').ran).toEqual(['dependencies', 'secrets', 'intent']);
    expect(rolesAt('ci').deferred).toEqual([]);
  });

  it('says which stage a deferred gate is waiting for', () => {
    const result = runAll(DEFAULT_STAGES, {
      repoRoot: tempDir(),
      staged: true,
      pathValue: allThreeInstalled(),
      stage: 'commit',
    });
    expect(result.deferred).toEqual([{ role: 'intent', product: 'intent-guard', stage: 'ci' }]);
  });

  it('honours an explicit stage over the role default in both directions', () => {
    const policy = parsePolicy(
      [
        'version: 1',
        'gates:',
        '  dependencies:',
        '    product: dep-guard',
        '    stage: ci',
        '  intent:',
        '    product: intent-guard',
        '    stage: commit',
      ].join('\n'),
      POLICY_FILE_NAME
    );
    const result = runAll(policy, {
      repoRoot: tempDir(),
      staged: true,
      pathValue: allThreeInstalled(),
      stage: 'commit',
    });
    expect(result.gates.map((gate) => gate.role)).toEqual(['intent']);
    expect(result.deferred.map((gate) => gate.role)).toEqual(['dependencies']);
  });

  it('never lets a deferred gate reach the exit code, since it was not asked to run', () => {
    // The gate that would have blocked is the deferred one. A stage filter
    // that leaked its verdict would fail a commit over a check nobody ran.
    const policy = parsePolicy(
      'version: 1\ngates:\n  intent:\n    product: intent-guard\n    stage: ci\n',
      POLICY_FILE_NAME
    );
    const bin = tempDir();
    stubGate(bin, 'intent-guard', {
      stdout: JSON.stringify({
        status: 'blocked',
        exitCode: 1,
        reasons: ['Budget hard_block: too many files'],
        contractFound: true,
        contractFrozen: true,
      }),
      exit: 1,
    });

    const result = runAll(policy, {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
      stage: 'commit',
    });

    expect(result.gates).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('does not treat a deferred gate as a missing one', () => {
    // A gate switched on and absent is exit 2. A gate switched on and
    // deferred is not the same thing, and the binary is never even looked
    // for: an intent gate installed only on the CI image must not fail a
    // developer's commit.
    const policy = parsePolicy(
      'version: 1\ngates:\n  intent:\n    product: intent-guard\n    stage: ci\n',
      POLICY_FILE_NAME
    );
    const result = runAll(policy, {
      repoRoot: tempDir(),
      staged: true,
      pathValue: tempDir(),
      stage: 'commit',
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.deferred.map((gate) => gate.role)).toEqual(['intent']);
  });

  it('leaves a disabled gate out of the deferred list rather than reporting it twice', () => {
    const policy = parsePolicy(
      'version: 1\ngates:\n  intent:\n    product: intent-guard\n    enabled: false\n',
      POLICY_FILE_NAME
    );
    const result = runAll(policy, {
      repoRoot: tempDir(),
      staged: true,
      pathValue: tempDir(),
      stage: 'commit',
    });
    expect(result.gates).toEqual([]);
    expect(result.deferred).toEqual([]);
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
