#!/usr/bin/env node
/**
 * Claude Code integration dogfood — lifecycle hook path.
 *
 * Claude lifecycle configs are advisory until hooks fire. This script proves
 * the shared shell adapters used by settings.sample.json:
 *
 *   1. Copy settings.sample.json → .claude/settings.json
 *   2. Copy integrations/hooks into the fixture (CLAUDE_PROJECT_DIR layout)
 *   3. init → extract → freeze
 *   4. SessionStart script prints a resume brief
 *   5. out-of-scope staged change → Stop script (conductor-stop-check) blocks
 *   6. in-scope staged change → Stop script passes
 *   7. (secondary) conductor hook install still works for the shared Git gate
 *
 * Usage (from repo root, after build):
 *   node scripts/dogfood-claude-hooks.mjs
 *   pnpm dogfood:claude-hooks
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
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
const resumeCli = join(root, "packages/skill/dist/resume-cli.js");
const settingsSrc = join(
  root,
  "integrations/claude-code/settings.sample.json",
);
const hooksSrc = join(root, "integrations/hooks");

function fail(msg) {
  console.error(`dogfood-claude-hooks: FAIL — ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

if (!existsSync(cli) || !existsSync(checkCli) || !existsSync(resumeCli)) {
  fail("build missing — run `pnpm build` first");
}

if (!existsSync(settingsSrc) || !existsSync(hooksSrc)) {
  fail("Claude Code sample or integrations/hooks missing");
}

const work = mkdtempSync(join(tmpdir(), "conductor-claude-dogfood-"));
const bin = join(work, "bin");
mkdirSync(bin);

writeFileSync(
  join(bin, "conductor"),
  `#!/usr/bin/env bash\nexec node "${cli}" "$@"\n`,
);
writeFileSync(
  join(bin, "conductor-check"),
  `#!/usr/bin/env bash\nexec node "${checkCli}" "$@"\n`,
);
writeFileSync(
  join(bin, "conductor-resume"),
  `#!/usr/bin/env bash\nexec node "${resumeCli}" "$@"\n`,
);
chmodSync(join(bin, "conductor"), 0o755);
chmodSync(join(bin, "conductor-check"), 0o755);
chmodSync(join(bin, "conductor-resume"), 0o755);

const env = {
  ...process.env,
  PATH: `${bin}:${process.env.PATH ?? ""}`,
  CLAUDE_PROJECT_DIR: work,
  GIT_AUTHOR_NAME: "Claude Dogfood",
  GIT_AUTHOR_EMAIL: "dogfood@example.invalid",
  GIT_COMMITTER_NAME: "Claude Dogfood",
  GIT_COMMITTER_EMAIL: "dogfood@example.invalid",
};

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: work,
    env,
    encoding: "utf8",
    ...opts,
  });
}

function conductor(args) {
  return run("node", [cli, ...args]);
}

try {
  console.log(`dogfood-claude-hooks: workdir ${work}`);

  run("git", ["init", "-q"]);
  run("git", ["config", "user.name", "Claude Dogfood"]);
  run("git", ["config", "user.email", "dogfood@example.invalid"]);

  writeFileSync(join(work, "README.md"), "# Claude dogfood fixture\n");
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({ name: "claude-dogfood-fixture", version: "0.0.0" }, null, 2) +
      "\n",
  );
  mkdirSync(join(work, "src"), { recursive: true });
  writeFileSync(join(work, "src", "app.ts"), "export const n = 1;\n");

  mkdirSync(join(work, ".claude"), { recursive: true });
  copyFileSync(settingsSrc, join(work, ".claude", "settings.json"));
  const settings = readFileSync(join(work, ".claude", "settings.json"), "utf8");
  if (!settings.includes("${CLAUDE_PROJECT_DIR}")) {
    fail("installed settings missing CLAUDE_PROJECT_DIR placeholders");
  }
  if (!settings.includes("conductor-session-start.sh")) {
    fail("installed settings missing SessionStart script");
  }
  if (!settings.includes("conductor-stop-check.sh")) {
    fail("installed settings missing Stop script");
  }
  ok("installed Claude Code settings (.claude/settings.json)");

  mkdirSync(join(work, "integrations"), { recursive: true });
  cpSync(hooksSrc, join(work, "integrations", "hooks"), { recursive: true });
  for (const name of [
    "conductor-session-start.sh",
    "conductor-stop-check.sh",
    "conductor-lib.sh",
  ]) {
    chmodSync(join(work, "integrations", "hooks", name), 0o755);
  }
  ok("copied integrations/hooks into fixture");

  let r = conductor(["init", "--project", "."]);
  if (r.status !== 0) fail(`init: ${r.stderr || r.stdout}`);
  ok("conductor init");

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
    "claude-dogfood",
  ]);
  if (r.status !== 0) fail(`freeze: ${r.stderr || r.stdout}`);
  ok("conductor freeze");

  const sessionStart = join(
    work,
    "integrations",
    "hooks",
    "conductor-session-start.sh",
  );
  r = run("bash", [sessionStart]);
  if (r.status !== 0) {
    fail(`SessionStart script failed: ${r.stderr || r.stdout}`);
  }
  const briefOut = `${r.stdout || ""}${r.stderr || ""}`;
  if (!/session brief|intent|in_scope|README/i.test(briefOut)) {
    fail(
      `SessionStart did not print a useful brief (stdout=${(r.stdout || "").slice(0, 400)})`,
    );
  }
  ok("SessionStart script prints resume brief");

  run("git", ["add", "."]);
  r = run("git", [
    "commit",
    "--no-verify",
    "-qm",
    "chore: seed claude dogfood fixture",
  ]);
  if (r.status !== 0) fail(`seed commit: ${r.stderr || r.stdout}`);
  ok("seed commit");

  const stopCheck = join(
    work,
    "integrations",
    "hooks",
    "conductor-stop-check.sh",
  );

  writeFileSync(join(work, "src", "app.ts"), "export const n = 2;\n");
  run("git", ["add", "src/app.ts"]);

  r = run("bash", [stopCheck]);
  // Claude Code hard-blocks Stop only on exit 2 (exit 1 is non-blocking).
  if (r.status !== 2) {
    fail(
      `expected Stop script to block with exit 2 (got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr})`,
    );
  }
  ok(`Stop script blocks out-of-scope change (exit=${r.status})`);

  run("git", ["reset", "HEAD", "src/app.ts"]);
  run("git", ["checkout", "--", "src/app.ts"]);

  writeFileSync(
    join(work, "README.md"),
    "# Claude dogfood fixture\n\nInstall: npm i example\n",
  );
  run("git", ["add", "README.md"]);

  r = run("bash", [stopCheck]);
  if (r.status !== 0) {
    fail(
      `expected Stop script to allow in-scope README change (exit=${r.status}, stdout=${r.stdout}, stderr=${r.stderr})`,
    );
  }
  ok("Stop script allows in-scope README change");

  // Secondary: shared Git mechanical gate still installs.
  r = conductor(["hook", "install", "--project", "."]);
  if (r.status !== 0) fail(`hook install: ${r.stderr || r.stdout}`);
  const hookPath = join(work, ".git", "hooks", "pre-commit");
  if (!existsSync(hookPath)) fail("pre-commit hook missing after install");
  if (!readFileSync(hookPath, "utf8").includes("conductor-managed-pre-commit")) {
    fail("pre-commit hook missing Conductor marker");
  }
  ok("shared Git gate: conductor hook install");

  console.log("\ndogfood-claude-hooks: OK");
  console.log(
    "Claude lifecycle samples call SessionStart/Stop scripts; blocking gate = conductor-check.",
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
