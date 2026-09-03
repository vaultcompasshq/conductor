import { describe, expect, it } from '@jest/globals';

import {
  GATE_ROLES,
  GATE_STAGES,
  POLICY_FILE_NAME,
  applyCliOverrides,
  enabledGates,
  parsePolicy,
  renderOptionFlags,
  runsAtStage,
} from '../src/policy.js';

const MINIMAL = `version: 1
gates:
  dependencies:
    product: dep-guard
    enabled: true
  secrets:
    product: vault-guard
    enabled: false
  intent:
    product: intent-guard
    enabled: true
`;

describe('policy file', () => {
  it('names the file .guardrails.yaml', () => {
    expect(POLICY_FILE_NAME).toBe('.guardrails.yaml');
  });

  it('keys gates by role, not by product', () => {
    expect(GATE_ROLES).toEqual(['dependencies', 'secrets', 'intent']);
  });

  it('parses a minimal policy and keeps the declared enabled flags', () => {
    const policy = parsePolicy(MINIMAL, POLICY_FILE_NAME);
    expect(policy.gates.dependencies?.product).toBe('dep-guard');
    expect(policy.gates.dependencies?.enabled).toBe(true);
    expect(policy.gates.secrets?.enabled).toBe(false);
    expect(policy.gates.intent?.product).toBe('intent-guard');
  });

  it('defaults the report format to text and options to an empty bag', () => {
    const policy = parsePolicy(MINIMAL, POLICY_FILE_NAME);
    expect(policy.report.format).toBe('text');
    expect(policy.gates.dependencies?.options).toEqual({});
  });

  it('defaults enabled to true when the key is omitted', () => {
    const policy = parsePolicy(
      'version: 1\ngates:\n  secrets:\n    product: vault-guard\n',
      POLICY_FILE_NAME
    );
    expect(policy.gates.secrets?.enabled).toBe(true);
  });

  it('defaults each gate stage by role: the cheap two at commit, intent at ci', () => {
    const policy = parsePolicy(MINIMAL, POLICY_FILE_NAME);
    expect(policy.gates.dependencies?.stage).toBe('commit');
    expect(policy.gates.secrets?.stage).toBe('commit');
    // The intent gate is the only one with per-task ceremony behind it, so
    // its natural stopping point is a pull request rather than a commit.
    expect(policy.gates.intent?.stage).toBe('ci');
  });

  it('keeps an explicit stage over the role default', () => {
    const policy = parsePolicy(
      'version: 1\ngates:\n  intent:\n    product: intent-guard\n    stage: commit\n  secrets:\n    product: vault-guard\n    stage: push\n',
      POLICY_FILE_NAME
    );
    expect(policy.gates.intent?.stage).toBe('commit');
    expect(policy.gates.secrets?.stage).toBe('push');
  });

  it('rejects a stage that is not one of the three', () => {
    expect(() =>
      parsePolicy(
        'version: 1\ngates:\n  secrets:\n    product: vault-guard\n    stage: nightly\n',
        POLICY_FILE_NAME
      )
    ).toThrow(/stage/);
  });

  it('defaults enforce to true, so a gate blocks unless the file says otherwise', () => {
    const policy = parsePolicy(MINIMAL, POLICY_FILE_NAME);
    expect(policy.gates.dependencies?.enforce).toBe(true);
    expect(policy.gates.intent?.enforce).toBe(true);
  });

  it('keeps an explicit enforce: false', () => {
    const policy = parsePolicy(
      'version: 1\ngates:\n  intent:\n    product: intent-guard\n    enforce: false\n',
      POLICY_FILE_NAME
    );
    expect(policy.gates.intent?.enforce).toBe(false);
  });

  it('rejects an enforce that is not a boolean, rather than reading a string as true', () => {
    // "enforce: maybe" reading as enforced would be the safe direction, and
    // "enforce: no" reading as enforced would be the surprising one. Neither
    // is worth guessing at.
    expect(() =>
      parsePolicy(
        'version: 1\ngates:\n  secrets:\n    product: vault-guard\n    enforce: maybe\n',
        POLICY_FILE_NAME
      )
    ).toThrow(/enforce/);
  });

  it('rejects an unknown gate role', () => {
    expect(() =>
      parsePolicy('version: 1\ngates:\n  tests:\n    product: dep-guard\n', POLICY_FILE_NAME)
    ).toThrow(/tests/);
  });

  it('rejects a product that does not belong to the role', () => {
    expect(() =>
      parsePolicy('version: 1\ngates:\n  secrets:\n    product: dep-guard\n', POLICY_FILE_NAME)
    ).toThrow(/secrets/);
  });

  it('rejects an unknown top-level key rather than ignoring it', () => {
    expect(() => parsePolicy(`${MINIMAL}baseline: true\n`, POLICY_FILE_NAME)).toThrow(/baseline/);
  });

  it('rejects a top-level shared severity threshold, which the draft calls a trap', () => {
    expect(() => parsePolicy(`${MINIMAL}failOn: high\n`, POLICY_FILE_NAME)).toThrow(/failOn/);
  });

  it('rejects a version it does not know', () => {
    expect(() =>
      parsePolicy('version: 2\ngates:\n  secrets:\n    product: vault-guard\n', POLICY_FILE_NAME)
    ).toThrow(/version/);
  });

  it('rejects a non-absolute command override', () => {
    expect(() =>
      parsePolicy(
        'version: 1\ngates:\n  secrets:\n    product: vault-guard\n    command: vault-guard\n',
        POLICY_FILE_NAME
      )
    ).toThrow(/absolute/);
  });

  it('accepts an absolute command override with an explicit argv prefix', () => {
    const policy = parsePolicy(
      'version: 1\ngates:\n  intent:\n    product: intent-guard\n    command: /opt/build/intent-guard.js\n    args: [check]\n',
      POLICY_FILE_NAME
    );
    expect(policy.gates.intent?.command).toBe('/opt/build/intent-guard.js');
    expect(policy.gates.intent?.args).toEqual(['check']);
  });
});

