import type { IntentContract } from "@vaultcompasshq/conductor-schema";
import { readContract, isContractFrozen } from "./contract-store.js";
import { scoreDrift, type DriftSignals, type DriftScore } from "./drift.js";
import { loadConfig } from "./config.js";

export type GateStatus = "ok" | "blocked";

export interface GateResult {
  status: GateStatus;
  /** Process exit code: 0 when ok, 1 when blocked. */
  exitCode: 0 | 1;
  reasons: string[];
  contractFound: boolean;
  contractFrozen: boolean;
  drift?: DriftScore;
}

export interface CheckGateOptions {
  /** Require a frozen contract to exist (the hard gate). Default true. */
  requireFrozen?: boolean;
  /** Drift inputs; when paths/signals are present, drift is scored too. */
  signals?: DriftSignals;
}

/**
 * The single enforcement point. Unlike a SKILL.md instruction an agent may
 * ignore, this returns a non-zero exit code a pre-commit hook or CI step can
 * act on. Two independent gates:
 *
 *   1. A frozen Intent Contract must exist (intent fidelity has a baseline).
 *   2. Scored drift must not reach a blocking threshold.
 */
export function checkGate(
  projectRoot: string,
  options: CheckGateOptions = {},
): GateResult {
  const requireFrozen = options.requireFrozen ?? true;
  const config = loadConfig(projectRoot);
  const reasons: string[] = [];

  let contract: IntentContract | null = null;
  try {
    contract = readContract(projectRoot);
  } catch (err) {
    return {
      status: "blocked",
      exitCode: 1,
      reasons: [`Intent contract is invalid: ${(err as Error).message}`],
      contractFound: true,
      contractFrozen: false,
    };
  }

  const contractFound = contract !== null;
  const contractFrozen = contract !== null && isContractFrozen(contract);

  if (!contractFound) {
    if (requireFrozen) {
      reasons.push(
        "No .conductor/intent-contract.yaml found. Draft intent with conductor-extract, then approve with conductor-freeze before implementing.",
      );
    }
    return {
      status: requireFrozen ? "blocked" : "ok",
      exitCode: requireFrozen ? 1 : 0,
      reasons,
      contractFound,
      contractFrozen,
    };
  }

  if (requireFrozen && !contractFrozen) {
    reasons.push(
      "Intent contract exists but is not frozen by user. Approve and freeze before implementing.",
    );
  }

  let drift: DriftScore | undefined;
  const hasDriftInput =
    (options.signals?.changedPaths?.length ?? 0) > 0 ||
    (options.signals?.signals?.length ?? 0) > 0 ||
    !!options.signals?.userMessage;

  if (contract && hasDriftInput) {
    drift = scoreDrift(contract, options.signals ?? {}, {
      thresholds: config.drift.thresholds,
      hard_block_on_critical_constraints:
        config.drift.hard_block_on_critical_constraints,
    });
    if (drift.action === "soft_block" || drift.action === "hard_block") {
      reasons.push(
        `Drift ${drift.action} (score ${drift.overall}/100). Resolve drift or log an acknowledged pivot before continuing.`,
      );
    }
  }

  const blocked = reasons.length > 0;
  return {
    status: blocked ? "blocked" : "ok",
    exitCode: blocked ? 1 : 0,
    reasons,
    contractFound,
    contractFrozen,
    drift,
  };
}
