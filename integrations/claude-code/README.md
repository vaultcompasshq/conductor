# Claude Code Hook Adapter

Claude Code supports project hooks in `.claude/settings.json`. Command hooks
receive event JSON on stdin and can block lifecycle events with non-zero exit
codes or event-specific JSON decisions.

## Install

```bash
mkdir -p .claude
cp integrations/claude-code/settings.sample.json .claude/settings.json
chmod +x integrations/hooks/*.sh
```

## What It Does

- `SessionStart` on `startup|resume`: runs `conductor-session-start.sh` and
  prints the current `conductor-resume` brief when available.
- `Stop`: runs `conductor-stop-check.sh`; if `conductor-check` blocks, Claude
  Code receives a failed hook and should continue rather than silently ending.

## Source Notes

Claude Code documents project hooks in `.claude/settings.json`, `SessionStart`
and `Stop` lifecycle events, command hooks, `${CLAUDE_PROJECT_DIR}` for project
paths, and `timeout` in seconds.
