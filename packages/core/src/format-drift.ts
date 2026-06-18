import type { DriftScore } from "./drift.js";

export function formatDriftMessage(score: DriftScore): string {
  if (score.action === "proceed") return "";

  const header =
    score.action === "hard_block"
      ? "**Drift guard — hard block**"
      : score.action === "soft_block"
        ? "**Drift guard — confirm to continue**"
        : score.action === "warn"
          ? "**Drift guard — warning**"
          : "**Drift guard — trending**";

  const lines = [
    header,
    `Score: ${score.overall}/100 (${score.action})`,
    "",
    "Categories:",
    `- scope creep: ${score.categories.scope_creep}`,
    `- constraint violation: ${score.categories.constraint_violation}`,
    `- AC divergence: ${score.categories.ac_divergence}`,
    `- undocumented pivot: ${score.categories.undocumented_pivot}`,
  ];

  if (score.findings.length > 0) {
    lines.push("", "Findings:", ...score.findings.map((f) => `- ${f}`));
  }

  if (score.action === "soft_block" || score.action === "hard_block") {
    lines.push(
      "",
      "Resolve drift or log an acknowledged pivot in the intent contract before continuing.",
    );
  }

  return lines.join("\n");
}
