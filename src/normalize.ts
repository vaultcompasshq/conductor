// Turning each gate's own JSON into the internal envelope.
//
// Separate functions rather than one table-driven mapper, because the
// shapes disagree in ways a table would have to paper over: one is a flat
// findings array, one is nested by file, the third is two different streams
// (a change-budget evaluation and a scored drift rubric) plus a gate status
// that can block for neither reason, and the two external tools' reports
// (gitleaks, osv-scanner) carry no blocking flag at all, so whether they
// block comes from the exit code the runner read.
//
// What every one of them refuses to do, in one place so it is reviewable:
// invent a line number, invent a fingerprint, re-derive a severity a
// product already stated, or claim a finding is blocking when the gate's
// own reported count says otherwise.

import { createHash } from 'node:crypto';

import {
  type Diagnostic,
  type Finding,
  type NormalizedGateOutput,
  NormalizeError,
  type Severity,
  atOrAboveThreshold,
} from './envelope.js';
import type { GateRole, Product } from './policy.js';
import { profileFor } from './products.js';

const BLOCKING_MISMATCH = 'conductor/blocking-count-mismatch';
const THRESHOLD_UNKNOWN = 'conductor/blocking-threshold-unknown';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Element-level validation.
//
// A top-level shape check is not enough, and that was a real defect rather
// than a hypothetical: `{"findings": [null]}` passed the old check that
// findings was an array, and then reading a property off null threw a
// TypeError, which is not a NormalizeError, so it escaped the gate runner,
// escaped the run, and reached the user as a stack trace carrying a local
// path, with exit 1 -- which the hook reports as "a gate blocked" -- and the
// remaining gates never ran.
//
// So every field the mapping actually reads is checked before it is read,
// and every failure is a NormalizeError naming the product and the path to
// the offending field. Fields the mapping only passes through are NOT
// required: rejecting output because a gate stopped emitting a field nobody
// maps would turn a harmless upstream change into a blocked commit.

function fail(product: string, where: string, wanted: string): never {
  throw new NormalizeError(
    `${product} output did not have the shape the umbrella knows: ${where} should be ${wanted}.`
  );
}

function needRecord(value: unknown, product: string, where: string): Record<string, unknown> {
  return isRecord(value) ? value : fail(product, where, 'an object');
}

function needArray(value: unknown, product: string, where: string): unknown[] {
  return Array.isArray(value) ? value : fail(product, where, 'an array');
}

function needString(value: unknown, product: string, where: string): string {
  return typeof value === 'string' ? value : fail(product, where, 'a string');
}

function needNumber(value: unknown, product: string, where: string): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fail(product, where, 'a number');
}

function optionalString(value: unknown, product: string, where: string): string | undefined {
  return value === undefined ? undefined : needString(value, product, where);
}

function optionalDetails(
  value: unknown,
  product: string,
  where: string
): Record<string, unknown> {
  return value === undefined ? {} : needRecord(value, product, where);
}

/** A string array, used for the two products that report matched path lists. */
function needStringArray(value: unknown, product: string, where: string): string[] {
  return needArray(value, product, where).map((entry, index) =>
    needString(entry, product, `${where}[${index}]`)
  );
}

/**
 * Reconciles per-finding blocking against the count the gate reported.
 *
 * Neither dep-guard nor vault-guard marks a finding as blocking; each
 * reports the threshold it used and how many findings met it. So the
 * per-finding flag is reconstructed from that threshold and then checked
 * against that count. When the two disagree, the gate wins: every flag
 * drops to false and a diagnostic says why, because the alternative is the
 * report telling a user a finding blocked their commit when the tool that
 * blocks commits disagrees.
 */
function reconcileBlocking(
  findings: Finding[],
  reportedBlocking: number | undefined,
  threshold: string | null,
  product: string,
  diagnostics: Diagnostic[]
): void {
  if (threshold === null) {
    for (const finding of findings) {
      finding.blocking = false;
    }
    diagnostics.push({
      code: THRESHOLD_UNKNOWN,
      message:
        `${product} did not report the threshold it gated on, so no finding is marked blocking. ` +
        'The gate exit code still decides the run.',
    });
    return;
  }

  for (const finding of findings) {
    finding.blocking = atOrAboveThreshold(finding.severity, threshold);
  }

  const derived = findings.filter((finding) => finding.blocking).length;
  if (reportedBlocking !== undefined && derived !== reportedBlocking) {
    for (const finding of findings) {
      finding.blocking = false;
    }
    diagnostics.push({
      code: BLOCKING_MISMATCH,
      message:
        `${product} reported ${reportedBlocking} blocking finding(s) at threshold "${threshold}" ` +
        `but the umbrella reconstructed ${derived}. No finding is marked blocking; the gate own ` +
        'exit code still decides the run. This means the gate output shape has moved.',
    });
  }
}

// -- dep-guard ------------------------------------------------------------

/** Diagnostics from a gate, validated element by element like everything else. */
function readDiagnostics(value: unknown, product: string, where: string): Diagnostic[] {
  if (value === undefined) {
    return [];
  }
  return needArray(value, product, where).map((entry, index) => {
    const record = needRecord(entry, product, `${where}[${index}]`);
    return {
      code: needString(record.code, product, `${where}[${index}].code`),
      message: needString(record.message, product, `${where}[${index}].message`),
    };
  });
}

/**
 * dep-guard's run-level `online` object (issue #72), read leniently.
 *
 * The object is gaining fields in a parallel dep-guard branch, so an
 * installed dep-guard may send none of it, all of it, or a shape with the
 * wrong field types. This is reporting, not judgment: a malformed value here
 * must never turn into a could-not-run for the gate, so nothing here throws.
 * Only the fields the umbrella actually displays are validated; a
 * present-but-wrong-typed one of those invalidates the whole object, because
 * there is nothing honest left to report from it once one claim is suspect.
 *
 * `enabled` is dep-guard's OWN statement about whether it actually ran
 * online for this scan, which is a different question from whether the
 * umbrella passed `--online`: dep-guard also turns online checks on from
 * `"online": true` in `.dep-guard.json`, with no flag at all, so a
 * config-driven run has `enabled: true` while the umbrella's own argv never
 * saw `--online`. When this field is present and valid it wins over the
 * flag; the flag is a fallback statement about what the umbrella asked for,
 * never a claim about what dep-guard actually did.
 */
interface DepGuardOnlineInfo {
  enabled?: boolean;
  lookupsAttempted?: number;
  lookupsSkippedByDeadline?: number;
}

