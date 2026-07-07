import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import {
  DEFAULT_CONDUCTOR_CONFIG,
  mergeConductorConfig,
  type ConductorConfig,
} from "./config-types.js";
import { conductorDir } from "./contract-store.js";

export const CONFIG_FILE = "config.yaml";

export function configPath(projectRoot: string): string {
  return join(conductorDir(projectRoot), CONFIG_FILE);
}

export function loadConfig(projectRoot: string): ConductorConfig {
  const path = configPath(projectRoot);
  if (!existsSync(path)) return { ...DEFAULT_CONDUCTOR_CONFIG };
  const raw = parse(readFileSync(path, "utf8")) as Partial<ConductorConfig>;
  return mergeConductorConfig(raw);
}

export function defaultConfigYaml(): string {
  return stringify(DEFAULT_CONDUCTOR_CONFIG).trim();
}
