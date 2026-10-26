// What timeout actually reaches spawnSync, per product.
//
// Its own file because it replaces node:child_process for the module under
// test, which in ESM has to happen before that module is imported. The
// replacement calls straight through to the real spawnSync and only records
// the options, so the stub gates still run as real subprocesses.

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const real = await import('node:child_process');
const calls: Array<{ command: string; args: readonly string[]; timeout: number | undefined; cwd: string | undefined }> = [];

jest.unstable_mockModule('node:child_process', () => ({
  ...real,
  spawnSync: (command: string, args: readonly string[], options: { timeout?: number; cwd?: string }) => {
    calls.push({ command, args, timeout: options?.timeout, cwd: options?.cwd });
    return real.spawnSync(command, args as string[], options as Parameters<typeof real.spawnSync>[2]);
  },
}));

const { runGate } = await import('../src/gate-runner.js');
const { runAll } = await import('../src/run.js');
const { parsePolicy, POLICY_FILE_NAME } = await import('../src/policy.js');
const { renderText } = await import('../src/output-text.js');
const { renderSarif } = await import('../src/output-sarif.js');
const { buildProgram } = await import('../src/cli.js');
const { CLEAN_GITLEAKS, CLEAN_OSV_SCANNER, CLEAN_VAULT_GUARD, stubGate, stubIntentGuard } = await import(
  './helpers/stub-gate.js'
);
const { lockBody, stubOsv } = await import('./helpers/osv-stub.js');

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string): string => readFileSync(path.join(FIXTURES, name), 'utf8');

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

function git(repo: string, ...args: string[]): void {
  real.execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', ...args], { cwd: repo });
}

/** A repository tracking one lockfile, so osv-scanner is actually spawned. */
function lockfileRepo(): string {
  const repo = tempDir();
  git(repo, 'init', '--quiet', '-b', 'main');
  writeFileSync(path.join(repo, 'package-lock.json'), '{}\n');
  git(repo, 'add', 'package-lock.json');
  git(repo, 'commit', '--quiet', '-m', 'lockfile');
  return repo;
}

