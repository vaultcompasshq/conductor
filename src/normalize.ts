// Turning each gate's own JSON into the internal envelope.
//
// Three separate functions rather than one table-driven mapper, because the
// three shapes disagree in ways a table would have to paper over: one is a
// flat findings array, one is nested by file, and the third is two
// different streams (a change-budget evaluation and a scored drift rubric)
// plus a gate status that can block for neither reason.
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

export function normalizeDepGuard(raw: unknown, version: string | null): NormalizedGateOutput {
  const product = 'dep-guard';
  const root = needRecord(raw, product, 'the output');
  const run = needRecord(root.run, product, 'run');
  const threshold = optionalString(run.failOn, product, 'run.failOn') ?? null;
  const diagnostics: Diagnostic[] = [];

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
    run: {
      failOn: threshold,
      suppressed: typeof root.suppressed === 'number' ? root.suppressed : 0,
      ignored: typeof root.ignored === 'number' ? root.ignored : 0,
      // Diagnostics never move dep-guard's own exit code, so they stay out
      // of findings[] here too rather than becoming pseudo-findings.
      diagnostics: readDiagnostics(run.diagnostics, product, 'run.diagnostics'),
      details: {
        mode: run.mode ?? null,
        corpusBuiltAt: run.corpusBuiltAt ?? null,
        lockfileFormat: run.lockfileFormat ?? null,
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
          // No endColumn. The JSON output does not carry matchLength (only
          // the fingerprint's inputs use it), so the end of the match is
          // genuinely unknown from this output and is not guessed.
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
          column,
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
    run: {
      failOn: threshold,
      suppressed: typeof run.baseline_suppressed === 'number' ? run.baseline_suppressed : 0,
      // vault-guard does not report an ignore count separately; ignored
      // files never reach the output at all. Reporting 0 here would claim a
      // fact the gate did not state, so the report says "not reported"
      // instead, driven by this null.
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
 */
export const GATE_STATE_REASON_KINDS = [
  'contract-invalid',
  'contract-missing',
  'contract-unfrozen',
] as const;

export type GateStateReasonKind = (typeof GATE_STATE_REASON_KINDS)[number];

const GATE_STATE_REASON_PREFIXES: ReadonlyArray<[string, GateStateReasonKind]> = [
  ['Intent contract is invalid:', 'contract-invalid'],
  ['No .conductor/intent-contract.yaml found', 'contract-missing'],
  ['Intent contract exists but is not frozen', 'contract-unfrozen'],
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

export function normalizeIntentGuard(raw: unknown, version: string | null): NormalizedGateOutput {
  const product = 'intent-guard';
  const root = needRecord(raw, product, 'the output');
  if (root.status !== 'blocked' && root.status !== 'ok') {
    fail(product, 'status', 'either "ok" or "blocked"');
  }

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

    findings.push({
      schemaVersion: 1,
      product,
      productVersion: version,
      // The category, not rule_id: rule_id can carry contract prose, and a
      // rule id that contains a user's sentence is not a rule id. The full
      // value goes in details.
      ruleId: `intent-guard/drift.${category}`,
      severity: DRIFT_SEVERITY[driftAction] ?? 'info',
      severityIsDerived: true,
      blocking: driftBlocks,
      message: needString(detail.message, product, `${where}.message`),
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
    run: {
      // intent-guard has no threshold flag and no reported threshold: its
      // drift thresholds live in its own config file and its budget rules
      // have no threshold at all.
      failOn: null,
      suppressed: 0,
      ignored: 0,
      diagnostics: [],
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
  candidates: string[]
): Finding {
  return gateProblem(
    'conductor/gate-missing',
    role,
    product,
    `The "${role}" gate is enabled but no ${product} binary was found. ` +
      `Looked for: ${candidates.join(', ')}. Install it, point the gate at a build with an ` +
      `absolute "command:", or set enabled: false to switch the gate off on purpose.`,
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
  detail: string
): Finding {
  return gateProblem(
    'conductor/gate-output-unparseable',
    role,
    product,
    `The "${role}" gate ran but the umbrella could not read its output: ${detail} ` +
      'This is the umbrella being out of date with that gate, not a problem in your code. ' +
      'Nothing was verified by this gate.',
    { detail }
  );
}

/** The finding raised when a gate could not be run or did not complete. */
export function normalizeFailedGate(role: GateRole, product: Product, detail: string): Finding {
  return gateProblem(
    'conductor/gate-failed',
    role,
    product,
    `The "${role}" gate did not complete: ${detail} Nothing was verified by this gate.`,
    { detail }
  );
}
