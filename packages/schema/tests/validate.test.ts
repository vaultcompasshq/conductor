import { describe, it, expect } from "vitest";
import { validateIntentContract } from "../src/validate.js";

const validContract = {
  contract_id: "ic-20260617-a3f9k2",
  version: "1.0.0",
  original_ask: "Add CSV export for the fund performance table on the dashboard.",
  in_scope: ["Export button downloads visible table columns as CSV"],
  out_of_scope: ["PDF export"],
  constraints: [
    {
      source: "CLAUDE.md",
      rule: "No new API endpoints without explicit approval",
      priority: "critical",
    },
  ],
  acceptance_criteria: [
    {
      id: "ac-1",
      description: "Click Export downloads CSV with correct headers",
      testable: true,
    },
  ],
  frozen_at: "2026-06-17T14:30:00Z",
  pivot_log: [],
};

describe("validateIntentContract", () => {
  it("accepts a valid contract", () => {
    const result = validateIntentContract(validContract);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects missing contract_id", () => {
    const { contract_id: _, ...invalid } = validContract;
    const result = validateIntentContract(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects invalid contract_id format", () => {
    const result = validateIntentContract({
      ...validContract,
      contract_id: "bad-id",
    });
    expect(result.valid).toBe(false);
  });
});
