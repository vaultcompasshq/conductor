// Running one gate as a child process.
//
// Wrapper, not library: nothing here imports any gate's own package. That
// is what keeps the umbrella from taking exact version pins on five tools
// and needing a release of its own every time one of them ships, and it is
// what makes "this gate ran and exited N, output unparsed" an available
// outcome instead of a build error. What differs per tool (how the version
// is asked, where the JSON comes from, what each exit means, the timeout)
// is data in src/products.ts, not branches here.
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
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Diagnostic, Finding, RunSummary } from './envelope.js';
import { NormalizeError } from './envelope.js';
import {
  normalizeDepGuard,
  normalizeFailedGate,
  normalizeGitleaks,
  normalizeIntentGuard,
  normalizeMisconfiguredGate,
  normalizeMissingGate,
  normalizeOsvScanner,
  normalizeUnparseableGate,
  normalizeVaultGuard,
} from './normalize.js';
import type { ContractSource, IntentPreparation } from './intent-prepare.js';
import type { GatePolicy, GateRole, GateStage, Product } from './policy.js';
import { renderOptionFlags } from './policy.js';
import {
  ExternalConfigError,
  materializeExternalConfig,
  nestedConfigProposals,
} from './external-config.js';
import { profileFor } from './products.js';
import type { ProductProfile } from './products.js';
import { atLeastVersion, refuseHeadControlledProgram } from './trust-base.js';
import {
  ResolveError,
  candidateNames,
  nodeModulesCandidate,
  resolveGateBinary,
} from './resolve.js';
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
  | 'gate-program-refused'
  /**
   * The installed build is older than the oldest version whose command line
   * the umbrella speaks (`minVersion` in src/products.ts). Only the external
   * tools have a floor; nothing was run beyond the version probe.
   */
  | 'gate-version-unsupported'
  /**
   * The gate exited with a verdict but the report file it writes that
   * verdict to is not there. Only a tool whose output is a report file can
   * land here.
   */
  | 'report-missing'
  /**
   * The gate reads git history and the checkout is shallow, so the history it
   * would read is truncated (at depth 1 the pull request's merge commit is
   * grafted, and base..HEAD holds one commit: a secret added and removed
   * inside the pull request is never seen). Never unshallowed automatically:
   * the remedy is a checkout setting, fetch-depth: 0.
   */
  | 'history-shallow';

export interface CouldNotRun {
  reason: CouldNotRunReason;
  detail: string;
}

/**
 * The first version of each gate that understands `--trust-base`.
 *
 * A TABLE rather than a boolean, because the three family gates got pull-request
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
  'dep-guard': '0.6.0',
  // The two external tools have no --trust-base and are never handed one.
  // For them the umbrella itself provides pull-request mode: it scopes the
  // history to base..HEAD and hands over the config (and gitleaks' ignore
  // file) read from the base ref (src/external-config.ts). So the entry here
  // is their command-line floor, the same value as `minVersion` in
  // src/products.ts, and being in the table is what makes an unreadable
  // version a refusal on a pull request rather than a quiet withholding.
  gitleaks: '8.19.0',
  'osv-scanner': '2.0.0',
  // The table stays a table rather than becoming a boolean: a new role can
  // arrive without pull-request mode, and the "no pull-request mode yet"
  // branch below is what keeps that gate from being handed a flag it would
  // reject.
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
  /**
   * The `node_modules/.bin` candidate resolution did NOT try, repository
   * relative, on a pull-request run where one was there.
   *
   * Absent outside pull-request mode, and absent inside it when there was
   * nothing to skip: it is a claim that something was there and was declined,
   * not a claim about the mode. Reported so an adopter whose gates are
   * devDependencies learns why the gate came from somewhere else, or from
   * nowhere. Repository-relative because it reaches a published log.
   */
  nodeModulesSkipped?: string;
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
  /**
   * The directory under which this gate's own working directory is made, for
   * an external tool's report file and materialised config. The runner
   * removes what it made. Defaults to the system temporary directory; tests
   * inject one so they can see that nothing is left behind.
   */
  tempRoot?: string;
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
 * EVERY program this binary would spawn, vetted against the trust base.
 *
 * Two files and not one. `program` is what the gate runs, and
 * `versionProbe.command` can be a DIFFERENT file: for a per-command binary
 * that ignores `--version`, resolution finds the version-safe sibling
 * somewhere else entirely (`versionProbeFor`, src/resolve.ts:238-262). Vetting
 * only the first left the probe free to spawn whatever the head put at the
 * second, and a probe RUNS a program as thoroughly as a scan does.
 *
 * The first refusal wins and the rest is not consulted. The verdict is the
 * same either way, and the sentence a reader has to act on should name one
 * file rather than two.
 */
