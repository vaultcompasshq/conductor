import type {
  AcceptanceCriterion,
  Constraint,
  IntentContract,
} from "@vaultcompasshq/conductor-schema";
import { scorePrompt } from "./coach.js";
import { constraintRuleTexts } from "./constraints.js";

export interface DraftContractInput {
  userText: string;
  constraints?: Constraint[];
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0").slice(0, 6);
}

export function generateContractId(date = new Date()): string {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `ic-${ymd}-${randomSuffix()}`;
}

function oneSentence(text: string, max = 500): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^[^.!?]+[.!?]?/);
  const sentence = (match?.[0] ?? normalized).trim();
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

function bulletItems(text: string): string[] {
  const fromBullets = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").trim())
    .filter((l) => l.length >= 5 && l.length <= 200);
  if (fromBullets.length > 0) return fromBullets.slice(0, 12);
  return [];
}

function extractInScope(text: string): string[] {
  const bullets = bulletItems(text);
  if (bullets.length > 0) return bullets;

  const clauses = text
    .split(/[.!?]+/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 5 && c.length <= 200)
    .filter((c) =>
      /\b(add|export|implement|build|create|fix|update|show|enable)\b/i.test(c),
    );
  if (clauses.length > 0) return clauses.slice(0, 6);

  const fallback = oneSentence(text, 200);
  return fallback.length >= 5 ? [fallback] : ["Describe the requested change"];
}

function extractOutOfScope(text: string): string[] {
  const patterns = [
    /\bno\s+([a-z][\w\s-]{3,80})/gi,
    /\bnot\s+([a-z][\w\s-]{3,80})/gi,
    /\bwithout\s+([a-z][\w\s-]{3,80})/gi,
  ];
  const items: string[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const item = match[0].trim().replace(/\s+/g, " ");
      if (item.length >= 5 && item.length <= 200) items.push(item);
    }
  }
  return items.slice(0, 8);
}

function extractAcceptanceCriteria(
  text: string,
  inScope: string[],
): AcceptanceCriterion[] {
  const criteria: AcceptanceCriterion[] = [];
  const lines = text.split("\n").map((l) => l.trim());

  for (const line of lines) {
    if (
      /\b(verify|test|should|must|when|done when|acceptance)\b/i.test(line) &&
      line.length >= 10
    ) {
      const description = line.replace(/^[-*]\s+/, "").trim();
      if (description.length <= 200) {
        criteria.push({
          id: `ac-${criteria.length + 1}`,
          description,
          testable: true,
        });
      }
    }
  }

  if (criteria.length > 0) return criteria.slice(0, 15);

  const defaults = inScope.slice(0, 2).map((item, i) => ({
    id: `ac-${i + 1}`,
    description: `Verify: ${item}`,
    testable: true,
  }));

  if (defaults.length === 0) {
    defaults.push({
      id: "ac-1",
      description: "User can complete the described workflow without errors",
      testable: true,
    });
  }

  return defaults;
}

export function draftContract(input: DraftContractInput): IntentContract {
  const { userText, constraints = [] } = input;
  const ruleTexts = constraintRuleTexts(constraints);
  const inScope = extractInScope(userText);
  const promptQuality = scorePrompt(userText, {
    constraints: ruleTexts,
    hasAcceptanceCriteria: /\b(verify|test|should|must|done)\b/i.test(userText),
  });

  return {
    contract_id: generateContractId(),
    version: "1.0.0",
    original_ask: oneSentence(userText),
    in_scope: inScope,
    out_of_scope: extractOutOfScope(userText),
    constraints,
    acceptance_criteria: extractAcceptanceCriteria(userText, inScope),
    frozen_at: new Date().toISOString(),
    prompt_quality: {
      score: promptQuality.score,
      issues: promptQuality.issues,
      coaching_shown: promptQuality.score < 60,
    },
    pivot_log: [],
  };
}
