// Pull-request mode, at the level of the four decisions it rests on.
//
// Real git repositories, never a mocked one. Three of the four refusals here
// are about what a ref RESOLVES to, and a mock would only prove the umbrella
// agrees with whoever wrote the mock. The fourth, the version comparison, is
// pure and needs none.

import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  atLeastVersion,
  headTreeEqualsBase,
  policyDiffers,
  readFileAtRef,
  treeEntryAt,
  refuseAmbiguousRef,
  refuseHeadControlledProgram,
  refuseTrustBaseForPullRequest,
  refuseTrustBaseRef,
  resolveRev,
} from '../src/trust-base.js';

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/** An empty repository with an identity, and no commits yet. */
function emptyRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-trust-'));
  temps.push(dir);
  git(dir, ['init', '--quiet', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  return dir;
}

function commit(repo: string, files: Record<string, string>, message: string): string {
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(repo, name), contents);
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

/** Removes a tracked file and commits the removal, returning the new HEAD. */
function removeAndCommit(repo: string, name: string, message: string): string {
  git(repo, ['rm', '--quiet', name]);
  git(repo, ['commit', '--quiet', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

/**
 * A repository shaped like the proof repository's secret-in-history pull
 * request: a base commit, a branch that adds a file and then removes it (so
 * the branch tip's tree is byte-identical to the base's), merged with
 * --no-ff so HEAD is a merge commit whose first parent is the base and whose
 * second parent is the branch tip. Returns both commits.
 */
function equalTreeMergeRepo(): { repo: string; base: string; branchTip: string } {
  const repo = emptyRepo();
  const base = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
  git(repo, ['checkout', '--quiet', '-b', 'feature']);
  commit(repo, { 'secret.txt': 'a-planted-secret-value\n' }, 'add a secret');
  const branchTip = removeAndCommit(repo, 'secret.txt', 'back it out, tree matches base again');
  git(repo, ['checkout', '--quiet', 'main']);
  git(repo, ['merge', '--quiet', '--no-ff', '-m', 'merge feature', 'feature']);
  return { repo, base, branchTip };
}

const BASE_POLICY = [
  'version: 1',
  'gates:',
  '  secrets:',
  '    product: vault-guard',
  '',
].join('\n');

describe('refusing a trust base', () => {
  it('accepts a ref that is a different commit with a different tree', () => {
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['branch', 'base']);
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'head');

    expect(refuseTrustBaseRef(repo, 'base')).toBeNull();
  });

  it('refuses a ref that does not resolve, and says how to fetch it', () => {
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');

    const refusal = refuseTrustBaseRef(repo, 'origin/nope');
    expect(refusal).toMatch(/does not resolve to a commit/);
    expect(refusal).toMatch(/origin\/nope/);
    expect(refusal).toMatch(/fetch-depth: 0/);
    expect(refusal).toMatch(/Nothing was checked/);
  });

  it('refuses a ref that resolves to the head commit', () => {
    // The live shape of this mistake is --trust-base with github.sha, which
    // on a pull_request event IS the merge commit, which is HEAD. Every
    // control input would come from the tree being judged while the run
    // reported pull-request mode as on.
    const repo = emptyRepo();
    const head = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'only');

    const refusal = refuseTrustBaseRef(repo, head);
    expect(refusal).toMatch(/the same commit as HEAD/);
    expect(refusal).toMatch(head.slice(0, 12));
  });

  it('refuses a different commit that carries an identical tree', () => {
    // A commit comparison alone waves this through, and it is not a
    // curiosity: a pull request merge ref carries the head branch's tree
    // whenever the base has not moved since the fork.
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'first');
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'second, same tree']);

    const refusal = refuseTrustBaseRef(repo, 'HEAD~1');
    expect(refusal).toMatch(/identical tree/);
    expect(refusal).toMatch(/Nothing was checked/);
  });

  it('refuses when there is no head commit to compare against', () => {
    const repo = emptyRepo();

    // Nothing resolves in a repository with no commits, so this lands on the
    // first refusal. What matters is that it refuses rather than reading the
    // working tree.
    expect(refuseTrustBaseRef(repo, 'HEAD')).not.toBeNull();
  });

  it('does not refuse a merge commit whose first parent is the trust base, even with an identical tree', () => {
    // This is the proof repository's shape: a value committed and then
    // backed out inside one pull request, so the merge ref's tree is
    // byte-identical to the base's. GitHub builds that merge ref with the
    // base as the FIRST parent, which is the fact that tells this shape
    // apart from the ordinary "base resolves to HEAD's tree" misconfiguration
    // the test above pins.
    const { repo, base } = equalTreeMergeRepo();

    expect(refuseTrustBaseRef(repo, base)).toBeNull();
  });

  it('refuses when the trust base is the SECOND parent, even though it is also an ancestor', () => {
    // The pull request's own branch tip is an ancestor of the merge commit
    // too, so an ancestor check alone would accept it. It must not: that
    // branch is the tree being judged, and trusting it is the hole this
    // whole file exists to close. First-parent identity, not ancestry, is
    // the discriminator.
    const { repo, branchTip } = equalTreeMergeRepo();

    const refusal = refuseTrustBaseRef(repo, branchTip);
    expect(refusal).toMatch(/identical tree/);
    expect(refusal).toMatch(/Nothing was checked/);
  });

  it('still refuses a non-merge HEAD with an equal-tree ancestor', () => {
    // The exception is narrow: without a second parent on HEAD there is no
    // merge-ref shape to distinguish, so the ordinary refusal stands. Same
    // repository shape as "refuses a different commit that carries an
    // identical tree" above, restated here so a change that widened the
    // exception past merge commits would be caught beside it.
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'first');
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'second, same tree, not a merge']);

    const refusal = refuseTrustBaseRef(repo, 'HEAD~1');
    expect(refusal).toMatch(/identical tree/);
  });
});

