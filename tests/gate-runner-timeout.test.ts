// What timeout actually reaches spawnSync, per product.
//
// Its own file because it replaces node:child_process for the module under
// test, which in ESM has to happen before that module is imported. The
// replacement calls straight through to the real spawnSync and only records
// the options, so the stub gates still run as real subprocesses.

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const real = await import('node:child_process');
const calls: Array<{ command: string; args: readonly string[]; timeout: number | undefined }> = [];

jest.unstable_mockModule('node:child_process', () => ({
  ...real,
  spawnSync: (command: string, args: readonly string[], options: { timeout?: number }) => {
    calls.push({ command, args, timeout: options?.timeout });
    return real.spawnSync(command, args as string[], options as Parameters<typeof real.spawnSync>[2]);
  },
}));

const { runGate } = await import('../src/gate-runner.js');
const { CLEAN_OSV_SCANNER, CLEAN_VAULT_GUARD, stubGate } = await import('./helpers/stub-gate.js');

const temps: string[] = [];
afterEach(() => {
  calls.length = 0;
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-timeout-'));
  temps.push(dir);
  return dir;
}

/** A repository tracking one lockfile, so osv-scanner is actually spawned. */
function lockfileRepo(): string {
  const repo = tempDir();
  const git = (...args: string[]) => real.execFileSync('git', args, { cwd: repo });
  git('init', '--quiet', '-b', 'main');
  writeFileSync(path.join(repo, 'package-lock.json'), '{}\n');
  git('add', 'package-lock.json');
  git('-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '--quiet', '-m', 'lockfile');
  return repo;
}

function scanCall():{ timeout: number | undefined } | undefined {
  return calls.find((c) => c.args.includes('--format') || c.args.includes('-f'));
}

describe('the timeout each gate is given', () => {
  it('gives an external gate the profile timeout when the caller sets none', () => {
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', exit: 0, stdout: CLEAN_OSV_SCANNER });
    runGate(
      { role: 'vulnerabilities', product: 'osv-scanner', enabled: true, stage: 'ci', enforce: true, excludedByCli: false, options: {} },
      { repoRoot: lockfileRepo(), staged: false, pathValue: bin, tempRoot: tempDir() }
    );
    expect(scanCall()?.timeout).toBe(300_000);
  });

  it('keeps an npm gate on two minutes', () => {
    const bin = tempDir();
    stubGate(bin, 'vault-guard', { exit: 0, stdout: CLEAN_VAULT_GUARD });
    runGate(
      { role: 'secrets', product: 'vault-guard', enabled: true, stage: 'commit', enforce: true, excludedByCli: false, options: {} },
      { repoRoot: tempDir(), staged: false, pathValue: bin }
    );
    expect(scanCall()?.timeout).toBe(120_000);
  });

  it('lets the caller override the profile', () => {
    const bin = tempDir();
    stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', exit: 0, stdout: CLEAN_OSV_SCANNER });
    runGate(
      { role: 'vulnerabilities', product: 'osv-scanner', enabled: true, stage: 'ci', enforce: true, excludedByCli: false, options: {} },
      { repoRoot: lockfileRepo(), staged: false, pathValue: bin, tempRoot: tempDir(), timeoutMs: 5_000 }
    );
    expect(scanCall()?.timeout).toBe(5_000);
  });
});
