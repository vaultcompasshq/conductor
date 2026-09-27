import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { stubGate } from './helpers/stub-gate.js';

describe('stubGate for external tools', () => {
  it('answers a version subcommand with a custom line', () => {
    const bin = mkdtempSync(path.join(tmpdir(), 'stub-'));
    const cmd = stubGate(bin, 'gitleaks', { versionSubcommand: true, versionLine: '8.30.1', exit: 0, stdout: '' });
    const out = spawnSync(cmd, ['version'], { encoding: 'utf8' });
    expect(out.stdout.trim()).toBe('8.30.1');
  });

  it('answers --version with the custom line too', () => {
    const bin = mkdtempSync(path.join(tmpdir(), 'stub-'));
    const cmd = stubGate(bin, 'osv-scanner', { versionLine: 'osv-scanner version: 2.6.0', exit: 0 });
    const out = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    expect(out.stdout.trim()).toBe('osv-scanner version: 2.6.0');
  });

  it('writes the report body to the path after the report flag and exits with the chosen code', () => {
    const bin = mkdtempSync(path.join(tmpdir(), 'stub-'));
    const report = path.join(bin, 'out.json');
    const cmd = stubGate(bin, 'gitleaks', { reportFlag: '--report-path', reportBody: '[{"RuleID":"x"}]', exit: 3, stdout: '' });
    const out = spawnSync(cmd, ['git', '--report-path', report, '.'], { encoding: 'utf8' });
    expect(out.status).toBe(3);
    expect(readFileSync(report, 'utf8')).toBe('[{"RuleID":"x"}]');
  });
});
