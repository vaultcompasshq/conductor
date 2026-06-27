import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import {
  assertValidIntentContract,
  type IntentContract,
} from "@vaultcompasshq/conductor-schema";

export const CONDUCTOR_DIR = ".conductor";
export const DEFAULT_CONTRACT_FILE = "intent-contract.yaml";

export function conductorDir(projectRoot: string): string {
  return join(projectRoot, CONDUCTOR_DIR);
}

export function contractPath(
  projectRoot: string,
  filename = DEFAULT_CONTRACT_FILE,
): string {
  return join(conductorDir(projectRoot), filename);
}

export function readContract(
  projectRoot: string,
  filename = DEFAULT_CONTRACT_FILE,
): IntentContract | null {
  const path = contractPath(projectRoot, filename);
  if (!existsSync(path)) return null;
  const raw = parse(readFileSync(path, "utf8"));
  return assertValidIntentContract(raw);
}

export function writeContract(
  projectRoot: string,
  contract: IntentContract,
  filename = DEFAULT_CONTRACT_FILE,
): string {
  assertValidIntentContract(contract);
  const dir = conductorDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  writeFileSync(path, stringify(contract), "utf8");
  return path;
}

export interface FreezeApproval {
  /** Identity of the approver — required, so approval is attributable. */
  approvedBy: string;
  method?: "interactive" | "explicit-flag" | "forced";
}

/**
 * Freeze a contract under an explicit, attributable approval. Approval is no
 * longer a bare flag: an `approval` record (who/when/how) is always written, and
 * the gate requires it (see isContractFrozen). Software can't prove a human
 * approved in a headless run, but it can require a deliberate, recorded act
 * rather than a default of the drafting step.
 */
export function freezeContract(
  contract: IntentContract,
  approval: FreezeApproval,
): IntentContract {
  const now = new Date().toISOString();
  return {
    ...contract,
    frozen_at: now,
    frozen_by: "user",
    approval: {
      approved_by: approval.approvedBy,
      approved_at: now,
      method: approval.method ?? "explicit-flag",
    },
  };
}

/**
 * A contract is frozen only when a user approved it with an approval record.
 * `frozen_by: "user"` alone (e.g. hand-set in YAML) is not enough.
 */
export function isContractFrozen(contract: IntentContract): boolean {
  return contract.frozen_by === "user" && contract.approval != null;
}
