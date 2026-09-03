import { afterEach, describe, expect, it } from '@jest/globals';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CANDIDATES, resolveGateBinary } from '../src/resolve.js';
import type { GatePolicy } from '../src/policy.js';

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-resolve-'));
  temps.push(dir);
  return dir;
}

/** Writes an executable no-op shim so resolution has something real to find. */
function shim(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, 0o755);
  return file;
}

function gate(overrides: Partial<GatePolicy> = {}): GatePolicy {
  return {
    role: 'intent',
    product: 'intent-guard',
    enabled: true,
    options: {},
    ...overrides,
  } as GatePolicy;
}

describe('binary resolution', () => {
  it('finds a binary on PATH', () => {
    const binDir = tempDir();
    shim(binDir, 'dep-guard');
    const repo = tempDir();

    const resolved = resolveGateBinary(
      gate({ role: 'dependencies', product: 'dep-guard' }),
      repo,
      binDir
    );

    expect(resolved?.source).toBe('path');
    expect(resolved?.candidate).toBe('dep-guard');
    expect(resolved?.argvPrefix).toEqual(['scan']);
  });

  it('falls back to the target repository node_modules/.bin', () => {
    const emptyPath = tempDir();
    const repo = tempDir();
    shim(path.join(repo, 'node_modules', '.bin'), 'dep-guard');

    const resolved = resolveGateBinary(
      gate({ role: 'dependencies', product: 'dep-guard' }),
      repo,
      emptyPath
    );

    expect(resolved?.source).toBe('node_modules');
    expect(resolved?.command).toBe(path.join(repo, 'node_modules', '.bin', 'dep-guard'));
  });

  it('returns null when nothing resolves, rather than guessing a name', () => {
    expect(
      resolveGateBinary(gate({ role: 'secrets', product: 'vault-guard' }), tempDir(), tempDir())
    ).toBeNull();
  });

  it('falls back from intent-guard to intent-guard-check, with the right argument prefix', () => {
    const binDir = tempDir();
    shim(binDir, 'intent-guard-check');

    const resolved = resolveGateBinary(gate(), tempDir(), binDir);

    expect(resolved?.candidate).toBe('intent-guard-check');
    // The per-command binary IS the check command, so it takes no
    // subcommand of its own.
    expect(resolved?.argvPrefix).toEqual([]);
  });

  it('falls back to the pre-rename conductor names', () => {
    const binDir = tempDir();
    shim(binDir, 'conductor');

    const resolved = resolveGateBinary(gate(), tempDir(), binDir);

    expect(resolved?.candidate).toBe('conductor');
    expect(resolved?.argvPrefix).toEqual(['check']);
  });

  it('falls back to conductor-check last', () => {
    const binDir = tempDir();
    shim(binDir, 'conductor-check');

    const resolved = resolveGateBinary(gate(), tempDir(), binDir);

    expect(resolved?.candidate).toBe('conductor-check');
    expect(resolved?.argvPrefix).toEqual([]);
  });

  it('prefers the current name over a pre-rename one even when the old one is on PATH', () => {
    const binDir = tempDir();
    shim(binDir, 'conductor');
    const repo = tempDir();
    shim(path.join(repo, 'node_modules', '.bin'), 'intent-guard');

    const resolved = resolveGateBinary(gate(), repo, binDir);

    // A locally installed current name beats a globally installed old one.
    // Preferring PATH here would silently pin a repository to the package
    // its author renamed away from.
    expect(resolved?.candidate).toBe('intent-guard');
    expect(resolved?.source).toBe('node_modules');
  });

  it('lets an absolute command in the policy override resolution entirely', () => {
    const binDir = tempDir();
    shim(binDir, 'intent-guard');
    const elsewhere = tempDir();
    const chosen = shim(elsewhere, 'my-build');

    const resolved = resolveGateBinary(gate({ command: chosen, args: ['check'] }), tempDir(), binDir);

    expect(resolved?.source).toBe('policy');
    expect(resolved?.command).toBe(chosen);
    expect(resolved?.argvPrefix).toEqual(['check']);
  });

  it('infers the argument prefix from a configured command own name', () => {
    const dir = tempDir();
    const chosen = shim(dir, 'intent-guard-check');
    const resolved = resolveGateBinary(gate({ command: chosen }), tempDir(), tempDir());
    expect(resolved?.argvPrefix).toEqual([]);
  });

  it('runs a configured script through node when it is not executable itself', () => {
    const dir = tempDir();
    const script = path.join(dir, 'intent-guard.js');
    writeFileSync(script, '// not chmod +x\n');

    const resolved = resolveGateBinary(gate({ command: script }), tempDir(), tempDir());

    expect(resolved?.command).toBe(process.execPath);
    expect(resolved?.argvPrefix).toEqual([script, 'check']);
  });

  it('reports a configured command that does not exist rather than falling back silently', () => {
    const binDir = tempDir();
    shim(binDir, 'intent-guard');

    expect(() =>
      resolveGateBinary(gate({ command: '/nowhere/at/all/intent-guard' }), tempDir(), binDir)
    ).toThrow(/nowhere/);
  });
});

describe('version probing', () => {
  it('probes the resolved binary when asking it for a version is safe', () => {
    const binDir = tempDir();
    shim(binDir, 'dep-guard');
    const resolved = resolveGateBinary(
      gate({ role: 'dependencies', product: 'dep-guard' }),
      tempDir(),
      binDir
    );
    expect(resolved?.versionProbe?.command).toBe(path.join(binDir, 'dep-guard'));
  });

  it('never asks a per-command binary for its version, because that runs the gate', () => {
    const binDir = tempDir();
    shim(binDir, 'intent-guard-check');

    const resolved = resolveGateBinary(gate(), tempDir(), binDir);

    // intent-guard-check ignores --version and runs the check against the
    // current directory instead. Probing it would run a gate as a side
    // effect of asking a question.
    expect(resolved?.versionProbe).toBeNull();
  });

  it('probes the umbrella binary of the same product when the resolved one is unsafe to ask', () => {
    const binDir = tempDir();
    shim(binDir, 'intent-guard-check');
    shim(binDir, 'intent-guard');

    // intent-guard resolves first here, so force the per-command case by
    // resolving with the parent unavailable on PATH but present locally.
    const repo = tempDir();
    shim(path.join(repo, 'node_modules', '.bin'), 'intent-guard');
    const onlyCheck = tempDir();
    shim(onlyCheck, 'intent-guard-check');
    const resolved = resolveGateBinary(gate({ command: shim(onlyCheck, 'intent-guard-check') }), repo, onlyCheck);

    expect(resolved?.candidate).toBe('intent-guard-check');
    expect(resolved?.versionProbe?.command).toBe(
      path.join(repo, 'node_modules', '.bin', 'intent-guard')
    );
  });
});

describe('candidate table', () => {
  it('lists the pre-rename names after the current ones for the intent gate', () => {
    expect(CANDIDATES['intent-guard'].map((candidate) => candidate.name)).toEqual([
      'intent-guard',
      'intent-guard-check',
      'conductor',
      'conductor-check',
    ]);
  });

  it('has exactly one candidate for the two gates that were never renamed', () => {
    expect(CANDIDATES['dep-guard'].map((candidate) => candidate.name)).toEqual(['dep-guard']);
    expect(CANDIDATES['vault-guard'].map((candidate) => candidate.name)).toEqual(['vault-guard']);
  });
});
