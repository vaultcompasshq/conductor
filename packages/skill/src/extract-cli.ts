#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { stringify } from "yaml";
import {
  coachMessage,
  draftContract,
  loadAllConstraints,
  loadConfig,
  scorePrompt,
  writeContract,
} from "@vaultcompasshq/conductor-core";
import { validateIntentContract } from "@vaultcompasshq/conductor-schema";

function parseArgs(argv: string[]) {
  let projectRoot = ".";
  let userText = "";
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" && argv[i + 1]) {
      projectRoot = argv[++i];
    } else if (arg === "--text" && argv[i + 1]) {
      userText = argv[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  return { projectRoot, userText, dryRun };
}

const args = parseArgs(process.argv.slice(2));
if (!args.userText) {
  console.error(
    "Usage: conductor-extract --text <user ask> [--project <root>] [--dry-run]",
  );
  process.exit(1);
}

const loaded = loadAllConstraints(args.projectRoot);
const config = loadConfig(args.projectRoot);
const draft = draftContract({
  userText: args.userText,
  constraints: loaded.constraints,
});
const scored = scorePrompt(args.userText, {
  constraints: loaded.constraints.map((c) => c.rule),
  hasAcceptanceCriteria: /\b(verify|test|should|must|done)\b/i.test(args.userText),
});
const coaching = coachMessage(scored, args.userText);
// extract only ever writes an UNFROZEN draft. Approval is a separate,
// deliberate step: conductor-freeze.
const contract = draft;
const validation = validateIntentContract(contract);
const needsCoaching =
  scored.score < config.coach.show_when_score_below || scored.issues.length > 0;

let writtenPath: string | null = null;
if (!args.dryRun && validation.valid) {
  writtenPath = writeContract(args.projectRoot, contract);
}

console.log(
  JSON.stringify({
    valid: validation.valid,
    errors: validation.errors,
    written_path: writtenPath,
    frozen: false,
    next_step: "Review the draft, then approve with: conductor-freeze --project <root> [--approved-by <name>]",
    loaded_constraint_files: loaded.loadedFiles,
    prompt_score: scored.score,
    needs_coaching: needsCoaching,
    coaching,
    contract_yaml: stringify(contract),
  }),
);
