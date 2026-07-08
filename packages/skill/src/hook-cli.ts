#!/usr/bin/env node
import { installPreCommitHook } from "@vaultcompass/conductor-core";

const REASONS: Record<string, string> = {
  not_a_git_repo: "No .git directory found. Run this inside a git repository.",
  existing_hook_not_managed:
    "A pre-commit hook already exists and was not created by Conductor. Re-run with --force to overwrite it.",
};

function usage(): void {
  console.log(`Usage: conductor hook install [flags]

Install a self-contained Git pre-commit hook that runs the Conductor gate on
staged changes. The hook depends only on the installed CLIs, not on the
Conductor source repo.

Flags:
  --project <dir>      Project root (default: .)
  --with-vault-guard   Also run vault-guard secret scanning in the hook
  --force              Overwrite an existing non-Conductor pre-commit hook
  --json               Emit JSON (default)
  --human              Human-readable output
  --help, -h           Show this help`);
}

function parseArgs(argv: string[]) {
  let projectRoot = ".";
  let withVaultGuard = false;
  let force = false;
  let human = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" && argv[i + 1]) projectRoot = argv[++i];
    else if (arg === "--with-vault-guard") withVaultGuard = true;
    else if (arg === "--force") force = true;
    else if (arg === "--human") human = true;
    else if (arg === "--json") human = false;
  }

  return { projectRoot, withVaultGuard, force, human };
}

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  usage();
  process.exit(0);
}

// Accept an optional leading "install" subcommand for a natural CLI feel.
const rest = argv[0] === "install" ? argv.slice(1) : argv;
const args = parseArgs(rest);
const result = installPreCommitHook(args.projectRoot, {
  withVaultGuard: args.withVaultGuard,
  force: args.force,
});

if (args.human) {
  if (result.installed) {
    console.log(`Installed Conductor pre-commit hook at ${result.path}`);
    if (result.withVaultGuard) console.log("Paired with vault-guard secret scanning.");
    console.log("Bypass a single commit with: git commit --no-verify");
  } else {
    console.error(REASONS[result.reason ?? ""] ?? `Could not install hook: ${result.reason}`);
  }
} else {
  console.log(JSON.stringify(result));
}

process.exit(result.installed ? 0 : 1);
