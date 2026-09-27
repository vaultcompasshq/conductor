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
