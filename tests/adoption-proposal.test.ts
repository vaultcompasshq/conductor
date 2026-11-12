// Issue 101: a pull request that adds .guardrails.yaml to a default branch
// with no policy is reported as a PROPOSAL (exit 0, nothing enforced, loudly
// labelled) instead of exit 2.
//
// This is trust-boundary code: it decides when a run that enforces nothing
// may exit 0. So most of this file is the other direction. Every way to reach
// the proposal that is not a genuine first adoption is a test here, and each
// one asserts exit 2, that no gate was spawned, and the reason by name, so a
// refusal that survives for the wrong reason still fails.

import { afterEach, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGate } from '../src/gate-runner.js';
import { gateChildEnv, pinnedGitEnv } from '../src/git.js';
import type { GatePolicy } from '../src/policy.js';
import { childEnv, shimGit } from './helpers/child-env.js';
import { CLEAN_DEP_GUARD, CLEAN_VAULT_GUARD, stubGate } from './helpers/stub-gate.js';

const CONDUCTOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONDUCTOR_CLI = path.join(CONDUCTOR_ROOT, 'dist', 'cli.js');

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-adoption-'));
  temps.push(dir);
  return dir;
}

/** The environment with every GIT_ variable removed, so a test decides which are set. */
function withoutGitVariables(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (!name.toUpperCase().startsWith('GIT_')) {
      cleaned[name] = value;
    }
  }
  return cleaned;
}

