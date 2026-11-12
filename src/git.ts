// Every git command the umbrella runs itself, through one door.
//
// Three properties hold for each of them, and keeping the calls in one place
// is what lets that be said once rather than checked at a dozen call sites:
//
//  - THE PROGRAM. On a pull-request run the caller pins git to one absolute
//    path, outside the repository's work tree, before anything else runs
//    (`pinGitOutside`), so every git call here runs that program and no
//    other. Outside pull-request mode this is plain `git`, found the way a
//    shell finds it.
//
//  - REPLACE OBJECTS, GRAFTS AND A COMMIT-GRAPH FILE ARE IGNORED. Every call
//    passes core.useReplaceRefs=false and core.commitGraph=false on the
//    command line (`PINNED_GIT_CONFIG`), where no configuration file and no
//    GIT_CONFIG_COUNT entry can outrank them, and sets GIT_NO_REPLACE_OBJECTS
//    as well, so every read here sees the commit's own objects. The variable
//    alone is not enough: configuration can turn replacement back on over
//    it. GIT_GRAFT_FILE names a path that cannot exist, so every read of a
//    commit's parents sees the parents the commit itself records
//    (`pinnedGitEnv`); git has no configuration key for a graft file.
//
//  - NOTHING HERE DECIDES WHAT A FAILURE MEANS. The result carries the exit
//    status and the error, and each caller keeps "git said there is nothing
//    there" apart from "git could not answer", because the second is never
//    a reason to treat a trusted file as absent.

import { spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';

export interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when git could not be started at all. */
  error: Error | undefined;
}

let gitProgram = 'git';

/** The program every git call in this process runs. */
export function currentGitProgram(): string {
  return gitProgram;
}

/**
 * Pins the git program for the rest of this process. The CLI calls it once
 * on a pull-request run, with an absolute path; tests call it to reset.
 */
export function useGitProgram(program: string): void {
  gitProgram = program;
}

/**
 * A graft file path that cannot exist: /dev/null is not a directory, so
 * nothing can be created under it. The same value the Action's fetch step
 * exports (action.yml, "Fetch the trust base"). git reads a missing graft
 * file as no grafts, without a warning.
 */
export const NO_GRAFT_FILE = '/dev/null/conductor-no-grafts';

/**
 * git loads a commit-graph file when GIT_TEST_COMMIT_GRAPH is true, over
 * core.commitGraph=false on the command line and in GIT_CONFIG_PARAMETERS.
 * The environments conductor builds do not pass the variable on. A value
 * that is absent stays absent. The caller's object is never changed.
 */
function withoutCommitGraphTestVariable(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!Object.prototype.hasOwnProperty.call(env, 'GIT_TEST_COMMIT_GRAPH')) {
    return env;
  }
  const copy: NodeJS.ProcessEnv = { ...env };
  delete copy.GIT_TEST_COMMIT_GRAPH;
  return copy;
}

/**
 * The environment of every git call conductor makes itself: the caller's
 * own, with replace objects off and the graft file pointed at nothing.
 *
 * A replace ref swaps one object for another and a graft gives a commit
 * other parents, both from files in the git directory that no commit
 * records. The trees were always read without the first. The second matters
 * since the adoption proposal (issue 101), which asks what the merge bases
 * of two commits are and what the base branch's own first-parent history
 * touched: both answers are read from parents, and a graft would rewrite
 * them. Set last, so a value already in the environment never wins.
 */
export function pinnedGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...withoutCommitGraphTestVariable(env), GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: NO_GRAFT_FILE };
}

/**
 * Configuration set on the command line of every git call conductor makes
 * itself, ahead of the subcommand. The command line outranks every other
 * place git reads configuration from: the system, global and repository
 * files, anything they include, and GIT_CONFIG_COUNT in the environment.
 *
 *  - core.useReplaceRefs=false. GIT_NO_REPLACE_OBJECTS is NOT enough on its
 *    own: the same key set to true in any configuration git reads turns
 *    replacement back on over the variable (seen on git 2.39.3), and a
 *    replace ref can then swap the base commit for one with another tree and
 *    other parents. The variable stays as well, for a git where it is the
 *    one that counts.
 *  - core.commitGraph=false. A commit-graph file in the git directory holds
 *    each commit's parents and root tree, and no commit records it, so every
 *    read takes both from the commit object itself.
 */
export const PINNED_GIT_CONFIG: readonly string[] = [
  '-c',
  'core.useReplaceRefs=false',
  '-c',
  'core.commitGraph=false',
];

/**
 * GIT_CONFIG_COUNT as git reads it (strtoul, base 10): leading white space,
 * an optional sign, then digits and nothing after them. The number of
 * entries, or null when git itself refuses the value: something after the
 * digits, a negative number other than zero, or more than a 32-bit int
 * holds. Unset and empty are both zero entries.
 */
function configCountAsGitReadsIt(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') {
    return 0;
  }
  const read = raw.match(/^[ \t\n\v\f\r]*([+-]?)([0-9]+)$/);
  if (read === null) {
    return null;
  }
  const count = Number(read[2]);
  if (!Number.isSafeInteger(count) || count > 2147483646 || (read[1] === '-' && count !== 0)) {
    return null;
  }
  return count;
}

