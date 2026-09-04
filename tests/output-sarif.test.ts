import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Finding } from '../src/envelope.js';
import type { GateOutcome } from '../src/gate-runner.js';
import { normalizeDepGuard, normalizeIntentGuard, normalizeVaultGuard } from '../src/normalize.js';
import { fingerprintKey, placeArtifact, renderSarif } from '../src/output-sarif.js';
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
    argv: [],
    binary: null,
    exitCode: 1,
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

function result(
  gates: GateOutcome[],
  deferred: RunResult['deferred'] = [],
  skipped: RunResult['skipped'] = [],
  excluded: RunResult['excluded'] = []
): RunResult {
  const findings = gates.flatMap((gate) => gate.findings);
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-02T00:00:00.000Z',
    gates,
    deferred,
    skipped,
    excluded,
    findings,
    summary: { blocking: 0, byProduct: {}, bySeverity: {} },
    exitCode: 1,
  };
}

const depGuard = normalizeDepGuard(fixture('dep-guard-0.2.0-blocking.json'), '0.2.0');
const vaultGuard = normalizeVaultGuard(fixture('vault-guard-1.4.2-blocking.json'), '1.4.2');
const intentGuard = normalizeIntentGuard(fixture('intent-guard-1.2.0-drift.json'), '1.2.0');

const THREE_GATES = result([
  outcome({ role: 'dependencies', product: 'dep-guard', findings: depGuard.findings }),
  outcome({
    role: 'secrets',
    product: 'vault-guard',
    productVersion: '1.4.2',
    findings: vaultGuard.findings,
  }),
  outcome({
    role: 'intent',
    product: 'intent-guard',
    productVersion: '1.2.0',
    findings: intentGuard.findings,
  }),
]);

function sarif(runResult: RunResult): Record<string, never> & {
  runs: Array<Record<string, unknown>>;
  version: string;
  $schema: string;
} {
  return JSON.parse(renderSarif(runResult, '0.1.0'));
}

/** The umbrella run's tool-execution notifications, or an empty list. */
function notificationsOf(log: { runs: Array<Record<string, unknown>> }): Array<
  Record<string, unknown>
> {
  const umbrella = log.runs.find(
    (run) => (run.tool as Record<string, Record<string, unknown>>).driver.name === 'conductor'
  );
  const invocations = umbrella?.invocations as Array<Record<string, unknown>> | undefined;
  return (invocations?.[0]?.toolExecutionNotifications as Array<Record<string, unknown>>) ?? [];
}

/** Rule ids of the umbrella run's results, or an empty list. */
function umbrellaResultIds(log: { runs: Array<Record<string, unknown>> }): unknown[] {
  const umbrella = log.runs.find(
    (run) => (run.tool as Record<string, Record<string, unknown>>).driver.name === 'conductor'
  );
  return ((umbrella?.results as Array<Record<string, unknown>>) ?? []).map((entry) => entry.ruleId);
}

/**
 * A statement about coverage is a notification, not a finding.
 *
 * Three of the umbrella's own note-level results were statements about what
 * this run covered rather than about anybody's code: a gate deferred to a
 * later stage, a gate the policy told not to decide anything, and a branch
 * with no contract for the intent gate to check against. As results they
 * accrued in code scanning on every run of a repository on the adoption
 * ramp, fingerprint-less and permanent, which is alert fatigue manufactured
 * by the tool that is supposed to reduce it.
 */
