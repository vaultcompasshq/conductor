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
//  - REPLACE OBJECTS ARE IGNORED. GIT_NO_REPLACE_OBJECTS is set on every
//    call, so every read here sees the commit's own objects.
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

/** Runs one git command in `cwd`, reading stdout as UTF-8. Never throws. */
export function runGit(
  cwd: string,
  args: readonly string[],
  options: { maxBuffer?: number } = {}
): GitResult {
  const child = spawnSync(gitProgram, [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
  });
  return {
    status: child.status,
    stdout: typeof child.stdout === 'string' ? child.stdout : '',
    stderr: typeof child.stderr === 'string' ? child.stderr : '',
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
