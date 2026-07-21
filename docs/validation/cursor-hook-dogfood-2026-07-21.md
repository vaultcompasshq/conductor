# Cursor hook dogfood — 2026-07-21

Repeatable mechanical-gate proof for the Cursor integration path.
Cursor project rules remain **advisory**; enforcement is `conductor hook install`.

## How to re-run

```bash
pnpm build
pnpm dogfood:cursor-hooks
```

Script: `scripts/dogfood-cursor-hooks.mjs`

## What was validated

| Step | Result |
|------|--------|
| Copy `integrations/cursor/conductor.mdc` → `.cursor/rules/` | Pass |
| `conductor init` / `extract` / `freeze` | Pass |
| `conductor hook install` | Pass |
| Localize machine-wide `core.hooksPath` → `.git/hooks` | Pass (when global hooksPath is outside the repo) |
| `conductor doctor` reports pre-commit hook | Pass |
| Out-of-scope `src/` edit → `check` blocked + pre-commit refuses commit | Pass |
| In-scope `README.md` edit → `check` ok + pre-commit allows commit | Pass |

## Contract used

```
Add README install example only. Do not change source or package.json.
```

## Notes

- Claude Code / Codex lifecycle samples still call the same `conductor-check`
  gate; this dogfood covers the shared mechanical enforcement path.
- Do **not** commit a frozen Intent Contract for the Conductor OSS repo itself
  unless maintainers are actively dogfooding a task on a feature branch.
- If a consuming app already uses repo-local `.githooks`, `hook install` writes
  there without localizing (path stays inside the project).
