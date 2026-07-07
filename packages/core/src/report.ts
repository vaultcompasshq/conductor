import type {
  AcceptanceCriterion,
  CorrectionLogEntry,
  IntentContract,
  PivotLogEntry,
} from "@vaultcompass/conductor-schema";
import {
  isContractFrozen,
  readContract,
} from "./contract-store.js";
import {
  crossSessionDrift,
  type CrossSessionDriftScore,
  type DriftSignals,
} from "./drift.js";
import { checkGate, type GateResult } from "./gate.js";
import { readArchivedContract } from "./history.js";
import {
  intersectingTokens,
  tokenize,
} from "./tokenize.js";
import {
  scanVaultGuardStaged,
  type VaultGuardScanSummary,
} from "./vault-guard-scan.js";

export type CoverageStatus = "covered" | "unclear";

export interface AcceptanceCoverage {
  id: string;
  description: string;
  testable: boolean;
  status: CoverageStatus;
  matched: string[];
}

export interface ReportContractSummary {
  contract_id: string;
  intent: string;
  frozen: boolean;
  approved_by?: string;
  approved_at?: string;
  in_scope: string[];
  out_of_scope: string[];
}

export interface ConductorReport {
  generated_at: string;
  projectRoot: string;
  status: GateResult["status"];
  exitCode: 0 | 1;
  recommendation: string;
  changed_paths: string[];
  signals: string[];
  user_message?: string;
  contractFound: boolean;
  contractFrozen: boolean;
  contract?: ReportContractSummary;
  gate: GateResult;
  acceptance_coverage: AcceptanceCoverage[];
  pivots: {
    acknowledged: PivotLogEntry[];
    pending: PivotLogEntry[];
  };
  corrections: {
    acknowledged: CorrectionLogEntry[];
    pending: CorrectionLogEntry[];
  };
  crossSessionDrift?: CrossSessionDriftScore;
  vault_guard?: VaultGuardScanSummary;
}

export interface BuildReportOptions {
  requireFrozen?: boolean;
  signals?: DriftSignals;
  previousContract?: string;
  withSecrets?: boolean;
}

function evidenceTokens(signals: DriftSignals): Set<string> {
  const all = new Set<string>();
  for (const path of signals.changedPaths ?? []) {
    for (const token of tokenize(path)) all.add(token);
  }
  for (const signal of signals.signals ?? []) {
    for (const token of tokenize(signal)) all.add(token);
  }
  if (signals.userMessage) {
    for (const token of tokenize(signals.userMessage)) all.add(token);
  }
  return all;
}

function acceptanceCoverage(
  contract: IntentContract | null,
  signals: DriftSignals,
): AcceptanceCoverage[] {
  if (!contract) return [];
  const evidence = evidenceTokens(signals);

  return contract.acceptance_criteria.map((criterion: AcceptanceCriterion) => {
    const criterionTokens = tokenize(criterion.description);
    const matched = intersectingTokens(criterionTokens, evidence);
    return {
      id: criterion.id,
      description: criterion.description,
      testable: criterion.testable,
      status: matched.length > 0 ? "covered" : "unclear",
      matched,
    };
  });
}

function summarizeContract(
  contract: IntentContract | null,
): ReportContractSummary | undefined {
  if (!contract) return undefined;
  return {
    contract_id: contract.contract_id,
    intent: contract.original_ask,
    frozen: isContractFrozen(contract),
    approved_by: contract.approval?.approved_by,
    approved_at: contract.approval?.approved_at,
    in_scope: contract.in_scope,
    out_of_scope: contract.out_of_scope,
  };
}

function recommendation(report: {
  gate: GateResult;
  contract: IntentContract | null;
  signals: DriftSignals;
}): string {
  if (!report.gate.contractFound) {
    return "Draft and approve an Intent Contract before continuing.";
  }
  if (report.gate.contractFound && !report.gate.contractFrozen) {
    return "Review the active draft and freeze it with an explicit approver.";
  }
  if (report.gate.status === "blocked") {
    return "Resolve the drift or record an acknowledged pivot before merging.";
  }
  if (!report.gate.drift) {
    return "No drift input was provided; run with --staged or --paths for a useful report.";
  }
  if (report.gate.drift.action === "warn") {
    return "Review the warnings before merging.";
  }
  return "Proceed with normal review.";
}