describe('coverage statements are notifications rather than results', () => {
  const DEFERRED = result([outcome({ exitCode: 0, findings: [] })], [
    { role: 'intent', product: 'intent-guard', stage: 'ci' },
  ]);
  const UNENFORCED = result([outcome({ enforce: false, findings: depGuard.findings })]);
  const SKIPPED = result(
    [outcome({ exitCode: 0, findings: [] })],
    [],
    [
      {
        role: 'intent',
        product: 'intent-guard',
        reason: 'no-contract',
        detail: 'no spec was named and no frozen contract is in the repository.',
      },
    ]
  );

  it('moves gate-deferred out of results', () => {
    expect(umbrellaResultIds(sarif(DEFERRED))).not.toContain('conductor/gate-deferred');
    expect(
      notificationsOf(sarif(DEFERRED)).map((entry) => (entry.descriptor as Record<string, unknown>).id)
    ).toContain('conductor/gate-deferred');
  });

  it('records a gate --gate excluded as a notification, beside the deferred ones', () => {
    // Same discriminator, same answer: how much of the policy this run
    // covered is a statement about the run, not about anybody's code. Without
    // it an uploaded log from a --gate run cannot be told from a full one.
    const EXCLUDED = result(
      [outcome({ exitCode: 0, findings: [] })],
      [],
      [],
      [{ role: 'secrets', product: 'vault-guard' }]
    );

    expect(umbrellaResultIds(sarif(EXCLUDED))).not.toContain('conductor/gate-excluded');
    const entry = notificationsOf(sarif(EXCLUDED)).find(
      (candidate) => (candidate.descriptor as Record<string, unknown>).id === 'conductor/gate-excluded'
    ) as Record<string, unknown>;

    expect(entry).toBeDefined();
    expect(entry.level).toBe('note');
    expect((entry.message as Record<string, unknown>).text).toMatch(/secrets/);
    expect((entry.message as Record<string, unknown>).text).toMatch(/--gate/);
  });

  it('says nothing about exclusion when there was no --gate', () => {
    const log = sarif(result([outcome({ exitCode: 0, findings: [] })], [
      { role: 'intent', product: 'intent-guard', stage: 'ci' },
    ]));
    expect(
      notificationsOf(log).map((entry) => (entry.descriptor as Record<string, unknown>).id)
    ).not.toContain('conductor/gate-excluded');
  });

  it('moves gate-not-enforced out of results', () => {
    expect(umbrellaResultIds(sarif(UNENFORCED))).not.toContain('conductor/gate-not-enforced');
    expect(
      notificationsOf(sarif(UNENFORCED)).map(
        (entry) => (entry.descriptor as Record<string, unknown>).id
      )
    ).toContain('conductor/gate-not-enforced');
  });

  it('moves the no-contract advisory out of results, keeping the gate own namespace', () => {
    expect(umbrellaResultIds(sarif(SKIPPED))).not.toContain('intent-guard/no-contract');
    expect(
      notificationsOf(sarif(SKIPPED)).map((entry) => (entry.descriptor as Record<string, unknown>).id)
    ).toContain('intent-guard/no-contract');
  });

  it('keeps the message text unchanged in the move', () => {
    const entry = notificationsOf(sarif(DEFERRED))[0];
    expect((entry.message as Record<string, unknown>).text).toBe(
      'The intent gate (intent-guard) did not run at this stage. It runs from stage ci onwards.'
    );
  });

  it('keeps gate-missing a result, because a gate that could not run is an alert', () => {
    // The deliberate asymmetry. A gate that could not run is the fail-closed
    // posture made visible, and a reviewer looking at a pull request's alerts
    // has to see it as an alert rather than as tool status.
    const log = sarif(
      result([
        outcome({
          role: 'intent',
          product: 'intent-guard',
          productVersion: null,
          exitCode: null,
          couldNotRun: { reason: 'binary-missing', detail: 'no intent-guard binary on PATH' },
          findings: [
            {
              schemaVersion: 1,
              product: 'conductor',
              productVersion: null,
              ruleId: 'conductor/gate-missing',
              severity: 'high',
              severityIsDerived: true,
              blocking: true,
              message: 'the intent gate is enabled but no intent-guard binary was found',
              subject: { kind: 'none' },
              fingerprint: null,
              details: {},
            } satisfies Finding,
          ],
        }),
      ])
    );

    expect(umbrellaResultIds(log)).toContain('conductor/gate-missing');
    expect(
      notificationsOf(log).map((entry) => (entry.descriptor as Record<string, unknown>).id)
    ).not.toContain('conductor/gate-missing');
  });

  it('keeps gate-failed a result, for the same reason', () => {
    const log = sarif(
      result([
        outcome({
          exitCode: 3,
          couldNotRun: { reason: 'gate-error', detail: 'dep-guard exited 3' },
          findings: [
            {
              schemaVersion: 1,
              product: 'conductor',
              productVersion: null,
              ruleId: 'conductor/gate-failed',
              severity: 'high',
              severityIsDerived: true,
              blocking: true,
              message: 'dep-guard could not complete its scan',
              subject: { kind: 'none' },
              fingerprint: null,
              details: {},
            } satisfies Finding,
          ],
        }),
      ])
    );

    expect(umbrellaResultIds(log)).toContain('conductor/gate-failed');
    expect(
      notificationsOf(log).map((entry) => (entry.descriptor as Record<string, unknown>).id)
    ).not.toContain('conductor/gate-failed');
  });

  it('writes notification objects SARIF 2.1.0 can read', () => {
    const log = sarif(DEFERRED);
    const umbrella = log.runs.find(
      (run) => (run.tool as Record<string, Record<string, unknown>>).driver.name === 'conductor'
    ) as Record<string, unknown>;
    const invocation = (umbrella.invocations as Array<Record<string, unknown>>)[0];

    // executionSuccessful is required on an invocation object, and it is a
    // claim rather than a constant: every enabled gate here ran.
    expect(invocation.executionSuccessful).toBe(true);

    for (const entry of notificationsOf(log)) {
      expect(entry.descriptor).toEqual({ id: expect.any(String) });
      expect(['note', 'warning', 'error']).toContain(entry.level);
      expect((entry.message as Record<string, unknown>).text).toEqual(expect.any(String));
    }

    // Declared on the driver beside its rules, so a consumer can resolve the
    // descriptor reference rather than being handed a dangling id.
    const declared = (
      (umbrella.tool as Record<string, Record<string, unknown>>).driver
        .notifications as Array<Record<string, unknown>>
    ).map((entry) => entry.id);
    expect(declared).toContain('conductor/gate-deferred');
  });

  it('says the run did not succeed when a gate could not run', () => {
    const log = sarif(
      result([
        outcome({
          enforce: false,
          couldNotRun: { reason: 'binary-missing', detail: 'no dep-guard binary on PATH' },
          exitCode: null,
          findings: [],
        }),
      ])
    );
    const umbrella = log.runs.find(
      (run) => (run.tool as Record<string, Record<string, unknown>>).driver.name === 'conductor'
    ) as Record<string, unknown>;

    expect((umbrella.invocations as Array<Record<string, unknown>>)[0].executionSuccessful).toBe(
      false
    );
  });

  it('still emits the umbrella run when the only thing to say is a notification', () => {
    // The regression this move could quietly cause: the umbrella run used to
    // be emitted only when it had findings, and a deferred gate was one. If
    // notifications did not also earn the run, a commit-stage log would say
    // nothing at all about the gate that did not run there.
    const log = sarif(DEFERRED);
    expect(
      log.runs.map((run) => (run.tool as Record<string, Record<string, unknown>>).driver.name)
    ).toContain('conductor');
  });

  it('gives a deferred gate no run of its own, notifications or not', () => {
    expect(
      sarif(DEFERRED).runs.map(
        (run) => (run.tool as Record<string, Record<string, unknown>>).driver.name
      )
    ).toEqual(['dep-guard', 'conductor']);
  });

  it('does not count the umbrella own finding as a blocking finding of the gate', () => {
    // A gate that could not run carries the umbrella's own blocking
    // gate-missing finding in its findings list, and counting it made the
    // notification say the gate blocked one thing AND never ran, which are
    // opposite claims about the same gate in the same object. The text
    // report already guards against exactly this contradiction.
    const log = sarif(
      result([
        outcome({
          role: 'intent',
          product: 'intent-guard',
          productVersion: null,
          exitCode: null,
          enforce: false,
          couldNotRun: { reason: 'binary-missing', detail: 'no intent-guard binary on PATH' },
          findings: [
            {
              schemaVersion: 1,
              product: 'conductor',
              productVersion: null,
              ruleId: 'conductor/gate-missing',
              severity: 'high',
              severityIsDerived: true,
              blocking: true,
              message: 'the intent gate is enabled but no intent-guard binary was found',
              subject: { kind: 'none' },
              fingerprint: null,
              details: {},
            } satisfies Finding,
          ],
        }),
      ])
    );

    const entry = notificationsOf(log).find(
      (candidate) =>
        (candidate.descriptor as Record<string, unknown>).id === 'conductor/gate-not-enforced'
    );
    const details = (entry?.properties as Record<string, Record<string, unknown>>).details;

    expect(details.blockingFindings).toBe(0);
    expect(details.couldNotRun).toBe('binary-missing');
    expect((entry?.message as Record<string, unknown>).text).toMatch(/could not run/);
  });

  it('still counts the gate own blocking findings when it did run', () => {
    const log = sarif(result([outcome({ enforce: false, findings: depGuard.findings })]));
    const entry = notificationsOf(log).find(
      (candidate) =>
        (candidate.descriptor as Record<string, unknown>).id === 'conductor/gate-not-enforced'
    );
    const details = (entry?.properties as Record<string, Record<string, unknown>>).details;

    expect(details.blockingFindings).toBe(depGuard.findings.filter((f) => f.blocking).length);
    expect(details.blockingFindings).toBeGreaterThan(0);
  });

  it('leaves the exit code alone in every one of those cases', () => {
    // Rendering is not allowed to be a decision. The exit code was composed
    // in run.ts and the renderer only reads it.
    for (const runResult of [DEFERRED, UNENFORCED, SKIPPED]) {
      const before = runResult.exitCode;
      sarif(runResult);
      expect(runResult.exitCode).toBe(before);
    }
  });
});

