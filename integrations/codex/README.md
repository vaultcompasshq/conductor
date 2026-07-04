# Codex Hook Adapter

Codex supports project-local hooks in `.codex/hooks.json` or inline `[hooks]`
tables in `.codex/config.toml` when the project `.codex/` layer is trusted.

## Install

```bash
mkdir -p .codex
cp integrations/codex/hooks.json.sample .codex/hooks.json
chmod +x integrations/hooks/*.sh
```

Then start Codex in the project and review/trust the hooks with `/hooks`.

## What It Does

- `SessionStart` on `startup|resume|compact`: runs
  `integrations/hooks/conductor-session-start.sh`, which prints the current
  `conductor-resume` brief when an active contract exists.
- `Stop`: runs `integrations/hooks/conductor-stop-check.sh`, which invokes
  `conductor-check` against changed paths and fails the hook when the gate is
  blocked.

## Source Notes

The current Codex manual documents hooks in `hooks.json`, project `.codex/`
trust, `SessionStart` matchers such as `startup`, `resume`, `compact`, and
`Stop` hooks. It also recommends resolving repo-local hook scripts from the git
root instead of relying on the process working directory.
