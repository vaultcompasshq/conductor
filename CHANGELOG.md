# Changelog

All notable changes to Conductor will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **Unified CLI beta package.** Added `@vaultcompasshq/conductor-cli` with the
  public `conductor <subcommand>` binary wrapping the existing command surface:
  `init`, `coach`, `extract`, `freeze`, `check`, `drift`, `correct`, `brief`,
  `resume`, `index`, and `pivot`. Added top-level `--help` and `--version`.
- **CI drift mode.** `conductor drift --ci` now exits `1` when the drift JSON has
  `block: true`, making lower-level drift scoring usable in GitHub Actions and
  other CI jobs.
- **Release smoke checks.** Added `pnpm release:smoke`, which packs schema,
  core, skill, and CLI tarballs locally and verifies required files plus packed
  dependency ranges.
- **Dependency audit cleanup.** Added a pnpm override for patched `esbuild` so
  `pnpm audit --audit-level low` is clean.
- **Production-readiness dogfood.** Added
  `docs/dogfood/production-readiness-2026-07-04.md`, covering unified CLI,
  resume, correction, pivot, archive, prior-contract drift, and `drift --ci`.

- **Real freeze/approval step (dogfood finding #2).** `conductor-extract` now
  writes an unfrozen draft only; approval is a separate `conductor-freeze`
  command that records an attributable `approval` block (approved_by /
  approved_at / method). On a TTY it shows a summary and asks to confirm;
  non-interactively it refuses unless `--approved-by <name>` is given, so an
  agent cannot self-approve. `isContractFrozen` now requires the approval
  record (not just `frozen_by: user`), closing the "hard gate" loophole.

- **Phase 3a — Correction Log + Session Brief.** `correction_log` on the Intent
  Contract (schema + types) captures agent mistakes the user corrected as
  durable rules. `conductor-correct` records them (pending by default;
  `--acknowledge` to confirm, `--promote` to mirror into `constraints[]` as a
  `user-correction` rule the drift scorer enforces — off by default).
  `conductor-brief` emits the minimal correct-methodology context (intent,
  scope, AC, constraints, acknowledged corrections, no failed code) to
  re-inject after a context reset. New `capture-correction` skill. Conservative
  defaults per the design spec: no auto-promote, separate from `pivot_log`,
  append-only. See `docs/superpowers/specs/2026-06-20-correction-log-and-brief.md`.
- Constraint-loader precision fix: `extractConstraintsFromMarkdown` now requires
  normative language / leading prohibitions / rules-section bullets and skips
  tables, links, and code fences (real AGENTS.md: 12 bogus rules → 4 real ones).
  Resolves dogfood finding #1.

- `conductor-check` CLI + `checkGate()` — a real enforcement gate that exits
  non-zero when no frozen contract exists or staged changes drift past a
  blocking threshold (vs. advisory SKILL.md). Sample git pre-commit hook in
  `integrations/git-hooks/pre-commit.sample`.
- `packages/core/src/tokenize.ts` — generic, domain-agnostic token matching.
- `packages/skill/tests/cli.test.ts` — integration tests for all five CLIs
  (previously zero coverage on the skill package).
- Drift generality tests (`packages/core/tests/drift-generality.test.ts`) on a
  novel contract the scorer was never tuned against.
- GitHub Actions CI (`.github/workflows/ci.yml`): typecheck + build + test.

### Changed

- **Drift scorer rebuilt** to be project-independent. Removed the five
  fixture-specific path regexes and four hardcoded signal strings that only
  fired on the NetViz example. Matching now derives entirely from the
  contract's own `in_scope` / `out_of_scope` / `constraints` text, with
  in-scope-token subtraction to suppress false positives and a severity floor
  so a single out-of-scope or critical-constraint hit can block. `--signals`
  is now documented as open-vocabulary free text.
- Root `pnpm test` now builds first (skill CLI tests run the compiled `dist/`).

### Fixed

- Prohibition clauses such as "Do not add new API endpoints" no longer leak
  into `in_scope`, and overlapping prohibition matches are deduped in
  `out_of_scope`. This fixes a dogfood case where prior-contract drift was
  masked by in-scope token subtraction.
- Corrected test-count claims across README / NEXT / AGENTS (was "29"/"14",
  actual is 39: schema 3 + core 22 + skill 8 + examples 6).
- Tightened README multi-model / Venture Studio language to reflect that those
  integrations are design-stage, not shipped.

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
