import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeDepGuard,
  normalizeIntentGuard,
  normalizeMissingGate,
  normalizeVaultGuard,
} from '../src/normalize.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));
}

const DEP_GUARD_BLOCKING = fixture('dep-guard-0.2.0-blocking.json');
const DEP_GUARD_CLEAN = fixture('dep-guard-0.2.0-clean.json');
const VAULT_GUARD_BLOCKING = fixture('vault-guard-1.4.2-blocking.json');
const VAULT_GUARD_CLEAN = fixture('vault-guard-1.4.2-clean.json');
const INTENT_GUARD_BUDGET = fixture('intent-guard-1.2.0-budget-blocking.json');
const INTENT_GUARD_DRIFT = fixture('intent-guard-1.2.0-drift.json');

describe('dep-guard 0.2.0 normalization', () => {
  const result = normalizeDepGuard(DEP_GUARD_BLOCKING, '0.2.0');

  it('namespaces every rule id with the product', () => {
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      'dep-guard/unknown-package',
      'dep-guard/typosquat',
    ]);
  });

  it('carries the severity through by identity and says it was not derived', () => {
    expect(result.findings[0].severity).toBe('high');
    expect(result.findings[1].severity).toBe('critical');
    expect(result.findings.every((finding) => finding.severityIsDerived === false)).toBe(true);
  });

  it('agrees with the count the gate itself reported blocking', () => {
    expect(result.findings.filter((finding) => finding.blocking)).toHaveLength(2);
    expect(result.diagnostics).toEqual([]);
  });

  it('records a diagnostic rather than overruling the gate when the counts disagree', () => {
    const tampered = JSON.parse(JSON.stringify(DEP_GUARD_BLOCKING)) as {
      run: { blockingMatches: number };
    };
    tampered.run.blockingMatches = 1;
    const disagreed = normalizeDepGuard(tampered, '0.2.0');
    expect(disagreed.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'compass/blocking-count-mismatch'
    );
    // The gate said one. The umbrella does not get to say two.
    expect(disagreed.findings.every((finding) => finding.blocking === false)).toBe(true);
  });

  it('makes the subject a package, never a fabricated file position', () => {
    expect(result.findings[1].subject).toEqual({
      kind: 'package',
      name: 'lodahs',
      manifest: 'package.json',
    });
  });

  it('carries the gate fingerprint verbatim and calls it stable', () => {
    expect(result.findings[1].fingerprint).toEqual({
      value: '2e42ec0c067e77b5c97f3e8c1cdf9275aba9d3b439973de3035719b6f3a265e7',
      scope: 'dep-guard',
      stability: 'stable',
    });
  });

  it('passes the details bag through unchanged', () => {
    expect(result.findings[1].details).toEqual({
      matchedBy: 'alias-list',
      target: 'lodash',
      targetRank: 149,
      specifier: '1.0.0',
      depType: 'dependencies',
    });
  });

  it('keeps diagnostics out of findings, the way the gate itself does', () => {
    expect(result.run.diagnostics).toEqual([
      {
        code: 'lockfile-missing',
        message:
          'no lockfile was found, so the lockfile-tamper and install-script checks had nothing to read and were skipped; the manifest-level checks still ran',
      },
    ]);
    expect(result.findings).toHaveLength(2);
  });

  it('reports the gate own suppressed and ignored counts', () => {
    expect(result.run.suppressed).toBe(0);
    expect(result.run.ignored).toBe(0);
    expect(result.run.failOn).toBe('medium');
  });

  it('produces nothing from a clean run', () => {
    const clean = normalizeDepGuard(DEP_GUARD_CLEAN, '0.2.0');
    expect(clean.findings).toEqual([]);
  });

  it('refuses output that is not the shape it knows', () => {
    expect(() => normalizeDepGuard({ nope: true }, '0.2.0')).toThrow(/dep-guard/);
  });
});

