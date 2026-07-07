import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  Constraint,
  ConstraintSource,
} from "@vaultcompasshq/conductor-schema";
import {
  extractConstraintsFromMarkdown,
  normalizeConstraintRule,
} from "./constraints.js";

export type RulesAuditFindingStatus = "info" | "warn";
export type RulesAuditStatus = "ok" | "warn";

export interface RulesAuditFile {
  path: string;
  source: ConstraintSource;
  ruleCount: number;
}

export interface RulesAuditDuplicate {
  rule: string;
  paths: string[];
}

export interface RulesAuditFinding {
  id: string;
  status: RulesAuditFindingStatus;
  message: string;
  path?: string;
  detail?: string;
}

export interface RulesAuditResult {
  projectRoot: string;
  status: RulesAuditStatus;
  summary: {
    files: number;
    rules: number;
    duplicates: number;
    warnings: number;
  };
  files: RulesAuditFile[];
  rules: Constraint[];
  duplicates: RulesAuditDuplicate[];
  findings: RulesAuditFinding[];
}

interface RuleSource {
  source: ConstraintSource;
  path: string;
}

const FILE_SOURCES: RuleSource[] = [
  { source: "AGENTS.md", path: "AGENTS.md" },
  { source: "CLAUDE.md", path: "CLAUDE.md" },
  { source: "GEMINI.md", path: "GEMINI.md" },
];

const DIRECTORY_SOURCES: Array<{
  source: ConstraintSource;
  dir: string;
  extensions: string[];
}> = [
  { source: "cursor-rules", dir: ".cursor/rules", extensions: [".mdc", ".md"] },
  { source: "continue-rules", dir: ".continue/rules", extensions: [".md", ".mdc"] },
  { source: "kiro-steering", dir: ".kiro/steering", extensions: [".md", ".mdc"] },
];

function finding(
  status: RulesAuditFindingStatus,
  id: string,
  message: string,
  path?: string,
  detail?: string,
): RulesAuditFinding {
  return { id, status, message, path, detail };
}

function readRuleSources(projectRoot: string): RuleSource[] {
  const sources: RuleSource[] = [];
  for (const source of FILE_SOURCES) {
    if (existsSync(join(projectRoot, source.path))) sources.push(source);
  }

  for (const source of DIRECTORY_SOURCES) {
    const dir = join(projectRoot, source.dir);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!source.extensions.some((ext) => file.endsWith(ext))) continue;
      sources.push({
        source: source.source,
        path: join(source.dir, file),
      });
    }
  }

  return sources;
}

function duplicateGroups(rules: Constraint[]): RulesAuditDuplicate[] {
  const byRule = new Map<string, Constraint[]>();
  for (const rule of rules) {
    const key = normalizeConstraintRule(rule.rule);
    if (!key) continue;
    byRule.set(key, [...(byRule.get(key) ?? []), rule]);
  }

  return [...byRule.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      rule: group[0].rule,
      paths: group.map((rule) => rule.file_path ?? rule.source),
    }));
}

function rulePolarity(rule: string): "allow" | "prohibit" | "other" {
  if (/\b(must not|never|do not|don't|dont|cannot|can't|shall not|avoid)\b/i.test(rule)) {
    return "prohibit";
  }
  if (/^no\s+\w+/i.test(rule)) return "prohibit";
  if (/\b(allowed|allow|may|can|permitted)\b/i.test(rule)) return "allow";
  return "other";
}