/**
 * The environment of a gate conductor starts: `env`, plus the pins below.
 * GIT_TEST_COMMIT_GRAPH is not passed on. A `-c` the gate itself adds is
 * not something this function can outrank.
 *
 * conductor cannot put anything on the command line of a git call a gate
 * makes itself. What it can give the gate is the two environment channels
 * git reads configuration from. Numbered GIT_CONFIG_COUNT pairs are read
 * after every configuration file, so an entry there outranks
 * core.useReplaceRefs=true in the repository's configuration or a global
 * one. GIT_CONFIG_PARAMETERS is read after those numbered entries, so it
 * outranks them and the files. GIT_NO_REPLACE_OBJECTS does not: such a
 * setting turns replacement back on over it. A -c the gate passes on its
 * own git command line is read after GIT_CONFIG_PARAMETERS and still wins;
 * none of the spawns here pass one.
 *
 * The numbered entry is APPENDED, at the index the caller's own count ends
 * on, never written at index 0: the caller's entries are kept (an Action's
 * authentication header is one), and of two entries for one key git takes
 * the later. It is core.useReplaceRefs=false only. The same value, and
 * core.commitGraph=false, are appended to GIT_CONFIG_PARAMETERS after
 * exactly one space. When the caller's value is unset or the empty string
 * the two pins are the whole value, with no leading space. The caller's
 * value is not trimmed, parsed or repaired.
 *
 * A count git refuses is left exactly as it is and nothing is appended to
 * the numbered entries. The parameters pins are still set on that branch,
 * so there is no branch where they are absent. With a count git refuses,
 * every git call fails, and a failed read is a refusal everywhere here;
 * rewriting the count to make git work again would be conductor deciding
 * what the caller meant. Returns a new object and never changes `env`.
 */
export function gateChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const source = withoutCommitGraphTestVariable(env);
  const pins = "'core.useReplaceRefs=false' 'core.commitGraph=false'";
  const caller = source.GIT_CONFIG_PARAMETERS;
  const parameters = caller === undefined || caller === '' ? pins : `${caller} ${pins}`;
  const count = configCountAsGitReadsIt(source.GIT_CONFIG_COUNT);
  if (count === null) {
    return { ...source, GIT_CONFIG_PARAMETERS: parameters };
  }
  return {
    ...source,
    GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: 'core.useReplaceRefs',
    [`GIT_CONFIG_VALUE_${count}`]: 'false',
    GIT_CONFIG_PARAMETERS: parameters,
  };
}

