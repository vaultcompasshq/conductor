// One run across every enabled gate.

import { type Finding, compareFindings } from './envelope.js';
import { EXIT_COULD_NOT_RUN, composeExitCode } from './exit-codes.js';
import {
  type GateOutcome,
  gateProgramRefused,
  preparationFailed,
  refuseHeadControlledBinary,
  runGate,
} from './gate-runner.js';
import { resolveBaseRef } from './intent-base.js';
import {
  type IntentPreparation,
  frozenNativeContractPath,
  prepareIntent,
} from './intent-prepare.js';
import type { GatePolicy, GateRole, GateStage, Policy, Product } from './policy.js';
import { GATE_ROLES, enabledGates, runsAtStage } from './policy.js';
import { ResolveError, resolveGateBinary } from './resolve.js';
import { POLICY_PROPOSAL_LINE } from './trust-base.js';

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

/**
 * One control input this pull request proposes to change.
 *
 * A statement about CONFIGURATION, never a finding. It carries no severity,
 * no fingerprint and no blocking flag, it is not in `findings`, and nothing
 * here reaches the exit code: a pull request is allowed to propose changing
 * the rules, and the whole of the mechanism is that the proposal does not
 * take effect for the run that carries it. What it must do is be VISIBLE, so
 * a reviewer meets "this pull request also proposes to loosen the gate" as
 * one sentence beside the verdict.
 *
 * `line` is the sentence the gate that owns the control input wrote, carried
 * verbatim. The umbrella writes only its own, about its own policy file.
 */
export interface ControlProposal {
  /** The gate that raised it, or the umbrella for its own policy file. */
  product: Product | 'conductor';
  /** The role that gate fills, or null for the umbrella's own. */
  role: GateRole | null;
  line: string;
}

/**
 * Pull-request mode as the whole run saw it.
 *
 * `policyChanged` is decided in one place, before any gate runs, by comparing
 * the policy file at the base ref with the one at the head commit. It is
 * reported and never acted on: the base ref's policy is the one that ran.
 */
