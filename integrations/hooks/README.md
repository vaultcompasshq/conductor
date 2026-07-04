# Conductor Hook Adapters

These examples wire Conductor into agent lifecycle hooks so intent checks happen
without relying on the agent to remember a markdown instruction.

## Shared Scripts

| Script | Purpose |
|--------|---------|
| `conductor-session-start.sh` | Prints `conductor-resume` output when an active contract exists |
| `conductor-stop-check.sh` | Runs `conductor-check` against changed paths and exits non-zero on a blocked gate |

The scripts first look for this repo's built CLI files under
`packages/skill/dist/`, then fall back to `conductor-resume` /
`conductor-check` on `PATH`.

## Install

From a project that has Conductor available:

```bash
pnpm build
chmod +x integrations/hooks/*.sh
```

Then copy the relevant sample config from `integrations/codex/`,
`integrations/claude-code/`, or `integrations/cursor/`.

## Behavior

- Session-start hooks are best effort. They do not block if no active contract
  exists, because new projects need to bootstrap with `conductor-extract`.
- Stop hooks fail closed when `conductor-check` is unavailable or returns a
  blocking result.
- Cursor has no committed lifecycle hook config here; use the project rule plus
  the Git pre-commit hook for enforcement.
