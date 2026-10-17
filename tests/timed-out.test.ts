// A gate stopped at its time limit: how the stop is told apart from every
// other spawn failure, what the outcome says, and that nothing a stopped gate
// left behind (a report, clean JSON on stdout, a status of 0 or 3) is ever
// read as a verdict.
//
// The stubs that must outlive the deadline are Node scripts with an absolute
// shebang, so they run with a PATH holding only the stub directory and so a
// SIGTERM handler fires at once (a /bin/sh stub defers a TERM trap until a
// foreground sleep finishes). Every stub answers its version probe at once,
// because the same limit bounds the probe, and every variant asserts the step
// that was stopped.

import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONDUCTOR_OWN_REASONS,
  resolveTimeLimit,
  runGate,
  spawnFailure,
} from '../src/gate-runner.js';
import type { GateOutcome } from '../src/gate-runner.js';
import { renderSarif } from '../src/output-sarif.js';
import { gateLogLines, renderText, verdictToken } from '../src/output-text.js';
import { POLICY_FILE_NAME, parsePolicy } from '../src/policy.js';
import type { GatePolicy, GateRole, Product } from '../src/policy.js';
import { runAll } from '../src/run.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const GITLEAKS_ONE_FINDING = readFileSync(path.join(FIXTURES, 'gitleaks-8.30.1-history-blocking.json'), 'utf8');
const OSV_ONE_VULN = readFileSync(path.join(FIXTURES, 'osv-scanner-2.6.0-blocking.json'), 'utf8');
const CLEAN_VAULT = JSON.stringify({
  version: '1',
  scannedAt: '2026-09-02T00:00:00.000Z',
  summary: { files: 0, secrets: 0 },
  run: { duration_ms: 1, files_scanned: 0, bytes_scanned: 0, patterns_active: 59, diagnostics_count: 0, fail_on: 'medium', blocking_matches: 0 },
  results: [],
});

/** The two rename-detection warnings gitleaks 8.30.1 logged in the measured repository. */
export const RENAME_WARNINGS =
  '10:00AM WRN warning: exhaustive rename detection was skipped due to too many files.\n' +
  '10:00AM WRN warning: you may want to set your diff.renameLimit variable to at least 6 and retry the command.\n';

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-timedout-'));
  temps.push(dir);
  return dir;
}

function gitRepo(lockfile = false): string {
  const repo = tempDir();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
  git('init', '--quiet', '-b', 'main');
  writeFileSync(path.join(repo, lockfile ? 'package-lock.json' : 'README.md'), lockfile ? '{}\n' : '# x\n');
  git('add', '-A');
  git('-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '--quiet', '-m', 'one');
  return repo;
}

function gate(role: GateRole, product: Product, extra: Partial<GatePolicy> = {}): GatePolicy {
  return { role, product, enabled: true, stage: 'ci', enforce: true, excludedByCli: false, options: {}, ...extra };
}

interface NodeStub {
  version: string;
  /** Written to the --report-path argument before the stub sleeps. */
  reportBefore?: string;
  stdoutBefore?: string;
  stderrBefore?: string;
  /** What the stub does on SIGTERM: die (the default), handle it and exit, or ignore it for a while. */
  onTerm?: 'die' | 'exit' | 'ignore';
  termExit?: number;
  /** Written to the --report-path argument inside the SIGTERM handler. */
  termReport?: string;
  ignoreForMs?: number;
}

/** A Node stub gate. Its behaviour is a JSON file beside it, never shell quoting. */
function nodeStub(binDir: string, name: string, config: NodeStub): string {
  mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, name);
  writeFileSync(`${file}.json`, JSON.stringify(config));
  writeFileSync(
    file,
    [
      `#!${process.execPath}`,
      "const fs = require('fs');",
      "const cfg = JSON.parse(fs.readFileSync(__filename + '.json', 'utf8'));",
      'const args = process.argv.slice(2);',
      "if (args[0] === '--version' || args[0] === 'version') { fs.writeSync(1, cfg.version + '\\n'); process.exit(0); }",
      "const at = args.indexOf('--report-path');",
      'const report = at >= 0 ? args[at + 1] : null;',
      'if (cfg.reportBefore !== undefined && report !== null) fs.writeFileSync(report, cfg.reportBefore);',
      'if (cfg.stderrBefore !== undefined) fs.writeSync(2, cfg.stderrBefore);',
      'if (cfg.stdoutBefore !== undefined) fs.writeSync(1, cfg.stdoutBefore);',
      'const finish = () => {',
      '  if (cfg.termReport !== undefined && report !== null) fs.writeFileSync(report, cfg.termReport);',
      '  process.exit(cfg.termExit === undefined ? 0 : cfg.termExit);',
      '};',
      "if (cfg.onTerm === 'exit') process.on('SIGTERM', finish);",
      "if (cfg.onTerm === 'ignore') process.on('SIGTERM', () => setTimeout(finish, cfg.ignoreForMs === undefined ? 1000 : cfg.ignoreForMs));",
      'setTimeout(() => process.exit(0), 20000);',
      '',
    ].join('\n')
  );
  chmodSync(file, 0o755);
  return file;
}

