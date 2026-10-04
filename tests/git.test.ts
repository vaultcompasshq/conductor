// The git program conductor pins on a pull-request run.

import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createGitShim,
  gitOutside,
  pinGitOutside,
  removeGitShim,
  runGit,
  useGitProgram,
} from '../src/git.js';

const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const temps: string[] = [];
const savedPath = process.env.PATH;

afterEach(() => {
  useGitProgram('git');
  process.env.PATH = savedPath;
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'conductor-git-')));
  temps.push(dir);
  return dir;
}

function writeGit(dir: string, body: string): string {
  const file = path.join(dir, 'git');
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  return file;
}

describe('pinning git', () => {
  it('pins an absolute program, so a git that appears on PATH afterwards never runs', () => {
    const early = tempDir();
    const later = tempDir();
    const marker = path.join(tempDir(), 'planted-ran.txt');
    writeGit(later, `#!/bin/sh\nexec ${REAL_GIT} "$@"\n`);
    process.env.PATH = `${early}:${later}`;

    expect(pinGitOutside(process.env.PATH, [tempDir()])).toBe(path.join(later, 'git'));
    writeGit(early, `#!/bin/sh\necho ran >> ${JSON.stringify(marker)}\nexec ${REAL_GIT} "$@"\n`);
    const result = runGit(later, ['--version']);

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  it('skips a git whose real path is inside the excluded work tree, including through a symlink', () => {
    const repo = tempDir();
    const inside = path.join(repo, 'tools');
    mkdirSync(inside);
    writeGit(inside, '#!/bin/sh\nexit 0\n');
    const linkDir = tempDir();
    execFileSync('ln', ['-s', path.join(inside, 'git'), path.join(linkDir, 'git')]);
    const outside = tempDir();
    writeGit(outside, '#!/bin/sh\nexit 0\n');

    expect(gitOutside(`${inside}:${linkDir}:${outside}`, [repo])).toBe(path.join(outside, 'git'));
    expect(gitOutside(`${inside}:${linkDir}`, [repo])).toBeNull();
  });
});

describe('the private git directory', () => {
  it('holds exactly one entry, git, linked to the pinned program, in a directory only its owner can enter', () => {
    const tmp = tempDir();
    const repo = tempDir();

    const dir = createGitShim(REAL_GIT, tmp, [repo], 'darwin') as string;

    expect(path.dirname(dir)).toBe(tmp);
    expect(readdirSync(dir)).toEqual(['git']);
    expect(readlinkSync(path.join(dir, 'git'))).toBe(REAL_GIT);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    removeGitShim(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it('refuses a temp directory inside the repository, saying what to set', () => {
    const repo = tempDir();
    const inside = path.join(repo, 'tmp');
    mkdirSync(inside);

    expect(() => createGitShim(REAL_GIT, inside, [repo], 'linux')).toThrow(
      /is inside the repository being judged.*Set TMPDIR/
    );
    expect(readdirSync(inside)).toEqual([]);
  });

  it('refuses, saying why and what to set, when the directory cannot be created', () => {
    const missing = path.join(tempDir(), 'does-not-exist');

    expect(() => createGitShim(REAL_GIT, missing, [tempDir()], 'linux')).toThrow(
      /could not create the private git directory.*Set TMPDIR/
    );
  });

  it('makes nothing on Windows, where the gates look git up through the cleaned PATH', () => {
    const tmp = tempDir();

    expect(createGitShim(REAL_GIT, tmp, [tempDir()], 'win32')).toBeNull();
    expect(readdirSync(tmp)).toEqual([]);
  });
});
