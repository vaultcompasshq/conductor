# Next — cold-start handoff

**Updated:** 2026-07-04
**Read this first if you are an agent resuming work.** It is the single source
of truth for "where are we and what's next." For granular tasks see
[TODO.md](./TODO.md); for command usage see [cli-reference.md](./cli-reference.md).

---

## Where we are

- **Branch model:** all work lands on `main` **via PR** (never push to main). CI
  must be green before merge. See [[always-pr-to-main]] convention.
- **Tests:** 65 passing — schema 7 · core 36 · skill 16 · examples 6.
  Verify with `pnpm install && pnpm test` (test builds first).
- **CI:** `.github/workflows/ci.yml` — install → build → typecheck → test, Node 22.

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

### Merged so far (PRs #1–#5)

1. #1 production hardening (generic scorer, gate, CI, doc-credibility fixes)
2. #2 correction-log design spec
3. #3 constraint-loader noise fix (dogfood finding #1)
4. #4 Phase 3a: `correction_log` + `conductor-brief`
5. #5 real freeze/approval step (dogfood finding #2)

---

## What's next (priority order)

1. **Memory-index persistence** — roadmap Phase 3 core, the next major build.
   Archive frozen contracts to `.conductor/contracts/`, regenerate `index.md`
   from real data, session resume, cross-session drift. Foundation is ready now
   that approval means something (#2) and corrections accumulate (#4).
2. **Phase 3b deferred** (from the correction-log spec): correction decay/dedup,
   LLM-assisted rule normalization, auto-promotion policy.
3. **Phase 4** — unified `packages/cli` binary, public-release polish.

See [TODO.md](./TODO.md) for the file-level checklist of each.

---

## Open findings / known limits

- **Extraction is still rule-based:** multi-sentence scope/AC extraction is
  sharper now, but human review before `conductor-freeze` remains required.
- **Approval is best-effort headless:** `conductor-freeze` requires an explicit
  `--approved-by` in non-interactive runs, but software can't *prove* a human
  approved. Documented limitation, not a bug.
- **Drift scorer is rule-based:** good signal, but vocabulary-overlap false
  positives remain possible; LLM-assisted classification is a deferred option.
- **Integrations are design-stage:** Cursor hooks, Codex/Gemini, Venture Studio
  wiring are docs only — no runtime wiring shipped.

---

## Start prompt (resuming)

```
Read docs/NEXT.md, docs/TODO.md, and AGENTS.md.
All work lands on main via PR (never push to main); CI must be green.
Pick the top unstarted item in TODO.md (memory-index persistence) unless I say otherwise.
Use writing-plans before implementing a multi-step task.
Verify: pnpm install && pnpm test  (65 passing baseline).
```