describe('whether the head tree equals the trust base tree', () => {
  it('is true on the accepted merge-ref shape, so the caller can still tell the trees matched', () => {
    const { repo, base } = equalTreeMergeRepo();

    expect(refuseTrustBaseRef(repo, base)).toBeNull();
    expect(headTreeEqualsBase(repo, base)).toBe(true);
  });

  it('is false when the trees differ', () => {
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['branch', 'base']);
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'head');

    expect(headTreeEqualsBase(repo, 'base')).toBe(false);
  });
});

describe('reading the policy file at a ref', () => {
  it('reads the base ref file, not the one in the working tree', () => {
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['branch', 'base']);
    commit(repo, { '.guardrails.yaml': 'version: 1\ngates: {}\n' }, 'head rewrites it');
    writeFileSync(path.join(repo, '.guardrails.yaml'), 'version: 1\n# and an uncommitted edit\n');

    expect(readFileAtRef(repo, 'base', '.guardrails.yaml')).toEqual({ kind: 'file', text: BASE_POLICY });
  });

  it('reads the head commit rather than the working tree for the head side', () => {
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    writeFileSync(path.join(repo, '.guardrails.yaml'), 'version: 1\ngates: {}\n');

    // An uncommitted local edit is not something a pull request proposes.
    expect(readFileAtRef(repo, 'HEAD', '.guardrails.yaml')).toEqual({ kind: 'file', text: BASE_POLICY });
  });

  it('answers absent when the ref carries no policy file at all', () => {
    const repo = emptyRepo();
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'no policy here');

    expect(readFileAtRef(repo, 'HEAD', '.guardrails.yaml')).toEqual({ kind: 'absent' });
  });
});

