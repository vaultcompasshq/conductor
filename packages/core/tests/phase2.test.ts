import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import { loadConfig, configPath } from "../src/config.js";
import { initConductor } from "../src/init.js";
import { conductorDir } from "../src/contract-store.js";
import { loadCursorRules } from "../src/constraints.js";
import { scoreDrift } from "../src/drift.js";
import type { IntentContract } from "@vaultcompass/conductor-schema";

describe("loadConfig", () => {
  it("returns defaults when config missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-"));
    const config = loadConfig(dir);
    expect(config.drift.thresholds.soft_block).toBe(71);
    expect(config.coach.show_when_score_below).toBe(60);
  });

  it("merges project config overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-"));
    initConductor(dir);
    const raw = readFileSync(configPath(dir), "utf8").replace(
      "soft_block: 71",
      "soft_block: 80",
    );
    writeFileSync(configPath(dir), raw, "utf8");
    const config = loadConfig(dir);
    expect(config.drift.thresholds.soft_block).toBe(80);
  });
});

describe("initConductor", () => {
  it("creates .conductor skeleton", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-"));
    const result = initConductor(dir);
    expect(result.created).toContain(".conductor/config.yaml");
    expect(result.created).toContain(".conductor/index.md");
    expect(result.created).toContain(".conductor/contracts/");
    expect(readFileSync(join(conductorDir(dir), "index.md"), "utf8")).toContain(
      "Conductor Index",
    );
  });
});

describe("loadCursorRules", () => {
  it("loads .cursor/rules/*.mdc", () => {
    const dir = join(import.meta.dirname, "fixtures/cursor-project");
    const loaded = loadCursorRules(dir);
    expect(loaded.loadedFiles).toContain(".cursor/rules/test.mdc");
    expect(loaded.constraints.length).toBeGreaterThan(0);
  });
});

describe("Phase 2 validation drift", () => {
  it("soft-blocks adding packages/cli during Phase 2 contract", () => {
    const contract = parse(
      readFileSync(
        join(
          import.meta.dirname,
          "../../../examples/intent-contracts/conductor-phase2.yaml",
        ),
        "utf8",
      ),
    ) as IntentContract;

    const result = scoreDrift(contract, {
      changedPaths: [
        "packages/cli/src/index.ts",
        "packages/cli/package.json",
      ],
    });

    expect(result.overall).toBeGreaterThanOrEqual(70);
    expect(result.action).toBe("soft_block");
    expect(result.findings.some((f) => /cli/i.test(f))).toBe(true);
  });

  it("allows aligned Phase 2 skill paths", () => {
    const contract = parse(
      readFileSync(
        join(
          import.meta.dirname,
          "../../../examples/intent-contracts/conductor-phase2.yaml",
        ),
        "utf8",
      ),
    ) as IntentContract;

    const result = scoreDrift(contract, {
      changedPaths: [
        "packages/skill/intent-contract/SKILL.md",
        "packages/core/src/init.ts",
      ],
    });

    expect(result.overall).toBeLessThan(51);
    expect(result.action).toBe("proceed");
  });
});
