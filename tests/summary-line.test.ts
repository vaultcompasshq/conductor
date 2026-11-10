// The per-gate summary line and the run-level fixed lines (issue 105): the
// block at the top of every full text report that the Action copies to the
// step summary and the comment poster lifts above the collapsed report.
//
// Every line in it is a CLOSED SHAPE: conductor's own vocabulary (roles,
// products, could-not-run reasons, stages) and numbers, plus a version cut
// to version characters. Nothing a pull request writes reaches one.

import { describe, expect, it } from '@jest/globals';

import type { Finding } from '../src/envelope.js';
import type { CouldNotRunReason, GateOutcome } from '../src/gate-runner.js';
import {
  FINDINGS_NAMED,
  FINDING_LINE_MAX,
  findingLogLines,
  findingSummaryLines,
  gateSummaryLine,
  gateSummaryLines,
  renderText,
  runLevelLines,
} from '../src/output-text.js';
import { GATE_ROLES, GATE_STAGES, PRODUCTS, type Policy } from '../src/policy.js';
import { type RunResult, refusedTrustBase } from '../src/run.js';

function outcome(overrides: Partial<GateOutcome>): GateOutcome {
  return {
    role: 'dependencies',
    product: 'dep-guard',
    productVersion: '0.20.0',
    argv: ['scan'],
    binary: null,
    exitCode: 0,
    durationMs: 5,
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

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    schemaVersion: 1,
    product: 'vault-guard',
    productVersion: '1.13.3',
    ruleId: 'vault-guard/aws-key',
    severity: 'high',
    severityIsDerived: false,
    blocking: true,
    message: 'an AWS access key',
    subject: { kind: 'location', file: 'src/a.ts', line: 3, column: 1 },
    fingerprint: null,
    details: {},
    ...overrides,
  };
}

function result(gates: GateOutcome[], exitCode: number, extra: Partial<RunResult> = {}): RunResult {
  const findings = gates.flatMap((gate) => gate.findings);
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-10T00:00:00.000Z',
    gates,
    deferred: [],
    skipped: [],
    excluded: [],
    treeUnchanged: [],
    findings,
    trustBase: null,
    proposals: [],
    summary: { blocking: findings.filter((each) => each.blocking).length, byProduct: {}, bySeverity: {} },
    exitCode,
    ...extra,
  };
}

const POLICY: Policy = {
  version: 1,
  gates: {
    dependencies: {
      role: 'dependencies',
      product: 'dep-guard',
      enabled: true,
      stage: 'commit',
      enforce: false,
      excludedByCli: false,
      options: {},
    },
    secrets: {
      role: 'secrets',
      product: 'vault-guard',
      enabled: true,
      stage: 'commit',
      enforce: true,
      excludedByCli: false,
      options: {},
    },
  },
  report: { format: 'text' },
} as Policy;

const REFUSAL = 'the ref does not resolve. Nothing was checked.';

