#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const COMMANDS = {
  init: "init-cli.js",
  coach: "coach-cli.js",
  extract: "extract-cli.js",
  freeze: "freeze-cli.js",
  check: "check-cli.js",
  drift: "drift-cli.js",
  correct: "correct-cli.js",
  brief: "brief-cli.js",
  doctor: "doctor-cli.js",
  resume: "resume-cli.js",
  index: "index-cli.js",
  pivot: "pivot-cli.js",
} as const;

type Command = keyof typeof COMMANDS;

const HELP = `Usage: conductor <command> [flags]

Commands:
  init      Create a .conductor project skeleton
  coach     Score a prompt for scope and clarity risks
  extract   Draft an unfrozen Intent Contract from an ask
  freeze    Approve and freeze the active draft contract
  check     Run the enforcement gate against changed paths
  drift     Score drift for a specific contract file
  correct   Record a durable correction lesson
  brief     Emit a compact Session Brief
  doctor    Diagnose local Conductor setup
  resume    Emit a Session Brief plus recent history
  index     Render or regenerate .conductor/index.md
  pivot     Record an intentional scope change

Global flags:
  --help, -h       Show this help
  --version, -v    Print the CLI version

Examples:
  conductor init --project .
  conductor extract --project . --text "Add CSV export. No new API endpoints."
  conductor freeze --project . --approved-by alice
  conductor doctor --project .
  conductor check --project . --staged
  conductor drift --ci --contract .conductor/intent-contract.yaml --paths src/app/api/export/route.ts

For command flags, see docs/cli-reference.md. Legacy bins such as
conductor-check and conductor-resume remain available from conductor-skill.`;

function packageVersion(): string {
  const pkgUrl = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

function skillCliPath(command: Command): string {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve("@vaultcompasshq/conductor-skill/package.json");
  return join(dirname(pkgJson), "dist", COMMANDS[command]);
}

function printHelp(): void {
  console.log(HELP);
}

function isCommand(value: string): value is Command {
  return Object.prototype.hasOwnProperty.call(COMMANDS, value);
}

function relay(result: ReturnType<typeof spawnSync>): never {
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.signal) {
    console.error(`conductor: subcommand terminated by ${result.signal}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

function runPassthrough(command: Command, args: string[]): never {
  const result = spawnSync(process.execPath, [skillCliPath(command), ...args], {
    stdio: "inherit",
  });
  relay(result);
}

function runDrift(commandArgs: string[]): never {
  const ci = commandArgs.includes("--ci");
  if (!ci) runPassthrough("drift", commandArgs);

  const args = commandArgs.filter((arg) => arg !== "--ci");
  const result = spawnSync(process.execPath, [skillCliPath("drift"), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error || result.signal || result.status !== 0) relay(result);

  try {
    const parsed = JSON.parse(result.stdout) as { block?: boolean };
    process.exit(parsed.block ? 1 : 0);
  } catch {
    console.error("conductor drift --ci: failed to parse drift JSON output");
    process.exit(1);
  }
}

function main(argv: string[]): never {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const [first, ...rest] = normalized;

  if (!first || first === "--help" || first === "-h" || first === "help") {
    printHelp();
    process.exit(0);
  }

  if (first === "--version" || first === "-v" || first === "version") {
    console.log(packageVersion());
    process.exit(0);
  }

  if (!isCommand(first)) {
    console.error(`Unknown conductor command: ${first}`);
    console.error("Run `conductor --help` for available commands.");
    process.exit(1);
  }

  if (first === "drift") runDrift(rest);
  runPassthrough(first, rest);
}

main(process.argv.slice(2));
