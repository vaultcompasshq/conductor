import { Ajv } from "ajv";
import type { ErrorObject } from "ajv";
import type { FormatsPlugin } from "ajv-formats";
import addFormatsImport from "ajv-formats";
import schema from "./intent-contract.schema.json" with { type: "json" };
import type { IntentContract, ValidationResult } from "./types.js";

const addFormats = addFormatsImport as unknown as FormatsPlugin;

const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
addFormats(ajv);

const validate = ajv.compile(schema);

export function validateIntentContract(data: unknown): ValidationResult {
  const valid = validate(data);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validate.errors ?? []).map(
    (e: ErrorObject) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`.trim(),
  );
  return { valid: false, errors };
}

export function assertValidIntentContract(data: unknown): IntentContract {
  const result = validateIntentContract(data);
  if (!result.valid) {
    throw new Error(`Invalid intent contract:\n${result.errors.join("\n")}`);
  }
  return data as IntentContract;
}
