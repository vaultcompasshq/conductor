import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { fileURLToPath } from 'node:url';

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
import { parsePolicy } from '../src/policy.js';

/** Pre-commit hooks captured from real hook-manager installs. */
const HOOK_FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'hooks'
);

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-init-'));
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
// conductor on it WITHOUT also hiding git from this process. Setting PATH to
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

/**
 * A PATH with no conductor on it, but with git and the standard utilities
 * a hook actually needs: husky's generated files carry a
 * "#!/usr/bin/env sh" shebang, so an empty PATH makes them fail to start
 * with an error that looks nothing like a hook decision, and the hook
 * written here asks git for the worktree root.
 */
function shimDirWithGit(): string {
  const dir = tempDir();
  shim(dir, 'git', `#!/bin/sh\nexec ${GIT} "$@"\n`);
  return dir;
}

function pathLedBy(dir: string): string {
  return [dir, '/bin', '/usr/bin'].join(path.delimiter);
}

// husky 9's generated files, copied from husky 9.1.7's own installer
// (node_modules/husky/index.js writes the dispatcher, and husky/husky is
// the `h` shim). Reproduced here rather than depended on, so this suite
// never needs husky installed and never changes behaviour when it is.
//
// The one deliberate omission is the shim's sourcing of
// ~/.config/husky/init.sh: reading a file out of the developer's home
// directory would make this test's result depend on the machine.
const HUSKY_DISPATCHER = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"';

const HUSKY_SHIM = [
  '#!/usr/bin/env sh',
  '[ "$HUSKY" = "2" ] && set -x',
  'n=$(basename "$0")',
  's=$(dirname "$(dirname "$0")")/$n',
  '',
  '[ ! -f "$s" ] && exit 0',
  '',
  '[ "${HUSKY-}" = "0" ] && exit 0',
  '',
  'export PATH="node_modules/.bin:$PATH"',
  'sh -e "$s" "$@"',
  'c=$?',
  '',
  '[ $c != 0 ] && echo "husky - $n script failed (code $c)"',
  '[ $c = 127 ] && echo "husky - command not found in PATH=$PATH"',
  'exit $c',
  '',
].join('\n');

/** Exactly what husky's prepare step writes, on install and on re-install. */
function writeHuskyGenerated(repo: string): void {
  const generated = path.join(repo, '.husky', '_');
  mkdirSync(generated, { recursive: true });
  writeFileSync(path.join(generated, '.gitignore'), '*');
  writeFileSync(path.join(generated, 'pre-commit'), HUSKY_DISPATCHER);
  chmodSync(path.join(generated, 'pre-commit'), 0o755);
  writeFileSync(path.join(generated, 'h'), HUSKY_SHIM);
  chmodSync(path.join(generated, 'h'), 0o755);
}

/** A repository wired the way husky 9 wires one. */
function huskyRepo(): string {
  const repo = gitRepo();
  writeHuskyGenerated(repo);
  execFileSync('git', ['config', 'core.hooksPath', '.husky/_'], { cwd: repo });
  return repo;
}

// The real tracked hook shape found in the dogfood repository: vault-guard,
// recognised by content because that gate writes no marker of its own.
const TRACKED_VAULT_GUARD_HOOK = '#!/usr/bin/env sh\nvault-guard scan --staged\n';

function huskyRepoWithGateHook(): string {
  const repo = huskyRepo();
  writeFileSync(path.join(repo, '.husky', 'pre-commit'), TRACKED_VAULT_GUARD_HOOK);
  chmodSync(path.join(repo, '.husky', 'pre-commit'), 0o755);
  return repo;
}

// husky 8, which is a DIFFERENT layout and must not take the redirect.
// It points core.hooksPath at .husky itself, so the file git executes is
// already the tracked one; the generated shim it keeps under _ is called
// husky.sh, and every tracked hook SOURCES it as a preamble. That preamble
// is a line in the tracked hook, not a dispatcher, and reading it as one
// sent the umbrella looking for a tracked file one directory above .husky,
// which is the repository root.
const HUSKY_8_SHIM = [
  '#!/usr/bin/env sh',
  'if [ -z "$husky_skip_init" ]; then',
  '  readonly hook_name="$(basename -- "$0")"',
  '  export husky_skip_init=1',
  '  sh -e "$0" "$@"',
  '  exit $?',
  'fi',
  '',
].join('\n');

const HUSKY_8_TRACKED_HOOK = [
  '#!/usr/bin/env sh',
  '. "$(dirname -- "$0")/_/husky.sh"',
  '',
  'vault-guard scan --staged',
  '',
].join('\n');

/** A repository wired the way husky 8 wires one. */
function husky8Repo(): string {
  const repo = gitRepo();
  const generated = path.join(repo, '.husky', '_');
  mkdirSync(generated, { recursive: true });
  writeFileSync(path.join(generated, '.gitignore'), '*');
  writeFileSync(path.join(generated, 'husky.sh'), HUSKY_8_SHIM);
  chmodSync(path.join(generated, 'husky.sh'), 0o755);
  writeFileSync(path.join(repo, '.husky', 'pre-commit'), HUSKY_8_TRACKED_HOOK);
  chmodSync(path.join(repo, '.husky', 'pre-commit'), 0o755);
  execFileSync('git', ['config', 'core.hooksPath', '.husky'], { cwd: repo });
  return repo;
}

// lefthook and the pre-commit framework both install a GENERATED script
// into the hooks directory too. Neither has a tracked counterpart the
// umbrella could write instead, so both are refused rather than redirected.
//
// This lefthook constant is HAND-WRITTEN and does not match what lefthook
// generates: no released version writes a "lefthook_version:" line. It is
// kept only to cover the spare alternative in detectGeneratedHook. The
// file lefthook really produces is captured in tests/fixtures/hooks and
// exercised further down.
const LEFTHOOK_GENERATED = [
  '#!/bin/sh',
  '# lefthook_version: 0b7c1f0f0b2b4a8e',
  '',
  'call_lefthook run "pre-commit" "$@"',
  '',
].join('\n');

