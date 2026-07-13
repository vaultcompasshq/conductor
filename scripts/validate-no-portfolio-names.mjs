#!/usr/bin/env node
/**
 * Fail if tracked files mention Vault & Compass portfolio product names.
 * Conductor is public OSS — downstream app identities belong in private repos
 * or local maintainer notes only.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Product slugs and display names — extend when new Tier apps launch. */
const BANNED_PATTERNS = [
  /\bcapitalcanvas\b/i,
  /\bsheetful\b/i,
  /\bprismfolio\b/i,
  /\bnixblock\b/i,
  /\bkidcompass\b/i,
  /\bbrightlet\b/i,
  /\bstaysafe\b/i,
  /\bco-?signed\b/i,
  /\bmedicalbillsuite\b/i,
  /\bmedical-bill-suite\b/i,
  /vaultcompasshq\/(capitalcanvas|sheetful|prismfolio|nixblock|kidcompass|brightlet)/i,
];

const SKIP_PATH =
  /(?:^|\/)(?:node_modules|dist|\.git|pnpm-lock\.yaml|validate-no-portfolio-names\.mjs)(?:\/|$)/;

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "buffer" });
  if (result.status !== 0) {
    console.error("validate-no-portfolio-names: git ls-files failed");
    process.exit(2);
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((path) => !SKIP_PATH.test(path));
}

function scan() {
  const hits = [];
  for (const rel of trackedFiles()) {
    const abs = join(repoRoot, rel);
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of BANNED_PATTERNS) {
        if (pattern.test(line)) {
          hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
          break;
        }
      }
    }
  }
  return hits;
}

const hits = scan();
if (hits.length === 0) {
  console.log("validate-no-portfolio-names: OK (no portfolio product names in tracked files)");
  process.exit(0);
}

console.error("validate-no-portfolio-names: portfolio product names found in tracked files:\n");
for (const hit of hits) {
  console.error(`  ${hit.file}:${hit.line}: ${hit.text}`);
}
console.error(
  "\nUse generic labels (Tier 0 app repo, downstream integration) or local-only notes.",
);
process.exit(1);