describe('vault-guard 1.4.2 normalization', () => {
  const result = normalizeVaultGuard(VAULT_GUARD_BLOCKING, '1.4.2');

  it('flattens the file nesting into one namespaced finding per match', () => {
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].ruleId).toBe('vault-guard/github-token');
  });

  it('synthesises the message the JSON output does not carry', () => {
    expect(result.findings[0].message).toBe("Possible secret of type 'github-token'");
  });

  it('converts the 0-based JSON column to a 1-based envelope column', () => {
    expect(result.findings[0].subject).toEqual({
      kind: 'location',
      file: 'src/config.js',
      line: 2,
      column: 23,
    });
  });

  it('never invents an end column, because the JSON output has no match length', () => {
    const subject = result.findings[0].subject;
    expect(subject.kind).toBe('location');
    expect(Object.keys(subject)).not.toContain('endColumn');
  });

  it('marks the fingerprint positional rather than stable', () => {
    expect(result.findings[0].fingerprint).toEqual({
      value: '85ce78fecbada885e18040c4ef1299a29367a1d2eec35fec239ab556a0172c79',
      scope: 'vault-guard',
      stability: 'positional',
    });
  });

  it('gates on run.blocking_matches, not on summary.secrets', () => {
    const noneBlocking = JSON.parse(JSON.stringify(VAULT_GUARD_BLOCKING)) as {
      run: { blocking_matches: number; fail_on: string };
    };
    noneBlocking.run.blocking_matches = 0;
    noneBlocking.run.fail_on = 'none';
    const relaxed = normalizeVaultGuard(noneBlocking, '1.4.2');
    // summary.secrets is still 1. It is not what decides anything.
    expect(relaxed.findings[0].blocking).toBe(false);
  });

  it('keeps the redacted value in the details bag, since the source already redacted it', () => {
    expect(result.findings[0].details.value).toMatch(/^ghp_/);
    expect(result.findings[0].details.offset).toBe(93);
  });

  it('produces nothing from a clean run', () => {
    expect(normalizeVaultGuard(VAULT_GUARD_CLEAN, '1.4.2').findings).toEqual([]);
  });

  it('derives a severity it does not recognise rather than passing an unknown level through', () => {
    const odd = JSON.parse(JSON.stringify(VAULT_GUARD_BLOCKING)) as {
      results: Array<{ matches: Array<{ severity: string }> }>;
    };
    odd.results[0].matches[0].severity = 'spicy';
    const normalized = normalizeVaultGuard(odd, '1.4.2');
    expect(normalized.findings[0].severity).toBe('info');
    expect(normalized.findings[0].severityIsDerived).toBe(true);
  });

  it('refuses output that is not the shape it knows', () => {
    expect(() => normalizeVaultGuard({ results: 'nope' }, '1.4.2')).toThrow(/vault-guard/);
  });
});

