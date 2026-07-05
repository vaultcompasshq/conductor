import { DRIFT_THRESHOLDS, type DriftAction } from "./rubric.js";

export interface DriftThresholds {
  info: number;
  warn: number;
  soft_block: number;
  hard_block: number;
}

export interface ConductorConfig {
  version: string;
  drift: {
    mode: "handoff" | "file_write" | "every_turn";
    thresholds: DriftThresholds;
    hard_block_on_critical_constraints: boolean;
  };
  coach: {
    show_when_score_below: number;
    patterns_enabled: "all" | string[];
  };
  constraints: {
    priority_order: string[];
  };
  files: {
    active_contract: string;
    contracts_dir: string;
    drift_log: string;
  };
  integrations: {
    superpowers: {
      require_contract_before: string[];
    };
    downstream_pipeline: {
      enabled: boolean;
      issue_tracker_team_id: string | null;
    };
  };
}

export const DEFAULT_CONDUCTOR_CONFIG: ConductorConfig = {
  version: "1.0.0",
  drift: {
    mode: "handoff",
    thresholds: { ...DRIFT_THRESHOLDS },
    hard_block_on_critical_constraints: true,
  },
  coach: {
    show_when_score_below: 60,
    patterns_enabled: "all",
  },
  constraints: {
    priority_order: [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      "cursor-rules",
      "project-spec",
    ],
  },
  files: {
    active_contract: "intent-contract.yaml",
    contracts_dir: "contracts",
    drift_log: "drift-log.jsonl",
  },
  integrations: {
    superpowers: {
      require_contract_before: ["brainstorming", "test-driven-development"],
    },
    downstream_pipeline: {
      enabled: false,
      issue_tracker_team_id: null,
    },
  },
};

export function driftActionForScore(
  overall: number,
  thresholds: DriftThresholds,
): DriftAction {
  if (overall >= thresholds.hard_block) return "hard_block";
  if (overall >= thresholds.soft_block) return "soft_block";
  if (overall >= thresholds.warn) return "warn";
  if (overall >= thresholds.info) return "info";
  return "proceed";
}

function mergeThresholds(raw: Partial<DriftThresholds>): DriftThresholds {
  return {
    info: raw.info ?? DRIFT_THRESHOLDS.info,
    warn: raw.warn ?? DRIFT_THRESHOLDS.warn,
    soft_block: raw.soft_block ?? DRIFT_THRESHOLDS.soft_block,
    hard_block: raw.hard_block ?? DRIFT_THRESHOLDS.hard_block,
  };
}

export function mergeConductorConfig(raw: Partial<ConductorConfig>): ConductorConfig {
  return {
    version: raw.version ?? DEFAULT_CONDUCTOR_CONFIG.version,
    drift: {
      mode: raw.drift?.mode ?? DEFAULT_CONDUCTOR_CONFIG.drift.mode,
      thresholds: mergeThresholds(raw.drift?.thresholds ?? {}),
      hard_block_on_critical_constraints:
        raw.drift?.hard_block_on_critical_constraints ??
        DEFAULT_CONDUCTOR_CONFIG.drift.hard_block_on_critical_constraints,
    },
    coach: {
      show_when_score_below:
        raw.coach?.show_when_score_below ??
        DEFAULT_CONDUCTOR_CONFIG.coach.show_when_score_below,
      patterns_enabled:
        raw.coach?.patterns_enabled ??
        DEFAULT_CONDUCTOR_CONFIG.coach.patterns_enabled,
    },
    constraints: {
      priority_order:
        raw.constraints?.priority_order ??
        DEFAULT_CONDUCTOR_CONFIG.constraints.priority_order,
    },
    files: {
      active_contract:
        raw.files?.active_contract ?? DEFAULT_CONDUCTOR_CONFIG.files.active_contract,
      contracts_dir:
        raw.files?.contracts_dir ?? DEFAULT_CONDUCTOR_CONFIG.files.contracts_dir,
      drift_log: raw.files?.drift_log ?? DEFAULT_CONDUCTOR_CONFIG.files.drift_log,
    },
    integrations: {
      superpowers: {
        require_contract_before:
          raw.integrations?.superpowers?.require_contract_before ??
          DEFAULT_CONDUCTOR_CONFIG.integrations.superpowers.require_contract_before,
      },
      downstream_pipeline: {
        enabled:
          raw.integrations?.downstream_pipeline?.enabled ??
          DEFAULT_CONDUCTOR_CONFIG.integrations.downstream_pipeline.enabled,
        issue_tracker_team_id:
          raw.integrations?.downstream_pipeline?.issue_tracker_team_id ??
          DEFAULT_CONDUCTOR_CONFIG.integrations.downstream_pipeline.issue_tracker_team_id,
      },
    },
  };
}
