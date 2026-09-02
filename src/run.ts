// One run across every enabled gate.

import { type Finding, compareFindings } from './envelope.js';
import { composeExitCode } from './exit-codes.js';
import { type GateOutcome, runGate } from './gate-runner.js';
import { type Policy, enabledGates } from './policy.js';

export interface RunResult {
  schemaVersion: 1;
  generatedAt: string;
  gates: GateOutcome[];
  /**
   * Every finding, flat across products, ordered blocking-first. Which gate
   * produced a finding is IN the finding rather than in the structure, so a
   * consumer reads one list instead of three.
   */
  findings: Finding[];
  summary: {
    blocking: number;
    byProduct: Record<string, number>;
    bySeverity: Record<string, number>;
  };
  exitCode: number;
}

export interface RunOptions {
  repoRoot: string;
  staged: boolean;
  pathValue: string;
  timeoutMs?: number;
  /** Injected in tests so a run's output is comparable between runs. */
  now?: () => Date;
}

export function runAll(policy: Policy, options: RunOptions): RunResult {
  const gates = enabledGates(policy);

  // Sequential, not concurrent. Three Node process starts is real overhead
  // in a pre-commit hook and running them at once would hide most of it,
  // but interleaved stderr from three gates is unreadable exactly when a
  // commit has just been refused, and v0.1's job is to be legible. This is
  // the obvious thing to revisit with a measurement rather than a guess.
  const outcomes = gates.map((gate) =>
    runGate(gate, {
      repoRoot: options.repoRoot,
      staged: options.staged,
      pathValue: options.pathValue,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })
  );

  const findings = outcomes.flatMap((outcome) => outcome.findings).sort(compareFindings);

  const byProduct: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const finding of findings) {
    byProduct[finding.product] = (byProduct[finding.product] ?? 0) + 1;
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  }

  const exitCode = composeExitCode(
    outcomes.map((outcome) => ({
      couldNotRun: outcome.couldNotRun,
      exitCode: outcome.exitCode,
      hasBlockingFinding: outcome.findings.some((finding) => finding.blocking),
    }))
  );

  return {
    schemaVersion: 1,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    gates: outcomes,
    findings,
    summary: {
      blocking: findings.filter((finding) => finding.blocking).length,
      byProduct,
      bySeverity,
    },
    exitCode,
  };
}