describe('readFileAtRef keeps absent, file and error apart', () => {
  /** A base commit holding `files`, and a second commit on top of it. */
  function baseAndHead(files: Record<string, string>): { repo: string; base: string } {
    const repo = emptyRepo();
    for (const name of Object.keys(files)) {
      mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    }
    const base = commit(repo, files, 'base');
    commit(repo, { 'later.txt': 'later\n' }, 'head');
    return { repo, base };
  }

  /** Commits a tree entry of any mode at `name`, with no file on disk behind it. */
  function commitEntry(repo: string, mode: string, sha: string, name: string): string {
    git(repo, ['update-index', '--add', '--info-only', '--cacheinfo', `${mode},${sha},${name}`]);
    const tree = git(repo, ['write-tree', '--missing-ok']).trim();
    const parent = git(repo, ['rev-parse', 'HEAD']).trim();
    const made = git(repo, ['commit-tree', tree, '-p', parent, '-m', `entry ${name}`]).trim();
    git(repo, ['update-ref', 'refs/heads/entry', made]);
    return made;
  }

  it('reads a regular file', () => {
    const { repo, base } = baseAndHead({ 'conf/a.yaml': 'a: 1\n' });
    expect(readFileAtRef(repo, base, 'conf/a.yaml')).toEqual({ kind: 'file', text: 'a: 1\n' });
  });

  it('answers absent for a path the ref does not carry, including under a missing directory', () => {
    const { repo, base } = baseAndHead({ 'a.yaml': 'a: 1\n' });
    expect(readFileAtRef(repo, base, 'b.yaml')).toEqual({ kind: 'absent' });
    expect(readFileAtRef(repo, base, 'no/such/dir/b.yaml')).toEqual({ kind: 'absent' });
  });

  it('reads the right file when the working tree holds a file named like the revision and path', () => {
    // The path is looked up in the ref's tree and the blob read by id, so a
    // working-tree file of any name cannot change what is read.
    const { repo, base } = baseAndHead({ '.guardrails.yaml': BASE_POLICY });
    mkdirSync(path.join(repo, `${base}:.`));
    writeFileSync(path.join(repo, `${base}:.`, '.guardrails.yaml'), 'version: 1\ngates: {}\n');
    expect(readFileAtRef(repo, base, '.guardrails.yaml')).toEqual({ kind: 'file', text: BASE_POLICY });
  });

  it('answers error, never absent or empty, for a symlink entry', () => {
    const { repo } = baseAndHead({ 'real.yaml': 'a: 1\n' });
    symlinkSync('real.yaml', path.join(repo, 'link.yaml'));
    const ref = commit(repo, {}, 'add a link');
    const read = readFileAtRef(repo, ref, 'link.yaml');
    expect(read.kind).toBe('error');
    expect(read.kind === 'error' ? read.detail : '').toMatch(/not a regular file/);
  });

  it('answers error for a directory and for a submodule entry at the path', () => {
    const { repo } = baseAndHead({ 'dir/inner.yaml': 'a: 1\n' });
    const head = git(repo, ['rev-parse', 'HEAD']).trim();
    expect(readFileAtRef(repo, head, 'dir').kind).toBe('error');
    const withGitlink = commitEntry(repo, '160000', head, 'vendored');
    expect(readFileAtRef(repo, withGitlink, 'vendored').kind).toBe('error');
  });

  it('answers error when the tree lists a blob git does not have', () => {
    const { repo } = baseAndHead({ 'a.yaml': 'a: 1\n' });
    const missing = 'ab'.repeat(20);
    const ref = commitEntry(repo, '100644', missing, 'gone.yaml');
    const read = readFileAtRef(repo, ref, 'gone.yaml');
    expect(read.kind).toBe('error');
  });

  it('answers error, never absent, for a path below a symlinked or submodule directory', () => {
    const { repo } = baseAndHead({ 'realdir/a.yaml': 'a: 1\n' });
    symlinkSync('realdir', path.join(repo, 'linked'));
    const ref = commit(repo, {}, 'a linked directory');
    const linked = readFileAtRef(repo, ref, 'linked/a.yaml');
    expect(linked.kind).toBe('error');
    expect(linked.kind === 'error' ? linked.detail : '').toMatch(/linked is a symbolic link/);
    const withGitlink = commitEntry(repo, '160000', ref, 'vendored');
    const below = readFileAtRef(repo, withGitlink, 'vendored/a.yaml');
    expect(below.kind === 'error' ? below.detail : below.kind).toMatch(/vendored is a submodule/);
    expect(readFileAtRef(repo, ref, 'realdir/a.yaml')).toEqual({ kind: 'file', text: 'a: 1\n' });
    expect(readFileAtRef(repo, ref, 'nowhere/a.yaml')).toEqual({ kind: 'absent' });
  });

  it('answers error for a ref that does not resolve', () => {
    const { repo } = baseAndHead({ 'a.yaml': 'a: 1\n' });
    expect(readFileAtRef(repo, 'origin/nope', 'a.yaml').kind).toBe('error');
  });

  it('refuses a dash-leading ref inside the function, before git sees it', () => {
    const repo = emptyRepo();
    const base = commit(repo, { 'conductor.yml': 'a: 1\n' }, 'base');
    git(repo, ['update-ref', 'refs/tags/--output=pwned', base]);
    const read = readFileAtRef(repo, '--output=pwned', 'conductor.yml');
    expect(read.kind).toBe('error');
    expect(read.kind === 'error' ? read.detail : '').toMatch(/starts with "-"/);
    expect(readdirSync(repo)).not.toContain('pwned');
  });
});

describe('treeEntryAt keeps absent and error apart', () => {
  it('answers absent for a path the ref does not carry, and error for a ref that does not resolve', () => {
    const repo = emptyRepo();
    const base = commit(repo, { 'a.txt': 'a\n' }, 'base');
    expect(treeEntryAt(repo, base, 'b.txt')).toEqual({ kind: 'absent' });
    expect(treeEntryAt(repo, 'origin/nope', 'a.txt').kind).toBe('error');
    expect(treeEntryAt(repo, '--output=x', 'a.txt').kind).toBe('error');
    const entry = treeEntryAt(repo, base, 'a.txt');
    expect(entry.kind).toBe('entry');
  });
});

describe('every revision handed to git is ended with a double dash', () => {
  it('keeps the first-parent exception when the base carries a file named HEAD', () => {
    // HEAD is read as a revision whatever files the tree holds, so the
    // equal-tree exception for a merge whose first parent is the base holds.
    const repo = emptyRepo();
    const base = commit(repo, { '.guardrails.yaml': BASE_POLICY, HEAD: 'a file named HEAD\n' }, 'base');
    git(repo, ['checkout', '--quiet', '-b', 'feature']);
    commit(repo, { 'secret.txt': 'a-planted-secret-value\n' }, 'add a secret');
    removeAndCommit(repo, 'secret.txt', 'back it out');
    git(repo, ['checkout', '--quiet', 'main']);
    git(repo, ['merge', '--quiet', '--no-ff', '-m', 'merge feature', 'feature']);
    expect(refuseTrustBaseRef(repo, base)).toBeNull();
  });
});

