import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONDUCTOR_HOOK_MARKER = "conductor-managed-pre-commit";

export interface InstallHookOptions {
  /** Also run vault-guard secret scanning in the generated hook. */
  withVaultGuard?: boolean;
  /** Overwrite an existing pre-commit hook that Conductor did not write. */
  force?: boolean;
}

export interface InstallHookResult {
  installed: boolean;
  path: string;
  reason?: string;
  withVaultGuard: boolean;
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
 */
export function installPreCommitHook(
  projectRoot: string,
  options: InstallHookOptions = {},
): InstallHookResult {
  const withVaultGuard = options.withVaultGuard ?? false;
  const hooksDir = join(projectRoot, ".git", "hooks");
  const hookPath = join(hooksDir, "pre-commit");
  const gitDir = join(projectRoot, ".git");

  if (!existsSync(gitDir)) {
    return {
      installed: false,
      path: hookPath,
      reason: "not_a_git_repo",
      withVaultGuard,
    };
  }

  if (existsSync(hookPath) && !options.force) {
    const existing = readFileSync(hookPath, "utf8");
    if (!existing.includes(CONDUCTOR_HOOK_MARKER)) {
      return {
        installed: false,
        path: hookPath,
        reason: "existing_hook_not_managed",
        withVaultGuard,
      };
    }
  }

  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(hookPath, renderPreCommitHook(withVaultGuard), "utf8");
  chmodSync(hookPath, 0o755);

  return { installed: true, path: hookPath, withVaultGuard };
}
