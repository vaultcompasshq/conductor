# Conductor

**Intent fidelity for AI-assisted development** — across Claude, Codex, Gemini, and Cursor.

Conductor sits *above* foundation models and *below* your product code. It turns messy conversation into a frozen **Intent Contract**, coaches users when prompts cause scope explosion, and detects drift before bad code ships.

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

**Phase:** Phase 1 implementation (schema + core) — June 2026  
**Repository:** https://github.com/vaultcompasshq/conductor (public, MIT)  
**Relationship:** Feeder into AI Venture Studio — not a competitor

## Start here

| Doc | Purpose |
|-----|---------|
| [BRAINSTORMING.md](./BRAINSTORMING.md) | Session index — read this first |
| [docs/repo-strategy.md](./docs/repo-strategy.md) | Public vs private, licensing, org placement |
| [docs/superpowers/specs/2026-06-17-conductor-design.md](./docs/superpowers/specs/2026-06-17-conductor-design.md) | Approved design spec (review gate) |
| [docs/phases/implementation-roadmap.md](./docs/phases/implementation-roadmap.md) | 14-week build plan |
| [docs/superpowers/plans/2026-06-17-conductor-phase1.md](./docs/superpowers/plans/2026-06-17-conductor-phase1.md) | **Active** Phase 1 plan |

## What Conductor is / isn't

| Is | Isn't |
|----|-------|
| Governance layer for AI coding sessions | A foundation model or fine-tune |
| Intent Contract + drift detection | A full autonomous coding agent |
| User prompt coaching | Replacement for Superpowers or Venture Studio |
| Multi-model (Claude, Codex, Gemini) | Cursor-only or single-vendor lock-in |

## Planned packages (not built yet)

```
conductor/
├── packages/
│   ├── schema/          # Intent Contract JSON Schema
│   ├── skill/           # Superpowers-compatible skills
│   ├── cli/             # conductor contract | drift | coach
│   └── memory/          # Project constraint index (RAG-lite)
├── integrations/
│   ├── superpowers/
│   ├── cursor/
│   └── ai-venture-studio/
└── docs/
```

## Origin

Evolved from Agent #0 (Conductor) in EngineeringAgents, drift-resistant agent template, Agent #4f idea-alignment audit, and Superpowers process skills. See [docs/brainstorming/01-context-and-problem.md](./docs/brainstorming/01-context-and-problem.md).

## License

MIT — see [LICENSE](./LICENSE)
