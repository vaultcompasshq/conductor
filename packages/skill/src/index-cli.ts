#!/usr/bin/env node
import { renderIndex, writeIndex } from "@vaultcompasshq/conductor-core";

function parseArgs(argv: string[]) {
  let projectRoot = ".";
  let write = false;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" && argv[i + 1]) projectRoot = argv[++i];
    else if (arg === "--write") write = true;
    else if (arg === "--json") json = true;
  }

  return { projectRoot, write, json };
}

const args = parseArgs(process.argv.slice(2));
const indexMarkdown = renderIndex(args.projectRoot);
const writtenPath = args.write ? writeIndex(args.projectRoot) : null;

if (args.json) {
  console.log(
    JSON.stringify({
      written_path: writtenPath,
      index_markdown: indexMarkdown,
    }),
  );
} else if (writtenPath) {
  console.log(`✓ Wrote ${writtenPath}`);
} else {
  console.log(indexMarkdown);
}
