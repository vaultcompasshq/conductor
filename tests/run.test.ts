import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PREVIEW_WITHHELD } from '../src/gate-runner.js';
import { renderText, verdictToken } from '../src/output-text.js';
import { POLICY_FILE_NAME, type Policy, applyCliOverrides, parsePolicy } from '../src/policy.js';
import { type RunOptions, refusedTrustBase, runAll } from '../src/run.js';
import { fileURLToPath } from 'node:url';

import {
  CLEAN_DEP_GUARD,
  CLEAN_INTENT_GUARD,
  CLEAN_OSV_SCANNER,
  CLEAN_VAULT_GUARD,
  stubGate,
} from './helpers/stub-gate.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

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

function fivePolicy(historyEnforced = true) {
  return parsePolicy(
    [
      'version: 1',
      'gates:',
      '  dependencies:',
      '    product: dep-guard',
      '  secrets:',
      '    product: vault-guard',
      '  intent:',
      '    product: intent-guard',
      '  secrets-history:',
      '    product: gitleaks',
      `    enforce: ${historyEnforced ? 'true' : 'false'}`,
      '  vulnerabilities:',
      '    product: osv-scanner',
    ].join('\n'),
    POLICY_FILE_NAME
  );
}

const ALL_FIVE = fivePolicy();

/** A repository tracking one lockfile, so the vulnerabilities gate is spawned. */
function lockfileRepo(): string {
  const repo = tempDir();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
  git('init', '--quiet', '-b', 'main');
  writeFileSync(path.join(repo, 'package-lock.json'), '{}\n');
  git('add', 'package-lock.json');
  git('-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '--quiet', '-m', 'lockfile');
  return repo;
}

function runFive(binDir: string, policy = ALL_FIVE) {
  return runAll(policy, { repoRoot: lockfileRepo(), staged: false, pathValue: binDir, tempRoot: tempDir() });
}

/** Clean stubs for the three family gates and osv-scanner; gitleaks blocks. */
function fiveStubs(): string {
  const bin = tempDir();
  stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, exit: 0 });
  stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0 });
  stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, exit: 0 });
  stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', stdout: CLEAN_OSV_SCANNER, exit: 0 });
  stubGate(bin, 'gitleaks', {
    versionSubcommand: true,
    versionLine: '8.30.1',
    reportFlag: '--report-path',
    reportBody: readFileSync(path.join(FIXTURES, 'gitleaks-8.30.1-history-blocking.json'), 'utf8'),
    exit: 3,
    stdout: '',
  });
  return bin;
}