function git(repo: string, args: string[], env: Record<string, string> = {}): string {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: repo, encoding: 'utf8', env: { ...withoutGitVariables(process.env), ...env } }
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr ?? ''}`);
  }
  return (result.stdout ?? '').trim();
}

const REAL_GIT = (spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout ?? '').trim();

/**
 * Replaces the git the next runCli finds with one that logs every argv to
 * `log` and, when `failOn` is one of the arguments, fails as git does when it
 * cannot answer. Everything else goes to the real git.
 */
function wrapGit(bin: string, options: { log?: string; failOn?: string }): void {
  const lines = ['#!/bin/sh'];
  if (options.log !== undefined) {
    lines.push(`printf '%s\\n' "$*" >> ${JSON.stringify(options.log)}`);
  }
  if (options.failOn !== undefined) {
    lines.push(
      'for each in "$@"; do',
      `  if [ "$each" = ${JSON.stringify(options.failOn)} ]; then`,
      "    printf 'fatal: simulated failure\\n' >&2",
      '    exit 128',
      '  fi',
      'done'
    );
  }
  lines.push(`exec ${REAL_GIT} "$@"`, '');
  writeFileSync(path.join(bin, 'git'), lines.join('\n'));
  chmodSync(path.join(bin, 'git'), 0o755);
}

function runCli(
  repo: string,
  args: string[],
  bin: string,
  env: Record<string, string> = {},
  wrapped?: { log?: string; failOn?: string }
) {
  shimGit(bin);
  if (wrapped !== undefined) {
    wrapGit(bin, wrapped);
  }
  const result = spawnSync(process.execPath, [CONDUCTOR_CLI, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...withoutGitVariables(childEnv(bin)), ...env },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const POLICY = [
  'version: 1',
  'gates:',
  '  dependencies:',
  '    product: dep-guard',
  '  secrets:',
  '    product: vault-guard',
  '',
].join('\n');

const BLOCKING_VAULT_GUARD = JSON.stringify({
  version: '1',
  scannedAt: '2026-09-02T00:00:00.000Z',
  summary: { files: 1, secrets: 1 },
  run: {
    duration_ms: 1,
    files_scanned: 1,
    bytes_scanned: 40,
    patterns_active: 59,
    diagnostics_count: 0,
    fail_on: 'medium',
    blocking_matches: 1,
  },
  results: [
    {
      file: 'src/config.js',
      matches: [
        {
          type: 'github-token',
          severity: 'critical',
          line: 2,
          column: 22,
          offset: 93,
          value: 'ghp_...(40c)',
          fingerprint: '85ce78fecbada885e18040c4ef1299a29367a1d2eec35fec239ab556a0172c79',
        },
      ],
    },
  ],
});

interface Scratch {
  repo: string;
  bin: string;
  /** Every non-version invocation of a stub gate, one line each. Absent when none ran. */
  argvLog: string;
  /** Written by the script a head policy may point a gate at. */
  marker: string;
  /** The script itself, an absolute path inside the repository. */
  attacker: string;
}

function scratch(): Scratch {
  const repo = tempDir();
  const bin = tempDir();
  const argvLog = path.join(tempDir(), 'argv.txt');
  const marker = path.join(tempDir(), 'attacker-ran.txt');
  git(repo, ['init', '--quiet', '-b', 'main']);
  stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, argvLog });
  stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, argvLog });
  return { repo, bin, argvLog, marker, attacker: path.join(repo, 'tools', 'nice-gate.sh') };
}

function write(repo: string, relative: string, content: string): void {
  mkdirSync(path.dirname(path.join(repo, relative)), { recursive: true });
  writeFileSync(path.join(repo, relative), content);
}

function commit(repo: string, message: string, env: Record<string, string> = {}): string {
  git(repo, ['add', '--all']);
  git(repo, ['commit', '--quiet', '--allow-empty', '-m', message], env);
  return git(repo, ['rev-parse', 'HEAD']);
}

/**
 * The genuine adoption pull request: a base with no policy anywhere in its
 * history, and a head that adds one. `base` is a branch at the base commit.
 */
function adoption(options: { headPolicy?: string } = {}): Scratch & { baseId: string } {
  const made = scratch();
  write(made.repo, 'app.js', 'const x = 1;\n');
  const baseId = commit(made.repo, 'base');
  git(made.repo, ['branch', 'base']);
  write(made.repo, '.guardrails.yaml', (options.headPolicy ?? POLICY).replaceAll('{{attacker}}', made.attacker));
  write(made.repo, 'app.js', 'const x = 2;\n');
  write(
    made.repo,
    'tools/nice-gate.sh',
    ['#!/bin/sh', `printf 'ran\\n' > ${JSON.stringify(made.marker)}`, `echo ${JSON.stringify(CLEAN_VAULT_GUARD)}`, 'exit 0'].join('\n') + '\n'
  );
  chmodSync(made.attacker, 0o755);
  commit(made.repo, 'adopt conductor');
  return { ...made, baseId };
}

const PROPOSE = ['run', '--trust-base', 'base', '--adoption-proposal', '--verbose'];

const spawned = (made: Scratch): string[] =>
  existsSync(made.argvLog) ? readFileSync(made.argvLog, 'utf8').trim().split('\n') : [];

/** A refusal: exit 2, the could-not-run token, no gate spawned, no head script run. */
function expectRefused(made: Scratch, result: { status: number | null; stdout: string }, reason: RegExp): void {
  expect([result.status, result.stdout]).toEqual([2, expect.stringMatching(reason)]);
  expect(result.stdout).toMatch(/^verdict-token: could-not-run$/m);
  expect(result.stdout).toMatch(/^trust-base: refused, no rules were read and no gate ran$/m);
  expect(result.stdout).not.toMatch(/^proposal:/m);
  expect(result.stdout).not.toMatch(/verdict-token: proposal/);
  expect(spawned(made)).toEqual([]);
  expect(existsSync(made.marker)).toBe(false);
}

describe('the adoption proposal trigger (issue 101)', () => {
  it('proposes on the genuine shape: no policy on the base or in its history, the head adds one', () => {
    const made = adoption();
    const result = runCli(made.repo, PROPOSE, made.bin);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^verdict-token: proposal \(0\)$/m);
    expect(spawned(made)).toHaveLength(2);
    // A policy that sets nothing but what was applied proposes nothing more:
    // a product default it leaves alone is not listed as a change.
    expect(result.stdout).toMatch(/this run previews the policy this pull request adds\. 0 control change\(s\) proposed/);
    expect(result.stdout).not.toMatch(/^ {2}proposed /m);
  });

  it('does not list a product default as a proposed change', () => {
    // The vulnerabilities role has a default for present-on-base. The head
    // declares the role and leaves that key alone.
    const made = adoption({
      headPolicy: `${POLICY}  vulnerabilities:\n    product: osv-scanner\n    enforce: false\n`,
    });
    const result = runCli(made.repo, PROPOSE, made.bin);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/proposed .*present-on-base/);
  });

  it('refuses without the flag, as before it existed (B3)', () => {
    const made = adoption();
    const result = runCli(made.repo, ['run', '--trust-base', 'base', '--verbose'], made.bin);
    expectRefused(made, result, /No \.guardrails\.yaml on "base"/);
    // Today's sentence, unchanged.
    expect(result.stdout).toMatch(/is a proposal: it decides what runs once it is on the base branch/);
  });

  it('is a usage error with --staged, and without --trust-base', () => {
    const made = adoption();
    const staged = runCli(made.repo, ['run', '--staged', '--trust-base', 'base', '--adoption-proposal'], made.bin);
    expect(staged.status).toBe(2);
    expect(staged.stderr).toMatch(/--adoption-proposal cannot be combined with --staged/);
    expect(staged.stdout).toBe('');
    const bare = runCli(made.repo, ['run', '--adoption-proposal'], made.bin);
    expect(bare.status).toBe(2);
    expect(bare.stderr).toMatch(/--adoption-proposal needs --trust-base/);
    expect(bare.stdout).toBe('');
    expect(spawned(made)).toEqual([]);
  });

  describe('a stale merge ref after the policy was deleted on the base (B1)', () => {
    // M1 carries the policy. The pull request branches from M1 and never
    // touches the file. The base then deletes the policy (M2). The Action
    // fetches the live base tip, M2, while HEAD still carries M1's file.
    function stale(): Scratch & { prTip: string; mergeRef: string } {
      const made = scratch();
      write(made.repo, '.guardrails.yaml', POLICY);
      write(made.repo, 'app.js', 'const x = 1;\n');
      const m1 = commit(made.repo, 'M1, with the policy');
      git(made.repo, ['checkout', '--quiet', '-b', 'pr']);
      write(made.repo, 'payload.txt', 'payload\n');
      const prTip = commit(made.repo, 'the pull request, which never touches the policy');
      git(made.repo, ['checkout', '--quiet', '--detach', m1]);
      git(made.repo, ['merge', '--quiet', '--no-ff', '-m', 'merge ref', 'pr']);
      const mergeRef = git(made.repo, ['rev-parse', 'HEAD']);
      git(made.repo, ['checkout', '--quiet', 'main']);
      git(made.repo, ['rm', '--quiet', '.guardrails.yaml']);
      commit(made.repo, 'M2, the policy deleted');
      git(made.repo, ['branch', 'base']);
      return { ...made, prTip, mergeRef };
    }

    it('refuses with HEAD on the merge ref', () => {
      const made = stale();
      git(made.repo, ['checkout', '--quiet', '--detach', made.mergeRef]);
      expectRefused(made, runCli(made.repo, PROPOSE, made.bin), /carries a \.guardrails\.yaml at the merge base/);
    });

    it('refuses with HEAD on the pull request tip', () => {
      const made = stale();
      git(made.repo, ['checkout', '--quiet', '--detach', made.prTip]);
      expectRefused(made, runCli(made.repo, PROPOSE, made.bin), /carries a \.guardrails\.yaml at the merge base/);
    });
  });

  describe('a criss-cross with two merge bases, one of them carrying the policy', () => {
    // R has no policy. X adds one, Y does not. The base is merge(Y, X) with
    // the policy dropped in the merge; HEAD is merge(X, Y), which keeps it.
    // The merge bases are X and Y, and the base's own first-parent history
    // (base, Y, R) never touched the file, so only the merge-base rule can
    // refuse this.
    function crissCross(policyBaseIsNewer: boolean): Scratch {
      const made = scratch();
      const at = (seconds: number): Record<string, string> => ({
        GIT_AUTHOR_DATE: `2026-01-01T00:00:${String(seconds).padStart(2, '0')}Z`,
        GIT_COMMITTER_DATE: `2026-01-01T00:00:${String(seconds).padStart(2, '0')}Z`,
      });
      write(made.repo, 'app.js', 'const x = 1;\n');
      const root = commit(made.repo, 'R', at(1));
      git(made.repo, ['checkout', '--quiet', '-b', 'x']);
      write(made.repo, '.guardrails.yaml', POLICY);
      const x = commit(made.repo, 'X, with the policy', at(policyBaseIsNewer ? 3 : 2));
      git(made.repo, ['checkout', '--quiet', '-b', 'y', root]);
      write(made.repo, 'y.txt', 'y\n');
      const y = commit(made.repo, 'Y, without it', at(policyBaseIsNewer ? 2 : 3));
      // The base: Y first, X merged in, the policy removed in the merge.
      git(made.repo, ['checkout', '--quiet', '-b', 'base', y]);
      git(made.repo, ['merge', '--quiet', '--no-ff', '--no-commit', x], at(4));
      git(made.repo, ['rm', '--quiet', '-f', '.guardrails.yaml']);
      git(made.repo, ['commit', '--quiet', '-m', 'base: merge X, drop the policy'], at(4));
      // HEAD: X first, Y merged in, the policy kept.
      git(made.repo, ['checkout', '--quiet', '-B', 'main', x]);
      git(made.repo, ['merge', '--quiet', '--no-ff', '-m', 'head: merge Y', y], at(5));
      const bases = git(made.repo, ['merge-base', '--all', 'base', 'HEAD']).split('\n').sort();
      expect(bases).toEqual([x, y].sort());
      return made;
    }

    it.each([true, false])('refuses whichever merge base git lists first (policy base newer: %s)', (newer) => {
      const made = crissCross(newer);
      expectRefused(made, runCli(made.repo, PROPOSE, made.bin), /carries a \.guardrails\.yaml at the merge base/);
    });
  });

  it('refuses when the base and HEAD share no history', () => {
    const made = scratch();
    write(made.repo, 'app.js', 'const x = 1;\n');
    commit(made.repo, 'one root');
    git(made.repo, ['branch', 'base']);
    git(made.repo, ['checkout', '--quiet', '--orphan', 'other']);
    write(made.repo, '.guardrails.yaml', POLICY);
    commit(made.repo, 'another root, with a policy');
    expectRefused(made, runCli(made.repo, PROPOSE, made.bin), /share no history/);
  });

  it('refuses in a shallow repository, where the history that could carry a policy is cut off', () => {
    // R carries the policy, A deletes it, the head adds one back. A clone of
    // depth 2 holds the head and A and not R: A reads as a root there, so the
    // merge base (A) and A's own history both look clean. Only the shallow
    // test itself refuses this.
    const origin = scratch();
    write(origin.repo, '.guardrails.yaml', POLICY);
    write(origin.repo, 'app.js', 'const x = 1;\n');
    commit(origin.repo, 'R, with the policy');
    git(origin.repo, ['rm', '--quiet', '.guardrails.yaml']);
    const a = commit(origin.repo, 'A, the policy deleted');
    write(origin.repo, '.guardrails.yaml', POLICY);
    commit(origin.repo, 'the head adds a policy');
    const made = { ...origin, repo: path.join(tempDir(), 'clone') };
    git(origin.repo, ['clone', '--quiet', '--depth', '2', `file://${origin.repo}`, made.repo]);
    expect(git(made.repo, ['rev-parse', '--is-shallow-repository'])).toBe('true');
    const result = runCli(made.repo, ['run', '--trust-base', a, '--adoption-proposal', '--verbose'], made.bin);
    expectRefused(made, result, /shallow/);
    expect(result.stdout).toMatch(/fetch-depth: 0/);
  });

  describe('the base branch own history has carried a policy (Q3)', () => {
    function deletedThenReAdded(headPolicy = POLICY): Scratch {
      const made = scratch();
      write(made.repo, '.guardrails.yaml', POLICY);
      write(made.repo, 'app.js', 'const x = 1;\n');
      commit(made.repo, 'the base adopts');
      git(made.repo, ['rm', '--quiet', '.guardrails.yaml']);
      commit(made.repo, 'the base deletes the policy');
      git(made.repo, ['branch', 'base']);
      write(made.repo, '.guardrails.yaml', headPolicy);
      commit(made.repo, 'a later pull request adds one');
      return made;
    }

    it('refuses a pull request that adds a policy after one was deleted on the base', () => {
      const made = deletedThenReAdded();
      const result = runCli(made.repo, PROPOSE, made.bin);
      expectRefused(made, result, /has carried a \.guardrails\.yaml before/);
      // The remedy: the policy lands on the base branch first.
      expect(result.stdout).toMatch(/land .* on the base branch/i);
    });

    it('refuses when the policy arrived and left through merge commits', () => {
      // How a hosted merge lands a pull request: no commit on the base
      // branch's own line touches the file except the two merge commits.
      const made = scratch();
      write(made.repo, 'app.js', 'const x = 1;\n');
      commit(made.repo, 'root');
      git(made.repo, ['checkout', '--quiet', '-b', 'adopt']);
      write(made.repo, '.guardrails.yaml', POLICY);
      commit(made.repo, 'add the policy on a branch');
      git(made.repo, ['checkout', '--quiet', 'main']);
      git(made.repo, ['merge', '--quiet', '--no-ff', '-m', 'merge the adoption', 'adopt']);
      git(made.repo, ['checkout', '--quiet', '-b', 'drop']);
      git(made.repo, ['rm', '--quiet', '.guardrails.yaml']);
      commit(made.repo, 'delete the policy on a branch');
      git(made.repo, ['checkout', '--quiet', 'main']);
      git(made.repo, ['merge', '--quiet', '--no-ff', '-m', 'merge the deletion', 'drop']);
      git(made.repo, ['branch', 'base']);
      write(made.repo, '.guardrails.yaml', POLICY);
      commit(made.repo, 'a later pull request adds one');
      expectRefused(made, runCli(made.repo, PROPOSE, made.bin), /has carried a \.guardrails\.yaml before/);
    });

    it('refuses the all-disabled policy that would otherwise be a green nothing-checked', () => {
      const made = deletedThenReAdded(POLICY.replace(/(product: [a-z-]+)\n/g, '$1\n    enabled: false\n'));
      expectRefused(made, runCli(made.repo, PROPOSE, made.bin), /has carried a \.guardrails\.yaml before/);
    });
  });

  it('refuses when the base root holds the policy name in another case', () => {
    // A push run on a case-insensitive file system reads .Guardrails.yaml as
    // the policy, so this base is not a base without one.
    const made = scratch();
    write(made.repo, '.Guardrails.yaml', POLICY);
    write(made.repo, 'app.js', 'const x = 1;\n');
    commit(made.repo, 'base, with a case variant');
    git(made.repo, ['branch', 'base']);
    git(made.repo, ['mv', '-f', '.Guardrails.yaml', '.guardrails.yaml']);
    commit(made.repo, 'the head renames it');
    expect(git(made.repo, ['ls-tree', '--name-only', 'base'])).toContain('.Guardrails.yaml');
    expect(git(made.repo, ['ls-tree', '--name-only', 'HEAD'])).toContain('.guardrails.yaml');
    expectRefused(made, runCli(made.repo, PROPOSE, made.bin), /"\.Guardrails\.yaml"/);
  });

  describe('a git environment variable outside the allowlist (R3)', () => {
    const settings = (repo: string): Array<[string, string]> => [
      ['GIT_DIR', path.join(repo, '.git')],
      ['GIT_WORK_TREE', repo],
      ['GIT_COMMON_DIR', path.join(repo, '.git')],
      ['GIT_NAMESPACE', 'elsewhere'],
      ['GIT_OBJECT_DIRECTORY', path.join(repo, '.git', 'objects')],
      ['GIT_ALTERNATE_OBJECT_DIRECTORIES', path.join(repo, '.git', 'objects')],
      ['GIT_LITERAL_PATHSPECS', '0'],
      ['GIT_ICASE_PATHSPECS', '0'],
      ['GIT_CONFIG_GLOBAL', '/dev/null'],
      ['GIT_TRACE', '0'],
      ['GIT_SOMETHING_NOBODY_HAS_HEARD_OF', '1'],
    ];

    it('refuses for each one, naming it, though git answers exactly as before', () => {
      const made = adoption();
      for (const [name, value] of settings(made.repo)) {
        const result = runCli(made.repo, PROPOSE, made.bin, { [name]: value });
        expectRefused(made, result, new RegExp(`${name} is set`));
      }
    });

    it('still proposes with the variables the Action and conductor set themselves', () => {
      const made = adoption();
      const result = runCli(made.repo, PROPOSE, made.bin, {
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_GRAFT_FILE: '/dev/null/conductor-no-grafts',
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'advice.detachedHead',
        GIT_CONFIG_VALUE_0: 'false',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^verdict-token: proposal \(0\)$/m);
    });

    it('still proposes with a bot identity and dates set for the whole job', () => {
      const made = adoption();
      const result = runCli(made.repo, PROPOSE, made.bin, {
        GIT_AUTHOR_NAME: 'a-bot',
        GIT_AUTHOR_EMAIL: 'bot@example.com',
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
        GIT_COMMITTER_NAME: 'a-bot',
        GIT_COMMITTER_EMAIL: 'bot@example.com',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      });
      expect([result.status, result.stdout]).toEqual([0, expect.stringMatching(/^verdict-token: proposal \(0\)$/m)]);
      // A name beside those six is still outside the list.
      const other = adoption();
      expectRefused(
        other,
        runCli(other.repo, PROPOSE, other.bin, { GIT_AUTHOR_NAME: 'a-bot', GIT_COMMITTER_IDENT: 'x' }),
        /GIT_COMMITTER_IDENT is set/
      );
    });

    it('does not look at the environment on a run that is not a proposal', () => {
      // The Action passes the flag on every pull request into the default
      // branch. A base that has a policy is the ordinary run, whatever is set.
      const made = scratch();
      write(made.repo, '.guardrails.yaml', POLICY);
      commit(made.repo, 'base, with a policy');
      git(made.repo, ['branch', 'base']);
      write(made.repo, 'app.js', 'const x = 2;\n');
      commit(made.repo, 'an ordinary pull request');
      const result = runCli(made.repo, PROPOSE, made.bin, { GIT_TRACE: '0' });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^verdict-token: pass$/m);
    });
  });

  it('ignores a graft file that hides the commit which carried the policy', () => {
    // A graft that cuts the base off from its own past would make the history
    // read clean. conductor points git at a graft file that cannot exist.
    const made = scratch();
    write(made.repo, '.guardrails.yaml', POLICY);
    write(made.repo, 'app.js', 'const x = 1;\n');
    commit(made.repo, 'the base adopts');
    git(made.repo, ['rm', '--quiet', '.guardrails.yaml']);
    const deleted = commit(made.repo, 'the base deletes the policy');
    git(made.repo, ['branch', 'base']);
    write(made.repo, '.guardrails.yaml', POLICY);
    commit(made.repo, 'a later pull request adds one');
    mkdirSync(path.join(made.repo, '.git', 'info'), { recursive: true });
    writeFileSync(path.join(made.repo, '.git', 'info', 'grafts'), `${deleted}\n`);
    // The graft is live for a plain git: the deletion reads as a root commit.
    expect(git(made.repo, ['rev-list', '--count', 'base'])).toBe('1');
    expectRefused(made, runCli(made.repo, PROPOSE, made.bin), /has carried a \.guardrails\.yaml before/);
  });

  describe('git configuration that turns replace refs back on', () => {
    // An ORDINARY pull request on a repository WITH a policy: the base is A
    // then B, and B adds the policy. A replace ref swaps B for a commit with
    // A's tree and A as its parent, so a git that honours it reads a base
    // with no policy and no history of one. GIT_NO_REPLACE_OBJECTS alone does
    // not stop that: core.useReplaceRefs=true in any configuration git reads
    // turns replacement back on. Only the same key on the command line wins.
    function replaced(): Scratch {
      const made = scratch();
      stubGate(made.bin, 'vault-guard', { stdout: BLOCKING_VAULT_GUARD, exit: 1, argvLog: made.argvLog });
      write(made.repo, 'app.js', 'const x = 1;\n');
      const a = commit(made.repo, 'A, no policy');
      write(made.repo, '.guardrails.yaml', POLICY);
      const b = commit(made.repo, 'B, the base adopts');
      git(made.repo, ['branch', 'base']);
      write(made.repo, 'src/config.js', 'const x = 2;\n');
      commit(made.repo, 'an ordinary pull request');
      const fake = git(made.repo, ['commit-tree', `${a}^{tree}`, '-p', a, '-m', 'fake']);
      git(made.repo, ['replace', b, fake]);
      // The plant is live for a git that honours replace refs.
      expect(git(made.repo, ['-c', 'core.useReplaceRefs=true', 'ls-tree', '--name-only', 'base'])).not.toContain(
        '.guardrails.yaml'
      );
      return made;
    }

    function expectJudgedByTheBase(made: Scratch, result: { status: number | null; stdout: string }): void {
      expect([result.status, result.stdout]).toEqual([1, expect.stringMatching(/^verdict-token: blocked \(1\)$/m)]);
      expect(result.stdout).toMatch(/pull-request mode: rules from base\./);
      expect(result.stdout).not.toMatch(/proposal/);
      expect(spawned(made)).toHaveLength(2);
    }

    it('reads the real base with the key in GIT_CONFIG_COUNT, which the allowlist lets through', () => {
      const made = replaced();
      const result = runCli(made.repo, PROPOSE, made.bin, {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.useReplaceRefs',
        GIT_CONFIG_VALUE_0: 'true',
      });
      expectJudgedByTheBase(made, result);
    });

    it('reads the real base with the key in the repository own configuration', () => {
      const made = replaced();
      git(made.repo, ['config', 'core.useReplaceRefs', 'true']);
      expectJudgedByTheBase(made, runCli(made.repo, PROPOSE, made.bin));
    });

    it('reads the real base with the key in a global configuration found through HOME', () => {
      const made = replaced();
      const home = tempDir();
      writeFileSync(path.join(home, '.gitconfig'), '[core]\n\tuseReplaceRefs = true\n');
      expectJudgedByTheBase(made, runCli(made.repo, PROPOSE, made.bin, { HOME: home, XDG_CONFIG_HOME: home }));
    });

    it('reads the real base policy on an ordinary run, when a replace ref swaps it for a weaker one', () => {
      // No flag. The replacement commit carries a policy without the secrets
      // gate; a run that honoured it would never spawn vault-guard.
      const made = scratch();
      stubGate(made.bin, 'vault-guard', { stdout: BLOCKING_VAULT_GUARD, exit: 1, argvLog: made.argvLog });
      write(made.repo, 'app.js', 'const x = 1;\n');
      const a = commit(made.repo, 'A');
      write(made.repo, '.guardrails.yaml', POLICY);
      const b = commit(made.repo, 'B, the base policy');
      git(made.repo, ['branch', 'base']);
      write(made.repo, 'src/config.js', 'const x = 2;\n');
      const head = commit(made.repo, 'an ordinary pull request');
      git(made.repo, ['checkout', '--quiet', '--detach', a]);
      write(made.repo, '.guardrails.yaml', POLICY.replace('  secrets:\n    product: vault-guard\n', ''));
      const weaker = commit(made.repo, 'a weaker policy, never on the base');
      git(made.repo, ['checkout', '--quiet', '--detach', head]);
      git(made.repo, ['replace', b, weaker]);
      git(made.repo, ['config', 'core.useReplaceRefs', 'true']);
      expect(git(made.repo, ['show', 'base:.guardrails.yaml'])).not.toContain('vault-guard');
      const result = runCli(made.repo, ['run', '--trust-base', 'base', '--verbose'], made.bin);
      expect([result.status, result.stdout]).toEqual([1, expect.stringMatching(/^verdict-token: blocked \(1\)$/m)]);
      expect(spawned(made)).toHaveLength(2);
    });
  });

  describe('every git call conductor makes', () => {
    it('carries the replace and commit-graph pins on the command line, ahead of the subcommand', () => {
      const made = adoption();
      const log = path.join(tempDir(), 'git-argv.txt');
      const result = runCli(made.repo, PROPOSE, made.bin, {}, { log });
      expect(result.status).toBe(0);
      const calls = readFileSync(log, 'utf8').trim().split('\n');
      expect(calls.length).toBeGreaterThan(5);
      for (const call of calls) {
        expect(call).toMatch(/^-c core\.useReplaceRefs=false -c core\.commitGraph=false [a-z]/);
      }
      // The reads the trigger rests on are among them.
      expect(calls.some((call) => / merge-base --all /.test(call))).toBe(true);
      expect(calls.some((call) => / rev-list --first-parent /.test(call))).toBe(true);
    });

    // A read git cannot answer is never "nothing there". One argument per
    // read of the trigger; the run with the same git and no failure proposes.
    it.each([
      ['--is-shallow-repository', /whether this repository is shallow could not be checked/],
      ['merge-base', /the merge base of "base" and HEAD could not be read/],
      ['--first-parent', /the history of "base" could not be read/],
      ['--name-only', /under another spelling could not be checked/],
    ])('refuses when the read with %s fails, as a wrong owner or a broken configuration makes it', (failOn, reason) => {
      const made = adoption();
      expectRefused(made, runCli(made.repo, PROPOSE, made.bin, {}, { failOn }), reason);
    });

    it('refuses when the repository configuration cannot be parsed at all', () => {
      const made = adoption();
      writeFileSync(path.join(made.repo, '.git', 'config'), '[core\n', { flag: 'a' });
      const result = runCli(made.repo, PROPOSE, made.bin);
      expect(result.status).toBe(2);
      expect(result.stdout + result.stderr).not.toMatch(/verdict-token: proposal/);
      expect(spawned(made)).toEqual([]);
    });
  });

  it('refuses a base that holds a spelling the history rule cannot see, on a stale head', () => {
    // Only the name check at the base root stands here. The base adds the
    // policy under a name with a zero-width non-joiner in it, which HFS+
    // reads as .guardrails.yaml, AFTER the pull request branched. So no merge
    // base holds any spelling, and the case-insensitive pathspec of the
    // history rule does not fold that code point.
    const made = scratch();
    write(made.repo, 'app.js', 'const x = 1;\n');
    const root = commit(made.repo, 'root, no policy');
    const variant = '.guard‌rails.yaml';
    write(made.repo, variant, POLICY);
    commit(made.repo, 'the base adds the policy under another spelling');
    git(made.repo, ['branch', 'base']);
    git(made.repo, ['checkout', '--quiet', '-B', 'main', root]);
    write(made.repo, '.guardrails.yaml', POLICY);
    commit(made.repo, 'the pull request, branched before that');
    expect(git(made.repo, ['merge-base', 'base', 'HEAD'])).toBe(root);
    expect(git(made.repo, ['rev-list', '--first-parent', '-n', '1', 'base', '--', ':(icase).guardrails.yaml'])).toBe('');
    expectRefused(made, runCli(made.repo, PROPOSE, made.bin), /policy file name in another spelling/);
  });

  describe('ACCEPTED RESIDUE, pinned as it is today and not as intended', () => {
    // Both shapes need write access to the default branch, and both are
    // listed under NOT claimed in docs/INVARIANTS.md. A change that starts
    // refusing either one should turn these red and delete them on purpose.
    it('G2: proposes after a side branch policy was dropped by the merge commit that merged it', () => {
      const made = scratch();
      write(made.repo, 'app.js', 'const x = 1;\n');
      commit(made.repo, 'root');
      git(made.repo, ['checkout', '--quiet', '-b', 'side']);
      write(made.repo, '.guardrails.yaml', POLICY);
      commit(made.repo, 'the side branch adds a policy');
      git(made.repo, ['checkout', '--quiet', 'main']);
      git(made.repo, ['merge', '--quiet', '--no-ff', '--no-commit', 'side']);
      git(made.repo, ['rm', '--quiet', '-f', '.guardrails.yaml']);
      git(made.repo, ['commit', '--quiet', '-m', 'merge the side branch, dropping the policy']);
      git(made.repo, ['branch', 'base']);
      write(made.repo, '.guardrails.yaml', POLICY);
      commit(made.repo, 'a later pull request adds one');
      const result = runCli(made.repo, PROPOSE, made.bin);
      expect([result.status, result.stdout]).toEqual([0, expect.stringMatching(/^verdict-token: proposal \(0\)$/m)]);
    });

    it('G3: proposes after a side branch added then deleted a policy and was merged as it stood', () => {
      const made = scratch();
      write(made.repo, 'app.js', 'const x = 1;\n');
      commit(made.repo, 'root');
      git(made.repo, ['checkout', '--quiet', '-b', 'side']);
      write(made.repo, '.guardrails.yaml', POLICY);
      commit(made.repo, 'the side branch adds a policy');
      git(made.repo, ['rm', '--quiet', '.guardrails.yaml']);
      commit(made.repo, 'the side branch deletes it');
      git(made.repo, ['checkout', '--quiet', 'main']);
      git(made.repo, ['merge', '--quiet', '--no-ff', '-m', 'an ordinary merge', 'side']);
      git(made.repo, ['branch', 'base']);
      write(made.repo, '.guardrails.yaml', POLICY);
      commit(made.repo, 'a later pull request adds one');
      const result = runCli(made.repo, PROPOSE, made.bin);
      expect([result.status, result.stdout]).toEqual([0, expect.stringMatching(/^verdict-token: proposal \(0\)$/m)]);
    });
  });

  describe('a base that is not a base without a policy', () => {
    it('is the ordinary run when the base has a policy and the head changes it, never a proposal', () => {
      const made = scratch();
      write(made.repo, '.guardrails.yaml', POLICY);
      commit(made.repo, 'base, with a policy');
      git(made.repo, ['branch', 'base']);
      write(made.repo, '.guardrails.yaml', POLICY.replace('  secrets:\n    product: vault-guard\n', ''));
      commit(made.repo, 'the head drops the secrets gate');
      const result = runCli(made.repo, PROPOSE, made.bin);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^verdict-token: pass$/m);
      expect(result.stdout).not.toMatch(/^proposal:/m);
      // The base's two gates ran, the one the head dropped included.
      expect(spawned(made)).toHaveLength(2);
      expect(result.stdout).toMatch(/pull-request mode: rules from base\./);
    });

    it('refuses when the base policy is a symbolic link, with the reason git gave', () => {
      const made = scratch();
      write(made.repo, 'real.yaml', POLICY);
      symlinkSync('real.yaml', path.join(made.repo, '.guardrails.yaml'));
      commit(made.repo, 'base, the policy a link');
      git(made.repo, ['branch', 'base']);
      rmSync(path.join(made.repo, '.guardrails.yaml'));
      write(made.repo, '.guardrails.yaml', POLICY);
      commit(made.repo, 'the head makes it a file');
      expectRefused(made, runCli(made.repo, PROPOSE, made.bin), /is not a regular file at "base"/);
    });

    it('refuses when the base policy is a submodule entry', () => {
      const made = scratch();
      write(made.repo, 'app.js', 'const x = 1;\n');
      const first = commit(made.repo, 'first');
      git(made.repo, ['update-index', '--add', '--cacheinfo', `160000,${first},.guardrails.yaml`]);
      git(made.repo, ['commit', '--quiet', '-m', 'base, the policy a gitlink']);
      git(made.repo, ['branch', 'base']);
      git(made.repo, ['rm', '--quiet', '--cached', '.guardrails.yaml']);
      write(made.repo, '.guardrails.yaml', POLICY);
      commit(made.repo, 'the head makes it a file');
      expectRefused(made, runCli(made.repo, PROPOSE, made.bin), /is not a regular file at "base"/);
    });

    it.each([
      ['does not parse', 'version: 1\ngates: nonsense\n'],
      ['is empty', ''],
    ])('refuses, with a report that names the parse error, when the base policy %s', (_, basePolicy) => {
      const made = scratch();
      write(made.repo, '.guardrails.yaml', basePolicy);
      write(made.repo, 'app.js', 'const x = 1;\n');
      commit(made.repo, 'base, with a broken policy');
      git(made.repo, ['branch', 'base']);
      write(made.repo, '.guardrails.yaml', POLICY);
      commit(made.repo, 'the head fixes it');
      const result = runCli(made.repo, PROPOSE, made.bin);
      expectRefused(made, result, /The \.guardrails\.yaml on "base" is not a policy this run can use/);
      expect(result.stdout).toMatch(/base:\.guardrails\.yaml/);
    });
  });

  describe('a head policy that cannot be the proposal', () => {
    it('refuses, naming git reason, when the head policy is a symbolic link', () => {
      const made = scratch();
      write(made.repo, 'app.js', 'const x = 1;\n');
      commit(made.repo, 'base');
      git(made.repo, ['branch', 'base']);
      write(made.repo, 'real.yaml', POLICY);
      symlinkSync('real.yaml', path.join(made.repo, '.guardrails.yaml'));
      commit(made.repo, 'the head adds a link');
      const result = runCli(made.repo, PROPOSE, made.bin);
      expectRefused(made, result, /is not a regular file at "HEAD"/);
      expect(result.stdout).not.toMatch(/conductor init/);
      expect(result.stdout).not.toMatch(/^no-policy:/m);
    });

    it('refuses, naming the parse error, when the head policy does not parse', () => {
      const made = adoption({ headPolicy: 'version: 1\ngates: nonsense\n' });
      const result = runCli(made.repo, PROPOSE, made.bin);
      expectRefused(made, result, /HEAD:\.guardrails\.yaml/);
      expect(result.stdout).not.toMatch(/conductor init/);
      expect(result.stdout).not.toMatch(/^no-policy:/m);
    });

    it('refuses a head policy whose command is a relative path, which no policy may hold', () => {
      const made = adoption({ headPolicy: `${POLICY}`.replace('product: vault-guard\n', 'product: vault-guard\n    command: tools/nice-gate.sh\n') });
      expectRefused(made, runCli(made.repo, PROPOSE, made.bin), /HEAD:\.guardrails\.yaml/);
    });
  });
});

