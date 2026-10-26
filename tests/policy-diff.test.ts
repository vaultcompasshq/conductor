import { describe, expect, it } from '@jest/globals';
import { diffPolicies, policyChangeLine } from '../src/policy-diff.js';
import { parsePolicy } from '../src/policy.js';

const BASE = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\n', 'base');

describe('diffPolicies', () => {
  it('names gate, key, old and new value for an option', () => {
    const head = parsePolicy(
      'version: 1\ngates:\n  dependencies:\n    product: dep-guard\n    options:\n      fail-on: none\n',
      'head'
    );
    expect(diffPolicies(BASE, head).map(policyChangeLine)).toEqual([
      'policy: gates.dependencies.options.fail-on (absent) -> "none"',
    ]);
  });
  it('reports a gate switched off as one enabled change', () => {
    const head = parsePolicy(
      'version: 1\ngates:\n  dependencies:\n    product: dep-guard\n    enabled: false\n',
      'head'
    );
    expect(diffPolicies(BASE, head).map(policyChangeLine)).toEqual([
      'policy: gates.dependencies.enabled true -> false',
    ]);
  });
  it('reports nothing when the head only spells out defaults', () => {
    const head = parsePolicy(
      'version: 1\ngates:\n  dependencies:\n    product: dep-guard\n    enabled: true\n    enforce: true\n',
      'head'
    );
    expect(diffPolicies(BASE, head)).toEqual([]);
  });
  it('reports report.format with no role', () => {
    const head = parsePolicy(
      'version: 1\ngates:\n  dependencies:\n    product: dep-guard\nreport:\n  format: sarif\n',
      'head'
    );
    expect(diffPolicies(BASE, head)).toEqual([
      { role: null, key: 'report.format', old: 'text', new: 'sarif' },
    ]);
  });
  it('says the changes are not known when the head does not parse', () => {
    expect(diffPolicies(BASE, null).map(policyChangeLine)).toEqual([
      'policy: the head .guardrails.yaml is absent or does not parse, so its changes are not known',
    ]);
  });
  it('gives one change per present key for a role on one side only', () => {
    const head = parsePolicy(
      'version: 1\ngates:\n  dependencies:\n    product: dep-guard\n  secrets:\n    product: vault-guard\n',
      'head'
    );
    expect(diffPolicies(BASE, head).map((c) => c.key)).toEqual([
      'product',
      'enabled',
      'stage',
      'enforce',
    ]);
  });
  it('cuts a long value to 80 characters', () => {
    const long = 'a'.repeat(100);
    const line = policyChangeLine({ role: null, key: 'x', old: long, new: 1 });
    expect(line).toBe(`policy: x ${JSON.stringify(long).slice(0, 77)}... -> 1`);
  });
});
