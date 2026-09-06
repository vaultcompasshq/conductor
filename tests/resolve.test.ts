import { afterEach, describe, expect, it } from '@jest/globals';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CANDIDATES, nodeModulesCandidate, resolveGateBinary } from '../src/resolve.js';
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

  // DOGFOOD 1, finding 4: a global vault-guard 1.4.3 ran over the project's
  // pinned 1.4.1, silently, and the report named a version the repository
  // had deliberately not chosen. "pnpm exec vault-guard" in the same
  // repository runs the pin, so the umbrella disagreed with the package
  // manager about which copy of a gate this repository means.
  it('prefers the repository own pin over a global install of the same name', () => {
    const binDir = tempDir();
    shim(binDir, 'vault-guard');
    const repo = tempDir();
    shim(path.join(repo, 'node_modules', '.bin'), 'vault-guard');

    const resolved = resolveGateBinary(
      gate({ role: 'secrets', product: 'vault-guard' }),
      repo,
      binDir
    );

    expect(resolved?.source).toBe('node_modules');
    expect(resolved?.command).toBe(path.join(repo, 'node_modules', '.bin', 'vault-guard'));
  });

  it('still keeps the current name ahead of an older one, wherever each is installed', () => {
    // Candidate-major ordering, unchanged: the outer loop is the candidate
    // list and only the inner loop is location. A repository pinning the
    // pre-1.2.0 per-command binary must not beat a current intent-guard on
    // PATH, or a leftover name would decide what runs for as long as it
    // stayed installed.
    const binDir = tempDir();
    shim(binDir, 'intent-guard');
    const repo = tempDir();
    shim(path.join(repo, 'node_modules', '.bin'), 'intent-guard-check');

    const resolved = resolveGateBinary(gate(), repo, binDir);

    expect(resolved?.candidate).toBe('intent-guard');
    expect(resolved?.source).toBe('path');
  });

  it('resolves from the target repository node_modules/.bin', () => {
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

  it('does not resolve the intent gate from a binary literally named conductor', () => {
    // The umbrella's own binary is named conductor, and that name used to
    // be a pre-rename fallback for intent-guard too. It no longer is: those
    // packages are deprecated and had no users, so a binary named conductor
    // on PATH must never satisfy the intent gate, even with no real
    // intent-guard binary anywhere. resolveGateBinary must report this as
    // missing, the same way detectGates (init's own detection, driven by
    // the same CANDIDATES table) reports the gate as not found.
    const binDir = tempDir();
    shim(binDir, 'conductor');

    const resolved = resolveGateBinary(gate(), tempDir(), binDir);

    expect(resolved).toBeNull();
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
  it('lists only the current names for the intent gate', () => {
    expect(CANDIDATES['intent-guard'].map((candidate) => candidate.name)).toEqual([
      'intent-guard',
      'intent-guard-check',
    ]);
  });

  it('has exactly one candidate for the two gates that were never renamed', () => {
    expect(CANDIDATES['dep-guard'].map((candidate) => candidate.name)).toEqual(['dep-guard']);
    expect(CANDIDATES['vault-guard'].map((candidate) => candidate.name)).toEqual(['vault-guard']);
  });
});

/**
 * On a pull-request run node_modules/.bin is not a location at all.
 *
 * The repository's own pin beats a global install everywhere else, and that
 * ordering is right: a LOCATION is a statement about which build, and the
 * repository gets to make it. On a pull request the repository making that
 * statement is the pull request, and what is under node_modules was chosen by
 * the head's own manifest and lockfile. 0.3.0 let resolution take it and then
 * refused the program, which is safe and made every ordinary pull request in a
 * devDependency-installed repository exit 2. Not trying it at all is the same
 * safety with the gate still running, off PATH, from a build the base branch
 * pinned.
 */
describe('resolution on a pull-request run', () => {
  it('takes the PATH copy even though the repository has its own', () => {
    const binDir = tempDir();
    const onPath = shim(binDir, 'vault-guard');
    const repo = tempDir();
    shim(path.join(repo, 'node_modules', '.bin'), 'vault-guard');

    const resolved = resolveGateBinary(
      gate({ role: 'secrets', product: 'vault-guard' }),
      repo,
      binDir,
      { skipNodeModules: true }
    );

    expect(resolved?.source).toBe('path');
    expect(resolved?.command).toBe(onPath);
  });

  it('resolves nothing when the only copy is in node_modules/.bin', () => {
    const repo = tempDir();
    shim(path.join(repo, 'node_modules', '.bin'), 'dep-guard');

    expect(
      resolveGateBinary(gate({ role: 'dependencies', product: 'dep-guard' }), repo, tempDir(), {
        skipNodeModules: true,
      })
    ).toBeNull();
  });

  it('never reaches node_modules/.bin for a version probe either', () => {
    // The probe RUNS the binary. Resolving the version-safe sibling out of
    // node_modules would execute a head-chosen program to answer a question,
    // which is the exact ordering hazard the program check exists for.
    const onlyCheck = tempDir();
    const repo = tempDir();
    shim(path.join(repo, 'node_modules', '.bin'), 'intent-guard');

    const resolved = resolveGateBinary(
      gate({ command: shim(onlyCheck, 'intent-guard-check') }),
      repo,
      onlyCheck,
      { skipNodeModules: true }
    );

    expect(resolved?.candidate).toBe('intent-guard-check');
    expect(resolved?.versionProbe).toBeNull();
  });

  it('leaves the ordinary run alone, node_modules/.bin first', () => {
    // The parity case. Outside pull-request mode nothing about resolution
    // changes: a pre-commit hook and a direct run on your own checkout are
    // already inside the trust boundary.
    const binDir = tempDir();
    shim(binDir, 'vault-guard');
    const repo = tempDir();
    shim(path.join(repo, 'node_modules', '.bin'), 'vault-guard');

    for (const options of [undefined, {}, { skipNodeModules: false }]) {
      const resolved = resolveGateBinary(
        gate({ role: 'secrets', product: 'vault-guard' }),
        repo,
        binDir,
        options
      );
      expect(resolved?.source).toBe('node_modules');
    }
  });
});

describe('naming the candidate a pull-request run skipped', () => {
  it('reports the repository-relative path, so a published log carries no machine path', () => {
    const repo = tempDir();
    shim(path.join(repo, 'node_modules', '.bin'), 'dep-guard');

    expect(nodeModulesCandidate(gate({ role: 'dependencies', product: 'dep-guard' }), repo)).toBe(
      'node_modules/.bin/dep-guard'
    );
  });

  it('follows the candidate table rather than guessing the product name', () => {
    const repo = tempDir();
    shim(path.join(repo, 'node_modules', '.bin'), 'intent-guard-check');

    expect(nodeModulesCandidate(gate(), repo)).toBe('node_modules/.bin/intent-guard-check');
  });

  it('reports nothing when there is nothing there', () => {
    expect(nodeModulesCandidate(gate(), tempDir())).toBeNull();
  });

  it('reports nothing when the policy names a command, since resolution never looked', () => {
    // A `command:` overrides resolution entirely, so no candidate was skipped
    // and saying one was would send a reader to fix a file that decided
    // nothing.
    const repo = tempDir();
    shim(path.join(repo, 'node_modules', '.bin'), 'vault-guard');
    const elsewhere = tempDir();

    expect(
      nodeModulesCandidate(
        gate({ role: 'secrets', product: 'vault-guard', command: shim(elsewhere, 'vault-guard') }),
        repo
      )
    ).toBeNull();
  });
});
