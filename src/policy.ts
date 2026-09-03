// The one policy file.
//
// Gates are keyed by the ROLE they fill (dependencies, secrets, intent) and
// name the product filling it in a `product` field. That indirection is
// worth the extra line: a product rename, or swapping one gate for another,
// becomes a one-line edit instead of a rename of the key a repository wrote
// its CI around, and a fourth role can arrive without the schema moving.
//
// Two rules this file exists to enforce, both of them decisions rather than
// mechanics:
//
//  1. THERE IS NO SHARED SEVERITY THRESHOLD. Two of the three products
//     happen to share a four-level scale; the third scores a weighted
//     rubric from 0 to 100 and has no per-finding severity at all. A single
//     `failOn` at the top of the file would read as one decision and mean
//     three different things, so a top-level `failOn` is rejected outright
//     rather than silently ignored. Each gate keeps its own threshold in
//     its own passthrough block, spelled the way that gate spells it.
//
//  2. THE PASSTHROUGH IS ACTUALLY A PASSTHROUGH. `options` keys are the
//     gate's own long-flag names with the dashes stripped, and this file
//     never maps, renames, or interprets one. That is what keeps the
//     umbrella from growing a second, drifting copy of three CLIs, and it
//     is why a gate gains a flag without this package needing a release.
//     The only keys rejected are the handful the umbrella itself passes,
//     because two writers of the same flag is a fight the user would have
//     to debug from a stack trace.

// The 2020-12 dialect entry point, not ajv's default export: the default is
// still draft-07 and refuses a schema whose $schema names 2020-12, which is
// the dialect the shipped schema file declares.
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export const POLICY_FILE_NAME = '.guardrails.yaml';

export const GATE_ROLES = ['dependencies', 'secrets', 'intent'] as const;
export type GateRole = (typeof GATE_ROLES)[number];

export const PRODUCTS = ['dep-guard', 'vault-guard', 'intent-guard'] as const;
export type Product = (typeof PRODUCTS)[number];

/**
 * When a gate runs, in order, earliest first.
 *
 * Stages are CUMULATIVE: a gate runs at its own stage and at every later
 * one, so a run at `ci` runs everything that is enabled. The order of this
 * array is the whole rule, which is why it is one array rather than three
 * booleans: adding a fourth stopping point is an entry here and nothing
 * else.
 */
export const GATE_STAGES = ['commit', 'push', 'ci'] as const;
export type GateStage = (typeof GATE_STAGES)[number];

/**
 * Where each gate sits when the policy file does not say.
 *
 * Runtime is not what decides this. All three gates together take under a
 * second on a staged commit; the cost is CEREMONY, and only the intent gate
 * has any, because it wants a contract approved before the work starts.
 * The other two are silent until they find something, and a secret that
 * reaches a pull request is already on a remote, so the earliest stage is
 * the only honest place for them.
 */
export const DEFAULT_STAGE_FOR_ROLE: Record<GateRole, GateStage> = {
  dependencies: 'commit',
  secrets: 'commit',
  intent: 'ci',
};

/** Whether a gate at `gateStage` runs during a run asked for at `requested`. */
export function runsAtStage(gateStage: GateStage, requested: GateStage): boolean {
  return GATE_STAGES.indexOf(gateStage) <= GATE_STAGES.indexOf(requested);
}

/**
 * Which product fills which role today. Enforced on load: a policy that
 * puts dep-guard in the `secrets` role is a mistake with a confusing
 * failure mode (the secrets section of the report would carry dependency
 * findings), so it is rejected at parse time instead.
 *
 * This map is the single place a rename lands. It is not the same thing as
 * the roles being closed forever: a role gains a product by gaining an
 * entry here and an adapter, and nothing else in the schema moves.
 */
export const PRODUCT_FOR_ROLE: Record<GateRole, Product> = {
  dependencies: 'dep-guard',
  secrets: 'vault-guard',
  intent: 'intent-guard',
};

/**
 * Flags the umbrella supplies itself, per product. A policy that also sets
 * one would put two writers on the same flag, and which one won would
 * depend on that CLI's argument parser rather than on anything the user
 * could read in their own policy file.
 */
