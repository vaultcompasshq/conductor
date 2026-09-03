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
//  - NOTHING IS EVER WRITTEN UNDER <repo>/.conductor. A contract is a
//    committed artifact with an approver's name on it. A pull-request run
//    that dropped one into the working tree would either be committed by
//    accident or picked up by the next run as though a person had approved
//    it, and the second failure is silent.
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { changedPathsSince, currentBranch, resolveBaseRef } from './intent-base.js';
import { SPEC_DIR, discoverSpec, prBodyFromEvent } from './intent-spec.js';
import type { ResolvedBinary } from './resolve.js';

/** Prefix of the per-run directory, exported so a test can count leaks. */
export const TEMP_PREFIX = 'conductor-intent-';

export const NATIVE_CONTRACT_PATH = '.conductor/intent-contract.yaml';

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
export type PrepareStep = 'spec' | 'base' | 'import-spec' | 'write-contract' | 'freeze';

export type IntentPrepareResult =
  | { kind: 'ready'; preparation: IntentPreparation }
  /** No contract and no spec: an advisory, never an exit code. */
  | { kind: 'skip'; reason: 'no-contract'; detail: string }
  | { kind: 'failed'; step: PrepareStep; detail: string };

export interface IntentPrepareOptions {
  repoRoot: string;
  /** The resolved intent-guard binary, or null when none is installed. */
  binary: ResolvedBinary | null;
  env: NodeJS.ProcessEnv;
  base?: string;
  spec?: string;
  timeoutMs?: number;
}

/**
 * Whether a contract on disk has been approved.
 *
 * Both markers are checked because they are written by the same step and
 * either one alone would be a guess: `frozen_by: user` is what the gate
 * reads, and the `approval` block is what carries the name. A file that
 * cannot be parsed is treated as not frozen, which sends the run down the
 * import path rather than handing the gate something it will reject.
 */
function nativeContractIsFrozen(repoRoot: string): boolean {
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(path.join(repoRoot, NATIVE_CONTRACT_PATH), 'utf8'));
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return false;
  }
  const document = parsed as { frozen_by?: unknown; approval?: unknown };
  if (document.frozen_by === 'user') {
    return true;
  }
  return document.approval !== null && typeof document.approval === 'object';
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

/** The first line of whatever the child complained with, for a one-line report. */
function complaint(result: ChildResult): string {
  const text = (result.stderr.trim() === '' ? result.stdout : result.stderr).trim();
  return text.split('\n')[0] ?? '';
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

  let source: ContractSource;
  if (discovery.kind === 'flag') {
    source = { kind: 'imported', spec: discovery.spec, plan: discovery.plan };
  } else if (nativeContractIsFrozen(repoRoot)) {
    source = { kind: 'native', path: NATIVE_CONTRACT_PATH };
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
        `No frozen ${NATIVE_CONTRACT_PATH} and no spec under ${SPEC_DIR} matching ` +
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

  const projectDir = mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  const cleanup = (): void => {
    rmSync(projectDir, { recursive: true, force: true });
  };

  try {
    mkdirSync(path.join(projectDir, '.conductor'), { recursive: true });
    writeFileSync(path.join(projectDir, NATIVE_CONTRACT_PATH), contractYaml);
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

  return {
    kind: 'ready',
    preparation: { ...common, contractSource: source, projectDir, cleanup },
  };
}