/**
 * executionSuccessful is a claim, so it has to be made in both directions.
 *
 * It was being written only when there were notifications to hang it on, so
 * the field appeared when the answer was true and vanished when it was
 * false. An enforced gate that could not run, with nothing deferred and
 * nothing skipped, produced no invocation at all, which is exactly the run
 * where "the analysis did not complete" most needed saying.
 */
describe('the umbrella invocation', () => {
  function umbrellaInvocation(log: {
    runs: Array<Record<string, unknown>>;
  }): Record<string, unknown> | undefined {
    const umbrella = log.runs.find(
      (run) => (run.tool as Record<string, Record<string, unknown>>).driver.name === 'conductor'
    );
    return (umbrella?.invocations as Array<Record<string, unknown>> | undefined)?.[0];
  }

  const BROKEN_GATE = result([
    outcome({
      role: 'intent',
      product: 'intent-guard',
      productVersion: null,
      exitCode: null,
      couldNotRun: { reason: 'binary-missing', detail: 'no intent-guard binary on PATH' },
      findings: [
        {
          schemaVersion: 1,
          product: 'conductor',
          productVersion: null,
          ruleId: 'conductor/gate-missing',
          severity: 'high',
          severityIsDerived: true,
          blocking: true,
          message: 'the intent gate is enabled but no intent-guard binary was found',
          subject: { kind: 'none' },
          fingerprint: null,
          details: {},
        } satisfies Finding,
      ],
    }),
  ]);

  it('says the analysis did not complete, with no notification to hang it on', () => {
    const invocation = umbrellaInvocation(sarif(BROKEN_GATE));

    expect(invocation).toBeDefined();
    expect(invocation?.executionSuccessful).toBe(false);
    // Nothing was deferred, skipped or unenforced, so there is nothing to
    // notify. The invocation is still there, because the claim is about the
    // run rather than about the notifications.
    expect(invocation).not.toHaveProperty('toolExecutionNotifications');
  });

  it('says the analysis completed when every gate ran', () => {
    const log = sarif(
      result([
        outcome({
          exitCode: 0,
          findings: [],
          diagnostics: [
            { code: 'conductor/blocking-mismatch', message: 'the counts disagree' },
          ],
        }),
      ])
    );

    expect(umbrellaInvocation(log)?.executionSuccessful).toBe(true);
  });

  it('gives a gate run no invocation of its own', () => {
    // The claim belongs to the umbrella. A gate's run describes what that
    // gate found, and conductor has no standing to write an invocation
    // object under another tool's driver name.
    const gateRun = sarif(BROKEN_GATE).runs.find(
      (run) => (run.tool as Record<string, Record<string, unknown>>).driver.name !== 'conductor'
    );
    expect(gateRun).toBeUndefined();

    const ranFine = sarif(result([outcome({ findings: depGuard.findings })]));
    expect(ranFine.runs[0]).not.toHaveProperty('invocations');
  });
});

