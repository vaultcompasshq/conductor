import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ExternalConfigError, materializeExternalConfig } from '../src/external-config.js';
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

  it('materialises a relative [extend] path from the base next to the config, and proposes a head-side edit to it', () => {
    // gitleaks resolves [extend] path against its working directory. Read
    // from the head, the base config would pull in a file the pull request
    // wrote.
    const repo = tempGitRepo();
    writeFileSync(path.join(repo, '.gitleaks.toml'), '[extend]\npath = "gl-extra.toml"\n');
    writeFileSync(path.join(repo, 'gl-extra.toml'), '[extend]\nuseDefault = true\n');
    commitAll(repo, 'base config with extend');
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    writeFileSync(path.join(repo, 'gl-extra.toml'), "[extend]\nuseDefault = true\n[[allowlists]]\npaths = ['''src/.*''']\n");
    const tempRoot = tempDir();
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: 'main', profile: profileFor('gitleaks'), tempRoot })!;
    // In the directory the tool is run from, so the relative path lands here.
    expect(out.cwd).toBe(path.join(tempRoot, 'cwd'));
    expect(readFileSync(path.join(out.cwd, 'gl-extra.toml'), 'utf8')).toBe('[extend]\nuseDefault = true\n');
    expect(out.proposal).toBeNull();
    expect(out.extendProposals).toEqual([expect.stringMatching(/^gl-extra\.toml differs/)]);
  });

  it('follows an extend chain, each target from the base', () => {
    const repo = tempGitRepo();
    writeFileSync(path.join(repo, '.gitleaks.toml'), "[extend]\npath = 'config/a.toml'\n");
    mkdirSync(path.join(repo, 'config'));
    writeFileSync(path.join(repo, 'config/a.toml'), '[extend]\npath = "config/b.toml"\n');
    writeFileSync(path.join(repo, 'config/b.toml'), '[extend]\nuseDefault = true\n');
    commitAll(repo, 'chain');
    const tempRoot = tempDir();
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: 'HEAD', profile: profileFor('gitleaks'), tempRoot })!;
    expect(readFileSync(path.join(out.cwd, 'config/b.toml'), 'utf8')).toBe('[extend]\nuseDefault = true\n');
  });

  it('refuses an [extend] path the base ref does not have, naming it', () => {
    const repo = tempGitRepo();
    writeFileSync(path.join(repo, '.gitleaks.toml'), '[extend]\npath = "gl-extra.toml"\n');
    commitAll(repo, 'base config extending a file it never committed');
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    writeFileSync(path.join(repo, 'gl-extra.toml'), "[[allowlists]]\npaths = ['''.*''']\n");
    expect(() =>
      materializeExternalConfig({ repoRoot: repo, trustBase: 'main', profile: profileFor('gitleaks'), tempRoot: tempDir() })
    ).toThrow(ExternalConfigError);
    expect(() =>
      materializeExternalConfig({ repoRoot: repo, trustBase: 'main', profile: profileFor('gitleaks'), tempRoot: tempDir() })
    ).toThrow(/gl-extra\.toml/);
  });

  it('refuses an [extend] path that is absolute or climbs out of the work directory', () => {
    for (const target of ['/etc/gitleaks.toml', '../outside.toml']) {
      const repo = tempGitRepo();
      writeFileSync(path.join(repo, '.gitleaks.toml'), `[extend]\npath = "${target}"\n`);
      commitAll(repo, 'odd extend');
      expect(() =>
        materializeExternalConfig({ repoRoot: repo, trustBase: 'HEAD', profile: profileFor('gitleaks'), tempRoot: tempDir() })
      ).toThrow(ExternalConfigError);
    }
  });

  it('materialises a relative baseline named in the policy options from the base', () => {
    const repo = tempGitRepo();
    writeFileSync(path.join(repo, 'baseline.json'), '[]\n');
    commitAll(repo, 'baseline');
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    writeFileSync(path.join(repo, 'baseline.json'), '[{"Fingerprint":"x"}]\n');
    const tempRoot = tempDir();
    const out = materializeExternalConfig({
      repoRoot: repo, trustBase: 'main', profile: profileFor('gitleaks'), tempRoot, extraFiles: ['baseline.json'],
    })!;
    expect(readFileSync(path.join(out.cwd, 'baseline.json'), 'utf8')).toBe('[]\n');
    expect(out.extendProposals).toEqual([expect.stringMatching(/^baseline\.json differs/)]);
  });

  it('reads the base config when the working tree holds a file named like the revision and path', () => {
    // The base copy is what the tool gets, whatever the working tree holds.
    const repo = tempGitRepo();
    writeFileSync(path.join(repo, '.gitleaks.toml'), '[[rules]]\nid = "acme"\nregex = "ACME_[A-Z]{8}"\n');
    commitAll(repo, 'base config');
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    writeFileSync(path.join(repo, `${base}:.gitleaks.toml`), 'planted\n');
    commitAll(repo, 'plant');
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: base, profile: profileFor('gitleaks'), tempRoot: tempDir() })!;
    expect(out.source).toBe('base');
    expect(readFileSync(out.path, 'utf8')).toMatch(/ACME_/);
  });

  it('refuses, and never falls back to the neutral config, when the base config cannot be read', () => {
    const repo = tempGitRepo();
    writeFileSync(path.join(repo, 'real.toml'), '[[rules]]\nid = "acme"\n');
    symlinkSync('real.toml', path.join(repo, '.gitleaks.toml'));
    commitAll(repo, 'base config is a link');
    expect(() =>
      materializeExternalConfig({ repoRoot: repo, trustBase: 'HEAD', profile: profileFor('gitleaks'), tempRoot: tempDir() })
    ).toThrow(/\.gitleaks\.toml could not be read from the base ref/);
    expect(() =>
      materializeExternalConfig({ repoRoot: repo, trustBase: 'HEAD', profile: profileFor('gitleaks'), tempRoot: tempDir() })
    ).toThrow(
      /To clear it, make \.gitleaks\.toml a regular file on the base branch.*merged by someone allowed to merge without this check passing/
    );
  });

  it('refuses when the base ignore file cannot be read, rather than writing an empty one', () => {
    const repo = tempGitRepo();
    writeFileSync(path.join(repo, 'real-ignore'), 'fingerprint\n');
    symlinkSync('real-ignore', path.join(repo, '.gitleaksignore'));
    commitAll(repo, 'base ignore is a link');
    expect(() =>
      materializeExternalConfig({ repoRoot: repo, trustBase: 'HEAD', profile: profileFor('gitleaks'), tempRoot: tempDir() })
    ).toThrow(ExternalConfigError);
  });

  it('says the neutral stand-in was used, not the base copy, when the base has none', () => {
    const repo = tempGitRepo();
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    writeFileSync(path.join(repo, '.gitleaks.toml'), '[allowlist]\npaths = ["src/"]\n');
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: 'main', profile: profileFor('gitleaks'), tempRoot: tempDir() })!;
    expect(out.proposal).toMatch(/not on the base ref; conductor's neutral stand-in was used/);
    expect(out.proposal).not.toMatch(/base's copy/);
  });

  it('has no ignore file for osv-scanner', () => {
    const repo = tempGitRepo();
    const out = materializeExternalConfig({ repoRoot: repo, trustBase: 'HEAD', profile: profileFor('osv-scanner'), tempRoot: tempDir() })!;
    expect(out.ignore).toBeNull();
  });
});