export function refuseHeadControlledBinary(
  repoRoot: string,
  trustBase: string,
  binary: ResolvedBinary
): string | null {
  for (const program of [binary.program, binary.versionProbe?.command]) {
    if (program === undefined) {
      continue;
    }
    const refusal = refuseHeadControlledProgram(repoRoot, trustBase, program);
    if (refusal !== null) {
      return refusal;
    }
  }
  return null;
}

/**
 * The outcome for a gate whose program the umbrella declined to run.
 *
 * ONE BUILDER, TWO CALLERS, and that is the point of it being here rather
 * than written out at the return that needs it. `runGate` reaches this before
 * it spawns anything; `runAll` reaches it earlier still, before the intent
 * gate's preparation spawns the same program three times. A second copy of
 * the shape would be a second chance to forget the override below.
 *
 * ENFORCED, whatever the policy says. `enforce: false` is a standing decision
 * about what a gate's FINDINGS are worth, and this gate produced none: the
 * umbrella refused to run a program the pull request chose. Letting an
 * unenforced gate swallow that would let a pull request pick its own judge
 * and keep the run green.
 */
export function gateProgramRefused(
  gate: GatePolicy,
  trustBase: string,
  refusal: string,
  binary: ResolvedBinary
): GateOutcome {
  return {
    role: gate.role,
    product: gate.product,
    stage: gate.stage,
    enforce: true,
    productVersion: null,
    argv: [],
    binary,
    exitCode: null,
    durationMs: 0,
    stderr: '',
    trustBase: { ref: trustBase, withheld: null, refused: refusal, proposals: [] },
    couldNotRun: { reason: 'gate-program-refused', detail: refusal },
    findings: [normalizeFailedGate(gate.role, gate.product, refusal)],
    run: EMPTY_RUN,
    diagnostics: [],
  };
}

/**
 * Files the runner owns on an external tool's behalf: where gitleaks writes
 * its report, and the config materialised from the base ref on a pull
 * request (src/external-config.ts).
 */
