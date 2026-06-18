import { describe, it, expect } from "vitest";
import type { IntentContract } from "@vaultcompasshq/conductor-schema";
import { scoreDrift } from "../src/drift.js";

const baseContract: IntentContract = {
  contract_id: "ic-20260617-a3f9k2",
  version: "1.0.0",
  original_ask: "Add CSV export for the fund performance table.",
  in_scope: ["Client-side CSV export of fund table"],
  out_of_scope: ["PDF export", "New API endpoints", "WebSocket"],
  constraints: [
    {
      source: "CLAUDE.md",
      rule: "No new API endpoints without explicit approval",
      priority: "critical",
    },
  ],
  acceptance_criteria: [
    { id: "ac-1", description: "Export downloads CSV", testable: true },
  ],
  frozen_at: "2026-06-17T14:30:00Z",
  pivot_log: [],
};

describe("scoreDrift", () => {
  it("scores low drift for aligned diff signals", () => {
    const result = scoreDrift(baseContract, {
      changedPaths: ["src/components/ExportButton.tsx"],
      signals: [],
    });
    expect(result.overall).toBeLessThan(30);
    expect(result.action).toBe("proceed");
  });

  it("scores high drift for API + websocket outside scope", () => {
    const result = scoreDrift(baseContract, {
      changedPaths: ["src/app/api/export/route.ts", "src/hooks/useWebSocket.ts"],
      signals: ["new_api_route", "websocket_added"],
    });
    expect(result.overall).toBeGreaterThan(70);
    expect(["soft_block", "hard_block"]).toContain(result.action);
    expect(result.categories.constraint_violation).toBeGreaterThan(0);
  });
});
