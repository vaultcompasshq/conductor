import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importSpecContract } from "../src/spec-bridge.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "conductor-spec-bridge-"));
}

describe("spec bridge", () => {
  it("imports a Spec Kit spec directory into an unfrozen contract", () => {
    const dir = tmpProject();
    const specDir = join(dir, "specs", "photo-albums");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, "spec.md"),
      [
        "# Photo albums",
        "- Build album grouping by date",
        "- Users can drag photos between albums",
        "- Albums must never be nested inside other albums",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(specDir, "plan.md"),
      "- Use local SQLite metadata storage\n- Avoid uploading images\n",
      "utf8",
    );
    writeFileSync(
      join(specDir, "tasks.md"),
      "- [ ] Create album list\n- [ ] Test drag and drop reorder\n",
      "utf8",
    );

    const imported = importSpecContract(dir, { format: "spec-kit" });

    expect(imported.format).toBe("spec-kit");
    expect(imported.files.map((file) => file.role)).toEqual([
      "requirements",
      "design",
      "tasks",
    ]);
    expect(imported.contract.frozen_by).toBeUndefined();
    expect(imported.contract.original_ask).toMatch(/Import spec-kit spec/);
    expect(imported.contract.in_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/album grouping/i),
        expect.stringMatching(/drag photos/i),
      ]),
    );
    expect(imported.contract.out_of_scope).toEqual(
      expect.arrayContaining([expect.stringMatching(/never be nested/i)]),
    );
  });

  it("imports Kiro requirements/design/tasks from an explicit spec directory", () => {
    const dir = tmpProject();
    const specDir = join(dir, ".kiro", "specs", "billing-export");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, "requirements.md"),
      [
        "# Requirements",
        "WHEN a manager exports billing, THE SYSTEM SHALL include invoice totals.",
        "THE SYSTEM SHALL NOT expose customer payment tokens.",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(specDir, "design.md"),
      "Use the existing export service and avoid new API routes.",
      "utf8",
    );
    writeFileSync(
      join(specDir, "tasks.md"),
      "- [ ] Add billing export column\n- [ ] Verify invoice totals\n",
      "utf8",
    );

    const imported = importSpecContract(dir, {
      format: "kiro",
      specDir: ".kiro/specs/billing-export",
    });

    expect(imported.format).toBe("kiro");
    expect(imported.files).toHaveLength(3);
    expect(imported.contract.acceptance_criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: expect.stringMatching(/invoice totals/i),
        }),
      ]),
    );
    expect(imported.contract.out_of_scope).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/not expose customer payment tokens/i),
      ]),
    );
  });
});