function readOnlineInfo(value: unknown): DepGuardOnlineInfo | null {
  if (!isRecord(value)) {
    return null;
  }
  const info: DepGuardOnlineInfo = {};
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') {
      return null;
    }
    info.enabled = value.enabled;
  }
  if (value.lookupsAttempted !== undefined) {
    if (typeof value.lookupsAttempted !== 'number' || !Number.isFinite(value.lookupsAttempted)) {
      return null;
    }
    info.lookupsAttempted = value.lookupsAttempted;
  }
  if (value.lookupsSkippedByDeadline !== undefined) {
    if (
      typeof value.lookupsSkippedByDeadline !== 'number' ||
      !Number.isFinite(value.lookupsSkippedByDeadline)
    ) {
      return null;
    }
    info.lookupsSkippedByDeadline = value.lookupsSkippedByDeadline;
  }
  return info;
}

export function normalizeDepGuard(
  raw: unknown,
  version: string | null,
  /** Whether the umbrella passed --online to dep-guard, read from its own argv. */
  onlineRequested = false
): NormalizedGateOutput {
  const product = 'dep-guard';
  const root = needRecord(raw, product, 'the output');
  const run = needRecord(root.run, product, 'run');
  const threshold = optionalString(run.failOn, product, 'run.failOn') ?? null;
  const trustBase = readTrustBase(root.trustBase, product);
  const diagnostics: Diagnostic[] = [];
  const onlineInfo = readOnlineInfo(run.online);

  const findings: Finding[] = needArray(root.findings, product, 'findings').map((entry, index) => {
    const where = `findings[${index}]`;
    const source = needRecord(entry, product, where);
    return {
      schemaVersion: 1 as const,
      product,
      productVersion: version,
      ruleId: `dep-guard/${needString(source.ruleId, product, `${where}.ruleId`)}`,
      // dep-guard's four levels are the shared ladder exactly, so this is
      // identity and nothing is derived.
      severity: needString(source.severity, product, `${where}.severity`) as Severity,
      severityIsDerived: false,
      blocking: false,
      message: needString(source.message, product, `${where}.message`),
      subject: {
        kind: 'package' as const,
        name: needString(source.packageName, product, `${where}.packageName`),
        manifest: needString(source.manifestPath, product, `${where}.manifestPath`),
        ...(source.lockfilePath === undefined
          ? {}
          : { lockfile: needString(source.lockfilePath, product, `${where}.lockfilePath`) }),
      },
      fingerprint: {
        value: needString(source.fingerprint, product, `${where}.fingerprint`),
        scope: product,
        // dep-guard hashes the rule id, the package name, the manifest path,
        // and the signal. Position-free, so an unrelated edit above a finding
        // does not mint a new one.
        stability: 'stable' as const,
      },
      details: optionalDetails(source.details, product, `${where}.details`),
    };
  });

  reconcileBlocking(
    findings,
    typeof run.blockingMatches === 'number' ? run.blockingMatches : undefined,
    threshold,
    product,
    diagnostics
  );

  return {
    findings,
    // Third gate, same key, same two fields read. dep-guard carries three
    // changed flags and three shape changes, one pair about .npmrc, which
    // the other two have no equivalent of; none of it is read here. The
    // sentences are that gate's claims about its own control files.
    ...(trustBase === undefined ? {} : { trustBase }),
    run: {
      failOn: threshold,
      suppressed: typeof root.suppressed === 'number' ? root.suppressed : 0,
      ignored: typeof root.ignored === 'number' ? root.ignored : 0,
      // Diagnostics never move dep-guard's own exit code, so they stay out
      // of findings[] here too rather than becoming pseudo-findings. An
      // installed dep-guard old enough to have no `run.online` object, or
      // one whose online object says the budget ran out, raises its own
      // online-deadline-exceeded diagnostic here, and it is carried through
      // unchanged rather than the umbrella minting a second note about the
      // same event (issue #72 fix round: dep-guard's own diagnostic already
      // names the count, so nothing here duplicates it).
      diagnostics: readDiagnostics(run.diagnostics, product, 'run.diagnostics'),
      details: {
        mode: run.mode ?? null,
        corpusBuiltAt: run.corpusBuiltAt ?? null,
        lockfileFormat: run.lockfileFormat ?? null,
        // dep-guard's own `enabled` claim wins whenever the online object is
        // present and valid: dep-guard can turn online checks on from
        // ".dep-guard.json"'s own "online" key with no flag at all, so the
        // umbrella's argv does not always know the true answer. Only when
        // there is no trustworthy claim to read does this fall back to
        // stating what the umbrella itself asked for, worded so it is never
        // mistaken for a claim about what dep-guard actually did.
        ...(onlineInfo?.enabled === undefined
          ? { 'online-flag': onlineRequested ? 'passed' : 'not passed' }
          : { online: onlineInfo.enabled }),
        ...(onlineInfo?.lookupsAttempted === undefined
          ? {}
          : { lookups: onlineInfo.lookupsAttempted }),
        ...(onlineInfo?.lookupsSkippedByDeadline === undefined
          ? {}
          : { 'skipped-by-deadline': onlineInfo.lookupsSkippedByDeadline }),
      },
    },
    diagnostics,
  };
}

// -- vault-guard ----------------------------------------------------------

