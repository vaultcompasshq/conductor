// What the branch changed, and what to measure it against.
//
// The intent gate's pre-commit view is the index. Its pull-request view is
// the set of paths the branch changed since it forked, which is a different
// question with a different answer, and getting it wrong is not a small
// error: a two-dot diff attributes every commit that landed on the base
// branch after this branch forked to this branch, so somebody else's merge
// breaches this pull request's change budget.
//
// The umbrella computes the path set ITSELF rather than handing intent-guard
// its own `--base`, and that is a deliberate cost. The contract for a run may
// live in a temporary directory (see intent-prepare.ts), and `--base` inside
// the gate resolves git relative to `--project`, where there is no
// repository. Computing the set here and passing `--paths` is the one
// arrangement that works for both the native and the imported contract, and
// the flags below are copied from intent-guard 1.2.1 so the two agree on what
// "changed" means rather than agreeing by coincidence.

import { spawnSync } from 'node:child_process';

export interface BaseResolution {
  ref: string;
  /** Which input named it, so the report can say. */
  source: 'flag' | 'github';
}

export type ChangedPaths = { ok: true; paths: string[] } | { ok: false; detail: string };

/**
 * The ref to diff against, or null for a run that is not a pull request.
 *
 * `GITHUB_BASE_REF` is a BRANCH NAME, not a ref anything local can resolve:
 * a CI checkout has no local branch for it, so it is prefixed with `origin/`.
 * Actions defines the variable and leaves it EMPTY outside a pull request, so
 * an empty value has to mean "no pull request" rather than "origin/", which
 * would fail every push build closed.
 */
export function resolveBaseRef(options: {
  base?: string;
  env: NodeJS.ProcessEnv;
}): BaseResolution | null {
  if (options.base !== undefined && options.base !== '') {
    return { ref: options.base, source: 'flag' };
  }
  const fromGithub = options.env.GITHUB_BASE_REF;
  if (fromGithub !== undefined && fromGithub !== '') {
    return { ref: `origin/${fromGithub}`, source: 'github' };
  }
  return null;
}

/**
 * The branch this run is about.
 *
 * `GITHUB_HEAD_REF` first, and it is not an optimization: `actions/checkout`
 * leaves a pull request build on a DETACHED HEAD, so asking git for the
 * branch name there answers "HEAD" and matches no spec at all. Outside CI the
 * variable is absent and git is the only answer.
 */
export function currentBranch(repoRoot: string, env: NodeJS.ProcessEnv): string | null {
  const fromGithub = env.GITHUB_HEAD_REF;
  if (fromGithub !== undefined && fromGithub !== '') {
    return fromGithub;
  }
  const child = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const value = (child.stdout ?? '').trim();
  if (child.status !== 0 || value === '' || value === 'HEAD') {
    return null;
  }
  return value;
}

/**
 * The paths the branch changed since it forked from `base`.
 *
 * Three flags, each of which is a decision:
 *
 *  - `-c core.quotePath=false`, or git escapes any byte outside ASCII and
 *    wraps the line in quotes, and the gate is handed a path that matches no
 *    glob and no file on disk.
 *  - `--no-renames`, so a rename lists BOTH its old and its new path. Moving
 *    a file out of a protected directory still has to block, which it cannot
 *    if only the destination is listed. The cost is that a rename counts as
 *    two paths against a max_files budget, which is the same cost
 *    intent-guard's own `--base` pays.
 *  - the three-dot range, which asks what the branch changed since it forked
 *    rather than how it differs from the base branch right now.
 *
 * Fails closed. There is deliberately no fallback to an empty path set on a
 * git error, because an empty path set is indistinguishable from a clean run.
 */
export function changedPathsSince(repoRoot: string, base: string): ChangedPaths {
  const child = spawnSync(
    'git',
    [
      '-c',
      'core.quotePath=false',
      'diff',
      '--name-only',
      '--no-renames',
      `${base}...HEAD`,
    ],
    { cwd: repoRoot, encoding: 'utf8' }
  );

  if (child.error !== undefined) {
    return { ok: false, detail: `git could not be run: ${child.error.message}` };
  }
  if (child.status !== 0) {
    // git's own first line usually ends in a full stop, and this message
    // continues after it. Two in a row reads as a typo in a message somebody
    // is already reading because something went wrong.
    const stderr = ((child.stderr ?? '').trim().split('\n')[0] ?? '').replace(/\.+$/, '');
    return {
      ok: false,
      detail:
        `git could not resolve "${base}...HEAD" (exit ${child.status ?? -1})` +
        `${stderr === '' ? '' : `: ${stderr}`}. ` +
        'In Actions this is usually a shallow checkout with no merge base; ' +
        'check out with fetch-depth: 0, or fetch the base ref before the run.',
    };
  }

  // Split on newlines and NOTHING else. Trimming each line was corrupting a
  // filename with leading or trailing whitespace into a different filename,
  // which is worse than refusing it: the gate would then check a path that
  // does not exist and never check the one that changed.
  const paths = (child.stdout ?? '').split('\n').filter((line) => line.length > 0);

  for (const entry of paths) {
    // Fail closed rather than hand over a path the encoding cannot carry.
    // `--paths` is comma-joined, which is the only shape intent-guard 1.2.1
    // accepts, so a comma in a filename arrives as two paths: a phantom that
    // can be reported as outside allowed_paths, and a real path that quietly
    // stops being measured against a protected one. It invents a breach and
    // hides one, and neither half is visible in the report.
    if (entry.includes(',')) {
      return {
        ok: false,
        detail:
          `the changed path "${entry}" contains a comma, and the intent gate takes its ` +
          'path list comma-joined, so it cannot be passed without splitting into two paths. ' +
          'Nothing was checked, rather than checking a path that does not exist.',
      };
    }
    if (entry !== entry.trim()) {
      return {
        ok: false,
        detail:
          `the changed path "${entry}" has leading or trailing whitespace, which cannot ` +
          'survive the gate path list intact. Nothing was checked, rather than checking a ' +
          'path that does not exist. A space inside a path is fine.',
      };
    }
  }

  return { ok: true, paths };
}