export interface ExternalArgs {
  reportPath?: string;
  configPath?: string;
  /** Where the tool's ignore file was materialised (gitleaks only). */
  ignorePath?: string;
  /**
   * What gitleaks scans, when not the working tree. On a pull request it is
   * the repository's git directory: the same history, with no head-written
   * .gitleaksignore at its root for gitleaks to load on its own.
   */
  scanRoot?: string;
  /** The tracked lockfiles osv-scanner is handed, repository-relative. */
  lockfiles?: readonly string[];
}

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
  trustBase?: string,
  /** Paths the runner owns for an external tool; the npm gates ignore them. */
  external: ExternalArgs = {}
): string[] {
  const passthrough = renderOptionFlags(gate.options);
  const trust = trustBase === undefined ? [] : ['--trust-base', trustBase];
  const config = external.configPath === undefined ? [] : ['--config', external.configPath];
  switch (gate.product) {
    case 'dep-guard': {
      // `scan` takes --trust-base from 0.6.0. It sits beside whatever the
      // umbrella already passes rather than replacing it: --trust-base says
      // where the RULES come from and the mode flags say what is scanned,
      // and a pull-request run passes both.
      //
      // --base is a different flag answering a different question:
      // --trust-base says whose config is trusted, --base says what the
      // change is compared against. On a pull-request run (trustBase
      // decided) they end up pointing at the same ref, because the base
      // branch is both the state the pull request diverged from and the
      // state whose rules were approved -- but dep-guard's own CLI treats
      // them as unrelated flags, so both are passed rather than one
      // implying the other.
      //
      // Never added when staged: dep-guard's CLI refuses --staged together
      // with --base (packages/cli/src/cli.ts, resolveMode), because the two
      // name incompatible comparisons -- the git index versus an arbitrary
      // ref. A staged run already has its own comparison and --trust-base
      // is unaffected, since it answers a different question.
      const base = trustBase !== undefined && !staged ? ['--base', trustBase] : [];
      return [...(staged ? ['--staged'] : []), '--format', 'json', ...trust, ...base, ...passthrough];
    }
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
    case 'gitleaks': {
      if (external.reportPath === undefined) {
        throw new Error('gitleaks needs a report path: it cannot write its report to stdout');
      }
      // --exit-code 3 moves the leak code off 1, which gitleaks also uses for
      // errors, so a crash and a leak stop sharing a number. --log-opts is
      // always set: gitleaks' default is git log --all, which on a checkout
      // with fetch-depth 0 scans every branch, so one branch's secret would
      // redden every other pull request. --staged has no meaning here, and
      // --trust-base is never handed to an external tool: the trust base
      // scopes the history and selects the config, and that is all.
      //
      // --diff-merges=first-parent because `git log -p` shows no diff for a
      // merge commit, so a secret added inside a merge's own changes (an
      // evil merge, a key pasted while resolving a conflict) was never
      // scanned. The price is that a pull request's change shows twice under
      // an Actions-style merge, once in its commit and once in the merge's
      // first-parent diff; normalizeGitleaks collapses those.
      //
      // --log-level info, pinned: the umbrella reads ERR lines to tell a
      // failed scan from a clean one, so a lower level (or a future lower
      // default) would turn a failed scan into a pass. It is reserved too.
      const scope = trustBase === undefined ? 'HEAD' : `${trustBase}..HEAD`;
      return [
        '--report-format',
        'json',
        '--report-path',
        external.reportPath,
        '--exit-code',
        '3',
        '--redact',
        '--no-banner',
        '--log-level',
        'info',
        '--log-opts',
        `--diff-merges=first-parent ${scope}`,
        // On a pull request, inline gitleaks:allow comments are ignored: an
        // inline allow lives in the tree being judged, so the pull request
        // controls it. A legitimate allow belongs in the base ref's
        // .gitleaks.toml allowlist or .gitleaksignore, both of which the
        // umbrella already reads from the base. Local runs keep them.
        ...(trustBase === undefined ? [] : ['--ignore-gitleaks-allow']),
        ...config,
        ...(external.ignorePath === undefined ? [] : ['--gitleaks-ignore-path', external.ignorePath]),
        ...passthrough,
        external.scanRoot ?? '.',
      ];
    }
    case 'osv-scanner': {
      // JSON goes to stdout and everything else to stderr, so no report
      // file. No directory walk: each tracked lockfile is named with
      // --lockfile (the runner lists them, src/products.ts
      // OSV_LOCKFILE_NAMES), because osv-scanner's own walk skips anything
      // .gitignore matches, tracked or not. With none there is nothing to
      // hand over, and the runner reports that without spawning the tool.
      if (external.lockfiles === undefined || external.lockfiles.length === 0) {
        throw new Error('osv-scanner needs at least one lockfile: with none, nothing is spawned');
      }
      const lockfiles = external.lockfiles.flatMap((file) => ['--lockfile', file]);
      return ['--format', 'json', ...config, ...lockfiles, ...passthrough];
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
function probeVersion(
  binary: ResolvedBinary,
  product: Product,
  repoRoot: string,
  timeoutMs: number
): string | null {
  const spec = profileFor(product).versionProbe;
  if (binary.versionProbe === null || spec === null) {
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
  // Take the first line and accept it only if the product's pattern matches,
  // so a future help banner does not end up in a SARIF driver's version
  // field. The npm gates print a bare version and their pattern keeps the
  // whole line; an external tool that prefixes its version with its name has
  // a capture group that takes the number alone.
  const first = probe.stdout.trim().split('\n')[0]?.trim() ?? '';
  const match = spec.pattern.exec(first);
  return match === null ? null : (match[1] ?? match[0]).replace(/^v/, '');
}

/**
 * `context.blocked` is whether the gate's exit said it blocked. The npm gates
 * carry that in their own JSON and ignore it; the external tools' reports do
 * not, so their normalizers take it from here.
 *
 * `context.online` and `context.lockfiles` are read from the umbrella's OWN
 * constructed argv, never from a gate's JSON (issue #72): whether --online
 * was passed and which lockfiles were handed over with --lockfile are
 * questions about what this run asked for, which the umbrella already knows
 * before the child ever answers.
 */
function normalizeFor(
  product: Product,
  parsed: unknown,
  version: string | null,
  context: { blocked: boolean; roots: readonly string[]; online: boolean; lockfiles: readonly string[] }
) {
  switch (product) {
    case 'dep-guard':
      return normalizeDepGuard(parsed, version, context.online);
    case 'vault-guard':
      return normalizeVaultGuard(parsed, version);
    case 'intent-guard':
      return normalizeIntentGuard(parsed, version);
    case 'gitleaks':
      return normalizeGitleaks(parsed, version, context.blocked);
    case 'osv-scanner':
      return normalizeOsvScanner(parsed, version, context.blocked, context.roots, context.lockfiles);
  }
}

/**
 * The repository root in every spelling a child could print it in: as given,
 * and with symbolic links resolved (a macOS temporary directory is the
 * everyday case: /var is a link to /private/var).
 */
function rootSpellings(repoRoot: string): string[] {
  const spellings = [path.resolve(repoRoot)];
  try {
    const real = realpathSync(repoRoot);
    if (!spellings.includes(real)) {
      spellings.push(real);
    }
  } catch {
    // A root that cannot be resolved has one spelling.
  }
  return spellings;
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
 * The sentence a gate that resolved to nothing gets on a pull-request run.
 *
 * EMPTY OUTSIDE PULL-REQUEST MODE, because outside it nothing about
 * resolution changed and the old message is still the whole story. Inside it
 * the message would otherwise be actively misleading in the common case: an
 * adopter with the gates as devDependencies is looking straight at a
 * node_modules/.bin/<gate> while being told no binary was found.
 *
 * It names `npm install -g` and the Action's own input rather than "install
 * it", because those are the two places the fix actually is: on a runner, the
 * Action installs the gates itself at a version pinned in a workflow file that
 * lives on the base branch, which is the protected side.
 */
function missingGateRemedy(
  product: Product,
  skipNodeModules: boolean,
  skipped: string | null
): string {
  const profile = profileFor(product);
  if (!profile.managed) {
    // An external tool is never in node_modules and never installed by the
    // Action, so the pull-request sentence below would send a reader to the
    // wrong place. Its own install instruction applies on every run.
    return ` ${profile.remedy(skipNodeModules)}`;
  }
  if (!skipNodeModules) {
    // Named on a local run too: the scoped package is the only correct
    // install target, and the finding's own sentence must not be the only
    // place a reader could take a bare name from.
    return ` ${profile.remedy(false)}`;
  }
  return (
    ' On a pull-request run node_modules/.bin is not consulted at all: what is installed there ' +
    'is chosen by the head own manifest and lockfile, so no ref approves it.' +
    (skipped === null ? '' : ` There is a ${skipped}, and it was skipped for that reason.`) +
    ` ${profile.remedy(true)}`
  );
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

/**
 * Whether git says the repository at `repoRoot` is shallow. Anything other
 * than a clear "true" (no git, an old git that does not know the flag) is
 * not shallow: those runs have their own failure paths.
 */
function isShallowRepository(repoRoot: string): boolean {
  const probe = spawnSync('git', ['rev-parse', '--is-shallow-repository'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return probe.status === 0 && typeof probe.stdout === 'string' && probe.stdout.trim() === 'true';
}

function runGateInner(
  gate: GatePolicy,
  options: RunGateOptions,
  started: number,
  progress: Omit<GateOutcome, 'couldNotRun' | 'findings' | 'run' | 'diagnostics'>
): GateOutcome {
  const timeoutMs = options.timeoutMs ?? profileFor(gate.product).timeoutMs;

  // ONE PLACE DECIDES WHAT PULL-REQUEST MODE IS, and it is the presence of a
  // trust base. resolve.ts knows nothing about refs, so it is told rather than
  // asked.
  const skipNodeModules = options.trustBase !== undefined;
  const skipped = skipNodeModules ? nodeModulesCandidate(gate, options.repoRoot) : null;
  if (skipped !== null) {
    // Onto `progress` rather than only onto the returns below, so the
    // backstop's view carries it too.
    Object.assign(progress, { nodeModulesSkipped: skipped });
  }
  const base = progress;

  let binary: ResolvedBinary | null;
  try {
    binary = resolveGateBinary(gate, options.repoRoot, options.pathValue, { skipNodeModules });
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
    const remedy = missingGateRemedy(gate.product, skipNodeModules, skipped);
    return {
      ...base,
      durationMs: Date.now() - started,
      couldNotRun: {
        reason: 'binary-missing',
        // Named in resolution order, which is the repository's own copy
        // first. Saying PATH first points a reader at the location this
        // tool prefers second, which is the wrong place to install it. On a
        // pull-request run that order has one entry, because the other one is
        // not a location this run has.
        detail:
          (skipNodeModules
            ? `no ${gate.product} binary on PATH`
            : `no ${gate.product} binary in node_modules/.bin or on PATH`) +
          (remedy === '' ? '' : '.') +
          remedy,
      },
      // A missing enabled gate is a finding of the umbrella's own, never a
      // silent skip. Skipping is how a gate ends up switched on in the
      // policy file and absent in reality for months.
      findings: [
        normalizeMissingGate(gate.role, gate.product, candidateNames(gate.product), remedy),
      ],
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
    // BOTH SPAWNABLE PATHS, not just the program: the probe below can be a
    // different file from binary.program, and it is executed just as
    // thoroughly. The enforce override and the rest of the shape live in
    // gateProgramRefused, which the intent gate's preparation shares.
    const refusal = refuseHeadControlledBinary(options.repoRoot, options.trustBase, binary);
    if (refusal !== null) {
      return {
        ...base,
        ...gateProgramRefused(gate, options.trustBase, refusal, binary),
        durationMs: Date.now() - started,
      };
    }
  }

  // A history gate cannot vouch for history it was not given. Checked before
  // the version probe so nothing is executed for a run that cannot be honest.
  if (profileFor(gate.product).readsHistory && isShallowRepository(options.repoRoot)) {
    const detail =
      `this checkout is shallow, so the git history ${gate.product} reads is truncated: ` +
      'with the default actions/checkout depth of 1 the range from the base to HEAD holds a ' +
      'single grafted commit, and a secret added and then removed inside the pull request ' +
      'would never be seen. Check out with fetch-depth: 0 (actions/checkout) or run ' +
      'git fetch --unshallow, then run again. conductor does not deepen the checkout itself.';
    return {
      ...base,
      // Under a trust base this is enforced whatever the policy says: the
      // gate produced nothing for `enforce: false` to be a decision about.
      // A local run keeps the policy's own value.
      enforce: options.trustBase !== undefined ? true : gate.enforce,
      durationMs: Date.now() - started,
      couldNotRun: { reason: 'history-shallow', detail },
      findings: [normalizeFailedGate(gate.role, gate.product, detail)],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  const version = probeVersion(binary, gate.product, options.repoRoot, timeoutMs);

  // The command-line floor. Only the external tools have one: the umbrella
  // writes flags they grew at a known release (gitleaks' git subcommand,
  // osv-scanner's scan source), and an older build would reject the command
  // line with an exit the umbrella could misread. An UNREADABLE version falls
  // through to the trust-base decision below, which refuses it on a pull
  // request and runs it unverified locally, the same as the npm gates.
  const profile = profileFor(gate.product);
  if (
    profile.minVersion !== null &&
    version !== null &&
    !atLeastVersion(version, profile.minVersion)
  ) {
    const detail =
      `${gate.product} ${version} is older than ${profile.minVersion}, the oldest version whose ` +
      `command line this umbrella speaks. Upgrade it to ${profile.minVersion} or later.`;
    return {
      ...base,
      productVersion: version,
      binary,
      durationMs: Date.now() - started,
      couldNotRun: { reason: 'gate-version-unsupported', detail },
      findings: [normalizeFailedGate(gate.role, gate.product, detail)],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

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
      // ENFORCED, whatever the policy says, for the same reason a refused
      // program is: the gate produced no findings for `enforce: false` to be
      // a decision about, and this is the umbrella saying it could not
      // establish that the gate was inside the boundary.
      //
      // Reachable now only as a PACKAGING problem, not as an attack: the
      // program check above runs first, and with its directory-subtree rule a
      // pull request can no longer put a program here whose version probe it
      // controls. Before that rule it could, through the wrapper shape: a
      // head-replaced inner script exiting 3 on --version landed exactly
      // here, with enforce false and exit 0. A packaging quirk that
      // fails a build loudly is the better failure: the alternative is a
      // boundary that quietly downgrades itself on the runs where something
      // is already wrong, which is the shape of every bug in this file.
      enforce: true,
      trustBase,
      couldNotRun: { reason: 'trust-base-unverified', detail: trustBase.refused },
      findings: [normalizeFailedGate(gate.role, gate.product, trustBase.refused)],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  // A directory of the runner's own for an external tool's working files: the
  // report gitleaks writes. Made under the caller's temporary root when there
  // is one, and removed whatever happens, so a run leaves nothing behind. The
  // npm gates need none, and get none.
  const decidedRef =
    trustBase === undefined || trustBase.withheld !== null ? undefined : trustBase.ref;
  const needsConfig = decidedRef !== undefined && profile.configFile !== null;
  const workDir =
    profile.output.kind === 'report-file' || needsConfig
      ? mkdtempSync(path.join(options.tempRoot ?? tmpdir(), 'conductor-gate-'))
      : null;
  try {
    return spawnAndRead({
      gate,
      options,
      started,
      progress,
      base,
      binary,
      version,
      trustBase,
      profile,
      timeoutMs,
      workDir,
    });
  } finally {
    if (workDir !== null) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

interface SpawnContext {
  gate: GatePolicy;
  options: RunGateOptions;
  started: number;
  progress: Omit<GateOutcome, 'couldNotRun' | 'findings' | 'run' | 'diagnostics'>;
  base: Omit<GateOutcome, 'couldNotRun' | 'findings' | 'run' | 'diagnostics'>;
  binary: ResolvedBinary;
  version: string | null;
  trustBase: GateTrustBase | undefined;
  profile: ProductProfile;
  timeoutMs: number;
  workDir: string | null;
}

/** Strips ANSI colour codes: gitleaks colours its log even off a terminal. */
function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/** Builds the command line, runs the gate, and reads what it said. */
function spawnAndRead(ctx: SpawnContext): GateOutcome {
  const { gate, options, started, progress, base, binary, version, trustBase, profile, timeoutMs, workDir } =
    ctx;

  const external: ExternalArgs = {};
  if (profile.output.kind === 'report-file' && workDir !== null) {
    external.reportPath = path.join(workDir, `${gate.product}-report${profile.output.extension}`);
  }
  const decidedRef =
    trustBase === undefined || trustBase.withheld !== null ? undefined : trustBase.ref;

  // The lockfiles a file-fed tool is handed, from the repository's tracked
  // files. On a pull request this is the head's index, read directly and not
  // from the base ref: the lockfiles ARE the tree being judged, and adding,
  // removing or renaming one is visible in the diff, so there is nothing for
  // a base-ref read to protect. A listing that fails is not "no lockfiles".
  const nestedProposals: string[] = [];
  if (profile.lockfileNames !== null) {
    const names = new Set(profile.lockfileNames);
    const listing = spawnSync('git', ['ls-files', '-z'], {
      cwd: options.repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (listing.status !== 0 || typeof listing.stdout !== 'string') {
      const detail =
        `the repository's tracked files could not be listed, so ${gate.product} had no ` +
        'lockfiles to be handed.';
      return {
        ...base,
        productVersion: version,
        binary,
        durationMs: Date.now() - started,
        ...(trustBase === undefined ? {} : { trustBase }),
        couldNotRun: { reason: 'preparation-failed', detail },
        findings: [normalizeFailedGate(gate.role, gate.product, detail)],
        run: EMPTY_RUN,
        diagnostics: [],
      };
    }
    const tracked = listing.stdout.split('\0').filter((file) => file !== '');
    if (decidedRef !== undefined && profile.configFile !== null) {
      nestedProposals.push(
        ...nestedConfigProposals(options.repoRoot, decidedRef, tracked, profile.configFile)
      );
    }
    external.lockfiles = tracked
      // Never a vendored copy under node_modules: that is a dependency's own
      // lockfile, not a statement about what this repository resolves.
      .filter((file) => !file.split('/').includes('node_modules'))
      .filter((file) => names.has(path.posix.basename(file)))
      .sort();
    if (external.lockfiles.length === 0) {
      // Nothing to scan, reported the same way as osv-scanner's own 128 below,
      // without spawning it.
      return {
        ...base,
        productVersion: version,
        binary,
        durationMs: Date.now() - started,
        ...(trustBase === undefined ? {} : { trustBase }),
        exitCode: 0,
        couldNotRun: null,
        findings: [],
        run: EMPTY_RUN,
        diagnostics: [
          {
            code: 'conductor/nothing-to-scan',
            message: `${gate.product} found nothing to scan (no tracked lockfile); treated as clean.`,
          },
        ],
      };
    }
  }

  // On a pull request, the tool's config and ignore file come from the base
  // ref (or a neutral stand-in), never from the head it would otherwise
  // auto-load them from. A head-side change is a proposal, carried the same
  // way an npm gate's own proposals are.
  const configProposals: string[] = [...nestedProposals];
  // Where the child runs. The repository root, except for a tool whose base
  // config can name further files relative to its working directory: on a
  // pull request that tool runs from a directory holding the base ref's
  // copies, so no relative path it reads can land in the head tree. Every
  // path the umbrella hands it is absolute, so nothing else depends on it.
  let spawnCwd = options.repoRoot;
  if (decidedRef !== undefined && workDir !== null) {
    const baseline = gate.options['baseline-path'];
    let materialized: ReturnType<typeof materializeExternalConfig>;
    try {
      materialized = materializeExternalConfig({
        repoRoot: options.repoRoot,
        trustBase: decidedRef,
        profile,
        tempRoot: workDir,
        ...(typeof baseline === 'string' && !path.isAbsolute(baseline) ? { extraFiles: [baseline] } : {}),
      });
    } catch (err) {
      if (!(err instanceof ExternalConfigError)) {
        throw err;
      }
      return {
        ...base,
        productVersion: version,
        binary,
        durationMs: Date.now() - started,
        ...(trustBase === undefined ? {} : { trustBase }),
        couldNotRun: { reason: 'preparation-failed', detail: err.message },
        findings: [normalizeFailedGate(gate.role, gate.product, err.message)],
        run: EMPTY_RUN,
        diagnostics: [],
      };
    }
    if (materialized !== null) {
      external.configPath = materialized.path;
      if (materialized.proposal !== null) {
        configProposals.push(materialized.proposal);
      }
      configProposals.push(...materialized.extendProposals);
      if (profile.followsConfigExtend) {
        spawnCwd = materialized.cwd;
      }
      if (materialized.ignore !== null) {
        external.ignorePath = materialized.ignore.dir;
        if (materialized.ignore.proposal !== null) {
          configProposals.push(materialized.ignore.proposal);
        }
      }
    }
    if (profile.ignoreFile?.alsoLoadedFromScanRoot === true) {
      const gitDir = spawnSync('git', ['rev-parse', '--absolute-git-dir'], {
        cwd: options.repoRoot,
        encoding: 'utf8',
      });
      const resolved = typeof gitDir.stdout === 'string' ? gitDir.stdout.trim() : '';
      if (gitDir.status !== 0 || resolved === '') {
        // No git directory means no history to scan and nowhere safe to scan
        // it from. Not a clean result.
        const detail =
          `the repository's git directory could not be found, so ${gate.product} could not be ` +
          'pointed away from the head tree on this pull request.';
        return {
          ...base,
          productVersion: version,
          binary,
          durationMs: Date.now() - started,
          ...(trustBase === undefined ? {} : { trustBase }),
          couldNotRun: { reason: 'preparation-failed', detail },
          findings: [normalizeFailedGate(gate.role, gate.product, detail)],
          run: EMPTY_RUN,
          diagnostics: [],
        };
      }
      external.scanRoot = resolved;
    }
  }
  const trustBaseOut: GateTrustBase | undefined =
    trustBase === undefined || configProposals.length === 0
      ? trustBase
      : { ...trustBase, proposals: [...trustBase.proposals, ...configProposals] };

  const argv = [
    ...binary.argvPrefix,
    ...gateArgs(gate, options.staged, options.intent, decidedRef, external),
  ];

  const child = spawnSync(binary.command, argv, {
    cwd: spawnCwd,
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
    // Colour codes stripped here, once, so neither the text report nor the
    // gate-failed finding (which carries a summary of this into SARIF and a
    // pull-request comment) shows escape sequences: gitleaks colours its log
    // even when stderr is not a terminal.
    stderr: stripAnsi(child.stderr ?? ''),
    // Carried on every return path below, the failures included: WHETHER
    // this gate was in pull-request mode is exactly as interesting when it
    // could not run as when it could, and the withheld reason is the only
    // place a report can say a gate read its own rules out of the tree under
    // judgment.
    ...(trustBaseOut === undefined ? {} : { trustBase: trustBaseOut }),
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

  // "Nothing here to scan" is its own exit for osv-scanner (128, a
  // repository with no lockfile). Read as an error it would redden every pull
  // request in a docs-only repository; read as a verdict it would claim a
  // scan that did not happen. So it is clean, and the report says why.
  if (exitCode !== null && profile.exit.nothingToScan.includes(exitCode)) {
    return {
      ...withRun,
      exitCode: 0,
      couldNotRun: null,
      findings: [],
      run: EMPTY_RUN,
      diagnostics: [
        // When lockfiles WERE handed over, this exit means they parsed to no
        // packages at all, which is different news from "no lockfile": a
        // lockfile the tool could not read anything from deserves a look.
        external.lockfiles !== undefined && external.lockfiles.length > 0
          ? {
              code: 'conductor/lockfiles-empty',
              message:
                `${gate.product} read no packages from ${external.lockfiles.join(', ')} ` +
                `(exit ${exitCode}); treated as clean.`,
            }
          : {
              code: 'conductor/nothing-to-scan',
              message: `${gate.product} found nothing to scan (exit ${exitCode}); treated as clean.`,
            },
      ],
    };
  }

  // The profile says which exits are verdicts. For the npm gates that is 0
  // and 1, exactly as before profiles existed: dep-guard's 2 means "could not
  // run the checks at all" and it prints no JSON. gitleaks is handed
  // --exit-code 3, so its 1 is left meaning an error. A signal-killed child
  // or a timeout lands here too, and none of those are a clean result.
  const blocked = exitCode !== null && profile.exit.blocked.includes(exitCode);
  if (exitCode === null || (!blocked && !profile.exit.clean.includes(exitCode))) {
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

  // A clean exit that logged an error is not a clean scan. gitleaks 8.30.1
  // swallows a git failure (a base ref the checkout never fetched, a path
  // that is not a repository): it logs the git error at ERR, scans 0
  // commits, writes a report of [], and exits 0. Read by exit code alone
  // that is a pass over nothing on exactly the pull requests where the
  // history was never there to read.
  if (!blocked && profile.stderrError !== null) {
    const pattern = profile.stderrError;
    const errorLine = stripAnsi(withRun.stderr)
      .split('\n')
      .find((line) => pattern.test(line));
    if (errorLine !== undefined) {
      const detail =
        `${gate.product} exited ${exitCode} but logged an error, so its clean result cannot be ` +
        `trusted: ${errorLine.trim()}`;
      return {
        ...withRun,
        exitCode,
        couldNotRun: { reason: 'gate-error', detail },
        findings: [normalizeFailedGate(gate.role, gate.product, detail, withRun.stderr)],
        run: EMPTY_RUN,
        diagnostics: [],
      };
    }
  }

  let text: string;
  if (profile.output.kind === 'report-file') {
    // The report is where the verdict is. An exit that says clean or blocked
    // with no report behind it is not either of those.
    const reportPath = external.reportPath as string;
    if (!existsSync(reportPath)) {
      const detail = `${gate.product} exited ${exitCode} but wrote no report, so there is no verdict to read.`;
      return {
        ...withRun,
        exitCode,
        couldNotRun: { reason: 'report-missing', detail },
        findings: [normalizeFailedGate(gate.role, gate.product, detail, withRun.stderr)],
        run: EMPTY_RUN,
        diagnostics: [],
      };
    }
    text = readFileSync(reportPath, 'utf8');
  } else {
    text = child.stdout ?? '';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Exit 1 with unparseable stdout is what a rejected config looks like
    // from two of the three products, and it is could-not-run rather than
    // clean. Reporting it as a policy violation would tell the user their
    // code is at fault when their config is.
    const detail =
      profile.output.kind === 'report-file'
        ? `the gate exited ${exitCode} and its report is not valid JSON, which is not a clean result.`
        : `the gate exited ${exitCode} without valid JSON on stdout. ` +
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
    const normalized = normalizeFor(gate.product, parsed, version, {
      blocked,
      roots: rootSpellings(options.repoRoot),
      // The literal flag, read off the argv this run actually spawned with,
      // not off gate.options: the argv is what dep-guard was actually told.
      online: argv.includes('--online'),
      lockfiles: external.lockfiles ?? [],
    });
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
