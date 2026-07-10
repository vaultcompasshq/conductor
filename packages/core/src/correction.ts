import type {
  Constraint,
  CorrectionLogEntry,
  IntentContract,
} from "@vaultcompass/conductor-schema";
import {
  briefCorrections,
  type BriefCorrectionOptions,
} from "./correction-brief.js";

export interface AddCorrectionInput {
  /** What the agent did that was wrong. */
  wrong: string;
  /** The corrected approach to use instead. */
  right: string;
  /** Normalized negative rule capturing the lesson. */
  rule: string;
  /** User-confirmed (authoritative) vs agent-proposed (pending). Default pending. */
  acknowledged?: boolean;
  /**
   * Promote the lesson into constraints[] so the drift scorer enforces it.
   * Off by default (Phase 3a): a correction must be acknowledged AND explicitly
   * promoted. Promotion of an unacknowledged correction is ignored.
   */
  promote?: boolean;
  /** Priority for the promoted constraint. Default high. */
  priority?: Constraint["priority"];
}

function nextCorrectionId(contract: IntentContract): string {
  const n = (contract.correction_log?.length ?? 0) + 1;
  return `cl-${n}`;
}

/**
 * Append a correction to the contract, returning a new contract. Pure — does
 * not write to disk. When acknowledged + promote, also mirrors the lesson into
 * constraints[] as a `user-correction` rule so re-violations score as drift.
 */
export function addCorrection(
  contract: IntentContract,
  input: AddCorrectionInput,
): IntentContract {
  const acknowledged = input.acknowledged ?? false;
  const promote = (input.promote ?? false) && acknowledged;

  const entry: CorrectionLogEntry = {
    id: nextCorrectionId(contract),
    timestamp: new Date().toISOString(),
    wrong: input.wrong,
    right: input.right,
    rule: input.rule,
    acknowledged_by: acknowledged ? "user" : "pending",
    promoted_to_constraint: promote,
  };

  const constraints = promote
    ? [
        ...contract.constraints,
        {
          source: "user-correction" as const,
          rule: input.rule,
          priority: input.priority ?? "high",
        },
      ]
    : contract.constraints;

  return {
    ...contract,
    constraints,
    correction_log: [...(contract.correction_log ?? []), entry],
  };
}

/** Acknowledged corrections only — the authoritative lessons. */
export function acknowledgedCorrections(
  contract: IntentContract,
): CorrectionLogEntry[] {
  return (contract.correction_log ?? []).filter(
    (c) => c.acknowledged_by === "user",
  );
}

/**
 * Acknowledged corrections trimmed for brief/index surfaces: deduped, age-filtered,
 * capped. Full correction_log on the contract is unchanged.
 */
export function briefAcknowledgedCorrections(
  contract: IntentContract,
  options?: BriefCorrectionOptions,
): CorrectionLogEntry[] {
  return briefCorrections(acknowledgedCorrections(contract), options);
}

export type { BriefCorrectionOptions } from "./correction-brief.js";
export {
  briefCorrections,
  DEFAULT_BRIEF_CORRECTION_MAX,
  DEFAULT_BRIEF_CORRECTION_MAX_AGE_DAYS,
  CORRECTION_RULE_DEDUPE_THRESHOLD,
} from "./correction-brief.js";
