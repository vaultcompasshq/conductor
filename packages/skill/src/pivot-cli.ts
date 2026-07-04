#!/usr/bin/env node
import {
  addPivot,
  readContract,
  writeContract,
  writeIndex,
} from "@vaultcompasshq/conductor-core";

function parseArgs(argv: string[]) {
  let projectRoot = ".";
  let change = "";
  let reason = "";
  let acknowledge = false;
  const addScope: string[] = [];
  const removeScope: string[] = [];
  const addOutOfScope: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" && argv[i + 1]) projectRoot = argv[++i];
    else if (arg === "--change" && argv[i + 1]) change = argv[++i];
    else if (arg === "--reason" && argv[i + 1]) reason = argv[++i];
    else if (arg === "--add-scope" && argv[i + 1]) addScope.push(argv[++i]);
    else if (arg === "--remove-scope" && argv[i + 1]) removeScope.push(argv[++i]);
    else if (arg === "--add-out-of-scope" && argv[i + 1]) addOutOfScope.push(argv[++i]);
    else if (arg === "--acknowledge") acknowledge = true;
  }

  return {
    projectRoot,
    change,
    reason,
    acknowledge,
    addScope,
    removeScope,
    addOutOfScope,
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.change) {
  console.error(
    "Usage: conductor-pivot --change <text> [--reason <text>] [--add-scope <text>] [--remove-scope <text>] [--add-out-of-scope <text>] [--acknowledge] [--project <root>]",
  );
  process.exit(1);
}

const contract = readContract(args.projectRoot);
if (!contract) {
  console.error("No .conductor/intent-contract.yaml found. Run conductor-extract first.");
  process.exit(1);
}

const updated = addPivot(contract, {
  change: args.change,
  reason: args.reason || undefined,
  acknowledged: args.acknowledge,
  in_scope_added: args.addScope,
  in_scope_removed: args.removeScope,
  out_of_scope_added: args.addOutOfScope,
});
const writtenPath = writeContract(args.projectRoot, updated);
const indexPath = writeIndex(args.projectRoot);
const entry = updated.pivot_log[updated.pivot_log.length - 1];

console.log(
  JSON.stringify({
    written_path: writtenPath,
    index_path: indexPath,
    pivot: entry,
    pending: entry.acknowledged_by === "pending",
  }),
);
