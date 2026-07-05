---
name: intent-contract
description: >-
  Draft and freeze an Intent Contract before brainstorming or implementation.
  Use when the user describes a feature, fix, or task and no frozen contract
  exists in .conductor/intent-contract.yaml. Hard gate — do not run
  test-driven-development or implementation skills until frozen_by user.
---

# Intent Contract

**Announce at start:** "I'm using the intent-contract skill to freeze session intent."

## Priority

This skill runs **before** `brainstorming`, `writing-plans`, and `test-driven-development`.

Skill order: user instructions (AGENTS.md) → **Conductor skills** → Superpowers process skills.

## Hard gate

Do **not** invoke implementation skills until:

1. `.conductor/intent-contract.yaml` exists in the **target project root**
2. `frozen_by: user` is set (explicit user approval)

## Workflow

### 1. Check for existing contract

Read `.conductor/intent-contract.yaml` in the project being worked on.

- If present and `frozen_by: user` → proceed to brainstorming/plans
- If present but not frozen → present draft, ask one clarifying question at a time, then freeze
- If missing → continue below

### 2. Load constraints

Read from project root when present:

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`

### 3. Draft contract (helper CLI)

From the conductor repo (after `pnpm build`):

```bash
pnpm --filter @vaultcompasshq/conductor-skill exec conductor-extract \
  --project /path/to/target-project \
  --text "USER'S ORIGINAL ASK HERE" \
  --dry-run
```

Review `contract_yaml`, `prompt_score`, and `coaching` in the JSON output.

### 4. Run prompt-coach if needed

If `needs_coaching` is true or `prompt_score < 60`, invoke the `prompt-coach` skill before freezing.

### 5. Present draft to user

Show:

- `original_ask`
- `in_scope` / `out_of_scope`
- `constraints` (from project files)
- `acceptance_criteria`

Ask **one question at a time** for gaps. Update the draft mentally before writing.

### 6. Write the draft

```bash
pnpm --filter @vaultcompasshq/conductor-skill exec conductor-extract \
  --project /path/to/target-project \
  --text "FINAL ASK"
```

This writes an **unfrozen draft**. The gate still blocks until it is approved.

### 7. Freeze (explicit user approval)

Freezing is a separate, deliberate step — the agent must **not** self-approve.

```bash
pnpm --filter @vaultcompasshq/conductor-skill exec conductor-freeze \
  --project /path/to/target-project
# Interactive TTY → shows a summary and asks to confirm.
# Non-interactive → requires --approved-by "<name>".
```

The approver and timestamp are recorded in the contract's `approval` block;
the gate (`conductor-check`) only treats the contract as frozen once that
record exists. Confirm `written_path` is `.conductor/intent-contract.yaml`.

Set `metadata.superpowers_spec_path` when a design spec will follow (e.g. `docs/superpowers/specs/YYYY-MM-DD-topic-design.md`).

### 7. Link downstream work

- `brainstorming` / `writing-plans` specs must reference `contract_id`
- `verification-before-completion` checks `acceptance_criteria`
- Downstream alignment reviews use this file as the primary spec

## Install (copy to Cursor skills)

```bash
cp -r packages/skill/intent-contract ~/.cursor/skills/intent-contract
cp -r packages/skill/prompt-coach ~/.cursor/skills/prompt-coach
cp -r packages/skill/drift-guard ~/.cursor/skills/drift-guard
```

Also copy sibling skill folders from `packages/skill/`.

## Schema

Validated by `@vaultcompasshq/conductor-schema`. Examples: `examples/intent-contracts/`.
