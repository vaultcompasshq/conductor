// The one written exception to "a gate that exited non-zero blocks" (osv
// design, section 4.3): the vulnerabilities gate on a compared pull-request
// run under present-on-base: report, every parsed finding present-on-base, no
// licence or deprecation verdict in its output. Tests 17, 17a, 17b and 18,
// and the exit and token half of test 7.

import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Finding } from '../src/envelope.js';
import { EXIT_BLOCKED, EXIT_OK, composeExitCode, gateExitBlocks } from '../src/exit-codes.js';
import { runGate, type GateOutcome } from '../src/gate-runner.js';
import { renderText, verdictToken } from '../src/output-text.js';
import { renderSarif } from '../src/output-sarif.js';
import type { GatePolicy, Policy } from '../src/policy.js';
import { runAll, type RunResult } from '../src/run.js';
import { lockBody, osvOutput, osvResult, stubOsv } from './helpers/osv-stub.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-osv-exit-'));
  temps.push(dir);
  return dir;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
}

function commit(repo: string, files: Record<string, string>, message = 'change'): void {
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    writeFileSync(path.join(repo, name), body);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', message);
}

function prRepo(base: Record<string, string>, head: Record<string, string>): string {
  const repo = tempDir();
  git(repo, 'init', '--quiet', '-b', 'main');
  commit(repo, { 'README.md': '# fixture\n', ...base }, 'base');
  git(repo, 'checkout', '--quiet', '-b', 'pr');
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

const A: [string, string, string] = ['lodash', '4.17.20', 'GHSA-A'];
const B: [string, string, string] = ['minimist', '1.2.0', 'GHSA-B'];

function finding(label: 'introduced' | 'present-on-base' | undefined, blocking: boolean, product = 'osv-scanner'): Finding {
  return {
    schemaVersion: 1,
    product,
    productVersion: '2.4.0',
    ruleId: `${product}/GHSA-A`,
    severity: 'high',
    severityIsDerived: true,
    blocking,
    message: 'x',
    subject: { kind: 'package', name: 'lodash', manifest: 'package-lock.json' },
    fingerprint: null,
    details: { version: '4.17.20', ecosystem: 'npm', ...(label === undefined ? {} : { baseline: label }) },
  };
}

function outcome(overrides: Partial<GateOutcome> = {}): GateOutcome {
  return {
    role: 'vulnerabilities',
    product: 'osv-scanner',
    stage: 'ci',
    enforce: true,
    productVersion: '2.4.0',
    argv: [],
    binary: null,
    exitCode: 1,
    durationMs: 1,
    couldNotRun: null,
    findings: [finding('present-on-base', false)],
    run: { failOn: 'any', suppressed: 0, ignored: 0, diagnostics: [], details: {} },
    diagnostics: [],
    stderr: '',
    baseComparison: {
      ref: 'main',
      policy: 'report',
      introduced: 0,
      presentOnBase: 1,
      unavailable: [],
      otherVerdicts: [],
    },
    ...overrides,
  };
}

function resultOf(gates: GateOutcome[]): RunResult {
  const findings = gates.flatMap((g) => g.findings);
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-11T00:00:00.000Z',
    gates,
    deferred: [],
    skipped: [],
    excluded: [],
    treeUnchanged: [],
    findings,
    trustBase: { ref: 'main', policyChanged: false, refusal: null },
    proposals: [],
    summary: { blocking: findings.filter((f) => f.blocking).length, byProduct: {}, bySeverity: {} },
    exitCode: composeExitCode(
      gates.map((g) => ({
        couldNotRun: g.couldNotRun,
        exitBlocks: gateExitBlocks(g),
        hasBlockingFinding: g.findings.some((f) => f.blocking),
        enforce: g.enforce,
      }))
    ),
  };
}

describe('gateExitBlocks (test 17)', () => {
  it('does not block on exit 1 when every finding is present-on-base under report', () => {
    expect(gateExitBlocks(outcome())).toBe(false);
  });

  it('blocks on exit 1 with no parsed finding, which is the at-least-one guard (d)', () => {
    expect(gateExitBlocks(outcome({ findings: [] }))).toBe(true);
  });

  it('blocks in block mode (b), without a comparison (c), and on a could-not-run', () => {
    const c = outcome().baseComparison!;
    expect(gateExitBlocks(outcome({ baseComparison: { ...c, policy: 'block' } }))).toBe(true);
    const { baseComparison: _dropped, ...withoutComparison } = outcome();
    expect(gateExitBlocks(withoutComparison as GateOutcome)).toBe(true);
    expect(gateExitBlocks(outcome({ couldNotRun: { reason: 'gate-error', detail: 'x' } }))).toBe(true);
  });

  it('blocks when any finding is introduced (e), and says nothing about an exit of 0', () => {
    expect(gateExitBlocks(outcome({ findings: [finding('present-on-base', false), finding('introduced', true)] }))).toBe(true);
    expect(gateExitBlocks(outcome({ exitCode: 0 }))).toBe(false);
    expect(gateExitBlocks(outcome({ exitCode: null }))).toBe(false);
  });
});

