import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dedupeConstraints,
  extractConstraintsFromMarkdown,
  loadAllConstraints,
} from "../src/constraints.js";

describe("extractConstraintsFromMarkdown precision", () => {
  it("keeps normative rules and assigns priority", () => {
    const rules = extractConstraintsFromMarkdown(
      "- MUST run tests before claiming complete\n- Prefer small diffs\n- Never commit secrets",
      "AGENTS.md",
      "AGENTS.md",
    );
    const texts = rules.map((r) => r.rule);
    expect(texts).toContain("MUST run tests before claiming complete");
    expect(texts).toContain("Prefer small diffs");
    expect(texts).toContain("Never commit secrets");
    expect(rules.find((r) => /never commit/i.test(r.rule))?.priority).toBe("critical");
  });

  it("captures a leading prohibition without a keyword", () => {
    const rules = extractConstraintsFromMarkdown(
      "- No new API endpoints in this change",
      "AGENTS.md",
    );
    expect(rules.map((r) => r.rule)).toContain("No new API endpoints in this change");
  });

  it("rejects metadata, links, goals, and table rows from validation notes", () => {
    const md = [
      "# Conductor",
      "**Tag:** `v0.1.0-alpha`",
      "Repo: https://github.com/vaultcompasshq/conductor",
      "## Phase 2 scope",
      "- Goal: Superpowers skills wired to packages/core",
      "- `packages/core/extract.ts` — draft contract from text",
      "| 1 | README.md | what it is |",
    ].join("\n");
    const rules = extractConstraintsFromMarkdown(md, "AGENTS.md");
    expect(rules).toHaveLength(0);
  });

  it("captures bullets under a rules heading even without keywords", () => {
    const md = [
      "## Boundaries",
      "- Per-project config lives in app repos, not here",
    ].join("\n");
    const rules = extractConstraintsFromMarkdown(md, "AGENTS.md");
    expect(rules.length).toBe(1);
  });

  it("ignores fenced code blocks", () => {
    const md = ["```bash", "- MUST look like a rule but is code", "```"].join("\n");
    const rules = extractConstraintsFromMarkdown(md, "AGENTS.md");
    expect(rules).toHaveLength(0);
  });

  it("stays low-noise on the real AGENTS.md", () => {
    const content = readFileSync(
      join(import.meta.dirname, "../../../AGENTS.md"),
      "utf8",
    );
    const rules = extractConstraintsFromMarkdown(content, "AGENTS.md", "AGENTS.md");
    // Previously scraped ~12 lines incl. tags/goals/links. Tightened filter
    // should yield only real boundary rules.
    expect(rules.length).toBeLessThanOrEqual(8);
    expect(rules.some((r) => /do not commit local per-project/i.test(r.rule))).toBe(
      true,
    );
    expect(rules.every((r) => !/^tag:/i.test(r.rule))).toBe(true);
    expect(rules.every((r) => !/v0\.1\.0-alpha/i.test(r.rule))).toBe(true);
  });

  it("dedupes identical rules across loaded constraint files", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-constraints-"));
    writeFileSync(join(dir, "AGENTS.md"), "- Never commit secrets\n", "utf8");
    writeFileSync(join(dir, "CLAUDE.md"), "- NEVER commit secrets\n", "utf8");

    const loaded = loadAllConstraints(dir);
    expect(loaded.loadedFiles).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(loaded.constraints).toHaveLength(1);
    expect(loaded.constraints[0].rule).toMatch(/commit secrets/i);
  });

  it("keeps the highest priority when deduping rules", () => {
    const deduped = dedupeConstraints([
      { source: "AGENTS.md", rule: "Prefer no production deploys", priority: "medium" },
      { source: "CLAUDE.md", rule: "Prefer no production deploys", priority: "critical" },
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].priority).toBe("critical");
  });
});
