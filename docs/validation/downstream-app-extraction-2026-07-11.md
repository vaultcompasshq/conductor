# Downstream app extraction validation — `1.0.2` (2026-07-11)

Re-validates extraction fixes in [PR #29](https://github.com/vaultcompasshq/conductor/pull/29)
and release [`v1.0.2`](https://github.com/vaultcompasshq/conductor/releases/tag/v1.0.2).

**Context:** private consuming app repo with Conductor pre-commit + PR drift CI.

## Prompt (synthetic frontend filter)

```
Add unit tests for itemFilter in frontend/src/features/catalog-module/lib/itemFilter.ts.
Verify filtering excludes items not in the selected preset.
Do not add API endpoints. Do not modify backend Python services.
```

## Results

| Check | `1.0.1` | `1.0.2` |
|-------|---------|---------|
| `original_ask` keeps full first sentence through `.ts.` | **Fail** — truncated at `itemFilter.ts.` | **Pass** — includes `Verify filtering excludes…` |
| Verify clause `not in the selected preset` in `out_of_scope` | **Fail** — false positive | **Pass** — absent |
| Explicit prohibitions in `out_of_scope` | Pass | Pass (`Do not add API endpoints`, `Do not modify backend Python services`) |

## Gate smoke (frozen contract, `conductor check --paths`)

| Scenario | Paths | Result |
|----------|-------|--------|
| Aligned frontend test work | `frontend/.../itemFilter.test.ts` | `ok` — drift 0 |
| Out-of-scope backend API | `backend/app/api/item_filter_probe.py` | `soft_block` — 71/100 |

## Notes

- Per feature branch: `extract` → `freeze` with the real task prompt.
- Enforcement: repo-local `.githooks` + GitHub Actions drift gate.
