// Giving the intent gate a frozen contract for one run, without writing one
// into the repository.
//
// The gate refuses to check anything against a contract nobody approved, and
// approving one is a per-task human step. That step is the ceremony the
// stopping-points design exists to keep out of a pull request, so this file
// stands in for it: it takes the document the work was actually approved
// from, hands it to intent-guard's own importer, freezes the draft in a
// TEMPORARY directory, and points the gate at that directory for the length
// of one run.
//
// Two rules keep that from being a lie:
//
//  - NOTHING IS EVER WRITTEN UNDER THE REPOSITORY'S OWN STATE DIRECTORY,
//    under either of its two names. A contract is a committed artifact with
//    an approver's name on it. A pull-request run that dropped one into the
//    working tree would either be committed by accident or picked up by the
//    next run as though a person had approved it, and the second failure is
//    silent.
//
//  - THE REPOSITORY'S OWN FROZEN CONTRACT ALWAYS WINS. Where a team has done
//    the native flow, the native flow is what runs; the import is the
//    fallback for a repository that has not, not a replacement for one that
//    has. "Exists" is not the test, though: an unfrozen contract is a draft
//    somebody left behind, and running the gate against it fails every pull
//    request on "not frozen by user" without checking anything.
//
// Every step can fail, and every failure NAMES ITS STEP. The gate is
// could-not-run for the whole run either way, so the only thing that
// distinguishes a shallow checkout from a spec the importer choked on is the
// sentence in the report.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { changedPathsSince, currentBranch, resolveBaseRef } from './intent-base.js';
import { summariseStderr } from './normalize.js';
import { SPEC_DIR, discoverSpec, prBodyFromEvent } from './intent-spec.js';
import type { ResolvedBinary } from './resolve.js';

/** Prefix of the per-run directory, exported so a test can count leaks. */
export const TEMP_PREFIX = 'conductor-intent-';

/**
 * Where intent-guard keeps a project's frozen contract, canonical first.
 *
 * intent-guard 1.3.0 renamed its per-project state directory from
 * `.conductor` to `.intent-guard`, because `.conductor` had become the name
 * of a DIFFERENT product in the same family: a repository adopting both
 * showed `.conductor/` and `.guardrails/` side by side with nothing to say
 * which tool owned which. The umbrella has to read both, because the two
 * versions will be installed side by side across repositories for as long as
 * anybody is slow to upgrade, and a gate whose contract the umbrella cannot
 * find is a pull request blocked on nothing.
 *
 * THE ORDER IS THE RULE, and it is the same order intent-guard itself uses:
 * canonical wins outright, and the legacy path is consulted only when the
 * canonical one holds nothing. Reversing it would make a migrated repository
 * keep reading the directory the migration left behind.
 */
export const STATE_DIR = '.intent-guard';

/** The pre-1.3.0 directory. Read as a fallback, never written to. */
export const LEGACY_STATE_DIR = '.conductor';

export const NATIVE_CONTRACT_PATH = `${STATE_DIR}/intent-contract.yaml`;

/** The pre-1.3.0 path. Read as a fallback, never written to. */
export const LEGACY_NATIVE_CONTRACT_PATH = `${LEGACY_STATE_DIR}/intent-contract.yaml`;

/** Both, canonical first, so no caller has to spell the order itself. */
export const NATIVE_CONTRACT_PATHS = [
  NATIVE_CONTRACT_PATH,
  LEGACY_NATIVE_CONTRACT_PATH,
] as const;

/**
 * Whether a contract source path is the pre-1.3.0 one.
 *
 * A PREDICATE over the path rather than a flag carried beside it. The path is
 * already the fact, and a boolean travelling next to it is a second copy that
 * can disagree with the first -- the failure this repository has written down
 * about recomputing a gate's decision in a renderer, in the same shape.
 */
export function isLegacyContractPath(contractPath: string): boolean {
  return contractPath === LEGACY_NATIVE_CONTRACT_PATH;
}

