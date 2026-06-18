import type { IntentContract } from "@vaultcompasshq/conductor-schema";
import { DRIFT_WEIGHTS, driftAction, type DriftAction } from "./rubric.js";

export interface DriftSignals {
  changedPaths?: string[];
  signals?: string[];
  userMessage?: string;
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

export function scoreDrift(
  contract: IntentContract,
  input: DriftSignals,
): DriftScore {
  const findings: string[] = [];
  const paths = input.changedPaths ?? [];

  let scopeCreep = 0;
  let constraintViolation = 0;
  let acDivergence = 0;
  let undocumentedPivot = 0;

  const outOfScopeHits = contract.out_of_scope.filter((item) => {
    const key = item.toLowerCase();
    if (key.includes("api") && paths.some((p) => API_PATH.test(p))) {
      findings.push(`New API path conflicts with out_of_scope: ${item}`);
      return true;
    }
    if (key.includes("websocket") && paths.some((p) => WEBSOCKET_PATH.test(p))) {
      findings.push(`WebSocket change conflicts with out_of_scope: ${item}`);
      return true;
    }
    if (
      (key.includes("stub") || key.includes("println")) &&
      paths.some((p) => NOTIFICATION_PATH.test(p))
    ) {
      findings.push(`Stub notification implementation conflicts with out_of_scope: ${item}`);
      return true;
    }
    if (key.includes("hardcoded") && paths.some((p) => SAFETY_SCORE_PATH.test(p))) {
      findings.push(`Hardcoded safety score conflicts with out_of_scope: ${item}`);
      return true;
    }
    return false;
  });
  if (outOfScopeHits.length > 0) scopeCreep = Math.min(100, outOfScopeHits.length * 40);

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

  return {
    overall,
    action: driftAction(overall),
    categories,
    findings,
  };
}
