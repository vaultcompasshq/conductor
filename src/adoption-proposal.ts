// When a pull request that adds .guardrails.yaml may be reported as a
// PROPOSAL, exit 0, instead of the refusal every other policy-less base gets
// (issue 101).
//
// A proposal is a run that enforces nothing and still exits 0, so this file
// is trust-boundary code and it has one direction: every function here either
// says "all of this holds" or gives a reason to refuse, and anything it cannot
// establish is a reason. Nothing here falls back, guesses, or reads a failed
// git call as "nothing there".
//
// What it establishes, beyond what src/cli.ts#policyForRun already has by the
// time it asks (the flag was given, the trust base passed its own checks, the
// exact file name is absent in the base tree, and the HEAD blob parses):
//
//   - git's answers can be taken at their word (`disallowedGitVariables`);
//   - the base has no policy under another spelling either
//     (`policyNameVariants`);
//   - the repository has its history (`refuseAdoptionProposal`, shallow);
//   - this pull request ADDED the policy, rather than inheriting one the
//     base has since dropped: no merge base of the trust base and HEAD
//     carries it;
//   - the base branch never carried one: nothing on its own first-parent
//     history touched the file.
//
// Known limit, not closed here: a base branch force-rewound to before the
// commit that added the policy. A pull request branched from that commit
// inherits the file, its merge base with the rewound branch lacks it, and the
// rewound branch's first-parent history never held it. That takes a
// force-push to the default branch.

import { escapeNonAscii } from './escape.js';
import { gitComplaint, runGit } from './git.js';
import { POLICY_FILE_NAME } from './policy.js';
import { isFullObjectId, readFileAtRef, resolveRev } from './trust-base.js';

/**
 * The GIT_ variables a proposal run may have in its environment. AN
 * ALLOWLIST, never a deny list: git reads a long and growing set of GIT_
 * variables, several of them redirect where objects, refs or the work tree
 * are read from (GIT_DIR, GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY,
 * GIT_ALTERNATE_OBJECT_DIRECTORIES, GIT_WORK_TREE, GIT_NAMESPACE,
 * GIT_INDEX_FILE) or how a path is matched (GIT_LITERAL_PATHSPECS,
 * GIT_ICASE_PATHSPECS, GIT_GLOB_PATHSPECS, GIT_NOGLOB_PATHSPECS), and a list
 * of the dangerous ones is wrong the day git adds another. On every other
 * run a redirected git gives a wrong refusal; on this one it would give a
 * green check, because "the base has no policy" is the answer the exit code
 * rests on.
 *
 * Each entry says why that name cannot turn a policy that is there into one
 * that is not.
 */
const ALLOWED_GIT_VARIABLES: ReadonlyArray<{ name: RegExp; why: string }> = [
  {
    name: /^GIT_NO_REPLACE_OBJECTS$/,
    why:
      'The Action exports it for the gates step, and every git call here sets it anyway ' +
      '(src/git.ts#pinnedGitEnv). git tests it for presence only, so any value turns replace ' +
      'objects off, which is the direction wanted.',
  },
  {
    name: /^GIT_GRAFT_FILE$/,
    why:
      'Overwritten on every git call here with a path that cannot exist ' +
      '(src/git.ts#pinnedGitEnv), so the value in the environment is never the one git reads.',
  },
  {
    name: /^GIT_TERMINAL_PROMPT$/,
    why:
      'The Action sets it to 0 for the gates step. It only decides whether git may ask for a ' +
      'credential on a terminal; no read of a local object consults it.',
  },
  {
    name: /^GIT_CONFIG_COUNT$|^GIT_CONFIG_(KEY|VALUE)_(0|[1-9][0-9]*)$/,
    why:
      'Configuration handed over in the environment, which the Action preserves by design (its ' +
      'fetch step appends to a count already there). Configuration CAN bring replace objects ' +
      'back over GIT_NO_REPLACE_OBJECTS (core.useReplaceRefs=true), here or in any file git ' +
      'reads, which is why every git call conductor makes passes core.useReplaceRefs=false and ' +
      'core.commitGraph=false on the command line (src/git.ts#PINNED_GIT_CONFIG): the command ' +
      'line outranks these entries, GIT_CONFIG_PARAMETERS and every file. A gate conductor ' +
      'starts gets core.useReplaceRefs=false appended after these entries, and that value plus ' +
      'core.commitGraph=false appended to GIT_CONFIG_PARAMETERS (src/git.ts#gateChildEnv), ' +
      'because conductor cannot put that command line on a git call the gate makes. ' +
      'GIT_CONFIG_PARAMETERS is not on this list. Configuration has no key for a graft file or for ' +
      'pathspec matching, and cannot move the object store; the design review tried ' +
      'core.worktree and core.bare against the tree listing and the entry was still listed. It ' +
      'can make a read FAIL, and a failed read is an error here, never absent.',
  },
  {
    name: /^GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL|DATE)$/,
    why:
      'The identity and date git writes into a commit or a reflog entry it creates. No read of ' +
      'an object, a tree or a history consults them, and a workflow that sets a bot identity ' +
      'for the whole job would otherwise have a genuine adoption refused.',
  },
];