describe('a clean run, whose text report is now one summary line', () => {
  // The summary line is a text-format decision and nothing else. SARIF is
  // read by machines, and a published log that got quieter because a run
  // happened to be clean would make a clean scan and a scan that found
  // nothing to say indistinguishable to whatever consumes it. This pins the
  // whole document, byte for byte, against a literal written out by hand
  // rather than against whatever the renderer currently produces.
  const clean = result([
    outcome({ role: 'dependencies', product: 'dep-guard', exitCode: 0 }),
    outcome({
      role: 'secrets',
      product: 'vault-guard',
      productVersion: '1.4.2',
      exitCode: 0,
    }),
  ]);

  it('renders exactly the log it rendered before the summary line existed', () => {
    const expected = JSON.stringify(
      {
        $schema:
          'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
        version: '2.1.0',
        runs: [
          {
            tool: { driver: { name: 'dep-guard', version: '0.2.0', rules: [] } },
            results: [],
            properties: { enforced: true, stage: 'commit' },
          },
          {
            tool: { driver: { name: 'vault-guard', version: '1.4.2', rules: [] } },
            results: [],
            properties: { enforced: true, stage: 'commit' },
          },
        ],
      },
      null,
      2
    );

    expect(renderSarif(clean, '0.1.0')).toBe(expected);
  });
});

describe('one SARIF log, one run per gate', () => {
  const log = sarif(THREE_GATES);

  it('is SARIF 2.1.0 with a schema reference', () => {
    expect(log.version).toBe('2.1.0');
    expect(log.$schema).toMatch(/sarif/);
  });

  it('emits one run per gate, in gate order', () => {
    expect(log.runs).toHaveLength(3);
    const drivers = log.runs.map(
      (run) => ((run.tool as Record<string, Record<string, unknown>>).driver.name as string)
    );
    expect(drivers).toEqual(['dep-guard', 'vault-guard', 'intent-guard']);
  });

  it('takes each run tool name and version from that gate, not from the umbrella', () => {
    const versions = log.runs.map(
      (run) => (run.tool as Record<string, Record<string, unknown>>).driver.version
    );
    expect(versions).toEqual(['0.2.0', '1.4.2', '1.2.0']);
  });

  it('omits the driver version rather than substituting the umbrella own', () => {
    const unknownVersion = sarif(
      result([outcome({ productVersion: null, findings: depGuard.findings })])
    );
    const driver = (unknownVersion.runs[0].tool as Record<string, Record<string, unknown>>).driver;
    expect(driver.name).toBe('dep-guard');
    expect(driver).not.toHaveProperty('version');
  });

  it('declares every rule its own run reports', () => {
    const rules = (
      (log.runs[0].tool as Record<string, Record<string, unknown>>).driver.rules as Array<{
        id: string;
      }>
    ).map((rule) => rule.id);
    expect(rules).toEqual(['dep-guard/typosquat', 'dep-guard/unknown-package']);
  });
});

describe('result mapping', () => {
  const log = sarif(THREE_GATES);
  const depResults = log.runs[0].results as Array<Record<string, unknown>>;
  const secretResults = log.runs[1].results as Array<Record<string, unknown>>;
  const intentResults = log.runs[2].results as Array<Record<string, unknown>>;

  it('keeps rule ids product-namespaced', () => {
    expect(depResults.map((entry) => entry.ruleId)).toEqual([
      'dep-guard/unknown-package',
      'dep-guard/typosquat',
    ]);
  });

  it('maps severity to a SARIF level', () => {
    // critical and high are error, medium is warning, low and info are note.
    expect(depResults[0].level).toBe('error');
    expect(depResults[1].level).toBe('error');
    const noteLevel = sarif(
      result([
        outcome({
          findings: [{ ...depGuard.findings[0], severity: 'info' } as Finding],
        }),
      ])
    );
    expect((noteLevel.runs[0].results as Array<Record<string, unknown>>)[0].level).toBe('note');
  });

  it('carries blocking, severity, severityIsDerived and the verbatim details bag', () => {
    expect(depResults[1].properties).toEqual({
      blocking: true,
      severity: 'critical',
      severityIsDerived: false,
      fingerprintStability: 'stable',
      details: {
        matchedBy: 'alias-list',
        target: 'lodash',
        targetRank: 149,
        specifier: '1.0.0',
        depType: 'dependencies',
      },
    });
  });

  it('keys partialFingerprints by product and carries the value unhashed', () => {
    expect(depResults[1].partialFingerprints).toEqual({
      'dep-guard/v1': '2e42ec0c067e77b5c97f3e8c1cdf9275aba9d3b439973de3035719b6f3a265e7',
    });
    expect(secretResults[0].partialFingerprints).toEqual({
      'vault-guard/v1': '85ce78fecbada885e18040c4ef1299a29367a1d2eec35fec239ab556a0172c79',
    });
  });

  it('records fingerprint stability next to the fingerprint rather than hiding it', () => {
    expect((secretResults[0].properties as Record<string, unknown>).fingerprintStability).toBe(
      'positional'
    );
  });

  it('omits partialFingerprints entirely when the product mints none', () => {
    const blocked = normalizeIntentGuard(
      {
        status: 'blocked',
        exitCode: 1,
        reasons: ['not frozen'],
        contractFound: true,
        contractFrozen: false,
      },
      '1.2.0'
    );
    const log2 = sarif(
      result([outcome({ role: 'intent', product: 'intent-guard', findings: blocked.findings })])
    );
    const entry = (log2.runs[0].results as Array<Record<string, unknown>>)[0];
    expect(entry).not.toHaveProperty('partialFingerprints');
  });
});