describe('deciding whether the policy changed', () => {
  it('ignores formatting, so a reflow is not reported as a proposal', () => {
    const a = 'version: 1\ngates:\n  secrets:\n    product: vault-guard\n';
    const b = "version: 1\ngates: { secrets: { product: 'vault-guard' } }\n";

    expect(policyDiffers(a, b)).toBe(false);
  });

  it('reports a changed option even when nothing else moved', () => {
    const a = 'version: 1\ngates:\n  secrets:\n    product: vault-guard\n';
    const b =
      'version: 1\ngates:\n  secrets:\n    product: vault-guard\n    options:\n      fail-on: none\n';

    expect(policyDiffers(a, b)).toBe(true);
  });

  it('reports a policy that only one side has', () => {
    expect(policyDiffers('version: 1\n', null)).toBe(true);
    expect(policyDiffers(null, 'version: 1\n')).toBe(true);
    expect(policyDiffers(null, null)).toBe(false);
  });

  it('falls back to comparing text when a side will not parse, which fails closed', () => {
    // A head policy that is not YAML at all, or a symlink whose target string
    // arrives here instead of a document. Reporting it as changed is the safe
    // direction; the base ref's policy is what ran either way.
    expect(policyDiffers('version: 1\n', '\t: : not yaml\n  - [')).toBe(true);
  });
});

/**
 * Issue #58: defence in depth for the CLI. action.yml's validate step
 * refuses an explicit trust-base input outright on a pull_request event; this
 * is the CLI's own line, for anyone invoking it directly in CI and bypassing
 * that step. GITHUB_BASE_REF is Actions' own pull-request signal, and the
 * composite action itself always passes exactly origin/$GITHUB_BASE_REF, so
 * this only ever refuses a ref that disagrees with that.
 */
describe('refusing an explicit trust-base that disagrees with GITHUB_BASE_REF (issue #58)', () => {
  it('is a no-op when GITHUB_BASE_REF is not set: any resolvable ref is left alone', () => {
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['checkout', '--quiet', '-b', 'pr-branch']);
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'head');

    expect(refuseTrustBaseForPullRequest(repo, 'pr-branch', undefined)).toBeNull();
  });

  it('accepts a ref that resolves to the same commit as origin/<githubBaseRef>', () => {
    const repo = emptyRepo();
    const base = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['update-ref', 'refs/remotes/origin/main', base]);
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'head');

    expect(refuseTrustBaseForPullRequest(repo, 'origin/main', 'main')).toBeNull();
  });

  it('refuses a ref naming a different commit, naming both refs and both commits', () => {
    // This function IN ISOLATION, on the simplest shape that disagrees: a
    // linear branch, no merge involved. Note this is not yet the real #58
    // attack shape, because "pr-branch" here is HEAD's own commit, which
    // refuseTrustBaseRef ALREADY refuses on its own (same commit as HEAD).
    // The test below this one, "the real #58 shape", is the one where
    // refuseTrustBaseRef alone accepts the ref and this function is what
    // actually closes it.
    const repo = emptyRepo();
    const base = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['update-ref', 'refs/remotes/origin/main', base]);
    git(repo, ['checkout', '--quiet', '-b', 'pr-branch']);
    const head = commit(repo, { 'app.js': 'const x = 1;\n' }, 'the pull request');

    const refusal = refuseTrustBaseForPullRequest(repo, 'pr-branch', 'main');

    expect(refusal).toMatch(/trust base must be the base branch/);
    expect(refusal).toMatch(/"pr-branch"/);
    expect(refusal).toMatch(/origin\/main/);
    expect(refusal).toMatch(head.slice(0, 12));
    expect(refusal).toMatch(base.slice(0, 12));
  });

  it('refuses the real #58 shape: a moved base and a merge commit whose second parent is the pull request branch', () => {
    // HEAD is a merge commit, first parent the base, second parent the pull
    // request's own branch -- the shape GitHub's pull_request checkout
    // always uses -- but unlike equalTreeMergeRepo above, the base branch
    // has genuinely MOVED since the fork: it gained its own real commit
    // before the merge was built. That is what makes this the actual issue
    // #58 gap rather than a restatement of an existing refusal:
    //
    //  - the merge tree combines BOTH sides' changes, so it is identical to
    //    NEITHER parent's tree, and refuseTrustBaseRef's equal-tree check
    //    has nothing to catch;
    //  - the second parent (the pull request's own branch) is a different
    //    commit from HEAD, so the same-commit check has nothing to catch
    //    either.
    //
    // So on refuseTrustBaseRef ALONE -- today's code on main, with no #58
    // fix -- --trust-base naming the second parent is ACCEPTED: a same-repo
    // pull request really could set trust-base to its own branch, in its
    // own workflow file, exactly as the issue describes. Only
    // refuseTrustBaseForPullRequest closes it, by comparing against
    // origin/<githubBaseRef> rather than against HEAD at all.
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'fork point');
    git(repo, ['checkout', '--quiet', '-b', 'pr-branch']);
    const prBranchTip = commit(repo, { 'feature.js': 'const x = 1;\n' }, 'the pull request');
    git(repo, ['checkout', '--quiet', 'main']);
    const base = commit(repo, { 'base-only.txt': 'moved on\n' }, 'base moves on after the fork');
    git(repo, ['merge', '--quiet', '--no-ff', '-m', 'merge the pull request', 'pr-branch']);
    git(repo, ['update-ref', 'refs/remotes/origin/main', base]);

    // Confirms the gap: refuseTrustBaseRef by itself has nothing here.
    expect(refuseTrustBaseRef(repo, prBranchTip)).toBeNull();

    // refuseTrustBaseForPullRequest is what actually refuses it.
    const refusal = refuseTrustBaseForPullRequest(repo, prBranchTip, 'main');
    expect(refusal).toMatch(/trust base must be the base branch/);
    expect(refusal).toMatch(base.slice(0, 12));
    expect(refusal).toMatch(prBranchTip.slice(0, 12));
  });

  it('fails closed when origin/<githubBaseRef> itself does not resolve, naming it', () => {
    // Reachable on the default actions/checkout (fetch-depth: 1), which does
    // not carry the base branch at all. The README already asks for
    // fetch-depth: 0; this is not a reason to skip the comparison.
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['branch', 'pr-branch']);
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'head');

    const refusal = refuseTrustBaseForPullRequest(repo, 'pr-branch', 'nope');

    expect(refusal).toMatch(/origin\/nope/);
    expect(refusal).toMatch(/does not resolve to a commit/);
    expect(refusal).toMatch(/fetch-depth: 0/);
  });

  it('leaves an unresolvable given ref to refuseTrustBaseRef, rather than repeating its message', () => {
    const repo = emptyRepo();
    const base = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['update-ref', 'refs/remotes/origin/main', base]);

    expect(refuseTrustBaseForPullRequest(repo, 'origin/nope', 'main')).toBeNull();
    // refuseTrustBaseRef is the one that actually refuses this shape.
    expect(refuseTrustBaseRef(repo, 'origin/nope')).toMatch(/does not resolve to a commit/);
  });

  it('does not interfere with the equal-tree first-parent exception (issue #73)', () => {
    // The composite action always passes exactly origin/$GITHUB_BASE_REF, so
    // on an ordinary pull-request run the given ref and the expected ref are
    // the identical spelling and this returns null immediately, never
    // reaching -- let alone narrowing -- the equal-tree exception below.
    const { repo, base } = equalTreeMergeRepo();
    git(repo, ['update-ref', 'refs/remotes/origin/main', base]);

    expect(refuseTrustBaseForPullRequest(repo, 'origin/main', 'main')).toBeNull();
    expect(refuseTrustBaseRef(repo, 'origin/main')).toBeNull();
  });
});

