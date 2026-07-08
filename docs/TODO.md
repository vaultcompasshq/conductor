# TODO — detailed task backlog

**Updated:** 2026-07-08 · companion to [NEXT.md](./NEXT.md).
Tasks are file-level and checkboxed. All work lands on `main` via PR; CI green
before merge. Baseline: 128 tests passing.

Legend: `[ ]` todo · `[~]` partial · `[x]` done (kept for context).

---

## 1. Memory-index persistence (roadmap Phase 3 core) — CORE COMPLETE

Goal: contracts and lessons survive across sessions; a resumed session inherits
the right context.

- [x] **Contract history.** On `freezeContract`/`writeContract`, also archive a
      copy to `.conductor/contracts/<contract_id>.yaml`. New module
      `packages/core/src/history.ts` (`archiveContract`, `listContracts`,
      `readArchivedContract`). Tests: archive on freeze, list ordering.
- [x] **Live index.** Replace the static `.conductor/index.md` template
      (`init.ts` INDEX_TEMPLATE) with a generated view: active contract,
      recent contracts, recent pivots, acknowledged corrections. New
      `renderIndex(projectRoot)` + `conductor-index` CLI (or fold into existing
      CLIs). Regenerate on freeze/correct.
- [x] **Session resume.** On `conductor-init` (or a new `conductor-resume`),
      detect an existing active contract and print its Session Brief
      (`renderBriefMarkdown`) so a new session inherits intent + corrections.
- [x] **Cross-session drift.** Compare current changed paths/signals against a
      *prior* archived contract ("Tuesday scope vs Friday diff"). Extend
      `drift.ts` or add `crossSessionDrift(prevContract, current, signals)`.
      Decide: surface as info or as a gate input.
- [x] **Decide `packages/memory` vs `packages/core` module.** Roadmap names a
      `packages/memory` package; simplest is a core module unless isolation is
      wanted. Pick and record in the roadmap.
- [x] Tests + docs + a real validation run (resume on "day 5+" references prior
      contract — the roadmap Phase 3 exit gate). See
      [production-readiness-2026-07-04.md](./validation/production-readiness-2026-07-04.md).

## 2. Validation finding #3 — thin auto-extracted scope/AC — FIXED

- [x] `packages/core/src/extract.ts`: `extractInScope` / `extractAcceptanceCriteria`
      produce one generic bullet from a paragraph ask. Improve heuristics
      (split on sentences/conjunctions; derive AC from imperative clauses) OR
      formally rely on the human review pass before freeze and document it.
- [x] Add tests with multi-sentence asks asserting >1 scope item / AC.
- [x] Update [validation/phase2-live-run.md](./validation/phase2-live-run.md) finding #3.

## 3. Setup doctor command — SHIPPED

Goal: make a consuming repo self-diagnose its Conductor setup before users hit
confusing gate failures.

- [x] Add `conductor doctor` to `packages/cli` and the legacy skill CLI surface
      if needed.
- [x] Check `.conductor/config.yaml`, active contract presence, frozen/approval
      state, archived contracts, generated index freshness, and common YAML
      validation errors.
- [x] Detect missing or stale hook integrations for Git pre-commit, GitHub
      Actions, Codex, Claude Code, and Cursor where those files are present.
- [x] Detect optional vault-guard pairing signals: config, binary, Git hook, and
      GitHub Actions workflow references.
- [x] Print human-readable findings by default and support `--json` for CI or
      editor integrations.
- [x] Add tests for a clean repo, missing config, unfrozen contract, invalid
      contract, and stale index.
- [x] Document the command in [cli-reference.md](./cli-reference.md) and README.

## 4. Public repo validation harness

Goal: keep the public-repo smoke test repeatable while v1 features mature.

- [x] Promote the temporary `/tmp` public-repo validation script into
      `scripts/validate-public-repos.mjs`.
- [x] Cover at least 8 repositories: small package, CLI, web app, monorepo,
      docs-heavy repo, repo with agent rules, repo without agent rules, and a
      larger TypeScript project.
- [x] Record reports under `docs/validation/public-repos/` when a run should be
      committed (`--report docs/validation/public-repos/YYYY-MM-DD.md`).
- [x] Add controls for README-only pass, source/package drift block, path-only
      drift, explicit-signal drift, and existing-rule noise. README pass,
      source/package block, explicit-signal drift, and path-only drift are
      covered by the harness. Existing-rule noise is covered by `rules audit`
      and constraint deduplication tests.
- [x] Decide which parts should run in CI and which stay manual because they
      require network access. Offline lifecycle fixture runs in CI;
      `validate-public-repos.mjs` stays manual/networked.

