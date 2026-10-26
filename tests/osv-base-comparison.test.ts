// osv design item 1.3: the base run and the present-on-base labels. Tests
// 4a (base half), 7 to 14 and the head-edit half of 15, against the osv stub
// in real temporary repositories with real base and head commits. The stub
// answers from the bytes it is handed (tests/helpers/osv-stub.ts), so a base
// copy taken from the wrong place, or a rename mapped onto the wrong blob,
// changes what it reports.

import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Finding } from '../src/envelope.js';
import { runGate, type GateOutcome } from '../src/gate-runner.js';
import { compareWithBase, labelAgainstBase } from '../src/osv-baseline.js';
import type { GatePolicy } from '../src/policy.js';
import { childEnv, shimGit } from './helpers/child-env.js';
import { lockBody, osvRecord, stubOsv, type OsvSide } from './helpers/osv-stub.js';

const CONDUCTOR_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-osv-base-'));
  temps.push(dir);
  return dir;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
}

function put(repo: string, files: Record<string, string | Buffer>): void {
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    writeFileSync(path.join(repo, name), body);
  }
}

function commit(repo: string, files: Record<string, string | Buffer>, message = 'change'): void {
  put(repo, files);
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', message);
}

/** A repository whose main branch holds `base`, checked out on a pr branch holding `head` on top. */
function prRepo(base: Record<string, string | Buffer>, head: Record<string, string | Buffer>, remove: string[] = []): string {
  const repo = tempDir();
  git(repo, 'init', '--quiet', '-b', 'main');
  commit(repo, { 'README.md': '# fixture\n', ...base }, 'base');
  git(repo, 'checkout', '--quiet', '-b', 'pr');
  for (const file of remove) {
    git(repo, 'rm', '--quiet', '-r', file);
  }
  commit(repo, { 'CHANGES.md': 'pr\n', ...head }, 'pull request');
  return repo;
}

function osvGate(presentOnBase?: 'block' | 'report'): GatePolicy {
  return {
    role: 'vulnerabilities',
    product: 'osv-scanner',
    enabled: true,
    stage: 'ci',
    enforce: true,
    excludedByCli: false,
    options: {},
    ...(presentOnBase === undefined ? {} : { presentOnBase }),
  };
}

interface RunOpts {
  presentOnBase?: 'block' | 'report';
  head?: OsvSide;
  base?: OsvSide;
  tempRoot?: string;
  timeoutMs?: number;
  gate?: GatePolicy;
}

function compared(repo: string, opts: RunOpts = {}) {
  const bin = tempDir();
  const record = path.join(tempDir(), 'record');
  stubOsv(bin, { record, ...(opts.head ? { head: opts.head } : {}), ...(opts.base ? { base: opts.base } : {}) });
  const tempRoot = opts.tempRoot ?? tempDir();
  const out = runGate(opts.gate ?? osvGate(opts.presentOnBase), {
    repoRoot: repo,
    staged: false,
    pathValue: bin,
    tempRoot,
    trustBase: 'main',
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
  });
  return { out, head: osvRecord(record, 'head'), base: osvRecord(record, 'base'), tempRoot };
}

/** [ruleId, manifest, baseline label, blocking] for each finding, sorted. */
function labels(out: GateOutcome): Array<[string, string, unknown, boolean]> {
  return out.findings
    .map((f): [string, string, unknown, boolean] => [
      f.ruleId.replace('osv-scanner/', ''),
      f.subject.kind === 'package' ? f.subject.manifest : '',
      f.details.baseline,
      f.blocking,
    ])
    .sort((a, b) => `${a[1]} ${a[0]}`.localeCompare(`${b[1]} ${b[0]}`));
}

const A: [string, string, string] = ['lodash', '4.17.20', 'GHSA-A'];
const B: [string, string, string] = ['minimist', '1.2.0', 'GHSA-B'];

