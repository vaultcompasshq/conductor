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

import { NATIVE_CONTRACT_PATHS } from '../src/intent-prepare.js';
import { childEnv, shimGit } from './helpers/child-env.js';

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

/**
 * The contract the sibling intent-guard just froze, under whichever of its
 * two state-directory names that build uses.
 *
 * This suite runs against WHATEVER intent-guard is checked out beside this
 * repository, which is the whole point of it, so it cannot assume a version.
 * 1.3.0 renamed the directory from `.conductor` to `.intent-guard`; a
 * checkout on either side of that rename has to leave this suite green, or
 * the suite stops being evidence about the umbrella and starts being a
 * reading of the sibling's version number. Canonical first, matching the
 * order the umbrella itself uses. Throwing names both, because "no such
 * file" on one guessed path is the least useful way to learn this.
 */
function frozenContractIn(projectRoot: string): string {
  // The pair comes from the source rather than being spelled again here, so
  // "every consumer reads NATIVE_CONTRACT_PATHS" stays a fact about the
  // repository rather than a claim in a document.
  const candidates = NATIVE_CONTRACT_PATHS.map((relative) => path.join(projectRoot, relative));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      `intent-guard froze no contract this suite can find. Looked for: ${candidates.join(', ')}`
    );
  }
  return found;
}

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

    // The guard repositories now run the umbrella over themselves, so the
    // one cloned here tracks its own .guardrails.yaml. This suite is the
    // FRESH ADOPTION case: it asserts what init writes into a repository
    // that has none, and init deliberately never rewrites a policy file it
    // finds. Without this the clone arrives with the sibling's committed
    // policy, the assertion about what init enabled reads that file instead
    // of one init wrote, and the revert tests then run against a manifest
    // that never recorded a policy file at all.
    //
    // Removed by commit rather than by deleting the file, so the clone is a
    // clean tree and the later tests can stage and revert against it. The
    // existence check is for the day the sibling stops tracking one: nothing
    // to remove is the state this wants, not a reason to fail in beforeAll.
    if (existsSync(path.join(clone, '.guardrails.yaml'))) {
      git(['rm', '--quiet', '.guardrails.yaml']);
      git(['commit', '--quiet', '-m', 'dogfood fixture: start from no policy file']);
    }

    shim(binDir, 'conductor', `#!/bin/sh\nexec ${process.execPath} ${CONDUCTOR_CLI} "$@"\n`);
    shim(binDir, 'dep-guard', `#!/bin/sh\nexec ${process.execPath} ${DEP_GUARD_CLI} "$@"\n`);
    shim(binDir, 'vault-guard', `#!/bin/sh\nexec ${VAULT_GUARD as string} "$@"\n`);
    // intent-guard is deliberately NOT shimmed. It is the unpublished one,
    // and reaching it through the policy file's absolute "command:" is the
    // case that override exists for.

    // node and git are SHIMMED here rather than reached by putting their own
    // directories on PATH, and that is the whole point of the arrangement
    // below. See the PATH comment.
    shim(binDir, 'node', `#!/bin/sh\nexec ${process.execPath} "$@"\n`);
    const gitBinary = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    shim(binDir, 'git', `#!/bin/sh\nexec ${gitBinary} "$@"\n`);

    // CONSTRUCTED, never inherited, and it is exactly one directory: the one
    // this test filled itself.
    //
    // Prepending to the developer's own PATH made this suite's verdict
    // depend on that developer's machine. The assertion below that init
    // leaves the intent gate off is a claim that intent-guard is not
    // findable, and it held only while nobody happened to have intent-guard
    // installed. Somebody does, so the suite went red on main over a fact
    // about a laptop rather than about the code.
    //
    // Naming the node and git directories instead of inheriting is not
    // enough either, and the reason is worth writing down because it is the
    // same mistake one step further in: a global npm install puts its bin
    // symlink in THE SAME DIRECTORY AS NODE. On the machine that found this,
    // intent-guard sits beside node in an nvm bin directory, so adding "the
    // node directory" to PATH re-adds intent-guard and the test is
    // machine-dependent again. /usr/bin, where git lives, is a shared
    // directory with the same property in principle.
    //
    // So every entry on this PATH is a file this test wrote: the three gate
    // shims, the umbrella, node, and git. "intent-guard is not findable" is
    // then true by construction, and stays true on any machine, because
    // there is nowhere for it to be.
    env = childEnv(binDir);
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
    // Not on PATH and not in node_modules/.bin, which is now true BY
    // CONSTRUCTION: the child's PATH is built from three named directories
    // and intent-guard is in none of them. init leaves it off and says why
    // rather than silently switching on a gate that is not there.
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
    const contractPath = frozenContractIn(clone);
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
    // The same policy, run with a PATH that has neither gate shim on it. The
    // intent gate still runs, because its absolute command does not depend
    // on PATH; the other two are enabled and absent. A silent skip here is
    // the whole failure mode this umbrella exists to avoid.
    //
    // git IS on that PATH, and nothing else is. The CLI needs it to find the
    // working-tree root and says so plainly when it is missing, so without
    // the shim this test would exit 2 over git and never reach the question
    // it is about.
    const emptyDir = path.join(path.dirname(binDir), 'empty');
    mkdirSync(emptyDir, { recursive: true });
    shimGit(emptyDir);
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

  /**
   * Pull-request mode, against the real gates and a real branch.
   *
   * The block above left the clone with no policy file and no hook, which is
   * where this starts. It commits an honest policy and the contract frozen
   * earlier as the BASE, then commits the attack as the head: the policy
   * rewritten to point the secrets gate's `command:` at a script the same
   * commit adds, the dependency gate switched off, a fabricated secret, and
   * the frozen contract's approval rewritten to name the pull request itself.
   *
   * The attacker's script writes a marker file, so "did the pull request's
   * own code run on the runner" is answered by looking on disk rather than by
   * reading a command line. This is the case the whole release exists for and
   * the one thing in this file no unit test can stand in for: every stub in
   * the suite prints what the test told it to, and the question here is what
   * a real intent-guard, a real vault-guard and a real dep-guard do when the
   * rules are taken away from the tree they are judging.
   */
  describe('a pull request that rewrites the rules it is judged by', () => {
    let marker = '';
    let attacker = '';

    beforeAll(() => {
      marker = path.join(path.dirname(clone), 'attacker-ran.txt');

      // The base: an honest policy, and the contract frozen earlier in this
      // file, which is still on disk.
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
          '    enforce: false',
          '',
        ].join('\n')
      );
      git(['add', '-A']);
      git(['commit', '--quiet', '-m', 'base: an honest policy and a frozen contract']);
      git(['branch', '-f', 'trust-base-fixture']);

      // The pull request.
      attacker = path.join(clone, 'tools', 'nice-gate.sh');
      shim(
        path.dirname(attacker),
        'nice-gate.sh',
        [
          '#!/bin/sh',
          `printf 'ran\\n' > ${JSON.stringify(marker)}`,
          `echo '{"version":"1","summary":{"files":0,"secrets":0},"run":{"files_scanned":0,"patterns_active":0,"fail_on":"medium","blocking_matches":0},"results":[]}'`,
          'exit 0',
        ].join('\n') + '\n'
      );
      writeFileSync(
        path.join(clone, '.guardrails.yaml'),
        [
          'version: 1',
          'gates:',
          '  dependencies:',
          '    product: dep-guard',
          '    enabled: false',
          '  secrets:',
          '    product: vault-guard',
          '    enabled: true',
          `    command: ${attacker}`,
          '    args: []',
          '  intent:',
          '    product: intent-guard',
          '    enabled: true',
          `    command: ${INTENT_GUARD_CLI}`,
          '    enforce: false',
          '',
        ].join('\n')
      );
      // Fabricated. The shape of a GitHub token and no real account.
      writeFileSync(
        path.join(clone, 'leak.js'),
        "const token = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';\nmodule.exports = token;\n"
      );
      // And the contract's approval rewritten to name the pull request.
      const contractPath = frozenContractIn(clone);
      writeFileSync(
        contractPath,
        readFileSync(contractPath, 'utf8').replace(/approved_by: .*/, 'approved_by: this branch')
      );
      git(['add', '-A']);
      git(['commit', '--quiet', '-m', 'feat: a helpful refactor']);
    });

    it('runs the pull request own script when no trust base is passed, which is the hole', () => {
      rmSync(marker, { force: true });

      const result = conductor(['run']);

      expect(existsSync(marker)).toBe(true);
      expect(result.stdout).not.toMatch(/vault-guard\/github-token/);
      expect(result.stdout).not.toMatch(/dependencies\s+dep-guard/);
    });

    it('never runs it with a trust base, and the real gates report what it hid', () => {
      rmSync(marker, { force: true });

      const result = conductor(['run', '--trust-base', 'trust-base-fixture', '--verbose']);

      expect(existsSync(marker)).toBe(false);
      // The base policy's gates, including the one the pull request switched
      // off, and the secret its own gate would have swallowed.
      expect(result.stdout).toMatch(/dependencies\s+dep-guard/);
      expect(result.stdout).toMatch(/vault-guard\/github-token/);
      expect(result.stdout).toMatch(/leak\.js:1:/);
    });

    it('sums the umbrella own proposal and the gate own into one sentence', () => {
      const result = conductor(['run', '--trust-base', 'trust-base-fixture', '--verbose']);

      expect(result.stdout).toMatch(/2 control change\(s\) proposed in this pull request\./);
      expect(result.stdout).toMatch(/proposed\s+conductor\s+policy changed in this pull request/);
      expect(result.stdout).toMatch(
        /proposed\s+intent-guard\s+contract changed in this pull request/
      );
    });

    it('refuses the forged approval, as an ordinary blocking finding', () => {
      const result = conductor(['run', '--trust-base', 'trust-base-fixture', '--verbose']);

      expect(result.stdout).toMatch(/BLOCKING.*intent-guard\/gate-blocked/);
      expect(result.stdout).toMatch(/Self-approval refused:/);
    });

    it('names the gates that have no pull-request mode yet rather than staying quiet', () => {
      const result = conductor(['run', '--trust-base', 'trust-base-fixture', '--verbose']);

      expect(result.stdout).toMatch(/NOT in pull-request mode\s+dependencies\s+dep-guard/);
      expect(result.stdout).toMatch(/NOT in pull-request mode\s+secrets\s+vault-guard/);
      expect(result.stdout).not.toMatch(/NOT in pull-request mode\s+intent/);
    });

    it('fails closed for every enabled gate on a base ref that does not resolve', () => {
      rmSync(marker, { force: true });

      const result = conductor(['run', '--trust-base', 'origin/does-not-exist']);

      expect(result.status).toBe(2);
      expect(existsSync(marker)).toBe(false);
      expect(result.stdout).toMatch(/does not resolve to a commit/);
      expect(result.stdout).toMatch(/verdict: exit 2/);
    });

    it('writes a SARIF log whose every result has a location', () => {
      // The adjacent fix, checked where it was found: against a real
      // repository's real gate output rather than against a constructed
      // result. One result without a location makes code scanning reject the
      // whole log.
      const result = conductor([
        'run',
        '--trust-base',
        'trust-base-fixture',
        '--format',
        'sarif',
      ]);
      const log = JSON.parse(result.stdout) as {
        runs: Array<{
          results: Array<{ ruleId: string; locations?: unknown[] }>;
          invocations?: Array<{ toolExecutionNotifications?: Array<{ descriptor: { id: string } }> }>;
        }>;
      };

      const results = log.runs.flatMap((run) => run.results);
      expect(results.length).toBeGreaterThan(0);
      expect(
        results.filter((entry) => (entry.locations?.length ?? 0) === 0).map((entry) => entry.ruleId)
      ).toEqual([]);

      const notificationIds = log.runs.flatMap((run) =>
        (run.invocations ?? []).flatMap((invocation) =>
          (invocation.toolExecutionNotifications ?? []).map((entry) => entry.descriptor.id)
        )
      );
      expect(notificationIds).toContain('conductor/control-change-proposed');
      expect(notificationIds).toContain('conductor/trust-base-not-passed');
    });
  });
});

if (missing.length > 0) {
  // Not a silent skip: a skipped end-to-end test that reads as a pass is
  // the same problem as a gate that is switched on and not installed.
  // eslint-disable-next-line no-console
  console.warn(`dogfood e2e skipped: ${missing.join('; ')}`);
}
