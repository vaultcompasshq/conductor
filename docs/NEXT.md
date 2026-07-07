# Next - Maintainer Status

**Updated:** 2026-07-07
**Read this first when resuming work.** It is the single source
of truth for "where are we and what's next." For granular tasks see
[TODO.md](./TODO.md); for command usage see [cli-reference.md](./cli-reference.md).

---

## Where we are

- **Branch model:** all work lands on `main` **via PR** (never push to main). CI
  must be green before merge. See [[always-pr-to-main]] convention.
- **Tests:** 110 passing — schema 7 · core 59 · skill 25 · cli 9 · examples/integrations 10.
  Verify with `pnpm install && pnpm test` (test builds first).
- **CI:** `.github/workflows/ci.yml` — install → build → typecheck → test →
  release smoke, Node 22.

### What ships today (working, tested)

| Capability | Where | Notes |
|------------|-------|-------|
| Intent Contract schema + validator | `packages/schema` | AJV; `correction_log` + `approval` added |
| Prompt coach | `packages/core/coach*.ts` | rule/regex patterns |
| Generic drift scorer | `packages/core/drift.ts` + `tokenize.ts` | project-independent token matching, in-scope subtraction, severity floor, path-derived source/package/API signals |
| Constraint loader | `packages/core/constraints.ts` | precision filter (finding #1 fixed), duplicate rule merge |
| Draft → **approve** → gate | `extract` → `freeze` → `check` CLIs | real approval step (finding #2 fixed) |
| Enforcement gate | `conductor-check` + `gate.ts` | non-zero exit; pre-commit sample |
| Correction log + Session Brief | `correction.ts`, `brief.ts`, `correct`/`brief` CLIs | Phase 3a |
| Memory-index persistence | `history.ts`, `memory-index.ts`, `pivot.ts` + `index`/`pivot`/`resume` CLIs | Phase 3 core |
| Hook adapter samples | `integrations/hooks`, `integrations/codex`, `integrations/claude-code`, `integrations/cursor` | Codex/Claude Code lifecycle samples, Cursor rule + git hook setup |
| Unified CLI + release smoke | `packages/cli`, `scripts/release-smoke.mjs` | `conductor <subcommand>`, `drift --ci`, pack smoke for schema/core/skill/cli |
| Release docs + CI sample | `docs/release`, `integrations/github-actions` | beta release checklist, copyable `conductor drift --ci` workflow, and optional vault-guard pairing sample |
| Setup doctor | `doctor.ts`, `doctor` CLI | local setup diagnostics for config, contract state, archive/index, package version, visible hooks/workflows, and optional vault-guard pairing |
| Drift report | `report.ts`, `report` CLI | PR/CI handoff with contract summary, gate result, drift, AC coverage, pivots, corrections, and recommendation |
| Rules audit | `rules-audit.ts`, `rules audit` CLI | inspects AGENTS/Claude/Gemini/Cursor/Continue/Kiro rules; flags duplicates, stale/broad rules, conflicts, and critical candidates |
| Public repo validation harness | `scripts/validate-public-repos.mjs` | repeatable manual smoke against 8 public GitHub repos; includes explicit-signal and path-only drift controls |

### Recent shipped work

1. #1 production hardening (generic scorer, gate, CI, doc-credibility fixes)
2. #2 correction-log design spec
3. #3 constraint-loader noise fix (validation finding #1)
4. #4 Phase 3a: `correction_log` + `conductor-brief`
5. #5 real freeze/approval step (validation finding #2)
6. #7 Phase 3 core: contract archive, generated index, resume, pivot CLI, and
   informational cross-session drift.
7. #8 paragraph extraction hardening for richer scope/acceptance drafts.
8. #9 Codex/Claude Code hook adapter samples and Cursor project rule.
9. #10 production-readiness pass: unified CLI, release smoke, validation run,
   and prohibition extraction fix.
10. #11 public positioning cleanup: generic downstream integration docs,
    validation naming, and product positioning.
11. #12 setup doctor diagnostics across core, skill CLI, unified CLI, docs,
    and tests.
12. #13 docs/status sync and repeatable public-repo validation harness.
13. Optional vault-guard pairing: doctor awareness, combined pre-commit sample,
    paired CI sample, and clarified package-install workflow status.
14. v1 readiness pass: `conductor report`, `conductor rules audit`, constraint
    deduplication, path-only drift controls, and broader public-repo validation.

---

## What's next (priority order)

1. **Spec bridge** — import Spec Kit / Kiro-style requirements, designs, and
   tasks into an Intent Contract.
2. **Phase 3b deferred** (from the correction-log spec): correction decay/dedup,
   LLM-assisted rule normalization, auto-promotion policy.
3. **Integration hardening** — full runtime checks for hook adapters in real
   Codex/Claude/Cursor environments.
4. **Public repo validation policy** — decide what stays manual because it
   requires network access and whether a smaller offline fixture belongs in CI.
5. **Publish/tag execution** — deferred until the maintainer approves a release.

See [TODO.md](./TODO.md) for the file-level checklist of each.

---

## Open findings / known limits

- **Extraction is still rule-based:** multi-sentence scope/AC extraction and
  prohibition handling are sharper now, but human review before
  `conductor-freeze` remains required.
- **Approval is best-effort headless:** `conductor-freeze` requires an explicit
  `--approved-by` in non-interactive runs, but software can't *prove* a human
  approved. Documented limitation, not a bug.
- **Drift scorer is rule-based:** good signal, including path-derived API/source
  and manifest controls, but vocabulary-overlap false positives remain possible;
  LLM-assisted classification is a deferred option.
- **Hook integrations are samples:** Codex and Claude Code hook configs plus a
  Cursor project rule ship as integration examples. Downstream product wiring
  should happen in those downstream repos.
- **Public repo validation learned:** init/extract/freeze/doctor/check run
  against the default public-repo matrix in `scripts/validate-public-repos.mjs`.
  The matrix now includes explicit-signal and path-only negative controls.

---

## Resume Prompt

```
Read docs/NEXT.md, docs/TODO.md, and AGENTS.md.
All work lands on main via PR (never push to main); CI must be green.
Pick the top unstarted item in TODO.md unless I say otherwise.
Use writing-plans before implementing a multi-step task.
Verify: pnpm install && pnpm test && pnpm release:smoke  (110 passing baseline).
```