export type ContractSource =
  /** The repository's own frozen contract, used untouched. */
  | { kind: 'native'; path: string }
  /** A spec imported and frozen for this run only. Repository-relative paths. */
  | { kind: 'imported'; spec: string; plan: string | null }
  | { kind: 'none' };

export interface IntentPreparation {
  contractSource: ContractSource;
  /** The ref the change set was measured against, or null for a staged run. */
  baseRef: string | null;
  /** Whether that ref was asked for or inferred from the CI environment. */
  baseSource: 'flag' | 'github' | null;
  /** What to hand the gate as --project: "." or an absolute temporary path. */
  projectDir: string;
  /** The changed paths, or null to leave v0.1's staged behaviour alone. */
  paths: string[] | null;
  /** Removes anything written outside the repository. Safe to call twice. */
  cleanup: () => void;
}

/** Which link of the chain broke. Carried into the report verbatim. */
export type PrepareStep =
  | 'spec'
  | 'base'
  /**
   * The repository holds a frozen contract at BOTH the canonical and the
   * legacy path, so which one the gate is about cannot be answered. Its own
   * step because it happens before anything is spawned and before a spec is
   * even looked for, and because the fix is in the repository rather than in
   * anything conductor did.
   */
  | 'contract-source'
  | 'import-spec'
  | 'write-contract'
  | 'freeze';

export type IntentPrepareResult =
  | { kind: 'ready'; preparation: IntentPreparation }
  /**
   * Nothing to check against: an advisory, never an exit code.
   *
   * Two reasons, and they are different facts about the same run.
   * `no-contract` is the ordinary state of a branch nobody has written a
   * spec for; `contract-waived` is somebody saying in the pull request body
   * that there is deliberately no spec for this one. Reporting the second as
   * the first tells a reviewer to go and write a spec that was already
   * decided against.
   */
  | { kind: 'skip'; reason: 'no-contract' | 'contract-waived'; detail: string }
  | { kind: 'failed'; step: PrepareStep; detail: string };

export interface IntentPrepareOptions {
  repoRoot: string;
  /** The resolved intent-guard binary, or null when none is installed. */
  binary: ResolvedBinary | null;
  env: NodeJS.ProcessEnv;
  base?: string;
  spec?: string;
  timeoutMs?: number;
  /**
   * The directory the per-run temporary project is created under.
   *
   * Injected exactly like `env` and `pathValue` are, and for the same kind
   * of reason: the two tests that prove nothing is leaked count the
   * `conductor-intent-` directories either side of a run, and counting them
   * in the shared temporary directory made each of those tests depend on
   * what the other jest worker happened to be doing at that moment. Nothing
   * in production passes it, so a real run still uses the system temporary
   * directory. It cannot be steered with TMPDIR from a test either: node
   * reads that from the real process environment, and a jest test's
   * `process.env` is a copy that never reaches it.
   */
  tempRoot?: string;
}

/**
 * Whether a contract on disk has been approved.
 *
 * `frozen_by: user` and nothing else, because that is the marker THE GATE
 * ITSELF reads. Accepting an `approval` block as an alternative was a guess
 * dressed up as tolerance: a real 1.2.1 freeze writes both, so the only
 * contracts the second test admitted were hand-edited or half-written ones,
 * and admitting those skipped the import and then let the gate block every
 * pull request with "exists but is not frozen by user" -- the exact failure
 * this function exists to prevent.
 *
 * A file that cannot be parsed is treated as not frozen, which sends the run
 * down the import path rather than handing the gate something it will reject.
 */
function contractIsFrozenAt(absolutePath: string): boolean {
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(absolutePath, 'utf8'));
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return false;
  }
  // BOTH halves, because both halves are the gate's own test
  // (`isContractFrozen`: frozen_by === "user" && approval != null), and its
  // comment says frozen_by alone, hand-set in YAML, is not enough. This
  // function reconstructs that judgment from the file rather than asking the
  // gate, so reconstructing only half of it means calling a contract frozen
  // that the gate will call unfrozen -- which skips the import and then
  // blocks the pull request on "exists but is not frozen by user" without
  // checking anything, the exact failure the surrounding rule exists to
  // prevent. A real freeze on either version writes both, so requiring both
  // excludes no contract either tool produced.
  const contract = parsed as { frozen_by?: unknown; approval?: unknown };
  return (
    contract.frozen_by === 'user' && contract.approval !== undefined && contract.approval !== null
  );
}

