// action.yml and the adoption proposal (issue 101): when the gates step
// passes --adoption-proposal, and what it does with a proposal's token and
// lines. The step is run for real, in bash, against a conductor shim that
// records its arguments and writes a canned text report.

import { afterEach, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import type { Finding } from '../src/envelope.js';
import type { GateOutcome } from '../src/gate-runner.js';
import {
  PROPOSAL_FINDINGS_HEADING,
  findingSummaryLines,
  gateSummaryLines,
  renderText,
  runLevelLines,
  verdictToken,
} from '../src/output-text.js';
import type { Policy } from '../src/policy.js';
import { type RunResult, asProposal, isProposal, ranProposedPolicy, refusedTrustBase } from '../src/run.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Step {
  id?: string;
  run?: string;
  env?: Record<string, string>;
}
const action = parseYaml(readFileSync(path.join(ROOT, 'action.yml'), 'utf8')) as { runs: { steps: Step[] } };
const step = (id: string): Step => action.runs.steps.find((candidate) => candidate.id === id) ?? {};
const gatesScript = step('gates').run ?? '';
const renderScript = step('pr-render').run ?? '';

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

const SHA = 'a'.repeat(40);

interface GatesRun {
  status: number;
  argv: string[];
  summary: string;
  output: string[];
  reportLeft: boolean;
}

function runGates(options: {
  /** Does `run --help` list --adoption-proposal? */
  flagKnown?: boolean;
  baseRef?: string;
  defaultBranch?: string | null;
  event?: string | null;
  trustBaseInput?: string;
  body?: string;
  exit?: number;
}): GatesRun {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-action-adoption-'));
  temps.push(dir);
  const bin = path.join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const argvLog = path.join(dir, 'argv.txt');
  const bodyFile = path.join(dir, 'body.txt');
  const textReport = path.join(dir, 'conductor-text-report.txt');
  writeFileSync(argvLog, '');
  writeFileSync(bodyFile, options.body ?? 'conductor 9.9.9\nverdict-token: pass\n');
  const shim = path.join(bin, 'conductor');
  writeFileSync(
    shim,
    [
      '#!/bin/sh',
      'if [ "$1" = "run" ] && [ "$2" = "--help" ]; then',
      "  printf '  --text-report <path>  write the text report too\\n'",
      options.flagKnown === false ? '  :' : "  printf '  --adoption-proposal  report a first policy as a proposal\\n'",
      '  exit 0',
      'fi',
      `for arg in "$@"; do printf '%s\\n' "$arg" >> ${JSON.stringify(argvLog)}; done`,
      'prev=""',
      'for arg in "$@"; do',
      `  if [ "$prev" = "--text-report" ]; then cat ${JSON.stringify(bodyFile)} > "$arg"; fi`,
      '  prev="$arg"',
      'done',
      `exit ${options.exit ?? 0}`,
      '',
    ].join('\n')
  );
  chmodSync(shim, 0o755);
  const githubOutput = path.join(dir, 'github-output.txt');
  const summary = path.join(dir, 'summary.md');
  writeFileSync(githubOutput, '');
  writeFileSync(summary, '');
  const env: Record<string, string> = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    CONDUCTOR_BIN: shim,
    GITHUB_OUTPUT: githubOutput,
    GITHUB_STEP_SUMMARY: summary,
    GITHUB_EVENT_PATH: '',
    GITHUB_BASE_REF: options.baseRef ?? 'main',
    GITHUB_HEAD_REF: 'feature',
    BASE_REF: '',
    TRUST_BASE: options.trustBaseInput ?? '',
    TRUST_BASE_SHA: SHA,
    SPEC: '',
    STAGE: 'ci',
    OUTPUT: 'conductor.sarif',
    WORKDIR: '.',
    ADVISORY: 'false',
    PREVIEW: 'false',
    TEXT_REPORT: textReport,
  };
  if (options.defaultBranch !== null) {
    env.DEFAULT_BRANCH = options.defaultBranch ?? 'main';
  }
  if (options.event !== null) {
    env.GITHUB_EVENT_NAME = options.event ?? 'pull_request';
  }
  const result = spawnSync('bash', ['-c', gatesScript], { cwd: dir, encoding: 'utf8', env });
  const lines = (file: string): string[] =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
  return {
    status: result.status ?? -1,
    argv: lines(argvLog),
    summary: readFileSync(summary, 'utf8'),
    output: lines(githubOutput),
    reportLeft: existsSync(textReport),
  };
}