describe('locations', () => {
  const log = sarif(THREE_GATES);
  const depResults = log.runs[0].results as Array<Record<string, unknown>>;
  const secretResults = log.runs[1].results as Array<Record<string, unknown>>;
  const intentResults = log.runs[2].results as Array<Record<string, unknown>>;

  it('gives a package finding a logical package location and its manifest', () => {
    expect(depResults[1].locations).toEqual([
      {
        physicalLocation: {
          artifactLocation: { uri: 'package.json', uriBaseId: '%SRCROOT%' },
        },
        logicalLocations: [{ kind: 'package', fullyQualifiedName: 'lodahs' }],
      },
    ]);
  });

  it('gives a secret finding a region, with the 1-based column the envelope holds', () => {
    expect(secretResults[0].locations).toEqual([
      {
        physicalLocation: {
          artifactLocation: { uri: 'src/config.js', uriBaseId: '%SRCROOT%' },
          region: { startLine: 2, startColumn: 23 },
        },
      },
    ]);
  });

  it('never emits a region for a finding with no known line', () => {
    const withRegion = JSON.stringify(depResults);
    expect(withRegion).not.toMatch(/startLine/);
  });

  it('emits one location per path for a path-list finding, with no region', () => {
    const budget = intentResults.find(
      (entry) => entry.ruleId === 'intent-guard/budget.max_files'
    ) as Record<string, unknown>;
    expect(budget.locations).toEqual([
      {
        physicalLocation: { artifactLocation: { uri: 'package.json', uriBaseId: '%SRCROOT%' } },
      },
      {
        physicalLocation: { artifactLocation: { uri: 'src/config.js', uriBaseId: '%SRCROOT%' } },
      },
    ]);
  });

  it('gives a drift finding a logical contract location and no file at all', () => {
    const drift = intentResults.find((entry) =>
      String(entry.ruleId).startsWith('intent-guard/drift.')
    ) as Record<string, unknown>;
    expect(drift.locations).toEqual([
      { logicalLocations: [{ kind: 'contract', fullyQualifiedName: 'undocumented_pivot' }] },
    ]);
  });

  it('normalizes backslashes and a leading dot-slash to a relative reference', () => {
    const nested: Finding = {
      ...depGuard.findings[0],
      subject: { kind: 'package', name: 'x', manifest: '.\\packages\\app\\package.json' },
    };
    const log2 = sarif(result([outcome({ findings: [nested] })]));
    const location = (
      (log2.runs[0].results as Array<Record<string, unknown>>)[0].locations as Array<
        Record<string, Record<string, Record<string, unknown>>>
      >
    )[0];
    expect(location.physicalLocation.artifactLocation).toEqual({
      uri: 'packages/app/package.json',
      uriBaseId: '%SRCROOT%',
    });
  });

  it('does not put %SRCROOT% on an absolute path, since that path is not under it', () => {
    // One of the gates keeps a path absolute exactly when the file is
    // OUTSIDE the directory it scanned, so an absolute path is evidence the
    // file is not in the source root. Stripping the leading slash would
    // fabricate a source-root-relative path pointing at a different file,
    // and %SRCROOT% would then vouch for it.
    const posix: Finding = {
      ...depGuard.findings[0],
      subject: { kind: 'package', name: 'x', manifest: '/elsewhere/app/package.json' },
    };
    const windows: Finding = {
      ...depGuard.findings[0],
      subject: { kind: 'package', name: 'y', manifest: 'C:\\elsewhere\\app\\package.json' },
    };
    const log2 = sarif(result([outcome({ findings: [posix, windows] })]));
    const locations = (log2.runs[0].results as Array<Record<string, unknown>>).map(
      (entry) =>
        (entry.locations as Array<Record<string, Record<string, Record<string, unknown>>>>)[0]
          .physicalLocation.artifactLocation
    );
    expect(locations[0]).toEqual({ uri: 'file:///elsewhere/app/package.json' });
    expect(locations[1]).toEqual({ uri: 'file:///C%3A/elsewhere/app/package.json' });
    for (const location of locations) {
      expect(location).not.toHaveProperty('uriBaseId');
    }
  });

  it('drops the physical location for a path that escapes the source root', () => {
    const escaping: Finding = {
      ...depGuard.findings[0],
      subject: { kind: 'package', name: 'x', manifest: '../outside/package.json' },
    };
    const log2 = sarif(result([outcome({ findings: [escaping] })]));
    const entry = (log2.runs[0].results as Array<Record<string, unknown>>)[0];
    const locations = entry.locations as Array<Record<string, unknown>>;

    // No physical location at all: a uri of "outside/package.json" under
    // %SRCROOT% would point at a file that is not the one the gate found.
    expect(locations[0]).not.toHaveProperty('physicalLocation');
    // The package is still named.
    expect(locations[0].logicalLocations).toEqual([
      { kind: 'package', fullyQualifiedName: 'x' },
    ]);
    // And the path itself is not lost.
    expect((entry.properties as Record<string, unknown>).unresolvablePaths).toEqual([
      '../outside/package.json',
    ]);
  });

  it('catches a .. that only escapes after the segments cancel out', () => {
    const sneaky: Finding = {
      ...depGuard.findings[0],
      subject: { kind: 'package', name: 'x', manifest: 'a/../../outside/package.json' },
    };
    const log2 = sarif(result([outcome({ findings: [sneaky] })]));
    const entry = (log2.runs[0].results as Array<Record<string, unknown>>)[0];
    expect((entry.locations as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
      'physicalLocation'
    );
  });

  it('resolves an inner .. that stays inside the root', () => {
    const inner: Finding = {
      ...depGuard.findings[0],
      subject: { kind: 'package', name: 'x', manifest: 'packages/app/../lib/package.json' },
    };
    const log2 = sarif(result([outcome({ findings: [inner] })]));
    const location = (
      (log2.runs[0].results as Array<Record<string, unknown>>)[0].locations as Array<
        Record<string, Record<string, Record<string, unknown>>>
      >
    )[0];
    expect(location.physicalLocation.artifactLocation.uri).toBe('packages/lib/package.json');
  });

  it('drops a secret finding location entirely when its file escapes the root', () => {
    const escaping: Finding = {
      ...vaultGuard.findings[0],
      subject: { kind: 'location', file: '../outside/config.js', line: 2, column: 23 },
    };
    const log2 = sarif(
      result([outcome({ role: 'secrets', product: 'vault-guard', findings: [escaping] })])
    );
    const entry = (log2.runs[0].results as Array<Record<string, unknown>>)[0];
    // A region without a resolvable file would annotate line 2 of nothing.
    expect(entry).not.toHaveProperty('locations');
    expect((entry.properties as Record<string, unknown>).unresolvablePaths).toEqual([
      '../outside/config.js',
    ]);
  });
});

describe('the umbrella own findings', () => {
  it('go in a run of their own rather than under a gate that never ran', () => {
    const missing = outcome({
      role: 'secrets',
      product: 'vault-guard',
      productVersion: null,
      exitCode: null,
      couldNotRun: { reason: 'binary-missing', detail: 'nothing found' },
      findings: [
        {
          schemaVersion: 1,
          product: 'conductor',
          productVersion: null,
          ruleId: 'conductor/gate-missing',
          severity: 'critical',
          severityIsDerived: true,
          blocking: true,
          message: 'no vault-guard binary',
          subject: { kind: 'none' },
          fingerprint: { value: 'abc', scope: 'conductor', stability: 'stable' },
          details: {},
        },
      ],
    });

    const log = sarif(result([missing]));

    // A gate that never ran has no tool version and no invocation to
    // report, so inventing a vault-guard run for it would put a tool name
    // and a missing version on something vault-guard never did.
    expect(log.runs).toHaveLength(1);
    const driver = (log.runs[0].tool as Record<string, Record<string, unknown>>).driver;
    expect(driver.name).toBe('conductor');
    expect(driver.version).toBe('0.1.0');
    expect((log.runs[0].results as Array<Record<string, unknown>>)[0].ruleId).toBe(
      'conductor/gate-missing'
    );
  });

  it('carries no location, because a missing binary is not somewhere in the tree', () => {
    const missing = outcome({
      couldNotRun: { reason: 'binary-missing', detail: 'x' },
      findings: [
        {
          schemaVersion: 1,
          product: 'conductor',
          productVersion: null,
          ruleId: 'conductor/gate-missing',
          severity: 'critical',
          severityIsDerived: true,
          blocking: true,
          message: 'missing',
          subject: { kind: 'none' },
          fingerprint: null,
          details: {},
        },
      ],
    });
    const log = sarif(result([missing]));
    expect((log.runs[0].results as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
      'locations'
    );
  });

  it('carries the umbrella own diagnostics as note-level results', () => {
    // A blocking-count mismatch means the umbrella and the gate disagree
    // about what blocked. That is exactly the signal a published report has
    // to carry: it says the report may be understating what the gate did.
    const withDiagnostic = result([
      outcome({
        findings: depGuard.findings,
        diagnostics: [
          {
            code: 'conductor/blocking-count-mismatch',
            message: 'dep-guard reported 1 blocking finding(s) but the umbrella reconstructed 2.',
          },
        ],
      }),
    ]);

    const log = sarif(withDiagnostic);
    const umbrella = log.runs.find(
      (run) => (run.tool as Record<string, Record<string, unknown>>).driver.name === 'conductor'
    );
    const entry = (umbrella?.results as Array<Record<string, unknown>>)[0];

    expect(entry.ruleId).toBe('conductor/blocking-count-mismatch');
    expect(entry.level).toBe('note');
    expect((entry.message as Record<string, string>).text).toMatch(/reconstructed 2/);
    // A diagnostic is not a finding: it does not block, and it has no
    // location, because it is about the run rather than about the code.
    expect((entry.properties as Record<string, unknown>).blocking).toBe(false);
    expect(entry).not.toHaveProperty('locations');
  });

  it('names the gate a diagnostic came from, since the run it lands in is not that gate', () => {
    const withDiagnostic = result([
      outcome({
        role: 'secrets',
        product: 'vault-guard',
        findings: [],
        diagnostics: [{ code: 'conductor/blocking-threshold-unknown', message: 'no threshold' }],
      }),
    ]);
    const log = sarif(withDiagnostic);
    const umbrella = log.runs.find(
      (run) => (run.tool as Record<string, Record<string, unknown>>).driver.name === 'conductor'
    );
    const entry = (umbrella?.results as Array<Record<string, unknown>>)[0];
    const details = (entry.properties as Record<string, Record<string, unknown>>).details;
    expect(details.role).toBe('secrets');
    expect(details.product).toBe('vault-guard');
  });

  it('keeps an unenforced gate results at their own level rather than downgrading them', () => {
    // A critical finding is critical whoever decided not to block on it.
    // Rewriting the level would put the umbrella's enforcement policy into
    // the field a code-scanning UI uses to describe the finding itself.
    const log = sarif(result([outcome({ enforce: false, findings: depGuard.findings })]));
    const gateRun = log.runs[0];
    const levels = (gateRun.results as Array<Record<string, unknown>>).map((entry) => entry.level);

    expect(levels).toContain('error');
    expect(levels).not.toContain('note');
  });

  it('marks the gate own run as unenforced, and an enforced one as enforced', () => {
    const unenforced = sarif(result([outcome({ enforce: false, findings: depGuard.findings })]));
    const enforced = sarif(result([outcome({ findings: depGuard.findings })]));

    // Always present, so an absent property never has to be read as either
    // answer.
    expect((unenforced.runs[0].properties as Record<string, unknown>).enforced).toBe(false);
    expect((enforced.runs[0].properties as Record<string, unknown>).enforced).toBe(true);
  });

  it('records which stage the gate ran at, beside whether it was enforced', () => {
    // A log from a commit-stage run and one from a ci run are otherwise
    // indistinguishable for a gate that appears in both, and a consumer
    // comparing two uploads cannot tell a narrower run from a full one.
    const log = sarif(
      result([outcome({ stage: 'push', findings: depGuard.findings })])
    );
    expect(log.runs[0].properties).toEqual({ enforced: true, stage: 'push' });
  });

  it('also names an unenforced gate in the umbrella run, where a gate with no run still fits', () => {
    const log = sarif(result([outcome({ enforce: false, findings: depGuard.findings })]));
    const entry = notificationsOf(log).find(
      (candidate) =>
        (candidate.descriptor as Record<string, unknown>).id === 'conductor/gate-not-enforced'
    );

    expect(entry).toBeDefined();
    expect(entry?.level).toBe('note');
    const details = (entry?.properties as Record<string, Record<string, unknown>>).details;
    expect(details.role).toBe('dependencies');
    expect(details.product).toBe('dep-guard');
  });

  it('keeps saying a gate is unenforced when it could not run and so has no run of its own', () => {
    // The case the run-level property alone cannot carry, and the one where
    // it matters most: exit 0 with a gate that verified nothing.
    const missing = outcome({
      role: 'intent',
      product: 'intent-guard',
      productVersion: null,
      exitCode: null,
      enforce: false,
      couldNotRun: { reason: 'binary-missing', detail: 'no intent-guard binary on PATH' },
      findings: [
        {
          schemaVersion: 1,
          product: 'conductor',
          productVersion: null,
          ruleId: 'conductor/gate-missing',
          severity: 'high',
          severityIsDerived: true,
          blocking: true,
          message: 'the intent gate is enabled but no intent-guard binary was found',
          subject: { kind: 'none' },
          fingerprint: null,
          details: {},
        } satisfies Finding,
      ],
    });

    const log = sarif(result([missing]));

    expect(
      log.runs.map((run) => (run.tool as Record<string, Record<string, unknown>>).driver.name)
    ).toEqual(['conductor']);
    expect(
      notificationsOf(log).map((entry) => (entry.descriptor as Record<string, unknown>).id)
    ).toContain('conductor/gate-not-enforced');
    // And the gate that could not run is still an ALERT, in the same log.
    expect((log.runs[0].results as Array<Record<string, unknown>>).map((e) => e.ruleId)).toContain(
      'conductor/gate-missing'
    );
  });

  it('records a stage-deferred gate as a notification in the umbrella run, with no run of its own', () => {
    // Same rule as a gate that could not run: the gate produced no tool
    // output, so putting its name on a SARIF run would attribute an empty
    // run to a tool that never executed. The umbrella is the honest owner
    // of a statement about a gate that did not run.
    const log = sarif(
      result([outcome({ exitCode: 0, findings: [] })], [
        { role: 'intent', product: 'intent-guard', stage: 'ci' },
      ])
    );

    expect(
      log.runs.map((run) => (run.tool as Record<string, Record<string, unknown>>).driver.name)
    ).toEqual(['dep-guard', 'conductor']);

    const entry = notificationsOf(log)[0];
    expect((entry.descriptor as Record<string, unknown>).id).toBe('conductor/gate-deferred');
    expect(entry.level).toBe('note');
    expect(entry).not.toHaveProperty('locations');

    const details = (entry.properties as Record<string, Record<string, unknown>>).details;
    expect(details.role).toBe('intent');
    expect(details.product).toBe('intent-guard');
    expect(details.stage).toBe('ci');
  });

  it('emits no umbrella run at all when nothing was deferred and nothing went wrong', () => {
    const log = sarif(result([outcome({ exitCode: 0, findings: [] })]));
    expect(
      log.runs.map((run) => (run.tool as Record<string, Record<string, unknown>>).driver.name)
    ).toEqual(['dep-guard']);
  });

  it('still emits a gate run for a gate that ran and found nothing', () => {
    const log = sarif(result([outcome({ exitCode: 0, findings: [] })]));
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].results).toEqual([]);
  });
});

