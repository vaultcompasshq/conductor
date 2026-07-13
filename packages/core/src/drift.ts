import type { IntentContract } from "@vaultcompass/conductor-schema";
import { DRIFT_WEIGHTS, type DriftAction } from "./rubric.js";
import {
  driftActionForScore,
  type DriftThresholds,
} from "./config-types.js";
import {
  discriminatingTokens,
  hasSignificantConstraintMatch,
  intersectingTokens,
  outOfScopeTouch,
  pathSegmentTokens,
  tokenize,
} from "./tokenize.js";

export interface DriftSignals {
  /** Changed file paths since the last check (from git diff or session). */
  changedPaths?: string[];
  /**
   * Open-vocabulary signal phrases describing what the work did, e.g.
   * "new api route", "stubbed notification", "added websocket client".
   * Any descriptive text works — it is tokenized and matched, not enumerated.
   */
  signals?: string[];
  /** Latest user message, used to detect undocumented pivots. */
  userMessage?: string;
}

export interface ScoreDriftOptions {
  thresholds?: DriftThresholds;
  hard_block_on_critical_constraints?: boolean;
}

export interface DriftScore {
  overall: number;
  action: DriftAction;
  categories: {
    scope_creep: number;
    constraint_violation: number;
    ac_divergence: number;
    undocumented_pivot: number;
  };
  findings: string[];
}

export interface CrossSessionDriftScore {
  previous_contract_id: string;
  current_contract_id: string;
  previous: DriftScore;
  current: DriftScore;
  findings: string[];
}

const DEFAULT_THRESHOLDS: DriftThresholds = {
  info: 26,
  warn: 51,
  soft_block: 71,
  hard_block: 86,
};

const PRIORITY_SEVERITY: Record<string, number> = {
  critical: 90,
  high: 60,
  medium: 35,
  low: 15,
};

const PIVOT_PHRASES = /\b(actually|also|while we're at it|and another thing)\b/i;

function pathSemanticTokens(path: string): string[] {
  const normalized = path.toLowerCase();
  const tokens: string[] = [];

  if (/(^|\/)(src|lib|app|server|client|packages?)\//.test(normalized)) {
    tokens.push("source");
  }
  if (/(^|\/)(readme|docs?|documentation)(\/|\.|$)/.test(normalized)) {
    tokens.push("readme", "documentation");
  }
  if (
    /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|cargo\.toml|cargo\.lock|go\.mod|go\.sum|pyproject\.toml|requirements\.txt|poetry\.lock|gemfile|gemfile\.lock|composer\.json|pom\.xml|build\.gradle|gradle\.lockfile)(\/|$)?/.test(
      normalized,
    )
  ) {
    tokens.push("metadata", "dependency", "manifest");
  }
  if (/(^|\/)(api|routes?|controllers?|server)(\/|\.|$)/.test(normalized)) {
    tokens.push("api", "endpoint");
  }
  if (/(^|\/)(tests?|specs?|__tests__)(\/|\.|$)/.test(normalized)) {
    tokens.push("test");
  }

  return tokens;
}

/** Union of tokens describing what the work touched (paths + signals). */
function targetTokens(input: DriftSignals): { all: Set<string>; pathSegs: Set<string> } {
  const all = new Set<string>();
  const pathSegs = new Set<string>();
  for (const path of input.changedPaths ?? []) {
    for (const t of tokenize(path)) all.add(t);
    for (const t of pathSemanticTokens(path)) all.add(t);
    for (const t of pathSegmentTokens(path)) {
      all.add(t);
      pathSegs.add(t);
    }
  }
  for (const signal of input.signals ?? []) {
    for (const t of tokenize(signal)) all.add(t);
  }
  return { all, pathSegs };
}

/** Tokens describing the agreed work — used to subtract non-discriminating tokens. */
function scopeTokens(contract: IntentContract): Set<string> {
  const all = new Set<string>();
  for (const item of [...contract.in_scope, contract.original_ask]) {
    for (const t of tokenize(item)) all.add(t);
  }
  return all;
}

