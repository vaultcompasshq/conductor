import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, it, expect } from "vitest";
import { validateIntentContract } from "@vaultcompasshq/conductor-schema";

const dir = join(import.meta.dirname, "intent-contracts");

describe("example intent contracts", () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    it(`validates ${file}`, () => {
      const raw = parse(readFileSync(join(dir, file), "utf8"));
      const result = validateIntentContract(raw);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }
});