describe('the pair (test 7)', () => {
  const repo = () => prRepo({ 'package-lock.json': lockBody([A]) }, { 'package-lock.json': lockBody([A, B]) });

  it('labels the base advisory present-on-base and the added one introduced, both blocking with no key', () => {
    const { out, base } = compared(repo());
    expect(base.argv).toHaveLength(1);
    expect(out.exitCode).toBe(1);
    expect(labels(out)).toEqual([
      ['GHSA-A', 'package-lock.json', 'present-on-base', true],
      ['GHSA-B', 'package-lock.json', 'introduced', true],
    ]);
    expect(out.baseComparison).toEqual({
      ref: 'main',
      policy: 'block',
      introduced: 1,
      presentOnBase: 1,
      unavailable: [],
      otherVerdicts: [],
    });
  });

  it('under report, leaves the introduced advisory blocking and the present-on-base one not', () => {
    const { out } = compared(repo(), { presentOnBase: 'report' });
    expect(labels(out)).toEqual([
      ['GHSA-A', 'package-lock.json', 'present-on-base', false],
      ['GHSA-B', 'package-lock.json', 'introduced', true],
    ]);
    expect(out.baseComparison?.policy).toBe('report');
  });

  it('runs no comparison on a local run, and none on a clean head', () => {
    const local = runGate(osvGate('report'), {
      repoRoot: repo(),
      staged: false,
      pathValue: (() => {
        const bin = tempDir();
        stubOsv(bin, { record: path.join(tempDir(), 'r') });
        return bin;
      })(),
      tempRoot: tempDir(),
    });
    expect(local.baseComparison).toBeUndefined();
    expect(local.findings.every((f) => f.blocking && f.details.baseline === undefined)).toBe(true);

    // A clean head that still has a package: an EMPTIED head lockfile is the
    // emptied-lockfile check's case (tests/osv-emptied-base.test.ts).
    const clean = compared(
      prRepo({ 'package-lock.json': lockBody([A]) }, { 'package-lock.json': `${lockBody([])}PKG left-pad 1.0.0\n` })
    );
    expect(clean.out.exitCode).toBe(0);
    expect(clean.base.argv).toEqual([]);
    expect(clean.out.baseComparison).toBeUndefined();
  });
});

describe('the rename attack (test 8)', () => {
  // Since the emptied-lockfile check (audit 2026-10-18 N1, fix round), the
  // lockfile that left is itself a removal the base had packages in, with no
  // replacement in legacy/, so the gate is could-not-run before any label is
  // given. The labels are pinned again below with a replacement left in
  // legacy/, which is what clears the removal.
  it('is could-not-run when the lockfile that left had packages on the base and nothing replaced it', () => {
    const repo = prRepo(
      {
        'legacy/package-lock.json': lockBody([A], 'legacy'),
        'api/package-lock.json': lockBody([], 'api'),
        'tools/package-lock.json': lockBody([A], 'tools'),
      },
      {
        'api/package-lock.json': lockBody([A], 'legacy, lightly edited'),
        'tools/package-lock.json': lockBody([A], 'tools, touched'),
      },
      ['legacy']
    );
    const { out } = compared(repo, { presentOnBase: 'report' });
    expect(out.couldNotRun?.reason).toBe('lockfile-emptied');
    expect(out.couldNotRun?.detail).toContain('legacy/package-lock.json is not in this pull request but had 1 package(s)');
  });

  it('labels a vulnerable lockfile moved onto a clean one introduced, and notes the one that left', () => {
    // tools/ carries A on both sides and is touched, so the base run reports
    // A there too: a key without the full path would match api's A to it.
    const legacy = lockBody([A], 'legacy');
    const repo = prRepo(
      {
        'legacy/package-lock.json': legacy,
        'api/package-lock.json': lockBody([], 'api'),
        'tools/package-lock.json': lockBody([A], 'tools'),
      },
      {
        'api/package-lock.json': lockBody([A], 'legacy, lightly edited'),
        'tools/package-lock.json': lockBody([A], 'tools, touched'),
        // A populated replacement beside the same manifest clears the removal.
        'legacy/pnpm-lock.yaml': 'PKG left-pad 1.0.0\n',
      },
      ['legacy']
    );
    const { out } = compared(repo, { presentOnBase: 'report' });
    expect(labels(out)).toEqual([
      ['GHSA-A', 'api/package-lock.json', 'introduced', true],
      ['GHSA-A', 'tools/package-lock.json', 'present-on-base', false],
    ]);
    expect(out.exitCode).toBe(1);
    expect(out.diagnostics).toContainEqual({
      code: 'conductor/lockfile-no-longer-scanned',
      message:
        'legacy/package-lock.json is tracked on the base and not in this pull request, so it is no longer ' +
        'scanned (by either run). Its removal is visible in the diff.',
    });
  });
});

