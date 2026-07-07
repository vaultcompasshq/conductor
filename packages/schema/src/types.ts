export type ConstraintSource =
  | "AGENTS.md"
  | "CLAUDE.md"
  | "GEMINI.md"
  | "cursor-rules"
  | "continue-rules"
  | "kiro-steering"
  | "user-stated"
  | "user-correction"
  | "superpowers-spec"
  | "project-spec";

export type ConstraintPriority = "critical" | "high" | "medium" | "low";

export interface Constraint {
  source: ConstraintSource;
  rule: string;
  priority: ConstraintPriority;
  file_path?: string;
  line_ref?: string;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  testable: boolean;
}

export interface PivotLogEntry {
  timestamp: string;
  change: string;
  reason?: string;
  acknowledged_by: "user" | "pending";
  updates?: {
    in_scope_added?: string[];
    in_scope_removed?: string[];
    out_of_scope_added?: string[];
  };
}

export interface Approval {
  approved_by: string;
  approved_at: string;
  method?: "interactive" | "explicit-flag" | "forced";
}

export interface CorrectionLogEntry {
  id: string;
  timestamp: string;
  wrong: string;
  right: string;
  rule: string;
  acknowledged_by: "user" | "pending";
  promoted_to_constraint?: boolean;
}

export interface IntentContract {
  contract_id: string;
  version: "1.0.0";
  original_ask: string;
  in_scope: string[];
  out_of_scope: string[];
  constraints: Constraint[];
  acceptance_criteria: AcceptanceCriterion[];
  frozen_at: string;
  frozen_by?: "user" | "conductor" | "agent";
  approval?: Approval;
  prompt_quality?: {
    score: number;
    issues: string[];
    coaching_shown?: boolean;
  };
  pivot_log: PivotLogEntry[];
  correction_log?: CorrectionLogEntry[];
  metadata?: Record<string, string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
