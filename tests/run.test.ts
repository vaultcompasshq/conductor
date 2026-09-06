import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { POLICY_FILE_NAME, applyCliOverrides, parsePolicy } from '../src/policy.js';
import { refusedTrustBase, runAll } from '../src/run.js';
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

  it('carries the gates --gate excluded, the way it carries the deferred ones', () => {
    // Neither deferred nor skipped, and named nowhere before this: an
    // uploaded log from a --gate run was indistinguishable from a full run.
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, exit: 0 });
    const result = runAll(applyCliOverrides(ALL_THREE, { gates: ['dependencies'] }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
    });

    expect(result.gates.map((gate) => gate.role)).toEqual(['dependencies']);
    expect(result.excluded).toEqual([
      { role: 'secrets', product: 'vault-guard' },
      { role: 'intent', product: 'intent-guard' },
    ]);
  });

  it('excludes nothing when no --gate was given', () => {
    const result = runAll(applyCliOverrides(ALL_THREE, {}), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: allThreeInstalled(),
    });
    expect(result.excluded).toEqual([]);
  });

  it('gives a --gate run the same exit code a policy naming only that gate would', () => {
    // Reporting the excluded gates must not give them a vote. The gate that
    // would have blocked is one of the excluded ones, so if any of this
    // reached composeExitCode the two numbers below would differ.
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, exit: 0 });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 1 });

    const declaredAlone = parsePolicy(
      'version: 1\ngates:\n  dependencies:\n    product: dep-guard\n',
      POLICY_FILE_NAME
    );
    const options = { repoRoot: tempDir(), staged: true, pathValue: bin };
    const narrowed = runAll(applyCliOverrides(ALL_THREE, { gates: ['dependencies'] }), options);

    expect(narrowed.exitCode).toBe(runAll(declaredAlone, options).exitCode);
    expect(narrowed.exitCode).toBe(0);
    expect(narrowed.excluded.map((gate) => gate.role)).toEqual(['secrets', 'intent']);
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

/**
 * What the gate itself said about why it could not run.
 *
 * The umbrella's own sentence is "the gate exited 2, which it uses for could
 * not run", which is true and says nothing a reader can act on. The gate's
 * own line does: a dogfood run against a repository with an unparseable
 * lockfile had dep-guard printing the file and the reason, the text report
 * printed it, and the SARIF log carried only the generic sentence. A
 * code-scanning reader saw a critical alert with no way to learn what was
 * wrong, and a gate that could not run produces no SARIF run of its own, so
 * there was nowhere else in that log for the line to be.
 */
