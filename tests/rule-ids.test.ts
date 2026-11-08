import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULE_IDS } from '../src/rule-ids.js';
import { escapeNonAscii as fromEscape } from '../src/escape.js';
import { escapeNonAscii as fromPolicyDiff } from '../src/policy-diff.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('the rule-id registry', () => {
  it('lists every id once', () => {
    const ids = RULE_IDS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  const sources = (): Array<[string, string]> =>
    readdirSync(SRC)
      .filter((name) => name.endsWith('.ts') && name !== 'rule-ids.ts')
      .map((name) => [name, readFileSync(path.join(SRC, name), 'utf8')]);
  const registered = (): Set<string> => new Set(RULE_IDS.map((entry) => entry.id));

  it('holds every umbrella rule id literal written anywhere under src, in any quote style', () => {
    const written = new Set<string>();
    for (const [, source] of sources()) {
      for (const match of source.matchAll(/(['"`])((?:conductor|intent-guard)\/[a-z0-9.-]+)\1/g)) {
        written.add(match[2]);
      }
    }
    const known = registered();
    expect([...written].filter((id) => !known.has(id)).sort()).toEqual([]);
  });

  it('builds no id from a fixed namespace and a runtime suffix, which the scan could not read', () => {
    const hidden: string[] = [];
    for (const [name, source] of sources()) {
      for (const match of source.matchAll(/`(?:conductor|intent-guard)\/\$\{/g)) {
        hidden.push(`${name}:${match.index}`);
      }
    }
    expect(hidden).toEqual([]);
  });

  it('holds every id built as the gate product plus a fixed suffix (only intent gates reach these)', () => {
    const written = new Set<string>();
    for (const [, source] of sources()) {
      for (const match of source.matchAll(/`\$\{[\w.]*product\}\/([a-z0-9-]+)`/g)) {
        written.add(`intent-guard/${match[1]}`);
      }
    }
    expect(written.size).toBeGreaterThan(0);
    const known = registered();
    expect([...written].filter((id) => !known.has(id)).sort()).toEqual([]);
  });

  it('holds every skip reason, which becomes the second half of an id', () => {
    const runtimeSuffixes: string[] = [];
    for (const [, source] of sources()) {
      for (const match of source.matchAll(/`\$\{[\w.]*product\}\/\$\{([\w.]+)\}`/g)) {
        runtimeSuffixes.push(match[1]);
      }
    }
    // The only id with a runtime suffix is the prepared skip, on SkippedGate.reason.
    expect(runtimeSuffixes).toEqual(['gate.reason']);
    const run = readFileSync(path.join(SRC, 'run.ts'), 'utf8');
    const union = /export interface SkippedGate \{[\s\S]*?\n  reason: ([^;]+);/.exec(run);
    expect(union).not.toBeNull();
    const reasons = [...union![1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThan(0);
    const known = registered();
    expect(reasons.map((r) => `intent-guard/${r}`).filter((id) => !known.has(id))).toEqual([]);
  });

  it('keeps the osv coverage ids at their published values', () => {
    const byId = new Map(RULE_IDS.map((entry) => [entry.id, entry.class]));
    expect(byId.get('conductor/requirements-direct-only')).toBe('diagnostic');
    expect(byId.get('conductor/requirements-not-pinned')).toBe('diagnostic');
    expect(byId.get('conductor/requirements-not-scanned')).toBe('diagnostic');
    expect(byId.get('conductor/lockfile-no-longer-scanned')).toBe('diagnostic');
  });
});

describe('escapeNonAscii', () => {
  it('is the same function from its own module and from the policy diff re-export', () => {
    expect(fromPolicyDiff).toBe(fromEscape);
    expect(fromEscape('a‮b')).toBe('a\\u202eb');
  });
});
