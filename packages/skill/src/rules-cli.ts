#!/usr/bin/env node
import {
  auditRules,
  renderRulesAuditMarkdown,
} from "@vaultcompasshq/conductor-core";

function usage(): never {
  console.error("Usage: conductor-rules audit [--project <root>] [--json]");
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  if (command !== "audit") usage();

  let projectRoot = ".";
  let json = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--project" && rest[i + 1]) {
      projectRoot = rest[++i];
    } else if (arg === "--json") {
      json = true;
    }
  }

  return { projectRoot, json };
}

const args = parseArgs(process.argv.slice(2));
const result = auditRules(args.projectRoot);

if (args.json) {
  console.log(JSON.stringify(result));
} else {
  console.log(renderRulesAuditMarkdown(result));
}

process.exit(0);