export function scoreDrift(
  contract: IntentContract,
  input: DriftSignals,
  options: ScoreDriftOptions = {},
): DriftScore {
  const findings: string[] = [];
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const hardBlockCritical = options.hard_block_on_critical_constraints ?? true;

  const { all: target, pathSegs } = targetTokens(input);
  const scope = scopeTokens(contract);

  // ── Scope creep: work touching explicitly out-of-scope territory ──────────
  let scopeHits = 0;
  let touchedAcWhileOutOfScope = 0;
  const acTokenSets = contract.acceptance_criteria.map((ac) =>
    tokenize(ac.description),
  );

  for (const item of contract.out_of_scope) {
    const discriminating = discriminatingTokens(item, scope);
    if (discriminating.size === 0) continue;
    const matched = outOfScopeTouch(discriminating, target, pathSegs);
    if (matched.length > 0) {
      scopeHits += 1;
      findings.push(
        `Out-of-scope touched: "${item}" (matched: ${matched.join(", ")})`,
      );
      // If the out-of-scope work also overlaps an acceptance criterion, the
      // delivered behavior is diverging from what "done" was defined to mean.
      if (
        acTokenSets.some((ac) => intersectingTokens(discriminating, ac).length > 0)
      ) {
        touchedAcWhileOutOfScope += 1;
      }
    }
  }
  const scopeCreep = Math.min(100, scopeHits * 40);

  // ── Constraint violations: prohibitive rules whose subject was touched ────
  let constraintViolation = 0;
  let criticalViolated = false;
  for (const c of contract.constraints) {
    const discriminating = discriminatingTokens(c.rule, scope);
    if (discriminating.size === 0) continue;
    const matched = intersectingTokens(discriminating, target);
    if (matched.length === 0) continue;
    if (!hasSignificantConstraintMatch(matched)) continue;
    const severity = PRIORITY_SEVERITY[c.priority] ?? PRIORITY_SEVERITY.low;
    if (severity > constraintViolation) constraintViolation = severity;
    if (c.priority === "critical") criticalViolated = true;
    findings.push(
      `${c.priority} constraint at risk: "${c.rule}" (matched: ${matched.join(", ")})`,
    );
  }

  // ── Acceptance-criteria divergence ────────────────────────────────────────
  const acDivergence = Math.min(100, touchedAcWhileOutOfScope * 80);
  if (acDivergence > 0) {
    findings.push("Out-of-scope change overlaps defined acceptance criteria");
  }

  // ── Undocumented pivot: user signalled a scope change, not logged ─────────
  let undocumentedPivot = 0;
  if (
    input.userMessage &&
    PIVOT_PHRASES.test(input.userMessage) &&
    contract.pivot_log.every((p) => p.acknowledged_by !== "user")
  ) {
    undocumentedPivot = 70;
    findings.push("User message suggests a pivot with no acknowledged pivot_log entry");
  }

  const categories = {
    scope_creep: scopeCreep,
    constraint_violation: constraintViolation,
    ac_divergence: acDivergence,
    undocumented_pivot: undocumentedPivot,
  };

  const weighted = Math.round(
    categories.scope_creep * DRIFT_WEIGHTS.scope_creep +
      categories.constraint_violation * DRIFT_WEIGHTS.constraint_violation +
      categories.ac_divergence * DRIFT_WEIGHTS.ac_divergence +
      categories.undocumented_pivot * DRIFT_WEIGHTS.undocumented_pivot,
  );

  // A weighted average dilutes a single severe signal below any block
  // threshold. Floor the score so that touching out-of-scope territory or a
  // high/critical constraint is enough to pause on its own.
  let floor = 0;
  if (scopeHits >= 1) floor = Math.max(floor, thresholds.soft_block);
  if (constraintViolation >= PRIORITY_SEVERITY.critical) {
    floor = Math.max(floor, thresholds.soft_block);
  } else if (constraintViolation >= PRIORITY_SEVERITY.high) {
    floor = Math.max(floor, thresholds.warn);
  }

  const overall = Math.min(100, Math.max(weighted, floor));
  let action = driftActionForScore(overall, thresholds);

  if (hardBlockCritical && criticalViolated && overall >= thresholds.hard_block) {
    action = "hard_block";
  }

  return { overall, action, categories, findings };
}

export function crossSessionDrift(
  previousContract: IntentContract,
  currentContract: IntentContract,
  input: DriftSignals,
  options: ScoreDriftOptions = {},
): CrossSessionDriftScore {
  const previous = scoreDrift(previousContract, input, options);
  const current = scoreDrift(currentContract, input, options);
  const findings = previous.findings.map(
    (finding) =>
      `Prior contract ${previousContract.contract_id}: ${finding}`,
  );

  if (previous.overall > current.overall) {
    findings.push(
      `Current contract ${currentContract.contract_id} is more aligned (${current.overall}/100) than prior contract ${previousContract.contract_id} (${previous.overall}/100).`,
    );
  }

  return {
    previous_contract_id: previousContract.contract_id,
    current_contract_id: currentContract.contract_id,
    previous,
    current,
    findings,
  };
}