describe('the per-gate summary line (issue 105)', () => {
  it('says ran, with the gate version, the exit code and the blocking count', () => {
    expect(gateSummaryLine(outcome({}))).toBe('gate dependencies (dep-guard 0.20.0): ran, exit 0, 0 blocking');
    expect(
      gateSummaryLine(
        outcome({
          role: 'secrets',
          product: 'vault-guard',
          productVersion: '1.13.3',
          exitCode: 1,
          findings: [finding(), finding(), finding({ blocking: false })],
        })
      )
    ).toBe('gate secrets (vault-guard 1.13.3): ran, exit 1, 2 blocking');
  });

  it('says not enforced on a gate whose verdict does not reach the exit code', () => {
    expect(gateSummaryLine(outcome({ enforce: false, exitCode: 1, findings: [finding()] }))).toBe(
      'gate dependencies (dep-guard 0.20.0): ran, exit 1, 1 blocking, not enforced'
    );
  });

  it('says checked nothing for a gate that ran and examined nothing, never a bare ran', () => {
    const intent = outcome({
      role: 'intent',
      product: 'intent-guard',
      productVersion: '1.10.6',
      run: { failOn: null, suppressed: 0, ignored: 0, diagnostics: [], details: { contractFound: false } },
    });
    expect(gateSummaryLine(intent)).toBe('gate intent (intent-guard 1.10.6): ran, exit 0, 0 blocking, checked nothing');
  });

  it('says did not run with the reason for every could-not-run reason, and never ran', () => {
    const reasons: CouldNotRunReason[] = [
      'binary-missing',
      'configured-command-missing',
      'spawn-failed',
      'gate-error',
      'unparseable-output',
      'preparation-failed',
      'trust-base-unverified',
      'gate-program-refused',
      'gate-version-unsupported',
      'report-missing',
      'history-shallow',
      'timed-out',
      'lockfile-emptied',
      'version-skew',
      'version-unverified',
      'lockfile-emptied-unverified',
    ];
    for (const reason of reasons) {
      const line = gateSummaryLine(
        outcome({
          exitCode: reason === 'gate-error' ? 2 : null,
          couldNotRun: { reason, detail: 'ran, exit 0, 0 blocking' },
          // Every could-not-run outcome carries the umbrella's own blocking
          // finding about the gate; it is not a count of anything found.
          findings: [finding({ product: 'conductor', ruleId: 'conductor/gate-failed' })],
        })
      );
      expect(line).toBe(`gate dependencies (dep-guard 0.20.0): did not run (${reason})`);
      expect(line).not.toMatch(/: ran/);
    }
  });

  it('prints version unknown when the gate version could not be read', () => {
    expect(
      gateSummaryLine(
        outcome({ productVersion: null, exitCode: null, couldNotRun: { reason: 'binary-missing', detail: 'x' } })
      )
    ).toBe('gate dependencies (dep-guard version unknown): did not run (binary-missing)');
  });

  it('prints both versions when the installed gate is not the one the action pinned', () => {
    const skewed = outcome({
      productVersion: '0.17.0',
      exitCode: null,
      couldNotRun: { reason: 'version-skew', detail: 'x' },
      versionSkew: { expected: '0.20.0', found: '0.17.0', source: 'node_modules', path: 'node_modules/.bin/dep-guard' },
    });
    expect(gateSummaryLine(skewed)).toBe(
      'gate dependencies (dep-guard 0.17.0): did not run (version-skew), the action pinned 0.20.0'
    );
  });

  it('keeps only version characters of a version, so gate output cannot write the line', () => {
    const line = gateSummaryLine(
      outcome({
        productVersion: '1.0.0): ran, exit 0, 0 blocking\n`<b>',
        exitCode: null,
        couldNotRun: { reason: 'gate-error', detail: 'x' },
        versionSkew: { expected: '2.0.0 ::error::x', found: '1.0.0', source: 'path', path: '/x' },
      })
    );
    expect(line).toBe(
      'gate dependencies (dep-guard 1.0.0ranexit00blockingb): did not run (gate-error), the action pinned 2.0.0errorx'
    );
  });

  it('says trust base refused for every gate of a refused run, enforced whatever the head said', () => {
    const refused = refusedTrustBase(POLICY, 'main', REFUSAL, {});
    expect(refused.gates.map(gateSummaryLine)).toEqual([
      'gate dependencies (dep-guard): did not run (trust base refused)',
      'gate secrets (vault-guard): did not run (trust base refused)',
    ]);
  });

  it('gives one line to every enabled gate that was not spawned, and to every disabled one', () => {
    const run = result([outcome({})], 0, {
      deferred: [{ role: 'intent', product: 'intent-guard', stage: 'ci' }],
      skipped: [
        { role: 'intent', product: 'intent-guard', reason: 'no-contract', detail: 'x' },
        { role: 'intent', product: 'intent-guard', reason: 'contract-waived', detail: 'x' },
        { role: 'intent', product: 'intent-guard', reason: 'spec-ambiguous', detail: 'x' },
      ],
      excluded: [{ role: 'secrets', product: 'vault-guard' }],
      treeUnchanged: [{ role: 'secrets', product: 'vault-guard' }],
      disabled: [{ role: 'vulnerabilities', product: 'osv-scanner' }],
    });
    expect(gateSummaryLines(run)).toEqual([
      'gate dependencies (dep-guard 0.20.0): ran, exit 0, 0 blocking',
      'gate intent (intent-guard): skipped (deferred to stage ci)',
      'gate intent (intent-guard): skipped (no contract)',
      'gate intent (intent-guard): skipped (spec waived)',
      'gate intent (intent-guard): skipped (spec ambiguous)',
      'gate secrets (vault-guard): skipped (--gate did not name it)',
      'gate secrets (vault-guard): skipped (head tree equals the base tree)',
      'gate vulnerabilities (osv-scanner): disabled (enabled: false)',
    ]);
  });
});