const PROPOSAL_LINE = (count: number): string =>
  `proposal: no .guardrails.yaml on the base branch, so nothing here was enforced; ${count} would block once this policy is on the base branch`;

describe('the git a gate runs itself reads no replace ref either', () => {
  // conductor's own reads carry their pin on the command line. A gate reads
  // its control files from the trust base with its own git calls, and the
  // only thing conductor can give those is their environment. Measured in
  // review with a real gate: replacement turned back on in the repository
  // configuration, a replace ref that swaps the trust base for a copy whose
  // ignore file covers the finding, and the gate went quiet.
  const GREP = (spawnSync('sh', ['-c', 'command -v grep'], { encoding: 'utf8' }).stdout ?? '').trim();
  const CAT = (spawnSync('sh', ['-c', 'command -v cat'], { encoding: 'utf8' }).stdout ?? '').trim();
  // The two pins, old-style key=value, single quotes included. Appended to
  // GIT_CONFIG_PARAMETERS after exactly one space, or alone when the caller
  // value is unset or empty. git reads this channel after GIT_CONFIG_COUNT.
  const PARAMETER_PINS = "'core.useReplaceRefs=false' 'core.commitGraph=false'";

  /**
   * A vault-guard that asks git, by name, what the trust base holds: quiet
   * when the base has `ignore-everything` at its root, one blocking finding
   * otherwise. It also records the configuration its environment carried.
   */
  function baseReadingGate(made: Scratch, envLog: string): void {
    const file = path.join(made.bin, 'vault-guard');
    writeFileSync(`${file}.clean`, CLEAN_VAULT_GUARD);
    writeFileSync(`${file}.blocking`, BLOCKING_VAULT_GUARD);
    writeFileSync(
      file,
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then echo 9.9.9; exit 0; fi',
        `printf '%s\\n' "$*" >> ${JSON.stringify(made.argvLog)}`,
        `printf 'COUNT=%s;KEY0=%s;VALUE0=%s;KEY1=%s;VALUE1=%s\\n' "$GIT_CONFIG_COUNT" "$GIT_CONFIG_KEY_0" "$GIT_CONFIG_VALUE_0" "$GIT_CONFIG_KEY_1" "$GIT_CONFIG_VALUE_1" >> ${JSON.stringify(envLog)}`,
        'prev=""',
        'base=""',
        'for each in "$@"; do',
        '  if [ "$prev" = "--trust-base" ]; then base="$each"; fi',
        '  prev="$each"',
        'done',
        'listed="$(git ls-tree --name-only "$base")" || exit 3',
        `if printf '%s\\n' "$listed" | ${GREP} -qx ignore-everything; then ${CAT} ${JSON.stringify(`${file}.clean`)}; exit 0; fi`,
        `${CAT} ${JSON.stringify(`${file}.blocking`)}`,
        'exit 1',
        '',
      ].join('\n')
    );
    chmodSync(file, 0o755);
  }

  /** Swaps `target` for a copy of it that also holds `ignore-everything`, and turns replacement on. */
  function plantQuietBase(repo: string, target: string): void {
    const back = git(repo, ['rev-parse', 'HEAD']);
    git(repo, ['checkout', '--quiet', '--detach', target]);
    write(repo, 'ignore-everything', 'src/config.js\n');
    const quiet = commit(repo, 'a copy that ignores the finding');
    git(repo, ['checkout', '--quiet', '--detach', back]);
    git(repo, ['replace', target, quiet]);
    git(repo, ['config', 'core.useReplaceRefs', 'true']);
    // Live for a git that honours it: the base reads as the quiet copy.
    expect(git(repo, ['ls-tree', '--name-only', target])).toContain('ignore-everything');
  }

  function ordinary(): Scratch & { envLog: string } {
    const made = scratch();
    const envLog = path.join(tempDir(), 'gate-env.txt');
    baseReadingGate(made, envLog);
    write(made.repo, '.guardrails.yaml', POLICY);
    write(made.repo, 'app.js', 'const x = 1;\n');
    const base = commit(made.repo, 'the base, with a policy');
    git(made.repo, ['branch', 'base']);
    write(made.repo, 'src/config.js', 'const x = 2;\n');
    commit(made.repo, 'an ordinary pull request');
    plantQuietBase(made.repo, base);
    return { ...made, envLog };
  }

  function proposed(): Scratch & { envLog: string } {
    const made = adoption();
    const envLog = path.join(tempDir(), 'gate-env.txt');
    baseReadingGate(made, envLog);
    plantQuietBase(made.repo, made.baseId);
    return { ...made, envLog };
  }

  it('keeps an ordinary run blocked when a replace ref would hand the gate a quieter base', () => {
    const made = ordinary();
    const result = runCli(made.repo, ['run', '--trust-base', 'base', '--verbose'], made.bin);
    expect([result.status, result.stdout]).toEqual([1, expect.stringMatching(/^verdict-token: blocked \(1\)$/m)]);
  });

  it('keeps a proposal at proposal (1) when a replace ref would hand the gate a quieter base', () => {
    const made = proposed();
    const result = runCli(made.repo, PROPOSE, made.bin);
    expect([result.status, result.stdout]).toEqual([0, expect.stringMatching(/^verdict-token: proposal \(1\)$/m)]);
  });

  it('appends its entry after the entries the caller already set, and keeps those', () => {
    const made = proposed();
    const result = runCli(made.repo, PROPOSE, made.bin, {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://example.com/.extraheader',
      GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic eA==',
    });
    // Still a proposal: the allowlist reads conductor's own environment,
    // which is the caller's, and never the one it builds for a gate.
    expect([result.status, result.stdout]).toEqual([0, expect.stringMatching(/^verdict-token: proposal \(1\)$/m)]);
    expect(readFileSync(made.envLog, 'utf8').trim().split('\n')).toEqual([
      'COUNT=2;KEY0=http.https://example.com/.extraheader;VALUE0=AUTHORIZATION: basic eA==;KEY1=core.useReplaceRefs;VALUE1=false',
    ]);
  });

  it('gives a gate the entry at index 0 when the caller set none', () => {
    const made = ordinary();
    runCli(made.repo, ['run', '--trust-base', 'base', '--verbose'], made.bin);
    expect(readFileSync(made.envLog, 'utf8').trim().split('\n')).toEqual([
      'COUNT=1;KEY0=core.useReplaceRefs;VALUE0=false;KEY1=;VALUE1=',
    ]);
  });

  it.each(['abc', '-1', '1.5', '99999999999999999999'])(
    'is could-not-run, never a pass, when the caller GIT_CONFIG_COUNT is %s and git refuses every call',
    (count) => {
      const made = ordinary();
      const result = runCli(made.repo, ['run', '--trust-base', 'base', '--verbose'], made.bin, {
        GIT_CONFIG_COUNT: count,
      });
      expect(result.status).toBe(2);
      expect(result.stdout + result.stderr).not.toMatch(/verdict-token: (pass|proposal|nothing-checked)/);
    }
  );

  it('is could-not-run when the caller count names an entry that is not there', () => {
    const made = ordinary();
    const result = runCli(made.repo, ['run', '--trust-base', 'base', '--verbose'], made.bin, { GIT_CONFIG_COUNT: '2' });
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).not.toMatch(/verdict-token: (pass|proposal|nothing-checked)/);
  });

  it('keeps an ordinary run blocked when GIT_CONFIG_PARAMETERS is a quoted useReplaceRefs=true', () => {
    const made = ordinary();
    const result = runCli(made.repo, ['run', '--trust-base', 'base', '--verbose'], made.bin, {
      GIT_CONFIG_PARAMETERS: "'core.useReplaceRefs=true'",
    });
    expect([result.status, result.stdout]).toEqual([1, expect.stringMatching(/^verdict-token: blocked \(1\)$/m)]);
  });

  it('keeps an ordinary run blocked when GIT_CONFIG_PARAMETERS quotes the useReplaceRefs key and the value separately', () => {
    const made = ordinary();
    const result = runCli(made.repo, ['run', '--trust-base', 'base', '--verbose'], made.bin, {
      GIT_CONFIG_PARAMETERS: "'core.useReplaceRefs'='true'",
    });
    expect([result.status, result.stdout]).toEqual([1, expect.stringMatching(/^verdict-token: blocked \(1\)$/m)]);
  });

  it('the fetch step unsets GIT_TEST_COMMIT_GRAPH before its git calls', () => {
    const yml = readFileSync(path.join(CONDUCTOR_ROOT, 'action.yml'), 'utf8');
    const step = yml.split('- name: Fetch the trust base')[1]?.split('- name:')[0] ?? '';
    expect(step).toContain('unset GIT_TEST_COMMIT_GRAPH');
  });

  it('refuses a proposal when GIT_TEST_COMMIT_GRAPH is set', () => {
    const made = proposed();
    const result = runCli(made.repo, PROPOSE, made.bin, { GIT_TEST_COMMIT_GRAPH: '1' });
    expectRefused(made, result, /GIT_TEST_COMMIT_GRAPH is set/);
  });

  it('refuses a proposal when GIT_CONFIG_PARAMETERS is set', () => {
    const made = proposed();
    const result = runCli(made.repo, PROPOSE, made.bin, {
      GIT_CONFIG_PARAMETERS: "'core.useReplaceRefs=true'",
    });
    expectRefused(made, result, /GIT_CONFIG_PARAMETERS is set/);
  });

  // A value git already refuses stays refused. conductor's own git sees the
  // process environment, so the failure is repoRoot in src/cli.ts: rev-parse
  // exits 128 and the run says it is not a git repository, before a gate.
  it('is exit 2, never a pass, when GIT_CONFIG_PARAMETERS is unquoted', () => {
    const made = ordinary();
    const result = runCli(made.repo, ['run', '--trust-base', 'base', '--verbose'], made.bin, {
      GIT_CONFIG_PARAMETERS: 'core.useReplaceRefs=true',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/not a git repository/);
    expect(result.stdout + result.stderr).not.toMatch(/verdict-token: (pass|proposal|blocked|nothing-checked)/);
    expect(spawned(made)).toEqual([]);
  });

  it('is exit 2, never a pass, when GIT_CONFIG_PARAMETERS starts with a space', () => {
    const made = ordinary();
    const result = runCli(made.repo, ['run', '--trust-base', 'base', '--verbose'], made.bin, {
      GIT_CONFIG_PARAMETERS: " 'core.useReplaceRefs=true'",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/not a git repository/);
    expect(result.stdout + result.stderr).not.toMatch(/verdict-token: (pass|proposal|blocked|nothing-checked)/);
    expect(spawned(made)).toEqual([]);
  });

  /**
   * Point one commit's record in .git/objects/info/commit-graph at another
   * root tree, and recompute the trailing checksum. The commit object is
   * not touched. SHA-1 graphs only, the same five steps as the measured recipe.
   */
  function forgeCommitGraphRecord(repo: string, commitId: string, treeId: string): void {
    const graph = path.join(repo, '.git', 'objects', 'info', 'commit-graph');
    chmodSync(graph, 0o644);
    const bytes = Buffer.from(readFileSync(graph));
    if (bytes.subarray(0, 4).toString('latin1') !== 'CGPH' || bytes[5] !== 1) {
      throw new Error('not a SHA-1 commit-graph file');
    }
    const chunks = new Map<string, number>();
    const chunkCount = bytes[6] ?? 0;
    for (let row = 0; row < chunkCount + 1; row += 1) {
      const start = 8 + row * 12;
      chunks.set(bytes.subarray(start, start + 4).toString('latin1'), Number(bytes.readBigUInt64BE(start + 4)));
    }
    const fanout = chunks.get('OIDF');
    const lookup = chunks.get('OIDL');
    const records = chunks.get('CDAT');
    if (fanout === undefined || lookup === undefined || records === undefined) {
      throw new Error('commit-graph is missing OIDF, OIDL or CDAT');
    }
    const count = bytes.readUInt32BE(fanout + 255 * 4);
    const wanted = Buffer.from(commitId, 'hex');
    let index = -1;
    for (let i = 0; i < count; i += 1) {
      const start = lookup + i * 20;
      if (bytes.subarray(start, start + 20).equals(wanted)) {
        index = i;
        break;
      }
    }
    if (index < 0) {
      throw new Error('that commit is not in the graph');
    }
    Buffer.from(treeId, 'hex').copy(bytes, records + index * 36);
    createHash('sha1')
      .update(bytes.subarray(0, bytes.length - 20))
      .digest()
      .copy(bytes, bytes.length - 20);
    writeFileSync(graph, bytes);
  }

  /** A vault-guard that blocks only when git log -p base..HEAD shows the added file. */
  function historyGate(made: Scratch, patchLog: string): void {
    const file = path.join(made.bin, 'vault-guard');
    writeFileSync(`${file}.clean`, CLEAN_VAULT_GUARD);
    writeFileSync(`${file}.blocking`, BLOCKING_VAULT_GUARD);
    writeFileSync(
      file,
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then echo 9.9.9; exit 0; fi',
        `printf '%s\\n' "$*" >> ${JSON.stringify(made.argvLog)}`,
        'prev=""',
        'base=""',
        'for each in "$@"; do',
        '  if [ "$prev" = "--trust-base" ]; then base="$each"; fi',
        '  prev="$each"',
        'done',
        'patch="$(git log -p -U0 --full-history "$base"..HEAD)" || exit 3',
        `printf '%s\\n' "$patch" > ${JSON.stringify(patchLog)}`,
        `if printf '%s\\n' "$patch" | ${GREP} -F -q added-then-removed.txt; then ${CAT} ${JSON.stringify(`${file}.blocking`)}; exit 1; fi`,
        `${CAT} ${JSON.stringify(`${file}.clean`)}`,
        'exit 0',
        '',
      ].join('\n')
    );
    chmodSync(file, 0o755);
  }

  it('keeps an ordinary run blocked when a commit-graph record names the base tree for the middle commit', () => {
    const made = scratch();
    const patchLog = path.join(tempDir(), 'patch.txt');
    historyGate(made, patchLog);
    write(made.repo, '.guardrails.yaml', POLICY);
    write(made.repo, 'app.js', 'const x = 1;\n');
    commit(made.repo, 'the base, with a policy');
    git(made.repo, ['branch', 'base']);
    write(made.repo, 'added-then-removed.txt', 'present only in the middle commit\n');
    const middle = commit(made.repo, 'the middle commit adds a file');
    git(made.repo, ['rm', '--quiet', 'added-then-removed.txt']);
    // The tip tree has to differ from the base, or the trust base is refused
    // before the gate runs. The added file is still absent at the tip.
    write(made.repo, 'app.js', 'const x = 2;\n');
    commit(made.repo, 'the tip removes the file');
    const baseTree = git(made.repo, ['rev-parse', 'base^{tree}']);
    git(made.repo, ['commit-graph', 'write', '--reachable']);
    forgeCommitGraphRecord(made.repo, middle, baseTree);
    git(made.repo, ['config', 'core.commitGraph', 'true']);
    // Live for a git that consults the graph: the log has no patch for the file.
    expect(git(made.repo, ['log', '-p', '-U0', '--full-history', 'base..HEAD'])).not.toContain(
      'added-then-removed.txt'
    );
    const result = runCli(made.repo, ['run', '--trust-base', 'base', '--verbose'], made.bin);
    expect([result.status, result.stdout]).toEqual([1, expect.stringMatching(/^verdict-token: blocked \(1\)$/m)]);
    expect(readFileSync(patchLog, 'utf8')).toContain('added-then-removed.txt');
  });

  it('keeps an ordinary run blocked when GIT_TEST_COMMIT_GRAPH is set and a commit-graph record names the base tree', () => {
    const made = scratch();
    const patchLog = path.join(tempDir(), 'patch.txt');
    historyGate(made, patchLog);
    write(made.repo, '.guardrails.yaml', POLICY);
    write(made.repo, 'app.js', 'const x = 1;\n');
    commit(made.repo, 'the base, with a policy');
    git(made.repo, ['branch', 'base']);
    write(made.repo, 'added-then-removed.txt', 'present only in the middle commit\n');
    const middle = commit(made.repo, 'the middle commit adds a file');
    git(made.repo, ['rm', '--quiet', 'added-then-removed.txt']);
    write(made.repo, 'app.js', 'const x = 2;\n');
    commit(made.repo, 'the tip removes the file');
    const baseTree = git(made.repo, ['rev-parse', 'base^{tree}']);
    git(made.repo, ['commit-graph', 'write', '--reachable']);
    forgeCommitGraphRecord(made.repo, middle, baseTree);
    expect(git(made.repo, ['log', '-p', '-U0', '--full-history', 'base..HEAD'])).not.toContain(
      'added-then-removed.txt'
    );
    const result = runCli(made.repo, ['run', '--trust-base', 'base', '--verbose'], made.bin, {
      GIT_TEST_COMMIT_GRAPH: '1',
    });
    expect([result.status, result.stdout]).toEqual([1, expect.stringMatching(/^verdict-token: blocked \(1\)$/m)]);
    expect(readFileSync(patchLog, 'utf8')).toContain('added-then-removed.txt');
  });

  describe('gateChildEnv, against the real git', () => {
    /** What git itself makes of an environment: the value it reads for the key, or that it failed. */
    function gitReads(env: NodeJS.ProcessEnv): string {
      const repo = tempDir();
      git(repo, ['init', '--quiet']);
      git(repo, ['config', 'core.useReplaceRefs', 'true']);
      const asked = spawnSync(REAL_GIT, ['config', '--get', 'core.useReplaceRefs'], { cwd: repo, encoding: 'utf8', env });
      return asked.status === 0 ? (asked.stdout ?? '').trim() : 'git failed';
    }
    const base = (): NodeJS.ProcessEnv => withoutGitVariables(process.env);

    // Every spelling of the count: unset, empty, plain, and the ones strtoul
    // accepts that a strict reading would not. For each, EITHER git reads the
    // key as false over the repository configuration, OR git fails outright.
    // Never "true".
    it.each([
      [undefined, 'false'],
      ['', 'false'],
      ['0', 'false'],
      ['00', 'false'],
      [' 0', 'false'],
      ['+0', 'false'],
      ['-0', 'false'],
      ['abc', 'git failed'],
      ['-1', 'git failed'],
      ['1.5', 'git failed'],
      ['0x1', 'git failed'],
      ['1', 'git failed'],
      ['99999999999999999999', 'git failed'],
    ])('with GIT_CONFIG_COUNT %j, git reads %s', (count, expected) => {
      const env = gateChildEnv({ ...base(), ...(count === undefined ? {} : { GIT_CONFIG_COUNT: count }) });
      expect(gitReads(env)).toBe(expected);
    });

    it('wins over an earlier entry of the caller that sets the key to true', () => {
      const env = gateChildEnv({
        ...base(),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.useReplaceRefs',
        GIT_CONFIG_VALUE_0: 'true',
      });
      expect(env.GIT_CONFIG_COUNT).toBe('2');
      expect([env.GIT_CONFIG_KEY_0, env.GIT_CONFIG_VALUE_0]).toEqual(['core.useReplaceRefs', 'true']);
      expect([env.GIT_CONFIG_KEY_1, env.GIT_CONFIG_VALUE_1]).toEqual(['core.useReplaceRefs', 'false']);
      expect(gitReads(env)).toBe('false');
    });

    it('reads a count git accepts with a sign or a space as the number git reads', () => {
      const env = gateChildEnv({
        ...base(),
        GIT_CONFIG_COUNT: ' +1',
        GIT_CONFIG_KEY_0: 'core.useReplaceRefs',
        GIT_CONFIG_VALUE_0: 'true',
      });
      expect(env.GIT_CONFIG_COUNT).toBe('2');
      expect(gitReads(env)).toBe('false');
    });

    it('drops GIT_TEST_COMMIT_GRAPH and never changes what it was given', () => {
      const given = { ...base(), GIT_TEST_COMMIT_GRAPH: '1' };
      const env = gateChildEnv(given);
      expect(env.GIT_TEST_COMMIT_GRAPH).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(env, 'GIT_TEST_COMMIT_GRAPH')).toBe(false);
      expect(given.GIT_TEST_COMMIT_GRAPH).toBe('1');
      const clean = base();
      const dropped = gateChildEnv(clean);
      expect(Object.prototype.hasOwnProperty.call(dropped, 'GIT_TEST_COMMIT_GRAPH')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(clean, 'GIT_TEST_COMMIT_GRAPH')).toBe(false);
    });

    it('pinnedGitEnv drops GIT_TEST_COMMIT_GRAPH and never changes what it was given', () => {
      const given = { ...base(), GIT_TEST_COMMIT_GRAPH: '1' };
      const env = pinnedGitEnv(given);
      expect(env.GIT_TEST_COMMIT_GRAPH).toBeUndefined();
      expect(env.GIT_NO_REPLACE_OBJECTS).toBe('1');
      expect(env.GIT_GRAFT_FILE).toBe('/dev/null/conductor-no-grafts');
      expect(given.GIT_TEST_COMMIT_GRAPH).toBe('1');
    });

    it('leaves a count git refuses exactly as it was, still pins GIT_CONFIG_PARAMETERS, and never changes what it was given', () => {
      const given = { ...base(), GIT_CONFIG_COUNT: 'abc', GIT_CONFIG_PARAMETERS: "'user.name=Kept'" };
      const env = gateChildEnv(given);
      expect(env.GIT_CONFIG_COUNT).toBe('abc');
      expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
      expect(env.GIT_CONFIG_PARAMETERS).toBe(`'user.name=Kept' ${PARAMETER_PINS}`);
      expect(given.GIT_CONFIG_COUNT).toBe('abc');
      expect(given.GIT_CONFIG_PARAMETERS).toBe("'user.name=Kept'");
      const clean = base();
      gateChildEnv(clean);
      expect(clean.GIT_CONFIG_COUNT).toBeUndefined();
      expect(clean.GIT_CONFIG_PARAMETERS).toBeUndefined();
    });

    /** The value git reads for one key, or that the call failed. Repository config sets both pins' keys true. */
    function readsKey(env: NodeJS.ProcessEnv, key: string): string {
      const repo = tempDir();
      git(repo, ['init', '--quiet']);
      git(repo, ['config', 'core.useReplaceRefs', 'true']);
      git(repo, ['config', 'core.commitGraph', 'true']);
      const asked = spawnSync(REAL_GIT, ['config', '--get', key], { cwd: repo, encoding: 'utf8', env });
      return asked.status === 0 ? (asked.stdout ?? '').trim() : `git failed ${asked.status ?? 'none'}`;
    }

    it('with GIT_CONFIG_PARAMETERS unset, the value is the two pins and git reads both keys false', () => {
      const env = gateChildEnv(base());
      expect(env.GIT_CONFIG_PARAMETERS).toBe(PARAMETER_PINS);
      expect(readsKey(env, 'core.useReplaceRefs')).toBe('false');
      expect(readsKey(env, 'core.commitGraph')).toBe('false');
    });

    it('with GIT_CONFIG_PARAMETERS empty, the value is the two pins and git reads both keys false', () => {
      const env = gateChildEnv({ ...base(), GIT_CONFIG_PARAMETERS: '' });
      expect(env.GIT_CONFIG_PARAMETERS).toBe(PARAMETER_PINS);
      expect(readsKey(env, 'core.useReplaceRefs')).toBe('false');
      expect(readsKey(env, 'core.commitGraph')).toBe('false');
    });

    it('keeps a caller entry for user.name readable beside the pins', () => {
      const home = tempDir();
      const caller = "'user.name=Kept'";
      const env = gateChildEnv({ ...base(), HOME: home, GIT_CONFIG_PARAMETERS: caller });
      expect(env.GIT_CONFIG_PARAMETERS).toBe(`${caller} ${PARAMETER_PINS}`);
      expect(readsKey(env, 'user.name')).toBe('Kept');
      expect(readsKey(env, 'core.useReplaceRefs')).toBe('false');
      expect(readsKey(env, 'core.commitGraph')).toBe('false');
    });

    it.each([
      ['core.useReplaceRefs', 'count'],
      ['core.commitGraph', 'count'],
      ['core.useReplaceRefs', 'quoted-pair'],
      ['core.useReplaceRefs', 'quoted-halves'],
      ['core.commitGraph', 'quoted-pair'],
      ['core.commitGraph', 'quoted-halves'],
    ] as const)('reads %s as false when the caller set it true via %s', (key, channel) => {
      const env =
        channel === 'count'
          ? gateChildEnv({
              ...base(),
              GIT_CONFIG_COUNT: '1',
              GIT_CONFIG_KEY_0: key,
              GIT_CONFIG_VALUE_0: 'true',
            })
          : gateChildEnv({
              ...base(),
              GIT_CONFIG_PARAMETERS: channel === 'quoted-halves' ? `'${key}'='true'` : `'${key}=true'`,
            });
      expect(readsKey(env, key)).toBe('false');
    });

    it.each([
      ['unquoted', 'core.useReplaceRefs=true'],
      ['a leading space', " 'core.useReplaceRefs=true'"],
    ])('appends the pins to %s GIT_CONFIG_PARAMETERS and git still refuses it', (_label, raw) => {
      const env = gateChildEnv({ ...base(), GIT_CONFIG_PARAMETERS: raw });
      expect(env.GIT_CONFIG_PARAMETERS).toBe(`${raw} ${PARAMETER_PINS}`);
      const repo = tempDir();
      git(repo, ['init', '--quiet']);
      const asked = spawnSync(REAL_GIT, ['config', '--get', 'core.useReplaceRefs'], {
        cwd: repo,
        encoding: 'utf8',
        env,
      });
      expect(asked.status).toBe(128);
      expect(asked.stderr ?? '').toMatch(/bogus format in GIT_CONFIG_PARAMETERS/);
    });
  });

  // Same skip as tests/external-gates.real.e2e.test.ts: the binary is absent
  // unless CONDUCTOR_GITLEAKS_BIN is set or .local/bin/gitleaks exists.
  const GITLEAKS = process.env.CONDUCTOR_GITLEAKS_BIN ?? path.join(CONDUCTOR_ROOT, '.local', 'bin', 'gitleaks');
  const gitleaksGate: GatePolicy = {
    role: 'secrets-history',
    product: 'gitleaks',
    enabled: true,
    stage: 'ci',
    enforce: true,
    excludedByCli: false,
    options: {},
  };

  (existsSync(GITLEAKS) ? describe : describe.skip)('gitleaks, when the binary is present', () => {
    it('gitleaks still reports a secret added then removed when a commit-graph record names the base tree', () => {
      const repo = tempDir();
      git(repo, ['init', '--quiet', '-b', 'main']);
      write(repo, 'app.js', 'const x = 1;\n');
      commit(repo, 'base');
      git(repo, ['branch', 'base']);
      const token = ['dp', 'pt', 'q7ZkR2mXw9LpT4vB8nYc' + 'H3sJ6dF1gA5eK0uQzWxVbNm'].join('.');
      write(repo, 'src/config.js', `export const token = "${token}";\n`);
      const middle = commit(repo, 'middle adds a file');
      git(repo, ['rm', '--quiet', 'src/config.js']);
      commit(repo, 'tip removes it');
      const baseTree = git(repo, ['rev-parse', 'base^{tree}']);
      git(repo, ['commit-graph', 'write', '--reachable']);
      forgeCommitGraphRecord(repo, middle, baseTree);
      git(repo, ['config', 'core.commitGraph', 'true']);
      const out = runGate(gitleaksGate, {
        repoRoot: repo,
        staged: false,
        pathValue: path.dirname(GITLEAKS),
        tempRoot: tempDir(),
        trustBase: 'base',
      });
      expect(out.couldNotRun).toBeNull();
      expect(out.exitCode).toBe(3);
      expect(out.findings.some((f) => f.subject.kind === 'location' && f.subject.file === 'src/config.js')).toBe(true);
    });

    it('gitleaks still reports a secret added then removed when GIT_TEST_COMMIT_GRAPH is set and a commit-graph record names the base tree', () => {
      const repo = tempDir();
      git(repo, ['init', '--quiet', '-b', 'main']);
      write(repo, 'app.js', 'const x = 1;\n');
      commit(repo, 'base');
      git(repo, ['branch', 'base']);
      const token = ['dp', 'pt', 'q7ZkR2mXw9LpT4vB8nYc' + 'H3sJ6dF1gA5eK0uQzWxVbNm'].join('.');
      write(repo, 'src/config.js', `export const token = "${token}";\n`);
      const middle = commit(repo, 'middle adds a file');
      git(repo, ['rm', '--quiet', 'src/config.js']);
      commit(repo, 'tip removes it');
      const baseTree = git(repo, ['rev-parse', 'base^{tree}']);
      git(repo, ['commit-graph', 'write', '--reachable']);
      forgeCommitGraphRecord(repo, middle, baseTree);
      const previous = process.env.GIT_TEST_COMMIT_GRAPH;
      process.env.GIT_TEST_COMMIT_GRAPH = '1';
      try {
        const out = runGate(gitleaksGate, {
          repoRoot: repo,
          staged: false,
          pathValue: path.dirname(GITLEAKS),
          tempRoot: tempDir(),
          trustBase: 'base',
        });
        expect(out.couldNotRun).toBeNull();
        expect(out.exitCode).toBe(3);
        expect(out.findings.some((f) => f.subject.kind === 'location' && f.subject.file === 'src/config.js')).toBe(true);
      } finally {
        if (previous === undefined) {
          delete process.env.GIT_TEST_COMMIT_GRAPH;
        } else {
          process.env.GIT_TEST_COMMIT_GRAPH = previous;
        }
      }
    });
  });
});

