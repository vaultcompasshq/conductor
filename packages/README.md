# Packages

| Package | NPM name | Status | Description |
|---------|----------|--------|-------------|
| `schema/` | `@vaultcompass/conductor-schema` | Stable | Intent Contract JSON Schema v1.0.0, TypeScript types, and Ajv validation (`validateIntentContract`, `assertValidIntentContract`) |
| `core/` | `@vaultcompass/conductor-core` | Stable | Prompt coach, extraction, drift scoring, gate, correction log, brief, history, and memory index |
| `memory/` | - | Deferred | Separate package deferred; file-backed memory currently lives in `core/` |
| `cli/` | `@vaultcompass/conductor-cli` | Unified CLI | `conductor <subcommand>` binary |
| `skill/` | `@vaultcompass/conductor-skill` | Stable | Superpowers skills and legacy per-command CLIs |

See [implementation roadmap](../docs/phases/implementation-roadmap.md) for the full 14-week plan.