export interface RunTrustBase {
  /** The ref the umbrella took its own policy from. */
  ref: string;
  /** Whether the head commit's own policy file differs from that one. */
  policyChanged: boolean;
  /**
   * Why this ref could not be used at all, or null when it was.
   *
   * A SEPARATE FIELD RATHER THAN AN ABSENT `trustBase`, and it is load-bearing
   * in both renderers. A refusal is the worst outcome this tool has -- nothing
   * was checked, on a run that was supposed to be the gate -- and it has to be
   * the first thing a reader meets rather than something inferred from an exit
   * code. Both reports used to work the number of gates out first, and an
   * inventory naming no gate (every gate `enabled: false` in the head's file,
   * or a head file that will not parse) then printed "no gate ran because none
   * is enabled" in text and `{"runs": []}` in SARIF, with the refusal sentence
   * nowhere. That is reachable on the DEFAULT actions/checkout, which fetches
   * depth 1 and so carries no base ref.
   */
  refusal: string | null;
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
  /** Present only on a pull-request run; null means ordinary mode. */
  trustBase: RunTrustBase | null;
  /**
   * Every control input this pull request proposes to change, the umbrella's
   * own policy file first and then each gate's, in gate order. Empty outside
   * pull-request mode, and empty inside it when nothing was proposed.
   */
  proposals: ControlProposal[];
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
   * Pull-request mode. The policy this run was handed was ALREADY read from
   * this ref by the caller: `runAll` does not read it, because the policy has
   * to be parsed before there is a run to configure. What this carries is the
   * ref, so it can be passed down to every child that can take it, and the
   * one fact the caller established while reading it.
   */
  trustBase?: RunTrustBase;
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
  /**
   * Where the intent gate's per-run temporary project is created. Injected
   * in tests so the one that counts leaked directories counts its own and
   * not another jest worker's; nothing in production passes it. See
   * IntentPrepareOptions.tempRoot.
   */
  tempRoot?: string;
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

/**
 * The intent-guard binary, or null when there is none to prepare with.
 *
 * SAME SKIP AS runGate's, and it is not decoration: preparation SPAWNS this
 * binary, before runGate has looked at anything. Resolving it out of
 * node_modules on a pull-request run would execute a program the head chose,
 * three times, before the program check the boundary rests on had run once.
 */
function intentBinary(gate: GatePolicy, options: RunOptions) {
  try {
    return resolveGateBinary(gate, options.repoRoot, options.pathValue, {
      skipNodeModules: options.trustBase !== undefined,
    });
  } catch (err) {
    // A ResolveError means the policy named a command that is not there.
    // runGate reports that properly; preparation just has nothing to run.
    if (err instanceof ResolveError) {
      return null;
    }
    return null;
  }
}

/**
 * The three lists a stage filter and a `--gate` flag produce between them.
 *
 * Factored out because the trust-base refusal below needs the same partition:
 * a run that could not read its policy from the base ref still has to report
 * the gates it did not run and the stage each of them sits at, or the report
 * of the most serious failure this tool has is thinner than the report of an
 * ordinary one.
 */
function partitionGates(
  policy: Policy,
  requested: GateStage | undefined
): { gates: GatePolicy[]; deferred: DeferredGate[]; excluded: ExcludedGate[] } {
  const enabled = enabledGates(policy);

  // Partitioned before anything is spawned, and before any binary is even
  // looked for: a gate that will not run at this stage must not be able to
  // fail the run by being uninstalled here. An intent gate that lives only
  // on the CI image is the ordinary case, not an error.
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
  const excluded: ExcludedGate[] = GATE_ROLES.map((role) => policy.gates[role])
    .filter((gate): gate is GatePolicy => gate !== undefined && gate.excludedByCli)
    .map((gate) => ({ role: gate.role, product: gate.product }));

  return { gates, deferred, excluded };
}

/**
 * The run that never happened, because the trust base could not be judged
 * against.
 *
 * EVERY ENABLED GATE IS COULD-NOT-RUN, which is the fail-closed half of
 * pull-request mode. A base ref that will not resolve is not a reason to fall
 * back to the head's policy: falling back to the head is the behaviour this
 * release removes, and it would be reachable by anybody who could make the
 * base ref unfetchable.
 *
 * TWO THINGS HERE ARE DELIBERATELY NOT READ OFF THE POLICY, and both are the
 * point rather than shortcuts. The policy handed in is the HEAD's, used only
 * as an inventory so the report can name the gates that did not run; it
 * cannot be trusted, so:
 *
 *  - Every synthesized outcome is ENFORCED, whatever the file says. The
 *    `enforce` flag is itself a control input, and the file it lives in is
 *    the one that could not be read from the base. A head policy setting
 *    `enforce: false` everywhere must not be able to turn this into exit 0.
 *  - The exit code is written here rather than composed. A head policy
 *    enabling NO gate at all would otherwise compose to 0 over an empty list,
 *    which would report a run that checked nothing as a clean one.
 */
export function refusedTrustBase(
  policy: Policy,
  ref: string,
  detail: string,
  options: { stage?: GateStage; now?: () => Date }
): RunResult {
  const { gates, deferred, excluded } = partitionGates(policy, options.stage);
  const outcomes = gates.map((gate) =>
    preparationFailed({ ...gate, enforce: true }, `the trust base could not be used: ${detail}`)
  );
  const findings = outcomes.flatMap((outcome) => outcome.findings).sort(compareFindings);

  const byProduct: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const finding of findings) {
    byProduct[finding.product] = (byProduct[finding.product] ?? 0) + 1;
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  }

  return {
    schemaVersion: 1,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    gates: outcomes,
    deferred,
    skipped: [],
    excluded,
    findings,
    // policyChanged is unknowable: the base side of the comparison is the
    // thing that could not be read. False rather than a third state, because
    // no proposal is reported on a run where nothing was judged. The refusal
    // itself is carried, and it is what both renderers lead with.
    trustBase: { ref, policyChanged: false, refusal: detail },
    proposals: [],
    summary: {
      blocking: findings.filter((finding) => finding.blocking).length,
      byProduct,
      bySeverity,
    },
    exitCode: EXIT_COULD_NOT_RUN,
  };
}

