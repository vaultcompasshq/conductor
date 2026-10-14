// The external gates against the REAL gitleaks, in throwaway repositories.
//
// Stubs prove what the runner hands a tool; only the tool proves what it does
// with it, and every hole found in this feature came from the tool doing
// something its documentation did not say (an [extend] path read from the
// working directory, a merge commit's own changes left out of `git log -p`, a
// .gitattributes binary mark hiding a file). So each of those is pinned here
// against the binary itself.
//
// Skipped when no gitleaks is available: set CONDUCTOR_GITLEAKS_BIN, or put
// one at .local/bin/gitleaks in this checkout (gitignored). CI without it
// runs the stubbed suites only, which pin the argv and the working directory.

import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGate } from '../src/gate-runner.js';
import type { GatePolicy } from '../src/policy.js';

const CHECKOUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GITLEAKS = process.env.CONDUCTOR_GITLEAKS_BIN ?? path.join(CHECKOUT, '.local', 'bin', 'gitleaks');
const available = existsSync(GITLEAKS);

// Built at run time so this file carries no token shape of its own.
const TOKEN = ['dp', 'pt', 'q7ZkR2mXw9LpT4vB8nYc' + 'H3sJ6dF1gA5eK0uQzWxVbNm'].join('.');

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-real-'));
  temps.push(dir);
  return dir;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', ...args],
    { cwd: repo, encoding: 'utf8' }
  );
}

function put(repo: string, files: Record<string, string>): void {
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    writeFileSync(path.join(repo, name), body);
  }
}

function commit(repo: string, files: Record<string, string>, message: string): void {
  put(repo, files);
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', message);
}

function repoOnMain(files: Record<string, string> = { 'README.md': '# fixture\n' }): string {
  const repo = tempDir();
  git(repo, 'init', '--quiet', '-b', 'main');
  commit(repo, files, 'base');
  return repo;
}

const gitleaksGate: GatePolicy = {
  role: 'secrets-history',
  product: 'gitleaks',
  enabled: true,
  stage: 'ci',
  enforce: true,
  excludedByCli: false,
  options: {},
};

function run(repo: string, trustBase?: string) {
  return runGate(gitleaksGate, {
    repoRoot: repo,
    staged: false,
    pathValue: path.dirname(GITLEAKS),
    tempRoot: tempDir(),
    ...(trustBase === undefined ? {} : { trustBase }),
  });
}

