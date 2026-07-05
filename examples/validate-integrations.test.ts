import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function readJson(path: string) {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
}

function readText(path: string) {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("integration hook samples", () => {
  it("ships valid Codex hooks JSON", () => {
    const hooks = readJson("integrations/codex/hooks.json.sample");
    expect(hooks.hooks.SessionStart[0].hooks[0].command).toContain(
      "conductor-session-start.sh",
    );
    expect(hooks.hooks.Stop[0].hooks[0].command).toContain(
      "conductor-stop-check.sh",
    );
  });

  it("ships valid Claude Code settings JSON", () => {
    const settings = readJson("integrations/claude-code/settings.sample.json");
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain(
      "${CLAUDE_PROJECT_DIR}",
    );
    expect(settings.hooks.Stop[0].hooks[0].timeout).toBe(60);
  });

  it("keeps hook shell scripts syntactically valid", () => {
    for (const script of [
      "integrations/hooks/conductor-lib.sh",
      "integrations/hooks/conductor-session-start.sh",
      "integrations/hooks/conductor-stop-check.sh",
    ]) {
      expect(() =>
        execFileSync("bash", ["-n", join(ROOT, script)], {
          encoding: "utf8",
        }),
      ).not.toThrow();
    }
  });

  it("ships a GitHub Actions drift CI sample", () => {
    const workflow = readText(
      "integrations/github-actions/conductor-drift-ci.yml.sample",
    );
    expect(workflow).toContain("@vaultcompasshq/conductor-cli@0.3.0-beta.0");
    expect(workflow).toContain("drift");
    expect(workflow).toContain("--ci");
    expect(workflow).toContain(".conductor/intent-contract.yaml");
  });
});
