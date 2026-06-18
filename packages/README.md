# Packages

| Package | NPM name | Status | Description |
|---------|----------|--------|-------------|
| `schema/` | `@vaultcompasshq/conductor-schema` | ✅ Phase 1 | Intent Contract JSON Schema v1.0.0, TypeScript types, and Ajv validation (`validateIntentContract`, `assertValidIntentContract`) |
| `core/` | `@vaultcompasshq/conductor-core` | ✅ Phase 1 | Prompt coach (pattern detection, scoring, narrowing) and drift engine (weighted rubric, exit gates) |
| `memory/` | — | Phase 3 | Project constraint index (RAG-lite) |
| `cli/` | — | Phase 4 | `conductor contract \| drift \| coach` binary |
| `skill/` | — | Phase 2–4 | Superpowers-compatible SKILL.md files |

See [implementation roadmap](../docs/phases/implementation-roadmap.md) for the full 14-week plan.
