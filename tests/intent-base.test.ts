import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { changedPathsSince, resolveBaseRef, resolveBaseRefInRepo } from '../src/intent-base.js';

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
    const { root, headMinusOne } = twoCommitBranch();
    git(root, ['tag', 'origin/main', headMinusOne]);

    const resolved = resolveBaseRefInRepo(root, { env });

    expect(resolved).toEqual({ ok: true, base: { ref: 'refs/remotes/origin/main', source: 'github' } });
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
      base: { ref: PRIVATE, source: 'github' },
    });
  });

  it('uses the private ref, without a refusal, when both exist and differ: the base advanced after checkout (N2)', () => {
    const { root, headMinusOne } = twoCommitBranch();
    git(root, ['update-ref', PRIVATE, headMinusOne]);
    expect(resolveBaseRefInRepo(root, { env })).toEqual({
      ok: true,
      base: { ref: PRIVATE, source: 'github' },
    });
  });

  it('accepts both when they name the same commit', () => {
    const { root, base } = twoCommitBranch();
    git(root, ['update-ref', PRIVATE, base]);
    expect(resolveBaseRefInRepo(root, { env })).toEqual({
      ok: true,
      base: { ref: PRIVATE, source: 'github' },
    });
  });

  it('with neither present, hands back the spelled remote ref so the diff fails closed naming fetch-depth: 0', () => {
    const { root } = twoCommitBranch();
    git(root, ['update-ref', '-d', 'refs/remotes/origin/main']);
    const resolved = resolveBaseRefInRepo(root, { env });
    expect(resolved).toEqual({ ok: true, base: { ref: 'refs/remotes/origin/main', source: 'github' } });
    if (!resolved.ok || resolved.base === null) throw new Error('unreachable');
    const changed = changedPathsSince(root, resolved.base.ref);
    expect(changed.ok).toBe(false);
    if (changed.ok) throw new Error('unreachable');
    expect(changed.detail).toMatch(/fetch-depth: 0/);
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
    expect(resolveBaseRefInRepo(root, { base: 'HEAD~1', env })).toEqual({
      ok: true,
      base: { ref: 'HEAD~1', source: 'flag' },
    });
  });

  it('is null outside a pull request', () => {
    const { root } = twoCommitBranch();
    expect(resolveBaseRefInRepo(root, { env: {} })).toEqual({ ok: true, base: null });
  });
});

describe('changedPathsSince', () => {
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

  it('hands over names with a quote, a backslash, a tab and a newline byte for byte, never C-quoted (N3)', () => {
    // Without -z git prints "secrets/a\"b.txt" with quotes and backslash
    // escapes; the gate was then handed a path that names no file, and
    // intent-guard refuses any explicit path with a backslash, so every pull
    // request touching such a name was permanently could-not-run.
    const root = repoWithMain();
    git(root, ['checkout', '--quiet', '-b', 'feat/odd-names']);
    const names = [
      'secrets/a"b.txt',
      'src/back\\slash.ts',
      'src/tab\there.ts',
      'src/new\nline.ts',
    ];
    for (const name of names) {
      write(root, name, 'export const x = 1;\n');
    }
    commit(root, 'odd names');

    expect(changedPathsSince(root, 'main')).toEqual({ ok: true, paths: [...names].sort() });
  });

  it('fails closed on a path containing a comma, naming the path', () => {
    // The only shape intent-guard's --paths accepts is comma-joined, so a
    // comma in a filename splits one path into two: a phantom entry that can
    // be reported outside allowed_paths, and a real path that silently stops
    // being checked against a protected one. Refusing to answer is the only
    // honest option, because both halves of that failure are invisible.
    const root = repoWithMain();
    git(root, ['checkout', '--quiet', '-b', 'feat/commas']);
    write(root, 'src/a,b.ts', 'export const ab = 1;\n');
    commit(root, 'comma');

    const changed = changedPathsSince(root, 'main');

    expect(changed.ok).toBe(false);
    expect(changed.ok === false && changed.detail).toContain('src/a,b.ts');
    expect(changed.ok === false && changed.detail).toMatch(/comma/);
  });

  it('fails closed on a path with leading whitespace, naming the path', () => {
    const root = repoWithMain();
    git(root, ['checkout', '--quiet', '-b', 'feat/leading']);
    write(root, ' leading.ts', 'export const l = 1;\n');
    commit(root, 'leading space');

    const changed = changedPathsSince(root, 'main');

    expect(changed.ok).toBe(false);
    expect(changed.ok === false && changed.detail).toContain('leading.ts');
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
