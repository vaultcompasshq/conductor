# Approaches and Recommendation

**Date:** 2026-06-17

---

## Three approaches evaluated

### Approach A: Superpowers skill only

**Description:** Publish `intent-contract` and `drift-guard` skills. No CLI, no memory, no Venture Studio wiring.

```
User → skill extracts contract → Superpowers brainstorming → implementation
                                      ↓
                              drift-guard at end of turn
```

| Pros | Cons |
|------|------|
| Ship in 1–2 weeks | No cross-session memory |
| Zero infra | Can't enforce in CI |
| Easy Superpowers PR | Venture Studio still fragmented |
| Lowest maintenance | Weaker moat |

**Best for:** Validation only. Too thin for "build it all out."

---

### Approach B: RAG + memory platform first

**Description:** Build vector index over project docs, then add contract extraction on top.

```
User → embed query → retrieve constraints → generate contract → work
```

| Pros | Cons |
|------|------|
| Scales to huge repos | 4–6 weeks before value |
| Fancy demos | Retrieval noise without contract schema |
| Enterprise story | Over-engineered for v1 |
| | Embedding costs / stale index |

**Best for:** Phase 3, not phase 1.

---

### Approach C: Foundation-first Conductor platform (RECOMMENDED)

**Description:** Intent Contract schema → runtime → memory → public extraction. Full 14-week plan.

```
Phase 1: Schema + rubric
Phase 2: Runtime + Venture Studio hooks
Phase 3: Memory index (RAG-lite)
Phase 4: Public skill + CLI
```

| Pros | Cons |
|------|------|
| Each phase shippable | 14 weeks total |
| Dogfoods on real ventures | More docs + code |
| Strong moat | Solo maintainer load |
| Correct build order | |
| Public + private split clear | |

**Best for:** "I have time" — **this is the answer.**

---

## Recommendation

**Approach C** — build the full platform bottom-up:

| Phase | Weeks | Deliverable | Standalone value? |
|-------|-------|-------------|-------------------|
| 1 | 1–2 | Schema, rubric, examples | Yes — teams can adopt schema manually |
| 2 | 3–6 | Runtime, VS integration | Yes — internal dogfood |
| 3 | 7–10 | Memory index | Yes — cross-session drift |
| 4 | 11–14 | Skill + CLI publish | Yes — public OSS |

**Do not skip Phase 1.** Everything hangs on the contract.

---

## How Approach C maps to packages

```
packages/schema     ← Phase 1
packages/skill      ← Phase 2 draft, Phase 4 publish
integrations/       ← Phase 2
packages/memory     ← Phase 3
packages/cli        ← Phase 4
```

---

## Agent #0 evolution

**Today:** Venture strategic gatekeeper (go/no-go for new ideas).

**Tomorrow:** Two modes, same Conductor brand:

| Mode | Trigger | Output |
|------|---------|--------|
| **Venture** | New idea in Linear | Strategic analysis (existing) |
| **Session** | Any coding task | Intent Contract (new) |

Session mode does **not** replace venture mode — it extends Agent #0.

```json
{
  "modes": {
    "venture": { "runsBefore": ["agent-01-ideation"] },
    "session": { "runsBefore": ["brainstorming", "implementation"] }
  }
}
```

---

## Integration priority

1. **Superpowers** — skill install (widest distribution)
2. **AI Venture Studio** — Agent #0 + #4f (dogfood)
3. **Cursor** — rules + optional hook docs
4. **GitHub Actions** — `conductor drift --ci` (phase 4+)

---

## What to extract to public repo vs keep private

| Public (`vaultcompasshq/conductor`) | Private (Venture Studio) |
|-------------------------------------|--------------------------|
| Schema, CLI, skills | Linear poller wiring |
| Generic coaching templates | Venture scoring rubrics |
| Drift algorithms | Gold-standard test library |
| Synthetic examples | Real incident fixtures |
| Integration guides | API keys, portfolio data |

---

## Kill criteria (stop or pivot)

Stop if after Phase 2:

- False positive drift rate > 40%
- You bypass Conductor every session
- Zero real drift catches in 4 weeks
- Maintenance > 4 hours/week with no value

---

## Decision

| Question | Answer |
|----------|--------|
| Public repo? | **Yes** — `vaultcompasshq/conductor`, MIT |
| Compete with Venture Studio? | **No** — feeder |
| Which approach? | **C** — full platform, phased |
| First code to write? | Schema validation + example contracts |
| First integration? | Superpowers `intent-contract` skill |

**Awaiting:** User approval of design spec → then `writing-plans`.