export function normalizeVaultGuard(raw: unknown, version: string | null): NormalizedGateOutput {
  const product = 'vault-guard';
  const root = needRecord(raw, product, 'the output');
  const run = root.run === undefined ? {} : needRecord(root.run, product, 'run');
  // run.blocking_matches, never summary.secrets. vault-guard's own type
  // documentation says integrators gating a build must read the former,
  // because the latter ignores the threshold. A sibling tool in this family
  // read summary.secrets and that is the bug not to copy.
  const threshold = optionalString(run.fail_on, product, 'run.fail_on') ?? null;
  const trustBase = readTrustBase(root.trustBase, product);
  const diagnostics: Diagnostic[] = [];

  const findings: Finding[] = [];
  const results = needArray(root.results, product, 'results');
  for (const [fileIndex, rawEntry] of results.entries()) {
    const entryWhere = `results[${fileIndex}]`;
    const entry = needRecord(rawEntry, product, entryWhere);
    const file = needString(entry.file, product, `${entryWhere}.file`);
    const matches =
      entry.matches === undefined
        ? []
        : needArray(entry.matches, product, `${entryWhere}.matches`);

    for (const [matchIndex, rawMatch] of matches.entries()) {
      const where = `${entryWhere}.matches[${matchIndex}]`;
      const match = needRecord(rawMatch, product, where);
      const type = needString(match.type, product, `${where}.type`);
      const severity = needString(match.severity, product, `${where}.severity`);
      const line = needNumber(match.line, product, `${where}.line`);
      const column = needNumber(match.column, product, `${where}.column`);
      const known = ['critical', 'high', 'medium', 'low'].includes(severity);

      findings.push({
        schemaVersion: 1,
        product,
        productVersion: version,
        // `type` is an open vocabulary: a user's own extra_patterns choose
        // their own ids, which is exactly why the namespace is not optional.
        ruleId: `vault-guard/${type}`,
        // Unknown levels land on info rather than being passed through, so
        // a downstream consumer never sees a level outside the union. An
        // unrecognised level is the umbrella's guess, hence derived.
        severity: known ? (severity as Severity) : 'info',
        severityIsDerived: !known,
        blocking: false,
        // The JSON output carries no message at all. This is vault-guard's
        // own SARIF template, so the wording comes from the product rather
        // than from here.
        message: `Possible secret of type '${type}'`,
        subject: {
          kind: 'location',
          file,
          line,
          // The JSON column is 0-based and the envelope's is 1-based. The
          // product's own SARIF does the same conversion; doing it here too
          // is what makes one shared mapping possible.
          column: column + 1,
          // No endColumn. vault-guard DOES know the match length: it hashes
          // it into the fingerprint and puts an end column in its own SARIF.
          // What it omits is matchLength on the match object in the JSON
          // output, which is the channel the umbrella reads. So the end of
          // the match is unknown from THIS CHANNEL rather than unknown to
          // the product, which makes it a fixable upstream ask (carry
          // matchLength on the match) rather than a permanent limitation.
          // Until it is carried, it is not guessed.
        },
        fingerprint: {
          value: needString(match.fingerprint, product, `${where}.fingerprint`),
          scope: product,
          // Hashed over the relative path, the type, the line, the offset,
          // and the match length. Inserting an unrelated line above a
          // secret changes it, so a baseline entry expires on the next edit.
          stability: 'positional',
        },
        // The passthrough half. These are not required: they are carried,
        // not mapped, so a gate that stops emitting one should not turn
        // into a blocked commit.
        details: {
          type,
          severity,
          line,
          // Spelled with its base in the key. This bag is carried, not
          // mapped, so the number stays the gate's own 0-based one; calling
          // it "column" put it next to a 1-based SARIF startColumn in the
          // same result, where it read as an off-by-one in this tool rather
          // than as two different conventions side by side. Renaming the key
          // says which is which without rewriting a gate's own output into
          // units that gate never used.
          columnZeroBased: column,
          offset: match.offset ?? null,
          // Already redacted at the source, so it is safe to carry.
          value: match.value ?? null,
        },
      });
    }
  }

  reconcileBlocking(
    findings,
    typeof run.blocking_matches === 'number' ? run.blocking_matches : undefined,
    threshold,
    product,
    diagnostics
  );

  return {
    findings,
    // vault-guard 1.7.0 puts its pull-request summary at the TOP LEVEL, the
    // same place intent-guard puts its own, and carries more fields than the
    // umbrella reads (configChanged, baselineChanged, and a shape change for
    // each). Only `ref` and `proposals` are read, which is the passthrough
    // rule applied to a second gate: the sentences are that gate's claims
    // about its own control files, and this package has no standing to
    // rewrite them or to act on the structured half.
    ...(trustBase === undefined ? {} : { trustBase }),
    run: {
      failOn: threshold,
      suppressed: typeof run.baseline_suppressed === 'number' ? run.baseline_suppressed : 0,
      // This normalizer reads no ignore count out of vault-guard's run object
      // (which does carry config_ignored_files; it is not mapped here), so 0
      // is a placeholder and not a claim that nothing was ignored. What makes
      // the report say "ignored not reported" is not this number: it is
      // `ignoredReported: false` in `details` below, which output-text.ts and
      // the summary line read in its place.
      ignored: 0,
      // vault-guard's diagnostics carry a context object rather than a
      // message, so the context is rendered as one. Validated the same way
      // as everything else, since a malformed entry here would otherwise
      // reach String() and produce "[object Object]" in a report.
      diagnostics:
        root.diagnostics === undefined
          ? []
          : needArray(root.diagnostics, product, 'diagnostics').map((entry, index) => {
              const where = `diagnostics[${index}]`;
              const record = needRecord(entry, product, where);
              return {
                code: needString(record.code, product, `${where}.code`),
                message: JSON.stringify(record.ctx ?? {}),
              };
            }),
      details: {
        filesScanned: run.files_scanned ?? null,
        patternsActive: run.patterns_active ?? null,
        ignoredReported: false,
      },
    },
    diagnostics,
  };
}

// -- intent-guard ---------------------------------------------------------

/**
 * intent-guard has no per-finding severity, so every level below is the
 * umbrella's invention and every finding it produces carries
 * severityIsDerived: true. The product's own action string is kept in
 * `details` so a consumer can ignore this mapping entirely.
 */
const BUDGET_SEVERITY: Record<string, Severity> = {
  hard_block: 'critical',
  soft_block: 'high',
};

const DRIFT_SEVERITY: Record<string, Severity> = {
  hard_block: 'critical',
  soft_block: 'high',
  warn: 'medium',
  info: 'low',
  proceed: 'info',
};

/**
 * intent-guard's own namespace for its advance-notice warnings, not the
 * umbrella's: the umbrella never mints a `conductor/` id for this, because
 * the statement being relayed is entirely intent-guard's own (see AGENTS.md
 * on the umbrella's fixed set of ids).
 */
export const INTENT_WARNING = 'intent-guard/warning';

/**
 * intent-guard 1.7.0's own advance notice that a frozen contract's
 * `protected_paths` or `allowed_paths` carries an entry no git path can
 * ever match (a leading slash, an empty path segment, and the like), read
 * from the optional `warnings` array. 1.7.0 warns about this; 2.0.0 turns it
 * into a blocking reason (intent-guard's own budget-paths.ts).
 *
 * Tolerant on purpose, unlike everything else this file validates: this is
 * reporting, never judgment, so a shape an installed intent-guard did not
 * send correctly must never turn into a could-not-run for the gate. Absent
 * (1.6.0 and earlier, which never sent this field) means none. A value that
 * is not an array, or an array holding even one non-string entry, is
 * ignored outright rather than partially read: half-reading it would print
 * some warnings and silently drop others, which is worse than saying
 * nothing until the shape is understood again.
 */
function readIntentWarnings(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.every((entry) => typeof entry === 'string') ? (raw as string[]) : [];
}

