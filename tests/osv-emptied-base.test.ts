// An emptied lockfile under a trust base is could-not-run (audit 2026-10-18
// N1; design docs/superpowers/specs/2026-10-18-emptied-lockfile-under-trust-base.md).
//
// Against the osv stub in real temporary repositories with real base and
// head commits. The stub prints osv-scanner 2.4.0's per-file count line on
// stderr ("Scanned <path> file and found N packages"), counting a handed
// file's OSV and PKG lines, so a base copy taken from the wrong place
// changes the count the check reads.

import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGate } from '../src/gate-runner.js';
import { checkEmptiedAgainstBase, type EmptiedCheckArgs } from '../src/osv-baseline.js';
import type { GatePolicy } from '../src/policy.js';
import { childEnv, shimGit } from './helpers/child-env.js';
import { lockBody, osvRecord, stubOsv, type OsvSide } from './helpers/osv-stub.js';
import { CLEAN_VAULT_GUARD, stubGate } from './helpers/stub-gate.js';

const CONDUCTOR_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-osv-emptied-'));
  temps.push(dir);
  return dir;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
}

function commit(repo: string, files: Record<string, string>, message: string): void {
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    writeFileSync(path.join(repo, name), body);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', message);
}

/** main holds `base`; the checked-out pr branch holds `head` on top. */
function prRepo(
  base: Record<string, string>,
  head: Record<string, string>,
  before: (repo: string) => void = () => {}
): string {
  const repo = tempDir();
  git(repo, 'init', '--quiet', '-b', 'main');
  commit(repo, { 'README.md': '# fixture\n', ...base }, 'base');
  git(repo, 'checkout', '--quiet', '-b', 'pr');
  before(repo);
  commit(repo, { 'CHANGES.md': 'pr\n', ...head }, 'pull request');
  return repo;
}

const OSV_GATE: GatePolicy = {
  role: 'vulnerabilities',
  product: 'osv-scanner',
  enabled: true,
  stage: 'ci',
  enforce: true,
  excludedByCli: false,
  options: {},
};

function run(repo: string, opts: { head?: OsvSide; base?: OsvSide; trustBase?: boolean; timeoutMs?: number } = {}) {
  const bin = tempDir();
  const record = path.join(tempDir(), 'record');
  stubOsv(bin, {
    record,
    counts: true,
    ...(opts.head ? { head: opts.head } : {}),
    ...(opts.base ? { base: opts.base } : {}),
  });
  const out = runGate(OSV_GATE, {
    repoRoot: repo,
    staged: false,
    pathValue: bin,
    tempRoot: tempDir(),
    ...(opts.trustBase === false ? {} : { trustBase: 'main' }),
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
  });
  return { out, head: osvRecord(record, 'head'), base: osvRecord(record, 'base') };
}

const A: [string, string, string] = ['lodash', '4.17.20', 'GHSA-A'];
/** Two packages, no advisory: populated, and clean. */
const POPULATED = 'PKG left-pad 1.0.0\nPKG chalk 5.0.0\n';

/** The audit's shape: the base lockfile has packages, the head empties it beside another populated one. */
function emptiedRepo(baseLock = lockBody([A]) + POPULATED): string {
  return prRepo(
    { 'package-lock.json': baseLock, 'web/package-lock.json': POPULATED },
    { 'package-lock.json': '{}\n' }
  );
}

