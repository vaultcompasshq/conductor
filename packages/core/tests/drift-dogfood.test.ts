import { describe, it, expect } from "vitest";
import type { IntentContract } from "@vaultcompass/conductor-schema";
import { draftContract } from "../src/extract.js";
import { scoreDrift } from "../src/drift.js";

describe("drift dogfood regressions (Tier 0 replays)", () => {
  it("onboarding replay: connect-link path does not trip production-credentials prohibition", () => {
    const contract = draftContract({
      userText:
        "Add export link to dashboard status card when an external destination is linked. Fix duplicate connect clicks in onboarding: redirect start-connect directly into provider OAuth when no config exists. Add unit tests for status-card. Do not modify payment-provider production credentials, database migrations, or deployment config.",
    });

    expect(contract.in_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/export link/i),
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
        "Fix Records tab never updated by sync: add refreshRecordsRemote. Fix CSV history column unformatted values. Add tests in records-summary.test.ts. Do not change integration token flow or webhook handlers.",
    });

    const drift = scoreDrift(contract, {
      changedPaths: [
        "apps/web/lib/sync.ts",
        "apps/web/lib/templates/records-summary.ts",
      ],
    });
    expect(drift.action).toBe("proceed");
  });

  it("reconnect hotfix replay: meta refactor constraint does not block aligned fix", () => {
    const contract: IntentContract = {
      contract_id: "ic-20260713-reconn",
      version: "1.0.0",
      original_ask:
        "Fix reconnect to pass external_record_id string, not row UUID.",
      in_scope: [
        "Fix reconnect: pass external_record_id string to createRefreshSession",
        "update web Reconnect button to use remote_record_id",
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
        { id: "ac-1", description: "Reconnect uses external_record_id string", testable: true },
      ],
      frozen_at: "2026-07-13T00:00:00Z",
      pivot_log: [],
    };

    const drift = scoreDrift(contract, {
      changedPaths: [
        "packages/web-app/src/app/(webapp)/records/page.tsx",
        "packages/api/src/services/records.ts",
      ],
    });
    expect(drift.action).toBe("proceed");
    expect(drift.categories.constraint_violation).toBe(0);
  });

  it("still blocks real production vendor config drift", () => {
    const contract = draftContract({
      userText:
        "Add export link on dashboard. Do not modify payment-provider production credentials or deployment config.",
    });

    const drift = scoreDrift(contract, {
      changedPaths: ["apps/web/lib/payment-provider-production-config.ts"],
      signals: ["updated payment-provider production credentials in dashboard"],
    });
    expect(["soft_block", "hard_block"]).toContain(drift.action);
    expect(drift.categories.scope_creep).toBeGreaterThan(0);
  });
});
