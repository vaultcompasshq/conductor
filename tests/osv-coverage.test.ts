// osv design item 1.1: what the vulnerabilities gate hands osv-scanner.
// Tests 2, 4 (the on-disk half), 4a (the resolution-mode half that needs no
// base run), 5 and 6 of the design's test plan, against the osv stub in
// real temporary repositories.

import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runGate } from '../src/gate-runner.js';
import type { GatePolicy } from '../src/policy.js';
import { osvOutput, osvRecord, osvResult, stubOsv } from './helpers/osv-stub.js';

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-osv-cov-'));
  temps.push(dir);
  return dir;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
}

function put(repo: string, files: Record<string, string>): void {
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    writeFileSync(path.join(repo, name), body);
  }
}

function commit(repo: string, files: Record<string, string>, message = 'change'): void {
  put(repo, files);
  for (const name of Object.keys(files)) {
    git(repo, 'add', '-f', name);
  }
  git(repo, 'commit', '--quiet', '-m', message);
}

function repoWith(files: Record<string, string>): string {
  const repo = tempDir();
  git(repo, 'init', '--quiet', '-b', 'main');
  commit(repo, { 'README.md': '# fixture\n', ...files }, 'base');
  return repo;
}

function osvGate(overrides: Partial<GatePolicy> = {}): GatePolicy {
  return {
    role: 'vulnerabilities',
    product: 'osv-scanner',
    enabled: true,
    stage: 'ci',
    enforce: true,
    excludedByCli: false,
    options: {},
    ...overrides,
  };
}

function runOsv(repo: string, opts: { trustBase?: string; gate?: GatePolicy; head?: { stdout?: string; exit?: number } } = {}) {
  const bin = tempDir();
  const record = path.join(tempDir(), 'record');
  stubOsv(bin, { record, head: opts.head ?? {} });
  const out = runGate(opts.gate ?? osvGate(), {
    repoRoot: repo,
    staged: false,
    pathValue: bin,
    tempRoot: tempDir(),
    ...(opts.trustBase === undefined ? {} : { trustBase: opts.trustBase }),
  });
  return { out, head: osvRecord(record, 'head') };
}

const PINNED = 'flask==2.0.1\n';

describe('the file list and its argv (test 2)', () => {
  it('hands exact names bare and requirements variants in the parse-as form, and never go.sum or requirements.in', () => {
    const repo = repoWith({
      'package-lock.json': '{}\n',
      'npm-shrinkwrap.json': '{}\n',
      'go.mod': 'module example.invalid/m\n',
      'go.sum': '',
      'api/requirements.txt': PINNED,
      'requirements-dev.txt': PINNED,
      'sub/dev-requirements.txt': PINNED,
      'requirements.in': 'flask\n',
      'node_modules/x/requirements.txt': PINNED,
    });
    const { out, head } = runOsv(repo);
    expect(out.couldNotRun).toBeNull();
    expect(head.argv).toEqual([
      'scan source --format json --lockfile api/requirements.txt --lockfile go.mod --lockfile npm-shrinkwrap.json ' +
        '--lockfile package-lock.json --lockfile requirements.txt:requirements-dev.txt ' +
        '--lockfile requirements.txt:sub/dev-requirements.txt --no-resolve',
    ]);
  });
});

describe('includes, read from the tracked files on disk (test 4)', () => {
  it('leaves a requirements file unscanned when its include is on disk but not tracked', () => {
    const repo = repoWith({ 'package-lock.json': '{}\n', 'requirements.txt': '-r extra.txt\nflask==2.0.1\n' });
    put(repo, { 'extra.txt': 'six==1.16.0\n' });
    const { out, head } = runOsv(repo);
    expect(head.argv[0]).not.toContain('requirements.txt');
    expect(out.diagnostics).toContainEqual({
      code: 'conductor/requirements-not-scanned',
      message: 'requirements.txt not scanned: includes extra.txt, which is not tracked.',
    });
  });

  it('leaves a requirements file unscanned when its include is a tracked symbolic link', () => {
    const repo = repoWith({ 'package-lock.json': '{}\n', 'requirements.txt': '-r extra.txt\n', 'real.txt': PINNED });
    symlinkSync('real.txt', path.join(repo, 'extra.txt'));
    git(repo, 'add', 'extra.txt');
    git(repo, 'commit', '--quiet', '-m', 'link');
    const { out } = runOsv(repo);
    expect(out.diagnostics).toContainEqual({
      code: 'conductor/requirements-not-scanned',
      message: 'requirements.txt not scanned: includes extra.txt, which is not a regular file.',
    });
  });

  it('scans a requirements file whose include in a subdirectory resolves next to it', () => {
    const repo = repoWith({
      'sub/requirements-dev.txt': '-r base.txt\n-r requirements-dev.txt\n',
      'sub/base.txt': PINNED,
      'base.txt': 'flask>=1\n',
    });
    const { head } = runOsv(repo);
    expect(head.argv[0]).toContain('--lockfile requirements.txt:sub/requirements-dev.txt');
  });
});

