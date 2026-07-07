import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { parse, stringify } from "yaml";
import {
  assertValidIntentContract,
  type IntentContract,
} from "@vaultcompass/conductor-schema";

const CONDUCTOR_DIR = ".conductor";
const CONTRACTS_DIR = "contracts";

export interface ArchivedContractSummary {
  contract_id: string;
  original_ask: string;
  frozen_at: string;
  archived_path: string;
  updated_at: string;
  approved_by?: string;
}

export function contractsDir(projectRoot: string): string {
  return join(projectRoot, CONDUCTOR_DIR, CONTRACTS_DIR);
}

export function archivedContractPath(
  projectRoot: string,
  contractId: string,
): string {
  return join(contractsDir(projectRoot), `${contractId}.yaml`);
}

export function archiveContract(
  projectRoot: string,
  contract: IntentContract,
): string {
  assertValidIntentContract(contract);
  const dir = contractsDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  const path = archivedContractPath(projectRoot, contract.contract_id);
  writeFileSync(path, stringify(contract), "utf8");
  return path;
}

export function readArchivedContract(
  projectRoot: string,
  contractId: string,
): IntentContract | null {
  const path = archivedContractPath(projectRoot, contractId);
  if (!existsSync(path)) return null;
  const raw = parse(readFileSync(path, "utf8"));
  return assertValidIntentContract(raw);
}

export function listContracts(projectRoot: string): ArchivedContractSummary[] {
  const dir = contractsDir(projectRoot);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .map((file) => {
      const path = join(dir, file);
      const raw = parse(readFileSync(path, "utf8"));
      const contract = assertValidIntentContract(raw);
      const stat = statSync(path);
      return {
        contract_id: contract.contract_id,
        original_ask: contract.original_ask,
        frozen_at: contract.frozen_at,
        archived_path: join(CONDUCTOR_DIR, CONTRACTS_DIR, basename(path)),
        updated_at: stat.mtime.toISOString(),
        approved_by: contract.approval?.approved_by,
      };
    })
    .sort((a, b) => {
      const frozenDelta =
        Date.parse(b.frozen_at) - Date.parse(a.frozen_at);
      if (frozenDelta !== 0) return frozenDelta;
      return Date.parse(b.updated_at) - Date.parse(a.updated_at);
    });
}