const PRE_COMMIT_FRAMEWORK_GENERATED = [
  '#!/usr/bin/env bash',
  '# File generated by pre-commit: https://pre-commit.com',
  '# ID: 138fd403232d2ddd5efb44317e38bf03',
  '',
  'exec pre-commit hook-impl --hook-type=pre-commit -- "$@"',
  '',
].join('\n');

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

    expect(hook).toMatch(/conductor run --staged/);
    expect(hook).toContain(MANAGED_HOOK_MARKER);
    expect(hook).not.toMatch(/dep-guard scan/);
    expect(hook).not.toMatch(/vault-guard scan/);
  });

  it('writes a hook that runs the commit stage, not every stage', () => {
    // A pre-commit hook is the commit stopping point, so it asks for that
    // stage by name rather than for everything. Without it the hook would
    // run the intent gate on every commit, which is the per-task ceremony
    // the stage split exists to keep out of a commit.
    const repo = gitRepo();
    init(repo);
    const hook = readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8');

    expect(hook).toMatch(/conductor run --staged --stage commit/);
  });

  it('records the hook it actually wrote, so revert still recognises it', () => {
    // The manifest hashes the hook's contents. A hook text change that did
    // not reach the manifest would make every revert report the hook as
    // edited by hand and refuse to remove anything.
    const repo = gitRepo();
    init(repo);

    const revert = revertInit({ cwd: repo, pathValue: '' });

    expect(revert.ok).toBe(true);
    expect(revert.conflicts).toEqual([]);
    expect(existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false);
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

  it('writes each gate stage explicitly, so the file explains when each one runs', () => {
    // The generated policy file is where a user discovers the vocabulary.
    // A default that exists only in the parser is a default nobody can see,
    // and the intent gate sitting at a different stage from the other two is
    // exactly the thing that needs saying out loud.
    const repo = gitRepo();
    init(repo);
    const policy = readFileSync(path.join(repo, POLICY_FILE_NAME), 'utf8');

    expect(policy).toMatch(/dependencies:\n(?:.*\n)*?\s+stage: commit/);
    expect(policy).toMatch(/secrets:\n(?:.*\n)*?\s+stage: commit/);
    expect(policy).toMatch(/intent:\n(?:.*\n)*?\s+stage: ci/);
  });

  it('writes each gate enforce explicitly, by the same rule that writes stage', () => {
    // The file writes stage on every gate on the argument that a default
    // living only in the parser is undiscoverable. enforce is the same kind
    // of key and was getting a comment instead, which is that argument
    // applied to one of two identical cases.
    const repo = gitRepo();
    init(repo);
    const policy = readFileSync(path.join(repo, POLICY_FILE_NAME), 'utf8');

    expect(policy).toMatch(/dependencies:\n(?:.*\n)*?\s+enforce: true/);
    expect(policy).toMatch(/secrets:\n(?:.*\n)*?\s+enforce: true/);
    expect(policy).toMatch(/intent:\n(?:.*\n)*?\s+enforce: false/);
  });

  it('starts the intent gate off the exit code, which is the ramp the design calls for', () => {
    // The adoption ramp is a thing a fresh init should PRODUCE, not a thing
    // it describes and leaves for somebody to hand-edit into three
    // repositories, which is what actually happened.
    const repo = gitRepo();
    init(repo);
    const policy = readFileSync(path.join(repo, POLICY_FILE_NAME), 'utf8');
    const intent = policy.slice(policy.indexOf('  intent:'));

    expect(intent).toMatch(/# It runs and reports in CI without failing the run/);
    expect(intent).toMatch(/Flip it to\n\s+# true once a few pull requests/);
  });

  it('writes a policy file that still validates against the shipped schema', () => {
    const repo = gitRepo();
    init(repo);

    const parsed = parsePolicy(
      readFileSync(path.join(repo, POLICY_FILE_NAME), 'utf8'),
      POLICY_FILE_NAME
    );

    expect(parsed.gates.dependencies?.enforce).toBe(true);
    expect(parsed.gates.secrets?.enforce).toBe(true);
    expect(parsed.gates.intent?.enforce).toBe(false);
  });

  it('says in the file why a gate is switched off, so the file explains itself', () => {
    const repo = gitRepo();
    init(repo);
    const policy = readFileSync(path.join(repo, POLICY_FILE_NAME), 'utf8');
    // Named in resolution order, which is the repository's own copy first.
    expect(policy).toMatch(/# not found in node_modules\/\.bin or on PATH/);
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

// A hook carrying the umbrella's own marker used to be skipped whatever it
// said, so the hook an OLDER conductor wrote survived every re-init: it kept
// running the old command line, and it was never entered in the new
// manifest, so a later --revert walked past it and left it behind.
describe('re-init over a hook a previous conductor wrote', () => {
  const OLD_HOOK = [
    '#!/bin/sh',
    `# Guardrail pre-commit hook. ${MANAGED_HOOK_MARKER}`,
    'conductor_status=0',
    'conductor run --staged || conductor_status=$?',
    'exit "$conductor_status"',
    '',
  ].join('\n');

  function manifestOf(repo: string): {
    files: Array<{ path: string; sha256: string; kind: string }>;
    adopted: { path: string; content: string; product: string } | null;
  } {
    return JSON.parse(readFileSync(path.join(repo, MANIFEST_RELATIVE_PATH), 'utf8'));
  }

  /**
   * A repository as an older conductor would have left it: the hook it wrote
   * on disk, and the manifest recording that hook's own digest. Nobody has
   * touched either since.
   */
  function repoFromOlderConductor(): string {
    const repo = gitRepo();
    init(repo);
    const hookPath = path.join(repo, '.git', 'hooks', 'pre-commit');
    writeFileSync(hookPath, OLD_HOOK);

    const manifest = manifestOf(repo);
    for (const file of manifest.files) {
      if (file.kind === 'hook') {
        file.sha256 = createHash('sha256').update(OLD_HOOK).digest('hex');
      }
    }
    writeFileSync(
      path.join(repo, MANIFEST_RELATIVE_PATH),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    return repo;
  }

  it('replaces it, because the manifest says it is ours and nobody edited it', () => {
    const repo = repoFromOlderConductor();

    const result = init(repo);

    expect(result.ok).toBe(true);
    expect(result.alreadyInstalled).toBe(false);
    const hook = readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8');
    expect(hook).toMatch(/conductor run --staged --stage commit/);
    expect(
      result.actions.some((action) => action.path.endsWith('pre-commit') && action.kind === 'write')
    ).toBe(true);
    expect(
      result.actions.find((action) => action.path.endsWith('pre-commit'))?.detail
    ).toMatch(/older conductor/);
  });

  it('records the new digest, so a later revert actually removes the hook', () => {
    // The half of the bug nobody sees until they try to uninstall: the old
    // hook was never entered in the manifest, so revert walked past it.
    const repo = repoFromOlderConductor();
    init(repo);

    const hookEntry = manifestOf(repo).files.find((file) => file.kind === 'hook');
    expect(hookEntry?.sha256).toBe(
      createHash('sha256').update(
        readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')
      ).digest('hex')
    );
    // Not the old digest still sitting there because nothing was replaced:
    // that state also satisfies "the manifest matches the file on disk".
    expect(hookEntry?.sha256).not.toBe(createHash('sha256').update(OLD_HOOK).digest('hex'));

    const revert = revertInit({ cwd: repo, pathValue: '' });

    expect(revert.ok).toBe(true);
    expect(existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });

  it('reports the update under --dry-run and writes nothing', () => {
    const repo = repoFromOlderConductor();

    const result = init(repo, { dryRun: true });

    expect(result.ok).toBe(true);
    expect(
      result.actions.find((action) => action.path.endsWith('pre-commit'))?.detail
    ).toMatch(/older conductor/);
    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe(OLD_HOOK);
  });

  it('keeps the policy file in the manifest rather than dropping it on the upgrade', () => {
    // applyInit rebuilds the manifest from what it wrote, and on an upgrade
    // that is the hook alone. Dropping the policy entry would make revert
    // stop knowing about a file init had written.
    const repo = repoFromOlderConductor();
    init(repo);

    const paths = manifestOf(repo).files.map((file) => path.basename(file.path));
    expect(paths).toContain(POLICY_FILE_NAME);
  });

  it('keeps an adopted gate hook recoverable across the upgrade', () => {
    // The manifest is the only copy of the hook --adopt replaced. An
    // upgrade that rebuilt the manifest without it would make the gate's own
    // hook unrestorable, which is the failure the revert rules already name.
    const repo = gitRepo();
    const original = `#!/bin/sh\n# ${DEP_GUARD_HOOK_MARKER}\ndep-guard scan --staged\n`;
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), original);
    init(repo, { adopt: true });

    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), OLD_HOOK);
    const manifest = manifestOf(repo);
    for (const file of manifest.files) {
      if (file.kind === 'hook') {
        file.sha256 = createHash('sha256').update(OLD_HOOK).digest('hex');
      }
    }
    writeFileSync(
      path.join(repo, MANIFEST_RELATIVE_PATH),
      `${JSON.stringify(manifest, null, 2)}\n`
    );

    init(repo);

    expect(manifestOf(repo).adopted?.content).toBe(original);
  });
});

// The hook is already exactly right, so there is nothing to write. The
// manifest is the part that has gone missing, and without it --revert has
// no record that the hook is the umbrella's, so it reports success and
// leaves a hook behind that runs a tool the repository no longer wants.
describe('re-init when the hook is current but the manifest is gone', () => {
  function repoWithLostManifest(): string {
    const repo = gitRepo();
    init(repo);
    // What a "git clean", a deleted .guardrails directory, or an install
    // from before there were manifests leaves behind.
    rmSync(path.join(repo, path.dirname(MANIFEST_RELATIVE_PATH)), {
      recursive: true,
      force: true,
    });
    return repo;
  }

  it('records the hook it found, rather than writing a manifest without it', () => {
    const repo = repoWithLostManifest();

    const result = init(repo);

    expect(result.ok).toBe(true);
    const manifest = JSON.parse(
      readFileSync(path.join(repo, MANIFEST_RELATIVE_PATH), 'utf8')
    ) as { files: Array<{ path: string; sha256: string; kind: string }> };
    const hookEntry = manifest.files.find((file) => file.kind === 'hook');
    expect(hookEntry).toBeDefined();
    expect(hookEntry?.sha256).toBe(
      createHash('sha256')
        .update(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8'))
        .digest('hex')
    );
  });

  it('leaves the hook byte for byte alone while doing it', () => {
    const repo = repoWithLostManifest();
    const before = readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8');

    init(repo);

    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe(before);
  });

  it('makes a later revert actually remove the hook', () => {
    const repo = repoWithLostManifest();
    init(repo);

    const revert = revertInit({ cwd: repo, pathValue: '' });

    expect(revert.ok).toBe(true);
    expect(existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });

  it('writes nothing under --dry-run', () => {
    const repo = repoWithLostManifest();

    const result = init(repo, { dryRun: true });

    expect(result.ok).toBe(true);
    expect(existsSync(path.join(repo, MANIFEST_RELATIVE_PATH))).toBe(false);
  });

  it('still does nothing at all when the manifest already records the hook', () => {
    // The ordinary second run. Nothing is missing, so nothing is rebuilt.
    const repo = gitRepo();
    init(repo);

    const second = init(repo);

    expect(second.alreadyInstalled).toBe(true);
    expect(second.actions.every((action) => action.kind === 'skip')).toBe(true);
  });
});

describe('re-init over a managed hook somebody edited', () => {
  const EDITED = [
    '#!/bin/sh',
    `# Guardrail pre-commit hook. ${MANAGED_HOOK_MARKER}`,
    '# and one line of my own',
    'exit 0',
    '',
  ].join('\n');

  it('refuses rather than silently discarding the edit', () => {
    const repo = gitRepo();
    init(repo);
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), EDITED);

    const result = init(repo);

    expect(result.ok).toBe(false);
    expect(result.conflicts[0].reason).toBe('changed-since-init');
    expect(result.conflicts[0].guidance).toMatch(/--force/);
    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe(EDITED);
  });

  it('replaces it under --force', () => {
    const repo = gitRepo();
    init(repo);
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), EDITED);

    const result = init(repo, { force: true });

    expect(result.ok).toBe(true);
    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toMatch(
      /conductor run --staged --stage commit/
    );
  });

  it('treats a marked hook with no manifest at all the same way', () => {
    // Nothing on disk says this hook is the one conductor wrote, so it is
    // not the umbrella's to overwrite on its own say-so.
    const repo = gitRepo();
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), EDITED);

    const result = init(repo);

    expect(result.ok).toBe(false);
    expect(result.conflicts[0].reason).toBe('changed-since-init');
    expect(existsSync(path.join(repo, POLICY_FILE_NAME))).toBe(false);
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

  it('takes the .guardrails directory with the last file it held', () => {
    const repo = gitRepo();
    init(repo);

    const result = revertInit({ cwd: repo, pathValue: '' });

    expect(result.ok).toBe(true);
    // An empty directory left behind is the one visible trace of a revert
    // that reported it had removed everything.
    expect(existsSync(path.join(repo, '.guardrails'))).toBe(false);
  });

  it('leaves the .guardrails directory when something else is in it', () => {
    const repo = gitRepo();
    init(repo);
    writeFileSync(path.join(repo, '.guardrails', 'notes.txt'), 'somebody else put this here\n');

    const result = revertInit({ cwd: repo, pathValue: '' });

    // "Removes exactly what init wrote, and nothing else" includes the
    // directory: it is only ours while it holds only our files.
    expect(existsSync(path.join(repo, '.guardrails', 'notes.txt'))).toBe(true);

    // And it says so. A directory the tool created and then left behind,
    // with no line about it, reads as something revert forgot rather than
    // as something it decided.
    const kept = result.actions.find((action) => action.path === '.guardrails');
    expect(kept?.kind).toBe('skip');
    expect(kept?.detail).toMatch(/something else/);
    // Still a clean revert: everything of ours is gone.
    expect(result.ok).toBe(true);
  });

  it('does not report the directory at all when it went with the manifest', () => {
    const repo = gitRepo();
    init(repo);

    const result = revertInit({ cwd: repo, pathValue: '' });

    const directory = result.actions.find((action) => action.path === '.guardrails');
    expect(directory?.kind).toBe('remove');
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
    // hook running conductor with nothing to read, so every commit after this
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
    // A plain relative hooksPath, deliberately NOT .husky/_: that one is
    // husky's generated directory and has a redirect of its own, covered
    // below. This case is only about which root a relative path resolves
    // against.
    execFileSync('git', ['config', 'core.hooksPath', 'githooks'], { cwd: repo });

    init(repo);

    // The hook must be where git actually looks. Planting the assertion on
    // a path string would let this test agree with the same mistake the
    // code could make, so the check is whether a commit is refused.
    expect(existsSync(path.join(repo, 'githooks', 'pre-commit'))).toBe(true);

    writeFileSync(path.join(repo, 'change.txt'), 'staged\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const commit = spawnSync(GIT, ['commit', '-m', 'should be refused'], {
      cwd: repo,
      encoding: 'utf8',
      // No conductor on PATH, so the fail-closed branch is what refuses it.
      // git IS on it, so the refusal is about conductor and not about the
      // hook's own inability to look.
      env: { ...process.env, PATH: pathLedBy(shimDirWithGit()) },
    });

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toMatch(/conductor: command not found/);
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

// The DOGFOOD 1 findings, reproduced. husky 9 sets core.hooksPath to
// .husky/_, a generated and gitignored directory it rewrites on every
// install. The file git executes there is a two-line dispatcher that execs
// the TRACKED hook one directory up. Reading the dispatcher reported a real
// vault-guard hook as foreign; writing the dispatcher put the umbrella hook
// somewhere the next install deletes.
//
// Recognition takes all three of: hooks directory named _, parent named
// .husky, and husky's own shim in that directory. The husky 8 suite below
// is the case that says why the third one is required and why the executed
// file's content is not a signal at all.
describe('a husky 9 repository', () => {
  it('detects the tracked hook, not the generated dispatcher, when deciding what is there', () => {
    const repo = huskyRepoWithGateHook();

    const result = init(repo);

    // Before the fix this read .husky/_/pre-commit, saw husky's dispatcher,
    // and called the repository's real vault-guard hook a foreign hook.
    expect(result.ok).toBe(false);
    expect(result.conflicts[0].reason).toBe('gate-hook');
    expect(result.conflicts[0].guidance).toMatch(/vault-guard/);
    expect(result.conflicts[0].path).toBe('.husky/pre-commit');
  });

  it('adopts the tracked hook and leaves the generated dispatcher untouched', () => {
    const repo = huskyRepoWithGateHook();

    const result = init(repo, { adopt: true });

    expect(result.ok).toBe(true);
    expect(result.adoptedFrom?.product).toBe('vault-guard');
    expect(readFileSync(path.join(repo, '.husky', 'pre-commit'), 'utf8')).toContain(
      MANAGED_HOOK_MARKER
    );
    // husky owns everything under _. Writing there is writing into a
    // directory the next install regenerates.
    expect(readFileSync(path.join(repo, '.husky', '_', 'pre-commit'), 'utf8')).toBe(
      HUSKY_DISPATCHER
    );
    const manifest = JSON.parse(
      readFileSync(path.join(repo, MANIFEST_RELATIVE_PATH), 'utf8')
    ) as { adopted: { content: string; path: string } | null };
    expect(manifest.adopted?.content).toBe(TRACKED_VAULT_GUARD_HOOK);
    // endsWith, not equality: the manifest holds git's own worktree root,
    // which is the realpath, and the OS temp directory is behind a symlink.
    expect(manifest.adopted?.path.endsWith(path.join('.husky', 'pre-commit'))).toBe(true);
    expect(manifest.adopted?.path).not.toMatch(/\.husky[/\\]_[/\\]/);
  });

  it('restores the adopted tracked hook byte for byte on revert', () => {
    const repo = huskyRepoWithGateHook();
    init(repo, { adopt: true });

    const result = revertInit({ cwd: repo, pathValue: '' });

    expect(result.ok).toBe(true);
    expect(readFileSync(path.join(repo, '.husky', 'pre-commit'), 'utf8')).toBe(
      TRACKED_VAULT_GUARD_HOOK
    );
    expect(readFileSync(path.join(repo, '.husky', '_', 'pre-commit'), 'utf8')).toBe(
      HUSKY_DISPATCHER
    );
  });

  it('writes the tracked hook, and git runs it through husky dispatcher', () => {
    const repo = huskyRepo();

    init(repo);

    expect(existsSync(path.join(repo, '.husky', 'pre-commit'))).toBe(true);
    expect(readFileSync(path.join(repo, '.husky', '_', 'pre-commit'), 'utf8')).toBe(
      HUSKY_DISPATCHER
    );

    // The assertion that cannot be wrong in the same direction as the code:
    // a real commit, refused by the umbrella hook reached through husky's
    // own two-step dispatch.
    const bin = shimDirWithGit();
    // Announces itself, so the assertion is that OUR hook reached the
    // umbrella rather than that husky failed for some other reason.
    shim(bin, 'conductor', '#!/bin/sh\necho "the umbrella ran: $*" >&2\nexit 1\n');
    writeFileSync(path.join(repo, 'change.txt'), 'staged\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const commit = spawnSync(GIT, ['commit', '-m', 'should be refused'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: pathLedBy(bin) },
    });

    expect(commit.status).not.toBe(0);
    expect(`${commit.stdout}${commit.stderr}`).toMatch(/the umbrella ran: run --staged/);
  });

  // The second half of the same finding. Writing into .husky/_ produced a
  // hook that worked exactly until the next install, and then stopped
  // without a word: the gate reported itself installed and never ran. The
  // regeneration is simulated rather than driven through a real husky, so
  // this suite never needs husky installed to hold the property.
  it('survives the reinstall that rewrites husky generated directory', () => {
    const repo = huskyRepo();
    init(repo);

    // Byte for byte what husky's prepare step writes, on install and on
    // every re-install. Anything the umbrella left under _ is gone now.
    writeHuskyGenerated(repo);

    const bin = shimDirWithGit();
    shim(bin, 'conductor', '#!/bin/sh\necho "the umbrella ran: $*" >&2\nexit 1\n');
    writeFileSync(path.join(repo, 'change.txt'), 'staged\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const commit = spawnSync(GIT, ['commit', '-m', 'still gated after an install'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: pathLedBy(bin) },
    });

    expect(commit.status).not.toBe(0);
    expect(`${commit.stdout}${commit.stderr}`).toMatch(/the umbrella ran: run --staged/);
  });

  it('redirects on the path alone, with no shim in the generated directory', () => {
    // The shim says husky is installed RIGHT NOW. It is not what makes the
    // directory husky's: only husky creates .husky/_, so a repository that
    // has one is husky's whether or not an install has run recently.
    const repo = gitRepo();
    const generated = path.join(repo, '.husky', '_');
    mkdirSync(generated, { recursive: true });
    writeFileSync(path.join(generated, 'pre-commit'), HUSKY_DISPATCHER);
    chmodSync(path.join(generated, 'pre-commit'), 0o755);
    execFileSync('git', ['config', 'core.hooksPath', '.husky/_'], { cwd: repo });

    const result = init(repo);

    expect(result.ok).toBe(true);
    expect(result.hookManager).toBe('husky');
    expect(existsSync(path.join(repo, '.husky', 'pre-commit'))).toBe(true);
    expect(readFileSync(path.join(generated, 'pre-commit'), 'utf8')).toBe(HUSKY_DISPATCHER);
  });

  // The case a shim requirement excluded, and the original trap in its
  // purest form: "git clean -xdf" removes .husky/_ because husky gitignores
  // it, while core.hooksPath=.husky/_ lives in .git/config and survives. So
  // there is no shim, no dispatcher, and nothing in that directory to
  // detect at all, and the next install puts every bit of it back.
  it('redirects when the generated directory has been wiped by a clean', () => {
    const repo = gitRepo();
    mkdirSync(path.join(repo, '.husky'), { recursive: true });
    execFileSync('git', ['config', 'core.hooksPath', '.husky/_'], { cwd: repo });

    const result = init(repo);

    expect(result.ok).toBe(true);
    expect(result.hookManager).toBe('husky');
    expect(existsSync(path.join(repo, '.husky', 'pre-commit'))).toBe(true);
    // Nothing is created in husky's own directory, least of all a hook.
    expect(existsSync(path.join(repo, '.husky', '_'))).toBe(false);
  });

  it('survives the install that repopulates a wiped generated directory', () => {
    const repo = gitRepo();
    mkdirSync(path.join(repo, '.husky'), { recursive: true });
    execFileSync('git', ['config', 'core.hooksPath', '.husky/_'], { cwd: repo });
    init(repo);

    // The install that follows the clean. Under a shim requirement the
    // umbrella hook would be sitting in .husky/_/pre-commit by now, and
    // this line would delete it.
    writeHuskyGenerated(repo);

    const bin = shimDirWithGit();
    shim(bin, 'conductor', '#!/bin/sh\necho "the umbrella ran: $*" >&2\nexit 1\n');
    writeFileSync(path.join(repo, 'change.txt'), 'staged\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const commit = spawnSync(GIT, ['commit', '-m', 'gated after a clean and a reinstall'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: pathLedBy(bin) },
    });

    expect(commit.status).not.toBe(0);
    expect(`${commit.stdout}${commit.stderr}`).toMatch(/the umbrella ran: run --staged/);
  });

  it('does not redirect out of a generated directory that is not husky own', () => {
    // basename _ is not enough either: the parent has to be .husky. Any
    // other hooks directory ending in _ is somebody else's arrangement, and
    // writing to its parent is writing somewhere nobody asked for.
    const repo = gitRepo();
    const generated = path.join(repo, 'hooks', '_');
    mkdirSync(generated, { recursive: true });
    writeFileSync(path.join(generated, 'h'), HUSKY_SHIM);
    chmodSync(path.join(generated, 'h'), 0o755);
    execFileSync('git', ['config', 'core.hooksPath', 'hooks/_'], { cwd: repo });

    const result = init(repo);

    expect(result.ok).toBe(true);
    expect(result.hookManager).toBe('native');
    expect(existsSync(path.join(repo, 'hooks', '_', 'pre-commit'))).toBe(true);
    expect(existsSync(path.join(repo, 'hooks', 'pre-commit'))).toBe(false);
  });
});

// husky 8 is the layout the redirect must NOT fire on, and the one that
// proved content alone is not a safe signal. core.hooksPath is .husky, so
// the file git executes is ALREADY the tracked hook; the `. _/husky.sh`
// line inside it is a preamble, not a dispatcher. Reading it as one made
// init write <repository root>/pre-commit, report success, miss the
// vault-guard hook sitting right there, and let a commit through
// completely ungated.
describe('a husky 8 repository', () => {
  it('takes the native path, so the tracked hook is where init looks', () => {
    const repo = husky8Repo();

    const result = init(repo);

    expect(result.hookManager).toBe('native');
    expect(result.conflicts[0].reason).toBe('gate-hook');
    expect(result.conflicts[0].path).toBe('.husky/pre-commit');
    expect(result.conflicts[0].guidance).toMatch(/vault-guard/);
    // The repository root is not a hooks directory and never gets a hook.
    expect(existsSync(path.join(repo, 'pre-commit'))).toBe(false);
  });

  it('adopts the tracked hook and restores it on revert', () => {
    const repo = husky8Repo();

    const result = init(repo, { adopt: true });

    expect(result.ok).toBe(true);
    expect(result.adoptedFrom?.product).toBe('vault-guard');
    expect(readFileSync(path.join(repo, '.husky', 'pre-commit'), 'utf8')).toContain(
      MANAGED_HOOK_MARKER
    );
    expect(existsSync(path.join(repo, 'pre-commit'))).toBe(false);

    revertInit({ cwd: repo, pathValue: '' });

    expect(readFileSync(path.join(repo, '.husky', 'pre-commit'), 'utf8')).toBe(
      HUSKY_8_TRACKED_HOOK
    );
  });

  it('installs a hook git actually runs, proven by a real commit', () => {
    const repo = husky8Repo();
    rmSync(path.join(repo, '.husky', 'pre-commit'));

    init(repo);

    const bin = shimDirWithGit();
    shim(bin, 'conductor', '#!/bin/sh\necho "the umbrella ran: $*" >&2\nexit 1\n');
    writeFileSync(path.join(repo, 'change.txt'), 'staged\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const commit = spawnSync(GIT, ['commit', '-m', 'should be refused'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: pathLedBy(bin) },
    });

    expect(commit.status).not.toBe(0);
    expect(`${commit.stdout}${commit.stderr}`).toMatch(/the umbrella ran: run --staged/);
  });
});

describe('a dispatcher-shaped hook in the ordinary hooks directory', () => {
  it('is a foreign hook, not a reason to write somewhere else', () => {
    // No core.hooksPath at all, so hooks live in .git/hooks. A file there
    // that happens to source a sibling named h is somebody's own script:
    // the parent of .git/hooks is .git, and nothing may be written there.
    const repo = gitRepo();
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), HUSKY_DISPATCHER);

    const result = init(repo);

    expect(result.ok).toBe(false);
    expect(result.hookManager).toBe('native');
    expect(result.conflicts[0].reason).toBe('foreign-hook');
    // Suffix, not equality: with no core.hooksPath set, the hooks directory
    // is resolved against cwd while the root comes from git, and on a
    // machine whose temp directory is behind a symlink those disagree, so
    // the reported path walks back out through the symlink. Pre-existing
    // and cosmetic, reported rather than changed here.
    expect(result.conflicts[0].path.endsWith('.git/hooks/pre-commit')).toBe(true);
    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe(
      HUSKY_DISPATCHER
    );
    expect(existsSync(path.join(repo, '.git', 'pre-commit'))).toBe(false);
  });
});

