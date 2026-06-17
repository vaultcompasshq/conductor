# Competitive Analysis

**Date:** 2026-06-17  
**Scope:** Conductor vs adjacent products and internal systems

---

## Positioning matrix

```
                    Intent / spec governance
                              ▲
                              │
         Conductor (target)   │   ★
                              │
    Superpowers ──────────────┼────────────── Cursor Rules
                              │
    CodeRabbit ───────────────┼────────────── Devin / Factory
                              │
                              ▼
                    Code / output governance
```

**Conductor owns the top-left quadrant** — intent fidelity before and during coding.

---

## Direct and adjacent competitors

### 1. Cursor Rules + User Rules

| Dimension | Cursor | Conductor |
|-----------|--------|-----------|
| Persistence | Static files | Dynamic contract per task |
| Drift detection | None | Continuous vs contract |
| User coaching | None | Prompt variance debugger |
| Multi-session | Rules reload | Memory index + contract history |
| Multi-model | Cursor-native | Model-agnostic |

**Verdict:** Complementary. Conductor should **read** Cursor rules, not replace them.

---

### 2. Superpowers (obra/superpowers)

| Dimension | Superpowers | Conductor |
|-----------|-------------|-----------|
| Focus | Process skills (TDD, brainstorming) | Intent contract + drift |
| When it runs | Skill-triggered | Every session / turn (configurable) |
| Output | Design docs, plans | `intent-contract.yaml` |
| Public | Yes | Yes (vaultcompasshq) |

**Verdict:** **Partner, not competitor.** Conductor skills install *into* Superpowers. Propose upstream contribution of `intent-contract` and `drift-guard` skills after v0.3.

---

### 3. CodeRabbit / Bugbot / PR review agents

| Dimension | CodeRabbit | Conductor |
|-----------|------------|-----------|
| Timing | Post-commit / PR | Pre-implementation + in-session |
| Checks | Code diff | User intent + constraints |
| Multi-model | Some | Claude + Codex + Gemini by design |

**Verdict:** Conductor is **upstream**. CodeRabbit catches bad code; Conductor catches bad direction.

---

### 4. Aider / Continue / Cody

| Dimension | IDE agents | Conductor |
|-----------|------------|-----------|
| Job | Write code | Govern what gets written |
| Spec support | Optional / ad hoc | Required contract |
| Drift | User notices | System alerts |

**Verdict:** Conductor wraps any IDE agent via skills + CLI hooks.

---

### 5. Devin / Factory.ai / autonomous builders

| Dimension | Autonomous builders | Conductor |
|-----------|---------------------|-----------|
| Scope | End-to-end build | Governance layer |
| Buyer | "Build my app" | "Keep my app on-spec" |
| Venture Studio overlap | High | Low (feeder) |

**Verdict:** AI Venture Studio competes here. Conductor does not.

---

### 6. AI Venture Studio (internal)

| Dimension | Venture Studio | Conductor |
|-----------|----------------|-----------|
| Pipeline | 8 agents, idea → launch | Session governance |
| Agent #0 today | Venture go/no-go | Evolves to use Conductor |
| Distribution | Private pipeline | Public OSS |
| Spinout grade | Platform (B+) | Conductor (A−) per ideas.md |

**Verdict:** **Feeder relationship.** Studio imports Conductor as dependency.

```
Conductor (public OSS)
    ↓ depends
AI Venture Studio (pipeline)
    ↓ produces
Products (Sheetful, Prismfolio, …)
```

---

### 7. Agent #4f Idea Alignment (internal, built)

| Dimension | Agent #4f | Conductor |
|-----------|-----------|-----------|
| When | Post-implementation audit | Session start + continuous |
| Input | Guesses spec from README | Frozen Intent Contract |
| Output | Linear comment + score | Drift alert + coaching |

**Verdict:** Agent #4f becomes **more accurate** when Conductor provides the contract. Conductor is upstream.

---

### 8. Claude Code / Codex / Gemini system prompts

| Dimension | Model defaults | Conductor |
|-----------|----------------|-----------|
| Constraints | Session context | Contract + file-backed rules |
| Drift | Inevitable | Measured and surfaced |

**Verdict:** Conductor is the **orchestration layer** the exposure analysis doc describes — memory, routing, governance.

---

## Competitive moat

| Moat layer | Defensibility |
|------------|---------------|
| Intent Contract schema (open standard) | Medium — but first-mover + Superpowers integration |
| Prompt coaching corpus | High — grows from real sessions |
| Drift pattern library | High — incident → pattern → rule |
| Venture Studio integration | Medium — internal advantage |
| Multi-model audit bundle | Medium — already built in EngineeringAgents |

**Weakest if:** Someone ships "spec mode" in Cursor natively.  
**Mitigation:** Stay model-agnostic, publish schema, integrate everywhere.

---

## Market sizing (rough)

| Segment | TAM signal |
|---------|------------|
| Cursor users | Millions |
| Teams with AGENTS.md / CLAUDE.md | Growing fast (2025–2026) |
| Superpowers installs | Plugin ecosystem |
| Founders using agent pipelines | Niche but high willingness to pay |

**Initial GTM:** OSS skill → GitHub stars → optional hosted team features (v2+).  
**Not v1:** SaaS billing, enterprise sales.

---

## SWOT

| Strengths | Weaknesses |
|-----------|------------|
| Built on proven internal designs | Not yet implemented |
| Unique user coaching angle | Requires behavior change |
| Multi-model by design | No brand yet outside V&C |
| Feeds existing 32-venture pipeline | Solo maintainer risk |

| Opportunities | Threats |
|---------------|---------|
| Superpowers upstream PR | Cursor ships native intent mode |
| vaultcompasshq OSS credibility | Devin-style "just build it" mindset |
| Agent #4f + audit integration | Complexity / alert fatigue |
| B2D CLI + schema standard | OpenAI/Anthropic prompt caching changes |

---

## Recommendation

**Do not compete with AI Venture Studio or autonomous builders.**

Ship Conductor as:

1. **Public OSS** (`vaultcompasshq/conductor`) — schema + skills + CLI
2. **Internal dogfood** — required gate in Venture Studio Agent #0
3. **Ecosystem play** — Superpowers + Cursor rules + optional CodeRabbit handoff

**Elevator pitch:**  
*"Git for your intent — branch (pivot) with a log, or get warned when you've drifted."*