/**
 * The shape the Action and the comment poster accept, written out here a
 * third time on purpose: a line this file's renderer produces that this
 * pattern does not match is a line neither of them would copy.
 */
const ROLE = `(${GATE_ROLES.join('|')})`;
const PRODUCT = `(${PRODUCTS.join('|')})`;
const VERSION = '([0-9A-Za-z.+-]{1,64}|version unknown)';
const GATE_LINE = new RegExp(
  `^gate ${ROLE} \\(${PRODUCT}( ${VERSION})?\\): (` +
    'ran, (exit [0-9]{1,3}|no exit code), [0-9]{1,6} blocking(, checked nothing)?(, not enforced)?' +
    '|did not run \\(([a-z-]{1,40}|trust base refused)\\)(, the action pinned [0-9A-Za-z.+-]{1,64})?(, not enforced)?' +
    `|skipped \\((deferred to stage (${GATE_STAGES.join('|')})|no contract|spec waived|spec ambiguous|--gate did not name it|head tree equals the base tree)\\)` +
    '|disabled \\(enabled: false\\))$'
);

describe('the head block of the text report', () => {
  const blocked = result(
    [
      outcome({}),
      outcome({ role: 'secrets', product: 'vault-guard', productVersion: '1.13.3', exitCode: 1, findings: [finding()] }),
    ],
    1
  );

  it('puts one line per gate directly under the verdict token, before any gate text', () => {
    const lines = renderText(blocked, { version: '9.9.9' }).split('\n');
    expect(lines.slice(0, 7)).toEqual([
      'conductor 9.9.9',
      'verdict-token: blocked (1)',
      'gate dependencies (dep-guard 0.20.0): ran, exit 0, 0 blocking',
      'gate secrets (vault-guard 1.13.3): ran, exit 1, 1 blocking',
      'findings: 1 (1 blocking):',
      'finding: BLOCKING vault-guard vault-guard/aws-key src/a.ts:3: an AWS access key',
      'conductor run: 2 gate(s), 1 finding(s)',
    ]);
  });

  it('puts the run-level fixed lines above the per-gate lines', () => {
    const run = result([outcome({})], 0, {
      skipped: [
        {
          role: 'intent',
          product: 'intent-guard',
          reason: 'spec-ambiguous',
          detail: 'x',
          selection: { why: 'ambiguous', legacy: null } as never,
        },
      ],
    });
    const lines = renderText(run, { version: '9.9.9', verbose: true }).split('\n');
    expect(lines[2]).toBe('intent-spec: none chosen, two or more specs matched the branch equally');
    expect(lines[3]).toBe('gate dependencies (dep-guard 0.20.0): ran, exit 0, 0 blocking');
    expect(lines[4]).toBe('gate intent (intent-guard): skipped (spec ambiguous)');
  });

  it('leaves the one-line summary of a clean run without --verbose as it was', () => {
    const text = renderText(result([outcome({})], 0));
    expect(text.trimEnd().split('\n')).toHaveLength(1);
    expect(text).toMatch(/^conductor: clean, nothing blocked\./);
  });

  it('every line it prints for a gate matches the closed shape the Action accepts', () => {
    const everything = result(
      [
        outcome({}),
        outcome({ enforce: false, exitCode: 1, findings: [finding()] }),
        outcome({ productVersion: null, exitCode: null, couldNotRun: { reason: 'binary-missing', detail: 'x' } }),
        outcome({
          exitCode: null,
          enforce: false,
          couldNotRun: { reason: 'version-skew', detail: 'x' },
          versionSkew: { expected: '0.20.0', found: '0.17.0', source: 'path', path: '/x' },
        }),
        outcome({ productVersion: '`<script>\n::error::', exitCode: 0 }),
      ],
      2,
      {
        deferred: [{ role: 'intent', product: 'intent-guard', stage: 'ci' }],
        skipped: [{ role: 'intent', product: 'intent-guard', reason: 'no-contract', detail: '`x`' }],
        excluded: [{ role: 'secrets', product: 'vault-guard' }],
        treeUnchanged: [{ role: 'secrets', product: 'vault-guard' }],
        disabled: [{ role: 'vulnerabilities', product: 'osv-scanner' }],
      }
    );
    const lines = [...gateSummaryLines(everything), ...refusedTrustBase(POLICY, 'main', REFUSAL, {}).gates.map(gateSummaryLine)];
    expect(lines).toHaveLength(12);
    for (const line of lines) {
      expect([line, GATE_LINE.test(line)]).toEqual([line, true]);
    }
  });
});

