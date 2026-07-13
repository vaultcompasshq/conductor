# Cursor integration validation — downstream app (2026-07-09)

Validated on a private consuming app repo with Conductor pre-commit + PR drift CI.

## What was validated

| Surface | Result |
|---------|--------|
| `conductor init` / `extract` / `freeze` / `check` from npm | Pass |
| Repo-local `.githooks/pre-commit` (vault-guard + soft `conductor check`) | Pass on real commit |
| GitHub Actions `Conductor Drift` on PR | Pass (`intent-drift` job) |
| Out-of-scope drift block | Pass (frontend file → soft_block 71/100) |

## Cursor rule (`integrations/cursor/conductor.mdc`)

The Cursor project rule is **advisory** — it instructs agents to draft/freeze/check
but does not enforce mechanically. The consuming repo used repo-local `.githooks` for
enforcement instead of `conductor hook install` (global `core.hooksPath` override).

To adopt in a consuming repo:

1. Copy `integrations/cursor/conductor.mdc` to `.cursor/rules/conductor.mdc`
2. Run `./tools/install-git-hooks.sh` (or `conductor hook install`) for mechanical gate
3. Per feature branch: `conductor extract --text "…"` → `conductor freeze --approved-by <you>`

## Promotion policy

Acknowledged corrections require **explicit** `--promote` to become constraints.
Auto-promotion remains off by design.

## Brief correction cap (3b)

Session Brief and generated `index.md` now dedupe near-identical correction rules,
drop entries older than 90 days from brief surfaces, and cap at 10 items. The full
`correction_log` on the contract is unchanged.
