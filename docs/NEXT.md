# Next — cold-start handoff

**Updated:** 2026-07-04
**Read this first if you are an agent resuming work.** It is the single source
of truth for "where are we and what's next." For granular tasks see
[TODO.md](./TODO.md); for command usage see [cli-reference.md](./cli-reference.md).

---

## Where we are

- **Branch model:** all work lands on `main` **via PR** (never push to main). CI
  must be green before merge. See [[always-pr-to-main]] convention.
- **Tests:** 84 passing — schema 7 · core 42 · skill 20 · cli 6 · examples/integrations 9.
  Verify with `pnpm install && pnpm test` (test builds first).
- **CI:** `.github/workflows/ci.yml` — install → build → typecheck → test →
  release smoke, Node 22.

### What ships today (working, tested)

| Capability | Where | Notes |
|------------|-------|-------|
| Intent Contract schema + validator | `packages/schema` | AJV; `correction_log` + `approval` added |
| Prompt coach | `packages/core/coach*.ts` | rule/regex patterns |
| Generic drift scorer | `packages/core/drift.ts` + `tokenize.ts` | project-independent token matching, in-scope subtraction, severity floor |
| Constraint loader | `packages/core/constraints.ts` | precision filter (finding #1 fixed) |
| Draft → **approve** → gate | `extract` → `freeze` → `check` CLIs | real approval step (finding #2 fixed) |
| Enforcement gate | `conductor-check` + `gate.ts` | non-zero exit; pre-commit sample |
| Correction log + Session Brief | `correction.ts`, `brief.ts`, `correct`/`brief` CLIs | Phase 3a |
| Memory-index persistence | `history.ts`, `memory-index.ts`, `pivot.ts` + `index`/`pivot`/`resume` CLIs | Phase 3 core |
| Hook adapter samples | `integrations/hooks`, `integrations/codex`, `integrations/claude-code`, `integrations/cursor` | Codex/Claude Code lifecycle samples, Cursor rule + git hook setup |
| Unified CLI + release smoke | `packages/cli`, `scripts/release-smoke.mjs` | `conductor <subcommand>`, `drift --ci`, pack smoke for schema/core/skill/cli |

### Recent shipped work

1. #1 production hardening (generic scorer, gate, CI, doc-credibility fixes)
2. #2 correction-log design spec
3. #3 constraint-loader noise fix (dogfood finding #1)
4. #4 Phase 3a: `correction_log` + `conductor-brief`
5. #5 real freeze/approval step (dogfood finding #2)
6. #7 Phase 3 core: contract archive, generated index, resume, pivot CLI, and
   informational cross-session drift.
7. #8 paragraph extraction hardening for richer scope/acceptance drafts.
8. #9 Codex/Claude Code hook adapter samples and Cursor project rule.
9. Production-readiness pass: unified CLI, release smoke, dogfood run, and
   prohibition extraction fix.

---

## What's next (priority order)

1. **Publish/tag cleanup** — decide npm publish timing, create release notes,
   and tag `v0.3.0-beta`.
2. **Phase 3b deferred** (from the correction-log spec): correction decay/dedup,
   LLM-assisted rule normalization, auto-promotion policy.
3. **Integration hardening** — full runtime checks for hook adapters and a
   GitHub Action example around `conductor drift --ci`.

See [TODO.md](./TODO.md) for the file-level checklist of each.

---

## Open findings / known limits

- **Extraction is still rule-based:** multi-sentence scope/AC extraction and
  prohibition handling are sharper now, but human review before
  `conductor-freeze` remains required.
- **Approval is best-effort headless:** `conductor-freeze` requires an explicit
  `--approved-by` in non-interactive runs, but software can't *prove* a human
  approved. Documented limitation, not a bug.
- **Drift scorer is rule-based:** good signal, but vocabulary-overlap false
  positives remain possible; LLM-assisted classification is a deferred option.
- **Hook integrations are samples:** Codex and Claude Code hook configs plus a
  Cursor project rule ship as integration examples; Venture Studio wiring is
  still docs only.

---

## Start prompt (resuming)

```
Read docs/NEXT.md, docs/TODO.md, and AGENTS.md.
All work lands on main via PR (never push to main); CI must be green.
Pick the top unstarted item in TODO.md unless I say otherwise.
Use writing-plans before implementing a multi-step task.
Verify: pnpm install && pnpm test && pnpm release:smoke  (84 passing baseline).
```
