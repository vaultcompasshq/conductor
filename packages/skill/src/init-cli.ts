#!/usr/bin/env node
import { initConductor } from "@vaultcompasshq/conductor-core";

function parseArgs(argv: string[]) {
  let projectRoot = ".";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" && argv[i + 1]) {
      projectRoot = argv[++i];
    }
  }

  return { projectRoot };
}

const args = parseArgs(process.argv.slice(2));
const result = initConductor(args.projectRoot);
console.log(JSON.stringify(result));
