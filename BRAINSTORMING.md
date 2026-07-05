# Conductor Design Notes

**Date:** 2026-06-17  
**Participants:** Initial design session
**Outcome:** Design spec approved — Phase 1 complete (schema + core)  
**Repository:** `github.com/vaultcompasshq/conductor`

---

## Session goal

Design an installable governance layer that:

1. Converts user conversation → deterministic **Intent Contract**
2. Coaches users when prompting style causes scope explosion
3. Detects drift from original intent during multi-turn / multi-agent work
4. Audits against `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and project docs
5. Integrates with Superpowers and common coding-assistant workflows
6. Works across Claude, Codex, and Gemini

---

## Session documents (read in order)

| # | Document | Status |
|---|----------|--------|
| 0 | [00-session-overview.md](./docs/brainstorming/00-session-overview.md) | Complete |
| 1 | [01-context-and-problem.md](./docs/brainstorming/01-context-and-problem.md) | Complete |
| 2 | [02-competitive-analysis.md](./docs/brainstorming/02-competitive-analysis.md) | Complete |
| 3 | [03-approaches-and-recommendation.md](./docs/brainstorming/03-approaches-and-recommendation.md) | Complete |
| 4 | [04-open-questions.md](./docs/brainstorming/04-open-questions.md) | Defaults accepted |
| - | [2026-06-17-conductor-design.md](./docs/superpowers/specs/2026-06-17-conductor-design.md) | Approved |
| - | [2026-06-17-conductor-phase1.md](./docs/superpowers/plans/2026-06-17-conductor-phase1.md) | Phase 1 shipped |
| - | [repo-strategy.md](./docs/repo-strategy.md) | Complete |
| - | [implementation-roadmap.md](./docs/phases/implementation-roadmap.md) | Complete |

---

## Key decisions (session output)

### Repository

- **Public** under `vaultcompasshq/conductor` (MIT)
- Validation through downstream integrations
- Skills contributed upstream to Superpowers when stable

### Product shape

- **Intent Contract** = canonical artifact (schema in `docs/schemas/`)
- **Conductor** = session governance layer for assistant-driven development

### Build order (14 weeks)

1. Intent Contract schema + drift rubric (weeks 1–2)
2. Conductor runtime + host integration samples (weeks 3–6)
3. Project memory / RAG-lite (weeks 7–10)
4. Public skill + CLI extraction (weeks 11–14)

### Unique wedge

**Prompt variance debugger** — audit how the user talked to the model, not just the code output.

---

## Status

- Spec approved (2026-06-17)
- Repo live: https://github.com/vaultcompasshq/conductor
- Phase 1 complete: `@vaultcompasshq/conductor-schema`, `@vaultcompasshq/conductor-core`, 5 example contracts
- Phase 2 complete: `@vaultcompasshq/conductor-skill`, runtime CLIs
- Current baseline: 85 tests passing across schema, core, skill, cli, examples, and integrations

## Next step

Publish/tag execution, Phase 3b correction-memory hygiene, and runtime validation. See [docs/NEXT.md](./docs/NEXT.md).
