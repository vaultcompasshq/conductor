import type { IntentContract } from "@vaultcompasshq/conductor-schema";
import { acknowledgedCorrections } from "./correction.js";

export interface SessionBrief {
  contract_id: string;
  intent: string;
  in_scope: string[];
  out_of_scope: string[];
  acceptance_criteria: string[];
  constraints: string[];
  corrections: { rule: string; wrong: string; right: string }[];
}

/**
 * The minimal correct-methodology context for a session. Re-inject THIS after a
 * context reset instead of replaying the messy transcript — it carries the
 * distilled lessons (corrections) but none of the failed attempts.
 */
export function buildBrief(contract: IntentContract): SessionBrief {
  return {
    contract_id: contract.contract_id,
    intent: contract.original_ask,
    in_scope: contract.in_scope,
    out_of_scope: contract.out_of_scope,
    acceptance_criteria: contract.acceptance_criteria.map((ac) => ac.description),
    constraints: contract.constraints
      .filter((c) => c.priority === "critical" || c.priority === "high")
      .map((c) => c.rule),
    corrections: acknowledgedCorrections(contract).map((c) => ({
      rule: c.rule,
      wrong: c.wrong,
      right: c.right,
    })),
  };
}

export function renderBriefMarkdown(contract: IntentContract): string {
  const b = buildBrief(contract);
  const lines: string[] = [`# Session brief — ${b.contract_id}`, "", "## Intent", b.intent];

  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push("", `## ${title}`, ...items.map((i) => `- ${i}`));
  };

  section("In scope", b.in_scope);
  section("Out of scope", b.out_of_scope);
  section("Acceptance criteria", b.acceptance_criteria);
  section("Constraints (critical/high)", b.constraints);

  if (b.corrections.length > 0) {
    lines.push("", "## Corrections (do NOT repeat these mistakes)");
    for (const c of b.corrections) {
      lines.push(`- ${c.rule}`, `  - wrong: ${c.wrong}`, `  - right: ${c.right}`);
    }
  }

  return lines.join("\n");
}