/**
 * Every state directory in this repository holding a FROZEN contract,
 * canonical first.
 *
 * Zero is the ordinary case for a repository that has not done the native
 * flow, one is the answer this exists to give, and two cannot reach here:
 * `stateDirsConflict` below has already refused that repository, on a rule
 * wider than this one.
 *
 * FROZEN is the test rather than EXISTS for the reason the single-path
 * version of this already recorded: an unfrozen contract is a draft somebody
 * left behind, and handing the gate one fails every pull request on "not
 * frozen by user" without checking anything.
 */
function frozenNativeContracts(repoRoot: string): string[] {
  return NATIVE_CONTRACT_PATHS.filter((relative) =>
    contractIsFrozenAt(path.join(repoRoot, relative))
  );
}

/**
 * The files only intent-guard writes into its state directory.
 *
 * Copied from the gate's own `holdsIntentGuardState`, because the rule below
 * has to be the gate's rule and not an approximation of it. A `.conductor`
 * holding none of these belongs to something else, and neither tool touches
 * it.
 */
const STATE_MARKERS = [
  'config.yaml',
  'intent-contract.yaml',
  'index.md',
  'drift-log.jsonl',
  'contracts',
];

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function holdsIntentGuardState(dir: string): boolean {
  if (!isDirectory(dir)) {
    return false;
  }
  return STATE_MARKERS.some((marker) => existsSync(path.join(dir, marker)));
}

/**
 * Whether this repository is in the state intent-guard 1.3.0 refuses to run
 * ANY command in.
 *
 * THIS MIRRORS THE GATE'S OWN CONFLICT RULE, deliberately and exactly
 * (`inspectStateDir` in the gate's state-dir.ts): the canonical directory
 * merely EXISTING, even empty, beside a legacy directory holding any state
 * marker, frozen or not. Both halves are wider than they look and both
 * matter.
 *
 * An earlier version of this file used a narrower rule -- both directories
 * holding a FROZEN contract -- on the reasoning that a stale unfrozen draft
 * beside a real contract has an obvious right answer and refusing would fail
 * pull requests over a file nobody had looked at in months. That reasoning
 * was about the wrong tool. The gate does not share it: in that exact state
 * `stateDir` throws and every intent-guard command exits 1. So the narrower
 * rule did not save those pull requests, it just moved where they broke --
 * conductor handed the gate a repository the gate refuses to run in, the
 * child exited non-zero with no JSON, and the run surfaced as
 * gate-output-unparseable with a message about the umbrella being out of
 * date. A guess about somebody else's tool is worth what the run that
 * checked it is worth, and this one had not been checked.
 */
function stateDirsConflict(repoRoot: string): boolean {
  return (
    isDirectory(path.join(repoRoot, STATE_DIR)) &&
    holdsIntentGuardState(path.join(repoRoot, LEGACY_STATE_DIR))
  );
}

/**
 * The contract file inside a prepared temporary project, canonical first, or
 * null when neither path holds one.
 *
 * EXISTS rather than FROZEN, unlike the repository-side lookup above, and the
 * difference is deliberate: this asks whether the freeze step left a file
 * where the gate will look for it, and reading `frozen_by` here would be the
 * umbrella double-checking a decision it just asked intent-guard to make.
 */
function frozenContractIn(projectDir: string): string | null {
  return (
    NATIVE_CONTRACT_PATHS.find((relative) => existsSync(path.join(projectDir, relative))) ?? null
  );
}

