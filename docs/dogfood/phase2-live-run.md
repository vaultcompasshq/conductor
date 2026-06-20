# Phase 2 live dogfood run

**Date:** 2026-06-20
**Target:** Conductor repo itself, governing a real task on `feat/production-hardening`
**Contract:** `.conductor/intent-contract.yaml` (frozen for this run)

Unlike [phase2-retrospective.md](./phase2-retrospective.md) (a *simulated* diff
fed into a unit test), this is a real session: a contract was frozen, real edits
were staged, and `conductor-check --staged` decided pass/block against the live
git index.

## Task

> Add a Quickstart section for the `conductor-check` gate to
> `integrations/superpowers/README.md`. No changes to the drift scorer. No Phase
> 3 memory index. No new packages.

## Result — first real gate catch

| Step | Staged change | Gate | Exit |
|------|---------------|------|------|
| In-scope | `integrations/superpowers/README.md` (Quickstart) | ✓ ok | 0 |
| Out-of-scope | also edited `packages/core/src/drift.ts` | ✖ soft_block (71/100) | 1 |

Out-of-scope finding (verbatim):

```
- Out-of-scope touched: "No changes to the drift scorer" (matched: drift, scorer)
```

The gate scored the change against the contract's own `out_of_scope` text — no
rule about the drift scorer is hardcoded anywhere. This is the catch the
roadmap's Phase 2 exit gate asked for, on a real diff rather than a fixture.

## Findings from the run (issues to fix)

1. **Constraint loader is too noisy.** `loadConstraintFiles` scraped ~12
   "constraints" out of `AGENTS.md` markdown bullets that are not rules at all
   (e.g. `"Tag: v0.1.0-alpha"`, `"Goal: Superpowers skills wired to
   packages/core"`). Two of these produced spurious `low constraint at risk`
   findings in the run by matching the token `core`. The markdown heuristic
   needs a much tighter filter (imperative/`MUST`/`NEVER` lines only) or an
   explicit constraints block.
2. **`--freeze` sets `frozen_by: user` with no actual user approval.** The
   "hard gate requires explicit user approval" claim is currently just a CLI
   flag. Freezing should be a distinct, attributable step.
3. **Auto-extracted `in_scope`/`acceptance_criteria` are thin** — one generic
   bullet each from a one-paragraph ask. Good enough to gate on, but the
   contract is only as sharp as the extractor, which argues for a human (or
   LLM) review pass before freeze.

## Next

Fix finding #1 (constraint-loader signal-to-noise) before relying on constraint
violations in the score; scope creep matching held up well.
