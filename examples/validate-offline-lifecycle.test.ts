import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/cli/dist/conductor.js");

function run(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseJson(stdout: string) {
  return JSON.parse(stdout) as Record<string, unknown>;
}

function setupFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "conductor-offline-fixture-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "README.md"),
    "# Fixture\n\nUsage documentation for the offline validation fixture.\n",
    "utf8",
  );
  writeFileSync(join(dir, "package.json"), '{"name":"fixture","version":"1.0.0"}\n', "utf8");
  writeFileSync(join(dir, "src", "index.js"), "module.exports = {};\n", "utf8");

  for (const cmd of [
    ["git", ["init"]],
    ["git", ["add", "."]],
    ["git", ["-c", "user.name=Conductor Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"]],
  ] as const) {
    const result = spawnSync(cmd[0], [...cmd[1]], { cwd: dir, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(
        `${cmd[0]} ${cmd[1].join(" ")} failed: ${result.stderr || result.stdout}`,
      );
    }
  }

  return dir;
}

describe("offline lifecycle fixture", () => {
  it(
    "runs init → extract → freeze → check pass/block without network",
    async () => {
    expect(existsSync(cliPath)).toBe(true);
    const dir = setupFixture();
    const ask =
      "Update README usage documentation for the package. Do not change source code, package metadata, or build configuration.";

    const init = run(["init", "--project", dir], repoRoot);
    expect(init.code).toBe(0);
    const initJson = parseJson(init.stdout);
    expect(initJson.next_steps).toBeInstanceOf(Array);

    const extract = run(["extract", "--project", dir, "--text", ask], repoRoot);
    expect(extract.code).toBe(0);
    expect(parseJson(extract.stdout).valid).toBe(true);

    const freeze = run(
      ["freeze", "--project", dir, "--approved-by", "offline-fixture", "--json"],
      repoRoot,
    );
    expect(freeze.code).toBe(0);
    expect(parseJson(freeze.stdout).frozen).toBe(true);

    appendFileSync(join(dir, "README.md"), "\nOffline fixture probe.\n");
    spawnSync("git", ["add", "README.md"], { cwd: dir, encoding: "utf8" });
    const readmeCheck = run(
      ["check", "--project", dir, "--staged", "--signals", "README documentation update", "--json"],
      repoRoot,
    );
    expect(readmeCheck.code).toBe(0);
    expect(parseJson(readmeCheck.stdout).status).toBe("ok");

    appendFileSync(join(dir, "src", "index.js"), "\n");
    spawnSync("git", ["add", "src/index.js"], { cwd: dir, encoding: "utf8" });
    const sourceCheck = run(["check", "--project", dir, "--staged", "--json"], repoRoot);
    expect(sourceCheck.code).toBe(1);
    expect(parseJson(sourceCheck.stdout).status).toBe("blocked");

    const report = run(["report", "--project", dir, "--staged", "--json"], repoRoot);
    expect(report.code).toBe(1);
    const reportJson = parseJson(report.stdout);
    expect(reportJson.status).toBe("blocked");
    expect(reportJson.recommendation).toMatch(/resolve the drift/i);
    },
    30_000,
  );
});
