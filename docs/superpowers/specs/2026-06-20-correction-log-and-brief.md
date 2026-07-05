# Design spec: Correction Log + Session Brief

**Date:** 2026-06-20
**Status:** Phase 3a implemented — no-auto-promote, separate from `pivot_log`, append-only. Q2 (decay) and Q3 (LLM rule-normalization) deferred to 3b.
**Author:** Conductor team
**Related:** [2026-06-17-conductor-design.md](./2026-06-17-conductor-design.md) · roadmap Phase 3 (memory index)

---

## 1. Problem

In a long AI-assisted coding session the agent makes a mistake, the user
corrects it, the agent makes another mistake, the user corrects again. The full
back-and-forth — including every **wrong** attempt — sits in the context window.
Two failure modes follow:

1. **Lesson loss.** When the window is compacted or a new session starts, the
   correction was only ever a chat message, so the agreed methodology is gone.
   The agent re-makes a mistake the user already corrected.
2. **Failure priming.** While the wrong attempts are *still* in context, the
   model can re-read its own earlier flawed implementation and resample it.
   Leaving failed attempts in the window increases recurrence risk; what you
   want is warning signs.

The user wants a way to clean this up so that **only the correct methodology**
remains as the operative context.

## 2. The boundary (what Conductor can and cannot do)

This problem has two halves. Conductor owns one of them.

| Half | Owner | Why |
|------|-------|-----|
| Pruning/summarizing the actual context window | **Harness** (Claude Code, Cursor) | Only the harness controls the model's context. A file-layer tool cannot reach into it. |
| Distilling corrections into durable rules + a clean re-injectable artifact | **Conductor** | This is the Intent Contract's thesis: capture intent/constraints as a first-class file, not buried chat. |

**Conductor produces the clean artifact; the harness consumes it to clean the
window.** Conductor must not claim to compact context — it cannot enforce that.
What it can do is make the *right* context cheap to re-establish.

## 3. Goals / Non-goals

**Goals**
- Capture each user correction as a durable, attributable rule on the contract.
- Record both the wrong approach and the corrected approach (the lesson, not
  just the verdict).
- Emit a compact **Session Brief**: the minimal correct-methodology context
  (intent + scope + acceptance criteria + corrections) that replaces a messy
  transcript on re-injection.

**Non-goals**
- Editing or summarizing the model's context window (harness concern).
- Auto-detecting that a correction happened (the agent/skill proposes; the user
  confirms — same trust model as freezing a contract).
- A new subsystem. This is an extension of the existing contract + memory index,
  not a parallel feature.

## 4. Design

### 4.1 Schema: `correction_log`

The methodology analog of the existing `pivot_log` (which already handles
"scope changed, here is the acknowledged delta"). Added to `IntentContract` in
`packages/schema`:

```ts
export interface CorrectionLogEntry {
  id: string;                    // cl-1, cl-2, …
  timestamp: string;             // ISO 8601
  wrong: string;                 // the approach the agent took that was wrong
  right: string;                 // the corrected approach to use instead
  rule: string;                  // normalized negative constraint, e.g.
                                 // "Never put data-fetching in components; use a hook"
  acknowledged_by: "user" | "pending";
  promoted_to_constraint?: boolean; // mirrored into constraints[] when true
}
```

- `pending` entries are agent-proposed; only `acknowledged_by: user` entries are
  treated as authoritative (consistent with the `frozen_by: user` gate).
- When `promoted_to_constraint` is true, a matching `Constraint` is added with
  `source: "user-correction"` (new `ConstraintSource` value) and `priority`
  defaulting to `high`, so the existing **drift scorer already enforces it** with
  no scorer changes — a re-violation of a corrected rule scores as a constraint
  violation.

### 4.2 The Session Brief

A render target, not new state. `conductor brief` (and a `renderBrief()` core
function) emits the minimal correct context from the frozen contract:

```
# Session brief — <contract_id>

## Intent
<original_ask>

## In scope / Out of scope
- …

## Acceptance criteria
- …

## Corrections (do NOT repeat these mistakes)
- cl-1: Never <wrong>. Instead <right>.
- cl-2: …
```

Output formats: markdown (human / paste), and `--json` for programmatic
re-injection. The brief is deliberately small and contains **no failed code** —
only the distilled rules. This is the artifact you re-load after a context reset
instead of replaying the transcript.

### 4.3 Workflow

1. Agent makes a mistake; user corrects it in chat.
2. The `intent-contract` skill (or a new `capture-correction` skill) proposes a
   `correction_log` entry: `wrong`, `right`, normalized `rule`.
3. User confirms → `acknowledged_by: user`, optionally `promoted_to_constraint`.
4. On a new session or after compaction, the agent loads `conductor brief`
   instead of the raw history. The corrected methodology is now operative
   context; the landmines are gone.

### 4.4 CLI

```bash
conductor-correct --project . --wrong "fetched in component" \
  --right "use a useX hook" --rule "Never fetch in components; use a hook"
# appends a pending correction; prints it for confirmation

conductor-brief --project .            # markdown brief
conductor-brief --project . --json     # machine-readable
```

## 5. Why this is the right Phase 3 anchor

The roadmap's Phase 3 memory index is currently justified by "contract history /
session resume." Correction distillation is a sharper use case for the same
machinery: the memory index becomes *the place corrections accumulate across
sessions*, and the brief is *how a fresh session inherits them*. It leans on the
Intent Contract (the defensible, portable asset) rather than the commoditizable
drift heuristics.

## 6. Open questions

1. **Promotion default** — should every acknowledged correction auto-promote to
   a `high` constraint, or only on explicit `--promote`? Auto-promotion makes
   the scorer enforce corrections immediately but raises false-positive risk
   (compounding the existing constraint-loader noise — see
   [validation/phase2-live-run.md](../../validation/phase2-live-run.md) finding #1,
   which should be fixed first).
2. **Dedup / decay** — corrections accumulate. Do stale ones expire, or get
   merged? A 40-correction brief is no longer "minimal."
3. **Who normalizes `rule`** — a clean negative constraint from a messy
   correction is itself an extraction problem. Rule-based will be crude here;
   this is a candidate for the optional LLM-assisted path.
4. **Relationship to `pivot_log`** — both are acknowledged deltas. Keep separate
   (scope vs methodology) or unify under one `session_log` with a `kind` field?

## 7. Phasing

- **Depends on:** fixing the constraint-loader noise (validation finding #1) before
  auto-promotion is safe.
- **Phase 3a:** `correction_log` schema + `conductor-correct` + `renderBrief()`
  / `conductor-brief` (no auto-promotion).
- **Phase 3b:** promotion to constraints + cross-session accumulation via the
  memory index.
- **Out of scope here:** any context-window editing (harness).

## 8. Decision needed

Approve the `correction_log` + brief direction, choose the promotion default
(Q1), and decide unify-vs-separate with `pivot_log` (Q4) before implementation.