describe('an emptied lockfile under a trust base', () => {
  it('is could-not-run, naming the file and the base count', () => {
    const { out, base } = run(emptiedRepo());

    expect(out.couldNotRun?.reason).toBe('lockfile-emptied');
    expect(out.couldNotRun?.detail).toContain(
      'package-lock.json read no packages at the head but 3 at the base (main)'
    );
    expect(out.couldNotRun?.detail).toContain('Regenerate the lockfile');
    expect(out.findings.map((finding) => finding.ruleId)).toEqual(['conductor/gate-failed']);
    // One base run, handed only the emptied file's base copy.
    expect(base.argv).toHaveLength(1);
    expect(base.lockfiles).toHaveLength(1);
    expect(base.lockfiles[0]!.bytes.toString('utf8')).toBe(lockBody([A]) + POPULATED);
  });

  it('is could-not-run, not blocked, when the head also blocks', () => {
    const repo = prRepo(
      { 'package-lock.json': POPULATED, 'web/package-lock.json': POPULATED },
      { 'package-lock.json': '{}\n', 'web/package-lock.json': lockBody([A]) }
    );
    const { out } = run(repo);

    expect(out.couldNotRun?.reason).toBe('lockfile-emptied');
    expect(out.couldNotRun?.detail).toContain('but 2 at the base');
  });

  it('changes nothing on a plain run: the lockfiles-empty line, no base run', () => {
    const { out, base } = run(emptiedRepo(), { trustBase: false });

    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(0);
    expect(out.diagnostics.map((d) => d.code)).toContain('conductor/lockfiles-empty');
    expect(base.argv).toHaveLength(0);
  });

  it('changes nothing when the head lockfile still has packages', () => {
    const repo = prRepo(
      { 'package-lock.json': POPULATED, 'web/package-lock.json': POPULATED },
      { 'package-lock.json': 'PKG left-pad 1.0.1\n' }
    );
    const { out, base } = run(repo);

    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(0);
    expect(base.argv).toHaveLength(0);
  });

  it('changes nothing when the base lockfile was already empty', () => {
    const { out, base } = run(emptiedRepo('{"lockfileVersion": 3}\n'));

    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(0);
    expect(out.diagnostics.map((d) => d.code)).toContain('conductor/lockfiles-empty');
    expect(base.argv).toHaveLength(1);
  });

  it('changes nothing when the lockfile is new in this pull request', () => {
    const repo = prRepo({ 'web/package-lock.json': POPULATED }, { 'package-lock.json': '{}\n' });
    const { out, base } = run(repo);

    expect(out.couldNotRun).toBeNull();
    expect(base.argv).toHaveLength(0);
  });

  it('is could-not-run when the base run fails', () => {
    const { out } = run(emptiedRepo(), { base: { stdout: 'boom', exit: 2 } });

    expect(out.couldNotRun?.reason).toBe('lockfile-emptied-unverified');
    expect(out.couldNotRun?.detail).toContain('osv-scanner exited 2 on the base copies');
  });

  it('is timed-out, step base-check, when the base run outlives the remaining limit', () => {
    const { out } = run(emptiedRepo(), { base: { sleep: 5 }, timeoutMs: 1500 });

    expect(out.couldNotRun?.reason).toBe('timed-out');
    expect(out.couldNotRun?.timedOut?.step).toBe('base-check');
  });

  it('leaves a head that could not run as it was, and spawns no base run', () => {
    const { out, base } = run(emptiedRepo(), { head: { stdout: '', exit: 127 } });

    expect(out.couldNotRun?.reason).toBe('gate-error');
    expect(out.exitCode).toBe(127);
    expect(base.argv).toHaveLength(0);
  });

  it('on exit 128 checks the base copy of every handed lockfile', () => {
    const repo = prRepo(
      { 'package-lock.json': lockBody([A]), 'web/package-lock.json': '{}\n' },
      { 'package-lock.json': '{}\n' }
    );
    const { out, base } = run(repo, { head: { exit: 128 } });

    expect(base.lockfiles.map((entry) => path.basename(path.dirname(entry.arg)) + '/' + path.basename(entry.arg)).sort()).toEqual(
      ['emptied/package-lock.json', 'web/package-lock.json'].sort()
    );
    expect(out.couldNotRun?.reason).toBe('lockfile-emptied');
    expect(out.couldNotRun?.detail).toContain('package-lock.json read no packages at the head but 1 at the base');
    expect(out.couldNotRun?.detail).not.toContain('web/package-lock.json');
  });
});

