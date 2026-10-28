// The combined report, for a terminal.
//
// One section per gate in gate order, findings within a gate ordered
// blocking-first, and a one-line verdict at the end. Three things are in
// here deliberately rather than for completeness:
//
//  - Each gate's own threshold is printed in its own section, because
//    there is no shared one and printing a single number would imply there
//    was.
//
//  - The suppressed and ignored counts are printed even when they are
//    zero. Those numbers are the user's own earlier decisions, and hiding
//    them makes a repository with two hundred baselined findings read as
//    clean.
//
//  - A gate that could not run gets a loud section rather than an empty
//    one. An empty section and a clean section look identical at a glance,
//    and that is exactly the confusion that lets a switched-on gate sit
//    uninstalled for months.
//
// No colour and no unicode. This output is read in a pre-commit hook, in
// CI logs, and in pasted issue reports, and the plainest thing that works
// everywhere is worth more here than a nicer-looking terminal.

import { type Finding, compareFindings } from './envelope.js';
import { EXIT_BLOCKED, EXIT_COULD_NOT_RUN, gateExitBlocks } from './exit-codes.js';
import {
  CONDUCTOR_OWN_REASONS,
  type GateOutcome,
  cleanOutputLine,
  cleanPreviewLine,
  conductorStatedReason,
  resolutionPlace,
  versionCharacters,
  versionSkewRemedy,
} from './gate-runner.js';
import { isLegacyContractPath, legacyChangedSentence } from './intent-prepare.js';
import type { ReportedMatch } from './intent-prepare.js';
import { SPEC_DIR } from './intent-spec.js';
import { PRODUCT_FOR_ROLE } from './policy.js';
import { escapeNonAscii } from './policy-diff.js';
import { type RunResult, guardPreview } from './run.js';

// A file path in a finding is the head's choice on any pull-request run (a
// file named with a right-to-left override in it), so in the text report,
// and so in the pull-request comment, every path is printed with
// escapeNonAscii (audit 2026-10-27 fix round, N3). SARIF keeps the real path:
// code scanning has to find the file.
function subjectLabel(finding: Finding): string {
  const subject = finding.subject;
  switch (subject.kind) {
    case 'package':
      return `${subject.name} (${escapeNonAscii(subject.manifest)})`;
    case 'location':
      return `${escapeNonAscii(subject.file)}:${subject.line}:${subject.column}`;
    case 'paths':
      return subject.paths.map(escapeNonAscii).join(', ');
    case 'contract':
      return subject.category === undefined ? 'intent contract' : `contract: ${subject.category}`;
    case 'none':
      return '';
  }
}

/**
 * The findings of one section, as the entries a reader sees.
 *
 * For osv-scanner one entry per ADVISORY ON ONE INSTALLED PACKAGE, however
 * many lockfiles carry it: a repository with a dozen lockfiles pinning the
 * same lodash printed the same advisory a dozen times, and the one fact that
 * differed between those lines, the lockfile, is what --verbose lists. Every
 * other gate keeps one entry per finding. Presentation only: the findings
 * themselves, their count, SARIF and the exit decision are all untouched.
 */
