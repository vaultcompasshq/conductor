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

export function extractConstraintsFromMarkdown(
  content: string,
  source: ConstraintSource,
  filePath?: string,
): Constraint[] {
  const constraints: Constraint[] = [];
  const lines = content.split("\n");

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length < 10 || line.length > 300) continue;
    if (line.startsWith("#")) continue;
    if (!/^[-*]|\d+\.|MUST|NEVER|IMPORTANT|CRITICAL/i.test(line)) continue;

    const rule = cleanRule(line);
    if (rule.length < 10) continue;

    constraints.push({
      source,
      rule,
      priority: inferPriority(line),
      file_path: filePath,
    });
  }

  return constraints.slice(0, 12);
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
