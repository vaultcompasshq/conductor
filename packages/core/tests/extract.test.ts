import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractConstraintsFromMarkdown,
  loadConstraintFiles,
} from "../src/constraints.js";
import {
  draftContract,
  generateContractId,
} from "../src/extract.js";
import {
  readContract,
  writeContract,
  freezeContract,
  isContractFrozen,
} from "../src/contract-store.js";
import { appendDriftEvent, driftLogPath } from "../src/drift-log.js";

describe("extractConstraintsFromMarkdown", () => {
  it("extracts MUST rules as critical", () => {
    const rules = extractConstraintsFromMarkdown(
      "- MUST verify tests before claiming complete\n- Prefer small diffs",
      "AGENTS.md",
      "AGENTS.md",
    );
    expect(rules.length).toBeGreaterThanOrEqual(2);
    expect(rules[0].priority).toBe("high");
    expect(rules[0].source).toBe("AGENTS.md");
  });
});

describe("loadConstraintFiles", () => {
  it("loads AGENTS.md when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-"));
    writeFileSync(
      join(dir, "AGENTS.md"),
      "- MUST run pnpm test before claiming complete",
    );
    const loaded = loadConstraintFiles(dir);
    expect(loaded.loadedFiles).toContain("AGENTS.md");
    expect(loaded.constraints.length).toBeGreaterThan(0);
  });
});

describe("draftContract", () => {
  it("drafts a contract from user text", () => {
    const contract = draftContract({
      userText:
        "Add CSV export for the fund table. Client-side only. No PDF export.",
    });
    expect(contract.contract_id).toMatch(/^ic-\d{8}-[a-z0-9]{6}$/);
    expect(contract.in_scope.length).toBeGreaterThan(0);
    expect(contract.out_of_scope.some((s) => /pdf/i.test(s))).toBe(true);
    expect(contract.acceptance_criteria.length).toBeGreaterThan(0);
    expect(contract.prompt_quality?.score).toBeGreaterThan(50);
  });

  it("generateContractId matches schema pattern", () => {
    expect(generateContractId(new Date("2026-06-17T12:00:00Z"))).toMatch(
      /^ic-20260617-[a-z0-9]{6}$/,
    );
  });
});

describe("contract store", () => {
  it("writes and reads a frozen contract", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-"));
    const draft = draftContract({ userText: "Add export button on dashboard." });
    const frozen = freezeContract(draft, "user");
    const path = writeContract(dir, frozen);
    expect(path).toContain(".conductor/intent-contract.yaml");
    const loaded = readContract(dir);
    expect(loaded?.contract_id).toBe(frozen.contract_id);
    expect(isContractFrozen(loaded!)).toBe(true);
  });
});

describe("drift log", () => {
  it("appends JSONL events", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-"));
    appendDriftEvent(dir, {
      contract_id: "ic-20260617-abc123",
      overall: 72,
      action: "soft_block",
      findings: ["test finding"],
    });
    const content = readFileSync(driftLogPath(dir), "utf8");
    expect(content).toContain("soft_block");
    expect(content).toContain("test finding");
  });
});
