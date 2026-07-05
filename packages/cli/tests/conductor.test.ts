import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const DIST = join(import.meta.dirname, "..", "dist");
const CLI = join(DIST, "conductor.js");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd?: string): RunResult {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "conductor-unified-cli-"));
}

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error("dist not built - run `pnpm build` before tests");
  }
});

describe("conductor", () => {
  it("prints top-level help", () => {
    const res = run(["--help"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Usage: conductor <command> [flags]");
    expect(res.stdout).toContain("conductor check --project . --staged");
  });

  it("accepts a leading pnpm argument separator", () => {
    const res = run(["--", "--help"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Usage: conductor <command> [flags]");
  });

  it("prints the package version", () => {
    const res = run(["--version"]);
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe("0.3.0-beta.0");
  });

  it("dispatches to an existing subcommand", () => {
    const res = run(["coach", "just quickly add export like notion"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.needs_coaching).toBe(true);
  });

  it("runs init through the unified binary", () => {
    const dir = tmpProject();
    const res = run(["init", "--project", dir]);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout).created).toContain(".conductor/config.yaml");
    expect(existsSync(join(dir, ".conductor", "config.yaml"))).toBe(true);
  });

  it("supports drift --ci with a blocking exit code", () => {
    const dir = tmpProject();
    const contractPath = join(dir, "intent-contract.yaml");
    writeFileSync(
      contractPath,
      `contract_id: ic-20260704-clici0
version: "1.0.0"
original_ask: "Add CSV export for the fund performance table."
in_scope:
  - "Client-side CSV export of fund table"
out_of_scope:
  - "New API endpoints"
constraints:
  - source: AGENTS.md
    rule: "No new API endpoints without explicit approval"
    priority: critical
acceptance_criteria:
  - id: ac-1
    description: "Export downloads CSV"
    testable: true
frozen_at: "2026-06-17T14:30:00Z"
frozen_by: user
pivot_log: []
metadata:
  project: conductor
`,
    );

    const res = run([
      "drift",
      "--ci",
      "--contract",
      contractPath,
      "--project",
      dir,
      "--paths",
      "src/app/api/export/route.ts",
      "--signals",
      "new api endpoint",
    ]);
    expect(res.code).toBe(1);
    expect(res.stderr).toBe("");
    expect(res.stdout).not.toBe("");
    const out = JSON.parse(res.stdout);
    expect(out.block).toBe(true);
    expect(readFileSync(contractPath, "utf8")).toContain("ic-20260704-clici0");
  });
});
