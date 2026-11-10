// The "existing findings" message: what a run with no base says when the
// history gate (gitleaks) or the vulnerabilities gate (osv-scanner) blocks.
//
// WORDS ONLY. Nothing in this file reaches the exit code, the verdict token
// or any finding's `blocking` flag: collectExistingFindings reads the
// outcomes after the exit code is composed and only counts, and the text it
// feeds is printed beside the verdict, never instead of it. A repository that
// adopts conductor late meets its whole history on the first run with no
// base (a local run, a push, a scheduled run); every one of those findings
// still blocks, and this section says why there are so many and what the
// real options are.
//
// Two of the facts are git facts and are only ever stated when git answered:
// how many history findings predate the commit that added the policy file,
// and how many cite a file that is gone at HEAD. When git cannot answer
// (not a repository, a failed call) the number is null and the report says
// nothing about it rather than guess.

import type { GateOutcome } from './gate-runner.js';
import { runGit } from './git.js';
import { POLICY_FILE_NAME } from './policy.js';

/** What predated the policy: a count, or the policy is not committed yet. */
export type PredatingFact = { kind: 'count'; count: number } | { kind: 'not-committed' };

export interface ExistingFindings {
  /** Blocking findings from the history gate (gitleaks). */
  history: number;
  /** Blocking findings from the vulnerabilities gate (osv-scanner). */
  vulnerabilities: number;
  /** About the history findings only; null when there are none or git could not say. */
  predating: PredatingFact | null;
  /** History findings whose file is not in HEAD's tree; null when git could not say. */
  goneAtHead: number | null;
  /** History findings whose file is in HEAD's tree; null when git could not say. */
  stillAtHead: number | null;
}

/** Blocking findings of one gate that block the run: enforced, ran, found something. */
function blockingOf(outcomes: readonly GateOutcome[], role: GateOutcome['role']): GateOutcome['findings'] {
  return outcomes
    .filter((gate) => gate.role === role && gate.couldNotRun === null && gate.enforce)
    .flatMap((gate) => gate.findings.filter((finding) => finding.blocking && finding.product === gate.product));
}

/** The commits a history finding carries: the kept one and every alsoIn. */
function carriedCommits(details: Record<string, unknown>): string[] | null {
  if (typeof details.commit !== 'string' || details.commit.length === 0) {
    return null;
  }
  const also = Array.isArray(details.alsoIn)
    ? details.alsoIn.filter((value): value is string => typeof value === 'string')
    : [];
  return [details.commit, ...also];
}

