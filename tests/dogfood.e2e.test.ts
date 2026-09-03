// The end-to-end test: a real clone, the real three gates, a real commit.
//
// Everything else in this suite proves one piece against a fixture. This
// proves the pieces compose, which is the only place a cross-piece
// disagreement can show up: a policy file init wrote, parsed by the loader,
// resolved to binaries, run as children, normalized, reported, composed
// into an exit code, and acted on by a hook git actually invoked.
//
// It skips rather than fails when the sibling checkouts are not present, so
// a clone of this repository alone still has a green suite. When it skips,
// nothing in this file has been proven, and the skip message says which
// piece was missing rather than reading as a pass.

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONDUCTOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONDUCTOR_CLI = path.join(CONDUCTOR_ROOT, 'dist', 'cli.js');

// Sibling checkouts, resolved relative to this repository rather than from
// an absolute path, so no machine layout is written down here.
const SIBLINGS = path.resolve(CONDUCTOR_ROOT, '..');
const DEP_GUARD_REPO = path.join(SIBLINGS, 'dep-guard');
const DEP_GUARD_CLI = path.join(DEP_GUARD_REPO, 'packages', 'cli', 'dist', 'cli.js');
const DEP_GUARD_CORPUS = path.join(DEP_GUARD_REPO, '.corpus-work', 'corpus');
const INTENT_GUARD_CLI = path.join(
  SIBLINGS,
  'intent-guard',
  'packages',
  'cli',
  'dist',
  'intent-guard.js'
);
function vaultGuardOnPath(): string | null {
  const found = spawnSync('sh', ['-c', 'command -v vault-guard'], { encoding: 'utf8' });
  const value = (found.stdout ?? '').trim();
  return found.status === 0 && value.length > 0 ? value : null;
}

const VAULT_GUARD = vaultGuardOnPath();

const missing = [
  existsSync(CONDUCTOR_CLI) ? null : 'the umbrella is not built (run pnpm build)',
  existsSync(DEP_GUARD_REPO) ? null : 'no dep-guard checkout beside this repository',
  existsSync(DEP_GUARD_CLI) ? null : 'dep-guard is not built',
  existsSync(DEP_GUARD_CORPUS) ? null : 'dep-guard has no locally built corpus',
  existsSync(INTENT_GUARD_CLI) ? null : 'no intent-guard build beside this repository',
  VAULT_GUARD === null ? 'no vault-guard on PATH' : null,
].filter((entry): entry is string => entry !== null);

const describeE2E = missing.length === 0 ? describe : describe.skip;

// The scratch parent is overridable so a session can point it at its own
// scratch area; the default is the OS temp directory, never anywhere near
// the checkouts being read.
const SCRATCH_PARENT = process.env.CONDUCTOR_SCRATCH_DIR ?? os.tmpdir();

let clone = '';
let binDir = '';
let env: NodeJS.ProcessEnv = {};

function shim(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, body);
  chmodSync(file, 0o755);
}

function git(args: string[], options: { cwd?: string } = {}): string {
  return execFileSync('git', args, {
    cwd: options.cwd ?? clone,
    encoding: 'utf8',
  });
}

