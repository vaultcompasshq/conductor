import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const CONDUCTOR_HOOK_MARKER = "conductor-managed-pre-commit";

export interface InstallHookOptions {
  /** Also run vault-guard secret scanning in the generated hook. */
  withVaultGuard?: boolean;
  /** Overwrite an existing pre-commit hook that Conductor did not write. */
  force?: boolean;
  /**
   * When `core.hooksPath` points outside this repository (e.g. a machine-wide
   * `~/.git-hooks`), set local `core.hooksPath=.git/hooks` and install there
   * instead of overwriting the shared directory. Default: true.
   */
  preferLocalGitHooks?: boolean;
}

export interface InstallHookResult {
  installed: boolean;
  path: string;
  reason?: string;
  withVaultGuard: boolean;
  /** True when install rewrote local core.hooksPath to `.git/hooks`. */
  localizedHooksPath?: boolean;
}

export interface ResolvedHooksDir {
  /** Absolute directory where Git will look for hooks. */
  hooksDir: string;
  /** Display path for the pre-commit hook (repo-relative when possible). */
  displayHookPath: string;
  /** Raw `core.hooksPath` config value, or null if unset. */
  hooksPathConfig: string | null;
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Resolve the directory Git uses for hooks in this repo, matching doctor.
 * Only consults `core.hooksPath` when `projectRoot` is a usable git work tree
 * (avoids inheriting a machine-wide hooksPath into bare test fixtures).
 */
export function resolveGitHooksDir(projectRoot: string): ResolvedHooksDir {
  const defaultDir = join(projectRoot, ".git", "hooks");
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (inside.status !== 0) {
    return {
      hooksDir: defaultDir,
      displayHookPath: ".git/hooks/pre-commit",
      hooksPathConfig: null,
    };
  }

  const result = spawnSync("git", ["config", "--get", "core.hooksPath"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const hooksPath = result.stdout?.trim() || "";
  if (!hooksPath) {
    return {
      hooksDir: defaultDir,
      displayHookPath: ".git/hooks/pre-commit",
      hooksPathConfig: null,
    };
  }

  const hooksDir = isAbsolute(hooksPath)
    ? hooksPath
    : resolve(projectRoot, hooksPath);
  const display =
    hooksPath.endsWith("/") || hooksPath.endsWith(sep)
      ? `${hooksPath}pre-commit`
      : `${hooksPath}/pre-commit`;

  return {
    hooksDir,
    displayHookPath: display.replace(/\\/g, "/"),
    hooksPathConfig: hooksPath,
  };
}

/**
 * Render a self-contained pre-commit hook. It depends only on the installed
 * CLIs (conductor-check, optionally vault-guard) being resolvable on PATH or via
 * npx, never on the Conductor repo's integrations/ directory — which does not
 * ship in the published npm packages.
 */
export function renderPreCommitHook(withVaultGuard = false): string {
  const lines = [
    "#!/usr/bin/env bash",
    `# ${CONDUCTOR_HOOK_MARKER}`,
    "# Installed by: conductor hook install",
    "# Blocks the commit when no frozen Intent Contract exists or staged changes",
    "# drift past a blocking threshold. Bypass one commit with: git commit --no-verify",
    "",
    "set -euo pipefail",
    "",
    "run_conductor() {",
    '  if command -v conductor-check >/dev/null 2>&1; then',
    '    conductor-check --project . --staged',
    '  elif command -v conductor >/dev/null 2>&1; then',
    '    conductor check --project . --staged',
    '  elif command -v npx >/dev/null 2>&1; then',
    '    npx --no-install conductor check --project . --staged',
    "  else",
    '    echo "conductor not found on PATH; skipping intent gate." >&2',
    "    return 0",
    "  fi",
    "}",
    "",
    "status=0",
    "run_conductor || status=$?",
    "",
  ];

  if (withVaultGuard) {
    lines.push(
      "run_vault_guard() {",
      '  if command -v vault-guard >/dev/null 2>&1; then',
      '    vault-guard scan --staged',
      '  elif command -v npx >/dev/null 2>&1; then',
      '    npx --no-install vault-guard scan --staged',
      "  else",
      '    echo "vault-guard not found on PATH; skipping secret scan." >&2',
      "    return 0",
      "  fi",
      "}",
      "",
      "run_vault_guard || status=$?",
      "",
    );
  }

  lines.push('exit "$status"', "");
  return lines.join("\n");
}

/**
 * Install the Conductor pre-commit hook into the repository at projectRoot.
 * Refuses to clobber a foreign (non-Conductor) hook unless force is set.
 *
 * When a machine-wide `core.hooksPath` points outside this repo, defaults to
 * setting local `core.hooksPath=.git/hooks` so install does not overwrite a
 * shared hooks directory (common with global vault-guard installs).
 */
export function installPreCommitHook(
  projectRoot: string,
  options: InstallHookOptions = {},
): InstallHookResult {
  const withVaultGuard = options.withVaultGuard ?? false;
  const preferLocal = options.preferLocalGitHooks ?? true;
  const gitDir = join(projectRoot, ".git");

  if (!existsSync(gitDir)) {
    return {
      installed: false,
      path: join(gitDir, "hooks", "pre-commit"),
      reason: "not_a_git_repo",
      withVaultGuard,
    };
  }

  let localizedHooksPath = false;
  const insideWorkTree = spawnSync(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    { cwd: projectRoot, encoding: "utf8" },
  );
  const usableGit = insideWorkTree.status === 0;

  let resolved: ResolvedHooksDir = usableGit
    ? resolveGitHooksDir(projectRoot)
    : {
        hooksDir: join(gitDir, "hooks"),
        displayHookPath: ".git/hooks/pre-commit",
        hooksPathConfig: null,
      };

  if (
    usableGit &&
    preferLocal &&
    resolved.hooksPathConfig &&
    !isPathInside(projectRoot, resolved.hooksDir)
  ) {
    const localize = spawnSync(
      "git",
      ["config", "core.hooksPath", ".git/hooks"],
      { cwd: projectRoot, encoding: "utf8" },
    );
    if (localize.status !== 0) {
      return {
        installed: false,
        path: join(resolved.hooksDir, "pre-commit"),
        reason: "hooks_path_localize_failed",
        withVaultGuard,
      };
    }
    localizedHooksPath = true;
    resolved = {
      hooksDir: join(gitDir, "hooks"),
      displayHookPath: ".git/hooks/pre-commit",
      hooksPathConfig: ".git/hooks",
    };
  }

  const hookPath = join(resolved.hooksDir, "pre-commit");

  if (existsSync(hookPath) && !options.force) {
    const existing = readFileSync(hookPath, "utf8");
    if (!existing.includes(CONDUCTOR_HOOK_MARKER)) {
      return {
        installed: false,
        path: hookPath,
        reason: "existing_hook_not_managed",
        withVaultGuard,
        localizedHooksPath,
      };
    }
  }

  mkdirSync(resolved.hooksDir, { recursive: true });
  writeFileSync(hookPath, renderPreCommitHook(withVaultGuard), "utf8");
  chmodSync(hookPath, 0o755);

  return {
    installed: true,
    path: hookPath,
    withVaultGuard,
    localizedHooksPath,
  };
}