/**
 * intent-guard 1.6.0 (issue #34) caps a constraint finding at advisory when
 * its `source` is a prose rules file (CLAUDE.md, AGENTS.md, GEMINI.md,
 * cursor rules): a strong match is still reported, but it never raises
 * `constraint_violation`, `criticalViolated`, or the gate's own exit code.
 *
 * `finding_details` carries no field saying so. `strength` is "strong" for a
 * capped prose match exactly the same as an uncapped one, and the
 * constraint's `source` is never carried onto the finding at all. The ONLY
 * surviving signal is this literal prefix, which intent-guard's own drift.ts
 * puts on the message for this one case.
 *
 * THIS IS NOT A SAFETY NET. Nothing in this repository detects an upstream
 * rewording of that prefix: there is no test against the live binary, only
 * a static fixture capture, so a wording change in a future intent-guard
 * release would silently stop matching here and a capped finding would go
 * back to rendering as blocking with no warning anywhere in this report or
 * in CI. Filed upstream as intent-guard #114, asking for a machine-readable
 * per-finding field so this can stop keying on message text; this constant
 * is the interim measure until that lands, not a substitute for it.
 */
const ADVISORY_CONSTRAINT_PREFIX = 'advisory ';

/**
 * The three ways the intent gate can block on the STATE of the contract
 * rather than on anything in the diff.
 *
 * These matter because the gate pushes them into the same `reasons` array as
 * its budget and drift reasons, and exposes no structured field saying which
 * is which. So a run with an unfrozen contract AND a budget violation used
 * to report only the budget violation: the reason the commit could not be
 * fixed by editing the diff was in neither report.
 *
 * The prefixes are copied from intent-guard's own gate.ts. They are matched
 * as prefixes rather than whole strings because one of the three
 * interpolates an error message, and they are enumerated in a test against
 * the real strings, so an upstream rewording turns that test red instead of
 * silently dropping a reason out of every report.
 *
 * THE NO-CONTRACT SENTENCE INTERPOLATES THE STATE DIRECTORY NAME, so it has
 * two spellings and needs two entries. The gate builds it as
 * `No ${STATE_DIR}/intent-contract.yaml found.`, and 1.3.0 renamed STATE_DIR
 * from `.conductor` to `.intent-guard`. Matching only the old name left this
 * classifier DEAD against every gate anybody can install today: the reason
 * fell through to the unattributed backstop, so the finding said
 * `kind: unattributed` where a consumer filters on `contract-missing`, and a
 * run that also had a budget violation dropped the no-contract reason out of
 * the report entirely, since the backstop only fires when nothing else
 * blocked. Both names stay, because the umbrella reads both state
 * directories elsewhere and a repository on either version has to be
 * classified the same way.
 */
export const GATE_STATE_REASON_KINDS = [
  'contract-invalid',
  'contract-missing',
  'contract-unfrozen',
  /**
   * The two pull-request-mode refusals, from intent-guard 1.4.0.
   *
   * They are here rather than left to the backstop for the reason the whole
   * list exists. The backstop fires only when NOTHING ELSE BLOCKED, so a pull
   * request that forged a contract approval AND breached a change budget
   * reported only the budget breach: the run still failed, but the report
   * never said the approval was self-granted, which is the single most
   * important sentence pull-request mode produces. Found by running the real
   * gate against a crafted pull request rather than by reading the code.
   */
  'self-approval-refused',
  'control-input-refused',
] as const;

export type GateStateReasonKind = (typeof GATE_STATE_REASON_KINDS)[number];

const GATE_STATE_REASON_PREFIXES: ReadonlyArray<[string, GateStateReasonKind]> = [
  ['Intent contract is invalid:', 'contract-invalid'],
  ['No .intent-guard/intent-contract.yaml found', 'contract-missing'],
  ['No .conductor/intent-contract.yaml found', 'contract-missing'],
  ['Intent contract exists but is not frozen', 'contract-unfrozen'],
  // Copied from intent-guard's own trust-base.ts, where both are exported
  // constants for exactly this: SELF_APPROVAL_REASON_PREFIX and
  // CONTROL_INPUT_REASON_PREFIX. Prefixes, because each interpolates the ref
  // and the path.
  ['Self-approval refused:', 'self-approval-refused'],
  ['Control input refused:', 'control-input-refused'],
];

/** Which gate-state reason this is, or null when it is a budget or drift reason. */
export function classifyGateStateReason(reason: string): GateStateReasonKind | null {
  for (const [prefix, kind] of GATE_STATE_REASON_PREFIXES) {
    if (reason.startsWith(prefix)) {
      return kind;
    }
  }
  return null;
}

/**
 * The pull-request-mode summary intent-guard 1.4.0 puts on its check output,
 * or undefined when the run was not in pull-request mode.
 *
 * ABSENCE IS THE SIGNAL, and it is the gate's own: the field is present only
 * on a run that was given `--trust-base`, so an ordinary run has nothing here
 * and no report has to guess. Validated element by element like everything
 * else, because a malformed proposal reaching String() would put
 * "[object Object]" on the one line a reviewer reads.
 *
 * The proposal SENTENCES are the gate's, carried verbatim and never
 * rewritten. Every one of them is a claim about that gate's own control
 * files, which the umbrella does not read and has no standing to describe.
 */
function readTrustBase(
  raw: unknown,
  product: string
): NormalizedGateOutput['trustBase'] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const record = needRecord(raw, product, 'trustBase');
  return {
    ref: needString(record.ref, product, 'trustBase.ref'),
    proposals:
      record.proposals === undefined
        ? []
        : needStringArray(record.proposals, product, 'trustBase.proposals'),
  };
}

