# Production Readiness Validation - 2026-07-04

**Branch:** `production-readiness-cli-release`
**Goal:** Exercise the new unified CLI, release packaging smoke test, session
resume, pivots, corrections, archived contracts, and prior-contract drift before
public beta packaging.

## Commands Exercised

All commands used the unified CLI entrypoint:

```bash
PROJECT=/tmp/conductor-prod-validation
node packages/cli/dist/conductor.js init --project "$PROJECT"
node packages/cli/dist/conductor.js extract --project "$PROJECT" --text "Add a client-side CSV export button to the report table. Do not add new API endpoints. Verify that the downloaded file includes visible rows and headers."
node packages/cli/dist/conductor.js freeze --project "$PROJECT" --approved-by validation --json
node packages/cli/dist/conductor.js correct --project "$PROJECT" --wrong "planned server endpoint work inside a client-only export" --right "keep export implementation client-side unless a pivot is explicitly approved" --rule "Do not add server endpoints to client-only export contracts" --acknowledge
node packages/cli/dist/conductor.js pivot --project "$PROJECT" --change "Export must respect currently visible filtered rows" --reason "User clarified filtered table state is part of done" --add-scope "Export respects currently visible filtered rows" --acknowledge
node packages/cli/dist/conductor.js resume --project "$PROJECT" --json
node packages/cli/dist/conductor.js check --project "$PROJECT" --paths src/app/api/export/route.ts --signals "added new api endpoint for csv export" --previous-contract ic-20260705-dyer8y --json
node packages/cli/dist/conductor.js drift --ci --contract "$PROJECT/.conductor/contracts/ic-20260705-dyer8y.yaml" --project "$PROJECT" --paths src/app/api/export/route.ts --signals "added new api endpoint for csv export"
```

## Findings Fixed

1. **Negative clauses leaked into `in_scope`.** The ask "Do not add new API
   endpoints" was extracted into both `in_scope` and `out_of_scope`. Because
   drift subtracts in-scope tokens, this also masked prior-contract drift.
   Fixed in `packages/core/src/extract.ts` by excluding prohibition clauses from
   scope extraction.

2. **Nested prohibition matches duplicated `out_of_scope`.** `Do not add new API
   endpoints` also matched the nested `not add new API endpoints`. Fixed by
   deduping overlapping out-of-scope matches.

## Final Result

The fixed first contract extracted cleanly:

```yaml
in_scope:
  - Add a client-side CSV export button to the report table
out_of_scope:
  - Do not add new API endpoints
```

`conductor resume --json` included the active intent, filtered-row pivot,
out-of-scope API endpoint rule, and acknowledged correction.

Prior-contract drift worked as intended after freezing a second contract that
allowed an API endpoint:

```json
{
  "previous_contract_id": "ic-20260705-dyer8y",
  "current_contract_id": "ic-20260705-uqur2c",
  "previous": {
    "overall": 71,
    "action": "soft_block"
  },
  "current": {
    "overall": 0,
    "action": "proceed"
  }
}
```

`conductor drift --ci` exited `1` against the archived first contract and
reported `block: true` with the finding:

```text
Out-of-scope touched: "Do not add new API endpoints" (matched: api, endpoints)
```

## Remaining Production Work

- Publish/tag is still manual and was not executed in this validation run.
- Phase 3b correction decay/dedup remains deferred.
- Hook adapters are sample-level integrations; execution tests cover syntax and
  config validity, not full Codex/Claude/Cursor runtime behavior.
