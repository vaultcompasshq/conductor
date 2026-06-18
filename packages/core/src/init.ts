import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { conductorDir } from "./contract-store.js";
import { defaultConfigYaml, configPath } from "./config.js";

const INDEX_TEMPLATE = `# Conductor Index

## Active
- No frozen contract yet — run intent-contract skill or conductor-extract --freeze

## Constraints
- Loaded from AGENTS.md, CLAUDE.md, GEMINI.md, .cursor/rules when present

## Recent pivots
- none
`;

export interface InitResult {
  conductor_dir: string;
  created: string[];
  skipped: string[];
}

export function initConductor(projectRoot: string): InitResult {
  const dir = conductorDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  const created: string[] = [];
  const skipped: string[] = [];

  const configFile = configPath(projectRoot);
  if (!existsSync(configFile)) {
    writeFileSync(configFile, `${defaultConfigYaml()}\n`, "utf8");
    created.push(".conductor/config.yaml");
  } else {
    skipped.push(".conductor/config.yaml");
  }

  const indexPath = join(dir, "index.md");
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, INDEX_TEMPLATE, "utf8");
    created.push(".conductor/index.md");
  } else {
    skipped.push(".conductor/index.md");
  }

  const contractsDir = join(dir, "contracts");
  if (!existsSync(contractsDir)) {
    mkdirSync(contractsDir, { recursive: true });
    created.push(".conductor/contracts/");
  } else {
    skipped.push(".conductor/contracts/");
  }

  return { conductor_dir: dir, created, skipped };
}