export function normalizeIntentGuard(raw: unknown, version: string | null): NormalizedGateOutput {
  const product = 'intent-guard';
  const root = needRecord(raw, product, 'the output');
  if (root.status !== 'blocked' && root.status !== 'ok') {
    fail(product, 'status', 'either "ok" or "blocked"');
  }
  const trustBase = readTrustBase(root.trustBase, product);
  const warnings = readIntentWarnings(root.warnings);

  const findings: Finding[] = [];
  const budget = root.budget === undefined ? undefined : needRecord(root.budget, product, 'budget');
  const drift = root.drift === undefined ? undefined : needRecord(root.drift, product, 'drift');

  // Budget violations. The gate raises one reason per violation and blocks
  // when it has any reason at all, so every violation is blocking. That is
  // read off the gate's own composition rule, not off a severity ladder.
  const violations =
    budget?.violations === undefined
      ? []
      : needArray(budget.violations, product, 'budget.violations');

  for (const [index, rawViolation] of violations.entries()) {
    const where = `budget.violations[${index}]`;
    const violation = needRecord(rawViolation, product, where);
    const rule = needString(violation.rule, product, `${where}.rule`);
    const severity = needString(violation.severity, product, `${where}.severity`);
    const matched =
      violation.matched === undefined
        ? []
        : needStringArray(violation.matched, product, `${where}.matched`);

    findings.push({
      schemaVersion: 1,
      product,
      productVersion: version,
      ruleId: `intent-guard/budget.${rule}`,
      severity: BUDGET_SEVERITY[severity] ?? 'info',
      severityIsDerived: true,
      blocking: true,
      message: needString(violation.message, product, `${where}.message`),
      subject: { kind: 'paths', paths: matched },
      fingerprint: {
        value: needString(violation.fingerprint, product, `${where}.fingerprint`),
        scope: product,
        // Hashed over the contract id, the rule, and the sorted normalized
        // matched paths. Order-independent and position-free.
        stability: 'stable',
      },
      details: { rule, severity, matched },
    });
  }

  // Drift findings. 1.2.0 gave these stable fingerprints and a bounded
  // rule_id, which is what makes one finding per entry honest; before that
  // they were bare prose strings and the only truthful rendering was a
  // single synthetic finding for the whole run.
  //
  // The blocking decision is the SCORE's, not the finding's: the gate
  // raises one drift reason for the overall action and none per finding, so
  // a finding is blocking exactly when the overall action blocks.
  const driftAction = optionalString(drift?.action, product, 'drift.action') ?? 'proceed';
  const driftBlocks = driftAction === 'soft_block' || driftAction === 'hard_block';

  const driftDetails =
    drift?.finding_details === undefined
      ? []
      : needArray(drift.finding_details, product, 'drift.finding_details');

  for (const [index, rawDetail] of driftDetails.entries()) {
    const where = `drift.finding_details[${index}]`;
    const detail = needRecord(rawDetail, product, where);
    const category = needString(detail.category, product, `${where}.category`);
    const message = needString(detail.message, product, `${where}.message`);

    // See ADVISORY_CONSTRAINT_PREFIX. A capped finding never contributed to
    // driftAction, so it must not inherit that action's blocking flag or
    // severity the way every other drift finding here does (issue #34).
    const advisoryCapped = category === 'constraint_violation' && message.startsWith(ADVISORY_CONSTRAINT_PREFIX);

    findings.push({
      schemaVersion: 1,
      product,
      productVersion: version,
      // The category, not rule_id: rule_id can carry contract prose, and a
      // rule id that contains a user's sentence is not a rule id. The full
      // value goes in details.
      ruleId: `intent-guard/drift.${category}`,
      severity: advisoryCapped ? 'low' : (DRIFT_SEVERITY[driftAction] ?? 'info'),
      severityIsDerived: true,
      blocking: advisoryCapped ? false : driftBlocks,
      message,
      // No paths subject: `matched` here is "tokens or paths", so treating
      // it as a path list would sometimes point at a file that does not
      // exist. It stays in details, where it is not claiming to be a location.
      subject: { kind: 'contract', category },
      fingerprint: {
        value: needString(detail.fingerprint, product, `${where}.fingerprint`),
        scope: product,
        stability: 'stable',
      },
      details: {
        ruleId: detail.rule_id ?? null,
        category,
        matched: detail.matched ?? [],
      },
    });
  }

  // The gate can block for a reason that is neither a budget violation nor
  // drift: no contract, an unfrozen contract, an unreadable one. Those
  // arrive only as prose in `reasons`, mixed in with the budget and drift
  // reasons and with no structured field separating them.
  //
  // One finding PER gate-state reason, and always, not only when nothing
  // else blocked. The old rule ("only when nothing else is blocking") meant
  // a run with both an unfrozen contract and a budget violation reported
  // only the budget violation, hiding the one problem the user could not fix
  // by editing the diff.
  const reasons =
    root.reasons === undefined ? [] : needStringArray(root.reasons, product, 'reasons');

  function gateBlocked(message: string, kind: GateStateReasonKind | 'unattributed'): Finding {
    return {
      schemaVersion: 1,
      product,
      productVersion: version,
      ruleId: 'intent-guard/gate-blocked',
      severity: 'critical',
      severityIsDerived: true,
      blocking: true,
      message,
      subject: { kind: 'none' },
      // No fingerprint: the product mints none for a gate-state block, and
      // inventing one would produce an id no baseline anywhere contains.
      fingerprint: null,
      details: {
        kind,
        reasons,
        contractFound: root.contractFound ?? null,
        contractFrozen: root.contractFrozen ?? null,
      },
    };
  }

  if (root.status === 'blocked') {
    const gateStateReasons = reasons
      .map((reason) => ({ reason, kind: classifyGateStateReason(reason) }))
      .filter((entry): entry is { reason: string; kind: GateStateReasonKind } => entry.kind !== null);

    for (const entry of gateStateReasons) {
      findings.push(gateBlocked(entry.reason, entry.kind));
    }

    // The backstop, unchanged in spirit: a blocked gate with nothing blocking
    // in the report reads as a bug in the umbrella and hides the one thing
    // the user needs to see. It fires only when no gate-state reason was
    // recognised AND nothing else blocked, so it never doubles up with the
    // findings above, and it never invents a contract complaint the gate did
    // not make (a contract left unfrozen under --no-require-frozen is not a
    // reason, and must not become one here).
    if (gateStateReasons.length === 0 && !findings.some((finding) => finding.blocking)) {
      findings.push(
        gateBlocked(
          reasons.length > 0
            ? reasons.join(' ')
            : 'The intent gate blocked without stating a reason.',
          'unattributed'
        )
      );
    }
  }

  return {
    findings,
    ...(trustBase === undefined ? {} : { trustBase }),
    run: {
      // intent-guard has no threshold flag and no reported threshold: its
      // drift thresholds live in its own config file and its budget rules
      // have no threshold at all.
      failOn: null,
      suppressed: 0,
      ignored: 0,
      // intent-guard's own advance-notice warnings (1.7.0's budget-path
      // deprecation notes). Reporting, never a finding: no severity, no
      // fingerprint, no blocking flag, and no effect on the exit code.
      diagnostics: warnings.map((message) => ({ code: INTENT_WARNING, message })),
      details: {
        contractFound: root.contractFound ?? null,
        contractFrozen: root.contractFrozen ?? null,
        driftOverall: typeof drift?.overall === 'number' ? drift.overall : null,
        driftAction,
        driftCategories: drift?.categories ?? null,
        budgetAction: budget?.action ?? null,
        reasons,
      },
    },
    diagnostics: [],
  };
}

