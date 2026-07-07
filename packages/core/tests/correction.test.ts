import { describe, it, expect } from "vitest";
import type { IntentContract } from "@vaultcompass/conductor-schema";
import { assertValidIntentContract } from "@vaultcompass/conductor-schema";
import { addCorrection, acknowledgedCorrections } from "../src/correction.js";
import { buildBrief, renderBriefMarkdown } from "../src/brief.js";

const base: IntentContract = {
  contract_id: "ic-20260624-corr01",
  version: "1.0.0",
  original_ask: "Build a settings page with a theme toggle.",
  in_scope: ["Theme toggle on settings page"],
  out_of_scope: ["Server-side sync"],
  constraints: [],
  acceptance_criteria: [
    { id: "ac-1", description: "Toggle persists across reloads", testable: true },
  ],
  frozen_at: "2026-06-24T10:00:00Z",
  frozen_by: "user",
  pivot_log: [],
};

describe("addCorrection", () => {
  it("appends a pending correction by default and does not promote", () => {
    const out = addCorrection(base, {
      wrong: "fetched data inside the component",
      right: "use a useThemePreference hook",
      rule: "Never fetch in components; use a hook",
    });
    expect(out.correction_log).toHaveLength(1);
    expect(out.correction_log![0].id).toBe("cl-1");
    expect(out.correction_log![0].acknowledged_by).toBe("pending");
    expect(out.constraints).toHaveLength(0);
    assertValidIntentContract(out);
  });

  it("promotes to a user-correction constraint when acknowledged + promote", () => {
    const out = addCorrection(base, {
      wrong: "fetched in the component",
      right: "used a hook",
      rule: "Never fetch in components; use a hook",
      acknowledged: true,
      promote: true,
    });
    expect(out.correction_log![0].acknowledged_by).toBe("user");
    expect(out.correction_log![0].promoted_to_constraint).toBe(true);
    expect(out.constraints).toHaveLength(1);
    expect(out.constraints[0].source).toBe("user-correction");
    expect(out.constraints[0].priority).toBe("high");
    assertValidIntentContract(out);
  });

  it("ignores promote when not acknowledged", () => {
    const out = addCorrection(base, {
      wrong: "x", right: "y", rule: "Some rule here", promote: true,
    });
    expect(out.correction_log![0].promoted_to_constraint).toBe(false);
    expect(out.constraints).toHaveLength(0);
  });

  it("increments ids and is append-only", () => {
    const one = addCorrection(base, { wrong: "a", right: "b", rule: "Rule one here" });
    const two = addCorrection(one, { wrong: "c", right: "d", rule: "Rule two here" });
    expect(two.correction_log!.map((c) => c.id)).toEqual(["cl-1", "cl-2"]);
  });
});

describe("buildBrief / renderBriefMarkdown", () => {
  it("includes only acknowledged corrections", () => {
    let c = addCorrection(base, { wrong: "a", right: "b", rule: "Pending rule here" });
    c = addCorrection(c, {
      wrong: "c", right: "d", rule: "Acked rule here", acknowledged: true,
    });
    const brief = buildBrief(c);
    expect(brief.corrections).toHaveLength(1);
    expect(brief.corrections[0].rule).toBe("Acked rule here");
  });

  it("renders markdown with intent and a corrections section", () => {
    const c = addCorrection(base, {
      wrong: "fetched in component",
      right: "use a hook",
      rule: "Never fetch in components",
      acknowledged: true,
    });
    const md = renderBriefMarkdown(c);
    expect(md).toContain("# Session brief — ic-20260624-corr01");
    expect(md).toContain("## Intent");
    expect(md).toContain("Corrections (do NOT repeat these mistakes)");
    expect(md).toContain("Never fetch in components");
    // Must NOT leak failed-attempt code; only the distilled rule + wrong/right.
    expect(md).not.toContain("```");
  });
});
