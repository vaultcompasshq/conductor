// The per-key difference between the base policy and the head policy.
//
// Pull-request mode reports a changed `.guardrails.yaml` as a proposal and
// never acts on it. This file only turns "it differs" into "these keys
// differ", so a reader sees which gate, which key, and the old and new value
// without opening the diff. Both arguments are parsed documents; the head is
// parsed for this comparison and never reaches the run that decides the
// verdict. The one place a head value goes further is `previewPolicy`, which
// takes only `enabled`, `stage` and `enforce` from it for the preview under
// the proposed rules, a run that decides nothing.

import type { GatePolicy, GateRole, Policy } from './policy.js';
import { GATE_ROLES, PRODUCT_FOR_ROLE, parsePolicy } from './policy.js';

export interface PolicyKeyChange {
  /** The gate role the key belongs to, or null for a key outside any gate. */
  role: GateRole | null;
  /** The key in the file's own spelling, without the `gates.<role>.` prefix. */
  key: string;
  old: unknown;
  new: unknown;
}

export const HEAD_POLICY_KEY = '.guardrails.yaml';

const MAX_VALUE_LENGTH = 80;

/** The keys of one gate in the order they are compared and reported. */
function gateKeys(gate: GatePolicy | undefined, optionNames: string[]): Array<[string, unknown]> {
  const get = (key: string): unknown => {
    if (gate === undefined) return undefined;
    switch (key) {
      case 'product':
        return gate.product;
      case 'enabled':
        return gate.enabled;
      case 'stage':
        return gate.stage;
      case 'enforce':
        return gate.enforce;
      case 'command':
        return gate.command;
      case 'args':
        return gate.args;
      case 'present-on-base':
        return gate.presentOnBase;
      case 'timeout-seconds':
        return gate.timeoutSeconds;
      default:
        {
          const name = key.slice('options.'.length);
          return Object.hasOwn(gate.options, name) ? gate.options[name] : undefined;
        }
    }
  };
  const keys = [
    'product',
    'enabled',
    'stage',
    'enforce',
    'command',
    'args',
    ...optionNames.map((name) => `options.${name}`),
    'present-on-base',
    'timeout-seconds',
  ];
  return keys.map((key) => [key, get(key)]);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Every key whose value differs, gates in GATE_ROLES order and `report.format`
 * last. `excludedByCli` is never compared: it is the run's own flag, not the
 * file's. A null head (absent or unparseable) is one change that says so.
 */
export function diffPolicies(base: Policy, head: Policy | null): PolicyKeyChange[] {
  if (head === null) {
    return [{ role: null, key: HEAD_POLICY_KEY, old: 'present', new: null }];
  }
  const changes: PolicyKeyChange[] = [];
  for (const role of GATE_ROLES) {
    const b = base.gates[role];
    const h = head.gates[role];
    if (b === undefined && h === undefined) continue;
    const names = [
      ...new Set([...Object.keys(b?.options ?? {}), ...Object.keys(h?.options ?? {})]),
    ].sort();
    const baseKeys = gateKeys(b, names);
    const headKeys = gateKeys(h, names);
    baseKeys.forEach(([key, oldValue], i) => {
      const newValue = headKeys[i]?.[1];
      if (!same(oldValue, newValue)) changes.push({ role, key, old: oldValue, new: newValue });
    });
  }
  if (base.report.format !== head.report.format) {
    changes.push({
      role: null,
      key: 'report.format',
      old: base.report.format,
      new: head.report.format,
    });
  }
  return changes;
}

/**
 * Every character outside printable ASCII as a \uXXXX escape (an astral
 * character as its two surrogate escapes), so head-chosen text cannot smuggle
 * a bidi override or a zero-width character into the report. Used for a head
 * policy value here, and for every preview line (cleanPreviewLine,
 * src/gate-runner.ts), whose gate text the head's own control files can
 * choose (audit 2026-10-27, N3).
 */
export function escapeNonAscii(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function renderValue(value: unknown): string {
  if (value === undefined) return '(absent)';
  const text = JSON.stringify(value) ?? '(absent)';
  const escaped = escapeNonAscii(text);
  if (escaped.length <= MAX_VALUE_LENGTH) return escaped;
  // Keep whole tokens up to 77 characters, so no escape sequence is split.
  let kept = '';
  for (const token of escaped.match(/\\u[0-9a-f]{4}|\\.|[^\\]/g) ?? []) {
    if (kept.length + token.length > MAX_VALUE_LENGTH - 3) break;
    kept += token;
  }
  return `${kept}...`;
}

/** One proposal line for one changed key. */
export function policyChangeLine(change: PolicyKeyChange): string {
  if (change.key === HEAD_POLICY_KEY) {
    // One text for every case where the head's keys cannot be read: the file
    // is absent, it is not YAML, it parses as YAML but fails policy
    // validation, or git could not read it at all.
    return `policy: the head ${HEAD_POLICY_KEY} is absent or does not parse, so its changes are not known`;
  }
  const where = change.role === null ? change.key : `gates.${change.role}.${change.key}`;
  return `policy: ${where} ${renderValue(change.old)} -> ${renderValue(change.new)}`;
}

/**
 * The roles a preview under the proposed rules runs: every role with an
 * `enabled` or `stage` change, in GATE_ROLES order. A role whose only changes
 * are `enforce` or keys the preview takes from the base would preview as the
 * primary run again, so it is left out, and so is `report.format`.
 */
export function previewRoles(changes: PolicyKeyChange[]): GateRole[] {
  const wanted = new Set(
    changes
      .filter((change) => change.role !== null && (change.key === 'enabled' || change.key === 'stage'))
      .map((change) => change.role as GateRole)
  );
  return GATE_ROLES.filter((role) => wanted.has(role));
}

/**
 * The policy a preview runs under. Only `enabled`, `stage` and `enforce` come
 * from the head: `command`, `args`, `options`, `timeout-seconds` and
 * `present-on-base` come from the base role, or, for a role only the head
 * has, from what the policy file gives for its product alone. A role the head
 * removed is the base role switched off. Only the roles in `roles` are held,
 * with the base `report`.
 */
export function previewPolicy(base: Policy, head: Policy, roles: GateRole[]): Policy {
  const gates: Partial<Record<GateRole, GatePolicy>> = {};
  for (const role of GATE_ROLES) {
    if (!roles.includes(role)) continue;
    const b = base.gates[role];
    const h = head.gates[role];
    if (h === undefined) {
      if (b !== undefined) gates[role] = { ...b, enabled: false };
      continue;
    }
    const from: GatePolicy = b ?? productDefault(role);
    gates[role] = { ...from, enabled: h.enabled, stage: h.stage, enforce: h.enforce };
  }
  return { version: 1, gates, report: base.report };
}

/**
 * The gate parsePolicy gives for `product: <product>` alone, built by
 * parsePolicy itself so its defaults have one source. The product is
 * PRODUCT_FOR_ROLE's, which parsePolicy already required the head to match.
 */
function productDefault(role: GateRole): GatePolicy {
  const gate = parsePolicy(
    `version: 1\ngates:\n  ${role}:\n    product: ${PRODUCT_FOR_ROLE[role]}\n`,
    'the preview default'
  ).gates[role];
  if (gate === undefined) {
    throw new Error(`no default gate for the ${role} role`);
  }
  return gate;
}
