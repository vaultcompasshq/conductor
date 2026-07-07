import type {
  IntentContract,
  PivotLogEntry,
} from "@vaultcompass/conductor-schema";

export interface AddPivotInput {
  change: string;
  reason?: string;
  acknowledged?: boolean;
  in_scope_added?: string[];
  in_scope_removed?: string[];
  out_of_scope_added?: string[];
}

function cleanItems(items: string[] | undefined): string[] {
  return (items ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function appendUnique(base: string[], additions: string[]): string[] {
  const seen = new Set(base.map((item) => item.toLowerCase()));
  const next = [...base];
  for (const item of additions) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      next.push(item);
      seen.add(key);
    }
  }
  return next;
}

function removeItems(base: string[], removals: string[]): string[] {
  const remove = new Set(removals.map((item) => item.toLowerCase()));
  return base.filter((item) => !remove.has(item.toLowerCase()));
}

export function addPivot(
  contract: IntentContract,
  input: AddPivotInput,
): IntentContract {
  const inScopeAdded = cleanItems(input.in_scope_added);
  const inScopeRemoved = cleanItems(input.in_scope_removed);
  const outOfScopeAdded = cleanItems(input.out_of_scope_added);

  const entry: PivotLogEntry = {
    timestamp: new Date().toISOString(),
    change: input.change,
    acknowledged_by: input.acknowledged ? "user" : "pending",
  };
  if (input.reason) entry.reason = input.reason;

  const updates: NonNullable<PivotLogEntry["updates"]> = {};
  if (inScopeAdded.length > 0) updates.in_scope_added = inScopeAdded;
  if (inScopeRemoved.length > 0) updates.in_scope_removed = inScopeRemoved;
  if (outOfScopeAdded.length > 0) updates.out_of_scope_added = outOfScopeAdded;
  if (Object.keys(updates).length > 0) entry.updates = updates;

  return {
    ...contract,
    in_scope: appendUnique(
      removeItems(contract.in_scope, inScopeRemoved),
      inScopeAdded,
    ),
    out_of_scope: appendUnique(contract.out_of_scope, outOfScopeAdded),
    pivot_log: [...contract.pivot_log, entry],
  };
}