/**
 * The two exported helpers, exercised directly.
 *
 * They are exported so these rules can be read one at a time rather than only
 * through a whole rendered log, and until now nothing imported either of them,
 * so the comment saying so promised a test that did not exist. A path rule is
 * exactly the kind of thing worth pinning here: a wrong uri is
 * indistinguishable from a right one once the log is uploaded, and a rendered
 * log only ever exercises whichever spellings the fixtures happen to contain.
 */
describe('placing one path in a SARIF log', () => {
  it('keeps a path inside the root relative, for %SRCROOT%', () => {
    expect(placeArtifact('src/index.ts')).toEqual({ placement: 'in-root', uri: 'src/index.ts' });
  });

  it('forward-slashes a Windows-spelled relative path', () => {
    expect(placeArtifact('src\\deep\\index.ts')).toEqual({
      placement: 'in-root',
      uri: 'src/deep/index.ts',
    });
  });

  it('strips a leading ./, which names the same file', () => {
    expect(placeArtifact('./src/index.ts')).toEqual({ placement: 'in-root', uri: 'src/index.ts' });
  });

  it('calls an absolute path elsewhere, rather than stripping the slash off it', () => {
    // Stripping the leading slash fabricates a source-root-relative path that
    // points at a different file, and %SRCROOT% then vouches for it. One of
    // the gates keeps a path absolute exactly when the file is OUTSIDE the
    // directory it scanned, so an absolute path is positive evidence against
    // the claim %SRCROOT% would make.
    expect(placeArtifact('/etc/hosts')).toEqual({
      placement: 'outside-root',
      uri: 'file:///etc/hosts',
    });
  });

  it('treats a Windows drive prefix as absolute too', () => {
    expect(placeArtifact('C:\\Users\\dev\\secrets.txt')).toEqual({
      placement: 'outside-root',
      uri: 'file:///C%3A/Users/dev/secrets.txt',
    });
  });

  it('encodes each segment of an absolute path, keeping the separators', () => {
    // A path can legitimately hold a space or a hash and neither is legal raw
    // in a uri, but encoding the separators too would collapse the path into
    // one opaque segment.
    const placed = placeArtifact('/tmp/my notes/a#b.txt');
    expect(placed).toEqual({ placement: 'outside-root', uri: 'file:///tmp/my%20notes/a%23b.txt' });
  });

  it('refuses to place a path that escapes the root', () => {
    expect(placeArtifact('../outside.txt')).toEqual({ placement: 'unresolvable' });
  });

  it('refuses one that only escapes after normalizing, not just one that starts with ..', () => {
    // "a/../../b" escapes too, and only the second .. is visible without
    // resolving the path first.
    expect(placeArtifact('a/../../b')).toEqual({ placement: 'unresolvable' });
  });

  it('refuses a path that normalizes away to nothing', () => {
    expect(placeArtifact('.')).toEqual({ placement: 'unresolvable' });
    expect(placeArtifact('a/..')).toEqual({ placement: 'unresolvable' });
  });

  it('keeps a path that walks up and back down inside the root', () => {
    expect(placeArtifact('src/../lib/index.ts')).toEqual({
      placement: 'in-root',
      uri: 'lib/index.ts',
    });
  });
});

describe('the partialFingerprints key', () => {
  it('names the product and a version, so a later change to the inputs ships as v2', () => {
    // Hashing a product's own fingerprint together with anything would mint a
    // second identity that moves when the first does not, and every alert
    // would resurface on the next scan. The version is what lets a consumer
    // tell two generations of inputs apart instead of silently comparing
    // hashes of different things.
    expect(fingerprintKey('dep-guard')).toBe('dep-guard/v1');
    expect(fingerprintKey('conductor')).toBe('conductor/v1');
  });
});