/**
 * The command line for one intent-guard subcommand.
 *
 * The resolved binary already carries `check` as its argument prefix, since
 * running the gate is what every other caller wants. The chain needs two
 * other subcommands off the same binary, so the trailing `check` is replaced.
 * A binary whose prefix does not end in `check` is one the candidate table
 * did not choose (the per-command `intent-guard-check`, or a `command:`
 * override with its own `args:`), and neither can run `import-spec` at all.
 */
function subcommand(
  binary: ResolvedBinary,
  name: string
): { command: string; argv: string[] } | null {
  const prefix = binary.argvPrefix;
  if (prefix[prefix.length - 1] !== 'check') {
    return null;
  }
  return { command: binary.command, argv: [...prefix.slice(0, -1), name] };
}

interface ChildResult {
  status: number | null;
  stdout: string;
  stderr: string;
  errorMessage: string | null;
}

function run(
  command: string,
  argv: string[],
  cwd: string,
  timeoutMs: number
): ChildResult {
  const child = spawnSync(command, argv, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: child.status,
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
    errorMessage: child.error === undefined ? null : child.error.message,
  };
}

/**
 * Everything the child complained with, trimmed and capped.
 *
 * THIS USED TO BE THE FIRST LINE, and that was a real defect rather than a
 * stylistic choice. The draft is written under the legacy directory name, so
 * intent-guard 1.3.0 prints "reading project state from .conductor/, renamed
 * to .intent-guard/ in 1.3.0" as line one of stderr on EVERY import-spec and
 * EVERY freeze in a prepared project. Taking line one therefore reported the
 * rename notice as the reason the step failed and discarded the sentence
 * saying what was actually wrong, on every failure, on the version this
 * release exists to support.
 *
 * The cap is the same one the gate-failed carry uses, and for the same
 * reason: this string ends up in an uploaded report, and a child that dumps
 * a stack must not grow it without a bound.
 */
function complaint(result: ChildResult): string {
  return summariseStderr(result.stderr.trim() === '' ? result.stdout : result.stderr) ?? '';
}

/** The short commit the contract is attributed to, or a placeholder. */
function shortHead(repoRoot: string): string {
  const child = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const value = (child.stdout ?? '').trim();
  return child.status === 0 && value !== '' ? value : 'an unknown commit';
}