function gitRepo(): string {
  const repo = tempDir();
  git(repo, 'init', '--quiet', '-b', 'main');
  writeFileSync(path.join(repo, 'README.md'), '# x\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'one');
  return repo;
}

function scanCall():{ timeout: number | undefined } | undefined {
  return calls.find((c) => c.args.includes('--format') || c.args.includes('-f'));
}

/** Every spawn of the stub at `bin/name`, version probe included. */
function spawnsOf(bin: string, name: string) {
  return calls.filter((c) => c.command === path.join(bin, name));
}

const GITLEAKS_GATE = {
  role: 'secrets-history' as const,
  product: 'gitleaks' as const,
  enabled: true,
  stage: 'ci' as const,
  enforce: true,
  excludedByCli: false,
  options: {},
};

function cleanGitleaks(bin: string, extra: { exit?: number; stderr?: string } = {}): void {
  stubGate(bin, 'gitleaks', {
    versionSubcommand: true,
    versionLine: '8.30.1',
    reportFlag: '--report-path',
    reportBody: CLEAN_GITLEAKS,
    exit: extra.exit ?? 0,
    ...(extra.stderr === undefined ? {} : { stderr: extra.stderr }),
  });
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

  it('gives gitleaks ten minutes when the policy sets no timeout-seconds', () => {
    const bin = tempDir();
    cleanGitleaks(bin);
    const out = runGate(GITLEAKS_GATE, { repoRoot: gitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.couldNotRun).toBeNull();
    expect(spawnsOf(bin, 'gitleaks').map((c) => c.timeout)).toEqual([600_000, 600_000]);
    expect(out.timeLimit).toEqual({ ms: 600_000, source: 'default' });
  });
});

describe('timeout-seconds from the policy, and the test hook above it', () => {
  it('reaches the probe and the scan, and the test hook still wins', () => {
    const policy = parsePolicy(
      'version: 1\ngates:\n  secrets:\n    product: vault-guard\n    timeout-seconds: 45\n',
      POLICY_FILE_NAME
    );
    const gate = policy.gates.secrets!;
    const bin = tempDir();
    stubGate(bin, 'vault-guard', { exit: 0, stdout: CLEAN_VAULT_GUARD });

    runGate(gate, { repoRoot: tempDir(), staged: false, pathValue: bin });
    expect(spawnsOf(bin, 'vault-guard').map((c) => c.timeout)).toEqual([45_000, 45_000]);

    calls.length = 0;
    runGate(gate, { repoRoot: tempDir(), staged: false, pathValue: bin, timeoutMs: 5_000 });
    expect(spawnsOf(bin, 'vault-guard').map((c) => c.timeout)).toEqual([5_000, 5_000]);
  });

  it('shows a policy limit on the header of a gate that ran with --verbose, and nothing for a default', () => {
    const bin = tempDir();
    stubGate(bin, 'vault-guard', { exit: 0, stdout: CLEAN_VAULT_GUARD });
    // A missing dep-guard makes the run could-not-run, so the full report is
    // printed with or without --verbose and the vault-guard header is on it.
    const run = (extra: string, verbose: boolean) =>
      renderText(
        runAll(
          parsePolicy(
            `version: 1\ngates:\n  dependencies:\n    product: dep-guard\n  secrets:\n    product: vault-guard\n${extra}`,
            POLICY_FILE_NAME
          ),
          { repoRoot: tempDir(), staged: false, pathValue: bin }
        ),
        { verbose }
      );
    expect(run('    timeout-seconds: 1800\n', true)).toMatch(/^secrets {2}vault-guard .* limit 1800s \(policy\)/m);
    expect(run('', true)).not.toContain('limit ');
    const quiet = run('    timeout-seconds: 1800\n', false);
    expect(quiet).toMatch(/^secrets {2}vault-guard /m);
    expect(quiet).not.toContain('limit 1800s');
  });
});

describe('gitleaks own options.timeout is passed through, beside conductor own limit', () => {
  const POLICY = 'version: 1\ngates:\n  secrets-history:\n    product: gitleaks\n    options:\n      timeout: 900\n';

  it('passes --timeout 900 to gitleaks, keeps conductor at 600 s, and carries the note', () => {
    const gate = parsePolicy(POLICY, POLICY_FILE_NAME).gates['secrets-history']!;
    const bin = tempDir();
    cleanGitleaks(bin);
    const out = runGate(gate, { repoRoot: gitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });

    const scan = spawnsOf(bin, 'gitleaks').find((c) => c.args.includes('--report-path'));
    const at = scan?.args.indexOf('--timeout') ?? -1;
    expect(scan?.args.slice(at, at + 2)).toEqual(['--timeout', '900']);
    expect(scan?.timeout).toBe(600_000);
    expect(out.gateOwnOption).toBe(
      "options.timeout is gitleaks' own --timeout (900 s); conductor stops the gate at 600 s (the default for this gate)."
    );
    expect(out.run.diagnostics.map((d) => d.code)).not.toContain('conductor/option-is-gate-own');
  });

  it('carries no note when the key is not set', () => {
    const bin = tempDir();
    cleanGitleaks(bin);
    const out = runGate(GITLEAKS_GATE, { repoRoot: gitRepo(), staged: false, pathValue: bin, tempRoot: tempDir() });
    expect(out.gateOwnOption).toBeUndefined();
  });

  it('keeps the note on the gate-error that gitleaks own deadline produces, in text and in SARIF', () => {
    const captures = JSON.parse(fixture('stated-reason-captures.json')) as Record<string, { stderr: string }>;
    const bin = tempDir();
    cleanGitleaks(bin, { exit: 1, stderr: captures['gitleaks-8.30.1-own-timeout']!.stderr });
    const result = runAll(parsePolicy(POLICY, POLICY_FILE_NAME), {
      repoRoot: gitRepo(),
      staged: false,
      pathValue: bin,
      tempRoot: tempDir(),
    });
    const out = result.gates[0]!;

    expect(result.exitCode).toBe(2);
    expect(out.couldNotRun?.reason).toBe('gate-error');
    expect(out.couldNotRun?.gateSaid).toBe("10:19AM ERR failed to scan Git repository error='context deadline exceeded'");
    expect(out.gateOwnOption).toContain("options.timeout is gitleaks' own --timeout (900 s)");
    expect(renderText(result)).toContain(
      "  note conductor/option-is-gate-own: options.timeout is gitleaks' own --timeout (900 s)"
    );
    const sarif = JSON.parse(renderSarif(result, '0.0.0')) as {
      runs: Array<{ invocations?: Array<{ toolExecutionNotifications?: Array<{ descriptor: { id: string } }> }> }>;
    };
    const ids = sarif.runs.flatMap((r) =>
      (r.invocations?.[0]?.toolExecutionNotifications ?? []).map((n) => n.descriptor.id)
    );
    expect(ids).toContain('conductor/option-is-gate-own');
  });
});

describe('on a pull request the limit comes from the base policy, through the CLI path', () => {
  async function prRun(basePolicy: string, headPolicy: string) {
    const repo = tempDir();
    git(repo, 'init', '--quiet', '-b', 'main');
    writeFileSync(path.join(repo, '.guardrails.yaml'), basePolicy);
    writeFileSync(path.join(repo, 'README.md'), '# x\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '--quiet', '-m', 'base');
    git(repo, 'branch', 'base');
    writeFileSync(path.join(repo, '.guardrails.yaml'), headPolicy);
    writeFileSync(path.join(repo, 'app.js'), 'const x = 1;\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '--quiet', '-m', 'the pull request');

    const bin = tempDir();
    cleanGitleaks(bin);
    const saved = {
      PATH: process.env.PATH,
      GITHUB_BASE_REF: process.env.GITHUB_BASE_REF,
      GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
      exitCode: process.exitCode,
    };
    const stdout: string[] = [];
    const out = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      process.env.PATH = `${bin}${path.delimiter}${saved.PATH ?? ''}`;
      delete process.env.GITHUB_BASE_REF;
      delete process.env.GITHUB_ACTIONS;
      await buildProgram().parseAsync(['node', 'conductor', 'run', '--trust-base', 'base', '--project', repo, '--verbose']);
      return { stdout: stdout.join(''), exitCode: process.exitCode, bin };
    } finally {
      out.mockRestore();
      err.mockRestore();
      process.env.PATH = saved.PATH;
      for (const key of ['GITHUB_BASE_REF', 'GITHUB_ACTIONS'] as const) {
        if (saved[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = saved[key];
        }
      }
      process.exitCode = saved.exitCode;
    }
  }

  const policy = (limit: string) =>
    `version: 1\ngates:\n  secrets-history:\n    product: gitleaks\n${limit === '' ? '' : `    timeout-seconds: ${limit}\n`}`;

  it('a head policy raising the limit to 21600 leaves the scan at the base 10 s, as a proposal', async () => {
    const { stdout, exitCode, bin } = await prRun(policy('10'), policy('21600'));
    const scans = spawnsOf(bin, 'gitleaks').filter((c) => c.args.includes('--report-path'));
    expect(scans).toHaveLength(1);
    expect(scans[0]?.timeout).toBe(10_000);
    expect(calls.some((c) => c.timeout === 21_600_000)).toBe(false);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/policy: gates\.secrets-history\.timeout-seconds 10 -> 21600/);
  });

  it('a key only on the head leaves the scan at the gitleaks default', async () => {
    const { stdout, bin } = await prRun(policy(''), policy('21600'));
    const scans = spawnsOf(bin, 'gitleaks').filter((c) => c.args.includes('--report-path'));
    expect(scans.map((c) => c.timeout)).toEqual([600_000]);
    expect(stdout).toMatch(/policy: gates\.secrets-history\.timeout-seconds \(absent\) -> 21600/);
  });
});

describe('the intent gate preparation spawns get the full limit', () => {
  function intentRepo(): string {
    const root = tempDir();
    git(root, 'init', '--quiet', '-b', 'main');
    for (const [rel, body] of [
      ['README.md', '# scratch\n'],
      ['docs/superpowers/specs/2026-09-03-widget-cache-design.md', fixture('superpowers/specs/2026-09-03-widget-cache-design.md')],
      ['docs/superpowers/plans/2026-09-03-widget-cache.md', fixture('superpowers/plans/2026-09-03-widget-cache.md')],
    ] as const) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), body);
    }
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '-m', 'base');
    git(root, 'checkout', '--quiet', '-b', 'feat/widget-cache');
    mkdirSync(path.join(root, 'src/widget'), { recursive: true });
    writeFileSync(path.join(root, 'src/widget/cache.ts'), 'export const x = 1;\n');
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '-m', 'branch work');
    return root;
  }

  it('sends 30 s to the probe, import-spec, freeze and check alike', () => {
    const bin = tempDir();
    stubIntentGuard(bin, {
      importSpec: { stdout: fixture('intent-guard-1.2.1-import-spec-superpowers-dry-run.json') },
      freeze: { stdout: fixture('intent-guard-1.2.1-freeze.json') },
      check: { stdout: fixture('intent-guard-1.2.1-check-passing.json') },
    });
    const policy = parsePolicy(
      'version: 1\ngates:\n  intent:\n    product: intent-guard\n    timeout-seconds: 30\n',
      POLICY_FILE_NAME
    );
    const result = runAll(policy, { repoRoot: intentRepo(), staged: false, pathValue: bin, env: {}, base: 'main' });

    expect(result.exitCode).toBe(0);
    const spawns = spawnsOf(bin, 'intent-guard');
    const first = (args: readonly string[]) => args[0];
    expect(spawns.map((c) => first(c.args))).toEqual(expect.arrayContaining(['import-spec', 'freeze', '--version', 'check']));
    expect(new Set(spawns.map((c) => c.timeout))).toEqual(new Set([30_000]));
  });
});

