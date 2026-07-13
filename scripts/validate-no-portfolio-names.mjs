#!/usr/bin/env node
/**
 * Public-repo hygiene guard: fail if tracked files contain tokens whose
 * SHA-256 (lowercased) matches the blocklist below. Plaintext portfolio
 * codenames are never stored in this repo — only hashes. To add an entry:
 *
 *   node -e "const c=require('crypto');const t=process.argv[1];console.log(c.createHash('sha256').update(t.toLowerCase()).digest('hex'))" '<token>'
 *
 * Paste the hash into BANNED_HASHES. See CONTRIBUTING.md § Public repo hygiene.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// SHA-256(lowercase token) — no plaintext codenames in the repository.
const BANNED_HASHES = new Set([
  "8bb4b7a9e837acadf49af332f3211a29f98e2239aa985825f1fe62cdf780c068",
  "9f9f3ba21e38f52a4a40f521490c33c4a2da799b5235c53374ad159ea8d0000b",
  "bcbff8a223bdb66059e43ae951a28ed12598c9e782fb65c58dabcd347f65cabe",
  "c3b53b09f7f132caa42bd4ddb8acd99972439acb571e9322fe9607135197154b",
  "cd800cbc9cd106b8f8646762b9ba7c530812555958e019b97c0a9878b005c52f",
  "d52aa800a6d18843a0369b60f374fefb59b2cb91318b83c040f9e9d561ee96c4",
  "e44dbe116f27c5aef9c3386906b82f94f8b557a48c4b036a248f3ba75ddaece1",
  "ec4e8dbcdbe500197bb27e769cee7864c0a4b4876a604998a23c80bbcc979d4c",
  "57cd823001a8558b03746dd1dac01fe13b4fc442728bed4b5840703a755b810e",
  "59f5eae64585bb2483b57c4618b144e92011ba0656565003a42db23f029f8bd5",
  "7f5f6e890b491a749b2a764e033c6b8d19fc0a0022697d391438dd11af101b95",
]);

const ALLOWLIST = new Set([
  "CONTRIBUTING.md",
  "docs/release/public-content-policy.md",
  "integrations/cursor/no-portfolio-names.mdc",
  "scripts/validate-no-portfolio-names.mjs",
]);

const INTERNAL_PATH = /\/Users\/[^/\s]+\/Desktop\/Projects\//i;
const TOKEN = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*\b/gi;

function hashToken(token) {
  return createHash("sha256").update(token.toLowerCase()).digest("hex");
}

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "buffer",
  });
  if (result.status !== 0) {
    console.error("validate-no-portfolio-names: git ls-files failed");
    process.exit(2);
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((path) => !path.startsWith("node_modules/"));
}

let failed = false;

for (const rel of trackedFiles()) {
  if (ALLOWLIST.has(rel)) continue;

  const abs = join(repoRoot, rel);
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue;
  }

  const pathMatch = text.match(INTERNAL_PATH);
  if (pathMatch) {
    const line = text.slice(0, pathMatch.index).split("\n").length;
    console.error(`✗ ${rel}:${line}: internal workspace path`);
    failed = true;
  }

  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    if (BANNED_HASHES.has(hashToken(token))) {
      const line = text.slice(0, match.index).split("\n").length;
      console.error(`✗ ${rel}:${line}: blocked token (hash match)`);
      failed = true;
    }
  }
}

if (failed) {
  console.error(
    "\nvalidate-no-portfolio-names: remove portfolio references from tracked files.",
  );
  console.error("See CONTRIBUTING.md § Public repo hygiene.");
  process.exit(1);
}

console.log(
  "validate-no-portfolio-names: OK (no portfolio product names in tracked files)",
);