// Fix round after review: a base lockfile the head deleted or moved is
// removed from what the gate judges just as surely as one it emptied.
describe('a deleted or moved lockfile under a trust base', () => {
  it('is could-not-run after git mv plus an emptied copy (the replacement reads 0)', () => {
    const repo = prRepo({ 'package-lock.json': lockBody([A]) + POPULATED }, { 'app/package-lock.json': '{}\n' }, (r) => {
      mkdirSync(path.join(r, 'app'));
      git(r, 'mv', 'package-lock.json', 'app/package-lock.json');
    });
    const { out, base } = run(repo);

    expect(out.couldNotRun?.reason).toBe('lockfile-emptied');
    expect(out.couldNotRun?.detail).toContain(
      'package-lock.json is not in this pull request but had 3 package(s) at the base (main)'
    );
    expect(out.couldNotRun?.detail).toContain('add its replacement beside the same manifest');
    expect(base.argv).toHaveLength(1);
  });

  it('is could-not-run when the only lockfile is deleted', () => {
    const repo = prRepo({ 'package-lock.json': lockBody([A]) }, {}, (r) => git(r, 'rm', '--quiet', 'package-lock.json'));
    const { out, head } = run(repo);

    expect(head.argv).toHaveLength(0);
    expect(out.couldNotRun?.reason).toBe('lockfile-emptied');
    expect(out.couldNotRun?.detail).toContain('package-lock.json is not in this pull request but had 1 package(s)');
  });

  it('is could-not-run when the replacement sits in another directory', () => {
    const repo = prRepo(
      { 'package-lock.json': lockBody([A]) + POPULATED, 'web/package-lock.json': POPULATED },
      { 'web/pnpm-lock.yaml': POPULATED },
      (r) => git(r, 'rm', '--quiet', 'package-lock.json')
    );
    const { out } = run(repo);

    expect(out.couldNotRun?.reason).toBe('lockfile-emptied');
    expect(out.couldNotRun?.detail).toContain('package-lock.json is not in this pull request but had 3 package(s)');
  });

  it('changes nothing when a populated replacement sits in the same directory', () => {
    const repo = prRepo({ 'package-lock.json': lockBody([A]) + POPULATED }, { 'pnpm-lock.yaml': POPULATED }, (r) =>
      git(r, 'rm', '--quiet', 'package-lock.json')
    );
    const { out, base } = run(repo);

    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(0);
    expect(base.argv).toHaveLength(1);
  });

  // Second review: a replacement must be new in the pull request. A
  // lockfile the base already had carries its own manifest's packages, not
  // the deleted file's.
  it('is could-not-run when the only same-directory lockfile was already on the base (Cargo.lock)', () => {
    const repo = prRepo(
      { 'package-lock.json': lockBody([A]) + POPULATED, 'Cargo.lock': POPULATED },
      {},
      (r) => git(r, 'rm', '--quiet', 'package-lock.json')
    );
    const { out, head } = run(repo);

    expect(head.lockfiles.map((entry) => entry.arg)).toEqual(['Cargo.lock']);
    // couldNotRun is what the CLI turns into exit 2 (the audit case below).
    expect(out.couldNotRun?.reason).toBe('lockfile-emptied');
    expect(out.couldNotRun?.detail).toContain('package-lock.json is not in this pull request but had 3 package(s)');
  });
});

// Second review: the replacement rule, called directly, for the requirements
// cases a stub run cannot produce (the stub counts no packages in a file
// that passes the pin check).
describe('checkEmptiedAgainstBase, which head lockfile replaces a removed one', () => {
  /** A spawn that reports 3 packages for every base copy it is handed. */
  const threeEach = (argv: readonly string[]) => ({
    status: 0,
    stderr: argv
      .flatMap((arg, i) => (argv[i - 1] === '--lockfile' ? [`Scanned ${arg} file and found 3 packages`] : []))
      .join('\n'),
    failure: null,
  });

  function removedArgs(repo: string, headCounts: Map<string, number>): EmptiedCheckArgs {
    return {
      repoRoot: repo,
      ref: 'main',
      workDir: tempDir(),
      emptied: [],
      removed: ['package-lock.json'],
      headCounts,
      headArgv: null,
      baseArgv: (copies) => ['scan', 'source', ...copies.flatMap((copy) => ['--lockfile', copy])],
      budgetMs: 10_000,
      spawn: threeEach,
    };
  }

  it('does not count a pinned requirements file the base already had', () => {
    const repo = prRepo(
      { 'package-lock.json': lockBody([A]), 'requirements.txt': 'left-pad==1.0.0\n' },
      {},
      (r) => git(r, 'rm', '--quiet', 'package-lock.json')
    );
    const result = checkEmptiedAgainstBase(removedArgs(repo, new Map([['requirements.txt', 2]])));

    expect(result).toEqual({ kind: 'emptied', files: [{ path: 'package-lock.json', packages: 3, removed: true }] });
  });

  it('does not count a requirements file new in the pull request', () => {
    const repo = prRepo({ 'package-lock.json': lockBody([A]) }, { 'requirements.txt': 'left-pad==1.0.0\n' }, (r) =>
      git(r, 'rm', '--quiet', 'package-lock.json')
    );
    const result = checkEmptiedAgainstBase(removedArgs(repo, new Map([['requirements.txt', 2]])));

    expect(result).toEqual({ kind: 'emptied', files: [{ path: 'package-lock.json', packages: 3, removed: true }] });
  });

  it('does not count a lockfile the base already had in the same directory', () => {
    const repo = prRepo({ 'package-lock.json': lockBody([A]), 'Cargo.lock': POPULATED }, {}, (r) =>
      git(r, 'rm', '--quiet', 'package-lock.json')
    );
    const result = checkEmptiedAgainstBase(removedArgs(repo, new Map([['Cargo.lock', 2]])));

    expect(result).toEqual({ kind: 'emptied', files: [{ path: 'package-lock.json', packages: 3, removed: true }] });
  });

  it('counts a populated lockfile new in the pull request in the same directory', () => {
    const repo = prRepo({ 'package-lock.json': lockBody([A]) }, { 'pnpm-lock.yaml': POPULATED }, (r) =>
      git(r, 'rm', '--quiet', 'package-lock.json')
    );
    const result = checkEmptiedAgainstBase(removedArgs(repo, new Map([['pnpm-lock.yaml', 2]])));

    expect(result).toEqual({ kind: 'clear' });
  });
});

