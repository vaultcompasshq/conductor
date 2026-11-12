// The proposal outcome (issue 101) as the renderers and the exit code see it:
// the one function that writes the exit code, the token's place in the order,
// the three run-level lines, and the drift pins for the two other spellings
// of the closed shapes (the comment poster here; the gates step in
// tests/action-adoption-proposal.test.ts).

import { describe, expect, it } from '@jest/globals';

import type { Finding } from '../src/envelope.js';
import type { GateOutcome } from '../src/gate-runner.js';
import {
  FINDINGS_HEADINGS,
  NO_POLICY_LINE,
  POLICY_REMOVED_LINE,
  PROPOSAL_FINDINGS_HEADING,
  findingLogLines,
  findingSummaryLines,
  gateSummaryLines,
  jobLogSummary,
  proposalLine,
  renderText,
  runLevelLines,
  verdictToken,
} from '../src/output-text.js';
import { renderSarif } from '../src/output-sarif.js';
import type { Policy } from '../src/policy.js';
import { type RunResult, asProposal, isProposal, ranProposedPolicy, refusedTrustBase } from '../src/run.js';

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

const PROPOSED = { ref: 'main', policyChanged: true, refusal: null, proposal: { reason: 'no-policy-on-base' as const } };

/** A run as runAll returns it for a proposed policy, before asProposal. */
function ran(gates: GateOutcome[], exitCode: number, trustBase: RunResult['trustBase'] = PROPOSED): RunResult {
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
    trustBase,
    proposals: [],
    summary: { blocking: findings.filter((each) => each.blocking).length, byProduct: {}, bySeverity: {} },
    exitCode,
  };
}

/** The closing sentence: the last line of the full report. */
const verdict = (run: RunResult, advisory: boolean): string =>
  renderText(run, { version: '0.19.0', verbose: true, advisory }).trimEnd().split('\n').at(-1) ?? '';

const SECRETS = { role: 'secrets', product: 'vault-guard', productVersion: '1.13.3' } as const;
const blockingGate = (overrides: Partial<GateOutcome> = {}): GateOutcome =>
  outcome({ ...SECRETS, exitCode: 1, findings: [finding(), finding({ ruleId: 'vault-guard/github-token' })], ...overrides });
const brokenGate = (overrides: Partial<GateOutcome> = {}): GateOutcome =>
  outcome({ exitCode: null, productVersion: null, couldNotRun: { reason: 'binary-missing', detail: 'not on PATH' }, ...overrides });

const POLICY: Policy = {
  version: 1,
  gates: {
    secrets: { role: 'secrets', product: 'vault-guard', enabled: true, stage: 'commit', enforce: true, excludedByCli: false, options: {} },
  },
  report: { format: 'text' },
} as Policy;

describe('asProposal: the one place a proposal exit code is written', () => {
  it('is 0 whatever the gates found, when every enforced gate ran', () => {
    expect(asProposal(ran([outcome({})], 0)).exitCode).toBe(0);
    expect(asProposal(ran([outcome({}), blockingGate()], 1)).exitCode).toBe(0);
    expect(asProposal(ran([], 0)).exitCode).toBe(0);
  });

  it('is 2 when a gate the proposed policy enforces could not run, alone or beside findings', () => {
    expect(asProposal(ran([brokenGate()], 2)).exitCode).toBe(2);
    expect(asProposal(ran([brokenGate(), blockingGate()], 2)).exitCode).toBe(2);
    // Even if the composed code handed in were wrong, the gate list decides.
    expect(asProposal(ran([brokenGate()], 0)).exitCode).toBe(2);
    expect(asProposal(ran([brokenGate()], 1)).exitCode).toBe(2);
  });

  it('keeps a composed code that is neither 0 nor 1 as could-not-run', () => {
    expect(asProposal(ran([outcome({})], 2)).exitCode).toBe(2);
    expect(asProposal(ran([outcome({})], 3)).exitCode).toBe(2);
  });

  it('is 0 when the only gate that could not run has enforce: false', () => {
    expect(asProposal(ran([brokenGate({ enforce: false }), blockingGate()], 1)).exitCode).toBe(0);
  });

  it('throws on a run that is not a run of a proposed policy, so no other exit code can become 0', () => {
    expect(() => asProposal(ran([blockingGate()], 1, null))).toThrow(/not a run of a proposed policy/);
    expect(() => asProposal(ran([blockingGate()], 1, { ref: 'main', policyChanged: false, refusal: null }))).toThrow();
    expect(() => asProposal(refusedTrustBase(POLICY, 'main', 'no.', {}))).toThrow();
    expect(() =>
      asProposal(ran([blockingGate()], 1, { ...PROPOSED, refusal: 'refused all the same' }))
    ).toThrow();
  });

  it('changes nothing but the exit code', () => {
    const before = ran([outcome({}), blockingGate()], 1);
    const { exitCode: _before, ...rest } = before;
    const { exitCode: _after, ...after } = asProposal(before);
    expect(after).toEqual(rest);
  });
});