describe('action.yml: when the gates step passes --adoption-proposal', () => {
  it('passes it on a pull request into the default branch, beside the fetched trust base', () => {
    const run = runGates({});
    expect(run.argv).toContain('--adoption-proposal');
    expect(run.argv[run.argv.indexOf('--trust-base') + 1]).toBe(SHA);
  });

  it('passes it on pull_request_target too', () => {
    expect(runGates({ event: 'pull_request_target' }).argv).toContain('--adoption-proposal');
  });

  it('does not pass it for a pull request into another branch (B2)', () => {
    const run = runGates({ baseRef: 'release' });
    expect(run.argv).toContain('--trust-base');
    expect(run.argv).not.toContain('--adoption-proposal');
  });

  it('does not pass it when the default branch is unknown or empty', () => {
    expect(runGates({ defaultBranch: null }).argv).not.toContain('--adoption-proposal');
    expect(runGates({ defaultBranch: '' }).argv).not.toContain('--adoption-proposal');
    // An empty base ref beside an empty default branch is a push, not a match.
    const push = runGates({ baseRef: '', defaultBranch: '' });
    expect(push.argv).not.toContain('--adoption-proposal');
    expect(push.argv).not.toContain('--trust-base');
  });

  it('does not pass it on a merge queue run, or any event that is not a pull request (R2)', () => {
    for (const event of ['merge_group', 'push', 'workflow_dispatch', 'schedule', '', null]) {
      const run = runGates({ event });
      expect(run.argv).toContain('--trust-base');
      expect(run.argv).not.toContain('--adoption-proposal');
    }
  });

  it('does not pass it with an explicit trust-base input', () => {
    const run = runGates({ trustBaseInput: 'refs/heads/other' });
    expect(run.argv[run.argv.indexOf('--trust-base') + 1]).toBe('refs/heads/other');
    expect(run.argv).not.toContain('--adoption-proposal');
  });

  it('does not pass it to a conductor whose help does not list it', () => {
    const run = runGates({ flagKnown: false });
    expect(run.argv).toContain('--trust-base');
    expect(run.argv).not.toContain('--adoption-proposal');
  });

  it('compares branch names as text, never as a pattern', () => {
    expect(runGates({ baseRef: 'main', defaultBranch: '*' }).argv).not.toContain('--adoption-proposal');
    expect(runGates({ baseRef: 'main', defaultBranch: 'mai?' }).argv).not.toContain('--adoption-proposal');
  });

  it('takes the default branch and the event from the event context, never from an input', () => {
    const env = step('gates').env ?? {};
    expect(env.DEFAULT_BRANCH).toBe('${{ github.event.repository.default_branch }}');
    expect(env.GITHUB_EVENT_NAME).toBe('${{ github.event_name }}');
  });

  it('writes the flag in exactly one place in the gates step, inside the fetched-base branch', () => {
    const added = gatesScript.split('\n').filter((line) => /ARGS\+=\(.*--adoption-proposal/.test(line));
    expect(added).toHaveLength(1);
    const at = gatesScript.indexOf(added[0] as string);
    const branch = gatesScript.lastIndexOf('elif [ -n "${GITHUB_BASE_REF:-}" ]; then', at);
    const explicit = gatesScript.lastIndexOf('if [ -n "$TRUST_BASE" ]; then', at);
    expect(branch).toBeGreaterThan(explicit);
    // No `fi` at the branch's own depth in between: still inside that elif.
    expect(gatesScript.slice(branch, at)).not.toMatch(/\nfi\n/);
  });

  it('publishes that it passed the flag, exactly when it did', () => {
    expect(runGates({}).output).toContain('adoption-proposal=true');
    for (const refusedBy of [{ baseRef: 'release' }, { event: 'merge_group' }, { flagKnown: false }, { trustBaseInput: 'refs/heads/other' }]) {
      const run = runGates(refusedBy);
      expect(run.argv).not.toContain('--adoption-proposal');
      expect(run.output.filter((line) => line.startsWith('adoption-proposal='))).toEqual([]);
    }
  });

  it('hands the render step that output and nothing it could decide the flag from itself', () => {
    const env = step('pr-render').env ?? {};
    expect(env.ADOPTION_PROPOSAL).toBe('${{ steps.gates.outputs.adoption-proposal }}');
    expect(env.DEFAULT_BRANCH).toBeUndefined();
    expect(env.GITHUB_EVENT_NAME).toBeUndefined();
    expect(renderScript).not.toMatch(/run --help/);
  });
});

describe('action.yml: a proposal token and its lines in the gates step', () => {
  const PROPOSAL_LINE =
    'proposal: no .guardrails.yaml on the base branch, so nothing here was enforced; 2 would block once this policy is on the base branch';
  const GATE = 'gate secrets (vault-guard 1.13.3): ran, exit 1, 2 blocking';
  const report = (token: string, rest: string[] = []): string => ['conductor 9.9.9', `verdict-token: ${token}`, ...rest, ''].join('\n');

  it('publishes proposal (N) at exit 0, with the proposal line and the would-block heading', () => {
    const run = runGates({
      body: report('proposal (2)', [
        PROPOSAL_LINE,
        GATE,
        'would block once the policy is on the base: 2 (2 blocking):',
        'finding: BLOCKING vault-guard vault-guard/github-token src/a.js:2: Possible secret',
      ]),
    });
    expect(run.status).toBe(0);
    expect(run.output).toContain('verdict=proposal (2)');
    expect(run.summary).toContain('conductor verdict: proposal (2)\n\n');
    expect(run.summary).toContain(`${PROPOSAL_LINE}\n\n`);
    expect(run.summary).toContain(GATE);
    expect(run.summary).toContain('would block once the policy is on the base: 2 (2 blocking):');
    expect(run.summary).not.toMatch(/conductor verdict: pass/);
  });

  it('publishes proposal-nothing-checked at exit 0', () => {
    const run = runGates({ body: report('proposal-nothing-checked', [PROPOSAL_LINE.replace('; 2 would', '; 0 would')]) });
    expect(run.status).toBe(0);
    expect(run.output).toContain('verdict=proposal-nothing-checked');
    expect(run.summary).toContain('conductor verdict: proposal-nothing-checked');
  });

  it.each([1, 2])('never publishes a proposal token beside exit %i: could-not-run, and the report is removed', (exit) => {
    const run = runGates({ body: report('proposal (0)', [PROPOSAL_LINE]), exit });
    expect(run.status).toBe(exit);
    expect(run.output).toContain('verdict=could-not-run');
    expect(run.summary).not.toContain('proposal');
    expect(run.reportLeft).toBe(false);
  });

  it('never publishes a proposal token whose line 3 is missing, or carries another count', () => {
    // The token says exit 0 with nothing enforced; without the sentence that
    // says so under it, it is not published at all.
    for (const rest of [[GATE], [PROPOSAL_LINE.replace('; 2 would', '; 3 would'), GATE], [GATE, PROPOSAL_LINE]]) {
      const run = runGates({ body: report('proposal (2)', rest) });
      expect(run.status).toBe(0);
      expect(run.output).toContain('verdict=unknown');
      expect(run.summary).toBe('conductor verdict: unknown\n\n');
      expect(run.reportLeft).toBe(false);
    }
    expect(runGates({ body: report('proposal-nothing-checked', [GATE]) }).output).toContain('verdict=unknown');
  });

  it.each(['proposal', 'proposal-pass', 'proposal (x)', 'proposal(1)', 'proposal-nothing-checked (1)', 'pass proposal (1)'])(
    'does not accept %s as a token: unknown at exit 0',
    (token) => {
      const run = runGates({ body: report(token, [PROPOSAL_LINE]) });
      expect(run.output).toContain('verdict=unknown');
      expect(run.summary).not.toContain('nothing here was enforced');
    }
  );

  it('copies the no-policy line and the policy-removed line, and nothing that only resembles them', () => {
    const noPolicy =
      'no-policy: this workflow checks nothing until .guardrails.yaml is on the base branch; run conductor init and merge it';
    const refused = runGates({
      body: report('could-not-run', [noPolicy, 'trust-base: refused, no rules were read and no gate ran']),
      exit: 2,
    });
    expect(refused.summary).toContain(`${noPolicy}\n\n`);
    const removed =
      'policy-removed: this pull request deletes .guardrails.yaml; once merged, nothing is enforced on the base branch and every pull-request run is refused until a policy is back on it';
    expect(runGates({ body: report('pass', [removed, GATE]) }).summary).toContain(`${removed}\n\n`);
    for (const forged of [
      'proposal: no .guardrails.yaml on the base branch, so nothing here was enforced; 0 would block once this policy is on the base branch, all clear',
      'proposal: everything passed',
      'no-policy: all good',
      'policy-removed: nothing to see',
    ]) {
      expect(runGates({ body: report('pass', [forged, GATE]) }).summary).toBe('conductor verdict: pass\n\n');
    }
  });

  // The drift pin for this step, which spells the shapes out in bash: what
  // the renderer prints for a proposal is published and copied whole.
  it('accepts the report the renderer writes for a proposal, a no-policy refusal and a policy removal', () => {
    const gate = (overrides: Partial<GateOutcome>): GateOutcome =>
      ({
        role: 'secrets',
        product: 'vault-guard',
        productVersion: '1.13.3',
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
      }) as GateOutcome;
    const found: Finding = {
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
    };
    const run = (gates: GateOutcome[], exitCode: number, trustBase: RunResult['trustBase']): RunResult => ({
      schemaVersion: 1,
      generatedAt: '2026-11-10T00:00:00.000Z',
      gates,
      deferred: [],
      skipped: [],
      excluded: [],
      treeUnchanged: [],
      findings: gates.flatMap((each) => each.findings),
      trustBase,
      proposals: [{ product: 'conductor', role: 'secrets', line: 'gates.secrets.timeout-seconds: 70' }],
      summary: { blocking: 0, byProduct: {}, bySeverity: {} },
      exitCode,
    });
    const proposed = { ref: SHA, policyChanged: true, refusal: null, proposal: { reason: 'no-policy-on-base' as const } };
    const policy = {
      version: 1,
      gates: { secrets: { role: 'secrets', product: 'vault-guard', enabled: true, stage: 'commit', enforce: true, excludedByCli: false, options: {} } },
      report: { format: 'text' },
    } as Policy;
    const cases: Array<{ result: RunResult; exit: number }> = [
      { result: asProposal(run([gate({ exitCode: 1, findings: [found] })], 1, proposed)), exit: 0 },
      { result: asProposal(run([gate({})], 0, proposed)), exit: 0 },
      { result: asProposal(run([gate({ findings: [{ ...found, blocking: false }] })], 0, proposed)), exit: 0 },
      { result: refusedTrustBase(policy, SHA, 'no.', { noPolicy: true }), exit: 2 },
      { result: run([gate({})], 0, { ref: SHA, policyChanged: true, refusal: null, policyRemoved: true }), exit: 0 },
    ];
    for (const { result, exit } of cases) {
      const text = renderText(result, { version: '0.19.0', verbose: true, compact: true });
      const published = runGates({ body: text, exit });
      expect(published.output).toContain(`verdict=${verdictToken(result, false)}`);
      for (const line of [...runLevelLines(result), ...gateSummaryLines(result)]) {
        expect(published.summary).toContain(`${line}\n`);
      }
      const heading = isProposal(result) ? { heading: PROPOSAL_FINDINGS_HEADING } : {};
      for (const line of findingSummaryLines(result, heading)) {
        expect(published.summary).toContain(`${line}\n`);
      }
      if (ranProposedPolicy(result)) {
        expect(published.summary).toContain(
          `pull-request mode: no policy on ${SHA}; this run previews the policy this pull request adds. 1 control change(s)`
        );
        expect(published.summary).toContain('proposed  conductor');
      }
    }
    expect(runLevelLines(cases[0]?.result as RunResult)).toHaveLength(1);
    expect(findingSummaryLines(cases[0]?.result as RunResult, { heading: PROPOSAL_FINDINGS_HEADING })).toHaveLength(2);
  });

  it('copies the count line of a proposal run into the control changes block', () => {
    const count =
      '  pull-request mode: no policy on aaaa; this run previews the policy this pull request adds. 1 control change(s) proposed in this pull request.';
    const run = runGates({
      body: report('proposal (2)', [PROPOSAL_LINE, GATE, '', count, '  proposed  conductor      gates.secrets.command: set']),
    });
    expect(run.summary).toContain(count.trim());
    expect(run.summary).toContain('proposed  conductor      gates.secrets.command: set');
  });
});