/**
 * Every GIT_ variable in `env` that is not on the allowlist, sorted. Matched
 * on the upper-cased name, so a lower-case spelling (which Windows treats as
 * the same variable) is caught, and present-but-empty counts: git treats
 * several of these as set whatever they hold.
 */
export function disallowedGitVariables(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter((name) => env[name] !== undefined && name.toUpperCase().startsWith('GIT_'))
    .filter((name) => !ALLOWED_GIT_VARIABLES.some((allowed) => allowed.name.test(name)))
    .sort();
}

/**
 * A file name as a case-insensitive, normalization-insensitive file system
 * compares it, near enough to refuse on: compatibility-decomposed, the code
 * points HFS+ ignores removed, upper-cased then lower-cased (so a long s
 * meets s). Errs toward calling two names the same.
 */
function foldedName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[‌-‏‪-‮⁪-⁯﻿]/g, '')
    .toUpperCase()
    .toLowerCase();
}

/**
 * The entries at the root of `commit`'s tree whose name is the policy file
 * name under another spelling (`.Guardrails.yaml`), or the reason the root
 * could not be listed.
 *
 * `src/policy.ts#loadPolicy` reads the policy from disk by name, so on a
 * case-insensitive file system (the macOS runners) a push run finds and
 * enforces `.Guardrails.yaml`, while every read from a ref here asks git for
 * the exact name and is told there is none. Such a base has a policy.
 */
export function policyNameVariants(
  repoRoot: string,
  commit: string
): { kind: 'listed'; names: string[] } | { kind: 'error'; detail: string } {
  if (!isFullObjectId(commit)) {
    return { kind: 'error', detail: `"${commit}" is not a full commit id` };
  }
  const listed = runGit(repoRoot, ['ls-tree', '--name-only', '-z', commit]);
  if (listed.error !== undefined || listed.status !== 0) {
    return { kind: 'error', detail: `cannot list the root of ${commit}: ${gitComplaint(listed)}` };
  }
  const wanted = foldedName(POLICY_FILE_NAME);
  return {
    kind: 'listed',
    names: listed.stdout
      .split('\0')
      .filter((name) => name !== '' && name !== POLICY_FILE_NAME && foldedName(name) === wanted),
  };
}

/** A name from a tree, quoted and with nothing outside printable ASCII. */
function shownName(name: string): string {
  return escapeNonAscii(JSON.stringify(name));
}

/**
 * How a base branch that once had a policy, or lost one, gets one back. A
 * pull request cannot do it as a proposal, by the two history rules below.
 */
const LAND_IT_FIRST =
  `Land ${POLICY_FILE_NAME} on the base branch first: the pull request that adds it is judged ` +
  'against this same base, so it has to be merged by someone allowed to merge without this ' +
  'check passing.';

/**
 * Why this run is NOT an adoption proposal, or null when every condition
 * holds. Called only after the caller has established that the flag was
 * given, that the trust base passed its own checks, that the exact policy
 * file name is absent in the trust base's tree, and that the HEAD blob
 * parses.
 *
 * The reason is one or two sentences for the refusal the caller reports;
 * every enabled gate is then could-not-run and the run exits 2, exactly as
 * on a base without a policy before this file existed.
 */
