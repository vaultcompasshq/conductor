// One run across every enabled gate.

import { type Finding, compareFindings } from './envelope.js';
import { composeExitCode } from './exit-codes.js';
import { type GateOutcome, preparationFailed, runGate } from './gate-runner.js';
import { resolveBaseRef } from './intent-base.js';
import { type IntentPreparation, prepareIntent } from './intent-prepare.js';
import type { GatePolicy, GateRole, GateStage, Policy, Product } from './policy.js';
import { GATE_ROLES, enabledGates, runsAtStage } from './policy.js';
import { ResolveError, resolveGateBinary } from './resolve.js';

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

/**
 * A gate `--gate` left out of this run.
 *
 * Recorded for the same reason a deferred gate is, and it is deliberately the
 * same shape minus the stage: there is no stage at which this one comes back,
 * only another command line. A gate switched on in the policy file that did
 * not run has to be visible somewhere, or a `--gate secrets` run reads exactly
 * like a run that checked the whole policy. It is NOT a GateOutcome for the
 * same reason DeferredGate is not: no binary was looked for, nothing was
 * spawned, and there is no exit code to report.
 */
export interface ExcludedGate {
  role: GateRole;
  product: Product;
}

/**
 * An enabled gate that had nothing to check.
 *
 * Two things produce this today, both of them an intent gate with no frozen
 * contract: a branch with no spec to import (`no-contract`), and a pull
 * request body that waived the spec with a `Spec: none` line
 * (`contract-waived`). Neither is a deferred gate (nobody asked for a
 * different stage), neither is a could-not-run (nothing broke), and neither
 * must ever reach the exit code, enforced or not. A branch that has no spec
 * is a branch this gate has no opinion about, and turning that into a failed
 * build is how a gate gets switched off repository-wide.
 *
 * The reason is carried rather than flattened because the two ask different
 * things of a reader: one wants a spec written, the other says a person
 * already decided there is none. It is also the second half of the
 * notification id in the SARIF log.
 */
export interface SkippedGate {
  role: GateRole;
  product: Product;
  reason: 'no-contract' | 'contract-waived';
  detail: string;
}

export interface RunResult {
  schemaVersion: 1;
  generatedAt: string;
  gates: GateOutcome[];
  /** Enabled gates the requested stage held back. Empty with no --stage. */
  deferred: DeferredGate[];
  /** Enabled gates that ran at this stage and found nothing to check. */
  skipped: SkippedGate[];
  /** Gates the --gate flag left out. Empty with no --gate. */
  excluded: ExcludedGate[];
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
  /** The ref to measure the intent gate's change set against. */
  base?: string;
  /** An explicit spec for the intent gate, outranking every other source. */
  spec?: string;
  /**
   * The environment the pull-request defaults are read from.
   *
   * Injected rather than read off `process`, exactly like `pathValue`, and it
   * defaults to EMPTY rather than to `process.env`. A run is then a function
   * of its arguments: without this, running this package's own suite inside a
   * pull request build would put every gate into the pull-request flow,
   * because Actions sets GITHUB_BASE_REF for the whole job.
   */
  env?: NodeJS.ProcessEnv;
  /** Injected in tests so a run's output is comparable between runs. */
  now?: () => Date;
}

/**
 * Whether this run is the pull-request shaped one.
 *
 * The whole intent-at-pull-request flow engages on a resolved base ref or an
 * explicit `--spec`, and on nothing else. Without one of those, the intent
 * gate keeps exactly the command line v0.1 gave it: a developer running
 * `conductor run` on their own machine has not asked for a contract to be
 * imported, and importing one anyway would change what a local run means
 * without anybody having written that down.
 */
function isPullRequestShaped(options: RunOptions, env: NodeJS.ProcessEnv): boolean {
  if (options.spec !== undefined) {
    return true;
  }
  return resolveBaseRef({ ...(options.base === undefined ? {} : { base: options.base }), env }) !== null;
}

/** The intent-guard binary, or null when there is none to prepare with. */
function intentBinary(gate: GatePolicy, options: RunOptions) {
  try {
    return resolveGateBinary(gate, options.repoRoot, options.pathValue);
  } catch (err) {
    // A ResolveError means the policy named a command that is not there.
    // runGate reports that properly; preparation just has nothing to run.
    if (err instanceof ResolveError) {
      return null;
    }
    return null;
  }
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

  // Read off the policy rather than off the enabled list, because these gates
  // are exactly the ones the override took out of it. In role order, so a
  // report's ordering never depends on the order the flags were typed.
  const excluded: ExcludedGate[] = GATE_ROLES.map((role) => policy.gates[role]).filter(
    (gate): gate is GatePolicy => gate !== undefined && gate.excludedByCli
  ).map((gate) => ({ role: gate.role, product: gate.product }));

  const env = options.env ?? {};
  const skipped: SkippedGate[] = [];
  const cleanups: Array<() => void> = [];

  // Sequential, not concurrent. Three Node process starts is real overhead
  // in a pre-commit hook and running them at once would hide most of it,
  // but interleaved stderr from three gates is unreadable exactly when a
  // commit has just been refused, and v0.1's job is to be legible. This is
  // the obvious thing to revisit with a measurement rather than a guess.
  const outcomes: GateOutcome[] = [];
  try {
    for (const gate of gates) {
      let intent: IntentPreparation | undefined;

      if (gate.role === 'intent' && isPullRequestShaped(options, env)) {
        const binary = intentBinary(gate, options);
        // A gate with no binary is left to runGate, which raises the
        // umbrella's own gate-missing finding. Reporting the same absence
        // twice, once as a failed preparation and once as a missing gate,
        // would read as two problems where there is one.
        if (binary !== null) {
          const prepared = prepareIntent({
            repoRoot: options.repoRoot,
            binary,
            env,
            ...(options.base === undefined ? {} : { base: options.base }),
            ...(options.spec === undefined ? {} : { spec: options.spec }),
            ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          });

          if (prepared.kind === 'skip') {
            skipped.push({
              role: gate.role,
              product: gate.product,
              reason: prepared.reason,
              detail: prepared.detail,
            });
            continue;
          }
          if (prepared.kind === 'failed') {
            outcomes.push(
              preparationFailed(
                gate,
                `the intent gate could not be prepared at the ${prepared.step} step: ${prepared.detail}`
              )
            );
            continue;
          }
          intent = prepared.preparation;
          cleanups.push(prepared.preparation.cleanup);
        }
      }

      outcomes.push(
        runGate(gate, {
          repoRoot: options.repoRoot,
          staged: options.staged,
          pathValue: options.pathValue,
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          ...(intent === undefined ? {} : { intent }),
        })
      );
    }
  } finally {
    // Once every gate has run, and whatever happened while they did. runGate
    // is total and nothing in the loop is expected to throw, which is exactly
    // why the try is worth two lines: the cost of being wrong about that is
    // one leaked directory per pull request on a shared CI runner, with
    // nothing in any report pointing at the cause.
    for (const cleanup of cleanups) {
      cleanup();
    }
  }

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
      enforce: outcome.enforce,
    }))
  );

  return {
    schemaVersion: 1,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    gates: outcomes,
    deferred,
    skipped,
    excluded,
    findings,
    summary: {
      blocking: findings.filter((finding) => finding.blocking).length,
      byProduct,
      bySeverity,
    },
    exitCode,
  };
}
