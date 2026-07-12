import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { IntentContract } from "@vaultcompass/conductor-schema";
import { configPath, loadConfig } from "./config.js";
import {
  contractPath,
  conductorDir,
  isContractFrozen,
  readContract,
} from "./contract-store.js";
import { archivedContractPath, contractsDir, listContracts } from "./history.js";
import { INDEX_FILE, renderIndex } from "./memory-index.js";

export type DoctorFindingStatus = "ok" | "info" | "warn" | "error";
export type DoctorStatus = "ok" | "warn" | "error";

export interface DoctorFinding {
  id: string;
  status: DoctorFindingStatus;
  message: string;
  path?: string;
  detail?: string;
}

export interface DoctorSummary {
  ok: number;
  info: number;
  warn: number;
  error: number;
}

export interface DoctorResult {
  projectRoot: string;
  conductorDir: string;
  packageVersion: string;
  status: DoctorStatus;
  exitCode: number;
  summary: DoctorSummary;
  findings: DoctorFinding[];
}

function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, "../package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function finding(
  status: DoctorFindingStatus,
  id: string,
  message: string,
  path?: string,
  detail?: string,
): DoctorFinding {
  return { id, status, message, path, detail };
}

function summarize(findings: DoctorFinding[]): DoctorSummary {
  return {
    ok: findings.filter((f) => f.status === "ok").length,
    info: findings.filter((f) => f.status === "info").length,
    warn: findings.filter((f) => f.status === "warn").length,
    error: findings.filter((f) => f.status === "error").length,
  };
}

function finalize(
  projectRoot: string,
  findings: DoctorFinding[],
): DoctorResult {
  const summary = summarize(findings);
  const status: DoctorStatus =
    summary.error > 0 ? "error" : summary.warn > 0 ? "warn" : "ok";
  return {
    projectRoot,
    conductorDir: conductorDir(projectRoot),
    packageVersion: packageVersion(),
    status,
    exitCode: summary.error > 0 ? 1 : 0,
    summary,
    findings,
  };
}

