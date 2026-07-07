import { spawnSync } from "node:child_process";

export interface VaultGuardScanSummary {
  available: boolean;
  skipped?: string;
  secrets: number;
  files: number;
  exitCode: number;
  version?: string;
}

function commandVersion(command: string): string | null {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function parseJson(stdout: string): { summary?: { secrets?: number; files?: number } } | null {
  try {
    return JSON.parse(stdout) as { summary?: { secrets?: number; files?: number } };
  } catch {
    return null;
  }
}

/**
 * Optional vault-guard staged scan for handoff reports. Returns a skipped summary
 * when vault-guard is not installed; never throws.
 */
export function scanVaultGuardStaged(projectRoot: string): VaultGuardScanSummary {
  const version = commandVersion("vault-guard");
  if (!version) {
    return {
      available: false,
      skipped: "vault-guard not found on PATH",
      secrets: 0,
      files: 0,
      exitCode: 0,
    };
  }

  const result = spawnSync("vault-guard", ["scan", "--staged", "--format", "json"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = parseJson(result.stdout);
  return {
    available: true,
    version,
    secrets: parsed?.summary?.secrets ?? 0,
    files: parsed?.summary?.files ?? 0,
    exitCode: typeof result.status === "number" ? result.status : 1,
  };
}
