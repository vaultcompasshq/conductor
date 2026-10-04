// What the branch changed, and what to measure it against.
//
// The intent gate's pre-commit view is the index. Its pull-request view is
// the set of paths the branch changed since it forked, which is a different
// question with a different answer, and getting it wrong is not a small
// error: a two-dot diff attributes every commit that landed on the base
// branch after this branch forked to this branch, so somebody else's merge
// breaches this pull request's change budget.
//
// The umbrella computes the path set ITSELF, and how it reaches the gate
// depends on the contract. An imported contract lives in a temporary
// directory (see intent-prepare.ts), where the gate's own `--base` would
// resolve git relative to a `--project` with no repository in it, so that
// gate is always handed `--paths`. A native contract on an intent-guard new
// enough to read the change set from git itself is handed the gate's own
// `--base` instead (`intentChangeChannel` in gate-runner.ts), and `--paths`
// otherwise. The flags below are copied from intent-guard so the two agree
// on what "changed" means rather than agreeing by coincidence.

import { runGit } from './git.js';
import {
  PRIVATE_TRUST_BASE_REF,
  exactRefLookup,
  exactRefObject,
  refuseAmbiguousRef,
  resolveRev,
} from './trust-base.js';

export interface BaseResolution {
  ref: string;
  /** Which input named it, so the report can say. */
  source: 'flag' | 'github' | 'trust-base';
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

export type ResolvedBase =
  | { ok: true; base: BaseResolution | null }
  | { ok: false; detail: string };

/**
 * The base to diff against, resolved against the repository and always
 * spelled so a tag cannot shadow it (the same class as the trust base: git
 * resolves a short origin/<base> through refs/tags/ first, so a tag at
 * HEAD~1 would narrow the change set to the last commit).
 *
 *  - An explicit --base keeps its meaning, but a short name that matches
 *    more than one kind of ref is refused (refuseAmbiguousRef).
 *  - Otherwise, on a pull request: refs/conductor/trust-base (the composite
 *    action's private fetch) when it exists, else refs/remotes/origin/<base>,
 *    both in full. The private ref wins and is not compared against the
 *    remote-tracking ref. If neither exists the spelled remote ref is returned and the
 *    diff fails closed, naming fetch-depth: 0.
 *  - Otherwise, on a run with a trust base: the commit the trust base
 *    resolves to.
 *  - Null outside a pull request.
 *
 * Nothing is deepened here: a depth-1 private ref has no merge base and the
 * diff fails closed, the same outcome as a depth-1 origin/<base> always had.
 */
export function resolveBaseRefInRepo(
  repoRoot: string,
  options: { base?: string; trustBase?: string; env: NodeJS.ProcessEnv }
): ResolvedBase {
  if (options.base !== undefined && options.base !== '') {
    // A base that starts with a dash is an OPTION to git, not a ref:
    // "--output=/x" made "git diff --output=/x...HEAD" write that file and
    // print nothing, an empty change set the intent gate then judged as clean.
    // Refused here, and changedPathsSince refuses it again itself.
    if (options.base.startsWith('-')) {
      return {
        ok: false,
        detail:
          `refusing "${options.base}" as the intent gate base: it starts with a dash, so git would ` +
          'read it as an option rather than a ref. Nothing was checked.',
      };
    }
    const ambiguous = refuseAmbiguousRef(repoRoot, options.base, 'the intent gate base');
    if (ambiguous !== null) {
      return { ok: false, detail: ambiguous };
    }
    // A refs/ name is checked with show-ref: git's name resolution would
    // otherwise fall back to refs/tags/<that name> when the ref is absent.
    if (options.base.startsWith('refs/') && exactRefObject(repoRoot, options.base) === null) {
      return {
        ok: false,
        detail:
          `refusing "${options.base}" as the intent gate base: no such ref exists in this ` +
          'repository (a tag of that name does not count). Nothing was checked.',
      };
    }
    return { ok: true, base: { ref: options.base, source: 'flag' } };
  }
  const fromGithub = options.env.GITHUB_BASE_REF;
  if (fromGithub === undefined || fromGithub === '') {
    if (options.trustBase === undefined) {
      return { ok: true, base: null };
    }
    // No other base was named, so the change set is measured from the trust
    // base: the commit the rules were read from is the one the pull request
    // is judged against. Handed on as the commit id it resolves to, read the
    // same way the trust base itself was (resolveRev never sends a refs/
    // name through git's name resolution).
    const commit = resolveRev(repoRoot, options.trustBase, 'commit');
    if (commit === null) {
      return {
        ok: false,
        detail:
          `the trust base does not resolve to a commit: "${options.trustBase}" names no commit in ` +
          'this repository, so there is no base to measure the intent gate against and nothing ' +
          'was checked. Fix: pass a trust base that is a commit in this checkout (in CI, check out ' +
          'with fetch-depth: 0).',
      };
    }
    return { ok: true, base: { ref: commit, source: 'trust-base' } };
  }
  const remoteRef = `refs/remotes/origin/${fromGithub}`;
  // The private ref is the authority when it exists; refs/remotes/origin/<base>
  // is fixed at checkout time, is the side pull-request code can move, and is
  // not compared against it (a merge to the base in between would be a false
  // refusal). It is the base only when the private ref is absent. Both are
  // read with show-ref (the EXACT ref, never git's name resolution, which
  // would take a tag of that name) and the base handed on is the commit id.
  // A private ref git could not read is a refusal, never taken for an absent
  // one; the remote-tracking ref is used only when the private ref is absent.
  const privLookup = exactRefLookup(repoRoot, PRIVATE_TRUST_BASE_REF);
  if (privLookup.kind === 'error') {
    return {
      ok: false,
      detail:
        `the base branch could not be read: ${privLookup.detail}, so there is no base to measure ` +
        'the intent gate against and nothing was checked. Fix: check that git can read the ' +
        `repository and that the action's fetch of the base branch into ${PRIVATE_TRUST_BASE_REF} ` +
        'succeeded, then run again.',
    };
  }
  const priv = privLookup.kind === 'ref' ? privLookup.oid : null;
  const remote = priv === null ? exactRefObject(repoRoot, remoteRef) : null;
  const chosen = priv ?? remote;
  if (chosen === null) {
    return {
      ok: false,
      detail:
        `the base branch is not in this repository: neither ${PRIVATE_TRUST_BASE_REF} (the ` +
        `composite action's fetch of the base branch) nor ${remoteRef} exists, so there is no base ` +
        'to measure the intent gate against and nothing was checked. Fix: in CI, check out with ' +
        'fetch-depth: 0, or fetch the base ref before the run.',
    };
  }
  return { ok: true, base: { ref: chosen, source: 'github' } };
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
  const child = runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const value = child.stdout.trim();
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
  // Refused here, inside the function that calls git, so no caller can skip
  // it: "--output=/x...HEAD" is an option to git diff, not a range.
  if (base.startsWith('-')) {
    return {
      ok: false,
      detail:
        `refusing "${base}" as the intent gate base: it starts with a dash, so git would read it ` +
        'as an option rather than a ref. Nothing was checked.',
    };
  }
  const child = runGit(
    repoRoot,
    [
      '-c',
      'core.quotePath=false',
      'diff',
      '--name-only',
      // NUL-terminated, so a name with a quote, a backslash, a tab or a
      // newline arrives byte for byte instead of C-quoted ("a\"b.txt"), which
      // names no file and which intent-guard refuses outright (backslash).
      '-z',
      '--no-renames',
      // A moved submodule pointer is a change, and is listed whatever
      // .gitmodules or git config says about ignoring submodules: the command
      // line value overrides both.
      '--ignore-submodules=none',
      `${base}...HEAD`,
      // Ends the revisions, so the range is always read as a range.
      '--',
    ],
    { maxBuffer: 64 * 1024 * 1024 }
  );

  if (child.error !== undefined) {
    return { ok: false, detail: `git could not be run: ${child.error.message}` };
  }
  if (child.status !== 0) {
    // git's own first line usually ends in a full stop, and this message
    // continues after it. Two in a row reads as a typo in a message somebody
    // is already reading because something went wrong.
    const stderr = (child.stderr.trim().split('\n')[0] ?? '').replace(/\.+$/, '');
    return {
      ok: false,
      detail:
        `git could not resolve "${base}...HEAD" (exit ${child.status ?? -1})` +
        `${stderr === '' ? '' : `: ${stderr}`}. ` +
        'In Actions this is usually a shallow checkout with no merge base. ' +
        'Fix: check out with fetch-depth: 0, or fetch the base ref before the run.',
    };
  }

  // Split on NUL and NOTHING else. Trimming each entry was corrupting a
  // filename with leading or trailing whitespace into a different filename,
  // which is worse than refusing it: the gate would then check a path that
  // does not exist and never check the one that changed.
  const paths = child.stdout.split('\0').filter((line) => line.length > 0);
  return { ok: true, paths };
}

/**
 * Why this change set cannot be handed to intent-guard as one `--paths`
 * value, or null when it can.
 *
 * Asked only where `--paths` is the channel: a contract imported from a spec
 * (its project is a temporary directory with no repository, so the gate
 * cannot read the change set from git itself) or an intent-guard older than
 * the release whose own `--base` reads the change set from git. Where the
 * gate reads git itself, none of this applies and the change is judged.
 *
 *  - A comma: `--paths` is comma-joined, so a comma in a filename arrives as
 *    two paths, a phantom that can be reported as outside allowed_paths and a
 *    real path that quietly stops being measured against a protected one.
 *  - A backslash: intent-guard refuses an explicit path list entry with one.
 *  - Leading or trailing whitespace: it cannot survive the list intact.
 *  - EVERY path starting with "-": intent-guard reads a `--paths` value that
 *    starts with "-" as a missing value, and there is no `--paths=value` form
 *    (verified against intent-guard 1.8.0: it is an unknown option). One path
 *    starting with "-" is fine once another leads the list
 *    (`orderForPathsFlag`), so this is refused only when every path does.
 *
 * A space or any other byte inside a path passes through unchanged.
 */
export function pathsFlagRefusal(paths: readonly string[]): string | null {
  for (const entry of paths) {
    if (entry.includes(',')) {
      return (
        `the changed path "${entry}" contains a comma, and intent-guard takes an explicit path ` +
        'list comma-joined, so it cannot be passed without splitting into two paths.'
      );
    }
    if (entry.includes('\\')) {
      return (
        `the changed path "${entry}" contains a backslash, and intent-guard refuses an explicit ` +
        'path list entry with one.'
      );
    }
    if (entry !== entry.trim()) {
      return (
        `the changed path "${entry}" has leading or trailing whitespace, which cannot survive ` +
        'the path list intact. A space inside a path is fine.'
      );
    }
  }
  if (paths.length > 0 && paths.every((entry) => entry.startsWith('-'))) {
    return (
      `every changed path starts with "-" (the first is "${paths[0]}"), and intent-guard reads ` +
      'a path list that starts with "-" as a missing value.'
    );
  }
  return null;
}

/**
 * The change set in the order it is joined for `--paths`: unchanged, except
 * that when the first path starts with "-" the first path that does not is
 * moved to the front, so the joined value does not start with "-". Order
 * carries no meaning to the gate.
 */
export function orderForPathsFlag(paths: readonly string[]): string[] {
  const lead = paths.findIndex((entry) => !entry.startsWith('-'));
  if (paths.length === 0 || !paths[0]!.startsWith('-') || lead === -1) {
    return [...paths];
  }
  return [paths[lead]!, ...paths.slice(0, lead), ...paths.slice(lead + 1)];
}