/** Every path in HEAD's tree, or null when git could not list it. */
function headPaths(repoRoot: string): Set<string> | null {
  const listed = runGit(repoRoot, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']);
  if (listed.error !== undefined || listed.status !== 0) {
    return null;
  }
  return new Set(listed.stdout.split('\0').filter((entry) => entry.length > 0));
}

/**
 * The oldest commit on HEAD's first-parent chain that adds the policy file:
 * a commit id, 'none' when the file is in no commit and not in HEAD (not
 * committed yet), or null when git could not say.
 */
function policyCommit(repoRoot: string, paths: Set<string> | null): string[] | 'none' | null {
  const lines = (result: ReturnType<typeof runGit>): string[] | null =>
    result.error !== undefined || result.status !== 0
      ? null
      : result.stdout.split('\n').filter((line) => line.length > 0);
  // --no-renames: a policy renamed into place is an add, not an R the filter skips.
  const firstParent = lines(
    runGit(repoRoot, ['log', '--first-parent', '--no-renames', '--diff-filter=A', '--format=%H', '--', POLICY_FILE_NAME])
  );
  // EVERY commit reachable from HEAD that adds the file relative to any
  // parent, merges included, on any branch: HEAD's first-parent chain can run
  // through a branch that forked before the policy and merged it in, where the
  // only "add" on that chain is the merge itself and every commit on the
  // branch would look old; and a merge that introduces the file in its own
  // conflict resolution can sit off that chain. -m lists a merge once per
  // parent it adds the file against; the Set below dedupes.
  const everywhere = lines(
    runGit(repoRoot, [
      'log',
      '--full-history',
      '-m',
      '--no-renames',
      '--diff-filter=A',
      '--format=%H',
      '--',
      POLICY_FILE_NAME,
    ])
  );
  if (firstParent === null || everywhere === null) {
    return null;
  }
  const ids = new Set<string>([
    ...(firstParent.length > 0 ? [firstParent[firstParent.length - 1] as string] : []),
    ...everywhere,
  ]);
  if (ids.size > MAX_POLICY_ADDS) {
    return null;
  }
  if (ids.size > 0) {
    return [...ids];
  }
  // No commit adds it. Not committed yet only when HEAD does not hold it
  // either; a file in HEAD that no first-parent commit adds is not a state
  // this can name, so it says nothing.
  if (paths === null) {
    return null;
  }
  return paths.has(POLICY_FILE_NAME) ? null : 'none';
}

/** More add commits than this and the number is left out: each costs a rev-list. */
const MAX_POLICY_ADDS = 20;

/** Every commit that is an ancestor of the policy commit's first parent; empty for a root commit. */
function commitsBeforePolicy(repoRoot: string, policy: string): Set<string> | null {
  const parent = runGit(repoRoot, ['rev-parse', '--verify', '--quiet', `${policy}^`]);
  if (parent.error !== undefined) {
    return null;
  }
  if (parent.status !== 0) {
    // A root commit has no parent: nothing predates it. A different failure
    // is not told apart from that, so confirm the commit really is a root.
    const parents = runGit(repoRoot, ['rev-list', '--parents', '-n', '1', policy]);
    const fields = parents.stdout.trim().split(' ').filter((field) => field.length > 0);
    return parents.status === 0 && fields.length === 1 ? new Set() : null;
  }
  const ancestors = runGit(repoRoot, ['rev-list', parent.stdout.trim()]);
  if (ancestors.error !== undefined || ancestors.status !== 0) {
    return null;
  }
  return new Set(ancestors.stdout.split('\n').filter((line) => line.length > 0));
}

/**
 * The facts for the message, or null when the gates that block are not the
 * history or the vulnerabilities gate. The caller only calls it on a run with
 * no trust base; the text report checks that again.
 *
 * A history finding counts as predating the policy only when EVERY commit it
 * carries (the kept commit and each alsoIn) is an ancestor of the policy
 * commit's first parent. The kept commit can be the newest, or chosen by a
 * forged date, so it alone proves nothing. Gaming this changes a sentence,
 * never an exit code.
 */
export function collectExistingFindings(
  outcomes: readonly GateOutcome[],
  repoRoot: string
): ExistingFindings | null {
  const historyFindings = blockingOf(outcomes, 'secrets-history');
  const vulnerabilities = blockingOf(outcomes, 'vulnerabilities').length;
  if (historyFindings.length === 0 && vulnerabilities === 0) {
    return null;
  }

  let predating: PredatingFact | null = null;
  let goneAtHead: number | null = null;
  let stillAtHead: number | null = null;

  if (historyFindings.length > 0) {
    const paths = headPaths(repoRoot);
    if (paths !== null) {
      const gone = historyFindings.filter(
        (finding) => finding.subject.kind === 'location' && !paths.has(finding.subject.file)
      ).length;
      goneAtHead = gone;
      stillAtHead = historyFindings.length - gone;
    }
    const policy = policyCommit(repoRoot, paths);
    if (policy === 'none') {
      predating = { kind: 'not-committed' };
    } else if (policy !== null) {
      // The intersection of the ancestor sets of every add commit's first
      // parent: a commit predates the policy only if it predates every way
      // the policy arrived. Any set that cannot be computed, no number.
      const sets = policy.map((add) => commitsBeforePolicy(repoRoot, add));
      const complete = sets.every((one): one is Set<string> => one !== null);
      if (complete) {
        const [first, ...rest] = sets as Set<string>[];
        const known = rest.reduce(
          (acc, one) => new Set([...acc].filter((id) => one.has(id))),
          first as Set<string>
        );
        const count = historyFindings.filter((finding) => {
          const commits = carriedCommits(finding.details);
          return commits !== null && commits.every((id) => known.has(id));
        }).length;
        predating = { kind: 'count', count };
      }
    }
  }

  return { history: historyFindings.length, vulnerabilities, predating, goneAtHead, stillAtHead };
}

/**
 * The report section. Every name in it exists today: the stage split, each
 * tool's own ignore mechanism and each family gate's own baseline. Nothing
 * here points at a conductor command that records findings as known.
 */
export function existingFindingsLines(info: ExistingFindings): string[] {
  const counts = [
    ...(info.history > 0 ? [`${info.history} blocking finding(s) in secrets-history`] : []),
    ...(info.vulnerabilities > 0
      ? [info.history > 0 ? `${info.vulnerabilities} in vulnerabilities` : `${info.vulnerabilities} blocking finding(s) in vulnerabilities`]
      : []),
  ].join(' and ');
  const judged = [
    ...(info.history > 0 ? ['all of git history'] : []),
    ...(info.vulnerabilities > 0 ? ['every tracked lockfile'] : []),
  ].join(' and ');

  const lines = [
    `existing findings: ${counts}.`,
    `  This run has no base, so it judged ${judged}, including what was here before conductor.`,
    '  A pull request is judged only on what it changes.',
  ];

  if (info.history > 0) {
    if (info.predating?.kind === 'count') {
      lines.push(
        `  ${info.predating.count} of the ${info.history} in secrets-history are only in commits made before ` +
          `${POLICY_FILE_NAME} was first committed.`
      );
    } else if (info.predating?.kind === 'not-committed') {
      lines.push(
        `  In secrets-history, all of them are in commits made before ${POLICY_FILE_NAME}, which is not committed yet.`
      );
    }
    if (info.goneAtHead !== null && info.stillAtHead !== null) {
      lines.push(
        `  By file: ${info.goneAtHead} gone at HEAD, ${info.stillAtHead} still at HEAD (the line may have moved).`
      );
    }
  }

  lines.push(
    '  first: read them. A key that was ever live must be rotated; deleting the file does not remove it from history.',
    "  then:  run history and advisories on a schedule, not on every push: the Action's stage: push on push runs",
    '         (README, What a history scan costs).'
  );
  if (info.history > 0) {
    lines.push(
      '         accept a reviewed old history finding in .gitleaksignore, one line per commit the finding lists (its',
      '         commit and each "also in"), in the form commit:file:rule:line. gitleaks then drops those records and',
      '         this report does not count them. One line silences every secret on that line in that commit that the',
      '         same rule matches, not only the one you reviewed.'
    );
  }
  if (info.vulnerabilities > 0) {
    lines.push(
      '         accept a reviewed advisory in osv-scanner.toml under [[IgnoredVulns]] with a reason; osv-scanner counts',
      '         those, and they show as suppressed here.'
    );
  }
  lines.push(
    '         dependencies and secrets keep their own baselines: vault-guard baseline, and .dep-guard.baseline.json',
    '         for dep-guard. Those cover the dependencies and secrets gates, not the history or vulnerability',
    '         findings this section is about.'
  );
  return lines;
}
