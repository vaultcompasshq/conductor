// The per-key difference between the base policy and the head policy.
//
// Pull-request mode reports a changed `.guardrails.yaml` as a proposal and
// never acts on it. This file only turns "it differs" into "these keys
// differ", so a reader sees which gate, which key, and the old and new value
// without opening the diff. Both arguments are parsed documents; the head is
// parsed for this comparison alone and never reaches a run.

import type { GatePolicy, GateRole, Policy } from './policy.js';
import { GATE_ROLES } from './policy.js';

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
        return gate.options[key.slice('options.'.length)];
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

function renderValue(value: unknown): string {
  if (value === undefined) return '(absent)';
  const text = JSON.stringify(value) ?? '(absent)';
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 3)}...` : text;
}

/** One proposal line for one changed key. */
export function policyChangeLine(change: PolicyKeyChange): string {
  if (change.key === HEAD_POLICY_KEY) {
    return `policy: the head ${HEAD_POLICY_KEY} is absent or does not parse, so its changes are not known`;
  }
  const where = change.role === null ? change.key : `gates.${change.role}.${change.key}`;
  return `policy: ${where} ${renderValue(change.old)} -> ${renderValue(change.new)}`;
}
