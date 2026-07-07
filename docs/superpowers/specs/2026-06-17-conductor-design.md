# Conductor — Design Specification

**Date:** 2026-06-17  
**Version:** 1.0.0  
**Status:** Draft — awaiting user review  
**Author:** Conductor team
**Repository:** `github.com/vaultcompasshq/conductor`

---

## 1. Executive Summary

**Problem:** AI coding sessions drift from user intent. Code review catches syntax, not alignment. Users prompt in ways that cause scope explosion. Constraints in `AGENTS.md` / `CLAUDE.md` are ignored mid-session.

**Solution:** **Conductor** — a model-agnostic governance layer that produces a frozen **Intent Contract**, coaches prompt quality, and detects drift continuously.

**Not in scope:** Custom models, autonomous building, or replacing downstream product pipelines.

**Relationship:** Public OSS governance layer that downstream tools can consume.

---

## 2. Goals and Non-Goals

### Goals

1. Freeze intent as validated `intent-contract.yaml` per task/session
2. Score and coach user prompts before execution
3. Detect drift vs contract + constraint files during work
4. Log intentional pivots with acknowledgment
5. Integrate with Superpowers, Cursor, and downstream review workflows
6. Work across Claude, Codex, Gemini via skills + CLI (not model APIs)

### Non-Goals (v1)

- Fine-tuned models
- Hosted SaaS / billing
- Replacing security code review
- Product ideation scoring
- Full vector DB / embedding pipeline

---

## 3. Architecture

### 3.1 System context

```
┌──────────────────────────────────────────────────────────────────┐
│                         User + IDE                                │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│                      CONDUCTOR (this repo)                        │
│  ┌─────────────┐ ┌──────────────┐ ┌────────────┐ ┌─────────────┐ │
│  │  Extractor  │→│   Contract   │→│   Coach    │→│ Drift Guard │ │
│  └─────────────┘ └──────────────┘ └────────────┘ └─────────────┘ │
│         ↑               ↑                              ↑          │
│  ┌──────┴───────────────┴──────────────────────────────┴──────┐  │
│  │              Memory Index (Phase 3)                         │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  Superpowers           Downstream tools       Any IDE agent
  (skills)              (review workflows)     (Claude/Codex/Gemini)
```

### 3.2 Components

| Component | Responsibility | Phase |
|-----------|----------------|-------|
| **Extractor** | Parse user message + constraint files → draft contract | 1 |
| **Contract Store** | Write/read `.conductor/intent-contract.yaml` | 1 |
| **Prompt Coach** | Detect bad patterns, suggest rewrites | 1 |
| **Drift Guard** | Score divergence (scope, constraints, AC) | 2 |
| **Memory Index** | File-based index of contracts, pivots, constraints | 3 |
| **CLI** | `contract`, `drift`, `coach`, `validate` | 4 |
| **Skills** | Superpowers-compatible skill files | 2 draft, 4 publish |

### 3.3 Data flow — happy path

```
1. User describes task
2. Conductor loads AGENTS.md, CLAUDE.md, GEMINI.md, docs/spec.md (if exist)
3. Conductor drafts Intent Contract
4. If prompt_quality.score < 60 → show coaching, wait for refinement
5. User approves → contract frozen (frozen_by: user)
6. Superpowers brainstorming (if needed) → spec links to contract_id
7. Implementation proceeds
8. Drift Guard runs at handoff boundaries (and optionally on file write)
9. If drift → soft block or coach per severity
10. verification-before-completion checks acceptance_criteria
11. Downstream review workflows consume the contract for alignment checks
```

---

## 4. Intent Contract

**Schema:** `docs/schemas/intent-contract.schema.json`  
**Storage:** `.conductor/intent-contract.yaml` (per repo) or `.conductor/contracts/<id>.yaml` (history)

### 4.1 Field rules

- `original_ask`: max 500 chars, one sentence, no bullet lists
- `in_scope`: 1–12 items, each independently testable
- `out_of_scope`: explicit negatives prevent model invention
- `constraints`: must cite `source`; critical constraints trigger hard drift alerts
- `acceptance_criteria`: every item must be `testable: true` for implementation tasks
- `pivot_log`: append-only; never mutate frozen fields without log entry

### 4.2 Contract lifecycle

