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

  it('names the npm install and the action input in the remedy for a managed product', () => {
    expect(profileFor('dep-guard').remedy(false)).toContain('npm install -g @vaultcompass/dep-guard');
    expect(profileFor('dep-guard').remedy(true)).toContain('dep-guard-version');
  });
});
