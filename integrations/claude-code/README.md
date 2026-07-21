# Claude Code Hook Adapter

Claude Code supports project hooks in `.claude/settings.json`. Command hooks
receive event JSON on stdin. For **Stop**, Claude Code hard-blocks only on
**exit code 2** (exit 1 is a non-blocking error). Conductor's
`conductor-stop-check.sh` maps a blocked gate to exit 2 for that reason.

## Install

```bash
mkdir -p .claude
cp integrations/claude-code/settings.sample.json .claude/settings.json
chmod +x integrations/hooks/*.sh
# Mechanical gate (shared with Cursor): also install the Git pre-commit hook
npx @vaultcompass/conductor-cli@latest hook install --project .
```

The lifecycle samples resume/brief and stop-check; the **blocking** gate is
`conductor-check` via `integrations/hooks/conductor-stop-check.sh`.

Prove the path locally:

```bash
pnpm dogfood:claude-hooks
# or: node scripts/dogfood-claude-hooks.mjs   # after pnpm build
```

Validation note:
[claude-hook-dogfood-2026-07-21.md](../../docs/validation/claude-hook-dogfood-2026-07-21.md).
Shared Git mechanical gate:
[cursor-hook-dogfood-2026-07-21.md](../../docs/validation/cursor-hook-dogfood-2026-07-21.md).

## What It Does

- `SessionStart` on `startup|resume`: runs `conductor-session-start.sh` and
  prints the current `conductor-resume` brief when available.
- `Stop`: runs `conductor-stop-check.sh`; if `conductor-check` blocks, the
  script exits **2** so Claude Code treats it as a blocking Stop (not a
  non-blocking exit 1).

**Hard enforcement** for commits is still `conductor hook install` (Git
pre-commit). Lifecycle Stop is best-effort host wiring on top of the same gate.

## Source Notes

Claude Code documents project hooks in `.claude/settings.json`, `SessionStart`
and `Stop` lifecycle events, command hooks, `${CLAUDE_PROJECT_DIR}` for project
paths, and `timeout` in seconds. Stop policy hooks should use exit code **2**
to block ending the turn.
