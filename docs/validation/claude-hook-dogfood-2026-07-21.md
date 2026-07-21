# Claude Code hook dogfood — 2026-07-21

Repeatable lifecycle-hook proof for the Claude Code integration path.
`.claude/settings.json` samples are **advisory until hooks fire**; blocking
enforcement is `conductor-check` via `integrations/hooks/conductor-stop-check.sh`
(and the shared Git gate from `conductor hook install`).

## How to re-run

```bash
pnpm build
pnpm dogfood:claude-hooks
```

Script: `scripts/dogfood-claude-hooks.mjs`

## What was validated

| Step | Result |
|------|--------|
| Copy `integrations/claude-code/settings.sample.json` → `.claude/settings.json` | Pass |
| Copy `integrations/hooks/` into fixture (`CLAUDE_PROJECT_DIR` layout) | Pass |
| `conductor init` / `extract` / `freeze` | Pass |
| SessionStart script (`conductor-session-start.sh`) prints resume brief | Pass |
| Out-of-scope `src/` edit → Stop script blocks | Pass |
| In-scope `README.md` edit → Stop script allows | Pass |
| Shared Git gate: `conductor hook install` | Pass (secondary) |

## Contract used

```
Add README install example only. Do not change source or package.json.
```

## Notes

- Cursor mechanical-gate dogfood remains
  [cursor-hook-dogfood-2026-07-21.md](./cursor-hook-dogfood-2026-07-21.md).
- This run also fixed macOS-incompatible `paste <<<` usage in
  `integrations/hooks/conductor-lib.sh` (BSD paste needs `paste -sd, -`).
- Codex uses the same shell adapters with a different config sample; a full
  interactive Codex `/hooks` trust session is still optional follow-up.
- Do **not** commit a frozen Intent Contract for the Conductor OSS repo itself
  unless maintainers are actively dogfooding a task on a feature branch.
