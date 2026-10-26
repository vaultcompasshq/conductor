import { describe, expect, it } from '@jest/globals';
import { diffPolicies, policyChangeLine, previewPolicy, previewRoles } from '../src/policy-diff.js';
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
  it('escapes characters outside printable ASCII so the line is printable ASCII', () => {
    const head = parsePolicy(
      'version: 1\ngates:\n  dependencies:\n    product: dep-guard\n    options:\n      fail-on: "a\\u202Eb\\u200Bc"\n',
      'head'
    );
    const line = diffPolicies(BASE, head).map(policyChangeLine)[0] as string;
    expect(line).toMatch(/^[\x20-\x7e]+$/);
    expect(line).toContain('\\u202e');
    expect(line).toContain('\\u200b');
  });
  it('never cuts through an escape sequence when truncating', () => {
    const long = `${'a'.repeat(75)}\u202e${'b'.repeat(10)}`;
    const line = policyChangeLine({ role: null, key: 'x', old: long, new: 1 });
    expect(line).toBe(`policy: x ${JSON.stringify('a'.repeat(75)).slice(0, -1)}... -> 1`);
  });
  it('does not read an inherited property as an option value', () => {
    const base = parsePolicy(
      'version: 1\ngates:\n  dependencies:\n    product: dep-guard\n    options:\n      constructor: 1\n',
      'base'
    );
    expect(diffPolicies(base, BASE).map(policyChangeLine)).toEqual([
      'policy: gates.dependencies.options.constructor 1 -> (absent)',
    ]);
  });
});

describe('the preview policy', () => {
  const ONLY = (role: string, product: string) =>
    parsePolicy(`version: 1\ngates:\n  ${role}:\n    product: ${product}\n`, 'only').gates;
  it('takes only enabled, stage and enforce from the head', () => {
    const base = parsePolicy('version: 1\ngates:\n  vulnerabilities:\n    product: osv-scanner\n    enabled: false\n    timeout-seconds: 60\n', 'b');
    const head = parsePolicy('version: 1\ngates:\n  vulnerabilities:\n    product: osv-scanner\n    stage: ci\n    enforce: false\n    timeout-seconds: 21600\n    options:\n      call-analysis: all\n      output: /x/y\n  secrets:\n    product: vault-guard\n    enforce: false\n    command: /x/evil\n    args: [a]\n    options:\n      fail-on: none\n', 'h');
    const preview = previewPolicy(base, head, ['vulnerabilities', 'secrets']);
    expect(preview.gates.vulnerabilities).toEqual({ ...base.gates.vulnerabilities, enabled: true, stage: 'ci', enforce: false });
    expect(preview.gates.secrets).toEqual({ ...ONLY('secrets', 'vault-guard').secrets, enforce: false });
    // A second head-only role, pinned literally: parsePolicy's own defaults,
    // presentOnBase 'block' included, and nothing else from the head.
    const vulnHead = parsePolicy('version: 1\ngates:\n  vulnerabilities:\n    product: osv-scanner\n    stage: push\n    timeout-seconds: 21600\n    present-on-base: report\n    options:\n      call-analysis: all\n', 'h2');
    expect(previewPolicy(BASE, vulnHead, ['vulnerabilities']).gates.vulnerabilities).toEqual({
      role: 'vulnerabilities', product: 'osv-scanner', enabled: true, stage: 'push', enforce: true,
      excludedByCli: false, options: {}, presentOnBase: 'block',
    });
  });
  it('holds only the previewed roles, and previews a removed role as disabled', () => {
    const base = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\n  secrets:\n    product: vault-guard\n', 'b');
    const head = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\n', 'h');
    const preview = previewPolicy(base, head, ['secrets']);
    expect(Object.keys(preview.gates)).toEqual(['secrets']);
    expect(preview.gates.secrets).toEqual({ ...base.gates.secrets, enabled: false });
    expect(preview.report).toEqual(base.report);
  });
  it('previews only a role with an enabled or stage change', () => {
    expect(previewRoles([
      { role: 'dependencies', key: 'enforce', old: true, new: false },
      { role: 'dependencies', key: 'command', old: undefined, new: '/x' },
      { role: 'secrets', key: 'options.fail-on', old: undefined, new: 'none' },
      { role: null, key: 'report.format', old: 'text', new: 'sarif' },
    ])).toEqual([]);
    expect(previewRoles([
      { role: 'secrets', key: 'stage', old: 'commit', new: 'ci' },
      { role: 'secrets', key: 'enabled', old: false, new: true },
      { role: 'dependencies', key: 'enabled', old: false, new: true },
    ])).toEqual(['dependencies', 'secrets']);
    const head = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\n  secrets-history:\n    product: gitleaks\n', 'h');
    expect(previewRoles(diffPolicies(BASE, head))).toEqual(['secrets-history']);
  });
});
