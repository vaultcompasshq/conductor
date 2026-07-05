# Packages

| Package | NPM name | Status | Description |
|---------|----------|--------|-------------|
| `schema/` | `@vaultcompasshq/conductor-schema` | ✅ Phase 1 | Intent Contract JSON Schema v1.0.0, TypeScript types, and Ajv validation (`validateIntentContract`, `assertValidIntentContract`) |
| `core/` | `@vaultcompasshq/conductor-core` | ✅ Phase 1 | Prompt coach (pattern detection, scoring, narrowing) and drift engine (weighted rubric, exit gates) |
| `memory/` | — | Phase 3 | Project constraint index (RAG-lite) |
| `cli/` | `@vaultcompasshq/conductor-cli` | Unified CLI | `conductor <subcommand>` binary |
| `skill/` | `@vaultcompasshq/conductor-skill` | ✅ Phase 2 | Superpowers skills + `conductor-coach`, `conductor-drift`, `conductor-extract`, `conductor-init` |

See [implementation roadmap](../docs/phases/implementation-roadmap.md) for the full 14-week plan.