/**
 * Every proposed control change, the umbrella's own policy first.
 *
 * The umbrella's line comes first because it is the one that decides what the
 * others even are: a pull request that rewrites `.guardrails.yaml` is
 * proposing to change which gates run at all, and reading that after a gate's
 * own contract line would bury it.
 */
function collectProposals(
  outcomes: GateOutcome[],
  trustBase: RunTrustBase | undefined
): ControlProposal[] {
  const proposals: ControlProposal[] = [];
  if (trustBase?.policyChanged === true) {
    proposals.push({ product: 'conductor', role: null, line: POLICY_PROPOSAL_LINE });
  }
  for (const outcome of outcomes) {
    for (const line of outcome.trustBase?.proposals ?? []) {
      proposals.push({ product: outcome.product, role: outcome.role, line });
    }
  }
  return proposals;
}

/**
 * The `intentContract` option for a run with no preparation, or nothing.
 *
 * A small helper rather than an inline conditional because the spread at the
 * call site is already three lines, and because "nothing" has to be an empty
 * object rather than an undefined property: the option is optional and
 * `exactOptionalPropertyTypes` refuses an explicit undefined.
 */
function nativeContractOption(repoRoot: string): { intentContract?: string } {
  const contract = frozenNativeContractPath(repoRoot);
  return contract === null ? {} : { intentContract: contract };
}

export function runAll(policy: Policy, options: RunOptions): RunResult {
  const { gates, deferred, excluded } = partitionGates(policy, options.stage);

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
          // BEFORE ANYTHING IS SPAWNED, and that ordering is the whole of it.
          // runGate makes this check for every other gate and makes it first;
          // for this one the preparation gets there earlier and runs the gate
          // three times, so the check has to be made here as well or the
          // boundary begins after the program the pull request chose has
          // already run. Same builder as runGate's, so the enforce override
          // cannot drift between the two places that produce this outcome.
          const trustBaseRef = options.trustBase?.ref;
          if (trustBaseRef !== undefined) {
            const refusal = refuseHeadControlledBinary(options.repoRoot, trustBaseRef, binary);
            if (refusal !== null) {
              outcomes.push(gateProgramRefused(gate, trustBaseRef, refusal, binary));
              continue;
            }
          }

          const prepared = prepareIntent({
            repoRoot: options.repoRoot,
            binary,
            env,
            ...(options.base === undefined ? {} : { base: options.base }),
            ...(options.spec === undefined ? {} : { spec: options.spec }),
            ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
            ...(options.tempRoot === undefined ? {} : { tempRoot: options.tempRoot }),
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
                // ENFORCED under a trust base, by the same argument as
                // `refusedTrustBase` below: `enforce` is itself a control
                // input, this gate produced no findings for it to be a
                // decision about, and a pull-request run where the intent
                // gate could not be prepared is one where nothing judged the
                // intent. Reading the flag here let a base policy with
                // enforce: false report the failure and still exit 0.
                trustBaseRef === undefined ? gate : { ...gate, enforce: true },
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
          // For a run with no preparation: which contract the child will read
          // out of the repository itself. Looked up only for the gate it is
          // about, so no other gate pays for the two stat calls.
          ...(intent !== undefined || gate.role !== 'intent'
            ? {}
            : nativeContractOption(options.repoRoot)),
          // Offered to every child. runGate decides which ones can take it,
          // so a gate with no pull-request mode yet is not handed a flag it
          // would reject, and the reason it was withheld is on the outcome.
          ...(options.trustBase === undefined ? {} : { trustBase: options.trustBase.ref }),
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
    trustBase: options.trustBase ?? null,
    proposals: collectProposals(outcomes, options.trustBase),
    summary: {
      blocking: findings.filter((finding) => finding.blocking).length,
      byProduct,
      bySeverity,
    },
    exitCode,
  };
}
