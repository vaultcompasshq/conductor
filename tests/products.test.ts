import { describe, expect, it } from '@jest/globals';

import { PRODUCTS } from '../src/policy.js';
import { NPM_VERSION_PATTERN, profileFor } from '../src/products.js';

describe('product profiles', () => {
  it('has a profile for every product', () => {
    for (const product of PRODUCTS) {
      expect(profileFor(product).product).toBe(product);
    }
  });

  it('keeps the three npm gates on the behaviour the runner had before profiles existed', () => {
    for (const product of ['dep-guard', 'vault-guard', 'intent-guard'] as const) {
      const p = profileFor(product);
      expect(p.managed).toBe(true);
      expect(p.output).toEqual({ kind: 'stdout' });
      expect(p.exit).toEqual({ clean: [0], blocked: [1], nothingToScan: [] });
      expect(p.timeoutMs).toBe(120_000);
      expect(p.configFile).toBeNull();
      // All three answer --version. intent-guard's per-command sibling does
      // not, and that is decided per candidate in resolve.ts, not here.
      expect(p.versionProbe).toEqual({ argv: ['--version'], pattern: NPM_VERSION_PATTERN });
    }
  });

  it('reads an npm gate version the way the runner always has: the whole first line, minus a leading v', () => {
    const match = NPM_VERSION_PATTERN.exec('v1.4.0-rc.1');
    expect(match?.[1] ?? match?.[0]).toBe('v1.4.0-rc.1');
    expect(NPM_VERSION_PATTERN.exec('usage: dep-guard')).toBeNull();
  });

  it('marks the two external tools as not managed, with their own output, exit and config rules', () => {
    const g = profileFor('gitleaks');
    expect(g.managed).toBe(false);
    expect(g.versionProbe).toEqual({ argv: ['version'], pattern: /(\d+\.\d+\.\d+)/ });
    expect(g.output).toEqual({ kind: 'report-file', flag: '--report-path', extension: '.json' });
    expect(g.exit).toEqual({ clean: [0], blocked: [3], nothingToScan: [] });
    expect(g.timeoutMs).toBe(600_000);
    expect(g.minVersion).toBe('8.19.0');
    expect(g.configFile).toBe('.gitleaks.toml');
    expect(g.neutralConfig).toBe('[extend]\nuseDefault = true\n');
    expect(g.ignoreFile).toEqual({ name: '.gitleaksignore', flag: '--gitleaks-ignore-path', alsoLoadedFromScanRoot: true });
    expect(profileFor('osv-scanner').ignoreFile).toBeNull();
    expect(g.remedy(true)).toMatch(/install gitleaks/i);
    expect(g.remedy(true)).not.toContain('npm install');

    const o = profileFor('osv-scanner');
    expect(o.managed).toBe(false);
    expect(o.versionProbe).toEqual({ argv: ['--version'], pattern: /(\d+\.\d+\.\d+)/ });
    expect(o.output).toEqual({ kind: 'stdout' });
    expect(o.exit).toEqual({ clean: [0], blocked: [1], nothingToScan: [128] });
    expect(o.timeoutMs).toBe(300_000);
    expect(o.minVersion).toBe('2.0.0');
    expect(o.configFile).toBe('osv-scanner.toml');
    expect(o.neutralConfig).toBe('');
    expect(o.remedy(false)).toMatch(/install osv-scanner/i);
    expect(o.stderrError).toBeNull();
  });

  it('reads a gitleaks ERR log line as an error and leaves its INF lines alone', () => {
    const pattern = profileFor('gitleaks').stderrError as RegExp;
    expect(pattern.test("6:36PM ERR [git] fatal: ambiguous argument 'origin/main..HEAD'")).toBe(true);
    expect(pattern.test('6:36PM INF 0 commits scanned.')).toBe(false);
    expect(pattern.test('6:36PM WRN leaks found: 1')).toBe(false);
    for (const product of ['dep-guard', 'vault-guard', 'intent-guard'] as const) {
      expect(profileFor(product).stderrError).toBeNull();
    }
  });

  it('names the npm install and the action input in the remedy for a managed product', () => {
    expect(profileFor('dep-guard').remedy(false)).toContain('npm install -g @vaultcompass/dep-guard');
    expect(profileFor('dep-guard').remedy(true)).toContain('dep-guard-version');
  });
});