describe('the proposal run: which policy it runs', () => {
  it('reads the policy from the HEAD commit, never from the file on disk', () => {
    const made = adoption();
    // An uncommitted edit switches the secrets gate off. HEAD still enables it.
    write(made.repo, '.guardrails.yaml', POLICY.replace('product: vault-guard\n', 'product: vault-guard\n    enabled: false\n'));
    const result = runCli(made.repo, PROPOSE, made.bin);
    expect(result.status).toBe(0);
    expect(spawned(made)).toHaveLength(2);
    expect(result.stdout).toMatch(/^gate secrets \(vault-guard 9\.9\.9\): ran/m);
  });

  it('takes enabled, stage and enforce from the head policy and nothing else', () => {
    const made = adoption({
      headPolicy: [
        'version: 1',
        'gates:',
        '  dependencies:',
        '    product: dep-guard',
        '    enabled: false',
        '  secrets:',
        '    product: vault-guard',
        '    command: {{attacker}}',
        '    timeout-seconds: 70',
        '    enforce: false',
        'report:',
        '  format: sarif',
        '',
      ].join('\n'),
    });
    const result = runCli(made.repo, PROPOSE, made.bin);
    expect(result.status).toBe(0);
    // The head's script never ran; the vault-guard on PATH did, and only it.
    expect(existsSync(made.marker)).toBe(false);
    expect(spawned(made)).toHaveLength(1);
    // report.format was not applied: this is the text report.
    expect(result.stdout).toMatch(/^verdict-token: proposal \(0\)$/m);
    // What was not applied is listed as proposed, and what was applied is not.
    expect(result.stdout).toMatch(/pull-request mode: no policy on base; this run previews the policy this pull request adds\. 3 control change\(s\) proposed/);
    expect(result.stdout).toMatch(/proposed.*command/);
    expect(result.stdout).toMatch(/proposed.*timeout-seconds/);
    expect(result.stdout).toMatch(/proposed.*report\.format/);
    expect(result.stdout).not.toMatch(/proposed.*enforce/);
    expect(result.stdout).not.toMatch(/proposed.*enabled/);
    expect(result.stdout).not.toMatch(/rules from base/);
  });

  it('hands every gate the trust base, as on any pull-request run', () => {
    const made = adoption();
    runCli(made.repo, PROPOSE, made.bin);
    const lines = spawned(made);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatch(/--trust-base/);
    }
  });

  it('ignores --preview without error: the same gates, the same arguments, no preview section', () => {
    const plain = adoption();
    const first = runCli(plain.repo, PROPOSE, plain.bin);
    const previewed = adoption();
    const second = runCli(previewed.repo, [...PROPOSE, '--preview'], previewed.bin);
    expect(second.status).toBe(0);
    expect(spawned(previewed)).toHaveLength(2);
    expect(spawned(previewed).map((line) => line.replace(/[0-9a-f]{40}/g, 'ID'))).toEqual(
      spawned(plain).map((line) => line.replace(/[0-9a-f]{40}/g, 'ID'))
    );
    expect(second.stdout).not.toMatch(/preview under the proposed rules/i);
    expect(second.stdout.split('\n').slice(0, 4)).toEqual(first.stdout.split('\n').slice(0, 4));
  });

  it('honours --gate, and refuses a role the proposed policy does not declare', () => {
    const made = adoption();
    const one = runCli(made.repo, [...PROPOSE, '--gate', 'secrets'], made.bin);
    expect(one.status).toBe(0);
    expect(spawned(made)).toHaveLength(1);
    const undeclared = runCli(made.repo, [...PROPOSE, '--gate', 'intent'], made.bin);
    expect(undeclared.status).toBe(2);
    expect(undeclared.stdout).toBe('');
  });
});

