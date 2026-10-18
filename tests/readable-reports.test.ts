// Readable reports (phase 3, items 3.1 to 3.3): what the text report says
// about osv-scanner and gitleaks findings, how much of it it says, and what a
// refused or failed gate prints. Every case here is presentational: none of
// them may move an exit code, a verdict token or a blocking flag, and the
// cases that could are asserted on those too.

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Finding } from '../src/envelope.js';
import type { GateOutcome } from '../src/gate-runner.js';
import {
  normalizeDepGuard,
  normalizeFailedGate,
  normalizeGitleaks,
  normalizeOsvScanner,
  normalizeUnparseableGate,
  osvSuppressions,
} from '../src/normalize.js';
import { rendersToTerminal } from '../src/cli.js';
import { renderSarif } from '../src/output-sarif.js';
import { FINDINGS_SHOWN_PER_GATE, gateLogLines, renderText, verdictToken } from '../src/output-text.js';
import { refusedTrustBase } from '../src/run.js';
import type { RunResult } from '../src/run.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function text(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

function outcome(overrides: Partial<GateOutcome>): GateOutcome {
  return {
    role: 'vulnerabilities',
    product: 'osv-scanner',
    productVersion: '2.4.0',
    argv: [],
    binary: null,
    exitCode: 1,
    durationMs: 10,
    stage: 'ci',
    enforce: true,
    couldNotRun: null,
    findings: [],
    run: { failOn: 'any', suppressed: 0, ignored: 0, diagnostics: [], details: {} },
    diagnostics: [],
    stderr: '',
    ...overrides,
  } as GateOutcome;
}

function result(gates: GateOutcome[], exitCode: number): RunResult {
  const findings = gates.flatMap((gate) => gate.findings);
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-17T00:00:00.000Z',
    gates,
    deferred: [],
    skipped: [],
    excluded: [],
    treeUnchanged: [],
    findings,
    trustBase: null,
    proposals: [],
    summary: { blocking: findings.filter((finding) => finding.blocking).length, byProduct: {}, bySeverity: {} },
    exitCode,
  };
}

const ROOT = '/tmp/conductor-osv-fixture';
const TWO = normalizeOsvScanner(
  fixture('osv-scanner-2.4.0-two-lockfiles.json'),
  '2.4.0',
  true,
  [ROOT],
  ['a/package-lock.json', 'b/package-lock.json']
);

function osvGate(normalized = TWO): GateOutcome {
  return outcome({ findings: normalized.findings, run: normalized.run });
}

