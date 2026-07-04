#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import {
  buildBrief,
  freezeContract,
  isContractFrozen,
  readContract,
  writeContract,
  writeIndex,
} from "@vaultcompasshq/conductor-core";

function parseArgs(argv: string[]) {
  let projectRoot = ".";
  let approvedBy = "";
  let yes = false;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" && argv[i + 1]) projectRoot = argv[++i];
    else if (arg === "--approved-by" && argv[i + 1]) approvedBy = argv[++i];
    else if (arg === "--yes") yes = true;
    else if (arg === "--json") json = true;
  }
  return { projectRoot, approvedBy, yes, json };
}

function gitUser(projectRoot: string): string {
  try {
    return execFileSync("git", ["config", "user.name"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function printSummary(projectRoot: string): void {
  const c = readContract(projectRoot)!;
  const b = buildBrief(c);
  process.stderr.write(`\nIntent: ${b.intent}\n`);
  process.stderr.write(`In scope: ${b.in_scope.join("; ") || "(none)"}\n`);
  process.stderr.write(`Out of scope: ${b.out_of_scope.join("; ") || "(none)"}\n`);
  process.stderr.write(`Constraints (crit/high): ${b.constraints.join("; ") || "(none)"}\n\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const contract = readContract(args.projectRoot);
  if (!contract) {
    console.error("No draft .conductor/intent-contract.yaml found. Run conductor-extract first.");
    process.exit(1);
  }
  if (isContractFrozen(contract)) {
    const out = {
      already_frozen: true,
      approved_by: contract.approval?.approved_by,
      approved_at: contract.approval?.approved_at,
    };
    console.log(args.json ? JSON.stringify(out) : `Already approved by ${out.approved_by}.`);
    process.exit(0);
  }

  let approvedBy = args.approvedBy;
  let method: "interactive" | "explicit-flag" | "forced" =
    args.approvedBy ? "explicit-flag" : "interactive";

  if (!approvedBy) {
    // No explicit approver. Only an interactive TTY may approve; otherwise
    // refuse — an automated run cannot self-approve the contract.
    if (args.yes) {
      approvedBy = gitUser(args.projectRoot) || process.env.USER || "unknown";
      method = "forced";
    } else if (process.stdin.isTTY && process.stdout.isTTY) {
      printSummary(args.projectRoot);
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      const answer = (await rl.question("Approve and freeze this contract? [y/N] ")).trim().toLowerCase();
      rl.close();
      if (answer !== "y" && answer !== "yes") {
        console.error("Aborted — contract not frozen.");
        process.exit(1);
      }
      approvedBy = gitUser(args.projectRoot) || process.env.USER || "user";
      method = "interactive";
    } else {
      console.error(
        "Refusing to freeze: approval requires --approved-by <name> in a non-interactive run (an agent must not self-approve).",
      );
      process.exit(1);
    }
  }

  const frozen = freezeContract(contract, { approvedBy, method });
  const writtenPath = writeContract(args.projectRoot, frozen);
  const indexPath = writeIndex(args.projectRoot);
  const out = {
    frozen: true,
    written_path: writtenPath,
    index_path: indexPath,
    approved_by: approvedBy,
    method,
  };
  console.log(args.json ? JSON.stringify(out) : `✓ Frozen. Approved by ${approvedBy} (${method}).`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