describe('the proposal tokens', () => {
  it('is proposal (N), N the blocking findings on enforced gates', () => {
    expect(verdictToken(asProposal(ran([outcome({}), blockingGate()], 1)), false)).toBe('proposal (2)');
    expect(verdictToken(asProposal(ran([outcome({})], 0)), false)).toBe('proposal (0)');
  });

  it('never counts an unenforced gate, or a gate that could not run, in N', () => {
    const run = asProposal(ran([blockingGate({ enforce: false }), brokenGate({ enforce: false }), outcome({})], 0));
    expect(verdictToken(run, false)).toBe('proposal (0)');
  });

  it('counts a gate that exited blocked with no finding marked as one, as blocked (N) does', () => {
    expect(verdictToken(asProposal(ran([outcome({ ...SECRETS, exitCode: 1 })], 1)), false)).toBe('proposal (1)');
  });

  it('is proposal-nothing-checked when no gate ran', () => {
    expect(verdictToken(asProposal(ran([], 0)), false)).toBe('proposal-nothing-checked');
  });

  it('comes after could-not-run and before every other token', () => {
    // An enforced gate could not run: could-not-run, never a proposal.
    expect(verdictToken(asProposal(ran([brokenGate(), blockingGate()], 2)), false)).toBe('could-not-run');
    // What would be blocked, advisory-blocked, unenforced-findings and pass
    // on an enforced run is a proposal token here.
    expect(verdictToken(asProposal(ran([blockingGate()], 1)), false)).toBe('proposal (2)');
    expect(verdictToken(asProposal(ran([blockingGate()], 1)), true)).toBe('proposal (2)');
    expect(verdictToken(asProposal(ran([blockingGate({ enforce: false })], 0)), false)).toBe('proposal (0)');
    expect(verdictToken(asProposal(ran([outcome({})], 0)), false)).not.toBe('pass');
  });

  it('is never given to a refused run that carries the marker by mistake', () => {
    const run = { ...refusedTrustBase(POLICY, 'main', 'no.', {}) };
    run.trustBase = { ...(run.trustBase as NonNullable<RunResult['trustBase']>), proposal: { reason: 'no-policy-on-base' } };
    expect(ranProposedPolicy(run)).toBe(false);
    expect(isProposal(run)).toBe(false);
    expect(verdictToken(run, false)).toBe('could-not-run');
    expect(runLevelLines(run)).not.toContain(proposalLine(0));
  });
});