describe('a licence violation or a deprecated package beside present-on-base advisories (test 17a)', () => {
  // The head output is shaped like the real 2.4.0 captures in
  // tests/fixtures (osv-scanner-2.4.0-license-violation.json and
  // osv-scanner-2.4.0-deprecated.json): one package carrying the
  // present-on-base advisory A, and one carrying the other verdict.
  const capture = (name: string) =>
    (JSON.parse(readFileSync(path.join(HERE, 'fixtures', name), 'utf8')) as { results: Array<{ packages: unknown[] }> })
      .results[0]!.packages[0] as Record<string, unknown>;

  function run(extraPackage: Record<string, unknown>) {
    // package-lock.json is untouched by the pull request, so A is
    // present-on-base by the shortcut and no base run is needed.
    const repo = prRepo({ 'package-lock.json': lockBody([A]) }, { 'src/app.js': 'x\n' });
    const head = JSON.parse(
      osvOutput(osvResult('package-lock.json', [{ name: A[0], version: A[1], ids: [A[2]] }]))
    ) as { results: Array<{ packages: unknown[] }> };
    head.results[0]!.packages.push(extraPackage);
    const bin = tempDir();
    stubOsv(bin, { record: path.join(tempDir(), 'r'), head: { stdout: JSON.stringify(head), exit: 1 } });
    return runGate(osvGate('report'), { repoRoot: repo, staged: false, pathValue: bin, tempRoot: tempDir(), trustBase: 'main' });
  }

  it('still blocks on a licence violation', () => {
    const out = run(capture('osv-scanner-2.4.0-license-violation.json'));
    expect(out.findings.map((f) => [f.details.baseline, f.blocking])).toEqual([['present-on-base', false]]);
    expect(out.baseComparison?.otherVerdicts).toEqual(['license_violations (click@8.1.7)']);
    expect(gateExitBlocks(out)).toBe(true);
    expect(resultOf([out]).exitCode).toBe(EXIT_BLOCKED);
  });

  it('still blocks on a deprecated package', () => {
    const out = run(capture('osv-scanner-2.4.0-deprecated.json'));
    expect(out.baseComparison?.otherVerdicts).toEqual(['deprecated (querystring@0.2.1)']);
    expect(gateExitBlocks(out)).toBe(true);
    expect(resultOf([out]).exitCode).toBe(EXIT_BLOCKED);
  });

  it('does not block without either, which is what the two cases above differ from', () => {
    const out = run({ package: { name: 'six', version: '1.16.0', ecosystem: 'PyPI' }, licenses: ['MIT'] });
    expect(gateExitBlocks(out)).toBe(false);
    expect(resultOf([out]).exitCode).toBe(EXIT_OK);
  });
});

describe('the exception is the vulnerabilities gate alone (test 17b)', () => {
  for (const [role, product] of [
    ['dependencies', 'dep-guard'],
    ['secrets', 'vault-guard'],
  ] as const) {
    it(`blocks a ${product} outcome carrying a report-mode comparison with every finding present-on-base`, () => {
      const out = outcome({ role, product, findings: [finding('present-on-base', false, product)] });
      expect(gateExitBlocks(out)).toBe(true);
      expect(resultOf([out]).exitCode).toBe(EXIT_BLOCKED);
    });
  }

  it('blocks an osv-scanner outcome filed under another role', () => {
    expect(gateExitBlocks(outcome({ role: 'dependencies' }))).toBe(true);
  });

  it('blocks a vulnerabilities-role outcome whose product is not osv-scanner', () => {
    const out = outcome({ product: 'dep-guard', findings: [finding('present-on-base', false, 'dep-guard')] });
    expect(gateExitBlocks(out)).toBe(true);
    expect(resultOf([out]).exitCode).toBe(EXIT_BLOCKED);
  });
});

describe('the pair, through runAll (test 7, exit and token)', () => {
  function runPair(head: Record<string, string>, presentOnBase?: 'block' | 'report') {
    const repo = prRepo({ 'package-lock.json': lockBody([A]) }, head);
    const bin = tempDir();
    stubOsv(bin, { record: path.join(tempDir(), 'r') });
    const policy: Policy = {
      version: 1,
      gates: { vulnerabilities: osvGate(presentOnBase) },
      report: { format: 'text' },
    };
    return runAll(policy, {
      repoRoot: repo,
      staged: false,
      pathValue: bin,
      tempRoot: tempDir(),
      trustBase: { ref: 'main', policyChanged: false, refusal: null },
    });
  }

  it('blocks on both with no key', () => {
    const result = runPair({ 'package-lock.json': lockBody([A, B]) });
    expect(result.exitCode).toBe(EXIT_BLOCKED);
    expect(verdictToken(result, false)).toBe('blocked (2)');
  });

  it('blocks on the introduced one alone under report', () => {
    const result = runPair({ 'package-lock.json': lockBody([A, B]) }, 'report');
    expect(result.exitCode).toBe(EXIT_BLOCKED);
    expect(verdictToken(result, false)).toBe('blocked (1)');
  });

  it('exits 0 with token pass under report when every finding is present-on-base, and prints it', () => {
    const result = runPair({ 'package-lock.json': lockBody([A], 'touched') }, 'report');
    expect(result.gates[0]!.exitCode).toBe(1);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(verdictToken(result, false)).toBe('pass');
    expect(renderText(result)).toMatch(/ {2}report {2}high\* {5}osv-scanner\/GHSA-A {2}lodash \(package-lock\.json\) {2}present-on-base\n/);
  });
});

