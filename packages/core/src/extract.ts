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
// end of input — except a '.' that closes a simple filename extension (e.g.
// ".ts.", ".yaml.") before the next sentence. Compound extensions (".test.ts.",
// ".spec.tsx.", ".d.ts.") still end the sentence at the final dot.
const SIMPLE_FILE_EXTENSION_SUFFIX = /\.\w{1,8}$/;
const COMPOUND_FILE_EXTENSION_SUFFIX = /\.[a-z0-9][\w-]*\.[a-z]{2,8}$/i;

function isFilenameExtensionPeriod(text: string, index: number): boolean {
  const before = text.slice(0, index);
  if (COMPOUND_FILE_EXTENSION_SUFFIX.test(before)) return false;
  return SIMPLE_FILE_EXTENSION_SUFFIX.test(before);
}

function isSentenceTerminatorAt(text: string, index: number): boolean {
  const ch = text[index];
  if (!/[.!?]/.test(ch)) return false;
  const rest = text.slice(index + 1);
  if (rest.length > 0 && !/^\s/.test(rest)) return false;
  if (ch === "." && isFilenameExtensionPeriod(text, index)) return false;
  return true;
}

function findFirstSentenceEnd(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (isSentenceTerminatorAt(text, i)) return i;
  }
  return -1;
}

function oneSentence(text: string, max = 500): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const boundary = findFirstSentenceEnd(normalized);
  const sentence = (boundary === -1
    ? normalized
    : normalized.slice(0, boundary + 1)
  ).trim();
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

