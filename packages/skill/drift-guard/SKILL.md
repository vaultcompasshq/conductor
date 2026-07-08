---
name: drift-guard
description: >-
  Score drift from the frozen Intent Contract at Superpowers handoff boundaries.
  Use after brainstorming before writing-plans, after writing-plans before
  test-driven-development, and before verification-before-completion. Warns or
  soft-blocks based on score; hard-blocks only on critical constraint violations.
---

# Drift Guard

**Announce at start:** "I'm using the drift-guard skill to check intent alignment."

## When to run

| Boundary | Action |
|----------|--------|
| After `brainstorming` → before `writing-plans` | Compare spec scope to contract |
| After `writing-plans` → before `test-driven-development` | Compare plan to contract |
| Before `verification-before-completion` | Compare work to acceptance criteria |
| On file save | Opt-in via `.conductor/config.yaml` (future) |

## Prerequisites

- Frozen `.conductor/intent-contract.yaml` in the target project
- List of changed file paths since last check (from git diff or session context)
- Optional: user message if scope may have pivoted

## Score drift (helper CLI)

```bash
pnpm --filter @vaultcompass/conductor-skill exec conductor-drift \
  --contract /path/to/project/.conductor/intent-contract.yaml \
  --project /path/to/project \
  --paths "src/api/new-route.ts,src/hooks/useWebSocket.ts" \
  --signals "new_api_route" \
  --message "actually let's also add notifications" \
  --log
```

JSON output:

- `overall` — 0–100 drift score
- `action` — `proceed` | `info` | `warn` | `soft_block` | `hard_block`
- `findings` — human-readable drift signals
- `message` — formatted message for the user
- `block` — true when agent should pause for confirmation

`--log` appends to `.conductor/drift-log.jsonl`.

### Signals are open-vocabulary

`--signals` takes free-text phrases describing what the change *did* — e.g.
`"added a new api route"`, `"stubbed the notification handler"`,
`"sends telemetry to analytics"`. They are tokenized and matched against the
contract's `out_of_scope` and `constraints`; there is no fixed enum. Describe
the change in plain words. The scorer subtracts tokens that also appear in
`in_scope`, so naming the change honestly is enough.

## Actions by score (default thresholds)

| Score | Action |
|-------|--------|
| 0–25 | Proceed silently |
| 26–50 | Info: drift trending |
| 51–70 | Warn: show diff vs contract |
| 71–85 | Soft block: confirm to continue |
| 86–100 | Hard block on critical constraints |

Configurable via `.conductor/config.yaml` — see `examples/conductor.config.example.yaml`.

## When blocked

1. Show `message` and `findings` to the user
2. Options: narrow scope, update `out_of_scope`, or log acknowledged pivot in `pivot_log`
3. Re-run drift check after contract update

## Pivot protocol

If the user intentionally changed scope:

```yaml
pivot_log:
  - timestamp: "2026-06-17T18:00:00Z"
    change: "Add email notifications"
    reason: "User requested after export shipped"
    acknowledged_by: user
    updates:
      in_scope_added:
        - "Toast notification on successful export"
```

Do not mutate frozen fields without a `pivot_log` entry.

## Hard enforcement (outside the agent)

A SKILL.md is advisory — an agent can ignore it. For a gate that *cannot* be
ignored, use `conductor-check`, which exits non-zero when no frozen contract
exists or staged changes drift past a blocking threshold:

```bash
conductor-check --project . --staged
```

Install it as a git pre-commit hook with `conductor hook install` (add
`--with-vault-guard` to pair secret scanning), or wire a CI step.

## Implementation

Generic token-matching scorer: `packages/core/src/drift.ts` +
`packages/core/src/tokenize.ts`. No project-specific rules and no LLM required —
matching is driven entirely by the contract's own `in_scope`, `out_of_scope`,
and `constraints` text.
