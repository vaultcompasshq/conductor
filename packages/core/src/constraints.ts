import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Constraint, ConstraintSource } from "@vaultcompasshq/conductor-schema";

export const DEFAULT_CONSTRAINT_FILES: ConstraintSource[] = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
];

export interface LoadedConstraints {
  constraints: Constraint[];
  loadedFiles: string[];
}

function inferPriority(line: string): Constraint["priority"] {
  if (/\b(MUST NOT|NEVER|CRITICAL|DO NOT)\b/i.test(line)) return "critical";
  if (/\b(MUST|IMPORTANT|REQUIRED)\b/i.test(line)) return "high";
  if (/\b(should|prefer|avoid)\b/i.test(line)) return "medium";
  return "low";
}

function cleanRule(line: string): string {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\*\*/g, "")
    .trim();
}

// Normative language that marks a line as an actual rule, not prose/metadata.
const NORMATIVE =
  /\b(must not|must|never|do not|don't|dont|shall not|shall|always|required?|avoid|prefer|cannot|can't|should not|should|minimi[sz]e)\b/i;
// A leading prohibition like "No new API endpoints".
const LEADING_PROHIBITION = /^no\s+\w+/i;
// Headings under which bullet items are rules even without a keyword.
const RULE_HEADING =
  /\b(constraint|rule|boundar|guardrail|do not|must|principle|requirement|polic|invariant)/i;

const BULLET = /^([-*]\s+|\d+\.\s+)/;

function isRuleLine(
  rule: string,
  wasBullet: boolean,
  underRuleHeading: boolean,
): boolean {
  if (NORMATIVE.test(rule)) return true;
  if (LEADING_PROHIBITION.test(rule)) return true;
  if (underRuleHeading && wasBullet) return true;
  return false;
}

/**
 * Extract genuine rules from a markdown constraint file.
 *
 * Precision over recall: a line qualifies only if it uses normative language
 * (MUST/NEVER/should/avoid/prefer…), is a leading prohibition ("No new …"), or
 * is a bullet under a rules-style heading. This filters out doc prose, metadata
 * (tags, links, goals) and tables that the previous "any bullet line" heuristic
 * scraped as bogus constraints; see docs/validation/phase2-live-run.md finding #1.
 */
export function extractConstraintsFromMarkdown(
  content: string,
  source: ConstraintSource,
  filePath?: string,
): Constraint[] {
  const constraints: Constraint[] = [];
  const lines = content.split("\n");

  let inFence = false;
  let underRuleHeading = false;

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (line.startsWith("#")) {
      underRuleHeading = RULE_HEADING.test(line);
      continue;
    }

    if (line.length < 10 || line.length > 300) continue;
    if (line.startsWith("|")) continue; // table row
    if (line.startsWith(">")) continue; // blockquote
    if (/\bhttps?:\/\//i.test(line)) continue; // link/url-bearing prose

    const wasBullet = BULLET.test(line);
    const rule = cleanRule(line);
    if (rule.length < 10) continue;
    if (!isRuleLine(rule, wasBullet, underRuleHeading)) continue;

    constraints.push({
      source,
      rule,
      priority: inferPriority(line),
      file_path: filePath,
    });
  }

  return constraints.slice(0, 15);
}

export function loadCursorRules(projectRoot: string): LoadedConstraints {
  const rulesDir = join(projectRoot, ".cursor", "rules");
  const constraints: Constraint[] = [];
  const loadedFiles: string[] = [];

  if (!existsSync(rulesDir)) {
    return { constraints, loadedFiles };
  }

  for (const name of readdirSync(rulesDir)) {
    if (!name.endsWith(".mdc") && !name.endsWith(".md")) continue;
    const rel = join(".cursor/rules", name);
    const content = readFileSync(join(rulesDir, name), "utf8");
    loadedFiles.push(rel);
    constraints.push(
      ...extractConstraintsFromMarkdown(content, "cursor-rules", rel),
    );
  }

  return { constraints, loadedFiles };
}

export function loadAllConstraints(projectRoot: string): LoadedConstraints {
  const fromFiles = loadConstraintFiles(projectRoot);
  const fromRules = loadCursorRules(projectRoot);
  return {
    constraints: [...fromFiles.constraints, ...fromRules.constraints],
    loadedFiles: [...fromFiles.loadedFiles, ...fromRules.loadedFiles],
  };
}

export function loadConstraintFiles(projectRoot: string): LoadedConstraints {
  const constraints: Constraint[] = [];
  const loadedFiles: string[] = [];

  for (const filename of DEFAULT_CONSTRAINT_FILES) {
    const path = join(projectRoot, filename);
    if (!existsSync(path)) continue;
    loadedFiles.push(filename);
    const content = readFileSync(path, "utf8");
    constraints.push(...extractConstraintsFromMarkdown(content, filename, filename));
  }

  return { constraints, loadedFiles };
}

export function constraintRuleTexts(constraints: Constraint[]): string[] {
  return constraints.map((c) => c.rule);
}
