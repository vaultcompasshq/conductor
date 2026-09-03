import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Finding } from '../src/envelope.js';
import type { GateOutcome } from '../src/gate-runner.js';
import { normalizeDepGuard, normalizeIntentGuard, normalizeVaultGuard } from '../src/normalize.js';
import { renderSarif } from '../src/output-sarif.js';
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
    couldNotRun: null,
    findings: [],
    run: { failOn: 'medium', suppressed: 0, ignored: 0, diagnostics: [], details: {} },
    diagnostics: [],
    stderr: '',
    ...overrides,
  } as GateOutcome;
}

function result(gates: GateOutcome[]): RunResult {
  const findings = gates.flatMap((gate) => gate.findings);
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-02T00:00:00.000Z',
    gates,
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

  it('still emits a gate run for a gate that ran and found nothing', () => {
    const log = sarif(result([outcome({ exitCode: 0, findings: [] })]));
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].results).toEqual([]);
  });
});