describe('intent-guard 1.2.0 normalization', () => {
  const result = normalizeIntentGuard(INTENT_GUARD_BUDGET, '1.2.0');

  it('turns every budget violation into its own namespaced finding', () => {
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      'intent-guard/budget.protected_paths',
      'intent-guard/budget.max_files',
      'intent-guard/budget.allow_new_dependencies',
    ]);
  });

  it('derives the severity from the budget action and says so', () => {
    expect(result.findings[0].severity).toBe('critical');
    expect(result.findings[1].severity).toBe('high');
    expect(result.findings.every((finding) => finding.severityIsDerived)).toBe(true);
  });

  it('blocks on every violation, because the gate itself raises a reason for each', () => {
    expect(result.findings.every((finding) => finding.blocking)).toBe(true);
  });

  it('makes the subject a path list rather than inventing a line number', () => {
    expect(result.findings[1].subject).toEqual({
      kind: 'paths',
      paths: ['package.json', 'src/config.js'],
    });
  });

  it('carries the budget fingerprint verbatim and calls it stable', () => {
    expect(result.findings[0].fingerprint).toEqual({
      value: '15ffc0289ba23314504884f36b594be823b104c08925c0f863257caaeadb4511',
      scope: 'intent-guard',
      stability: 'stable',
    });
  });

  it('emits one finding per drift finding now that 1.2.0 gives them stable ids', () => {
    const drift = normalizeIntentGuard(INTENT_GUARD_DRIFT, '1.2.0');
    const driftFindings = drift.findings.filter((finding) =>
      finding.ruleId.startsWith('intent-guard/drift.')
    );
    expect(driftFindings).toHaveLength(1);
    expect(driftFindings[0].ruleId).toBe('intent-guard/drift.undocumented_pivot');
    expect(driftFindings[0].fingerprint).toEqual({
      value: 'aeda5f744d5965f9f44e247ffb38b4373f8f505b879ea270b3c139a414e8bf9c',
      scope: 'intent-guard',
      stability: 'stable',
    });
    expect(driftFindings[0].subject).toEqual({
      kind: 'contract',
      category: 'undocumented_pivot',
    });
  });

  it('does not block on a drift finding whose overall action is not blocking', () => {
    const drift = normalizeIntentGuard(INTENT_GUARD_DRIFT, '1.2.0');
    const driftFinding = drift.findings.find((finding) =>
      finding.ruleId.startsWith('intent-guard/drift.')
    );
    // The fixture scores 7 overall, action "proceed": the finding is real
    // and reportable, and it is not what blocked the commit.
    expect(driftFinding?.blocking).toBe(false);
  });

  it('carries the score and the category breakdown in the run block', () => {
    const drift = normalizeIntentGuard(INTENT_GUARD_DRIFT, '1.2.0');
    expect(drift.run.details).toMatchObject({
      driftOverall: 7,
      driftAction: 'proceed',
      contractFound: true,
      contractFrozen: true,
    });
  });

  it('never lets a blocked gate report zero blocking findings', () => {
    const unfrozen = {
      status: 'blocked',
      exitCode: 1,
      reasons: ['Intent contract exists but is not frozen by user.'],
      contractFound: true,
      contractFrozen: false,
    };
    const normalized = normalizeIntentGuard(unfrozen, '1.2.0');
    expect(normalized.findings).toHaveLength(1);
    expect(normalized.findings[0].ruleId).toBe('intent-guard/gate-blocked');
    expect(normalized.findings[0].blocking).toBe(true);
    expect(normalized.findings[0].fingerprint).toBeNull();
    expect(normalized.findings[0].details.reasons).toEqual(unfrozen.reasons);
  });

  it('refuses output that is not the shape it knows', () => {
    expect(() => normalizeIntentGuard({ status: 'maybe' }, '1.2.0')).toThrow(/intent-guard/);
  });
});

describe('the umbrella own missing-gate finding', () => {
  const finding = normalizeMissingGate('dependencies', 'dep-guard', ['dep-guard']);

  it('is a blocking finding of the umbrella, not a silent skip', () => {
    expect(finding.ruleId).toBe('compass/gate-missing');
    expect(finding.blocking).toBe(true);
    expect(finding.product).toBe('compass');
  });

  it('has no subject, because a missing binary is not somewhere in the tree', () => {
    expect(finding.subject).toEqual({ kind: 'none' });
  });

  it('names every binary it looked for', () => {
    expect(finding.message).toMatch(/dep-guard/);
    expect(finding.details.candidates).toEqual(['dep-guard']);
  });

  it('fingerprints deterministically so a repeat run is the same alert', () => {
    const again = normalizeMissingGate('dependencies', 'dep-guard', ['dep-guard']);
    expect(finding.fingerprint?.value).toBe(again.fingerprint?.value);
    expect(finding.fingerprint?.stability).toBe('stable');
    const other = normalizeMissingGate('secrets', 'vault-guard', ['vault-guard']);
    expect(other.fingerprint?.value).not.toBe(finding.fingerprint?.value);
  });
});