describe('osv-scanner findings readability (3.1)', () => {
  it('carries the dev marker osv-scanner gives a package, and the fix for the installed version', () => {
    const minimist = TWO.findings.find((finding) => finding.ruleId === 'osv-scanner/GHSA-xvch-5gv4-984h');
    expect(minimist?.details.dependencyGroups).toEqual(['dev']);
    expect(minimist?.details.fixedVersion).toBe('1.2.6');
    const lodash = TWO.findings.filter((finding) => finding.ruleId === 'osv-scanner/GHSA-35jh-r3h4-6jhm');
    expect(lodash).toHaveLength(2);
    expect(lodash[0]?.details.dependencyGroups).toBeUndefined();
  });

  it('shows package@installed-version, the fix and the dev marker on the line', () => {
    const report = renderText(result([osvGate()], 1));
    expect(report).toMatch(
      /osv-scanner\/GHSA-xvch-5gv4-984h {2}minimist@1\.2\.5 \(a\/package-lock\.json\) {2}fix 1\.2\.6 {2}dev\n/
    );
  });

  it('says "no fix" when no release fixes the installed version', () => {
    const noFix = TWO.findings.map((finding) => {
      const { fixedVersion: _drop, ...details } = finding.details;
      return { ...finding, details };
    });
    const report = renderText(result([outcome({ findings: noFix, run: TWO.run })], 1));
    expect(report).toMatch(/minimist@1\.2\.5 \(a\/package-lock\.json\) {2}no fix listed {2}dev/);
  });

  it('groups one advisory on one installed package across lockfiles into one line, listed with --verbose', () => {
    const report = renderText(result([osvGate()], 1));
    const lines = report.split('\n').filter((line) => line.includes('GHSA-35jh-r3h4-6jhm'));
    expect(lines).toEqual(['  BLOCKING  high*     osv-scanner/GHSA-35jh-r3h4-6jhm  lodash@4.17.20 2 lockfiles  fix 4.17.21']);
    expect(report).not.toContain('lockfiles: a/package-lock.json, b/package-lock.json');
    const verbose = renderText(result([osvGate()], 1), { verbose: true });
    expect(verbose).toContain('      lockfiles: a/package-lock.json, b/package-lock.json');
  });

  it('keeps every finding behind a grouped line: the count line, SARIF and the verdict are unchanged', () => {
    const run = result([osvGate()], 1);
    expect(renderText(run)).toContain('conductor run: 1 gate(s), 3 finding(s)');
    expect(verdictToken(run, false)).toBe('blocked (3)');
    const sarif = JSON.parse(renderSarif(run, '0.0.0')) as { runs: Array<{ results: unknown[] }> };
    expect(sarif.runs.flatMap((each) => each.results).filter((r) => JSON.stringify(r).includes('GHSA-35jh'))).toHaveLength(2);
  });

  it('osv-scanner 2.4.0 prints one result per lockfile handed with --lockfile, and the count says lockfiles with findings', () => {
    expect((fixture('osv-scanner-2.4.0-two-lockfiles.json') as { results: unknown[] }).results).toHaveLength(2);
    expect(TWO.run.details['sources-with-findings']).toBe(2);
  });

  it('does not count a result that carries no advisory as a lockfile with findings', () => {
    const raw = fixture('osv-scanner-2.4.0-two-lockfiles.json') as {
      results: Array<{ packages: Array<{ vulnerabilities: unknown[]; groups: unknown[] }> }>;
    };
    // The second lockfile's package with no advisory left on it, the shape a
    // licence-only or deprecation-only verdict has.
    const second = raw.results[1]?.packages[0];
    if (second !== undefined) {
      second.vulnerabilities = [];
      second.groups = [];
    }
    const out = normalizeOsvScanner(raw, '2.4.0', true, [ROOT], ['a/package-lock.json', 'b/package-lock.json']);
    expect(out.run.details['sources-with-findings']).toBe(1);
  });

  it('reads the osv-scanner.toml suppressions osv-scanner prints on stderr, ids and reasons, never an expiry', () => {
    const said = osvSuppressions(text('osv-scanner-2.4.0-filtered.stderr.txt'));
    expect(said).toEqual({
      count: 4,
      ids: [
        { id: 'GHSA-29mw-wpgm-hmr9', reason: 'no expiry' },
        { id: 'GHSA-35jh-r3h4-6jhm', reason: 'synthetic fixture' },
      ],
    });
    expect(osvSuppressions('Scanned x file and found 2 packages\n')).toBeNull();
  });

  it('reports the suppressed count osv-scanner printed, labelled as its count, instead of a hard-coded 0', () => {
    const out = normalizeOsvScanner(
      fixture('osv-scanner-2.4.0-two-lockfiles.json'),
      '2.4.0',
      true,
      [ROOT],
      ['a/package-lock.json', 'b/package-lock.json'],
      text('osv-scanner-2.4.0-filtered.stderr.txt')
    );
    expect(out.run.suppressed).toBe(4);
    const report = renderText(result([osvGate(out)], 1));
    expect(report).toContain('threshold any   suppressed 4   ignored 0');
    expect(report).toContain(
      'suppressed-by-osv-scanner.toml GHSA-29mw-wpgm-hmr9 (no expiry), GHSA-35jh-r3h4-6jhm (synthetic fixture); ' +
        'counted by osv-scanner once per advisory per lockfile; expiry not reported by osv-scanner'
    );
    // No stderr count line: the old 0, and no claim.
    expect(TWO.run.suppressed).toBe(0);
    expect(TWO.run.details['suppressed-by-osv-scanner.toml']).toBeUndefined();
  });

  it('strips control characters from a suppression reason, which is text from the repository', () => {
    const said = osvSuppressions(
      'GHSA-x and 1 alias have been filtered out because: bad\u001b[31m red\nFiltered 1 vulnerabilities from output\n'
    );
    expect(said?.ids[0]?.reason).toBe('bad[31m red');
  });
});