(available ? describe : describe.skip)('gitleaks, for real', () => {
  it('reads an [extend] target from the base, so a pull request cannot allowlist through it', () => {
    const repo = repoOnMain({
      '.gitleaks.toml': '[extend]\npath = "gl-extra.toml"\n',
      'gl-extra.toml': '[extend]\nuseDefault = true\n',
    });
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    commit(
      repo,
      {
        'gl-extra.toml': "[extend]\nuseDefault = true\n\n[[allowlists]]\npaths = ['''src/.*''']\n",
        'src/config.js': `export const token = "${TOKEN}";\n`,
      },
      'allowlist src through the extended file, then add a token there'
    );

    const out = run(repo, 'main');
    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(3);
    expect(out.findings.map((f) => f.subject.kind === 'location' && f.subject.file)).toContain('src/config.js');
    expect(out.trustBase?.proposals.some((p) => /^gl-extra\.toml differs/.test(p))).toBe(true);
  });

  it('finds a secret added inside a merge commit own changes', () => {
    const repo = repoOnMain();
    git(repo, 'checkout', '--quiet', '-b', 'side');
    commit(repo, { 'side.txt': 'side\n' }, 'side work');
    git(repo, 'checkout', '--quiet', 'main');
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    commit(repo, { 'pr.txt': 'pr\n' }, 'pr work');
    git(repo, 'merge', '--no-ff', '--no-commit', 'side');
    put(repo, { 'evil.env': `TOKEN=${TOKEN}\n` });
    git(repo, 'add', 'evil.env');
    git(repo, 'commit', '--quiet', '-m', 'merge side (and something else)');

    const out = run(repo, 'main');
    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(3);
    expect(out.findings.map((f) => f.subject.kind === 'location' && f.subject.file)).toEqual(['evil.env']);
  });

  it('reports an ordinary pull-request secret once under an Actions-style merge, naming the merge as also carrying it', () => {
    const repo = repoOnMain();
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    // Dated earlier than the merge, as a real pull request commit is; within
    // one test second the two would tie and the first seen would be kept.
    put(repo, { 'config.env': `TOKEN=${TOKEN}\n` });
    git(repo, 'add', '-A');
    git(repo, 'commit', '--quiet', '--date=2020-01-01T00:00:00Z', '-m', 'add a token');
    const prCommit = git(repo, 'rev-parse', 'HEAD').trim();
    // The shape actions/checkout gives a pull_request event: a detached merge
    // of the pull request into the base, first parent the base.
    git(repo, 'checkout', '--quiet', '--detach', 'main');
    git(repo, 'merge', '--quiet', '--no-ff', '-m', 'synthetic merge', 'pr');

    const out = run(repo, 'main');
    expect(out.exitCode).toBe(3);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.details.commit).toBe(prCommit);
    expect(out.findings[0]!.details.alsoIn).toEqual([git(repo, 'rev-parse', 'HEAD').trim()]);
  });

  it('on a pull request, finds a secret in a file the head marks binary in .gitattributes', () => {
    const repo = repoOnMain();
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    commit(
      repo,
      { '.gitattributes': 'src/*.js binary\n', 'src/config.js': `export const token = "${TOKEN}";\n` },
      'mark src binary and add a token'
    );
    const out = run(repo, 'main');
    expect(out.exitCode).toBe(3);
    expect(out.findings.map((f) => f.subject.kind === 'location' && f.subject.file)).toEqual(['src/config.js']);

    // The documented LOCAL limit, pinned so a change in either direction is
    // noticed: scanning the working tree, git honours the tree's own
    // .gitattributes and shows the file as binary, so the secret is missed.
    // The pull-request run above is protected only because it scans from the
    // git directory, where the head's .gitattributes is not read.
    const local = run(repo);
    expect(local.findings).toEqual([]);
  });
});

// osv-scanner, for real (osv design, test 20). Skipped when no osv-scanner is
// available: set CONDUCTOR_OSV_SCANNER_BIN, or put one at
// .local/bin/osv-scanner in this checkout (gitignored). These query the
// osv.dev database over the network, which is why they are not in the
// default suite's stubbed files. Observations are in tests/fixtures/README.md.
const OSV = process.env.CONDUCTOR_OSV_SCANNER_BIN ?? path.join(CHECKOUT, '.local', 'bin', 'osv-scanner');
const osvAvailable = existsSync(OSV);

const osvGate: GatePolicy = {
  role: 'vulnerabilities',
  product: 'osv-scanner',
  enabled: true,
  stage: 'ci',
  enforce: true,
  excludedByCli: false,
  options: {},
};

function runOsv(repo: string, trustBase?: string, presentOnBase?: 'block' | 'report') {
  return runGate(
    { ...osvGate, ...(presentOnBase === undefined ? {} : { presentOnBase }) },
    {
      repoRoot: repo,
      staged: false,
      pathValue: path.dirname(OSV),
      tempRoot: tempDir(),
      ...(trustBase === undefined ? {} : { trustBase }),
    }
  );
}

/** A package-lock.json (v3) resolving exactly these packages. */
function packageLock(packages: Record<string, string>): string {
  const entries: Record<string, unknown> = {
    '': { name: 'fixture', version: '1.0.0', dependencies: packages },
  };
  for (const [name, version] of Object.entries(packages)) {
    entries[`node_modules/${name}`] = {
      version,
      resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
    };
  }
  return `${JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: entries }, null, 2)}\n`;
}

