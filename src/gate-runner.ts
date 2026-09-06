// Running one gate as a child process.
//
// Wrapper, not library: nothing here imports any gate's own package. That
// is what keeps the umbrella from taking three exact version pins and
// needing a release of its own every time one of the three ships, and it is
// what makes "this gate ran and exited N, output unparsed" an available
// outcome instead of a build error.
//
// The one non-obvious constraint, and it came from running the tools rather
// than from reading them: the CHILD'S WORKING DIRECTORY MUST BE THE
// REPOSITORY ROOT. vault-guard resolves both its config file and its
// baseline from process.cwd() rather than from the path argument, so a
// child spawned from anywhere else scans the right files with the wrong
// configuration and the wrong baseline, and says nothing about it.
// dep-guard resolves from its path argument and intent-guard from
// --project, so setting cwd correctly is the single approach that is right
// for all three.

import { spawnSync } from 'node:child_process';

import type { Diagnostic, Finding, RunSummary } from './envelope.js';
import { NormalizeError } from './envelope.js';
import {
  normalizeDepGuard,
  normalizeFailedGate,
  normalizeIntentGuard,
  normalizeMisconfiguredGate,
  normalizeMissingGate,
  normalizeUnparseableGate,
  normalizeVaultGuard,
} from './normalize.js';
import type { ContractSource, IntentPreparation } from './intent-prepare.js';
import type { GatePolicy, GateRole, GateStage, Product } from './policy.js';
import { renderOptionFlags } from './policy.js';
import { atLeastVersion, refuseHeadControlledProgram } from './trust-base.js';
import { ResolveError, candidateNames, resolveGateBinary } from './resolve.js';
import type { ResolvedBinary } from './resolve.js';

export type CouldNotRunReason =
  | 'binary-missing'
  | 'configured-command-missing'
  | 'spawn-failed'
  | 'gate-error'
  | 'unparseable-output'
  /**
   * The gate was never spawned because the run could not be set up for it:
   * an unresolvable base ref, or a spec that would not import. Distinct from
   * gate-error on purpose, since the gate itself said nothing at all.
   */
  | 'preparation-failed'
  /**
   * On a pull-request run, the umbrella could not establish that this gate
   * would take its rules from the base ref, so it was not spawned. Raised for
   * a gate in `TRUST_BASE_MIN_VERSION` whose version could not be read.
   * Distinct from `preparation-failed`, which is about the run rather than
   * about this gate, and from `binary-missing`, since the binary was found.
   */
  | 'trust-base-unverified'
  /**
   * On a pull-request run, the gate's PROGRAM is a file the head controls, so
   * it was not run. Its own reason rather than a shape of
   * `trust-base-unverified`, because the two send a reader to different
   * places: one is a packaging problem with the installed gate, and this one
   * is a pull request choosing the program that judges it.
   */
  | 'gate-program-refused';

export interface CouldNotRun {
  reason: CouldNotRunReason;
  detail: string;
}

/**
 * The first version of each gate that understands `--trust-base`.
 *
 * A TABLE rather than a boolean, because the three gates get pull-request
 * mode in three separate releases and the umbrella has to keep working
 * against every combination in the meantime. A product missing from this
 * table has no pull-request mode yet and is never handed the flag; a product
 * in it is handed the flag only when the installed build says it is at least
 * this version. Both directions matter: handing an older build a flag it does
 * not parse makes it exit non-zero with no JSON, which the umbrella correctly
 * reports as could-not-run, so a wrong guess here turns a working repository's
 * pull requests red rather than merely leaving a gate un-hardened.
 *
 * The umbrella is deliberately NOT the place a version pin lives otherwise
 * (nothing here imports any gate's package), and this is the one exception:
 * it is a statement about a command-line flag, which is the only interface
 * this package has to those tools.
 */
export const TRUST_BASE_MIN_VERSION: Partial<Record<Product, string>> = {
  'intent-guard': '1.4.0',
  'vault-guard': '1.7.0',
  // dep-guard is deliberately absent: its pull-request mode is in flight, so
  // it is never offered the flag and is never refused over a version it does
  // not need. An entry here is the whole of adopting a gate into the
  // boundary, so the day it ships this is a one-line change.
};