describe("a failing gate's own error", () => {
  const LOCKFILE = 'dep-guard: pnpm-lock.yaml: not valid YAML (lockfile-parse)';

  function failingDepGuard(stderr: string) {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: '', stderr, exit: 2 });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0 });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, exit: 0 });
    return runWith(bin).findings.find((entry) => entry.ruleId === 'conductor/gate-failed');
  }

  it('reaches the umbrella finding, and not only the text report', () => {
    const finding = failingDepGuard(`${LOCKFILE}\n`);

    expect(finding?.message).toContain(LOCKFILE);
    expect(finding?.details.stderr).toBe(LOCKFILE);
    // The generic sentence is still there. It says which exit code was seen
    // and what that code means, which the gate's own line does not.
    expect(finding?.message).toMatch(/exited 2/);
  });

  it('caps a very long stderr and says out loud that it did', () => {
    // A gate that dumps a stack or a whole file into stderr must not put all
    // of it in a published log, and a silent truncation is worse than a long
    // message: the reader cannot tell a cut-off line from the gate's last
    // word.
    const finding = failingDepGuard(`${'x'.repeat(5000)}\n`);

    const stderr = String(finding?.details.stderr);
    expect(stderr.length).toBeLessThan(2200);
    expect(stderr).toMatch(/truncated/);
    expect(stderr).toMatch(/5000/);
    expect(finding?.message).toMatch(/truncated/);
  });

  it('says nothing extra when the gate exited 2 with nothing on stderr', () => {
    const finding = failingDepGuard('');

    expect(finding?.details.stderr).toBeNull();
    expect(finding?.message).toBe(
      'The "dependencies" gate did not complete: the gate exited 2, which it uses for ' +
        '"could not run". Nothing was verified by this gate.'
    );
  });

  it('reaches gate-output-unparseable too, which is the same reader problem', () => {
    // A gate that exits 1 with no JSON is the shape a rejected config takes,
    // and the gate has almost always said why on stderr. That result had the
    // same gap gate-failed did: the umbrella's own sentence and nothing the
    // reader could act on. The classic case is the one that found this,
    // where a state-directory conflict makes the gate refuse every command.
    const bin = tempDir();
    const line = 'intent-guard: both .intent-guard/ and .conductor/ exist';
    stubGate(bin, 'dep-guard', { stdout: 'not json', stderr: `${line}\n`, exit: 1 });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0 });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, exit: 0 });

    const finding = runWith(bin).findings.find(
      (entry) => entry.ruleId === 'conductor/gate-output-unparseable'
    );

    expect(finding?.message).toContain(line);
    expect(finding?.details.stderr).toBe(line);
  });

  it('leaves the fingerprint alone, so a reworded gate error is not a new alert', () => {
    // The fingerprint is deliberately over the rule, the role and the
    // product and never over the message. Carrying stderr into the message
    // is exactly the change that would break that if it were computed from
    // the message instead.
    const first = failingDepGuard('one thing went wrong\n');
    const second = failingDepGuard('a completely different thing went wrong\n');

    expect(first?.fingerprint?.value).toBe(second?.fingerprint?.value);
  });
});

/**
 * The fail-closed half of pull-request mode, at the run level.
 *
 * A base ref that cannot be judged against is never a reason to fall back to
 * the head's policy: that fallback IS the vulnerability, and it would be
 * reachable by anybody who could make the base ref unfetchable. So every
 * enabled gate is could-not-run and the run exits 2.
 *
 * Two of the three tests here are about what this refuses to READ off the
 * policy it was handed, because that policy is the head's and is used only as
 * an inventory of gate names.
 */
describe('a trust base that could not be used', () => {
  const DETAIL = 'it does not resolve to a commit in this repository.';

  it('reports every enabled gate as could-not-run and exits 2', () => {
    const result = refusedTrustBase(ALL_THREE, 'origin/main', DETAIL, {});

    expect(result.exitCode).toBe(2);
    expect(result.gates.map((gate) => gate.role)).toEqual([
      'dependencies',
      'secrets',
      'intent',
    ]);
    for (const gate of result.gates) {
      expect(gate.couldNotRun?.reason).toBe('preparation-failed');
      expect(gate.couldNotRun?.detail).toContain(DETAIL);
      expect(gate.findings.some((finding) => finding.blocking)).toBe(true);
    }
    // The refusal is carried on the result, not only in the gate details:
    // both renderers lead with it, and an inventory naming no gate would
    // otherwise leave the report with nothing to say.
    expect(result.trustBase).toEqual({
      ref: 'origin/main',
      policyChanged: false,
      refusal: DETAIL,
    });
  });

  it('exits 2 even when the head policy says every gate is unenforced', () => {
    // enforce is itself a control input, in the file that could not be read
    // from the base. A head policy setting it false everywhere must not turn
    // a run that checked nothing into a green one.
    const unenforced = parsePolicy(
      [
        'version: 1',
        'gates:',
        '  secrets:',
        '    product: vault-guard',
        '    enforce: false',
      ].join('\n'),
      POLICY_FILE_NAME
    );

    const result = refusedTrustBase(unenforced, 'origin/main', DETAIL, {});

    expect(result.exitCode).toBe(2);
    expect(result.gates[0].enforce).toBe(true);
  });

  it('exits 2 even when the head policy enables no gate at all', () => {
    // Composing an exit code over an empty list gives 0, which would report a
    // run that checked nothing as a clean one.
    const nothing = parsePolicy(
      ['version: 1', 'gates:', '  secrets:', '    product: vault-guard', '    enabled: false'].join(
        '\n'
      ),
      POLICY_FILE_NAME
    );

    const result = refusedTrustBase(nothing, 'origin/main', DETAIL, {});

    expect(result.gates).toEqual([]);
    expect(result.exitCode).toBe(2);
  });

  it('still reports the gates a stage held back, so the report is not thinner than an ordinary one', () => {
    const result = refusedTrustBase(ALL_THREE, 'origin/main', DETAIL, { stage: 'commit' });

    expect(result.gates.map((gate) => gate.role)).toEqual(['dependencies', 'secrets']);
    expect(result.deferred.map((gate) => gate.role)).toEqual(['intent']);
  });
});

