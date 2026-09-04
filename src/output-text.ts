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
import { EXIT_BLOCKED, EXIT_COULD_NOT_RUN } from './exit-codes.js';
import type { GateOutcome } from './gate-runner.js';
import type { RunResult } from './run.js';

function subjectLabel(finding: Finding): string {
  const subject = finding.subject;
  switch (subject.kind) {
    case 'package':
      return `${subject.name} (${subject.manifest})`;
    case 'location':
      return `${subject.file}:${subject.line}:${subject.column}`;
    case 'paths':
      return subject.paths.join(', ');
    case 'contract':
      return subject.category === undefined ? 'intent contract' : `contract: ${subject.category}`;
    case 'none':
      return '';
  }
}

function findingLines(finding: Finding): string[] {
  const marker = finding.blocking ? 'BLOCKING' : '  report';
  const severity = finding.severityIsDerived ? `${finding.severity}*` : finding.severity;
  const subject = subjectLabel(finding);
  const head = `  ${marker}  ${severity.padEnd(9)} ${finding.ruleId}${
    subject === '' ? '' : `  ${subject}`
  }`;
  return [head, `      ${finding.message}`];
}

function header(gate: GateOutcome): string {
  const version = gate.productVersion === null ? '(version unknown)' : gate.productVersion;
  // On the header line rather than only at the bottom of the section: a
  // reader scanning headers for the gate that refused their commit has to
  // be able to see, in the same glance, that this one did not.
  const enforcement = gate.enforce ? '' : '  [not enforced]';
  if (gate.couldNotRun !== null) {
    return `${gate.role}  ${gate.product} ${version}  DID NOT RUN (${gate.couldNotRun.reason})${enforcement}`;
  }
  const source = gate.binary === null ? '' : `  via ${gate.binary.candidate} on ${gate.binary.source}`;
  return `${gate.role}  ${gate.product} ${version}  exit ${gate.exitCode ?? '?'}  ${gate.durationMs}ms${source}${enforcement}`;
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
  if (blocking > 0 || (gate.exitCode ?? 0) !== 0) {
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
      ? `the repository's own frozen ${source.path}`
      : source.kind === 'imported'
        ? `spec ${source.spec}${source.plan === null ? '' : ` plus plan ${source.plan}`}`
        : 'none';
  const base =
    gate.intent.baseRef === null ? 'base: none, the git index' : `base: ${gate.intent.baseRef}`;
  return `  contract: ${where}   ${base}`;
}

function gateSection(gate: GateOutcome): string[] {
  const lines: string[] = ['', header(gate)];

  const contract = contractLine(gate);
  if (contract !== null) {
    lines.push(contract);
  }

  if (gate.couldNotRun !== null) {
    lines.push(`    ${gate.couldNotRun.detail}`);
    if (gate.stderr.trim().length > 0) {
      for (const line of gate.stderr.trim().split('\n')) {
        lines.push(`    | ${line}`);
      }
    }
  }

  // Sorted here rather than relying on the order the gate happened to emit:
  // blocking first, then by severity. A section whose first line is a low
  // finding buries the one that just refused a commit.
  for (const finding of [...gate.findings].sort(compareFindings)) {
    lines.push(...findingLines(finding));
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
    (gate) => `  skipped   ${gate.role}  ${gate.product}  no contract: ${gate.detail}`
  );
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
      ((gate.exitCode ?? 0) !== 0 || gate.findings.some((finding) => finding.blocking))
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

function verdict(result: RunResult): string {
  // Counted over ENFORCED gates only. The exit code came from those alone,
  // so a count taken over all of them describes a different run from the one
  // the number at the front of the line is about, and the umbrella's own
  // findings about an unenforced broken gate inflate it further.
  const enforcedGates = result.gates.filter((gate) => gate.enforce);
  const blocking = enforcedGates
    .flatMap((gate) => gate.findings)
    .filter((finding) => finding.blocking).length;

  if (result.gates.length === 0 && result.deferred.length > 0) {
    // Distinct from "none is enabled" below. A policy file with everything
    // switched off and a stage with nothing to do at it are two different
    // states, and telling somebody to set enabled: true is the wrong advice
    // for the second one.
    const names = result.deferred.map((gate) => `${gate.role} at stage ${gate.stage}`).join(', ');
    return `verdict: exit 0, nothing ran at this stage: every enabled gate is deferred (${names}).`;
  }
  if (result.gates.length === 0 && result.skipped.length > 0) {
    // A third distinct state, and telling somebody to switch a gate on is
    // wrong advice here too: the gate IS on, it ran, and it had nothing to
    // check. The fix is a spec, which the skipped line above names.
    const names = result.skipped.map((gate) => gate.role).join(', ');
    return `verdict: exit 0, nothing was checked: ${names} had no contract to check against.`;
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
    return `verdict: exit 1, ${blocking} blocking finding(s) across ${enforcedGates.length} gate(s).${aside}`;
  }

  // Exit 0 with red on the screen above it. The verdict is the one line
  // somebody reads when they read nothing else, so it is the line that has
  // to carry the reason rather than leaving it to the sections.
  if (clauses.length > 0) {
    return (
      `verdict: exit 0, but ${clauses.join(' and ')}. ` +
      'Those gates have enforce: false in .guardrails.yaml, so nothing here failed the run.'
    );
  }

  return `verdict: exit 0, every enabled gate ran and none blocked.`;
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
 * that something went wrong is a result: conductor/blocking-mismatch is the
 * umbrella saying its own report may disagree with the gate's own verdict
 * about what blocked, which is a defect in THIS run and cannot be reported
 * as a number on a line that also says "clean, nothing blocked".
 *
 * A run where no gate ran at all is not clean either, whatever the exit code
 * says. "No gate ran because none is enabled", "every gate was deferred" and
 * "nothing had a contract to check" are three distinct states somebody needs
 * telling about, and a summary line that named no gates would be the exact
 * confusion this family exists to prevent.
 */
function isFullyClean(result: RunResult): boolean {
  if (result.exitCode !== 0 || result.gates.length === 0) {
    return false;
  }
  return result.gates.every(
    (gate) =>
      gate.couldNotRun === null &&
      (gate.exitCode ?? 0) === 0 &&
      gate.diagnostics.length === 0 &&
      !gate.findings.some((finding) => finding.blocking)
  );
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

  // Same reasoning as the deferred clause. A gate that ran and had nothing to
  // check covered none of this commit, and silence there makes a branch with
  // no spec read as a branch that passed the intent gate.
  if (result.skipped.length > 0) {
    const names = result.skipped.map((gate) => `${gate.role} (${gate.product})`).join(', ');
    parts.push(`Nothing to check against: ${names}.`);
  }

  // A gate that ran with enforce: false could not have failed this run
  // whatever it found. Naming it among the gates that ran and then saying
  // nothing more makes a repository on the adoption ramp read as fully
  // gated, and being fully gated is exactly what the ramp is not yet. The
  // full report says this in the line under that gate's findings; on a clean
  // run there are no findings, so the summary line is the only place left to
  // say it.
  const unenforced = result.gates.filter((gate) => !gate.enforce);
  if (unenforced.length > 0) {
    const names = unenforced.map((gate) => `${gate.role} (${gate.product})`).join(', ');
    parts.push(`Could not have blocked, enforce: false in .guardrails.yaml: ${names}.`);
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

  parts.push('Re-run with --verbose for the full report.');
  return parts.join(' ');
}

export function renderText(result: RunResult, options: TextOptions = {}): string {
  if (!options.verbose && isFullyClean(result)) {
    return `${summaryLine(result)}\n`;
  }

  // Counted over EVERY gate, unenforced ones included, and deliberately not
  // the same number the verdict prints. This line is an inventory of what
  // follows it: a reader counting the finding lines on screen has to arrive
  // at this number, and narrowing it to the enforced gates would make the
  // header disagree with the report under it. The verdict is the other
  // question, what failed the run, and that one is enforced gates only. Two
  // different questions, so two numbers, and the section headers and the
  // "not enforced" lines are what connect them.
  const lines: string[] = [
    `conductor run: ${result.gates.length} gate(s), ${result.findings.length} finding(s)`,
  ];

  for (const gate of result.gates) {
    lines.push(...gateSection(gate));
  }

  const aside = [...deferredLines(result), ...skippedLines(result)];
  if (aside.length > 0) {
    lines.push('', ...aside);
  }

  // A derived severity is marked with a trailing asterisk above; say what
  // that means rather than leaving a reader to guess, and only when one is
  // actually on screen.
  if (result.findings.some((finding) => finding.severityIsDerived)) {
    lines.push('', '* severity assigned by the umbrella; that gate reports no per-finding severity.');
  }

  lines.push('', verdict(result));
  return `${lines.join('\n')}\n`;
}
