# Conductor — agent playbook

**Repo:** `github.com/vaultcompasshq/conductor` (public OSS, MIT)  
**Tag:** `v0.1.0-alpha`  
**Workspace:** Open `/Users/melroysaldanha/Projects/conductor` — not Vault & Compass LLC.

Conductor is the **intent fidelity layer** for AI-assisted development: Intent Contract schema, prompt coaching, drift scoring. It feeds into Superpowers and AI Venture Studio; it does not replace them.

---

## Read order (cold start)

| # | File | Purpose |
|---|------|---------|
| 1 | [docs/NEXT.md](./docs/NEXT.md) | **Cold-start handoff — start here.** Current state + what's next |
| 2 | [docs/TODO.md](./docs/TODO.md) | File-level task backlog |
| 3 | [docs/cli-reference.md](./docs/cli-reference.md) | Every CLI and its flags |
| 4 | [README.md](./README.md) | What Conductor is, package layout, dev commands |
| 5 | [docs/superpowers/specs/2026-06-17-conductor-design.md](./docs/superpowers/specs/2026-06-17-conductor-design.md) | Approved product spec |
| 6 | [docs/phases/implementation-roadmap.md](./docs/phases/implementation-roadmap.md) | 14-week plan |

Phase 1 reference (complete): [docs/superpowers/plans/2026-06-17-conductor-phase1.md](./docs/superpowers/plans/2026-06-17-conductor-phase1.md)

---

## Phase status

| Phase | Weeks | Status |
|-------|-------|--------|
| 1 — Schema + core | 1–2 | ✅ Complete |
| 2 — Runtime + skills | 3–6 | ✅ Complete (`packages/skill`, CLIs, config, init) |
| 3a — Correction log + brief | — | ✅ Complete (PR #4) |
| Hardening — generic scorer, gate, approval | — | ✅ Complete (PRs #1, #3, #5) |
| 3 — Memory-index persistence | 7–10 | ✅ Core complete (`history`, generated index, resume, pivot, cross-session drift) |
| 3b — decay/dedup, LLM normalization | — | Deferred |
| 4 — Unified CLI + public release | 11–14 | Planned |

**Resuming work? Read [docs/NEXT.md](./docs/NEXT.md) (cold-start handoff) and
[docs/TODO.md](./docs/TODO.md) first.**

---

## Packages

```
packages/
├── schema/     # @vaultcompasshq/conductor-schema — AJV validator + types ✅
├── core/       # @vaultcompasshq/conductor-core — coach, drift, gate, correction, brief, history ✅
├── skill/      # Superpowers skills + 11 CLIs (coach/extract/freeze/check/drift/correct/brief/init/index/pivot/resume) ✅
├── cli/        # unified conductor binary (Phase 4 — not built)
└── memory/     # separate package deferred; file memory lives in core
```

CLIs are documented in [docs/cli-reference.md](./docs/cli-reference.md).
Lifecycle: coach → extract (draft) → **freeze (approve)** → check (gate) →
pivot/correct → brief/resume.

---

## Current work

The Phase 3 core build is complete: frozen contracts archive to
`.conductor/contracts/`, `index.md` is generated from real data, resume emits a
Session Brief, pivots are logged, and `conductor-check` can surface prior-contract
drift. Next work is dogfood/tuning, Phase 3b, and unified CLI polish.

**Skills shipped:** `intent-contract`, `prompt-coach`, `drift-guard`,
`capture-correction` (`packages/skill/*/SKILL.md`).

**Process:** Use Superpowers `writing-plans` before implementing a multi-step
task. All work lands on `main` via PR (never push to main); CI must be green.

---

## Verification

```bash
pnpm install
pnpm test      # 77 tests — schema (7) + core (41) + skill (20) + examples/integrations (9)
pnpm build
pnpm typecheck
```

`pnpm test` builds first (the skill CLI tests spawn the compiled `dist/`).

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