/**
 * B1: a short name like origin/main is resolved by git with refs/tags/ BEFORE
 * refs/remotes/, so anyone who can push a tag named origin/main could choose
 * the commit the rules are read from, with no code from the pull request
 * running at all. Every ref the umbrella judges by is spelled in full, and a
 * short name that matches more than one kind of ref is refused.
 */
describe('a tag cannot shadow the trust base (B1)', () => {
  const PRIVATE = 'refs/conductor/trust-base';

  /** main is the real base; a tag named origin/main points at a permissive commit. */
  function shadowedRepo(): { repo: string; base: string; permissive: string } {
    const repo = emptyRepo();
    const base = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['update-ref', 'refs/remotes/origin/main', base]);
    git(repo, ['checkout', '--quiet', '-b', 'permissive']);
    const permissive = commit(repo, { '.guardrails.yaml': 'version: 1\ngates: {}\n' }, 'permissive');
    git(repo, ['tag', 'origin/main', permissive]);
    git(repo, ['checkout', '--quiet', 'main']);
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'head');
    return { repo, base, permissive };
  }

  it('refuses a short trust base that a tag shadows, for a local CLI user (no GITHUB_BASE_REF)', () => {
    const { repo } = shadowedRepo();
    const refusal = refuseTrustBaseRef(repo, 'origin/main');
    expect(refusal).toMatch(/ambiguous/);
    expect(refusal).toMatch(/refs\/tags\/origin\/main/);
    expect(refusal).toMatch(/refs\/remotes\/origin\/main/);
    // Spelled in full, the same commit is fine.
    expect(refuseTrustBaseRef(repo, 'refs/remotes/origin/main')).toBeNull();
  });

  it('refuses the shadowed short name on a pull request too, and never resolves it to the tag', () => {
    const { repo } = shadowedRepo();
    const refusal = refuseTrustBaseForPullRequest(repo, 'origin/main', 'main');
    expect(refusal).not.toBeNull();
    expect(refusal).toMatch(/ambiguous/);
  });

  it('compares origin/<base> spelled in full, so a tag of that name cannot stand in for it', () => {
    // An EXPLICIT trust base (private ref absent) is compared against the
    // fully spelled remote-tracking ref, which is the only reference there is.
    // Before the fix the expected side resolved through the tag, matched, and
    // the run trusted the permissive commit.
    const { repo, permissive } = shadowedRepo();
    const refusal = refuseTrustBaseForPullRequest(repo, 'refs/heads/permissive', 'main');
    expect(refusal).toMatch(/refs\/remotes\/origin\/main/);
    expect(refusal).toMatch(permissive.slice(0, 12));
    expect(refusal).toMatch(/something moved one of them/);
  });

  it('accepts the private ref when the base branch advanced between checkout and the private fetch (N2)', () => {
    // refs/remotes/origin/<base> is fixed at checkout time, the private ref is
    // fetched later; a merge in that window is benign. The private ref is the
    // authority and nothing reads refs/remotes/origin/<base> for trust, so no
    // comparison (and no false refusal).
    const repo = emptyRepo();
    const checkoutTime = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base at checkout');
    git(repo, ['update-ref', 'refs/remotes/origin/main', checkoutTime]);
    const advanced = commit(repo, { 'later.txt': 'merged meanwhile\n' }, 'base advanced');
    git(repo, ['update-ref', PRIVATE, advanced]);
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'head');

    expect(refuseTrustBaseForPullRequest(repo, PRIVATE, 'main')).toBeNull();
  });

  it('accepts the private ref when the same commit is in refs/remotes/origin/<base>', () => {
    const repo = emptyRepo();
    const base = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['update-ref', PRIVATE, base]);
    git(repo, ['update-ref', 'refs/remotes/origin/main', base]);
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'head');
    expect(refuseTrustBaseForPullRequest(repo, PRIVATE, 'main')).toBeNull();
  });

  it('accepts the private ref without comparison when refs/remotes/origin/<base> does not exist (depth-1 checkout), and nothing else', () => {
    const repo = emptyRepo();
    const base = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['update-ref', PRIVATE, base]);
    git(repo, ['branch', 'pr-branch']);
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'head');
    expect(refuseTrustBaseForPullRequest(repo, PRIVATE, 'main')).toBeNull();
    expect(refuseTrustBaseForPullRequest(repo, 'pr-branch', 'main')).toMatch(/does not resolve/);
  });
});

