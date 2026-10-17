import { describe, expect, it } from '@jest/globals';

import { renderPolicy } from '../src/init-policy.js';
import { POLICY_FILE_NAME, parsePolicy } from '../src/policy.js';
import type { GateRole } from '../src/policy.js';

describe('the init template and timeout-seconds', () => {
  const ALL: GateRole[] = ['dependencies', 'secrets', 'intent', 'secrets-history', 'vulnerabilities'];

  it('writes no timeout-seconds key, so every gate keeps the product default', () => {
    const text = renderPolicy(new Set(ALL), null);
    expect(text).not.toMatch(/^\s*timeout-seconds:/m);
    const policy = parsePolicy(text, POLICY_FILE_NAME);
    for (const role of ALL) {
      expect(policy.gates[role]).not.toHaveProperty('timeoutSeconds');
    }
  });

  it('names the key in two comment lines under the secrets-history gate only', () => {
    const text = renderPolicy(new Set(ALL), null);
    const comment =
      '    # A full-history scan can outlive the 600 s default on a large repository.\n' +
      '    # Set timeout-seconds beside enforce to change it; see the README.\n';
    expect(text.split(comment)).toHaveLength(2);
    const history = text.slice(text.indexOf('  secrets-history:'), text.indexOf('  vulnerabilities:'));
    expect(history).toContain(comment);
  });
});
