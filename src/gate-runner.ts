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
import { realPathInside, runGit } from './git.js';
import { NormalizeError } from './envelope.js';
import {
  describeLockfiles,
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
import type { GatePolicy, GateRole, GateStage, OptionValue, Product } from './policy.js';
import { renderOptionFlags } from './policy.js';
import {
  NO_RESOLVE_OVERRIDDEN,
  emptiedLockfiles,
  noLongerScanned,
  noLongerScannedFiles,
  nothingScannableMessage,
  notScannedDetail,
  packageCounts,
  selectOsvInputs,
  type OsvSelection,
} from './osv-coverage.js';
import {
  checkEmptiedAgainstBase,
  compareWithBase,
  comparisonFailed,
  type BaseComparison,
  type CompareArgs,
  type EmptiedCheckResult,
} from './osv-baseline.js';
import {
  ExternalConfigError,
  materializeExternalConfig,
  nestedConfigProposals,
} from './external-config.js';
import { osvLockfileKind, profileFor } from './products.js';
import { unreadManifestsNote } from './unread-manifests.js';
import type { ProductProfile } from './products.js';
import { atLeastVersion, refuseHeadControlledProgram } from './trust-base.js';
import {
  ResolveError,
  candidateNames,
  nodeModulesCandidate,
  resolveGateBinary,
} from './resolve.js';
import type { ResolutionSource, ResolvedBinary } from './resolve.js';

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
   * the umbrella speaks (`minVersion` in src/products.ts, which only the
   * external tools have), or, on a run with a trust base, older than the
   * first version that takes its rules from the base ref
   * (`TRUST_BASE_MIN_VERSION`). The gate's check was not run. For an intent
   * gate with an imported contract the preparation that stages that contract
   * from the base ref has already run by then.
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
  | 'history-shallow'
  /**
   * conductor stopped the gate at its time limit (`timeout-seconds` in the
   * policy, else the product's default). Decided by the spawn error code
   * ETIMEDOUT alone, never by the signal or the status: a child that handled
   * SIGTERM can return status 0, or its blocked code, with a clean report.
   * Raised for the version probe, the scan, and the intent gate's
   * preparation steps; `timedOut.step` says which spawn was stopped.
   */
  | 'timed-out'
  /**
   * The vulnerabilities gate on a decided trust base: a handed lockfile read
   * no packages at the head, or a base lockfile is gone from the head with
   * no populated replacement in its directory, and the base copy had
   * packages, so the dependency set the head removed cannot be judged.
   * Fail closed by design
   * (docs/superpowers/specs/2026-10-18-emptied-lockfile-under-trust-base.md).
   */
  | 'lockfile-emptied'
  /**
   * The run was told which version of this gate must judge it (the Action's
   * pin, `RunGateOptions.expectedVersion`) and the resolved binary reports
   * another one, from whichever location resolution took it. The gate's
   * check was not run. Design:
   * docs/superpowers/specs/2026-10-18-version-skew-could-not-run.md.
   */
  | 'version-skew'
  /**
   * The same expectation, and the resolved binary's version could not be
   * read, so it is not known to be the expected one. Fail closed.
   */
  | 'version-unverified'
  /**
   * The same check could not clear the head: a base copy unreadable, a base
   * run that failed or printed no count, a command-line mismatch, or a head
   * run whose stderr carries no package count (a lowered verbosity).
   */
  | 'lockfile-emptied-unverified';

/**
 * Where a gate's time limit came from: the test hook, the policy, the product
 * default, or, in the preview under the proposed rules, what was left of the
 * preview's own budget when that was the smaller limit.
 */
export type TimeLimitSource = 'override' | 'policy' | 'default' | 'preview-budget';

export interface TimeLimit {
  ms: number;
  source: TimeLimitSource;
}

/** Which of a gate's spawns was stopped at the limit. The intent gate's check is `scan`. */
export type TimedOutStep = 'version-probe' | 'scan' | 'import-spec' | 'freeze' | 'base-check';

export interface TimedOut {
  step: TimedOutStep;
  limitSeconds: number;
  elapsedSeconds: number;
  limitSource: TimeLimitSource;
  /** What spawnSync reported; null when the child handled SIGTERM and exited itself. Never used to classify. */
  signal: string | null;
}

export interface CouldNotRun {
  reason: CouldNotRunReason;
  detail: string;
  /** Present only for `timed-out`. */
  timedOut?: TimedOut;
  /**
   * What the gate itself said about why it could not run: a short, bounded,
   * sanitised excerpt of its own stderr (first line) or, failing that, of a
   * `reason` field in its JSON output. Present only when the gate exited with
   * a code the umbrella does not read as a verdict and said something. It is
   * information for the reader and never an input to a decision: the exit
   * code and `reason` above are decided before this is looked at.
   */
  gateSaid?: string;
}

/** The longest excerpt of a gate's own reason that is carried. */
export const GATE_SAID_MAX_CHARS = 160;

/**
 * A short, plain excerpt of one line of gate output.
 *
 * ASCII only and one line, because the excerpt lands in a job log line, in the
 * text report and in a pull-request comment: control characters, escape
 * sequences and anything a terminal would interpret are replaced, whitespace is
 * collapsed, workflow-command markers are broken up, double quotes become
 * single quotes (the excerpt is shown inside double quotes), and the result is
 * cut at GATE_SAID_MAX_CHARS.
 */
function sanitizeGateSaid(raw: string): string | null {
  const flat = breakWorkflowMarkers(
    stripAnsi(raw)
      .replace(/[^\x20-\x7e]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  ).replace(/"/g, "'");
  if (flat === '') {
    return null;
  }
  return flat.length > GATE_SAID_MAX_CHARS ? `${flat.slice(0, GATE_SAID_MAX_CHARS - 3)}...` : flat;
}

/**
 * Breaks up the two character sequences a CI log reader treats as a command
 * ("##[" and "::") by putting a space inside them, so gate-printed text stays
 * inert in a job log. Repeated until stable, so runs such as ":::" and "###["
 * are covered too.
 */
export function breakWorkflowMarkers(text: string): string {
  let out = text;
  for (;;) {
    const next = out.replace(/#(?=#\[)/g, '# ').replace(/:(?=:)/g, ': ');
    if (next === out) {
      return out;
    }
    out = next;
  }
}

/**
 * The could-not-run reasons that are conductor's OWN decision, made before
 * the gate was spawned (or instead of spawning it), or the umbrella stopping
 * it, as opposed to something the gate itself said or did.
 */
export const CONDUCTOR_OWN_REASONS: ReadonlySet<CouldNotRunReason> = new Set<CouldNotRunReason>([
  'preparation-failed',
  'trust-base-unverified',
  'gate-program-refused',
  'gate-version-unsupported',
  'history-shallow',
  'timed-out',
  'lockfile-emptied',
  'lockfile-emptied-unverified',
  'version-skew',
  'version-unverified',
]);

/**
 * A probed version as it may be printed. The probe for the family gates
 * accepts anything after x.y.z on the first line, and the text reaches a
 * workflow command, the step summary and the reports, so only version
 * characters are kept.
 */
export function versionCharacters(raw: string): string {
  return raw.replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 64);
}

/** Where a resolved binary came from, in words. Never a machine path. */
export function resolutionPlace(source: ResolutionSource): string {
  return source === 'node_modules' ? 'node_modules/.bin' : source === 'path' ? 'PATH' : 'the policy command';
}

/**
 * The remedy for a gate that is not at the expected version, which depends
 * on where the binary came from. THE ONE PLACE it is written: the
 * could-not-run detail and every version-skew line in src/output-text.ts
 * call this.
 */
export function versionSkewRemedy(product: string, source: ResolutionSource, expected: string): string {
  if (source === 'node_modules') {
    return (
      `Fix: bump or remove the repository's own ${product} devDependency. node_modules/.bin outranks ` +
      "PATH outside a pull request, so on a push run it shadows the action's install."
    );
  }
  if (source === 'path') {
    return `Fix: remove the other ${product} from PATH, or install ${expected}.`;
  }
  return `Fix: point the policy command at ${product} ${expected}, or remove the command override.`;
}

/**
 * A gate's time limit, and where it came from. THE ONE PLACE the precedence
 * is written: the test hook (`RunGateOptions.timeoutMs`, which no CLI path
 * sets), then the policy's `timeout-seconds`, then the product's default.
 * runGate and the intent gate's preparation in run.ts both call this, so the
 * two cannot disagree about a gate's limit.
 */
export function resolveTimeLimit(gate: GatePolicy, override: number | undefined): TimeLimit {
  if (override !== undefined) {
    return { ms: override, source: 'override' };
  }
  if (gate.timeoutSeconds !== undefined) {
    return { ms: gate.timeoutSeconds * 1000, source: 'policy' };
  }
  return { ms: profileFor(gate.product).timeoutMs, source: 'default' };
}

/** What a spawn error was: the umbrella's deadline, or anything else. */
export type SpawnFailure =
  | { reason: 'timed-out'; signal: string | null }
  | { reason: 'spawn-failed'; message: string };

/**
 * Classifies a spawnSync result that carries an error. PURE, so it is tested
 * on hand-built results.
 *
 * THE ERROR CODE ALONE decides it. ETIMEDOUT is timed-out and nothing else
 * is. No status or signal condition belongs here: a child that traps SIGTERM,
 * or ignores it and exits on its own, comes back with status 0 (or its
 * blocked code) and signal null, and ENOBUFS arrives with the same SIGTERM a
 * timeout does. The signal is recorded for the report and never classifies.
 */
export function spawnFailure(child: {
  error?: Error | undefined;
  status?: number | null;
  signal?: NodeJS.Signals | string | null;
}): SpawnFailure | null {
  if (child.error === undefined) {
    return null;
  }
  if ((child.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return { reason: 'timed-out', signal: child.signal ?? null };
  }
  return { reason: 'spawn-failed', message: child.error.message };
}

/** "(the default for this gate)", or where the policy value came from. */
function limitSourcePhrase(gate: GatePolicy, source: TimeLimitSource, trustBase: string | undefined): string {
  if (source === 'policy') {
    return trustBase === undefined
      ? `gates.${gate.role}.timeout-seconds`
      : `gates.${gate.role}.timeout-seconds on ${trustBase}`;
  }
  if (source === 'preview-budget') {
    return 'what was left of the 300 s preview budget';
  }
  return source === 'default' ? 'the default for this gate' : 'set by the caller';
}

/**
 * The note for `options.timeout` on the secrets-history gate, which is
 * gitleaks' own --timeout and not conductor's limit. Null when the key is not
 * set or the gate is not gitleaks.
 */
function gateOwnTimeoutNote(gate: GatePolicy, limit: TimeLimit, trustBase: string | undefined): string | null {
  if (gate.product !== 'gitleaks' || gate.options.timeout === undefined) {
    return null;
  }
  return (
    `options.timeout is gitleaks' own --timeout (${String(gate.options.timeout)} s); conductor stops the ` +
    `gate at ${Math.round(limit.ms / 1000)} s (${limitSourcePhrase(gate, limit.source, trustBase)}).`
  );
}

/** The could-not-run detail for a gate stopped at its limit, by step. */
function timedOutDetail(
  gate: GatePolicy,
  step: TimedOutStep,
  limit: TimeLimit,
  elapsedMs: number,
  trustBase: string | undefined
): string {
  const limitSeconds = Math.round(limit.ms / 1000);
  const elapsedSeconds = Math.round(elapsedMs / 1000);
  const where = limitSourcePhrase(gate, limit.source, trustBase);
  const own = gateOwnTimeoutNote(gate, limit, trustBase);
  // A preview stopped by its own budget has no limit to raise: the budget is
  // fixed, and the gate's own limit was not what stopped it.
  const remedies =
    limit.source === 'preview-budget'
      ? 'The preview under the proposed rules has 300 s in all, whatever each gate\'s own limit.'
      : profileFor(gate.product).timeoutRemedies(gate.role);
  // A preview spawn with no budget left was never started (spawnLimits):
  // there is no elapsed time or limit to report.
  if (limit.source === 'preview-budget' && limit.ms === 0) {
    const what = step === 'version-probe' ? `the version probe of ${gate.product}` : gate.product;
    return `${what} was not started: the preview budget was spent, so nothing was checked by it. ${remedies}`;
  }
  if (step === 'version-probe') {
    return (
      `the version probe of ${gate.product} was stopped at ${limitSeconds} s (${where}), so the gate ` +
      'was not run and nothing was checked by it.'
    );
  }
  if (step === 'base-check') {
    return (
      `${gate.product}'s check of the base copies of the lockfiles this pull request emptied was stopped ` +
      `after ${elapsedSeconds} s, at what was left of its ${limitSeconds} s limit (${where}) after the ` +
      `head scan, so the dependencies the pull request removed were not judged. ${remedies}`
    );
  }
  const what =
    step === 'scan'
      ? `${gate.product} was stopped after ${elapsedSeconds} s, at its ${limitSeconds} s limit (${where}), ` +
        'so nothing was checked by it.'
      : `the intent gate's ${step} step was stopped after ${elapsedSeconds} s, at its ${limitSeconds} s ` +
        `limit (${where}), so the gate was not run and nothing was checked by it.`;
  return `${what} ${remedies}${own === null ? '' : ` ${own}`}`;
}

function timedOutRecord(
  step: TimedOutStep,
  limit: TimeLimit,
  elapsedMs: number,
  signal: string | null
): TimedOut {
  return {
    step,
    limitSeconds: Math.round(limit.ms / 1000),
    elapsedSeconds: Math.round(elapsedMs / 1000),
    limitSource: limit.source,
    signal,
  };
}

/** The `conductor/gate-failed` finding for a timed-out gate, with the timing in its details. */
function timedOutFinding(gate: GatePolicy, detail: string, timedOut: TimedOut, stderr?: string): Finding {
  return normalizeFailedGate(gate.role, gate.product, detail, stderr, {
    timedOut: {
      limitSeconds: timedOut.limitSeconds,
      elapsedSeconds: timedOut.elapsedSeconds,
      limitSource: timedOut.limitSource,
    },
  });
}

/**
 * conductor's own reason for a could-not-run, as a job-log excerpt: cleaned,
 * one line, capped and with double quotes replaced, exactly like a gate's
 * stated reason. Null when there is nothing to print.
 */
export function conductorStatedReason(detail: string): string | null {
  return sanitizeGateSaid(detail);
}

/**
 * One line of raw gate output, made safe to print: control characters (escape
 * included) become spaces and workflow-command markers are broken up. The
 * content is otherwise left as it was.
 */
export function cleanOutputLine(raw: string): string {
  return breakWorkflowMarkers(raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' '));
}

/** One stderr line as the stated-reason rule sees it. */
interface ReasonLine {
  /** Empty or whitespace-only after stripAnsi (a CRLF carriage return included). */
  blank: boolean;
  /** Begins with whitespace after stripAnsi, and is not blank. */
  indented: boolean;
  /** Plain one-line text, uncapped; empty when nothing printable is left. */
  text: string;
  /** A note block line or a gitleaks rename-detection warning: never chosen. */
  informational: boolean;
}

/** A zerolog line at one level: gitleaks' "<time> ERR ..." shape. */
const ZEROLOG_ERR = /^\S+\s+ERR\s/;
const ZEROLOG_WRN = /^\S+\s+WRN\s/;

/**
 * osv-scanner 2.4.0's progress lines, which come before its error on every
 * run (tests/fixtures/stated-reason-captures.json, audit 2026-10-18 N4): the
 * walk banner, one "Scanned <file> file and found N package(s)" per file
 * read, and the "End status:" counters. Quoting the banner as "gate said"
 * was noise on every osv could-not-run.
 */
const OSV_PROGRESS: readonly RegExp[] = [
  /^Starting filesystem walk for root: /,
  /^Scanned .+ file and found \d+ packages?$/,
  /^End status: /,
];

function plainLine(raw: string): string {
  return raw.replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The stderr half of the stated-reason rule: the line a gate marks as its
 * failure, else the first line that is not informational, else nothing.
 *
 *  1. Lines are split after stripAnsi. Whitespace tests (blank, indented)
 *     are made there, before sanitizing, because a colour code can come
 *     before the indentation; markers are matched on the sanitized text, so
 *     a leading emoji or colour code does not hide one.
 *  2. Informational lines are never chosen: a `note:` line and every
 *     following indented line (a BLANK line ends the note block, so an
 *     indented reason after it is not swallowed), and gitleaks' two
 *     rename-detection warnings, and osv-scanner's progress lines
 *     (OSV_PROGRESS).
 *  3. A marker wins: the first remaining INCOMPLETE: or zerolog ERR line,
 *     joined with the indented lines after it, skipping blank lines, up to
 *     the first non-blank line that is not indented.
 *  4. No marker: the first remaining line.
 */
function statedReasonFromStderr(stderr: string): string | null {
  const lines: ReasonLine[] = stripAnsi(stderr)
    .split('\n')
    .map((raw) => {
      const blank = raw.trim() === '';
      return { blank, indented: !blank && /^\s/.test(raw), text: plainLine(raw), informational: false };
    });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^note:/i.test(line.text)) {
      line.informational = true;
      for (let j = i + 1; j < lines.length && lines[j]!.indented; j++) {
        lines[j]!.informational = true;
      }
    } else if (
      ZEROLOG_WRN.test(line.text) &&
      (line.text.includes('rename detection was skipped') || line.text.includes('diff.renameLimit'))
    ) {
      line.informational = true;
    } else if (OSV_PROGRESS.some((pattern) => pattern.test(line.text))) {
      line.informational = true;
    }
  }

  const candidate = (line: ReasonLine): boolean => !line.blank && !line.informational && line.text !== '';
  const markerAt = lines.findIndex(
    (line) => candidate(line) && (line.text.startsWith('INCOMPLETE:') || ZEROLOG_ERR.test(line.text))
  );
  if (markerAt >= 0) {
    const block = [lines[markerAt]!.text];
    for (let k = markerAt + 1; k < lines.length; k++) {
      const next = lines[k]!;
      if (next.blank) {
        continue;
      }
      if (!next.indented) {
        break;
      }
      if (next.text !== '') {
        block.push(next.text);
      }
    }
    return sanitizeGateSaid(block.join(' '));
  }
  const first = lines.find(candidate);
  return first === undefined ? null : sanitizeGateSaid(first.text);
}

/**
 * What a gate that exited with a non-verdict code said about why.
 *
 * TOTAL, and never a decision: the caller has already settled that this is a
 * could-not-run, and nothing here can change that. stderr is preferred, since
 * that is where every gate in the family prints its reason on exit 2
 * (dep-guard, intent-guard and vault-guard all do), read by the rule in
 * `statedReasonFromStderr`: the line the gate marks as the failure, never an
 * informational line. Failing that, stdout is parsed only for a gate whose
 * output is JSON on stdout, and only a string `reason` field (top level, or
 * on `run`) is read; anything else, including output that does not parse, is
 * simply no excerpt. An absent excerpt is better than quoting a warning as
 * the cause; the full stderr is still printed in the text report.
 */
export function gateStatedReason(
  stderr: string,
  stdout: string | null | undefined,
  stdoutIsJson: boolean
): string | null {
  try {
    const fromStderr = statedReasonFromStderr(stderr);
    if (fromStderr !== null) {
      return fromStderr;
    }
    if (!stdoutIsJson || typeof stdout !== 'string' || !stdout.trimStart().startsWith('{')) {
      return null;
    }
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const run = record.run;
    const candidates = [
      record.reason,
      typeof run === 'object' && run !== null ? (run as Record<string, unknown>).reason : undefined,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const excerpt = sanitizeGateSaid(candidate);
        if (excerpt !== null) {
          return excerpt;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The first version of each gate that understands `--trust-base`.
 *
 * A TABLE rather than a boolean, because the three family gates got pull-request
 * mode in three separate releases and the umbrella has to keep working
 * against every combination in the meantime. A product missing from this
 * table has no pull-request mode yet and is never handed the flag; a product
 * in it is handed the flag only when the installed build says it is at least
 * this version, and on a run with a trust base a build below it is
 * could-not-run rather than run without the flag, since without the flag it
 * would take its rules from the tree being judged. The entries are the
 * minimum the umbrella requires on a pull-request run, which can be later
 * than the release the flag first appeared in.
 *
 * The umbrella is deliberately NOT the place a version pin lives otherwise
 * (nothing here imports any gate's package), and this is the one exception:
 * it is a statement about a command-line flag, which is the only interface
 * this package has to those tools.
 */
export const TRUST_BASE_MIN_VERSION: Partial<Record<Product, string>> = {
  'intent-guard': '1.8.1',
  'vault-guard': '1.9.1',
  'dep-guard': '0.10.1',
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
 * The first intent-guard whose own `--base` can carry any change set: it
 * reads the paths from git NUL-separated (1.8.0) and lists a moved submodule
 * pointer with --ignore-submodules=none and ends the range with "--" (the
 * release after 1.8.0). For a native contract on this version or later the
 * runner hands the gate `--base` instead of `--paths`, so a changed path
 * that `--paths` cannot carry (a comma, a backslash, edge whitespace, a
 * leading "-") is judged rather than refused.
 *
 * It equals the intent-guard entry in `TRUST_BASE_MIN_VERSION`, so on a run
 * with a trust base every intent gate that runs is new enough, and the
 * `--paths` refusal for a native contract is reached only on a run without
 * one (an explicit `--base`). Kept as its own constant because the two
 * answer different questions and the floor may move without it.
 */
export const INTENT_BASE_CHANNEL_MIN_VERSION = '1.8.1';

/**
 * How the intent gate is handed the change set on a prepared run: its own
 * `--base` (native contract, gate new enough), `--paths`, or not at all,
 * with the reason, when `--paths` cannot carry it and `--base` is not
 * available.
 */
function intentChangeChannel(
  gate: GatePolicy,
  intent: IntentPreparation | undefined,
  version: string | null
): { kind: 'base'; ref: string } | { kind: 'paths' } | { kind: 'refused'; detail: string } {
  if (gate.product !== 'intent-guard' || intent === undefined || intent.paths === null) {
    return { kind: 'paths' };
  }
  if (
    intent.contractSource.kind === 'native' &&
    intent.baseRef !== null &&
    atLeastVersion(version, INTENT_BASE_CHANNEL_MIN_VERSION)
  ) {
    return { kind: 'base', ref: intent.baseRef };
  }
  if (intent.pathsRefusal !== undefined) {
    return {
      kind: 'refused',
      detail:
        `${intent.pathsRefusal} intent-guard ${version ?? 'of an unreadable version'} takes the ` +
        'change set only as that list, so nothing was checked by this gate. To clear it, ' +
        `upgrade intent-guard to ${INTENT_BASE_CHANNEL_MIN_VERSION} or later, which reads the ` +
        'change set from git itself for a contract frozen in the repository.',
    };
  }
  return { kind: 'paths' };
}

/**
 * Pull-request mode as it applied to ONE gate.
 *
 * Carried on the outcome rather than worked out again by each reporter,
 * because two different things have to be visible and neither is derivable
 * from the other: whether this gate was actually put into pull-request mode,
 * and what it said about the control inputs the head proposes to change.
 *
 * `withheld` is the half that must never be silent. A gate the umbrella did
 * not put into pull-request mode was not handed the base ref, and a run where
 * that happened must not look like a run where it did not.
 */
export interface GateTrustBase {
  /** The ref the umbrella took its own policy from, and offered to this gate. */
  ref: string;
  /**
   * Null when the flag was passed; otherwise the reason it was not. Only two
   * cases withhold: a product with no pull-request mode at all (none today,
   * every product is in `TRUST_BASE_MIN_VERSION`), and an intent gate judging
   * a contract imported for this run, whose project is a temporary directory
   * with no repository in it (the contract itself was read from the base).
   * A gate below its minimum is never withheld; it is `refused`.
   */
  withheld: string | null;
  /**
   * Set when the umbrella could not ESTABLISH that this gate would be in
   * pull-request mode (its version did not read), or established that it
   * would not be (its version is below the minimum), which is could-not-run
   * rather than a downgrade.
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
 * Why dep-guard and vault-guard are not handed `--trust-base` in the preview
 * under the proposed rules: the preview shows what the head's rules would do,
 * and their own control files are part of those rules.
 */
export const PREVIEW_WITHHELD =
  'preview under the proposed rules: this gate read its own control files from the head';

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
  productVersion: string | null,
  /**
   * The preview under the proposed rules. dep-guard and vault-guard then read
   * their own control files from the head, so the flag is withheld from them;
   * the trust base itself stays set on the run, and every other product is
   * decided exactly as without it.
   */
  preview = false
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

  // A version BELOW the minimum is refused too, never withheld: running it
  // without the flag would let it take its rules from the tree being judged
  // on a run whose whole promise is that every rule comes from the base ref.
  if (!atLeastVersion(productVersion, minimum)) {
    return refused(
      `${gate.product} did not run: the installed ${productVersion} is older than ${minimum}, the ` +
        'first version that takes its rules from the base ref on a pull-request run, so nothing ' +
        `was checked by it. Fix: install ${gate.product} ${minimum} or newer, or remove an ` +
        'explicit older version pin.'
    );
  }

  // AFTER both version refusals, so a gate refused in the primary run is
  // refused in the preview too. Only the --trust-base flag is withheld: the
  // run keeps its trust base, and with it the node_modules skip, the program
  // refusal and the forced enforce, and dep-guard keeps --base (gateArgs'
  // changeBase). gitleaks and osv-scanner never reach this: the umbrella
  // itself is their pull-request mode, and it stays the base's.
  if (preview && (gate.product === 'dep-guard' || gate.product === 'vault-guard')) {
    return withheld(PREVIEW_WITHHELD);
  }

  // AFTER the version checks, so an imported contract cannot let an older
  // gate run: this withholding is about where --project points, not about
  // what the gate understands, and the contract itself came from the base.
  if (intent !== undefined && intent.contractSource.kind !== 'native') {
    const from =
      intent.contractSource.kind === 'imported' && intent.contractSource.ref !== undefined
        ? `came from the spec on "${intent.contractSource.ref}"`
        : 'came from a spec in the head tree';
    return withheld(
      'the intent gate is running against a contract imported for this run, which lives in a ' +
        'temporary directory with no repository in it, so there is no ref there to read control ' +
        `inputs from. The contract it is judging against ${from}.`
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
  intent?: { contractSource: ContractSource; baseRef: string | null; note?: string };
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
  /**
   * Present only when the version this gate reported differs from the one
   * the run was told to expect (the Action's pin, handed over as an
   * environment variable), and both are known, WHEREVER the binary was
   * resolved from. Since 0.13.0 it is present exactly on a `version-skew`
   * could-not-run, and carries the facts the warning surfaces print; it is
   * the outcome, not this record, that the exit code reads.
   *
   * Every location, not only PATH (audit 2026-10-18, the intent-guard
   * audit's MB3). Outside a pull request a repository's own devDependency in
   * node_modules/.bin outranks the Action's global install by design, and
   * recording PATH alone left every guard repository's own push runs on
   * stale gates with the pins set and nothing said. `path` is
   * repository-relative when the binary is inside the repository (it
   * reaches a published log through the reports), and absolute otherwise.
   */
  versionSkew?: { expected: string; found: string; source: ResolutionSource; path: string };
  /**
   * The vulnerabilities gate only, and only when a base comparison ran (a
   * pull-request run whose head scan blocked with at least one finding): the
   * ref, the base policy's present-on-base value, the counts, the lockfiles
   * the comparison was unavailable for, and any non-advisory verdict in the
   * head output. Carried here, like `enforce`, so a report and the exit
   * decision (gateExitBlocks) never need the policy file.
   */
  baseComparison?: BaseComparison;
  /**
   * The time limit this gate ran under and where it came from, carried like
   * `enforce` so the report and the timed-out message never need the policy
   * file. Set on every outcome runGate builds once the limit is resolved.
   */
  timeLimit?: TimeLimit;
  /**
   * The `conductor/option-is-gate-own` note: set when the secrets-history
   * gate's options carry `timeout`, which is gitleaks' own --timeout and not
   * conductor's limit. On the OUTCOME rather than in `run.diagnostics`,
   * because every could-not-run outcome carries an empty run, and the
   * gate-error that gitleaks' own deadline produces is exactly the outcome
   * that needs the note. Information only; nothing decides on it.
   */
  gateOwnOption?: string;
}

export interface RunGateOptions {
  /**
   * The version this run expects of the gate, when something says so (the
   * Action passes its pin). Compared with what the resolved binary reports,
   * wherever it was found: another version is `version-skew` and an
   * unreadable one `version-unverified`, both could-not-run (0.13.0). Absent
   * means no expectation, which is every local run, and changes nothing.
   */
  expectedVersion?: string;
  repoRoot: string;
  staged: boolean;
  /** PATH to search. Injected so tests never depend on the machine. */
  pathValue: string;
  /**
   * A test hook: the time limit for every spawn of this gate, outranking the
   * policy's timeout-seconds. No CLI path sets it. See `resolveTimeLimit`.
   */
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
  /**
   * Set only in the preview under the proposed rules. Every spawn of this
   * gate then takes its timeout, kill signal and environment from
   * `previewSpawnOptions`, and two refusals run before any spawn.
   */
  preview?: PreviewSpawn;
}

/** The preview's hard deadline, its clock, and its private cache directory. */
export interface PreviewSpawn {
  /** In the clock's own units (milliseconds): the whole preview ends here. */
  deadline: number;
  clock: () => number;
  /** XDG_CACHE_HOME for every preview spawn, removed when the preview ends. */
  cacheDir: string;
}

/** The smaller of a spawn's own limit and what is left of the preview budget, never negative. */
export function previewSpawnTimeout(limitMs: number, preview: PreviewSpawn): number {
  return Math.max(0, Math.min(limitMs, preview.deadline - preview.clock()));
}

/**
 * The spawn options of every preview spawn: the timeout above, SIGKILL, so a
 * child that traps SIGTERM cannot outlive the budget, and the spawn's own
 * environment with XDG_CACHE_HOME pointed at the preview's private cache, so
 * nothing the head's rules fetched persists on a shared runner.
 */
export function previewSpawnOptions(
  limitMs: number,
  preview: PreviewSpawn,
  env: NodeJS.ProcessEnv
): { timeout: number; killSignal: 'SIGKILL'; env: NodeJS.ProcessEnv } {
  return {
    timeout: previewSpawnTimeout(limitMs, preview),
    killSignal: 'SIGKILL',
    env: { ...env, XDG_CACHE_HOME: preview.cacheDir },
  };
}

/**
 * The options one spawn passes to spawnSync beside its own, and the limit it
 * ran under. Outside the preview: the full limit and nothing else, exactly as
 * before. In the preview: `previewSpawnOptions`, and the limit's source is
 * `preview-budget` when the budget left was the smaller. `start` false means
 * no budget is left, and the spawn must not be started: a spawnSync timeout
 * of 0 is no timeout at all.
 */
function spawnLimits(
  limit: TimeLimit,
  preview: PreviewSpawn | undefined,
  env: NodeJS.ProcessEnv | undefined
): { start: boolean; limit: TimeLimit; options: { timeout: number; killSignal?: 'SIGKILL'; env?: NodeJS.ProcessEnv } } {
  if (preview === undefined) {
    return { start: true, limit, options: { timeout: limit.ms, ...(env === undefined ? {} : { env }) } };
  }
  const options = previewSpawnOptions(limit.ms, preview, env ?? process.env);
  return {
    start: options.timeout > 0,
    limit: options.timeout < limit.ms ? { ms: options.timeout, source: 'preview-budget' } : limit,
    options,
  };
}

/** A spawnSync-shaped result for a preview spawn that was never started: no budget left. */
function notStartedResult(): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  const error = Object.assign(new Error('spawnSync ETIMEDOUT: the preview budget was spent'), { code: 'ETIMEDOUT' });
  return { pid: 0, output: [], stdout: '', stderr: '', status: null, signal: null, error } as unknown as ReturnType<
    typeof spawnSync
  > & { stdout: string; stderr: string };
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

/**
 * The intent gate whose preparation step (import-spec or freeze) was stopped
 * at the gate's time limit. Shaped like `preparationFailed`, with the
 * timed-out reason, so it composes the same way; the caller decides
 * `enforce` under the same rule it applies to a failed preparation.
 */
export function preparationTimedOut(
  gate: GatePolicy,
  stopped: {
    step: 'import-spec' | 'freeze';
    elapsedMs: number;
    signal: string | null;
    limit: TimeLimit;
    trustBase?: string;
  }
): GateOutcome {
  const detail = timedOutDetail(gate, stopped.step, stopped.limit, stopped.elapsedMs, stopped.trustBase);
  const timedOut = timedOutRecord(stopped.step, stopped.limit, stopped.elapsedMs, stopped.signal);
  return {
    role: gate.role,
    product: gate.product,
    stage: gate.stage,
    enforce: gate.enforce,
    productVersion: null,
    argv: [],
    binary: null,
    exitCode: null,
    durationMs: stopped.elapsedMs,
    stderr: '',
    timeLimit: stopped.limit,
    couldNotRun: { reason: 'timed-out', detail, timedOut },
    findings: [timedOutFinding(gate, detail, timedOut)],
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
  /**
   * The files osv-scanner is handed: repository-relative on the head run,
   * absolute copies under the work directory on the base run.
   */
  lockfiles?: readonly string[];
  /**
   * Whether this invocation gets --no-resolve. Decided once, from the HEAD
   * run's list (any requirements file), and handed to the base run as is, so
   * the two command lines cannot differ in resolution mode because the base
   * run scans a different subset (osv design, section 2.4). Absent means
   * "decide from `lockfiles`".
   */
  noResolve?: boolean;
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
  external: ExternalArgs = {},
  /**
   * For the intent gate on a prepared run: hand it this base with its own
   * `--base` in place of `--paths`. Decided by `intentChangeChannel`.
   */
  intentBase?: string,
  /**
   * dep-guard's `--base` when `trustBase` is withheld from it in the preview
   * under the proposed rules: the change is still measured against the base
   * ref, only the rules are the head's. Ignored when `trustBase` is set, and
   * by every other product.
   */
  changeBase?: string
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
      const baseRef = trustBase ?? changeBase;
      const base = baseRef !== undefined && !staged ? ['--base', baseRef] : [];
      return [...(staged ? ['--staged'] : []), '--format', 'json', ...trust, ...base, ...passthrough];
    }
    case 'vault-guard':
      // No path argument: the CLI defaults it to "." and the umbrella runs
      // with cwd at the repository root anyway. Passing one would also risk
      // a passthrough value being read as the positional.
      //
      // `scan` takes --trust-base from 1.7.0. On exit 2 it prints a line on
      // stderr and may also write a JSON document (it can on a staged run, and
      // from 1.9.1 on a scan that skipped files). conductor never reads a
      // verdict out of stdout on exit 2: the could-not-run branch in
      // spawnAndRead, below, returns before the verdict JSON.parse is reached.
      // That branch does read the stderr first line, or a reason field in the
      // JSON, as a bounded excerpt for the reader (gateStatedReason).
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
          : intentBase !== undefined
            ? ['--base', intentBase]
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
      // --lockfile (the runner lists them, src/osv-coverage.ts), because
      // osv-scanner's own walk skips anything .gitignore matches, tracked or
      // not. With none there is nothing to hand over, and the runner reports
      // that without spawning the tool.
      if (external.lockfiles === undefined || external.lockfiles.length === 0) {
        throw new Error('osv-scanner needs at least one lockfile: with none, nothing is spawned');
      }
      const isRequirements = (file: string): boolean =>
        osvLockfileKind(path.basename(file)) === 'requirements';
      // A requirements variant (requirements-dev.txt) is handed in the
      // parse-as form, because 2.4.0 does not recognise the bare name;
      // requirements.txt itself and every exact lockfile name go bare
      // (npm-shrinkwrap.json is not even a valid parse-as type in 2.4.0).
      // The parse-as form splits on the first colon only, so a variant's own
      // path is safe; a bare path with a colon is split and exits 127, which
      // is a could-not-run, never a silent skip.
      const lockfiles = external.lockfiles.flatMap((file) => [
        '--lockfile',
        isRequirements(file) && path.basename(file) !== 'requirements.txt' ? `requirements.txt:${file}` : file,
      ]);
      // --no-resolve on every invocation that carries a requirements file,
      // and on the base run exactly when the head run had it (section 2.4):
      // without a lockfile, a resolved transitive version is the registry's
      // latest, not the installed one. Not overridable: a policy no-resolve
      // is dropped from such an invocation (the runner says so), because
      // no-resolve: false would render --no-no-resolve, which osv rejects.
      const noResolve = external.noResolve ?? external.lockfiles.some(isRequirements);
      const options: Record<string, OptionValue> = { ...gate.options };
      if (noResolve) {
        delete options['no-resolve'];
      }
      // On a pull-request run, call analysis is off for every language
      // unless the base policy says otherwise (section 3.3, open question 6):
      // the base copies carry no source, so call analysis could hide on the
      // head what the base run reports, and the comparison would then not be
      // a dependency fact. Off on both runs makes the head only gain
      // findings. A policy that names either key keeps its own value, on
      // both runs, through the passthrough.
      const callAnalysis =
        trustBase !== undefined && !('call-analysis' in options) && !('no-call-analysis' in options)
          ? ['--no-call-analysis=all']
          : [];
      return [
        '--format',
        'json',
        ...config,
        ...lockfiles,
        ...(noResolve ? ['--no-resolve'] : []),
        ...callAnalysis,
        ...renderOptionFlags(options),
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
type ProbeResult =
  | { kind: 'version'; value: string }
  | { kind: 'unreadable' }
  /**
   * The probe was stopped at the gate's limit: ETIMEDOUT, whatever its status.
   * `limit` is the one it ran under, the preview budget when that was smaller.
   */
  | { kind: 'timed-out'; elapsedMs: number; signal: string | null; limit: TimeLimit };

function probeVersion(
  binary: ResolvedBinary,
  product: Product,
  repoRoot: string,
  timeLimit: TimeLimit,
  preview?: PreviewSpawn
): ProbeResult {
  const spec = profileFor(product).versionProbe;
  if (binary.versionProbe === null || spec === null) {
    return { kind: 'unreadable' };
  }
  const limits = spawnLimits(timeLimit, preview, undefined);
  const probeStarted = Date.now();
  const probe = limits.start
    ? spawnSync(binary.versionProbe.command, binary.versionProbe.argv, {
        cwd: repoRoot,
        encoding: 'utf8',
        ...limits.options,
      })
    : notStartedResult();
  // FIRST, before the status: a probe that handled SIGTERM can exit 0 with a
  // version on stdout, and it was still stopped at the limit.
  const failure = spawnFailure(probe);
  if (failure !== null && failure.reason === 'timed-out') {
    return { kind: 'timed-out', elapsedMs: Date.now() - probeStarted, signal: failure.signal, limit: limits.limit };
  }
  if (probe.status !== 0 || typeof probe.stdout !== 'string') {
    return { kind: 'unreadable' };
  }
  // Take the first line and accept it only if the product's pattern matches,
  // so a future help banner does not end up in a SARIF driver's version
  // field. The npm gates print a bare version and their pattern keeps the
  // whole line; an external tool that prefixes its version with its name has
  // a capture group that takes the number alone.
  const first = probe.stdout.trim().split('\n')[0]?.trim() ?? '';
  const match = spec.pattern.exec(first);
  return match === null ? { kind: 'unreadable' } : { kind: 'version', value: (match[1] ?? match[0]).replace(/^v/, '') };
}

/**
 * The could-not-run for a gate whose version is not the expected one
 * (`version-skew`) or cannot be read (`version-unverified`).
 *
 * ONE BUILDER, TWO CALLERS, like gateProgramRefused: runGate reaches it right
 * after its version probe, and runAll reaches it earlier, through
 * `expectedVersionBeforePreparation`, before the intent gate's preparation
 * spawns the same binary. Two copies of the sentence would be two chances for
 * the reason, the detail or the enforce override to drift apart.
 *
 * ENFORCED whatever the policy says: the gate produced no verdict for
 * `enforce: false` to be a decision about.
 */
function versionNotExpected(
  gate: GatePolicy,
  binary: ResolvedBinary,
  version: string | null,
  expected: string,
  repoRoot: string
): GateOutcome {
  const relative = path.relative(repoRoot, binary.program);
  const inside =
    relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  // Repository-relative inside the repository; outside it, words only,
  // because this detail reaches the reports and a published log.
  const place = binary.source === 'node_modules' && inside ? relative : resolutionPlace(binary.source);
  const remedy = versionSkewRemedy(gate.product, binary.source, expected);
  const pinned = `${expected} (the version the action pinned)`;
  const detail =
    version === null
      ? `${gate.product} did not run: the version of the build resolved from ${place} could not be read, ` +
        `so it is not known to be ${pinned}. ${remedy}`
      : `${gate.product} did not run: the build resolved from ${place} reports version ` +
        `${versionCharacters(version)}, but this run expects ${pinned}. ${remedy}`;
  return {
    role: gate.role,
    product: gate.product,
    stage: gate.stage,
    argv: [],
    exitCode: null,
    durationMs: 0,
    stderr: '',
    ...(version === null
      ? {}
      : {
          // Kept for the job-log line, the annotation, the step summary,
          // the text report line and the SARIF note that 0.12.0 printed.
          versionSkew: {
            expected,
            found: version,
            source: binary.source,
            path: inside ? relative : binary.program,
          },
        }),
    productVersion: version,
    binary,
    enforce: true,
    couldNotRun: { reason: version === null ? 'version-unverified' : 'version-skew', detail },
    findings: [normalizeFailedGate(gate.role, gate.product, detail)],
    run: EMPTY_RUN,
    diagnostics: [],
  };
}

/**
 * The expected-version decision for the intent gate, made BEFORE its
 * preparation (residual 3, 2026-10-20).
 *
 * The preparation spawns the resolved binary for import-spec and freeze, and
 * a failed or timed-out preparation ends the gate there, so without this the
 * version check in runGate was never reached: an off-pin build whose
 * preparation failed on a run with no trust base and `enforce: false` read
 * preparation-failed, not enforced, exit 0, where runGate would have said
 * version-skew, exit 2. Here the same probe and the same builder as runGate's
 * decide first, and only the probe is spawned.
 *
 * Null when the version is the expected one: the preparation and runGate then
 * go on as before, and runGate probes again (one cheap spawn) and reaches the
 * same answer. The caller only calls this when an expectation is set; a run
 * without one never reaches it, and nothing about it changes.
 */
export function expectedVersionBeforePreparation(
  gate: GatePolicy,
  binary: ResolvedBinary,
  options: { repoRoot: string; expectedVersion: string; timeoutMs?: number; trustBase?: string }
): GateOutcome | null {
  const timeLimit = resolveTimeLimit(gate, options.timeoutMs);
  // What runGate's outcome carries on the same path, so the two report alike.
  const skipped = options.trustBase === undefined ? null : nodeModulesCandidate(gate, options.repoRoot);
  const carried = { timeLimit, ...(skipped === null ? {} : { nodeModulesSkipped: skipped }) };
  const started = Date.now();
  const probed = probeVersion(binary, gate.product, options.repoRoot, timeLimit);
  if (probed.kind === 'timed-out') {
    // The same outcome runGate builds for a stopped probe under the
    // expectation: enforced, because the run cannot show this is the pinned
    // build.
    const detail = timedOutDetail(gate, 'version-probe', timeLimit, probed.elapsedMs, options.trustBase);
    const timedOut = timedOutRecord('version-probe', timeLimit, probed.elapsedMs, probed.signal);
    return {
      role: gate.role,
      product: gate.product,
      stage: gate.stage,
      enforce: true,
      productVersion: null,
      argv: [],
      binary,
      exitCode: null,
      durationMs: Date.now() - started,
      stderr: '',
      ...carried,
      couldNotRun: { reason: 'timed-out', detail, timedOut },
      findings: [timedOutFinding(gate, detail, timedOut)],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }
  const version = probed.kind === 'version' ? probed.value : null;
  if (version === options.expectedVersion) {
    return null;
  }
  return {
    ...versionNotExpected(gate, binary, version, options.expectedVersion, options.repoRoot),
    ...carried,
    durationMs: Date.now() - started,
  };
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
  context: {
    blocked: boolean;
    roots: readonly string[];
    online: boolean;
    lockfiles: readonly string[];
    /** The child's stderr, read by the osv-scanner normalizer for its suppression lines only. */
    stderr: string;
  }
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
      return normalizeOsvScanner(
        parsed,
        version,
        context.blocked,
        context.roots,
        context.lockfiles,
        context.stderr
      );
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
            ...(options.intent.note === undefined ? {} : { note: options.intent.note }),
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
 * The two refusals only the preview under the proposed rules makes.
 *
 * An option value starting with "-" would render as a flag of its own
 * (renderOptionFlags), so a value the base never ran with could add an output
 * path or a second --log-opts. A base `command:` inside the working tree is
 * checked by refuseHeadControlledProgram for its own blob only, while what it
 * imports comes from the head, and the preview can reach a role the base has
 * switched off, whose command nobody has exercised (spec 5.2, finding 7).
 */
function previewRefusal(gate: GatePolicy, repoRoot: string): CouldNotRun | null {
  for (const name of Object.keys(gate.options).sort()) {
    const value = gate.options[name];
    const values = Array.isArray(value) ? value : [value];
    if (values.some((item) => typeof item === 'string' && item.startsWith('-'))) {
      return {
        reason: 'preparation-failed',
        detail: `preview under the proposed rules: option ${name} has a value starting with "-", so this gate was not run`,
      };
    }
  }
  // osv-scanner's call analysis builds the project it scans, and in the
  // preview that is the head's code (a Rust build.rs, for one). Off (`none`,
  // or false, which renders --no-call-analysis) is the only value it runs with.
  const callAnalysis = gate.options['call-analysis'];
  if (
    gate.product === 'osv-scanner' &&
    callAnalysis !== undefined &&
    callAnalysis !== false &&
    !(Array.isArray(callAnalysis) ? callAnalysis : [callAnalysis]).every((item) => item === 'none')
  ) {
    return {
      reason: 'preparation-failed',
      detail: "the preview does not run call analysis, because it would build the head's code",
    };
  }
  if (gate.command !== undefined && realPathInside(repoRoot, gate.command)) {
    return {
      reason: 'gate-program-refused',
      detail: `preview under the proposed rules: the base command ${gate.command} is inside the working tree, so this gate was not run`,
    };
  }
  return null;
}

/**
 * Whether git says the repository at `repoRoot` is shallow. Anything other
 * than a clear "true" (no git, an old git that does not know the flag) is
 * not shallow: those runs have their own failure paths.
 */
/** The oldest git a history gate runs under on a pull-request run. */
export const HISTORY_GIT_FLOOR = '2.31.0';

/** git's own version ("git version 2.39.3 (Apple Git-145)" reads 2.39.3), or null. */
function probeGitVersion(repoRoot: string): string | null {
  const probe = runGit(repoRoot, ['--version']);
  if (probe.error !== undefined || probe.status !== 0) {
    return null;
  }
  const match = /git version (\d+\.\d+\.\d+)/.exec(probe.stdout);
  return match === null ? null : match[1]!;
}

function isShallowRepository(repoRoot: string): boolean {
  const probe = runGit(repoRoot, ['rev-parse', '--is-shallow-repository']);
  return probe.status === 0 && probe.stdout.trim() === 'true';
}

function runGateInner(
  gate: GatePolicy,
  options: RunGateOptions,
  started: number,
  progress: Omit<GateOutcome, 'couldNotRun' | 'findings' | 'run' | 'diagnostics'>
): GateOutcome {
  // Every spawn of this gate gets the FULL limit, not a share of it: the
  // version probe, the scan and, on a compared pull request, osv-scanner's
  // base run. Onto `progress` so every outcome from here on carries it. In
  // the preview each spawn gets the smaller of this and what is left of the
  // preview's budget (spawnLimits), and the outcome says which it was.
  const timeLimit = resolveTimeLimit(gate, options.timeoutMs);
  Object.assign(progress, { timeLimit });
  const ownOption = gateOwnTimeoutNote(gate, timeLimit, options.trustBase);
  if (ownOption !== null) {
    // Before any spawn, the way nodeModulesSkipped is, so every return path
    // from here on carries it, the gate-error of gitleaks' own deadline
    // included.
    Object.assign(progress, { gateOwnOption: ownOption });
  }

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

  // THE PREVIEW'S OWN REFUSALS, before resolution and before any spawn, the
  // version probe included. The primary run needs neither.
  if (options.preview !== undefined) {
    const refused = previewRefusal(gate, options.repoRoot);
    if (refused !== null) {
      return {
        ...base,
        // Enforced under a trust base, like every refusal there; the preview
        // never reaches the exit code either way.
        enforce: options.trustBase !== undefined ? true : gate.enforce,
        durationMs: Date.now() - started,
        couldNotRun: refused,
        findings: [normalizeFailedGate(gate.role, gate.product, refused.detail)],
        run: EMPTY_RUN,
        diagnostics: [],
      };
    }
  }

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

  // THE GIT FLOOR, on a pull-request run, for a gate that reads history. The
  // newest git option this umbrella relies on is the one it hands gitleaks,
  // "git log --diff-merges=first-parent" (git 2.31, per git's release notes);
  // every other option conductor itself passes is older (rev-parse
  // --is-shallow-repository is git 2.15). An older git would make that gate
  // log a git error rather than say why, so the version is asked once, here,
  // and an older one is a named could-not-run. Only where the option is used:
  // a run with no history gate never pays for the probe or meets the floor.
  if (profileFor(gate.product).readsHistory && options.trustBase !== undefined) {
    const gitVersion = probeGitVersion(options.repoRoot);
    if (gitVersion === null || !atLeastVersion(gitVersion, HISTORY_GIT_FLOOR)) {
      const found =
        gitVersion === null
          ? `the git version could not be read, so git is not known to be ${HISTORY_GIT_FLOOR} or later`
          : `git ${gitVersion} is older than ${HISTORY_GIT_FLOOR}`;
      const detail =
        `${found}, which ${gate.product} needs on a pull-request run: conductor hands it ` +
        '"git log --diff-merges=first-parent", which arrived in git 2.31. Upgrade git, then run ' +
        'again. Nothing was checked by this gate.';
      return {
        ...base,
        enforce: true,
        durationMs: Date.now() - started,
        couldNotRun: { reason: 'preparation-failed', detail },
        findings: [normalizeFailedGate(gate.role, gate.product, detail)],
        run: EMPTY_RUN,
        diagnostics: [],
      };
    }
  }

  // A history gate cannot vouch for history it was not given. Checked before
  // the version probe so nothing is executed for a run that cannot be honest.
  if (profileFor(gate.product).readsHistory && isShallowRepository(options.repoRoot)) {
    const detail =
      `${gate.product} did not run, because this checkout is shallow and the git history it reads ` +
      'is truncated: with the default actions/checkout depth of 1 the range from the base to HEAD ' +
      'holds a single grafted commit, and a secret added and then removed inside the pull ' +
      'request would never be seen. Fix: check out with fetch-depth: 0 (actions/checkout) or run ' +
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

  const probed = probeVersion(binary, gate.product, options.repoRoot, timeLimit, options.preview);
  if (probed.kind === 'timed-out') {
    // The limit the probe ran under, which in the preview can be what was
    // left of the budget; onto `progress` so the outcome says so.
    Object.assign(progress, { timeLimit: probed.limit });
    // Stopped here, before the version floor and before decideTrustBase: a
    // timed-out probe is not an unreadable version (which on a pull request
    // would read as trust-base-unverified, a packaging problem that does not
    // exist), and a local run does not go on to scan with the version
    // unknown. Enforced under a trust base, like trust-base-unverified: the
    // gate could not be placed inside the boundary. Enforced under the
    // Action's expected-version signal too, like version-unverified: the run
    // cannot show this is the pinned build.
    const detail = timedOutDetail(gate, 'version-probe', probed.limit, probed.elapsedMs, options.trustBase);
    const timedOut = timedOutRecord('version-probe', probed.limit, probed.elapsedMs, probed.signal);
    return {
      ...base,
      binary,
      enforce: options.trustBase !== undefined || options.expectedVersion !== undefined ? true : gate.enforce,
      durationMs: Date.now() - started,
      exitCode: null,
      couldNotRun: { reason: 'timed-out', detail, timedOut },
      findings: [timedOutFinding(gate, detail, timedOut)],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }
  const version = probed.kind === 'version' ? probed.value : null;

  // THE EXPECTED VERSION (0.13.0, design
  // docs/superpowers/specs/2026-10-18-version-skew-could-not-run.md). When
  // the run was told which version must judge it (the Action's pin), a
  // binary at another version, or one whose version cannot be read, is
  // could-not-run, from whichever location resolution took it
  // (node_modules/.bin, PATH or a policy command). Resolution itself is
  // unchanged. Here, right after the probe and before the command-line floor
  // and decideTrustBase, so nothing past the probe runs. ENFORCED whatever
  // the policy says, like a refused program: the gate produced no verdict for
  // `enforce: false` to be a decision about. No expectation (every plain run)
  // skips all of this.
  if (options.expectedVersion !== undefined && version !== options.expectedVersion) {
    return {
      ...base,
      ...versionNotExpected(gate, binary, version, options.expectedVersion, options.repoRoot),
      durationMs: Date.now() - started,
    };
  }

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
      `${gate.product} did not run: the installed ${version} is older than ${profile.minVersion}, ` +
      'the oldest version whose command line this umbrella speaks. ' +
      `Fix: upgrade it to ${profile.minVersion} or later.`;
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
  // a gate IN the table whose version is below its minimum, or could not be
  // read, is refused rather than run outside the boundary.
  const trustBase = decideTrustBase(gate, options.intent, options.trustBase, version, options.preview !== undefined);

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
      // Reachable as an installation problem (a gate older than its minimum)
      // or a packaging one (a version that does not read), not as an attack:
      // the program check above runs first, and with its directory-subtree
      // rule a pull request cannot put a program here whose version probe it
      // controls. A build that fails loudly is the better failure: the
      // alternative is a boundary that quietly downgrades itself.
      enforce: true,
      trustBase,
      // decideTrustBase refuses for exactly two reasons: a version it could
      // not read, and a version it read that is below the minimum.
      couldNotRun: {
        reason: version === null ? 'trust-base-unverified' : 'gate-version-unsupported',
        detail: trustBase.refused,
      },
      findings: [normalizeFailedGate(gate.role, gate.product, trustBase.refused)],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  }

  const channel = intentChangeChannel(gate, options.intent, version);
  if (channel.kind === 'refused') {
    return {
      ...base,
      productVersion: version,
      binary,
      durationMs: Date.now() - started,
      // Enforced under a trust base: the gate produced nothing for
      // enforce: false to be a decision about.
      enforce: options.trustBase !== undefined ? true : gate.enforce,
      ...(trustBase === undefined ? {} : { trustBase }),
      couldNotRun: { reason: 'preparation-failed', detail: channel.detail },
      findings: [normalizeFailedGate(gate.role, gate.product, channel.detail)],
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
      timeLimit,
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
  /** The resolved limit; its `ms` bounds the scan and osv-scanner's base run alike. */
  timeLimit: TimeLimit;
  workDir: string | null;
}

/** Strips ANSI colour codes: gitleaks colours its log even off a terminal. */
function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/** Builds the command line, runs the gate, and reads what it said. */
function spawnAndRead(ctx: SpawnContext): GateOutcome {
  const { gate, options, started, progress, base, binary, version, trustBase, profile, timeLimit, workDir } =
    ctx;
  const timeoutMs = timeLimit.ms;

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
  // What the osv gate's selection said beside the list it handed over: the
  // umbrella's own diagnostics (a requirements file left out, or scanned
  // under the ratchet, a passthrough option dropped) and the per-file run
  // notes. Carried onto every outcome from here on that reports a scan.
  let selection: OsvSelection | null = null;
  const selectionDiagnostics: Diagnostic[] = [];
  // On a decided trust base, the base lockfiles the head deleted or moved:
  // candidates for the emptied-lockfile base check below. Null when the base
  // tree could not be listed, which that check reads as unverified.
  let removedLockfiles: string[] | null = [];

  // THE EMPTIED-LOCKFILE BASE CHECK (audit 2026-10-18 N1, design
  // docs/superpowers/specs/2026-10-18-emptied-lockfile-under-trust-base.md).
  // Only on a decided trust base and only for the vulnerabilities gate. The
  // candidates are the emptied handed lockfiles plus the base lockfiles the
  // head deleted or moved. Called after a completed head scan (every head
  // could-not-run returns first), or, when nothing at all was handed, in its
  // place. Returns the could-not-run outcome, or null when the head result
  // stands. `headArgv` null means no head run, so there is no command line
  // to hold the base one against.
  const removalCheck = (input: {
    emptied: readonly string[];
    headCounts: ReadonlyMap<string, number>;
    headArgv: readonly string[] | null;
    budgetMs: number;
    outcome: Omit<GateOutcome, 'couldNotRun' | 'findings' | 'run' | 'diagnostics'>;
  }): GateOutcome | null => {
    if (gate.product !== 'osv-scanner' || decidedRef === undefined) {
      return null;
    }
    const removed = removedLockfiles;
    if (input.emptied.length === 0 && removed !== null && removed.length === 0) {
      return null;
    }
    const baseArgv = (copies: readonly string[]): string[] => [
      ...binary.argvPrefix,
      ...gateArgs(gate, options.staged, options.intent, decidedRef, { ...external, lockfiles: [...copies] }),
    ];
    const checked: EmptiedCheckResult =
      removed === null
        ? { kind: 'unverified', detail: `the base tree at ${decidedRef} could not be listed` }
        : workDir === null
          ? { kind: 'unverified', detail: 'there is no work directory to hold the base copies' }
          : checkEmptiedAgainstBase({
              repoRoot: options.repoRoot,
              ref: decidedRef,
              workDir,
              emptied: input.emptied,
              removed,
              headCounts: input.headCounts,
              headArgv: input.headArgv,
              baseArgv,
              budgetMs: input.budgetMs,
              spawn: (argv, cwd, budget) => {
                const limits = spawnLimits({ ...timeLimit, ms: budget }, options.preview, undefined);
                const baseChild = limits.start
                  ? spawnSync(binary.command, [...argv], {
                      cwd,
                      encoding: 'utf8',
                      maxBuffer: 64 * 1024 * 1024,
                      ...limits.options,
                    })
                  : notStartedResult();
                return {
                  status: baseChild.status,
                  stderr: stripAnsi(baseChild.stderr ?? ''),
                  failure: spawnFailure(baseChild),
                };
              },
            });
    if (checked.kind === 'clear') {
      return null;
    }
    const done = { ...input.outcome, durationMs: Date.now() - started };
    if (checked.kind === 'timed-out') {
      const detail = timedOutDetail(gate, 'base-check', timeLimit, checked.elapsedMs, options.trustBase);
      const timedOut = timedOutRecord('base-check', timeLimit, checked.elapsedMs, checked.signal);
      return {
        ...done,
        couldNotRun: { reason: 'timed-out', detail, timedOut },
        findings: [timedOutFinding(gate, detail, timedOut)],
        run: EMPTY_RUN,
        diagnostics: [],
      };
    }
    const named = [...new Set([...input.emptied, ...(removed ?? [])])];
    const detail =
      checked.kind === 'emptied'
        ? `${checked.files
            .map((entry) =>
              entry.removed
                ? `${entry.path} is not in this pull request but had ${entry.packages} package(s) at the base (${decidedRef})`
                : `${entry.path} read no packages at the head but ${entry.packages} at the base (${decidedRef})`
            )
            .join('; ')}, so the dependencies this pull request removed cannot be judged. Regenerate the ` +
          'lockfile, or add its replacement beside the same manifest in this pull request, or remove ' +
          "the manifest's dependencies with it."
        : `${named.join(', ')} ${named.length === 1 ? 'was' : 'were'} emptied, deleted or moved by this pull ` +
          `request, and the check that the base had no packages there could not be completed: ` +
          `${checked.detail}. Nothing the pull request removed was judged.`;
    return {
      ...done,
      couldNotRun: { reason: checked.kind === 'emptied' ? 'lockfile-emptied' : 'lockfile-emptied-unverified', detail },
      findings: [normalizeFailedGate(gate.role, gate.product, detail)],
      run: EMPTY_RUN,
      diagnostics: [],
    };
  };
  // Tracked manifests this gate was NOT handed, when it was handed others
  // (review of 1b.2, item 5): a run note, so a Podfile.lock beside a scanned
  // mix.lock is named without pushing a clean run off its one-line summary.
  // The nothing-to-scan branch below names them in its own diagnostic.
  let unreadNote: Diagnostic | null = null;
  if (profile.lockfileMatcher !== null) {
    const listing = runGit(options.repoRoot, ['ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 });
    if (listing.error !== undefined || listing.status !== 0) {
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
      try {
        nestedProposals.push(
          ...nestedConfigProposals(options.repoRoot, decidedRef, tracked, profile.configFile)
        );
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
    }
    // The pin check reads the head copies on disk and, on a pull request, the
    // base copies through the one reader; both are selection, not verdicts.
    selection = selectOsvInputs({
      repoRoot: options.repoRoot,
      tracked,
      ...(decidedRef === undefined ? {} : { decidedRef }),
    });
    external.lockfiles = selection.handed;
    selectionDiagnostics.push(...selection.diagnostics);
    if (decidedRef !== undefined) {
      selectionDiagnostics.push(...noLongerScanned(options.repoRoot, decidedRef, new Set(tracked)));
      removedLockfiles = noLongerScannedFiles(options.repoRoot, decidedRef, new Set(tracked));
    }
    if (external.lockfiles.length > 0) {
      const unread = unreadManifestsNote(tracked, new Set(selection.handed), gate.product);
      unreadNote = unread === null ? null : { code: 'conductor/manifests-not-handed', message: unread };
    }
    if (external.lockfiles.length === 0) {
      // Nothing to scan, reported the same way as osv-scanner's own 128 below,
      // without spawning it. The verdict is unchanged (clean); what changes is
      // what is said: which requirements files the pin check left out, and
      // which tracked manifests were not handed to this scanner.
      // Every lockfile the base had may have been deleted: on a trust base
      // the removed ones are still checked, with no head scan to precede
      // it, so the whole limit is the budget.
      const removedOutcome = removalCheck({
        emptied: [],
        headCounts: new Map(),
        headArgv: null,
        budgetMs: timeoutMs,
        outcome: {
          ...base,
          productVersion: version,
          binary,
          ...(trustBase === undefined ? {} : { trustBase }),
          exitCode: null,
        },
      });
      if (removedOutcome !== null) {
        return removedOutcome;
      }
      const unread = unreadManifestsNote(tracked, new Set(selection.handed), gate.product);
      const cleanBecause =
        'the verdict is clean because there was nothing to read, not because a scan found nothing.';
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
          ...selectionDiagnostics,
          {
            code: 'conductor/nothing-to-scan',
            message:
              (selection.notScanned.length > 0
                ? `${nothingScannableMessage(selection.notScanned)} T${cleanBecause.slice(1)}`
                : `${gate.product} read no lockfile, so nothing was scanned; ${cleanBecause}`) +
              (unread === null ? '' : ` ${unread}`),
          },
        ],
      };
    }
    external.noResolve = external.lockfiles.some(
      (file) => osvLockfileKind(path.posix.basename(file)) === 'requirements'
    );
    if (external.noResolve && 'no-resolve' in gate.options) {
      selectionDiagnostics.push({ code: 'conductor/option-overridden', message: NO_RESOLVE_OVERRIDDEN });
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
      const gitDir = runGit(options.repoRoot, ['rev-parse', '--absolute-git-dir']);
      const resolved = gitDir.stdout.trim();
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

  // Decided again here from the same inputs rather than threaded through:
  // intentChangeChannel is pure, and runGateInner already returned on the one
  // outcome that does not spawn.
  const channel = intentChangeChannel(gate, options.intent, version);
  // In the preview, dep-guard and vault-guard are not handed --trust-base
  // (decideTrustBase), and dep-guard still measures the change against the
  // base ref: --base comes from the run's trust base, which stays set.
  const changeBase =
    options.preview !== undefined && trustBase?.withheld === PREVIEW_WITHHELD ? options.trustBase : undefined;
  const argv = [
    ...binary.argvPrefix,
    ...gateArgs(
      gate,
      options.staged,
      options.intent,
      decidedRef,
      external,
      channel.kind === 'base' ? channel.ref : undefined,
      changeBase
    ),
  ];

  // A history gate reads git history, and replace refs or grafts can cut
  // that history without making the repository shallow. Ignoring replace
  // objects makes it read the real commits. Other gates keep the inherited
  // environment untouched, outside the preview.
  const scanLimits = spawnLimits(
    timeLimit,
    options.preview,
    profile.readsHistory ? { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' } : undefined
  );
  if (scanLimits.limit !== timeLimit) {
    Object.assign(progress, { timeLimit: scanLimits.limit });
  }
  // Taken just before the call, so a timed-out message's elapsed time is the
  // scan's own and not resolution plus the version probe.
  const spawnStarted = Date.now();
  const child = scanLimits.start
    ? spawnSync(binary.command, argv, {
        cwd: spawnCwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        ...scanLimits.options,
      })
    : notStartedResult();

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
    // place a report can say a gate was not handed the base ref.
    ...(trustBaseOut === undefined ? {} : { trustBase: trustBaseOut }),
  };
  // Keep the backstop's view current, so an unexpected throw below still
  // reports which binary ran and what it printed.
  Object.assign(progress, withRun);

  // The emptied-lockfile base check after a completed head scan, under what
  // is left of the limit (removalCheck, above).
  const emptiedOnBase = (
    emptied: readonly string[],
    headCounts: ReadonlyMap<string, number>,
    exitCode: number
  ): GateOutcome | null =>
    removalCheck({
      emptied,
      headCounts,
      headArgv: argv,
      budgetMs: timeoutMs - (Date.now() - spawnStarted),
      outcome: { ...withRun, exitCode },
    });

  // THE FIRST THING READ after spawnSync returns, ahead of every status,
  // signal, report and stdout check, and it returns for every error. A child
  // stopped at the limit that handled SIGTERM can come back with status 0, or
  // its blocked code, and a complete clean report or clean JSON on stdout;
  // only this order keeps that from reading as a verdict. The outcome's
  // exitCode is null whatever child.status says: a status from a child that
  // was told to stop is not a verdict. Nothing on this path reads the report
  // file, parses stdout or calls a normalizer.
  const failure = spawnFailure(child);
  if (failure !== null) {
    if (failure.reason === 'timed-out') {
      const elapsedMs = Date.now() - spawnStarted;
      const detail = timedOutDetail(gate, 'scan', scanLimits.limit, elapsedMs, options.trustBase);
      const timedOut = timedOutRecord('scan', scanLimits.limit, elapsedMs, failure.signal);
      return {
        ...withRun,
        exitCode: null,
        couldNotRun: { reason: 'timed-out', detail, timedOut },
        findings: [timedOutFinding(gate, detail, timedOut, withRun.stderr)],
        run: EMPTY_RUN,
        diagnostics: [],
      };
    }
    return {
      ...withRun,
      exitCode: null,
      couldNotRun: { reason: 'spawn-failed', detail: failure.message },
      findings: [normalizeFailedGate(gate.role, gate.product, failure.message, withRun.stderr)],
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
    const handedAll = external.lockfiles ?? [];
    // Every handed file read nothing: on a trust base, each one's base copy
    // is checked (the emptied-lockfile check above).
    const emptiedAll = emptiedOnBase(handedAll, new Map(), exitCode);
    if (emptiedAll !== null) {
      return emptiedAll;
    }
    return {
      ...withRun,
      exitCode: 0,
      couldNotRun: null,
      findings: [],
      // Every handed lockfile parsed to nothing: `packages-read 0` is the
      // marker that this gate read NOTHING (the verdict token's
      // nothing-checked rule reads it), which the partial-empty note further
      // down shares a diagnostic code with but never carries.
      run:
        handedAll.length === 0
          ? EMPTY_RUN
          : {
              ...EMPTY_RUN,
              diagnostics: unreadNote === null ? [] : [unreadNote],
              details: {
                lockfiles: describeLockfiles(handedAll, new Set(handedAll)),
                'packages-read': 0,
              },
            },
      diagnostics: [
        ...selectionDiagnostics,
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
              message:
                `${gate.product} read no lockfile (exit ${exitCode}), so nothing was scanned; the ` +
                `verdict is clean because there was nothing to read, not because a scan found nothing.`,
            },
      ],
    };
  }

  // The profile says which exits are verdicts. For the npm gates that is 0
  // and 1, exactly as before profiles existed: dep-guard's 2 means "could not
  // run the checks at all" and it prints no JSON. gitleaks is handed
  // --exit-code 3, so its 1 is left meaning an error. A child killed by
  // something other than the umbrella lands here too (a timeout returned
  // above), and none of those are a clean result.
  const blocked = exitCode !== null && profile.exit.blocked.includes(exitCode);
  if (exitCode === null || (!blocked && !profile.exit.clean.includes(exitCode))) {
    const detail =
      exitCode === null
        ? `the gate was killed by signal ${child.signal ?? 'unknown'} before it exited.`
        : `the gate exited ${exitCode}, which it uses for "could not run".`;
    // WHY, in the gate's own words, when it said. Read here and nowhere
    // earlier: the exit code has already been judged above, and this only
    // annotates the result. It never reads stdout for a verdict.
    const gateSaid =
      exitCode === null
        ? null
        : gateStatedReason(withRun.stderr, child.stdout, profile.output.kind === 'stdout');
    return {
      ...withRun,
      exitCode,
      couldNotRun: {
        reason: 'gate-error',
        detail,
        ...(gateSaid === null ? {} : { gateSaid }),
      },
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
      stderr: withRun.stderr,
    });
    // The base comparison (osv design, section 3.1): only on a decided trust
    // base, only when the head run exited blocked and produced a finding. A
    // clean head, nothing to scan, empty lockfiles and every could-not-run
    // returned before this, so none of them costs anything new. Its own
    // try: a comparison that throws labels every finding introduced and is
    // never a could-not-run, unlike the normalizer failure the catch below
    // is for.
    let findings = normalized.findings;
    // A handed lockfile osv-scanner read no packages from, while it read
    // packages from another (audit finding F2). Exit 128 above covers only
    // the all-empty case; this is the rest, named on the coverage line and
    // in a diagnostic, so an emptied lockfile's advisories never vanish
    // without a word. Annotation only on a plain run; on a trust base the
    // emptied-lockfile check runs first, BEFORE the comparison, and a head
    // that blocked is checked too, so the verdict is could-not-run rather
    // than blocked when the head emptied a file the base had packages in.
    const emptied =
      gate.product === 'osv-scanner'
        ? emptiedLockfiles(withRun.stderr, external.lockfiles ?? [], spawnCwd)
        : [];
    const headCounts =
      gate.product === 'osv-scanner'
        ? packageCounts(withRun.stderr, external.lockfiles ?? [], spawnCwd)
        : new Map<string, number>();
    // A LOWERED VERBOSITY FAILS CLOSED on a trust base: without a count line
    // for a handed lockfile, an emptied one cannot be told from a populated
    // one, so the check that the head removed nothing cannot run. Said, and
    // the option left alone: conductor never edits a gate's configuration.
    const uncounted =
      gate.product === 'osv-scanner' && decidedRef !== undefined
        ? (external.lockfiles ?? []).filter(
            (file) => osvLockfileKind(path.posix.basename(file)) !== 'requirements' && !headCounts.has(file)
          )
        : [];
    if (uncounted.length > 0) {
      const detail =
        `osv-scanner printed no package count for ${uncounted.join(', ')}, which the trust-base check that ` +
        'this pull request emptied, deleted or moved no lockfile needs. A verbosity option in the ' +
        "policy's osv-scanner options hides those counts: remove it.";
      return {
        ...withRun,
        durationMs: Date.now() - started,
        exitCode,
        couldNotRun: { reason: 'lockfile-emptied-unverified', detail },
        findings: [normalizeFailedGate(gate.role, gate.product, detail)],
        run: EMPTY_RUN,
        diagnostics: [],
      };
    }
    const emptiedOutcome = emptiedOnBase(emptied, headCounts, exitCode as number);
    if (emptiedOutcome !== null) {
      return emptiedOutcome;
    }
    let baseComparison: BaseComparison | undefined;
    const comparisonDiagnostics: Diagnostic[] = [];
    if (
      gate.product === 'osv-scanner' &&
      decidedRef !== undefined &&
      workDir !== null &&
      blocked &&
      findings.length > 0
    ) {
      const compareArgs: CompareArgs = {
        repoRoot: options.repoRoot,
        ref: decidedRef,
        workDir,
        policy: gate.presentOnBase ?? 'block',
        version,
        headFindings: findings,
        headLockfiles: external.lockfiles ?? [],
        closures: selection?.closures ?? new Map(),
        otherVerdicts: normalized.otherVerdicts ?? [],
        headArgv: argv,
        baseArgv: (copies) => [
          ...binary.argvPrefix,
          ...gateArgs(gate, options.staged, options.intent, decidedRef, { ...external, lockfiles: copies }),
        ],
        spawn: (baseArgv, cwd) => {
          const limits = spawnLimits(timeLimit, options.preview, undefined);
          const baseChild = limits.start
            ? spawnSync(binary.command, [...baseArgv], {
                cwd,
                encoding: 'utf8',
                maxBuffer: 64 * 1024 * 1024,
                ...limits.options,
              })
            : notStartedResult();
          return { status: baseChild.status, stdout: baseChild.stdout ?? '', error: baseChild.error };
        },
        rootSpellings,
      };
      let compared;
      try {
        compared = compareWithBase(compareArgs);
      } catch (err) {
        compared = comparisonFailed(compareArgs, `the comparison failed (${messageOf(err)})`);
      }
      findings = compared.findings;
      baseComparison = compared.comparison;
      comparisonDiagnostics.push(...compared.diagnostics);
    }
    const emptyDiagnostics: Diagnostic[] =
      emptied.length === 0
        ? []
        : [
            {
              code: 'conductor/lockfiles-empty',
              message:
                `${gate.product} read no packages from ${emptied.join(', ')} while it read packages ` +
                'from the other lockfiles, so nothing in the named file(s) was checked. A lockfile ' +
                'emptied in this change hides every advisory it carried; look at its diff.',
            },
          ];
    const run =
      selection === null
        ? normalized.run
        : {
            ...normalized.run,
            diagnostics: [
              ...normalized.run.diagnostics,
              ...selection.notes,
              ...(unreadNote === null ? [] : [unreadNote]),
            ],
            details: {
              ...normalized.run.details,
              ...(emptied.length === 0
                ? {}
                : { lockfiles: describeLockfiles(external.lockfiles ?? [], new Set(emptied)) }),
              ...(selection.notScanned.length === 0
                ? {}
                : { 'not-scanned': notScannedDetail(selection.notScanned) }),
            },
          };
    return {
      ...withRun,
      exitCode,
      couldNotRun: null,
      findings,
      run,
      diagnostics: [
        ...normalized.diagnostics,
        ...selectionDiagnostics,
        ...emptyDiagnostics,
        ...comparisonDiagnostics,
      ],
      ...(baseComparison === undefined ? {} : { baseComparison }),
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