function readText(path: string): string | null {
  try {
    if (!existsSync(path) || statSync(path).isDirectory()) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function textMentionsConductor(path: string): boolean {
  return /conductor/i.test(readText(path) ?? "");
}

function textMentionsVaultGuard(path: string): boolean {
  return /vault[- ]guard/i.test(readText(path) ?? "");
}

function commandVersion(command: string): string | null {
  try {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.signal || result.status !== 0) return null;
    return (result.stdout || result.stderr).trim().split("\n")[0] || "available";
  } catch {
    return null;
  }
}

function filesInDir(path: string, extensions: string[]): string[] {
  if (!existsSync(path)) return [];
  try {
    return readdirSync(path)
      .filter((file) => extensions.some((ext) => file.endsWith(ext)))
      .map((file) => join(path, file));
  } catch {
    return [];
  }
}

function activeContractStatus(
  projectRoot: string,
  findings: DoctorFinding[],
): IntentContract | null {
  const activePath = contractPath(projectRoot);
  if (!existsSync(activePath)) {
    findings.push(
      finding(
        "error",
        "active_contract_missing",
        "No active Intent Contract found. Run conductor extract, review it, then conductor freeze.",
        ".conductor/intent-contract.yaml",
      ),
    );
    return null;
  }

  try {
    const contract = readContract(projectRoot);
    if (!contract) return null;
    findings.push(
      finding(
        "ok",
        "active_contract_valid",
        `Active contract ${contract.contract_id} is schema-valid.`,
        ".conductor/intent-contract.yaml",
      ),
    );

    if (isContractFrozen(contract)) {
      findings.push(
        finding(
          "ok",
          "active_contract_frozen",
          `Active contract is frozen and approved by ${contract.approval?.approved_by}.`,
          ".conductor/intent-contract.yaml",
        ),
      );
    } else {
      findings.push(
        finding(
          "error",
          "active_contract_unfrozen",
          "Active contract exists but is not approved/frozen. Run conductor freeze --approved-by <name>.",
          ".conductor/intent-contract.yaml",
        ),
      );
    }
    return contract;
  } catch (error) {
    findings.push(
      finding(
        "error",
        "active_contract_invalid",
        "Active Intent Contract is not valid.",
        ".conductor/intent-contract.yaml",
        error instanceof Error ? error.message : String(error),
      ),
    );
    return null;
  }
}

function configStatus(projectRoot: string, findings: DoctorFinding[]): void {
  const path = configPath(projectRoot);
  if (!existsSync(path)) {
    findings.push(
      finding(
        "error",
        "config_missing",
        "Missing .conductor/config.yaml. Run conductor init.",
        ".conductor/config.yaml",
      ),
    );
    return;
  }

  try {
    parse(readFileSync(path, "utf8"));
    loadConfig(projectRoot);
    findings.push(
      finding("ok", "config_valid", "Config file is readable.", ".conductor/config.yaml"),
    );
  } catch (error) {
    findings.push(
      finding(
        "error",
        "config_invalid",
        "Config file cannot be parsed or merged.",
        ".conductor/config.yaml",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

function archiveStatus(
  projectRoot: string,
  contract: IntentContract | null,
  findings: DoctorFinding[],
): void {
  const dir = contractsDir(projectRoot);
  if (!existsSync(dir)) {
    findings.push(
      finding(
        "warn",
        "contracts_dir_missing",
        "Archived contracts directory is missing. Run conductor init or freeze the active contract again.",
        ".conductor/contracts/",
      ),
    );
    return;
  }

  try {
    const archived = listContracts(projectRoot);
    findings.push(
      finding(
        archived.length > 0 ? "ok" : "info",
        "contracts_archive_readable",
        archived.length > 0
          ? `${archived.length} archived contract(s) found.`
          : "No archived contracts yet.",
        ".conductor/contracts/",
      ),
    );

    if (
      contract &&
      isContractFrozen(contract) &&
      !existsSync(archivedContractPath(projectRoot, contract.contract_id))
    ) {
      findings.push(
        finding(
          "warn",
          "active_contract_not_archived",
          "Frozen active contract is not archived under .conductor/contracts/.",
          `.conductor/contracts/${contract.contract_id}.yaml`,
        ),
      );
    }
  } catch (error) {
    findings.push(
      finding(
        "warn",
        "contracts_archive_invalid",
        "One or more archived contracts could not be read.",
        ".conductor/contracts/",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

function indexStatus(projectRoot: string, findings: DoctorFinding[]): void {
  const path = join(conductorDir(projectRoot), INDEX_FILE);
  if (!existsSync(path)) {
    findings.push(
      finding(
        "warn",
        "index_missing",
        "Missing .conductor/index.md. Run conductor index.",
        ".conductor/index.md",
      ),
    );
    return;
  }

  try {
    const actual = readFileSync(path, "utf8").trim();
    const expected = renderIndex(projectRoot).trim();
    findings.push(
      finding(
        actual === expected ? "ok" : "warn",
        actual === expected ? "index_current" : "index_stale",
        actual === expected
          ? "Generated index is current."
          : "Generated index is stale. Run conductor index.",
        ".conductor/index.md",
      ),
    );
  } catch (error) {
    findings.push(
      finding(
        "warn",
        "index_unreadable",
        "Generated index could not be checked.",
        ".conductor/index.md",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

function resolveGitPreCommitHook(
  projectRoot: string,
): { absolutePath: string; displayPath: string } | null {
  const gitDir = join(projectRoot, ".git");
  if (!existsSync(gitDir)) return null;

  const hooksPathResult = spawnSync("git", ["config", "core.hooksPath"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const hooksPath = hooksPathResult.stdout?.trim();
  if (hooksPath) {
    const hookPath = join(projectRoot, hooksPath, "pre-commit");
    if (existsSync(hookPath)) {
      const display = hooksPath.endsWith("/")
        ? `${hooksPath}pre-commit`
        : `${hooksPath}/pre-commit`;
      return { absolutePath: hookPath, displayPath: display };
    }
  }

  const defaultHook = join(gitDir, "hooks", "pre-commit");
  if (existsSync(defaultHook)) {
    return { absolutePath: defaultHook, displayPath: ".git/hooks/pre-commit" };
  }
  return null;
}

function integrationStatus(projectRoot: string, findings: DoctorFinding[]): void {
  const vaultGuardConfig = [
    ".vault-guard.json",
    ".vault-guard.local.json",
    ".vault-guard.yaml",
    ".vault-guard.yml",
  ].find((path) => existsSync(join(projectRoot, path)));
  const vaultGuardVersion = commandVersion("vault-guard");
  const vaultGuardEvidence: string[] = [];

  if (vaultGuardConfig) {
    vaultGuardEvidence.push(vaultGuardConfig);
    findings.push(
      finding(
        "ok",
        "vault_guard_config_present",
        "vault-guard config is present.",
        vaultGuardConfig,
      ),
    );
  }

  if (vaultGuardVersion) {
    findings.push(
      finding(
        "ok",
        "vault_guard_binary_found",
        `vault-guard binary found: ${vaultGuardVersion}`,
      ),
    );
  }

  const gitDir = join(projectRoot, ".git");
  if (existsSync(gitDir)) {
    const preCommitHook = resolveGitPreCommitHook(projectRoot);
    if (!preCommitHook) {
      findings.push(
        finding(
          "info",
          "git_pre_commit_missing",
          "No Git pre-commit hook detected.",
          ".git/hooks/pre-commit",
        ),
      );
    } else if (textMentionsConductor(preCommitHook.absolutePath)) {
      findings.push(
        finding(
          "ok",
          "git_pre_commit_conductor",
          "Git pre-commit hook mentions Conductor.",
          preCommitHook.displayPath,
        ),
      );
    } else {
      findings.push(
        finding(
          "warn",
          "git_pre_commit_without_conductor",
          "Git pre-commit hook exists but does not mention Conductor.",
          preCommitHook.displayPath,
        ),
      );
    }

    if (
      preCommitHook &&
      textMentionsVaultGuard(preCommitHook.absolutePath)
    ) {
      vaultGuardEvidence.push(preCommitHook.displayPath);
      findings.push(
        finding(
          "ok",
          "git_pre_commit_vault_guard",
          "Git pre-commit hook mentions vault-guard.",
          preCommitHook.displayPath,
        ),
      );
    }
  }

  const workflowFiles = filesInDir(join(projectRoot, ".github", "workflows"), [
    ".yml",
    ".yaml",
  ]);
  if (workflowFiles.length > 0) {
    const hasConductor = workflowFiles.some(textMentionsConductor);
    findings.push(
      finding(
        hasConductor ? "ok" : "info",
        hasConductor ? "github_actions_conductor" : "github_actions_without_conductor",
        hasConductor
          ? "At least one GitHub Actions workflow mentions Conductor."
          : "GitHub Actions workflows exist but none mention Conductor.",
        ".github/workflows/",
      ),
    );

    if (workflowFiles.some(textMentionsVaultGuard)) {
      vaultGuardEvidence.push(".github/workflows/");
      findings.push(
        finding(
          "ok",
          "github_actions_vault_guard",
          "At least one GitHub Actions workflow mentions vault-guard.",
          ".github/workflows/",
        ),
      );
    }
  }

  const codexHooks = join(projectRoot, ".codex", "hooks.json");
  if (existsSync(codexHooks)) {
    findings.push(
      finding(
        textMentionsConductor(codexHooks) ? "ok" : "warn",
        textMentionsConductor(codexHooks)
          ? "codex_hooks_conductor"
          : "codex_hooks_without_conductor",
        textMentionsConductor(codexHooks)
          ? "Codex hooks mention Conductor."
          : "Codex hooks file exists but does not mention Conductor.",
        ".codex/hooks.json",
      ),
    );
  }

  const claudeSettings = join(projectRoot, ".claude", "settings.json");
  if (existsSync(claudeSettings)) {
    findings.push(
      finding(
        textMentionsConductor(claudeSettings) ? "ok" : "warn",
        textMentionsConductor(claudeSettings)
          ? "claude_hooks_conductor"
          : "claude_hooks_without_conductor",
        textMentionsConductor(claudeSettings)
          ? "Claude Code settings mention Conductor."
          : "Claude Code settings exist but do not mention Conductor.",
        ".claude/settings.json",
      ),
    );
  }

  const cursorRules = filesInDir(join(projectRoot, ".cursor", "rules"), [".mdc"]);
  if (cursorRules.length > 0) {
    const hasConductor = cursorRules.some(textMentionsConductor);
    findings.push(
      finding(
        hasConductor ? "ok" : "info",
        hasConductor ? "cursor_rules_conductor" : "cursor_rules_without_conductor",
        hasConductor
          ? "Cursor rules mention Conductor."
          : "Cursor rules exist but none mention Conductor.",
        ".cursor/rules/",
      ),
    );
  }

  if (vaultGuardEvidence.length === 0 && !vaultGuardVersion) {
    findings.push(
      finding(
        "info",
        "vault_guard_not_detected",
        "Optional vault-guard secret scanning is not detected.",
      ),
    );
  } else if (vaultGuardEvidence.length > 0 && !vaultGuardVersion) {
    findings.push(
      finding(
        "warn",
        "vault_guard_binary_missing",
        "vault-guard is referenced by project files, but the binary was not found on PATH.",
        vaultGuardEvidence.join(", "),
      ),
    );
  }
}

export function runDoctor(projectRoot: string): DoctorResult {
  const findings: DoctorFinding[] = [
    finding(
      "ok",
      "package_version",
      `@vaultcompass/conductor-core ${packageVersion()}`,
    ),
  ];

  if (!existsSync(conductorDir(projectRoot))) {
    findings.push(
      finding(
        "error",
        "conductor_not_initialized",
        "No .conductor directory found. Run conductor init.",
        ".conductor/",
      ),
    );
    integrationStatus(projectRoot, findings);
    return finalize(projectRoot, findings);
  }

  findings.push(
    finding("ok", "conductor_dir_found", ".conductor directory exists.", ".conductor/"),
  );

  configStatus(projectRoot, findings);
  const contract = activeContractStatus(projectRoot, findings);
  archiveStatus(projectRoot, contract, findings);
  if (contract) indexStatus(projectRoot, findings);
  integrationStatus(projectRoot, findings);

  return finalize(projectRoot, findings);
}
