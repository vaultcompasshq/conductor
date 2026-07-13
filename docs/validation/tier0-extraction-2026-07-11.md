# Tier 0 extraction validation — `1.0.2` (2026-07-11)

Re-validates the dogfood findings that motivated [PR #29](https://github.com/vaultcompasshq/conductor/pull/29)
and release [`v1.0.2`](https://github.com/vaultcompasshq/conductor/releases/tag/v1.0.2).

**Context:** private downstream app repo with Conductor integration (pre-commit + PR drift CI).

## Prompt (synthetic frontend filter dogfood)

```
Add unit tests for optionFilter in frontend/src/features/widget-builder/lib/optionFilter.ts.
Verify filtering excludes options not in the selected preset.
Do not add API endpoints. Do not modify backend Python services.
```

## Results

| Check | `1.0.1` | `1.0.2` |
|-------|---------|---------|
| `original_ask` keeps full first sentence through `.ts.` | **Fail** — truncated at `optionFilter.ts.` | **Pass** — includes `Verify filtering excludes…` |
| Verify clause `not in the selected preset` in `out_of_scope` | **Fail** — false positive | **Pass** — absent |
| Explicit prohibitions in `out_of_scope` | Pass | Pass (`Do not add API endpoints`, `Do not modify backend Python services`) |

## Gate smoke (frozen contract, `conductor check --paths`)

| Scenario | Paths | Result |
|----------|-------|--------|
| Aligned frontend test work | `frontend/.../optionFilter.test.ts` | `ok` — drift 0 |
| Out-of-scope backend API | `backend/app/api/option_filter_probe.py` | `soft_block` — 71/100 |

## Notes

- Stale integration contract on the app repo `main` branch (pre-1.0.0 `.yml` mangling) was replaced locally
  for this run; **per feature branch**, teams should `extract` → `freeze` with the real task prompt.
- Cursor rule update in `1.0.2` documents one-contract-per-feature-branch; enforcement remains
  repo-local `.githooks` + GitHub Actions drift gate.
