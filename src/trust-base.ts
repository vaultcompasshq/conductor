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
import { realpathSync } from 'node:fs';
import path from 'node:path';
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
  const child = spawnSync('git', ['ls-tree', ref, '--', `./${relativePath}`], {
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