export function prepareIntent(options: IntentPrepareOptions): IntentPrepareResult {
  const { repoRoot, env } = options;
  const timeoutMs = options.timeoutMs ?? 120_000;

  // The contract source is decided FIRST, before git is touched. A repository
  // with no spec is never blocked by this gate, and that promise has to hold
  // on a shallow checkout too: resolving the base ref first would turn a
  // fetch-depth of 1 into exit 2 on a repository the gate was never going to
  // check anything in.
  const eventPath = env.GITHUB_EVENT_PATH;
  const prBody = eventPath === undefined ? null : prBodyFromEvent(eventPath);
  const branch = currentBranch(repoRoot, env);

  const discovery = discoverSpec({
    repoRoot,
    ...(options.spec === undefined ? {} : { spec: options.spec }),
    ...(prBody === null ? {} : { prBody }),
    ...(branch === null ? {} : { branch }),
  });

  if (discovery.kind === 'missing-flag') {
    return {
      kind: 'failed',
      step: 'spec',
      detail:
        `--spec named "${discovery.spec}", which is not in this repository. ` +
        'A spec asked for by name is never replaced by a discovered one.',
    };
  }

  // A repository holding both state directories stops the run before
  // anything else is decided, INCLUDING before --spec is honoured. The flag
  // would otherwise take the import path, which runs "import-spec --project ."
  // in this same repository, where intent-guard 1.3.0 fails closed on the
  // same conflict and reports it as an opaque non-zero exit from a
  // subcommand. One sentence naming both directories beats that, and it is
  // the same answer either way.
  if (stateDirsConflict(repoRoot)) {
    return {
      kind: 'failed',
      step: 'contract-source',
      detail:
        `this repository has both ${STATE_DIR}/ and a ${LEGACY_STATE_DIR}/ holding ` +
        `intent-guard state. ${LEGACY_STATE_DIR}/ is the pre-1.3 name for ${STATE_DIR}/, and ` +
        'intent-guard reads one state directory and never merges two, so it refuses every ' +
        `command here rather than guessing. Move ${LEGACY_STATE_DIR}/ aside, or move what ` +
        `is still needed out of it into ${STATE_DIR}/, and re-run. Nothing was checked by ` +
        'this gate.',
    };
  }
  const nativeContract = frozenNativeContracts(repoRoot)[0] ?? null;

  let source: ContractSource;
  if (discovery.kind === 'flag') {
    source = { kind: 'imported', spec: discovery.spec, plan: discovery.plan };
  } else if (nativeContract !== null) {
    source = { kind: 'native', path: nativeContract };
  } else if (discovery.kind === 'waived') {
    // BELOW the native check, and the order is the whole meaning of the
    // token: "Spec: none" says there is no spec to import, not that this
    // repository's own frozen contract should be ignored. Above the
    // convention, though, which discoverSpec has already settled: an
    // explicit statement beats an inferred one.
    return {
      kind: 'skip',
      reason: 'contract-waived',
      detail:
        'The pull request body waived the spec with a "Spec: none" line, so there was ' +
        `nothing to import and no frozen ${NATIVE_CONTRACT_PATHS.join(' or ')} to fall ` +
        'back on.',
    };
  } else if (discovery.kind === 'none') {
    source = { kind: 'none' };
  } else {
    source = { kind: 'imported', spec: discovery.spec, plan: discovery.plan };
  }

  if (source.kind === 'none') {
    return {
      kind: 'skip',
      reason: 'no-contract',
      detail:
        `No frozen ${NATIVE_CONTRACT_PATHS.join(' or ')} and no spec under ${SPEC_DIR} matching ` +
        `${branch === null ? 'this branch' : `branch "${branch}"`}. ` +
        'Name one with a "Spec: <path>" line in the pull request body, or pass --spec.',
    };
  }

  const base = resolveBaseRef({
    ...(options.base === undefined ? {} : { base: options.base }),
    env,
  });

  let paths: string[] | null = null;
  if (base !== null) {
    const changed = changedPathsSince(repoRoot, base.ref);
    if (!changed.ok) {
      return { kind: 'failed', step: 'base', detail: changed.detail };
    }
    paths = changed.paths;
  }

  const common = {
    baseRef: base === null ? null : base.ref,
    baseSource: base === null ? null : base.source,
    paths,
  };

  if (source.kind === 'native') {
    return {
      kind: 'ready',
      preparation: {
        ...common,
        contractSource: source,
        // The repository itself, spelled the way every other gate is spelled:
        // the child already runs with the repository root as its working
        // directory.
        projectDir: '.',
        cleanup: () => undefined,
      },
    };
  }

  if (options.binary === null) {
    // Nothing to run the chain with. The caller reports the missing binary
    // through the ordinary gate-missing path, so this never becomes a second
    // way of saying the same thing.
    return {
      kind: 'failed',
      step: 'import-spec',
      detail: 'no intent-guard binary was resolved, so the spec could not be imported.',
    };
  }

  const importCommand = subcommand(options.binary, 'import-spec');
  if (importCommand === null) {
    return {
      kind: 'failed',
      step: 'import-spec',
      detail:
        `the resolved binary is ${options.binary.candidate}, which has no import-spec ` +
        'subcommand. Importing a spec needs the unified intent-guard binary.',
    };
  }

  const importResult = run(
    importCommand.command,
    [
      ...importCommand.argv,
      '--project',
      '.',
      '--from',
      'superpowers',
      '--spec',
      path.join(repoRoot, source.spec),
      ...(source.plan === null ? [] : ['--plan', path.join(repoRoot, source.plan)]),
      '--dry-run',
    ],
    repoRoot,
    timeoutMs
  );

  if (importResult.errorMessage !== null) {
    return { kind: 'failed', step: 'import-spec', detail: importResult.errorMessage };
  }
  if (importResult.status !== 0) {
    return {
      kind: 'failed',
      step: 'import-spec',
      detail: `import-spec exited ${importResult.status ?? -1}: ${complaint(importResult)}`,
    };
  }

  let contractYaml: string;
  try {
    const parsed = JSON.parse(importResult.stdout) as { contract_yaml?: unknown };
    if (typeof parsed.contract_yaml !== 'string' || parsed.contract_yaml === '') {
      return {
        kind: 'failed',
        step: 'import-spec',
        detail: 'import-spec printed no contract_yaml, so there is nothing to freeze.',
      };
    }
    contractYaml = parsed.contract_yaml;
  } catch {
    return {
      kind: 'failed',
      step: 'import-spec',
      detail: 'import-spec printed something that is not JSON, so no draft could be read.',
    };
  }

  const projectDir = mkdtempSync(path.join(options.tempRoot ?? os.tmpdir(), TEMP_PREFIX));
  const cleanup = (): void => {
    rmSync(projectDir, { recursive: true, force: true });
  };

  try {
    // The DRAFT goes to the legacy path, which is the one both versions can
    // find. A 1.2.x intent-guard reads only that directory; a 1.3.0 one reads
    // it as the legacy fallback and renames it to the canonical name on its
    // first write, which the freeze below is. Writing the canonical name
    // instead would work on 1.3.0 and leave 1.2.x freezing an empty project.
    // This is a temporary directory the umbrella made two lines ago, so
    // writing the old name here is not a migration anybody has to live with.
    mkdirSync(path.join(projectDir, path.dirname(LEGACY_NATIVE_CONTRACT_PATH)), {
      recursive: true,
    });
    writeFileSync(path.join(projectDir, LEGACY_NATIVE_CONTRACT_PATH), contractYaml);
  } catch (err) {
    cleanup();
    return {
      kind: 'failed',
      step: 'write-contract',
      detail: `the drafted contract could not be written: ${(err as Error).message}`,
    };
  }

  const freezeCommand = subcommand(options.binary, 'freeze');
  if (freezeCommand === null) {
    cleanup();
    return { kind: 'failed', step: 'freeze', detail: 'no freeze subcommand on this binary.' };
  }

  const freezeResult = run(
    freezeCommand.command,
    [
      ...freezeCommand.argv,
      '--project',
      projectDir,
      '--approved-by',
      // Says what approved it and against which commit, so the approval is
      // never mistaken for a person's. The spec path is repository-relative,
      // because this string ends up in a contract and a machine path in a
      // contract is exactly what intent-guard's own docs warn about.
      `conductor: ${source.spec} at ${shortHead(repoRoot)}`,
      '--yes',
      '--json',
    ],
    repoRoot,
    timeoutMs
  );

  if (freezeResult.errorMessage !== null || freezeResult.status !== 0) {
    cleanup();
    return {
      kind: 'failed',
      step: 'freeze',
      detail:
        freezeResult.errorMessage ??
        `freeze exited ${freezeResult.status ?? -1}: ${complaint(freezeResult)}`,
    };
  }

  // Exit 0 is not proof there is a contract to hand the gate. freeze writes
  // through intent-guard's own state directory, so a 1.3.0 build has just
  // renamed the directory this function created and a 1.2.x one has not, and
  // the whole point of this release is that the umbrella cannot assume which.
  // Looking for the file, canonical first, turns "the gate found no contract
  // in a directory conductor prepared" into a named preparation failure here
  // rather than a confusing verdict from the gate three steps later.
  if (frozenContractIn(projectDir) === null) {
    cleanup();
    return {
      kind: 'failed',
      step: 'freeze',
      detail:
        'freeze reported success but left no contract in the prepared project: neither ' +
        `${NATIVE_CONTRACT_PATHS.join(' nor ')} is there. That is a version of ` +
        'intent-guard writing its state somewhere this umbrella does not know about.',
    };
  }

  return {
    kind: 'ready',
    preparation: { ...common, contractSource: source, projectDir, cleanup },
  };
}