| State | Description |
|-------|-------------|
| `draft` | Conductor proposed, not frozen |
| `frozen` | User approved, immutable except via pivot |
| `superseded` | New contract replaces; link via `parent_contract_id` |
| `completed` | All AC met, archived |

---

## 5. Drift Scoring Rubric

**Overall drift score:** 0–100 (0 = aligned, 100 = severe drift)

| Category | Weight | Signals |
|----------|--------|---------|
| **Scope creep** | 35% | Files/features outside `in_scope`; new deps not listed |
| **Constraint violation** | 35% | Breaks `critical`/`high` constraint rules |
| **AC divergence** | 20% | Work doesn't advance testable AC |
| **Undocumented pivot** | 10% | User message changes scope without `pivot_log` entry |

### 5.1 Thresholds (default)

| Score | Action |
|-------|--------|
| 0–25 | Proceed silently |
| 26–50 | Info: "Drift trending" |
| 51–70 | Warn: show diff vs contract |
| 71–85 | Soft block: confirm to continue |
| 86–100 | Hard block on `critical` constraints only |

Configurable via `.conductor/config.yaml`.

### 5.2 Drift detection methods (phased)

| Phase | Method |
|-------|--------|
| 2a | Keyword + path heuristics (new `api/`, `websocket`, etc.) |
| 2b | Diff stat vs `in_scope` / `out_of_scope` |
| 3 | Memory index retrieval of prior contracts |
| 4 | Optional: LLM-assisted classification (local, user API key) |

**v1 does not require LLM for drift** — rule-based first (deterministic).

---

## 6. Prompt Coach

### 6.1 Pattern library

| Pattern ID | Detection heuristic | Coaching template |
|------------|---------------------|-------------------|
| `product_stack` | ≥2 product names as comparators | Narrow to one workflow |
| `comparative_overload` | >2 "like X" phrases | Pick one reference or describe without comparators |
| `scope_adverb` | `just`, `quickly`, `simply`, `only` + large ask | Remove minimizer; list explicit boundaries |
| `implicit_pivot` | `actually`, `also`, `while we're at it` | Confirm pivot → update contract |
| `authority_without_spec` | `you know`, `the usual`, `standard` | State explicit requirements |
| `constraint_conflict` | Ask contradicts loaded constraint file | Quote conflicting rule |
| `vague_ask` | <20 chars or no verb/object | Who/what/when format |
| `missing_acceptance_criteria` | No testable outcome stated | Propose 2–3 AC |

### 6.2 Prompt quality score

```
score = 100
  - 15 per pattern detected (max -60)
  - 10 if original_ask < 20 chars
  - 10 if in_scope empty
  + 5 if user provided acceptance criteria unprompted
```

Show coaching when `score < 60` or any `constraint_conflict`.

---

## 7. Memory Index (Phase 3)

**Design:** Lightweight file-backed index - no vector DB v1.

### 7.1 File layout

```
.conductor/
├── config.yaml
├── intent-contract.yaml          # active contract
├── contracts/                    # history
│   └── ic-20260617-a3f9k2.yaml
├── index.md                      # MEMORY.md-style pointer file
└── drift-log.jsonl               # append-only events
```

### 7.2 Index format (`index.md`)

```markdown
# Conductor Index

## Active
- [intent-contract.yaml](./intent-contract.yaml) — CSV export (frozen 2026-06-17)

## Constraints
- [AGENTS.md](../AGENTS.md)
- [CLAUDE.md](../CLAUDE.md)

## Recent pivots
- ic-20260617-a3f9k2: none
```

### 7.3 Retrieval

On session start: read `index.md` → load active contract + constraint files.  
On drift check: compare git diff + conversation summary against contract (no embedding).

---

## 8. Integrations

### 8.1 Superpowers

**New skills (this repo → eventual upstream PR):**

| Skill | Trigger | Hard gate? |
|-------|---------|------------|
| `intent-contract` | Before brainstorming / implementation | Yes — contract must exist |
| `drift-guard` | Handoff boundaries | No — warns/blocks per config |
| `prompt-coach` | Low prompt quality score | Soft |

**Hook order:**

```
intent-contract → brainstorming → writing-plans → TDD → drift-guard → verification-before-completion
```

See `integrations/superpowers/README.md`.