describe('gitleaks findings readability (3.2)', () => {
  const doubled = normalizeGitleaks(fixture('gitleaks-8.30.1-merge-doubled.json'), '8.30.1', true);

  it('shows the short commit and the fingerprint under each finding', () => {
    const report = renderText(
      result([outcome({ role: 'secrets-history', product: 'gitleaks', exitCode: 3, findings: doubled.findings, run: doubled.run })], 1)
    );
    expect(report).toContain(
      '      commit 252f53e  fingerprint 252f53e499d6b657bc8865ea7f6ac5fa60bab49f:config.txt:github-pat:5'
    );
    expect(report).toContain(
      '      commit a45fca7  fingerprint a45fca73a783a24de4986fa5781506a3a5aab980:config.txt:github-pat:3'
    );
  });

  it('labels the raw record count and the distinct count apart', () => {
    expect(doubled.run.details).toEqual({ 'entries-raw': 2, 'entries-distinct': 2 });
    const collapsed = normalizeGitleaks(
      [
        { RuleID: 'r', File: 'f', StartLine: 1, StartColumn: 2, Commit: 'aaaaaaa1', Date: '2026-01-02T00:00:00Z' },
        { RuleID: 'r', File: 'f', StartLine: 1, StartColumn: 2, Commit: 'bbbbbbb2', Date: '2026-01-01T00:00:00Z' },
      ],
      '8.30.1',
      true
    );
    expect(collapsed.run.details).toEqual({ 'entries-raw': 2, 'entries-distinct': 1 });
  });

  it('keeps the merge copy on a moved line as its own finding, and names the likely pair', () => {
    // The two records differ in StartLine, Commit, Date and Fingerprint; under
    // --redact nothing in either identifies the secret, so neither is dropped.
    expect(doubled.findings).toHaveLength(2);
    const [merge, original] = doubled.findings as [Finding, Finding];
    expect(merge.details.possiblySameSecretAs).toEqual([original.fingerprint?.value]);
    expect(original.details.possiblySameSecretAs).toEqual([merge.fingerprint?.value]);
    const report = renderText(
      result([outcome({ role: 'secrets-history', product: 'gitleaks', exitCode: 3, findings: doubled.findings, run: doubled.run })], 1)
    );
    expect(report).toContain('possibly the same secret as a45fca73a783a24de4986fa5781506a3a5aab980:config.txt:github-pat:3');
  });

  it('does not pair two records whose entropy differs', () => {
    const raw = fixture('gitleaks-8.30.1-merge-doubled.json') as Array<Record<string, unknown>>;
    (raw[1] as Record<string, unknown>).Entropy = 4.2;
    const out = normalizeGitleaks(raw, '8.30.1', true);
    expect(out.findings.every((finding) => finding.details.possiblySameSecretAs === undefined)).toBe(true);
  });
});

function manyFindings(count: number): Finding[] {
  return Array.from({ length: count }, (_, index) => ({
    schemaVersion: 1,
    product: 'gitleaks',
    productVersion: '8.30.1',
    ruleId: 'gitleaks/generic-api-key',
    severity: 'high',
    severityIsDerived: true,
    blocking: true,
    message: `leak number ${index}`,
    subject: { kind: 'location', file: `f${index}.txt`, line: 1, column: 1 },
    fingerprint: { value: `c:f${index}.txt:generic-api-key:1`, scope: 'gitleaks', stability: 'stable' },
    details: {},
  }));
}

