import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { materializeExternalConfig } from '../src/external-config.js';
import { profileFor } from '../src/products.js';

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-extcfg-'));
  temps.push(dir);
  return dir;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function commitAll(repo: string, message: string): void {
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '--quiet', '-m', message);
}

/** A repository on `main` with one commit. */
function tempGitRepo(): string {
  const repo = tempDir();
  git(repo, 'init', '--quiet', '-b', 'main');
  writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
  commitAll(repo, 'init');
  return repo;
}

describe('materializeExternalConfig', () => {
  it('returns null for a product with no config file', () => {
    expect(materializeExternalConfig({ repoRoot: tempGitRepo(), trustBase: 'HEAD', profile: profileFor('dep-guard'), tempRoot: tempDir() })).toBeNull();
  });

  it('uses the base copy when the base has one, and reports a head-side difference as a proposal', () => {
    const repo = tempGitRepo();
    writeFileSync(path.join(repo, '.gitleaks.toml'), '[allowlist]\npaths = ["docs/"]\n');
    commitAll(repo, 'base config');
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    writeFileSync(path.join(repo, '.gitleaks.toml'), '[allowlist]\npaths = ["docs/", "src/"]\n');
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: 'main', profile: profileFor('gitleaks'), tempRoot: tempDir() })!;
    expect(out.source).toBe('base');
    expect(readFileSync(out.path, 'utf8')).toBe('[allowlist]\npaths = ["docs/"]\n');
    expect(out.proposal).toMatch(/\.gitleaks\.toml differs/);
  });

  it('uses the neutral config when the base has none, so a head-side file cannot be auto-loaded', () => {
    const repo = tempGitRepo();
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    writeFileSync(path.join(repo, '.gitleaks.toml'), '[allowlist]\npaths = ["src/"]\n');
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: 'main', profile: profileFor('gitleaks'), tempRoot: tempDir() })!;
    expect(out.source).toBe('neutral');
    expect(readFileSync(out.path, 'utf8')).toBe('[extend]\nuseDefault = true\n');
    expect(out.proposal).toMatch(/\.gitleaks\.toml/);
  });

  it('has no proposal when base and head agree', () => {
    const repo = tempGitRepo();
    writeFileSync(path.join(repo, 'osv-scanner.toml'), '');
    commitAll(repo, 'cfg');
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: 'HEAD', profile: profileFor('osv-scanner'), tempRoot: tempDir() })!;
    expect(out.proposal).toBeNull();
  });

  it('takes the ignore file from the base too, so a pull request cannot ignore the leak it adds', () => {
    // gitleaks auto-loads .gitleaksignore from the scanned tree, and an entry
    // there is a fingerprint the scan then skips: the same hole as the
    // config, through a second file.
    const repo = tempGitRepo();
    writeFileSync(path.join(repo, '.gitleaksignore'), 'base-fingerprint\n');
    commitAll(repo, 'base ignore');
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    writeFileSync(path.join(repo, '.gitleaksignore'), 'base-fingerprint\nhead-fingerprint\n');
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: 'main', profile: profileFor('gitleaks'), tempRoot: tempDir() })!;
    expect(out.ignore).not.toBeNull();
    expect(readFileSync(path.join(out.ignore!.dir, '.gitleaksignore'), 'utf8')).toBe('base-fingerprint\n');
    expect(out.ignore!.proposal).toMatch(/\.gitleaksignore differs/);
  });

  it('gives gitleaks an empty ignore file when the base has none', () => {
    const repo = tempGitRepo();
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    writeFileSync(path.join(repo, '.gitleaksignore'), 'head-fingerprint\n');
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: 'main', profile: profileFor('gitleaks'), tempRoot: tempDir() })!;
    expect(readFileSync(path.join(out.ignore!.dir, '.gitleaksignore'), 'utf8')).toBe('');
    expect(out.ignore!.proposal).toMatch(/\.gitleaksignore/);
  });

  it('has no ignore file for osv-scanner', () => {
    const repo = tempGitRepo();
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: 'HEAD', profile: profileFor('osv-scanner'), tempRoot: tempDir() })!;
    expect(out.ignore).toBeNull();
  });
});
