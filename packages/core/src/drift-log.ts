import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DriftAction } from "./rubric.js";
import { conductorDir } from "./contract-store.js";

export interface DriftLogEvent {
  timestamp: string;
  contract_id: string;
  overall: number;
  action: DriftAction;
  findings: string[];
  changed_paths?: string[];
  user_message?: string;
}

export function driftLogPath(projectRoot: string): string {
  return join(conductorDir(projectRoot), "drift-log.jsonl");
}

export function appendDriftEvent(
  projectRoot: string,
  event: Omit<DriftLogEvent, "timestamp">,
): void {
  const dir = conductorDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    ...event,
    timestamp: new Date().toISOString(),
  });
  appendFileSync(driftLogPath(projectRoot), `${line}\n`, "utf8");
}
