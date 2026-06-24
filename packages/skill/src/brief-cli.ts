#!/usr/bin/env node
import { buildBrief, readContract, renderBriefMarkdown } from "@vaultcompasshq/conductor-core";

function parseArgs(argv: string[]) {
  let projectRoot = ".";
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" && argv[i + 1]) projectRoot = argv[++i];
    else if (arg === "--json") json = true;
  }
  return { projectRoot, json };
}

const args = parseArgs(process.argv.slice(2));
const contract = readContract(args.projectRoot);
if (!contract) {
  console.error("No frozen .conductor/intent-contract.yaml found.");
  process.exit(1);
}

if (args.json) {
  console.log(JSON.stringify(buildBrief(contract)));
} else {
  console.log(renderBriefMarkdown(contract));
}
