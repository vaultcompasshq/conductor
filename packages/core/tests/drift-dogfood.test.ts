import { describe, it, expect } from "vitest";
import type { IntentContract } from "@vaultcompass/conductor-schema";
import { draftContract } from "../src/extract.js";
import { scoreDrift } from "../src/drift.js";

describe("drift dogfood regressions (Tier 0 replays)", () => {
  it("Sheetful #369: plaid-link-button path does not trip production-credentials prohibition", () => {
    const contract = draftContract({
      userText:
        "Add Open sheet link to dashboard Sync Status card when a spreadsheet destination is linked. Fix duplicate connect clicks in onboarding: redirect create-sheet directly into Google OAuth when no config exists. Add unit tests for sync-status. Do not modify Plaid production credentials, database migrations, or deployment config.",
    });

    expect(contract.in_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/open sheet link/i),
        expect.stringMatching(/duplicate connect clicks/i),
        expect.stringMatching(/redirect create-sheet/i),
      ]),
    );

    const drift = scoreDrift(contract, {
      changedPaths: [
        "apps/web/components/banks/plaid-link-button.tsx",
        "apps/web/components/dashboard/sync-status.tsx",
      ],
    });
    expect(drift.action).toBe("proceed");
    expect(drift.categories.scope_creep).toBe(0);
  });

  it("Sheetful #366: aligned sync paths still pass", () => {
    const contract = draftContract({
      userText:
        "Fix Accounts tab never updated by sync: add refreshAccountsGoogle. Fix Excel Balance History unformatted amounts. Add tests in accounts-balance-sheet.test.ts. Do not change Plaid link token flow or Stripe billing.",
    });

    const drift = scoreDrift(contract, {
      changedPaths: [
        "apps/web/lib/sync.ts",
        "apps/web/lib/templates/accounts-balance-sheet.ts",
      ],
    });
    expect(drift.action).toBe("proceed");
  });

  it("Prismfolio #463: meta refactor constraint does not block aligned reconnect fix", () => {
    const contract: IntentContract = {
      contract_id: "ic-20260713-pr463",
      version: "1.0.0",
      original_ask:
        "Fix Plaid reconnect to pass item_id string, not row UUID.",
      in_scope: [
        "Fix Plaid reconnect: pass Plaid item_id string to createUpdateLinkToken",
        "update web Reconnect button to use plaid_sync_item_id",
        "Add tests",
      ],
      out_of_scope: ["Do not change Stripe webhooks"],
      constraints: [
        {
          source: "cursor-rules",
          rule: "Do not refactor, clean up, or restructure code beyond what the task requires.",
          priority: "critical",
        },
      ],
      acceptance_criteria: [
        { id: "ac-1", description: "Reconnect uses item_id string", testable: true },
      ],
      frozen_at: "2026-07-13T00:00:00Z",
      pivot_log: [],
    };

    const drift = scoreDrift(contract, {
      changedPaths: [
        "packages/web-app/src/app/(webapp)/accounts/page.tsx",
        "packages/api/src/services/accounts.ts",
      ],
    });
    expect(drift.action).toBe("proceed");
    expect(drift.categories.constraint_violation).toBe(0);
  });

  it("still blocks real production Plaid config drift", () => {
    const contract = draftContract({
      userText:
        "Add Open sheet link on dashboard. Do not modify Plaid production credentials or deployment config.",
    });

    const drift = scoreDrift(contract, {
      changedPaths: ["apps/web/lib/plaid-production-config.ts"],
      signals: ["updated plaid production credentials in dashboard"],
    });
    expect(["soft_block", "hard_block"]).toContain(drift.action);
    expect(drift.categories.scope_creep).toBeGreaterThan(0);
  });
});