describe('the proposal run: exit code and tokens', () => {
  function blocking(headPolicy?: string): Scratch {
    const made = adoption(headPolicy === undefined ? {} : { headPolicy });
    stubGate(made.bin, 'vault-guard', { stdout: BLOCKING_VAULT_GUARD, exit: 1, argvLog: made.argvLog });
    return made;
  }

  it('exits 0 with proposal (N) when the proposed policy would block', () => {
    const made = blocking();
    const result = runCli(made.repo, PROPOSE, made.bin);
    expect(result.status).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines[1]).toBe('verdict-token: proposal (1)');
    expect(lines[2]).toBe(PROPOSAL_LINE(1));
    expect(result.stdout).toMatch(/^would block once the policy is on the base: 1 \(1 blocking\):$/m);
    expect(result.stdout).not.toMatch(/^findings:$/m);
    expect(result.stdout).toMatch(
      /^verdict: exit 0, proposal, not a verdict: there is no \.guardrails\.yaml on "base", so nothing here could be enforced\. 1 would block once this policy is on the base branch\.$/m
    );
    expect(result.stdout).not.toMatch(/verdict-token: (pass|blocked|nothing-checked)/);
  });

  it('labels the one job-log line of a run whose report went to a file', () => {
    const made = blocking();
    const out = path.join(tempDir(), 'report.sarif');
    const result = runCli(made.repo, [...PROPOSE, '--format', 'sarif', '--output', out], made.bin);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(
      /^conductor run: proposal, no policy on "base": 2 gate\(s\), 1 finding\(s\); verdict-token proposal \(1\); /m
    );
    expect(result.stderr).toMatch(/^conductor: would block once the policy is on the base: 1 \(1 blocking\):$/m);
  });

  it('prints the full report without --verbose, never the one clean line', () => {
    const made = adoption();
    const result = runCli(made.repo, ['run', '--trust-base', 'base', '--adoption-proposal'], made.bin);
    expect(result.status).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines[1]).toBe('verdict-token: proposal (0)');
    expect(lines[2]).toBe(PROPOSAL_LINE(0));
    expect(result.stdout).toMatch(/^verdict: exit 0, proposal, not a verdict/m);
  });

  it('is proposal-nothing-checked when the proposed policy enables no gate', () => {
    const made = adoption({ headPolicy: POLICY.replace(/(product: [a-z-]+)\n/g, '$1\n    enabled: false\n') });
    const result = runCli(made.repo, PROPOSE, made.bin);
    expect(result.status).toBe(0);
    expect(result.stdout.split('\n')[1]).toBe('verdict-token: proposal-nothing-checked');
    expect(result.stdout).toMatch(/^proposal: no \.guardrails\.yaml on the base branch/m);
    expect(spawned(made)).toEqual([]);
  });

  it('does not count an unenforced gate in N', () => {
    const made = blocking(POLICY.replace('product: vault-guard\n', 'product: vault-guard\n    enforce: false\n'));
    const result = runCli(made.repo, PROPOSE, made.bin);
    expect(result.status).toBe(0);
    expect(result.stdout.split('\n')[1]).toBe('verdict-token: proposal (0)');
  });

  it('--advisory changes nothing on a proposal', () => {
    const made = blocking();
    const result = runCli(made.repo, [...PROPOSE, '--advisory'], made.bin);
    expect(result.status).toBe(0);
    expect(result.stdout.split('\n')[1]).toBe('verdict-token: proposal (1)');
  });

  describe('a gate the proposed policy enforces could not run (ruled 2026-11-10)', () => {
    function broken(headPolicy?: string): Scratch {
      const made = blocking(headPolicy);
      rmSync(path.join(made.bin, 'dep-guard'));
      return made;
    }

    it('exits 2 with could-not-run, never a proposal', () => {
      const made = broken();
      const result = runCli(made.repo, PROPOSE, made.bin);
      expect(result.status).toBe(2);
      expect(result.stdout.split('\n')[1]).toBe('verdict-token: could-not-run');
      expect(result.stdout).not.toMatch(/^proposal:/m);
      expect(result.stdout).not.toMatch(/verdict-token: proposal/);
      expect(result.stdout).not.toMatch(/proposal, not a verdict/);
      // Still honest about where the rules came from.
      expect(result.stdout).toMatch(/pull-request mode: no policy on base/);
      expect(result.stdout).not.toMatch(/rules from base/);
    });

    it('stays exit 2 under --advisory', () => {
      const made = broken();
      expect(runCli(made.repo, [...PROPOSE, '--advisory'], made.bin).status).toBe(2);
    });

    it('is still a proposal, exit 0, when that gate has enforce: false, and is not counted', () => {
      const made = broken(POLICY.replace('product: dep-guard\n', 'product: dep-guard\n    enforce: false\n'));
      const result = runCli(made.repo, PROPOSE, made.bin);
      expect(result.status).toBe(0);
      const lines = result.stdout.split('\n');
      expect(lines[1]).toBe('verdict-token: proposal (1)');
      expect(lines[2]).toBe(PROPOSAL_LINE(1));
      expect(result.stdout).toMatch(/dependencies could not run, and the proposed policy has enforce: false there\.$/m);
    });
  });
});

