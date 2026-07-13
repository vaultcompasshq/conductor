import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditRules, renderRulesAuditMarkdown } from "../src/rules-audit.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "conductor-rules-"));
}

describe("rules audit", () => {
  it("reports duplicate rules and critical candidates", () => {
    const dir = tmpProject();
    writeFileSync(
      join(dir, "AGENTS.md"),
      ["## Rules", "- Never commit secrets", "- Prefer no production deploys"].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(dir, "CLAUDE.md"),
      ["## Rules", "- NEVER commit secrets", "- Temporary rule: avoid old deploy path"].join("\n"),
      "utf8",
    );

    const result = auditRules(dir);
    const markdown = renderRulesAuditMarkdown(result);

    expect(result.status).toBe("warn");
    expect(result.summary.files).toBe(2);
    expect(result.duplicates).toHaveLength(1);
    expect(result.findings.some((finding) => finding.id === "duplicate_rule")).toBe(true);
    expect(result.findings.some((finding) => finding.id === "critical_candidate")).toBe(true);
    expect(result.findings.some((finding) => finding.id === "possibly_stale_rule")).toBe(true);
    expect(markdown).toContain("# Conductor rules audit");
  });

  it("loads Cursor, Continue, and Kiro rule directories", () => {
    const dir = tmpProject();
    mkdirSync(join(dir, ".cursor", "rules"), { recursive: true });
    mkdirSync(join(dir, ".continue", "rules"), { recursive: true });
    mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
    writeFileSync(join(dir, ".cursor", "rules", "conductor.mdc"), "- Must run tests\n", "utf8");
    writeFileSync(join(dir, ".continue", "rules", "rules.md"), "- Avoid broad refactors\n", "utf8");
    writeFileSync(join(dir, ".kiro", "steering", "product.md"), "- Do not change billing\n", "utf8");

    const result = auditRules(dir);

    expect(result.files.map((file) => file.source)).toEqual([
      "cursor-rules",
      "continue-rules",
      "kiro-steering",
    ]);
    expect(result.summary.rules).toBe(3);
  });

  it("flags drift-noisy meta rules", () => {
    const dir = tmpProject();
    writeFileSync(
      join(dir, "AGENTS.md"),
      "- Do not refactor, clean up, or restructure code beyond what the task requires.",
      "utf8",
    );

    const result = auditRules(dir);
    expect(result.findings.some((finding) => finding.id === "drift_noisy_rule")).toBe(
      true,
    );
  });
});
