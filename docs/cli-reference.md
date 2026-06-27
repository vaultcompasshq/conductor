# CLI reference

All CLIs live in `packages/skill` and are built to `packages/skill/dist`. Run via
the package bin (after `pnpm build`) or the root `pnpm conductor:*` scripts.

```bash
pnpm build
pnpm conductor:check -- --project . --staged        # root script form
# or, if packages/skill/dist is on PATH / via pnpm exec:
conductor-check --project . --staged
```

The session lifecycle: **coach → extract (draft) → freeze (approve) → check
(gate) → correct → brief**.

---

## conductor-coach `<prompt text>`

Scores a prompt for scope/clarity issues. JSON: `score`, `issues`,
`coaching`, `needs_coaching`. Never blocks.

## conductor-extract

Draft an Intent Contract from an ask. **Writes an UNFROZEN draft** — approval is
separate (`conductor-freeze`).

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project (default `.`) |
| `--text "<ask>"` | the user's ask (required) |
| `--dry-run` | print the draft JSON, write nothing |

JSON: `valid`, `written_path`, `frozen` (always false), `next_step`,
`prompt_score`, `needs_coaching`, `coaching`, `contract_yaml`.

## conductor-freeze

Approve a draft. A deliberate, attributable step — an agent must not self-approve.

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
| `--approved-by "<name>"` | explicit approver (required when non-interactive) |
| `--yes` | skip the interactive prompt (records `method: forced`) |
| `--json` | machine-readable output |

Behavior: on a TTY, shows a summary and asks to confirm. Non-interactively,
**refuses unless `--approved-by` is given**. Records an `approval` block
(`approved_by` / `approved_at` / `method`). Idempotent if already frozen.

## conductor-check (the gate)

Exits non-zero when no **approved** contract exists or staged changes drift past
a blocking threshold. Used by the pre-commit hook / CI.

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
| `--staged` | auto-collect staged paths via `git diff --cached --name-only` |
| `--paths a,b` | explicit changed paths |
| `--signals "x,y"` | free-text descriptions of what changed (open vocabulary) |
| `--message "<text>"` | latest user message (pivot detection) |
| `--no-require-frozen` | allow a missing contract (still scores drift) |
| `--json` / `--log` | JSON output / append to `drift-log.jsonl` |

Exit 0 = ok, 1 = blocked.

## conductor-drift

Scores drift for a given contract path (lower-level than `check`; does not gate
on contract presence).

| Flag | Meaning |
|------|---------|
| `--contract <path>` | contract YAML (required) |
| `--project <root>` · `--paths` · `--signals` · `--message` · `--log` | as above |

JSON: `overall`, `action`, `categories`, `findings`, `message`, `block`.

## conductor-correct

Record a user correction as a durable lesson on the contract.

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
| `--wrong "<text>"` | what the agent did wrong (required) |
| `--right "<text>"` | the corrected approach (required) |
| `--rule "<text>"` | normalized negative rule (required) |
| `--acknowledge` | user-confirmed (authoritative); else `pending` |
| `--promote` | also add to `constraints[]` (requires `--acknowledge`) so drift-guard enforces it |

## conductor-brief

Emit the minimal correct-methodology context (intent, scope, AC, critical/high
constraints, **acknowledged** corrections — no failed code). Re-inject after a
context reset instead of replaying the transcript.

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
| `--json` | machine-readable (default is markdown) |

## conductor-init

Create the `.conductor/` skeleton (`config.yaml`, `index.md`, `contracts/`).

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