describe('osv-scanner base run on a compared pull request', () => {
  it('gets the policy limit too, not the profile constant', () => {
    const repo = tempDir();
    git(repo, 'init', '--quiet', '-b', 'main');
    writeFileSync(path.join(repo, 'package-lock.json'), lockBody([['lodash', '4.17.20', 'GHSA-A']]));
    git(repo, 'add', '-A');
    git(repo, 'commit', '--quiet', '-m', 'base');
    git(repo, 'checkout', '--quiet', '-b', 'pr');
    writeFileSync(
      path.join(repo, 'package-lock.json'),
      lockBody([
        ['lodash', '4.17.20', 'GHSA-A'],
        ['minimist', '1.2.0', 'GHSA-B'],
      ])
    );
    git(repo, 'add', '-A');
    git(repo, 'commit', '--quiet', '-m', 'pull request');
    const bin = tempDir();
    stubOsv(bin, { record: path.join(tempDir(), 'record') });

    const out = runGate(
      {
        role: 'vulnerabilities',
        product: 'osv-scanner',
        enabled: true,
        stage: 'ci',
        enforce: true,
        excludedByCli: false,
        options: {},
        presentOnBase: 'block',
        timeoutSeconds: 45,
      },
      { repoRoot: repo, staged: false, pathValue: bin, tempRoot: tempDir(), trustBase: 'main' }
    );

    expect(out.baseComparison).toBeDefined();
    const scans = spawnsOf(bin, 'osv-scanner').filter((c) => c.args.includes('--format'));
    expect(scans).toHaveLength(2);
    expect(scans.map((c) => c.timeout)).toEqual([45_000, 45_000]);
  });
});