/**
 * B2: git resolves the string refs/conductor/trust-base through its DWIM
 * rules, which include refs/tags/<string>, so a TAG stored as
 * refs/tags/refs/conductor/trust-base resolved whenever the private ref was
 * absent. No ref NAME is trusted any more: the action passes a full commit
 * id, and a refs/ name is checked with show-ref (the exact ref) before it is
 * resolved.
 */
describe('a tag cannot become the trust base through ref name resolution (B2)', () => {
  const PRIVATE = 'refs/conductor/trust-base';

  function repoWithBaseAndTag(): { repo: string; base: string; other: string } {
    const repo = emptyRepo();
    const base = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['update-ref', 'refs/remotes/origin/main', base]);
    const other = commit(repo, { '.guardrails.yaml': 'version: 1\ngates: {}\n' }, 'permissive');
    // Stored as refs/tags/refs/conductor/trust-base: what a pushed tag named
    // refs/conductor/trust-base would be.
    git(repo, ['tag', PRIVATE, other]);
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'head');
    return { repo, base, other };
  }

  it('a full commit id is the object even when a branch is named like it', () => {
    const repo = emptyRepo();
    const first = commit(repo, { 'a.txt': 'a\n' }, 'first');
    const second = commit(repo, { 'b.txt': 'b\n' }, 'second');
    git(repo, ['update-ref', `refs/heads/${first}`, second]);
    expect(resolveRev(repo, first, 'commit')).toBe(first);
  });

  it('never resolves a refs/ name through a tag of that name: absent private ref means unresolvable', () => {
    const { repo } = repoWithBaseAndTag();
    expect(resolveRev(repo, PRIVATE, 'commit')).toBeNull();
    expect(refuseTrustBaseRef(repo, PRIVATE)).toMatch(/does not resolve to a commit/);
  });

  it('the CLI refuses a refs/conductor/trust-base that exists only as a tag, on a pull request too', () => {
    const { repo } = repoWithBaseAndTag();
    expect(refuseTrustBaseForPullRequest(repo, PRIVATE, 'main')).not.toBeNull();
  });

  it("accepts a full commit id equal to the private ref when it exists, and nothing else (N1)", () => {
    const repo = emptyRepo();
    const base = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['update-ref', PRIVATE, base]);
    const moved = commit(repo, { 'later.txt': 'x\n' }, 'base advanced');
    git(repo, ['update-ref', 'refs/remotes/origin/main', moved]);
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'head');
    expect(refuseTrustBaseForPullRequest(repo, base, 'main')).toBeNull();
    const head = git(repo, ['rev-parse', 'HEAD']).trim();
    const refusal = refuseTrustBaseForPullRequest(repo, head, 'main');
    expect(refusal).toMatch(head.slice(0, 12));
    expect(refusal).toMatch(/trust base must be the base branch/);
  });

  it('refuses a full commit id equal to a MOVED refs/remotes/origin/<base> when the private ref exists (N1)', () => {
    // Pull-request code can move the remote-tracking ref; once the private ref
    // (the authority) exists, an id that matches only the moved ref is the
    // attack, not a second acceptable answer.
    const repo = emptyRepo();
    const base = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['update-ref', PRIVATE, base]);
    const moved = commit(repo, { '.guardrails.yaml': 'version: 1\ngates: {}\n' }, 'permissive');
    git(repo, ['update-ref', 'refs/remotes/origin/main', moved]);
    const refusal = refuseTrustBaseForPullRequest(repo, moved, 'main');
    expect(refusal).not.toBeNull();
    expect(refusal).toMatch(/trust base must be the base branch/);
  });

  it('accepts a full commit id equal to refs/remotes/origin/<base> only when the private ref does not exist (N1)', () => {
    const repo = emptyRepo();
    const base = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['update-ref', 'refs/remotes/origin/main', base]);
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'head');
    expect(refuseTrustBaseForPullRequest(repo, base, 'main')).toBeNull();
  });

  it('refuses a full commit id when neither the private ref nor refs/remotes/origin/<base> exists, and when only a tag names it', () => {
    const { repo, other } = repoWithBaseAndTag();
    git(repo, ['update-ref', '-d', 'refs/remotes/origin/main']);
    expect(refuseTrustBaseForPullRequest(repo, other, 'main')).toMatch(/cannot verify/);
  });
});

