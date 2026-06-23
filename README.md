# Conductor

**Intent fidelity for AI-assisted development.**

Conductor sits *above* foundation models and *below* your product code. It turns messy conversation into a frozen **Intent Contract**, coaches users when prompts cause scope explosion, and detects drift before bad code ships.

The Intent Contract is a plain YAML file, so any model that can read a file (Claude, Codex, Gemini) can consume it. Today the enforcement surfaces that ship are the `conductor-check` gate (pre-commit / CI) and the Cursor/Claude skills; deeper Codex, Gemini, and Venture Studio wiring is **design-stage** — see [integrations/](./integrations).

```
User conversation (messy)
        ↓
   Conductor layer          ← intent contract, drift guard, prompt coach
        ↓
   Superpowers / agents     ← brainstorming, TDD, build, review
        ↓
   Shipped product
```

## Status

**Phase:** Phase 2 complete — June 2026  
**Repository:** https://github.com/vaultcompasshq/conductor (public, MIT)  
**Relationship:** Feeder into AI Venture Studio — not a competitor

**Packages:** `packages/schema` · `packages/core` · `packages/skill` · **39 tests passing**

## Start here

| Doc | Purpose |
|-----|---------|
| [AGENTS.md](./AGENTS.md) | Agent rules, phase status, verification |
| [docs/NEXT.md](./docs/NEXT.md) | Phase 2 handoff — current task work |
| [BRAINSTORMING.md](./BRAINSTORMING.md) | Session index — read this first |
| [docs/repo-strategy.md](./docs/repo-strategy.md) | Public vs private, licensing, org placement |
| [docs/superpowers/specs/2026-06-17-conductor-design.md](./docs/superpowers/specs/2026-06-17-conductor-design.md) | Approved design spec (review gate) |
| [docs/phases/implementation-roadmap.md](./docs/phases/implementation-roadmap.md) | 14-week build plan |
| [docs/superpowers/plans/2026-06-17-conductor-phase1.md](./docs/superpowers/plans/2026-06-17-conductor-phase1.md) | Phase 1 plan (complete) |

## What Conductor is / isn't

| Is | Isn't |
|----|-------|
| Governance layer for AI coding sessions | A foundation model or fine-tune |
| Intent Contract + drift detection | A full autonomous coding agent |
| User prompt coaching | Replacement for Superpowers or Venture Studio |
| Multi-model (Claude, Codex, Gemini) | Cursor-only or single-vendor lock-in |

## Packages

```
conductor/
├── packages/
│   ├── schema/          # @vaultcompasshq/conductor-schema ✅
│   ├── core/            # @vaultcompasshq/conductor-core ✅
│   ├── skill/           # Superpowers skills + CLIs incl. conductor-check ✅
│   ├── cli/             # unified conductor binary (Phase 4 — not built)
│   └── memory/          # project constraint index (Phase 3 — not built)
├── integrations/
│   ├── superpowers/     # skills + install script ✅
│   ├── git-hooks/       # pre-commit gate sample ✅
│   ├── cursor/          # design notes
│   └── ai-venture-studio/  # design notes
└── docs/
```

The enforcement gate (`conductor-check`) returns a non-zero exit code when no
frozen contract exists or staged changes drift past a blocking threshold — the
one place Conductor *enforces* rather than *suggests*. Wire it via
[integrations/git-hooks/pre-commit.sample](./integrations/git-hooks/pre-commit.sample)
or a CI step.

## Development

```bash
pnpm install
pnpm test      # 39 tests (builds first, then schema + core + skill + examples)
pnpm build
pnpm conductor:install-skills   # copy skills to ~/.cursor/skills
pnpm conductor:check -- --project . --staged   # enforcement gate
```

## Origin

Evolved from Agent #0 (Conductor) in EngineeringAgents, drift-resistant agent template, Agent #4f idea-alignment audit, and Superpowers process skills. See [docs/brainstorming/01-context-and-problem.md](./docs/brainstorming/01-context-and-problem.md).

## License

MIT — see [LICENSE](./LICENSE)
