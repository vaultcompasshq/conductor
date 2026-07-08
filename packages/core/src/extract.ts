import type {
  AcceptanceCriterion,
  Constraint,
  IntentContract,
} from "@vaultcompass/conductor-schema";
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

// A '.', '!' or '?' terminates a sentence only when followed by whitespace or
// end of input. This keeps dotted tokens like ".yml", ".githooks", or
// "config.yaml" intact instead of shredding them into nonsense fragments.
const SENTENCE_TERMINATOR = /[.!?](?=\s|$)/;
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

function oneSentence(text: string, max = 500): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const boundary = normalized.search(SENTENCE_TERMINATOR);
  const sentence = (boundary === -1
    ? normalized
    : normalized.slice(0, boundary + 1)
  ).trim();
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

// Split into sentence-like segments without breaking dotted file tokens.
// Newlines and semicolons always separate clauses; periods/!/? only when
// they are real sentence boundaries (followed by whitespace or EOL).
function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(SENTENCE_BOUNDARY))
    .flatMap((chunk) => chunk.split(";"))
    .map((segment) => segment.trim())
    .filter(Boolean);
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

const ACTION_VERBS = [
  "add",
  "archive",
  "block",
  "build",
  "compare",
  "create",
  "detect",
  "display",
  "enable",
  "enforce",
  "export",
  "fix",
  "generate",
  "hide",
  "implement",
  "include",
  "load",
  "persist",
  "preserve",
  "record",
  "regenerate",
  "render",
  "show",
  "support",
  "update",
  "use",
  "validate",
  "wire",
];

const ACTION_RE = new RegExp(`\\b(${ACTION_VERBS.join("|")})\\b`, "i");
const ACTION_START_RE = new RegExp(
  `\\b(?:and|then|also|plus)?\\s*(${ACTION_VERBS.join("|")})\\b`,
  "i",
);
const PROHIBITION_RE =
  /\b(do not|don't|must not|should not|cannot|can't|never|avoid|no|not|without)\b/i;

function normalizeItem(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[-*]\s+/, "")
    .replace(/^(and|then|also|plus)\s+/i, "")
    .trim()
    .replace(/[,:;.\s]+$/, "");
}

function uniqueItems(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = normalizeItem(raw);
    const key = item.toLowerCase();
    if (item.length < 5 || item.length > 200 || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function textClauses(text: string): string[] {
  return splitSentences(text)
    .flatMap((segment) =>
      segment.split(
        new RegExp(
          `\\s+(?:and|then|also|plus)\\s+(?=(?:${ACTION_VERBS.join("|")})\\b)`,
          "i",
        ),
      ),
    )
    .map(normalizeItem)
    .filter(Boolean);
}

function isProhibitionClause(text: string): boolean {
  return PROHIBITION_RE.test(text);
}

function expandProhibitionLists(text: string): string[] {
  const items: string[] = [];
  const pattern =
    /\b(do not|don't|must not|should not|cannot|can't|never|avoid|no)\s+([a-z]+)\s+([^.!?]{3,200})/gi;

  for (const match of text.matchAll(pattern)) {
    const prefix = match[1].replace(/\s+/g, " ");
    const verb = match[2];
    const rest = match[3];
    if (!rest.includes(",")) continue;

    for (const part of rest.split(",")) {
      const target = normalizeItem(part.trim().replace(/^(and|or)\s+/i, ""));
      if (target.length < 5) continue;
      items.push(`${prefix} ${verb} ${target}`);
    }
  }

  return items;
}

function extractInScope(text: string): string[] {
  const bullets = bulletItems(text);
  if (bullets.length > 0) {
    return uniqueItems(
      bullets.filter((item) => !isProhibitionClause(item)),
      12,
    );
  }

  const clauses = textClauses(text).filter(
    (c) => ACTION_RE.test(c) && !isProhibitionClause(c),
  );
  if (clauses.length > 0) return uniqueItems(clauses, 6);

  const fallback = oneSentence(text, 200);
  return fallback.length >= 5 ? [fallback] : ["Describe the requested change"];
}

function extractOutOfScope(text: string): string[] {
  const patterns = [
    /\bdo\s+not\s+([a-z][\w\s-]{3,80})/gi,
    /\bmust\s+not\s+([a-z][\w\s-]{3,80})/gi,
    /\bshould\s+not\s+([a-z][\w\s-]{3,80})/gi,
    /\bcannot\s+([a-z][\w\s-]{3,80})/gi,
    /\bcan't\s+([a-z][\w\s-]{3,80})/gi,
    /\bnever\s+([a-z][\w\s-]{3,80})/gi,
    /\bavoid\s+([a-z][\w\s-]{3,80})/gi,
    /\bno\s+([a-z][\w\s-]{3,80})/gi,
    /\bnot\s+([a-z][\w\s-]{3,80})/gi,
    /\bwithout\s+([a-z][\w\s-]{3,80})/gi,
  ];
  const items: string[] = [];
  items.push(...expandProhibitionLists(text));
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const item = match[0].trim().replace(/\s+/g, " ");
      if (item.length >= 5 && item.length <= 200) items.push(item);
    }
  }
  const unique = uniqueItems(items, 12);
  return unique
    .filter((item, index) => {
      const key = item.toLowerCase();
      return !unique
        .slice(0, index)
        .some((previous) => previous.toLowerCase().includes(key));
    })
    .slice(0, 8);
}

function extractAcceptanceCriteria(
  text: string,
  inScope: string[],
): AcceptanceCriterion[] {
  const criteria: AcceptanceCriterion[] = [];
  const clauses = textClauses(text);

  for (const clause of clauses) {
    if (
      /\b(verify|test|should|must|when|done when|acceptance)\b/i.test(clause) &&
      clause.length >= 10
    ) {
      const description = normalizeItem(
        clause.replace(/^done when\s+/i, "").replace(/^acceptance:\s*/i, ""),
      );
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

  const defaults = inScope.slice(0, 4).map((item, i) => ({
    id: `ac-${i + 1}`,
    description: ACTION_START_RE.test(item)
      ? `Verify ${item}`
      : `Verify: ${item}`,
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
