// The verdict token: a closed-set label for the umbrella's OWN exit decision.
//
// It decides nothing. Every state here is derived from the exit code the
// umbrella already composed, plus which gates that composition left out, so
// each case below builds a RunResult the way runAll would and asserts the
// label, never a new verdict.

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Finding } from '../src/envelope.js';
import type { GateOutcome } from '../src/gate-runner.js';
import { normalizeDepGuard, normalizeMissingGate } from '../src/normalize.js';
import { renderText, verdictToken } from '../src/output-text.js';
import type { RunResult } from '../src/run.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const base = normalizeDepGuard(
  JSON.parse(readFileSync(path.join(FIXTURES, 'dep-guard-0.2.0-blocking.json'), 'utf8')),
  '0.2.0'
);
const blockingFinding: Finding = { ...(base.findings[0] as Finding), blocking: true };
const reportFinding: Finding = { ...(base.findings[0] as Finding), blocking: false };

function gate(overrides: Partial<GateOutcome>): GateOutcome {
  return {
    role: 'dependencies',
    product: 'dep-guard',
    productVersion: '0.2.0',
    argv: ['scan'],
    binary: {
      command: '/usr/local/bin/dep-guard',
      argvPrefix: ['scan'],
      source: 'path',
      candidate: 'dep-guard',
      versionProbe: null,
    },
    exitCode: 0,
    durationMs: 10,
    stage: 'commit',
    enforce: true,
    couldNotRun: null,
    findings: [],
    run: { failOn: 'medium', suppressed: 0, ignored: 0, diagnostics: [], details: {} },
    diagnostics: [],
    stderr: '',
    ...overrides,
  } as GateOutcome;
}

function run(
  gates: GateOutcome[],
  exitCode: number,
  extra: Partial<RunResult> = {}
): RunResult {
  const findings = gates.flatMap((g) => g.findings);
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-29T00:00:00.000Z',
    gates,
    deferred: [],
    skipped: [],
    excluded: [],
    treeUnchanged: [],
    findings,
    trustBase: null,
    proposals: [],
    summary: { blocking: 0, byProduct: {}, bySeverity: {} },
    exitCode,
    ...extra,
  };
}

const blockedGate = (overrides: Partial<GateOutcome> = {}): GateOutcome =>
  gate({ exitCode: 1, findings: [blockingFinding, blockingFinding], ...overrides });

const brokenGate = (enforce: boolean, role: 'secrets' | 'intent' = 'secrets'): GateOutcome =>
  gate({
    role,
    product: role === 'secrets' ? 'vault-guard' : 'intent-guard',
    productVersion: null,
    exitCode: null,
    binary: null,
    enforce,
    couldNotRun: { reason: 'binary-missing', detail: 'binary missing' },
    findings: [
      normalizeMissingGate(role, role === 'secrets' ? 'vault-guard' : 'intent-guard', [
        role === 'secrets' ? 'vault-guard' : 'intent-guard',
      ]),
    ],
  });

