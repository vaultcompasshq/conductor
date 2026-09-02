import { afterEach, describe, expect, it } from '@jest/globals';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGate } from '../src/gate-runner.js';
import type { GatePolicy } from '../src/policy.js';
import { stubGate } from './helpers/stub-gate.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compass-runner-'));
  temps.push(dir);
  return dir;
}

function gate(overrides: Partial<GatePolicy> = {}): GatePolicy {
  return {
    role: 'dependencies',
    product: 'dep-guard',
    enabled: true,
    options: {},
    ...overrides,
  } as GatePolicy;
}

const DEP_GUARD_JSON = readFileSync(path.join(FIXTURES, 'dep-guard-0.2.0-blocking.json'), 'utf8');
const DEP_GUARD_CLEAN = readFileSync(path.join(FIXTURES, 'dep-guard-0.2.0-clean.json'), 'utf8');

describe('running one gate', () => {
  it('normalizes a gate that ran and blocked', () => {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: DEP_GUARD_JSON, exit: 1 });

    const outcome = runGate(gate(), { repoRoot: tempDir(), staged: true, pathValue: bin });

    expect(outcome.couldNotRun).toBeNull();
    expect(outcome.exitCode).toBe(1);
    expect(outcome.findings).toHaveLength(2);
    expect(outcome.productVersion).toBe('9.9.9');
  });

  it('passes the JSON flag and --staged, and puts the passthrough block last', () => {
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'dep-guard', { stdout: DEP_GUARD_CLEAN, argvLog: log });

    runGate(gate({ options: { 'fail-on': 'high', online: true } }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
    });

    expect(readFileSync(log, 'utf8').trim()).toBe(
      'scan --staged --format json --fail-on high --online'
    );
  });

  it('omits --staged when the run is not a staged one', () => {
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'dep-guard', { stdout: DEP_GUARD_CLEAN, argvLog: log });

    runGate(gate(), { repoRoot: tempDir(), staged: false, pathValue: bin });

    expect(readFileSync(log, 'utf8').trim()).toBe('scan --format json');
  });

  it('runs the child with the repository root as its working directory', () => {
    // vault-guard resolves its config AND its baseline from process.cwd(),
    // not from the path argument, so this is the difference between
    // scanning with the user's configuration and scanning with none.
    const bin = tempDir();
    const repo = tempDir();
    const log = path.join(tempDir(), 'cwd.txt');
    mkdirSync(bin, { recursive: true });
    const file = path.join(bin, 'vault-guard');
    writeFileSync(
      file,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.4.2; exit 0; fi\npwd > ${log}\necho '{"results":[],"run":{"fail_on":"medium","blocking_matches":0}}'\n`
    );
    chmodSync(file, 0o755);

    runGate(gate({ role: 'secrets', product: 'vault-guard' }), {
      repoRoot: repo,
      staged: true,
      pathValue: bin,
    });

    // realpath both sides: on macOS the OS temp directory resolves through
    // a symlink, so the raw strings can disagree while naming one place.
    expect(realpathSync(readFileSync(log, 'utf8').trim())).toBe(realpathSync(repo));
  });

  it('names only the configured path when a configured command does not exist', () => {
    const bin = tempDir();
    stubGate(bin, 'intent-guard', { stdout: '{}' });

    const outcome = runGate(
      gate({
        role: 'intent',
        product: 'intent-guard',
        command: '/nowhere/at/all/my-build.js',
      }),
      { repoRoot: tempDir(), staged: true, pathValue: bin }
    );

    expect(outcome.couldNotRun?.reason).toBe('configured-command-missing');
    expect(outcome.findings[0].message).toMatch(/\/nowhere\/at\/all\/my-build\.js/);
    // The candidate list is about resolution, and resolution did not happen:
    // the user named one file. Listing the names the umbrella would have
    // searched for suggests it looked for them, which it did not.
    expect(outcome.findings[0].message).not.toMatch(/conductor/);
    expect(outcome.findings[0].details.candidates).toBeUndefined();
    expect(outcome.findings[0].details.command).toBe('/nowhere/at/all/my-build.js');
  });

  it('raises the umbrella own blocking finding when an enabled gate binary is missing', () => {
    const outcome = runGate(gate(), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: tempDir(),
    });

    expect(outcome.couldNotRun?.reason).toBe('binary-missing');
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0].ruleId).toBe('compass/gate-missing');
    expect(outcome.findings[0].blocking).toBe(true);
  });

  it('treats exit 2 as could-not-run rather than as a policy violation', () => {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: '', stderr: 'corpus unreadable', exit: 2 });

    const outcome = runGate(gate(), { repoRoot: tempDir(), staged: true, pathValue: bin });

    expect(outcome.couldNotRun?.reason).toBe('gate-error');
    expect(outcome.stderr).toMatch(/corpus unreadable/);
  });

  it('treats exit 1 with unparseable stdout as could-not-run, the rejected-config shape', () => {
    const bin = tempDir();
    stubGate(bin, 'vault-guard', {
      stdout: '',
      stderr: 'Config error: unexpected token',
      exit: 1,
    });

    const outcome = runGate(gate({ role: 'secrets', product: 'vault-guard' }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
    });

    expect(outcome.couldNotRun?.reason).toBe('unparseable-output');
    // Not an empty finding list. A gate that could not run gets no SARIF run
    // of its own, so without a finding here the published report would carry
    // no trace of the most important thing that happened.
    expect(outcome.findings.map((finding) => finding.ruleId)).toEqual([
      'compass/gate-output-unparseable',
    ]);
    expect(outcome.findings[0].blocking).toBe(true);
  });

  it('treats output it does not recognise as could-not-run, and says which side is at fault', () => {
    const bin = tempDir();
    stubGate(bin, 'dep-guard', { stdout: '{"something":"else"}', exit: 0 });

    const outcome = runGate(gate(), { repoRoot: tempDir(), staged: true, pathValue: bin });

    expect(outcome.couldNotRun?.reason).toBe('unparseable-output');
    expect(outcome.couldNotRun?.detail).toMatch(/dep-guard/);
  });

  it('reports a version of null rather than a guess when the binary cannot be asked', () => {
    const bin = tempDir();
    // intent-guard-check ignores --version and runs the gate, so the
    // runner must not ask it. This stub answers --version anyway; the point
    // is that the runner never sends it.
    stubGate(bin, 'intent-guard-check', {
      stdout: '{"status":"ok","exitCode":0,"reasons":[],"contractFound":true,"contractFrozen":true}',
    });

    const outcome = runGate(gate({ role: 'intent', product: 'intent-guard' }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
    });

    expect(outcome.binary?.candidate).toBe('intent-guard-check');
    expect(outcome.productVersion).toBeNull();
  });

  it('runs the intent gate with an explicit project root', () => {
    const bin = tempDir();
    const log = path.join(tempDir(), 'argv.txt');
    stubGate(bin, 'intent-guard', {
      stdout: '{"status":"ok","exitCode":0,"reasons":[],"contractFound":true,"contractFrozen":true}',
      argvLog: log,
    });

    runGate(gate({ role: 'intent', product: 'intent-guard' }), {
      repoRoot: tempDir(),
      staged: true,
      pathValue: bin,
    });

    expect(readFileSync(log, 'utf8').trim()).toBe('check --project . --staged --json');
  });
});