describe('the proposal run: the SARIF log', () => {
  it('marks the run, every result and one warning notification, and stays exit 0', () => {
    const made = adoption();
    stubGate(made.bin, 'vault-guard', { stdout: BLOCKING_VAULT_GUARD, exit: 1, argvLog: made.argvLog });
    const result = runCli(made.repo, [...PROPOSE, '--format', 'sarif'], made.bin);
    expect(result.status).toBe(0);
    const log = JSON.parse(result.stdout) as {
      runs: Array<{
        tool: { driver: { name: string } };
        results: Array<{ properties: { proposal?: boolean; blocking: boolean } }>;
        properties?: { trustBase?: { proposal?: { reason: string } } };
        invocations?: Array<{
          executionSuccessful: boolean;
          toolExecutionNotifications?: Array<{ descriptor: { id: string }; level: string; message: { text: string } }>;
        }>;
      }>;
    };
    const umbrella = log.runs.find((run) => run.tool.driver.name === 'conductor');
    expect(umbrella?.properties?.trustBase?.proposal).toEqual({ reason: 'no-policy-on-base' });
    const notes = umbrella?.invocations?.[0]?.toolExecutionNotifications ?? [];
    const marker = notes.filter((note) => note.descriptor.id === 'conductor/proposal-run');
    expect(marker).toHaveLength(1);
    expect(marker[0]?.level).toBe('warning');
    expect(marker[0]?.message.text).toMatch(/NOTHING IN THIS LOG WAS ENFORCED/);
    expect(umbrella?.invocations?.[0]?.executionSuccessful).toBe(true);
    const results = log.runs.flatMap((run) => run.results);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((entry) => entry.properties.proposal === true)).toBe(true);
    expect(result.stdout).not.toMatch(/The rules came from/);
  });

  it('carries no proposal marker on an ordinary pull-request run', () => {
    const made = scratch();
    write(made.repo, '.guardrails.yaml', POLICY);
    commit(made.repo, 'base, with a policy');
    git(made.repo, ['branch', 'base']);
    write(made.repo, 'app.js', 'const x = 2;\n');
    commit(made.repo, 'an ordinary pull request');
    stubGate(made.bin, 'vault-guard', { stdout: BLOCKING_VAULT_GUARD, exit: 1, argvLog: made.argvLog });
    const result = runCli(made.repo, [...PROPOSE, '--format', 'sarif'], made.bin);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toMatch(/"proposal"/);
    expect(result.stdout).not.toMatch(/conductor\/proposal-run/);
  });
});

