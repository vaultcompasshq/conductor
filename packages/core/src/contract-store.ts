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

export function freezeContract(
  contract: IntentContract,
  by: IntentContract["frozen_by"] = "user",
): IntentContract {
  return {
    ...contract,
    frozen_at: new Date().toISOString(),
    frozen_by: by,
  };
}

export function isContractFrozen(contract: IntentContract): boolean {
  return contract.frozen_by === "user" || contract.frozen_by === "conductor";
}