// -- gitleaks (external, git history mode) -------------------------------
//
// The report is a JSON array written to a file, one entry per leak, with
// the field names in tests/fixtures/README.md. gitleaks has no severity of
// its own: a rule matched or it did not. So every finding is `high`, marked
// derived, and whether it blocks comes from the exit code the runner read
// (3, the leak code the umbrella moves it to), not from anything in the
// entry.
//
// NEVER CARRIED: Secret, Match and Line. The umbrella passes --redact, but a
// report can be unredacted if a tool changes or a policy finds a way round
// it, and this report is posted to a pull request and uploaded as SARIF.
// Neither Email nor Author is carried: who made the commit has no bearing on
// fixing a leak, and a name or address would be published with it.
//
// ONE FINDING PER PLACE. The umbrella asks git for each merge's first-parent
// diff (--diff-merges=first-parent) so a secret added inside a merge is seen,
// and under an Actions-style merge that shows a pull request's change twice:
// in its own commit and in the merge. Entries sharing rule, file, line and
// column collapse to the one with the earliest Date (the last in report
// order on a tie or a missing date, since git log lists newest first), and
// the other commits are listed in details.alsoIn.

export function normalizeGitleaks(
  raw: unknown,
  version: string | null,
  blocked: boolean
): NormalizedGateOutput {
  const product = 'gitleaks';
  const entries = needArray(raw, product, 'the report');
  const byPlace = new Map<string, { finding: Finding; time: number; alsoIn: string[] }>();
  entries.forEach((rawEntry, index) => {
    const where = `report[${index}]`;
    const entry = needRecord(rawEntry, product, where);
    const rule = needString(entry.RuleID, product, `${where}.RuleID`);
    const file = needString(entry.File, product, `${where}.File`);
    const line = needNumber(entry.StartLine, product, `${where}.StartLine`);
    // Carried as gitleaks reports them, which is also what its own SARIF
    // output uses. gitleaks 8.30.1 column numbers are not consistently 0- or
    // 1-based across findings (one token at character 21 was reported at 22,
    // another at character 15 at 15), so no correction is applied.
    const column = typeof entry.StartColumn === 'number' ? entry.StartColumn : 1;
    const endColumn = typeof entry.EndColumn === 'number' ? entry.EndColumn : undefined;
    const commit = optionalString(entry.Commit, product, `${where}.Commit`);
    const date = optionalString(entry.Date, product, `${where}.Date`);
    // gitleaks' own Fingerprint is commit:file:rule:line, identical across
    // runs over the same history, so it is stable. Rebuilt in that shape if
    // a report ever omits it.
    const fingerprint =
      optionalString(entry.Fingerprint, product, `${where}.Fingerprint`) ??
      `${commit ?? ''}:${file}:${rule}:${line}`;
    const finding: Finding = {
      schemaVersion: 1,
      product,
      productVersion: version,
      ruleId: `gitleaks/${rule}`,
      severity: 'high',
      severityIsDerived: true,
      blocking: blocked,
      message:
        optionalString(entry.Description, product, `${where}.Description`) ?? `${rule} matched`,
      subject: {
        kind: 'location',
        file,
        line,
        column,
        ...(endColumn === undefined ? {} : { endColumn }),
      },
      fingerprint: { value: fingerprint, scope: product, stability: 'stable' },
      details: {
        ...(commit === undefined ? {} : { commit }),
        ...(date === undefined ? {} : { date }),
        ...(typeof entry.Entropy === 'number' ? { entropy: entry.Entropy } : {}),
        ...(Array.isArray(entry.Tags) ? { tags: entry.Tags } : {}),
      },
    };
    const place = JSON.stringify([rule, file, line, column]);
    const time = date === undefined ? Number.NaN : Date.parse(date);
    const seen = byPlace.get(place);
    if (seen === undefined) {
      byPlace.set(place, { finding, time, alsoIn: [] });
      return;
    }
    // The later entry replaces the kept one unless both dates are known and
    // it is strictly newer. So an earlier date wins, and on a tie or a
    // missing date the LAST entry in report order wins: git log lists newer
    // commits first, so the last is the oldest, never a synthetic merge.
    const bothDated = !Number.isNaN(time) && !Number.isNaN(seen.time);
    const replace = !bothDated || time <= seen.time;
    const dropped = replace ? seen.finding : finding;
    const droppedCommit = dropped.details.commit;
    if (replace) {
      seen.finding = finding;
      seen.time = time;
    }
    if (typeof droppedCommit === 'string') {
      seen.alsoIn.push(droppedCommit);
    }
  });
  const findings: Finding[] = [...byPlace.values()].map(({ finding, alsoIn }) =>
    alsoIn.length === 0 ? finding : { ...finding, details: { ...finding.details, alsoIn } }
  );
  return {
    findings,
    run: {
      // Any match fails the gate: gitleaks has no threshold to report.
      failOn: 'any',
      suppressed: 0,
      ignored: 0,
      diagnostics: [],
      details: { entries: entries.length },
    },
    diagnostics: [],
  };
}

// -- osv-scanner (external, known vulnerabilities) ------------------------
//
// `osv-scanner scan source --format json` prints results[] per lockfile,
// packages[] per resolved package, vulnerabilities[] per advisory, and
// groups[] that merge an advisory with its aliases and carry the highest
// CVSS base score among them as `max_severity`, a string. Every field read
// below was checked against the 2.6.0 capture (tests/fixtures/README.md).

/** CVSS base score onto the shared four-level ladder, by the CVSS v3 bands. */
export function cvssToSeverity(score: number | null): Severity {
  if (score === null || Number.isNaN(score)) {
    return 'medium';
  }
  if (score >= 9) {
    return 'critical';
  }
  if (score >= 7) {
    return 'high';
  }
  if (score >= 4) {
    return 'medium';
  }
  return 'low';
}

function osvScore(vuln: Record<string, unknown>, groups: Record<string, unknown>[]): number | null {
  const id = typeof vuln.id === 'string' ? vuln.id : '';
  for (const group of groups) {
    const ids = Array.isArray(group.ids) ? (group.ids as unknown[]) : [];
    if (ids.includes(id) && typeof group.max_severity === 'string' && group.max_severity !== '') {
      const score = Number(group.max_severity);
      if (!Number.isNaN(score)) {
        return score;
      }
    }
  }
  // No group score: fall back to the advisory database's own word, mapped
  // to a representative score inside the matching band.
  const specific = vuln.database_specific;
  if (isRecord(specific) && typeof specific.severity === 'string') {
    const word = specific.severity.toUpperCase();
    if (word === 'CRITICAL') return 9.5;
    if (word === 'HIGH') return 7.5;
    if (word === 'MODERATE' || word === 'MEDIUM') return 5;
    if (word === 'LOW') return 2;
  }
  return null;
}

/** Numeric parts of a version, for ordering; "0" and "4.0.0" both parse. */
function versionParts(value: string): number[] {
  return (value.match(/\d+/g) ?? []).map(Number);
}

function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * The release that fixes this advisory for the INSTALLED version.
 *
 * An advisory can list several ranges for one package (nanoid's fixes at
 * 3.3.16 for the 3.x line and 5.1.16 for 4.x and 5.x), so the first `fixed`
 * event is not the answer: the fix is the one closing the range the
 * installed version sits in. When no range can be shown to contain it, the
 * lowest fix above the installed version is the next best statement; when
 * there is none, no fix is claimed.
 */
