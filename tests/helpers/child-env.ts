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
