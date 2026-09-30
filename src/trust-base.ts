// Pull-request mode for the umbrella: the policy comes from the base ref.
//
// The hole this closes is the umbrella's own, and it is the sharpest one in
// the family because the policy file can name a program to run. On a
// pull-request run the author controls every file in the tree being judged,
// `.guardrails.yaml` included, so one commit could point a gate's `command:`
// at a script the same commit added, or set `enabled: false` on the gate
// that would have caught what else is in it, and the report would say the
// run was clean. The gate ran. It just ran the pull request's own program,
// under the pull request's own rules.
//
// The fix is not a heuristic about which policy edits look suspicious. It is
// base versus head, and it is plain git: with `--trust-base <ref>` the
// umbrella reads its policy from that ref and judges the head tree. A policy
// difference never takes effect for the run, and the report says it was
// proposed. Outside pull-request mode nothing changes, because a pre-commit
// hook and a direct run on your own checkout are already inside the trust
// boundary.
//
// Three rules hold this file together, and all three are intent-guard's,
// mirrored on purpose so the two gates cannot disagree about what a trust
// base is:
//
//  - READS ONLY, AND NEVER INTO THE REPOSITORY. `git rev-parse` and
//    `git show`, both of which only read. No checkout switch, no worktree, no
//    stash, no write of any kind. An umbrella that moved somebody's HEAD to
//    do its job would be a worse bug than the one it fixes.
//
//  - FAIL CLOSED ON THE REF. A ref that will not resolve is could-not-run for
//    every enabled gate. It is never a reason to fall back to the head,
//    because falling back to the head is exactly the behaviour being removed,
//    and it would be reachable by anyone who could make the base ref
//    unfetchable.
//
//  - THE BASE MUST NOT BE THE HEAD, by commit AND by tree. A trust base that
//    resolves to the head commit puts the boundary back where it started
//    while still reporting as on, and two different commits can carry one
//    identical tree, which has the same effect and passes a commit
//    comparison. Both are real misconfigurations rather than curiosities:
//    on a pull_request event `github.sha` IS the merge commit, and what
//    GitHub publishes as the merge ref carries the head branch's tree
//    whenever the base has not moved since the fork.
//
//    ONE NARROW EXCEPTION to the tree rule, added for issue #69. When a pull
//    request's net diff is empty -- a value committed and then backed out in
//    the same pull request -- the merge ref GitHub builds has a tree
//    byte-identical to the base's, and the refusal above would stop
//    secrets-history (gitleaks) from running on exactly the shape it exists
//    to catch: the value is gone from the tree but still in the history
//    between the base and HEAD. The discriminator is FIRST-PARENT IDENTITY,
//    not ancestry: GitHub always builds the merge ref with the base branch as
//    the first parent and the pull request's own head as the second, so a
//    trust base that resolves to HEAD's first parent is the base the merge
//    ref was actually built from, while HEAD's second parent is the pull
//    request's own branch -- also an ancestor of HEAD, also carrying the
//    same tree, and exactly the ref this rule must keep refusing, because
//    trusting it would put the policy back inside the tree being judged. An
//    ancestry check cannot tell those two apart; first-parent identity can.
//    The exception applies ONLY when HEAD has two or more parents (a real
//    merge commit) and the ref resolves to the first one; every other
//    equal-tree shape -- a non-merge HEAD, the second parent, any other
//    ancestor -- keeps refusing exactly as before. And the exception does not
//    change what a tree-reading gate is told: it changes only whether the
//    RUN proceeds, so the caller can still learn the trees matched
//    (`headTreeEqualsBase` below) and run only the gates whose input is
//    history rather than the tree.

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { POLICY_FILE_NAME } from './policy.js';

/**
 * The private, fully spelled ref the composite action fetches the base branch
 * into (action.yml, gates step). Nothing else writes it and no short name can
 * shadow it: git resolves a short name like origin/main through refs/tags/
 * BEFORE refs/remotes/, so a tag pushed by anyone able to push tags would
 * otherwise choose the commit the rules are read from.
 */
export const PRIVATE_TRUST_BASE_REF = 'refs/conductor/trust-base';

