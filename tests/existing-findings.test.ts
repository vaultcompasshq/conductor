// The "existing findings" message on a blocked run with no base.
//
// Words only: the second half proves the section moves no exit code, no
// verdict token and no blocking flag. The git facts (predates the policy,
// gone at HEAD) are measured against real scratch repositories; the findings
// are built by hand with fabricated commit ids taken from those repositories.

import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Finding } from '../src/envelope.js';
import { collectExistingFindings, existingFindingsLines } from '../src/existing-findings.js';
import type { GateOutcome } from '../src/gate-runner.js';
import { renderText, verdictToken } from '../src/output-text.js';
import type { RunResult } from '../src/run.js';

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() as string, { recursive: true, force: true });
  }
});
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conductor-existing-'));
  temps.push(dir);
  return dir;
}

function git(repo: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', ...args],
    { cwd: repo, encoding: 'utf8' }
  ).trim();
}

function commit(repo: string, files: Record<string, string | null>, message: string): string {
  for (const [name, body] of Object.entries(files)) {
    if (body === null) {
      git(repo, ['rm', '--quiet', name]);
      continue;
    }
    mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    writeFileSync(path.join(repo, name), body);
    git(repo, ['add', '-f', name]);
  }
  git(repo, ['commit', '--quiet', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

interface Scratch {
  repo: string;
  old1: string;
  old2: string;
  policy: string;
  newer: string;
}

/**
 * old1 adds gone.txt and kept.txt, old2 removes gone.txt, the policy commit
 * adds .guardrails.yaml, newer adds later.txt after it.
 */
function scratch(): Scratch {
  const repo = tempDir();
  git(repo, ['init', '--quiet', '-b', 'main']);
  const old1 = commit(repo, { 'gone.txt': 'one\n', 'kept.txt': 'two\n' }, 'old one');
  const old2 = commit(repo, { 'gone.txt': null }, 'old two');
  const policy = commit(repo, { '.guardrails.yaml': 'version: 1\n' }, 'add the policy');
  const newer = commit(repo, { 'later.txt': 'three\n' }, 'after the policy');
  return { repo, old1, old2, policy, newer };
}

function leak(file: string, commitId: string, alsoIn: string[] = []): Finding {
  return {
    schemaVersion: 1,
    product: 'gitleaks',
    productVersion: '8.30.1',
    ruleId: 'gitleaks/generic-api-key',
    severity: 'high',
    severityIsDerived: true,
    blocking: true,
    message: 'a fabricated finding',
    subject: { kind: 'location', file, line: 1, column: 1 },
    fingerprint: { value: `${commitId}:${file}:generic-api-key:1`, scope: 'gitleaks', stability: 'stable' },
    details: { commit: commitId, ...(alsoIn.length === 0 ? {} : { alsoIn }) },
  };
}

function advisory(blocking = true): Finding {
  return {
    schemaVersion: 1,
    product: 'osv-scanner',
    productVersion: '2.4.0',
    ruleId: 'osv/GHSA-fake-0000-0000',
    severity: 'high',
    severityIsDerived: false,
    blocking,
    message: 'a fabricated advisory',
    subject: { kind: 'package', name: 'left-pad', manifest: 'package-lock.json' },
    fingerprint: null,
    details: { version: '1.0.0' },
  };
}

function outcome(overrides: Partial<GateOutcome>): GateOutcome {
  return {
    role: 'secrets-history',
    product: 'gitleaks',
    productVersion: '8.30.1',
    argv: [],
    binary: null,
    exitCode: 1,
    durationMs: 10,
    stage: 'ci',
    enforce: true,
    couldNotRun: null,
    findings: [],
    run: { failOn: null, suppressed: 0, ignored: 0, diagnostics: [], details: {} },
    diagnostics: [],
    stderr: '',
    ...overrides,
  } as GateOutcome;
}

const history = (findings: Finding[], overrides: Partial<GateOutcome> = {}): GateOutcome =>
  outcome({ findings, ...overrides });
const vulns = (findings: Finding[], overrides: Partial<GateOutcome> = {}): GateOutcome =>
  outcome({ role: 'vulnerabilities', product: 'osv-scanner', productVersion: '2.4.0', findings, ...overrides });

function runResult(gates: GateOutcome[], extra: Partial<RunResult> = {}): RunResult {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-10T00:00:00.000Z',
    gates,
    deferred: [],
    skipped: [],
    excluded: [],
    treeUnchanged: [],
    findings: gates.flatMap((g) => g.findings),
    trustBase: null,
    proposals: [],
    summary: { blocking: 0, byProduct: {}, bySeverity: {} },
    exitCode: 1,
    ...extra,
  };
}

describe('collecting the existing-findings facts', () => {
  it('counts a history finding as predating only when it is in commits made before the policy', () => {
    const s = scratch();
    const info = collectExistingFindings([history([leak('kept.txt', s.old1), leak('later.txt', s.newer)])], s.repo);
    expect(info?.history).toBe(2);
    expect(info?.predating).toEqual({ kind: 'count', count: 1 });
  });

  it('does not count a finding whose kept commit is old but whose alsoIn holds a newer commit (forged-date shape)', () => {
    const s = scratch();
    const info = collectExistingFindings([history([leak('kept.txt', s.old1, [s.newer])])], s.repo);
    expect(info?.predating).toEqual({ kind: 'count', count: 0 });
  });

  it('does not count a finding that carries no commit', () => {
    const s = scratch();
    const noCommit = leak('kept.txt', s.old1);
    noCommit.details = {};
    const info = collectExistingFindings([history([noCommit])], s.repo);
    expect(info?.predating).toEqual({ kind: 'count', count: 0 });
  });

  it('says the policy is not committed yet when it is not, and counts nothing as a number', () => {
    const repo = tempDir();
    git(repo, ['init', '--quiet', '-b', 'main']);
    const first = commit(repo, { 'a.txt': 'x\n' }, 'only');
    const info = collectExistingFindings([history([leak('a.txt', first)])], repo);
    expect(info?.predating).toEqual({ kind: 'not-committed' });
  });

  it('counts nothing as predating when the policy came in with the root commit', () => {
    const repo = tempDir();
    git(repo, ['init', '--quiet', '-b', 'main']);
    const root = commit(repo, { '.guardrails.yaml': 'version: 1\n', 'a.txt': 'x\n' }, 'root');
    const info = collectExistingFindings([history([leak('a.txt', root)])], repo);
    expect(info?.predating).toEqual({ kind: 'count', count: 0 });
  });

  describe('policy histories that are not a straight line', () => {
    const mergeNoFf = (repo: string, branch: string): string => {
      git(repo, ['merge', '--no-ff', '--quiet', '-m', `merge ${branch}`, branch]);
      return git(repo, ['rev-parse', 'HEAD']);
    };
    const predatingOf = (repo: string, commits: string[]) =>
      collectExistingFindings([history(commits.map((id, i) => leak(`f${i}.txt`, id)))], repo)?.predating;

    it('a local branch that forked before the policy and merged main in: only what predates the policy on main counts (case H)', () => {
      const repo = tempDir();
      git(repo, ['init', '--quiet', '-b', 'main']);
      const s = commit(repo, { 'a.txt': 'x\n' }, 's on main');
      git(repo, ['checkout', '--quiet', '-b', 'local']);
      const l = commit(repo, { 'b.txt': 'y\n' }, 'l on local');
      git(repo, ['checkout', '--quiet', 'main']);
      commit(repo, { '.guardrails.yaml': 'version: 1\n' }, 'policy on main');
      git(repo, ['checkout', '--quiet', 'local']);
      mergeNoFf(repo, 'main');
      expect(predatingOf(repo, [s, l])).toEqual({ kind: 'count', count: 1 });
    });

    it('the same shape with a secret committed after the merge is not counted either', () => {
      const repo = tempDir();
      git(repo, ['init', '--quiet', '-b', 'main']);
      const s = commit(repo, { 'a.txt': 'x\n' }, 's');
      git(repo, ['checkout', '--quiet', '-b', 'local']);
      commit(repo, { 'b.txt': 'y\n' }, 'l');
      git(repo, ['checkout', '--quiet', 'main']);
      commit(repo, { '.guardrails.yaml': 'version: 1\n' }, 'policy');
      git(repo, ['checkout', '--quiet', 'local']);
      mergeNoFf(repo, 'main');
      const later = commit(repo, { 'c.txt': 'z\n' }, 'after');
      expect(predatingOf(repo, [s, later])).toEqual({ kind: 'count', count: 1 });
    });

    it('a policy that came in through a no-ff pull-request merge counts what was on main before the branch forked', () => {
      const repo = tempDir();
      git(repo, ['init', '--quiet', '-b', 'main']);
      const old = commit(repo, { 'a.txt': 'x\n' }, 'old');
      git(repo, ['checkout', '--quiet', '-b', 'pr']);
      commit(repo, { '.guardrails.yaml': 'version: 1\n' }, 'add policy on the branch');
      git(repo, ['checkout', '--quiet', 'main']);
      mergeNoFf(repo, 'pr');
      const after = commit(repo, { 'c.txt': 'z\n' }, 'after');
      expect(predatingOf(repo, [old, after])).toEqual({ kind: 'count', count: 1 });
    });

    it('a policy deleted and added again counts only what predates the first add', () => {
      const repo = tempDir();
      git(repo, ['init', '--quiet', '-b', 'main']);
      const old = commit(repo, { 'a.txt': 'x\n' }, 'old');
      commit(repo, { '.guardrails.yaml': 'version: 1\n' }, 'add');
      const between = commit(repo, { '.guardrails.yaml': null }, 'delete');
      commit(repo, { '.guardrails.yaml': 'version: 1\n' }, 're-add');
      expect(predatingOf(repo, [old, between])).toEqual({ kind: 'count', count: 1 });
    });

    it('a policy renamed into place counts as added', () => {
      const repo = tempDir();
      git(repo, ['init', '--quiet', '-b', 'main']);
      const old = commit(repo, { 'a.txt': 'x\n' }, 'old');
      commit(repo, { 'draft.yaml': 'version: 1\n' }, 'draft');
      git(repo, ['mv', 'draft.yaml', '.guardrails.yaml']);
      git(repo, ['commit', '--quiet', '-m', 'rename into place']);
      const after = commit(repo, { 'c.txt': 'z\n' }, 'after');
      expect(predatingOf(repo, [old, after])).toEqual({ kind: 'count', count: 1 });
    });

    it('a policy added independently on two branches counts only what predates BOTH adds', () => {
      const repo = tempDir();
      git(repo, ['init', '--quiet', '-b', 'main']);
      const base = commit(repo, { 'a.txt': 'x\n' }, 'base');
      git(repo, ['checkout', '--quiet', '-b', 'one']);
      commit(repo, { '.guardrails.yaml': 'version: 1\n' }, 'policy on one');
      git(repo, ['checkout', '--quiet', 'main']);
      const mid = commit(repo, { 'b.txt': 'y\n' }, 'main moves on');
      git(repo, ['checkout', '--quiet', '-b', 'two']);
      commit(repo, { '.guardrails.yaml': 'version: 1\n' }, 'policy on two');
      git(repo, ['checkout', '--quiet', 'main']);
      mergeNoFf(repo, 'one');
      git(repo, ['merge', '--no-ff', '--quiet', '-m', 'merge two', 'two']);
      expect(predatingOf(repo, [base, mid])).toEqual({ kind: 'count', count: 1 });
    });

    it('an octopus merge that brings in two policy-adding branches counts only what predates both', () => {
      const repo = tempDir();
      git(repo, ['init', '--quiet', '-b', 'main']);
      const base = commit(repo, { 'a.txt': 'x\n' }, 'base');
      git(repo, ['checkout', '--quiet', '-b', 'p1']);
      commit(repo, { '.guardrails.yaml': 'version: 1\n' }, 'policy p1');
      git(repo, ['checkout', '--quiet', 'main']);
      git(repo, ['checkout', '--quiet', '-b', 'p2']);
      const side = commit(repo, { 's.txt': 'y\n' }, 'side secret before the second policy');
      commit(repo, { '.guardrails.yaml': 'version: 1\n' }, 'policy p2');
      git(repo, ['checkout', '--quiet', 'main']);
      git(repo, ['merge', '--quiet', '-m', 'octopus', 'p1', 'p2']);
      expect(predatingOf(repo, [base, side])).toEqual({ kind: 'count', count: 1 });
    });

    it('a merge that introduces the policy in its own conflict resolution, off the first-parent chain, still constrains the count (case J)', () => {
      const repo = tempDir();
      git(repo, ['init', '--quiet', '-b', 'main']);
      const s = commit(repo, { 'a.txt': 'x\n' }, 's on main');
      git(repo, ['checkout', '--quiet', '-b', 'side']);
      commit(repo, { 'side.txt': 'a\n' }, 'a on side');
      git(repo, ['checkout', '--quiet', '-b', 'other', 'main']);
      commit(repo, { 'other.txt': 'b\n' }, 'b on other');
      git(repo, ['checkout', '--quiet', 'side']);
      git(repo, ['merge', '--no-commit', '--no-ff', '--quiet', 'other']);
      writeFileSync(path.join(repo, '.guardrails.yaml'), 'version: 1\n');
      git(repo, ['add', '.guardrails.yaml']);
      git(repo, ['commit', '--quiet', '-m', 'merge other, adding the policy']);
      git(repo, ['checkout', '--quiet', 'main']);
      const late = commit(repo, { 'late.txt': 'c\n' }, 'late on main');
      mergeNoFf(repo, 'side');
      expect(predatingOf(repo, [s, late])).toEqual({ kind: 'count', count: 1 });
    });
  });

  it('counts files gone at HEAD and files still at HEAD', () => {
    const s = scratch();
    const info = collectExistingFindings([history([leak('gone.txt', s.old1), leak('kept.txt', s.old1)])], s.repo);
    expect(info?.goneAtHead).toBe(1);
    expect(info?.stillAtHead).toBe(1);
  });

  it('knows nothing about git outside a repository and says nothing about it', () => {
    const info = collectExistingFindings([history([leak('a.txt', 'a'.repeat(40))])], tempDir());
    expect(info?.history).toBe(1);
    expect(info?.predating).toBeNull();
    expect(info?.goneAtHead).toBeNull();
    expect(info?.stillAtHead).toBeNull();
    const text = existingFindingsLines(info as NonNullable<typeof info>).join('\n');
    expect(text).not.toContain('predat');
    expect(text).not.toContain('before .guardrails.yaml');
    expect(text).not.toContain('gone at HEAD');
  });

  it('is present when only the vulnerabilities gate blocks, with no history facts', () => {
    const s = scratch();
    const info = collectExistingFindings([vulns([advisory(), advisory()])], s.repo);
    expect(info?.vulnerabilities).toBe(2);
    expect(info?.history).toBe(0);
    expect(info?.predating).toBeNull();
  });

  it('is absent when only dep-guard or vault-guard blocks', () => {
    const s = scratch();
    const dep = outcome({
      role: 'dependencies',
      product: 'dep-guard',
      findings: [{ ...leak('x', s.old1), product: 'dep-guard' }],
    });
    const vault = outcome({
      role: 'secrets',
      product: 'vault-guard',
      findings: [{ ...leak('x', s.old1), product: 'vault-guard' }],
    });
    expect(collectExistingFindings([dep, vault], s.repo)).toBeNull();
  });

  it('is absent when the history gate found nothing blocking, could not run, or is not enforced', () => {
    const s = scratch();
    expect(collectExistingFindings([history([{ ...leak('kept.txt', s.old1), blocking: false }], { exitCode: 0 })], s.repo)).toBeNull();
    expect(
      collectExistingFindings(
        [history([leak('kept.txt', s.old1)], { couldNotRun: { reason: 'history-shallow', detail: 'x' } })],
        s.repo
      )
    ).toBeNull();
    expect(collectExistingFindings([history([leak('kept.txt', s.old1)], { enforce: false })], s.repo)).toBeNull();
  });
});

describe('the existing-findings text', () => {
  const info = (): NonNullable<ReturnType<typeof collectExistingFindings>> => {
    const s = scratch();
    return collectExistingFindings(
      [history([leak('gone.txt', s.old1), leak('kept.txt', s.old1), leak('later.txt', s.newer)]), vulns([advisory()])],
      s.repo
    ) as NonNullable<ReturnType<typeof collectExistingFindings>>;
  };

  it('states the counts, the predating count, and gone and still at HEAD, each once', () => {
    const text = existingFindingsLines(info()).join('\n');
    expect(text).toContain('3 blocking finding(s) in secrets-history and 1 in vulnerabilities');
    expect(text).toContain(
      '2 of the 3 in secrets-history are only in commits made before .guardrails.yaml was first committed'
    );
    expect(text.match(/gone at HEAD/g)).toHaveLength(1);
    expect(text.match(/still at HEAD/g)).toHaveLength(1);
    expect(text).toContain('1 gone at HEAD, 2 still at HEAD');
  });

  it('names only things that exist today, with the gitleaks caveat', () => {
    const text = existingFindingsLines(info()).join('\n');
    expect(text).not.toContain('accept-existing');
    expect(text).toContain('stage: push');
    expect(text).toContain('.gitleaksignore');
    expect(text).toContain('this report does not count them');
    expect(text).toContain('one line per commit the finding lists (its');
    expect(text).toContain('commit and each "also in"), in the form commit:file:rule:line');
    expect(text).toContain('same rule matches, not only the one you reviewed');
    expect(text).toContain('not the history or vulnerability');
    expect(text).toContain('[[IgnoredVulns]]');
    expect(text).toContain('osv-scanner.toml');
    expect(text).toContain('suppressed');
    expect(text).toContain('vault-guard baseline');
    expect(text).toContain('.dep-guard.baseline.json');
    expect(text).toContain('rotated');
  });

  it('uses the not-committed-yet wording when the policy is not committed', () => {
    const repo = tempDir();
    git(repo, ['init', '--quiet', '-b', 'main']);
    const first = commit(repo, { 'a.txt': 'x\n' }, 'only');
    const text = existingFindingsLines(
      collectExistingFindings([history([leak('a.txt', first)])], repo) as NonNullable<ReturnType<typeof collectExistingFindings>>
    ).join('\n');
    expect(text).toContain('all of them are in commits made before .guardrails.yaml, which is not committed yet');
  });

  it('leaves the vulnerabilities half out when only history blocks, and the reverse', () => {
    const s = scratch();
    const onlyHistory = existingFindingsLines(
      collectExistingFindings([history([leak('kept.txt', s.old1)])], s.repo) as NonNullable<ReturnType<typeof collectExistingFindings>>
    ).join('\n');
    expect(onlyHistory).not.toContain('[[IgnoredVulns]]');
    expect(onlyHistory).toContain('.gitleaksignore');
    const onlyVulns = existingFindingsLines(
      collectExistingFindings([vulns([advisory()])], s.repo) as NonNullable<ReturnType<typeof collectExistingFindings>>
    ).join('\n');
    expect(onlyVulns).toContain('[[IgnoredVulns]]');
    expect(onlyVulns).not.toContain('.gitleaksignore');
  });
});

describe('where the section appears in the text report', () => {
  const blocked = (extra: Partial<RunResult> = {}): RunResult => {
    const s = scratch();
    const gates = [history([leak('kept.txt', s.old1)])];
    return runResult(gates, { existingFindings: collectExistingFindings(gates, s.repo) as never, ...extra });
  };

  it('is printed on a no-base blocked run, before the verdict sentence', () => {
    const text = renderText(blocked());
    const at = text.indexOf('existing findings:');
    expect(at).toBeGreaterThan(0);
    const verdictLine = text.trimEnd().split('\n').pop() as string;
    expect(text.lastIndexOf(verdictLine)).toBeGreaterThan(at);
    expect(verdictLine).not.toContain('existing findings');
    expect(text).toContain('verdict-token: blocked');
  });

  it('is not printed under a trust base, even if the field were present', () => {
    const text = renderText(
      blocked({ trustBase: { ref: 'origin/main', policyChanged: false, refusal: null } })
    );
    expect(text).not.toContain('existing findings:');
  });

  it('is not printed when the result carries no such field', () => {
    const s = scratch();
    const text = renderText(runResult([history([leak('kept.txt', s.old1)])]));
    expect(text).not.toContain('existing findings:');
  });

  it('changes no exit code, verdict token, verdict line or blocking flag', () => {
    const withSection = blocked();
    const without: RunResult = { ...withSection };
    delete (without as { existingFindings?: unknown }).existingFindings;

    const a = renderText(withSection, { version: '0.0.0-test' });
    const b = renderText(without, { version: '0.0.0-test' });
    expect(a).not.toBe(b);
    expect(a.split('\n').slice(0, 3)).toEqual(b.split('\n').slice(0, 3));
    expect(a.trimEnd().split('\n').pop()).toBe(b.trimEnd().split('\n').pop());
    expect(verdictToken(withSection, false)).toBe(verdictToken(without, false));
    expect(withSection.exitCode).toBe(without.exitCode);
    expect(withSection.findings.map((f) => f.blocking)).toEqual(without.findings.map((f) => f.blocking));
    // Removing exactly the section lines gives the other report back.
    const section = existingFindingsLines(withSection.existingFindings as never).join('\n');
    expect(a.replace(`${section}\n\n`, '')).toBe(b);
  });
});