describe('five gates, two of them external', () => {
  it('exits 1 when only an external gate blocks, and 2 when an external binary is missing', () => {
    const bin = fiveStubs();
    const blocked = runFive(bin);
    expect(blocked.gates.map((g) => g.product)).toEqual([
      'dep-guard',
      'vault-guard',
      'intent-guard',
      'gitleaks',
      'osv-scanner',
    ]);
    expect(blocked.exitCode).toBe(1);
    rmSync(path.join(bin, 'gitleaks'));
    const missing = runFive(bin);
    expect(missing.exitCode).toBe(2);
    const remedy = missing.findings.find((f) => f.ruleId === 'conductor/gate-missing');
    expect(remedy?.message).toMatch(/install gitleaks/i);
  });

  it('does not count an unenforced external gate toward the exit code', () => {
    expect(runFive(fiveStubs(), fivePolicy(false)).exitCode).toBe(0);
  });
});

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
      version: '1.8.1',
      argvLog: lastArgvLog,
    });

    return runAll(ALL_THREE, {
      repoRoot: prRepo(),
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

  it('runs no gate below its minimum through a whole run, and exits 2 for it', () => {
    // A gate below its pull-request-mode minimum is could-not-run on a run
    // with a trust base, never run without the flag. The other two, above
    // their minimums, still run in pull-request mode.
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, argvLog: log, version: '0.5.0' });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, argvLog: log });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, argvLog: log });

    const result = runAll(ALL_THREE, {
      repoRoot: prRepo(),
      staged: true,
      pathValue: bin,
      trustBase: { ref: 'origin/main', policyChanged: false, refusal: null },
    });
    const lines = readFileSync(log, 'utf8').trim().split('\n');

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toContain('--trust-base origin/main');
    }
    expect(result.gates[0].couldNotRun?.reason).toBe('gate-version-unsupported');
    expect(result.gates[0].couldNotRun?.detail).toMatch(/^dep-guard did not run: the installed 0\.5\.0/);
    expect(result.gates[0].trustBase?.withheld).toBeNull();
    expect(result.exitCode).toBe(2);
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
      version: '1.9.1',
    });
    stubGate(bin, 'intent-guard', { stdout: PROPOSING_INTENT, version: '1.8.1' });

    const result = runAll(ALL_THREE, {
      repoRoot: prRepo(),
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
  describe('the preview under the proposed rules', () => {
    const P = (body: string) => parsePolicy(`version: 1\ngates:\n${body}`, 'preview-test');
    const SECRETS = P('  secrets:\n    product: vault-guard\n');
    const SECRETS_OFF = P('  secrets:\n    product: vault-guard\n    enabled: false\n');
    const FAMILY = P('  dependencies:\n    product: dep-guard\n  secrets:\n    product: vault-guard\n');
    const HISTORY = P('  secrets-history:\n    product: gitleaks\n  vulnerabilities:\n    product: osv-scanner\n');
    const PR_TRUST_BASE = { ref: 'origin/main', policyChanged: true, refusal: null };

    function previewRun(base: Policy, preview: Policy, extra: Partial<RunOptions> = {}, depGuard: { stdout: string; exit: number } = { stdout: CLEAN_DEP_GUARD, exit: 0 }) {
      const bin = tempDir();
      lastArgvLog = path.join(tempDir(), 'argv.txt');
      stubGate(bin, 'dep-guard', { ...depGuard, argvLog: lastArgvLog });
      stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, argvLog: lastArgvLog });
      stubGate(bin, 'intent-guard', { stdout: PROPOSING_INTENT, version: '1.8.1', argvLog: lastArgvLog });
      return runAll(base, {
        repoRoot: prRepo(), staged: false, pathValue: bin,
        trustBase: PR_TRUST_BASE,
        preview: { policy: preview }, ...extra,
      });
    }

    /** dep-guard blocking (exit 1, one finding) for the preview only: the base does not enable it. */
    function blockingDepGuardPreviewRun(base: Policy, preview: Policy) {
      return previewRun(base, preview, {}, {
        stdout: readFileSync(path.join(FIXTURES, 'dep-guard-0.2.0-blocking.json'), 'utf8'),
        exit: 1,
      });
    }

    /** fiveStubs() on PATH, prRepo(), and the same history policy as the base and as the preview. */
    function historyPreviewRun() {
      return runAll(HISTORY, {
        repoRoot: prRepo(), staged: false, pathValue: fiveStubs(), tempRoot: tempDir(),
        trustBase: PR_TRUST_BASE, preview: { policy: HISTORY },
      });
    }

    /** A clean vault-guard on a PATH outside any repository. */
    function cleanBin(): string {
      const bin = tempDir();
      stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD });
      return bin;
    }

    /**
     * prRepo() plus, in the head commit only, node_modules/.bin/vault-guard
     * and tools/bin/vault-guard, both writing `marker` when run.
     */
    function familyRepo(): { repo: string; marker: string } {
      const repo = prRepo();
      const marker = path.join(tempDir(), 'family-ran.txt');
      for (const rel of ['node_modules/.bin/vault-guard', 'tools/bin/vault-guard']) {
        const file = path.join(repo, rel);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, `#!/bin/sh\nprintf 'ran\\n' > ${JSON.stringify(marker)}\necho '9.9.9'\n`);
        chmodSync(file, 0o755);
      }
      const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
      git('add', '-A', '-f');
      git('-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '--quiet', '-m', 'plant');
      return { repo, marker };
    }

    it('preview omits --trust-base only for dep-guard and vault-guard', () => {
      const result = previewRun(SECRETS, FAMILY);
      // The stubs log their whole argv, the npm gates' `scan` subcommand
      // included: the primary vault-guard, then the preview's two.
      expect(readFileSync(lastArgvLog, 'utf8').trim().split('\n')).toEqual([
        'scan -f json --trust-base origin/main',
        'scan --format json --base origin/main',
        'scan -f json',
      ]);
      expect(result.preview?.gates.map((gate) => gate.trustBase?.withheld)).toEqual([PREVIEW_WITHHELD, PREVIEW_WITHHELD]);
    });

    it('preview hands gitleaks and osv-scanner the same trust inputs as the primary run', () => {
      const result = historyPreviewRun();
      const strip = (argv: string[]) => argv.map((arg) => (arg.startsWith(os.tmpdir()) ? '<tmp>' : arg));
      // Same argv, except that an osv-scanner preview spawn ends in the
      // forced --no-call-analysis=all (spec 5.2, finding 7).
      const expected = result.gates.map((gate) =>
        gate.product === 'osv-scanner' ? [...strip(gate.argv), '--no-call-analysis=all'] : strip(gate.argv)
      );
      expect(result.preview?.gates.map((gate) => strip(gate.argv))).toEqual(expected);
      expect(result.preview?.gates.map((gate) => gate.trustBase?.withheld)).toEqual([null, null]);
      expect(result.preview?.gates[0].argv).toContain('--diff-merges=first-parent origin/main..HEAD');
      expect(result.preview?.gates[0].argv).toContain('--ignore-gitleaks-allow');
    });

    it('never lets a blocking or could-not-run preview gate change the primary result', () => {
      const without = previewRun(SECRETS, FAMILY, { preview: undefined });
      const result = blockingDepGuardPreviewRun(SECRETS, FAMILY);
      expect(result.preview?.gates[0].findings.some((finding) => finding.blocking)).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.findings).toEqual([]);
      expect(result.summary).toEqual(without.summary);
      expect(result.proposals).toEqual(without.proposals);
    });

    it('a preview that throws leaves the exit code, the verdict token and lines 1-4 identical to the run without it', () => {
      const boom = { version: 1, report: { format: 'text' }, get gates() { throw new Error('boom'); } } as unknown as Policy;
      // One shared clock that only the preview advances: generatedAt is read
      // before the preview starts, so it is the value a run without one gives.
      let previewTicks = 0;
      const clocks = {
        now: () => new Date(previewTicks * 1000),
        previewClock: () => ++previewTicks,
      };
      const without = previewRun(SECRETS, FAMILY, { preview: undefined, ...clocks });
      const result = previewRun(SECRETS, boom, clocks);
      expect(result.preview).toEqual({ gates: [], findings: [], skipped: [], deferred: [], overBudget: [], threw: 'boom' });
      expect(previewTicks).toBe(1);
      expect(result.generatedAt).toBe(without.generatedAt);
      expect(result.exitCode).toBe(without.exitCode);
      expect(verdictToken(result, false)).toBe(verdictToken(without, false));
      // A clean run without --verbose is one summary line, so line 2 onward
      // is the preview block itself: that form is pinned by its prefix. The
      // full report (--verbose, the form the Action and the comment use) is
      // compared with the same result rendered without its preview, since
      // the two runs' durations differ.
      expect(renderText(result).startsWith(renderText(without))).toBe(true);
      const { preview: _preview, ...unpreviewed } = result;
      const full = renderText(result, { verbose: true });
      expect(full.startsWith(renderText(unpreviewed, { verbose: true }))).toBe(true);
      expect(full.split('\n').slice(0, 4)).toEqual(renderText(unpreviewed, { verbose: true }).split('\n').slice(0, 4));
      expect(renderText(result)).toContain('\npreview: could not be completed (boom)\n');
    });

    it('the preview never calls prepareIntent and prints the deferred line', () => {
      const result = previewRun(SECRETS, P('  intent:\n    product: intent-guard\n'));
      expect(result.preview?.deferred).toEqual(['intent']);
      expect(result.preview?.gates).toEqual([]);
      expect(readFileSync(lastArgvLog, 'utf8').trim().split('\n')).toEqual(['scan -f json --trust-base origin/main']);
    });

    it('stops the preview at the budget and lists the rest as over budget', () => {
      // The clock reads 0 until the preview dep-guard has written its argv line,
      // then 300 000: dependencies runs inside the budget, secrets finds none left.
      const result = previewRun(SECRETS, FAMILY, {
        previewClock: () => (readFileSync(lastArgvLog, 'utf8').includes('--format json --base') ? 300_000 : 0),
      });
      expect(result.preview?.gates.map((gate) => gate.role)).toEqual(['dependencies']);
      expect(result.preview?.overBudget).toEqual(['secrets']);
    });

    it('refuses a preview option value that starts with a dash without spawning the gate', () => {
      const result = previewRun(SECRETS, P('  dependencies:\n    product: dep-guard\n    options:\n      fail-on: "--output=/tmp/x"\n'));
      expect(result.preview?.gates[0].couldNotRun?.reason).toBe('preparation-failed');
      expect(readFileSync(lastArgvLog, 'utf8').trim().split('\n')).toEqual(['scan -f json --trust-base origin/main']);
    });

    it('preview of a family gate keeps the node_modules skip and refuses a head-controlled program', () => {
      const { repo, marker } = familyRepo();
      const skip = runAll(SECRETS_OFF, { repoRoot: repo, staged: false, pathValue: cleanBin(),
        trustBase: PR_TRUST_BASE, preview: { policy: SECRETS } });
      expect(skip.preview?.gates[0].nodeModulesSkipped).toBeDefined();
      expect(skip.preview?.gates[0].couldNotRun).toBeNull();
      const refused = runAll(SECRETS_OFF, { repoRoot: repo, staged: false, pathValue: path.join(repo, 'tools', 'bin'),
        trustBase: PR_TRUST_BASE, preview: { policy: SECRETS } });
      expect(refused.preview?.gates[0].couldNotRun?.reason).toBe('gate-program-refused');
      expect(existsSync(marker)).toBe(false);
    });

    it("preview refuses osv-scanner call analysis, because it would build the head's code", () => {
      const bin = tempDir();
      lastArgvLog = path.join(tempDir(), 'argv.txt');
      stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, argvLog: lastArgvLog });
      stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', stdout: CLEAN_OSV_SCANNER, argvLog: lastArgvLog });
      const vulns = (enabled: boolean) =>
        `  vulnerabilities:\n    product: osv-scanner\n${enabled ? '' : '    enabled: false\n'}    options:\n      call-analysis: all\n`;
      const result = runAll(P(`  secrets:\n    product: vault-guard\n${vulns(false)}`), {
        repoRoot: prRepo(), staged: false, pathValue: bin, tempRoot: tempDir(),
        trustBase: PR_TRUST_BASE, preview: { policy: P(vulns(true)) },
      });
      expect(result.preview?.gates[0].couldNotRun?.reason).toBe('preparation-failed');
      expect(result.preview?.gates[0].couldNotRun?.detail).toBe(
        "the preview does not run call analysis, because it would build the head's code"
      );
      // Only the primary vault-guard ran: osv-scanner was never spawned.
      expect(readFileSync(lastArgvLog, 'utf8').trim().split('\n')).toEqual(['scan -f json --trust-base origin/main']);
      expect(result.exitCode).toBe(0);
    });

    it('preview refuses any call-analysis option key that is not an all-off form', () => {
      const bin = tempDir();
      lastArgvLog = path.join(tempDir(), 'argv.txt');
      stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, argvLog: lastArgvLog });
      stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', stdout: CLEAN_OSV_SCANNER, argvLog: lastArgvLog });
      const vulns = (enabled: boolean, option: string) =>
        `  vulnerabilities:\n    product: osv-scanner\n${enabled ? '' : '    enabled: false\n'}    options:\n      ${option}\n`;
      const run = (option: string) =>
        runAll(P(`  secrets:\n    product: vault-guard\n${vulns(false, option)}`), {
          repoRoot: prRepo(), staged: false, pathValue: bin, tempRoot: tempDir(),
          trustBase: PR_TRUST_BASE, preview: { policy: P(vulns(true, option)) },
        });
      // Another spelling of the key renders as a flag of its own and is refused,
      // and so is every call-analysis value: only no-call-analysis can say off.
      for (const option of ['experimental-call-analysis: true', 'no-call-analysis: rust', 'call-analysis: [none, go]', 'call-analysis: []', 'call-analysis: none', 'call-analysis: false']) {
        const result = run(option);
        expect(result.preview?.gates[0].couldNotRun?.reason).toBe('preparation-failed');
        expect(result.exitCode).toBe(0);
      }
      expect(readFileSync(lastArgvLog, 'utf8')).not.toMatch(/call-analysis/);
      // The all-off forms are not refused: osv-scanner is spawned, and every
      // preview spawn of it ends in --no-call-analysis=all whatever the options
      // said (what the stub's output then earns is not the point here).
      for (const option of ['no-call-analysis: true', 'no-call-analysis: all']) {
        const result = run(option);
        expect(result.preview?.gates[0].couldNotRun?.reason).not.toBe('preparation-failed');
      }
      const osvLines = readFileSync(lastArgvLog, 'utf8').trim().split('\n').filter((line) => line.includes('--format json'));
      expect(osvLines.length).toBeGreaterThan(0);
      for (const line of osvLines) expect(line.endsWith('--no-call-analysis=all')).toBe(true);
    });

    it('a mismatched version pin makes the preview gate could-not-run and leaves the primary result alone', () => {
      // The pin names dep-guard, which only the preview runs; the stub reports 9.9.9.
      const env = { CONDUCTOR_EXPECTED_DEP_GUARD_VERSION: '0.10.5' };
      const without = previewRun(SECRETS, FAMILY, { preview: undefined, env });
      const result = previewRun(SECRETS, FAMILY, { env });
      expect(result.preview?.gates[0].role).toBe('dependencies');
      expect(result.preview?.gates[0].couldNotRun?.reason).toBe('version-skew');
      expect(result.exitCode).toBe(without.exitCode);
      expect(result.exitCode).toBe(0);
      expect(result.gates[0].couldNotRun).toBeNull();
      expect(result.findings).toEqual(without.findings);
    });

    it('preview refuses a base command inside the working tree before any spawn', () => {
      const repo = prRepo();
      const program = path.join(repo, 'tools', 'base-gate.sh');
      const programLog = path.join(tempDir(), 'base-gate.txt');
      mkdirSync(path.dirname(program), { recursive: true });
      writeFileSync(program, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(programLog)}\necho '9.9.9'\n`);
      chmodSync(program, 0o755);
      const withCommand = (enabled: boolean) =>
        P(`  secrets:\n    product: vault-guard\n${enabled ? '' : '    enabled: false\n'}    command: ${program}\n    args: []\n`);
      const bin = tempDir();
      lastArgvLog = path.join(tempDir(), 'argv.txt');
      stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, argvLog: lastArgvLog });
      const result = runAll(withCommand(false), {
        repoRoot: repo, staged: false, pathValue: bin,
        trustBase: PR_TRUST_BASE, preview: { policy: withCommand(true) },
      });
      expect(result.preview?.gates[0].couldNotRun?.reason).toBe('gate-program-refused');
      expect(result.preview?.gates[0].couldNotRun?.detail).toBe(
        `preview under the proposed rules: the base command ${program} is inside the working tree, so this gate was not run`
      );
      // Nothing spawned for it, the version probe included.
      expect(existsSync(programLog)).toBe(false);
      expect(existsSync(lastArgvLog)).toBe(false);
    });

    it('preview refuses a base args script inside the working tree before any spawn, and runs one outside it', () => {
      // Audit 2026-10-27, B1: an interpreter command outside the tree with
      // the gate script in args. The script is the program, so the preview's
      // in-tree refusal has to see it as it sees a command.
      const repo = prRepo();
      const programLog = path.join(tempDir(), 'base-gate.txt');
      const scriptBody =
        `import { appendFileSync } from 'node:fs';\n` +
        `appendFileSync(${JSON.stringify(programLog)}, process.argv.slice(2).join(' ') + '\\n');\n` +
        `if (process.argv[2] === '--version') { console.log('9.9.9'); process.exit(0); }\n` +
        `console.log(${JSON.stringify(CLEAN_VAULT_GUARD)});\n`;
      const inside = path.join(repo, 'tools', 'base-gate.mjs');
      mkdirSync(path.dirname(inside), { recursive: true });
      writeFileSync(inside, scriptBody);
      const outside = path.join(tempDir(), 'base-gate.mjs');
      writeFileSync(outside, scriptBody);
      const withScript = (enabled: boolean, script: string) =>
        P(`  secrets:\n    product: vault-guard\n${enabled ? '' : '    enabled: false\n'}    command: ${JSON.stringify(process.execPath)}\n    args: [${JSON.stringify(script)}, scan]\n`);
      const bin = tempDir();
      const run = (script: string) =>
        runAll(withScript(false, script), {
          repoRoot: repo, staged: false, pathValue: bin,
          trustBase: PR_TRUST_BASE, preview: { policy: withScript(true, script) },
        });

      const refused = run('tools/base-gate.mjs');
      expect(refused.preview?.gates[0].couldNotRun?.reason).toBe('gate-program-refused');
      expect(refused.preview?.gates[0].couldNotRun?.detail).toBe(
        'preview under the proposed rules: the base args entry tools/base-gate.mjs names a path inside the working tree, so this gate was not run'
      );
      expect(existsSync(programLog)).toBe(false);

      // The same candidate set as the primary run (fix round): a bare name
      // Node runs as <name>.js is refused here before any spawn too.
      writeFileSync(path.join(repo, 'base-gate.js'), '// would run as base-gate\n');
      const bare = run('base-gate');
      expect(bare.preview?.gates[0].couldNotRun?.detail).toBe(
        'preview under the proposed rules: the base args entry base-gate names a path inside the working tree, so this gate was not run'
      );
      expect(existsSync(programLog)).toBe(false);

      const ran = run(outside);
      expect(ran.preview?.gates[0].couldNotRun?.reason).not.toBe('gate-program-refused');
      // The probe asked the script, not Node (N4), and then the scan ran.
      expect(readFileSync(programLog, 'utf8').split('\n')[0]).toBe('--version');
    });

    it('preview refuses an in-tree link in args whose target is outside the tree, by the link own entry (audit 2026-10-28, N3)', () => {
      const repo = prRepo();
      const programLog = path.join(tempDir(), 'base-gate.txt');
      const outside = path.join(tempDir(), 'base-gate.mjs');
      writeFileSync(
        outside,
        `import { appendFileSync } from 'node:fs';\n` +
          `appendFileSync(${JSON.stringify(programLog)}, process.argv.slice(2).join(' ') + '\\n');\n` +
          `if (process.argv[2] === '--version') { console.log('9.9.9'); process.exit(0); }\n` +
          `console.log(${JSON.stringify(CLEAN_VAULT_GUARD)});\n`
      );
      mkdirSync(path.join(repo, 'tools'), { recursive: true });
      symlinkSync(outside, path.join(repo, 'tools', 'link.mjs'));
      const withScript = (enabled: boolean) =>
        P(`  secrets:\n    product: vault-guard\n${enabled ? '' : '    enabled: false\n'}    command: ${JSON.stringify(process.execPath)}\n    args: ["tools/link.mjs", scan]\n`);
      const result = runAll(withScript(false), {
        repoRoot: repo, staged: false, pathValue: tempDir(),
        trustBase: PR_TRUST_BASE, preview: { policy: withScript(true) },
      });
      expect(result.preview?.gates[0].couldNotRun?.detail).toBe(
        'preview under the proposed rules: the base args entry tools/link.mjs names a path inside the working tree, so this gate was not run'
      );
      expect(existsSync(programLog)).toBe(false);
    });

    it('preview does not refuse outright a data file the gate itself is given in args (audit 2026-10-28, N1)', () => {
      const repo = prRepo();
      writeFileSync(path.join(repo, 'rules.json'), '{}\n');
      const bin = tempDir();
      const gateBinary = stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD });
      const withRules = (enabled: boolean) =>
        P(`  secrets:\n    product: vault-guard\n${enabled ? '' : '    enabled: false\n'}    command: ${JSON.stringify(gateBinary)}\n    args: [scan, "--config=rules.json"]\n`);
      const result = runAll(withRules(false), {
        repoRoot: repo, staged: false, pathValue: bin,
        trustBase: PR_TRUST_BASE, preview: { policy: withRules(true) },
      });
      expect(result.preview?.gates[0].couldNotRun?.detail ?? '').not.toMatch(/the base args entry/);
    });
  });
});

describe('the equal-tree exception (issue #69)', () => {
  /**
   * dep-guard, vault-guard, intent-guard and osv-scanner are deliberately
   * NOT stubbed onto this PATH. If the runner spawned any of them anyway --
   * which is exactly the mistake this exception must not make, since a
   * pull-request run with --trust-base and --base pointed at an
   * equal-tree ref is dep-guard 0.8.0's own refusal case -- the missing
   * binary would surface as a could-not-run gate, which the assertions
   * below on result.gates and result.exitCode would catch.
   */
  function equalTreeRun(gitleaks: { exit: number; reportBody: string }) {
    const bin = tempDir();
    stubGate(bin, 'gitleaks', {
      versionSubcommand: true,
      versionLine: '8.30.1',
      reportFlag: '--report-path',
      reportBody: gitleaks.reportBody,
      exit: gitleaks.exit,
      stdout: '',
    });
    return runAll(fivePolicy(), {
      repoRoot: lockfileRepo(),
      staged: false,
      pathValue: bin,
      tempRoot: tempDir(),
      // A ref that exists in the repository: the base config is read from it,
      // and a ref that cannot be read is could-not-run, never the neutral one.
      trustBase: { ref: 'HEAD', policyChanged: false, refusal: null, treeUnchanged: true },
    });
  }

  it('runs only the history gate and reports every other enabled gate as tree-unchanged', () => {
    const result = equalTreeRun({ exit: 0, reportBody: '[]' });

    expect(result.gates).toHaveLength(1);
    expect(result.gates[0].product).toBe('gitleaks');
    expect(result.treeUnchanged.map((gate) => gate.product).sort()).toEqual([
      'dep-guard',
      'intent-guard',
      'osv-scanner',
      'vault-guard',
    ]);
    // Never a GateOutcome: nothing was spawned for these, so there is no
    // exit code or binary to report, exactly like DeferredGate and
    // ExcludedGate.
    expect(result.treeUnchanged.every((gate) => 'role' in gate && 'product' in gate)).toBe(true);
  });

  it('takes the exit code from the history gate alone', () => {
    const result = equalTreeRun({
      exit: 3,
      reportBody: readFileSync(path.join(FIXTURES, 'gitleaks-8.30.1-history-blocking.json'), 'utf8'),
    });

    expect(result.gates).toHaveLength(1);
    expect(result.gates[0].product).toBe('gitleaks');
    expect(result.exitCode).toBe(1);
    expect(result.summary.blocking).toBeGreaterThan(0);
  });

  it('exits 0 when the history gate is clean, with the other four gates skipped', () => {
    const result = equalTreeRun({ exit: 0, reportBody: '[]' });

    expect(result.exitCode).toBe(0);
  });

  it('does not skip anything outside the equal-tree shape, even in pull-request mode', () => {
    // treeUnchanged: false (the ordinary pull-request case) must not trigger
    // the skip. Every gate needs a stub here, unlike equalTreeRun above,
    // precisely because all five are expected to run.
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD });
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', stdout: CLEAN_OSV_SCANNER, exit: 0 });
    stubGate(bin, 'gitleaks', {
      versionSubcommand: true,
      versionLine: '8.30.1',
      reportFlag: '--report-path',
      reportBody: '[]',
      exit: 0,
      stdout: '',
    });

    const result = runAll(fivePolicy(), {
      repoRoot: prRepo(),
      staged: false,
      pathValue: bin,
      tempRoot: tempDir(),
      trustBase: { ref: 'origin/main', policyChanged: false, refusal: null, treeUnchanged: false },
    });

    expect(result.gates).toHaveLength(5);
    expect(result.treeUnchanged).toEqual([]);
  });

});

/**
 * A repository a trust base can be read from: main carries a frozen intent
 * contract and a lockfile, refs/remotes/origin/main points at it, and a
 * branch commit sits on top. A trust base makes the intent gate's run
 * pull-request shaped, so the contract decision and the change set are read
 * from origin/main and need a real ref to read them from.
 */
function prRepo(): string {
  const repo = tempDir();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
  git('init', '--quiet', '-b', 'main');
  mkdirSync(path.join(repo, '.intent-guard'), { recursive: true });
  writeFileSync(
    path.join(repo, '.intent-guard', 'intent-contract.yaml'),
    'frozen_by: user\napproval:\n  approved_by: a human\n'
  );
  writeFileSync(path.join(repo, 'package-lock.json'), '{}\n');
  git('add', '-A');
  git('-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '--quiet', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(path.join(repo, 'app.js'), 'const x = 1;\n');
  git('add', '-A');
  git('-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '--quiet', '-m', 'branch');
  return repo;
}
