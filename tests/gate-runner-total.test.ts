// runGate is total: an error nothing anticipated never escapes it.
//
// The normalizers now validate what they read, so a malformed payload raises
// a NormalizeError and never reaches the broad catches this file pins. The
// only honest way to exercise those catches is to make a module throw
// something else, which is what the module mocks below do: a TypeError from
// a normalizer (the shape of the original defect), and a plain Error from
// the product table before anything is normalized.

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const state = { normalizerThrows: false, profileThrows: false };

const actualNormalize = await import('../src/normalize.js');
const actualProducts = await import('../src/products.js');

jest.unstable_mockModule('../src/normalize.js', () => ({
  ...actualNormalize,
  normalizeDepGuard: (...args: Parameters<typeof actualNormalize.normalizeDepGuard>) => {
    if (state.normalizerThrows) {
      throw new TypeError('a normalizer read a property of undefined');
    }
    return actualNormalize.normalizeDepGuard(...args);
  },
}));

jest.unstable_mockModule('../src/products.js', () => ({
  ...actualProducts,
  profileFor: (product: Parameters<typeof actualProducts.profileFor>[0]) => {
    if (state.profileThrows && product === 'dep-guard') {
      throw new Error('the product table could not be read');
    }
    return actualProducts.profileFor(product);
  },
}));

const { runGate } = await import('../src/gate-runner.js');
const { runAll } = await import('../src/run.js');
const { parsePolicy } = await import('../src/policy.js');
const { CLEAN_DEP_GUARD, CLEAN_INTENT_GUARD, CLEAN_VAULT_GUARD, stubGate } = await import(
  './helpers/stub-gate.js'
);

const temps: string[] = [];

afterEach(() => {
  state.normalizerThrows = false;
  state.profileThrows = false;
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-total-'));
  temps.push(dir);
  return dir;
}

const ALL_THREE = parsePolicy(
  [
    'version: 1',
    'gates:',
    '  dependencies:',
    '    product: dep-guard',
    '  secrets:',
    '    product: vault-guard',
    '  intent:',
    '    product: intent-guard',
    '',
  ].join('\n'),
  '.guardrails.yaml'
);

function threeStubs(): string {
  const bin = tempDir();
  stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD });
  stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD });
  stubGate(bin, 'intent-guard', { stdout: CLEAN_INTENT_GUARD, version: '1.4.0' });
  return bin;
}

// A stack frame as Node prints it.
const STACK_FRAME = /\n\s+at\s+\S+/;

describe('runGate is total', () => {
  it('turns a TypeError thrown while normalizing into could-not-run, with no stack', () => {
    state.normalizerThrows = true;
    const dependencies = ALL_THREE.gates.dependencies!;

    const outcome = runGate(dependencies, { repoRoot: tempDir(), staged: true, pathValue: threeStubs() });

    expect(outcome.couldNotRun?.reason).toBe('unparseable-output');
    expect(outcome.couldNotRun?.detail).toContain('a normalizer read a property of undefined');
    expect(JSON.stringify(outcome)).not.toMatch(STACK_FRAME);
  });

  it('runs every gate after the one whose normalizer threw, and the run exits 2', () => {
    state.normalizerThrows = true;

    const result = runAll(ALL_THREE, { repoRoot: tempDir(), staged: true, pathValue: threeStubs() });

    expect(result.gates.map((gate) => gate.product)).toEqual(['dep-guard', 'vault-guard', 'intent-guard']);
    expect(result.gates[1].couldNotRun).toBeNull();
    expect(result.gates[2].couldNotRun).toBeNull();
    expect(result.exitCode).toBe(2);
  });

  it('turns an error thrown before normalization into could-not-run through the outer backstop', () => {
    state.profileThrows = true;
    const dependencies = ALL_THREE.gates.dependencies!;

    const outcome = runGate(dependencies, { repoRoot: tempDir(), staged: true, pathValue: threeStubs() });

    expect(outcome.couldNotRun?.reason).toBe('unparseable-output');
    expect(outcome.couldNotRun?.detail).toBe('the product table could not be read');
    expect(JSON.stringify(outcome)).not.toMatch(STACK_FRAME);
  });
});