/**
 * Pull-request mode as it applied to ONE gate.
 *
 * Carried on the outcome rather than worked out again by each reporter,
 * because two different things have to be visible and neither is derivable
 * from the other: whether this gate was actually put into pull-request mode,
 * and what it said about the control inputs the head proposes to change.
 *
 * `withheld` is the half that must never be silent. A gate the umbrella could
 * not put into pull-request mode read its own control inputs out of the tree
 * under judgment, which is the whole hole this release exists to close, and a
 * run where that happened must not look like a run where it did not.
 */
export interface GateTrustBase {
  /** The ref the umbrella took its own policy from, and offered to this gate. */
  ref: string;
  /**
   * Null when the flag was passed; otherwise the reason it was not, for a
   * gate that was never going to be inside the boundary in the first place.
   * The run continues: that gate read its own control inputs from the tree
   * being judged, and the report says so.
   */
  withheld: string | null;
  /**
   * Set when the umbrella could not ESTABLISH that this gate would be in
   * pull-request mode, which is could-not-run rather than a downgrade.
   *
   * The distinction is the whole point and it is not symmetry with
   * `withheld`. A gate outside the table was never going to get the flag, so
   * nothing is unknown about it. A gate INSIDE the table is one this
   * repository expects to be inside the boundary, and a version probe that
   * fails leaves that unestablished for an unexplained reason. Falling back
   * to running it anyway would put it quietly outside the boundary on the
   * exact runs where something is already wrong.
   */
  refused: string | null;
  /** The control-input changes this gate reported as proposed. */
  proposals: string[];
}

/**
 * Whether this gate can be handed `--trust-base`, and why not when it cannot.
 *
 * Exported so the decision can be tested directly rather than only through a
 * spawned child, and so there is exactly one copy of it.
 *
 * THE PROJECT DIRECTORY IS THE FIRST TEST, not the version. The flag names a
 * git ref, and intent-guard resolves it against its own `--project`. On a
 * run with an imported contract that directory is a temporary one the
 * umbrella made, holding a contract and nothing else, with no repository in
 * it: the child would exit 2 on a ref it could not resolve, and the gate that
 * was working a moment ago would report could-not-run. So the flag goes only
 * where `--project` is the repository itself.
 */
export function decideTrustBase(
  gate: GatePolicy,
  intent: IntentPreparation | undefined,
  trustBase: string | undefined,
  productVersion: string | null
): GateTrustBase | undefined {
  if (trustBase === undefined) {
    return undefined;
  }
  const withheld = (reason: string): GateTrustBase => ({
    ref: trustBase,
    withheld: reason,
    refused: null,
    proposals: [],
  });
  const refused = (reason: string): GateTrustBase => ({
    ref: trustBase,
    withheld: null,
    refused: reason,
    proposals: [],
  });

  if (intent !== undefined && intent.contractSource.kind !== 'native') {
    return withheld(
      'the intent gate is running against a contract imported for this run, which lives in a ' +
        'temporary directory with no repository in it, so there is no ref there to read control ' +
        'inputs from. The contract it is judging against came from a spec in the head tree.'
    );
  }

  const minimum = TRUST_BASE_MIN_VERSION[gate.product];
  if (minimum === undefined) {
    return withheld(
      `${gate.product} has no pull-request mode yet, so it read its own configuration from the ` +
        'tree being judged.'
    );
  }

  // An UNREADABLE version is refused, not withheld, and only for a product in
  // the table. The old code folded the two together and interpolated the
  // missing version straight into the sentence, which read "intent-guard
  // reported no version does not understand --trust-base": not a sentence,
  // and it named a version that does not exist. Worse than the wording, it
  // said the gate had been left outside the boundary on purpose when what had
  // actually happened is that the umbrella could not tell.
  if (productVersion === null) {
    return refused(
      `${gate.product} is expected to run in pull-request mode from ${minimum} onwards, and its ` +
        'version could not be read, so the umbrella cannot establish that this gate would take ' +
        'its rules from the base ref. Nothing was checked by it. Running it anyway would put it ' +
        'quietly outside the trust boundary on exactly the runs where something is already wrong.'
    );
  }

  if (!atLeastVersion(productVersion, minimum)) {
    return withheld(
      `${gate.product} ${productVersion} does not understand --trust-base, which arrived in ` +
        `${minimum}, so it read its own control inputs from the tree being judged. Upgrade it to ` +
        'put this gate into pull-request mode.'
    );
  }

  return { ref: trustBase, withheld: null, refused: null, proposals: [] };
}

