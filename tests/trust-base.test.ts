// Pull-request mode, at the level of the four decisions it rests on.
//
// Real git repositories, never a mocked one. Three of the four refusals here
// are about what a ref RESOLVES to, and a mock would only prove the umbrella
// agrees with whoever wrote the mock. The fourth, the version comparison, is
// pure and needs none.

import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  atLeastVersion,
  policyDiffers,
  readPolicyAtRef,
  refuseTrustBaseRef,
} from '../src/trust-base.js';

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/** An empty repository with an identity, and no commits yet. */
function emptyRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-trust-'));
  temps.push(dir);
  git(dir, ['init', '--quiet', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  return dir;
}

function commit(repo: string, files: Record<string, string>, message: string): string {
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(repo, name), contents);
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

const BASE_POLICY = [
  'version: 1',
  'gates:',
  '  secrets:',
  '    product: vault-guard',
  '',
].join('\n');

describe('refusing a trust base', () => {
  it('accepts a ref that is a different commit with a different tree', () => {
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['branch', 'base']);
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'head');

    expect(refuseTrustBaseRef(repo, 'base')).toBeNull();
  });

  it('refuses a ref that does not resolve, and says how to fetch it', () => {
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');

    const refusal = refuseTrustBaseRef(repo, 'origin/nope');
    expect(refusal).toMatch(/does not resolve to a commit/);
    expect(refusal).toMatch(/origin\/nope/);
    expect(refusal).toMatch(/fetch-depth: 0/);
    expect(refusal).toMatch(/Nothing was checked/);
  });

  it('refuses a ref that resolves to the head commit', () => {
    // The live shape of this mistake is --trust-base with github.sha, which
    // on a pull_request event IS the merge commit, which is HEAD. Every
    // control input would come from the tree being judged while the run
    // reported pull-request mode as on.
    const repo = emptyRepo();
    const head = commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'only');

    const refusal = refuseTrustBaseRef(repo, head);
    expect(refusal).toMatch(/the same commit as HEAD/);
    expect(refusal).toMatch(head.slice(0, 12));
  });

  it('refuses a different commit that carries an identical tree', () => {
    // A commit comparison alone waves this through, and it is not a
    // curiosity: a pull request merge ref carries the head branch's tree
    // whenever the base has not moved since the fork.
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'first');
    git(repo, ['commit', '--quiet', '--allow-empty', '-m', 'second, same tree']);

    const refusal = refuseTrustBaseRef(repo, 'HEAD~1');
    expect(refusal).toMatch(/identical tree/);
    expect(refusal).toMatch(/Nothing was checked/);
  });

  it('refuses when there is no head commit to compare against', () => {
    const repo = emptyRepo();

    // Nothing resolves in a repository with no commits, so this lands on the
    // first refusal. What matters is that it refuses rather than reading the
    // working tree.
    expect(refuseTrustBaseRef(repo, 'HEAD')).not.toBeNull();
  });
});

describe('reading the policy file at a ref', () => {
  it('reads the base ref file, not the one in the working tree', () => {
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    git(repo, ['branch', 'base']);
    commit(repo, { '.guardrails.yaml': 'version: 1\ngates: {}\n' }, 'head rewrites it');
    writeFileSync(path.join(repo, '.guardrails.yaml'), 'version: 1\n# and an uncommitted edit\n');

    expect(readPolicyAtRef(repo, 'base')).toBe(BASE_POLICY);
  });

  it('reads the head commit rather than the working tree for the head side', () => {
    const repo = emptyRepo();
    commit(repo, { '.guardrails.yaml': BASE_POLICY }, 'base');
    writeFileSync(path.join(repo, '.guardrails.yaml'), 'version: 1\ngates: {}\n');

    // An uncommitted local edit is not something a pull request proposes.
    expect(readPolicyAtRef(repo, 'HEAD')).toBe(BASE_POLICY);
  });

  it('answers null when the ref carries no policy file at all', () => {
    const repo = emptyRepo();
    commit(repo, { 'app.js': 'const x = 1;\n' }, 'no policy here');

    expect(readPolicyAtRef(repo, 'HEAD')).toBeNull();
  });
});

describe('deciding whether the policy changed', () => {
  it('ignores formatting, so a reflow is not reported as a proposal', () => {
    const a = 'version: 1\ngates:\n  secrets:\n    product: vault-guard\n';
    const b = "version: 1\ngates: { secrets: { product: 'vault-guard' } }\n";

    expect(policyDiffers(a, b)).toBe(false);
  });

  it('reports a changed option even when nothing else moved', () => {
    const a = 'version: 1\ngates:\n  secrets:\n    product: vault-guard\n';
    const b =
      'version: 1\ngates:\n  secrets:\n    product: vault-guard\n    options:\n      fail-on: none\n';

    expect(policyDiffers(a, b)).toBe(true);
  });

  it('reports a policy that only one side has', () => {
    expect(policyDiffers('version: 1\n', null)).toBe(true);
    expect(policyDiffers(null, 'version: 1\n')).toBe(true);
    expect(policyDiffers(null, null)).toBe(false);
  });

  it('falls back to comparing text when a side will not parse, which fails closed', () => {
    // A head policy that is not YAML at all, or a symlink whose target string
    // arrives here instead of a document. Reporting it as changed is the safe
    // direction; the base ref's policy is what ran either way.
    expect(policyDiffers('version: 1\n', '\t: : not yaml\n  - [')).toBe(true);
  });
});

describe('the version floor for handing a gate the flag', () => {
  it('accepts the version the flag arrived in and everything above it', () => {
    expect(atLeastVersion('1.4.0', '1.4.0')).toBe(true);
    expect(atLeastVersion('1.4.1', '1.4.0')).toBe(true);
    expect(atLeastVersion('2.0.0', '1.4.0')).toBe(true);
  });

  it('compares components numerically, so 1.10.0 is above 1.4.0', () => {
    // A string comparison puts "1.10.0" below "1.4.0" and would withhold the
    // flag from every build after the ninth minor.
    expect(atLeastVersion('1.10.0', '1.4.0')).toBe(true);
  });

  it('refuses a build below the floor', () => {
    expect(atLeastVersion('1.3.1', '1.4.0')).toBe(false);
    expect(atLeastVersion('0.9.9', '1.4.0')).toBe(false);
  });

  it('treats an unreadable version as below the floor', () => {
    // The safe direction: handing an older build a flag it does not parse
    // makes it exit non-zero with no JSON, which turns a working gate into a
    // could-not-run and a working repository's pull requests red.
    expect(atLeastVersion(null, '1.4.0')).toBe(false);
    expect(atLeastVersion('not a version', '1.4.0')).toBe(false);
    expect(atLeastVersion('1.4', '1.4.0')).toBe(false);
  });

  it('accepts a leading v, which is how some builds print it', () => {
    expect(atLeastVersion('v1.4.0', '1.4.0')).toBe(true);
  });
});