function findingEntries(gate: GateOutcome): Finding[][] {
  const sorted = [...gate.findings].sort(compareFindings);
  if (gate.product !== 'osv-scanner') {
    return sorted.map((finding) => [finding]);
  }
  const groups = new Map<string, Finding[]>();
  for (const finding of sorted) {
    const name = finding.subject.kind === 'package' ? finding.subject.name : '';
    const key = JSON.stringify([
      finding.ruleId,
      name,
      finding.details.version ?? null,
      finding.blocking,
      finding.severity,
      finding.details.baseline ?? null,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  return [...groups.values()];
}

function isDev(finding: Finding): boolean {
  const groups = finding.details.dependencyGroups;
  return Array.isArray(groups) && groups.includes('dev');
}

/** The osv-scanner head-line subject: package@installed, the lockfile or the count, the fix, dev. */
function osvSubject(entry: Finding[]): string {
  const first = entry[0] as Finding;
  const name = first.subject.kind === 'package' ? first.subject.name : '';
  const installed = typeof first.details.version === 'string' ? first.details.version : '';
  const where =
    entry.length === 1 && first.subject.kind === 'package'
      ? `(${escapeNonAscii(first.subject.manifest)})`
      : `${entry.length} lockfiles`;
  const fixed = typeof first.details.fixedVersion === 'string' ? `fix ${first.details.fixedVersion}` : 'no fix listed';
  const dev = entry.filter(isDev).length;
  const devLabel = dev === 0 ? '' : dev === entry.length ? '  dev' : `  dev in ${dev} of ${entry.length}`;
  return `${name}@${installed} ${where}  ${fixed}${devLabel}`;
}

function shortCommit(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 7) : null;
}

/** gitleaks' own identity for a finding: the commit it was seen in and its fingerprint. */
function gitleaksLines(finding: Finding): string[] {
  const commit = shortCommit(finding.details.commit);
  const parts = [
    ...(commit === null ? [] : [`commit ${commit}`]),
    ...(finding.fingerprint === null ? [] : [`fingerprint ${finding.fingerprint.value}`]),
  ];
  const alsoIn = Array.isArray(finding.details.alsoIn)
    ? finding.details.alsoIn.map(shortCommit).filter((value): value is string => value !== null)
    : [];
  if (alsoIn.length > 0) {
    parts.push(`also in ${alsoIn.join(', ')}`);
  }
  const lines = parts.length === 0 ? [] : [`      ${parts.join('  ')}`];
  const twins = finding.details.possiblySameSecretAs;
  if (Array.isArray(twins) && twins.length > 0) {
    lines.push(
      `      possibly the same secret as ${twins.join(', ')} (same rule, file, columns and entropy; ` +
        'a merge reports a moved line again)'
    );
  }
  return lines;
}

/**
 * The umbrella's own finding for a gate that did not complete, whose message
 * is that gate's detail plus its stderr: both already printed in the section
 * just above it. gate-missing is not one, its message carries the install
 * remedy, which the section does not print anywhere else.
 */
function isRepeatedProblem(finding: Finding): boolean {
  return (
    finding.product === 'conductor' &&
    (finding.ruleId === 'conductor/gate-failed' || finding.ruleId === 'conductor/gate-output-unparseable')
  );
}

function findingLines(entry: Finding[], verbose: boolean, shortProblem: boolean): string[] {
  const finding = entry[0] as Finding;
  const marker = finding.blocking ? 'BLOCKING' : '  report';
  const severity = finding.severityIsDerived ? `${finding.severity}*` : finding.severity;
  const subject = finding.product === 'osv-scanner' && finding.subject.kind === 'package' ? osvSubject(entry) : subjectLabel(finding);
  // The vulnerabilities gate's base-comparison label, on a compared
  // pull-request run only: the label is set nowhere else.
  const baseline = finding.details.baseline;
  const label = baseline === 'introduced' || baseline === 'present-on-base' ? `  ${baseline}` : '';
  const head = `  ${marker}  ${severity.padEnd(9)} ${finding.ruleId}${
    subject === '' ? '' : `  ${subject}`
  }${label}`;
  // A gate that could not run already printed its reason, and the gate's own
  // output, in the lines above this one. The umbrella's finding carries the
  // same two again for SARIF, where they are the only record; here they were
  // the second and third copy of one failure.
  // The unparseable finding keeps the one sentence the section above does not
  // say: whose side the problem is on.
  const message = !shortProblem
    ? finding.message
    : finding.ruleId === 'conductor/gate-output-unparseable'
      ? 'Nothing was verified by this gate; the reason is above. This is the umbrella being out of date with that gate, not a problem in your code.'
      : 'Nothing was verified by this gate; the reason is above.';
  const lines = [head, `      ${message}`];
  if (finding.product === 'gitleaks') {
    lines.push(...gitleaksLines(finding));
  }
  if (verbose && entry.length > 1) {
    const manifests = entry.map((each) => (each.subject.kind === 'package' ? escapeNonAscii(each.subject.manifest) : ''));
    lines.push(`      lockfiles: ${manifests.join(', ')}`);
  }
  return lines;
}

/**
 * How many entries a section prints before it rolls the rest up into one
 * line, unless --verbose. A full-history gitleaks scan or an osv-scanner run
 * over an old lockfile printed six hundred lines on one repository, which
 * buries the verdict and every other gate. Findings past the cap are still
 * findings: they are counted in every number on the report, they are in the
 * SARIF log, --verbose prints them, and the exit code never reads this.
 */
export const FINDINGS_SHOWN_PER_GATE = 20;

/**
 * The base comparison under the vulnerabilities gate's threshold line: the
 * ref, the two counts, the base policy and what it means here, then one line
 * per lockfile the comparison was unavailable for. Nothing on a run with no
 * comparison.
 */
function baseComparisonLines(gate: GateOutcome): string[] {
  const comparison = gate.baseComparison;
  if (comparison === undefined) {
    return [];
  }
  const meaning = comparison.policy === 'report' ? 'report (not blocking)' : 'block (blocking)';
  return [
    `  base comparison  ${comparison.ref}  introduced ${comparison.introduced}  ` +
      `present-on-base ${comparison.presentOnBase}  present-on-base: ${meaning}`,
    ...comparison.unavailable.map(
      (entry) => `  base comparison unavailable for ${entry.path}: ${entry.reason}; counted as introduced`
    ),
  ];
}

/**
 * How many present-on-base findings were reported and NOT blocking, across
 * the gates: the vulnerabilities gate under present-on-base: report. The
 * number on the report's third line and in the exit-0 verdict clause.
 */
function presentOnBaseReported(result: RunResult): number {
  return result.gates
    .filter((gate) => gate.baseComparison?.policy === 'report')
    .flatMap((gate) => gate.findings)
    .filter((finding) => finding.details.baseline === 'present-on-base' && !finding.blocking).length;
}

function header(gate: GateOutcome, verbose: boolean): string {
  const version = gate.productVersion === null ? '(version unknown)' : gate.productVersion;
  // On the header line rather than only at the bottom of the section: a
  // reader scanning headers for the gate that refused their commit has to
  // be able to see, in the same glance, that this one did not.
  const enforcement = gate.enforce ? '' : '  [not enforced]';
  if (gate.couldNotRun !== null) {
    return `${gate.role}  ${gate.product} ${version}  DID NOT RUN (${gate.couldNotRun.reason})${enforcement}`;
  }
  const source = gate.binary === null ? '' : `  via ${gate.binary.candidate} on ${gate.binary.source}`;
  // Only with --verbose, and only a limit the policy set: a default is the
  // same on every run and says nothing about this repository.
  const limit =
    verbose && gate.timeLimit?.source === 'policy' ? `  limit ${Math.round(gate.timeLimit.ms / 1000)}s (policy)` : '';
  return `${gate.role}  ${gate.product} ${version}  exit ${gate.exitCode ?? '?'}  ${gate.durationMs}ms${limit}${source}${enforcement}`;
}

/**
 * The line that keeps a green exit from being a surprise.
 *
 * A report with BLOCKING on it and exit 0 at the bottom reads as a bug in
 * the umbrella unless the reason is on the same screen, in words rather
 * than in a flag somebody has to go and look up in the policy file.
 */
function enforcementNote(gate: GateOutcome): string | null {
  if (gate.enforce) {
    return null;
  }
  if (gate.couldNotRun !== null) {
    return (
      `  not enforced: this gate could not run, and enforce is false for it in .guardrails.yaml, ` +
      'so it is a note here rather than a failed run. Nothing was checked by it.'
    );
  }
  const blocking = gate.findings.filter((finding) => finding.blocking).length;
  if (blocking > 0 || gateExitBlocks(gate)) {
    return (
      `  not enforced: this gate reported ${blocking} blocking finding(s) and exited ` +
      `${gate.exitCode ?? '?'}, and enforce is false for it in .guardrails.yaml, so the commit ` +
      'proceeds. Set enforce: true there to make it block.'
    );
  }
  return '  not enforced: enforce is false for this gate in .guardrails.yaml. It found nothing to block on here.';
}

/**
 * Where the intent gate's contract came from, and what it measured against.
 *
 * Both halves are on one line and both are always printed when there is a
 * prepared run, including the base. A reader looking at a drift finding has
 * to be able to tell "checked the branch against main using the spec" from
 * "checked the index against a contract in the repository" without opening
 * the policy file or the CI configuration, because those are two different
 * claims and only one of them is about the pull request.
 */
function contractLine(gate: GateOutcome): string | null {
  if (gate.intent === undefined) {
    return null;
  }
  const source = gate.intent.contractSource;
  const where =
    source.kind === 'native'
      ? // The path already names the directory, and the aside says what a
        // reader who has not followed intent-guard's releases cannot get from
        // the path alone: that this is the old name and a newer gate moves it.
        `the repository's own frozen ${source.path}${
          isLegacyContractPath(source.path) ? ' (pre-1.3 directory, still read)' : ''
        }`
      : source.kind === 'imported'
        ? `spec ${source.spec}${source.plan === null ? '' : ` plus plan ${source.plan}`}`
        : 'none';
  const base =
    gate.intent.baseRef === null ? 'base: none, the git index' : `base: ${gate.intent.baseRef}`;
  return `  contract: ${where}   ${base}`;
}

/** The convention match behind a gate's contract, when the branch name chose it. */
export function conventionMatch(gate: GateOutcome): ReportedMatch | null {
  const source = gate.intent?.contractSource;
  return source?.kind === 'imported' && source.match !== undefined ? source.match : null;
}

/**
 * The weak-match line, printed under the contract line in every report.
 *
 * The shared words are charset-restricted tokens (isSignificant in
 * intent-spec.ts), so nothing the branch was called beyond them reaches this
 * line, and the runner-up is a filename the specs directory listed.
 */
function weakMatchLine(match: ReportedMatch): string {
  const words = (list: string[]): string => list.map((word) => `"${word}"`).join(', ');
  const why =
    match.weakBecause.includes('length-tiebreak') && match.runnerUp !== null
      ? `the branch name shares ${words(match.shared)} with this spec and ` +
        `${words(match.runnerUpShared)} with ${SPEC_DIR}/${match.runnerUp}; the longer word decided it.`
      : `the branch name shares only ${words(match.shared)} with this spec's name.`;
  const remedy =
    match.remedy === 'pr-body'
      ? 'To be sure this is the right contract, add a "Spec: <path>" line to the pull request body ' +
        "or rename the branch to the spec's name."
      : "To be sure this is the right contract, pass --spec <path> or rename the branch to the spec's name.";
  return `  match: weak, ${why} ${remedy}`;
}

/**
 * The lines a convention match adds to the gate block: the weak line and the
 * changed-winner note, printed in every report, and the chosen-by line,
 * printed for every strength under --verbose so a strong or exact choice is
 * visible too.
 */
function conventionLines(gate: GateOutcome): { under: string[]; chosenBy: string | null } {
  const match = conventionMatch(gate);
  if (match === null) {
    return { under: [], chosenBy: null };
  }
  const under: string[] = [];
  if (match.strength === 'weak') {
    under.push(weakMatchLine(match));
  }
  if (match.legacy !== null) {
    under.push(`  note: ${legacyChangedSentence(match.legacy)}`);
  }
  const chosenBy =
    `  chosen by: branch name, ${match.strength}, shared: ${match.shared.join(' ')}` +
    (match.runnerUp === null ? '' : `, runner-up ${SPEC_DIR}/${match.runnerUp}`);
  return { under, chosenBy };
}

function gateSection(gate: GateOutcome, verbose: boolean, refusedOnTerminal = false): string[] {
  // A gate the refused trust base stopped, on a terminal: the refusal is at
  // the top of the report once, so the section is one line and no more.
  // Every other caller (a file, a pipe, a pull request comment) keeps the full
  // section, byte for byte.
  if (refusedOnTerminal) {
    return [`  ${gate.role}  ${gate.product}  did not run: the trust base was refused (above)`];
  }
  const lines: string[] = ['', header(gate, verbose)];

  // Under the header, on every outcome that carries it: gitleaks' own
  // --timeout is not conductor's limit, and the gate-error it produces is the
  // outcome a reader most needs this on.
  if (gate.gateOwnOption !== undefined) {
    lines.push(`  note conductor/option-is-gate-own: ${gate.gateOwnOption}`);
  }
  // Under the header too: the header names the version and the location,
  // and this says that version is not the one the run was pinned to.
  const skew = versionSkewLine(gate);
  if (skew !== null) {
    lines.push(skew);
  }

  const contract = contractLine(gate);
  if (contract !== null) {
    lines.push(contract);
    // The weak line and the changed-winner note sit directly under the
    // contract line; the chosen-by line, --verbose only, after any other note.
    const convention = conventionLines(gate);
    lines.push(...convention.under);
    if (gate.intent?.note !== undefined) {
      lines.push(`  note: ${gate.intent.note}`);
    }
    if (verbose && convention.chosenBy !== null) {
      lines.push(convention.chosenBy);
    }
  }

  if (gate.couldNotRun !== null) {
    lines.push(`    ${gate.couldNotRun.detail}`);
    if (gate.couldNotRun.gateSaid !== undefined) {
      lines.push(`    gate said: "${gate.couldNotRun.gateSaid}"`);
    }
    if (gate.stderr.trim().length > 0) {
      if (gate.couldNotRun.reason === 'timed-out') {
        // What a stopped gate printed is often a warning that has nothing to
        // do with the stop; the line above is the reason.
        lines.push('    (printed by the gate before it was stopped; not the reason it stopped)');
      }
      for (const line of gate.stderr.trim().split('\n')) {
        lines.push(`    | ${cleanOutputLine(line)}`);
      }
    }
  }

  // Sorted here rather than relying on the order the gate happened to emit:
  // blocking first, then by severity. A section whose first line is a low
  // finding buries the one that just refused a commit. The cap keeps that
  // order, so what it rolls up is always the least severe.
  const entries = findingEntries(gate);
  const shown = verbose ? entries : entries.slice(0, FINDINGS_SHOWN_PER_GATE);
  for (const entry of shown) {
    lines.push(...findingLines(entry, verbose, gate.couldNotRun !== null && isRepeatedProblem(entry[0] as Finding)));
  }
  const hidden = entries.slice(shown.length).reduce((total, entry) => total + entry.length, 0);
  if (hidden > 0) {
    lines.push(
      `  ${hidden} more finding(s) in this gate, not shown here: re-run with --verbose, or read the ` +
        'SARIF report (--format sarif). They count toward everything on this report.'
    );
  }

  if (gate.couldNotRun === null) {
    const threshold =
      gate.run.failOn === null ? 'threshold not reported' : `threshold ${gate.run.failOn}`;
    // "ignored 0" would state a fact the gate never stated for a gate that
    // drops ignored files before they reach its output, and it reads as
    // "nothing was ignored". The normalizer records which is which.
    const ignored =
      gate.run.details.ignoredReported === false
        ? 'ignored not reported'
        : `ignored ${gate.run.ignored}`;
    lines.push(`  ${threshold}   suppressed ${gate.run.suppressed}   ${ignored}`);
    lines.push(...baseComparisonLines(gate));

    // The gate's own run facts: what it scanned, with what, against what.
    // These were being collected and then dropped.
    //
    // Scalars only. String() on an object gives "[object Object]", and on an
    // empty array gives nothing at all, so a naive render produced both a
    // line of noise and a key with no value. The structured members of this
    // bag (a category breakdown, a reason list) are already in the SARIF
    // details and, for the reasons, in a finding of their own; a terminal
    // summary line is not where they belong.
    const facts = Object.entries(gate.run.details)
      .filter(
        ([key, value]) =>
          // ignoredReported drives the line above rather than being a fact
          // about the run, so it is not printed twice.
          key !== 'ignoredReported' &&
          (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') &&
          value !== ''
      )
      .map(([key, value]) => `${key} ${String(value)}`);
    if (facts.length > 0) {
      lines.push(`  ${facts.join('   ')}`);
    }

    for (const diagnostic of gate.run.diagnostics) {
      lines.push(`  note ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  for (const diagnostic of gate.diagnostics) {
    lines.push(`  ! ${diagnostic.code}: ${diagnostic.message}`);
  }

  // Last in the section, so it is the line under the findings it explains.
  const enforcement = enforcementNote(gate);
  if (enforcement !== null) {
    lines.push(enforcement);
  }

  return lines;
}

/**
 * One line per gate the stage filter held back.
 *
 * Deliberately not a section: nothing ran, so there is no header, no exit
 * code and no duration to put in one. It still has to be on screen, because
 * a run at the commit stage otherwise reads exactly like a run that checked
 * everything, and the whole point of a stage is that some gates did not.
 */
function deferredLines(result: RunResult): string[] {
  return result.deferred.map(
    (gate) =>
      `  deferred  ${gate.role}  ${gate.product}  did not run here; it runs from stage ${gate.stage} onwards`
  );
}

/**
 * One line per gate that had nothing to check.
 *
 * A line rather than silence, and a line rather than a finding. Silence makes
 * a branch with no spec read as a branch that passed the intent gate, which
 * is the confusion this family exists to prevent. A finding would put the
 * absence of a spec on the same footing as a drift, and it is not one: it is
 * the ordinary state of most branches in a repository that has not adopted
 * the flow yet.
 */
function skippedLines(result: RunResult): string[] {
  return result.skipped.map(
    (gate) =>
      `  skipped   ${gate.role}  ${gate.product}  ${skipWording(gate.reason).line}: ${gate.detail}`
  );
}

/**
 * How a skipped gate is worded, in each of the three places it is worded.
 *
 * ONE function rather than a phrase at each call site, because the report has
 * three of them and the first attempt changed one: the full report's own line
 * said "spec waived" while the verdict under it still said "had no contract
 * to check against" and the one-line summary still said "Nothing to check
 * against". Both of those tell a reader to go and write the spec that
 * whoever opened the pull request had just written down there is none of, and
 * the summary line is the one a pre-commit hook and a pull request comment
 * actually print.
 *
 * The `no-contract` wording is unchanged, deliberately: it was right, and a
 * repository on the adoption ramp reads it on most branches.
 */
interface SkipWording {
  /** The label in front of the skipped line in the full report. */
  line: string;
  /** The clause naming what happened, for the verdict sentence. */
  verdict: string;
  /** The lead-in on the one-line summary of an otherwise clean run. */
  summary: string;
}

function skipWording(reason: RunResult['skipped'][number]['reason']): SkipWording {
  if (reason === 'contract-waived') {
    return {
      line: 'spec waived',
      verdict: 'had its spec waived by the pull request body',
      summary: 'Spec waived by the pull request body',
    };
  }
  if (reason === 'spec-ambiguous') {
    // A spec exists; two or more matched equally. Never "nothing to check
    // against", which tells a reader to go and write one.
    return {
      line: 'spec ambiguous',
      verdict: 'matched two or more specs equally, so none was chosen',
      summary: 'No spec chosen, two or more matched the branch equally',
    };
  }
  return {
    line: 'no contract',
    verdict: 'had no contract to check against',
    summary: 'Nothing to check against',
  };
}

/**
 * One line per gate the --gate flag left out.
 *
 * The same reasoning as the deferred lines above, with the one difference
 * that there is no later stage to name: this gate is on in the policy file
 * and did not run because of how this one command was typed. Without the
 * line, a --gate run and a full run produce the same report.
 */
function excludedLines(result: RunResult): string[] {
  return result.excluded.map(
    (gate) =>
      `  excluded  ${gate.role}  ${gate.product}  did not run here; --gate did not name it`
  );
}

/**
 * One line per gate the policy file switches off with enabled: false, so an
 * adopter sees what is not running at all. Absent when none is.
 */
function disabledLines(result: RunResult): string[] {
  return (result.disabled ?? []).map(
    (gate) =>
      `  disabled  ${gate.role}  ${gate.product}  enabled: false in .guardrails.yaml; it did not run`
  );
}

/**
 * One line per gate skipped because the head tree equals the trust base's
 * (issue #69).
 *
 * Modeled on deferredLines and excludedLines just above: nothing ran for
 * these gates either, so there is no header, no exit code and no duration to
 * put in a section, and the reason has to be on screen or a run in this shape
 * reads exactly like a run that judged every enabled gate's tree.
 */
function treeUnchangedLines(result: RunResult): string[] {
  return result.treeUnchanged.map(
    (gate) =>
      `  tree-unchanged  ${gate.role}  ${gate.product}  did not run: the head tree is identical to the base tree, so there is no change for this gate to judge`
  );
}

/**
 * The one sentence the whole of pull-request mode has to fit into.
 *
 * Counted even at ZERO, by the family suppression rule: the number is the
 * answer to "did this pull request also try to change the rules", and leaving
 * it out when the answer is none makes a run in pull-request mode
 * indistinguishable from a run that was never in it.
 *
 * NEVER A COUNT THAT TREATS A GATE THAT COULD NOT RUN AS ZERO. A gate that
 * was put into pull-request mode and could not run reported no summary the
 * umbrella reads, so its proposals are not known rather than none. The
 * sentence then names those gates and counts only what the others proposed.
 * On a run with a trust base that includes a gate that stopped before its
 * pull-request mode was even decided (it carries no trustBase: a preparation
 * that failed, a git older than the floor, a missing binary), because it was
 * meant to run in that mode and reported nothing either.
 */
export function proposalCount(result: RunResult): string {
  const unknown = result.gates.filter(
    (gate) =>
      gate.couldNotRun !== null &&
      (gate.trustBase === undefined
        ? result.trustBase !== null
        : gate.trustBase.withheld === null && gate.trustBase.refused === null)
  );
  if (unknown.length === 0) {
    return `${result.proposals.length} control change(s) proposed in this pull request`;
  }
  const names = unknown.map((gate) => `${gate.role} (${gate.product})`).join(', ');
  return (
    `${result.proposals.length} control change(s) proposed by the gates that ran; ` +
    `${names} could not run, so the proposals of ${unknown.length === 1 ? 'that gate are' : 'those gates are'} not known`
  );
}

/**
 * The gates the umbrella did not hand the trust base to.
 *
 * This is the loud half and it must never be silent: a run where one gate was
 * not handed the base ref must not read like a run where every gate was. A
 * gate below its pull-request-mode minimum is never here (it is
 * could-not-run); what is left is an intent gate judging a contract imported
 * from the base for this run, and a product with no pull-request mode at all.
 * It is a statement about coverage rather than about anybody's code, so it is
 * a line and a notification rather than a finding, and it never reaches the
 * exit code.
 */
function withheldTrustBase(result: RunResult): Array<{ gate: GateOutcome; reason: string }> {
  return result.gates.flatMap((gate) => {
    const reason = gate.trustBase?.withheld;
    return reason === undefined || reason === null ? [] : [{ gate, reason }];
  });
}

/**
 * The gates whose own node_modules/.bin copy this run declined to take.
 *
 * ONE LINE FOR THE WHOLE RUN rather than one per gate. The fact is about the
 * run's mode, not about any gate's verdict, and in the repository shape it is
 * most likely to happen in, gates installed as devDependencies and nothing
 * else, it is true of all three at once. Three lines saying the same thing
 * would read as three problems.
 */
function nodeModulesSkippedLine(result: RunResult): string[] {
  const skipped = result.gates.flatMap((gate) =>
    gate.nodeModulesSkipped === undefined
      ? []
      : [`${gate.role} (${gate.product}) at ${gate.nodeModulesSkipped}`]
  );
  if (skipped.length === 0) {
    return [];
  }
  return [
    `  node_modules/.bin not consulted: ${skipped.join(', ')}. What is installed there is ` +
      'chosen by the head own manifest and lockfile, so no ref approves it; each of those gates ' +
      'was resolved from PATH or from an absolute command: instead, or reported as could-not-run.',
  ];
}

/**
 * The pull-request-mode block of the full report.
 *
 * Four things in one place, because they answer one question between them:
 * where the rules came from, what this pull request proposes to change them
 * to, which gates were not covered by any of it, and where the programs that
 * did run came from.
 */
function trustBaseLines(result: RunResult): string[] {
  if (result.trustBase === null) {
    return [];
  }
  if (result.trustBase.notGiven === true) {
    return ['  pull-request mode: no trust base was given, so no rules were read.'];
  }
  const lines = [
    `  pull-request mode: rules from ${result.trustBase.ref}. ${proposalCount(result)}.`,
  ];
  for (const proposal of result.proposals) {
    lines.push(`  proposed  ${proposal.product.padEnd(13)} ${proposal.line}`);
  }
  for (const { gate, reason } of withheldTrustBase(result)) {
    lines.push(`  NOT in pull-request mode  ${gate.role}  ${gate.product}  ${reason}`);
  }
  lines.push(...nodeModulesSkippedLine(result));
  return lines;
}

/**
 * What an unenforced gate did, as clauses for a verdict line.
 *
 * Shared by the exit 0 and exit 1 branches: an unenforced gate is left out
 * of the count and out of the reason either way, but it still gets a
 * sentence. A gate that verified nothing is worth a line whatever the exit
 * code turned out to be.
 */
function unenforcedClauses(result: RunResult): string[] {
  const unenforced = result.gates.filter((gate) => !gate.enforce);
  // A gate that could not run is only that. Its findings list carries the
  // umbrella's own blocking gate-missing finding, so a naive test for "has a
  // blocking finding" reports the same gate as having blocked AND as having
  // failed to run, which are opposite claims.
  const blocked = unenforced.filter(
    (gate) =>
      gate.couldNotRun === null &&
      (gateExitBlocks(gate) || gate.findings.some((finding) => finding.blocking))
  );
  const broken = unenforced.filter((gate) => gate.couldNotRun !== null);

  const clauses: string[] = [];
  if (blocked.length > 0) {
    clauses.push(`${blocked.map((gate) => gate.role).join(', ')} blocked`);
  }
  if (broken.length > 0) {
    clauses.push(`${broken.map((gate) => gate.role).join(', ')} could not run`);
  }
  return clauses;
}

/**
 * The refusal, as the first line of the report and as the verdict.
 *
 * FIRST, and before any question about how many gates there are. The old
 * order asked that question first, and an inventory naming no gate -- every
 * gate `enabled: false` in the head's file, or a head file that will not
 * parse -- fell into the "no gate ran because none is enabled" branch, which
 * printed exit 0 and told the reader to switch a gate on while the process
 * exited 2 and nothing had been checked. The refusal is the whole story of
 * such a run and there is no arrangement of the other clauses that tells it.
 */
function refusalLines(result: RunResult): string[] {
  const refusal = result.trustBase?.refusal;
  if (refusal === undefined || refusal === null) {
    return [];
  }
  return [
    result.trustBase?.notGiven === true
      ? 'conductor: this is a pull-request job and no trust base was given, so no rules were read. Nothing was checked.'
      : `conductor: refused the trust base "${result.trustBase?.ref ?? ''}". Nothing was checked.`,
    `  ${refusal}`,
  ];
}

/**
 * The one-line summary a `--output` run prints to the job log after writing
 * its report to a file (see cli.ts). Refused first, exactly like every other
 * renderer in this file, and for the same reason: `refusedTrustBase` fills
 * `result.gates` and `result.findings` with a could-not-run outcome PER
 * ENABLED GATE, so counting them the ordinary way reports "N gate(s), N
 * finding(s)" on a run where nothing ran and nothing was found -- issue #46.
 * A reader with only this line, no --verbose and no pull-request comment
 * (a fork's read-only token, or pr-comment left off) deserves the same words
 * the comment's own compact body gives them, not a count that implies gates
 * ran.
 *
 * `refusal` (from refuseTrustBaseRef in trust-base.ts) already says "Nothing
 * was checked" itself as part of its own sentence, so this does not repeat
 * that lead-in: doing so used to print the phrase twice on one line. Nor
 * does it append its own closing sentence: cli.ts joins this return value
 * with "; " before the rest of the job-log line, and a trailing period here
 * left every refused run's log line reading "...; sarif report written",
 * with a period sitting directly before that semicolon. A trailing period
 * on `refusal` itself is trimmed for the same reason.
 *
 * A normal run is untouched: the exact same
 * "N gate(s), N finding(s)" text as before, so a working adopter's log does
 * not change.
 */
export function jobLogSummary(result: RunResult): string {
  const refusal = result.trustBase?.refusal;
  if (refusal !== undefined && refusal !== null) {
    return result.trustBase?.notGiven === true
      ? `pull-request job with no trust base, no rules read: ${refusal.replace(/\.+\s*$/, '')}`
      : `refused the trust base "${result.trustBase?.ref ?? ''}": ${refusal.replace(/\.+\s*$/, '')}`;
  }
  return `${result.gates.length} gate(s), ${result.findings.length} finding(s)`;
}

/**
 * The proposal lines for a job log: the count sentence, then one line per
 * proposed control change. Empty outside pull-request mode, and empty when
 * the trust base was refused or never given, because no rules were read and
 * there is nothing proposed to count. Each line goes through
 * cleanOutputLine, since a proposal carries text a gate printed.
 */
export function proposalLogLines(result: RunResult): string[] {
  const trust = result.trustBase;
  if (trust === null || trust.notGiven === true || (trust.refusal !== null && trust.refusal !== undefined)) {
    return [];
  }
  return [
    cleanOutputLine(`conductor: ${proposalCount(result)}.`),
    ...result.proposals.map((proposal) =>
      cleanOutputLine(`conductor: proposed ${proposal.product} ${proposal.line}`)
    ),
  ];
}

/**
 * A gate's outcome in the job log's words: `ok`, `findings (N, M blocking)`
 * with dep-guard's deadline clause when it said so, `could-not-run (reason)`
 * or `missing (reason)`. Shared by the per-gate lines and the preview's.
 */
export function gateOutcomeWords(gate: GateOutcome): string {
  if (gate.couldNotRun !== null) {
    const reason = gate.couldNotRun.reason;
    return reason === 'binary-missing' || reason === 'configured-command-missing'
      ? `missing (${reason})`
      : `could-not-run (${reason})`;
  }
  const total = gate.findings.length;
  const blocking = gate.findings.filter((finding) => finding.blocking).length;
  let outcome = total === 0 && (gate.exitCode ?? 0) === 0 ? 'ok' : `findings (${total}, ${blocking} blocking)`;
  // Only when the gate said so; the outcome word above is unchanged.
  const coverage = deadlineCoverage(gate);
  if (coverage !== null) {
    outcome += `, ${coverage}`;
  }
  return outcome;
}

/**
 * The header the preview block starts with, in the report and the comment.
 * scripts/lib/pr-comment.mjs spells it too, to cut the preview first from a
 * comment over the limit, and action.yml stops its summary scan at it.
 */
export const PREVIEW_HEADER = 'Preview under the proposed rules (does not affect the verdict)';

/**
 * The preview under the proposed rules, as report lines: empty without a
 * preview, otherwise a blank line, the header, the fixed-shape count line,
 * one gate section per preview gate, then the deferred, over-budget, threw
 * and advisory lines. Printed only AFTER the verdict line, and read by
 * nothing that decides one. Every line goes through cleanOutputLine: a
 * preview runs under head-proposed keys, so its gate text is not trusted to
 * be free of a workflow command.
 */
export function previewLines(result: RunResult, verbose: boolean): string[] {
  const preview = result.preview;
  if (preview === undefined) {
    return [];
  }
  const body = guardPreview(
    (): string[] => {
      const couldNotRun = preview.gates.filter((gate) => gate.couldNotRun !== null).length;
      const lines = [
        `preview: ${preview.gates.length} gate(s), ${preview.findings.length} finding(s), ${couldNotRun} could-not-run`,
        ...preview.gates.flatMap((gate) => gateSection(gate, verbose)),
        ...preview.skipped.map((skip) => `preview: ${skip.role} (${skip.product}) would not run: ${skip.reason}`),
      ];
      if (preview.deferred.includes('intent')) {
        lines.push('preview: intent (intent-guard) deferred, the preview does not prepare the intent gate');
      }
      if (preview.overBudget.length > 0) {
        lines.push(
          `preview skipped: over budget (${preview.overBudget
            .map((role) => `${role} (${PRODUCT_FOR_ROLE[role]})`)
            .join(', ')})`
        );
      }
      if (preview.threw !== null) {
        lines.push(`preview: could not be completed (${preview.threw})`);
      }
      if (couldNotRun > 0) {
        lines.push('  a could-not-run in the preview is advisory: it does not change the exit code.');
      }
      return lines;
    },
    (message) => [`preview: could not be completed (${message})`]
  );
  // cleanPreviewLine, not cleanOutputLine: a head .vault-guard.json can name
  // a pattern id with a right-to-left override in it (audit 2026-10-27, N3).
  return ['', PREVIEW_HEADER, ...body].map(cleanPreviewLine);
}

/**
 * The preview's job log lines: one per preview gate in the per-gate lines'
 * outcome words, one per over-budget role, and one for a deferred intent
 * gate. Empty without a preview. Each line goes through cleanOutputLine.
 */
export function previewLogLines(result: RunResult): string[] {
  const preview = result.preview;
  if (preview === undefined) {
    return [];
  }
  const lines = guardPreview(
    (): string[] => [
      ...preview.gates.map((gate) => `conductor: preview ${gate.role} (${gate.product}) ${gateOutcomeWords(gate)}`),
      ...preview.overBudget.map((role) => `conductor: preview ${role} (${PRODUCT_FOR_ROLE[role]}) over budget`),
      ...(preview.deferred.includes('intent') ? ['conductor: preview intent (intent-guard) deferred'] : []),
    ],
    (message) => [`conductor: preview could not be completed (${message})`]
  );
  return lines.map(cleanPreviewLine);
}

/**
 * One plain line per gate, for the job log: which gate, which version, what
 * happened, and the exit code. Written to stderr by cli.ts on EVERY run, so
 * an adopter reading the log learns which gate did what without opening a
 * report (the SARIF log, the text report file or the pull request comment).
 *
 * Outcomes, in the words the lines use: `ok`, `findings (N, M blocking)`,
 * `could-not-run (reason)` with the gate's own stated reason when it gave
 * one, or conductor's own reason when the refusal was conductor's (both
 * cleaned, one line, capped and quoted), `missing (reason)` for a gate that
 * was not found, and `skipped (why)`
 * for a gate that was enabled and never spawned (deferred by stage, left out
 * by --gate, no contract, tree unchanged). A gate with no process behind it
 * says `no exit code`, never a made-up one.
 *
 * Describes, decides nothing: every word is read off the outcomes the exit
 * code was already composed from. Same plain ASCII as the rest of this file.
 */
export function gateLogLines(result: RunResult, options: { terminal?: boolean } = {}): string[] {
  // On a terminal a refused run's per-gate lines are the refusal sentence once
  // per gate, under a report that already led with it. One line instead; a
  // job log (never a terminal) keeps one line per gate.
  const refusal = result.trustBase?.refusal;
  if (options.terminal === true && refusal !== undefined && refusal !== null && result.gates.length > 0) {
    return [
      `conductor: the trust base was refused, so no gate ran: ` +
        `${result.gates.map((gate) => `${gate.role} (${gate.product})`).join(', ')}; could-not-run, no exit code`,
    ];
  }
  const lines: string[] = [];
  for (const gate of result.gates) {
    const version = gate.productVersion === null ? 'version unknown' : gate.productVersion;
    const exit = gate.exitCode === null ? 'no exit code' : `exit ${gate.exitCode}`;
    const outcome = gateOutcomeWords(gate);
    // conductor's own refusals (a git below the floor, a path list it cannot
    // pass, a PATH or git-directory failure, a gate below its minimum) carry
    // their reason the same way, since no gate said anything for them.
    const conductorSaid =
      gate.couldNotRun !== null &&
      gate.couldNotRun.gateSaid === undefined &&
      CONDUCTOR_OWN_REASONS.has(gate.couldNotRun.reason)
        ? conductorStatedReason(gate.couldNotRun.detail)
        : null;
    lines.push(
      `conductor: gate ${gate.role} (${gate.product} ${version}): ${outcome}, ${exit}` +
        (gate.enforce ? '' : ', not enforced') +
        (gate.couldNotRun?.gateSaid === undefined ? '' : `, gate said: "${gate.couldNotRun.gateSaid}"`) +
        (conductorSaid === null ? '' : `, conductor said: "${conductorSaid}"`)
    );
  }
  const notRun = (role: string, product: string, why: string): string =>
    `conductor: gate ${role} (${product}): skipped (${why}), no exit code`;
  for (const gate of result.deferred) {
    lines.push(notRun(gate.role, gate.product, `deferred to stage ${gate.stage}`));
  }
  for (const gate of result.skipped) {
    lines.push(notRun(gate.role, gate.product, skipWording(gate.reason).line));
  }
  for (const gate of result.excluded) {
    lines.push(notRun(gate.role, gate.product, '--gate did not name it'));
  }
  for (const gate of result.treeUnchanged) {
    lines.push(notRun(gate.role, gate.product, 'head tree equals the base tree'));
  }
  return lines;
}

type VersionSkew = NonNullable<GateOutcome['versionSkew']>;

/** Where a skewed binary came from, in words. Never a machine path. */
export function skewPlace(skew: VersionSkew): string {
  return resolutionPlace(skew.source);
}

/** The reported version as it may be printed: version characters only (`versionCharacters`). */
export function skewFound(skew: VersionSkew): string {
  return versionCharacters(skew.found);
}

/** The remedy, which depends on where the binary came from. One source: `versionSkewRemedy`. */
function skewFix(product: string, skew: VersionSkew): string {
  return versionSkewRemedy(product, skew.source, skew.expected);
}

/**
 * The sentence every GitHub surface shares (0.13.0): what was found, what was
 * expected, and that the gate was therefore not run. No machine path.
 */
function skewSentence(product: string, skew: VersionSkew): string {
  return (
    `${product} resolved from ${skewPlace(skew)} reports version ${skewFound(skew)}, but this run expects ` +
    `${skew.expected} (the version the action pinned), so conductor did not run it: the gate is ` +
    'could-not-run (version-skew).'
  );
}

/**
 * One error line per gate whose resolved binary reported a version other
 * than the one this run expected (the Action's pin), wherever it was found:
 * node_modules/.bin, PATH or a policy command. Since 0.13.0 every such gate
 * is could-not-run, so the line says so.
 *
 * For the job log: it names the file the binary was found at, which for PATH
 * is an absolute machine path, so this exact line is never part of a report.
 * The reports carry the same fact without that path (gateSection here, the
 * conductor/version-skew notification in SARIF). Resolution is unchanged.
 */
export function versionSkewWarnings(result: RunResult): string[] {
  return result.gates.flatMap((gate) =>
    gate.versionSkew === undefined
      ? []
      : [
          `conductor: error: ${skewSentence(gate.product, gate.versionSkew)} It was found at ` +
            `${gate.versionSkew.path}. ${skewFix(gate.product, gate.versionSkew)}`,
        ]
  );
}

/** A workflow-command message: `%`, CR and LF escaped, as the runner requires. */
function workflowCommandData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/**
 * The same lines as GitHub Actions `::error::` annotations (a could-not-run
 * since 0.13.0, a `::warning::` before), so a skew shows on the run's summary
 * page without anybody opening the log. No machine path: the location is
 * named in words.
 */
export function versionSkewAnnotations(result: RunResult): string[] {
  return result.gates.flatMap((gate) =>
    gate.versionSkew === undefined
      ? []
      : [
          '::error title=conductor version skew::' +
            workflowCommandData(
              `${skewSentence(gate.product, gate.versionSkew)} ${skewFix(gate.product, gate.versionSkew)}`
            ),
        ]
  );
}

/** The step-summary lines for the same errors, one paragraph each. */
export function versionSkewSummaryLines(result: RunResult): string[] {
  return result.gates.flatMap((gate) =>
    gate.versionSkew === undefined
      ? []
      : [`conductor error: ${skewSentence(gate.product, gate.versionSkew)} ${skewFix(gate.product, gate.versionSkew)}`]
  );
}

/** The gate-block line of the text report. Repository-relative paths only. */
function versionSkewLine(gate: GateOutcome): string | null {
  const skew = gate.versionSkew;
  if (skew === undefined) {
    return null;
  }
  const from = skew.source === 'node_modules' ? skew.path : skewPlace(skew);
  return (
    `  ! conductor/version-skew: ${gate.product} ${skewFound(skew)}, from ${from}, was not run: this run expects ` +
    `${skew.expected} (the version the action pinned). Resolution is unchanged. ${skewFix(gate.product, skew)}`
  );
}

/**
 * How many blocking findings one gate that RAN is carrying, for the token.
 *
 * A gate that exited non-zero with nothing on screen marked blocking (the
 * mismatch shape the verdict sentence already has its own wording for) counts
 * as one, so a state that is not a pass never prints a count of zero. A gate
 * that could not run is not counted here at all: its findings list carries
 * the umbrella's own blocking gate-missing finding, and counting that as well
 * would report one broken gate as two things.
 */
function blockingCount(gate: RunResult['gates'][number]): number {
  if (gate.couldNotRun !== null) {
    return 0;
  }
  const blocking = gate.findings.filter((finding) => finding.blocking).length;
  return blocking === 0 && gateExitBlocks(gate) ? 1 : blocking;
}

/**
 * The verdict token: a label for the umbrella's OWN exit decision, in a
 * closed set, so a person or a script reading a report or a job summary gets
 * the state without parsing the verdict sentence.
 *
 *   pass                     exit 0 and nothing was hidden by it
 *   nothing-checked          exit 0, but nothing was checked: no gate ran at
 *                            all (none enabled, or every one deferred,
 *                            tree-unchanged or skipped), or every gate that
 *                            ran checked nothing (nothing to scan, or no
 *                            contract; audit finding F4)
 *   advisory-blocked (N)     exit 1 that --advisory turned into exit 0
 *   unenforced-findings (N)  exit 0, but enforce: false gates blocked or
 *                            could not run
 *   blocked (N)              exit 1
 *   could-not-run            exit 2, a refused trust base included
 *
 * PRECEDENCE, when several apply: could-not-run, then blocked or
 * advisory-blocked, then unenforced-findings, then pass. So an advisory run
 * whose only blocking findings sit on an unenforced gate is
 * unenforced-findings and never advisory-blocked: --advisory did nothing
 * there, and saying it did would be a false statement of what was hidden.
 *
 * This decides nothing. Every branch reads the exit code composeExitCode
 * already produced (result.exitCode) and the enforce flags already on the
 * gates; the only counting is over what those gates said. It never
 * overrules a gate. It is also the same `advisory` boolean cli.ts hands to
 * applyAdvisory, so the label and the process exit code cannot disagree.
 *
 * A SKIPPED gate (no contract, or a waived spec) is in result.skipped rather
 * than result.gates, is neither a blocking finding nor a could-not-run, and
 * so does not by itself move the token off pass when another gate ran. When
 * NO gate ran, the token is nothing-checked, matching the verdict sentence.
 *
 * Any exit code outside 0, 1 and 2 is could-not-run: an unknown state is
 * not a pass.
 */
export function verdictToken(result: RunResult, advisory: boolean): string {
  const refusal = result.trustBase?.refusal;
  const refused = refusal !== undefined && refusal !== null;
  if (refused || (result.exitCode !== 0 && result.exitCode !== EXIT_BLOCKED)) {
    return 'could-not-run';
  }

  if (result.exitCode === EXIT_BLOCKED) {
    const count = result.gates
      .filter((gate) => gate.enforce)
      .reduce((total, gate) => total + blockingCount(gate), 0);
    return advisory ? `advisory-blocked (${count})` : `blocked (${count})`;
  }

  // Exit 0 with no gate having run at all (none enabled, every one deferred,
  // tree-unchanged or skipped): the exit code stays 0, since nothing failed,
  // but the label must not say pass. It is the same condition the verdict
  // sentence words as "nothing was checked".
  if (result.gates.length === 0) {
    return 'nothing-checked';
  }

  const unenforced = result.gates
    .filter((gate) => !gate.enforce)
    .reduce((total, gate) => total + (gate.couldNotRun !== null ? 1 : blockingCount(gate)), 0);
  if (unenforced > 0) {
    return `unenforced-findings (${unenforced})`;
  }
  // Exit 0 where every gate that RAN checked nothing (audit finding F4): the
  // vulnerabilities gate with no lockfile it reads, an intent gate with no
  // contract. Gates ran, so the rule above does not fire, but nothing was
  // examined, and a pass here is the same false statement as a pass with no
  // gate at all. Same token, same exit code (0), same predicate the verdict
  // sentence uses, so the two cannot disagree.
  return result.gates.every(gateCheckedNothing) ? 'nothing-checked' : 'pass';
}

/**
 * A gate that ran and examined nothing: osv-scanner with nothing to scan,
 * osv-scanner whose every handed lockfile parsed to no packages (exit 128,
 * marked `packages-read 0`; a sole lockfile rewritten to {} is exactly the
 * same news as no lockfile), or an intent gate that found no contract to
 * check against. The one predicate behind both the verdict token and the
 * verdict sentence's list of what was not checked.
 *
 * NOT the partial-empty case: `conductor/lockfiles-empty` is also raised
 * when osv-scanner read packages from other lockfiles (audit finding F2),
 * and that gate checked something. Only the `packages-read` marker, which
 * the exit-128 branch alone writes, tells the two apart.
 */
function readNoPackages(gate: RunResult['gates'][number]): boolean {
  return gate.run.details['packages-read'] === 0;
}

function gateCheckedNothing(gate: RunResult['gates'][number]): boolean {
  if (gate.couldNotRun !== null) {
    return false;
  }
  return (
    gate.diagnostics.some((d) => d.code === 'conductor/nothing-to-scan') ||
    readNoPackages(gate) ||
    (gate.role === 'intent' && gate.run.details.contractFound === false)
  );
}

/** How the verdict sentence names a gate that ran and checked nothing. */
function checkedNothingWording(gate: RunResult['gates'][number]): string {
  if (gate.role === 'intent') {
    return `${gate.role} ran but found no contract to check against`;
  }
  return readNoPackages(gate)
    ? `${gate.role} read no packages from its lockfiles`
    : `${gate.role} had nothing to scan`;
}

function verdict(result: RunResult, advisory: boolean): string {
  const refusal = result.trustBase?.refusal;
  if (refusal !== undefined && refusal !== null) {
    // Written rather than composed, exactly as the exit code is: no gate ran,
    // so there is nothing for the clauses below to count, and every one of
    // them would describe a different run from the one that happened. A
    // refusal is a could-not-run outcome (exit 2), which --advisory never
    // touches, so this branch reads advisory or not exactly the same.
    return result.trustBase?.notGiven === true
      ? 'verdict: exit 2, this is a pull-request job and no trust base was given, so no rules ' +
          'were read, no gate ran and nothing here is a result of any kind.'
      : `verdict: exit 2, the trust base "${result.trustBase?.ref ?? ''}" could not be used, ` +
          'so no gate ran and nothing here is a result of any kind.';
  }
  return verdictForRun(result, advisory);
}

function verdictForRun(result: RunResult, advisory: boolean): string {
  // Counted over ENFORCED gates only. The exit code came from those alone,
  // so a count taken over all of them describes a different run from the one
  // the number at the front of the line is about, and the umbrella's own
  // findings about an unenforced broken gate inflate it further.
  const enforcedGates = result.gates.filter((gate) => gate.enforce);
  const blocking = enforcedGates
    .flatMap((gate) => gate.findings)
    .filter((finding) => finding.blocking).length;

  if (
    result.gates.length === 0 &&
    (result.deferred.length > 0 || result.treeUnchanged.length > 0 || result.skipped.length > 0)
  ) {
    // Three distinct states can each leave result.gates empty, and a run can
    // land in more than one of them at once: a stage that deferred one gate
    // while another was tree-unchanged (issue #69) is a real shape, not a
    // hypothetical, so this names EVERY one that applies rather than the
    // first one found. Naming only "every enabled gate is deferred" when a
    // tree-unchanged gate was also in the mix would be false: not every gate
    // was deferred, some had nothing to judge for a different reason. All
    // three are also distinct from "none is enabled" below, and each needs
    // its own fix: set enabled: true is wrong for all three of them, since
    // every gate named here IS enabled.
    const clauses: string[] = [];
    if (result.deferred.length > 0) {
      // Never "every enabled gate is deferred" here: that claim is only true
      // when nothing else in this branch fired, and a mix with a
      // tree-unchanged or skipped gate makes it false.
      const names = result.deferred.map((gate) => `${gate.role} at stage ${gate.stage}`).join(', ');
      clauses.push(`deferred to a later stage (${names})`);
    }
    if (result.treeUnchanged.length > 0) {
      // The head tree is identical to the trust base's, so there is nothing
      // for these gates to judge (issue #69).
      const names = result.treeUnchanged.map((gate) => gate.role).join(', ');
      clauses.push(
        `the head tree is identical to the base tree, so there is no change for these gates to judge (${names})`
      );
    }
    if (result.skipped.length > 0) {
      // What to do about this is NOT the same for every reason, which is why
      // the clause comes from the skip reason rather than being written
      // here: for a missing spec the fix is to write one, and for a waiver
      // there is nothing to fix, because a person decided it.
      clauses.push(
        result.skipped.map((gate) => `${gate.role} ${skipWording(gate.reason).verdict}`).join(', ')
      );
    }
    return `verdict: exit 0, nothing was checked: ${clauses.join('; ')}.`;
  }
  if (result.gates.length === 0) {
    // Exit 0 with an empty report is indistinguishable from a clean run at a
    // glance, and a policy file with every gate switched off is exactly the
    // state somebody needs told about. Still 0: nothing was asked for and
    // nothing failed, so this is not the umbrella's decision to overturn.
    return (
      'verdict: exit 0, no gate ran because none is enabled. ' +
      'Nothing was checked. Set enabled: true on a gate in .guardrails.yaml.'
    );
  }
  const clauses = unenforcedClauses(result);
  const aside =
    clauses.length === 0
      ? ''
      : ` ${clauses.join(' and ')}, but those gates have enforce: false in .guardrails.yaml, ` +
        'so that is not why.';

  if (result.exitCode === EXIT_COULD_NOT_RUN) {
    // Only the ENFORCED gates. An unenforced gate that could not run is not
    // why this run failed, and naming it here sends somebody off to install
    // a gate that would not have changed the answer.
    const names = enforcedGates
      .filter((gate) => gate.couldNotRun !== null)
      .map((gate) => gate.role)
      .join(', ');
    return `verdict: exit 2, a gate could not run (${names}), so nothing here is a clean result.${aside}`;
  }
  if (result.exitCode === EXIT_BLOCKED) {
    // Exit 1 with nothing on screen marked blocking. The sibling of the exit 0
    // clause below, and it exists for the same reason: composeExitCode returns
    // 1 for a non-zero gate exit code OR a blocking finding, and both branches
    // of reconcileBlocking in normalize.ts drop every blocking flag to false
    // while the gate's own non-zero exit still stands. "0 blocking finding(s)"
    // on the one line somebody reads when they read nothing else contradicts
    // the exit code printed beside it, and sends a reader looking for a
    // finding that this report deliberately does not claim.
    //
    // ADVISORY ONLY EVER REWRITES THIS ONE BRANCH. The process's own exit
    // code is decided in cli.ts by mapping EXIT_BLOCKED to EXIT_OK when
    // --advisory was given; this function never changes result.exitCode
    // itself, so a could-not-run verdict a few lines up is untouched
    // whatever `advisory` says. The findings above this line still print
    // with their BLOCKING marker: advisory changes what the exit code
    // claims, never what a gate found.
    if (blocking === 0) {
      // The mismatch branch: composeExitCode also lands here when an
      // enforced gate exited non-zero but nothing reconciled as a blocking
      // finding (conductor/blocking-count-mismatch or
      // conductor/blocking-threshold-unknown; see normalize.ts). "Findings
      // were advisory and did not block" would claim a finding this branch
      // explicitly says there is none of, so it gets its own, narrower
      // wording that is true here and says nothing about findings at all.
      const names = enforcedGates
        .filter((gate) => gateExitBlocks(gate))
        .map((gate) => `${gate.role} (exit ${gate.exitCode ?? '?'})`)
        .join(', ');
      const base =
        `and no finding here is marked blocking. Enforced gate(s) that exited ` +
        `non-zero: ${names}. The umbrella could not reconcile a blocking count with what those ` +
        `gates reported, so the gate exit code decided the run.${aside}`;
      return advisory
        ? `verdict: exit 0, ${base} This run was advisory, so exit 1 became exit 0.`
        : `verdict: exit 1, ${base}`;
    }
    // Gates that blocked out of gates that could have, not a bare count of
    // the enforced ones, which read as if every one of them had blocked.
    const blockedGates = enforcedGates.filter((gate) => blockingCount(gate) > 0).length;
    const base =
      `${blocking} blocking finding(s) in ${blockedGates} of ${enforcedGates.length} ` +
      `enforced gate(s).${aside}`;
    return advisory
      ? `verdict: exit 0, ${base} Findings were advisory and did not block, so this run exits 0 rather than 1.`
      : `verdict: exit 1, ${base}`;
  }

  // Known advisories already on the base branch, reported and not blocking
  // (the vulnerabilities gate under present-on-base: report). Said on the
  // exit-0 verdict, so a pass that carries them never reads as spotless.
  const reported = presentOnBaseReported(result);
  const presentClause =
    reported === 0
      ? ''
      : `; ${reported} known ${reported === 1 ? 'vulnerability' : 'vulnerabilities'} already on the ` +
        `base ${reported === 1 ? 'was' : 'were'} reported, not blocking (vulnerabilities: present-on-base: report)`;

  // Exit 0 with red on the screen above it. The verdict is the one line
  // somebody reads when they read nothing else, so it is the line that has
  // to carry the reason rather than leaving it to the sections.
  if (clauses.length > 0) {
    return (
      `verdict: exit 0, but ${clauses.join(' and ')}${presentClause}. ` +
      'Those gates have enforce: false in .guardrails.yaml, so nothing here failed the run.'
    );
  }

  // "Every enabled gate ran" is only true when each one actually checked
  // something. A gate that was held back, left out, skipped, or found nothing
  // to scan did not, and the sentence a reader reads alone must say so.
  const unchecked: string[] = [
    ...result.deferred.map((gate) => `${gate.role} deferred to stage ${gate.stage}`),
    ...result.excluded.map((gate) => `${gate.role} left out by --gate`),
    ...result.treeUnchanged.map((gate) => `${gate.role} skipped, head tree equals the base tree`),
    ...result.skipped.map((gate) => `${gate.role} ${skipWording(gate.reason).verdict}`),
    // A gate with nothing to scan, or the intent gate with require-frozen:
    // false running with no contract: it ran and checked nothing.
    ...result.gates.filter(gateCheckedNothing).map(checkedNothingWording),
  ];
  // Every gate that ran checked nothing: the token is nothing-checked (audit
  // finding F4), and the sentence says what the token says.
  if (result.gates.every(gateCheckedNothing)) {
    return `verdict: exit 0, nothing was checked: ${unchecked.join('; ')}.`;
  }
  if (unchecked.length > 0) {
    return (
      'verdict: exit 0, no gate blocked, but not every enabled gate checked something: ' +
      `${unchecked.join('; ')}${presentClause}.`
    );
  }

  return `verdict: exit 0, every enabled gate ran and none blocked${presentClause}.`;
}

export interface TextOptions {
  /**
   * Print the full report even when the run is fully clean.
   *
   * A flag on the command line rather than a key in the policy file. The
   * schema describes what a repository gates on, and how loud one developer
   * wants their own terminal to be is not that.
   */
  verbose?: boolean;

  /**
   * The umbrella's own package version, printed as the first line of the
   * full report. This text report is also the pull-request comment body,
   * and without this line nothing on it says which conductor produced it.
   *
   * Left out of the one-line clean summary on purpose: that line is kept to
   * one line by design, and the version is not the fact a clean run needs to
   * lead with. Omitted entirely (no line at all) when no version is given,
   * so a caller that does not pass one sees the same report as before.
   */
  version?: string;

  /**
   * Renders a short body instead of the full report when the trust base was
   * refused and no gate ran: the version, the verdict sentence, and every
   * refusal detail line the full report would have printed for this case
   * (`refusalLines`) -- which is the reason and, when the base ref carries
   * no policy file at all, the remedy that reason names. There is no
   * pointer at a step log: a fork's read-only token cannot even show the
   * commenter that log, so the reason has to be ON the comment rather than
   * behind a link to one.
   *
   * Built for the pull-request-comment step. Its whole point is otherwise a
   * full sticky comment whose only content is "the trust base was refused,
   * nothing was checked" -- true, but not worth the ceremony of the full
   * per-gate report on every push. Every other run is unaffected: this only
   * fires when the trust base was actually refused, whatever --verbose says.
   */
  compact?: boolean;

  /**
   * Maps an EXIT_BLOCKED verdict to exit 0 in the printed verdict line, and
   * says so in words. This never touches the RunResult passed in: the exit
   * code composed for this run (`result.exitCode`) is unchanged, and so is
   * every finding's own `blocking` marker in the sections above the verdict.
   * `cli.ts` is what actually maps the PROCESS exit code, from the same
   * `result.exitCode` this option reads; this flag exists so the one line a
   * reader is most likely to read alone does not contradict the exit code
   * the process is about to produce.
   *
   * Has no effect on any other verdict shape: a could-not-run run (exit 2)
   * reads the same whatever this says, because advisory is about a finding
   * that did not block, never about a gate that did not run.
   */
  advisory?: boolean;

  /**
   * The report is going straight to a terminal (cli.ts: stdout is a TTY and
   * no --output). Only one thing reads it: a refused trust base prints its
   * refusal once at the top and one line per gate, rather than the refusal
   * again in every gate's section and again in every gate's finding. A file,
   * a pipe and a pull request comment never set it and are unchanged.
   */
  terminal?: boolean;
}

/**
 * Whether this run has nothing at all to report.
 *
 * Three conditions, and the second and third are why this is not just a test
 * of the exit code. A gate with enforce: false is left out of the composed
 * code entirely, so a run where such a gate blocked, or could not run at
 * all, still exits 0; collapsing those to one "clean" line would silently
 * swallow the only report of them anybody sees.
 *
 * A GATE'S OWN NOTES ARE NOT IN HERE; THE UMBRELLA'S OWN DIAGNOSTICS ARE.
 * The two are printed with different markers in the full report and the
 * difference is real. A statement about how much of the policy a run covered
 * is a notification: the standing note that pnpm lockfiles do not record
 * install-script metadata is a permanent property of that file format, true
 * on every run forever, and forcing a screenful over it would make the
 * summary line useless in the repositories that most need it. A statement
 * that something went wrong is a result: conductor/blocking-count-mismatch
 * and conductor/blocking-threshold-unknown, the two codes reconcileBlocking
 * raises in normalize.ts, are the umbrella saying its own report may disagree
 * with the gate's own verdict about what blocked, which is a defect in THIS
 * run and cannot be reported as a number on a line that also says "clean,
 * nothing blocked".
 *
 * A run where no gate ran at all is not clean either, whatever the exit code
 * says. "No gate ran because none is enabled", "every gate was deferred" and
 * "nothing had a contract to check" are three distinct states somebody needs
 * telling about, and a summary line that named no gates would be the exact
 * confusion this family exists to prevent.
 */
function isFullyClean(result: RunResult): boolean {
  // Every gate that ran checked nothing is the nothing-checked token's state
  // (audit finding F4), and a line opening "clean" would contradict it.
  if (result.exitCode !== 0 || result.gates.length === 0 || result.gates.every(gateCheckedNothing)) {
    return false;
  }
  // A tie the convention refused to guess, or a skip whose branch 0.10.0
  // bound to a spec, carries a sentence the one-line summary would drop.
  if (
    result.skipped.some(
      (gate) => gate.reason === 'spec-ambiguous' || (gate.selection?.legacy ?? null) !== null
    )
  ) {
    return false;
  }
  return result.gates.every(
    (gate) =>
      gate.couldNotRun === null &&
      (gate.exitCode ?? 0) === 0 &&
      gate.diagnostics.length === 0 &&
      // A note about an input this run did not use is never folded into the
      // one-line summary, where nobody would see it.
      gate.intent?.note === undefined &&
      // Nor a weak convention match, or a winner that changed this release.
      conventionMatch(gate)?.strength !== 'weak' &&
      (conventionMatch(gate)?.legacy ?? null) === null &&
      !gate.findings.some((finding) => finding.blocking)
  );
}

/**
 * The intent-spec header line: a CLOSED SET of four strings, in precedence
 * order, naming no branch, no file and no token. The Action copies one to the
 * step summary only on a whole-line match, so nothing the repository or the
 * head branch carries can reach that summary through it.
 */
export const INTENT_SPEC_LINES = [
  'intent-spec: none chosen, two or more specs matched the branch equally',
  'intent-spec: none chosen, this branch chose a spec before conductor 0.11.0',
  'intent-spec: a different spec chosen than before conductor 0.11.0, see the report',
  'intent-spec: weak match, see the intent gate in the report',
] as const;

/** The first of the four lines that applies to this run, or null. */
function intentSpecLine(result: RunResult): string | null {
  const misses = result.skipped.flatMap((gate) => (gate.selection === undefined ? [] : [gate.selection]));
  const matches = result.gates.flatMap((gate) => {
    const match = conventionMatch(gate);
    return match === null ? [] : [match];
  });
  if (misses.some((miss) => miss.why === 'ambiguous')) {
    return INTENT_SPEC_LINES[0];
  }
  if (misses.some((miss) => miss.legacy !== null)) {
    return INTENT_SPEC_LINES[1];
  }
  if (matches.some((match) => match.legacy !== null)) {
    return INTENT_SPEC_LINES[2];
  }
  if (matches.some((match) => match.strength === 'weak')) {
    return INTENT_SPEC_LINES[3];
  }
  return null;
}

/**
 * dep-guard's own diagnostic code for an online budget that ran out before
 * every lookup was made (dep-guard core, online/deadline.ts,
 * ONLINE_DEADLINE_CODE). Read, never minted: the umbrella only repeats it.
 */
export const DEP_GUARD_DEADLINE_CODE = 'online-deadline-exceeded';

/**
 * The coverage clause for a dep-guard run whose online lookups were cut short
 * by its own deadline, or null. Not a verdict: dep-guard still exits 0 for
 * this and so does the run; the clause exists because a summary that read
 * "ok" while some names were never looked up overstated what was checked.
 */
function deadlineCoverage(gate: GateOutcome): string | null {
  if (gate.product !== 'dep-guard' || gate.couldNotRun !== null) {
    return null;
  }
  const said = gate.run.diagnostics.some((diagnostic) => diagnostic.code === DEP_GUARD_DEADLINE_CODE);
  const skipped = gate.run.details['skipped-by-deadline'];
  const count = typeof skipped === 'number' ? skipped : null;
  if (!said && (count === null || count === 0)) {
    return null;
  }
  return count === null || count === 0
    ? `online lookups incomplete (${DEP_GUARD_DEADLINE_CODE})`
    : `online lookups incomplete, ${count} skipped by the deadline (${DEP_GUARD_DEADLINE_CODE})`;
}

/**
 * The gates' own notes, and only those.
 *
 * The umbrella's own diagnostics are deliberately not added in. They force
 * the full report instead, by the rule on isFullyClean above, so a count of
 * them here would be a count of something that can never be on this line.
 */
function noteCount(result: RunResult): number {
  return result.gates.reduce((total, gate) => total + gate.run.diagnostics.length, 0);
}

/**
 * The whole report of a clean run, on one line.
 *
 * The v0.2 design constraint is that the gates must not slow development
 * down, and the cost it names is ceremony rather than runtime. Twelve lines
 * of per-gate detail on a commit that found nothing is that cost, paid on
 * every commit, and it is what makes a team switch a hook off. What it must
 * still carry: which gates actually ran, which ones did not run here, and
 * that there is more to read. Everything else waits for --verbose.
 */
function summaryLine(result: RunResult): string {
  const ran = result.gates.map((gate) => `${gate.role} (${gate.product})`).join(', ');
  const parts = [`conductor: clean, nothing blocked. ${result.gates.length} gate(s) ran: ${ran}.`];

  if (result.deferred.length > 0) {
    const names = result.deferred
      .map((gate) => `${gate.role} (${gate.product}) from stage ${gate.stage}`)
      .join(', ');
    parts.push(`Deferred to a later stage: ${names}.`);
  }

  // Same reasoning as the deferred clause, for the equal-tree shape
  // (issue #69): these gates are enabled and did not run, so a clean run in
  // this shape must not read like a run that judged their tree too.
  if (result.treeUnchanged.length > 0) {
    const names = result.treeUnchanged.map((gate) => `${gate.role} (${gate.product})`).join(', ');
    parts.push(`Tree unchanged from the trust base, skipped: ${names}.`);
  }

  // Same reasoning as the deferred clause. A gate that ran and had nothing to
  // check covered none of this commit, and silence there makes a branch with
  // no spec read as a branch that passed the intent gate.
  //
  // One clause per REASON, not one clause for all of them. This line is the
  // whole report on a clean run, which is what a pre-commit hook and a pull
  // request comment print, so a shared "nothing to check against" would hide
  // the difference between nobody having written a spec and somebody having
  // decided there is none exactly where most readers stop reading. Grouped in
  // first-seen order so the sentence does not reorder itself between runs.
  const skippedByWording = new Map<string, string[]>();
  for (const gate of result.skipped) {
    const lead = skipWording(gate.reason).summary;
    skippedByWording.set(lead, [
      ...(skippedByWording.get(lead) ?? []),
      `${gate.role} (${gate.product})`,
    ]);
  }
  for (const [lead, names] of skippedByWording) {
    parts.push(`${lead}: ${names.join(', ')}.`);
  }

  // Same reasoning again, for the gates the command line left out. This one
  // is the easiest of the three to lose: a --gate run is usually somebody
  // narrowing a run on purpose, and a log of it that says nothing about the
  // narrowing is the log that gets uploaded and read as a full run later.
  // Counted even at zero for the same suppression reason as the enforcement
  // count above: a gate the command line dropped had no vote, and "0 gate(s)
  // left out by --gate" says the run was not narrowed.
  if (result.excluded.length > 0) {
    const names = result.excluded.map((gate) => `${gate.role} (${gate.product})`).join(', ');
    parts.push(`${result.excluded.length} gate(s) left out by --gate: ${names}.`);
  } else {
    parts.push('0 gate(s) left out by --gate.');
  }

  // A gate that ran with enforce: false could not have failed this run
  // whatever it found. Naming it among the gates that ran and then saying
  // nothing more makes a repository on the adoption ramp read as fully
  // gated, and being fully gated is exactly what the ramp is not yet. The
  // full report says this in the line under that gate's findings; on a clean
  // run there are no findings, so the summary line is the only place left to
  // say it.
  //
  // Printed as a count even when it is zero. This is the family suppression
  // rule: a gate that can be turned off is the user's decision, and a clean
  // line that says nothing about enforcement lets a repository read as fully
  // gated when a gate's result did not move the exit code. "0 gate(s) not
  // enforced" is the umbrella saying every gate that ran had a vote.
  const unenforced = result.gates.filter((gate) => !gate.enforce);
  if (unenforced.length > 0) {
    const names = unenforced.map((gate) => `${gate.role} (${gate.product})`).join(', ');
    parts.push(
      `${unenforced.length} gate(s) not enforced, could not have blocked, enforce: false in .guardrails.yaml: ${names}.`
    );
  } else {
    parts.push('0 gate(s) not enforced.');
  }

  // Gates the policy file switches off. Only when there are some: a count of
  // zero here would be noise on the line a hook prints on every commit.
  const disabled = result.disabled ?? [];
  if (disabled.length > 0) {
    const names = disabled.map((gate) => `${gate.role} (${gate.product})`).join(', ');
    parts.push(`Disabled (enabled: false in .guardrails.yaml): ${names}.`);
  }

  // Non-blocking findings are counted rather than hidden, for the same reason
  // the full report prints the suppressed and ignored counts at zero: they
  // are things the gates actually said, and a summary that omitted them would
  // let a repository accumulate them unread.
  const counts: string[] = [];
  if (result.findings.length > 0) {
    counts.push(`${result.findings.length} non-blocking finding(s)`);
  }
  const notes = noteCount(result);
  if (notes > 0) {
    counts.push(`${notes} note(s)`);
  }
  if (counts.length > 0) {
    parts.push(`${counts.join(', ')}.`);
  }

  // A clean run whose dependency gate did not finish its online lookups is
  // still exit 0, and still this line, but it says so in words.
  for (const gate of result.gates) {
    const coverage = deadlineCoverage(gate);
    if (coverage !== null) {
      parts.push(`${gate.role} (${gate.product}): ${coverage}.`);
    }
  }

  // The suppressed and ignored counts the gates reported, summed across them
  // and printed even at zero. The full report prints these per gate for the
  // same reason, so a quiet report is not mistaken for a clean one; the clean
  // summary line is the one a hook and a pull request comment actually print,
  // and it is where a repository baselining findings without saying so would
  // otherwise read as clean. Suppressed always shows because it is always a
  // number the gate reported. Ignored shows only when every gate that ran
  // reported it: a gate that drops ignored files before its own output has no
  // count to give, and "0 ignored" there would state a fact no gate stated.
  const suppressed = result.gates.reduce((total, gate) => total + gate.run.suppressed, 0);
  const gatesReportingIgnored = result.gates.filter(
    (gate) => gate.run.details.ignoredReported !== false
  );
  const ignored = gatesReportingIgnored.reduce((total, gate) => total + gate.run.ignored, 0);
  parts.push(
    gatesReportingIgnored.length === result.gates.length
      ? `${suppressed} suppressed, ${ignored} ignored across all gates.`
      : `${suppressed} suppressed across all gates.`
  );

  // Pull-request mode, on the one line a hook and a pull request comment
  // actually print. A clean run is exactly where this matters most: a pull
  // request that proposes to switch a gate off and carries nothing else
  // produces a clean report, and without this clause the only trace of the
  // attempt would be in a file nobody re-reads.
  if (result.trustBase !== null) {
    parts.push(`Rules from ${result.trustBase.ref}. ${proposalCount(result)}.`);
    const withheld = withheldTrustBase(result);
    if (withheld.length > 0) {
      const names = withheld.map(({ gate }) => `${gate.role} (${gate.product})`).join(', ');
      parts.push(`${withheld.length} gate(s) NOT in pull-request mode: ${names}.`);
    }
  }

  parts.push('Re-run with --verbose for the full report.');
  return parts.join(' ');
}

/**
 * The version line, as the first line of every report that carries one.
 *
 * One function rather than one literal at each of the two call sites below:
 * the compact body and the full report both lead with it, and a change to
 * the line's wording only needs one edit to stay in sync between them.
 */
function versionLine(version: string | undefined): string[] {
  return version === undefined ? [] : [`conductor ${version}`];
}

/**
 * The version line, then the verdict-token line directly under it: the first
 * two lines of every report that carries a token. Without a version the
 * token is the first line. The closing verdict sentence is a separate thing
 * and stays where it was.
 */
function headerLines(result: RunResult, options: TextOptions): string[] {
  return [
    ...versionLine(options.version),
    `verdict-token: ${verdictToken(result, Boolean(options.advisory))}`,
  ];
}

export function renderText(result: RunResult, options: TextOptions = {}): string {
  const refusal = refusalLines(result);

  if (options.compact === true && refusal.length > 0) {
    // The version, then the verdict sentence, then EVERY refusal detail
    // line the full report would have printed for this case -- refusalLines
    // itself, which already carries the base-ref-specific remedy (running
    // "conductor init", or reading the pull request's own file as a
    // proposal) as part of the same sentence. Nothing here points at a step
    // log: the reason has to be readable on the comment itself.
    const lines: string[] = [
      ...headerLines(result, options),
      verdict(result, Boolean(options.advisory)),
      ...refusal,
    ];
    return `${lines.join('\n')}\n`;
  }

  // The preview, when there is one, goes after everything else: after the
  // one-line summary here and after the verdict line below, so every report
  // line above it is byte for byte the same run's without one.
  const preview = previewLines(result, Boolean(options.verbose));
  const withPreview = (report: string): string =>
    preview.length === 0 ? report : `${report}${preview.join('\n')}\n`;

  if (refusal.length === 0 && !options.verbose && isFullyClean(result)) {
    return withPreview(`${summaryLine(result)}\n`);
  }

  // Counted over EVERY gate, unenforced ones included, and deliberately not
  // the same number the verdict prints. This line is an inventory of what
  // follows it: a reader counting the finding lines on screen has to arrive
  // at this number, and narrowing it to the enforced gates would make the
  // header disagree with the report under it. The verdict is the other
  // question, what failed the run, and that one is enforced gates only. Two
  // different questions, so two numbers, and the section headers and the
  // "not enforced" lines are what connect them.
  // The fixed third line (osv design, section 4.4), printed only when known
  // advisories were reported and not blocking. The Action copies it to the
  // job summary when, and only when, line 3 is exactly this shape, so a pass
  // that carries them does not read as spotless there either.
  const reported = presentOnBaseReported(result);
  // The intent-spec line follows it, so the present-on-base line, when
  // present, stays line 3 and every report without an intent-spec line keeps
  // the shape the Action already reads.
  const specLine = intentSpecLine(result);
  const lines: string[] = [
    ...headerLines(result, options),
    ...(reported === 0 ? [] : [`present-on-base: ${reported} reported, not blocking`]),
    ...(specLine === null ? [] : [specLine]),
    ...refusal,
    ...(refusal.length === 0 ? [] : ['']),
    `conductor run: ${result.gates.length} gate(s), ${result.findings.length} finding(s)`,
  ];

  const refusedOnTerminal = options.terminal === true && refusal.length > 0;
  if (refusedOnTerminal && result.gates.length > 0) {
    lines.push('');
  }
  for (const gate of result.gates) {
    lines.push(...gateSection(gate, Boolean(options.verbose), refusedOnTerminal));
  }

  const aside = [
    ...deferredLines(result),
    ...skippedLines(result),
    ...excludedLines(result),
    ...treeUnchangedLines(result),
    ...disabledLines(result),
  ];
  if (aside.length > 0) {
    lines.push('', ...aside);
  }

  const trust = trustBaseLines(result);
  if (trust.length > 0) {
    lines.push('', ...trust);
  }

  // A derived severity is marked with a trailing asterisk above; say what
  // that means rather than leaving a reader to guess, and only when one is
  // actually on screen.
  // A compact terminal refusal prints no finding line at all, so no asterisk.
  if (!refusedOnTerminal && result.findings.some((finding) => finding.severityIsDerived)) {
    lines.push('', '* severity assigned by the umbrella; that gate reports no per-finding severity.');
  }

  lines.push('', verdict(result, Boolean(options.advisory)));
  return withPreview(`${lines.join('\n')}\n`);
}