export interface GateOutcome {
  role: GateRole;
  product: Product;
  /** The stage this gate is configured for, carried so the report can say it. */
  stage: GateStage;
  /**
   * Whether this gate's verdict reaches the exit code. Carried on the
   * outcome rather than looked up again from the policy, so a report never
   * has to be handed the policy file to explain its own exit code.
   */
  enforce: boolean;
  /** From the binary's --version, or null when there was no safe way to ask. */
  productVersion: string | null;
  /** The command line actually run, for the report header. */
  argv: string[];
  binary: ResolvedBinary | null;
  exitCode: number | null;
  durationMs: number;
  couldNotRun: CouldNotRun | null;
  findings: Finding[];
  run: RunSummary;
  /** Problems with the run or the normalization, not with the scanned code. */
  diagnostics: Diagnostic[];
  /** Kept so the report can show why a gate that could not run said no. */
  stderr: string;
  /**
   * Present only on the intent gate, and only for a pull-request shaped run.
   * Where its contract came from and what the change set was measured
   * against: the two facts that decide what the gate's verdict is even about.
   */
  intent?: { contractSource: ContractSource; baseRef: string | null };
  /**
   * Present only on a pull-request run. Whether this gate was put into
   * pull-request mode, and what it said was proposed.
   */
  trustBase?: GateTrustBase;
}

export interface RunGateOptions {
  repoRoot: string;
  staged: boolean;
  /** PATH to search. Injected so tests never depend on the machine. */
  pathValue: string;
  /** Wall-clock limit per gate. */
  timeoutMs?: number;
  /** The contract and change set prepared for the intent gate, when there is one. */
  intent?: IntentPreparation;
  /**
   * The repository's own frozen contract, for a run with NO preparation.
   *
   * A plain `conductor run` never prepares anything, but the intent gate
   * still judges against the contract in the repository, resolved by the
   * child from `--project .`. Recording it makes that visible: the report
   * says which contract, and the SARIF fallback files the gate's own results
   * against the contract they are about rather than against the policy file.
   * Ignored when `intent` is set, which already carries the same fact.
   */
  intentContract?: string;
  /**
   * The ref the umbrella took its own policy from, on a pull-request run.
   * Offered to every child; `decideTrustBase` says which ones can take it.
   */
  trustBase?: string;
}

/**
 * A gate that never got as far as being spawned.
 *
 * The preparation for the intent gate happens before any child process, and
 * a failure there has to compose exactly like any other could-not-run: exit 2
 * for an enforced gate and a note for an unenforced one. So it is expressed
 * as an ordinary GateOutcome rather than as a fourth kind of thing the report
 * would have to learn about.
 */
export function preparationFailed(gate: GatePolicy, detail: string): GateOutcome {
  return {
    role: gate.role,
    product: gate.product,
    stage: gate.stage,
    enforce: gate.enforce,
    productVersion: null,
    argv: [],
    binary: null,
    exitCode: null,
    durationMs: 0,
    stderr: '',
    couldNotRun: { reason: 'preparation-failed', detail },
    findings: [normalizeFailedGate(gate.role, gate.product, detail)],
    run: EMPTY_RUN,
    diagnostics: [],
  };
}

const EMPTY_RUN: RunSummary = {
  failOn: null,
  suppressed: 0,
  ignored: 0,
  diagnostics: [],
  details: {},
};

/**
 * The arguments the umbrella adds, per product.
 *
 * These are the reserved options the policy schema refuses to let a user
 * set, and this is the only place they are written. The passthrough block
 * goes last so a gate's own flags are visible at the end of the command
 * line in the report, where they read as the user's own additions.
 *
 * Exported so a test can DERIVE the flags this writes and hold
 * RESERVED_OPTIONS in policy.ts against them. The two lists are otherwise
 * parallel and hand-maintained, and a flag added here and forgotten there
 * would let a policy file write the same flag a second time, with the winner
 * decided by that gate's own argument parser rather than by anything the
 * user could read in their own policy file.
 */