describe('the proposal in the text report', () => {
  const proposal = asProposal(ran([outcome({}), blockingGate()], 1));

  it('puts the proposal line third, above every other run-level line', () => {
    const lines = renderText(proposal, { version: '0.19.0', verbose: false }).split('\n');
    expect(lines.slice(0, 3)).toEqual(['conductor 0.19.0', 'verdict-token: proposal (2)', proposalLine(2)]);
    expect(proposalLine(2)).toBe(
      'proposal: no .guardrails.yaml on the base branch, so nothing here was enforced; 2 would block once this policy is on the base branch'
    );
  });

  it('heads the named findings with what would block, in the report and the job log', () => {
    const text = renderText(proposal, { version: '0.19.0', verbose: true });
    expect(text).toContain(`\n${PROPOSAL_FINDINGS_HEADING}: 2 (2 blocking):\n`);
    expect(text).not.toMatch(/^findings: /m);
    expect(findingLogLines(proposal)[0]).toBe(`conductor: ${PROPOSAL_FINDINGS_HEADING}: 2 (2 blocking):`);
    expect(FINDINGS_HEADINGS).toEqual(['findings', PROPOSAL_FINDINGS_HEADING]);
  });

  it('closes with a sentence that is not a verdict and claims nothing ran clean', () => {
    expect(verdict(proposal, false)).toBe(
      'verdict: exit 0, proposal, not a verdict: there is no .guardrails.yaml on "main", so nothing here could be enforced. 2 would block once this policy is on the base branch.'
    );
    expect(verdict(proposal, true)).toBe(verdict(proposal, false));
    expect(verdict(asProposal(ran([], 0)), false)).toMatch(/ran no gate, so nothing was checked\.$/);
  });

  it('never prints the existing-findings section, on a proposal, its exit 2 form or a refused run', () => {
    // That section is for a blocked run with no base. A proposal always has
    // one, so the section stays out even if a result were handed its data.
    const existing = { history: 2, vulnerabilities: 0, predating: null, goneAtHead: null, stillAtHead: null };
    const forced = (run: RunResult): string =>
      renderText({ ...run, existingFindings: existing }, { version: '0.19.0', verbose: true });
    expect(forced(proposal)).not.toMatch(/existing findings:/);
    // Exit 1 as composed, before asProposal wrote the code.
    expect(forced(ran([outcome({}), blockingGate()], 1))).not.toMatch(/existing findings:/);
    expect(forced(asProposal(ran([blockingGate(), brokenGate()], 2)))).not.toMatch(/existing findings:/);
    const refused = refusedTrustBase(POLICY, 'main', 'no.', {});
    expect(forced({ ...refused, exitCode: 1 })).not.toMatch(/existing findings:/);
    // The control: the same data on a blocked run with no base does print.
    expect(forced(ran([outcome({}), blockingGate()], 1, null))).toMatch(/^existing findings: 2 blocking/m);
  });

  it('never says the rules came from the ref', () => {
    const text = renderText(proposal, { version: '0.19.0', verbose: true });
    expect(text).not.toMatch(/rules from main/);
    expect(text).toMatch(/pull-request mode: no policy on main; this run previews the policy this pull request adds\. 0 control change\(s\)/);
  });

  it('labels the job-log count', () => {
    expect(jobLogSummary(proposal)).toBe('proposal, no policy on "main": 2 gate(s), 2 finding(s)');
    expect(jobLogSummary(ran([outcome({})], 0, null))).toBe('1 gate(s), 0 finding(s)');
  });

  it('prints no proposal line and no proposal sentence when an enforced gate could not run', () => {
    const broken = asProposal(ran([brokenGate(), blockingGate()], 2));
    const text = renderText(broken, { version: '0.19.0', verbose: true });
    expect(text.split('\n')[1]).toBe('verdict-token: could-not-run');
    expect(text).not.toMatch(/^proposal:/m);
    expect(text).not.toMatch(/not a verdict/);
    expect(text).toMatch(/^findings: /m);
    expect(text).toMatch(/pull-request mode: no policy on main/);
  });
});

