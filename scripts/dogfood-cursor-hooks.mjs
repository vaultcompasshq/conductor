#!/usr/bin/env node
/**
 * Cursor integration dogfood — mechanical gate path.
 *
 * Cursor project rules are advisory. Enforcement is the Git pre-commit hook
 * installed via `conductor hook install`, which is what this script proves:
 *
 *   1. Copy integrations/cursor/conductor.mdc → .cursor/rules/
 *   2. init → extract → freeze
 *   3. hook install
 *   4. doctor sees the hook
 *   5. out-of-scope staged change → check + pre-commit block
 *   6. in-scope staged change → check + commit succeed
 *
 * Usage (from repo root, after build):
 *   node scripts/dogfood-cursor-hooks.mjs
 *   pnpm dogfood:cursor-hooks
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  chmodSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "packages/cli/dist/conductor.js");
const checkCli = join(root, "packages/skill/dist/check-cli.js");
const ruleSrc = join(root, "integrations/cursor/conductor.mdc");

function fail(msg) {
  console.error(`dogfood-cursor-hooks: FAIL — ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

if (!existsSync(cli) || !existsSync(checkCli)) {
  fail("build missing — run `pnpm build` first");
}

const work = mkdtempSync(join(tmpdir(), "conductor-cursor-dogfood-"));
const bin = join(work, "bin");
mkdirSync(bin);

// Wrappers so the installed pre-commit hook finds conductor on PATH.
writeFileSync(
  join(bin, "conductor"),
  `#!/usr/bin/env bash\nexec node "${cli}" "$@"\n`,
);
writeFileSync(
  join(bin, "conductor-check"),
  `#!/usr/bin/env bash\nexec node "${checkCli}" "$@"\n`,
);
chmodSync(join(bin, "conductor"), 0o755);
chmodSync(join(bin, "conductor-check"), 0o755);

const env = {
  ...process.env,
  PATH: `${bin}:${process.env.PATH ?? ""}`,
  GIT_AUTHOR_NAME: "Cursor Dogfood",
  GIT_AUTHOR_EMAIL: "dogfood@example.invalid",
  GIT_COMMITTER_NAME: "Cursor Dogfood",
  GIT_COMMITTER_EMAIL: "dogfood@example.invalid",
};

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: work,
    env,
    encoding: "utf8",
    ...opts,
  });
  return result;
}

function conductor(args) {
  return run("node", [cli, ...args]);
}

try {
  console.log(`dogfood-cursor-hooks: workdir ${work}`);

  run("git", ["init", "-q"]);
  run("git", ["config", "user.name", "Cursor Dogfood"]);
  run("git", ["config", "user.email", "dogfood@example.invalid"]);
  // Intentionally leave global core.hooksPath alone — hook install should
  // localize to .git/hooks when a machine-wide hooksPath is configured.

  writeFileSync(join(work, "README.md"), "# Cursor dogfood fixture\n");
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({ name: "cursor-dogfood-fixture", version: "0.0.0" }, null, 2) +
      "\n",
  );
  mkdirSync(join(work, "src"), { recursive: true });
  writeFileSync(join(work, "src", "app.ts"), "export const n = 1;\n");

  mkdirSync(join(work, ".cursor", "rules"), { recursive: true });
  copyFileSync(ruleSrc, join(work, ".cursor", "rules", "conductor.mdc"));
  ok("installed Cursor project rule (.cursor/rules/conductor.mdc)");

  let r = conductor(["init", "--project", "."]);
  if (r.status !== 0) fail(`init: ${r.stderr || r.stdout}`);
  ok("conductor init");

  // README-only ask — same pattern as packed-install dogfood; source edits drift.
  const ask =
    "Add README install example only. Do not change source or package.json.";
  r = conductor(["extract", "--project", ".", "--text", ask]);
  if (r.status !== 0) fail(`extract: ${r.stderr || r.stdout}`);
  ok("conductor extract");

  r = conductor([
    "freeze",
    "--project",
    ".",
    "--approved-by",
    "cursor-dogfood",
  ]);
  if (r.status !== 0) fail(`freeze: ${r.stderr || r.stdout}`);
  ok("conductor freeze");

  r = conductor(["hook", "install", "--project", "."]);
  if (r.status !== 0) fail(`hook install: ${r.stderr || r.stdout}`);
  const hookPath = join(work, ".git", "hooks", "pre-commit");
  if (!existsSync(hookPath)) fail("pre-commit hook missing after install");
  if (!readFileSync(hookPath, "utf8").includes("conductor-managed-pre-commit")) {
    fail("pre-commit hook missing Conductor marker");
  }
  ok("conductor hook install");

  r = conductor(["doctor", "--project", ".", "--json"]);
  if (r.status !== 0) fail(`doctor: ${r.stderr || r.stdout}`);
  const doctorJson = JSON.stringify(JSON.parse(r.stdout)).toLowerCase();
  if (!doctorJson.includes("pre-commit") && !doctorJson.includes("hook")) {
    fail(`doctor did not report pre-commit hook: ${r.stdout.slice(0, 400)}`);
  }
  ok("conductor doctor sees pre-commit hook");

  run("git", ["add", "."]);
  r = run("git", [
    "commit",
    "--no-verify",
    "-qm",
    "chore: seed cursor dogfood fixture",
  ]);
  if (r.status !== 0) fail(`seed commit: ${r.stderr || r.stdout}`);
  ok("seed commit");

  // Out-of-scope: touch source (prohibited)
  writeFileSync(join(work, "src", "app.ts"), "export const n = 2;\n");
  run("git", ["add", "src/app.ts"]);

  r = conductor(["check", "--project", ".", "--staged", "--json"]);
  let gate;
  try {
    gate = JSON.parse(r.stdout);
  } catch {
    fail(`check JSON parse: ${r.stdout || r.stderr}`);
  }
  if (r.status === 0 || gate.status === "ok") {
    fail(
      `expected out-of-scope source change to block (status=${gate.status}, code=${r.status})`,
    );
  }
  ok(`out-of-scope check blocks (status=${gate.status})`);

  r = run("git", ["commit", "-qm", "should be blocked by conductor hook"]);
  if (r.status === 0) fail("pre-commit allowed out-of-scope commit");
  ok("pre-commit blocks out-of-scope commit");

  run("git", ["reset", "HEAD", "src/app.ts"]);
  run("git", ["checkout", "--", "src/app.ts"]);

  // In-scope: README only
  writeFileSync(
    join(work, "README.md"),
    "# Cursor dogfood fixture\n\nInstall: npm i example\n",
  );
  run("git", ["add", "README.md"]);

  r = conductor(["check", "--project", ".", "--staged", "--json"]);
  try {
    gate = JSON.parse(r.stdout);
  } catch {
    fail(`in-scope check JSON: ${r.stdout || r.stderr}`);
  }
  if (r.status !== 0 || gate.status === "blocked") {
    fail(
      `expected in-scope README change to pass (status=${gate.status}, code=${r.status}, stdout=${r.stdout})`,
    );
  }
  ok(`in-scope check passes (status=${gate.status})`);

  r = run("git", ["commit", "-qm", "docs: add install example"]);
  if (r.status !== 0) {
    fail(`pre-commit blocked in-scope commit: ${r.stderr || r.stdout}`);
  }
  ok("pre-commit allows in-scope commit");

  console.log("\ndogfood-cursor-hooks: OK");
  console.log(
    "Cursor rule is advisory; mechanical enforcement = conductor hook install.",
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