describe('other hook managers that install a generated hook', () => {
  it.each([
    ['lefthook', LEFTHOOK_GENERATED, /lefthook-local\.yml/],
    ['the pre-commit framework', PRE_COMMIT_FRAMEWORK_GENERATED, /\.pre-commit-config\.yaml/],
  ])('refuses to write over %s own generated hook', (_name, content, guidance) => {
    const repo = gitRepo();
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), content);

    const result = init(repo);

    expect(result.ok).toBe(false);
    expect(result.conflicts[0].reason).toBe('generated-hook');
    expect(result.conflicts[0].guidance).toMatch(guidance);
    // Untouched: that file is regenerated by its manager, so anything
    // written into it is lost on the next install anyway.
    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe(content);
    expect(existsSync(path.join(repo, POLICY_FILE_NAME))).toBe(false);
  });

  it.each([
    ['lefthook', LEFTHOOK_GENERATED],
    ['the pre-commit framework', PRE_COMMIT_FRAMEWORK_GENERATED],
  ])('does not replace %s generated hook even with --adopt', (_name, content) => {
    const repo = gitRepo();
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), content);

    const result = init(repo, { adopt: true });

    expect(result.ok).toBe(false);
    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe(content);
  });
});

// The two cases above use hand-written approximations of what these tools
// generate, which proves only that the code agrees with whoever wrote the
// approximation. These use the file each tool actually produced on a real
// install, captured in a scratch repository. See tests/fixtures/hooks.
describe('generated hooks captured from a real install', () => {
  function capturedHook(name: string): string {
    return readFileSync(path.join(HOOK_FIXTURES, name), 'utf8');
  }

  it.each([
    ['lefthook 2.1.12', 'lefthook-2.1.12-pre-commit.sh', 'lefthook', /lefthook-local\.yml/],
    ['lefthook 1.7.18', 'lefthook-1.7.18-pre-commit.sh', 'lefthook', /lefthook-local\.yml/],
    [
      'pre-commit 4.6.2',
      'pre-commit-4.6.2-pre-commit.sh',
      'precommit',
      /\.pre-commit-config\.yaml/,
    ],
  ])('classifies the hook %s really wrote', (_name, fixture, manager, guidance) => {
    const repo = gitRepo();
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), capturedHook(fixture));

    const result = init(repo);

    expect(result.ok).toBe(false);
    expect(result.hookManager).toBe(manager);
    expect(result.conflicts[0].reason).toBe('generated-hook');
    expect(result.conflicts[0].guidance).toMatch(guidance);
    expect(existsSync(path.join(repo, POLICY_FILE_NAME))).toBe(false);
  });

  it('recognises lefthook without the version stamp, which no live version writes', () => {
    // The finding this whole describe block exists for. init.ts matched on
    // "lefthook_version:" OR "call_lefthook", and the first of those appears
    // in neither version's generated hook, nor anywhere in the 2.1.12
    // binary. Only the second is doing any work, so it has to keep working
    // on its own.
    for (const fixture of ['lefthook-2.1.12-pre-commit.sh', 'lefthook-1.7.18-pre-commit.sh']) {
      expect(capturedHook(fixture)).not.toMatch(/lefthook_version:/);
      expect(capturedHook(fixture)).toMatch(/call_lefthook/);
    }
  });

  it('finds the pre-commit framework marker line exactly as init.ts spells it', () => {
    expect(capturedHook('pre-commit-4.6.2-pre-commit.sh')).toContain(
      'File generated by pre-commit: https://pre-commit.com'
    );
  });
});