describe('verdictToken', () => {
  it('is pass for a clean run', () => {
    expect(verdictToken(run([gate({})], 0), false)).toBe('pass');
    expect(verdictToken(run([gate({})], 0), true)).toBe('pass');
  });

  it('is pass when non-blocking findings are all there is', () => {
    expect(verdictToken(run([gate({ findings: [reportFinding] })], 0), false)).toBe('pass');
  });

  it('is pass for a run with no gate at all, since nothing failed and nothing was hidden', () => {
    expect(verdictToken(run([], 0), false)).toBe('pass');
  });

  it('is pass when an intent gate was skipped for want of a contract', () => {
    // A skipped gate is in result.skipped and not in result.gates, and the
    // verdict sentence already says "nothing was checked" for it. It is not
    // a blocking finding and not a could-not-run, so it does not by itself
    // move the token off pass.
    const skipped = run([gate({})], 0, {
      skipped: [
        { role: 'intent', product: 'intent-guard', reason: 'no-contract', detail: 'no contract' },
      ],
    });
    expect(verdictToken(skipped, false)).toBe('pass');
    const onlySkipped = run([], 0, {
      skipped: [
        { role: 'intent', product: 'intent-guard', reason: 'no-contract', detail: 'no contract' },
      ],
    });
    expect(verdictToken(onlySkipped, false)).toBe('pass');
  });

  it('is blocked (N) at exit 1, counting blocking findings on enforced gates only', () => {
    const gates = [
      blockedGate(),
      gate({ role: 'intent', product: 'intent-guard', enforce: false, exitCode: 1, findings: [blockingFinding] }),
    ];
    expect(verdictToken(run(gates, 1), false)).toBe('blocked (2)');
  });

  it('is advisory-blocked (N) when --advisory turned exit 1 into exit 0', () => {
    expect(verdictToken(run([blockedGate()], 1), true)).toBe('advisory-blocked (2)');
  });

  it('never reports blocked (0): an enforced gate that exited non-zero with no blocking finding counts as one', () => {
    const mismatch = gate({ exitCode: 1, findings: [reportFinding] });
    expect(verdictToken(run([mismatch], 1), false)).toBe('blocked (1)');
    expect(verdictToken(run([mismatch], 1), true)).toBe('advisory-blocked (1)');
  });

  it('is unenforced-findings (N) at exit 0 when an enforce: false gate has blocking findings', () => {
    const unenforced = gate({ role: 'intent', product: 'intent-guard', enforce: false, exitCode: 1, findings: [blockingFinding, blockingFinding, blockingFinding] });
    expect(verdictToken(run([gate({}), unenforced], 0), false)).toBe('unenforced-findings (3)');
  });

  it('is unenforced-findings, not advisory-blocked, when --advisory is on and only unenforced gates blocked', () => {
    const unenforced = gate({ role: 'intent', product: 'intent-guard', enforce: false, exitCode: 1, findings: [blockingFinding] });
    expect(verdictToken(run([gate({}), unenforced], 0), true)).toBe('unenforced-findings (1)');
  });

  it('counts an unenforced gate that could not run once, not twice', () => {
    // Its findings list carries the umbrella's own blocking gate-missing
    // finding; counting that as well would report one broken gate as two.
    expect(verdictToken(run([gate({}), brokenGate(false)], 0), false)).toBe('unenforced-findings (1)');
  });

  it('adds unenforced blocking findings and unenforced gates that could not run', () => {
    const unenforced = gate({ role: 'dependencies', enforce: false, exitCode: 1, findings: [blockingFinding, blockingFinding] });
    expect(verdictToken(run([unenforced, brokenGate(false, 'intent')], 0), false)).toBe(
      'unenforced-findings (3)'
    );
  });

  it('counts an unenforced gate that exited non-zero with no blocking finding as one', () => {
    const unenforced = gate({ enforce: false, exitCode: 1, findings: [] });
    expect(verdictToken(run([unenforced], 0), false)).toBe('unenforced-findings (1)');
  });

  it('is could-not-run at exit 2', () => {
    expect(verdictToken(run([brokenGate(true)], 2), false)).toBe('could-not-run');
  });

  it('is could-not-run at exit 2 even with --advisory, which never touches exit 2', () => {
    expect(verdictToken(run([brokenGate(true)], 2), true)).toBe('could-not-run');
  });

  it('is could-not-run for a refused trust base', () => {
    const refused = run([], 2, {
      trustBase: { ref: 'origin/main', policyChanged: false, refusal: 'no such ref.' },
    });
    expect(verdictToken(refused, false)).toBe('could-not-run');
    expect(verdictToken(refused, true)).toBe('could-not-run');
  });

  it('ranks could-not-run above blocked when both are present', () => {
    expect(verdictToken(run([blockedGate(), brokenGate(true)], 2), false)).toBe('could-not-run');
  });

  it('ranks blocked above unenforced-findings when both are present', () => {
    const unenforced = gate({ role: 'intent', product: 'intent-guard', enforce: false, exitCode: 1, findings: [blockingFinding] });
    expect(verdictToken(run([blockedGate(), unenforced], 1), false)).toBe('blocked (2)');
    expect(verdictToken(run([blockedGate(), unenforced], 1), true)).toBe('advisory-blocked (2)');
  });

  it('ranks could-not-run above an unenforced finding', () => {
    const unenforced = gate({ role: 'intent', product: 'intent-guard', enforce: false, exitCode: 1, findings: [blockingFinding] });
    expect(verdictToken(run([brokenGate(true), unenforced], 2), false)).toBe('could-not-run');
  });

  it('fails closed on an exit code outside 0, 1 and 2', () => {
    expect(verdictToken(run([gate({})], 7), false)).toBe('could-not-run');
  });
});

describe('the verdict-token line in the text report', () => {
  it('is the second line, directly under the version line', () => {
    const text = renderText(run([blockedGate()], 1), { version: '9.9.9', advisory: true });
    const lines = text.split('\n');
    expect(lines[0]).toBe('conductor 9.9.9');
    expect(lines[1]).toBe('verdict-token: advisory-blocked (2)');
  });

  it('is the first line when no version is given', () => {
    const lines = renderText(run([blockedGate()], 1)).split('\n');
    expect(lines[0]).toBe('verdict-token: blocked (2)');
  });

  it('is on the refused compact report too, under the version', () => {
    const refused = run([], 2, {
      trustBase: { ref: 'origin/main', policyChanged: false, refusal: 'no such ref.' },
    });
    const lines = renderText(refused, { version: '9.9.9', compact: true }).split('\n');
    expect(lines[0]).toBe('conductor 9.9.9');
    expect(lines[1]).toBe('verdict-token: could-not-run');
  });

  it('is on the refused full report too', () => {
    const refused = run([], 2, {
      trustBase: { ref: 'origin/main', policyChanged: false, refusal: 'no such ref.' },
    });
    const lines = renderText(refused, { version: '9.9.9' }).split('\n');
    expect(lines[1]).toBe('verdict-token: could-not-run');
  });

  it('leaves the closing verdict sentence exactly as it was', () => {
    const text = renderText(run([blockedGate()], 1), { version: '9.9.9', advisory: true });
    const last = text.trimEnd().split('\n').pop() as string;
    expect(last).toMatch(/^verdict: exit 0, 2 blocking finding\(s\)/);
  });

  it('is on a verbose clean run as pass, and absent from the one-line clean summary', () => {
    const verbose = renderText(run([gate({})], 0), { version: '9.9.9', verbose: true });
    expect(verbose.split('\n')[1]).toBe('verdict-token: pass');
    expect(renderText(run([gate({})], 0), { version: '9.9.9' }).trimEnd().split('\n')).toHaveLength(1);
  });
});
