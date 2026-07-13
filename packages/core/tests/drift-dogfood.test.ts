import { describe, it, expect } from "vitest";
import type { IntentContract } from "@vaultcompass/conductor-schema";
import { draftContract } from "../src/extract.js";
import { scoreDrift } from "../src/drift.js";

describe("drift replay regressions", () => {
  it("onboarding replay: connect-link path does not trip production-credentials prohibition", () => {
    const contract = draftContract({
      userText:
        "Add status link on dashboard card when an external destination is linked. Fix duplicate connect clicks in onboarding: redirect start-connect when no config exists. Add unit tests for status-card. Do not modify third-party production credentials, database migrations, or deployment config.",
    });

    expect(contract.in_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/status link/i),
        expect.stringMatching(/duplicate connect clicks/i),
        expect.stringMatching(/redirect start-connect/i),
      ]),
    );

    const drift = scoreDrift(contract, {
      changedPaths: [
        "apps/web/components/integrations/connect-link-button.tsx",
        "apps/web/components/dashboard/status-card.tsx",
      ],
    });
    expect(drift.action).toBe("proceed");
    expect(drift.categories.scope_creep).toBe(0);
  });

  it("sync replay: aligned sync paths still pass", () => {
    const contract = draftContract({
      userText:
        "Fix Items tab never updated by sync: add refreshItemsRemote. Fix export column unformatted values. Add tests in items-summary.test.ts. Do not change integration token flow or webhook handlers.",
    });

    const drift = scoreDrift(contract, {
      changedPaths: [
        "apps/web/lib/sync.ts",
        "apps/web/lib/templates/items-summary.ts",
      ],
    });
    expect(drift.action).toBe("proceed");
  });

  it("relink fix replay: meta refactor constraint does not block aligned fix", () => {
    const contract: IntentContract = {
      contract_id: "ic-20260713-relink",
      version: "1.0.0",
      original_ask: "Fix relink to pass external_id string, not row UUID.",
      in_scope: [
        "Fix relink: pass external_id string to createSessionToken",
        "update web Relink button to use remote_id",
        "Add tests",
      ],
      out_of_scope: ["Do not change webhook handlers"],
      constraints: [
        {
          source: "cursor-rules",
          rule: "Do not refactor, clean up, or restructure code beyond what the task requires.",
          priority: "critical",
        },
      ],
      acceptance_criteria: [
        { id: "ac-1", description: "Relink uses external_id string", testable: true },
      ],
      frozen_at: "2026-07-13T00:00:00Z",
      pivot_log: [],
    };

    const drift = scoreDrift(contract, {
      changedPaths: [
        "packages/web-app/src/app/(webapp)/items/page.tsx",
        "packages/api/src/services/items.ts",
      ],
    });
    expect(drift.action).toBe("proceed");
    expect(drift.categories.constraint_violation).toBe(0);
  });

  it("still blocks real production config drift", () => {
    const contract = draftContract({
      userText:
        "Add status link on dashboard. Do not modify third-party production credentials or deployment config.",
    });

    const drift = scoreDrift(contract, {
      changedPaths: ["apps/web/lib/third-party-production-config.ts"],
      signals: ["updated third-party production credentials in dashboard"],
    });
    expect(["soft_block", "hard_block"]).toContain(drift.action);
    expect(drift.categories.scope_creep).toBeGreaterThan(0);
  });
});
