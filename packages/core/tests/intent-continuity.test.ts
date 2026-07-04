import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IntentContract } from "@vaultcompasshq/conductor-schema";
import {
  addPivot,
  archiveContract,
  archivedContractPath,
  crossSessionDrift,
  listContracts,
  renderIndex,
  renderResume,
  writeContract,
} from "../src/index.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "conductor-continuity-"));
}

function contract(
  id: string,
  frozenAt: string,
  ask = "Add CSV export to the report table.",
): IntentContract {
  return {
    contract_id: id,
    version: "1.0.0",
    original_ask: ask,
    in_scope: ["CSV export for the report table"],
    out_of_scope: ["New API endpoints"],
    constraints: [],
    acceptance_criteria: [
      { id: "ac-1", description: "CSV downloads from the report table", testable: true },
    ],
    frozen_at: frozenAt,
    frozen_by: "user",
    approval: {
      approved_by: "tester",
      approved_at: frozenAt,
      method: "explicit-flag",
    },
    pivot_log: [],
  };
}

describe("intent continuity", () => {
  it("archives frozen active contracts and lists newest first", () => {
    const dir = tmpProject();
    const older = contract("ic-20260701-aaaaaa", "2026-07-01T10:00:00.000Z");
    const newer = contract("ic-20260702-bbbbbb", "2026-07-02T10:00:00.000Z");

    writeContract(dir, older);
    writeContract(dir, newer);

    const archived = listContracts(dir);
    expect(archived.map((c) => c.contract_id)).toEqual([
      "ic-20260702-bbbbbb",
      "ic-20260701-aaaaaa",
    ]);
    expect(archivedContractPath(dir, older.contract_id)).toContain(
      ".conductor/contracts/ic-20260701-aaaaaa.yaml",
    );
  });

  it("renders index and resume from real active/history data", () => {
    const dir = tmpProject();
    const active = contract("ic-20260703-cccccc", "2026-07-03T10:00:00.000Z");
    writeContract(dir, active);

    const index = renderIndex(dir);
    expect(index).toContain("## Active");
    expect(index).toContain("ic-20260703-cccccc");
    expect(index).toContain("## Recent contracts");

    const resume = renderResume(dir);
    expect(resume).toContain("# Session brief");
    expect(resume).toContain("CSV export for the report table");
  });

  it("records an acknowledged pivot and updates active scope", () => {
    const active = contract("ic-20260704-dddddd", "2026-07-04T10:00:00.000Z");

    const updated = addPivot(active, {
      change: "Also include keyboard shortcut support",
      reason: "User clarified accessibility requirement",
      acknowledged: true,
      in_scope_added: ["Keyboard shortcut triggers CSV export"],
      out_of_scope_added: ["Bulk export of all reports"],
    });

    expect(updated.in_scope).toContain("Keyboard shortcut triggers CSV export");
    expect(updated.out_of_scope).toContain("Bulk export of all reports");
    expect(updated.pivot_log[0].acknowledged_by).toBe("user");
    expect(updated.pivot_log[0].updates?.in_scope_added).toEqual([
      "Keyboard shortcut triggers CSV export",
    ]);
  });

  it("scores current changes against a prior archived contract", () => {
    const previous = contract("ic-20260701-eeeeee", "2026-07-01T10:00:00.000Z");
    const current = {
      ...contract("ic-20260704-ffffff", "2026-07-04T10:00:00.000Z"),
      in_scope: ["CSV export through a new API endpoint"],
      out_of_scope: [],
    };

    const result = crossSessionDrift(previous, current, {
      changedPaths: ["src/app/api/export/route.ts"],
      signals: ["added new api endpoint for export"],
    });

    expect(result.previous.action).toBe("soft_block");
    expect(result.current.action).toBe("proceed");
    expect(result.findings.some((f) => /Prior contract/.test(f))).toBe(true);
  });

  it("reads a manually archived contract", () => {
    const dir = tmpProject();
    const active = contract("ic-20260704-gggggg", "2026-07-04T10:00:00.000Z");
    const path = archiveContract(dir, active);

    expect(path).toContain("ic-20260704-gggggg.yaml");
    expect(listContracts(dir)[0].contract_id).toBe("ic-20260704-gggggg");
  });
});
