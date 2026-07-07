import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addCorrection } from "../src/correction.js";
import { freezeContract, writeContract } from "../src/contract-store.js";
import { draftContract } from "../src/extract.js";
import {
  buildConductorReport,
  renderConductorReportMarkdown,
} from "../src/report.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "conductor-report-"));
}

function frozenContract() {
  const draft = draftContract({
    userText:
      "Add README usage documentation. Do not change source code or package metadata. Verify README includes one usage example.",
  });
  return freezeContract(
    addCorrection(draft, {
      wrong: "changed source code",
      right: "only edit README",
      rule: "Do not change source code for documentation-only asks",
      acknowledged: true,
    }),
    { approvedBy: "tester" },
  );
}

describe("conductor report", () => {
  it("renders an ok handoff report for aligned staged work", () => {
    const dir = tmpProject();
    writeContract(dir, frozenContract());

    const report = buildConductorReport(dir, {
      signals: {
        changedPaths: ["README.md"],
        signals: ["README documentation update"],
      },
    });
    const markdown = renderConductorReportMarkdown(report);

    expect(report.status).toBe("ok");
    expect(report.exitCode).toBe(0);
    expect(report.contract?.approved_by).toBe("tester");
    expect(report.acceptance_coverage.some((item) => item.status === "covered")).toBe(true);
    expect(markdown).toContain("# Conductor report");
    expect(markdown).toContain("Recommendation: Proceed with normal review.");
    expect(markdown).toContain("acknowledged");
  });

  it("blocks and explains out-of-scope package drift", () => {
    const dir = tmpProject();
    writeContract(dir, frozenContract());

    const report = buildConductorReport(dir, {
      signals: {
        changedPaths: ["package.json"],
      },
    });

    expect(report.status).toBe("blocked");
    expect(report.exitCode).toBe(1);
    expect(report.gate.drift?.action).toBe("soft_block");
    expect(report.recommendation).toMatch(/resolve the drift/i);
  });
});
