import { afterEach, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLEAN_DEP_GUARD,
  CLEAN_INTENT_GUARD,
  CLEAN_VAULT_GUARD,
  stubGate,
} from './helpers/stub-gate.js';

const CONDUCTOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONDUCTOR_CLI = path.join(CONDUCTOR_ROOT, 'dist', 'cli.js');

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-cli-'));
  temps.push(dir);
  return dir;
}

const ALL_THREE_POLICY = [
  'version: 1',
  'gates:',
  '  dependencies:',
  '    product: dep-guard',
  '  secrets:',
  '    product: vault-guard',
  '  intent:',
  '    product: intent-guard',
  '',
].join('\n');

function repoWithPolicy(policy = ALL_THREE_POLICY): string {
  const dir = tempDir();
  spawnSync('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  writeFileSync(path.join(dir, '.guardrails.yaml'), policy);
  return dir;
}

function runCli(cwd: string, args: string[], pathValue: string) {
  const result = spawnSync(process.execPath, [CONDUCTOR_CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: pathValue },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// A stack frame as Node prints it: whitespace, "at ", then an identifier or
// a path. Matching "at " alone would fire on ordinary prose.
const STACK_FRAME = /^\s+at\s+\S+/m;

describe('the CLI never prints a stack trace for a gate failure', () => {
  const DRIFTED = JSON.stringify({
    findings: [null],
    suppressed: 0,
    ignored: 0,
    run: { failOn: 'medium', blockingMatches: 0, diagnostics: [] },
    exitCode: 0,
  });

  it('reports a drifted gate output as exit 2 with no stack frames', () => {
    const repo = repoWithPolicy();
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: DRIFTED, exit: 0 });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0 });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, exit: 0 });

    const result = runCli(repo, ['run', '--staged'], bin);

    expect(result.status).toBe(2);
    expect(result.stderr).not.toMatch(STACK_FRAME);
    expect(result.stdout).not.toMatch(STACK_FRAME);
    expect(result.stdout).toMatch(/conductor\/gate-output-unparseable/);
    // And the other two gates still reported.
    expect(result.stdout).toMatch(/vault-guard/);
    expect(result.stdout).toMatch(/intent-guard/);
  });

  it('prints no stack frames when a gate exits with its could-not-run code', () => {
    const repo = repoWithPolicy();
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: '', stderr: 'corpus unreadable', exit: 2 });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0 });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, exit: 0 });

    const result = runCli(repo, ['run', '--staged'], bin);

    expect(result.status).toBe(2);
    expect(result.stderr).not.toMatch(STACK_FRAME);
    expect(result.stdout).not.toMatch(STACK_FRAME);
  });

  it('prints no stack frames when a gate binary is missing', () => {
    const repo = repoWithPolicy();

    const result = runCli(repo, ['run', '--staged'], tempDir());

    expect(result.status).toBe(2);
    expect(result.stderr).not.toMatch(STACK_FRAME);
    expect(result.stdout).not.toMatch(STACK_FRAME);
    expect(result.stdout).toMatch(/conductor\/gate-missing/);
  });

  it('prints a one-line message and no stack for a policy file that will not parse', () => {
    const repo = repoWithPolicy('version: 1\ngates:\n  nonsense:\n    product: dep-guard\n');

    const result = runCli(repo, ['run'], tempDir());

    expect(result.status).toBe(2);
    expect(result.stderr).not.toMatch(STACK_FRAME);
    expect(result.stderr).toMatch(/nonsense/);
  });

  it('prints a one-line message and no stack when there is no policy file at all', () => {
    const dir = tempDir();
    spawnSync('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });

    const result = runCli(dir, ['run'], tempDir());

    expect(result.status).toBe(2);
    expect(result.stderr).not.toMatch(STACK_FRAME);
    expect(result.stderr).toMatch(/conductor init/);
  });

  it('keeps the SARIF output parseable when a gate could not run', () => {
    const repo = repoWithPolicy();
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: DRIFTED, exit: 0 });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0 });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, exit: 0 });

    const result = runCli(repo, ['run', '--staged', '--format', 'sarif'], bin);

    expect(result.status).toBe(2);
    const log = JSON.parse(result.stdout) as {
      runs: Array<{ tool: { driver: { name: string } }; results: Array<{ ruleId: string }> }>;
    };
    const umbrella = log.runs.find((run) => run.tool.driver.name === 'conductor');
    expect(umbrella?.results.map((entry) => entry.ruleId)).toContain(
      'conductor/gate-output-unparseable'
    );
  });
});

