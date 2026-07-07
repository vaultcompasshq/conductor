import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const DIST = join(import.meta.dirname, "..", "dist");
const execFileAsync = promisify(execFile);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(cli: string, args: string[], cwd?: string): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [join(DIST, cli), ...args], {
      cwd,
      encoding: "utf8",
      timeout: 30000,
    });
    return { code: 0, stdout: String(stdout), stderr: String(stderr ?? "") };
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === "number" ? e.code : 1,
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
async function frozenProjectWith(text: string): Promise<string> {
  const dir = tmpProject();
  await run("extract-cli.js", ["--project", dir, "--text", text]);
  await run("freeze-cli.js", ["--project", dir, "--approved-by", "tester"]);
  return dir;
}

describe("conductor-init", () => {
  it("creates the .conductor skeleton", async () => {
    const dir = tmpProject();
    const res = await run("init-cli.js", ["--project", dir]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.created).toContain(".conductor/config.yaml");
    expect(existsSync(join(dir, ".conductor", "config.yaml"))).toBe(true);
  });
});

describe("conductor-coach", () => {
  it("flags a vague minimizer prompt", async () => {
    const res = await run("coach-cli.js", ["just quickly add export like notion and figma"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.needs_coaching).toBe(true);
    expect(out.issues.length).toBeGreaterThan(0);
  });
});

describe("conductor-extract", () => {
  it("--dry-run does not write a contract", async () => {
    const dir = tmpProject();
    const res = await run("extract-cli.js", [
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

  it("writes an UNFROZEN draft (no approval)", async () => {
    const dir = tmpProject();
    const res = await run("extract-cli.js", [
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
  it("refuses to freeze non-interactively without an approver", async () => {
    const dir = tmpProject();
    await run("extract-cli.js", ["--project", dir, "--text", "Add a theme toggle. Verify it persists."]);
    const res = await run("freeze-cli.js", ["--project", dir, "--json"]);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/approval requires --approved-by/i);
  });

  it("freezes with an explicit approver and records the approval", async () => {
    const dir = tmpProject();
    await run("extract-cli.js", ["--project", dir, "--text", "Add a theme toggle. Verify it persists."]);
    const res = await run("freeze-cli.js", ["--project", dir, "--approved-by", "alice", "--json"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.frozen).toBe(true);
    expect(out.approved_by).toBe("alice");
    expect(out.method).toBe("explicit-flag");
    const written = readFileSync(join(dir, ".conductor", "intent-contract.yaml"), "utf8");
    const contractId = written.match(/contract_id: (ic-[a-z0-9-]+)/)?.[1];
    expect(written).toContain("frozen_by: user");
    expect(written).toContain("approved_by: alice");
    expect(existsSync(join(dir, ".conductor", "index.md"))).toBe(true);
    expect(existsSync(join(dir, ".conductor", "contracts", `${contractId}.yaml`))).toBe(true);
  });

  it("is idempotent on an already-frozen contract", async () => {
    const dir = tmpProject();
    await run("extract-cli.js", ["--project", dir, "--text", "Add a theme toggle. Verify it persists."]);
    await run("freeze-cli.js", ["--project", dir, "--approved-by", "alice"]);
    const res = await run("freeze-cli.js", ["--project", dir, "--approved-by", "bob", "--json"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.already_frozen).toBe(true);
    expect(out.approved_by).toBe("alice");
  });
});

describe("conductor-check (enforcement gate)", () => {
  it("blocks with exit 1 when no contract exists", async () => {
    const dir = tmpProject();
    const res = await run("check-cli.js", ["--project", dir, "--json"]);
    expect(res.code).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("blocked");
    expect(out.contractFound).toBe(false);
  });

  it("blocks with exit 1 when a draft exists but is not approved", async () => {
    const dir = tmpProject();
    await run("extract-cli.js", [
      "--project", dir,
      "--text", "Add a CSV export button to the report table. Verify file downloads.",
    ]);
    const res = await run("check-cli.js", ["--project", dir, "--json"]);
    expect(res.code).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("blocked");
    expect(out.contractFound).toBe(true);
    expect(out.contractFrozen).toBe(false);
  });

  it("passes with exit 0 when frozen and work is aligned", async () => {
    const dir = await frozenProjectWith(
      "Add a CSV export button to the report table. No new API endpoints. Verify file downloads.",
    );
    const res = await run("check-cli.js", [
      "--project", dir,
      "--paths", "src/ReportTable.tsx",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("ok");
  });

  it("blocks with exit 1 on out-of-scope drift", async () => {
    const dir = await frozenProjectWith(
      "Add a CSV export button to the report table. No new API endpoints. Verify file downloads.",
    );
    const res = await run("check-cli.js", [
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

  it("--no-require-frozen allows missing contract but still scores drift", async () => {
    const dir = tmpProject();
    const res = await run("check-cli.js", ["--project", dir, "--no-require-frozen", "--json"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("ok");
  });

  it("surfaces previous-contract drift as informational JSON", async () => {
    const dir = tmpProject();
    await run("extract-cli.js", [
      "--project", dir,
      "--text", "Add a CSV export button. No new API endpoints. Verify file downloads.",
    ]);
    await run("freeze-cli.js", ["--project", dir, "--approved-by", "tester"]);
    const first = readFileSync(join(dir, ".conductor", "intent-contract.yaml"), "utf8");
    const firstId = first.match(/contract_id: (ic-[a-z0-9-]+)/)?.[1]!;

    await run("extract-cli.js", [
      "--project", dir,
      "--text", "Add CSV export through a new API endpoint. Verify file downloads.",
    ]);
    await run("freeze-cli.js", ["--project", dir, "--approved-by", "tester"]);

    const res = await run("check-cli.js", [
      "--project", dir,
      "--paths", "src/app/api/export/route.ts",
      "--signals", "added new api endpoint for export",
      "--previous-contract", firstId,
      "--json",
    ]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("ok");
    expect(out.crossSessionDrift.previous.action).toBe("soft_block");
  });
});

describe("conductor-doctor", () => {
  it("reports missing setup as an error in JSON", async () => {
    const dir = tmpProject();
    const res = await run("doctor-cli.js", ["--project", dir, "--json"]);
    expect(res.code).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("error");
    expect(out.findings.some((f: { id: string }) => f.id === "conductor_not_initialized")).toBe(true);
  });

  it("prints readable diagnostics for a healthy frozen project", async () => {
    const dir = tmpProject();
    await run("init-cli.js", ["--project", dir]);
    await run("extract-cli.js", [
      "--project", dir,
      "--text", "Update README usage documentation. Do not change source code. Verify the README includes the new note.",
    ]);
    await run("freeze-cli.js", ["--project", dir, "--approved-by", "tester"]);
    const res = await run("doctor-cli.js", ["--project", dir]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Conductor doctor: ok");
    expect(res.stdout).toContain("Active contract is frozen");
  });
});

describe("conductor-report", () => {
  it("renders a markdown report for aligned work", async () => {
    const dir = await frozenProjectWith(
      "Update README usage documentation. Do not change source code or package metadata. Verify README includes one usage example.",
    );
    const res = await run("report-cli.js", [
      "--project", dir,
      "--paths", "README.md",
      "--signals", "README documentation update",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("# Conductor report");
    expect(res.stdout).toContain("Status: ok");
    expect(res.stdout).toContain("Acceptance criteria");
  });

  it("returns JSON and exit 1 for blocking drift", async () => {
    const dir = await frozenProjectWith(
      "Update README usage documentation. Do not change source code or package metadata. Verify README includes one usage example.",
    );
    const res = await run("report-cli.js", [
      "--project", dir,
      "--paths", "package.json",
      "--json",
    ]);
    expect(res.code).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("blocked");
    expect(out.gate.drift.action).toBe("soft_block");
  });
});

describe("conductor-rules", () => {
  it("audits project rule files", async () => {
    const dir = tmpProject();
    await run("init-cli.js", ["--project", dir]);
    writeFileSync(
      join(dir, "AGENTS.md"),
      "## Rules\n- Never commit secrets\n- Prefer no production deploys\n",
      "utf8",
    );
    writeFileSync(join(dir, "CLAUDE.md"), "## Rules\n- NEVER commit secrets\n", "utf8");

    const res = await run("rules-cli.js", ["audit", "--project", dir, "--json"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("warn");
    expect(out.summary.duplicates).toBe(1);
  });
});

function frozenProject(): Promise<string> {
  return frozenProjectWith(
    "Add a theme toggle to the settings page. Verify it persists across reloads.",
  );
}

describe("conductor-correct + conductor-brief", () => {
  it("records a pending correction without promoting", async () => {
    const dir = await frozenProject();
    const res = await run("correct-cli.js", [
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

  it("promotes an acknowledged correction into the contract", async () => {
    const dir = await frozenProject();
    const res = await run("correct-cli.js", [
      "--project", dir,
      "--wrong", "fetched in the component", "--right", "used a hook",
      "--rule", "Never fetch in components; use a hook",
      "--acknowledge", "--promote",
    ]);
    const out = JSON.parse(res.stdout);
    expect(out.promoted).toBe(true);
    expect(out.pending).toBe(false);
  });

  it("brief includes acknowledged corrections and intent, as JSON", async () => {
    const dir = await frozenProject();
    await run("correct-cli.js", [
      "--project", dir,
      "--wrong", "did the wrong thing", "--right", "did the right thing",
      "--rule", "Acknowledged lesson here",
      "--acknowledge",
    ]);
    await run("correct-cli.js", [
      "--project", dir,
      "--wrong", "another wrong thing", "--right", "another right thing",
      "--rule", "Pending lesson here",
    ]);
    const res = await run("brief-cli.js", ["--project", dir, "--json"]);
    expect(res.code).toBe(0);
    const brief = JSON.parse(res.stdout);
    expect(brief.intent).toMatch(/theme toggle/i);
    expect(brief.corrections.map((c: { rule: string }) => c.rule)).toEqual([
      "Acknowledged lesson here",
    ]);
  });

  it("brief renders markdown by default", async () => {
    const dir = await frozenProject();
    const res = await run("brief-cli.js", ["--project", dir]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("# Session brief —");
    expect(res.stdout).toContain("## Intent");
  });
});

describe("conductor-index, conductor-resume, conductor-pivot", () => {
  it("renders and writes the generated index", async () => {
    const dir = await frozenProject();
    const render = await run("index-cli.js", ["--project", dir, "--json"]);
    expect(render.code).toBe(0);
    const out = JSON.parse(render.stdout);
    expect(out.index_markdown).toContain("## Active");

    const write = await run("index-cli.js", ["--project", dir, "--write", "--json"]);
    expect(write.code).toBe(0);
    expect(JSON.parse(write.stdout).written_path).toContain(".conductor/index.md");
  });

  it("prints a resume brief for the active contract", async () => {
    const dir = await frozenProject();
    const res = await run("resume-cli.js", ["--project", dir]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("# Session brief");
    expect(res.stdout).toContain("theme toggle");
  });

  it("records a pivot and regenerates the index", async () => {
    const dir = await frozenProject();
    const res = await run("pivot-cli.js", [
      "--project", dir,
      "--change", "Also support keyboard shortcut",
      "--reason", "User clarified accessibility requirement",
      "--add-scope", "Keyboard shortcut toggles theme",
      "--add-out-of-scope", "Theme marketplace",
      "--acknowledge",
    ]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.pending).toBe(false);
    expect(out.pivot.acknowledged_by).toBe("user");
    const written = readFileSync(join(dir, ".conductor", "intent-contract.yaml"), "utf8");
    expect(written).toContain("Keyboard shortcut toggles theme");
    expect(readFileSync(join(dir, ".conductor", "index.md"), "utf8")).toContain(
      "Also support keyboard shortcut",
    );
  });
});
