import { afterEach, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLEAN_INTENT_GUARD, CLEAN_VAULT_GUARD, stubGate } from './helpers/stub-gate.js';

const COMPASS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPASS_CLI = path.join(COMPASS_ROOT, 'dist', 'cli.js');

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compass-cli-'));
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
  const result = spawnSync(process.execPath, [COMPASS_CLI, ...args], {
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
    expect(result.stdout).toMatch(/compass\/gate-output-unparseable/);
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
    expect(result.stdout).toMatch(/compass\/gate-missing/);
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
    expect(result.stderr).toMatch(/compass init/);
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
    const umbrella = log.runs.find((run) => run.tool.driver.name === 'compass');
    expect(umbrella?.results.map((entry) => entry.ruleId)).toContain(
      'compass/gate-output-unparseable'
    );
  });
});
