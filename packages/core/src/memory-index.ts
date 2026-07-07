import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IntentContract } from "@vaultcompass/conductor-schema";
import { acknowledgedCorrections } from "./correction.js";
import { conductorDir, readContract } from "./contract-store.js";
import { listContracts } from "./history.js";
import { renderBriefMarkdown } from "./brief.js";

export const INDEX_FILE = "index.md";

function bullet(text: string): string {
  return `- ${text}`;
}

function summarizeContract(contract: IntentContract): string {
  const approved = contract.approval?.approved_by
    ? `, approved by ${contract.approval.approved_by}`
    : "";
  const state = contract.approval ? "frozen" : "draft";
  return `[intent-contract.yaml](./intent-contract.yaml) — ${contract.original_ask} (${contract.contract_id}, ${state} ${contract.frozen_at}${approved})`;
}

export function renderIndex(projectRoot: string): string {
  const active = readContract(projectRoot);
  const archived = listContracts(projectRoot).slice(0, 8);
  const lines: string[] = ["# Conductor Index", ""];

  lines.push("## Active");
  if (active) {
    lines.push(bullet(summarizeContract(active)));
  } else {
    lines.push(
      "- No frozen contract yet — run conductor-extract, review, then conductor-freeze",
    );
  }

  lines.push("", "## Recent contracts");
  if (archived.length > 0) {
    for (const c of archived) {
      const approved = c.approved_by ? `, approved by ${c.approved_by}` : "";
      lines.push(
        bullet(
          `[${c.contract_id}](./contracts/${c.contract_id}.yaml) — ${c.original_ask} (frozen ${c.frozen_at}${approved})`,
        ),
      );
    }
  } else {
    lines.push("- none");
  }

  lines.push("", "## Constraints");
  if (active && active.constraints.length > 0) {
    const seen = new Set<string>();
    for (const c of active.constraints) {
      const source = c.file_path ?? c.source;
      const item = `${source} — ${c.priority}`;
      if (!seen.has(item)) {
        lines.push(bullet(item));
        seen.add(item);
      }
    }
  } else {
    lines.push("- Loaded from AGENTS.md, CLAUDE.md, GEMINI.md, .cursor/rules when present");
  }

  lines.push("", "## Recent pivots");
  const pivots = active?.pivot_log.slice(-5).reverse() ?? [];
  if (pivots.length > 0) {
    for (const pivot of pivots) {
      lines.push(
        bullet(
          `${pivot.timestamp} — ${pivot.change} (${pivot.acknowledged_by})`,
        ),
      );
    }
  } else {
    lines.push("- none");
  }

  lines.push("", "## Acknowledged corrections");
  const corrections = active ? acknowledgedCorrections(active).slice(-8) : [];
  if (corrections.length > 0) {
    for (const correction of corrections) {
      lines.push(bullet(`${correction.id}: ${correction.rule}`));
    }
  } else {
    lines.push("- none");
  }

  return `${lines.join("\n")}\n`;
}

export function writeIndex(projectRoot: string): string {
  const dir = conductorDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, INDEX_FILE);
  writeFileSync(path, renderIndex(projectRoot), "utf8");
  return path;
}

export function renderResume(projectRoot: string): string | null {
  const active = readContract(projectRoot);
  if (!active) return null;

  const archived = listContracts(projectRoot)
    .filter((c) => c.contract_id !== active.contract_id)
    .slice(0, 3);
  const lines = [renderBriefMarkdown(active)];

  if (archived.length > 0) {
    lines.push("", "## Recent prior contracts");
    for (const contract of archived) {
      lines.push(
        bullet(
          `${contract.contract_id} — ${contract.original_ask} (frozen ${contract.frozen_at})`,
        ),
      );
    }
  }

  return lines.join("\n");
}
