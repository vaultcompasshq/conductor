#!/usr/bin/env node
import {
  addCorrection,
  readContract,
  writeContract,
  writeIndex,
} from "@vaultcompasshq/conductor-core";

function parseArgs(argv: string[]) {
  let projectRoot = ".";
  let wrong = "";
  let right = "";
  let rule = "";
  let acknowledge = false;
  let promote = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" && argv[i + 1]) projectRoot = argv[++i];
    else if (arg === "--wrong" && argv[i + 1]) wrong = argv[++i];
    else if (arg === "--right" && argv[i + 1]) right = argv[++i];
    else if (arg === "--rule" && argv[i + 1]) rule = argv[++i];
    else if (arg === "--acknowledge") acknowledge = true;
    else if (arg === "--promote") promote = true;
  }

  return { projectRoot, wrong, right, rule, acknowledge, promote };
}

const args = parseArgs(process.argv.slice(2));
if (!args.wrong || !args.right || !args.rule) {
  console.error(
    "Usage: conductor-correct --wrong <text> --right <text> --rule <text> [--project <root>] [--acknowledge] [--promote]",
  );
  process.exit(1);
}

const contract = readContract(args.projectRoot);
if (!contract) {
  console.error("No frozen .conductor/intent-contract.yaml found.");
  process.exit(1);
}

const updated = addCorrection(contract, {
  wrong: args.wrong,
  right: args.right,
  rule: args.rule,
  acknowledged: args.acknowledge,
  promote: args.promote,
});
const writtenPath = writeContract(args.projectRoot, updated);
const indexPath = writeIndex(args.projectRoot);
const entry = updated.correction_log![updated.correction_log!.length - 1];

console.log(
  JSON.stringify({
    written_path: writtenPath,
    index_path: indexPath,
    correction: entry,
    promoted: entry.promoted_to_constraint === true,
    pending: entry.acknowledged_by === "pending",
  }),
);
