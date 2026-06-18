export {
  COACH_PATTERNS,
  detectPatterns,
  type CoachPattern,
  type CoachPatternId,
} from "./coach-patterns.js";
export {
  coachMessage,
  narrowPrompt,
  scorePrompt,
  type PromptScore,
} from "./coach.js";
export { DRIFT_WEIGHTS, DRIFT_THRESHOLDS, driftAction } from "./rubric.js";
export { scoreDrift, type DriftScore, type DriftSignals } from "./drift.js";