function osvFixedVersion(
  vuln: Record<string, unknown>,
  name: string,
  installed: string
): string | undefined {
  const affected = Array.isArray(vuln.affected) ? vuln.affected : [];
  const candidates: string[] = [];
  for (const entry of affected) {
    if (!isRecord(entry)) continue;
    if (isRecord(entry.package) && entry.package.name !== name) continue;
    const ranges = Array.isArray(entry.ranges) ? entry.ranges : [];
    for (const range of ranges) {
      if (!isRecord(range) || !Array.isArray(range.events)) continue;
      let introduced: string | undefined;
      for (const event of range.events) {
        if (!isRecord(event)) continue;
        if (typeof event.introduced === 'string') {
          introduced = event.introduced;
        }
        if (typeof event.fixed === 'string') {
          candidates.push(event.fixed);
          const inRange =
            installed !== '' &&
            (introduced === undefined || compareVersions(installed, introduced) >= 0) &&
            compareVersions(installed, event.fixed) < 0;
          if (inRange) {
            return event.fixed;
          }
        }
      }
    }
  }
  const above = candidates
    .filter((fixed) => installed === '' || compareVersions(fixed, installed) > 0)
    .sort(compareVersions);
  return above[0];
}

/**
 * osv-scanner writes every manifest path absolute, whatever scan root or
 * relative --lockfile path it is given, so in CI it names the runner's
 * checkout. Made relative to the first root that contains it; left as it is
 * when none does, rather than guessed.
 */
function relativeToRoots(file: string, roots: readonly string[]): string {
  for (const root of roots) {
    const prefix = root.endsWith('/') ? root : `${root}/`;
    if (file.startsWith(prefix)) {
      return file.slice(prefix.length);
    }
  }
  return file;
}

/**
 * The vulnerabilities summary line's lockfile fact (issue #72): the count and
 * names of the lockfiles the UMBRELLA handed osv-scanner with --lockfile,
 * never osv-scanner's own results[], which 2.x prints only for a source with
 * findings. A clean scan of one lockfile and a run that scanned none both
 * have results: [], and only this list tells them apart.
 */
function describeLockfiles(lockfiles: readonly string[]): string {
  return lockfiles.length === 0 ? '0' : `${lockfiles.length} (${lockfiles.join(', ')})`;
}

export function normalizeOsvScanner(
  raw: unknown,
  version: string | null,
  blocked: boolean,
  /** The scan root as a path osv-scanner may have printed it, in any spelling. */
  roots: readonly string[] = [],
  /** The lockfiles the umbrella passed with --lockfile, repository-relative. */
  lockfiles: readonly string[] = []
): NormalizedGateOutput {
  const product = 'osv-scanner';
  const top = needRecord(raw, product, 'the output');
  const results = needArray(top.results, product, 'results');
  const findings: Finding[] = [];
  for (const [ri, rawResult] of results.entries()) {
    const resultWhere = `results[${ri}]`;
    const result = needRecord(rawResult, product, resultWhere);
    const source = needRecord(result.source, product, `${resultWhere}.source`);
    const manifest = relativeToRoots(
      needString(source.path, product, `${resultWhere}.source.path`),
      roots
    );
    const packages = needArray(result.packages, product, `${resultWhere}.packages`);
    for (const [pi, rawPackage] of packages.entries()) {
      const packageWhere = `${resultWhere}.packages[${pi}]`;
      const entry = needRecord(rawPackage, product, packageWhere);
      const pkg = needRecord(entry.package, product, `${packageWhere}.package`);
      const name = needString(pkg.name, product, `${packageWhere}.package.name`);
      const installed = optionalString(pkg.version, product, `${packageWhere}.package.version`) ?? '';
      const ecosystem = optionalString(pkg.ecosystem, product, `${packageWhere}.package.ecosystem`);
      const groups = (
        entry.groups === undefined ? [] : needArray(entry.groups, product, `${packageWhere}.groups`)
      ).filter(isRecord);
      const vulns =
        entry.vulnerabilities === undefined
          ? []
          : needArray(entry.vulnerabilities, product, `${packageWhere}.vulnerabilities`);
      for (const [vi, rawVuln] of vulns.entries()) {
        const where = `${packageWhere}.vulnerabilities[${vi}]`;
        const vuln = needRecord(rawVuln, product, where);
        const id = needString(vuln.id, product, `${where}.id`);
        const score = osvScore(vuln, groups);
        const fixedVersion = osvFixedVersion(vuln, name, installed);
        findings.push({
          schemaVersion: 1,
          product,
          productVersion: version,
          ruleId: `osv-scanner/${id}`,
          severity: cvssToSeverity(score),
          severityIsDerived: true,
          blocking: blocked,
          message:
            optionalString(vuln.summary, product, `${where}.summary`) ??
            `${id} affects ${name}@${installed}`,
          subject: { kind: 'package', name, manifest },
          // The advisory, the package and version it applies to, and the
          // manifest it was found through: the same four facts on every run
          // over the same lockfile, so the value is stable.
          fingerprint: { value: `${id}|${name}|${installed}|${manifest}`, scope: product, stability: 'stable' },
          details: {
            version: installed,
            ...(ecosystem === undefined ? {} : { ecosystem }),
            aliases: Array.isArray(vuln.aliases) ? vuln.aliases : [],
            ...(score === null ? {} : { cvss: score }),
            ...(fixedVersion === undefined ? {} : { fixedVersion }),
          },
        });
      }
    }
  }
  return {
    findings,
    run: {
      // Any known vulnerability fails the gate; a threshold, when an adopter
      // wants one, lives in osv-scanner.toml.
      failOn: 'any',
      suppressed: 0,
      ignored: 0,
      diagnostics: [],
      details: {
        lockfiles: describeLockfiles(lockfiles),
        // Distinct from the old "sources" name on purpose: this counts only
        // the sources osv-scanner reported findings for, never how many were
        // scanned, and the old name read as the latter.
        'sources-with-findings': results.length,
      },
    },
    diagnostics: [],
  };
}

// -- the umbrella's own findings ------------------------------------------
//
// Every way a gate can fail to produce a usable result gets a finding here.
// Not for symmetry: a gate that could not run is invisible in the SARIF log
// otherwise, because a gate that never ran gets no SARIF run of its own, so
// without one of these the published report would carry no trace of the
// most important thing that happened.

export type GateProblemRule =
  | 'conductor/gate-missing'
  | 'conductor/gate-output-unparseable'
  | 'conductor/gate-failed';

