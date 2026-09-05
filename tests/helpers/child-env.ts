// Building a hermetic environment for a spawned CLI child process.
//
// GitHub Actions sets GITHUB_BASE_REF, GITHUB_HEAD_REF and GITHUB_EVENT_PATH
// for the WHOLE JOB on a pull_request event, not just for a step that asks
// for them. A test that spawns the built CLI with a plain
// `{ ...process.env, PATH: pathValue }` inherits these too, and
// src/intent-base.ts and src/intent-prepare.ts read them unconditionally:
// the intent gate then silently enters its pull-request path, tries to
// resolve a base ref against a scratch repository that has no origin, and
// does not run. That is exactly what made every pull request build of this
// repository fail while pushes to main passed -- a push event never sets
// these, so the leak was invisible until a pull_request run exposed it.
//
// Every spawn site that hands the built CLI its environment MUST build it
// through this helper rather than spreading process.env directly, or the
// same leak comes back the moment this suite runs inside a pull request
// again.
import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LEAKED_ON_PULL_REQUEST_EVENT = ['GITHUB_BASE_REF', 'GITHUB_HEAD_REF', 'GITHUB_EVENT_PATH'] as const;

export interface ChildEnvOptions {
  /**
   * Variables to opt back in, by name, from LEAKED_ON_PULL_REQUEST_EVENT.
   * A test that deliberately exercises the pull-request flow through a real
   * spawned CLI names the ones it wants here, so the exception is visible at
   * the call site rather than a silent reversion to spreading process.env.
   */
  keep?: readonly string[];
}

/**
 * The environment for a spawned CLI child: process.env, with PATH replaced
 * by the caller's own value, and the pull-request-only GitHub Actions
 * variables removed unless the caller names them in `keep`.
 */
export function childEnv(pathValue: string, options: ChildEnvOptions = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: pathValue };
  const keep = new Set(options.keep ?? []);
  for (const name of LEAKED_ON_PULL_REQUEST_EVENT) {
    if (!keep.has(name)) {
      delete env[name];
    }
  }
  return env;
}

/** The real git, resolved once, so the shim below execs something real. */
const GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

/**
 * A `git` shim in a directory that is about to become a child's whole PATH.
 *
 * A suite that replaces PATH wholesale so the gates resolve to stubs takes
 * git away from the spawned CLI too, and the CLI needs git to find the
 * working-tree root. Every such spawn site needs this, which is why it lives
 * here beside childEnv rather than in one test that noticed: a test that
 * forgets it now gets "conductor: git is not on PATH" instead of a report,
 * where before the CLI silently treated the working directory as the root
 * and the whole file passed for the wrong reason.
 *
 * A shim rather than putting git's own directory on PATH: that directory is
 * shared, so whatever else a machine keeps beside git would come with it and
 * the suite's verdict would depend on the laptop running it.
 */
export function shimGit(binDir: string): void {
  const file = path.join(binDir, 'git');
  writeFileSync(file, `#!/bin/sh\nexec ${GIT} "$@"\n`);
  chmodSync(file, 0o755);
}