describe('a version probe or a preparation step stopped at the limit is timed-out', () => {
  function sleepingProbe(bin: string, name: string): void {
    mkdirSync(bin, { recursive: true });
    const file = path.join(bin, name);
    writeFileSync(file, '#!/bin/sh\nif [ "$1" = "--version" ]; then exec /bin/sleep 5; fi\necho "{}"\nexit 0\n');
    chmodSync(file, 0o755);
  }
  const vault = (enforce: boolean) => ({
    role: 'secrets' as const,
    product: 'vault-guard' as const,
    enabled: true,
    stage: 'commit' as const,
    enforce,
    excludedByCli: false,
    options: {},
  });

  it('stops the gate at the probe on a local run, and never spawns the scan', () => {
    const bin = tempDir();
    sleepingProbe(bin, 'vault-guard');
    const out = runGate(vault(true), { repoRoot: tempDir(), staged: false, pathValue: bin, timeoutMs: 1000 });

    expect(out.couldNotRun?.reason).toBe('timed-out');
    expect(out.couldNotRun?.timedOut?.step).toBe('version-probe');
    expect(out.couldNotRun?.detail).toMatch(/^the version probe of vault-guard was stopped at \d+ s \(set by the caller\), so the gate was not run/);
    expect(out.exitCode).toBeNull();
    expect(spawnsOf(bin, 'vault-guard')).toHaveLength(1);
  });

  it('is enforced on a trust-base run under enforce: false, and is not trust-base-unverified', () => {
    const bin = tempDir();
    sleepingProbe(bin, 'vault-guard');
    const out = runGate(vault(false), {
      repoRoot: gitRepo(),
      staged: false,
      pathValue: bin,
      timeoutMs: 1000,
      trustBase: 'main',
    });

    expect(out.couldNotRun?.reason).toBe('timed-out');
    expect(out.couldNotRun?.timedOut?.step).toBe('version-probe');
    expect(out.enforce).toBe(true);
    expect(spawnsOf(bin, 'vault-guard')).toHaveLength(1);
  });

  function intentStub(bin: string, sleeps: 'import-spec' | 'freeze'): void {
    mkdirSync(bin, { recursive: true });
    const file = path.join(bin, 'intent-guard');
    const importOut = path.join(bin, 'import.json');
    writeFileSync(importOut, fixture('intent-guard-1.2.1-import-spec-superpowers-dry-run.json'));
    writeFileSync(
      file,
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then echo 1.8.1; exit 0; fi',
        `if [ "$1" = "${sleeps}" ]; then exec /bin/sleep 5; fi`,
        `if [ "$1" = "import-spec" ]; then /bin/cat ${JSON.stringify(importOut)}; exit 0; fi`,
        'echo "{}"',
        'exit 0',
        '',
      ].join('\n')
    );
    chmodSync(file, 0o755);
  }

  for (const step of ['import-spec', 'freeze'] as const) {
    it(`reports a stopped ${step} as timed-out, not preparation-failed`, () => {
      const root = tempDir();
      git(root, 'init', '--quiet', '-b', 'main');
      const spec = 'docs/superpowers/specs/2026-09-03-widget-cache-design.md';
      mkdirSync(path.dirname(path.join(root, spec)), { recursive: true });
      writeFileSync(path.join(root, spec), fixture('superpowers/specs/2026-09-03-widget-cache-design.md'));
      git(root, 'add', '-A');
      git(root, 'commit', '--quiet', '-m', 'base');
      git(root, 'checkout', '--quiet', '-b', 'feat/widget-cache');
      writeFileSync(path.join(root, 'cache.ts'), 'export const x = 1;\n');
      git(root, 'add', '-A');
      git(root, 'commit', '--quiet', '-m', 'work');
      const bin = tempDir();
      intentStub(bin, step);

      const result = runAll(parsePolicy('version: 1\ngates:\n  intent:\n    product: intent-guard\n', POLICY_FILE_NAME), {
        repoRoot: root,
        staged: false,
        pathValue: bin,
        env: {},
        base: 'main',
        timeoutMs: 1000,
      });

      const out = result.gates[0]!;
      expect(out.couldNotRun?.reason).toBe('timed-out');
      expect(out.couldNotRun?.timedOut?.step).toBe(step);
      expect(out.couldNotRun?.detail).toMatch(new RegExp(`^the intent gate's ${step} step was stopped after`));
      expect(result.exitCode).toBe(2);
    });
  }
});
