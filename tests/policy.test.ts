import { describe, expect, it } from '@jest/globals';

import { gateArgs } from '../src/gate-runner.js';
import {
  GATE_ROLES,
  GATE_STAGES,
  POLICY_FILE_NAME,
  PRODUCT_FOR_ROLE,
  RESERVED_OPTIONS,
  applyCliOverrides,
  enabledGates,
  parsePolicy,
  renderOptionFlags,
  runsAtStage,
} from '../src/policy.js';
import type { GatePolicy, GateRole, Product } from '../src/policy.js';

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

  it('rejects base on the intent gate, naming the key rather than failing in CI', () => {
    // The umbrella works the changed-path set out itself and passes --paths,
    // because --project may be a temporary directory with no repository in
    // it. A policy that also sets base sends intent-guard looking for git
    // THERE, and every run exits 2 blaming git for a policy line. dep-guard
    // has reserved base since v0.1 for the same reason.
    expect(() =>
      parsePolicy(
        'version: 1\ngates:\n  intent:\n    product: intent-guard\n    options:\n      base: main\n',
        POLICY_FILE_NAME
      )
    ).toThrow(/base/);
    expect(() =>
      parsePolicy(
        'version: 1\ngates:\n  intent:\n    product: intent-guard\n    options:\n      base: main\n',
        POLICY_FILE_NAME
      )
    ).toThrow(/reserved/);
  });

  it('explains base on the intent gate for the reason it is actually rejected', () => {
    // The generic sentence says the umbrella passes that flag itself, and for
    // this one key that is not true: it passes --paths instead, and --base
    // would be resolved against a project directory holding no repository.
    // A message that gives the wrong reason sends somebody to the wrong fix.
    expect(() =>
      parsePolicy(
        'version: 1\ngates:\n  intent:\n    product: intent-guard\n    options:\n      base: main\n',
        POLICY_FILE_NAME
      )
    ).toThrow(/--paths/);
  });

  it('explains format on the secrets gate as the short flag the umbrella actually writes', () => {
    // The generic sentence says the umbrella passes that flag itself. For
    // this key it passes the SHORT form, -f, so a reader told "the umbrella
    // passes --format" goes looking for a --format in the command line and
    // does not find one. Same class of wrong reason as base on the intent
    // gate, and the same fix: say which flag, so the collision is visible.
    expect(() =>
      parsePolicy(
        'version: 1\ngates:\n  secrets:\n    product: vault-guard\n    options:\n      format: text\n',
        POLICY_FILE_NAME
      )
    ).toThrow(/-f/);
  });

  it('explains base on the dependencies gate as the flag it fights rather than one the umbrella writes', () => {
    // The umbrella passes --staged to dep-guard and never --base. The key is
    // still reserved, because a policy-supplied base would fight the --staged
    // the umbrella writes, but the generic sentence gives the wrong reason.
    expect(() =>
      parsePolicy(
        'version: 1\ngates:\n  dependencies:\n    product: dep-guard\n    options:\n      base: main\n',
        POLICY_FILE_NAME
      )
    ).toThrow(/--staged/);
  });
});

/**
 * The drift guard the two hand-maintained lists never had.
 *
 * RESERVED_OPTIONS describes what gateArgs writes, and until now nothing held
 * the two together. The dangerous direction is a flag added to gateArgs and
 * forgotten in RESERVED_OPTIONS: a policy file could then write the same flag
 * a second time, and which one won would depend on that gate's own argument
 * parser rather than on anything the user could read in their own policy file.
 *
 * Derived from gateArgs rather than restated, so this is not a third copy of
 * the list. The one thing that cannot be derived is the other direction: a
 * few keys are reserved WITHOUT the umbrella writing them, each for its own
 * reason, so those are named here and each one has to be justified rather
 * than accumulating quietly.
 */
