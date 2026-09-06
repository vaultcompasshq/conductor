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

import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

import { POLICY_FILE_NAME } from './policy.js';

/**
 * What a rev resolves to at this repository, or null when it does not.
 *
 * `--quiet` suppresses git's own explanation, so there is nothing worth
 * forwarding on failure: the caller writes a sentence a reader can act on
 * rather than repeating the command line that failed.
 */
function resolveRev(repoRoot: string, rev: string, kind: 'commit' | 'tree'): string | null {
  const child = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${rev}^{${kind}}`], {
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
 */
export function refuseTrustBaseRef(repoRoot: string, ref: string): string | null {
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
 * The policy file's contents at a ref, or null when that ref carries none.
 *
 * `git show`, never a checkout switch and never a read from the working
 * tree. The `./` is load-bearing for the same reason it is in intent-guard:
 * it makes git resolve the path relative to the working directory, which is
 * the repository root here, rather than to wherever the repository root would
 * be from somewhere else.
 */
export function readPolicyAtRef(repoRoot: string, ref: string): string | null {
  const child = spawnSync('git', ['show', `${ref}:./${POLICY_FILE_NAME}`], {
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
