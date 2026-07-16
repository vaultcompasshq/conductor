import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    expect(res.stdout.trim()).toBe("1.0.8");
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

  it("runs doctor through the unified binary", () => {
    const dir = tmpProject();
    const res = run(["doctor", "--project", dir, "--json"]);
    expect(res.code).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("error");
    expect(out.findings.some((f: { id: string }) => f.id === "conductor_not_initialized")).toBe(true);
  });

  it("runs report through the unified binary", () => {
    const dir = tmpProject();
    run([
      "extract",
      "--project",
      dir,
      "--text",
      "Update README usage docs. Do not change source code or package metadata. Verify README includes one usage example.",
    ]);
    run(["freeze", "--project", dir, "--approved-by", "tester"]);

    const res = run([
      "report",
      "--project",
      dir,
      "--paths",
      "README.md",
      "--signals",
      "README documentation update",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("ok");
    expect(out.contract.approved_by).toBe("tester");
  });

  it("installs the pre-commit hook through the unified binary", () => {
    const dir = tmpProject();
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    const res = run(["hook", "install", "--project", dir, "--with-vault-guard"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.installed).toBe(true);
    const hook = readFileSync(join(dir, ".git", "hooks", "pre-commit"), "utf8");
    expect(hook).toContain("conductor-managed-pre-commit");
    expect(hook).toContain("vault-guard scan --staged");
  });

  it("runs rules audit through the unified binary", () => {
    const dir = tmpProject();
    writeFileSync(join(dir, "AGENTS.md"), "## Rules\n- Never commit secrets\n", "utf8");
    writeFileSync(join(dir, "CLAUDE.md"), "## Rules\n- NEVER commit secrets\n", "utf8");

    const res = run(["rules", "audit", "--project", dir, "--json"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.summary.duplicates).toBe(1);
  });

  it("runs import-spec through the unified binary", () => {
    const dir = tmpProject();
    const specDir = join(dir, ".kiro", "specs", "theme-toggle");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, "requirements.md"),
      "WHEN a user toggles theme, THE SYSTEM SHALL persist the preference.\n",
      "utf8",
    );
    writeFileSync(join(specDir, "design.md"), "Use existing settings storage.\n", "utf8");
    writeFileSync(join(specDir, "tasks.md"), "- [ ] Add theme toggle\n", "utf8");

    const res = run([
      "import-spec",
      "--project",
      dir,
      "--from",
      "kiro",
      "--spec-dir",
      ".kiro/specs/theme-toggle",
    ]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.format).toBe("kiro");
    expect(out.written_path).toContain("intent-contract.yaml");
    expect(readFileSync(out.written_path, "utf8")).not.toContain("approval:");
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