export function gateArgs(
  gate: GatePolicy,
  staged: boolean,
  intent: IntentPreparation | undefined,
  /**
   * The trust base to hand THIS gate, or undefined. Already decided by
   * `decideTrustBase`; nothing here re-decides it, so a gate that cannot take
   * the flag is never handed one by a second opinion written in this switch.
   */
  trustBase?: string
): string[] {
  const passthrough = renderOptionFlags(gate.options);
  const trust = trustBase === undefined ? [] : ['--trust-base', trustBase];
  switch (gate.product) {
    case 'dep-guard':
      return [...(staged ? ['--staged'] : []), '--format', 'json', ...passthrough];
    case 'vault-guard':
      // No path argument: the CLI defaults it to "." and the umbrella runs
      // with cwd at the repository root anyway. Passing one would also risk
      // a passthrough value being read as the positional.
      //
      // `scan` takes --trust-base from 1.7.0, and on exit 2 it prints one
      // line on stderr and NO document at all, which the could-not-run path
      // above already handles before JSON.parse is reached.
      return [...(staged ? ['--staged'] : []), '-f', 'json', ...trust, ...passthrough];
    case 'intent-guard': {
      if (intent === undefined) {
        return [
          '--project',
          '.',
          ...(staged ? ['--staged'] : []),
          ...trust,
          '--json',
          ...passthrough,
        ];
      }
      // A prepared run replaces --staged entirely rather than adding to it.
      // The two path sources are ADDITIVE in intent-guard, so leaving
      // --staged on would silently widen a pull request's change set with
      // whatever happens to be in the index of the machine running it.
      //
      // --paths is passed even when the branch changed nothing, so the empty
      // set is stated rather than left for the gate to fill in from the
      // index.
      return [
        '--project',
        intent.projectDir,
        ...(intent.paths === null
          ? staged
            ? ['--staged']
            : []
          : ['--paths', intent.paths.join(',')]),
        // Beside --paths on purpose, and they are independent: --trust-base
        // says where the RULES come from, --paths says which paths are
        // judged. A pull-request run passes both.
        ...trust,
        '--json',
        ...passthrough,
      ];
    }
  }
}

/**
 * Asks a binary for its version.
 *
 * Never called for a binary the candidate table marks unsafe to ask: the
 * per-command binaries ignore --version and run the gate instead, so a
 * probe there would have side effects on the user's repository.
 */
