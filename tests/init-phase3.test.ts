// conductor init, phase 3 (item 3.4): roles an existing policy lacks, the
// external-gate rule, the manifest's .gitignore line, and husky on a fresh
// clone. Init-side only: none of this reaches a run's verdict.

import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  GITIGNORE_LINE,
  MANIFEST_RELATIVE_PATH,
  POLICY_FILE_NAME,
  applyInit,
  planInit,
  renderInitHuman,
  revertInit,
} from '../src/init.js';
import { parsePolicy } from '../src/policy.js';

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-init3-'));
  temps.push(dir);
  return dir;
}

function gitRepo(files: Record<string, string> = {}): string {
  const dir = tempDir();
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(path.join(dir, 'README.md'), 'fixture\n');
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), body);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: dir });
  return dir;
}

function shim(dir: string, name: string): void {
  writeFileSync(path.join(dir, name), '#!/bin/sh\nexit 0\n');
  chmodSync(path.join(dir, name), 0o755);
}

function init(cwd: string, options: Record<string, unknown> = {}) {
  const opts = { cwd, pathValue: '', ...options } as Parameters<typeof planInit>[0];
  return applyInit(planInit(opts), opts);
}

describe('init on an existing policy (3.4a)', () => {
  it('names each role the file lacks, with the two lines that add it, and leaves the file alone', () => {
    const policy = ['version: 1', 'gates:', '  dependencies:', '    product: dep-guard', ''].join('\n');
    const repo = gitRepo({ [POLICY_FILE_NAME]: policy });
    const result = init(repo);
    const text = renderInitHuman(result);
    expect(text).toContain(
      `Note: ${POLICY_FILE_NAME} has no entry for 4 gate role(s): secrets, intent, secrets-history, vulnerabilities.`
    );
    expect(text).toContain('  secrets-history:\n    product: gitleaks');
    expect(text).toContain('  vulnerabilities:\n    product: osv-scanner');
    expect(text).not.toContain('  dependencies:\n    product: dep-guard');
    expect(readFileSync(path.join(repo, POLICY_FILE_NAME), 'utf8')).toBe(policy);
    // The snippet is real: pasted under gates:, the file parses with the role.
    const pasted = policy.replace('gates:\n', 'gates:\n  secrets-history:\n    product: gitleaks\n');
    expect(parsePolicy(pasted, POLICY_FILE_NAME).gates['secrets-history']?.product).toBe('gitleaks');
  });

  it('says nothing about missing roles when the file has every one', () => {
    const repo = gitRepo();
    init(repo);
    expect(renderInitHuman(init(repo))).not.toContain('has no entry for');
  });
});

describe('external gates at init (3.4b)', () => {
  it('writes an external gate enabled only when its binary is found, with a CI comment in the file', () => {
    const repo = gitRepo();
    const bin = tempDir();
    shim(bin, 'gitleaks');
    const result = init(repo, { pathValue: bin });
    const policy = readFileSync(path.join(repo, POLICY_FILE_NAME), 'utf8');
    expect(policy).toMatch(
      /secrets-history:\n\s+product: gitleaks\n\s+enabled: true\n\s+# Enabled because gitleaks was found on the machine that ran init\. CI must\n\s+# install gitleaks itself/
    );
    expect(policy).toMatch(/vulnerabilities:\n\s+product: osv-scanner\n\s+enabled: false\n\s+stage: ci/);
    expect(policy).not.toContain('Enabled because osv-scanner');
    expect(renderInitHuman(result)).toMatch(
      /^WARNING: secrets-history \(gitleaks\) is enabled only because its tool was found on this machine's PATH;.*conductor\/gate-missing and exit 2/m
    );
  });

  it('writes no CI comment on a managed gate or a gate it did not find', () => {
    const repo = gitRepo();
    const bin = tempDir();
    shim(bin, 'vault-guard');
    init(repo, { pathValue: bin });
    expect(readFileSync(path.join(repo, POLICY_FILE_NAME), 'utf8')).not.toContain('CI must');
  });
});

