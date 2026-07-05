# Context and Problem

**Date:** 2026-06-17

---

## The failure mode

Most AI coding disasters follow the same arc:

```
1. User gives vague or overloaded prompt
2. Model confidently expands scope
3. User doesn't notice drift for 20–40 turns
4. Code review checks syntax, not intent
5. Shipped product ≠ original idea
```

**NetViz** is the canonical example in this workspace: notifications were `println!`, safety scores were hardcoded, preferences weren't persistent. Review agents scored architecture and linting — not **functional truth**.

---

## Why existing tools don't fix this

| Tool | What it checks | What it misses |
|------|----------------|----------------|
| **Linters / ESLint** | Code style, patterns | Whether you meant to build this |
| **CodeRabbit / PR review** | Diff quality, security | Session-level intent drift |
| **Cursor rules** | Static preferences | Dynamic scope creep mid-session |
| **Superpowers brainstorming** | Design before code | In-session enforcement after approval |
| **alignment review idea-alignment** | Spec vs repo (post-hoc) | Upstream contract at session start |
| **session governance Conductor (today)** | Product go/no-go | Per-feature / per-session governance |

The gap is **continuous intent fidelity** — not a one-time spec, not a post-merge audit.

---

## What "deterministic" means here

**Not:** Making LLM outputs reproducible (temperature 0 still drifts).

**Yes:**

1. **Deterministic contract** — frozen `intent-contract.yaml` per task/session
2. **Deterministic checks** — rule-based drift scoring against contract + constraint files
3. **Deterministic coaching** — templated feedback for known bad prompt patterns
4. **Deterministic audit trail** — `pivot_log[]` with timestamps and acknowledgments

Think **Return Replay** (from your product portfolio): recalculate "what we agreed" vs "what we built."

---

## Existing assets to build on

### Existing Downstream Automation

| Asset | Path | Reuse |
|-------|------|-------|
| session governance Conductor | `agents/session-governance-conductor/` | Evolve from product gate → session governance |
| Drift-resistant template | `docs/plans/2026-03-10-drift-resistant-agent-template-design.md` | Guardrails + validation layers |
| session governance audit system | `docs/plans/2026-03-15-agent-audit-system-design.md` | Gold standards (phase 2+) |
| alignment review idea-alignment | `tools/product-board-manager/polling/alignment-review-idea-alignment-poller.js` | Downstream drift consumer |
| Multi-model audit | `COMPREHENSIVE_AUDIT_FRAMEWORK.md` | Post-implementation validation |
| Memory system design | `docs/plans/2026-04-13-agent-memory-context-system-design.md` | RAG-lite index |
| CLAUDE.md integration | Agent prompts + memory design | Constraint loading |

### Superpowers (public)

| Skill | Role in Conductor |
|-------|-------------------|
| `brainstorming` | Runs **after** contract draft, **before** freeze |
| `writing-plans` | Plans must reference `contract_id` |
| `verification-before-completion` | Final gate vs acceptance criteria |
| `test-driven-development` | Acceptance criteria → tests |
| `systematic-debugging` | When drift detected, structured diagnosis |

### User constraint files (any repo)

| File | Priority | Contents |
|------|----------|----------|
| `AGENTS.md` | Highest | Agent behavior, tool rules |
| `CLAUDE.md` | High | Project decisions, anti-patterns |
| `GEMINI.md` | High | Gemini-specific overrides |
| `.cursor/rules/*` | Medium | Cursor rule packs |
| `docs/spec.md` | High | Feature spec |
| `docs/pivots.md` | Medium | Documented intentional changes |

---

## User coaching — the unique wedge

### Bad prompt patterns (detect → coach)

| Pattern | Example | Why it causes chaos |
|---------|---------|---------------------|
| **Product stack** | "Notion + Figma + issue tracker in one" | Model invents architecture |
| **Comparative overload** | "Like X but also Y and Z" | Conflicting reference frames |
| **Scope adverb** | "Just quickly add..." | Model skips constraints |
| **Implicit pivot** | "Actually let's also..." | Undocumented scope expansion |
| **Authority without spec** | "You know what I mean" | Model fills gaps with hallucination |
| **Constraint conflict** | "Refactor everything" + CLAUDE.md says no redesign pre-launch | Violates project rules |

### Coaching tone

- Direct, not preachy
- Show **cause → effect** ("this phrasing caused X in 73% of similar sessions")
- Offer **narrowed rewrite** of the prompt
- Never block without offering a fix

---

## Personas

### Persona A: Solo founder (Melroy)

- multiple products, context switching
- Needs: cross-session memory, product-agnostic install
- Pain: rework when agent "goes crazy" on vague ask

### Persona B: External developer

- Uses Cursor + Claude, no downstream pipeline
- Needs: install skill, zero config start
- Pain: rules files ignored mid-session

### Persona C: Small team lead

- Shared `AGENTS.md`, multiple engineers
- Needs: contract in repo, PR drift checks
- Pain: junior dev prompts explode scope

---

## Problem metrics (baseline to beat)

From downstream automation audit docs:

| Metric | Current (estimated) | Target with Conductor |
|--------|---------------------|----------------------|
| Rework cycles per feature | ~1.5 | < 0.5 |
| "That's not what I meant" turns | ~2–3 per session | < 1 |
| Spec-less sessions | ~70% | < 20% |
| Undocumented pivots | Common | Logged in `pivot_log` |
| alignment review alignment score | Variable | +10–15 pts with upstream contract |

---

## Core vocabulary

| Term | Definition |
|------|------------|
| **Intent Contract** | Frozen YAML/JSON artifact defining scope, constraints, acceptance criteria |
| **Drift** | Measurable divergence from contract (scope, constraints, or spec) |
| **Pivot** | Intentional drift — must be logged and acknowledged |
| **Prompt variance** | How user's phrasing amplifies model chaos |
| **Constraint source** | Any file Conductor reads for rules (AGENTS.md, etc.) |
| **Coach** | Conductor feedback on prompt quality before execution |