export function refuseAdoptionProposal(
  repoRoot: string,
  trustBase: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  // THE ENVIRONMENT FIRST, before any answer from git is believed.
  const unexpected = disallowedGitVariables(env);
  if (unexpected.length > 0) {
    return (
      `${unexpected.join(', ')} ${unexpected.length === 1 ? 'is' : 'are'} set in the environment of ` +
      'this run. conductor reports a proposal only when it can take git at its word that the base ' +
      'has no policy, and a GIT_ variable can change what git reads. Unset ' +
      `${unexpected.length === 1 ? 'it' : 'them'} for this step.`
    );
  }

  const base = resolveRev(repoRoot, trustBase, 'commit');
  const head = resolveRev(repoRoot, 'HEAD', 'commit');
  if (base === null || head === null || !isFullObjectId(base) || !isFullObjectId(head)) {
    return `"${trustBase}" and HEAD could not both be resolved to commits, so their history could not be read.`;
  }

  // THE BASE ROOT, UNDER ANY SPELLING.
  const atBase = policyNameVariants(repoRoot, base);
  if (atBase.kind === 'error') {
    return `whether "${trustBase}" holds the policy file under another spelling could not be checked: ${atBase.detail}.`;
  }
  if (atBase.names.length > 0) {
    return (
      `"${trustBase}" holds ${atBase.names.map(shownName).join(', ')} at its root, which is the policy ` +
      'file name in another spelling, and a run on a case-insensitive file system reads that file ' +
      `as the policy. So this base is not a base without one. Rename it to ${POLICY_FILE_NAME} on ` +
      'the base branch.'
    );
  }

  // A SHALLOW REPOSITORY CANNOT ANSWER THE NEXT TWO QUESTIONS. A commit at
  // the shallow boundary reads as a commit with no parents, so a merge base
  // can be missed and a history that carried a policy reads as one that
  // never did.
  const shallow = runGit(repoRoot, ['rev-parse', '--is-shallow-repository']);
  if (shallow.error !== undefined || shallow.status !== 0 || shallow.stdout.trim() !== 'false') {
    return (
      shallow.error === undefined && shallow.status === 0 && shallow.stdout.trim() === 'true'
        ? 'this is a shallow repository, so the history that would show whether the base branch ' +
          'ever carried a policy is not here.'
        : `whether this repository is shallow could not be checked (${gitComplaint(shallow)}).`
    ) + ' Check out with fetch-depth: 0.';
  }

  // EVERY MERGE BASE. When no commit the pull request shares with the base
  // carries the policy and HEAD does, the pull request added it. When one
  // does, the pull request inherited it and the base has dropped it since:
  // a merge ref built before a deletion landed, or a branch cut before one.
  // --all, and every one of them read: a criss-cross history has more than
  // one merge base. The parents come from the commits themselves, never
  // from a replace ref, a graft or a commit-graph file left in the git
  // directory: runGit pins all three on every call.
  const bases = runGit(repoRoot, ['merge-base', '--all', base, head]);
  const mergeBases = bases.stdout.split('\n').filter((line) => line !== '');
  if (bases.error === undefined && bases.status === 1 && mergeBases.length === 0) {
    return (
      `"${trustBase}" and HEAD share no history, so nothing shows that this pull request is the one ` +
      'that added the policy.'
    );
  }
  if (
    bases.error !== undefined ||
    bases.status !== 0 ||
    mergeBases.length === 0 ||
    !mergeBases.every(isFullObjectId)
  ) {
    return `the merge base of "${trustBase}" and HEAD could not be read (${gitComplaint(bases)}).`;
  }
  for (const mergeBase of mergeBases) {
    const read = readFileAtRef(repoRoot, mergeBase, POLICY_FILE_NAME);
    if (read.kind === 'error') {
      return `${POLICY_FILE_NAME} could not be read at the merge base ${mergeBase}: ${read.detail}.`;
    }
    const variants = read.kind === 'file' ? null : policyNameVariants(repoRoot, mergeBase);
    if (variants !== null && variants.kind === 'error') {
      return `the merge base ${mergeBase} could not be listed: ${variants.detail}.`;
    }
    if (variants === null || variants.names.length > 0) {
      return (
        `the history this pull request shares with "${trustBase}" carries a ${POLICY_FILE_NAME} at ` +
        `the merge base ${mergeBase}, so this pull request did not add the policy: the base branch ` +
        `dropped it after this branch, or its merge ref, was made. ${LAND_IT_FIRST}`
      );
    }
  }

  // THE BASE BRANCH'S OWN HISTORY. One commit on its first-parent chain that
  // added, changed or removed the file means the branch has carried a policy
  // and no longer does, and a pull request that adds one after that is the
  // second half of "delete the rules, then propose weaker ones". rev-list,
  // the plumbing form of `git log --first-parent -1 <base> -- <file>`, so no
  // log configuration reaches it. Matched in any case, as the root listing
  // above is. Empty output is the only answer that passes.
  const touched = runGit(repoRoot, [
    'rev-list',
    '--first-parent',
    '-n',
    '1',
    base,
    '--',
    `:(icase)${POLICY_FILE_NAME}`,
  ]);
  if (touched.error !== undefined || touched.status !== 0) {
    return `the history of "${trustBase}" could not be read (${gitComplaint(touched)}). Check out with fetch-depth: 0.`;
  }
  const commit = touched.stdout.trim();
  if (commit !== '') {
    return (
      `the base branch has carried a ${POLICY_FILE_NAME} before: ` +
      `${isFullObjectId(commit) ? `commit ${commit}` : 'a commit'} on the first-parent history of ` +
      `"${trustBase}" added, changed or removed one. So this is not a first adoption. ${LAND_IT_FIRST}`
    );
  }

  return null;
}