(osvAvailable ? describe : describe.skip)('osv-scanner, for real', () => {
  it('reads go.mod and blocks on a known advisory, and never hands over go.sum', () => {
    const repo = repoOnMain({
      'go.mod': 'module example.invalid/m\n\ngo 1.20\n\nrequire golang.org/x/text v0.3.0\n',
      'go.sum': 'golang.org/x/text v0.3.0 h1:g61tztE5qeGQ89tm6NTjjM9VPIm088od1l6aSorWRWg=\n',
    });
    const out = runOsv(repo);
    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(1);
    expect(out.argv).toContain('go.mod');
    expect(out.argv.some((arg) => arg.includes('go.sum'))).toBe(false);
    expect(out.findings.some((f) => f.subject.kind === 'package' && f.subject.name === 'golang.org/x/text')).toBe(true);
  });

  it('scans a pinned requirements-dev.txt through the parse-as form, and names an unpinned file', () => {
    const repo = repoOnMain({ 'requirements-dev.txt': 'jinja2==2.4.1\n', 'requirements.txt': 'flask>=2.0\n' });
    const out = runOsv(repo);
    expect(out.couldNotRun).toBeNull();
    expect(out.argv).toContain('requirements.txt:requirements-dev.txt');
    expect(out.argv).toContain('--no-resolve');
    expect(out.exitCode).toBe(1);
    expect(
      out.findings.every((f) => f.subject.kind === 'package' && f.subject.manifest === 'requirements-dev.txt')
    ).toBe(true);
    expect(out.findings.length).toBeGreaterThan(0);
    expect(out.diagnostics.map((d) => d.code)).toContain('conductor/requirements-not-scanned');
  });

  it('reads a tracked mix.lock and blocks on a known advisory (audit F3, for real)', () => {
    const repo = repoOnMain({
      'mix.lock':
        '%{\n  "plug": {:hex, :plug, "1.3.0", "6e2b01afc5db3fd011ca4a16efd9cb424528c157c30a44a0186bcc92c7b2e8f3", ' +
        '[:mix], [], "hexpm", "e3b1c1e2a5d4c1f0a7b9e6c5d4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5"},\n}\n',
    });
    const out = runOsv(repo);
    expect(out.couldNotRun).toBeNull();
    expect(out.argv).toContain('mix.lock');
    expect(out.exitCode).toBe(1);
    expect(out.findings.some((f) => f.subject.kind === 'package' && f.subject.name === 'plug')).toBe(true);
  });

  it('names a lockfile emptied to {} beside one that was read (audit F2, for real)', () => {
    // Pins osv-scanner's own per-file count line, which is what the umbrella
    // reads: a change to its wording would silently stop the naming.
    const repo = repoOnMain({ 'package-lock.json': '{}\n', 'requirements.txt': 'jinja2==2.4.1\n' });
    const out = runOsv(repo);
    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(1);
    const empty = out.diagnostics.filter((d) => d.code === 'conductor/lockfiles-empty');
    expect(empty).toHaveLength(1);
    expect(empty[0]?.message).toContain('package-lock.json');
    expect(empty[0]?.message).not.toContain('requirements.txt');
    expect(out.run.details.lockfiles).toBe('2 (package-lock.json [no packages read], requirements.txt)');
  });

  it('labels a base advisory present-on-base and an added one introduced (test 7, for real)', () => {
    const repo = repoOnMain({ 'package-lock.json': packageLock({ lodash: '4.17.20' }) });
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    commit(repo, { 'package-lock.json': packageLock({ lodash: '4.17.20', minimist: '1.2.0' }) }, 'add minimist');
    const out = runOsv(repo, 'main', 'report');
    expect(out.couldNotRun).toBeNull();
    expect(out.baseComparison?.unavailable).toEqual([]);
    const byName = (name: string) =>
      out.findings.filter((f) => f.subject.kind === 'package' && f.subject.name === name);
    expect(byName('lodash').length).toBeGreaterThan(0);
    expect(byName('minimist').length).toBeGreaterThan(0);
    expect(byName('lodash').every((f) => f.details.baseline === 'present-on-base' && !f.blocking)).toBe(true);
    expect(byName('minimist').every((f) => f.details.baseline === 'introduced' && f.blocking)).toBe(true);
  });
});