function probeVersion(binary: ResolvedBinary, repoRoot: string, timeoutMs: number): string | null {
  if (binary.versionProbe === null) {
    return null;
  }
  const probe = spawnSync(binary.versionProbe.command, binary.versionProbe.argv, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  if (probe.status !== 0 || typeof probe.stdout !== 'string') {
    return null;
  }
  // All three print a bare version string. Take the first line and accept
  // it only if it looks like one, so a future help banner does not end up
  // in a SARIF driver's version field.
  const first = probe.stdout.trim().split('\n')[0]?.trim() ?? '';
  return /^v?\d+\.\d+\.\d+/.test(first) ? first.replace(/^v/, '') : null;
}

function normalizeFor(product: Product, parsed: unknown, version: string | null) {
  switch (product) {
    case 'dep-guard':
      return normalizeDepGuard(parsed, version);
    case 'vault-guard':
      return normalizeVaultGuard(parsed, version);
    case 'intent-guard':
      return normalizeIntentGuard(parsed, version);
  }
}

/**
 * An error's message, never its stack.
 *
 * A stack reaching the terminal puts a local filesystem path in front of a
 * user who cannot act on any of it, and puts one into a report that gets
 * uploaded. The message is the part that says what went wrong.
 */
function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Runs one gate. TOTAL: this never throws.
 *
 * That is a contract, not a hope. The caller maps over the enabled gates in
 * order, so an escaping error does not just lose this gate's report, it
 * loses every gate after it, and it surfaces as a stack trace with exit 1,
 * which the pre-commit hook reports as "a gate blocked". Everything that can
 * go wrong here is a could-not-run for THIS gate, composing to exit 2, with
 * a finding of the umbrella's own saying so.
 */
export function runGate(gate: GatePolicy, options: RunGateOptions): GateOutcome {
  const progress: Omit<GateOutcome, 'couldNotRun' | 'findings' | 'run' | 'diagnostics'> = {
    role: gate.role,
    product: gate.product,
    stage: gate.stage,
    enforce: gate.enforce,
    productVersion: null,
    argv: [],
    binary: null,
    exitCode: null,
    durationMs: 0,
    stderr: '',
    // Carried on every return path below, including the failures: which
    // contract a gate WOULD have used is exactly as interesting when it could
    // not run as when it could.
    ...(options.intent !== undefined
      ? {
          intent: {
            contractSource: options.intent.contractSource,
            baseRef: options.intent.baseRef,
          },
        }
      : options.intentContract === undefined
        ? {}
        : {
            // No preparation, but the repository has a frozen contract and
            // the child will read it from `--project .`. Same shape, and the
            // base is null because nothing was diffed: this run is the index
            // or the working tree, not a branch against a ref.
            intent: {
              contractSource: { kind: 'native' as const, path: options.intentContract },
              baseRef: null,
            },
          }),
  };
  const started = Date.now();

  try {
    return runGateInner(gate, options, started, progress);
  } catch (err) {
    // The backstop. Anything the paths below did not anticipate lands here
    // rather than in the user's terminal.
    const detail = messageOf(err);
    return {
      ...progress,
      durationMs: Date.now() - started,
      couldNotRun: { reason: 'unparseable-output', detail },
      // progress.stderr, because the comment on progress promises exactly
      // this: it is kept current so an unexpected throw still reports which
      // binary ran and what it printed. Leaving it off here made that
      // promise false for the finding, which is the only part of it a
      // published log ever sees.
      findings: [normalizeUnparseableGate(gate.role, gate.product, detail, progress.stderr)],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }
}

function runGateInner(
  gate: GatePolicy,
  options: RunGateOptions,
  started: number,
  progress: Omit<GateOutcome, 'couldNotRun' | 'findings' | 'run' | 'diagnostics'>
): GateOutcome {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const base = progress;

  let binary: ResolvedBinary | null;
  try {
    binary = resolveGateBinary(gate, options.repoRoot, options.pathValue);
  } catch (err) {
    // A ResolveError is the expected shape here; anything else is still a
    // problem with this gate rather than with the run, so it takes the same
    // path instead of being rethrown into the caller's map.
    const detail = err instanceof ResolveError ? err.message : messageOf(err);
    return {
      ...base,
      durationMs: Date.now() - started,
      couldNotRun: { reason: 'configured-command-missing', detail },
      // Only reachable when the policy named a command, since that is the
      // only thing resolution throws over. So the finding names that path
      // and not the candidate list, which was never searched.
      findings: [
        gate.command === undefined
          ? normalizeMissingGate(gate.role, gate.product, candidateNames(gate.product))
          : normalizeMisconfiguredGate(gate.role, gate.product, gate.command, detail),
      ],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  if (binary === null) {
    return {
      ...base,
      durationMs: Date.now() - started,
      couldNotRun: {
        reason: 'binary-missing',
        // Named in resolution order, which is the repository's own copy
        // first. Saying PATH first points a reader at the location this
        // tool prefers second, which is the wrong place to install it.
        detail: `no ${gate.product} binary in node_modules/.bin or on PATH`,
      },
      // A missing enabled gate is a finding of the umbrella's own, never a
      // silent skip. Skipping is how a gate ends up switched on in the
      // policy file and absent in reality for months.
      findings: [normalizeMissingGate(gate.role, gate.product, candidateNames(gate.product))],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  // BEFORE the version probe, and that ordering is the whole of it: the probe
  // RUNS the program, so asking a head-controlled binary for its version is
  // already executing it. A planted stub answering "1.7.0" is the cheapest
  // version of this attack and it would have been run before anything checked
  // where it came from.
  if (options.trustBase !== undefined) {
    const refusal = refuseHeadControlledProgram(
      options.repoRoot,
      options.trustBase,
      binary.program
    );
    if (refusal !== null) {
      return {
        ...base,
        binary,
        durationMs: Date.now() - started,
        // ENFORCED, whatever the policy says. enforce: false is a standing
        // decision about what a gate's FINDINGS are worth, and this gate
        // produced none: the umbrella refused to run a program the pull
        // request chose. Letting an unenforced gate swallow that would let a
        // pull request pick its own judge and keep the run green.
        enforce: true,
        trustBase: { ref: options.trustBase, withheld: null, refused: refusal, proposals: [] },
        couldNotRun: { reason: 'gate-program-refused', detail: refusal },
        findings: [normalizeFailedGate(gate.role, gate.product, refusal)],
        run: EMPTY_RUN,
        diagnostics: [],
      };
    }
  }

  const version = probeVersion(binary, options.repoRoot, timeoutMs);
  // AFTER the version probe and BEFORE the command line is built, because the
  // decision reads the version. That ordering is the whole capability gate:
  // an intent-guard older than 1.4.0 must not be handed a flag it would
  // reject, and a gate IN the table whose version could not be read is
  // refused rather than run outside the boundary.
  const trustBase = decideTrustBase(gate, options.intent, options.trustBase, version);

  if (trustBase !== undefined && trustBase.refused !== null) {
    return {
      ...base,
      productVersion: version,
      binary,
      durationMs: Date.now() - started,
      trustBase,
      couldNotRun: { reason: 'trust-base-unverified', detail: trustBase.refused },
      findings: [normalizeFailedGate(gate.role, gate.product, trustBase.refused)],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  const argv = [
    ...binary.argvPrefix,
    ...gateArgs(
      gate,
      options.staged,
      options.intent,
      trustBase === undefined || trustBase.withheld !== null ? undefined : trustBase.ref
    ),
  ];

  const child = spawnSync(binary.command, argv, {
    cwd: options.repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });

  const withRun = {
    ...base,
    productVersion: version,
    argv,
    binary,
    durationMs: Date.now() - started,
    stderr: child.stderr ?? '',
    // Carried on every return path below, the failures included: WHETHER
    // this gate was in pull-request mode is exactly as interesting when it
    // could not run as when it could, and the withheld reason is the only
    // place a report can say a gate read its own rules out of the tree under
    // judgment.
    ...(trustBase === undefined ? {} : { trustBase }),
  };
  // Keep the backstop's view current, so an unexpected throw below still
  // reports which binary ran and what it printed.
  Object.assign(progress, withRun);

  if (child.error !== undefined) {
    return {
      ...withRun,
      exitCode: null,
      couldNotRun: { reason: 'spawn-failed', detail: child.error.message },
      findings: [
        normalizeFailedGate(gate.role, gate.product, child.error.message, withRun.stderr),
      ],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  const exitCode = child.status;
  const stdout = child.stdout ?? '';

  // dep-guard's 2 means "could not run the checks at all" and it prints no
  // JSON. The other two have no such code, but a signal-killed child or a
  // timeout lands here too, and none of those are a clean result.
  if (exitCode === null || exitCode > 1) {
    const detail =
      exitCode === null
        ? 'the gate did not exit normally (killed, or timed out).'
        : `the gate exited ${exitCode}, which it uses for "could not run".`;
    return {
      ...withRun,
      exitCode,
      couldNotRun: { reason: 'gate-error', detail },
      // The child's own stderr goes with it. The text report prints it from
      // the outcome, but a gate that could not run gets no SARIF run of its
      // own, so this finding is the only place a published log can say what
      // the gate actually complained about.
      findings: [normalizeFailedGate(gate.role, gate.product, detail, withRun.stderr)],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Exit 1 with unparseable stdout is what a rejected config looks like
    // from two of the three products, and it is could-not-run rather than
    // clean. Reporting it as a policy violation would tell the user their
    // code is at fault when their config is.
    const detail =
      `the gate exited ${exitCode} without valid JSON on stdout. ` +
      'A rejected config file looks exactly like this, and it is not a clean result.';
    return {
      ...withRun,
      exitCode,
      couldNotRun: { reason: 'unparseable-output', detail },
      findings: [normalizeUnparseableGate(gate.role, gate.product, detail, withRun.stderr)],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  try {
    const normalized = normalizeFor(gate.product, parsed, version);
    return {
      ...withRun,
      exitCode,
      couldNotRun: null,
      findings: normalized.findings,
      run: normalized.run,
      diagnostics: normalized.diagnostics,
      // The gate's own answer about the control inputs, folded onto the
      // decision the umbrella made before spawning it. A gate that was NOT
      // put into pull-request mode reports no proposals, and its trustBase
      // keeps the withheld reason rather than being overwritten with an
      // empty list that would read as "nothing was proposed".
      ...(trustBase === undefined || normalized.trustBase === undefined
        ? {}
        : { trustBase: { ...trustBase, proposals: normalized.trustBase.proposals } }),
    };
  } catch (err) {
    // Deliberately NOT narrowed to NormalizeError. That narrowing was the
    // defect: a normalizer reading a property off a null element threw a
    // TypeError, which is not a NormalizeError, so it escaped here, escaped
    // the run, and reached the user as a stack trace with exit 1. The
    // normalizers now validate every element they touch, and this catch is
    // the second line of that defence rather than the only one.
    //
    // The gate ran and answered; the umbrella did not understand it. That is
    // could-not-run for the umbrella's purposes, and the message says which
    // side the problem is on so nobody debugs the wrong repository.
    const detail = err instanceof NormalizeError ? err.message : messageOf(err);
    return {
      ...withRun,
      exitCode,
      couldNotRun: { reason: 'unparseable-output', detail },
      findings: [normalizeUnparseableGate(gate.role, gate.product, detail, withRun.stderr)],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }
}