describe('the generated hook', () => {
  it('fails closed when the umbrella binary is missing, and blocks the commit', () => {
    const repo = gitRepo();
    init(repo);

    writeFileSync(path.join(repo, 'change.txt'), 'staged\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const commit = spawnSync(GIT, ['commit', '-m', 'no conductor installed'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: pathLedBy(shimDirWithGit()) },
    });

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toMatch(/NOT checked/);
    expect(commit.stderr).toMatch(/conductor: command not found/);
  });

  it('says git is missing rather than blaming conductor, when git is missing', () => {
    const repo = gitRepo();
    init(repo);
    // Present, and unreachable without git: the hook has to find the root
    // before it can look here.
    shim(path.join(repo, 'node_modules', '.bin'), 'conductor', '#!/bin/sh\nexit 0\n');

    // The hook is run directly rather than through a commit, and that is
    // the only way to reach this case: git prepends its own exec-path to a
    // hook's PATH and there is a git binary in it, so a hook git itself
    // invokes can always find git no matter what PATH says. A hook invoked
    // by hand, or by a runner that is not git, has no such guarantee.
    const run = spawnSync(path.join(repo, '.git', 'hooks', 'pre-commit'), [], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: tempDir() },
    });

    // Without git the hook cannot find the repository root, so it cannot
    // look in node_modules/.bin, so the conductor sitting right there is
    // invisible. Reporting that as "conductor not found" names a symptom
    // and sends the reader off to reinstall a tool they already have.
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/conductor: git is not on this hook's PATH/);
    expect(run.stderr).toMatch(/NOT checked/);
    // One line, so a hook's output stays readable in a terminal.
    expect(run.stderr.trim().split('\n')).toHaveLength(1);
  });

  // DOGFOOD 1, finding 3. The hook ran a bare "command -v conductor", so a
  // conductor installed only as a devDependency of the repository was
  // invisible to its own hook and every commit reported the umbrella
  // missing. husky's dispatcher prepends node_modules/.bin for exactly this
  // reason; this hook has to do it for itself, since it also runs under
  // plain .git/hooks where nothing prepends anything.
  it('finds a conductor installed only as a project devDependency', () => {
    const repo = gitRepo();
    init(repo);
    shim(
      path.join(repo, 'node_modules', '.bin'),
      'conductor',
      '#!/bin/sh\necho "the umbrella ran: $*" >&2\nexit 1\n'
    );

    writeFileSync(path.join(repo, 'change.txt'), 'staged\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const commit = spawnSync(GIT, ['commit', '-m', 'blocked by the local install'], {
      cwd: repo,
      encoding: 'utf8',
      // No conductor anywhere on PATH. The only copy is the project's own.
      env: { ...process.env, PATH: pathLedBy(shimDirWithGit()) },
    });

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toMatch(/the umbrella ran: run --staged/);
    expect(commit.stderr).toMatch(/conductor: a gate blocked this commit/);
    // The fail-closed branch must not be what refused this commit: that
    // would be the right exit code for the wrong reason.
    expect(commit.stderr).not.toMatch(/command not found/);
  });

  it('asks git for the root rather than assuming the hook runs from it', () => {
    const repo = gitRepo();
    init(repo);
    shim(path.join(repo, 'node_modules', '.bin'), 'conductor', '#!/bin/sh\nexit 1\n');
    mkdirSync(path.join(repo, 'packages', 'app'), { recursive: true });

    // A relative "node_modules/.bin" points at nothing from here. git runs
    // a pre-commit hook from the top level today, but a hook invoked by
    // hand or by another manager can start anywhere.
    const run = spawnSync(path.join(repo, '.git', 'hooks', 'pre-commit'), [], {
      cwd: path.join(repo, 'packages', 'app'),
      encoding: 'utf8',
      env: { ...process.env, PATH: pathLedBy(shimDirWithGit()) },
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/conductor: a gate blocked this commit/);
    expect(run.stderr).not.toMatch(/command not found/);
  });

  it('still fails closed when there is no conductor in node_modules either', () => {
    const repo = gitRepo();
    init(repo);
    mkdirSync(path.join(repo, 'node_modules', '.bin'), { recursive: true });

    writeFileSync(path.join(repo, 'change.txt'), 'staged\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const commit = spawnSync(GIT, ['commit', '-m', 'no conductor anywhere'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: pathLedBy(shimDirWithGit()) },
    });

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toMatch(/NOT checked/);
  });

  it('says why a commit was blocked even when run under sh -e, as husky runs it', () => {
    const repo = huskyRepo();
    init(repo);
    shim(path.join(repo, 'node_modules', '.bin'), 'conductor', '#!/bin/sh\nexit 2\n');

    writeFileSync(path.join(repo, 'change.txt'), 'staged\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    const commit = spawnSync(GIT, ['commit', '-m', 'a gate could not run'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: pathLedBy(shimDirWithGit()) },
    });

    expect(commit.status).not.toBe(0);
    // husky's shim runs the tracked hook as "sh -e", under which a hook
    // that captures $? after the failing command exits before it can print
    // anything. The exit code survives that; the explanation does not, and
    // a blocked commit with no reason on screen is the failure this line
    // exists to prevent.
    expect(`${commit.stdout}${commit.stderr}`).toMatch(/conductor: a gate could not run/);
  });

  it('passes the umbrella exit code through unchanged', () => {
    const repo = gitRepo();
    init(repo);
    const bin = tempDir();
    shim(bin, 'conductor', '#!/bin/sh\nexit 2\n');

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
    shim(bin, 'conductor', '#!/bin/sh\nexit 0\n');

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

/**
 * What the hook SAYS, taken from running the generated script rather than
 * from reading the template.
 *
 * A stub conductor that exits with a chosen code is the whole fixture: the
 * hook's own two branches are shell, and the only honest test of shell is to
 * run it. Asserting on the template's text would pass just as happily on a
 * message that never reaches a terminal.
 */
describe('what the generated hook says about each exit code', () => {
  function hookOutput(exitCode: number): string {
    const repo = gitRepo();
    init(repo);
    const bin = tempDir();
    shim(bin, 'conductor', `#!/bin/sh\nexit ${exitCode}\n`);

    const run = spawnSync(path.join(repo, '.git', 'hooks', 'pre-commit'), [], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    return `${run.stdout ?? ''}${run.stderr ?? ''}`;
  }

  it('says nothing at all on exit 0', () => {
    expect(hookOutput(0).trim()).toBe('');
  });

  it('says a gate blocked on exit 1, and where to record a disagreement', () => {
    const output = hookOutput(1);

    expect(output).toMatch(/conductor: a gate blocked this commit/);
    expect(output).toMatch(/report above/);
    // The escape a gate already has is a recorded one. An allow entry, an
    // ignore path, a baseline, or enforce: false all leave a reviewable
    // trace of the decision in the repository.
    expect(output).toMatch(/\.guardrails\.yaml/);
  });

  it('says nothing was checked on exit 2, rather than calling it a blocked commit', () => {
    // Exit 2 means a gate could not run, so nothing was looked at. Calling
    // that "commit blocked" reports findings that were never looked for,
    // which is the exact confusion the exit-code split exists to prevent.
    const output = hookOutput(2);

    expect(output).toMatch(/conductor: a gate could not run/);
    expect(output).toMatch(/NOTHING was checked/);
    expect(output).not.toMatch(/blocked/);
  });

  it('advertises no bypass, in any branch of the hook it writes', () => {
    // Every gate already has a recorded, reviewable, scoped escape. A
    // bypass flag skips every gate invisibly, including the ones that would
    // have caught something unrelated to the finding somebody disagreed
    // with, and it leaves no trace of the decision anywhere.
    const native = gitRepo();
    init(native);
    const husky = huskyRepo();
    init(husky);

    for (const hookPath of [
      path.join(native, '.git', 'hooks', 'pre-commit'),
      path.join(husky, '.husky', 'pre-commit'),
    ]) {
      expect(readFileSync(hookPath, 'utf8')).not.toMatch(/no-verify/);
    }
  });
});

/**
 * The hooks already installed in real repositories, upgraded in place.
 *
 * Changing the hook body makes every hook a previous conductor wrote into
 * one "from an older conductor". The upgrade path decides that by digest, so
 * this is a test of the REAL previous body rather than a synthetic stand-in:
 * the fixture is byte for byte what v0.2 wrote into those repositories.
 */
describe('re-init over the hook body v0.2 actually shipped', () => {
  const V02_HOOK = readFileSync(
    path.join(HOOK_FIXTURES, 'conductor-0.2.0-pre-commit.sh'),
    'utf8'
  );

  function repoRunningTheOldBody(): string {
    const repo = gitRepo();
    init(repo);
    const hookPath = path.join(repo, '.git', 'hooks', 'pre-commit');
    writeFileSync(hookPath, V02_HOOK);

    const manifest = JSON.parse(
      readFileSync(path.join(repo, MANIFEST_RELATIVE_PATH), 'utf8')
    ) as { files: Array<{ path: string; sha256: string; kind: string }> };
    for (const file of manifest.files) {
      if (file.kind === 'hook') {
        file.sha256 = createHash('sha256').update(V02_HOOK).digest('hex');
      }
    }
    writeFileSync(
      path.join(repo, MANIFEST_RELATIVE_PATH),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    return repo;
  }

  it('is the previous body, not the current one', () => {
    // The guard on the whole block. If this fixture ever drifts into being
    // what init writes today, every assertion below passes for the wrong
    // reason.
    const repo = gitRepo();
    init(repo);
    expect(readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).not.toBe(
      V02_HOOK
    );
    expect(V02_HOOK).toMatch(new RegExp(MANAGED_HOOK_MARKER));
  });

  it('reports the update rather than refusing it as a hand-edited hook', () => {
    const repo = repoRunningTheOldBody();

    const result = init(repo);

    expect(result.ok).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.actions.find((action) => action.path.endsWith('pre-commit'))?.detail).toMatch(
      /older conductor/
    );
  });

  it('leaves the new message in place of the old one', () => {
    const repo = repoRunningTheOldBody();
    init(repo);

    const hook = readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf8');
    expect(hook).toMatch(/a gate blocked this commit/);
    expect(hook).not.toMatch(/no-verify/);
  });
});
