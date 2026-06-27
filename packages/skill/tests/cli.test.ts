import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DIST = join(import.meta.dirname, "..", "dist");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(cli: string, args: string[], cwd?: string): RunResult {
  try {
    const stdout = execFileSync("node", [join(DIST, cli), ...args], {
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
  return mkdtempSync(join(tmpdir(), "conductor-cli-"));
}

beforeAll(() => {
  if (!existsSync(join(DIST, "check-cli.js"))) {
    throw new Error("dist not built — run `pnpm build` before tests");
  }
});

// Extract a draft and approve it, returning the project dir.
function frozenProjectWith(text: string): string {
  const dir = tmpProject();
  run("extract-cli.js", ["--project", dir, "--text", text]);
  run("freeze-cli.js", ["--project", dir, "--approved-by", "tester"]);
  return dir;
}

describe("conductor-init", () => {
  it("creates the .conductor skeleton", () => {
    const dir = tmpProject();
    const res = run("init-cli.js", ["--project", dir]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.created).toContain(".conductor/config.yaml");
    expect(existsSync(join(dir, ".conductor", "config.yaml"))).toBe(true);
  });
});

describe("conductor-coach", () => {
  it("flags a vague minimizer prompt", () => {
    const res = run("coach-cli.js", ["just quickly add export like notion and figma"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.needs_coaching).toBe(true);
    expect(out.issues.length).toBeGreaterThan(0);
  });
});

describe("conductor-extract", () => {
  it("--dry-run does not write a contract", () => {
    const dir = tmpProject();
    const res = run("extract-cli.js", [
      "--project", dir,
      "--text", "Add a CSV export button. No new API endpoints. Verify file downloads.",
      "--dry-run",
    ]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.valid).toBe(true);
    expect(out.written_path).toBeNull();
    expect(existsSync(join(dir, ".conductor", "intent-contract.yaml"))).toBe(false);
  });

  it("writes an UNFROZEN draft (no approval)", () => {
    const dir = tmpProject();
    const res = run("extract-cli.js", [
      "--project", dir,
      "--text", "Add a CSV export button. No new API endpoints. Verify file downloads.",
    ]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.written_path).toContain("intent-contract.yaml");
    expect(out.frozen).toBe(false);
    const written = readFileSync(out.written_path, "utf8");
    expect(written).not.toContain("frozen_by: user");
    expect(written).not.toContain("approval:");
  });
});

describe("conductor-freeze (approval gate)", () => {
  it("refuses to freeze non-interactively without an approver", () => {
    const dir = tmpProject();
    run("extract-cli.js", ["--project", dir, "--text", "Add a theme toggle. Verify it persists."]);
    const res = run("freeze-cli.js", ["--project", dir, "--json"]);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/approval requires --approved-by/i);
  });

  it("freezes with an explicit approver and records the approval", () => {
    const dir = tmpProject();
    run("extract-cli.js", ["--project", dir, "--text", "Add a theme toggle. Verify it persists."]);
    const res = run("freeze-cli.js", ["--project", dir, "--approved-by", "alice", "--json"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.frozen).toBe(true);
    expect(out.approved_by).toBe("alice");
    expect(out.method).toBe("explicit-flag");
    const written = readFileSync(join(dir, ".conductor", "intent-contract.yaml"), "utf8");
    expect(written).toContain("frozen_by: user");
    expect(written).toContain("approved_by: alice");
  });

  it("is idempotent on an already-frozen contract", () => {
    const dir = tmpProject();
    run("extract-cli.js", ["--project", dir, "--text", "Add a theme toggle. Verify it persists."]);
    run("freeze-cli.js", ["--project", dir, "--approved-by", "alice"]);
    const res = run("freeze-cli.js", ["--project", dir, "--approved-by", "bob", "--json"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.already_frozen).toBe(true);
    expect(out.approved_by).toBe("alice");
  });
});

describe("conductor-check (enforcement gate)", () => {
  it("blocks with exit 1 when no contract exists", () => {
    const dir = tmpProject();
    const res = run("check-cli.js", ["--project", dir, "--json"]);
    expect(res.code).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("blocked");
    expect(out.contractFound).toBe(false);
  });

  it("blocks with exit 1 when a draft exists but is not approved", () => {
    const dir = tmpProject();
    run("extract-cli.js", [
      "--project", dir,
      "--text", "Add a CSV export button to the report table. Verify file downloads.",
    ]);
    const res = run("check-cli.js", ["--project", dir, "--json"]);
    expect(res.code).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("blocked");
    expect(out.contractFound).toBe(true);
    expect(out.contractFrozen).toBe(false);
  });

  it("passes with exit 0 when frozen and work is aligned", () => {
    const dir = frozenProjectWith(
      "Add a CSV export button to the report table. No new API endpoints. Verify file downloads.",
    );
    const res = run("check-cli.js", [
      "--project", dir,
      "--paths", "src/ReportTable.tsx",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("ok");
  });

  it("blocks with exit 1 on out-of-scope drift", () => {
    const dir = frozenProjectWith(
      "Add a CSV export button to the report table. No new API endpoints. Verify file downloads.",
    );
    const res = run("check-cli.js", [
      "--project", dir,
      "--paths", "src/app/api/export/route.ts",
      "--signals", "added new api endpoint for export",
      "--json",
    ]);
    expect(res.code).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("blocked");
    expect(out.drift.action === "soft_block" || out.drift.action === "hard_block").toBe(true);
  });

  it("--no-require-frozen allows missing contract but still scores drift", () => {
    const dir = tmpProject();
    const res = run("check-cli.js", ["--project", dir, "--no-require-frozen", "--json"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("ok");
  });
});

function frozenProject(): string {
  return frozenProjectWith(
    "Add a theme toggle to the settings page. Verify it persists across reloads.",
  );
}

describe("conductor-correct + conductor-brief", () => {
  it("records a pending correction without promoting", () => {
    const dir = frozenProject();
    const res = run("correct-cli.js", [
      "--project", dir,
      "--wrong", "fetched data in the component",
      "--right", "use a useThemePreference hook",
      "--rule", "Never fetch in components; use a hook",
    ]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.pending).toBe(true);
    expect(out.promoted).toBe(false);
    expect(out.correction.id).toBe("cl-1");
  });

  it("promotes an acknowledged correction into the contract", () => {
    const dir = frozenProject();
    const res = run("correct-cli.js", [
      "--project", dir,
      "--wrong", "fetched in the component", "--right", "used a hook",
      "--rule", "Never fetch in components; use a hook",
      "--acknowledge", "--promote",
    ]);
    const out = JSON.parse(res.stdout);
    expect(out.promoted).toBe(true);
    expect(out.pending).toBe(false);
  });

  it("brief includes acknowledged corrections and intent, as JSON", () => {
    const dir = frozenProject();
    run("correct-cli.js", [
      "--project", dir,
      "--wrong", "did the wrong thing", "--right", "did the right thing",
      "--rule", "Acknowledged lesson here",
      "--acknowledge",
    ]);
    run("correct-cli.js", [
      "--project", dir,
      "--wrong", "another wrong thing", "--right", "another right thing",
      "--rule", "Pending lesson here",
    ]);
    const res = run("brief-cli.js", ["--project", dir, "--json"]);
    expect(res.code).toBe(0);
    const brief = JSON.parse(res.stdout);
    expect(brief.intent).toMatch(/theme toggle/i);
    expect(brief.corrections.map((c: { rule: string }) => c.rule)).toEqual([
      "Acknowledged lesson here",
    ]);
  });

  it("brief renders markdown by default", () => {
    const dir = frozenProject();
    const res = run("brief-cli.js", ["--project", dir]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("# Session brief —");
    expect(res.stdout).toContain("## Intent");
  });
});