export const RESERVED_OPTIONS: Record<Product, readonly string[]> = {
  'dep-guard': ['format', 'staged', 'base'],
  'vault-guard': ['format', 'f', 'staged'],
  'intent-guard': ['json', 'staged', 'project', 'paths'],
};

export type OptionValue = string | number | boolean | Array<string | number>;

export interface GatePolicy {
  role: GateRole;
  product: Product;
  enabled: boolean;
  /** Resolved, never absent: the file's own value or this role's default. */
  stage: GateStage;
  /** Absolute path to the gate's executable, overriding resolution. */
  command?: string;
  /** Argument prefix used with `command` when it cannot be inferred. */
  args?: string[];
  /** Handed to the gate unchanged. */
  options: Record<string, OptionValue>;
}

export interface Policy {
  version: 1;
  gates: Partial<Record<GateRole, GatePolicy>>;
  report: { format: 'text' | 'sarif' };
}

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

const SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'schema',
  'guardrails.schema.json'
);

let validator: ValidateFunction | undefined;

/**
 * The compiled schema validator, built once. The schema is a shipped file
 * rather than an object literal in here so a user can point an editor at
 * it and get completion in their own policy file, and so the published
 * contract is a thing on disk that can be diffed between releases.
 */
type AjvConstructor = new (options: Record<string, unknown>) => {
  compile: (schema: object) => ValidateFunction;
};

function policyValidator(): ValidateFunction {
  if (validator === undefined) {
    // Ajv ships as CommonJS with an interop default; under NodeNext the
    // namespace object is what an `import` binds, so the constructor has to
    // be reached through `.default` when it is there. The cast is the price
    // of that interop, and it is kept to this one line.
    const imported = Ajv2020 as unknown as { default?: AjvConstructor };
    const AjvCtor = (imported.default ?? (Ajv2020 as unknown as AjvConstructor)) as AjvConstructor;
    const ajv = new AjvCtor({ allErrors: true, strict: false, useDefaults: false });
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as object;
    validator = ajv.compile(schema);
  }
  return validator;
}

function describeErrors(errors: ValidateFunction['errors'], source: string): string {
  const lines = (errors ?? []).map((error) => {
    const where = error.instancePath === '' ? '(root)' : error.instancePath;
    // Name the offending key. Ajv puts it in a different param depending on
    // which keyword failed, and an error that says only "property name must
    // be valid" makes the user hunt for which one, which is exactly the
    // moment a config-file error is most annoying.
    const params = (error.params ?? {}) as Record<string, unknown>;
    const offender = params.additionalProperty ?? params.propertyName;
    const extra = offender === undefined ? '' : `: ${String(offender)}`;
    return `  ${where} ${error.message ?? 'is invalid'}${extra}`;
  });
  return `${source} is not a valid policy file:\n${lines.join('\n')}`;
}

/**
 * Parses and validates policy YAML.
 *
 * `source` is only used in error messages, so the same function serves the
 * file loader and the tests without either needing a temporary directory.
 */
export function parsePolicy(text: string, source: string): Policy {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new PolicyError(`${source} is not valid YAML: ${(err as Error).message}`);
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PolicyError(`${source} must contain a mapping at the top level.`);
  }

  const validate = policyValidator();
  if (!validate(raw)) {
    throw new PolicyError(describeErrors(validate.errors, source));
  }

  const document = raw as {
    version: 1;
    gates: Record<string, Record<string, unknown>>;
    report?: { format?: 'text' | 'sarif' };
  };

  const gates: Partial<Record<GateRole, GatePolicy>> = {};

  for (const role of GATE_ROLES) {
    const entry = document.gates[role];
    if (entry === undefined) {
      continue;
    }

    const product = entry.product as Product;
    if (PRODUCT_FOR_ROLE[role] !== product) {
      throw new PolicyError(
        `${source}: the "${role}" role is filled by ${PRODUCT_FOR_ROLE[role]}, not ${product}. ` +
          'Gates are keyed by role; put the product in the role it fills.'
      );
    }

    const options = (entry.options ?? {}) as Record<string, OptionValue>;
    for (const key of Object.keys(options)) {
      if (RESERVED_OPTIONS[product].includes(key)) {
        throw new PolicyError(
          `${source}: "${key}" under gates.${role}.options is reserved. ` +
            `The umbrella passes that flag to ${product} itself, and two writers of one flag ` +
            'would resolve differently depending on that CLI argument parser.'
        );
      }
    }

    const command = entry.command as string | undefined;
    if (command !== undefined && !path.isAbsolute(command)) {
      throw new PolicyError(
        `${source}: gates.${role}.command must be an absolute path, got "${command}". ` +
          'A bare name would be resolved against PATH, which is what resolution already does; ' +
          'the override exists to name a build PATH cannot reach.'
      );
    }

    gates[role] = {
      role,
      product,
      enabled: entry.enabled === undefined ? true : Boolean(entry.enabled),
      // The schema has already refused anything outside the enum, so the
      // only two cases left are "the file said one" and "it did not".
      stage: (entry.stage as GateStage | undefined) ?? DEFAULT_STAGE_FOR_ROLE[role],
      ...(command === undefined ? {} : { command }),
      ...(entry.args === undefined ? {} : { args: entry.args as string[] }),
      options,
    };
  }

  return {
    version: 1,
    gates,
    report: { format: document.report?.format ?? 'text' },
  };
}

