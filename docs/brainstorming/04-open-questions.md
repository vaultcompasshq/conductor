# Open Questions

**Date:** 2026-06-17  
**Status:** Awaiting Melroy's input — one decision unlocks implementation planning

---

## Q1: Repo name on GitHub (confirm)

**Recommendation:** `vaultcompasshq/conductor`

Alternatives:

| Name | Pros | Cons |
|------|------|------|
| `conductor` | Matches Agent #0, short | Generic name taken on npm/GitHub? |
| `intent-contract` | Descriptive | Doesn't cover coaching/drift |
| `spec-guard` | Clear function | Less brandable |

**Default if no answer:** `conductor`

---

## Q2: Agent #0 venture mode — merge or separate package?

When Session mode ships, should Venture go/no-go live in:

- **A)** Same `packages/skill` with `mode: venture | session` (recommended)
- **B)** Separate `integrations/ai-venture-studio` only — public repo has session mode only
- **C)** Two repos — `conductor` (public) + `conductor-venture` (private)

**Recommendation:** B — public repo is session governance; venture mode stays in Venture Studio importing Conductor schema.

---

## Q3: Drift check frequency

How often should Drift Guard run?

- **A)** Every assistant turn (strict, noisy risk)
- **B)** On file writes + explicit user requests (recommended)
- **C)** Only at handoff boundaries (brainstorming → plan → implement → review)
- **D)** Configurable per project

**Recommendation:** D with default C, opt-in B for Tier 0 launches.

---

## Q4: Blocking vs coaching-only (v1)

When drift detected:

- **A)** Block until user acknowledges (hard)
- **B)** Warn + require confirmation to continue (soft block — matches Agent #0 audit design)
- **C)** Coach only, never block (advisory)

**Recommendation:** B for constraint violations, C for scope suggestions.

---

## Q5: Superpowers upstream timing

When to PR skills to obra/superpowers?

- **A)** After v0.3 beta (recommended)
- **B)** Immediately with draft skills
- **C)** Never — keep vaultcompasshq-only

**Recommendation:** A

---

## Q6: First dogfood project

Which project validates Phase 2?

- **A)** Sheetful (active, high stakes)
- **B)** KidCompass (launching June)
- **C)** EngineeringAgents itself (meta)
- **D)** Greenfield toy repo (clean signal)

**Recommendation:** C for meta + one Tier 0 (A or B) in parallel.

---

## Please reply with

Minimum to unblock implementation plan:

1. Confirm repo name: `conductor`? (yes/no/alternative)
2. Drift frequency default: B / C / D?
3. Blocking mode v1: B (soft) ok?
4. First dogfood: C + which Tier 0?

Or reply **"approve spec as-is"** to accept all recommendations and proceed to `writing-plans`.