describe('the manifest and .gitignore (3.4c)', () => {
  it('creates .gitignore with the line when there is none, and says so', () => {
    const repo = gitRepo();
    const result = init(repo);
    expect(readFileSync(path.join(repo, '.gitignore'), 'utf8')).toBe(`${GITIGNORE_LINE}\n`);
    expect(renderInitHuman(result)).toMatch(/wrote \.gitignore \(append "\.guardrails\/"/);
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' });
    expect(status).not.toContain(MANIFEST_RELATIVE_PATH);
  });

  it('appends to an existing .gitignore without changing any line, adding a missing final newline', () => {
    const repo = gitRepo({ '.gitignore': 'node_modules\n# keep\ndist' });
    init(repo);
    expect(readFileSync(path.join(repo, '.gitignore'), 'utf8')).toBe(`node_modules\n# keep\ndist\n${GITIGNORE_LINE}\n`);
  });

  it('does nothing when git already ignores the manifest', () => {
    const repo = gitRepo({ '.gitignore': '.guardrails/manifest.json\n' });
    const result = init(repo);
    expect(readFileSync(path.join(repo, '.gitignore'), 'utf8')).toBe('.guardrails/manifest.json\n');
    expect(renderInitHuman(result)).not.toContain('.gitignore');
  });

  it('never writes through a symbolic link, and prints the line instead', () => {
    const repo = gitRepo();
    const outside = path.join(tempDir(), 'elsewhere');
    writeFileSync(outside, 'theirs\n');
    symlinkSync(outside, path.join(repo, '.gitignore'));
    const result = init(repo);
    expect(readFileSync(outside, 'utf8')).toBe('theirs\n');
    expect(renderInitHuman(result)).toContain(
      `is not ignored by git and init did not change .gitignore (.gitignore is a symbolic link). Add the line "${GITIGNORE_LINE}"`
    );
  });

  it('writes nothing on a dry run, and --revert leaves the line', () => {
    const dry = gitRepo();
    const plan = init(dry, { dryRun: true });
    expect(existsSync(path.join(dry, '.gitignore'))).toBe(false);
    expect(renderInitHuman(plan)).toMatch(/would write \.gitignore/);
    const repo = gitRepo();
    init(repo);
    expect(revertInit({ cwd: repo, pathValue: '' }).ok).toBe(true);
    expect(readFileSync(path.join(repo, '.gitignore'), 'utf8')).toBe(`${GITIGNORE_LINE}\n`);
  });
});

describe('husky on a fresh clone (3.4d)', () => {
  it('targets the tracked .husky/pre-commit when package.json declares husky and core.hooksPath is not set', () => {
    const repo = gitRepo({ 'package.json': JSON.stringify({ devDependencies: { husky: '^9.1.7' } }) });
    const result = init(repo, { hook: true });
    expect(result.ok).toBe(true);
    expect(result.hookManager).toBe('husky');
    expect(existsSync(path.join(repo, '.husky', 'pre-commit'))).toBe(true);
    expect(existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false);
    expect(renderInitHuman(result)).toContain(
      'husky is declared in package.json (devDependencies) but has not been installed in this clone'
    );
  });

  it('recognises a prepare script that runs husky, and a tracked .husky/ directory on its own', () => {
    const viaPrepare = gitRepo({ 'package.json': JSON.stringify({ scripts: { prepare: 'husky' } }) });
    expect(init(viaPrepare, { hook: true }).hookManager).toBe('husky');
    const viaDir = gitRepo({ '.husky/pre-commit': 'pnpm lint\n' });
    const result = init(viaDir, { hook: true });
    // The tracked hook is somebody's, so it is refused as foreign, at the
    // tracked path rather than written into .git/hooks behind husky's back.
    expect(result.hookManager).toBe('husky');
    expect(result.conflicts.map((conflict) => conflict.reason)).toEqual(['foreign-hook']);
    expect(existsSync(path.join(viaDir, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });

  it('does not redirect when core.hooksPath is set explicitly to .git/hooks, the path git then runs (B2)', () => {
    const repo = gitRepo({ 'package.json': JSON.stringify({ devDependencies: { husky: '^9.1.7' } }) });
    execFileSync('git', ['config', 'core.hooksPath', '.git/hooks'], { cwd: repo });
    const result = init(repo, { hook: true });
    expect(result.hookManager).toBe('native');
    expect(existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(true);
    expect(existsSync(path.join(repo, '.husky', 'pre-commit'))).toBe(false);
    expect(renderInitHuman(result)).not.toContain('core.hooksPath is not set');
  });

  it('matches the husky command in a prepare script, never the bare word', () => {
    for (const prepare of ['husky install', 'is-ci || husky', 'npx husky', 'pnpm exec husky', 'tsc && husky']) {
      const repo = gitRepo({ 'package.json': JSON.stringify({ scripts: { prepare } }) });
      expect([prepare, init(repo, { hook: true }).hookManager]).toEqual([prepare, 'husky']);
    }
    for (const prepare of ['no-husky', 'echo skip husky', 'node scripts/husky-free.js']) {
      const repo = gitRepo({ 'package.json': JSON.stringify({ scripts: { prepare } }) });
      expect([prepare, init(repo, { hook: true }).hookManager]).toEqual([prepare, 'native']);
    }
  });

  it('tells the owner of a foreign tracked .husky/pre-commit that husky must be installed for it to run', () => {
    const repo = gitRepo({ '.husky/pre-commit': 'pnpm lint\n' });
    const result = init(repo, { hook: true });
    expect(result.conflicts[0]?.guidance).toContain(
      'husky is not installed in this clone (core.hooksPath is not set), so that hook does not run at all until'
    );
  });

  it('leaves a repository with no husky declaration on .git/hooks', () => {
    const repo = gitRepo({ 'package.json': JSON.stringify({ devDependencies: { jest: '1' }, scripts: { prepare: 'tsc' } }) });
    const result = init(repo, { hook: true });
    expect(result.hookManager).toBe('native');
    expect(existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(true);
  });

  it('respects a core.hooksPath somebody configured, whatever package.json says', () => {
    const repo = gitRepo({ 'package.json': JSON.stringify({ devDependencies: { husky: '9' } }) });
    execFileSync('git', ['config', 'core.hooksPath', 'hooks'], { cwd: repo });
    const result = init(repo, { hook: true });
    expect(result.hookManager).toBe('native');
    expect(existsSync(path.join(repo, 'hooks', 'pre-commit'))).toBe(true);
  });
});
