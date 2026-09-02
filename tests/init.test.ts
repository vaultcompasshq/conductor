import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEP_GUARD_HOOK_MARKER,
  INTENT_GUARD_HOOK_MARKER,
  MANAGED_HOOK_MARKER,
  MANIFEST_RELATIVE_PATH,
  POLICY_FILE_NAME,
  applyInit,
  planInit,
  revertInit,
} from '../src/init.js';

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compass-init-'));
  temps.push(dir);
  return dir;
}

function gitRepo(): string {
  const dir = tempDir();
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(path.join(dir, 'README.md'), 'fixture\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: dir });
  return dir;
}

// git's absolute path, so a commit can be driven with a PATH that has no
// compass on it WITHOUT also hiding git from this process. Setting PATH to
// an empty directory and still calling "git" by name finds nothing, and the
// resulting undefined stderr looks like a hook that stayed quiet.
const GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

function shim(dir: string, name: string, body = '#!/bin/sh\nexit 0\n'): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  return file;
}

function init(cwd: string, options: Record<string, unknown> = {}) {
  const opts = { cwd, pathValue: '', ...options } as Parameters<typeof planInit>[0];
  const plan = planInit(opts);
  return applyInit(plan, opts);
}

describe('what init writes', () => {
  it('writes the policy file and one pre-commit hook', () => {
    const repo = gitRepo();
    const result = init(repo);

    expect(result.ok).toBe(true);
    expect(existsSync(path.join(repo, POLICY_FILE_NAME))).toBe(true);
    expect(existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(true);
    expect(existsSync(path.join(repo, MANIFEST_RELATIVE_PATH))).toBe(true);
  });

  it('writes exactly one hook, which runs the umbrella and not three gates', () => {
    const repo = gitRepo();
    init(repo);
    const hook = readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8');

    expect(hook).toMatch(/compass run --staged/);
    expect(hook).toContain(MANAGED_HOOK_MARKER);
    expect(hook).not.toMatch(/dep-guard scan/);
    expect(hook).not.toMatch(/vault-guard scan/);
  });

  it('enables gates it found and lists the rest disabled rather than omitting them', () => {
    const repo = gitRepo();
    const bin = tempDir();
    shim(bin, 'vault-guard');

    init(repo, { pathValue: bin });
    const policy = readFileSync(path.join(repo, POLICY_FILE_NAME), 'utf8');

    expect(policy).toMatch(/secrets:\n\s+product: vault-guard\n\s+enabled: true/);
    expect(policy).toMatch(/dependencies:\n\s+product: dep-guard\n\s+enabled: false/);
    expect(policy).toMatch(/intent:\n\s+product: intent-guard\n\s+enabled: false/);
  });

  it('says in the file why a gate is switched off, so the file explains itself', () => {
    const repo = gitRepo();
    init(repo);
    const policy = readFileSync(path.join(repo, POLICY_FILE_NAME), 'utf8');
    expect(policy).toMatch(/# not found on PATH or in node_modules\/\.bin/);
  });

  it('writes byte-identical output on two runs in two repositories', () => {
    const first = gitRepo();
    const second = gitRepo();
    init(first);
    init(second);
    expect(readFileSync(path.join(first, POLICY_FILE_NAME), 'utf8')).toBe(
      readFileSync(path.join(second, POLICY_FILE_NAME), 'utf8')
    );
  });

  it('refuses in a directory that is not a git repository', () => {
    const result = init(tempDir());
    expect(result.ok).toBe(false);
    expect(result.conflicts[0].reason).toBe('not-a-git-repository');
  });
});

describe('idempotence', () => {
  it('does nothing on a second run and says so', () => {
    const repo = gitRepo();
    init(repo);
    const hookBefore = readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8');

    const second = init(repo);

    expect(second.ok).toBe(true);
    expect(second.alreadyInstalled).toBe(true);
    expect(second.actions.every((action) => action.kind === 'skip')).toBe(true);
    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe(hookBefore);
  });

  it('leaves a policy file the user has edited completely alone', () => {
    const repo = gitRepo();
    init(repo);
    const edited = 'version: 1\ngates:\n  secrets:\n    product: vault-guard\n';
    writeFileSync(path.join(repo, POLICY_FILE_NAME), edited);

    init(repo);

    expect(readFileSync(path.join(repo, POLICY_FILE_NAME), 'utf8')).toBe(edited);
  });
});

describe('dry run', () => {
  it('prints every file it would touch and writes none of them', () => {
    const repo = gitRepo();
    const result = init(repo, { dryRun: true });

    const paths = result.actions.map((action) => action.path);
    expect(paths).toContain(POLICY_FILE_NAME);
    expect(paths).toContain(MANIFEST_RELATIVE_PATH);
    expect(paths.some((entry) => entry.endsWith('pre-commit'))).toBe(true);

    expect(existsSync(path.join(repo, POLICY_FILE_NAME))).toBe(false);
    expect(existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false);
    expect(existsSync(path.join(repo, MANIFEST_RELATIVE_PATH))).toBe(false);
  });
});

describe('revert', () => {
  it('removes exactly what init wrote', () => {
    const repo = gitRepo();
    init(repo);
    writeFileSync(path.join(repo, 'unrelated.txt'), 'not ours\n');

    const result = revertInit({ cwd: repo, pathValue: '' });

    expect(result.ok).toBe(true);
    expect(existsSync(path.join(repo, POLICY_FILE_NAME))).toBe(false);
    expect(existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false);
    expect(existsSync(path.join(repo, MANIFEST_RELATIVE_PATH))).toBe(false);
    expect(existsSync(path.join(repo, 'unrelated.txt'))).toBe(true);
  });

  it('leaves a policy file the user changed after init, rather than deleting their work', () => {
    const repo = gitRepo();
    init(repo);
    writeFileSync(path.join(repo, POLICY_FILE_NAME), 'version: 1\ngates:\n  secrets:\n    product: vault-guard\n');

    const result = revertInit({ cwd: repo, pathValue: '' });

    expect(existsSync(path.join(repo, POLICY_FILE_NAME))).toBe(true);
    expect(result.actions.some((action) => action.detail.includes('changed since init'))).toBe(true);
    // Something was left behind, so this is not a success.
    expect(result.ok).toBe(false);
    // The hook is gone, so an edited policy file left behind is inert.
    expect(existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false);
    // And the manifest survives, still holding the entry it could not act on.
    expect(existsSync(path.join(repo, MANIFEST_RELATIVE_PATH))).toBe(true);
  });
});

// The reviewer's scratch sequences. Before the fix, revert deleted the
// manifest unconditionally and returned ok: true even when it had skipped a
// file, which produced two states nobody could get out of.
describe('revert with a hook the user edited', () => {
  function editedHook(repo: string): void {
    const hookPath = path.join(repo, '.git', 'hooks', 'pre-commit');
    writeFileSync(hookPath, `${readFileSync(hookPath, 'utf8')}\n# a local tweak\n`);
  }

  it('leaves the policy file in place too, so no hook is left running without one', () => {
    const repo = gitRepo();
    init(repo);
    editedHook(repo);

    const result = revertInit({ cwd: repo, pathValue: '' });

    expect(result.ok).toBe(false);
    // The proven consequence: removing the policy file here leaves an edited
    // hook running compass with nothing to read, so every commit after this
    // is refused with exit 2 while revert reported success.
    expect(existsSync(path.join(repo, POLICY_FILE_NAME))).toBe(true);
    expect(existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(true);
  });

  it('keeps the manifest, so a second revert still knows what it is looking at', () => {
    const repo = gitRepo();
    init(repo);
    editedHook(repo);

    revertInit({ cwd: repo, pathValue: '' });

    expect(existsSync(path.join(repo, MANIFEST_RELATIVE_PATH))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(path.join(repo, MANIFEST_RELATIVE_PATH), 'utf8')
    ) as { files: unknown[] };
    expect(manifest.files.length).toBeGreaterThan(0);
  });

  it('says what was left and why', () => {
    const repo = gitRepo();
    init(repo);
    editedHook(repo);

    const result = revertInit({ cwd: repo, pathValue: '' });

    expect(result.conflicts[0].reason).toBe('changed-since-init');
    expect(result.conflicts[0].guidance).toMatch(/--force/);
  });

  it('cleans up on a second revert with --force', () => {
    const repo = gitRepo();
    init(repo);
    editedHook(repo);
    revertInit({ cwd: repo, pathValue: '' });

    const forced = revertInit({ cwd: repo, pathValue: '', force: true });

    expect(forced.ok).toBe(true);
    expect(existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false);
    expect(existsSync(path.join(repo, POLICY_FILE_NAME))).toBe(false);
    expect(existsSync(path.join(repo, MANIFEST_RELATIVE_PATH))).toBe(false);
  });
});

describe('revert after adopting a gate hook', () => {
  const ORIGINAL = `#!/bin/sh\n# ${DEP_GUARD_HOOK_MARKER}\ndep-guard scan --staged\n`;

  function adopted(): string {
    const repo = gitRepo();
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), ORIGINAL);
    init(repo, { adopt: true });
    return repo;
  }

  it('keeps the adopted content in the manifest when the hook was edited', () => {
    const repo = adopted();
    const hookPath = path.join(repo, '.git', 'hooks', 'pre-commit');
    writeFileSync(hookPath, `${readFileSync(hookPath, 'utf8')}\n# a local tweak\n`);

    const result = revertInit({ cwd: repo, pathValue: '' });

    expect(result.ok).toBe(false);
    // The manifest holds the only copy of the gate's own hook. Deleting it
    // here makes that hook unrecoverable.
    const manifest = JSON.parse(
      readFileSync(path.join(repo, MANIFEST_RELATIVE_PATH), 'utf8')
    ) as { adopted: { content: string } | null };
    expect(manifest.adopted?.content).toBe(ORIGINAL);
  });

  it('restores the gate own hook byte for byte under --force', () => {
    const repo = adopted();
    const hookPath = path.join(repo, '.git', 'hooks', 'pre-commit');
    writeFileSync(hookPath, `${readFileSync(hookPath, 'utf8')}\n# a local tweak\n`);
    revertInit({ cwd: repo, pathValue: '' });

    const forced = revertInit({ cwd: repo, pathValue: '', force: true });

    expect(forced.ok).toBe(true);
    expect(readFileSync(hookPath, 'utf8')).toBe(ORIGINAL);
    expect(existsSync(path.join(repo, MANIFEST_RELATIVE_PATH))).toBe(false);
  });

  it('restores it without --force when the umbrella hook was left untouched', () => {
    const repo = adopted();

    const result = revertInit({ cwd: repo, pathValue: '' });

    expect(result.ok).toBe(true);
    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe(ORIGINAL);
  });
});

describe('revert, continued', () => {

  it('refuses when there is no manifest, rather than guessing what to delete', () => {
    const result = revertInit({ cwd: gitRepo(), pathValue: '' });
    expect(result.ok).toBe(false);
    expect(result.conflicts[0].reason).toBe('no-manifest');
  });
});

describe('hook collisions', () => {
  it('refuses to overwrite a foreign hook', () => {
    const repo = gitRepo();
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nmake lint\n');

    const result = init(repo);

    expect(result.ok).toBe(false);
    expect(result.conflicts[0].reason).toBe('foreign-hook');
    expect(existsSync(path.join(repo, POLICY_FILE_NAME))).toBe(false);
  });

  it('does not overwrite a foreign hook even with --adopt', () => {
    const repo = gitRepo();
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nmake lint\n');

    const result = init(repo, { adopt: true });

    expect(result.ok).toBe(false);
    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toMatch(
      /make lint/
    );
  });

  it.each([
    ['dep-guard', `#!/bin/sh\n# ${DEP_GUARD_HOOK_MARKER}\ndep-guard scan --staged\n`],
    ['intent-guard', `#!/usr/bin/env bash\n# ${INTENT_GUARD_HOOK_MARKER}\nintent-guard-check\n`],
    ['vault-guard', '#!/bin/sh\n# vault-guard pre-commit\nvault-guard scan --staged\n'],
  ])('stops on a %s hook rather than stacking a second invocation', (product, content) => {
    const repo = gitRepo();
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), content);

    const result = init(repo);

    expect(result.ok).toBe(false);
    expect(result.conflicts[0].reason).toBe('gate-hook');
    expect(result.conflicts[0].guidance).toMatch(new RegExp(product));
    // The gate's own hook is still there, untouched.
    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe(content);
  });

  it('replaces a gate own hook only when told to adopt it', () => {
    const repo = gitRepo();
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    const original = `#!/bin/sh\n# ${DEP_GUARD_HOOK_MARKER}\ndep-guard scan --staged\n`;
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), original);

    const result = init(repo, { adopt: true });

    expect(result.ok).toBe(true);
    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toContain(
      MANAGED_HOOK_MARKER
    );
    expect(result.adoptedFrom?.product).toBe('dep-guard');
  });

  it('puts an adopted hook back on revert, because that is undoing what init did', () => {
    const repo = gitRepo();
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    const original = `#!/bin/sh\n# ${DEP_GUARD_HOOK_MARKER}\ndep-guard scan --staged\n`;
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), original);
    init(repo, { adopt: true });

    revertInit({ cwd: repo, pathValue: '' });

    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe(original);
  });

  it('treats a whitespace-only hook as absent, not as foreign', () => {
    const repo = gitRepo();
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), '\n  \n');

    expect(init(repo).ok).toBe(true);
  });
});