describe('refuseAmbiguousRef sees through revision syntax (N3)', () => {
  it('refuses origin/main~0 and origin/main^{commit} when a tag shadows origin/main', () => {
    const repo = emptyRepo();
    const base = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['update-ref', 'refs/remotes/origin/main', base]);
    const other = commit(repo, { 'x.txt': 'x\n' }, 'other');
    git(repo, ['tag', 'origin/main', other]);
    for (const spelled of ['origin/main', 'origin/main~0', 'origin/main^{commit}', 'origin/main^0', 'origin/main@{0}']) {
      expect([spelled, refuseAmbiguousRef(repo, spelled)]).toEqual([
        spelled,
        expect.stringMatching(/ambiguous/),
      ]);
    }
    expect(refuseAmbiguousRef(repo, 'HEAD~1')).toBeNull();
  });

  it('refuses a name with a literal @ in it when a branch and a tag both carry it: git picks the tag (N3)', () => {
    const repo = emptyRepo();
    const base = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['branch', 'feature@x', base]);
    const other = commit(repo, { 'x.txt': 'x\n' }, 'other');
    git(repo, ['tag', 'feature@x', other]);
    // Cutting at every @ made this name "feature", which matches nothing.
    for (const spelled of ['feature@x', 'feature@x~1', 'feature@x^{commit}']) {
      expect([spelled, refuseAmbiguousRef(repo, spelled)]).toEqual([
        spelled,
        expect.stringMatching(/ambiguous.*feature@x/),
      ]);
    }
  });

  it('a bare @ is HEAD, and only @{ starts a reflog suffix (N3)', () => {
    const repo = emptyRepo();
    commit(repo, { 'a.txt': 'a\n' }, 'a');
    expect(refuseAmbiguousRef(repo, '@')).toBeNull();
    expect(refuseAmbiguousRef(repo, '@{1}')).toBeNull();
    expect(refuseAmbiguousRef(repo, '@~1')).toBeNull();
  });
});

describe('the version floor for handing a gate the flag', () => {
  it('accepts the version the flag arrived in and everything above it', () => {
    expect(atLeastVersion('1.4.0', '1.4.0')).toBe(true);
    expect(atLeastVersion('1.4.1', '1.4.0')).toBe(true);
    expect(atLeastVersion('2.0.0', '1.4.0')).toBe(true);
  });

  it('compares components numerically, so 1.10.0 is above 1.4.0', () => {
    // A string comparison puts "1.10.0" below "1.4.0" and would withhold the
    // flag from every build after the ninth minor.
    expect(atLeastVersion('1.10.0', '1.4.0')).toBe(true);
  });

  it('refuses a build below the floor', () => {
    expect(atLeastVersion('1.3.1', '1.4.0')).toBe(false);
    expect(atLeastVersion('0.9.9', '1.4.0')).toBe(false);
  });

  it('treats an unreadable version as below the floor', () => {
    // The safe direction: handing an older build a flag it does not parse
    // makes it exit non-zero with no JSON, which turns a working gate into a
    // could-not-run and a working repository's pull requests red.
    expect(atLeastVersion(null, '1.4.0')).toBe(false);
    expect(atLeastVersion('not a version', '1.4.0')).toBe(false);
    expect(atLeastVersion('1.4', '1.4.0')).toBe(false);
  });

  it('accepts a leading v, which is how some builds print it', () => {
    expect(atLeastVersion('v1.4.0', '1.4.0')).toBe(true);
  });
});

