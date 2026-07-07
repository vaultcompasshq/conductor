#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGES = [
  "packages/schema",
  "packages/core",
  "packages/skill",
  "packages/cli",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function usage() {
  console.log(`Usage: node scripts/publish-beta.mjs [--dry-run]

Publishes @vaultcompass/conductor packages in dependency order.
Requires npm login with publish access to the @vaultcompasshq scope.

Steps:
  1. pnpm build
  2. pnpm release:smoke
  3. publish schema -> core -> skill -> cli
`);
}

const dryRun = process.argv.includes("--dry-run");
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

console.log("Building workspace...");
run("pnpm", ["build"]);
console.log("Running release smoke...");
run("pnpm", ["release:smoke"]);

for (const pkg of PACKAGES) {
  const args = ["publish", "--access", "public", "--no-git-checks"];
  if (dryRun) args.push("--dry-run");
  console.log(`\nPublishing ${pkg}...`);
  run("pnpm", args, { cwd: resolve(repoRoot, pkg) });
}

console.log(dryRun ? "\nDry run complete." : "\nPublish complete.");