describe('core.hooksPath', () => {
  it('resolves a relative hooksPath against the worktree root, proven by a real commit', () => {
    const repo = gitRepo();
    execFileSync('git', ['config', 'core.hooksPath', '.husky/_'], { cwd: repo });

    init(repo);

    // The hook must be where git actually looks. Planting the assertion on
    // a path string would let this test agree with the same mistake the
    // code could make, so the check is whether a commit is refused.
    expect(existsSync(path.join(repo, '.husky', '_', 'pre-commit'))).toBe(true);

    writeFileSync(path.join(repo, 'change.txt'), 'staged\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const commit = spawnSync(GIT, ['commit', '-m', 'should be refused'], {
      cwd: repo,
      encoding: 'utf8',
      // No compass on PATH, so the fail-closed branch is what refuses it.
      env: { ...process.env, PATH: tempDir() },
    });

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toMatch(/compass: command not found/);
  });

  it('leaves an absolute hooksPath that points outside the repository alone', () => {
    const repo = gitRepo();
    const shared = tempDir();
    execFileSync('git', ['config', 'core.hooksPath', shared], { cwd: repo });

    const result = init(repo);

    expect(result.ok).toBe(false);
    expect(result.conflicts[0].reason).toBe('hooks-path-outside-repository');
    expect(existsSync(path.join(shared, 'pre-commit'))).toBe(false);
  });
});

describe('the generated hook', () => {
  it('fails closed when the umbrella binary is missing, and blocks the commit', () => {
    const repo = gitRepo();
    init(repo);

    writeFileSync(path.join(repo, 'change.txt'), 'staged\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const commit = spawnSync(GIT, ['commit', '-m', 'no compass installed'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: tempDir() },
    });

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toMatch(/NOT checked/);
  });

  it('passes the umbrella exit code through unchanged', () => {
    const repo = gitRepo();
    init(repo);
    const bin = tempDir();
    shim(bin, 'compass', '#!/bin/sh\nexit 2\n');

    const run = spawnSync(path.join(repo, '.git', 'hooks', 'pre-commit'), [], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
    });

    // 2 means a gate could not run. Collapsing it into 1 would report
    // findings that were never actually looked for.
    expect(run.status).toBe(2);
  });

  it('lets a clean run through', () => {
    const repo = gitRepo();
    init(repo);
    const bin = tempDir();
    shim(bin, 'compass', '#!/bin/sh\nexit 0\n');

    writeFileSync(path.join(repo, 'change.txt'), 'staged\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const commit = spawnSync('git', ['commit', '-m', 'clean'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
    });

    expect(commit.status).toBe(0);
  });
});
