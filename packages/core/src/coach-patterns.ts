export type CoachPatternId =
  | "product_stack"
  | "comparative_overload"
  | "scope_adverb"
  | "implicit_pivot"
  | "authority_without_spec"
  | "constraint_conflict"
  | "vague_ask"
  | "missing_acceptance_criteria";

export interface CoachPattern {
  id: CoachPatternId;
  detect: (text: string, context?: { constraints?: string[] }) => boolean;
  coaching: string;
}

// Illustrative public SaaS names only — used to detect "like Notion + Figma"
// comparative overload. Not a portfolio/product catalog; keep this list short.
const PUBLIC_SAAS_EXEMPLARS =
  /\b(notion|figma|linear|slack|airtable|jira|github|vercel|supabase)\b/i;

const FEATURE_STACK =
  /\b(export\w*|import\w*|sharing|share\w*|pdf\w*|sync\w*|collaborat\w*|upload\w*|download\w*)\b/i;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export const COACH_PATTERNS: CoachPattern[] = [
  {
    id: "product_stack",
    detect: (text) => {
      const matches =
        text.match(new RegExp(PUBLIC_SAAS_EXEMPLARS.source, "gi")) ?? [];
      if (matches.length >= 2) return true;
      if (matches.length >= 1 && /\blike\b/i.test(text)) {
        const features = text.match(new RegExp(FEATURE_STACK.source, "gi")) ?? [];
        return features.length >= 2;
      }
      return false;
    },
    coaching:
      "Multiple tool or product references imply multiple architectures. Pick one workflow.",
  },
  {
    id: "comparative_overload",
    detect: (text) => (text.match(/\blike\s+\w+/gi) ?? []).length > 2,
    coaching:
      "Too many comparators create conflicting frames. Describe without 'like X'.",
  },
  {
    id: "scope_adverb",
    detect: (text) => {
      if (wordCount(text) <= 8) return false;
      if (/\b(just|quickly|simply)\b/i.test(text)) return true;
      return /\bonly\b/i.test(text) && !/\b[\w-]+\s+only\b/i.test(text);
    },
    coaching:
      "Minimizers ('just', 'quickly') cause models to skip edge cases and tests.",
  },
  {
    id: "implicit_pivot",
    detect: (text) =>
      /\b(actually|also|while we're at it|and another thing)\b/i.test(text),
    coaching:
      "Scope change detected. Log a pivot in the contract before continuing.",
  },
  {
    id: "authority_without_spec",
    detect: (text) =>
      /\b(you know|the usual|standard approach|obviously)\b/i.test(text),
    coaching:
      "State explicit requirements instead of assuming shared context.",
  },
  {
    id: "vague_ask",
    detect: (text) => text.trim().length < 20,
    coaching:
      "Ask is too short. Include: what, for whom, and how to verify done.",
  },
  {
    id: "constraint_conflict",
    detect: (text, context) => {
      if (!context?.constraints?.length) return false;
      const lower = text.toLowerCase();
      return (
        /\b(refactor everything|rewrite|redesign)\b/i.test(lower) &&
        context.constraints.some((c) =>
          /no major redesign|minimize scope/i.test(c),
        )
      );
    },
    coaching: "This request conflicts with a loaded project constraint.",
  },
  {
    id: "missing_acceptance_criteria",
    detect: (text) => {
      if (
        /\b(should|must|when|verify|test|acceptance|done when)\b/i.test(text)
      ) {
        return false;
      }
      if (
        /\b(client-side|server-side)\b/i.test(text) &&
        /\bno\s+[\w.]+\b/i.test(text)
      ) {
        return false;
      }
      return wordCount(text) >= 6;
    },
    coaching:
      "Add testable acceptance criteria: what does 'done' look like?",
  },
];

export function detectPatterns(
  text: string,
  context?: { constraints?: string[] },
): CoachPatternId[] {
  return COACH_PATTERNS.filter((p) => p.detect(text, context)).map((p) => p.id);
}