describe('conductor run --stage', () => {
  function allThreeStubbed(): string {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, exit: 0 });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0 });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, exit: 0 });
    return bin;
  }

  it('runs the commit gates and defers the intent gate at --stage commit', () => {
    const result = runCli(repoWithPolicy(), ['run', '--staged', '--stage', 'commit'], allThreeStubbed());

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/dep-guard/);
    expect(result.stdout).toMatch(/vault-guard/);
    expect(result.stdout).toMatch(/deferred\s+intent/);
    expect(result.stdout).toMatch(/stage ci/);
  });

  it('runs every gate at --stage ci', () => {
    const result = runCli(repoWithPolicy(), ['run', '--staged', '--stage', 'ci'], allThreeStubbed());

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^conductor run: 3 gate\(s\)/m);
    expect(result.stdout).not.toMatch(/deferred/);
  });

  it('runs every gate with no --stage at all, exactly as v0.1 did', () => {
    const result = runCli(repoWithPolicy(), ['run', '--staged'], allThreeStubbed());

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^conductor run: 3 gate\(s\)/m);
    expect(result.stdout).not.toMatch(/deferred/);
  });

  it('refuses an unknown stage with exit 2 rather than quietly running everything', () => {
    // The dangerous failure is the silent one: a typo in a CI file that
    // makes the job run every gate, or none, and say nothing about it.
    const result = runCli(
      repoWithPolicy(),
      ['run', '--staged', '--stage', 'nightly'],
      allThreeStubbed()
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/nightly/);
    expect(result.stderr).toMatch(/commit, push, ci/);
    expect(result.stderr).not.toMatch(STACK_FRAME);
    // Nothing ran.
    expect(result.stdout).toBe('');
  });

  it('names the deferred gate in the SARIF log rather than dropping it', () => {
    const result = runCli(
      repoWithPolicy(),
      ['run', '--staged', '--stage', 'commit', '--format', 'sarif'],
      allThreeStubbed()
    );

    const log = JSON.parse(result.stdout) as {
      runs: Array<{ tool: { driver: { name: string } }; results: Array<{ ruleId: string }> }>;
    };
    const umbrella = log.runs.find((run) => run.tool.driver.name === 'conductor');
    expect(umbrella?.results.map((entry) => entry.ruleId)).toContain('conductor/gate-deferred');
    // And the gate that did not run got no run of its own.
    expect(log.runs.map((run) => run.tool.driver.name)).not.toContain('intent-guard');
  });
});

describe('a gate-state reason alongside a budget violation', () => {
  // Both reasons come out of intent-guard in one array with nothing marking
  // which is which. Before the fix the unfrozen-contract reason appeared in
  // neither report.
  const BOTH = JSON.stringify({
    status: 'blocked',
    exitCode: 1,
    reasons: [
      'Intent contract exists but is not frozen by user. Approve and freeze before implementing.',
      'Budget soft_block: Changed 2 files, budget allows 1',
    ],
    contractFound: true,
    contractFrozen: false,
    budget: {
      ok: false,
      action: 'soft_block',
      violations: [
        {
          fingerprint: 'a12fc3e4',
          rule: 'max_files',
          severity: 'soft_block',
          message: 'Changed 2 files, budget allows 1',
          matched: ['a.js', 'b.js'],
        },
      ],
    },
  });

  function intentOnly(): { repo: string; bin: string } {
    const repo = repoWithPolicy(
      'version: 1\ngates:\n  intent:\n    product: intent-guard\n'
    );
    const bin = tempDir();
    stubGate(bin, 'intent-guard', { stdout: BOTH, exit: 1 });
    return { repo, bin };
  }

  it('names both in the text report', () => {
    const { repo, bin } = intentOnly();

    const result = runCli(repo, ['run', '--staged'], bin);

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/intent-guard\/budget\.max_files/);
    expect(result.stdout).toMatch(/intent-guard\/gate-blocked/);
    expect(result.stdout).toMatch(/not frozen by user/);
  });

  it('names both in the SARIF log', () => {
    const { repo, bin } = intentOnly();

    const result = runCli(repo, ['run', '--staged', '--format', 'sarif'], bin);

    const log = JSON.parse(result.stdout) as {
      runs: Array<{ results: Array<{ ruleId: string; message: { text: string } }> }>;
    };
    const ruleIds = log.runs.flatMap((run) => run.results.map((entry) => entry.ruleId));
    expect(ruleIds).toContain('intent-guard/budget.max_files');
    expect(ruleIds).toContain('intent-guard/gate-blocked');

    const gateState = log.runs
      .flatMap((run) => run.results)
      .find((entry) => entry.ruleId === 'intent-guard/gate-blocked');
    expect(gateState?.message.text).toMatch(/not frozen by user/);
  });
});

describe('sarif output, continued', () => {
  const DRIFTED = JSON.stringify({
    findings: [null],
    suppressed: 0,
    ignored: 0,
    run: { failOn: 'medium', blockingMatches: 0, diagnostics: [] },
    exitCode: 0,
  });

  it('lists the two gates that ran alongside the umbrella run', () => {
    const repo = repoWithPolicy();
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: DRIFTED, exit: 0 });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0 });
    stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, exit: 0 });

    const result = runCli(repo, ['run', '--staged', '--format', 'sarif'], bin);

    expect(result.status).toBe(2);
    const log = JSON.parse(result.stdout) as {
      runs: Array<{ tool: { driver: { name: string } } }>;
    };
    // The gate whose output could not be read produced no tool output, so it
    // gets no run; the two that answered do, and the umbrella's own run
    // carries what it has to say about the third.
    expect(log.runs.map((run) => run.tool.driver.name)).toEqual([
      'vault-guard',
      'intent-guard',
      'conductor',
    ]);
  });
});