describe('per-gate option passthrough', () => {
  it('keeps each gate threshold in its own passthrough block', () => {
    const policy = parsePolicy(
      'version: 1\ngates:\n  dependencies:\n    product: dep-guard\n    options:\n      fail-on: high\n  secrets:\n    product: vault-guard\n    options:\n      fail-on: low\n',
      POLICY_FILE_NAME
    );
    expect(policy.gates.dependencies?.options).toEqual({ 'fail-on': 'high' });
    expect(policy.gates.secrets?.options).toEqual({ 'fail-on': 'low' });
  });

  it('renders option keys as the gate own flag spellings, unchanged', () => {
    expect(renderOptionFlags({ 'fail-on': 'high' })).toEqual(['--fail-on', 'high']);
    expect(renderOptionFlags({ online: true })).toEqual(['--online']);
    expect(renderOptionFlags({ 'require-frozen': false })).toEqual(['--no-require-frozen']);
    expect(renderOptionFlags({ 'max-size': 12 })).toEqual(['--max-size', '12']);
  });

  it('renders an array option once per value', () => {
    expect(renderOptionFlags({ ignore: ['a', 'b'] })).toEqual(['--ignore', 'a', '--ignore', 'b']);
  });

  it('renders options in a deterministic order regardless of file order', () => {
    const first = renderOptionFlags({ zeta: '1', alpha: '2' });
    const second = renderOptionFlags({ alpha: '2', zeta: '1' });
    expect(first).toEqual(second);
  });

  it('rejects an option key that is not a flag spelling', () => {
    expect(() =>
      parsePolicy(
        'version: 1\ngates:\n  secrets:\n    product: vault-guard\n    options:\n      "--fail-on": high\n',
        POLICY_FILE_NAME
      )
    ).toThrow(/fail-on/);
  });

  it('rejects an option the umbrella itself owns, rather than letting it fight the wrapper', () => {
    expect(() =>
      parsePolicy(
        'version: 1\ngates:\n  secrets:\n    product: vault-guard\n    options:\n      format: text\n',
        POLICY_FILE_NAME
      )
    ).toThrow(/reserved/);
    expect(() =>
      parsePolicy(
        'version: 1\ngates:\n  intent:\n    product: intent-guard\n    options:\n      json: true\n',
        POLICY_FILE_NAME
      )
    ).toThrow(/reserved/);
  });
});

describe('stages are cumulative', () => {
  it('runs a gate at its own stage', () => {
    expect(runsAtStage('commit', 'commit')).toBe(true);
    expect(runsAtStage('push', 'push')).toBe(true);
    expect(runsAtStage('ci', 'ci')).toBe(true);
  });

  it('runs an earlier gate at every later stage', () => {
    expect(runsAtStage('commit', 'push')).toBe(true);
    expect(runsAtStage('commit', 'ci')).toBe(true);
    expect(runsAtStage('push', 'ci')).toBe(true);
  });

  it('does not run a later gate at an earlier stage', () => {
    expect(runsAtStage('ci', 'commit')).toBe(false);
    expect(runsAtStage('ci', 'push')).toBe(false);
    expect(runsAtStage('push', 'commit')).toBe(false);
  });

  it('names the three stages in order, earliest first', () => {
    expect(GATE_STAGES).toEqual(['commit', 'push', 'ci']);
  });
});

describe('precedence', () => {
  it('leaves the gate own config file alone, so layer one is untouched by construction', () => {
    const policy = parsePolicy(MINIMAL, POLICY_FILE_NAME);
    // The policy carries no path to any product config file: there is
    // nothing here that could write one.
    expect(JSON.stringify(policy)).not.toMatch(/\.dep-guard\.json|\.vault-guard\.json|\.conductor/);
  });

  it('lets an umbrella command-line gate selection override the policy enabled flags', () => {
    const policy = parsePolicy(MINIMAL, POLICY_FILE_NAME);
    const narrowed = applyCliOverrides(policy, { gates: ['secrets'] });
    expect(enabledGates(narrowed).map((gate) => gate.role)).toEqual(['secrets']);
  });

  it('returns enabled gates in role order, not file order', () => {
    const policy = parsePolicy(
      'version: 1\ngates:\n  intent:\n    product: intent-guard\n  dependencies:\n    product: dep-guard\n',
      POLICY_FILE_NAME
    );
    expect(enabledGates(policy).map((gate) => gate.role)).toEqual(['dependencies', 'intent']);
  });

  it('rejects a command-line gate selection naming a role the policy does not declare', () => {
    const policy = parsePolicy(
      'version: 1\ngates:\n  secrets:\n    product: vault-guard\n',
      POLICY_FILE_NAME
    );
    expect(() => applyCliOverrides(policy, { gates: ['intent'] })).toThrow(/intent/);
  });
});