describe('the no-policy and policy-removed lines', () => {
  it('says the workflow checks nothing when neither side has a policy, exit 2', () => {
    const made = scratch();
    write(made.repo, 'app.js', 'const x = 1;\n');
    commit(made.repo, 'base');
    git(made.repo, ['branch', 'base']);
    write(made.repo, 'app.js', 'const x = 2;\n');
    commit(made.repo, 'a pull request');
    const result = runCli(made.repo, PROPOSE, made.bin);
    expect(result.status).toBe(2);
    const lines = result.stdout.split('\n');
    expect(lines[1]).toBe('verdict-token: could-not-run');
    expect(lines[2]).toBe(
      'no-policy: this workflow checks nothing until .guardrails.yaml is on the base branch; run conductor init and merge it'
    );
    expect(result.stdout).toMatch(/^trust-base: refused, no rules were read and no gate ran$/m);
    expect(spawned(made)).toEqual([]);
  });

  it('appends the no-policy line to the step summary on a push run with no policy file', () => {
    const made = scratch();
    write(made.repo, 'app.js', 'const x = 1;\n');
    commit(made.repo, 'no policy anywhere');
    const summary = path.join(tempDir(), 'summary.md');
    const result = runCli(made.repo, ['run'], made.bin, { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/No \.guardrails\.yaml in/);
    expect(readFileSync(summary, 'utf8')).toBe(
      'no-policy: this workflow checks nothing until .guardrails.yaml is on the base branch; run conductor init and merge it\n\n'
    );
    // Outside Actions nothing is written anywhere.
    const local = path.join(tempDir(), 'summary.md');
    runCli(made.repo, ['run'], made.bin, { GITHUB_STEP_SUMMARY: local });
    expect(existsSync(local)).toBe(false);
  });

  it('does not call an unparseable policy file a missing one', () => {
    const made = scratch();
    write(made.repo, '.guardrails.yaml', 'version: 1\ngates: nonsense\n');
    commit(made.repo, 'a broken policy');
    const summary = path.join(tempDir(), 'summary.md');
    const result = runCli(made.repo, ['run'], made.bin, { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary });
    expect(result.status).toBe(2);
    expect(existsSync(summary)).toBe(false);
  });

  it('names a pull request that deletes the policy, on the ordinary run under the base rules', () => {
    const made = scratch();
    write(made.repo, '.guardrails.yaml', POLICY);
    write(made.repo, 'app.js', 'const x = 1;\n');
    commit(made.repo, 'base, with a policy');
    git(made.repo, ['branch', 'base']);
    git(made.repo, ['rm', '--quiet', '.guardrails.yaml']);
    commit(made.repo, 'the pull request deletes it');
    const result = runCli(made.repo, PROPOSE, made.bin);
    expect(result.status).toBe(0);
    expect(result.stdout.split('\n')[1]).toBe('verdict-token: pass');
    expect(result.stdout).toMatch(
      /^policy-removed: this pull request deletes \.guardrails\.yaml; once merged, nothing is enforced on the base branch and every pull-request run is refused until a policy is back on it$/m
    );
    expect(result.stdout).not.toMatch(/^proposal:/m);
    // The base's gates still ran.
    expect(spawned(made)).toHaveLength(2);
  });

  it('prints no policy-removed line when the head only changes the policy', () => {
    const made = scratch();
    write(made.repo, '.guardrails.yaml', POLICY);
    commit(made.repo, 'base, with a policy');
    git(made.repo, ['branch', 'base']);
    write(made.repo, '.guardrails.yaml', `${POLICY}# a comment\n`);
    commit(made.repo, 'the pull request edits it');
    const result = runCli(made.repo, PROPOSE, made.bin);
    expect(result.stdout).not.toMatch(/policy-removed/);
  });
});
