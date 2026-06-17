# Intent Contract — Example (synthetic)

**contract_id:** ic-20260617-a3f9k2  
**Project:** Example — CSV export feature (not a real Vault & Compass spec)

```yaml
contract_id: ic-20260617-a3f9k2
version: "1.0.0"

original_ask: "Add CSV export for the fund performance table on the dashboard."

in_scope:
  - "Export button on /funds page exports visible table columns"
  - "CSV includes fund name, YTD return, Sharpe, last updated"
  - "File downloads client-side (no new API endpoint)"
  - "Works in Chrome and Safari latest"

out_of_scope:
  - "PDF export"
  - "Scheduled email exports"
  - "Custom column picker / saved views"
  - "Authentication changes"

constraints:
  - source: CLAUDE.md
    rule: "No new API endpoints without explicit approval — client-side only"
    priority: critical
    file_path: CLAUDE.md
  - source: AGENTS.md
    rule: "Minimize scope — simplest correct diff"
    priority: high
  - source: user-stated
    rule: "Launch in 3 days — no refactors outside export feature"
    priority: critical

acceptance_criteria:
  - id: ac-1
    description: "Click Export → .csv downloads with correct headers and row count"
    testable: true
  - id: ac-2
    description: "Empty table state shows disabled Export with tooltip"
    testable: true
  - id: ac-3
    description: "No new network requests beyond existing fund fetch"
    testable: true

frozen_at: "2026-06-17T14:30:00Z"
frozen_by: user

prompt_quality:
  score: 78
  issues:
    - scope_adverb
  coaching_shown: true

pivot_log: []

metadata:
  project: fund-analytics-dashboard
  repo_path: ./dashboard
  superpowers_spec_path: docs/superpowers/specs/2026-06-17-csv-export-design.md
```

---

## Drift example (same contract, turn 40)

**Detected drift:**

| Signal | Evidence | Severity |
|--------|----------|----------|
| Scope creep | Diff adds WebSocket real-time sync | critical |
| Constraint violation | New `/api/export` route added | critical |
| Undocumented pivot | "Actually let's also sync live" | high |

**Conductor message (soft block):**

> Session drift detected. Contract `ic-20260617-a3f9k2` says client-side CSV only, no new API.  
> Current diff adds `api/export/route.ts` and WebSocket hook.  
> **Options:** (1) Log pivot and update contract (2) Revert drift (3) Override with reason

**Pivot log entry (if user chooses 1):**

```yaml
- timestamp: "2026-06-17T16:45:00Z"
  change: "Add real-time export via API + WebSocket"
  reason: "User needs live data for desk workflow"
  acknowledged_by: user
  updates:
    in_scope_added:
      - "Real-time CSV stream via WebSocket"
    out_of_scope_removed:
      - "No new API endpoint"  # moved to in_scope via pivot
```

---

## Prompt coaching example (before freeze)

**User said:** "Just quickly add export like Notion does with sharing and maybe PDF too"

**Coach output:**

> **Prompt variance warning**  
> - `just quickly` → models skip edge cases and tests  
> - `like Notion` + `sharing` + `PDF` → 3 product surfaces, not one feature  
>  
> **Suggested rewrite:**  
> "Add CSV download for the current fund table. Client-side only. No PDF, no sharing."