/** Reads the policy file at a repository root. */
export function loadPolicy(repoRoot: string): Policy {
  const filePath = path.join(repoRoot, POLICY_FILE_NAME);
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    throw new PolicyError(
      `No ${POLICY_FILE_NAME} in ${repoRoot}. Run "conductor init" to write one. ` +
        'The umbrella deliberately has no implicit default policy: a run that gates a commit ' +
        'should be explainable from a file in the repository, not from a built-in.'
    );
  }
  return parsePolicy(text, POLICY_FILE_NAME);
}

export interface CliOverrides {
  /** Restrict the run to these roles, whatever the policy enabled. */
  gates?: GateRole[];
}

/**
 * Layer three of the precedence chain.
 *
 * Layer one is each product's own config file, which the umbrella never
 * writes or reads. Layer two is this policy file, delivered to the child as
 * command-line flags, which every one of the three treats as higher
 * precedence than its own config. Layer three is a flag on the umbrella's
 * own command line, and in v0.1 that is exactly one thing: restricting the
 * run to named roles. There is deliberately no umbrella flag that rewrites
 * a gate's threshold, because a threshold means something different in each
 * product and a single flag would have to pick one meaning silently.
 */
export function applyCliOverrides(policy: Policy, overrides: CliOverrides): Policy {
  if (overrides.gates === undefined) {
    return policy;
  }

  for (const role of overrides.gates) {
    if (policy.gates[role] === undefined) {
      throw new PolicyError(
        `--gate ${role} was asked for, but ${POLICY_FILE_NAME} declares no "${role}" gate.`
      );
    }
  }

  const gates: Partial<Record<GateRole, GatePolicy>> = {};
  for (const role of GATE_ROLES) {
    const gate = policy.gates[role];
    if (gate === undefined) {
      continue;
    }
    gates[role] = { ...gate, enabled: overrides.gates.includes(role) };
  }

  return { ...policy, gates };
}

/** Enabled gates in role order, so a report's section order never depends on file order. */
export function enabledGates(policy: Policy): GatePolicy[] {
  return GATE_ROLES.map((role) => policy.gates[role]).filter(
    (gate): gate is GatePolicy => gate !== undefined && gate.enabled
  );
}

/**
 * Renders a passthrough option bag as child-process arguments.
 *
 * Keys are sorted so two policy files that differ only in key order produce
 * the same command line, which is what makes a run reproducible and a
 * report diffable.
 */
export function renderOptionFlags(options: Record<string, OptionValue>): string[] {
  const args: string[] = [];
  for (const key of Object.keys(options).sort()) {
    const value = options[key];
    if (value === true) {
      args.push(`--${key}`);
    } else if (value === false) {
      // Both dep-guard and intent-guard spell a negated boolean this way,
      // and it is commander's own convention, so it is the one negation
      // rendering that is right without the umbrella knowing the flag.
      args.push(`--no-${key}`);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        args.push(`--${key}`, String(item));
      }
    } else {
      args.push(`--${key}`, String(value));
    }
  }
  return args;
}
