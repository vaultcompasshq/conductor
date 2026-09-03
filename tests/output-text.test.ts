import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GateOutcome } from '../src/gate-runner.js';
import { normalizeDepGuard, normalizeMissingGate, normalizeVaultGuard } from '../src/normalize.js';
import { renderText } from '../src/output-text.js';
import type { RunResult } from '../src/run.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function outcome(overrides: Partial<GateOutcome>): GateOutcome {
  return {
    role: 'dependencies',
    product: 'dep-guard',
    productVersion: '0.2.0',
    argv: ['scan', '--staged', '--format', 'json'],
    binary: {
      command: '/usr/local/bin/dep-guard',
      argvPrefix: ['scan'],
      source: 'path',
      candidate: 'dep-guard',
      versionProbe: null,
    },
    exitCode: 1,
    durationMs: 75,
    couldNotRun: null,
    findings: [],
    run: { failOn: 'medium', suppressed: 0, ignored: 0, diagnostics: [], details: {} },
    diagnostics: [],
    stderr: '',
    ...overrides,
  } as GateOutcome;
}

function result(
  gates: GateOutcome[],
  exitCode: number,
  deferred: RunResult['deferred'] = []
): RunResult {
  const findings = gates.flatMap((gate) => gate.findings);
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-02T00:00:00.000Z',
    gates,
    deferred,
    findings,
    summary: {
      blocking: findings.filter((finding) => finding.blocking).length,
      byProduct: {},
      bySeverity: {},
    },
    exitCode,
  };
}

const depGuard = normalizeDepGuard(fixture('dep-guard-0.2.0-blocking.json'), '0.2.0');
const vaultGuard = normalizeVaultGuard(fixture('vault-guard-1.4.2-blocking.json'), '1.4.2');