describe('resolution mode, the head half (test 4a)', () => {
  it('passes --no-resolve with a requirements file and never without one', () => {
    const withReq = runOsv(repoWith({ 'package-lock.json': '{}\n', 'requirements.txt': PINNED }));
    expect(withReq.head.argv[0]).toMatch(/ --no-resolve$/);
    const without = runOsv(repoWith({ 'package-lock.json': '{}\n' }));
    expect(without.head.argv).toEqual(['scan source --format json --lockfile package-lock.json']);
  });

  it('drops a policy no-resolve on a run with a requirements file, with a note, and passes it as written otherwise', () => {
    const gate = osvGate({ options: { 'no-resolve': false } });
    const withReq = runOsv(repoWith({ 'requirements.txt': PINNED }), { gate });
    expect(withReq.head.argv).toEqual(['scan source --format json --lockfile requirements.txt --no-resolve']);
    expect(withReq.out.diagnostics).toContainEqual({
      code: 'conductor/option-overridden',
      message:
        'options.no-resolve in .guardrails.yaml was not passed: requirements files are always scanned ' +
        'with --no-resolve (direct requirements only).',
    });
    const without = runOsv(repoWith({ 'package-lock.json': '{}\n' }), { gate });
    expect(without.head.argv).toEqual(['scan source --format json --lockfile package-lock.json --no-no-resolve']);
    expect(without.out.diagnostics.map((d) => d.code)).not.toContain('conductor/option-overridden');
  });

  it('says per scanned requirements file that only direct requirements were read', () => {
    const { out } = runOsv(repoWith({ 'api/requirements.txt': PINNED, 'package-lock.json': '{}\n' }));
    expect(out.run.diagnostics).toContainEqual({
      code: 'conductor/requirements-direct-only',
      message: 'api/requirements.txt: direct requirements only; no lockfile, so transitive packages are not scanned.',
    });
    expect(out.run.diagnostics.filter((d) => d.code === 'conductor/requirements-direct-only')).toHaveLength(1);
  });
});

describe('coverage wording (test 5)', () => {
  it('names an unpinned requirements file with the line that stopped it, and counts it in the run details', () => {
    const repo = repoWith({
      'package-lock.json': '{}\n',
      'services/api/requirements.txt': 'six==1.16.0\n# web\n\nflask>=2.0\n',
    });
    const { out, head } = runOsv(repo);
    expect(head.argv).toEqual(['scan source --format json --lockfile package-lock.json']);
    expect(out.diagnostics).toEqual([
      {
        code: 'conductor/requirements-not-scanned',
        message:
          'services/api/requirements.txt not scanned: line 4 "flask>=2.0" is not pinned with ==, so any ' +
          'version osv-scanner reported would be a guess.',
      },
    ]);
    expect(out.run.details['not-scanned']).toBe('1 (services/api/requirements.txt)');
  });

  it('says what it had nothing to scan for when every candidate was an unpinned requirements file, at exit 0', () => {
    const repo = repoWith({ 'requirements.txt': 'flask\n', 'web/requirements-dev.txt': 'pytest>=7\n' });
    const { out, head } = runOsv(repo);
    expect(head.argv).toEqual([]);
    expect(out.exitCode).toBe(0);
    expect(out.couldNotRun).toBeNull();
    expect(out.diagnostics.map((d) => d.code)).toEqual([
      'conductor/requirements-not-scanned',
      'conductor/requirements-not-scanned',
      'conductor/nothing-to-scan',
    ]);
    expect(out.diagnostics[2]!.message).toBe(
      'osv-scanner had nothing it could scan: 2 requirements file(s) not pinned (requirements.txt, ' +
        'web/requirements-dev.txt). The verdict is clean because there was nothing to read, not because ' +
        'a scan found nothing. Tracked manifests not handed to osv-scanner: requirements.txt, ' +
        'web/requirements-dev.txt.'
    );
  });

  it('keeps the read-no-lockfile sentence when there was no candidate at all', () => {
    const { out } = runOsv(repoWith({}));
    expect(out.diagnostics).toEqual([
      {
        code: 'conductor/nothing-to-scan',
        message:
          'osv-scanner read no lockfile, so nothing was scanned; the verdict is clean because there was ' +
          'nothing to read, not because a scan found nothing.',
      },
    ]);
  });
});