describe('pull-request mode through a whole run', () => {
  const PROPOSING_INTENT = JSON.stringify({
    status: 'ok',
    exitCode: 0,
    reasons: [],
    contractFound: true,
    contractFrozen: true,
    trustBase: {
      ref: 'origin/main',
      proposals: ['contract changed in this pull request', 'config changed in this pull request'],
      contractChanged: true,
      configChanged: true,
      baseContractFound: true,
      selfApproval: false,
      contractShapeChange: null,
    },
  });

  let lastArgvLog = '';

  function pullRequestRun(policyChanged: boolean) {
    const bin = tempDir();
    lastArgvLog = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, argvLog: lastArgvLog });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, argvLog: lastArgvLog });
    stubGate(bin, 'intent-guard', {
      stdout: PROPOSING_INTENT,
      version: '1.4.0',
      argvLog: lastArgvLog,
    });

    return runAll(ALL_THREE, {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
      trustBase: { ref: 'origin/main', policyChanged, refusal: null },
    });
  }

  it('hands the ref down to every gate in the version table', () => {
    pullRequestRun(true);
    const lines = readFileSync(lastArgvLog, 'utf8').trim().split('\n');

    // One line per gate, in gate order: dependencies, secrets, intent. The
    // stubs report 9.9.9, which is above all three floors, so all three
    // carry the flag. What decides this is the TABLE, not the count: a gate
    // missing from it must not be handed a flag it would reject, which is
    // the case the next test covers.
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toContain('--trust-base origin/main');
    }
  });

  it('hands it to no gate the table does not name', () => {
    // The whole boundary rests on the table rather than on a count of
    // products, and the count is now all of them, so this is the only place
    // left that the withholding half is exercised through a real run. A
    // stub below the floor stands in for a gate the table does not cover.
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, argvLog: log, version: '0.5.0' });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, argvLog: log, version: '1.7.0' });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, argvLog: log, version: '1.4.0' });

    const result = runAll(ALL_THREE, {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
      trustBase: { ref: 'origin/main', policyChanged: false, refusal: null },
    });
    const lines = readFileSync(log, 'utf8').trim().split('\n');

    expect(lines[0]).not.toContain('--trust-base');
    expect(lines[1]).toContain('--trust-base origin/main');
    expect(lines[2]).toContain('--trust-base origin/main');
    expect(result.gates[0].trustBase?.withheld).toMatch(/dep-guard 0\.5\.0/);
  });

  it('sums a proposal raised by the secrets gate alongside the intent gate own', () => {
    // vault-guard 1.7.0 puts its summary at the same top-level key, so the
    // umbrella sums two gates' proposals and its own policy line into one
    // sentence, which is the sentence the whole wave exists to produce.
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD });
    stubGate(bin, 'vault-guard', {
      stdout: JSON.stringify({
        version: '1',
        scannedAt: '2026-09-06T00:00:00.000Z',
        summary: { files: 0, secrets: 0 },
        run: { files_scanned: 0, patterns_active: 59, fail_on: 'medium', blocking_matches: 0 },
        trustBase: {
          ref: 'origin/main',
          proposals: ['config changed in this pull request'],
          configChanged: true,
          baselineChanged: false,
          configShapeChange: null,
          baselineShapeChange: null,
        },
        results: [],
      }),
      version: '1.7.0',
    });
    stubGate(bin, 'intent-guard', { stdout: PROPOSING_INTENT, version: '1.4.0' });

    const result = runAll(ALL_THREE, {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
      trustBase: { ref: 'origin/main', policyChanged: true, refusal: null },
    });

    expect(result.proposals).toEqual([
      { product: 'conductor', role: null, line: 'policy changed in this pull request' },
      {
        product: 'vault-guard',
        role: 'secrets',
        line: 'config changed in this pull request',
      },
      {
        product: 'intent-guard',
        role: 'intent',
        line: 'contract changed in this pull request',
      },
      { product: 'intent-guard', role: 'intent', line: 'config changed in this pull request' },
    ]);
  });

  it("sums the children's proposals and puts the umbrella's own policy line first", () => {
    const result = pullRequestRun(true);

    expect(result.proposals).toEqual([
      { product: 'conductor', role: null, line: 'policy changed in this pull request' },
      {
        product: 'intent-guard',
        role: 'intent',
        line: 'contract changed in this pull request',
      },
      { product: 'intent-guard', role: 'intent', line: 'config changed in this pull request' },
    ]);
  });

  it('raises no policy line when the head policy matches the base', () => {
    const result = pullRequestRun(false);

    expect(result.proposals.map((proposal) => proposal.product)).toEqual([
      'intent-guard',
      'intent-guard',
    ]);
  });

  it('lets none of it reach the findings, the summary or the exit code', () => {
    // A pull request is ALLOWED to propose changing the rules. The whole of
    // the mechanism is that the proposal does not take effect for the run
    // that carries it, so a proposal that blocked would make the honest case
    // (re-freezing a contract) unmergeable and train people to bypass.
    const result = pullRequestRun(true);

    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.summary.blocking).toBe(0);
  });

  it('carries the ref on the result, so a report never has to work it out again', () => {
    expect(pullRequestRun(true).trustBase).toEqual({
      ref: 'origin/main',
      policyChanged: true,
      refusal: null,
    });
  });

  it("records the repository's own frozen contract on a run with no preparation", () => {
    // A plain run prepares nothing, but the intent gate still judges against
    // the contract in the repository, resolved by the child from --project .
    // Recording it is what makes the report say which contract, and what
    // makes a contract-state result in SARIF point at the contract rather
    // than at the policy file.
    const repo = tempDir();
    const bin = tempDir();
    mkdirSync(path.join(repo, '.intent-guard'), { recursive: true });
    writeFileSync(
      path.join(repo, '.intent-guard', 'intent-contract.yaml'),
      'frozen_by: user\napproval:\n  approved_by: a human\n'
    );
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, version: '1.4.0' });

    const policy = parsePolicy(
      ['version: 1', 'gates:', '  intent:', '    product: intent-guard'].join('\n'),
      POLICY_FILE_NAME
    );
    const result = runAll(policy, { repoRoot: repo, staged: true, pathValue: bin });

    expect(result.gates[0].intent).toEqual({
      contractSource: { kind: 'native', path: '.intent-guard/intent-contract.yaml' },
      baseRef: null,
    });
  });

  it('records nothing when the repository has no frozen contract', () => {
    const bin = tempDir();
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, version: '1.4.0' });

    const policy = parsePolicy(
      ['version: 1', 'gates:', '  intent:', '    product: intent-guard'].join('\n'),
      POLICY_FILE_NAME
    );
    const result = runAll(policy, { repoRoot: tempDir(), staged: true, pathValue: bin });

    expect(result.gates[0].intent).toBeUndefined();
  });

  it('reports no proposals at all outside pull-request mode', () => {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD });
    stubGate(bin, 'intent-guard', { stdout: PROPOSING_INTENT, version: '1.4.0' });

    const result = runAll(ALL_THREE, { repoRoot: tempDir(), staged: true, pathValue: bin });

    expect(result.trustBase).toBeNull();
    expect(result.proposals).toEqual([]);
  });
});
