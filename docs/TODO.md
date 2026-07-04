# TODO — detailed task backlog

**Updated:** 2026-07-04 · companion to [NEXT.md](./NEXT.md).
Tasks are file-level and checkboxed. All work lands on `main` via PR; CI green
before merge. Baseline: 74 tests passing.

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
- [~] Tests + docs + a real dogfood run (resume on "day 5+" references prior
      contract — the roadmap Phase 3 exit gate). Tests/docs done; real dogfood
      run remains.

## 2. Dogfood finding #3 — thin auto-extracted scope/AC — FIXED

- [x] `packages/core/src/extract.ts`: `extractInScope` / `extractAcceptanceCriteria`
      produce one generic bullet from a paragraph ask. Improve heuristics
      (split on sentences/conjunctions; derive AC from imperative clauses) OR
      formally rely on the human review pass before freeze and document it.
- [x] Add tests with multi-sentence asks asserting >1 scope item / AC.
- [x] Update [dogfood/phase2-live-run.md](./dogfood/phase2-live-run.md) finding #3.

## 3. Phase 3b — deferred from the correction-log spec

See [superpowers/specs/2026-06-20-correction-log-and-brief.md](./superpowers/specs/2026-06-20-correction-log-and-brief.md) §6–7.

- [ ] **Correction decay/dedup** — corrections accumulate; a 40-item brief isn't
      "minimal." Merge near-duplicate rules; optionally expire stale ones.
- [ ] **Auto-promotion policy** — decide whether acknowledged corrections
      auto-promote to constraints (currently explicit `--promote` only).
- [ ] **LLM-assisted rule normalization** — turning a messy correction into a
      clean negative constraint is itself extraction; candidate for the optional
      LLM path. Keep rule-based as default/offline.

## 4. Phase 4 — public release polish

- [ ] `packages/cli` unified `conductor <subcommand>` binary wrapping the
      per-command CLIs (init, extract, freeze, coach, drift, check, correct,
      brief). Currently they are separate bins in `packages/skill`.
- [ ] `conductor --help`, README install-without-Venture-Studio check, version
      tag (`v0.3.0-beta`), optional `conductor drift --ci` GitHub Action example.

## 5. Integrations (design-stage → real, if/when prioritized)

- [ ] Cursor: on-save hook → `conductor-check` (currently design notes only).
- [ ] Codex / Gemini: confirm the contract YAML is consumed; no runtime wiring
      exists beyond reading `GEMINI.md` as a constraint file.
- [ ] AI Venture Studio / EngineeringAgents wiring — separate-repo PR; explicitly
      out of scope for this repo (see AGENTS.md boundaries).

## 6. Smaller hygiene

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
- [x] Constraint-loader precision (dogfood finding #1) (#3).
- [x] Phase 3a: `correction_log` + `conductor-correct` + `conductor-brief` (#4).
- [x] Real freeze/approval step (dogfood finding #2) (#5).
- [x] Better paragraph extraction for scope/AC (dogfood finding #3).
