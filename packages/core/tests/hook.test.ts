import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
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

function realGitProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "conductor-hook-git-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Hook Test"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "hook@example.invalid"], {
    cwd: dir,
  });
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
    expect(readFileSync(result.path, "utf8")).toContain(
      "vault-guard scan --staged",
    );
  });

  it("localizes machine-wide core.hooksPath to .git/hooks by default", () => {
    const dir = realGitProject();
    const shared = mkdtempSync(join(tmpdir(), "shared-hooks-"));
    writeFileSync(join(shared, "pre-commit"), "#!/bin/sh\necho shared\n", "utf8");
    execFileSync("git", ["config", "core.hooksPath", shared], { cwd: dir });

    const result = installPreCommitHook(dir);
    expect(result.installed).toBe(true);
    expect(result.localizedHooksPath).toBe(true);
    expect(result.path).toBe(join(dir, ".git", "hooks", "pre-commit"));
    expect(existsSync(join(dir, ".git", "hooks", "pre-commit"))).toBe(true);
    expect(readFileSync(join(shared, "pre-commit"), "utf8")).toContain("echo shared");

    const localPath = execFileSync("git", ["config", "--get", "core.hooksPath"], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
    expect(localPath).toBe(".git/hooks");
  });

  it("installs into an in-repo custom hooksPath without localizing", () => {
    const dir = realGitProject();
    mkdirSync(join(dir, ".githooks"), { recursive: true });
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: dir });

    const result = installPreCommitHook(dir);
    expect(result.installed).toBe(true);
    expect(result.localizedHooksPath).toBeFalsy();
    expect(existsSync(join(dir, ".githooks", "pre-commit"))).toBe(true);
    expect(readFileSync(join(dir, ".githooks", "pre-commit"), "utf8")).toContain(
      CONDUCTOR_HOOK_MARKER,
    );
  });
});
