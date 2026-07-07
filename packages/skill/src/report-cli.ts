#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  buildConductorReport,
  renderConductorReportMarkdown,
} from "@vaultcompasshq/conductor-core";

function parseArgs(argv: string[]) {
  let projectRoot = ".";
  const paths: string[] = [];
  const signals: string[] = [];
  let userMessage = "";
  let staged = false;
  let requireFrozen = true;
  let json = false;
  let previousContract = "";
  let withSecrets = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" && argv[i + 1]) {
      projectRoot = argv[++i];
    } else if (arg === "--paths" && argv[i + 1]) {
      paths.push(...argv[++i].split(",").filter(Boolean));
    } else if (arg === "--signals" && argv[i + 1]) {
      signals.push(...argv[++i].split(",").filter(Boolean));
    } else if (arg === "--message" && argv[i + 1]) {
      userMessage = argv[++i];
    } else if (arg === "--staged") {
      staged = true;
    } else if (arg === "--no-require-frozen") {
      requireFrozen = false;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--with-secrets") {
      withSecrets = true;
    } else if (arg === "--previous-contract" && argv[i + 1]) {
      previousContract = argv[++i];
    }
  }

  return {
    projectRoot,
    paths,
    signals,
    userMessage,
    staged,
    requireFrozen,
    json,
    previousContract,
    withSecrets,
  };
}

function stagedPaths(projectRoot: string): string[] {
  try {
    const out = execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    return out.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const args = parseArgs(process.argv.slice(2));
const changedPaths = [...args.paths];
if (args.staged) changedPaths.push(...stagedPaths(args.projectRoot));

const report = buildConductorReport(args.projectRoot, {
  requireFrozen: args.requireFrozen,
  previousContract: args.previousContract || undefined,
  withSecrets: args.withSecrets,
  signals: {
    changedPaths,
    signals: args.signals,
    userMessage: args.userMessage || undefined,
  },
});

if (args.json) {
  console.log(JSON.stringify(report));
} else {
  console.log(renderConductorReportMarkdown(report));
}

process.exit(report.exitCode);
