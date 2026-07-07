#!/usr/bin/env node
import {
  runDoctor,
  type DoctorFinding,
  type DoctorFindingStatus,
} from "@vaultcompass/conductor-core";

function parseArgs(argv: string[]) {
  let projectRoot = ".";
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" && argv[i + 1]) {
      projectRoot = argv[++i];
    } else if (arg === "--json") {
      json = true;
    }
  }

  return { projectRoot, json };
}

function marker(status: DoctorFindingStatus): string {
  if (status === "ok") return "ok";
  if (status === "info") return "info";
  if (status === "warn") return "warn";
  return "error";
}

function renderFinding(finding: DoctorFinding): string {
  const path = finding.path ? ` (${finding.path})` : "";
  const detail = finding.detail ? `\n    ${finding.detail}` : "";
  return `  [${marker(finding.status)}] ${finding.message}${path}${detail}`;
}

const args = parseArgs(process.argv.slice(2));
const result = runDoctor(args.projectRoot);

if (args.json) {
  console.log(JSON.stringify(result));
} else {
  console.log(`Conductor doctor: ${result.status}`);
  console.log(
    `Summary: ${result.summary.ok} ok, ${result.summary.info} info, ${result.summary.warn} warn, ${result.summary.error} error`,
  );
  for (const finding of result.findings) {
    console.log(renderFinding(finding));
  }
}

process.exit(result.exitCode);