### 8.2 Downstream Pipeline Integration

| Workflow | Integration |
|----------|-------------|
| Session intake | Calls Conductor CLI/skill before implementation |
| Planning | Reads contract metadata when product-specific IDs are present |
| Implementation | Plans reference `contract_id` + AC ids |
| Alignment review | Uses contract as spec instead of guessing from README |
| Aggregation | Optional extra score: Conductor drift score at review time |

Import: `npm install @vaultcompass/conductor-schema` or git submodule.

See `integrations/downstream-pipeline/README.md`.

### 8.3 Cursor

- Read `.cursor/rules/*` as `source: cursor-rules`
- Document manual setup: user rule points to Conductor skill
- v2: optional hook on save (out of scope v1)

See `integrations/cursor/README.md`.

---

## 9. CLI Specification (Phase 4)

```bash
conductor init                    # Create .conductor/ skeleton
conductor contract draft          # Interactive or stdin → draft YAML
conductor contract freeze         # Mark frozen, validate schema
conductor contract validate       # JSON Schema check
conductor coach "user message"    # Prompt quality + suggestions
conductor drift                   # Score current diff vs active contract
conductor drift --ci              # Exit 1 if score > threshold (CI)
conductor pivot "description"     # Append to pivot_log
conductor history                 # List contracts
```

**Language:** TypeScript (Node 20+) - matches the rest of this repo.
**Alternative:** Rust CLI later if performance needed (not v1).

---

## 10. Package Structure

```
conductor/
├── packages/
│   ├── schema/           # JSON Schema + validators
│   ├── core/             # Extract, coach, drift engines
│   ├── cli/              # Commander.js CLI
│   ├── skill/            # Superpowers SKILL.md files
│   └── memory/           # Index read/write
├── integrations/
│   ├── superpowers/
│   ├── cursor/
│   └── downstream-pipeline/
├── examples/
│   └── intent-contracts/
├── docs/
└── tests/
```

---

## 11. Security and Privacy

- All processing local-first
- No telemetry v1
- Public repo: synthetic examples only
- `drift-log.jsonl` may contain file paths — gitignore by default
- Never upload contracts to cloud without explicit opt-in (v2)

---

## 12. Success Metrics

| Metric | Target (8 weeks post Phase 2) |
|--------|-------------------------------|
| Drift catches per active project | ≥ 1/week |
| Rework "not what I meant" turns | -50% |
| Sessions with frozen contract | > 80% |
| False positive drift rate | < 30% |
| Alignment review score delta | +10 pts with contract |
| Superpowers skill installs | > 0 external (qualitative v1) |

---

## 13. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Alert fatigue | Default thresholds conservative; snooze; handoff-only mode |
| Schema churn pre-1.0 | Semver, changelog, migration guide |
| Solo maintainer | Focus v1 on schema + skill; defer CLI polish |
| Cursor ships native spec mode | Open schema standard; multi-platform |
| Private product-data leakage | Public/downstream split documented in repo-strategy.md |

---

## 14. Implementation Phases

See `docs/phases/implementation-roadmap.md` for week-by-week tasks.

| Phase | Weeks | Exit gate |
|-------|-------|-----------|
| 1 Schema | 1–2 | 3 real sessions scorable manually |
| 2 Runtime | 3–6 | 1 drift catch on validation project |
| 3 Memory | 7–10 | Cross-session drift on day 5+ |
| 4 Publish | 11–14 | External install docs work |

---

## 15. Approval

**Review this spec.** Reply:

- `approve` — proceed to implementation plan
- `changes: ...` — revise and re-review

**After approval:** invoke Superpowers `writing-plans` → `docs/plans/2026-06-17-conductor-implementation-plan.md`

---

## Appendix A: Mapping from Earlier Internal Assets

| Earlier asset | Conductor equivalent |
|---------------|----------------------|
| Session governance mode | `integrations/downstream-pipeline` |
| drift-resistant template guardrails | `constraints[]` + drift rubric |
| alignment review | Downstream consumer of contract |
| audit gold standards | Phase 5+ optional module |
| memory system design | `.conductor/index.md` |

## Appendix B: Glossary

See `docs/brainstorming/01-context-and-problem.md` § Core vocabulary.

---

**End of design specification**
