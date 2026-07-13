# Changelog

All notable changes to Conductor will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [1.0.7] - 2026-07-13

### Changed

- **Public hygiene pass:** hash-only portfolio guard; generic fixtures and doc
  names (`downstream-app-*`, `stub-detection-*`); remove internal jargon from
  tests; trim decorative source comments; `.cursor/` gitignored.
- **Portfolio guard:** SHA-256 hash blocklist only (vault-guard pattern); slim
  maintainer Cursor rule and CONTRIBUTING prose.
- **Tests:** longer timeouts on spawn-heavy doctor, report, and skill CLI cases.

## [Unreleased]

## [1.0.6] - 2026-07-13

### Changed

- **Public content hygiene:** removed portfolio product names and private-repo links
  from docs, changelog history entries, and dogfood tests; renamed validation
  notes to generic `downstream-app-*` filenames.
- **CI guard:** `pnpm validate:portfolio-names` fails if blocked product names appear
  in tracked files (see [CONTRIBUTING.md](./CONTRIBUTING.md#public-repo-hygiene-portfolio-names)).
- **Cursor rule:** `integrations/cursor/no-portfolio-names.mdc` for maintainers (copy to
  `.cursor/rules/`).

## [1.0.5] - 2026-07-13

### Fixed

- **Drift:** out-of-scope path matching no longer fires on a lone integration token in a
  filename when the prohibition names sensitive qualifiers (e.g. `connect-link-button.tsx`
  vs “third-party production credentials”).
- **Drift:** constraint scoring ignores noise-only token overlaps (`task`, `hooks`,
  `component`, `web`, …) that caused false soft-blocks on large downstream PRs.
- **Extraction:** imperative clauses with embedded prohibitions (`Fix X … do not Y`)
  split correctly; colon-separated actions and `redirect` verbs land in `in_scope`;
  embedded `no config` no longer drops whole Fix sentences.

### Added

- **`conductor rules audit`** flags `drift_noisy_rule` for meta-rules likely to
  false-block path drift (refactor-beyond-task, skip hooks, design-system tokens).
- **Dogfood regression tests** for consuming-app onboarding, sync, and reconnect replay
  scenarios.

## [1.0.4] - 2026-07-12

### Fixed

- **`conductor doctor` respects `core.hooksPath`.** Repo-local hooks such as
  `.githooks/pre-commit` are detected instead of only `.git/hooks/pre-commit`.
- **Prohibition extraction:** no bare `without review` false positives; file
  paths in `do not modify …` clauses (e.g. `agents/registry.json`) are preserved.

## [1.0.3] - 2026-07-12

### Fixed

- **Compound file extensions end sentences correctly.** Periods after `.test.ts.`,
  `.spec.tsx.`, `.d.ts.`, etc. are sentence boundaries again; prompts no longer
  merge into a single >200-character clause that drops all `in_scope` items.
- **Extraction recognizes `Extract` as an action verb** so helper-extraction
  clauses land in `in_scope` (multi-clause extract prompts with an `Extract` verb).
- **Prohibition clause detection** no longer treats hyphenated words like
  `no-overwrite` as a `no …` prohibition when filtering `in_scope`.

## [1.0.2] - 2026-07-11

### Fixed

- **Extraction no longer breaks on `file.ts.` sentence boundaries.** Prompts like
  `itemFilter.ts. Verify…` no longer truncate `original_ask` at the extension
  period; the full first sentence is preserved.
- **Prohibition extraction false positives.** Bare `not …` matches inside verify
  clauses (e.g. "excludes strategies not in the selected preset") are no longer
  added to `out_of_scope`.

### Changed

- Cursor integration rule: one contract per feature branch; do not reuse stale
  contracts from unrelated tasks.

## [1.0.1] - 2026-07-09

### Added

- **Phase 3b (partial): brief correction dedup + cap.** Session Brief and generated
  `index.md` dedupe near-identical acknowledged correction rules (keep newest),
  drop entries older than 90 days from brief surfaces, and cap at 10 items. Full
  `correction_log` on the contract is unchanged. Promotion to constraints stays
  **explicit** (`conductor correct --promote` only).

### Changed

- **`conductor-extract --freeze` deprecation.** Removed flag now exits with a clear
  message pointing to `conductor-freeze`.
- Cursor integration rule references `conductor hook install` instead of the
  non-shipping `integrations/git-hooks` sample path.

## [1.0.0] - 2026-07-08

First stable release. The CLI surface and the `@vaultcompass/conductor-*` package
APIs are now covered by the [stability policy](./docs/release/stability-policy.md);
breaking changes require a major version bump.

### Added

- **Stable `1.0.0` line** for `@vaultcompass/conductor-{schema,core,skill,cli}`.

### Fixed

- **Intent extraction no longer shreds dotted file tokens.** `conductor extract`
  treated any `.` as a sentence boundary, so prompts mentioning paths like
  `.githooks`, `.github/workflows/conductor-drift.yml`, or `config.yaml` produced
  mangled `original_ask`/`in_scope` fragments (e.g. `"yml CI on pull requests"`).
  Periods now only end a sentence when followed by whitespace or end of input.

### Verified

- **consuming-app dogfood + real PR gate.** Conductor's pre-commit hook and CI drift job
  were exercised on a private downstream app repo: aligned changes pass,
  out-of-scope changes soft-block, and the `intent-drift` CI job is green.

## [0.3.0-beta.3] - 2026-07-07

### Fixed

- **Broken pre-commit guidance for npm installs.** `conductor init` previously
  told users to `cp integrations/git-hooks/...`, a path that does not ship in the
  published packages. `init` now points to `conductor hook install`.

### Added

- **`conductor hook install` / `conductor-hook`.** Writes a self-contained Git
  pre-commit hook that runs the enforcement gate on staged changes and resolves
  the CLI at commit time (no dependency on the Conductor source repo). Supports
  `--with-vault-guard`, `--force`, and refuses to clobber a foreign hook.

## [0.3.0-beta.2] - 2026-07-07

### Added

- **v1 launch path.** [v1-launch-checklist.md](./docs/release/v1-launch-checklist.md),
  [stability-policy.md](./docs/release/stability-policy.md), and
  `scripts/dogfood-app.sh` for consuming app dogfood before `1.0.0`.
- **npm package READMEs** for `@vaultcompass/conductor-{schema,core,skill,cli}` and
  keywords for registry discoverability.

### Changed

- Release workflow publishes with **`latest`** dist-tag (npm page shows current version).
- GitHub Actions integration samples use `@vaultcompass/conductor-cli@latest`.

## [0.3.0-beta.1] - 2026-07-07

### Fixed

- **`conductor init` from npm.** Default `config.yaml` is now generated from embedded
  defaults in `@vaultcompass/conductor-core` instead of reading
  `examples/conductor.config.example.yaml`, which is not shipped in published
  packages.

### Added

- **npm scope alignment.** Publishable packages now use the `@vaultcompass/*`
  scope (same org as vault-guard). GitHub org remains `vaultcompasshq`.
- **GitHub Actions release.** Tag `v*` triggers `.github/workflows/release.yml`
  for OIDC npm publish and post-publish CLI smoke.
  `--human` prints readable onboarding hints. `conductor report --with-secrets`
  appends an optional vault-guard staged scan when installed. Added offline
  lifecycle fixture tests for CI, `scripts/publish-beta.mjs`, and README npm
  install + AI session guardrails quickstart.
- **Drift handoff report.** Added `conductor report` / `conductor-report` for
  PR, CI, and agent handoffs. The report runs the gate, exits with the same
  status as `check`, and summarizes the active contract, drift score, blockers,
  acceptance criteria coverage, pivots, corrections, changed paths, signals,
  and recommended next action.
- **Rules audit.** Added `conductor rules audit` / `conductor-rules audit` to
  inspect `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`,
  `.continue/rules`, and `.kiro/steering`. It reports loaded rules, duplicates,
  potential conflicts, stale or overbroad rules, and rules that may deserve
  critical priority.
- **Spec bridge.** Added `conductor import-spec` /
  `conductor-import-spec` to import Spec Kit or Kiro-style artifacts into an
  unfrozen Intent Contract draft. Supports auto-discovery plus explicit
  `--spec-dir`, `--requirements`, `--design`, and `--tasks` paths.
- **Path-only drift controls.** Drift scoring now derives generic source,
  manifest, API, documentation, and test signals from changed paths, so obvious
  out-of-scope source/package changes can block without requiring explicit
  `--signals`.
- **Setup doctor.** Added `conductor doctor` / `conductor-doctor` to diagnose
  local setup, active contract state, approval/freeze status, archive/index
  state, package version, and visible hook/workflow files. Supports readable
  output and `--json`.
- **Public repo validation harness.** Added
  `scripts/validate-public-repos.mjs` plus `pnpm validate:public-repos` for
  repeatable manual validation against public GitHub repositories, with optional
  markdown reports under `docs/validation/public-repos/`.
- **Optional vault-guard pairing.** `conductor doctor` now reports vault-guard
  config, binary, Git hook, and GitHub Actions references when present. Added a
  paired pre-commit sample and a paired CI sample for teams that want intent
  drift and secret scanning as independent gates.
- **Unified CLI beta package.** Added `@vaultcompass/conductor-cli` with the
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
- **Production-readiness validation.** Added
  `docs/validation/production-readiness-2026-07-04.md`, covering unified CLI,
  resume, correction, pivot, archive, prior-contract drift, and `drift --ci`.
- **Release and CI docs.** Added a beta release checklist and a copyable GitHub
  Actions workflow sample for `conductor drift --ci`.

- **Real freeze/approval step (validation finding #2).** `conductor-extract` now
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
  Resolves validation finding #1.

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
  fired on the sample desktop app example. Matching now derives entirely from the
  contract's own `in_scope` / `out_of_scope` / `constraints` text, with
  in-scope-token subtraction to suppress false positives and a severity floor
  so a single out-of-scope or critical-constraint hit can block. `--signals`
  is now documented as open-vocabulary free text.
- Root `pnpm test` now builds first (skill CLI tests run the compiled `dist/`).
- GitHub Actions integration docs now mark package-install workflow samples as
  post-publish templates until `@vaultcompass/conductor-cli` is available on
  npm.
- Constraint loading now deduplicates identical rules across loaded files and
  keeps the highest priority copy.
- Public repo validation now defaults to 8 repositories and checks both
  explicit-signal drift and path-only source/package drift.

### Fixed

- Prohibition lists such as "Do not change source code, package metadata, or
  runtime behavior" now expand into separate out-of-scope items, so path-only
  manifest changes have a contract item to match.
- Prohibition clauses such as "Do not add new API endpoints" no longer leak
  into `in_scope`, and overlapping prohibition matches are deduped in
  `out_of_scope`. This fixes a validation case where prior-contract drift was
  masked by in-scope token subtraction.
- Corrected test-count claims across README / NEXT / AGENTS (was "29"/"14",
  actual is 39: schema 3 + core 22 + skill 8 + examples 6).
- Tightened README multi-model / Venture Studio language to reflect that those
  integrations are design-stage, not shipped.

## [0.2.0-beta] - 2026-06-17

### Added

- `@vaultcompass/conductor-skill` — Superpowers skills (`intent-contract`, `prompt-coach`, `drift-guard`)
- Helper CLIs: `conductor-coach`, `conductor-extract`, `conductor-drift`, `conductor-init`
- Root scripts: `pnpm conductor:coach`, `conductor:extract`, `conductor:drift`, `conductor:init`, `conductor:install-skills`
- Core runtime: `extract.ts`, `constraints.ts` (incl. `.cursor/rules`), `config.ts`, `init.ts`, `drift-log.ts`
- `.conductor/` directory spec — `docs/schemas/directory-layout.md`
- Phase 2 validation retrospective — `docs/validation/phase2-retrospective.md`
- Example contract `examples/intent-contracts/conductor-phase2.yaml`
- `integrations/superpowers/install-skills.sh`

### Changed

- Drift scorer: configurable thresholds, CLI path detection, keyword matching, critical hard-block at 86+

### Tests

- 29 passing (18 core + 3 schema + 6 examples)

## [0.1.0-alpha] - 2026-06-17

### Added

- `@vaultcompass/conductor-schema` package — Intent Contract JSON Schema v1.0.0 with Ajv validation
- `@vaultcompass/conductor-core` package — prompt coach and drift scoring engines
- 5 example intent contracts in `examples/intent-contracts/`
- sample desktop app retrospective exit gate (drift score 83)
- Phase 1 implementation plan (`docs/superpowers/plans/2026-06-17-conductor-phase1.md`)
- GitHub repository: https://github.com/vaultcompasshq/conductor
- Brainstorming session and design documentation (2026-06-17)
- Competitive analysis and repo strategy
- 14-week implementation roadmap
- Integration guides: Superpowers, AI Venture Studio, Cursor

## [0.0.0] - 2026-06-17

- Repository initialized — design phase only