/** The limit the T12 stubs are run under: long enough for Node to start and write, short enough to wait for. */
const LIMIT_MS = 1500;

function expectStoppedAtScan(outcome: GateOutcome): void {
  expect(outcome.couldNotRun?.reason).toBe('timed-out');
  expect(outcome.couldNotRun?.timedOut?.step).toBe('scan');
  expect(outcome.exitCode).toBeNull();
  expect(outcome.findings.map((finding) => finding.ruleId)).toEqual(['conductor/gate-failed']);
  expect(outcome.couldNotRun?.gateSaid).toBeUndefined();
}

describe('spawnFailure tells a timeout from every other spawn error by the error code alone', () => {
  const err = (code: string): Error => Object.assign(new Error(`spawnSync x ${code}`), { code });

  it('reads ETIMEDOUT as timed-out with status null and SIGTERM', () => {
    expect(spawnFailure({ error: err('ETIMEDOUT'), status: null, signal: 'SIGTERM' })).toEqual({
      reason: 'timed-out',
      signal: 'SIGTERM',
    });
  });

  it('reads ETIMEDOUT as timed-out when the child handled SIGTERM and exited 0, signal null', () => {
    expect(spawnFailure({ error: err('ETIMEDOUT'), status: 0, signal: null })).toEqual({
      reason: 'timed-out',
      signal: null,
    });
  });

  it('reads ETIMEDOUT as timed-out when the child exited 3, its blocked code, signal null', () => {
    expect(spawnFailure({ error: err('ETIMEDOUT'), status: 3, signal: null })?.reason).toBe('timed-out');
  });

  it('keeps ENOBUFS, which arrives with the same SIGTERM, and ENOENT and EACCES as spawn-failed', () => {
    expect(spawnFailure({ error: err('ENOBUFS'), status: null, signal: 'SIGTERM' })).toEqual({
      reason: 'spawn-failed',
      message: 'spawnSync x ENOBUFS',
    });
    expect(spawnFailure({ error: err('ENOENT'), status: null, signal: null })?.reason).toBe('spawn-failed');
    expect(spawnFailure({ error: err('EACCES'), status: null, signal: null })?.reason).toBe('spawn-failed');
  });

  it('does not classify a result with no error', () => {
    expect(spawnFailure({ status: null, signal: 'SIGKILL' })).toBeNull();
    expect(spawnFailure({ status: 0, signal: null })).toBeNull();
  });
});

