# Changelog

All notable changes to Conductor will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.2.0-beta] - 2026-06-17

### Added

- `@vaultcompasshq/conductor-skill` — Superpowers skills (`intent-contract`, `prompt-coach`, `drift-guard`)
- Helper CLIs: `conductor-coach`, `conductor-extract`, `conductor-drift`, `conductor-init`
- Root scripts: `pnpm conductor:coach`, `conductor:extract`, `conductor:drift`, `conductor:init`, `conductor:install-skills`
- Core runtime: `extract.ts`, `constraints.ts` (incl. `.cursor/rules`), `config.ts`, `init.ts`, `drift-log.ts`
- `.conductor/` directory spec — `docs/schemas/directory-layout.md`
- Phase 2 dogfood retrospective — `docs/dogfood/phase2-retrospective.md`
- Example contract `examples/intent-contracts/conductor-phase2.yaml`
- `integrations/superpowers/install-skills.sh`

### Changed

- Drift scorer: configurable thresholds, CLI path detection, keyword matching, critical hard-block at 86+

### Tests

- 29 passing (18 core + 3 schema + 6 examples)

## [0.1.0-alpha] - 2026-06-17

### Added

- `@vaultcompasshq/conductor-schema` package — Intent Contract JSON Schema v1.0.0 with Ajv validation
- `@vaultcompasshq/conductor-core` package — prompt coach and drift scoring engines
- 5 example intent contracts in `examples/intent-contracts/`
- NetViz retrospective exit gate (drift score 83)
- Phase 1 implementation plan (`docs/superpowers/plans/2026-06-17-conductor-phase1.md`)
- GitHub repository: https://github.com/vaultcompasshq/conductor
- Brainstorming session and design documentation (2026-06-17)
- Competitive analysis and repo strategy
- 14-week implementation roadmap
- Integration guides: Superpowers, AI Venture Studio, Cursor

## [0.0.0] - 2026-06-17

- Repository initialized — design phase only