describe('new in this pull request (issue 102, first cut)', () => {
  const compared = (introduced: number, presentOnBase: number): GateOutcome =>
    outcome({
      role: 'vulnerabilities',
      product: 'osv-scanner',
      exitCode: 1,
      baseComparison: { ref: 'main', policy: 'report', introduced, presentOnBase, unavailable: [], otherVerdicts: [] },
    } as Partial<GateOutcome>);

  it('is a run-level line from the split the vulnerabilities gate already computed', () => {
    expect(runLevelLines(result([outcome({}), compared(2, 5)], 1))).toEqual([
      'new in this pull request: 2 (vulnerabilities gate; 5 already on the base)',
    ]);
    expect(runLevelLines(result([compared(0, 0)], 0))).toEqual([
      'new in this pull request: 0 (vulnerabilities gate; 0 already on the base)',
    ]);
  });

  it('is absent when no gate compared with the base, since nothing was split', () => {
    expect(runLevelLines(result([outcome({ exitCode: 1, findings: [finding()] })], 1))).toEqual([]);
  });
});

describe('the named findings (issue 144)', () => {
  const secrets = (findings: Finding[], overrides: Partial<GateOutcome> = {}): GateOutcome =>
    outcome({ role: 'secrets', product: 'vault-guard', productVersion: '1.13.3', exitCode: 1, findings, ...overrides });

  it('names each blocking finding: the gate, the rule, where, and the reason; counts the rest', () => {
    const run = result(
      [
        secrets([finding()]),
        outcome({
          exitCode: 1,
          findings: [
            finding({
              product: 'dep-guard',
              ruleId: 'dep-guard/recent-publish',
              blocking: false,
              severity: 'low',
              message: 'published 2026-11-08, 2 days ago',
              subject: { kind: 'package', name: 'left-pad', manifest: 'package.json' },
              details: { version: '1.3.0' },
            }),
          ],
        }),
      ],
      1
    );
    expect(findingSummaryLines(run)).toEqual([
      'findings: 2 (1 blocking):',
      'finding: BLOCKING vault-guard vault-guard/aws-key src/a.ts:3: an AWS access key',
    ]);
  });

  const low = (count: number): Finding[] =>
    Array.from({ length: count }, (_, i) => finding({ blocking: false, severity: 'low', message: `low ${i}` }));

  it('names only what blocks, the first ten of them, then says how many more block', () => {
    const blocking = (count: number): Finding[] => Array.from({ length: count }, (_, i) => finding({ message: `blocking ${i}` }));
    // Fewer block than the limit: all of them, no "the first", no "more",
    // however many findings do not block.
    expect(findingSummaryLines(result([secrets([...low(30), ...blocking(6)])], 1))).toEqual([
      'findings: 36 (6 blocking):',
      ...Array.from({ length: 6 }, (_, i) => `finding: BLOCKING vault-guard vault-guard/aws-key src/a.ts:3: blocking ${i}`),
    ]);
    // More block than the limit.
    const lines = findingSummaryLines(result([secrets([...low(30), ...blocking(13)])], 1));
    expect(lines).toHaveLength(12);
    expect(lines[0]).toBe('findings: 43 (13 blocking), the first 10:');
    expect(lines.slice(1, 11).every((line) => line.startsWith('finding: BLOCKING '))).toBe(true);
    expect(lines[11]).toBe('and 3 more blocking');
    expect(FINDINGS_NAMED).toBe(10);
  });

  it('is the count line alone, with no colon and no list, when nothing blocks', () => {
    const run = result([secrets(low(77), { exitCode: 0 })], 0);
    expect(findingSummaryLines(run)).toEqual(['findings: 77 (0 blocking)']);
    expect(findingLogLines(run)).toEqual(['conductor: findings: 77 (0 blocking)']);
    expect(renderText(run, { version: '9.9.9', verbose: true }).split('\n').slice(2, 5)).toEqual([
      'gate secrets (vault-guard 1.13.3): ran, exit 0, 0 blocking',
      'findings: 77 (0 blocking)',
      'conductor run: 1 gate(s), 77 finding(s)',
    ]);
  });

  // "Blocking" is the gate's own mark on the finding. A gate with enforce:
  // false cannot change the exit code, and what it caught is still named.
  it('keeps the gate own blocking mark as the test on a gate that is not enforced', () => {
    const run = result([secrets([finding(), ...low(2)], { enforce: false })], 0);
    expect(findingSummaryLines(run)).toEqual([
      'findings: 3 (1 blocking):',
      'finding: BLOCKING vault-guard vault-guard/aws-key src/a.ts:3: an AWS access key',
    ]);
  });

  it('takes its heading and its limit as parameters', () => {
    const lines = findingSummaryLines(result([secrets([finding(), finding(), finding()])], 1), {
      heading: 'would block once the policy is on the base',
      limit: 2,
    });
    expect(lines[0]).toBe('would block once the policy is on the base: 3 (3 blocking), the first 2:');
    expect(lines[3]).toBe('and 1 more blocking');
  });

  // T and B count findings, K and M count lines. One advisory on one package
  // is one line however many lockfiles carry it, so the two units differ here
  // and K and M have to agree with each other, not with B.
  it('counts the lines shown and the lines left in the same unit when an advisory spans lockfiles', () => {
    const advisory = (id: number, manifest: string, blocking = true): Finding =>
      finding({
        product: 'osv-scanner',
        ruleId: `osv-scanner/GHSA-${id}`,
        message: 'prototype pollution',
        blocking,
        subject: { kind: 'package', name: 'lodash', manifest },
        details: { version: '4.17.20', fixedVersion: '4.17.21' },
      });
    const gate = outcome({
      role: 'vulnerabilities',
      product: 'osv-scanner',
      exitCode: 1,
      findings: [
        // Four blocking advisories, each in three lockfiles: 12 findings, 4 lines.
        ...[0, 1, 2, 3].flatMap((id) => ['a', 'b', 'c'].map((dir) => advisory(id, `${dir}/package-lock.json`))),
        // One that does not block, in two lockfiles: 2 findings, never a line.
        advisory(9, 'a/package-lock.json', false),
        advisory(9, 'b/package-lock.json', false),
      ],
    });
    const all = findingSummaryLines(result([gate], 1));
    expect(all[0]).toBe('findings: 14 (12 blocking):');
    expect(all).toHaveLength(5);
    const capped = findingSummaryLines(result([gate], 1), { limit: 3 });
    expect(capped[0]).toBe('findings: 14 (12 blocking), the first 3:');
    expect(capped.slice(1, 4).every((line) => / 3 lockfiles /.test(line))).toBe(true);
    // 3 lines shown and 1 line left make the 4 blocking lines: not 12 - 3.
    expect(capped.slice(4)).toEqual(['and 1 more blocking']);
  });

  it('names nothing on a clean run, and nothing for a gate that could not run', () => {
    expect(findingSummaryLines(result([outcome({})], 0))).toEqual([]);
    const broken = outcome({
      exitCode: null,
      couldNotRun: { reason: 'binary-missing', detail: 'x' },
      findings: [finding({ product: 'conductor', ruleId: 'conductor/gate-missing' })],
    });
    expect(findingSummaryLines(result([broken], 2))).toEqual([]);
    expect(findingSummaryLines(refusedTrustBase(POLICY, 'main', REFUSAL, {}))).toEqual([]);
  });

  it('names one osv-scanner advisory once however many lockfiles carry it', () => {
    const advisory = (manifest: string): Finding =>
      finding({
        product: 'osv-scanner',
        ruleId: 'osv-scanner/GHSA-xxxx',
        message: 'prototype pollution',
        subject: { kind: 'package', name: 'lodash', manifest },
        details: { version: '4.17.20', fixedVersion: '4.17.21' },
      });
    const gate = outcome({
      role: 'vulnerabilities',
      product: 'osv-scanner',
      exitCode: 1,
      findings: [advisory('a/package-lock.json'), advisory('b/package-lock.json'), advisory('c/package-lock.json')],
    });
    expect(findingSummaryLines(result([gate], 1))).toEqual([
      'findings: 3 (3 blocking):',
      'finding: BLOCKING osv-scanner osv-scanner/GHSA-xxxx lodash@4.17.20 3 lockfiles fix 4.17.21: prototype pollution',
    ]);
  });

  // The injection cases, end to end: every field of a finding is text a pull
  // request can choose, and the line is printed where markdown is rendered.
  const HOSTILE = '`\n```\n</details>\n<img src=x onerror=1>\n::error::pwn\r##[error]pwn‮ [x](http://e) &amp;';

  it('keeps every hostile field on one printable line with no backtick, tag or workflow command', () => {
    const hostile = [
      finding({ ruleId: HOSTILE, message: HOSTILE, subject: { kind: 'location', file: HOSTILE, line: 1, column: 1 } }),
      finding({ product: HOSTILE, subject: { kind: 'package', name: HOSTILE, manifest: HOSTILE }, details: { version: HOSTILE } }),
      finding({ subject: { kind: 'paths', paths: [HOSTILE, HOSTILE, HOSTILE, HOSTILE, HOSTILE] } }),
      finding({ subject: { kind: 'contract', category: HOSTILE } }),
    ];
    const lines = findingSummaryLines(result([secrets(hostile)], 1));
    expect(lines).toHaveLength(5);
    for (const line of lines.slice(1)) {
      expect(line).toMatch(/^finding: BLOCKING [\x20-\x7e]+$/);
      expect(line).not.toMatch(/[`<>&]/);
      expect(line).not.toContain('::');
      expect(line).not.toContain('##[');
      expect(line.length).toBeLessThanOrEqual(FINDING_LINE_MAX);
    }
    // And none of them is, or contains at its start, a line of another kind.
    expect(lines.filter((line) => /^(gate |verdict-token|conductor|trust-base|present-on-base|intent-spec)/.test(line))).toEqual([]);
  });

  it('caps a long field rather than the line running on', () => {
    const long = finding({ message: 'm'.repeat(5000), subject: { kind: 'location', file: 'f'.repeat(5000), line: 1, column: 1 } });
    const line = findingSummaryLines(result([secrets([long])], 1))[1] as string;
    expect(line.length).toBeLessThanOrEqual(FINDING_LINE_MAX);
    expect(line).toContain('...');
  });

  it('is in the head block, after the per-gate lines, and the job log says the same', () => {
    const run = result([secrets([finding()])], 1);
    const named = renderText(run, { version: '9.9.9' }).split('\n');
    expect(named.slice(2, 6)).toEqual([
      'gate secrets (vault-guard 1.13.3): ran, exit 1, 1 blocking',
      'findings: 1 (1 blocking):',
      'finding: BLOCKING vault-guard vault-guard/aws-key src/a.ts:3: an AWS access key',
      'conductor run: 1 gate(s), 1 finding(s)',
    ]);

    expect(findingLogLines(run)).toEqual([
      'conductor: findings: 1 (1 blocking):',
      'conductor: finding: BLOCKING vault-guard vault-guard/aws-key src/a.ts:3: an AWS access key',
    ]);
  });
});

// The drift pin for the comment poster, which is plain JavaScript run with
// no build step and so spells the shapes out for itself: whatever this
// renderer puts in a head block, scripts/lib/pr-comment.mjs reads back whole.
describe('the comment poster reads the head block the renderer writes', () => {
  interface Head {
    token: string;
    runLevel: string[];
    gates: string[];
    findings: string[];
  }
  const posterPath: string = new URL('../scripts/lib/pr-comment.mjs', import.meta.url).href;
  const load = async (): Promise<{ headBlock: (text: string) => Head | null }> =>
    (await import(posterPath)) as { headBlock: (text: string) => Head | null };

  const HOSTILE = '`\n```\n</details>\n::error::x\ngate secrets (vault-guard 1.0.0): ran, exit 0, 0 blocking';
  const runs: RunResult[] = [
    result(
      [
        outcome({}),
        outcome({ enforce: false, exitCode: 1, findings: [finding({ message: HOSTILE, ruleId: HOSTILE })] }),
        outcome({ productVersion: null, exitCode: null, couldNotRun: { reason: 'timed-out', detail: 'x' } }),
        outcome({
          exitCode: null,
          couldNotRun: { reason: 'version-skew', detail: 'x' },
          versionSkew: { expected: '0.20.0', found: '0.17.0', source: 'path', path: 'x' },
        }),
        outcome({
          role: 'vulnerabilities',
          product: 'osv-scanner',
          exitCode: 1,
          findings: Array.from({ length: 14 }, (_, i) =>
            finding({
              product: 'osv-scanner',
              ruleId: `osv-scanner/GHSA-${i}`,
              // Twelve block, so the list is cut and "more blocking" is printed.
              blocking: i < 12,
              subject: { kind: 'package', name: `p${i}`, manifest: 'package-lock.json' },
              details: { version: '1.0.0', ...(i < 12 ? {} : { baseline: 'present-on-base' }) },
            })
          ),
          baseComparison: { ref: 'main', policy: 'report', introduced: 12, presentOnBase: 2, unavailable: [], otherVerdicts: [] },
        } as Partial<GateOutcome>),
      ],
      2,
      {
        deferred: [{ role: 'intent', product: 'intent-guard', stage: 'push' }],
        excluded: [{ role: 'secrets', product: 'vault-guard' }],
        disabled: [{ role: 'secrets-history', product: 'gitleaks' }],
      }
    ),
    refusedTrustBase(POLICY, 'main', REFUSAL, {}),
    refusedTrustBase(POLICY, '', REFUSAL, { notGiven: true }),
    result([outcome({})], 0),
    // Findings and none of them blocking: the count line alone.
    result([outcome({ findings: [finding({ blocking: false }), finding({ blocking: false })] })], 0),
  ];

  it('for a mixed run, a refused run, a run with no trust base given, and a clean one', async () => {
    const { headBlock } = await load();
    for (const run of runs) {
      for (const compact of [false, true]) {
        const head = headBlock(renderText(run, { version: '0.19.0-rc.1', verbose: true, compact }));
        expect(head).not.toBeNull();
        expect(head?.runLevel).toEqual(runLevelLines(run));
        expect(head?.gates).toEqual(gateSummaryLines(run));
        expect(head?.findings).toEqual(findingSummaryLines(run));
      }
    }
    // And the mixed run really does exercise all three kinds of line.
    expect(runLevelLines(runs[0] as RunResult)).toHaveLength(2);
    expect(findingSummaryLines(runs[0] as RunResult)).toHaveLength(12);
    expect(findingSummaryLines(runs[0] as RunResult).at(-1)).toBe('and 3 more blocking');
    expect(findingSummaryLines(runs[4] as RunResult)).toEqual(['findings: 2 (0 blocking)']);
  });
});

describe('a refused trust base (issue 105, and the two wording defects)', () => {
  const refused = refusedTrustBase(POLICY, 'main', REFUSAL, {});

  it('has a fixed run-level line that names no ref and carries no refusal text', () => {
    expect(runLevelLines(refused)).toEqual(['trust-base: refused, no rules were read and no gate ran']);
    expect(runLevelLines(refusedTrustBase(POLICY, '', REFUSAL, { notGiven: true }))).toEqual([
      'trust-base: not given on a pull-request job, no rules were read and no gate ran',
    ]);
    expect(runLevelLines(result([outcome({})], 0))).toEqual([]);
  });

  it('prints the refusal detail once, each gate as did not run, and no gate section', () => {
    const text = renderText(refused, { version: '9.9.9' });
    const lines = text.split('\n');
    expect(lines.slice(0, 6)).toEqual([
      'conductor 9.9.9',
      'verdict-token: could-not-run',
      'trust-base: refused, no rules were read and no gate ran',
      'gate dependencies (dep-guard): did not run (trust base refused)',
      'gate secrets (vault-guard): did not run (trust base refused)',
      'conductor: refused the trust base "main". Nothing was checked.',
    ]);
    expect(text.split('does not resolve').length - 1).toBe(1);
    expect(text).not.toContain('DID NOT RUN');
    expect(text).not.toContain('BLOCKING');
  });

  it('never says rules came from the ref, since none were read', () => {
    const text = renderText(refused, { version: '9.9.9' });
    expect(text).not.toMatch(/rules from/);
    expect(text).not.toMatch(/control change\(s\)/);
    expect(text).toContain('  pull-request mode: the trust base was refused, so no rules were read.');
  });

  it('never counts gates and findings on a run where nothing ran', () => {
    const text = renderText(refused, { version: '9.9.9' });
    expect(text).not.toMatch(/gate\(s\), \d+ finding\(s\)/);
    expect(text).toContain('\nconductor run: no gate ran and nothing was checked\n');
  });

  it('carries the per-gate lines in the compact body the comment gets', () => {
    const lines = renderText(refused, { version: '9.9.9', compact: true }).trimEnd().split('\n');
    expect(lines).toEqual([
      'conductor 9.9.9',
      'verdict-token: could-not-run',
      'trust-base: refused, no rules were read and no gate ran',
      'gate dependencies (dep-guard): did not run (trust base refused)',
      'gate secrets (vault-guard): did not run (trust base refused)',
      'verdict: exit 2, the trust base "main" could not be used, so no gate ran and nothing here is a result of any kind.',
      'conductor: refused the trust base "main". Nothing was checked.',
      `  ${REFUSAL}`,
    ]);
  });
});
