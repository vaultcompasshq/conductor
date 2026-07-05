# Downstream Pipeline Integration Notes

**Status:** Design - wiring not implemented yet  
**Scope:** This repo provides packages and integration guidance. Runtime wiring belongs in the downstream pipeline repo.

---

## Relationship

```
vaultcompasshq/conductor
         │
         │ git submodule / npm dep / path import
         ▼
downstream pipeline repo
         │
         ▼
   product projects
```

Conductor is the upstream governance layer. The downstream pipeline owns product-specific automation, credentials, and runtime orchestration.

---

## Pipeline Mapping

| Pipeline step | Today | With Conductor |
|---------------|-------|----------------|
| Intake | Product-specific go/no-go only | Adds session mode -> Intent Contract |
| Ideation | Generates/scores ideas | Reads contract context if linked |
| Design | UI/UX mockups | Design spec must reference `contract_id` |
| Implementation | Builds code | Plans tied to `acceptance_criteria` |
| Audits | Code/UX/business | Unchanged |
| Alignment review | Guesses spec from README | Uses `.conductor/intent-contract.yaml` as primary spec |
| Aggregator | Existing audit scores | Optional extra Conductor drift score |

---

## Dual Mode

```json
{
  "component": "session-governance",
  "modes": {
    "pipeline": {
      "trigger": "new product intake",
      "output": "docs/strategic-analysis/*.md",
      "unchanged": true
    },
    "session": {
      "trigger": "any implementation task",
      "output": ".conductor/intent-contract.yaml",
      "skill": "intent-contract",
      "runsBefore": ["planning", "implementation"]
    }
  }
}
```

Pipeline-specific modes stay in the downstream repo. Session mode can call the public Conductor package.

---

## Alignment Review Upgrade Path

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

## Installation in a Downstream Pipeline Repo

```bash
cd path/to/downstream-pipeline
git submodule add https://github.com/vaultcompasshq/conductor.git vendor/conductor
# or
npm install github:vaultcompasshq/conductor#main
```

Add to `AGENTS.md`:

```markdown
## Conductor
Before implementation, ensure `.conductor/intent-contract.yaml` exists and is frozen.
Run drift check before review handoff.
```

---

## What stays private

- Issue-tracker API keys and poller scripts
- Product-specific gold-standard tests
- Portfolio scoring rubrics
- Real incident fixtures from production products

---

## Validation Order

1. Validate the session lifecycle in one downstream pipeline repo.
2. Validate against one active product repo with real implementation pressure.
3. Expand after the Phase 2 exit gate is met and false positives are reviewed.

---

## Future: Conductor score in aggregator

```javascript
// Optional aggregation enhancement
overallScore = (
  codeScore + uxScore + businessScore + alignmentScore + conductorDriftScore
) / 5;
```

`conductorDriftScore = 100 - driftScore` (invert so higher is better).

Threshold: drift score > 70 at review should flag the handoff for review.
