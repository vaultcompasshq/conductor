import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GATE_STATE_REASON_KINDS,
  classifyGateStateReason,
  cvssToSeverity,
  normalizeDepGuard,
  normalizeGitleaks,
  normalizeIntentGuard,
  normalizeMissingGate,
  normalizeOsvScanner,
  normalizeVaultGuard,
} from '../src/normalize.js';
import { NormalizeError } from '../src/envelope.js';

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
const INTENT_GUARD_ADVISORY_CAPPED = fixture('intent-guard-1.7.0-check-advisory-capped.json');
const INTENT_GUARD_UNCAPPED_CONSTRAINT_BLOCKING = fixture(
  'intent-guard-1.7.0-check-uncapped-constraint-blocking.json'
);

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
      'conductor/blocking-count-mismatch'
    );
    // The gate said one. The umbrella does not get to say two.
    expect(disagreed.findings.every((finding) => finding.blocking === false)).toBe(true);
  });

  it('records a diagnostic rather than guessing when the gate reported no threshold', () => {
    // The other branch of reconcileBlocking, and the one nothing pinned. Both
    // codes exist only in normalize.ts, and every test that named one before
    // this hand-wrote it into a fixture, so nothing held the renderers and the
    // docs to the spelling the normalizer actually emits.
    const noThreshold = JSON.parse(JSON.stringify(DEP_GUARD_BLOCKING)) as {
      run: { failOn?: string };
    };
    delete noThreshold.run.failOn;
    const unknown = normalizeDepGuard(noThreshold, '0.2.0');

    expect(unknown.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'conductor/blocking-threshold-unknown',
    ]);
    // Nothing is marked blocking: with no threshold there is nothing to
    // reconstruct the flag from, and the gate's own exit code still decides.
    expect(unknown.findings.every((finding) => finding.blocking === false)).toBe(true);
    expect(unknown.run.failOn).toBeNull();
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

describe('dep-guard online reporting (issue #72, fix round)', () => {
  it('prints dep-guard\'s own enabled claim, true, even when the umbrella never passed --online', () => {
    // dep-guard also turns online checks on from "online": true in its own
    // config, with no flag at all. If the umbrella asserted "online false"
    // from the missing flag here, that would be a stated fact contradicted
    // by dep-guard's own JSON on the very next line.
    const withOnline = JSON.parse(JSON.stringify(DEP_GUARD_CLEAN)) as { run: Record<string, unknown> };
    withOnline.run.online = { enabled: true };
    const out = normalizeDepGuard(withOnline, '0.2.0', false);
    expect(out.run.details.online).toBe(true);
    expect(out.run.details['online-flag']).toBeUndefined();
  });

  it('prints dep-guard\'s own enabled claim, false, even when the umbrella did pass --online', () => {
    // dep-guard's own statement about what it actually did wins over the
    // umbrella's statement about what it asked for.
    const withOnline = JSON.parse(JSON.stringify(DEP_GUARD_CLEAN)) as { run: Record<string, unknown> };
    withOnline.run.online = { enabled: false };
    const out = normalizeDepGuard(withOnline, '0.2.0', true);
    expect(out.run.details.online).toBe(false);
    expect(out.run.details['online-flag']).toBeUndefined();
  });

  it('prints the flag as a flag, never as "online false", when there is no online object to read', () => {
    const noFlag = normalizeDepGuard(DEP_GUARD_CLEAN, '0.2.0', false);
    expect(noFlag.run.details['online-flag']).toBe('not passed');
    expect(noFlag.run.details.online).toBeUndefined();

    const withFlag = normalizeDepGuard(DEP_GUARD_CLEAN, '0.2.0', true);
    expect(withFlag.run.details['online-flag']).toBe('passed');
    expect(withFlag.run.details.online).toBeUndefined();
  });

  it('defaults to the not-passed flag wording when the caller says nothing, for every existing call site', () => {
    expect(normalizeDepGuard(DEP_GUARD_CLEAN, '0.2.0').run.details['online-flag']).toBe('not passed');
  });

  it('reads lookup and skipped counts from a well-formed online object', () => {
    const withOnline = JSON.parse(JSON.stringify(DEP_GUARD_CLEAN)) as { run: Record<string, unknown> };
    withOnline.run.online = { enabled: true, lookupsAttempted: 5, lookupsSkippedByDeadline: 2 };
    const out = normalizeDepGuard(withOnline, '0.2.0', true);
    expect(out.run.details.online).toBe(true);
    expect(out.run.details.lookups).toBe(5);
    expect(out.run.details['skipped-by-deadline']).toBe(2);
  });

  it('surfaces an older dep-guard\'s own online-deadline-exceeded diagnostic, with no online object present', () => {
    const oldStyle = JSON.parse(JSON.stringify(DEP_GUARD_CLEAN)) as {
      run: { diagnostics: Array<{ code: string; message: string }> };
    };
    oldStyle.run.diagnostics = [
      {
        code: 'online-deadline-exceeded',
        message:
          'publish-age: the per-run online budget (20000ms) was spent before 3 lookup(s) could run; ' +
          'those findings kept their offline result',
      },
    ];
    const out = normalizeDepGuard(oldStyle, '0.2.0', true);
    expect(out.run.details['online-flag']).toBe('passed');
    expect(out.run.details.lookups).toBeUndefined();
    expect(out.run.diagnostics.map((d) => d.code)).toContain('online-deadline-exceeded');
    expect(
      out.run.diagnostics.find((d) => d.code === 'online-deadline-exceeded')?.message
    ).toMatch(/budget/);
  });

  it('never mints a second note about the same cut-short event: dep-guard\'s own diagnostic is the only one', () => {
    // A dep-guard carrying the new online object still raises its own
    // online-deadline-exceeded diagnostic when the budget runs out, so if
    // the umbrella ALSO synthesized one, a single cut-short event would
    // print twice. Only dep-guard's own note survives.
    const raw = JSON.parse(JSON.stringify(DEP_GUARD_CLEAN)) as {
      run: Record<string, unknown> & { diagnostics: Array<{ code: string; message: string }> };
    };
    raw.run.online = {
      enabled: true,
      lookupsAttempted: 5,
      lookupsSkippedByDeadline: 2,
      // Present in the raw payload, exactly as a real dep-guard's would be
      // when its own diagnostic below fires, even though the umbrella no
      // longer reads this field: a synthesis reintroduced here would still
      // trigger on it and duplicate dep-guard's own note.
      deadlineExceeded: true,
    };
    raw.run.diagnostics = [
      {
        code: 'online-deadline-exceeded',
        message:
          'publish-age: the per-run online budget (20000ms) was spent before 2 lookup(s) could run; ' +
          'those findings kept their offline result',
      },
    ];
    const out = normalizeDepGuard(raw, '0.2.0', true);
    expect(out.run.diagnostics).toEqual([
      {
        code: 'online-deadline-exceeded',
        message:
          'publish-age: the per-run online budget (20000ms) was spent before 2 lookup(s) could run; ' +
          'those findings kept their offline result',
      },
    ]);
  });

  it('ignores a malformed online object rather than failing the gate, and prints the flag-derived part only', () => {
    // enabled is valid here, but lookupsAttempted is not: the whole object
    // is untrustworthy once one of its claims is suspect, so this falls all
    // the way back to the flag wording, never partway to "online true".
    const malformed = JSON.parse(JSON.stringify(DEP_GUARD_CLEAN)) as { run: Record<string, unknown> };
    malformed.run.online = { enabled: true, lookupsAttempted: 'five', lookupsSkippedByDeadline: 2 };
    expect(() => normalizeDepGuard(malformed, '0.2.0', true)).not.toThrow();
    const out = normalizeDepGuard(malformed, '0.2.0', true);
    expect(out.run.details['online-flag']).toBe('passed');
    expect(out.run.details.online).toBeUndefined();
    expect(out.run.details.lookups).toBeUndefined();
    expect(out.run.details['skipped-by-deadline']).toBeUndefined();
  });

  it('ignores a malformed enabled field the same way as any other malformed field', () => {
    const malformed = JSON.parse(JSON.stringify(DEP_GUARD_CLEAN)) as { run: Record<string, unknown> };
    malformed.run.online = { enabled: 'yes' };
    const out = normalizeDepGuard(malformed, '0.2.0', false);
    expect(out.run.details['online-flag']).toBe('not passed');
    expect(out.run.details.online).toBeUndefined();
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

  // The details bag is carried, not mapped: every number in it is the
  // gate's own, in the gate's own units. That put a 0-based column next to
  // a 1-based startColumn in the same SARIF result, both spelled "column",
  // which reads as an off-by-one in this tool. The value stays raw and the
  // KEY says which base it is in, so nothing in the bag is quietly
  // rewritten into units its own gate never used.
  it('names the raw column by its base, since the bag carries the gate own units', () => {
    expect(result.findings[0].details.columnZeroBased).toBe(22);
    expect(result.findings[0].details).not.toHaveProperty('column');
    // The mapped, 1-based one lives on the subject, which is where SARIF
    // reads it from.
    expect((result.findings[0].subject as { column: number }).column).toBe(23);
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

  // Issue #34: intent-guard 1.6.0 caps a constraint finding at advisory when
  // its source is a prose rules file (CLAUDE.md, AGENTS.md, GEMINI.md,
  // cursor rules). Such a finding never raises constraint_violation,
  // criticalViolated, or the gate's own exit code, but finding_details
  // carries no field saying so: `strength` is "strong" for a capped prose
  // match exactly like an uncapped one. The fixture below is a real capture
  // (tests/fixtures/README.md) of a run that blocks purely on scope creep
  // (soft_block, 71/100) while also carrying a strong, prose-sourced
  // constraint match the gate itself marks advisory with the literal
  // "advisory " message prefix -- the only surviving signal.
  describe('intent-guard advisory-capped constraint findings (issue 34)', () => {
    const result = normalizeIntentGuard(INTENT_GUARD_ADVISORY_CAPPED, '1.7.0');
    const driftFindings = result.findings.filter((finding) =>
      finding.ruleId.startsWith('intent-guard/drift.')
    );

    it('never marks the advisory-capped constraint finding blocking, even though the run blocks', () => {
      const capped = driftFindings.find(
        (finding) => finding.ruleId === 'intent-guard/drift.constraint_violation'
      );
      expect(capped?.message).toMatch(/^advisory /);
      expect(capped?.blocking).toBe(false);
    });

    it('gives the capped finding a lower severity than the run-level action would imply', () => {
      const capped = driftFindings.find(
        (finding) => finding.ruleId === 'intent-guard/drift.constraint_violation'
      );
      // drift.action is soft_block, which would otherwise map to 'high'
      // (DRIFT_SEVERITY.soft_block). The cap means this finding never drove
      // that action, so it must not inherit its severity either.
      expect(capped?.severity).toBe('low');
      expect(capped?.severityIsDerived).toBe(true);
    });

    it('still blocks on the uncapped scope_creep finding that actually drove the soft_block', () => {
      const scopeCreep = driftFindings.find(
        (finding) => finding.ruleId === 'intent-guard/drift.scope_creep'
      );
      expect(scopeCreep?.message).not.toMatch(/^advisory /);
      expect(scopeCreep?.blocking).toBe(true);
      expect(scopeCreep?.severity).toBe('high');
    });
  });

  // The gap a reviewer named: every uncapped finding tested above was
  // scope_creep. A constraint_violation finding specifically needs its own
  // coverage, because that is the category the cap applies to -- a
  // regression that made EVERY constraint_violation finding non-blocking,
  // capped or not, would still pass every test above.
  it('still blocks on an uncapped constraint_violation finding in a run that blocks (source: user-stated)', () => {
    const result = normalizeIntentGuard(INTENT_GUARD_UNCAPPED_CONSTRAINT_BLOCKING, '1.7.0');
    const constraintFinding = result.findings.find(
      (finding) => finding.ruleId === 'intent-guard/drift.constraint_violation'
    );
    expect(constraintFinding?.message).not.toMatch(/^advisory /);
    expect(constraintFinding?.blocking).toBe(true);
    expect(constraintFinding?.severity).toBe('high');
  });

  // The cap detection is a literal, case-sensitive, start-anchored prefix
  // match, not a substring or case-insensitive one. These two constructed
  // cases exercise real intent-guard shapes (a genuine finding_details
  // entry, just with a message intent-guard itself would never produce)
  // rather than a captured fixture, because the point is to pin the
  // matcher's own strictness: a message.includes() mutation would pass the
  // first, and a toLowerCase() mutation would pass the second.
  describe('the advisory-cap match is case-sensitive and anchored to the start of the message', () => {
    function constraintFinding(message: string): unknown {
      return {
        status: 'blocked',
        exitCode: 1,
        reasons: ['Drift soft_block (score 71/100). Resolve drift or log an acknowledged pivot before continuing.'],
        contractFound: true,
        contractFrozen: true,
        drift: {
          overall: 71,
          action: 'soft_block',
          categories: { scope_creep: 0, constraint_violation: 90, ac_divergence: 0, undocumented_pivot: 0 },
          findings: [message],
          finding_details: [
            {
              fingerprint: 'f'.repeat(64),
              category: 'constraint_violation',
              rule_id: 'constraint_violation:test rule',
              message,
              matched: ['test'],
              strength: 'strong',
            },
          ],
        },
      };
    }

    it('stays blocking when "advisory " appears mid-message rather than as a prefix', () => {
      const result = normalizeIntentGuard(
        constraintFinding('critical constraint at risk, advisory only in spirit: "test rule"'),
        '1.7.0'
      );
      const finding = result.findings.find(
        (f) => f.ruleId === 'intent-guard/drift.constraint_violation'
      );
      expect(finding?.blocking).toBe(true);
      expect(finding?.severity).toBe('high');
    });

    it('stays blocking when the message is capitalised "Advisory " rather than lowercase', () => {
      const result = normalizeIntentGuard(
        constraintFinding('Advisory critical constraint at risk: "test rule"'),
        '1.7.0'
      );
      const finding = result.findings.find(
        (f) => f.ruleId === 'intent-guard/drift.constraint_violation'
      );
      expect(finding?.blocking).toBe(true);
      expect(finding?.severity).toBe('high');
    });
  });

  it('leaves older intent-guard JSON with no advisory-capped finding unchanged', () => {
    // INTENT_GUARD_DRIFT predates the advisory cap (intent-guard 1.2.0): its
    // one drift finding's message never starts with "advisory ", so the new
    // cap detection must not fire and the existing action-derived severity
    // and blocking rules keep applying exactly as before.
    const drift = normalizeIntentGuard(INTENT_GUARD_DRIFT, '1.2.0');
    const driftFinding = drift.findings.find((finding) =>
      finding.ruleId.startsWith('intent-guard/drift.')
    );
    expect(driftFinding?.message).not.toMatch(/^advisory /);
    expect(driftFinding?.severity).toBe('info');
    expect(driftFinding?.blocking).toBe(false);
  });

  // intent-guard's checkGate pushes gate-state reasons (no contract, an
  // unfrozen contract, an unreadable one) into the SAME reasons array as
  // budget and drift reasons. The old rule only raised a synthetic finding
  // when nothing else was blocking, so with a budget violation present the
  // unfrozen-contract reason appeared in neither report.
  describe('gate-state reasons alongside other findings', () => {
    const BOTH = {
      status: 'blocked',
      exitCode: 1,
      reasons: [
        'Intent contract exists but is not frozen by user. Approve and freeze before implementing.',
        'Budget soft_block: Changed 2 files, budget allows 1',
      ],
      contractFound: true,
      contractFrozen: false,
      budget: {
        ok: false,
        action: 'soft_block',
        violations: [
          {
            fingerprint: 'a12fc3e4',
            rule: 'max_files',
            severity: 'soft_block',
            message: 'Changed 2 files, budget allows 1',
            matched: ['a.js', 'b.js'],
          },
        ],
      },
    };

    it('reports the contract state as well as the budget violation', () => {
      const normalized = normalizeIntentGuard(BOTH, '1.2.0');
      expect(normalized.findings.map((finding) => finding.ruleId).sort()).toEqual([
        'intent-guard/budget.max_files',
        'intent-guard/gate-blocked',
      ]);
    });

    it('makes the contract-state finding blocking and names the reason verbatim', () => {
      const normalized = normalizeIntentGuard(BOTH, '1.2.0');
      const gateState = normalized.findings.find(
        (finding) => finding.ruleId === 'intent-guard/gate-blocked'
      );
      expect(gateState?.blocking).toBe(true);
      expect(gateState?.message).toBe(BOTH.reasons[0]);
      expect(gateState?.details.kind).toBe('contract-unfrozen');
    });

    it('emits one finding per gate-state reason, not one for all of them', () => {
      const normalized = normalizeIntentGuard(
        {
          ...BOTH,
          contractFound: false,
          reasons: [
            'No .conductor/intent-contract.yaml found. Draft intent with intent-guard-extract, then approve with intent-guard-freeze before implementing.',
            'Intent contract exists but is not frozen by user. Approve and freeze before implementing.',
            'Budget soft_block: Changed 2 files, budget allows 1',
          ],
        },
        '1.2.0'
      );
      const gateState = normalized.findings.filter(
        (finding) => finding.ruleId === 'intent-guard/gate-blocked'
      );
      expect(gateState).toHaveLength(2);
      expect(gateState.map((finding) => finding.details.kind)).toEqual([
        'contract-missing',
        'contract-unfrozen',
      ]);
    });

    it('does not invent a contract-state finding when only a budget rule fired', () => {
      const normalized = normalizeIntentGuard(
        {
          ...BOTH,
          // A contract present but unfrozen under --no-require-frozen: the
          // gate deliberately raises no reason about it, so neither does the
          // umbrella, even though contractFrozen is false.
          reasons: ['Budget soft_block: Changed 2 files, budget allows 1'],
        },
        '1.2.0'
      );
      expect(
        normalized.findings.filter((finding) => finding.ruleId === 'intent-guard/gate-blocked')
      ).toEqual([]);
    });
  });

  // Enumerated from intent-guard's own gate.ts. If upstream rewords one of
  // these, this test goes red rather than the reason quietly vanishing from
  // every report.
  describe('the known gate-state reason strings', () => {
    const FROM_GATE_TS: Array<[string, string]> = [
      ['Intent contract is invalid: Unexpected token', 'contract-invalid'],
      [
        'No .conductor/intent-contract.yaml found. Draft intent with intent-guard-extract, then approve with intent-guard-freeze before implementing.',
        'contract-missing',
      ],
      [
        'Intent contract exists but is not frozen by user. Approve and freeze before implementing.',
        'contract-unfrozen',
      ],
    ];

    it.each(FROM_GATE_TS)('classifies the reason starting "%s"', (reason, kind) => {
      expect(classifyGateStateReason(reason)).toBe(kind);
    });

    it('does not classify a budget or drift reason as gate state', () => {
      expect(classifyGateStateReason('Budget soft_block: Changed 2 files, budget allows 1')).toBe(
        null
      );
      expect(
        classifyGateStateReason('Drift soft_block (score 75/100). Resolve drift or log a pivot.')
      ).toBe(null);
    });

    it('lists exactly the kinds the gate can raise', () => {
      expect([...GATE_STATE_REASON_KINDS]).toEqual([
        'contract-invalid',
        'contract-missing',
        'contract-unfrozen',
        'self-approval-refused',
        'control-input-refused',
      ]);
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

/**
 * intent-guard 1.7.0's own advance notice, read from `warnings`.
 *
 * A frozen contract's protected_paths or allowed_paths entry can carry a
 * shape no git path can ever match (a leading slash, an empty path
 * segment). 1.7.0 warns about it rather than blocking, and says so will
 * change in 2.0.0. This is reporting, never a finding: it must never gain a
 * severity, a fingerprint, or a blocking flag, and it must never turn a
 * shape an older or newer intent-guard did not send correctly into a
 * could-not-run for the gate.
 */
describe('intent-guard 1.7.0 warnings', () => {
  const INTENT_GUARD_WARNINGS = fixture('intent-guard-1.7.0-check-warnings.json');

  it('turns each warning string into a note on the intent line, never a finding', () => {
    const result = normalizeIntentGuard(INTENT_GUARD_WARNINGS, '1.7.0');
    expect(result.findings).toEqual([]);
    expect(result.run.diagnostics).toEqual([
      {
        code: 'intent-guard/warning',
        message:
          "Budget protected_paths entry '/etc/widget.conf' is invalid: must not start with " +
          "'/' (paths are matched git-relative; a leading slash can never match). This will " +
          'block check and report starting in 2.0.0; edit the contract and run intent-guard ' +
          'freeze again before then.',
      },
      {
        code: 'intent-guard/warning',
        message:
          "Budget allowed_paths entry 'src/widget//export.ts' is invalid: must not contain " +
          'an empty path segment (consecutive \'/\'). This will block check and report ' +
          'starting in 2.0.0; edit the contract and run intent-guard freeze again before then.',
      },
    ]);
  });

  it('keeps both warnings out of findings entirely: zero findings, two diagnostics', () => {
    // A mutation that pushed a warning into `findings` too (blocking or not)
    // would leave findings.length at 0 under the old assertion here, which
    // only checked that no PRESENT finding was blocking; it never checked
    // that a finding could not be present at all. This checks both counts
    // directly, so either direction of that mutation goes red.
    const result = normalizeIntentGuard(INTENT_GUARD_WARNINGS, '1.7.0');
    expect(result.findings).toHaveLength(0);
    expect(result.run.diagnostics).toHaveLength(2);
  });

  it('reads as none, not an error, on an intent-guard old enough to have never sent warnings', () => {
    // 1.2.1 and earlier never sent a `warnings` field at all; absence is the
    // ordinary case and must stay silent exactly like it always has.
    const result = normalizeIntentGuard(fixture('intent-guard-1.2.1-check-passing.json'), '1.2.1');
    expect(result.run.diagnostics).toEqual([]);
  });

  it('ignores a malformed warnings value rather than treating it as could-not-run', () => {
    const notAnArray = { ...(INTENT_GUARD_WARNINGS as object), warnings: 'not-an-array' };
    const notAllStrings = { ...(INTENT_GUARD_WARNINGS as object), warnings: ['fine', 42] };

    expect(() => normalizeIntentGuard(notAnArray, '1.7.0')).not.toThrow();
    expect(normalizeIntentGuard(notAnArray, '1.7.0').run.diagnostics).toEqual([]);

    expect(() => normalizeIntentGuard(notAllStrings, '1.7.0')).not.toThrow();
    expect(normalizeIntentGuard(notAllStrings, '1.7.0').run.diagnostics).toEqual([]);
  });
});

describe('the umbrella own missing-gate finding', () => {
  const finding = normalizeMissingGate('dependencies', 'dep-guard', ['dep-guard']);

  it('is a blocking finding of the umbrella, not a silent skip', () => {
    expect(finding.ruleId).toBe('conductor/gate-missing');
    expect(finding.blocking).toBe(true);
    expect(finding.product).toBe('conductor');
  });

  it('has no subject, because a missing binary is not somewhere in the tree', () => {
    expect(finding.subject).toEqual({ kind: 'none' });
  });

  it('names the scoped package to install, never a bare unscoped name (C4)', () => {
    for (const product of ['dep-guard', 'vault-guard', 'intent-guard'] as const) {
      const message = normalizeMissingGate('dependencies', product, [product]).message;
      expect(message).toContain(`@vaultcompass/${product}`);
      expect(message).not.toMatch(/Install it[.,]/);
    }
    // The external tools are not npm packages of this family.
    const external = normalizeMissingGate('secrets-history', 'gitleaks', ['gitleaks']).message;
    expect(external).not.toContain('@vaultcompass/gitleaks');
    expect(external).toMatch(/Install gitleaks/);
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

/**
 * The no-contract classifier under BOTH state-directory names.
 *
 * intent-guard 1.3.0 renamed its state directory, and the sentence the gate
 * raises interpolates that name: 1.2.x says `.conductor/intent-contract.yaml`
 * and 1.3.0 and later say `.intent-guard/intent-contract.yaml`. The umbrella
 * matched only the first, so on every current gate the classifier was dead: a
 * pull request against a repository with no contract got the unattributed
 * backstop finding instead of a `contract-missing` one, and the SARIF details
 * said `unattributed` where a consumer filters on the kind.
 *
 * The 1.3.0 string is quoted from the gate's own gate.ts, which builds it as
 * `No ${STATE_DIR}/intent-contract.yaml found.` with STATE_DIR = .intent-guard.
 */
describe('the no-contract reason under both state-directory names', () => {
  const LEGACY =
    'No .conductor/intent-contract.yaml found. Draft intent with intent-guard-extract, ' +
    'then approve with intent-guard-freeze before implementing.';
  const CANONICAL =
    'No .intent-guard/intent-contract.yaml found. Draft intent with intent-guard-extract, ' +
    'then approve with intent-guard-freeze before implementing.';

  it('classifies the pre-1.3 wording as contract-missing', () => {
    expect(classifyGateStateReason(LEGACY)).toBe('contract-missing');
  });

  it('classifies the 1.3.0 and later wording as contract-missing', () => {
    expect(classifyGateStateReason(CANONICAL)).toBe('contract-missing');
  });

  it('files the 1.3.0 wording as contract-missing rather than as the unattributed backstop', () => {
    const normalized = normalizeIntentGuard(
      {
        status: 'blocked',
        exitCode: 1,
        reasons: [CANONICAL],
        contractFound: false,
        contractFrozen: false,
      },
      '1.4.0'
    );
    const blocked = normalized.findings.filter(
      (finding) => finding.ruleId === 'intent-guard/gate-blocked'
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0].details.kind).toBe('contract-missing');
    expect(blocked[0].message).toBe(CANONICAL);
  });

  it('still refuses to classify a sentence that only mentions a contract', () => {
    expect(classifyGateStateReason('No contract was needed for this branch.')).toBe(null);
  });
});

/**
 * The two pull-request-mode refusals intent-guard 1.4.0 raises.
 *
 * Both arrive as ordinary reasons in the same array as budget and drift
 * reasons, with nothing structured saying which is which, so they are matched
 * by prefix exactly as the three contract-state reasons are. The strings are
 * quoted from intent-guard's trust-base.ts, which exports both prefixes as
 * constants for this purpose.
 *
 * THE REASON THEY ARE CLASSIFIED RATHER THAN LEFT TO THE BACKSTOP is the
 * whole point, and it was found by running the real gate against a crafted
 * pull request. The backstop fires only when nothing else blocked, so a pull
 * request that forged a contract approval AND breached a change budget
 * reported only the budget breach. The run still failed; the report never
 * said the approval was self-granted, which is the one sentence a reviewer
 * needs from pull-request mode.
 */
describe("intent-guard's pull-request-mode refusals", () => {
  // Verbatim from a real 1.4.0 run against a scratch repository whose pull
  // request rewrote the frozen contract's approval block.
  const SELF_APPROVAL =
    'Self-approval refused: this pull request changes .intent-guard/intent-contract.yaml and ' +
    'gives it an approval that is not the one on "base". The approval that counts is the base ' +
    "ref's, which a pull request cannot write. Land the contract change on the base branch " +
    'first, or require a human approval for contract changes in the workflow.';
  const CONTROL_INPUT =
    'Control input refused: .intent-guard/intent-contract.yaml is a symlink at the head commit, ' +
    'not a regular file. A link makes the contract point at a file the base ref never approved.';

  it('classifies a self-approval refusal', () => {
    expect(classifyGateStateReason(SELF_APPROVAL)).toBe('self-approval-refused');
  });

  it('classifies a refused control input', () => {
    expect(classifyGateStateReason(CONTROL_INPUT)).toBe('control-input-refused');
  });

  it('renders and blocks like any other reason', () => {
    const normalized = normalizeIntentGuard(
      {
        status: 'blocked',
        exitCode: 1,
        reasons: [SELF_APPROVAL],
        contractFound: true,
        contractFrozen: true,
        trustBase: {
          ref: 'base',
          proposals: ['contract changed in this pull request'],
          contractChanged: true,
          configChanged: false,
          baseContractFound: true,
          selfApproval: true,
          contractShapeChange: null,
        },
      },
      '1.4.0'
    );

    expect(normalized.findings).toHaveLength(1);
    expect(normalized.findings[0].ruleId).toBe('intent-guard/gate-blocked');
    expect(normalized.findings[0].blocking).toBe(true);
    expect(normalized.findings[0].severity).toBe('critical');
    expect(normalized.findings[0].message).toBe(SELF_APPROVAL);
    expect(normalized.findings[0].details.kind).toBe('self-approval-refused');
  });

  it('keeps the refusal in the report when a budget violation blocked as well', () => {
    // The failure this classification exists to prevent. Left to the
    // backstop, this run reported only the budget breach.
    const normalized = normalizeIntentGuard(
      {
        status: 'blocked',
        exitCode: 1,
        reasons: [SELF_APPROVAL, 'Budget hard_block: a new dependency was added'],
        contractFound: true,
        contractFrozen: true,
        budget: {
          action: 'hard_block',
          violations: [
            {
              rule: 'allow_new_dependencies',
              severity: 'hard_block',
              message: 'A new dependency was added and the contract forbids it.',
              matched: ['package.json'],
              fingerprint: 'abc123',
            },
          ],
        },
      },
      '1.4.0'
    );

    const kinds = normalized.findings
      .filter((finding) => finding.ruleId === 'intent-guard/gate-blocked')
      .map((finding) => finding.details.kind);
    expect(kinds).toEqual(['self-approval-refused']);
    expect(normalized.findings.filter((finding) => finding.blocking)).toHaveLength(2);
  });

  it('carries the gate own trustBase summary through, proposals and all', () => {
    const normalized = normalizeIntentGuard(
      {
        status: 'ok',
        exitCode: 0,
        reasons: [],
        contractFound: true,
        contractFrozen: true,
        trustBase: {
          ref: 'origin/main',
          proposals: ['contract changed in this pull request', 'config changed in this pull request'],
          contractChanged: true,
          configChanged: true,
          baseContractFound: true,
          selfApproval: false,
          contractShapeChange: null,
        },
      },
      '1.4.0'
    );

    expect(normalized.trustBase).toEqual({
      ref: 'origin/main',
      proposals: [
        'contract changed in this pull request',
        'config changed in this pull request',
      ],
    });
  });

  it('says nothing at all when the gate was not in pull-request mode', () => {
    // Absence is the gate's own signal: the field is present only on a run
    // it was given --trust-base for, so an ordinary run has nothing here and
    // no report has to guess.
    const normalized = normalizeIntentGuard(
      {
        status: 'ok',
        exitCode: 0,
        reasons: [],
        contractFound: true,
        contractFrozen: true,
      },
      '1.4.0'
    );

    expect(normalized.trustBase).toBeUndefined();
  });

  it('reads the same block off vault-guard, which puts it in the same place', () => {
    // vault-guard 1.7.0 carries more than the umbrella reads: configChanged,
    // baselineChanged and a shape change for each. Only the ref and the
    // sentences are taken, which is the passthrough rule applied to a second
    // gate rather than a second opinion about that gate's control files.
    const normalized = normalizeVaultGuard(
      {
        version: '1',
        scannedAt: '2026-09-06T00:00:00.000Z',
        summary: { files: 1, secrets: 0 },
        run: { files_scanned: 1, patterns_active: 59, fail_on: 'medium', blocking_matches: 0 },
        trustBase: {
          ref: 'origin/main',
          proposals: ['config changed in this pull request'],
          configChanged: true,
          baselineChanged: false,
          configShapeChange: null,
          baselineShapeChange: null,
        },
        results: [],
      },
      '1.7.0'
    );

    expect(normalized.trustBase).toEqual({
      ref: 'origin/main',
      proposals: ['config changed in this pull request'],
    });
  });

  it('says nothing for a vault-guard that was not in pull-request mode', () => {
    const normalized = normalizeVaultGuard(VAULT_GUARD_CLEAN, '1.7.0');

    expect(normalized.trustBase).toBeUndefined();
  });

  it('reads the same block off dep-guard, which puts it in the same place', () => {
    // dep-guard 0.6.0 carries three changed flags and three shape changes,
    // one pair of which is about .npmrc, a control input the other two gates
    // do not have. The umbrella reads the ref and the sentences and nothing
    // else, which is what keeps a third gate from needing a third mapping.
    const normalized = normalizeDepGuard(
      {
        findings: [],
        suppressed: 0,
        ignored: 0,
        allowed: 1,
        allowedNames: ['left-pad'],
        trustBase: {
          ref: 'origin/main',
          proposals: ['config changed in this pull request (proposed: allow left-pad)'],
          configChanged: true,
          baselineChanged: false,
          npmrcChanged: false,
          configShapeChange: null,
          baselineShapeChange: null,
          npmrcShapeChange: null,
        },
        run: { mode: 'audit', failOn: 'medium', blockingMatches: 0, diagnostics: [] },
        exitCode: 0,
      },
      '0.6.0'
    );

    expect(normalized.trustBase).toEqual({
      ref: 'origin/main',
      proposals: ['config changed in this pull request (proposed: allow left-pad)'],
    });
  });

  it('says nothing for a dep-guard that was not in pull-request mode', () => {
    // Absence rather than null: dep-guard drops the key outright on an
    // ordinary run, so those bytes are what they were before the field
    // existed and a consumer that never enters the mode learns no new key.
    expect(normalizeDepGuard(DEP_GUARD_CLEAN, '0.6.0').trustBase).toBeUndefined();
  });

  it('refuses a trustBase of a shape it does not know rather than reading past it', () => {
    expect(() =>
      normalizeIntentGuard(
        {
          status: 'ok',
          exitCode: 0,
          reasons: [],
          contractFound: true,
          contractFrozen: true,
          trustBase: { ref: 'origin/main', proposals: [{ line: 'an object' }] },
        },
        '1.4.0'
      )
    ).toThrow(/trustBase\.proposals\[0\] should be a string/);
  });
});

describe('gitleaks 8.30.1 normalization', () => {
  const blocking = fixture('gitleaks-8.30.1-history-blocking.json');
  const clean = fixture('gitleaks-8.30.1-history-clean.json');
  // The planted token's first twelve characters, recorded in
  // tests/fixtures/README.md. The report is redacted, and the normalizer must
  // never carry Secret, Match or Line even when a report is not.
  const PLANTED_PREFIX = 'dp.pt.q7ZkR2';

  it('turns each report entry into a high, blocking finding at the leaked line with the rule as the id', () => {
    const out = normalizeGitleaks(blocking, '8.30.1', true);
    expect(out.findings.length).toBe((blocking as unknown[]).length);
    const f = out.findings[0]!;
    expect(f.product).toBe('gitleaks');
    expect(f.productVersion).toBe('8.30.1');
    expect(f.ruleId).toBe('gitleaks/doppler-api-token');
    expect(f.severity).toBe('high');
    expect(f.severityIsDerived).toBe(true);
    expect(f.blocking).toBe(true);
    expect(f.subject).toEqual({ kind: 'location', file: 'config.json', line: 3, column: 22, endColumn: 70 });
    expect(f.fingerprint).toEqual({
      value: (blocking as Array<{ Fingerprint: string }>)[0]!.Fingerprint,
      scope: 'gitleaks',
      stability: 'stable',
    });
    expect(f.details.commit).toBe((blocking as Array<{ Commit: string }>)[0]!.Commit);
    expect(JSON.stringify(f)).not.toContain(PLANTED_PREFIX);
    expect(JSON.stringify(f)).not.toContain('REDACTED');
  });

  it('never carries the matched text, even from an unredacted report', () => {
    const unredacted = (blocking as Array<Record<string, unknown>>).map((entry) => ({
      ...entry,
      Secret: `${PLANTED_PREFIX}xxxx`,
      Match: `token: ${PLANTED_PREFIX}xxxx`,
      Line: `"doppler_token": "${PLANTED_PREFIX}xxxx"`,
    }));
    const out = normalizeGitleaks(unredacted, '8.30.1', true);
    expect(JSON.stringify(out)).not.toContain(PLANTED_PREFIX);
  });

  it('carries the commit and date but never the author or the email', () => {
    const f = normalizeGitleaks(blocking, '8.30.1', true).findings[0]!;
    expect(f.details.commit).toBeDefined();
    expect(f.details.date).toBeDefined();
    expect(f.details.author).toBeUndefined();
    expect(JSON.stringify(f)).not.toContain('fixture@example.invalid');
    expect(JSON.stringify(f)).not.toContain('"Fixture"');
  });

  it('collapses the same leak seen in two commits into one finding, keeping the earliest and naming the other', () => {
    // --diff-merges=first-parent shows a pull request's change twice: in its
    // own commit and in the merge's first-parent diff.
    const original = (blocking as Array<Record<string, unknown>>)[0]!;
    const merge = { ...original, Commit: 'b'.repeat(40), Date: '2099-01-01T00:00:00Z', Fingerprint: `${'b'.repeat(40)}:config.json:doppler-api-token:3` };
    for (const report of [[original, merge], [merge, original]]) {
      const out = normalizeGitleaks(report, '8.30.1', true);
      expect(out.findings).toHaveLength(1);
      expect(out.findings[0]!.details.commit).toBe(original.Commit);
      expect(out.findings[0]!.details.alsoIn).toEqual(['b'.repeat(40)]);
      expect(out.findings[0]!.fingerprint?.value).toBe(original.Fingerprint);
    }
  });

  it('on equal or missing dates keeps the LAST entry in report order, which git log lists oldest', () => {
    // git log lists newer commits first, so the last entry is the oldest
    // commit and never a synthetic merge made after it.
    const original = (blocking as Array<Record<string, unknown>>)[0]!;
    const merge = { ...original, Commit: 'b'.repeat(40) };
    const tie = normalizeGitleaks([merge, original], '8.30.1', true).findings;
    expect(tie).toHaveLength(1);
    expect(tie[0]!.details.commit).toBe(original.Commit);
    expect(tie[0]!.details.alsoIn).toEqual(['b'.repeat(40)]);

    const undated = { ...original };
    delete undated.Date;
    const undatedMerge = { ...undated, Commit: 'c'.repeat(40) };
    const missing = normalizeGitleaks([undatedMerge, undated], '8.30.1', true).findings;
    expect(missing[0]!.details.commit).toBe(original.Commit);
    expect(missing[0]!.details.alsoIn).toEqual(['c'.repeat(40)]);
  });

  it('keeps leaks at different places apart', () => {
    const original = (blocking as Array<Record<string, unknown>>)[0]!;
    const elsewhere = { ...original, StartLine: 9, Commit: 'c'.repeat(40) };
    expect(normalizeGitleaks([original, elsewhere], '8.30.1', true).findings).toHaveLength(2);
  });

  it('marks findings non-blocking when the exit code did not say blocked', () => {
    expect(normalizeGitleaks(blocking, '8.30.1', false).findings.every((f) => !f.blocking)).toBe(true);
  });

  it('returns no findings for an empty report', () => {
    expect(normalizeGitleaks(clean, '8.30.1', false).findings).toEqual([]);
  });

  it('rejects a report that is not an array', () => {
    expect(() => normalizeGitleaks({ findings: [] }, '8.30.1', false)).toThrow(NormalizeError);
  });

  it('rejects an entry without a RuleID or a File', () => {
    expect(() => normalizeGitleaks([{ File: 'a', StartLine: 1 }], '8.30.1', false)).toThrow(NormalizeError);
    expect(() => normalizeGitleaks([{ RuleID: 'x', StartLine: 1 }], '8.30.1', false)).toThrow(NormalizeError);
    expect(() => normalizeGitleaks([null], '8.30.1', false)).toThrow(NormalizeError);
  });
});

describe('osv-scanner 2.6.0 normalization', () => {
  const blocking = fixture('osv-scanner-2.6.0-blocking.json');
  const clean = fixture('osv-scanner-2.6.0-clean.json');
  type Raw = {
    results: Array<{
      source: { path: string };
      packages: Array<{ package: { name: string; version: string }; vulnerabilities: Array<{ id: string }> }>;
    }>;
  };

  it('emits one finding per vulnerability id on a package, keyed by the OSV id', () => {
    const out = normalizeOsvScanner(blocking, '2.6.0', true);
    const raw = blocking as Raw;
    const expectedCount = raw.results.flatMap((r) => r.packages.flatMap((p) => p.vulnerabilities)).length;
    expect(out.findings.length).toBe(expectedCount);
    const first = out.findings[0]!;
    const rawFirst = raw.results[0]!.packages[0]!;
    expect(first.product).toBe('osv-scanner');
    expect(first.ruleId).toBe(`osv-scanner/${rawFirst.vulnerabilities[0]!.id}`);
    expect(first.subject).toEqual({ kind: 'package', name: rawFirst.package.name, manifest: raw.results[0]!.source.path });
    expect(first.blocking).toBe(true);
    expect(first.severityIsDerived).toBe(true);
    expect(['critical', 'high', 'medium', 'low']).toContain(first.severity);
    expect(first.fingerprint?.stability).toBe('stable');
    expect(first.details.version).toBe(rawFirst.package.version);
  });

  it('takes severity from the group max_severity that names the advisory', () => {
    const out = normalizeOsvScanner(blocking, '2.6.0', true);
    // GHSA-35jh-r3h4-6jhm sits in the group scored 8.1; GHSA-29mw-wpgm-hmr9 in 5.3.
    const high = out.findings.find((f) => f.ruleId === 'osv-scanner/GHSA-35jh-r3h4-6jhm')!;
    expect(high.severity).toBe('high');
    expect(high.details.cvss).toBe(8.1);
    const medium = out.findings.find((f) => f.ruleId === 'osv-scanner/GHSA-29mw-wpgm-hmr9')!;
    expect(medium.severity).toBe('medium');
  });

  it('carries aliases and the fixed version when the advisory names one', () => {
    const out = normalizeOsvScanner(blocking, '2.6.0', true);
    const withFix = out.findings.find((f) => f.details.fixedVersion !== undefined);
    expect(withFix).toBeDefined();
    expect(out.findings.find((f) => f.ruleId === 'osv-scanner/GHSA-29mw-wpgm-hmr9')?.details.fixedVersion).toBe('4.17.21');
    expect(Array.isArray(out.findings[0]!.details.aliases)).toBe(true);
  });

  it('takes the fixed version from the range the installed version is in, not the first fix listed', () => {
    // The shape of nanoid's GHSA-28wg-ghj8-5hjv in the osv-scanner 2.6.0
    // capture that could not be committed (tests/fixtures/README.md): one
    // advisory, two ranges for the same package.
    const raw = {
      results: [
        {
          source: { path: 'package-lock.json', type: 'lockfile' },
          packages: [
            {
              package: { name: 'nanoid', version: '5.0.9', ecosystem: 'npm' },
              groups: [{ ids: ['GHSA-28wg-ghj8-5hjv'], max_severity: '8.2' }],
              vulnerabilities: [
                {
                  id: 'GHSA-28wg-ghj8-5hjv',
                  affected: [
                    { package: { name: 'nanoid' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '3.3.16' }] }] },
                    { package: { name: 'nanoid' }, ranges: [{ events: [{ introduced: '4.0.0' }, { fixed: '5.1.16' }] }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(normalizeOsvScanner(raw, '2.6.0', true).findings[0]!.details.fixedVersion).toBe('5.1.16');
  });

  it('makes an absolute manifest path relative to the scan root it was given', () => {
    const out = normalizeOsvScanner(blocking, '2.6.0', true, ['/tmp/conductor-osv-fixture']);
    expect(out.findings[0]!.subject).toEqual({ kind: 'package', name: 'lodash', manifest: 'package-lock.json' });
    expect(out.findings[0]!.fingerprint?.value).not.toContain('/tmp/');
  });

  it('gives no findings for an empty results array', () => {
    expect(normalizeOsvScanner(clean, '2.6.0', false).findings).toEqual([]);
  });

  it('rejects output without a results array', () => {
    expect(() => normalizeOsvScanner({ packages: [] }, '2.6.0', false)).toThrow(NormalizeError);
  });

  it('maps CVSS scores onto the shared ladder', () => {
    expect(cvssToSeverity(9.8)).toBe('critical');
    expect(cvssToSeverity(7.5)).toBe('high');
    expect(cvssToSeverity(5.0)).toBe('medium');
    expect(cvssToSeverity(2.1)).toBe('low');
    expect(cvssToSeverity(null)).toBe('medium');
  });

  describe('the lockfile fact (issue #72)', () => {
    it('names the lockfile the umbrella passed and counts zero sources with findings, on a clean scan', () => {
      const out = normalizeOsvScanner(clean, '2.6.0', false, [], ['pnpm-lock.yaml']);
      expect(out.run.details.lockfiles).toBe('1 (pnpm-lock.yaml)');
      expect(out.run.details['sources-with-findings']).toBe(0);
    });

    it('names the lockfile and counts the sources with findings, on a run that found something', () => {
      const out = normalizeOsvScanner(blocking, '2.6.0', true, [], ['package-lock.json']);
      expect(out.run.details.lockfiles).toBe('1 (package-lock.json)');
      expect(out.run.details['sources-with-findings']).toBe(1);
    });

    it('names every lockfile passed, not just the first', () => {
      const out = normalizeOsvScanner(clean, '2.6.0', false, [], [
        'pnpm-lock.yaml',
        'apps/api/package-lock.json',
      ]);
      expect(out.run.details.lockfiles).toBe('2 (pnpm-lock.yaml, apps/api/package-lock.json)');
    });

    it('falls back to a bare zero when no lockfile list was given', () => {
      expect(normalizeOsvScanner(clean, '2.6.0', false).run.details.lockfiles).toBe('0');
    });

    it('counts every source with findings, not just whether there was one', () => {
      // Not a committed fixture: tests/fixtures/README.md is explicit that
      // every file there is a real binary's literal stdout, captured once,
      // and a hand-written one would only prove the normalizer agrees with
      // whoever wrote it. A two-lockfile capture was not available, so this
      // follows the same precedent as the nanoid shape above and builds the
      // minimal real 2.x shape (two `results[]` entries, each with its own
      // `source.path` and a finding) in the test itself instead.
      const raw = {
        results: [
          {
            source: { path: 'package-lock.json', type: 'lockfile' },
            packages: [
              {
                package: { name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
                vulnerabilities: [{ id: 'GHSA-29mw-wpgm-hmr9' }],
              },
            ],
          },
          {
            source: { path: 'web/pnpm-lock.yaml', type: 'lockfile' },
            packages: [
              {
                package: { name: 'axios', version: '0.21.0', ecosystem: 'npm' },
                vulnerabilities: [{ id: 'GHSA-4w2v-q235-vp99' }],
              },
            ],
          },
        ],
      };
      const out = normalizeOsvScanner(raw, '2.6.0', true, [], ['package-lock.json', 'web/pnpm-lock.yaml']);
      expect(out.run.details.lockfiles).toBe('2 (package-lock.json, web/pnpm-lock.yaml)');
      expect(out.run.details['sources-with-findings']).toBe(2);
      expect(out.findings).toHaveLength(2);
    });
  });
});
