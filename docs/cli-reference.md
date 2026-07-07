# CLI reference

The public entrypoint is the unified `conductor` binary in `packages/cli`.
Legacy per-command bins still ship from `packages/skill` for compatibility.

```bash
pnpm build
pnpm conductor -- check --project . --staged        # root script form
# after package install:
conductor check --project . --staged
# legacy package bin:
conductor-check --project . --staged
```

The session lifecycle: **coach → extract (draft) → freeze (approve) → check
(gate) → report/rules → pivot/correct → brief/resume**.

---

## Unified `conductor`

```bash
conductor --help
conductor --version
conductor <command> [flags]
```

Commands: `init`, `coach`, `extract`, `freeze`, `check`, `report`, `rules`,
`drift`, `correct`, `brief`, `doctor`, `resume`, `index`, `pivot`.

`conductor drift --ci` runs the lower-level drift scorer and exits `1` when the
JSON result has `block: true`; otherwise it preserves the normal command output.

## conductor coach `<prompt text>` / conductor-coach `<prompt text>`

Scores a prompt for scope/clarity issues. JSON: `score`, `issues`,
`coaching`, `needs_coaching`. Never blocks.

## conductor extract / conductor-extract

Draft an Intent Contract from an ask. **Writes an UNFROZEN draft** — approval is
separate (`conductor-freeze`).

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project (default `.`) |
| `--text "<ask>"` | the user's ask (required) |
| `--dry-run` | print the draft JSON, write nothing |

JSON: `valid`, `written_path`, `frozen` (always false), `next_step`,
`prompt_score`, `needs_coaching`, `coaching`, `contract_yaml`.

## conductor freeze / conductor-freeze

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

## conductor check / conductor-check (the gate)

Exits non-zero when no **approved** contract exists or staged changes drift past
a blocking threshold. Used by the pre-commit hook / CI.

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
| `--staged` | auto-collect staged paths via `git diff --cached --name-only` |
| `--paths a,b` | explicit changed paths |
| `--signals "x,y"` | free-text descriptions of what changed (open vocabulary) |
| `--message "<text>"` | latest user message (pivot detection) |
| `--previous-contract <id>` | score current changes against an archived prior contract; informational only |
| `--no-require-frozen` | allow a missing contract (still scores drift) |
| `--json` / `--log` | JSON output / append to `drift-log.jsonl` |

Exit 0 = ok, 1 = blocked.
When `--previous-contract` is provided, JSON includes `crossSessionDrift`;
this does not change the gate exit code.

## conductor report / conductor-report

Emit a reviewer-friendly handoff report for PRs, CI logs, or agent resumes.
It runs the same gate as `conductor check` and exits with the gate result.

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
| `--staged` | auto-collect staged paths via `git diff --cached --name-only` |
| `--paths a,b` | explicit changed paths |
| `--signals "x,y"` | free-text descriptions of what changed |
| `--message "<text>"` | latest user message |
| `--previous-contract <id>` | include prior-contract drift context |
| `--no-require-frozen` | allow a missing contract, matching `check` |
| `--json` | machine-readable report |

Markdown includes the active contract, gate reasons, drift score, acceptance
criteria coverage inferred from paths/signals, pivots, corrections, changed
paths, signals, and a recommended next action.

## conductor rules audit / conductor-rules audit

Inspect project rule files and surface maintainability problems before they
become noisy task constraints.

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
| `--json` | machine-readable output |

Sources: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`,
`.continue/rules`, and `.kiro/steering`. Findings include duplicate rules,
potential conflicts, stale or temporary wording, overbroad rules, and rules that
may deserve critical priority. The audit exits `0`; `status: warn` means the
maintainer should review findings.

## conductor doctor / conductor-doctor

Diagnose whether a project is ready to use Conductor before a gate fails.

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
| `--json` | machine-readable output |

Checks include `.conductor/config.yaml`, active contract validity, frozen
approval state, archived contracts, generated index freshness, package version,
visible hook/workflow integrations, and optional vault-guard pairing signals.
Missing setup or an invalid/unfrozen contract exits `1`; warnings such as stale
index, non-Conductor hooks, or a referenced vault-guard setup without a local
`vault-guard` binary exit `0`.

## conductor drift / conductor-drift

Scores drift for a given contract path (lower-level than `check`; does not gate
on contract presence).

| Flag | Meaning |
|------|---------|
| `--contract <path>` | contract YAML (required) |
| `--project <root>` · `--paths` · `--signals` · `--message` · `--log` | as above |
| `--ci` | unified CLI only; exit 1 when `block: true` |

JSON: `overall`, `action`, `categories`, `findings`, `message`, `block`.

## conductor correct / conductor-correct

Record a user correction as a durable lesson on the contract.

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
| `--wrong "<text>"` | what the agent did wrong (required) |
| `--right "<text>"` | the corrected approach (required) |
| `--rule "<text>"` | normalized negative rule (required) |
| `--acknowledge` | user-confirmed (authoritative); else `pending` |
| `--promote` | also add to `constraints[]` (requires `--acknowledge`) so drift-guard enforces it |

## conductor pivot / conductor-pivot

Record an intentional scope change and update the active contract through the
append-only `pivot_log`.

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
| `--change "<text>"` | pivot summary (required) |
| `--reason "<text>"` | why the pivot happened |
| `--add-scope "<text>"` | add an in-scope item; repeatable |
| `--remove-scope "<text>"` | remove an in-scope item; repeatable |
| `--add-out-of-scope "<text>"` | add an out-of-scope item; repeatable |
| `--acknowledge` | user-confirmed; else `pending` |

JSON: `written_path`, `index_path`, `pivot`, `pending`.

## conductor brief / conductor-brief

Emit the minimal correct-methodology context (intent, scope, AC, critical/high
constraints, **acknowledged** corrections — no failed code). Re-inject after a
context reset instead of replaying the transcript.

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
| `--json` | machine-readable (default is markdown) |

## conductor resume / conductor-resume

Emit the current Session Brief plus recent prior contracts. Use at the start of
a resumed agent session after context compaction or a new day.

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
| `--json` | machine-readable (`resume_markdown`) |

## conductor index / conductor-index

Render or regenerate `.conductor/index.md` from real contract history, pivots,
constraints, and acknowledged corrections.

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
| `--write` | write `.conductor/index.md`; default prints markdown |
| `--json` | machine-readable output |

## conductor init / conductor-init

Create the `.conductor/` skeleton (`config.yaml`, `index.md`, `contracts/`).

| Flag | Meaning |
|------|---------|
| `--project <root>` | target project |
