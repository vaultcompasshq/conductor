# Conductor — Brainstorming Session

**Date:** 2026-06-17  
**Participants:** Melroy + AI design session  
**Outcome:** Design spec written — awaiting human review before implementation  
**Location:** `/Users/melroysaldanha/Projects/conductor` → `github.com/vaultcompasshq/conductor`

---

## Session goal

Design an installable governance layer that:

1. Converts user conversation → deterministic **Intent Contract**
2. Coaches users when prompting style causes scope explosion
3. Detects drift from original intent during multi-turn / multi-agent work
4. Audits against `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and project docs
5. Integrates with Superpowers, AI Venture Studio, and existing audit agents
6. Works across Claude, Codex, and Gemini

---

## Session documents (read in order)

| # | Document | Status |
|---|----------|--------|
| 0 | [00-session-overview.md](./docs/brainstorming/00-session-overview.md) | ✅ Complete |
| 1 | [01-context-and-problem.md](./docs/brainstorming/01-context-and-problem.md) | ✅ Complete |
| 2 | [02-competitive-analysis.md](./docs/brainstorming/02-competitive-analysis.md) | ✅ Complete |
| 3 | [03-approaches-and-recommendation.md](./docs/brainstorming/03-approaches-and-recommendation.md) | ✅ Complete |
| 4 | [04-open-questions.md](./docs/brainstorming/04-open-questions.md) | 🟡 Needs your answers |
| — | [2026-06-17-conductor-design.md](./docs/superpowers/specs/2026-06-17-conductor-design.md) | ✅ Complete — **review gate** |
| — | [repo-strategy.md](./docs/repo-strategy.md) | ✅ Complete |
| — | [implementation-roadmap.md](./docs/phases/implementation-roadmap.md) | ✅ Complete |

---

## Key decisions (session output)

### Repository

- **Public** under `vaultcompasshq/conductor` (MIT)
- Dogfooding via private Venture Studio integration (submodule or path dep)
- Skills contributed upstream to Superpowers when stable

### Product shape

- **Conductor** = product name (extends Agent #0, broadened scope)
- **Intent Contract** = canonical artifact (schema in `docs/schemas/`)
- **Not** a Venture Studio competitor — upstream prep + session governance layer

### Build order (14 weeks)

1. Intent Contract schema + drift rubric (weeks 1–2)
2. Conductor runtime + Venture Studio hooks (weeks 3–6)
3. Project memory / RAG-lite (weeks 7–10)
4. Public skill + CLI extraction (weeks 11–14)

### Unique wedge

**Prompt variance debugger** — audit how the user talked to the model, not just the code output.

---

## Review gate (required before implementation)

Per Superpowers brainstorming process:

> Spec written at `docs/superpowers/specs/2026-06-17-conductor-design.md`.  
> Please review and confirm before we invoke `writing-plans` and scaffold code.

**Reply with:** approve / changes requested / defer

---

## Next step after approval

1. Invoke `writing-plans` skill → `docs/plans/2026-06-17-conductor-implementation-plan.md`
2. Scaffold `packages/schema`, `packages/skill`, `packages/cli`
3. Wire first integration: Superpowers `intent-contract` skill
4. Dogfood on Tier 0 Vault & Compass projects