describe('resolveTimeLimit, the one place a gate limit is decided', () => {
  it('takes the test hook first, then the policy, then the profile default', () => {
    const policy = gate('secrets', 'vault-guard', { timeoutSeconds: 45 });
    expect(resolveTimeLimit(policy, 5_000)).toEqual({ ms: 5_000, source: 'override' });
    expect(resolveTimeLimit(policy, undefined)).toEqual({ ms: 45_000, source: 'policy' });
    expect(resolveTimeLimit(gate('secrets', 'vault-guard'), undefined)).toEqual({ ms: 120_000, source: 'default' });
    expect(resolveTimeLimit(gate('secrets-history', 'gitleaks'), undefined)).toEqual({ ms: 600_000, source: 'default' });
    expect(resolveTimeLimit(gate('vulnerabilities', 'osv-scanner'), undefined)).toEqual({ ms: 300_000, source: 'default' });
  });

  it('is the only expression in src that turns timeoutSeconds or a profile timeoutMs into a limit', () => {
    const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
    // A limit computed from the policy key, from a profile constant, or with
    // a fallback after the caller's value.
    const computes = /timeoutSeconds\s*\*|\.timeoutMs\s*\?\?|profileFor\([^)]*\)\.timeoutMs|profile\.timeoutMs|\?\?\s*\d[\d_]*_000\b/;
    const hits: string[] = [];
    for (const name of readdirSync(src).filter((entry) => entry.endsWith('.ts'))) {
      let text = readFileSync(path.join(src, name), 'utf8');
      if (name === 'gate-runner.ts') {
        const start = text.indexOf('export function resolveTimeLimit(');
        const end = text.indexOf('\n}\n', start);
        expect(start).toBeGreaterThan(-1);
        // The resolver itself does compute it, once each way.
        expect(computes.test(text.slice(start, end))).toBe(true);
        text = text.slice(0, start) + text.slice(end);
      }
      text.split('\n').forEach((line, i) => {
        if (computes.test(line)) {
          hits.push(`${name}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});

describe('a gate stopped at its limit is timed-out, never spawn-failed', () => {
  it('names the limit and the remedies, carries no gate said, and captions the echoed stderr', () => {
    const bin = tempDir();
    const file = path.join(bin, 'gitleaks');
    writeFileSync(
      file,
      [
        '#!/bin/sh',
        'if [ "$1" = "version" ]; then echo 8.30.1; exit 0; fi',
        `printf '%s' ${JSON.stringify(RENAME_WARNINGS)} >&2`,
        'exec /bin/sleep 5',
        '',
      ].join('\n')
    );
    chmodSync(file, 0o755);

    const outcome = runGate(gate('secrets-history', 'gitleaks'), {
      repoRoot: gitRepo(),
      staged: false,
      pathValue: bin,
      tempRoot: tempDir(),
      timeoutMs: 1000,
    });

    expect(outcome.couldNotRun?.reason).toBe('timed-out');
    expect(outcome.exitCode).toBeNull();
    expect(outcome.couldNotRun?.gateSaid).toBeUndefined();
    expect(outcome.couldNotRun?.timedOut).toMatchObject({ step: 'scan', limitSource: 'override' });
    const detail = outcome.couldNotRun?.detail ?? '';
    expect(detail).toMatch(/^gitleaks was stopped after \d+ s, at its \d+ s limit \(set by the caller\), so nothing was checked by it\./);
    expect(detail).toContain('Raise the limit with gates.secrets-history.timeout-seconds in .guardrails.yaml (on a pull request, on the base branch).');
    expect(detail).toContain('max-target-megabytes');
    expect(detail).not.toContain('ETIMEDOUT');

    const result = runAll(parsePolicy('version: 1\ngates:\n  secrets-history:\n    product: gitleaks\n', POLICY_FILE_NAME), {
      repoRoot: gitRepo(),
      staged: false,
      pathValue: bin,
      tempRoot: tempDir(),
      timeoutMs: 1000,
    });
    const text = renderText(result);
    const caption = text.indexOf('    (printed by the gate before it was stopped; not the reason it stopped)');
    const echoed = text.indexOf('    | 10:00AM WRN warning: exhaustive rename detection was skipped');
    expect(caption).toBeGreaterThan(-1);
    expect(echoed).toBeGreaterThan(caption);
    expect(text).toContain('DID NOT RUN (timed-out)');
  });
});

describe('a timed-out gate leaves nothing that is read as a verdict', () => {
  const GITLEAKS_POLICY = parsePolicy('version: 1\ngates:\n  secrets-history:\n    product: gitleaks\n', POLICY_FILE_NAME);
  const OSV_POLICY = parsePolicy('version: 1\ngates:\n  vulnerabilities:\n    product: osv-scanner\n', POLICY_FILE_NAME);
  const VAULT_POLICY = parsePolicy('version: 1\ngates:\n  secrets:\n    product: vault-guard\n', POLICY_FILE_NAME);

  function runStopped(product: 'gitleaks' | 'osv-scanner' | 'vault-guard', config: NodeStub) {
    const bin = tempDir();
    nodeStub(bin, product, config);
    const tempRoot = tempDir();
    const policy = product === 'gitleaks' ? GITLEAKS_POLICY : product === 'osv-scanner' ? OSV_POLICY : VAULT_POLICY;
    const result = runAll(policy, {
      repoRoot: product === 'vault-guard' ? tempDir() : gitRepo(product === 'osv-scanner'),
      staged: false,
      pathValue: bin,
      tempRoot,
      timeoutMs: LIMIT_MS,
    });
    expect(result.exitCode).toBe(2);
    expect(readdirSync(tempRoot)).toEqual([]);
    expect(result.gates).toHaveLength(1);
    return result.gates[0] as GateOutcome;
  }

  describe('killed by SIGTERM', () => {
    it('never reads a report truncated mid object', () => {
      expectStoppedAtScan(
        runStopped('gitleaks', { version: '8.30.1', reportBefore: '[{"RuleID":"generic-api-key", "File": "a' })
      );
    });

    it('never reads a complete, valid one-finding report', () => {
      expectStoppedAtScan(runStopped('gitleaks', { version: '8.30.1', reportBefore: GITLEAKS_ONE_FINDING }));
    });

    it('never reads valid JSON with a vulnerability already on stdout', () => {
      expectStoppedAtScan(
        runStopped('osv-scanner', { version: 'osv-scanner version: 2.6.0', stdoutBefore: OSV_ONE_VULN })
      );
    });
  });

  describe('handling SIGTERM', () => {
    it('never reads a clean report written in the trap, with exit 0', () => {
      expectStoppedAtScan(
        runStopped('gitleaks', { version: '8.30.1', onTerm: 'exit', termExit: 0, termReport: '[]' })
      );
    });

    it('never reads clean vault-guard JSON printed before the deadline, with exit 0', () => {
      expectStoppedAtScan(
        runStopped('vault-guard', { version: '1.10.0', stdoutBefore: CLEAN_VAULT, onTerm: 'exit', termExit: 0 })
      );
    });

    it('never reads clean osv JSON printed before the deadline, with exit 0', () => {
      expectStoppedAtScan(
        runStopped('osv-scanner', {
          version: 'osv-scanner version: 2.6.0',
          stdoutBefore: JSON.stringify({ results: [] }),
          onTerm: 'exit',
          termExit: 0,
        })
      );
    });

    it('never reads a one-finding report written in the trap with exit 3, the blocked code', () => {
      expectStoppedAtScan(
        runStopped('gitleaks', { version: '8.30.1', onTerm: 'exit', termExit: 3, termReport: GITLEAKS_ONE_FINDING })
      );
    });
  });

  describe('ignoring SIGTERM and exiting 0 after the limit', () => {
    it('never reads clean JSON printed before the deadline', () => {
      expectStoppedAtScan(
        runStopped('vault-guard', {
          version: '1.10.0',
          stdoutBefore: CLEAN_VAULT,
          onTerm: 'ignore',
          ignoreForMs: 500,
          termExit: 0,
        })
      );
    });

    it('never reads a clean report written before it exits', () => {
      expectStoppedAtScan(
        runStopped('gitleaks', { version: '8.30.1', onTerm: 'ignore', ignoreForMs: 500, termExit: 0, termReport: '[]' })
      );
    });
  });
});

describe('a timed-out gate composes like every other could-not-run', () => {
  function stoppedVault(enforce: boolean) {
    const bin = tempDir();
    nodeStub(bin, 'vault-guard', { version: '1.10.0' });
    const policy = parsePolicy(
      `version: 1\ngates:\n  secrets:\n    product: vault-guard\n    enforce: ${enforce}\n`,
      POLICY_FILE_NAME
    );
    return runAll(policy, { repoRoot: tempDir(), staged: false, pathValue: bin, timeoutMs: LIMIT_MS });
  }

  it('exits 2 with the could-not-run token when enforced, and the job log line carries conductor said', () => {
    const result = stoppedVault(true);
    expect(result.exitCode).toBe(2);
    expect(verdictToken(result, false)).toBe('could-not-run');
    expect(CONDUCTOR_OWN_REASONS.has('timed-out')).toBe(true);
    const line = gateLogLines(result)[0] ?? '';
    expect(line).toContain('could-not-run (timed-out), no exit code');
    expect(line).toContain('conductor said: "vault-guard was stopped after');
  });

  it('is a note under enforce: false, and SARIF names timed-out and carries timedOut', () => {
    const result = stoppedVault(false);
    expect(result.exitCode).toBe(0);
    const sarif = JSON.parse(renderSarif(result, '0.0.0')) as {
      runs: Array<{
        results: Array<{ ruleId: string; properties: { details: Record<string, unknown> } }>;
        invocations?: Array<{ toolExecutionNotifications?: Array<{ descriptor: { id: string }; message: { text: string } }> }>;
      }>;
    };
    const umbrella = sarif.runs[sarif.runs.length - 1]!;
    const notEnforced = umbrella.invocations?.[0]?.toolExecutionNotifications?.find(
      (n) => n.descriptor.id === 'conductor/gate-not-enforced'
    );
    expect(notEnforced?.message.text).toContain('It could not run (timed-out)');
    const failed = umbrella.results.find((r) => r.ruleId === 'conductor/gate-failed');
    expect(failed?.properties.details.timedOut).toMatchObject({ limitSource: 'override' });
    expect(failed?.properties.details.timedOut).toHaveProperty('limitSeconds');
    expect(failed?.properties.details.timedOut).toHaveProperty('elapsedSeconds');
  });
});
