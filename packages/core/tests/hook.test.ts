import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CONDUCTOR_HOOK_MARKER,
  installPreCommitHook,
  renderPreCommitHook,
} from "../src/hook.js";

function gitProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "conductor-hook-"));
  mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
  return dir;
}

describe("renderPreCommitHook", () => {
  it("is a self-contained script with the managed marker", () => {
    const script = renderPreCommitHook();
    expect(script.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(script).toContain(CONDUCTOR_HOOK_MARKER);
    expect(script).toContain("conductor check --project . --staged");
    expect(script).not.toContain("integrations/");
  });

  it("includes vault-guard only when requested", () => {
    expect(renderPreCommitHook(false)).not.toContain("vault-guard");
    expect(renderPreCommitHook(true)).toContain("vault-guard scan --staged");
  });
});

describe("installPreCommitHook", () => {
  it("writes an executable hook into .git/hooks", () => {
    const dir = gitProject();
    const result = installPreCommitHook(dir);
    expect(result.installed).toBe(true);
    const contents = readFileSync(result.path, "utf8");
    expect(contents).toContain(CONDUCTOR_HOOK_MARKER);
    const mode = statSync(result.path).mode & 0o111;
    expect(mode).not.toBe(0);
  });

  it("refuses when not a git repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-nogit-"));
    const result = installPreCommitHook(dir);
    expect(result.installed).toBe(false);
    expect(result.reason).toBe("not_a_git_repo");
  });

  it("does not clobber a foreign hook without --force", () => {
    const dir = gitProject();
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\necho custom\n", "utf8");
    const result = installPreCommitHook(dir);
    expect(result.installed).toBe(false);
    expect(result.reason).toBe("existing_hook_not_managed");
    expect(readFileSync(hookPath, "utf8")).toContain("echo custom");
  });

  it("overwrites a foreign hook with force", () => {
    const dir = gitProject();
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\necho custom\n", "utf8");
    const result = installPreCommitHook(dir, { force: true });
    expect(result.installed).toBe(true);
    expect(readFileSync(hookPath, "utf8")).toContain(CONDUCTOR_HOOK_MARKER);
  });

  it("re-installs its own managed hook idempotently", () => {
    const dir = gitProject();
    installPreCommitHook(dir);
    const result = installPreCommitHook(dir, { withVaultGuard: true });
    expect(result.installed).toBe(true);
    expect(readFileSync(result.path, "utf8")).toContain("vault-guard scan --staged");
  });
});