function gateProblem(
  ruleId: GateProblemRule,
  role: GateRole,
  product: Product,
  message: string,
  details: Record<string, unknown>
): Finding {
  return {
    schemaVersion: 1,
    product: 'conductor',
    productVersion: null,
    ruleId,
    severity: 'critical',
    severityIsDerived: true,
    blocking: true,
    message,
    // No location: none of these is somewhere in the tree.
    subject: { kind: 'none' },
    fingerprint: {
      // Deterministic over the rule, the role, and the product, and NOT over
      // the message: a repeat run is the same alert rather than a new one
      // every commit, and a reworded detail is not a new problem.
      value: createHash('sha256').update(`${ruleId}|${role}|${product}`).digest('hex'),
      scope: 'conductor',
      stability: 'stable',
    },
    details: { role, product, ...details },
  };
}

/**
 * What to install for a product, spelled so it cannot be mistaken for
 * another package. The three npm gates are published under the
 * @vaultcompass scope only: the unscoped dep-guard and intent-guard names are
 * unclaimed on npm, so a reader (or an agent) told to install the bare name
 * could install a squatted package. The external tools are not npm packages
 * of this family and keep their own names.
 */
export function installName(product: Product): string {
  return profileFor(product).managed ? `@vaultcompass/${product}` : product;
}

/**
 * The finding raised when an ENABLED gate's binary cannot be found.
 *
 * A gate that is switched on and silently does not run is the failure this
 * whole family exists to prevent: the report reads clean because nothing
 * looked. So it is a finding, it blocks, and it says which names were
 * tried, so the fix is in the message rather than in a support thread.
 */
export function normalizeMissingGate(
  role: GateRole,
  product: Product,
  candidates: string[],
  /**
   * A sentence appended to the message, or nothing.
   *
   * Written by the caller rather than decided here, because the only thing
   * that varies is WHY the search came up empty, and that is a fact about the
   * run rather than about the finding. Today the one caller that passes
   * anything is a pull-request run, where node_modules/.bin was never
   * searched and the message would otherwise be misleading in exactly the
   * repository shape this is most likely to happen in.
   */
  remedy = ''
): Finding {
  return gateProblem(
    'conductor/gate-missing',
    role,
    product,
    `The "${role}" gate is enabled but no ${product} binary was found. ` +
      `Looked for: ${candidates.join(', ')}. Install ${installName(product)}, point the gate at a build with an ` +
      `absolute "command:", or set enabled: false to switch the gate off on purpose.${remedy}`,
    { candidates }
  );
}

/**
 * The finding raised when a gate's `command:` names a file that is not
 * there.
 *
 * It names ONLY that path. The candidate list belongs to resolution, and
 * resolution never happened here: the user pointed at one specific file, so
 * listing the names the umbrella would otherwise have searched for suggests
 * it looked for them and implies the fix is to install one of them, when
 * the fix is in their policy file.
 */
export function normalizeMisconfiguredGate(
  role: GateRole,
  product: Product,
  command: string,
  detail: string
): Finding {
  return gateProblem(
    'conductor/gate-missing',
    role,
    product,
    `The "${role}" gate points at "${command}", which the umbrella could not run: ${detail}`,
    { command }
  );
}

/**
 * The finding raised when a gate answered but the umbrella could not read
 * the answer: invalid JSON, a shape the normalizer does not know, or any
 * unexpected error thrown while normalizing.
 *
 * `detail` is an error MESSAGE, never a stack. A stack would put a local
 * filesystem path into a report that gets uploaded, and it would tell the
 * user nothing they can act on.
 */
export function normalizeUnparseableGate(
  role: GateRole,
  product: Product,
  detail: string,
  stderr?: string | null
): Finding {
  // Carried for the same reason gate-failed carries it, and the case that
  // found the gap is a good one: a gate refusing to run at all exits 1 with
  // no JSON and says why on stderr, and this result is the only place a
  // published log can repeat it.
  const said = summariseStderr(stderr);
  return gateProblem(
    'conductor/gate-output-unparseable',
    role,
    product,
    `The "${role}" gate ran but the umbrella could not read its output: ${detail} ` +
      'This is the umbrella being out of date with that gate, not a problem in your code. ' +
      'Nothing was verified by this gate.' +
      (said === null ? '' : ` The gate wrote to stderr: ${said}`),
    { detail, stderr: said }
  );
}

/**
 * How much of a failing gate's stderr goes into a published report.
 *
 * A gate that could not run may print a stack, a whole rejected config, or a
 * file it could not parse, and this finding is uploaded to code scanning.
 * The cap is generous enough for the shape that matters -- a line or two
 * naming the file and the reason -- and small enough that nothing here can
 * grow an alert without a bound.
 */
const STDERR_CAP = 2000;

/**
 * The gate's own last words, trimmed and capped, or null when it said
 * nothing.
 *
 * The truncation is ANNOUNCED rather than silent, and says how much there
 * was. A message that stops mid-sentence with no note reads as the gate's
 * final word, which sends a reader looking for meaning in a cut.
 */
export function summariseStderr(stderr: string | null | undefined): string | null {
  if (stderr === null || stderr === undefined) {
    return null;
  }
  const trimmed = stderr.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length <= STDERR_CAP) {
    return trimmed;
  }
  return `${trimmed.slice(0, STDERR_CAP)} [truncated, ${trimmed.length} characters in total]`;
}

/**
 * The finding raised when a gate could not be run or did not complete.
 *
 * `stderr` is what the child printed, and it is carried here because this
 * finding is the ONLY place a published log can say why. A gate that could
 * not run gets no SARIF run of its own, so without this the log held
 * "the gate exited 2, which it uses for could not run" and nothing else,
 * while the text report beside it printed the gate's own line naming the
 * file and the reason. Found by running the umbrella against a repository
 * with an unparseable lockfile.
 *
 * It is APPENDED to the umbrella's own sentence rather than replacing it.
 * The generic half says which exit code was seen and what that gate uses it
 * for, which the child's line does not, and a gate that exits 2 silently is
 * a real case that has to keep reading sensibly.
 *
 * The fingerprint is unaffected: it is computed over the rule, the role and
 * the product and never over the message, so a gate that reworded its error
 * is the same alert rather than a new one every run.
 */
export function normalizeFailedGate(
  role: GateRole,
  product: Product,
  detail: string,
  stderr?: string | null
): Finding {
  const said = summariseStderr(stderr);
  return gateProblem(
    'conductor/gate-failed',
    role,
    product,
    `The "${role}" gate did not complete: ${detail} Nothing was verified by this gate.` +
      (said === null ? '' : ` The gate wrote to stderr: ${said}`),
    { detail, stderr: said }
  );
}