describe('a dash-leading trust base never reaches git as an option', () => {
  it('refuses it in both refusal functions, before any git call', () => {
    // Not a repository at all: any git call would fail differently, so a
    // refusal naming the dash proves the guard ran first.
    const notARepo = path.join(os.tmpdir(), 'conductor-no-such-repo');
    expect(refuseTrustBaseRef(notARepo, '--output=pwned')).toMatch(/starts with "-"/);
    expect(refuseTrustBaseForPullRequest(notARepo, '--output=pwned', 'main')).toMatch(
      /starts with "-"/
    );
  });

  it('refuses a tag named like an option that points at the base commit', () => {
    const repo = emptyRepo();
    const base = commit(repo, { 'conductor.yml': 'a: 1\n' }, 'base');
    git(repo, ['update-ref', 'refs/remotes/origin/main', base]);
    git(repo, ['update-ref', 'refs/tags/--output=pwned', base]);
    expect(refuseTrustBaseForPullRequest(repo, '--output=pwned', 'main')).toMatch(
      /starts with "-"/
    );
  });

  it('readFileAtRef with a dash-leading ref never writes a file', () => {
    const repo = emptyRepo();
    const base = commit(repo, { 'conductor.yml': 'a: 1\n' }, 'base');
    git(repo, ['update-ref', 'refs/tags/--output=pwned', base]);
    // git reads "--output=pwned:./conductor.yml" as --output=<that path>, so
    // the directory it would write into has to exist for the bug to show.
    const sink = path.join(repo, 'pwned:.');
    mkdirSync(sink);
    expect(readFileAtRef(repo, '--output=pwned', 'conductor.yml').kind).toBe('error');
    expect(readdirSync(sink)).toEqual([]);
  });

  it('resolveRev refuses a dash-leading revision inside the function', () => {
    const repo = emptyRepo();
    commit(repo, { 'a.txt': 'a\n' }, 'base');
    expect(resolveRev(repo, '--output=x', 'commit')).toBeNull();
    expect(readdirSync(repo)).not.toContain('x');
  });
});

describe('vetting a program spelled through a symlinked repository root', () => {
  /**
   * A repository at <real>/repo, where <real> is fully resolved, plus <via>,
   * a symlink to <real> made by the test itself. Built this way on every
   * platform, so the symlinked spelling exists whatever the temporary
   * directory looks like on the machine running it. The base and head both
   * carry vendor/real-gate unchanged; the head working tree adds an
   * untracked link at node_modules/.bin/vault-guard pointing at it.
   */
  function linkedRoot(): { realRepo: string; viaRepo: string; base: string } {
    const real = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'conductor-trust-real-')));
    temps.push(real);
    const holder = mkdtempSync(path.join(os.tmpdir(), 'conductor-trust-via-'));
    temps.push(holder);
    const via = path.join(holder, 'via');
    symlinkSync(real, via);
    const realRepo = path.join(real, 'repo');
    mkdirSync(path.join(realRepo, 'vendor'), { recursive: true });
    git(realRepo, ['init', '--quiet', '-b', 'main']);
    git(realRepo, ['config', 'user.email', 'test@example.com']);
    git(realRepo, ['config', 'user.name', 'Test']);
    const base = commit(realRepo, { 'vendor/real-gate': '#!/bin/sh\nexit 0\n' }, 'base');
    commit(realRepo, { 'app.js': 'const x = 1;\n' }, 'head');
    mkdirSync(path.join(realRepo, 'node_modules', '.bin'), { recursive: true });
    symlinkSync(path.join(realRepo, 'vendor', 'real-gate'), path.join(realRepo, 'node_modules', '.bin', 'vault-guard'));
    return { realRepo, viaRepo: path.join(via, 'repo'), base };
  }

  it('refuses the untracked link on its own entry, whichever spelling of the root it arrives in', () => {
    const { realRepo, viaRepo, base } = linkedRoot();
    for (const spelling of [viaRepo, realRepo]) {
      const refusal = refuseHeadControlledProgram(
        realRepo,
        base,
        path.join(spelling, 'node_modules', '.bin', 'vault-guard')
      );
      expect([spelling === viaRepo ? 'via' : 'real', refusal]).toEqual([
        spelling === viaRepo ? 'via' : 'real',
        expect.stringMatching(/does not track the gate program at node_modules\/\.bin\/vault-guard/),
      ]);
    }
  });
});