function ruleSubject(rule: string): string {
  return normalizeConstraintRule(rule)
    .replace(/\b(must not|must|never|do not|don t|dont|cannot|can t|shall not|shall|avoid|allowed|allow|may|can|permitted|no)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPotentiallyStale(rule: string): boolean {
  return /\b(temporary|deprecated|legacy|until|remove after|todo|old rule)\b/i.test(rule);
}

function isOverbroad(rule: string): boolean {
  const normalized = normalizeConstraintRule(rule);
  const words = normalized.split(" ").filter(Boolean);
  return (
    words.length <= 3 ||
    /\b(best practices|be careful|keep it simple|do not break|avoid changes|use good judgment)\b/i.test(rule)
  );
}

function shouldBeCritical(rule: Constraint): boolean {
  if (rule.priority === "critical") return false;
  return /\b(secret|credential|api key|token|private key|production|customer|pii|payment|database migration|destructive|delete data)\b/i.test(
    rule.rule,
  );
}

function conflictFindings(rules: Constraint[]): RulesAuditFinding[] {
  const bySubject = new Map<string, Constraint[]>();
  for (const rule of rules) {
    const polarity = rulePolarity(rule.rule);
    if (polarity === "other") continue;
    const subject = ruleSubject(rule.rule);
    if (subject.length < 8) continue;
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), rule]);
  }

  const findings: RulesAuditFinding[] = [];
  for (const [subject, group] of bySubject) {
    const polarities = new Set(group.map((rule) => rulePolarity(rule.rule)));
    if (polarities.has("allow") && polarities.has("prohibit")) {
      findings.push(
        finding(
          "warn",
          "potential_rule_conflict",
          `Potential conflict around "${subject}".`,
          group.map((rule) => rule.file_path ?? rule.source).join(", "),
          group.map((rule) => rule.rule).join(" | "),
        ),
      );
    }
  }
  return findings;
}

export function auditRules(projectRoot: string): RulesAuditResult {
  const sources = readRuleSources(projectRoot);
  const files: RulesAuditFile[] = [];
  const rules: Constraint[] = [];
  const findings: RulesAuditFinding[] = [];

  for (const source of sources) {
    const content = readFileSync(join(projectRoot, source.path), "utf8");
    const extracted = extractConstraintsFromMarkdown(
      content,
      source.source,
      source.path,
    );
    files.push({
      path: source.path,
      source: source.source,
      ruleCount: extracted.length,
    });
    rules.push(...extracted);
  }

  const duplicates = duplicateGroups(rules);
  for (const duplicate of duplicates) {
    findings.push(
      finding(
        "warn",
        "duplicate_rule",
        `Duplicate rule loaded ${duplicate.paths.length} times.`,
        duplicate.paths.join(", "),
        duplicate.rule,
      ),
    );
  }

  findings.push(...conflictFindings(rules));

  for (const rule of rules) {
    const path = rule.file_path ?? rule.source;
    if (isPotentiallyStale(rule.rule)) {
      findings.push(
        finding("warn", "possibly_stale_rule", "Rule contains stale or temporary wording.", path, rule.rule),
      );
    }
    if (isOverbroad(rule.rule)) {
      findings.push(
        finding("warn", "overbroad_rule", "Rule may be too broad to enforce reliably.", path, rule.rule),
      );
    }
    if (shouldBeCritical(rule)) {
      findings.push(
        finding("info", "critical_candidate", "Rule may deserve critical priority.", path, rule.rule),
      );
    }
  }

  const warnings = findings.filter((item) => item.status === "warn").length;
  return {
    projectRoot,
    status: warnings > 0 ? "warn" : "ok",
    summary: {
      files: files.length,
      rules: rules.length,
      duplicates: duplicates.length,
      warnings,
    },
    files,
    rules,
    duplicates,
    findings,
  };
}

export function renderRulesAuditMarkdown(result: RulesAuditResult): string {
  const lines = [
    "# Conductor rules audit",
    "",
    `Status: ${result.status}`,
    `Files: ${result.summary.files}`,
    `Rules: ${result.summary.rules}`,
    `Duplicates: ${result.summary.duplicates}`,
    `Warnings: ${result.summary.warnings}`,
  ];

  if (result.files.length > 0) {
    lines.push("", "## Files");
    for (const file of result.files) {
      lines.push(`- ${file.path}: ${file.ruleCount} rule(s)`);
    }
  }

  if (result.findings.length > 0) {
    lines.push("", "## Findings");
    for (const item of result.findings) {
      const path = item.path ? ` (${item.path})` : "";
      lines.push(`- [${item.status}] ${item.message}${path}`);
      if (item.detail) lines.push(`  - ${item.detail}`);
    }
  }

  if (result.rules.length > 0) {
    lines.push("", "## Loaded Rules");
    for (const rule of result.rules) {
      lines.push(`- [${rule.priority}] ${rule.rule} (${rule.file_path ?? rule.source})`);
    }
  }

  return lines.join("\n");
}
