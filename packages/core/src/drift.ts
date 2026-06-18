import type { IntentContract } from "@vaultcompasshq/conductor-schema";
import { DRIFT_WEIGHTS, type DriftAction } from "./rubric.js";
import {
  driftActionForScore,
  type DriftThresholds,
} from "./config-types.js";

export interface DriftSignals {
  changedPaths?: string[];
  signals?: string[];
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

const API_PATH = /\/api\/|api\//i;
const WEBSOCKET_PATH = /websocket|useWebSocket|ws\./i;
const NOTIFICATION_PATH = /notification/i;
const SAFETY_SCORE_PATH = /safety_score/i;
const CLI_PATH = /packages\/cli|\/cli\//i;

function significantTokens(text: string): string[] {
  const blocklist = new Set([
    "packages",
    "phase",
    "index",
    "full",
    "binary",
    "changes",
    "workspace",
    "repos",
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !blocklist.has(w));
}

function pathMatchesTokens(path: string, tokens: string[]): boolean {
  const lower = path.toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

function matchOutOfScopeToPaths(
  outOfScope: string[],
  paths: string[],
  findings: string[],
): number {
  let hits = 0;

  for (const item of outOfScope) {
    const key = item.toLowerCase();
    let matched = false;

    if (key.includes("api") && paths.some((p) => API_PATH.test(p))) {
      findings.push(`New API path conflicts with out_of_scope: ${item}`);
      matched = true;
    }
    if (key.includes("websocket") && paths.some((p) => WEBSOCKET_PATH.test(p))) {
      findings.push(`WebSocket change conflicts with out_of_scope: ${item}`);
      matched = true;
    }
    if (
      (key.includes("stub") || key.includes("println")) &&
      paths.some((p) => NOTIFICATION_PATH.test(p))
    ) {
      findings.push(`Stub notification implementation conflicts with out_of_scope: ${item}`);
      matched = true;
    }
    if (key.includes("hardcoded") && paths.some((p) => SAFETY_SCORE_PATH.test(p))) {
      findings.push(`Hardcoded safety score conflicts with out_of_scope: ${item}`);
      matched = true;
    }
    if (key.includes("cli") && paths.some((p) => CLI_PATH.test(p))) {
      findings.push(`CLI path conflicts with out_of_scope: ${item}`);
      matched = true;
    }

    const tokens = significantTokens(item);
    if (!matched && tokens.length > 0 && paths.some((p) => pathMatchesTokens(p, tokens))) {
      findings.push(`Changed path matches out_of_scope keyword: ${item}`);
      matched = true;
    }

    if (matched) hits += 1;
  }

  return hits;
}

export function scoreDrift(
  contract: IntentContract,
  input: DriftSignals,
  options: ScoreDriftOptions = {},
): DriftScore {
  const findings: string[] = [];
  const paths = input.changedPaths ?? [];
  const thresholds = options.thresholds;
  const hardBlockCritical = options.hard_block_on_critical_constraints ?? true;

  let scopeCreep = 0;
  let constraintViolation = 0;
  let acDivergence = 0;
  let undocumentedPivot = 0;

  const outOfScopeHits = matchOutOfScopeToPaths(
    contract.out_of_scope,
    paths,
    findings,
  );
  if (outOfScopeHits > 0) scopeCreep = Math.min(100, outOfScopeHits * 40);

  const cliConflict =
    paths.some((p) => CLI_PATH.test(p)) &&
    contract.out_of_scope.some((item) => /cli/i.test(item));
  if (cliConflict) {
    scopeCreep = Math.max(scopeCreep, 100);
    acDivergence = Math.max(acDivergence, 80);
    if (!findings.some((f) => /CLI/i.test(f))) {
      findings.push("CLI work conflicts with contract out_of_scope");
    }
  }

  const hasApi = paths.some((p) => API_PATH.test(p));
  const criticalNoApi = contract.constraints.some(
    (c) => c.priority === "critical" && /no new api/i.test(c.rule),
  );
  if (hasApi && criticalNoApi) {
    constraintViolation = 90;
    findings.push("Critical constraint violated: no new API endpoints");
  }

  if (input.signals?.includes("websocket_added")) {
    scopeCreep = Math.max(scopeCreep, 80);
  }

  if (input.signals?.includes("stub_println_notification")) {
    scopeCreep = Math.min(100, scopeCreep + 40);
    findings.push("Stub println notification signal conflicts with contract scope");
    const criticalNoStub = contract.constraints.some(
      (c) => c.priority === "critical" && /not stubbed|functional/i.test(c.rule),
    );
    if (criticalNoStub) {
      constraintViolation = Math.max(constraintViolation, 90);
      findings.push("Critical constraint violated: features must be functional, not stubbed");
    }
  }

  if (input.signals?.includes("hardcoded_safety_score")) {
    scopeCreep = Math.min(100, scopeCreep + 40);
    findings.push("Hardcoded safety score signal conflicts with contract scope");
    acDivergence = Math.max(acDivergence, 80);
    findings.push("Hardcoded safety score diverges from acceptance criteria");
  }

  if (input.signals?.includes("new_api_route")) {
    acDivergence = Math.max(acDivergence, 80);
    findings.push("New API route signal diverges from contract acceptance criteria");
  }

  if (
    input.userMessage &&
    /\b(actually|also|while we're at it)\b/i.test(input.userMessage) &&
    contract.pivot_log.every((p) => p.acknowledged_by !== "user")
  ) {
    undocumentedPivot = 70;
    findings.push("User message suggests pivot without pivot_log entry");
  }

  const categories = {
    scope_creep: scopeCreep,
    constraint_violation: constraintViolation,
    ac_divergence: acDivergence,
    undocumented_pivot: undocumentedPivot,
  };

  const overall = Math.round(
    categories.scope_creep * DRIFT_WEIGHTS.scope_creep +
      categories.constraint_violation * DRIFT_WEIGHTS.constraint_violation +
      categories.ac_divergence * DRIFT_WEIGHTS.ac_divergence +
      categories.undocumented_pivot * DRIFT_WEIGHTS.undocumented_pivot,
  );

  const bumpedOverall =
    cliConflict
      ? Math.max(overall, thresholds?.soft_block ?? 71)
      : overall;

  let action: DriftAction = thresholds
    ? driftActionForScore(bumpedOverall, thresholds)
    : driftActionForScore(bumpedOverall, {
        info: 26,
        warn: 51,
        soft_block: 71,
        hard_block: 86,
      });

  if (
    hardBlockCritical &&
    constraintViolation >= 90 &&
    bumpedOverall >= (thresholds?.hard_block ?? 86)
  ) {
    action = "hard_block";
  }

  return {
    overall: bumpedOverall,
    action,
    categories,
    findings,
  };
}