## 5. Competitive positioning follow-ups

See [product-positioning.md](./product-positioning.md). These make the value
prop sharper against current spec tools, agent hosts, and PR review products.

- [x] **Rules audit.** Add `conductor rules audit` to list loaded rules from
      `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`,
      `.continue/rules`, and `.kiro/steering`; detect conflicts, stale rules,
      and rules that should become critical constraints.
- [x] **Spec import bridge.** Add import paths for popular spec artifacts,
      starting with Spec Kit and Kiro-style `requirements.md` / `design.md` /
      `tasks.md`; imported specs become unfrozen Intent Contract drafts.
- [x] **Drift report.** Add `conductor report --staged` for PR/CI/agent handoff:
      active contract summary, drift score, blockers, AC coverage, pivots,
      corrections, and recommended next action.
- [ ] **Semantic drift option.** Add an opt-in semantic classifier while keeping
      the offline rule-based scorer as the default.

## 6. Phase 3b — deferred from the correction-log spec

See [superpowers/specs/2026-06-20-correction-log-and-brief.md](./superpowers/specs/2026-06-20-correction-log-and-brief.md) §6–7.

- [ ] **Correction decay/dedup** — corrections accumulate; a 40-item brief isn't
      "minimal." Merge near-duplicate rules; optionally expire stale ones.
- [ ] **Auto-promotion policy** — decide whether acknowledged corrections
      auto-promote to constraints (currently explicit `--promote` only).
- [ ] **LLM-assisted rule normalization** — turning a messy correction into a
      clean negative constraint is itself extraction; candidate for the optional
      LLM path. Keep rule-based as default/offline.

## 7. Phase 4 — public release polish — CLI + SMOKE COMPLETE

- [x] `packages/cli` unified `conductor <subcommand>` binary wrapping the
      per-command CLIs (init, extract, freeze, coach, drift, check, correct,
      brief, resume, index, pivot).
- [x] `conductor --help`, `conductor --version`, and `conductor drift --ci`.
- [x] Release package metadata + `pnpm release:smoke` tarball checks for
      schema/core/skill/cli.
- [x] Clear the low `esbuild` advisory with a pnpm override.
- [x] README install-without-downstream-pipeline quickstart and beta release checklist.
- [x] GitHub Action example around `conductor drift --ci`.
- [x] Version tag and npm publish execution — `0.3.0-beta.3` on npm via trusted publisher (`latest`).
- [x] **v1.0.0** — shipped 2026-07-08: [PR #25](https://github.com/vaultcompasshq/conductor/pull/25),
  tag [`v1.0.0`](https://github.com/vaultcompasshq/conductor/releases/tag/v1.0.0), all four packages on npm at `1.0.0`.

## 8. Integrations (design-stage → real, if/when prioritized)

- [x] Codex / Claude Code hook adapter samples and Cursor project rule.
- [x] Optional vault-guard pairing samples for Git pre-commit and GitHub
      Actions, plus `conductor doctor` awareness.
- [ ] Gemini: confirm the contract YAML is consumed; no runtime wiring exists
      beyond reading `GEMINI.md` as a constraint file.
- [ ] Cursor: native extension/MCP status panel, if prioritized. Current
      enforcement is project rule + Git pre-commit hook.
- [ ] Downstream product wiring — separate-repo PRs; explicitly out of scope
      for this repo (see AGENTS.md boundaries).

## 9. Smaller hygiene

- [ ] Consider a deprecation alias or clear error if someone still passes
      `conductor-extract --freeze` (removed in PR #5).
- [ ] `prompt-coach` product-name list is hardcoded (9 products) — generalize or
      document as illustrative.
- [ ] Decide whether to commit a `.conductor/intent-contract.yaml` for this repo
      (currently gitignored per AGENTS.md "contracts live in app repos").

---

## Done (recent, for context)

- [x] Generic, project-independent drift scorer (#1).
- [x] `conductor-check` enforcement gate + pre-commit sample (#1).
- [x] CI workflow; build-before-typecheck fix (#1).
- [x] Constraint-loader precision (validation finding #1) (#3).
- [x] Phase 3a: `correction_log` + `conductor-correct` + `conductor-brief` (#4).
- [x] Real freeze/approval step (validation finding #2) (#5).
- [x] Better paragraph extraction for scope/AC (validation finding #3).
- [x] Codex/Claude Code hook adapter samples and Cursor project rule (#9).
- [x] Unified `conductor` CLI + release smoke + production validation run.
- [x] Low dependency advisory cleared (`pnpm audit --audit-level low` clean).
- [x] GitHub Actions `conductor drift --ci` sample and beta release checklist.