describe('the combined text report', () => {
  const text = renderText(
    result(
      [
        outcome({ findings: depGuard.findings, run: depGuard.run }),
        outcome({
          role: 'secrets',
          product: 'vault-guard',
          productVersion: '1.4.2',
          findings: vaultGuard.findings,
          run: vaultGuard.run,
        }),
      ],
      1
    )
  );

  it('has one section per gate, in gate order', () => {
    const dependencies = text.indexOf('dependencies');
    const secrets = text.indexOf('secrets');
    expect(dependencies).toBeGreaterThan(-1);
    expect(secrets).toBeGreaterThan(dependencies);
  });

  it('names the product and its version in the section header', () => {
    expect(text).toMatch(/dep-guard 0\.2\.0/);
    expect(text).toMatch(/vault-guard 1\.4\.2/);
  });

  it('shows the exit code and duration each gate reported', () => {
    expect(text).toMatch(/exit 1/);
    expect(text).toMatch(/75ms/);
  });

  it('puts blocking findings before the rest', () => {
    const lines = text.split('\n').filter((line) => line.includes('dep-guard/'));
    // Both fixture findings block, and the critical one leads.
    expect(lines[0]).toMatch(/critical/);
    expect(lines[0]).toMatch(/typosquat/);
  });

  it('shows the threshold each gate gated on, rather than one shared number', () => {
    expect(text).toMatch(/threshold medium/);
  });

  it('reports the suppressed and ignored counts, so a quiet report is not mistaken for a clean one', () => {
    expect(text).toMatch(/suppressed 0/);
    expect(text).toMatch(/ignored 0/);
  });

  it('says "ignored not reported" for a gate that reports no ignore count', () => {
    // vault-guard drops ignored files before they reach its output, so it
    // has no count to give. Printing "ignored 0" states a fact the gate
    // never stated, and reads as "nothing was ignored".
    const secretsSection = text.slice(text.indexOf('secrets'));
    expect(secretsSection).toMatch(/ignored not reported/);
    expect(secretsSection).not.toMatch(/ignored 0/);
  });

  it('renders the per-gate run facts rather than collecting them and dropping them', () => {
    expect(text).toMatch(/mode staged/);
    expect(text).toMatch(/lockfileFormat none/);
    expect(text).toMatch(/patternsActive 59/);
  });

  it('leaves out a run fact the gate did not report', () => {
    // A null is an absence, not a value: "corpusBuiltAt null" is noise.
    expect(text).not.toMatch(/\bnull\b/);
  });

  it('leaves out a structured run fact rather than rendering it as [object Object]', () => {
    // Caught in a real dogfood run: the intent gate's category breakdown
    // printed as "[object Object]" and its empty reasons list printed as a
    // key with no value. Both belong in the SARIF details bag, not in a
    // one-line terminal summary.
    const structured = renderText(
      result(
        [
          outcome({
            role: 'intent',
            product: 'intent-guard',
            run: {
              failOn: null,
              suppressed: 0,
              ignored: 0,
              diagnostics: [],
              details: {
                contractFound: true,
                driftCategories: { scope_creep: 0 },
                reasons: [],
                driftAction: 'proceed',
              },
            },
          }),
        ],
        0
      )
    );

    expect(structured).not.toMatch(/\[object Object\]/);
    expect(structured).not.toMatch(/driftCategories/);
    expect(structured).not.toMatch(/reasons/);
    // The scalars beside them still render.
    expect(structured).toMatch(/contractFound true/);
    expect(structured).toMatch(/driftAction proceed/);
  });

  it('shows a gate diagnostic without turning it into a finding', () => {
    expect(text).toMatch(/lockfile-missing/);
    expect(text.match(/dep-guard\//g)).toHaveLength(2);
  });

  it('ends with a one-line verdict carrying the composed exit code', () => {
    const last = text.trimEnd().split('\n').pop() as string;
    expect(last).toMatch(/^verdict:/);
    expect(last).toMatch(/exit 1/);
  });
});

describe('a gate that could not run', () => {
  const text = renderText(
    result(
      [
        outcome({
          role: 'intent',
          product: 'intent-guard',
          productVersion: null,
          exitCode: null,
          binary: null,
          couldNotRun: { reason: 'binary-missing', detail: 'no intent-guard binary on PATH' },
          findings: [normalizeMissingGate('intent', 'intent-guard', ['intent-guard'])],
        }),
      ],
      2
    )
  );

  it('says so loudly instead of printing an empty clean section', () => {
    expect(text).toMatch(/DID NOT RUN/);
    expect(text).toMatch(/binary-missing/);
  });

  it('prints the umbrella own blocking finding in that gate section', () => {
    expect(text).toMatch(/conductor\/gate-missing/);
  });

  it('says the version is unknown rather than printing a blank', () => {
    expect(text).toMatch(/version unknown/);
  });

  it('makes the verdict say a gate could not run, not that the code is clean', () => {
    const last = text.trimEnd().split('\n').pop() as string;
    expect(last).toMatch(/could not run/);
    expect(last).toMatch(/exit 2/);
  });
});

describe('a clean run', () => {
  it('says every gate ran and none blocked', () => {
    const text = renderText(result([outcome({ exitCode: 0 })], 0));
    const last = text.trimEnd().split('\n').pop() as string;
    expect(last).toMatch(/exit 0/);
    expect(last).toMatch(/none blocked/);
  });
});

describe('a gate the stage filter deferred', () => {
  const text = renderText(
    result([outcome({ exitCode: 0 })], 0, [
      { role: 'intent', product: 'intent-guard', stage: 'ci' },
    ])
  );

  it('says the gate was deferred and names the stage it is waiting for', () => {
    // A gate that is switched on and did not run has to be on screen, or a
    // commit-stage run reads exactly like a run that checked everything.
    expect(text).toMatch(/deferred/);
    expect(text).toMatch(/intent/);
    expect(text).toMatch(/stage ci/);
  });

  it('does not dress it up as a gate that could not run', () => {
    // Could-not-run is exit 2 and a failure. Deferred is neither.
    expect(text).not.toMatch(/DID NOT RUN/);
  });

  it('counts only the gates that actually ran in the header', () => {
    expect(text).toMatch(/^conductor run: 1 gate\(s\)/m);
  });
});

describe('a run where every enabled gate was deferred', () => {
  const text = renderText(
    result([], 0, [
      { role: 'intent', product: 'intent-guard', stage: 'ci' },
    ])
  );

  it('says so rather than claiming nothing is enabled', () => {
    // The two states look identical in a report and are not the same
    // problem: one is a policy file with everything switched off, the other
    // is a stage that had nothing to do.
    const last = text.trimEnd().split('\n').pop() as string;
    expect(last).toMatch(/exit 0/);
    expect(last).toMatch(/deferred/);
    expect(last).not.toMatch(/none is enabled/);
  });
});

describe('a run with no enabled gates', () => {
  const text = renderText(result([], 0));

  it('says no gate ran rather than reporting a clean pass', () => {
    // Exit 0 with an empty report is indistinguishable from a clean run at a
    // glance, and a policy file with every gate switched off is exactly the
    // state somebody needs told about.
    const last = text.trimEnd().split('\n').pop() as string;
    expect(last).toMatch(/no gate ran/);
    expect(last).not.toMatch(/none blocked/);
  });

  it('still exits 0, because nothing was asked for and nothing failed', () => {
    expect(result([], 0).exitCode).toBe(0);
  });

  it('says where to turn one on', () => {
    expect(text).toMatch(/\.guardrails\.yaml/);
  });
});