describe('the comparison key (tests 9 and 10)', () => {
  it('labels the same package and version added to a second lockfile introduced there (test 9)', () => {
    const repo = prRepo(
      { 'web/package-lock.json': lockBody([A]) },
      { 'web/package-lock.json': lockBody([A], 'touched'), 'api/package-lock.json': lockBody([A]) }
    );
    const { out } = compared(repo, { presentOnBase: 'report' });
    expect(labels(out)).toEqual([
      ['GHSA-A', 'api/package-lock.json', 'introduced', true],
      ['GHSA-A', 'web/package-lock.json', 'present-on-base', false],
    ]);
  });

  it('labels a version change inside one advisory introduced (test 10)', () => {
    const repo = prRepo(
      { 'package-lock.json': lockBody([['lodash', '4.17.15', 'GHSA-A']]) },
      { 'package-lock.json': lockBody([['lodash', '4.17.19', 'GHSA-A']]) }
    );
    const { out } = compared(repo, { presentOnBase: 'report' });
    expect(labels(out)).toEqual([['GHSA-A', 'package-lock.json', 'introduced', true]]);
  });
});

describe('a base that cannot be compared (test 11)', () => {
  function expectAllIntroduced(out: GateOutcome, reason: RegExp): void {
    expect(out.couldNotRun).toBeNull();
    expect(out.exitCode).toBe(1);
    expect(labels(out)).toEqual([['GHSA-A', 'package-lock.json', 'introduced', true]]);
    expect(out.baseComparison?.unavailable.map((u) => u.path)).toEqual(['package-lock.json']);
    const note = out.diagnostics.find((d) => d.code === 'conductor/base-comparison-unavailable');
    expect(note?.message).toMatch(/^base comparison unavailable for package-lock\.json: /);
    expect(note?.message).toMatch(reason);
    expect(note?.message).toMatch(/every finding there counts as introduced\.$/);
  }

  it('when the path is a symbolic link on the base', () => {
    const repo = tempDir();
    git(repo, 'init', '--quiet', '-b', 'main');
    put(repo, { 'real.json': lockBody([A]) });
    symlinkSync('real.json', path.join(repo, 'package-lock.json'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '--quiet', '-m', 'base');
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    git(repo, 'rm', '--quiet', 'package-lock.json');
    commit(repo, { 'package-lock.json': lockBody([A], 'now a file') });
    expectAllIntroduced(compared(repo, { presentOnBase: 'report' }).out, /not a regular file/);
  });

  const changed = () => prRepo({ 'package-lock.json': lockBody([A]) }, { 'package-lock.json': lockBody([A], 'touched') });

  it('when the base run exits 127', () => {
    expectAllIntroduced(
      compared(changed(), { presentOnBase: 'report', base: { stdout: '', exit: 127 } }).out,
      /exited 127 on the base copies/
    );
  });

  it('when the base run times out', () => {
    expectAllIntroduced(
      compared(changed(), { presentOnBase: 'report', base: { sleep: 5 }, timeoutMs: 1500 }).out,
      /did not finish on the base copies/
    );
  });

  it('when the base run prints something that is not JSON', () => {
    expectAllIntroduced(
      compared(changed(), { presentOnBase: 'report', base: { stdout: 'not json', exit: 1 } }).out,
      /no valid JSON/
    );
  });
});

describe('the trust boundary (test 12)', () => {
  it('copies the base blob byte for byte, never the HEAD commit, the index or the working tree', () => {
    const baseBlob = Buffer.concat([Buffer.from(lockBody([A], 'base')), Buffer.from([0xff, 0xfe, 0x0a])]);
    const repo = prRepo({ 'package-lock.json': baseBlob }, { 'package-lock.json': lockBody([A], 'head commit') });
    put(repo, { 'package-lock.json': lockBody([A], 'index') });
    git(repo, 'add', 'package-lock.json');
    put(repo, { 'package-lock.json': lockBody([A], 'working tree') });

    const { out, base } = compared(repo, { presentOnBase: 'report' });
    expect(base.lockfiles).toHaveLength(1);
    expect(base.lockfiles[0]!.bytes.equals(baseBlob)).toBe(true);
    expect(labels(out)).toEqual([['GHSA-A', 'package-lock.json', 'present-on-base', false]]);
  });
});

describe('the trust boundary for a requirements file (test 12, requirements variant)', () => {
  it('copies the base requirements blob, so a pin the pull request adds is introduced, not present-on-base', () => {
    const baseBlob = '# base\n#OSV jinja2 2.4.1 PyPI PYSEC-1\njinja2==2.4.1\n';
    const withAdded = (where: string) =>
      `# ${where}\n#OSV jinja2 2.4.1 PyPI PYSEC-1\njinja2==2.4.1\n#OSV urllib3 1.24.1 PyPI PYSEC-2\nurllib3==1.24.1\n`;
    const repo = prRepo({ 'requirements.txt': baseBlob }, { 'requirements.txt': withAdded('head commit') });
    put(repo, { 'requirements.txt': withAdded('index') });
    git(repo, 'add', 'requirements.txt');
    put(repo, { 'requirements.txt': withAdded('working tree') });

    const { out, base } = compared(repo, { presentOnBase: 'report' });
    expect(base.lockfiles).toHaveLength(1);
    expect(base.lockfiles[0]!.bytes.toString('utf8')).toBe(baseBlob);
    expect(labels(out)).toEqual([
      ['PYSEC-1', 'requirements.txt', 'present-on-base', false],
      ['PYSEC-2', 'requirements.txt', 'introduced', true],
    ]);
  });
});

describe('the work directory (test 13)', () => {
  function porcelain(repo: string): string {
    return git(repo, 'status', '--porcelain', '--ignored', '--untracked-files=all');
  }

  it('leaves nothing under the repository and nothing behind in the temporary root', () => {
    const repo = prRepo({ 'package-lock.json': lockBody([A]) }, { 'package-lock.json': lockBody([A, B]) });
    const before = porcelain(repo);
    const { out, base, tempRoot } = compared(repo, { presentOnBase: 'report' });
    expect(base.argv).toHaveLength(1);
    expect(base.cwd[0]).toMatch(/\/osv-base$/);
    expect(base.cwd[0]!.startsWith(`${realpathSync(tempRoot)}/`)).toBe(true);
    expect(out.baseComparison?.presentOnBase).toBe(1);
    expect(porcelain(repo)).toBe(before);
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it('removes the work directory after a comparison that threw on the way', () => {
    // The head stub turns the base copy directory into a FILE before the
    // comparison runs, so placing the copy throws inside the comparison.
    const repo = prRepo({ 'package-lock.json': lockBody([A]) }, { 'package-lock.json': lockBody([A], 'touched') });
    const bin = tempDir();
    const record = path.join(tempDir(), 'record');
    stubOsv(bin, { record });
    const real = path.join(bin, 'osv-scanner');
    const wrapper = path.join(bin, 'osv-wrapper');
    writeFileSync(
      wrapper,
      [
        '#!/bin/sh',
        'prev=""',
        'for a in "$@"; do',
        '  if [ "$prev" = "--config" ]; then : > "$(dirname "$a")/osv-base"; fi',
        '  prev="$a"',
        'done',
        `exec ${JSON.stringify(real)} "$@"`,
        '',
      ].join('\n'),
      { mode: 0o755 }
    );
    const tempRoot = tempDir();
    const out = runGate(
      { ...osvGate('report'), command: wrapper, args: ['scan', 'source'] },
      { repoRoot: repo, staged: false, pathValue: bin, tempRoot, trustBase: 'main' }
    );
    expect(out.couldNotRun).toBeNull();
    expect(labels(out)).toEqual([['GHSA-A', 'package-lock.json', 'introduced', true]]);
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it('makes the comparison unavailable when the temporary root is inside the repository', () => {
    const repo = prRepo(
      { 'package-lock.json': lockBody([A]), '.gitignore': '.tmp/\n' },
      { 'package-lock.json': lockBody([A], 'touched') }
    );
    const inside = path.join(repo, '.tmp');
    mkdirSync(inside);
    const { out, base } = compared(repo, { presentOnBase: 'report', tempRoot: inside });
    expect(base.argv).toEqual([]);
    expect(labels(out)).toEqual([['GHSA-A', 'package-lock.json', 'introduced', true]]);
    expect(out.diagnostics.find((d) => d.code === 'conductor/base-comparison-unavailable')?.message).toMatch(
      /temporary directory is inside the repository/
    );
    expect(readdirSync(inside)).toEqual([]);
  });
});

describe('the unchanged shortcut (test 14)', () => {
  it('spawns no base run for an untouched lockfile and labels its findings present-on-base', () => {
    const repo = prRepo({ 'package-lock.json': lockBody([A]) }, { 'src/app.js': 'x\n' });
    const { out, base } = compared(repo, { presentOnBase: 'report' });
    expect(base.argv).toEqual([]);
    expect(labels(out)).toEqual([['GHSA-A', 'package-lock.json', 'present-on-base', false]]);
  });

  it('does run the base for an unchanged requirements file whose include changed', () => {
    const top = '-r base.txt\n#OSV jinja2 2.4.1 PyPI PYSEC-1\njinja2==2.4.1\n';
    const repo = prRepo(
      { 'requirements.txt': top, 'base.txt': 'six==1.16.0\n' },
      { 'base.txt': 'six==1.16.0\nidna==3.7\n' }
    );
    const { out, base } = compared(repo, { presentOnBase: 'report' });
    expect(base.argv).toHaveLength(1);
    expect(base.argv[0]).toContain('/osv-base/requirements.txt');
    expect(labels(out)).toEqual([['PYSEC-1', 'requirements.txt', 'present-on-base', false]]);
  });

  it('ignores a clean filter the head adds: the ids are compared with filters off', () => {
    const repo = prRepo(
      { 'package-lock.json': lockBody([A]) },
      { '.gitattributes': 'package-lock.json filter=mangle\n' }
    );
    git(repo, 'config', 'filter.mangle.clean', 'tr a-z A-Z');
    const { out, base } = compared(repo, { presentOnBase: 'report' });
    expect(base.argv).toEqual([]);
    expect(labels(out)).toEqual([['GHSA-A', 'package-lock.json', 'present-on-base', false]]);
  });
});

describe('resolution mode on both runs (test 4a, base half)', () => {
  it('hands --no-resolve to the head and the base run alike, so the labels compare like with like', () => {
    const repo = prRepo(
      { 'requirements.txt': '#OSV jinja2 2.4.1 PyPI PYSEC-1\njinja2==2.4.1\n', 'package-lock.json': lockBody([A]) },
      {
        'requirements.txt': '#OSV jinja2 2.4.1 PyPI PYSEC-1\njinja2==2.4.1\nsix==1.16.0\n',
        'package-lock.json': lockBody([A], 'touched'),
      }
    );
    const { out, head, base } = compared(repo, { presentOnBase: 'report' });
    expect(head.argv[0]).toContain(' --no-resolve');
    expect(base.argv).toHaveLength(1);
    expect(base.argv[0]).toContain(' --no-resolve');
    expect(labels(out)).toEqual([
      ['GHSA-A', 'package-lock.json', 'present-on-base', false],
      ['PYSEC-1', 'requirements.txt', 'present-on-base', false],
    ]);
  });

  it('refuses to compare when the base command line would differ, naming the flag, and never spawns it', () => {
    const finding: Finding = {
      schemaVersion: 1,
      product: 'osv-scanner',
      productVersion: '2.4.0',
      ruleId: 'osv-scanner/GHSA-A',
      severity: 'high',
      severityIsDerived: true,
      blocking: true,
      message: 'x',
      subject: { kind: 'package', name: 'lodash', manifest: 'package-lock.json' },
      fingerprint: null,
      details: { version: '4.17.20', ecosystem: 'npm' },
    };
    const repo = prRepo({ 'package-lock.json': lockBody([A]) }, { 'package-lock.json': lockBody([A], 'touched') });
    let spawned = 0;
    const result = compareWithBase({
      repoRoot: repo,
      ref: 'main',
      workDir: tempDir(),
      policy: 'report',
      version: '2.4.0',
      headFindings: [finding],
      headLockfiles: ['package-lock.json'],
      closures: new Map(),
      otherVerdicts: [],
      headArgv: ['scan', 'source', '--format', 'json', '--lockfile', 'package-lock.json', '--no-resolve'],
      baseArgv: (copies) => ['scan', 'source', '--format', 'json', ...copies.flatMap((c) => ['--lockfile', c])],
      spawn: () => {
        spawned += 1;
        return { status: 1, stdout: '{"results":[]}', error: undefined };
      },
      rootSpellings: (dir) => [dir],
    });
    expect(spawned).toBe(0);
    expect(result.findings[0]!.details.baseline).toBe('introduced');
    expect(result.diagnostics[0]!.message).toMatch(/would differ from the head run's at --no-resolve/);
  });
});

describe('labelAgainstBase, the pure half', () => {
  const f = (manifest: string, version = '1.0.0', id = 'GHSA-A', ecosystem = 'npm'): Finding => ({
    schemaVersion: 1,
    product: 'osv-scanner',
    productVersion: null,
    ruleId: `osv-scanner/${id}`,
    severity: 'high',
    severityIsDerived: true,
    blocking: true,
    message: 'x',
    subject: { kind: 'package', name: 'pkg', manifest },
    fingerprint: null,
    details: { version, ecosystem },
  });

  it('keys on the advisory, ecosystem, package, version and path, and lets unavailable win over unchanged', () => {
    const out = labelAgainstBase(
      [f('a'), f('b'), f('c', '2.0.0'), f('d', '1.0.0', 'GHSA-A', 'PyPI'), f('e'), f('g')],
      [f('a'), f('c'), f('d'), f('g')],
      new Set(['g']),
      new Set(['e', 'g'])
    );
    expect(out.map((x) => x.details.baseline)).toEqual([
      'present-on-base',
      'introduced',
      'introduced',
      'introduced',
      'present-on-base',
      'introduced',
    ]);
  });
});

describe('the key comes from the base policy (test 15, head-edit half)', () => {
  it('ignores present-on-base: report added by the pull request itself, and reports the change as a proposal', () => {
    const basePolicy = 'version: 1\ngates:\n  vulnerabilities:\n    product: osv-scanner\n';
    const repo = prRepo(
      { '.guardrails.yaml': basePolicy, 'package-lock.json': lockBody([A]) },
      { '.guardrails.yaml': `${basePolicy}    present-on-base: report\n` }
    );
    const bin = tempDir();
    stubOsv(bin, { record: path.join(tempDir(), 'record') });
    shimGit(bin);
    const result = spawnSync(process.execPath, [CONDUCTOR_CLI, 'run', '--trust-base', 'main', '--verbose'], {
      cwd: repo,
      encoding: 'utf8',
      env: childEnv(bin),
    });
    expect(result.stdout).toMatch(/policy: gates\.vulnerabilities\.present-on-base "block" -> "report"/);
    expect(result.stdout).toMatch(/BLOCKING .*osv-scanner\/GHSA-A/);
    expect(result.status).toBe(1);
    expect(existsSync(path.join(repo, 'osv-base'))).toBe(false);
  });
});
