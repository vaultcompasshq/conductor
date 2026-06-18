export const DRIFT_WEIGHTS = {
  scope_creep: 0.35,
  constraint_violation: 0.35,
  ac_divergence: 0.2,
  undocumented_pivot: 0.1,
} as const;

export const DRIFT_THRESHOLDS = {
  info: 26,
  warn: 51,
  soft_block: 71,
  hard_block: 86,
} as const;

export type DriftAction =
  | "proceed"
  | "info"
  | "warn"
  | "soft_block"
  | "hard_block";

export function driftAction(overall: number): DriftAction {
  if (overall >= DRIFT_THRESHOLDS.hard_block) return "hard_block";
  if (overall >= DRIFT_THRESHOLDS.soft_block) return "soft_block";
  if (overall >= DRIFT_THRESHOLDS.warn) return "warn";
  if (overall >= DRIFT_THRESHOLDS.info) return "info";
  return "proceed";
}
