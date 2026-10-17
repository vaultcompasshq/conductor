// What a compared vulnerabilities run looks like in the text report and in
// SARIF (osv design, section 4.4; test 19), and that none of it appears on a
// run with no base comparison.

import { describe, expect, it } from '@jest/globals';

import type { Finding } from '../src/envelope.js';
import { composeExitCode, gateExitBlocks } from '../src/exit-codes.js';
import type { GateOutcome } from '../src/gate-runner.js';
import { renderSarif } from '../src/output-sarif.js';
import { renderText, verdictToken } from '../src/output-text.js';
import type { RunResult } from '../src/run.js';

function finding(id: string, name: string, label: 'introduced' | 'present-on-base' | undefined, blocking: boolean): Finding {
  return {
    schemaVersion: 1,
    product: 'osv-scanner',
    productVersion: '2.4.0',
    ruleId: `osv-scanner/${id}`,
    severity: 'high',
    severityIsDerived: true,
    blocking,
    message: `${id} in ${name}`,
    subject: { kind: 'package', name, manifest: 'package-lock.json' },
    fingerprint: { value: `${id}|${name}|1.0.0|package-lock.json`, scope: 'osv-scanner', stability: 'stable' },
    details: { version: '1.0.0', ecosystem: 'npm', ...(label === undefined ? {} : { baseline: label }) },
  };
}

function gate(findings: Finding[], comparison?: GateOutcome['baseComparison'], exitCode = 1): GateOutcome {
  return {
    role: 'vulnerabilities',
    product: 'osv-scanner',
    stage: 'ci',
    enforce: true,
    productVersion: '2.4.0',
    argv: [],
    binary: null,
    exitCode,
    durationMs: 1,
    couldNotRun: null,
    findings,
    run: { failOn: 'any', suppressed: 0, ignored: 0, diagnostics: [], details: { lockfiles: '1 (package-lock.json)' } },
    diagnostics: [],
    stderr: '',
    ...(comparison === undefined ? {} : { baseComparison: comparison }),
  };
}

function result(gates: GateOutcome[], trustBase = true): RunResult {
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
    trustBase: trustBase ? { ref: 'main', policyChanged: false, refusal: null } : null,
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

const comparison = (policy: 'block' | 'report', introduced: number, present: number, unavailable: Array<{ path: string; reason: string }> = []) => ({
  ref: 'main',
  policy,
  introduced,
  presentOnBase: present,
  unavailable,
  otherVerdicts: [],
});

type Sarif = {
  runs: Array<{
    tool: { driver: { name: string } };
    results?: Array<Record<string, unknown>>;
    properties?: { details?: Record<string, unknown> };
  }>;
};

function osvRun(text: string): Sarif['runs'][number] {
  return (JSON.parse(text) as Sarif).runs.find((r) => r.tool.driver.name === 'osv-scanner')!;
}

describe('a compared run under report, one advisory of each kind', () => {
  const mixed = result([
    gate([finding('GHSA-A', 'lodash', 'present-on-base', false), finding('GHSA-B', 'minimist', 'introduced', true)], comparison('report', 1, 1)),
  ]);

  it('labels each finding line and prints the base comparison line under the threshold', () => {
    const lines = renderText(mixed, { version: '9.9.9' }).split('\n');
    expect(lines).toContain('  BLOCKING  high*     osv-scanner/GHSA-B  minimist@1.0.0 (package-lock.json)  no fix listed  introduced');
    expect(lines).toContain('    report  high*     osv-scanner/GHSA-A  lodash@1.0.0 (package-lock.json)  no fix listed  present-on-base');
    const threshold = lines.findIndex((l) => l.startsWith('  threshold any'));
    expect(lines[threshold + 1]).toBe(
      '  base comparison  main  introduced 1  present-on-base 1  present-on-base: report (not blocking)'
    );
  });

  it('puts the present-on-base line third, under the version and the token', () => {
    const lines = renderText(mixed, { version: '9.9.9' }).split('\n');
    expect(lines.slice(0, 3)).toEqual([
      'conductor 9.9.9',
      'verdict-token: blocked (1)',
      'present-on-base: 1 reported, not blocking',
    ]);
  });

  it('marks SARIF results new and unchanged, and carries the comparison on the run', () => {
    const run = osvRun(renderSarif(mixed, '0.0.0'));
    const states = Object.fromEntries((run.results ?? []).map((r) => [r.ruleId, r.baselineState]));
    expect(states).toEqual({ 'osv-scanner/GHSA-A': 'unchanged', 'osv-scanner/GHSA-B': 'new' });
    expect(run.properties?.details).toMatchObject({
      'baseline-ref': 'main',
      introduced: 1,
      'present-on-base': 1,
      'present-on-base-policy': 'report',
    });
  });
});

describe('a compared run under report where everything was on the base', () => {
  const allPresent = result([
    gate([finding('GHSA-A', 'lodash', 'present-on-base', false), finding('GHSA-C', 'qs', 'present-on-base', false)], comparison('report', 0, 2)),
  ]);

  it('exits 0 with token pass, says why in the verdict, and still prints the line', () => {
    expect(allPresent.exitCode).toBe(0);
    expect(verdictToken(allPresent, false)).toBe('pass');
    const text = renderText(allPresent, { version: '9.9.9' });
    expect(text.split('\n')[2]).toBe('present-on-base: 2 reported, not blocking');
    expect(text.trimEnd().split('\n').at(-1)).toBe(
      'verdict: exit 0, every enabled gate ran and none blocked; 2 known vulnerabilities already on the ' +
        'base were reported, not blocking (vulnerabilities: present-on-base: report).'
    );
  });

  it('never folds that run into the one-line clean summary', () => {
    expect(renderText(allPresent)).not.toMatch(/^conductor: clean/);
  });
});

describe('block mode, and a comparison unavailable for a lockfile', () => {
  it('prints block on the comparison line, an unavailable line, and no present-on-base line at the top', () => {
    const run = result([
      gate(
        [finding('GHSA-A', 'lodash', 'present-on-base', true), finding('GHSA-B', 'minimist', 'introduced', true)],
        comparison('block', 1, 1, [{ path: 'web/package-lock.json', reason: 'osv-scanner exited 127 on the base copies' }])
      ),
    ]);
    const lines = renderText(run, { version: '9.9.9' }).split('\n');
    expect(lines).toContain('  base comparison  main  introduced 1  present-on-base 1  present-on-base: block (blocking)');
    expect(lines).toContain(
      '  base comparison unavailable for web/package-lock.json: osv-scanner exited 127 on the base copies; counted as introduced'
    );
    expect(lines[2]).toBe('conductor run: 1 gate(s), 2 finding(s)');
    expect(lines.some((l) => l.startsWith('present-on-base:'))).toBe(false);
  });
});

describe('a run with no base comparison', () => {
  const local = result([gate([finding('GHSA-A', 'lodash', undefined, true)])], false);

  it('prints no label, no comparison line and no present-on-base line', () => {
    const text = renderText(local, { version: '9.9.9' });
    expect(text).toContain('  BLOCKING  high*     osv-scanner/GHSA-A  lodash@1.0.0 (package-lock.json)  no fix listed\n');
    expect(text).not.toMatch(/introduced|present-on-base|base comparison/);
  });

  it('sets no baselineState and no comparison details in SARIF', () => {
    const run = osvRun(renderSarif(local, '0.0.0'));
    expect(run.results?.every((r) => !('baselineState' in r))).toBe(true);
    expect(Object.keys(run.properties?.details ?? {})).not.toContain('baseline-ref');
  });
});