describe('report volume (3.3)', () => {
  const many = outcome({
    role: 'secrets-history',
    product: 'gitleaks',
    exitCode: 3,
    findings: manyFindings(FINDINGS_SHOWN_PER_GATE + 5),
    run: { failOn: 'any', suppressed: 0, ignored: 0, diagnostics: [], details: {} },
  });

  it('rolls up a gate past the cap into one line, and --verbose lifts it', () => {
    const report = renderText(result([many], 1));
    expect(report.split('\n').filter((line) => line.includes('gitleaks/generic-api-key'))).toHaveLength(
      FINDINGS_SHOWN_PER_GATE
    );
    expect(report).toContain(
      '  5 more finding(s) in this gate, not shown here: re-run with --verbose, or read the SARIF report (--format sarif).'
    );
    const verbose = renderText(result([many], 1), { verbose: true });
    expect(verbose.split('\n').filter((line) => line.includes('gitleaks/generic-api-key'))).toHaveLength(
      FINDINGS_SHOWN_PER_GATE + 5
    );
    expect(verbose).not.toContain('more finding(s) in this gate');
  });

  it('never drops a capped finding from the counts, the verdict, the token or SARIF', () => {
    const run = result([many], 1);
    const report = renderText(run);
    expect(report).toContain(`conductor run: 1 gate(s), ${FINDINGS_SHOWN_PER_GATE + 5} finding(s)`);
    expect(report).toContain(`verdict: exit 1, ${FINDINGS_SHOWN_PER_GATE + 5} blocking finding(s)`);
    expect(verdictToken(run, false)).toBe(`blocked (${FINDINGS_SHOWN_PER_GATE + 5})`);
    const sarif = JSON.parse(renderSarif(run, '0.0.0')) as { runs: Array<{ results: unknown[] }> };
    expect(sarif.runs.flatMap((each) => each.results)).toHaveLength(FINDINGS_SHOWN_PER_GATE + 5);
  });

  // Audit 2026-10-18 N2: one osv advisory over two lockfiles is ONE line and
  // TWO findings, and the rollup counts findings. Counting lines stayed
  // green on every test before this one.
  it('counts findings, not lines, when the hidden osv lines group several lockfiles', () => {
    const advisories = FINDINGS_SHOWN_PER_GATE + 3;
    const grouped: Finding[] = Array.from({ length: advisories }, (_, index) =>
      ['a/package-lock.json', 'b/package-lock.json'].map(
        (lockfile): Finding => ({
          schemaVersion: 1,
          product: 'osv-scanner',
          productVersion: '2.4.0',
          ruleId: `osv-scanner/GHSA-test-${String(index).padStart(4, '0')}`,
          severity: 'high',
          severityIsDerived: false,
          blocking: true,
          message: `advisory ${index}`,
          subject: { kind: 'package', name: `pkg${index}`, manifest: lockfile, lockfile },
          fingerprint: { value: `GHSA-test-${index}:${lockfile}`, scope: 'osv-scanner', stability: 'stable' },
          details: { version: '1.0.0' },
        })
      )
    ).flat();
    const osv = outcome({
      role: 'vulnerabilities',
      product: 'osv-scanner',
      exitCode: 1,
      findings: grouped,
      run: { failOn: 'any', suppressed: 0, ignored: 0, diagnostics: [], details: {} },
    });
    const report = renderText(result([osv], 1));
    expect(report.split('\n').filter((line) => line.includes('osv-scanner/GHSA-test-'))).toHaveLength(
      FINDINGS_SHOWN_PER_GATE
    );
    expect(report).toContain('  6 more finding(s) in this gate, not shown here');
    expect(report).toContain(`conductor run: 1 gate(s), ${advisories * 2} finding(s)`);
  });

  it('prints no rollup at exactly the cap', () => {
    const exact = { ...many, findings: manyFindings(FINDINGS_SHOWN_PER_GATE) };
    expect(renderText(result([exact], 1))).not.toContain('more finding(s) in this gate');
  });

  const refused = refusedTrustBase(
    {
      version: 1,
      gates: {
        dependencies: {
          role: 'dependencies',
          product: 'dep-guard',
          enabled: true,
          stage: 'commit',
          enforce: true,
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
    },
    'refs/remotes/origin/main',
    'the ref does not resolve. Nothing was checked.',
    { now: () => new Date('2026-10-17T00:00:00Z') }
  );

  it('prints a refusal once on a terminal, with one line per gate', () => {
    const report = renderText(refused, { terminal: true });
    expect(report.split('the ref does not resolve').length - 1).toBe(1);
    expect(report).toContain('  dependencies  dep-guard  did not run: the trust base was refused (above)');
    expect(report).toContain('  secrets  vault-guard  did not run: the trust base was refused (above)');
    expect(report.split('\n')[0]).toBe('verdict-token: could-not-run');
  });

  it('keeps the full refused report everywhere else', () => {
    const report = renderText(refused);
    expect(report.split('the ref does not resolve').length - 1).toBeGreaterThan(1);
    expect(report).toContain('DID NOT RUN (preparation-failed)');
  });

  it('prints the refused run log as one line on a terminal, one per gate otherwise', () => {
    expect(gateLogLines(refused, { terminal: true })).toEqual([
      'conductor: the trust base was refused, so no gate ran: dependencies (dep-guard), secrets (vault-guard); could-not-run, no exit code',
    ]);
    expect(gateLogLines(refused)).toHaveLength(2);
  });

  it('prints a failed gate reason and its stderr once, not again inside its finding', () => {
    const stderr = 'vault-guard: cannot read .vault-guard.json: unexpected token\n';
    const detail = 'the gate exited 2, which it uses for "could not run".';
    const failed = outcome({
      role: 'secrets',
      product: 'vault-guard',
      exitCode: 2,
      stderr,
      couldNotRun: { reason: 'gate-error', detail, gateSaid: 'vault-guard: cannot read .vault-guard.json: unexpected token' },
      findings: [normalizeFailedGate('secrets', 'vault-guard', detail, stderr)],
    });
    const report = renderText(result([failed], 2));
    expect(report.split('unexpected token').length - 1).toBe(2); // gate said, and the stderr line
    expect(report.split(detail).length - 1).toBe(1);
    expect(report).toContain('      Nothing was verified by this gate; the reason is above.');
    // SARIF keeps the whole message: it is the only record a published log has.
    const sarif = renderSarif(result([failed], 2), '0.0.0');
    expect(sarif).toContain('The gate wrote to stderr: vault-guard: cannot read .vault-guard.json');
  });

  const deadline = normalizeDepGuard(
    {
      findings: [],
      run: {
        failOn: 'medium',
        blockingMatches: 0,
        online: { enabled: true, lookupsAttempted: 5, lookupsSkippedByDeadline: 2 },
        diagnostics: [{ code: 'online-deadline-exceeded', message: 'online budget spent; 2 lookups skipped' }],
      },
    },
    '0.11.1'
  );
  const depGate = outcome({
    role: 'dependencies',
    product: 'dep-guard',
    productVersion: '0.11.1',
    exitCode: 0,
    findings: [],
    run: deadline.run,
  });

  it('says a dep-guard deadline cut its online lookups short on the clean summary line, still exit 0', () => {
    const run = result([depGate], 0);
    const summary = renderText(run);
    expect(summary.split('\n')).toHaveLength(2);
    expect(summary).toContain(
      'dependencies (dep-guard): online lookups incomplete, 2 skipped by the deadline (online-deadline-exceeded).'
    );
    expect(run.exitCode).toBe(0);
    expect(verdictToken(run, false)).toBe('pass');
    expect(gateLogLines(run)).toEqual([
      'conductor: gate dependencies (dep-guard 0.11.1): ok, online lookups incomplete, 2 skipped by the deadline (online-deadline-exceeded), exit 0',
    ]);
  });

  it('leaves the clean summary line byte for byte alone when there was no deadline', () => {
    const clean = outcome({
      role: 'dependencies',
      product: 'dep-guard',
      exitCode: 0,
      run: { failOn: 'medium', suppressed: 0, ignored: 0, diagnostics: [], details: {} },
    });
    expect(renderText(result([clean], 0))).toBe(
      'conductor: clean, nothing blocked. 1 gate(s) ran: dependencies (dep-guard). 0 gate(s) left out by --gate. ' +
        '0 gate(s) not enforced. 0 suppressed, 0 ignored across all gates. Re-run with --verbose for the full report.\n'
    );
  });
});

describe('review fix round', () => {
  // What real osv-scanner 2.4.0 printed for an osv-scanner.toml reason
  // carrying a newline, an ESC colour code and a forged second line.
  const HOSTILE =
    'GHSA-35jh-r3h4-6jhm and 1 alias have been filtered out because: one\u001b[31m red\u0007\n' +
    '\u001b[0mFORGED-ID and 0 aliases have been filtered out because: forged\n' +
    'FORGED\u001b]0;x\u0007-ID and 0 aliases have been filtered out because: forged too\n' +
    'Filtered 3 vulnerabilities from output\n';

  it('never lets a control byte from osv-scanner stderr reach the fact, the text report, SARIF or the comment body (B1)', () => {
    const out = normalizeOsvScanner(
      fixture('osv-scanner-2.4.0-two-lockfiles.json'),
      '2.4.0',
      true,
      [ROOT],
      ['a/package-lock.json', 'b/package-lock.json'],
      HOSTILE
    );
    const fact = String(out.run.details['suppressed-by-osv-scanner.toml']);
    expect(fact).toBe(
      'GHSA-35jh-r3h4-6jhm (one[31m red); counted by osv-scanner once per advisory per lockfile; expiry not reported by osv-scanner'
    );
    const run = result([osvGate(out)], 1);
    // eslint-disable-next-line no-control-regex
    const control = /[\u0000-\u0008\u000b-\u001f\u007f]/;
    for (const body of [renderText(run), renderText(run, { verbose: true, compact: true }), renderSarif(run, '0.0.0')]) {
      expect(body).not.toMatch(control);
      expect(body).not.toContain('FORGED');
    }
  });

  it('ignores a filtered count too large to be a safe integer, rather than printing Infinity', () => {
    const huge = `Filtered ${'9'.repeat(400)} vulnerabilities from output\n`;
    expect(osvSuppressions(huge)).toBeNull();
    const out = normalizeOsvScanner(
      fixture('osv-scanner-2.4.0-two-lockfiles.json'),
      '2.4.0',
      true,
      [ROOT],
      ['a/package-lock.json', 'b/package-lock.json'],
      huge
    );
    expect(out.run.suppressed).toBe(0);
    expect(renderText(result([osvGate(out)], 1))).not.toContain('Infinity');
  });

  it('pairs two gitleaks records only when they come from different commits', () => {
    const raw = fixture('gitleaks-8.30.1-merge-doubled.json') as Array<Record<string, unknown>>;
    (raw[1] as Record<string, unknown>).Commit = (raw[0] as Record<string, unknown>).Commit;
    const out = normalizeGitleaks(raw, '8.30.1', true);
    expect(out.findings).toHaveLength(2);
    expect(out.findings.every((finding) => finding.details.possiblySameSecretAs === undefined)).toBe(true);
  });

  it('keeps the out-of-date sentence in a shortened gate-output-unparseable line', () => {
    const detail = 'the gate exited 0 without valid JSON on stdout.';
    const broken = outcome({
      role: 'secrets',
      product: 'vault-guard',
      exitCode: 0,
      couldNotRun: { reason: 'unparseable-output', detail },
      findings: [normalizeUnparseableGate('secrets', 'vault-guard', detail)],
    });
    expect(renderText(result([broken], 2))).toContain(
      '      Nothing was verified by this gate; the reason is above. This is the umbrella being out of date with that gate, not a problem in your code.'
    );
  });

  it('prints no severity footnote on a compact terminal refusal, which shows no finding line', () => {
    const refused = refusedTrustBase(
      {
        version: 1,
        gates: {
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
      },
      'main',
      'the ref does not resolve.',
      { now: () => new Date('2026-10-17T00:00:00Z') }
    );
    expect(renderText(refused, { terminal: true })).not.toContain('severity assigned by the umbrella');
    expect(renderText(refused)).toContain('severity assigned by the umbrella');
  });

  it('renders for a terminal only when stdout is a TTY and no --output was given', () => {
    expect(rendersToTerminal(undefined, true)).toBe(true);
    expect(rendersToTerminal(undefined, false)).toBe(false);
    expect(rendersToTerminal(undefined, undefined)).toBe(false);
    expect(rendersToTerminal('conductor.sarif', true)).toBe(false);
  });

  it('says "no fix listed" when osv-scanner gave no fixed version', () => {
    const noFix = TWO.findings.map((finding) => {
      const { fixedVersion: _drop, ...details } = finding.details;
      return { ...finding, details };
    });
    expect(renderText(result([outcome({ findings: noFix, run: TWO.run })], 1))).toContain('no fix listed');
  });
});
