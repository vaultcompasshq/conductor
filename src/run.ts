// One run across every enabled gate.

import { type Finding, compareFindings } from './envelope.js';
import { composeExitCode } from './exit-codes.js';
import { type GateOutcome, runGate } from './gate-runner.js';
import type { GateRole, GateStage, Policy, Product } from './policy.js';
import { enabledGates, runsAtStage } from './policy.js';

/**
 * An enabled gate the stage filter held back.
 *
 * Recorded rather than dropped. A gate that is switched on and did not run
 * has to be visible somewhere, or a run at `commit` reads exactly like a
 * run that checked everything, which is the confusion this whole family
 * exists to prevent. It is deliberately NOT a GateOutcome: no binary was
 * looked for, nothing was spawned, and there is no exit code to report.
 */
export interface DeferredGate {
  role: GateRole;
  product: Product;
  /** The earliest stage at which this gate will run. */
  stage: GateStage;
}

export interface RunResult {
  schemaVersion: 1;
  generatedAt: string;
  gates: GateOutcome[];
  /** Enabled gates the requested stage held back. Empty with no --stage. */
  deferred: DeferredGate[];
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
  /**
   * Which stopping point this run is. Absent means every enabled gate runs,
   * which is what v0.1 did and what a bare `conductor run` still does.
   */
  stage?: GateStage;
  /** Injected in tests so a run's output is comparable between runs. */
  now?: () => Date;
}

export function runAll(policy: Policy, options: RunOptions): RunResult {
  const enabled = enabledGates(policy);

  // Partitioned before anything is spawned, and before any binary is even
  // looked for: a gate that will not run at this stage must not be able to
  // fail the run by being uninstalled here. An intent gate that lives only
  // on the CI image is the ordinary case, not an error.
  const requested = options.stage;
  const gates =
    requested === undefined ? enabled : enabled.filter((gate) => runsAtStage(gate.stage, requested));
  const deferred: DeferredGate[] =
    requested === undefined
      ? []
      : enabled
          .filter((gate) => !runsAtStage(gate.stage, requested))
          .map((gate) => ({ role: gate.role, product: gate.product, stage: gate.stage }));

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
    deferred,
    findings,
    summary: {
      blocking: findings.filter((finding) => finding.blocking).length,
      byProduct,
      bySeverity,
    },
    exitCode,
  };
}
