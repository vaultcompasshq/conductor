# AI Venture Studio Integration

**Status:** Design — wiring not implemented yet  
**Internal repo:** `~/Projects/Engineering/EngineeringAgents` (or `github.com/MelroySaldanha/ai-venture-studio`)

---

## Relationship

```
vaultcompasshq/conductor (PUBLIC)
         │
         │ git submodule / npm dep / path import
         ▼
EngineeringAgents (PRIVATE or separate repo)
         │
         ▼
   Built ventures (Sheetful, KidCompass, …)
```

Conductor is the **upstream governance layer**. Venture Studio is the **downstream pipeline**.

---

## Agent mapping

| Studio Agent | Today | With Conductor |
|--------------|-------|----------------|
| **#0 Conductor** | Venture go/no-go only | + Session mode → Intent Contract |
| **#1 Ideation** | Generates/scores ideas | Reads contract context if venture-linked |
| **#2 Design** | UI/UX mockups | Design spec must reference `contract_id` |
| **#3 Implementation** | Builds code | Plans tied to `acceptance_criteria` |
| **#4a–#4d Audits** | Code/UX/business | Unchanged |
| **#4f Idea Alignment** | Guesses spec from README | **Uses `.conductor/intent-contract.yaml` as primary spec** |
| **#4e Aggregator** | 5 audit scores | Optional 6th: Conductor drift score |

---

## Agent #0 dual mode

```json
{
  "agent": "agent-00-conductor",
  "modes": {
    "venture": {
      "trigger": "new Linear idea",
      "output": "docs/strategic-analysis/*.md",
      "unchanged": true
    },
    "session": {
      "trigger": "any implementation task",
      "output": ".conductor/intent-contract.yaml",
      "skill": "intent-contract",
      "runsBefore": ["brainstorming", "agent-03-implementation"]
    }
  }
}
```

Venture mode stays in Venture Studio repo. Session mode calls public Conductor package.

---

## Agent #4f upgrade path

**Current:** `findOriginalSpec()` searches `docs/spec.md`, README, etc.

**Upgrade:**

```javascript
// Priority 1: Conductor contract
const contractPath = path.join(projectPath, ".conductor", "intent-contract.yaml");
if (fs.existsSync(contractPath)) {
  return parseConductorContract(contractPath);
}
// Priority 2: fallback to existing spec search
```

**Benefit:** Spec alignment score based on frozen intent, not inferred README.

---

## Installation in EngineeringAgents

```bash
cd ~/Projects/Engineering/EngineeringAgents
git submodule add https://github.com/vaultcompasshq/conductor.git vendor/conductor
# or
npm install github:vaultcompasshq/conductor#main
```

Add to `AGENTS.md`:

```markdown
## Conductor
Before implementation, ensure `.conductor/intent-contract.yaml` exists and is frozen.
Run drift check before Agent #4 handoff.
```

---

## What stays private

- Linear API keys and poller scripts
- Venture-specific gold-standard tests
- Portfolio scoring rubrics
- Real incident fixtures from production ventures

---

## Dogfood order

1. **EngineeringAgents** — meta (Conductor governs Conductor build)
2. **Sheetful or KidCompass** — Tier 0 launch pressure
3. Expand to other ventures after Phase 2 exit gate

---

## Future: Conductor score in aggregator

```javascript
// Agent #4e optional enhancement
overallScore = (
  agent4a + agent4b + agent4c + agent4d + agent4f + conductorDriftScore
) / 6;
```

`conductorDriftScore = 100 - driftScore` (invert so higher is better).

Threshold: drift score > 70 at review → flag in Linear comment.