// Split into sentence-like segments without breaking dotted file tokens or
// treating ".ts." / ".yaml." as a sentence boundary.
function splitSentences(text: string): string[] {
  const segments: string[] = [];

  for (const line of text.split(/\n+/)) {
    let start = 0;
    for (let i = 0; i < line.length; i++) {
      if (!isSentenceTerminatorAt(line, i)) continue;
      const chunk = line.slice(start, i + 1).trim();
      if (chunk) segments.push(chunk);
      start = i + 1;
      while (start < line.length && /\s/.test(line[start]!)) start++;
      i = start - 1;
    }
    const tail = line.slice(start).trim();
    if (tail) segments.push(tail);
  }

  return segments
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
  "extract",
  "fix",
  "generate",
  "hide",
  "implement",
  "include",
  "load",
  "persist",
  "preserve",
  "record",
  "redirect",
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
  /\b(do not|don't|must not|should not|shall not|cannot|can't|never|avoid|no\s+(?!\S*-)|without)\b/i;

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

/** True only when the clause *starts* as a prohibition (not embedded "no config"). */
function isLeadingProhibitionClause(text: string): boolean {
  const trimmed = text.trim();
  return /^(do not|don't|must not|should not|shall not|cannot|can't|never|avoid|no)\b/i.test(
    trimmed,
  );
}

interface ParsedClause {
  imperatives: string[];
  prohibitions: string[];
}

function splitColonActionClauses(text: string): string[] {
  const idx = text.indexOf(":");
  if (idx <= 0 || idx >= text.length - 5) return [text];
  const head = text.slice(0, idx).trim();
  const tail = text.slice(idx + 1).trim();
  if (!ACTION_RE.test(head) || tail.length < 8) return [text];
  const results = [head];
  if (ACTION_RE.test(tail) || /^(redirect|route|wire|update)\b/i.test(tail)) {
    results.push(normalizeItem(tail));
  }
  return results;
}

function splitImperativeFromProhibition(clause: string): ParsedClause {
  const imperatives: string[] = [];
  const prohibitions: string[] = [];
  const prohibitionMatch = clause.match(
    /\b(do not|don't|must not|should not|shall not|cannot|can't|never|avoid)\b/i,
  );

  if (!prohibitionMatch || prohibitionMatch.index === undefined) {
    if (isLeadingProhibitionClause(clause)) {
      prohibitions.push(normalizeItem(clause));
    } else {
      for (const part of splitColonActionClauses(clause)) {
        imperatives.push(normalizeItem(part));
      }
    }
    return { imperatives, prohibitions };
  }

  if (prohibitionMatch.index < 8) {
    prohibitions.push(normalizeItem(clause));
    return { imperatives, prohibitions };
  }

  const head = clause
    .slice(0, prohibitionMatch.index)
    .trim()
    .replace(/[,:;]\s*$/, "")
    .replace(/\s+so\s+users\s*$/i, "");
  const tail = clause.slice(prohibitionMatch.index).trim();

  if (head.length >= 5 && ACTION_RE.test(head) && !isProhibitionClause(head)) {
    for (const part of splitColonActionClauses(head)) {
      imperatives.push(normalizeItem(part));
    }
  }

  if (tail.length >= 5 && isValidOutOfScopeItem(tail)) {
    prohibitions.push(normalizeItem(tail));
  } else if (imperatives.length === 0 && isProhibitionClause(clause)) {
    prohibitions.push(normalizeItem(clause));
  }

  return { imperatives, prohibitions };
}

function parseActionClauses(text: string): ParsedClause {
  const imperatives: string[] = [];
  const prohibitions: string[] = [];
  const bullets = bulletItems(text);
  const sources = bullets.length > 0 ? bullets : textClauses(text);

  for (const raw of sources) {
    const parsed = splitImperativeFromProhibition(raw);
    imperatives.push(...parsed.imperatives);
    prohibitions.push(...parsed.prohibitions);
  }

  return { imperatives, prohibitions };
}

function expandProhibitionLists(text: string): string[] {
  const items: string[] = [];
  const pattern =
    /\b(do not|don't|must not|should not|shall not|cannot|can't|never|avoid|no)\s+([a-z]+)\s+([^.!?]{3,200})/gi;

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
  const { imperatives } = parseActionClauses(text);
  const bullets = bulletItems(text);

  if (bullets.length > 0) {
    return uniqueItems(
      imperatives.filter((item) => !isLeadingProhibitionClause(item)),
      12,
    );
  }

  const clauses = imperatives.filter(
    (c) => ACTION_RE.test(c) && !isLeadingProhibitionClause(c),
  );
  if (clauses.length > 0) return uniqueItems(clauses, 8);

  const fallback = oneSentence(text, 200);
  return fallback.length >= 5 ? [fallback] : ["Describe the requested change"];
}

function extractEmbeddedProhibitions(text: string): string[] {
  const { prohibitions } = parseActionClauses(text);
  return uniqueItems(prohibitions, 12);
}

function isValidOutOfScopeItem(item: string): boolean {
  const normalized = item.trim();
  if (/^without\b/i.test(normalized)) {
    return /^without\s+(approval|permission|changing|modifying|adding|removing|introducing|writing)\b/i.test(
      normalized,
    );
  }
  return /^(do not|don't|must not|should not|shall not|cannot|can't|never|avoid|no)\b/i.test(
    normalized,
  );
}

function extractOutOfScope(text: string): string[] {
  const tail = String.raw`[\w\s/.\-]{3,80}`;
  const patterns = [
    new RegExp(String.raw`\bdo\s+not\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bmust\s+not\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bshould\s+not\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bshall\s+not\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bcannot\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bcan't\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bnever\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bavoid\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bno\s+([a-z]${tail})`, "gi"),
    new RegExp(
      String.raw`\bwithout\s+(approval|permission|changing|modifying|adding|removing|introducing|writing)\s+([a-z]${tail})`,
      "gi",
    ),
  ];
  const items: string[] = [];
  items.push(...expandProhibitionLists(text));
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const item = match[0].trim().replace(/\s+/g, " ");
      if (item.length >= 5 && item.length <= 200 && isValidOutOfScopeItem(item)) {
        items.push(item);
      }
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

  const outOfScope = uniqueItems(
    [...extractOutOfScope(userText), ...extractEmbeddedProhibitions(userText)],
    12,
  ).filter((item, index, unique) => {
    const key = item.toLowerCase();
    return !unique.slice(0, index).some((previous) => previous.toLowerCase().includes(key));
  }).slice(0, 8);

  return {
    contract_id: generateContractId(),
    version: "1.0.0",
    original_ask: oneSentence(userText),
    in_scope: inScope,
    out_of_scope: outOfScope,
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