describe('the reserved option list against the flags the umbrella writes', () => {
  /** Every flag gateArgs can emit for a role, over the shapes of run there are. */
  function flagsWritten(role: GateRole): Set<string> {
    const gate: GatePolicy = {
      role,
      product: PRODUCT_FOR_ROLE[role],
      enabled: true,
      stage: 'commit',
      enforce: true,
      excludedByCli: false,
      options: {},
    };
    const intent = {
      projectDir: '/tmp/prepared',
      paths: ['a.ts'],
      contractSource: { kind: 'native' as const, path: '.conductor/intent-contract.yaml' },
      baseRef: 'main',
      baseSource: 'flag' as const,
      cleanup: () => {},
    };
    const runs = [
      gateArgs(gate, true, undefined),
      gateArgs(gate, false, undefined),
      gateArgs(gate, true, intent),
      gateArgs(gate, false, { ...intent, paths: null }),
    ];
    const flags = new Set<string>();
    for (const argv of runs) {
      for (const token of argv) {
        if (token.startsWith('-')) {
          flags.add(token.replace(/^--?/, ''));
        }
      }
    }
    return flags;
  }

  /**
   * Keys reserved although the umbrella writes no such flag. Each needs a
   * reason that is not "the umbrella writes it", and each has one in the
   * message parsePolicy raises.
   */
  const RESERVED_WITHOUT_WRITING: Record<Product, string[]> = {
    // The umbrella passes --staged. A policy-supplied base would fight it.
    'dep-guard': ['base'],
    // The umbrella writes the same option under its short name, -f.
    'vault-guard': ['format'],
    // The umbrella passes --paths, and a --base would be resolved against a
    // --project that may be a temporary directory with no repository in it.
    'intent-guard': ['base'],
  };

  it('reserves every flag the umbrella writes, which is the direction that can hurt', () => {
    for (const role of GATE_ROLES) {
      const product = PRODUCT_FOR_ROLE[role];
      const reserved = new Set(RESERVED_OPTIONS[product]);
      const unreserved = [...flagsWritten(role)].filter((flag) => !reserved.has(flag)).sort();
      expect({ product, unreserved }).toEqual({ product, unreserved: [] });
    }
  });

  it('reserves nothing else without a stated reason', () => {
    for (const role of GATE_ROLES) {
      const product = PRODUCT_FOR_ROLE[role];
      const written = flagsWritten(role);
      const extra = RESERVED_OPTIONS[product].filter((key) => !written.has(key)).sort();
      expect({ product, extra }).toEqual({
        product,
        extra: [...RESERVED_WITHOUT_WRITING[product]].sort(),
      });
    }
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

  it('marks the gates --gate switched off, so a later report can name them', () => {
    // A gate --gate left out is neither deferred nor skipped, and without a
    // mark on it nothing downstream can tell it apart from a gate the policy
    // file itself switched off. An uploaded log from a --gate run would then
    // be indistinguishable from a full one, which is the confusion the
    // deferred notification exists to prevent.
    const policy = parsePolicy(MINIMAL, POLICY_FILE_NAME);
    const narrowed = applyCliOverrides(policy, { gates: ['dependencies'] });

    expect(narrowed.gates.intent?.excludedByCli).toBe(true);
    expect(narrowed.gates.dependencies?.excludedByCli).toBe(false);
  });

  it('does not mark a gate the policy file had already switched off', () => {
    // MINIMAL declares secrets with enabled: false. --gate did not turn that
    // off, so naming it as excluded would report the user's own decision back
    // to them as something the command line did.
    const policy = parsePolicy(MINIMAL, POLICY_FILE_NAME);
    const narrowed = applyCliOverrides(policy, { gates: ['dependencies'] });

    expect(narrowed.gates.secrets?.excludedByCli).toBe(false);
  });

  it('marks nothing when no --gate was given', () => {
    const policy = applyCliOverrides(parsePolicy(MINIMAL, POLICY_FILE_NAME), {});
    for (const role of GATE_ROLES) {
      expect(policy.gates[role]?.excludedByCli ?? false).toBe(false);
    }
  });

  it('rejects a command-line gate selection naming a role the policy does not declare', () => {
    const policy = parsePolicy(
      'version: 1\ngates:\n  secrets:\n    product: vault-guard\n',
      POLICY_FILE_NAME
    );
    expect(() => applyCliOverrides(policy, { gates: ['intent'] })).toThrow(/intent/);
  });
});