export function buildConductorReport(
  projectRoot: string,
  options: BuildReportOptions = {},
): ConductorReport {
  const signals = options.signals ?? {};
  const gate = checkGate(projectRoot, {
    requireFrozen: options.requireFrozen,
    signals,
  });

  let contract: IntentContract | null = null;
  try {
    contract = readContract(projectRoot);
  } catch {
    contract = null;
  }

  const crossSession =
    options.previousContract && contract
      ? (() => {
          const previous = readArchivedContract(projectRoot, options.previousContract!);
          if (!previous) return undefined;
          return crossSessionDrift(previous, contract!, signals);
        })()
      : undefined;

  const corrections = contract?.correction_log ?? [];
  const report: ConductorReport = {
    generated_at: new Date().toISOString(),
    projectRoot,
    status: gate.status,
    exitCode: gate.exitCode,
    recommendation: "",
    changed_paths: signals.changedPaths ?? [],
    signals: signals.signals ?? [],
    user_message: signals.userMessage,
    contractFound: gate.contractFound,
    contractFrozen: gate.contractFrozen,
    contract: summarizeContract(contract),
    gate,
    acceptance_coverage: acceptanceCoverage(contract, signals),
    pivots: {
      acknowledged: (contract?.pivot_log ?? []).filter(
        (pivot) => pivot.acknowledged_by === "user",
      ),
      pending: (contract?.pivot_log ?? []).filter(
        (pivot) => pivot.acknowledged_by !== "user",
      ),
    },
    corrections: {
      acknowledged: corrections.filter(
        (correction) => correction.acknowledged_by === "user",
      ),
      pending: corrections.filter((correction) => correction.acknowledged_by !== "user"),
    },
    crossSessionDrift: crossSession,
  };
  report.recommendation = recommendation({ gate, contract, signals });
  if (options.withSecrets) {
    report.vault_guard = scanVaultGuardStaged(projectRoot);
  }
  return report;
}

function section(lines: string[], title: string, body: string[]): void {
  if (body.length === 0) return;
  lines.push("", `## ${title}`, ...body);
}

function list(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- None"];
}

export function renderConductorReportMarkdown(report: ConductorReport): string {
  const lines: string[] = [
    "# Conductor report",
    "",
    `Status: ${report.status}`,
    `Recommendation: ${report.recommendation}`,
  ];

  if (report.contract) {
    lines.push(
      "",
      "## Active contract",
      `- id: ${report.contract.contract_id}`,
      `- approved: ${report.contract.frozen ? "yes" : "no"}`,
      `- approved by: ${report.contract.approved_by ?? "n/a"}`,
      `- intent: ${report.contract.intent}`,
    );
    section(lines, "In scope", list(report.contract.in_scope));
    section(lines, "Out of scope", list(report.contract.out_of_scope));
  }

  section(lines, "Gate", report.gate.reasons.length > 0
    ? report.gate.reasons.map((reason) => `- ${reason}`)
    : ["- No blocking gate reasons."]);

  if (report.gate.drift) {
    const drift = report.gate.drift;
    lines.push(
      "",
      "## Drift",
      `- score: ${drift.overall}/100`,
      `- action: ${drift.action}`,
      `- scope creep: ${drift.categories.scope_creep}`,
      `- constraint violation: ${drift.categories.constraint_violation}`,
      `- AC divergence: ${drift.categories.ac_divergence}`,
      `- undocumented pivot: ${drift.categories.undocumented_pivot}`,
    );
    section(lines, "Drift findings", list(drift.findings));
  }

  if (report.acceptance_coverage.length > 0) {
    const covered = report.acceptance_coverage.filter(
      (criterion) => criterion.status === "covered",
    ).length;
    lines.push(
      "",
      "## Acceptance criteria",
      `Coverage: ${covered}/${report.acceptance_coverage.length} inferred from paths/signals`,
      ...report.acceptance_coverage.map(
        (criterion) =>
          `- [${criterion.status === "covered" ? "x" : " "}] ${criterion.id}: ${criterion.description}`,
      ),
    );
  }

  section(
    lines,
    "Pivots",
    [
      ...report.pivots.acknowledged.map((pivot) => `- acknowledged: ${pivot.change}`),
      ...report.pivots.pending.map((pivot) => `- pending: ${pivot.change}`),
    ],
  );
  section(
    lines,
    "Corrections",
    [
      ...report.corrections.acknowledged.map(
        (correction) => `- acknowledged: ${correction.rule}`,
      ),
      ...report.corrections.pending.map(
        (correction) => `- pending: ${correction.rule}`,
      ),
    ],
  );

  if (report.crossSessionDrift) {
    lines.push(
      "",
      "## Prior contract",
      `- previous: ${report.crossSessionDrift.previous_contract_id}`,
      `- previous score: ${report.crossSessionDrift.previous.overall}/100 (${report.crossSessionDrift.previous.action})`,
      `- current score: ${report.crossSessionDrift.current.overall}/100 (${report.crossSessionDrift.current.action})`,
      ...list(report.crossSessionDrift.findings),
    );
  }

  section(lines, "Changed paths", list(report.changed_paths));
  section(lines, "Signals", list(report.signals));

  if (report.vault_guard) {
    const scan = report.vault_guard;
    if (!scan.available) {
      section(lines, "Secrets (vault-guard)", [
        `- skipped: ${scan.skipped ?? "vault-guard unavailable"}`,
      ]);
    } else {
      section(lines, "Secrets (vault-guard)", [
        `- version: ${scan.version ?? "unknown"}`,
        `- staged secrets: ${scan.secrets}`,
        `- staged files with matches: ${scan.files}`,
        `- scan exit: ${scan.exitCode}`,
      ]);
    }
  }

  return lines.join("\n");
}
