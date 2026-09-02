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

const BLOCKING_MISMATCH = 'compass/blocking-count-mismatch';
const THRESHOLD_UNKNOWN = 'compass/blocking-threshold-unknown';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

interface DepGuardFinding {
  ruleId: string;
  severity: string;
  packageName: string;
  message: string;
  manifestPath: string;
  lockfilePath?: string;
  fingerprint: string;
  details?: Record<string, unknown>;
}

export function normalizeDepGuard(raw: unknown, version: string | null): NormalizedGateOutput {
  if (!isRecord(raw) || !Array.isArray(raw.findings) || !isRecord(raw.run)) {
    throw new NormalizeError(
      'dep-guard output did not have the shape the umbrella knows (findings[] and run{}).'
    );
  }

  const run = raw.run as Record<string, unknown>;
  const threshold = typeof run.failOn === 'string' ? run.failOn : null;
  const diagnostics: Diagnostic[] = [];

  const findings: Finding[] = (raw.findings as DepGuardFinding[]).map((source) => ({
    schemaVersion: 1 as const,
    product: 'dep-guard',
    productVersion: version,
    ruleId: `dep-guard/${source.ruleId}`,
    // dep-guard's four levels are the shared ladder exactly, so this is
    // identity and nothing is derived.
    severity: source.severity as Severity,
    severityIsDerived: false,
    blocking: false,
    message: source.message,
    subject: {
      kind: 'package' as const,
      name: source.packageName,
      manifest: source.manifestPath,
      ...(source.lockfilePath === undefined ? {} : { lockfile: source.lockfilePath }),
    },
    fingerprint: {
      value: source.fingerprint,
      scope: 'dep-guard',
      // dep-guard hashes the rule id, the package name, the manifest path,
      // and the signal. Position-free, so an unrelated edit above a finding
      // does not mint a new one.
      stability: 'stable' as const,
    },
    details: source.details ?? {},
  }));

  reconcileBlocking(
    findings,
    typeof run.blockingMatches === 'number' ? run.blockingMatches : undefined,
    threshold,
    'dep-guard',
    diagnostics
  );

  return {
    findings,
    run: {
      failOn: threshold,
      suppressed: typeof raw.suppressed === 'number' ? raw.suppressed : 0,
      ignored: typeof raw.ignored === 'number' ? raw.ignored : 0,
      // Diagnostics never move dep-guard's own exit code, so they stay out
      // of findings[] here too rather than becoming pseudo-findings.
      diagnostics: (Array.isArray(run.diagnostics) ? run.diagnostics : []) as Diagnostic[],
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

interface VaultGuardMatch {
  type: string;
  severity: string;
  line: number;
  /** 0-based in the source JSON. */
  column: number;
  offset: number;
  value: string;
  fingerprint: string;
}

export function normalizeVaultGuard(raw: unknown, version: string | null): NormalizedGateOutput {
  if (!isRecord(raw) || !Array.isArray(raw.results)) {
    throw new NormalizeError(
      'vault-guard output did not have the shape the umbrella knows (results[]).'
    );
  }

  const run = isRecord(raw.run) ? raw.run : {};
  // run.blocking_matches, never summary.secrets. vault-guard's own type
  // documentation says integrators gating a build must read the former,
  // because the latter ignores the threshold. A sibling tool in this family
  // read summary.secrets and that is the bug not to copy.
  const threshold = typeof run.fail_on === 'string' ? run.fail_on : null;
  const diagnostics: Diagnostic[] = [];

  const findings: Finding[] = [];
  for (const entry of raw.results as Array<{ file: string; matches: VaultGuardMatch[] }>) {
    for (const match of entry.matches ?? []) {
      const known = ['critical', 'high', 'medium', 'low'].includes(match.severity);
      findings.push({
        schemaVersion: 1,
        product: 'vault-guard',
        productVersion: version,
        // `type` is an open vocabulary: a user's own extra_patterns choose
        // their own ids, which is exactly why the namespace is not optional.
        ruleId: `vault-guard/${match.type}`,
        // Unknown levels land on info rather than being passed through, so
        // a downstream consumer never sees a level outside the union. An
        // unrecognised level is the umbrella's guess, hence derived.
        severity: known ? (match.severity as Severity) : 'info',
        severityIsDerived: !known,
        blocking: false,
        // The JSON output carries no message at all. This is vault-guard's
        // own SARIF template, so the wording comes from the product rather
        // than from here.
        message: `Possible secret of type '${match.type}'`,
        subject: {
          kind: 'location',
          file: entry.file,
          line: match.line,
          // The JSON column is 0-based and the envelope's is 1-based. The
          // product's own SARIF does the same conversion; doing it here too
          // is what makes one shared mapping possible.
          column: match.column + 1,
          // No endColumn. The JSON output does not carry matchLength (only
          // the fingerprint's inputs use it), so the end of the match is
          // genuinely unknown from this output and is not guessed.
        },
        fingerprint: {
          value: match.fingerprint,
          scope: 'vault-guard',
          // Hashed over the relative path, the type, the line, the offset,
          // and the match length. Inserting an unrelated line above a
          // secret changes it, so a baseline entry expires on the next edit.
          stability: 'positional',
        },
        details: {
          type: match.type,
          severity: match.severity,
          line: match.line,
          column: match.column,
          offset: match.offset,
          // Already redacted at the source, so it is safe to carry.
          value: match.value,
        },
      });
    }
  }

  reconcileBlocking(
    findings,
    typeof run.blocking_matches === 'number' ? run.blocking_matches : undefined,
    threshold,
    'vault-guard',
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
      diagnostics: (Array.isArray(raw.diagnostics) ? raw.diagnostics : []).map(
        (diagnostic: unknown) => {
          const record = isRecord(diagnostic) ? diagnostic : {};
          return {
            code: String(record.code ?? 'unknown'),
            message: JSON.stringify(record.ctx ?? {}),
          };
        }
      ),
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

interface BudgetViolation {
  fingerprint: string;
  rule: string;
  severity: string;
  message: string;
  matched: string[];
}

interface DriftFinding {
  fingerprint: string;
  category: string;
  rule_id: string;
  message: string;
  matched: string[];
}

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

export function normalizeIntentGuard(raw: unknown, version: string | null): NormalizedGateOutput {
  if (!isRecord(raw) || (raw.status !== 'blocked' && raw.status !== 'ok')) {
    throw new NormalizeError(
      'intent-guard output did not have the shape the umbrella knows (status of "ok" or "blocked").'
    );
  }

  const findings: Finding[] = [];
  const budget = isRecord(raw.budget) ? raw.budget : undefined;
  const drift = isRecord(raw.drift) ? raw.drift : undefined;

  // Budget violations. The gate raises one reason per violation and blocks
  // when it has any reason at all, so every violation is blocking. That is
  // read off the gate's own composition rule, not off a severity ladder.
  for (const violation of (budget?.violations ?? []) as BudgetViolation[]) {
    findings.push({
      schemaVersion: 1,
      product: 'intent-guard',
      productVersion: version,
      ruleId: `intent-guard/budget.${violation.rule}`,
      severity: BUDGET_SEVERITY[violation.severity] ?? 'info',
      severityIsDerived: true,
      blocking: true,
      message: violation.message,
      subject: { kind: 'paths', paths: violation.matched ?? [] },
      fingerprint: {
        value: violation.fingerprint,
        scope: 'intent-guard',
        // Hashed over the contract id, the rule, and the sorted normalized
        // matched paths. Order-independent and position-free.
        stability: 'stable',
      },
      details: { rule: violation.rule, severity: violation.severity, matched: violation.matched },
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
  const driftAction = typeof drift?.action === 'string' ? drift.action : 'proceed';
  const driftBlocks = driftAction === 'soft_block' || driftAction === 'hard_block';

  for (const detail of (drift?.finding_details ?? []) as DriftFinding[]) {
    findings.push({
      schemaVersion: 1,
      product: 'intent-guard',
      productVersion: version,
      // The category, not rule_id: rule_id can carry contract prose, and a
      // rule id that contains a user's sentence is not a rule id. The full
      // value goes in details.
      ruleId: `intent-guard/drift.${detail.category}`,
      severity: DRIFT_SEVERITY[driftAction] ?? 'info',
      severityIsDerived: true,
      blocking: driftBlocks,
      message: detail.message,
      // No paths subject: `matched` here is "tokens or paths", so treating
      // it as a path list would sometimes point at a file that does not
      // exist. It stays in details, where it is not claiming to be a location.
      subject: { kind: 'contract', category: detail.category },
      fingerprint: { value: detail.fingerprint, scope: 'intent-guard', stability: 'stable' },
      details: { ruleId: detail.rule_id, category: detail.category, matched: detail.matched },
    });
  }

  // The gate can block for a reason that is neither a budget violation nor
  // drift: no contract, an unfrozen contract, an unreadable one. Those
  // arrive only as prose in `reasons`, so rather than parsing prose this
  // catches the case structurally: a blocked gate with nothing blocking in
  // the report would read as a bug in the umbrella, and would hide the one
  // thing the user needs to see.
  if (raw.status === 'blocked' && !findings.some((finding) => finding.blocking)) {
    const reasons = (Array.isArray(raw.reasons) ? raw.reasons : []) as string[];
    findings.push({
      schemaVersion: 1,
      product: 'intent-guard',
      productVersion: version,
      ruleId: 'intent-guard/gate-blocked',
      severity: 'critical',
      severityIsDerived: true,
      blocking: true,
      message:
        reasons.length > 0 ? reasons.join(' ') : 'The intent gate blocked without stating a reason.',
      subject: { kind: 'none' },
      // No fingerprint: the product mints none for a gate-state block, and
      // inventing one would produce an id no baseline anywhere contains.
      fingerprint: null,
      details: {
        reasons,
        contractFound: raw.contractFound ?? null,
        contractFrozen: raw.contractFrozen ?? null,
      },
    });
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
        contractFound: raw.contractFound ?? null,
        contractFrozen: raw.contractFrozen ?? null,
        driftOverall: typeof drift?.overall === 'number' ? drift.overall : null,
        driftAction,
        driftCategories: drift?.categories ?? null,
        budgetAction: budget?.action ?? null,
        reasons: raw.reasons ?? [],
      },
    },
    diagnostics: [],
  };
}

// -- the umbrella's own finding -------------------------------------------

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
  return {
    schemaVersion: 1,
    product: 'compass',
    productVersion: null,
    ruleId: 'compass/gate-missing',
    severity: 'critical',
    severityIsDerived: true,
    blocking: true,
    message:
      `The "${role}" gate is enabled but no ${product} binary was found. ` +
      `Looked for: ${candidates.join(', ')}. Install it, point the gate at a build with an ` +
      `absolute "command:", or set enabled: false to switch the gate off on purpose.`,
    subject: { kind: 'none' },
    fingerprint: {
      // Deterministic over the role and product so a repeat run is the same
      // alert rather than a new one every commit.
      value: createHash('sha256').update(`compass/gate-missing|${role}|${product}`).digest('hex'),
      scope: 'compass',
      stability: 'stable',
    },
    details: { role, product, candidates },
  };
}
