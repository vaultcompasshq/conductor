#!/usr/bin/env node
import { initConductor } from "@vaultcompass/conductor-core";

function parseArgs(argv: string[]) {
  let projectRoot = ".";
  let json = true;
  let human = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" && argv[i + 1]) {
      projectRoot = argv[++i];
    } else if (arg === "--json") {
      json = true;
      human = false;
    } else if (arg === "--human") {
      human = true;
      json = false;
    }
  }

  return { projectRoot, json, human };
}

const args = parseArgs(process.argv.slice(2));
const result = initConductor(args.projectRoot);

if (args.human) {
  console.log(`Conductor initialized in ${result.conductor_dir}`);
  if (result.created.length > 0) {
    console.log(`Created: ${result.created.join(", ")}`);
  }
  if (result.skipped.length > 0) {
    console.log(`Skipped (already present): ${result.skipped.join(", ")}`);
  }
  console.log("");
  console.log("Next steps:");
  for (const step of result.next_steps) {
    console.log(`  ${step}`);
  }
} else {
  console.log(JSON.stringify(result));
}
