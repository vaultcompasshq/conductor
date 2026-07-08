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
import { scoreDrift } from "../src/drift.js";
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

  it("extracts multiple scope items from a multi-sentence paragraph ask", () => {
    const contract = draftContract({
      userText:
        "Build a resume flow. Archive frozen contracts to .conductor/contracts. Regenerate index.md from the active contract and recent pivots. Show acknowledged corrections in the brief.",
    });

    expect(contract.in_scope.length).toBeGreaterThanOrEqual(4);
    expect(contract.in_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/resume flow/i),
        expect.stringMatching(/archive frozen contracts/i),
        expect.stringMatching(/regenerate index/i),
        expect.stringMatching(/acknowledged corrections/i),
      ]),
    );
    expect(contract.acceptance_criteria.length).toBeGreaterThanOrEqual(4);
  });

  it("splits obvious action clauses and explicit acceptance criteria", () => {
    const contract = draftContract({
      userText:
        "Add CSV export to the report table and include current filters. Verify downloaded CSV has visible headers. Test that no API route is created.",
    });

    expect(contract.in_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/csv export/i),
        expect.stringMatching(/include current filters/i),
      ]),
    );
    expect(contract.acceptance_criteria.map((ac) => ac.description)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/downloaded CSV has visible headers/i),
        expect.stringMatching(/no API route is created/i),
      ]),
    );
    expect(contract.acceptance_criteria.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps prohibition clauses out of scope so drift can block them", () => {
    const contract = draftContract({
      userText:
        "Add a client-side CSV export button to the report table. Do not add new API endpoints. Verify downloaded CSV has visible headers.",
    });

    expect(contract.in_scope).toEqual(
      expect.arrayContaining([expect.stringMatching(/client-side CSV export/i)]),
    );
    expect(contract.in_scope).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/do not|not add|api endpoints/i)]),
    );
    expect(contract.out_of_scope).toEqual(
      expect.arrayContaining([expect.stringMatching(/do not add new API endpoints/i)]),
    );
    expect(contract.out_of_scope).toHaveLength(1);

    const drift = scoreDrift(contract, {
      changedPaths: ["src/app/api/export/route.ts"],
      signals: ["added new api endpoint for export"],
    });
    expect(drift.action === "soft_block" || drift.action === "hard_block").toBe(true);
  });

  it("splits comma-separated prohibition lists into separate out-of-scope items", () => {
    const contract = draftContract({
      userText:
        "Update README usage documentation. Do not change source code, package metadata, build configuration, dependency manifests, or runtime behavior. Done when README has one usage example.",
    });

    expect(contract.out_of_scope).toEqual(
      expect.arrayContaining([
        "Do not change source code",
        "Do not change package metadata",
        "Do not change build configuration",
        "Do not change dependency manifests",
        "Do not change runtime behavior",
      ]),
    );

    const drift = scoreDrift(contract, { changedPaths: ["package.json"] });
    expect(drift.action).toBe("soft_block");
  });

  it("does not split dotted file tokens into nonsense fragments", () => {
    const contract = draftContract({
      userText:
        "Add a repo-local .githooks pre-commit hook, a tools/install-git-hooks.sh bootstrap, and a .github/workflows/conductor-drift.yml CI job. Update .gitignore to commit config.yaml. Do not modify backend services.",
    });

    // original_ask keeps the full first sentence, not a fragment cut at ".githooks".
    expect(contract.original_ask).toMatch(/pre-commit hook/i);
    expect(contract.original_ask).not.toMatch(/^Add a repo-local \.?$/);

    const allItems = [...contract.in_scope, ...contract.acceptance_criteria.map((a) => a.description)];
    // No item should be a bare file-extension fragment like "yml CI ...".
    for (const item of allItems) {
      expect(item).not.toMatch(/^(yml|yaml|sh|githooks|github|gitignore)\b/i);
    }
    expect(contract.out_of_scope).toEqual(
      expect.arrayContaining([expect.stringMatching(/do not modify backend services/i)]),
    );
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
    expect(isContractFrozen(draft)).toBe(false);
    const frozen = freezeContract(draft, { approvedBy: "tester" });
    const path = writeContract(dir, frozen);
    expect(path).toContain(".conductor/intent-contract.yaml");
    const loaded = readContract(dir);
    expect(loaded?.contract_id).toBe(frozen.contract_id);
    expect(isContractFrozen(loaded!)).toBe(true);
    expect(loaded!.approval?.approved_by).toBe("tester");
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
