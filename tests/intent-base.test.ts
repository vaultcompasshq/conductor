import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { useGitProgram } from '../src/git.js';
import {
  changedPathsSince,
  orderForPathsFlag,
  pathsFlagRefusal,
  resolveBaseRef,
  resolveBaseRefInRepo,
} from '../src/intent-base.js';

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-base-'));
  temps.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function commit(cwd: string, message: string): void {
  git(cwd, ['add', '-A']);
  git(cwd, [
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'user.name=test',
    'commit',
    '--quiet',
    '-m',
    message,
  ]);
}

function write(root: string, relative: string, body: string): void {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** A repository with one commit on main and nothing else. */
function repoWithMain(): string {
  const root = tempDir();
  git(root, ['init', '--quiet', '-b', 'main']);
  write(root, 'src/base.ts', 'export const base = 1;\n');
  commit(root, 'base');
  return root;
}

describe('resolveBaseRef', () => {
  it('takes --base when it is given', () => {
    expect(resolveBaseRef({ base: 'origin/develop', env: {} })).toEqual({
      ref: 'origin/develop',
      source: 'flag',
    });
  });

  it('defaults to origin/<GITHUB_BASE_REF> in a pull request build', () => {
    expect(resolveBaseRef({ env: { GITHUB_BASE_REF: 'main' } })).toEqual({
      ref: 'origin/main',
      source: 'github',
    });
  });

  it('lets --base win over GITHUB_BASE_REF', () => {
    expect(resolveBaseRef({ base: 'HEAD~3', env: { GITHUB_BASE_REF: 'main' } })).toEqual({
      ref: 'HEAD~3',
      source: 'flag',
    });
  });

  it('resolves to nothing when neither is present, which is the v0.1 run', () => {
    expect(resolveBaseRef({ env: {} })).toBeNull();
  });

  it('ignores an empty GITHUB_BASE_REF, which is what a push build sets', () => {
    // Actions defines the variable and leaves it empty outside a pull
    // request. "origin/" is not a ref, and it would fail the run closed on
    // every push build.
    expect(resolveBaseRef({ env: { GITHUB_BASE_REF: '' } })).toBeNull();
  });
});

/**
 * The tag-shadow class (B1) for the intent gate's own base: a short
 * origin/<base> resolves through refs/tags/ first, so a tag of that name at
 * HEAD~1 would narrow the change set to the last commit.
 */
describe('resolveBaseRefInRepo: fully spelled, never shadowable', () => {
  const PRIVATE = 'refs/conductor/trust-base';

  /** main is the base (also refs/remotes/origin/main); feat has two commits. */
  function twoCommitBranch(): { root: string; base: string; headMinusOne: string } {
    const root = repoWithMain();
    const base = git(root, ['rev-parse', 'HEAD']).trim();
    git(root, ['update-ref', 'refs/remotes/origin/main', base]);
    git(root, ['checkout', '--quiet', '-b', 'feat/x']);
    write(root, 'src/one.ts', 'export const one = 1;\n');
    commit(root, 'first');
    const headMinusOne = git(root, ['rev-parse', 'HEAD']).trim();
    write(root, 'src/two.ts', 'export const two = 2;\n');
    commit(root, 'second');
    return { root, base, headMinusOne };
  }
  const env = { GITHUB_BASE_REF: 'main' };

  it('a tag origin/main at HEAD~1 no longer narrows the change set', () => {
    const { root, base, headMinusOne } = twoCommitBranch();
    git(root, ['tag', 'origin/main', headMinusOne]);

    const resolved = resolveBaseRefInRepo(root, { env });

    // The commit id, read from the exact ref with show-ref: no name is ever
    // handed to git's name resolution, so the tag has nothing to shadow.
    expect(resolved).toEqual({ ok: true, base: { ref: base, source: 'github' } });
    if (!resolved.ok || resolved.base === null) throw new Error('unreachable');
    expect(changedPathsSince(root, resolved.base.ref)).toEqual({
      ok: true,
      paths: ['src/one.ts', 'src/two.ts'],
    });
  });

  it('uses refs/conductor/trust-base when it is the only one present', () => {
    const { root, base } = twoCommitBranch();
    git(root, ['update-ref', '-d', 'refs/remotes/origin/main']);
    git(root, ['update-ref', PRIVATE, base]);
    expect(resolveBaseRefInRepo(root, { env })).toEqual({
      ok: true,
      base: { ref: base, source: 'github' },
    });
  });

  it('uses the private ref, without a refusal, when both exist and differ: the base advanced after checkout (N2)', () => {
    const { root, headMinusOne } = twoCommitBranch();
    git(root, ['update-ref', PRIVATE, headMinusOne]);
    expect(resolveBaseRefInRepo(root, { env })).toEqual({
      ok: true,
      base: { ref: headMinusOne, source: 'github' },
    });
  });

  it('accepts both when they name the same commit', () => {
    const { root, base } = twoCommitBranch();
    git(root, ['update-ref', PRIVATE, base]);
    expect(resolveBaseRefInRepo(root, { env })).toEqual({
      ok: true,
      base: { ref: base, source: 'github' },
    });
  });

  it('a TAG named refs/conductor/trust-base is not the private ref (B2)', () => {
    const { root, base, headMinusOne } = twoCommitBranch();
    git(root, ['tag', PRIVATE, headMinusOne]);
    // No private ref: the remote-tracking ref is used, never the tag.
    expect(resolveBaseRefInRepo(root, { env })).toEqual({
      ok: true,
      base: { ref: base, source: 'github' },
    });
    // And with no remote-tracking ref either, nothing resolves: refused.
    git(root, ['update-ref', '-d', 'refs/remotes/origin/main']);
    const refused = resolveBaseRefInRepo(root, { env });
    expect(refused.ok).toBe(false);
  });

  it('with neither present, refuses, naming fetch-depth: 0', () => {
    const { root } = twoCommitBranch();
    git(root, ['update-ref', '-d', 'refs/remotes/origin/main']);
    const resolved = resolveBaseRefInRepo(root, { env });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error('unreachable');
    expect(resolved.detail).toMatch(/fetch-depth: 0/);
    expect(resolved.detail).toContain('refs/conductor/trust-base');
  });

  it('refuses an explicit --base that a tag shadows, and keeps an unambiguous explicit one', () => {
    const { root, headMinusOne } = twoCommitBranch();
    git(root, ['tag', 'origin/main', headMinusOne]);
    const refused = resolveBaseRefInRepo(root, { base: 'origin/main', env });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('unreachable');
    expect(refused.detail).toMatch(/ambiguous/);
    expect(refused.detail).toContain('as the intent gate base');
    expect(resolveBaseRefInRepo(root, { base: 'refs/remotes/origin/main', env })).toEqual({
      ok: true,
      base: { ref: 'refs/remotes/origin/main', source: 'flag' },
    });
    // An explicit refs/ name that does not exist as that exact ref (a tag of
    // that name does not count) is refused, never resolved by name.
    git(root, ['tag', 'refs/conductor/nothing', headMinusOne]);
    expect(resolveBaseRefInRepo(root, { base: 'refs/conductor/nothing', env }).ok).toBe(false);
    expect(resolveBaseRefInRepo(root, { base: 'HEAD~1', env })).toEqual({
      ok: true,
      base: { ref: 'HEAD~1', source: 'flag' },
    });
  });

  it('is null outside a pull request', () => {
    const { root } = twoCommitBranch();
    expect(resolveBaseRefInRepo(root, { env: {} })).toEqual({ ok: true, base: null });
  });

  it('refuses an explicit --base that starts with a dash: it is an option, not a ref (N2)', () => {
    const { root } = twoCommitBranch();
    for (const base of ['--output=/x', '-p', '--no-index']) {
      const refused = resolveBaseRefInRepo(root, { base, env });
      expect([base, refused.ok]).toEqual([base, false]);
      if (refused.ok) throw new Error('unreachable');
      expect(refused.detail).toContain(`"${base}"`);
      expect(refused.detail).toMatch(/starts with a dash/);
      expect(refused.detail).toMatch(/Nothing was checked/);
    }
  });
});

describe('changedPathsSince', () => {
  it('never lets a base that looks like an option reach git as one: no file is written and the run fails closed (N2)', () => {
    // Before the fix "--output=<file>...HEAD" was git diff's own --output
    // option: it wrote that file and printed nothing, so the change set was
    // empty and the intent gate judged nothing. The check in
    // resolveBaseRefInRepo is the first line; the refusal inside
    // changedPathsSince is the second, proven here by calling it directly.
    const root = repoWithMain();
    const target = path.join(tempDir(), 'injected.txt');
    const changed = changedPathsSince(root, `--output=${target}`);
    expect(changed.ok).toBe(false);
    if (changed.ok) throw new Error('unreachable');
    expect(changed.detail).toMatch(/starts with a dash/);
    expect(existsSync(target)).toBe(false);
  });

  it('lists the change when the working tree holds a file named like the range', () => {
    // The range is always read as a range, whatever the working tree holds.
    const root = repoWithMain();
    const base = git(root, ['rev-parse', 'HEAD']).trim();
    git(root, ['checkout', '--quiet', '-b', 'feat/range']);
    write(root, 'src/widget/cache.ts', 'export const cache = 1;\n');
    write(root, `${base}...HEAD`, 'a file named like the range\n');
    commit(root, 'branch work');
    const changed = changedPathsSince(root, base);
    expect(changed.ok).toBe(true);
    if (!changed.ok) throw new Error('unreachable');
    expect(changed.paths).toContain('src/widget/cache.ts');
  });

  it('lists what the branch changed and not what landed on the base afterwards', () => {
    // The three-dot form. Two-dot would attribute a commit somebody else
    // merged into main after this branch forked to this branch's author,
    // and a budget with max_files would fail on somebody else's work.
    const root = repoWithMain();
    git(root, ['checkout', '--quiet', '-b', 'feat/widget']);
    write(root, 'src/widget/cache.ts', 'export const cache = 1;\n');
    commit(root, 'branch work');

    git(root, ['checkout', '--quiet', 'main']);
    write(root, 'src/unrelated.ts', 'export const other = 1;\n');
    commit(root, 'later work on main');
    git(root, ['checkout', '--quiet', 'feat/widget']);

    const changed = changedPathsSince(root, 'main');

    expect(changed).toEqual({ ok: true, paths: ['src/widget/cache.ts'] });
  });

  it('lists both sides of a rename, because a move out of a protected path still counts', () => {
    const root = repoWithMain();
    git(root, ['checkout', '--quiet', '-b', 'feat/move']);
    renameSync(path.join(root, 'src', 'base.ts'), path.join(root, 'src', 'moved.ts'));
    commit(root, 'move it');

    const changed = changedPathsSince(root, 'main');

    expect(changed).toEqual({ ok: true, paths: ['src/base.ts', 'src/moved.ts'] });
  });

  it('lists an unquoted path for a file name that git would otherwise escape', () => {
    // core.quotePath=false. Without it git prints "src/caf\303\251.ts" with
    // the quotes as part of the line, and the gate is handed a path that
    // matches no glob and no file.
    const root = repoWithMain();
    git(root, ['checkout', '--quiet', '-b', 'feat/accents']);
    write(root, 'src/café.ts', 'export const cafe = 1;\n');
    commit(root, 'accented');

    const changed = changedPathsSince(root, 'main');

    expect(changed).toEqual({ ok: true, paths: ['src/café.ts'] });
  });

  it('keeps a space in the middle of a path, which is an ordinary filename', () => {
    const root = repoWithMain();
    git(root, ['checkout', '--quiet', '-b', 'feat/spaces']);
    write(root, 'src/my widget.ts', 'export const w = 1;\n');
    commit(root, 'spaced');

    expect(changedPathsSince(root, 'main')).toEqual({ ok: true, paths: ['src/my widget.ts'] });
  });

  it('hands over names with a quote, a tab and a newline byte for byte, never C-quoted (N3)', () => {
    // Without -z git prints "secrets/a\"b.txt" with quotes and escapes; the
    // gate was then handed a path that names no file. intent-guard splits
    // --paths on commas only, so a tab or newline inside a name is intact.
    const root = repoWithMain();
    git(root, ['checkout', '--quiet', '-b', 'feat/odd-names']);
    const names = ['secrets/a"b.txt', 'src/tab\there.ts', 'src/new\nline.ts'];
    for (const name of names) {
      write(root, name, 'export const x = 1;\n');
    }
    commit(root, 'odd names');

    expect(changedPathsSince(root, 'main')).toEqual({ ok: true, paths: [...names].sort() });
  });

  it('lists a path with a backslash as it is, and names it as one --paths cannot carry', () => {
    const root = repoWithMain();
    git(root, ['checkout', '--quiet', '-b', 'feat/backslash']);
    write(root, 'src/back\\slash.ts', 'export const x = 1;\n');
    commit(root, 'backslash');

    const changed = changedPathsSince(root, 'main');

    expect(changed).toEqual({ ok: true, paths: ['src/back\\slash.ts'] });
    expect(pathsFlagRefusal(['src/back\\slash.ts'])).toMatch(/"src\/back\\slash\.ts" contains a backslash/);
  });

  it('lists a path with a comma as it is, and names it as one --paths cannot carry', () => {
    // --paths is comma-joined, so a comma in a filename would split one path
    // into two: a phantom entry and a real path that silently stops being
    // checked. Where --paths is the only channel that is refused; where the
    // gate reads the change set from git itself the path is judged.
    const root = repoWithMain();
    git(root, ['checkout', '--quiet', '-b', 'feat/commas']);
    write(root, 'src/a,b.ts', 'export const ab = 1;\n');
    commit(root, 'comma');

    const changed = changedPathsSince(root, 'main');

    expect(changed).toEqual({ ok: true, paths: ['src/a,b.ts'] });
    expect(pathsFlagRefusal(['src/a,b.ts'])).toMatch(/"src\/a,b\.ts" contains a comma/);
  });

  it('lists a path with leading whitespace as it is, and names it as one --paths cannot carry', () => {
    const root = repoWithMain();
    git(root, ['checkout', '--quiet', '-b', 'feat/leading']);
    write(root, ' leading.ts', 'export const l = 1;\n');
    commit(root, 'leading space');

    const changed = changedPathsSince(root, 'main');

    expect(changed).toEqual({ ok: true, paths: [' leading.ts'] });
    expect(pathsFlagRefusal([' leading.ts'])).toMatch(/leading or trailing whitespace/);
  });

  it('reports an empty change set as an empty list rather than as a failure', () => {
    const root = repoWithMain();
    git(root, ['checkout', '--quiet', '-b', 'feat/nothing']);

    expect(changedPathsSince(root, 'main')).toEqual({ ok: true, paths: [] });
  });

  it('fails naming the ref when the base cannot be resolved', () => {
    // Fail-closed. There is no fallback to an empty path set, because an
    // empty path set is what a passing gate looks like.
    const root = repoWithMain();

    const changed = changedPathsSince(root, 'origin/does-not-exist');

    expect(changed.ok).toBe(false);
    expect(changed.ok === false && changed.detail).toMatch(/origin\/does-not-exist/);
  });

  it('does not double the full stop when git own message already ends in one', () => {
    const root = repoWithMain();

    const changed = changedPathsSince(root, 'origin/does-not-exist');

    // Two dots then a space. Not two dots on their own: the three-dot range
    // is in this message too, and it is spelled correctly.
    expect(changed.ok === false && changed.detail).not.toMatch(/\.\.\s/);
  });

  it('fails when the directory is not a git repository at all', () => {
    const changed = changedPathsSince(tempDir(), 'main');

    expect(changed.ok).toBe(false);
  });
});

describe('an unreadable private ref is never taken for an absent one', () => {
  const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

  /** A git that fails, as git does on a read it cannot make, for the private ref only. */
  function failingPrivateRefGit(): string {
    const bin = tempDir();
    const file = path.join(bin, 'git');
    writeFileSync(
      file,
      [
        '#!/bin/sh',
        'case "$*" in',
        '  *"show-ref --verify --quiet refs/conductor/trust-base"*) echo "fatal: cannot read refs/conductor/trust-base" >&2; exit 128 ;;',
        'esac',
        `exec ${REAL_GIT} "$@"`,
        '',
      ].join('\n'),
      { mode: 0o755 }
    );
    return file;
  }

  function prBranch(): string {
    const root = repoWithMain();
    git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    git(root, ['checkout', '--quiet', '-b', 'feat/x']);
    write(root, 'src/one.ts', 'export const one = 1;\n');
    commit(root, 'first');
    return root;
  }

  it('refuses, naming the ref, instead of falling back to refs/remotes/origin/<base>', () => {
    const root = prBranch();
    useGitProgram(failingPrivateRefGit());
    try {
      const resolved = resolveBaseRefInRepo(root, { env: { GITHUB_BASE_REF: 'main' } });
      expect(resolved.ok).toBe(false);
      if (resolved.ok) throw new Error('unreachable');
      expect(resolved.detail).toMatch(/^the base branch could not be read: cannot read refs\/conductor\/trust-base/);
      expect(resolved.detail).toMatch(/nothing was checked\. Fix: check that git can read the repository/);
    } finally {
      useGitProgram('git');
    }
  });

  it('still falls back to refs/remotes/origin/<base> when the private ref is simply absent', () => {
    const root = prBranch();
    const remote = git(root, ['rev-parse', 'refs/remotes/origin/main']).trim();
    expect(resolveBaseRefInRepo(root, { env: { GITHUB_BASE_REF: 'main' } })).toEqual({
      ok: true,
      base: { ref: remote, source: 'github' },
    });
  });
});

describe('a moved submodule pointer', () => {
  it('is listed even when .gitmodules says ignore = all', () => {
    const root = repoWithMain();
    write(root, '.gitmodules', '[submodule "lib"]\n\tpath = vendor/lib\n\turl = ./lib\n\tignore = all\n');
    git(root, ['add', '.gitmodules']);
    git(root, ['update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},vendor/lib`]);
    // Committed straight from the index: "git add -A" would drop a gitlink
    // with no checkout behind it.
    git(root, ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'base with an ignored submodule']);
    const base = git(root, ['rev-parse', 'HEAD']).trim();
    git(root, ['checkout', '--quiet', '-b', 'feat/bump']);
    git(root, ['update-index', '--cacheinfo', `160000,${'2'.repeat(40)},vendor/lib`]);
    git(root, ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'move the pointer']);

    const changed = changedPathsSince(root, base);

    expect(changed).toEqual({ ok: true, paths: ['vendor/lib'] });
  });
});

describe('the --paths list', () => {
  it('leaves the order alone unless the first path starts with a dash', () => {
    expect(orderForPathsFlag(['a.ts', '-b.md'])).toEqual(['a.ts', '-b.md']);
    expect(orderForPathsFlag(['-b.md', '-c.md', 'a.ts', 'd.ts'])).toEqual(['a.ts', '-b.md', '-c.md', 'd.ts']);
    expect(orderForPathsFlag(['-b.md'])).toEqual(['-b.md']);
    expect(orderForPathsFlag([])).toEqual([]);
  });

  it('refuses a dash-leading change set only when every path starts with a dash', () => {
    expect(pathsFlagRefusal(['-b.md', 'a.ts'])).toBeNull();
    expect(pathsFlagRefusal(['-b.md', '-c.md'])).toMatch(/every changed path starts with "-"/);
    expect(pathsFlagRefusal([])).toBeNull();
  });
});

describe('the intent base refusals lead with what happened, then the fix', () => {
  it('says the base branch is not in the repository, then names the fix', () => {
    const root = tempDir();
    git(root, ['init', '--quiet', '-b', 'main']);
    writeFileSync(path.join(root, 'a.txt'), 'a\n');
    commit(root, 'one');

    const resolved = resolveBaseRefInRepo(root, { env: { GITHUB_BASE_REF: 'main' } });

    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error('unreachable');
    expect(resolved.detail).toMatch(/^the base branch is not in this repository: neither refs\/conductor\/trust-base/);
    expect(resolved.detail).toMatch(/Fix: in CI, check out with fetch-depth: 0, or fetch the base ref before the run\.$/);
  });

  it('says the trust base names no commit, then names the fix', () => {
    const root = repoWithMain();

    const resolved = resolveBaseRefInRepo(root, { env: {}, trustBase: 'origin/nope' });

    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error('unreachable');
    expect(resolved.detail).toMatch(/^the trust base does not resolve to a commit: "origin\/nope"/);
    expect(resolved.detail).toMatch(/Fix: pass a trust base that is a commit in this checkout/);
  });

  it('says git could not resolve the range, then names the fix', () => {
    const changed = changedPathsSince(tempDir(), 'main');

    expect(changed.ok).toBe(false);
    if (changed.ok) throw new Error('unreachable');
    expect(changed.detail).toMatch(/^git could not resolve "main\.\.\.HEAD"/);
    expect(changed.detail).toMatch(/Fix: check out with fetch-depth: 0, or fetch the base ref before the run\.$/);
  });
});