describe('the pin check is a ratchet on a pull request (test 6)', () => {
  it('still scans a file pinned on the base when the head adds an unpinned line, and its pinned advisory still blocks', () => {
    const repo = repoWith({ 'requirements.txt': 'jinja2==2.4.1\n' });
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    commit(repo, { 'requirements.txt': 'jinja2==2.4.1\nfoo>=1\n' }, 'add an unpinned line');
    const stdout = osvOutput(
      osvResult('requirements.txt', [{ name: 'jinja2', version: '2.4.1', ecosystem: 'PyPI', ids: ['PYSEC-2014-8'] }])
    );
    const { out, head } = runOsv(repo, { trustBase: 'main', head: { stdout, exit: 1 } });
    expect(head.argv[0]).toContain('--lockfile requirements.txt');
    expect(out.exitCode).toBe(1);
    expect(out.findings.map((f) => [f.ruleId, f.blocking])).toEqual([['osv-scanner/PYSEC-2014-8', true]]);
    expect(out.diagnostics).toContainEqual({
      code: 'conductor/requirements-not-pinned',
      message:
        'requirements.txt is scanned although line 2 "foo>=1" is not pinned with ==, so any version ' +
        'osv-scanner reported would be a guess. Its copy on the base is pinned, so the file stays scanned ' +
        'under the ratchet; the lines named are read as written.',
    });
    expect(out.run.diagnostics).toContainEqual({
      code: 'conductor/requirements-direct-only',
      message:
        'requirements.txt: direct requirements only; no lockfile, so transitive packages are not scanned. ' +
        'Pinned on the base; scanned under the ratchet.',
    });
  });

  it('leaves out a file that is unpinned on the base too, and one that is new in the pull request', () => {
    const repo = repoWith({ 'package-lock.json': '{}\n', 'requirements.txt': 'foo>=1\n' });
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    commit(repo, { 'requirements.txt': 'foo>=2\n', 'requirements-dev.txt': 'bar\n' });
    const { out, head } = runOsv(repo, { trustBase: 'main' });
    expect(head.argv[0]).not.toContain('requirements');
    expect(out.diagnostics.filter((d) => d.code === 'conductor/requirements-not-scanned')).toHaveLength(2);
  });

  it('notes a file the pull request pins for the first time', () => {
    const repo = repoWith({ 'requirements.txt': 'foo>=1\n' });
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    commit(repo, { 'requirements.txt': 'foo==1.0\n' });
    const { out } = runOsv(repo, { trustBase: 'main' });
    expect(out.run.diagnostics).toContainEqual({
      code: 'conductor/requirements-direct-only',
      message:
        'requirements.txt: direct requirements only; no lockfile, so transitive packages are not scanned. ' +
        'Newly pinned in this pull request.',
    });
  });

  it('does not ratchet on a local run: an unpinned file is simply left out', () => {
    const repo = repoWith({ 'package-lock.json': '{}\n', 'requirements.txt': 'jinja2==2.4.1\n' });
    put(repo, { 'requirements.txt': 'jinja2==2.4.1\nfoo>=1\n' });
    const { head } = runOsv(repo);
    expect(head.argv).toEqual(['scan source --format json --lockfile package-lock.json']);
  });
});
