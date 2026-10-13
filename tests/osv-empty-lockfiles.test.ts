// Which handed lockfiles osv-scanner read no packages from, out of a run that
// read packages from others (audit finding F2, 2026-10-12).
//
// osv-scanner 2.x exits 128 only when EVERY handed file parsed to nothing,
// and its JSON lists only sources with findings, so a lockfile rewritten to
// {} beside a healthy one used to be listed as scanned with no word said.
// The per-file count comes from the one line osv-scanner 2.4.0 prints to
// stderr per extracted file at its default verbosity, measured:
//
//   Scanned /abs/path/package-lock.json file and found 0 packages
//   Scanned /abs/path/requirements.txt file and found 1 package

import { describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { emptiedLockfiles } from '../src/osv-coverage.js';

function withRepo(files: string[], body: (root: string) => void): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'conductor-osv-empty-'));
  try {
    for (const file of files) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), '{}\n');
    }
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('emptiedLockfiles', () => {
  it('names a handed file osv-scanner found 0 packages in, and not one it found packages in', () => {
    withRepo(['package-lock.json', 'requirements.txt'], (root) => {
      const real = realpathSync(root);
      const stderr =
        'Starting filesystem walk for root: /\n' +
        `Scanned ${real}/package-lock.json file and found 0 packages\n` +
        `Scanned ${real}/requirements.txt file and found 1 package\n` +
        'End status: 0 dirs visited, 2 inodes visited, 2 Extract calls, 3.6ms elapsed, 3.6ms wall time\n';
      expect(emptiedLockfiles(stderr, ['package-lock.json', 'requirements.txt'], root)).toEqual([
        'package-lock.json',
      ]);
    });
  });

  it('matches the path whether osv-scanner printed it resolved or as handed', () => {
    withRepo(['web/yarn.lock'], (root) => {
      const stderr = `Scanned ${path.join(root, 'web/yarn.lock')} file and found 0 packages\n`;
      expect(emptiedLockfiles(stderr, ['web/yarn.lock'], root)).toEqual(['web/yarn.lock']);
    });
  });

  it('never confuses two files with the same base name in different directories', () => {
    withRepo(['package-lock.json', 'web/package-lock.json'], (root) => {
      const real = realpathSync(root);
      const stderr =
        `Scanned ${real}/web/package-lock.json file and found 0 packages\n` +
        `Scanned ${real}/package-lock.json file and found 12 packages\n`;
      expect(emptiedLockfiles(stderr, ['package-lock.json', 'web/package-lock.json'], root)).toEqual([
        'web/package-lock.json',
      ]);
    });
  });

  it('names nothing when every file had packages, or when no count line was printed', () => {
    withRepo(['go.mod'], (root) => {
      const real = realpathSync(root);
      expect(emptiedLockfiles(`Scanned ${real}/go.mod file and found 2 packages\n`, ['go.mod'], root)).toEqual([]);
      expect(emptiedLockfiles('', ['go.mod'], root)).toEqual([]);
    });
  });

  it('ignores a count line for a file that was not handed over', () => {
    withRepo(['package-lock.json'], (root) => {
      const real = realpathSync(root);
      const stderr = `Scanned ${real}/other/package-lock.json file and found 0 packages\n`;
      expect(emptiedLockfiles(stderr, ['package-lock.json'], root)).toEqual([]);
    });
  });
});