describe('every reader of a non-zero child exit agrees with the exit code (test 18)', () => {
  const depGuardBlocked: GateOutcome = outcome({
    role: 'dependencies',
    product: 'dep-guard',
    findings: [{ ...finding(undefined, true, 'dep-guard'), ruleId: 'dep-guard/x' }],
  });
  delete (depGuardBlocked as Partial<GateOutcome>).baseComparison;

  it('counts the token over the gate that blocked, not the report-mode osv gate', () => {
    const result = resultOf([depGuardBlocked, outcome()]);
    expect(result.exitCode).toBe(EXIT_BLOCKED);
    expect(verdictToken(result, false)).toBe('blocked (1)');
  });

  it('leaves a report-mode osv gate out of the mismatch sentence', () => {
    const mismatch = { ...depGuardBlocked, findings: [{ ...depGuardBlocked.findings[0]!, blocking: false }] };
    const text = renderText(resultOf([mismatch, outcome()]));
    expect(text).toMatch(/Enforced gate\(s\) that exited non-zero: dependencies \(exit 1\)\./);
  });

  it('does not call an unenforced report-mode osv gate blocked, in the token, the sentence or SARIF', () => {
    const result = resultOf([outcome({ enforce: false })]);
    expect(verdictToken(result, false)).toBe('pass');
    const text = renderText(result, { verbose: true });
    expect(text).not.toMatch(/vulnerabilities blocked/);
    expect(text).not.toMatch(/reported 0 blocking finding\(s\) and exited 1/);
    const log = JSON.parse(renderSarif(result, '0.0.0')) as {
      runs: Array<{
        invocations?: Array<{
          toolExecutionNotifications?: Array<{
            descriptor?: { id: string };
            message?: { text: string };
            properties?: { details?: Record<string, unknown> };
          }>;
        }>;
      }>;
    };
    const notes = log.runs.flatMap((r) => r.invocations ?? []).flatMap((i) => i.toolExecutionNotifications ?? []);
    const notEnforced = notes.find((n) => n.descriptor?.id === 'conductor/gate-not-enforced');
    expect(notEnforced?.properties?.details?.exitBlocks).toBe(false);
    expect(notEnforced?.message?.text).toMatch(/exited 1, which does not block here/);
  });

  /**
   * Every place under src/ that reads a gate's child exit code compared with
   * 0, outside exit-codes.ts. The two allowlisted sites ask a different
   * question, "did this gate say anything at all", and keep the raw exit on
   * purpose (osv design, section 4.3): a report-mode run with present-on-base
   * findings has findings and a non-zero exit, so it is never "ok" and never
   * folded into the one-line summary.
   */
  it('finds no reader of a gate exit code compared with 0 outside gateExitBlocks and the two allowlisted sites', () => {
    const allowed = new Set(['output-text.ts:gateLogLines', 'output-text.ts:isFullyClean']);
    // `result.exitCode` is the composed code, `process.exitCode` and
    // `err.exitCode` are not a gate's; every other receiver is.
    const notAGate = new Set(['result', 'process', 'err']);
    const reader = /([A-Za-z_$][\w$]*)\.exitCode(?:\s*\?\?\s*[^)]*\))?\s*(?:!==|===)\s*0\b/g;
    const found: string[] = [];
    for (const file of readdirSync(SRC).filter((f) => f.endsWith('.ts') && f !== 'exit-codes.ts')) {
      const lines = readFileSync(path.join(SRC, file), 'utf8').split('\n');
      let fn = '(top)';
      lines.forEach((line, index) => {
        const declared = /^(?:export\s+)?function\s+([\w$]+)/.exec(line);
        if (declared !== null) {
          fn = declared[1]!;
        }
        for (const match of line.matchAll(reader)) {
          if (!notAGate.has(match[1]!)) {
            found.push(`${file}:${fn}:${index + 1}`);
          }
        }
      });
    }
    const unexpected = found.filter((site) => !allowed.has(site.split(':').slice(0, 2).join(':')));
    expect(unexpected).toEqual([]);
    expect(found.map((site) => site.split(':').slice(0, 2).join(':')).sort()).toEqual([...allowed].sort());
  });
});
