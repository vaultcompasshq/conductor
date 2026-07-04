# Implementation Roadmap

**Date:** 2026-06-17 (status banner updated 2026-06-27)
**Total duration:** 14 weeks  
**Prerequisite:** Design spec approved

> **Status:** Phases 1 & 2 complete. Plus, beyond the original plan: a generic
> (project-independent) drift scorer, the `conductor-check` enforcement gate, a
> real freeze/**approval** step, and Phase **3a** (correction log + session
> brief). 65 tests passing. **Next:** memory-index persistence (Phase 3 core).
> Live status: [../NEXT.md](../NEXT.md) · backlog: [../TODO.md](../TODO.md).

---

## Phase 1: Intent Contract Foundation (Weeks 1–2)

### Week 1

| Task | Output |
|------|--------|
| Finalize JSON Schema | `packages/schema/intent-contract.schema.json` |
| Schema validator (ajv) | `packages/schema/validate.ts` |
| 5 synthetic example contracts | `examples/intent-contracts/` |
| Drift rubric as code constants | `packages/core/rubric.ts` |
| Prompt pattern library | `packages/core/coach-patterns.ts` |

### Week 2

| Task | Output |
|------|--------|
| Manual scoring worksheet | Score 3 past sessions (NetViz, Tier 0, drift session) |
| `.conductor/` directory spec | `docs/schemas/directory-layout.md` |
| Config file schema | `.conductor/config.yaml` example |
| Unit tests for validator + rubric | `tests/schema.test.ts` |

**Exit gate:** NetViz-style session would score >70 drift retrospectively.

---

## Phase 2: Conductor Runtime (Weeks 3–6)

### Week 3

| Task | Output |
|------|--------|
| `packages/core/extract.ts` — draft contract from text + files | |
| Constraint file loader (AGENTS.md, CLAUDE.md, GEMINI.md) | |
| `packages/skill/intent-contract/SKILL.md` draft | |

### Week 4

| Task | Output |
|------|--------|
| `packages/core/coach.ts` — prompt quality score | |
| `packages/skill/prompt-coach/SKILL.md` | |
| `packages/core/drift.ts` — rule-based diff scorer | |

### Week 5

| Task | Output |
|------|--------|
| `packages/skill/drift-guard/SKILL.md` | |
| `integrations/superpowers/README.md` + install guide | |
| `integrations/ai-venture-studio/README.md` | |
| Wire Agent #4f to read `.conductor/intent-contract.yaml` | PR in EngineeringAgents |

### Week 6

| Task | Output |
|------|--------|
| Dogfood on EngineeringAgents + one Tier 0 project | |
| Tune thresholds from false positives | |
| `drift-log.jsonl` writer | |

**Exit gate:** ≥1 real drift catch in dogfood; false positive rate <40%.

---

## Phase 3: Memory Index (Weeks 7–10)

### Week 7–8

| Task | Output |
|------|--------|
| `packages/memory/index.ts` — read/write `index.md` | |
| Contract history in `.conductor/contracts/` | |
| Session resume: load active contract on `conductor init` | |

### Week 9–10

| Task | Output |
|------|--------|
| Cross-session drift ("Tuesday scope vs Friday diff") | |
| Agent #0 session mode in Venture Studio | |
| Memory integration tests | |

**Exit gate:** New session on day 5+ correctly references prior contract.

---

## Phase 4: Public Release (Weeks 11–14)

### Week 11–12

| Task | Output |
|------|--------|
| `packages/cli` — init, validate, coach, drift | |
| `conductor --help` documentation | |
| Polish Superpowers skills for external install | |

### Week 13

| Task | Output |
|------|--------|
| Create `github.com/vaultcompasshq/conductor` | |
| README, CONTRIBUTING, CHANGELOG | |
| MIT LICENSE, CI (schema tests only) | |
| `integrations/cursor/README.md` | |

### Week 14

| Task | Output |
|------|--------|
| Tag `v0.3.0-beta` | |
| Dogfood report doc | |
| Decide Superpowers upstream PR timing | |
| Optional: `conductor drift --ci` GitHub Action example | |

**Exit gate:** Fresh clone + skill install works without Venture Studio.

---

## Phase 5+ (Post-v1, optional)

| Item | Effort |
|------|--------|
| Agent #0 audit gold standards port | 5 weeks |
| LLM-assisted drift classification | 2 weeks |
| Team dashboard | 3 weeks |
| npm publish `@vaultcompasshq/conductor-cli` | 1 week |
| Superpowers upstream PR | 1 week |

---

## Dependencies

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
                │
                └──► EngineeringAgents PR (Agent #4f, #0)
```

No phase starts before previous exit gate passes.

---

## Resource estimate

| Phase | Dev time | Your review time |
|-------|----------|------------------|
| 1 | 20–30 hrs | 3 hrs |
| 2 | 40–50 hrs | 5 hrs |
| 3 | 25–35 hrs | 3 hrs |
| 4 | 30–40 hrs | 4 hrs |
| **Total** | **~120–155 hrs** | **~15 hrs** |

---

## Kill criteria (any phase)

- False positives > 40% after tuning
- Zero drift catches by end of Phase 2
- You bypass Conductor >50% of sessions
- Maintenance burden > 4 hrs/week without measurable rework reduction
