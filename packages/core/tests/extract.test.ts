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

  it("does not treat a file-extension period as the end of original_ask", () => {
    const contract = draftContract({
      userText:
        "Add unit tests for itemFilter in frontend/src/features/catalog-module/lib/itemFilter.ts. Verify filtering excludes items not in the selected preset. Do not add API endpoints. Do not modify backend Python services.",
    });

    expect(contract.original_ask).toMatch(/itemFilter\.ts/i);
    expect(contract.original_ask).toMatch(/Verify filtering/i);
    expect(contract.in_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/unit tests for itemFilter/i),
      ]),
    );
    expect(contract.out_of_scope).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/not in the selected preset/i)]),
    );
    expect(contract.out_of_scope).toEqual(
      expect.arrayContaining([expect.stringMatching(/do not add API endpoints/i)]),
    );
    expect(contract.acceptance_criteria.map((ac) => ac.description)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/filtering excludes items/i),
      ]),
    );
  });

  it("splits compound extensions like .test.ts. and keeps in_scope under the length cap", () => {
    const contract = draftContract({
      userText:
        "Add filterItems helper in frontend/src/features/catalog-module/lib/itemFilter.ts with unit tests in itemFilter.test.ts. Build ItemPicker component with searchable library, custom badge, and assign/assigned states. Verify filtering excludes items not in the selected preset. Do not add API endpoints. Do not modify backend Python services.",
    });

    expect(contract.in_scope.length).toBeGreaterThanOrEqual(2);
    expect(contract.in_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/filterItems helper/i),
        expect.stringMatching(/Build ItemPicker/i),
      ]),
    );
    expect(contract.out_of_scope).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/not in the selected preset/i)]),
    );
    for (const item of contract.in_scope) {
      expect(item.length).toBeLessThanOrEqual(200);
    }
  });

  it("extracts Extract-clauses into in_scope (multi-clause prompts)", () => {
    const contract = draftContract({
      userText:
        'Fix catalog-module so we only ever target a Draft record using canonical status casing "Draft" (not lowercase "draft"). Extract resolveDraftRecord helper. Add unit tests locking the no-overwrite rule. Do not modify backend Python services. Do not add new API endpoints.',
    });

    expect(contract.in_scope.length).toBeGreaterThanOrEqual(3);
    expect(contract.in_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Fix catalog-module/i),
        expect.stringMatching(/Extract resolveDraftRecord/i),
        expect.stringMatching(/Add unit tests/i),
      ]),
    );
    expect(contract.out_of_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/do not modify backend/i),
        expect.stringMatching(/do not add new API endpoints/i),
      ]),
    );
  });

  it("keeps imperative head when a clause embeds a trailing prohibition", () => {
    const contract = draftContract({
      userText:
        "Fix duplicate connect clicks in onboarding: redirect start-connect when no config exists. Add unit tests for status-card. Do not modify third-party production credentials.",
    });

    expect(contract.in_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/duplicate connect clicks/i),
        expect.stringMatching(/redirect start-connect/i),
        expect.stringMatching(/unit tests for status-card/i),
      ]),
    );
    expect(contract.out_of_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/do not modify third-party production credentials/i),
      ]),
    );
  });

  it("does not add without review false positive from registry clause", () => {
    const contract = draftContract({
      userText:
        "Register module demo-module in the example orchestrator. Update modules/demo-module/state.json and produce output/decision.md. Run only the next approved stage. Do not commit secrets or skip Conductor approval. Do not modify config/registry.json without review.",
    });

    expect(contract.out_of_scope).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^without review$/i)]),
    );
    expect(contract.out_of_scope).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^Do not modify config$/i)]),
    );
    expect(contract.out_of_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/do not modify config\/registry\.json/i),
      ]),
    );
  });

  it("generateContractId matches schema pattern", () => {
    expect(generateContractId(new Date("2026-06-17T12:00:00Z"))).toMatch(
      /^ic-20260617-[a-z0-9]{6}$/,
    );
  });

  it("keeps a multi-clause imperative even when the first verb isn't in the curated action list", () => {
    const contract = draftContract({
      userText:
        "Blend the celebration audio cue with the existing background music in audioManager.ts. and fix the related accessibility labels for the Missing Sound station. Do not touch level unlock order or add new levels. Done when the audio blend has test coverage and a11y checks pass.",
    });
    expect(contract.in_scope.some((s) => /blend/i.test(s))).toBe(true);
    expect(contract.in_scope.some((s) => /accessibility labels/i.test(s))).toBe(true);
    expect(contract.in_scope.some((s) => /^done when/i.test(s))).toBe(false);
  });

  it("does not bleed acceptance-criteria text into out_of_scope", () => {
    const contract = draftContract({
      userText:
        "Bump github/codeql-action/init and github/codeql-action/analyze to 4.37.0 and actions/checkout to 7.0.0 in the CI workflow files. Do not change the scanning rule set or add new GitHub Actions jobs. Done when CI passes on the bumped action versions.",
    });
    expect(contract.out_of_scope.some((s) => /done when/i.test(s))).toBe(false);
    expect(
      contract.out_of_scope.some((s) => /^Do not change the scanning rule set/i.test(s)),
    ).toBe(true);
  });

  it("does not truncate a long prohibition clause mid-word", () => {
    const contract = draftContract({
      userText:
        "Fix the auth callback bug. Do not change the Google OAuth drive.file scope configuration or the Plaid removeItem ordering. Done when tests pass.",
    });
    expect(contract.out_of_scope.some((s) => /removeitem or$/i.test(s))).toBe(false);
    expect(contract.out_of_scope.some((s) => /removeitem ordering$/i.test(s))).toBe(true);
  });

  it("does not fabricate a garbled prohibition from a compound do-not clause", () => {
    const contract = draftContract({
      userText:
        "Fix the vulnerabilities in package.json. Do not modify the verification protocol logic in agents/4b or agents/4c, and do not add new agent capabilities.",
    });
    expect(contract.out_of_scope.some((s) => /modify do not add/i.test(s))).toBe(false);
    expect(
      contract.out_of_scope.some((s) => /^do not add new agent capabilities$/i.test(s)),
    ).toBe(true);
    expect(contract.out_of_scope.some((s) => /agents\/4b or agents\/4c/i.test(s))).toBe(true);
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