function conductor(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CONDUCTOR_CLI, ...args], {
    cwd: clone,
    encoding: 'utf8',
    env,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

describeE2E('dogfood: a real clone, the real gates, a real commit', () => {
  beforeAll(() => {
    mkdirSync(SCRATCH_PARENT, { recursive: true });
    const scratch = mkdtempSync(path.join(SCRATCH_PARENT, 'conductor-dogfood-'));
    clone = path.join(scratch, 'clone');
    binDir = path.join(scratch, 'bin');

    // A real clone of a real guard repository. Untracked things (its
    // node_modules, its corpus) do not come along, which is what makes the
    // clone a fair test of resolution.
    // No --depth: git ignores it for a local clone and warns about it, and
    // a warning in a test log is a thing people learn to skip past.
    execFileSync('git', ['clone', '--quiet', DEP_GUARD_REPO, clone]);
    git(['config', 'user.email', 'dogfood@example.com']);
    git(['config', 'user.name', 'Dogfood']);

    shim(binDir, 'conductor', `#!/bin/sh\nexec ${process.execPath} ${CONDUCTOR_CLI} "$@"\n`);
    shim(binDir, 'dep-guard', `#!/bin/sh\nexec ${process.execPath} ${DEP_GUARD_CLI} "$@"\n`);
    shim(binDir, 'vault-guard', `#!/bin/sh\nexec ${VAULT_GUARD as string} "$@"\n`);
    // intent-guard is deliberately NOT shimmed. It is the unpublished one,
    // and reaching it through the policy file's absolute "command:" is the
    // case that override exists for.

    env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` };
  });

  afterAll(() => {
    if (clone !== '') {
      rmSync(path.dirname(clone), { recursive: true, force: true });
    }
  });

  it('init writes one policy file and one hook, and enables what it found', () => {
    const result = conductor(['init']);

    expect(result.status).toBe(0);
    expect(existsSync(path.join(clone, '.guardrails.yaml'))).toBe(true);
    expect(existsSync(path.join(clone, '.git', 'hooks', 'pre-commit'))).toBe(true);

    const policy = readFileSync(path.join(clone, '.guardrails.yaml'), 'utf8');
    expect(policy).toMatch(/dependencies:\n\s+product: dep-guard\n\s+enabled: true/);
    expect(policy).toMatch(/secrets:\n\s+product: vault-guard\n\s+enabled: true/);
    // Not on PATH and not in node_modules/.bin, so init leaves it off and
    // says why rather than silently switching on a gate that is not there.
    expect(policy).toMatch(/intent:\n\s+product: intent-guard\n\s+enabled: false/);
  });

  it('reaches the unpublished gate through an absolute command in the policy', () => {
    // The dependency gate needs a corpus this clone does not carry, and the
    // intent gate needs a build that is not installed anywhere. Both are
    // expressed in the policy: one as a passthrough flag, one as a command
    // override.
    writeFileSync(
      path.join(clone, '.guardrails.yaml'),
      [
        'version: 1',
        'gates:',
        '  dependencies:',
        '    product: dep-guard',
        '    enabled: true',
        '    options:',
        `      corpus-dir: ${DEP_GUARD_CORPUS}`,
        '  secrets:',
        '    product: vault-guard',
        '    enabled: true',
        '  intent:',
        '    product: intent-guard',
        '    enabled: true',
        `    command: ${INTENT_GUARD_CLI}`,
        '',
        'report:',
        '  format: text',
        '',
      ].join('\n')
    );

    // A frozen contract with a change budget, so the intent gate has
    // something real to enforce.
    execFileSync(process.execPath, [INTENT_GUARD_CLI, 'init', '--project', '.'], { cwd: clone });
    execFileSync(
      process.execPath,
      [
        INTENT_GUARD_CLI,
        'extract',
        '--project',
        '.',
        '--text',
        'Update the readme only. Do not add dependencies. Do not touch source files.',
      ],
      { cwd: clone }
    );
    execFileSync(
      process.execPath,
      [INTENT_GUARD_CLI, 'freeze', '--project', '.', '--approved-by', 'dogfood'],
      { cwd: clone }
    );
    const contractPath = path.join(clone, '.conductor', 'intent-contract.yaml');
    writeFileSync(
      contractPath,
      readFileSync(contractPath, 'utf8').replace(
        'constraints: []',
        'constraints: []\nbudget:\n  allow_new_dependencies: false\n  max_files: 1'
      )
    );

    const result = conductor(['run']);
    // Not a clean run, but it ran: every gate resolved and answered.
    expect(result.stdout).toMatch(/dep-guard/);
    expect(result.stdout).toMatch(/vault-guard/);
    expect(result.stdout).toMatch(/intent-guard/);
    expect(result.stdout).not.toMatch(/DID NOT RUN/);
  });

  it('refuses the commit when a fake secret and a hallucinated dependency are staged', () => {
    const manifestPath = path.join(clone, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    manifest.dependencies = { ...(manifest.dependencies ?? {}), lodahs: '1.0.0' };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    // Fabricated. Matches the shape of a GitHub token and no real account.
    writeFileSync(
      path.join(clone, 'leak.js'),
      "const token = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';\nmodule.exports = token;\n"
    );

    git(['add', 'package.json', 'leak.js']);

    const commit = spawnSync('git', ['commit', '-m', 'this should not land'], {
      cwd: clone,
      encoding: 'utf8',
      env,
    });

    expect(commit.status).not.toBe(0);
    // The hook ran the umbrella, and the umbrella refused.
    expect(`${commit.stdout}${commit.stderr}`).toMatch(/conductor: a gate blocked this commit/);
  });

  it('names the right findings in the text report', () => {
    const result = conductor(['run', '--staged']);

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/dep-guard\/typosquat/);
    expect(result.stdout).toMatch(/lodahs/);
    expect(result.stdout).toMatch(/vault-guard\/github-token/);
    expect(result.stdout).toMatch(/leak\.js:1:/);
    expect(result.stdout).toMatch(/intent-guard\/budget\.allow_new_dependencies/);
    expect(result.stdout).toMatch(/verdict: exit 1/);
  });

  it('names the right findings in the SARIF log, one run per gate', () => {
    const result = conductor(['run', '--staged', '--format', 'sarif']);

    expect(result.status).toBe(1);
    const log = JSON.parse(result.stdout) as {
      version: string;
      runs: Array<{
        tool: { driver: { name: string; version?: string } };
        results: Array<{
          ruleId: string;
          partialFingerprints?: Record<string, string>;
          properties: Record<string, unknown>;
        }>;
      }>;
    };

    expect(log.version).toBe('2.1.0');
    expect(log.runs.map((run) => run.tool.driver.name)).toEqual([
      'dep-guard',
      'vault-guard',
      'intent-guard',
    ]);
    for (const run of log.runs) {
      // Read from each binary's own --version, so this must be a real
      // version rather than a placeholder.
      expect(run.tool.driver.version).toMatch(/^\d+\.\d+\.\d+/);
    }

    const ruleIds = log.runs.flatMap((run) => run.results.map((entry) => entry.ruleId));
    expect(ruleIds).toContain('dep-guard/typosquat');
    expect(ruleIds).toContain('vault-guard/github-token');
    expect(ruleIds).toContain('intent-guard/budget.allow_new_dependencies');

    const secret = log.runs[1].results[0];
    expect(Object.keys(secret.partialFingerprints ?? {})).toEqual(['vault-guard/v1']);
    expect(secret.properties.blocking).toBe(true);
  });

  it('reports a missing enabled gate as a blocking finding and exits 2', () => {
    // The same policy, run with a PATH that has neither shim on it. The
    // intent gate still runs, because its absolute command does not depend
    // on PATH; the other two are enabled and absent. A silent skip here is
    // the whole failure mode this umbrella exists to avoid.
    const emptyDir = path.join(path.dirname(binDir), 'empty');
    mkdirSync(emptyDir, { recursive: true });
    const result = spawnSync(process.execPath, [CONDUCTOR_CLI, 'run', '--staged'], {
      cwd: clone,
      encoding: 'utf8',
      env: { ...env, PATH: emptyDir },
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/conductor\/gate-missing/);
    expect(result.stdout).toMatch(/DID NOT RUN/);
    expect(result.stdout).toMatch(/verdict: exit 2/);
  });

  it('reverts the hook but leaves the hand-edited policy file, and says so', () => {
    git(['reset', '--quiet']);
    rmSync(path.join(clone, 'leak.js'), { force: true });
    git(['checkout', '--', 'package.json']);

    // The policy file was rewritten by hand earlier in this file, so this is
    // a PARTIAL revert: the hook goes, the edited file stays, and the exit
    // code says something was left behind rather than reporting success.
    const result = conductor(['init', '--revert']);

    expect(result.status).toBe(2);
    expect(existsSync(path.join(clone, '.git', 'hooks', 'pre-commit'))).toBe(false);
    expect(existsSync(path.join(clone, '.guardrails.yaml'))).toBe(true);
    expect(result.stderr).toMatch(/changed since init, left alone/);
    // The manifest survives, still describing what is left.
    expect(existsSync(path.join(clone, '.guardrails', 'manifest.json'))).toBe(true);
  });

  it('finishes the job under --force', () => {
    const result = conductor(['init', '--revert', '--force']);

    expect(result.status).toBe(0);
    expect(existsSync(path.join(clone, '.guardrails.yaml'))).toBe(false);
    expect(existsSync(path.join(clone, '.guardrails', 'manifest.json'))).toBe(false);
  });
});

if (missing.length > 0) {
  // Not a silent skip: a skipped end-to-end test that reads as a pass is
  // the same problem as a gate that is switched on and not installed.
  // eslint-disable-next-line no-console
  console.warn(`dogfood e2e skipped: ${missing.join('; ')}`);
}
