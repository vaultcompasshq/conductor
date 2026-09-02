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
  if (gate.couldNotRun !== null) {
    return `${gate.role}  ${gate.product} ${version}  DID NOT RUN (${gate.couldNotRun.reason})`;
  }
  const source = gate.binary === null ? '' : `  via ${gate.binary.candidate} on ${gate.binary.source}`;
  return `${gate.role}  ${gate.product} ${version}  exit ${gate.exitCode ?? '?'}  ${gate.durationMs}ms${source}`;
}

function gateSection(gate: GateOutcome): string[] {
  const lines: string[] = ['', header(gate)];

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
    const threshold = gate.run.failOn === null ? 'threshold not reported' : `threshold ${gate.run.failOn}`;
    lines.push(
      `  ${threshold}   suppressed ${gate.run.suppressed}   ignored ${gate.run.ignored}`
    );
    for (const diagnostic of gate.run.diagnostics) {
      lines.push(`  note ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  for (const diagnostic of gate.diagnostics) {
    lines.push(`  ! ${diagnostic.code}: ${diagnostic.message}`);
  }

  return lines;
}

function verdict(result: RunResult): string {
  const blocking = result.findings.filter((finding) => finding.blocking).length;
  if (result.exitCode === EXIT_COULD_NOT_RUN) {
    const names = result.gates
      .filter((gate) => gate.couldNotRun !== null)
      .map((gate) => gate.role)
      .join(', ');
    return `verdict: exit 2, a gate could not run (${names}), so nothing here is a clean result.`;
  }
  if (result.exitCode === EXIT_BLOCKED) {
    return `verdict: exit 1, ${blocking} blocking finding(s) across ${result.gates.length} gate(s).`;
  }
  return `verdict: exit 0, every enabled gate ran and none blocked.`;
}

export function renderText(result: RunResult): string {
  const lines: string[] = [
    `compass run: ${result.gates.length} gate(s), ${result.findings.length} finding(s)`,
  ];

  for (const gate of result.gates) {
    lines.push(...gateSection(gate));
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