// Fix round after review: a policy that lowers osv-scanner's verbosity
// removes the count lines the check reads, and that fails closed.
describe('a head stderr with no package count line', () => {
  it('is could-not-run, unverified, under a trust base, naming the file', () => {
    const { out, base } = run(emptiedRepo(), { head: { noCounts: true } });

    expect(out.couldNotRun?.reason).toBe('lockfile-emptied-unverified');
    expect(out.couldNotRun?.detail).toContain('osv-scanner printed no package count for package-lock.json');
    expect(out.couldNotRun?.detail).toContain('verbosity option');
    expect(base.argv).toHaveLength(0);
  });

  it('changes nothing on a plain run', () => {
    const { out } = run(emptiedRepo(), { head: { noCounts: true }, trustBase: false });

    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(0);
  });
});

describe('checkEmptiedAgainstBase, the branches a stub run cannot reach', () => {
  function args(repo: string, overrides: Partial<EmptiedCheckArgs>): EmptiedCheckArgs {
    return {
      repoRoot: repo,
      ref: 'main',
      workDir: tempDir(),
      emptied: ['package-lock.json'],
      removed: [],
      headCounts: new Map(),
      headArgv: ['scan', 'source', '--lockfile', 'package-lock.json'],
      baseArgv: (copies) => ['scan', 'source', ...copies.flatMap((copy) => ['--lockfile', copy])],
      budgetMs: 10_000,
      spawn: () => ({ status: 0, stderr: '', failure: null }),
      ...overrides,
    };
  }

  it('is timed-out, with nothing spawned, when no budget is left', () => {
    let spawned = 0;
    const result = checkEmptiedAgainstBase(
      args(emptiedRepo(), {
        budgetMs: 0,
        spawn: () => {
          spawned += 1;
          return { status: 0, stderr: '', failure: null };
        },
      })
    );

    expect(result.kind).toBe('timed-out');
    expect(spawned).toBe(0);
  });

  it('is unverified when the base run printed no count line for a copy', () => {
    const result = checkEmptiedAgainstBase(args(emptiedRepo(), {}));

    expect(result.kind).toBe('unverified');
    expect(result.kind === 'unverified' ? result.detail : '').toContain(
      'printed no package count for the base copy of package-lock.json'
    );
  });
});

describe('the audit case end to end', () => {
  it('exits 2 with token could-not-run beside another lockfile and another gate', () => {
    const policy = [
      'version: 1',
      'gates:',
      '  secrets:',
      '    product: vault-guard',
      '  vulnerabilities:',
      '    product: osv-scanner',
      '    stage: commit',
      '',
    ].join('\n');
    const repo = prRepo(
      { '.guardrails.yaml': policy, 'package-lock.json': lockBody([A]) + POPULATED, 'web/package-lock.json': POPULATED },
      { 'package-lock.json': '{}\n' }
    );
    const bin = tempDir();
    stubOsv(bin, { record: path.join(tempDir(), 'record'), counts: true });
    stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, exit: 0, version: '1.12.0' });
    shimGit(bin);
    const text = path.join(tempDir(), 'report.txt');
    const sarif = path.join(tempDir(), 'out.sarif');
    const result = spawnSync(
      process.execPath,
      [CONDUCTOR_CLI, 'run', '--trust-base', 'main', '--format', 'sarif', '--output', sarif, '--text-report', text],
      { cwd: repo, encoding: 'utf8', env: childEnv(bin) }
    );

    expect(result.status).toBe(2);
    const report = readFileSync(text, 'utf8');
    expect(report.split('\n')[1]).toBe('verdict-token: could-not-run');
    expect(report).toContain('DID NOT RUN (lockfile-emptied)');
    expect(report).toContain('package-lock.json read no packages at the head but 3 at the base');
  });
});