describe('the no-policy and policy-removed lines', () => {
  it('prints no-policy first on a refusal with no policy on either side, and only there', () => {
    const none = refusedTrustBase(POLICY, 'main', 'no.', { noPolicy: true });
    expect(runLevelLines(none)).toEqual([NO_POLICY_LINE, 'trust-base: refused, no rules were read and no gate ran']);
    expect(runLevelLines(refusedTrustBase(POLICY, 'main', 'no.', {}))).toEqual([
      'trust-base: refused, no rules were read and no gate ran',
    ]);
  });

  it('prints policy-removed on a run that was not refused, after the two older lines', () => {
    const removed = ran([outcome({})], 0, { ref: 'main', policyChanged: true, refusal: null, policyRemoved: true });
    expect(runLevelLines(removed)).toEqual([POLICY_REMOVED_LINE]);
    expect(verdictToken(removed, false)).toBe('pass');
  });

  it('names no ref, branch or file path in any of the three', () => {
    for (const line of [proposalLine(3), NO_POLICY_LINE, POLICY_REMOVED_LINE]) {
      expect(line).not.toMatch(/main|refs\/|origin/);
      expect(line).toMatch(/^[ -~]+$/);
      expect(line).not.toMatch(/[`<>&]/);
    }
  });
});

describe('the comment poster reads a proposal head block the renderer writes', () => {
  interface Head {
    token: string;
    runLevel: string[];
    gates: string[];
    findings: string[];
  }
  const posterPath: string = new URL('../scripts/lib/pr-comment.mjs', import.meta.url).href;
  const load = async (): Promise<{ headBlock: (text: string) => Head | null; buildCommentBody: (text: string) => string }> =>
    (await import(posterPath)) as { headBlock: (text: string) => Head | null; buildCommentBody: (text: string) => string };

  const runs: RunResult[] = [
    asProposal(ran([outcome({}), blockingGate()], 1)),
    asProposal(ran([outcome({})], 0)),
    asProposal(ran([], 0)),
    asProposal(ran([brokenGate({ enforce: false }), blockingGate()], 1)),
    asProposal(ran([brokenGate(), blockingGate()], 2)),
    refusedTrustBase(POLICY, 'main', 'no.', { noPolicy: true }),
    ran([outcome({})], 0, { ref: 'main', policyChanged: true, refusal: null, policyRemoved: true }),
  ];

  it('for every proposal shape, the no-policy refusal and a policy removal', async () => {
    const { headBlock } = await load();
    for (const run of runs) {
      const text = renderText(run, { version: '0.19.0-rc.1', verbose: true, compact: true });
      const head = headBlock(text);
      expect(head).not.toBeNull();
      expect(`verdict-token: ${head?.token ?? ''}`).toBe(text.split('\n')[1]);
      expect(head?.runLevel).toEqual(runLevelLines(run));
      expect(head?.gates).toEqual(gateSummaryLines(run));
      expect(head?.findings).toEqual(
        findingSummaryLines(run, isProposal(run) ? { heading: PROPOSAL_FINDINGS_HEADING } : {})
      );
    }
    expect(runLevelLines(runs[0] as RunResult)).toEqual([proposalLine(2)]);
  });

  it('reads no head block from a proposal token without its line, or with another count', async () => {
    const { headBlock, buildCommentBody } = await load();
    const gate = 'gate secrets (vault-guard 1.13.3): ran, exit 1, 2 blocking';
    const report = (token: string, rest: string[]): string => ['conductor 0.19.0', `verdict-token: ${token}`, ...rest, ''].join('\n');
    expect(headBlock(report('proposal (2)', [proposalLine(2), gate]))).not.toBeNull();
    expect(headBlock(report('proposal (2)', [gate]))).toBeNull();
    expect(headBlock(report('proposal (2)', [proposalLine(3), gate]))).toBeNull();
    expect(headBlock(report('proposal (2)', [gate, proposalLine(2)]))).toBeNull();
    expect(headBlock(report('proposal-nothing-checked', [gate]))).toBeNull();
    expect(headBlock(report('proposal-pass', [proposalLine(0), gate]))).toBeNull();
    // With no head block the report is posted whole, as fenced text, and no
    // verdict line is lifted above it.
    expect(buildCommentBody(report('proposal (2)', [gate]))).not.toMatch(/^conductor verdict:/m);
  });

  it('leads the comment with the proposal token and line, never a pass', async () => {
    const { buildCommentBody } = await load();
    const body = buildCommentBody(renderText(runs[0] as RunResult, { version: '0.19.0', verbose: true }));
    const lines = body.split('\n');
    expect(lines[3]).toBe('conductor verdict: proposal (2)');
    expect(lines[5]).toBe(proposalLine(2));
    expect(body).not.toMatch(/conductor verdict: pass/);
  });
});

describe('the proposal in the SARIF log', () => {
  const parse = (run: RunResult) =>
    JSON.parse(renderSarif(run, '0.19.0')) as {
      runs: Array<{
        tool: { driver: { name: string } };
        results: Array<{ properties: { proposal?: boolean } }>;
        properties?: { trustBase?: Record<string, unknown> };
        invocations?: Array<{
          executionSuccessful: boolean;
          toolExecutionNotifications?: Array<{ descriptor: { id: string }; level: string; message: { text: string } }>;
        }>;
      }>;
    };
  const umbrella = (run: RunResult) => parse(run).runs.find((each) => each.tool.driver.name === 'conductor');

  it('writes the umbrella run with the marker and one warning, even when nothing else earns it', () => {
    const clean = umbrella(asProposal(ran([outcome({})], 0)));
    expect(clean?.properties?.trustBase?.proposal).toEqual({ reason: 'no-policy-on-base' });
    const notes = clean?.invocations?.[0]?.toolExecutionNotifications ?? [];
    expect(notes.filter((note) => note.descriptor.id === 'conductor/proposal-run')).toHaveLength(1);
    expect(notes.find((note) => note.descriptor.id === 'conductor/proposal-run')?.level).toBe('warning');
    expect(clean?.invocations?.[0]?.executionSuccessful).toBe(true);
  });

  it('marks every result of every run', () => {
    const results = parse(asProposal(ran([outcome({}), blockingGate()], 1))).runs.flatMap((each) => each.results);
    expect(results).toHaveLength(2);
    expect(results.every((entry) => entry.properties.proposal === true)).toBe(true);
  });

  it('keeps executionSuccessful false, and says could-not-run, when an enforced gate could not run', () => {
    const broken = umbrella(asProposal(ran([brokenGate(), blockingGate()], 2)));
    expect(broken?.invocations?.[0]?.executionSuccessful).toBe(false);
    const note = broken?.invocations?.[0]?.toolExecutionNotifications?.find(
      (each) => each.descriptor.id === 'conductor/proposal-run'
    );
    expect(note?.message.text).toMatch(/could not run, so the run is could-not-run/);
    expect(note?.message.text).not.toMatch(/exits 0/);
  });

  it('marks nothing on an enforced run', () => {
    const text = renderSarif(ran([blockingGate()], 1, { ref: 'main', policyChanged: false, refusal: null }), '0.19.0');
    expect(text).not.toMatch(/"proposal"/);
    expect(text).not.toMatch(/proposal-run/);
  });
});
