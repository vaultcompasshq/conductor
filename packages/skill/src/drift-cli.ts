#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  appendDriftEvent,
  formatDriftMessage,
  loadConfig,
  scoreDrift,
} from "@vaultcompass/conductor-core";
import { assertValidIntentContract } from "@vaultcompass/conductor-schema";

function parseArgs(argv: string[]) {
  let contractPath = "";
  let projectRoot = ".";
  const paths: string[] = [];
  const signals: string[] = [];
  let userMessage = "";
  let log = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--contract" && argv[i + 1]) {
      contractPath = argv[++i];
    } else if (arg === "--project" && argv[i + 1]) {
      projectRoot = argv[++i];
    } else if (arg === "--paths" && argv[i + 1]) {
      paths.push(...argv[++i].split(",").filter(Boolean));
    } else if (arg === "--signals" && argv[i + 1]) {
      signals.push(...argv[++i].split(",").filter(Boolean));
    } else if (arg === "--message" && argv[i + 1]) {
      userMessage = argv[++i];
    } else if (arg === "--log") {
      log = true;
    }
  }

  return { contractPath, projectRoot, paths, signals, userMessage, log };
}

const args = parseArgs(process.argv.slice(2));
if (!args.contractPath) {
  console.error(
    "Usage: conductor-drift --contract <path> [--project <root>] [--paths a,b] [--signals x] [--message text] [--log]",
  );
  process.exit(1);
}

const raw = parse(readFileSync(args.contractPath, "utf8"));
const contract = assertValidIntentContract(raw);
const config = loadConfig(args.projectRoot);
const score = scoreDrift(
  contract,
  {
    changedPaths: args.paths,
    signals: args.signals,
    userMessage: args.userMessage,
  },
  {
    thresholds: config.drift.thresholds,
    hard_block_on_critical_constraints:
      config.drift.hard_block_on_critical_constraints,
  },
);

if (args.log) {
  appendDriftEvent(args.projectRoot, {
    contract_id: contract.contract_id,
    overall: score.overall,
    action: score.action,
    findings: score.findings,
    changed_paths: args.paths,
    user_message: args.userMessage || undefined,
  });
}

console.log(
  JSON.stringify({
    overall: score.overall,
    action: score.action,
    categories: score.categories,
    findings: score.findings,
    message: formatDriftMessage(score),
    block: score.action === "soft_block" || score.action === "hard_block",
  }),
);
