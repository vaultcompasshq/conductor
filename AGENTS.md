# Conductor — agent playbook

**Repo:** `github.com/vaultcompasshq/conductor` (public OSS, MIT)  
**Tag:** `v0.1.0-alpha`  
**Workspace:** Open `/Users/melroysaldanha/Projects/conductor` — not Vault & Compass LLC.

Conductor is the **intent fidelity layer** for AI-assisted development: Intent Contract schema, prompt coaching, drift scoring. It feeds into Superpowers and AI Venture Studio; it does not replace them.

---

## Read order (cold start)

| # | File | Purpose |
|---|------|---------|
| 1 | [README.md](./README.md) | What Conductor is, package layout, dev commands |
| 2 | [BRAINSTORMING.md](./BRAINSTORMING.md) | Session index, key decisions |
| 3 | [docs/superpowers/specs/2026-06-17-conductor-design.md](./docs/superpowers/specs/2026-06-17-conductor-design.md) | Approved product spec |
| 4 | [docs/phases/implementation-roadmap.md](./docs/phases/implementation-roadmap.md) | 14-week plan |
| 5 | [docs/NEXT.md](./docs/NEXT.md) | Current phase handoff — **start here for task work** |

Phase 1 reference (complete): [docs/superpowers/plans/2026-06-17-conductor-phase1.md](./docs/superpowers/plans/2026-06-17-conductor-phase1.md)

---

## Phase status

| Phase | Weeks | Status |
|-------|-------|--------|
| 1 — Schema + core | 1–2 | ✅ Complete |
| 2 — Runtime + skills | 3–6 | ✅ Complete (`packages/skill`, CLIs, config, init) |
| 3 — Memory index | 7–10 | 🔜 Next |
| 4 — CLI + public release | 11–14 | Planned |

---

## Packages

```
packages/
├── schema/     # @vaultcompasshq/conductor-schema — AJV validator + types ✅
├── core/       # @vaultcompasshq/conductor-core — coach, drift, rubric ✅
├── skill/      # Superpowers-compatible skills (Phase 2) — not started
├── cli/        # conductor CLI (Phase 4)
└── memory/     # Project constraint index (Phase 3)
```

---

## Phase 2 scope (current work)

**Goal:** Superpowers skills wired to `packages/core` and `packages/schema`.

| Skill | Package path | Integration doc |
|-------|--------------|-----------------|
| `intent-contract` | `packages/skill/intent-contract/SKILL.md` | [integrations/superpowers/README.md](./integrations/superpowers/README.md) |
| `prompt-coach` | `packages/skill/prompt-coach/SKILL.md` | same |
| `drift-guard` | `packages/skill/drift-guard/SKILL.md` | same |

**Also Phase 2 (later weeks):**

- `packages/core/extract.ts` — draft contract from text + constraint files
- Constraint loader (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`)
- EngineeringAgents wiring — [integrations/ai-venture-studio/README.md](./integrations/ai-venture-studio/README.md) (separate repo PR)

**Process:** Use Superpowers `writing-plans` to produce a Phase 2 plan (like Phase 1) before implementing.

---

## Verification

```bash
pnpm install
pnpm test      # 14 tests — schema (3) + core (6) + examples (5)
pnpm build
pnpm typecheck
```

Paste actual test output before claiming tests pass.

---

## Boundaries

- **Do not** add Conductor code to Vault & Compass LLC workspace or EngineeringAgents in this repo — integration docs only; wiring happens in those repos (Phase 2 week 5+).
- **Do not** copy skills to `~/.cursor/skills-cursor/` from here until `packages/skill` exists and is stable.
- Per-project `.conductor/intent-contract.yaml` lives in **app repos** (Sheetful, etc.), not in this repo.
- Examples and schema live here; dogfood targets are external.

---

## Related repos (paths only — not required in workspace)

| Path | Role |
|------|------|
| `~/Projects/Engineering/EngineeringAgents` | Phase 2 integration (Agent #0 session mode, #4f) |
| `~/Projects/Vault & Compass LLC/` | Dogfood targets later (Sheetful, etc.) |
| `~/Projects/vaultcompasshq/` | HQ meta repo (mostly empty) |

---

## License

MIT — see [LICENSE](./LICENSE)
