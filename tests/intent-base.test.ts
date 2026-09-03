import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { changedPathsSince, resolveBaseRef } from '../src/intent-base.js';

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
