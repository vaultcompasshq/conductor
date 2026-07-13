import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { scoreDrift } from "../src/drift.js";
import type { IntentContract } from "@vaultcompass/conductor-schema";

describe("stub detection retrospective", () => {
  it("drift score >= 70 for stubbed implementation signals", () => {
    const contract = parse(
      readFileSync(
        join(
          import.meta.dirname,
          "../../../examples/intent-contracts/stub-detection-retrospective.yaml",
        ),
        "utf8",
      ),
    ) as IntentContract;

    const result = scoreDrift(contract, {
      changedPaths: [
        "src-tauri/src/notification_system.rs",
        "src-tauri/src/metrics.rs",
      ],
      signals: ["stub_println_notification", "hardcoded_metric_values"],
    });

    expect(result.overall).toBeGreaterThanOrEqual(70);
    expect(["soft_block", "hard_block"]).toContain(result.action);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