/** Runs one git command in `cwd`, reading stdout as UTF-8. Never throws. */
export function runGit(
  cwd: string,
  args: readonly string[],
  options: { maxBuffer?: number; input?: string } = {}
): GitResult {
  const child = spawnSync(gitProgram, [...PINNED_GIT_CONFIG, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    env: pinnedGitEnv(),
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  return {
    status: child.status,
    stdout: typeof child.stdout === 'string' ? child.stdout : '',
    stderr: typeof child.stderr === 'string' ? child.stderr : '',
    error: child.error,
  };
}

/**
 * Runs one git command in `cwd` and keeps stdout as BYTES. For a blob that is
 * copied out byte for byte (the osv gate's base copies): decoding it as UTF-8
 * would rewrite a file with invalid bytes before anything read it. Same
 * program, same environment and same never-throws contract as runGit.
 */
export function runGitBytes(
  cwd: string,
  args: readonly string[],
  options: { maxBuffer?: number } = {}
): { status: number | null; stdout: Buffer; stderr: string; error: Error | undefined } {
  const child = spawnSync(gitProgram, [...PINNED_GIT_CONFIG, ...args], {
    cwd,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    env: pinnedGitEnv(),
  });
  return {
    status: child.status,
    stdout: Buffer.isBuffer(child.stdout) ? child.stdout : Buffer.alloc(0),
    stderr: Buffer.isBuffer(child.stderr) ? child.stderr.toString('utf8') : '',
    error: child.error,
  };
}

/**
 * A PATH with every entry that would resolve against the working directory
 * removed: an empty entry (which means the current directory) and a relative
 * one. Returns the cleaned value and what was removed, in order.
 *
 * Used on a run with a trust base, where the working directory of nearly
 * every child is the tree under judgment, so that every PATH lookup, for
 * git, for node in a gate's "#!/usr/bin/env node" line, or for a gate,
 * resolves against an absolute directory.
 */
export function absolutePathEntries(pathValue: string): { value: string; removed: string[] } {
  const kept: string[] = [];
  const removed: string[] = [];
  for (const entry of pathValue.split(path.delimiter)) {
    if (entry !== '' && path.isAbsolute(entry)) {
      kept.push(entry);
    } else {
      removed.push(entry);
    }
  }
  return { value: kept.join(path.delimiter), removed };
}

/** Whether `candidate` (already resolved) is `root` or under it. */
function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function realOrNull(candidate: string): string | null {
  try {
    return realpathSync(candidate);
  } catch {
    return null;
  }
}

/**
 * The nearest directory at or above `start` holding a `.git` entry (the
 * work tree a git run from `start` would find), resolved, or null. Found
 * without running git, because it decides which git may be run.
 */
export function workTreeAbove(start: string): string | null {
  let current = realOrNull(start);
  while (current !== null) {
    if (existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

/**
 * The first git on `pathValue` whose real path (symlinks resolved) is
 * outside every root in `excluded`, as that real path, or null when there
 * is none. Only absolute PATH entries are considered.
 */
export function gitOutside(pathValue: string, excluded: readonly string[]): string | null {
  const roots = excluded.map((root) => realOrNull(root) ?? root);
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir === '' || !path.isAbsolute(dir)) {
      continue;
    }
    const real = realOrNull(path.join(dir, 'git'));
    if (real === null) {
      continue;
    }
    try {
      if (!statSync(real).isFile()) {
        continue;
      }
      accessSync(real, constants.X_OK);
    } catch {
      continue;
    }
    if (roots.some((root) => isInside(root, real))) {
      continue;
    }
    return real;
  }
  return null;
}

/**
 * Pins every git call in this process to the first git on `pathValue` that
 * is outside the given work trees, and returns it; null, with nothing
 * pinned, when there is none. Called once on a pull-request run.
 */
export function pinGitOutside(pathValue: string, excluded: readonly string[]): string | null {
  const chosen = gitOutside(pathValue, excluded);
  if (chosen !== null) {
    useGitProgram(chosen);
  }
  return chosen;
}

/** Whether the pinned git program's real path is inside `root`. */
export function pinnedGitInside(root: string): boolean {
  const real = realOrNull(gitProgram);
  const resolvedRoot = realOrNull(root) ?? root;
  return real !== null && path.isAbsolute(gitProgram) && isInside(resolvedRoot, real);
}

/** Whether `candidate`'s real path is `root`'s real path or under it. */
export function realPathInside(root: string, candidate: string): boolean {
  const real = realOrNull(candidate) ?? candidate;
  return isInside(realOrNull(root) ?? root, real);
}

/** The name every private git directory starts with, under the temp directory. */
export const GIT_SHIM_PREFIX = 'conductor-git-';

/**
 * On a run with a trust base: creates the private directory that goes first
 * on PATH for every child the run starts, so that a gate, or anything a gate
 * starts, that looks git up by name runs the pinned `program` and never a git
 * found in a PATH entry inside the tree being judged.
 *
 * The directory is a fresh mkdtemp directory under `tempRoot`, mode 0700,
 * holding exactly one entry, `git`, a symbolic link to `program`, so no other
 * lookup is shadowed. git finds its helpers through its own exec path, not
 * through PATH, so a link is enough. Throws, with a sentence saying why and
 * what to set, when `tempRoot` is inside one of `excluded` or the directory
 * cannot be made; it never returns an unprotected result silently.
 *
 * On Windows it creates nothing and returns null: a symbolic link needs a
 * privilege there, and a git.cmd wrapper is not found by a child that starts
 * git without a shell. There the gates look git up through the cleaned PATH.
 */
export function createGitShim(
  program: string,
  tempRoot: string,
  excluded: readonly string[],
  platform: NodeJS.Platform = process.platform
): string | null {
  if (platform === 'win32') {
    return null;
  }
  const realTemp = realOrNull(tempRoot) ?? tempRoot;
  if (excluded.some((root) => realPathInside(root, realTemp))) {
    throw new Error(tempInsideTreeMessage(tempRoot));
  }
  let dir: string | undefined;
  try {
    dir = mkdtempSync(path.join(realTemp, GIT_SHIM_PREFIX));
    chmodSync(dir, 0o700);
    symlinkSync(program, path.join(dir, 'git'));
    return dir;
  } catch (err) {
    if (dir !== undefined) {
      removeGitShim(dir);
    }
    throw new Error(
      'conductor could not create the private git directory it puts first on PATH for the ' +
        `gates under the system temporary directory (${tempRoot}): ` +
        `${err instanceof Error ? err.message : String(err)}. ${SHIM_REMEDY}`
    );
  }
}

const SHIM_REMEDY =
  'Set TMPDIR to a writable directory outside the repository. Nothing was checked.';

/** Why a run cannot go ahead when the temp directory is inside the tree. */
export function tempInsideTreeMessage(tempRoot: string): string {
  return (
    `the system temporary directory (${tempRoot}) is inside the repository being judged, ` +
    'and on a pull-request run conductor keeps the directory it puts first on PATH for ' +
    `the gates outside that tree. ${SHIM_REMEDY}`
  );
}

/** Removes a directory createGitShim made. Never throws. */
export function removeGitShim(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Nothing left to remove, or not removable; the run's outcome stands.
  }
}

/** git's first line of complaint, without a trailing full stop. */
export function gitComplaint(result: GitResult): string {
  if (result.error !== undefined) {
    return `git could not be run: ${result.error.message}`;
  }
  const line = (result.stderr.trim().split('\n')[0] ?? '').replace(/\.+$/, '');
  return line === '' ? `git exited ${result.status ?? -1}` : line;
}
