import {
  COACH_PATTERNS,
  detectPatterns,
  type CoachPatternId,
} from "./coach-patterns.js";

export interface PromptScore {
  score: number;
  issues: CoachPatternId[];
}

export function scorePrompt(
  text: string,
  context?: { constraints?: string[]; hasAcceptanceCriteria?: boolean },
): PromptScore {
  const issues = detectPatterns(text, context);
  let score = 100;
  score -= Math.min(issues.length * 15, 60);
  if (text.trim().length < 20) score -= 10;
  if (context?.hasAcceptanceCriteria) score += 5;
  return { score: Math.max(0, Math.min(100, score)), issues };
}

export function coachMessage(
  scored: PromptScore,
  originalText: string,
): string {
  if (scored.score >= 60 && scored.issues.length === 0) {
    return "";
  }
  const lines = COACH_PATTERNS.filter((p) => scored.issues.includes(p.id)).map(
    (p) => `- ${p.id}: ${p.coaching}`,
  );
  return [
    "**Prompt variance warning**",
    ...lines,
    "",
    "**Suggested rewrite:**",
    narrowPrompt(originalText),
  ].join("\n");
}

export function narrowPrompt(text: string): string {
  const stripped = text
    .replace(/\b(just|quickly|simply)\b/gi, "")
    .replace(/\blike\s+\w+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 10
    ? `"${stripped}. State explicit boundaries and how to verify done."`
    : '"Describe one feature, client-side scope, and testable done criteria."';
}
