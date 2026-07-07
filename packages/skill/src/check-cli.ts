#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  appendDriftEvent,
  checkGate,
  crossSessionDrift,
  formatDriftMessage,
  readArchivedContract,
  readContract,
} from "@vaultcompass/conductor-core";

function parseArgs(argv: string[]) {
  let projectRoot = ".";
  const paths: string[] = [];
  const signals: string[] = [];
  let userMessage = "";
  let staged = false;
  let requireFrozen = true;
  let json = false;
  let log = false;
  let previousContract = "";

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
    } else if (arg === "--log") {
      log = true;
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
    log,
    previousContract,
  };
}

function stagedPaths(projectRoot: string): string[] {
  try {
    const out = execFileSync(
      "git",
      ["diff", "--cached", "--name-only"],
      { cwd: projectRoot, encoding: "utf8" },
    );
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const args = parseArgs(process.argv.slice(2));
const changedPaths = [...args.paths];
if (args.staged) changedPaths.push(...stagedPaths(args.projectRoot));

const result = checkGate(args.projectRoot, {
  requireFrozen: args.requireFrozen,
  signals: {
    changedPaths,
    signals: args.signals,
    userMessage: args.userMessage || undefined,
  },
});

const crossSession =
  args.previousContract
    ? (() => {
        const previous = readArchivedContract(
          args.projectRoot,
          args.previousContract,
        );
        const current = readContract(args.projectRoot);
        if (!previous || !current) return null;
        return crossSessionDrift(previous, current, {
          changedPaths,
          signals: args.signals,
          userMessage: args.userMessage || undefined,
        });
      })()
    : null;

if (args.log && result.drift) {
  appendDriftEvent(args.projectRoot, {
    contract_id: "gate-check",
    overall: result.drift.overall,
    action: result.drift.action,
    findings: result.drift.findings,
    changed_paths: changedPaths,
    user_message: args.userMessage || undefined,
  });
}

if (args.json) {
  console.log(JSON.stringify({ ...result, crossSessionDrift: crossSession }));
} else if (result.status === "blocked") {
  console.error("✖ Conductor gate: BLOCKED");
  for (const reason of result.reasons) console.error(`  - ${reason}`);
  if (result.drift) {
    console.error("");
    console.error(formatDriftMessage(result.drift));
  }
} else {
  console.log("✓ Conductor gate: ok");
  if (result.drift && result.drift.action !== "proceed") {
    console.log(`  drift: ${result.drift.action} (${result.drift.overall}/100)`);
  }
  if (crossSession && crossSession.previous.action !== "proceed") {
    console.log(
      `  prior-contract drift: ${crossSession.previous.action} (${crossSession.previous.overall}/100 vs ${crossSession.previous_contract_id})`,
    );
  }
}

process.exit(result.exitCode);
