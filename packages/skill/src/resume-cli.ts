#!/usr/bin/env node
import { renderResume } from "@vaultcompasshq/conductor-core";

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
const resumeMarkdown = renderResume(args.projectRoot);

if (!resumeMarkdown) {
  console.error("No .conductor/intent-contract.yaml found. Run conductor-extract first.");
  process.exit(1);
}

if (args.json) {
  console.log(JSON.stringify({ resume_markdown: resumeMarkdown }));
} else {
  console.log(resumeMarkdown);
}
