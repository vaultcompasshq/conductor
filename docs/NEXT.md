# Next: Phase 3 — Memory index

**Updated:** 2026-06-17  
**Prerequisite:** Phase 2 complete (`v0.2.0-beta`, 39 tests passing)  
**Roadmap:** [implementation-roadmap.md](./phases/implementation-roadmap.md) weeks 7–10

---

## Phase 2 complete

- `packages/skill` — intent-contract, prompt-coach, drift-guard skills + CLIs
- `packages/core` — extract, constraints, config, init, drift-log
- Dogfood retrospective: [dogfood/phase2-retrospective.md](./dogfood/phase2-retrospective.md)
- Install: `pnpm conductor:install-skills`

**Skipped (by design):** EngineeringAgents wiring, LLC workspace changes.

---

## Phase 3 goal

Lightweight memory index — contract history, session resume, cross-session drift.

See roadmap weeks 7–10:

- `packages/memory/index.ts`
- `.conductor/contracts/` history
- Session resume on init
- Cross-session drift ("Tuesday scope vs Friday diff")

---

## Start prompt

```
Read AGENTS.md and docs/phases/implementation-roadmap.md (Phase 3).
Phase 2 is complete. Start Phase 3 memory index per roadmap weeks 7–10.
Use writing-plans before implementing. Do not touch EngineeringAgents or LLC workspaces.
Verify: pnpm install && pnpm test
```
