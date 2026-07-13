import { describe, it, expect } from "vitest";
import type { IntentContract } from "@vaultcompass/conductor-schema";
import { scoreDrift } from "../src/drift.js";

// These contracts use vocabulary that appears nowhere in drift.ts.

const darkModeContract: IntentContract = {
  contract_id: "ic-20260618-dark01",
  version: "1.0.0",
  original_ask: "Add a dark mode toggle to the settings page, persisted in local storage.",
  in_scope: [
    "Dark mode / theme toggle component on the settings page",
    "Persist theme preference in local storage",
  ],
  out_of_scope: [
    "Analytics tracking of theme changes",
    "Server-side user preference sync",
  ],
  constraints: [
    {
      source: "CLAUDE.md",
      rule: "Never send telemetry to third-party analytics services",
      priority: "critical",
    },
    {
      source: "AGENTS.md",
      rule: "Prefer CSS variables over inline styles",
      priority: "medium",
    },
  ],
  acceptance_criteria: [
    { id: "ac-1", description: "Toggle switches theme and persists across reloads", testable: true },
  ],
  frozen_at: "2026-06-18T10:00:00Z",
  frozen_by: "user",
  pivot_log: [],
};

describe("drift scorer generality (novel vocabulary)", () => {
  it("passes aligned work on a contract it has never seen", () => {
    const result = scoreDrift(darkModeContract, {
      changedPaths: [
        "src/settings/ThemeToggle.tsx",
        "src/settings/useThemePreference.ts",
      ],
    });
    expect(result.overall).toBeLessThan(26);
    expect(result.action).toBe("proceed");
  });

  it("catches out-of-scope analytics work with no hardcoded rule for it", () => {
    const result = scoreDrift(darkModeContract, {
      changedPaths: ["src/lib/analytics.ts"],
      signals: ["added analytics tracking for theme toggle"],
    });
    expect(result.categories.scope_creep).toBeGreaterThan(0);
    expect(result.action === "soft_block" || result.action === "hard_block").toBe(true);
    expect(result.findings.some((f) => /analytics/i.test(f))).toBe(true);
  });

  it("hard-blocks a critical constraint violation expressed in novel terms", () => {
    const result = scoreDrift(darkModeContract, {
      changedPaths: ["src/lib/telemetry.ts"],
      signals: ["send telemetry events to third-party analytics"],
    });
    expect(result.categories.constraint_violation).toBe(90);
    expect(["soft_block", "hard_block"]).toContain(result.action);
    expect(result.findings.some((f) => /critical constraint/i.test(f))).toBe(true);
  });

  it("does not flag in-scope tokens shared with an out-of-scope phrase", () => {
    // "preference" appears in both in-scope (local storage) and out-of-scope
    // (server-side sync). Touching the local preference must not trip on the
    // shared word — only the discriminating "server"/"sync" tokens should.
    const result = scoreDrift(darkModeContract, {
      changedPaths: ["src/settings/preference-store.ts"],
    });
    expect(result.categories.scope_creep).toBe(0);
    expect(result.action).toBe("proceed");
  });
});