function refExists(repoRoot: string, fullRef: string): boolean {
  const child = spawnSync('git', ['show-ref', '--verify', '--quiet', fullRef], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return child.error === undefined && child.status === 0;
}

/**
 * The object id a fully spelled ref EXACTLY names, or null when there is no
 * such ref. `show-ref --verify` looks at that ref and nothing else: it does
 * not run git's name-resolution rules, so a tag stored as
 * refs/tags/refs/conductor/trust-base is never taken for
 * refs/conductor/trust-base.
 */
export function exactRefObject(repoRoot: string, fullRef: string): string | null {
  const child = spawnSync('git', ['show-ref', '--verify', '--hash', fullRef], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (child.error !== undefined || child.status !== 0) {
    return null;
  }
  const value = (child.stdout ?? '').trim();
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value) ? value : null;
}

/**
 * A caller-given trust base that starts with "-", or null. Git allows a tag
 * named refs/tags/--output=x, and such a name handed to git as an argument is
 * read as an option, not a revision. Refused before any git call sees it; the
 * git calls below also pass --end-of-options as a second line of defence.
 */
export function refuseDashLeadingRef(ref: string): string | null {
  if (!ref.startsWith('-')) {
    return null;
  }
  return (
    `refusing "${ref}" as the trust base: it starts with "-", which git would read as an ` +
    'option rather than a revision. Pass a ref name or a full commit id. Nothing was checked.'
  );
}

/** A full 40- or 64-hex object id: never subject to ref name resolution. */
export function isFullObjectId(value: string): boolean {
  return /^([0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}

/**
 * Why a SHORT ref name cannot be trusted as spelled, or null.
 *
 * A name that matches more than one kind of ref (a tag and a remote-tracking
 * ref or a branch) is resolved by git in its own precedence order, tags
 * first, with no warning under --quiet. That is a choice made by whoever can
 * create the tag, so it is refused rather than resolved. A ref already spelled
 * from refs/ is unambiguous, and revision expressions (HEAD, HEAD~1, a sha) are
 * not names and are left to the callers' own checks.
 */
export function refuseAmbiguousRef(
  repoRoot: string,
  ref: string,
  /** What the ref is used as, for the message: "the trust base", "the intent base". */
  noun = 'the trust base'
): string | null {
  // The NAME part only: origin/main~0, origin/main^{commit} and origin/main@{0}
  // resolve through the same tag-first rules as origin/main, so a revision
  // suffix is cut off (from the first ~ ^ : or @{) before the check. A bare @
  // is HEAD and is NOT a cut: a name may carry a literal @ (a branch and a tag
  // both named feature@x, where git picks the tag), and cutting there hid it.
  const cut = ref.search(/[~^:]|@\{/);
  const name = cut === -1 ? ref : ref.slice(0, cut);
  if (
    name === '' ||
    name === 'HEAD' ||
    name === '@' ||
    name.startsWith('refs/') ||
    /[\s{}\\]/.test(name) ||
    isFullObjectId(name)
  ) {
    return null;
  }
  const matches = [`refs/tags/${name}`, `refs/heads/${name}`, `refs/remotes/${name}`].filter((full) =>
    refExists(repoRoot, full)
  );
  if (matches.length <= 1) {
    return null;
  }
  return (
    `refusing "${ref}" as ${noun}: the name "${name}" is ambiguous, it matches ${matches.join(' and ')}, ` +
    'and git would pick one of them by its own precedence (tags first). Whoever can push a tag ' +
    'could choose the base this way. Pass the ref spelled in full, for example ' +
    'refs/remotes/origin/main. Nothing was checked.'
  );
}

/**
 * What a rev resolves to at this repository, or null when it does not.
 *
 * `--quiet` suppresses git's own explanation, so there is nothing worth
 * forwarding on failure: the caller writes a sentence a reader can act on
 * rather than repeating the command line that failed.
 */
export function resolveRev(repoRoot: string, rev: string, kind: 'commit' | 'tree'): string | null {
  // A refs/ name is NEVER handed to git's name resolution: rev-parse would
  // try refs/tags/<name> when the ref itself is absent, so a pushed tag named
  // refs/conductor/trust-base would stand in for the private ref. The exact
  // ref is read with show-ref and its object id is what gets resolved (a full
  // object id is not subject to name resolution).
  let target = rev;
  if (rev.startsWith('refs/')) {
    const exact = exactRefObject(repoRoot, rev);
    if (exact === null) {
      return null;
    }
    target = exact;
  }
  const child = spawnSync('git', ['rev-parse', '--verify', '--quiet', '--end-of-options', `${target}^{${kind}}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (child.error !== undefined || child.status !== 0) {
    return null;
  }
  const value = (child.stdout ?? '').trim();
  return value === '' ? null : value;
}

/**
 * HEAD's own parent commits, in order, or an empty list when they cannot be
 * read.
 *
 * `git rev-list --parents -n 1 HEAD` prints one line, HEAD's own sha
 * followed by each parent's, in order. The first entry is dropped here so
 * this returns parents only: for an ordinary commit that is one entry, for a
 * merge commit two or more, and GitHub's merge ref always puts the base
 * branch first and the pull request's own head second.
 */
function headParents(repoRoot: string): string[] {
  const child = spawnSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (child.error !== undefined || child.status !== 0) {
    return [];
  }
  const line = (child.stdout ?? '').trim();
  if (line === '') {
    return [];
  }
  return line.split(/\s+/).slice(1);
}

/**
 * Whether HEAD's tree is byte-identical to the trust base's tree.
 *
 * Exported separately from `refuseTrustBaseRef` rather than folded into its
 * return value, so that function's return type stays the simple `string |
 * null` every other caller and test already reads. The one caller that needs
 * this fact (`policyForRun` in cli.ts) calls it AFTER the refusal check has
 * already passed, on the one shape that is accepted despite an identical
 * tree: a merge commit whose first parent is the base. In that shape every
 * tree-reading gate still has nothing to judge, and the caller uses this to
 * decide which gates run.
 */
export function headTreeEqualsBase(repoRoot: string, ref: string): boolean {
  const baseTree = resolveRev(repoRoot, ref, 'tree');
  const headTree = resolveRev(repoRoot, 'HEAD', 'tree');
  return baseTree !== null && headTree !== null && baseTree === headTree;
}

/**
 * Why this ref cannot be a trust base, or null when it can.
 *
 * A string rather than a thrown error, because the caller does not print it
 * and stop: every enabled gate becomes could-not-run carrying this sentence,
 * so the report names the gates that did not run rather than only the ref
 * that was wrong.
 *
 * The four sentences mirror intent-guard's own refusals, which the umbrella
 * would otherwise meet second-hand as a child's exit 2. Refusing here means
 * the umbrella never spawns a child at all on a base it has already decided
 * it cannot judge against, and it means the two gates give a user the same
 * answer to the same mistake.
 *
 * The identical-tree refusal carries ONE exception (issue #69): when HEAD is
 * a merge commit and this ref is HEAD's first parent, this returns null
 * rather than refusing, because that is precisely the shape GitHub's own
 * merge ref takes on a pull request whose net diff is empty. See the header
 * comment above and `headTreeEqualsBase` below, which is how the caller
 * learns the trees matched even on this accepted path.
 */
export function refuseTrustBaseRef(repoRoot: string, ref: string): string | null {
  const dashed = refuseDashLeadingRef(ref);
  if (dashed !== null) {
    return dashed;
  }
  const ambiguous = refuseAmbiguousRef(repoRoot, ref);
  if (ambiguous !== null) {
    return ambiguous;
  }
  const base = resolveRev(repoRoot, ref, 'commit');
  if (base === null) {
    return (
      `cannot read the policy from base ref "${ref}": it does not resolve to a commit in ` +
      'this repository. Nothing was checked. In CI, fetch the base branch (actions/checkout ' +
      'with fetch-depth: 0) before running the gates.'
    );
  }

  const head = resolveRev(repoRoot, 'HEAD', 'commit');
  if (head === null) {
    return (
      `cannot resolve HEAD to compare against base ref "${ref}": this is not a repository ` +
      'with any commits. Pull-request mode needs both a base commit and a head commit. ' +
      'Nothing was checked.'
    );
  }

  if (base === head) {
    return (
      `refusing "${ref}" as the trust base: it resolves to ${head}, the same commit as HEAD, ` +
      'so the policy would come from the tree being judged and pull-request mode would be off ' +
      'while still reporting as on. Pass the base branch (for example origin/main), not the ' +
      'head commit: on a pull_request event github.sha is the merge commit, which is HEAD. ' +
      'Nothing was checked.'
    );
  }

  const baseTree = resolveRev(repoRoot, ref, 'tree');
  const headTree = resolveRev(repoRoot, 'HEAD', 'tree');
  if (baseTree !== null && headTree !== null && baseTree === headTree) {
    // THE ONE EXCEPTION: HEAD is a real merge commit (two or more parents)
    // and this ref resolves to HEAD's FIRST parent, which is the base
    // GitHub's merge ref was actually built from. Checked by identity against
    // `base` above, never by ancestry: HEAD's SECOND parent -- the pull
    // request's own branch -- is an ancestor too and carries the same tree,
    // and trusting it would be exactly the hole this rule closes.
    const parents = headParents(repoRoot);
    if (parents.length >= 2 && parents[0] === base) {
      return null;
    }
    return (
      `refusing "${ref}" as the trust base: it is a different commit from HEAD but carries an ` +
      `identical tree (${headTree}), so the policy would come from the tree being judged and ` +
      'there would be nothing for pull-request mode to compare. A pull request merge ref looks ' +
      'exactly like this when the base has not moved. Pass the base branch (for example ' +
      'origin/main), not the head or merge commit. Nothing was checked.'
    );
  }

  return null;
}

/**
 * Why an explicit --trust-base cannot be honoured on a pull request, or null.
 *
 * Issue #58. The refusal above only refuses a ref that resolves to HEAD's own
 * commit or to HEAD's own tree, which covers HEAD itself and an UNMOVED
 * origin/<pr-branch>. Once the base branch has moved, origin/<pr-branch> no
 * longer matches either test, so a same-repo pull request could set
 * trust-base to its own branch, in its own workflow file, and have this
 * package read .guardrails.yaml from the pull request after all -- at which
 * point the pull request controls the whole policy, which is the one thing
 * pull-request mode exists to prevent.
 *
 * action.yml's validate step now refuses an explicit trust-base input
 * outright on a pull_request or pull_request_target event, the stronger line
 * dep-guard's own base input took in 0.8.0. This function is the CLI's own
 * line of defence for anyone invoking it directly in CI, bypassing that step.
 *
 * GITHUB_BASE_REF IS ACTIONS' OWN PULL-REQUEST SIGNAL: the base branch's
 * NAME on a pull_request or pull_request_target event, and empty everywhere
 * else -- a push, a schedule, workflow_dispatch, merge_group, a local run, or
 * a platform that never sets it. When it is set, the given ref is accepted
 * only when it is the FULL COMMIT ID the composite action's "Fetch the trust
 * base" step published (which must equal refs/conductor/trust-base, the
 * authority, or refs/remotes/origin/<githubBaseRef>, both read with show-ref),
 * or is that private ref itself, or -- for an explicit trust base -- resolves
 * to the same commit as refs/remotes/origin/<githubBaseRef>. So an ordinary
 * pull-request run through the action returns null here, before
 * refuseTrustBaseRef's own checks -- HEAD, and the equal-tree exception from
 * issue #69/#73 -- ever run: this check is narrower than those and says
 * nothing about HEAD or about tree equality, only about whether the given ref
 * agrees with the one Actions says this run must use. A ref naming the pull
 * request's own branch, or anything else that disagrees, is refused with both
 * refs and both commits named.
 *
 * FAILS CLOSED when neither the private ref nor refs/remotes/origin/
 * <githubBaseRef> exists, naming them: reachable through the CLI on the
 * default actions/checkout (fetch-depth: 1), which does not carry the base
 * branch at all. The README already asks for fetch-depth: 0, and a checkout
 * that does not carry the base branch is not a reason to skip the comparison.
 *
 * When the GIVEN ref does not resolve at all, this returns null rather than
 * refusing: refuseTrustBaseRef is the function with its own sentence for an
 * unresolvable ref, and repeating it here under a second name would only
 * confuse which check actually fired.
 *
 * A no-op -- always null -- when githubBaseRef is undefined or empty, which
 * is every push, schedule, workflow_dispatch, merge_group and local run.
 */
export function refuseTrustBaseForPullRequest(
  repoRoot: string,
  ref: string,
  githubBaseRef: string | undefined
): string | null {
  if (githubBaseRef === undefined || githubBaseRef === '') {
    return null;
  }

  const dashed = refuseDashLeadingRef(ref);
  if (dashed !== null) {
    return dashed;
  }

  const ambiguous = refuseAmbiguousRef(repoRoot, ref);
  if (ambiguous !== null) {
    return ambiguous;
  }

  // SPELLED IN FULL, and read with show-ref (resolveRev does that for every
  // refs/ name): a short origin/<base> would resolve through
  // refs/tags/origin/<base> first, and a refs/ name through a tag of that
  // name when the ref is absent.
  const expectedRef = `refs/remotes/origin/${githubBaseRef}`;
  const expectedCommit = resolveRev(repoRoot, expectedRef, 'commit');
  const privateCommit = resolveRev(repoRoot, PRIVATE_TRUST_BASE_REF, 'commit');

  // THE ACTION PASSES A FULL COMMIT ID, never a ref name (a full object id is
  // not subject to name resolution). It is accepted only when it IS the
  // private ref's commit (the authority, fetched and verified by the action's
  // fetch step) or, ONLY when the private ref does not exist, the commit of
  // refs/remotes/origin/<base> (both read with show-ref).
  if (isFullObjectId(ref)) {
    const given = resolveRev(repoRoot, ref, 'commit');
    if (given === null) {
      return null;
    }
    // The private ref is the ONLY acceptable answer when it exists: pull-request
    // code can move refs/remotes/origin/<base>, so an id that matches only that
    // ref is the attack, not a second answer. The remote-tracking ref is the
    // reference only when the private ref is absent.
    if (privateCommit !== null ? given === privateCommit : given === expectedCommit) {
      return null;
    }
    if (privateCommit === null && expectedCommit === null) {
      return (
        `cannot verify "${ref}" as the trust base: neither ${PRIVATE_TRUST_BASE_REF} (the ` +
        `composite action's fetch of the base branch) nor "${expectedRef}" exists in this ` +
        'repository, so there is nothing to compare it against. Nothing was checked. In CI, fetch ' +
        'the base branch (actions/checkout with fetch-depth: 0) before running the gates.'
      );
    }
    return (
      `refusing "${ref}" as the trust base: GITHUB_BASE_REF is set to "${githubBaseRef}", so this ` +
      'run is a pull request, and on a pull request the trust base must be the base branch and ' +
      `nothing else. It equals neither ${PRIVATE_TRUST_BASE_REF} (${privateCommit ?? 'absent'}) ` +
      `nor ${expectedRef} (${expectedCommit ?? 'absent'}). Nothing was checked.`
    );
  }

  // THE PRIVATE REF IS THE AUTHORITY, and nothing reads
  // refs/remotes/origin/<base> for trust. That ref is fixed at checkout time
  // and is the side pull-request code can move, while the private ref is
  // fetched later by the action: comparing them adds a false refusal whenever
  // the base branch advances in between, and no protection. Only an explicit
  // trust base (below) has the remote-tracking ref as its one reference.
  if (ref === PRIVATE_TRUST_BASE_REF) {
    if (privateCommit !== null) {
      return null;
    }
    return (
      `refusing "${ref}" as the trust base: no such ref exists in this repository (a tag or ` +
      'branch of that name does not count: only the exact ref the action fetched does). The ' +
      'action\'s fetch of the base branch did not run or did not succeed. Nothing was checked.'
    );
  }

  if (expectedCommit === null) {
    return (
      `cannot verify "${ref}" as the trust base: "${expectedRef}" does not resolve to a commit ` +
      `in this repository, so there is nothing to compare it against, and only ` +
      `${PRIVATE_TRUST_BASE_REF} (fetched by the composite action) is accepted without it. ` +
      'Nothing was checked. In CI, fetch the base branch (actions/checkout with ' +
      'fetch-depth: 0) before running the gates.'
    );
  }

  const givenCommit = resolveRev(repoRoot, ref, 'commit');
  if (givenCommit === null) {
    return null;
  }

  // A NAMED explicit trust base may equal refs/remotes/origin/<base> even
  // while the private ref exists: the full-id rule above applies to the
  // action's own id, not to a name the caller typed.
  if (givenCommit === expectedCommit) {
    return null;
  }

  return (
    `refusing "${ref}" as the trust base: GITHUB_BASE_REF is set to "${githubBaseRef}", so this ` +
    'run is a pull request, and on a pull request the trust base must be the base branch and ' +
    `nothing else. "${ref}" resolves to ${givenCommit}, and "${expectedRef}" resolves to ` +
    `${expectedCommit}, a different commit: something moved one of them, so neither can be ` +
    `trusted. Pass ${expectedRef} or ${PRIVATE_TRUST_BASE_REF} instead. Nothing was checked.`
  );
}

/**
 * The policy file's contents at a ref, or null when that ref carries none.
 *
 * `git show`, never a checkout switch and never a read from the working
 * tree. The `./` is load-bearing for the same reason it is in intent-guard:
 * it makes git resolve the path relative to the working directory, which is
 * the repository root here, rather than to wherever the repository root would
 * be from somewhere else.
 */
export function readPolicyAtRef(repoRoot: string, ref: string): string | null {
  if (ref.startsWith('-')) {
    return null;
  }
  const child = spawnSync('git', ['show', '--end-of-options', `${ref}:./${POLICY_FILE_NAME}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (child.error !== undefined || child.status !== 0) {
    return null;
  }
  return child.stdout ?? '';
}

/**
 * Whether two policy files differ in what they SAY.
 *
 * Compared as parsed documents rather than as bytes, so a reflowed list, a
 * changed quote style or an edited comment is not reported as a proposal to
 * change the rules; a report that cries wolf on whitespace is a report
 * reviewers learn to skip. When either side will not parse, the raw text is
 * compared instead, which is the fail-closed direction: an unparseable head
 * policy is reported as a change rather than quietly matching.
 *
 * BOTH SIDES COME FROM `git show`, base and head alike, and that is not an
 * accident of implementation. intent-guard read its head side from the
 * working tree with a call that follows symlinks, so a pull request that
 * replaced a control file with a link compared equal to the base and was
 * reported as changing nothing. One reader for both sides is the only way the
 * two can be compared on equal terms, and it also means an uncommitted local
 * edit is not reported as something the pull request proposes.
 */
export function policyDiffers(base: string | null, head: string | null): boolean {
  if (base === null && head === null) {
    return false;
  }
  if (base === null || head === null) {
    return true;
  }
  try {
    return JSON.stringify(parseYaml(base) ?? null) !== JSON.stringify(parseYaml(head) ?? null);
  } catch {
    return base !== head;
  }
}

/** The one line the report prints when the head proposes a different policy. */
export const POLICY_PROPOSAL_LINE = 'policy changed in this pull request';

/**
 * One path's tree entry at a ref, or null when the ref has no such path.
 *
 * `ls-tree` rather than `git show`, because the BLOB ID is the thing being
 * compared and `show` prints contents without telling you what kind of entry
 * produced them. The mode comes with it, so a regular file can be told from a
 * symlink, a submodule or a directory in the same read.
 */
export function treeEntryAt(
  repoRoot: string,
  ref: string,
  relativePath: string
): { mode: string; type: string; sha: string } | null {
  if (ref.startsWith('-')) {
    return null;
  }
  const child = spawnSync('git', ['ls-tree', '--end-of-options', ref, '--', `./${relativePath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (child.error !== undefined || child.status !== 0) {
    return null;
  }
  const line = (child.stdout ?? '').split('\n').find((entry) => entry.trim().length > 0);
  if (line === undefined) {
    return null;
  }
  const [mode, type, sha] = line.split(/\s+/);
  if (mode === undefined || type === undefined || sha === undefined) {
    return null;
  }
  return { mode, type, sha };
}

/** The two modes that mean an ordinary file git will hand back. */
function isRegularFileMode(mode: string): boolean {
  return mode === '100644' || mode === '100755';
}

/**
 * The working-tree root, resolved through symlinks, or null.
 *
 * realpath on BOTH sides of every comparison below. On macOS the temporary
 * directory is reached through a symlink, so one repository root has two
 * spellings, one of them with an extra leading segment, and a prefix test on
 * the raw strings answers "outside" for a file that is plainly inside.
 */
function realOrNull(candidate: string): string | null {
  try {
    return realpathSync(candidate);
  } catch {
    return null;
  }
}

/** Whether `candidate` is the working tree or something under it. */
function insideWorkingTree(repoReal: string, candidate: string): boolean {
  const relative = path.relative(repoReal, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * A path with its PARENT resolved through symlinks but its own last component
 * left alone.
 *
 * Resolving the whole path would follow the program's own symlink, which is a
 * different question and is asked separately below. Resolving nothing at all
 * was a bug: the repository root arrives here realpath'd, so on a machine
 * where the working tree sits under a symlinked mount (a macOS temporary
 * directory, for one) the unresolved spelling of a file plainly inside the
 * tree compares as OUTSIDE it, and the entry was quietly skipped. Only the
 * link's target was then vetted, and the link's own entry never was.
 */
function withResolvedParent(candidate: string): string {
  const parent = path.dirname(candidate);
  return path.join(realOrNull(parent) ?? parent, path.basename(candidate));
}

/**
 * The tree object id of one directory at a ref, or null.
 *
 * The repository root is its own case: it has no containing directory, so the
 * comparison is the whole root tree, which `rev-parse` gives directly.
 */
function treeShaAt(repoRoot: string, ref: string, relativeDir: string): string | null {
  if (relativeDir === '' || relativeDir === '.') {
    return resolveRev(repoRoot, ref, 'tree');
  }
  const entry = treeEntryAt(repoRoot, ref, relativeDir);
  return entry === null || entry.type !== 'tree' ? null : entry.sha;
}

/**
 * Why this gate's PROGRAM cannot be trusted on a pull-request run, or null.
 *
 * Reading the rules from the base ref is worth nothing if the pull request
 * chooses the program that applies them, and it can, three ways that all look
 * ordinary in a diff:
 *
 *  - A base policy whose `command:` points INSIDE the repository, at
 *    something like `vendor/vault-guard`. The path came from the base and is
 *    therefore approved; the FILE AT THAT PATH is whatever the head commit
 *    put there. The umbrella then runs the pull request's own program, is
 *    told the scan was clean, and reports a clean scan.
 *
 *  - No `command:` at all. Resolution prefers the repository's own
 *    `node_modules/.bin` over PATH, deliberately, so that a project pin beats
 *    a global install. A head that commits `node_modules/.bin/vault-guard`
 *    shadows the real gate, and a stub that answers `--version` with a
 *    plausible number passes every check the umbrella makes. The composite
 *    action installs nothing, so the plant survives an install step.
 *
 *  - A base-approved WRAPPER. `vendor/vault-guard` is byte for byte what the
 *    base approved and is the path the policy names; it execs
 *    `vendor/impl.sh`, which the head rewrote. Nothing in the diff touches
 *    the path the policy names, so a per-file check waves it through. This
 *    one was found by a reviewer after the first two were closed, and it is
 *    why the unit of approval is a directory rather than a file.
 *
 * THE RULE. A program is acceptable when it is outside the working tree
 * entirely: on PATH, or an absolute `command:` somewhere else on the machine.
 * A pull request cannot write those. A program INSIDE the working tree is
 * acceptable only when BOTH hold: it is a tracked regular file whose blob is
 * IDENTICAL at the trust base and at HEAD, AND the tree object id of its
 * CONTAINING DIRECTORY is identical at those two refs. The first is the same
 * base-versus-head test the rules themselves get, applied to the thing that
 * enforces them; the second extends it to everything beside the program,
 * which is what the wrapper shape needs and what a per-file test cannot give.
 *
 * A tree object id covers a whole subtree in one comparison, so this needs no
 * knowledge of what a wrapper calls. WHAT IS VETTED IS THE PROGRAM FILE AND
 * ITS DIRECTORY SUBTREE AND NOTHING ELSE: anything the program reaches
 * outside that directory is not vetted, so an in-repo gate has to be
 * self-contained within its own directory. That limit is stated in the README
 * in those words, because an adopter has to be able to satisfy it.
 *
 * A PROGRAM AT THE REPOSITORY ROOT IS REFUSED. There the containing directory
 * is the whole repository, so the comparison is the root tree and every pull
 * request that changed anything differs, which is every pull request.
 * Refusing with the remedy in the message beats a rule that silently means
 * "no pull request may change anything".
 *
 * NOTHING HERE READS THE WORKING TREE. Both sides come from `git ls-tree`, so
 * an uncommitted local edit cannot make a file look approved and a tracked
 * file cannot be vouched for by a copy on disk that git has never seen.
 *
 * NODE_MODULES IS NEVER BASE-APPROVED, and the reason is worth stating
 * because "but the lockfile is committed" is the obvious objection. What is
 * under `node_modules` is chosen by the head's own manifest and lockfile and
 * installed by a step that runs before this one; git has no record of those
 * bytes at either ref, so `ls-tree` finds nothing and the rule refuses. That
 * is the correct answer rather than a limitation: a pull request that edits
 * its lockfile to pull a different build of a gate has chosen its own judge
 * just as surely as one that commits a stub.
 *
 * BOTH THE PROGRAM'S OWN PATH AND ITS REALPATH ARE VETTED, because a
 * head-committed symlink is a choice of program too. An in-repo symlink is
 * refused on its OWN entry, before its target matters: it is either untracked
 * or its tree entry is a link rather than a regular file, and either refuses.
 * Vetting the target is what catches a link whose own path is outside the
 * tree pointing into it; it never decides the in-repo case.
 */
export function refuseHeadControlledProgram(
  repoRoot: string,
  trustBase: string,
  programPath: string
): string | null {
  const repoReal = realOrNull(repoRoot);
  if (repoReal === null) {
    return `the repository root ${repoRoot} could not be resolved, so the gate program could not be checked against "${trustBase}". Nothing was checked by this gate.`;
  }

  const candidates = new Set<string>();
  for (const candidate of [withResolvedParent(programPath), realOrNull(programPath)]) {
    if (candidate !== null && insideWorkingTree(repoReal, candidate)) {
      candidates.add(candidate);
    }
  }
  if (candidates.size === 0) {
    // Outside the working tree: on PATH, or an absolute path elsewhere on the
    // machine. A pull request cannot write either.
    return null;
  }

  for (const candidate of candidates) {
    const relative = path.relative(repoReal, candidate).split(path.sep).join('/');
    const base = treeEntryAt(repoRoot, trustBase, relative);
    const head = treeEntryAt(repoRoot, 'HEAD', relative);

    if (base === null || head === null) {
      return (
        `the ${trustBase === '' ? 'base' : `"${trustBase}"`} ref does not track the gate program ` +
        `at ${relative}, so it is a file this pull request controls and running it would let the ` +
        'pull request choose the program that judges it. Nothing under node_modules is ever ' +
        'base-approved: what is there is chosen by the head own manifest and lockfile, and git ' +
        'has no record of those bytes at either ref. Install the gate on PATH, or point ' +
        'command: at a path outside the repository. Nothing was checked by this gate.'
      );
    }
    if (!isRegularFileMode(base.mode) || !isRegularFileMode(head.mode)) {
      return (
        `the gate program at ${relative} is not a regular file at both "${trustBase}" and the ` +
        'head commit, so what would actually run is decided by something other than the ' +
        'approved bytes. Nothing was checked by this gate.'
      );
    }
    if (base.sha !== head.sha) {
      return (
        `the gate program at ${relative} is not the one "${trustBase}" approved: this pull ` +
        'request changes it, so running it would let the pull request choose the program that ' +
        'judges it. Land the change on the base branch first. Nothing was checked by this gate.'
      );
    }

    // AND THE DIRECTORY AROUND IT. The file check alone is defeated by a
    // wrapper: `vendor/vault-guard` execs `vendor/impl.sh`, the pull request
    // leaves the wrapper byte for byte alone and rewrites the helper beside
    // it, and nothing in the diff touches the path the policy names. So the
    // unit of approval is the program's DIRECTORY SUBTREE, compared as one
    // tree object id, which covers every file under it at once without this
    // package having to know what a wrapper calls.
    const directory = path.posix.dirname(relative);
    const baseTree = treeShaAt(repoRoot, trustBase, directory);
    const headTree = treeShaAt(repoRoot, 'HEAD', directory);

    if (baseTree === null || headTree === null || baseTree !== headTree) {
      if (directory === '' || directory === '.') {
        // At the root the containing directory IS the whole repository, so
        // this compares root trees and any pull request that changed anything
        // differs, which is every pull request. Refusing with the remedy
        // beats a rule that silently means "no pull request may change
        // anything".
        return (
          `the gate program at ${relative} is at the repository root, so the directory that ` +
          'would have to be unchanged for it to be trusted is the whole repository, and this ' +
          `pull request differs from "${trustBase}" somewhere in it. Move a vendored gate into ` +
          'its own directory, or install it on PATH. Nothing was checked by this gate.'
        );
      }
      return (
        `a file beside the gate program in ${directory} is not what "${trustBase}" approved: the ` +
        `program at ${relative} is unchanged, but the directory around it is not, and a gate is ` +
        'rarely one file. A wrapper that execs a helper beside it runs whatever this pull ' +
        'request put there. Land the change on the base branch first, or install the gate on ' +
        'PATH. Nothing was checked by this gate.'
      );
    }
  }

  return null;
}

/**
 * Whether a gate's reported version is at least `minimum`.
 *
 * Numeric per component, not a string comparison, or "1.10.0" would sort
 * below "1.4.0". A version that cannot be read at all answers FALSE, which is
 * the safe direction for the one thing this decides: whether to hand a child
 * a flag an older build of it would reject outright. A gate that refused an
 * unknown flag would exit non-zero with no JSON, which the umbrella reports
 * as could-not-run, so guessing high turns a working run into a broken one
 * for every repository pinning an older gate.
 */
export function atLeastVersion(version: string | null, minimum: string): boolean {
  if (version === null) {
    return false;
  }
  const parse = (value: string): number[] => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
    return match === null ? [] : [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const actual = parse(version);
  const wanted = parse(minimum);
  if (actual.length !== 3 || wanted.length !== 3) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== wanted[index]) {
      return actual[index] > wanted[index];
    }
  }
  return true;
}
