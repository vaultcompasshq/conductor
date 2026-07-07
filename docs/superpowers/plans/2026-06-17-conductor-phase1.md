# Conductor Phase 1 — Schema, Rubric & Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a testable TypeScript monorepo with Intent Contract validation, prompt coaching, and rule-based drift scoring — no CLI or skills yet.

**Architecture:** pnpm workspace with two packages: `@vaultcompass/conductor-schema` (AJV validation + types) and `@vaultcompass/conductor-core` (coach patterns, drift rubric). Schema JSON is canonical in `packages/schema/`; `docs/schemas/` stays a symlink or copy for docs consumers.

**Tech Stack:** Node 20+, TypeScript 5, pnpm workspaces, Vitest, AJV 8, yaml

**Spec:** `docs/superpowers/specs/2026-06-17-conductor-design.md` (sections 4, 5, 6)

**Exit gate:** Validator passes 5 example contracts; NetViz retrospective drift score ≥ 70; unit tests green.

---

## File map (Phase 1)

| File | Responsibility |
|------|----------------|
| `package.json` | Workspace root, scripts |
| `pnpm-workspace.yaml` | Package globs |
| `tsconfig.base.json` | Shared TS config |
| `packages/schema/package.json` | Schema package |
| `packages/schema/src/intent-contract.schema.json` | Canonical schema (copied from docs) |
| `packages/schema/src/validate.ts` | AJV validator |
| `packages/schema/src/types.ts` | Inferred TS types |
| `packages/schema/src/index.ts` | Public exports |
| `packages/core/package.json` | Core package, depends on schema |
| `packages/core/src/coach-patterns.ts` | Pattern IDs + detection heuristics |
| `packages/core/src/coach.ts` | Prompt quality score |
| `packages/core/src/rubric.ts` | Drift category weights + thresholds |
| `packages/core/src/drift.ts` | Rule-based drift scorer |
| `packages/core/src/index.ts` | Public exports |
| `examples/intent-contracts/*.yaml` | 5 synthetic fixtures |
| `docs/retrospectives/netviz-drift-score.md` | Manual retrospective worksheet |

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.npmrc`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "conductor",
  "private": true,
  "version": "0.0.0",
  "description": "Intent fidelity for AI-assisted development",
  "license": "MIT",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Create `.npmrc`**

```
auto-install-peers=true
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .npmrc
git commit -m "chore: scaffold pnpm monorepo root"
```

---

### Task 2: Schema package — types and validator

**Files:**
- Create: `packages/schema/package.json`
- Create: `packages/schema/tsconfig.json`
- Create: `packages/schema/src/intent-contract.schema.json`
- Create: `packages/schema/src/types.ts`
- Create: `packages/schema/src/validate.ts`
- Create: `packages/schema/src/index.ts`
- Create: `packages/schema/tests/validate.test.ts`
- Test: `packages/schema/tests/validate.test.ts`

- [ ] **Step 1: Create `packages/schema/package.json`**

```json
{
  "name": "@vaultcompass/conductor-schema",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "src/intent-contract.schema.json"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  }
}
```

- [ ] **Step 2: Copy schema to package**

Copy `docs/schemas/intent-contract.schema.json` → `packages/schema/src/intent-contract.schema.json` (identical content).

- [ ] **Step 3: Create `packages/schema/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "tests"]
}
```

- [ ] **Step 4: Write failing test**

`packages/schema/tests/validate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateIntentContract } from "../src/validate.js";

const validContract = {
  contract_id: "ic-20260617-a3f9k2",
  version: "1.0.0",
  original_ask: "Add CSV export for the fund performance table on the dashboard.",
  in_scope: ["Export button downloads visible table columns as CSV"],
  out_of_scope: ["PDF export"],
  constraints: [
    {
      source: "CLAUDE.md",
      rule: "No new API endpoints without explicit approval",
      priority: "critical",
    },
  ],
  acceptance_criteria: [
    {
      id: "ac-1",
      description: "Click Export downloads CSV with correct headers",
      testable: true,
    },
  ],
  frozen_at: "2026-06-17T14:30:00Z",
  pivot_log: [],
};

describe("validateIntentContract", () => {
  it("accepts a valid contract", () => {
    const result = validateIntentContract(validContract);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects missing contract_id", () => {
    const { contract_id: _, ...invalid } = validContract;
    const result = validateIntentContract(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects invalid contract_id format", () => {
    const result = validateIntentContract({
      ...validContract,
      contract_id: "bad-id",
    });
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 5: Run test — expect FAIL**

```bash
cd packages/schema && pnpm install && pnpm test
```

Expected: FAIL — module `../src/validate.js` not found

- [ ] **Step 6: Implement `packages/schema/src/types.ts`**

```typescript
export type ConstraintSource =
  | "AGENTS.md"
  | "CLAUDE.md"
  | "GEMINI.md"
  | "cursor-rules"
  | "user-stated"
  | "superpowers-spec"
  | "project-spec";

export type ConstraintPriority = "critical" | "high" | "medium" | "low";

export interface Constraint {
  source: ConstraintSource;
  rule: string;
  priority: ConstraintPriority;
  file_path?: string;
  line_ref?: string;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  testable: boolean;
}

export interface PivotLogEntry {
  timestamp: string;
  change: string;
  reason?: string;
  acknowledged_by: "user" | "pending";
  updates?: {
    in_scope_added?: string[];
    in_scope_removed?: string[];
    out_of_scope_added?: string[];
  };
}

export interface IntentContract {
  contract_id: string;
  version: "1.0.0";
  original_ask: string;
  in_scope: string[];
  out_of_scope: string[];
  constraints: Constraint[];
  acceptance_criteria: AcceptanceCriterion[];
  frozen_at: string;
  frozen_by?: "user" | "conductor" | "agent";
  prompt_quality?: {
    score: number;
    issues: string[];
    coaching_shown?: boolean;
  };
  pivot_log: PivotLogEntry[];
  metadata?: Record<string, string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
```

- [ ] **Step 7: Implement `packages/schema/src/validate.ts`**

```typescript
import Ajv from "ajv";
import addFormats from "ajv-formats";
import schema from "./intent-contract.schema.json" with { type: "json" };
import type { IntentContract, ValidationResult } from "./types.js";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validate = ajv.compile(schema);

export function validateIntentContract(data: unknown): ValidationResult {
  const valid = validate(data);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`.trim(),
  );
  return { valid: false, errors };
}

export function assertValidIntentContract(data: unknown): IntentContract {
  const result = validateIntentContract(data);
  if (!result.valid) {
    throw new Error(`Invalid intent contract:\n${result.errors.join("\n")}`);
  }
  return data as IntentContract;
}
```

- [ ] **Step 8: Implement `packages/schema/src/index.ts`**

```typescript
export type {
  IntentContract,
  Constraint,
  AcceptanceCriterion,
  PivotLogEntry,
  ValidationResult,
} from "./types.js";
export { validateIntentContract, assertValidIntentContract } from "./validate.js";
```

- [ ] **Step 9: Add vitest config**

`packages/schema/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 10: Run tests — expect PASS**

```bash
cd packages/schema && pnpm test
```

Expected: 3 tests PASS

- [ ] **Step 11: Commit**

```bash
git add packages/schema
git commit -m "feat(schema): add Intent Contract validator with AJV"
```

---

### Task 3: Coach patterns and prompt quality score

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/coach-patterns.ts`
- Create: `packages/core/src/coach.ts`
- Create: `packages/core/tests/coach.test.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@vaultcompass/conductor-core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@vaultcompass/conductor-schema": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  }
}
```

- [ ] **Step 2: Write failing coach test**

`packages/core/tests/coach.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { scorePrompt, coachMessage } from "../src/coach.js";

describe("scorePrompt", () => {
  it("penalizes product_stack and scope_adverb patterns", () => {
    const result = scorePrompt(
      "Just quickly add export like Notion with sharing and PDF too",
    );
    expect(result.score).toBeLessThan(60);
    expect(result.issues).toContain("product_stack");
    expect(result.issues).toContain("scope_adverb");
  });

  it("scores a clear prompt higher", () => {
    const result = scorePrompt(
      "Add CSV export for the fund table. Client-side only. No PDF.",
    );
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.issues).toHaveLength(0);
  });
});

describe("coachMessage", () => {
  it("returns rewrite suggestion for low scores", () => {
    const scored = scorePrompt("Just quickly rebuild everything like Notion");
    const msg = coachMessage(scored, "Just quickly rebuild everything like Notion");
    expect(msg).toContain("Prompt variance");
    expect(msg).toContain("Suggested rewrite");
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
cd packages/core && pnpm install && pnpm test
```

- [ ] **Step 4: Implement `packages/core/src/coach-patterns.ts`**

```typescript
export type CoachPatternId =
  | "product_stack"
  | "comparative_overload"
  | "scope_adverb"
  | "implicit_pivot"
  | "authority_without_spec"
  | "constraint_conflict"
  | "vague_ask"
  | "missing_acceptance_criteria";

export interface CoachPattern {
  id: CoachPatternId;
  detect: (text: string, context?: { constraints?: string[] }) => boolean;
  coaching: string;
}

const PRODUCT_NAMES =
  /\b(notion|figma|linear|slack|airtable|jira|github|vercel|supabase)\b/i;

export const COACH_PATTERNS: CoachPattern[] = [
  {
    id: "product_stack",
    detect: (text) => {
      const matches = text.match(PRODUCT_NAMES) ?? [];
      return matches.length >= 2;
    },
    coaching: "Multiple product references imply multiple architectures. Pick one workflow.",
  },
  {
    id: "comparative_overload",
    detect: (text) => (text.match(/\blike\s+\w+/gi) ?? []).length > 2,
    coaching: "Too many comparators create conflicting frames. Describe without 'like X'.",
  },
  {
    id: "scope_adverb",
    detect: (text) =>
      /\b(just|quickly|simply|only)\b/i.test(text) &&
      text.split(/\s+/).length > 8,
    coaching: "Minimizers ('just', 'quickly') cause models to skip edge cases and tests.",
  },
  {
    id: "implicit_pivot",
    detect: (text) => /\b(actually|also|while we're at it|and another thing)\b/i.test(text),
    coaching: "Scope change detected. Log a pivot in the contract before continuing.",
  },
  {
    id: "authority_without_spec",
    detect: (text) => /\b(you know|the usual|standard approach|obviously)\b/i.test(text),
    coaching: "State explicit requirements instead of assuming shared context.",
  },
  {
    id: "vague_ask",
    detect: (text) => text.trim().length < 20,
    coaching: "Ask is too short. Include: what, for whom, and how to verify done.",
  },
  {
    id: "constraint_conflict",
    detect: (text, context) => {
      if (!context?.constraints?.length) return false;
      const lower = text.toLowerCase();
      return (
        /\b(refactor everything|rewrite|redesign)\b/i.test(lower) &&
        context.constraints.some((c) => /no major redesign|minimize scope/i.test(c))
      );
    },
    coaching: "This request conflicts with a loaded project constraint.",
  },
  {
    id: "missing_acceptance_criteria",
    detect: (text) =>
      !/\b(should|must|when|verify|test|acceptance|done when)\b/i.test(text) &&
      text.split(/\s+/).length > 6,
    coaching: "Add testable acceptance criteria: what does 'done' look like?",
  },
];

export function detectPatterns(
  text: string,
  context?: { constraints?: string[] },
): CoachPatternId[] {
  return COACH_PATTERNS.filter((p) => p.detect(text, context)).map((p) => p.id);
}
```

- [ ] **Step 5: Implement `packages/core/src/coach.ts`**

```typescript
import { COACH_PATTERNS, detectPatterns, type CoachPatternId } from "./coach-patterns.js";

export interface PromptScore {
  score: number;
  issues: CoachPatternId[];
}

export function scorePrompt(
  text: string,
  context?: { constraints?: string[]; hasAcceptanceCriteria?: boolean },
): PromptScore {
  const issues = detectPatterns(text, context);
  let score = 100;
  score -= Math.min(issues.length * 15, 60);
  if (text.trim().length < 20) score -= 10;
  if (context?.hasAcceptanceCriteria) score += 5;
  return { score: Math.max(0, Math.min(100, score)), issues };
}

export function coachMessage(scored: PromptScore, originalText: string): string {
  if (scored.score >= 60 && scored.issues.length === 0) {
    return "";
  }
  const lines = COACH_PATTERNS.filter((p) => scored.issues.includes(p.id)).map(
    (p) => `- ${p.id}: ${p.coaching}`,
  );
  return [
    "**Prompt variance warning**",
    ...lines,
    "",
    "**Suggested rewrite:**",
    narrowPrompt(originalText),
  ].join("\n");
}

function narrowPrompt(text: string): string {
  const stripped = text
    .replace(/\b(just|quickly|simply)\b/gi, "")
    .replace(/\blike\s+\w+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 10
    ? `"${stripped}. State explicit boundaries and how to verify done."`
    : '"Describe one feature, client-side scope, and testable done criteria."';
}
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
cd packages/core && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): add prompt coach patterns and quality scoring"
```

---

### Task 4: Drift rubric and rule-based scorer

**Files:**
- Create: `packages/core/src/rubric.ts`
- Create: `packages/core/src/drift.ts`
- Create: `packages/core/tests/drift.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing drift test**

`packages/core/tests/drift.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { IntentContract } from "@vaultcompass/conductor-schema";
import { scoreDrift } from "../src/drift.js";

const baseContract: IntentContract = {
  contract_id: "ic-20260617-a3f9k2",
  version: "1.0.0",
  original_ask: "Add CSV export for the fund performance table.",
  in_scope: ["Client-side CSV export of fund table"],
  out_of_scope: ["PDF export", "New API endpoints", "WebSocket"],
  constraints: [
    {
      source: "CLAUDE.md",
      rule: "No new API endpoints without explicit approval",
      priority: "critical",
    },
  ],
  acceptance_criteria: [
    { id: "ac-1", description: "Export downloads CSV", testable: true },
  ],
  frozen_at: "2026-06-17T14:30:00Z",
  pivot_log: [],
};

describe("scoreDrift", () => {
  it("scores low drift for aligned diff signals", () => {
    const result = scoreDrift(baseContract, {
      changedPaths: ["src/components/ExportButton.tsx"],
      signals: [],
    });
    expect(result.overall).toBeLessThan(30);
    expect(result.action).toBe("proceed");
  });

  it("scores high drift for API + websocket outside scope", () => {
    const result = scoreDrift(baseContract, {
      changedPaths: ["src/app/api/export/route.ts", "src/hooks/useWebSocket.ts"],
      signals: ["new_api_route", "websocket_added"],
    });
    expect(result.overall).toBeGreaterThan(70);
    expect(result.action).toBe("soft_block");
    expect(result.categories.constraint_violation).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/core && pnpm test
```

- [ ] **Step 3: Implement `packages/core/src/rubric.ts`**

```typescript
export const DRIFT_WEIGHTS = {
  scope_creep: 0.35,
  constraint_violation: 0.35,
  ac_divergence: 0.2,
  undocumented_pivot: 0.1,
} as const;

export const DRIFT_THRESHOLDS = {
  info: 26,
  warn: 51,
  soft_block: 71,
  hard_block: 86,
} as const;

export type DriftAction = "proceed" | "info" | "warn" | "soft_block" | "hard_block";

export function driftAction(overall: number): DriftAction {
  if (overall >= DRIFT_THRESHOLDS.hard_block) return "hard_block";
  if (overall >= DRIFT_THRESHOLDS.soft_block) return "soft_block";
  if (overall >= DRIFT_THRESHOLDS.warn) return "warn";
  if (overall >= DRIFT_THRESHOLDS.info) return "info";
  return "proceed";
}
```

- [ ] **Step 4: Implement `packages/core/src/drift.ts`**

```typescript
import type { IntentContract } from "@vaultcompass/conductor-schema";
import { DRIFT_WEIGHTS, driftAction, type DriftAction } from "./rubric.js";

export interface DriftSignals {
  changedPaths?: string[];
  signals?: string[];
  userMessage?: string;
}

export interface DriftScore {
  overall: number;
  action: DriftAction;
  categories: {
    scope_creep: number;
    constraint_violation: number;
    ac_divergence: number;
    undocumented_pivot: number;
  };
  findings: string[];
}

const API_PATH = /\/api\/|api\//i;
const WEBSOCKET_PATH = /websocket|useWebSocket|ws\./i;

export function scoreDrift(contract: IntentContract, input: DriftSignals): DriftScore {
  const findings: string[] = [];
  const paths = input.changedPaths ?? [];

  let scopeCreep = 0;
  let constraintViolation = 0;
  let acDivergence = 0;
  let undocumentedPivot = 0;

  const outOfScopeHits = contract.out_of_scope.filter((item) => {
    const key = item.toLowerCase();
    if (key.includes("api") && paths.some((p) => API_PATH.test(p))) {
      findings.push(`New API path conflicts with out_of_scope: ${item}`);
      return true;
    }
    if (key.includes("websocket") && paths.some((p) => WEBSOCKET_PATH.test(p))) {
      findings.push(`WebSocket change conflicts with out_of_scope: ${item}`);
      return true;
    }
    return false;
  });
  if (outOfScopeHits.length > 0) scopeCreep = Math.min(100, outOfScopeHits.length * 40);

  const hasApi = paths.some((p) => API_PATH.test(p));
  const criticalNoApi = contract.constraints.some(
    (c) => c.priority === "critical" && /no new api/i.test(c.rule),
  );
  if (hasApi && criticalNoApi) {
    constraintViolation = 90;
    findings.push("Critical constraint violated: no new API endpoints");
  }

  if (input.signals?.includes("websocket_added")) {
    scopeCreep = Math.max(scopeCreep, 80);
  }

  if (
    input.userMessage &&
    /\b(actually|also|while we're at it)\b/i.test(input.userMessage) &&
    contract.pivot_log.every((p) => p.acknowledged_by !== "user")
  ) {
    undocumentedPivot = 70;
    findings.push("User message suggests pivot without pivot_log entry");
  }

  const categories = {
    scope_creep: scopeCreep,
    constraint_violation: constraintViolation,
    ac_divergence: acDivergence,
    undocumented_pivot: undocumentedPivot,
  };

  const overall = Math.round(
    categories.scope_creep * DRIFT_WEIGHTS.scope_creep +
      categories.constraint_violation * DRIFT_WEIGHTS.constraint_violation +
      categories.ac_divergence * DRIFT_WEIGHTS.ac_divergence +
      categories.undocumented_pivot * DRIFT_WEIGHTS.undocumented_pivot,
  );

  return {
    overall,
    action: driftAction(overall),
    categories,
    findings,
  };
}
```

- [ ] **Step 5: Update `packages/core/src/index.ts`**

```typescript
export { COACH_PATTERNS, detectPatterns } from "./coach-patterns.js";
export { scorePrompt, coachMessage, type PromptScore } from "./coach.js";
export { DRIFT_WEIGHTS, DRIFT_THRESHOLDS, driftAction } from "./rubric.js";
export { scoreDrift, type DriftScore, type DriftSignals } from "./drift.js";
```

- [ ] **Step 6: Run all core tests — expect PASS**

```bash
cd packages/core && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): add rule-based drift scoring rubric"
```

---

### Task 5: Example contracts and root test script

**Files:**
- Create: `examples/intent-contracts/csv-export.yaml`
- Create: `examples/intent-contracts/netviz-retrospective.yaml`
- Create: `examples/intent-contracts/validate-examples.test.ts` (root)
- Modify: `package.json` (add vitest at root)

- [ ] **Step 1: Create `examples/intent-contracts/csv-export.yaml`**

Use content from `docs/schemas/intent-contract.example.md` (YAML block).

- [ ] **Step 2: Create `examples/intent-contracts/netviz-retrospective.yaml`**

```yaml
contract_id: ic-20260315-netviz01
version: "1.0.0"
original_ask: "Build Wi-Fi network visualization with real notifications and safety scores."
in_scope:
  - "3D network map visualization"
  - "Real system notifications for alerts"
  - "Safety scores calculated from device metrics"
  - "Persistent user preferences"
out_of_scope:
  - "Stub implementations with println only"
  - "Hardcoded safety score values"
constraints:
  - source: user-stated
    rule: "All features must be functional, not stubbed"
    priority: critical
acceptance_criteria:
  - id: ac-1
    description: "Notifications use OS/Tauri notification API"
    testable: true
  - id: ac-2
    description: "Safety scores derived from live metrics, not constants"
    testable: true
  - id: ac-3
    description: "Preferences persist across app restarts"
    testable: true
frozen_at: "2026-03-15T10:00:00Z"
frozen_by: user
pivot_log: []
metadata:
  project: netviz
  note: "Retrospective contract — what should have been frozen"
```

- [ ] **Step 3: Add root validation test**

`examples/validate-examples.test.ts`:

```typescript
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, it, expect } from "vitest";
import { validateIntentContract } from "@vaultcompass/conductor-schema";

const dir = join(import.meta.dirname, "intent-contracts");

describe("example intent contracts", () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    it(`validates ${file}`, () => {
      const raw = parse(readFileSync(join(dir, file), "utf8"));
      const result = validateIntentContract(raw);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }
});
```

- [ ] **Step 4: Add root devDeps**

Root `package.json` scripts add:

```json
"test": "pnpm -r test && vitest run examples/validate-examples.test.ts"
```

Root devDependencies: `vitest`, `yaml`, `@vaultcompass/conductor-schema` workspace.*

- [ ] **Step 5: Run full test suite**

```bash
pnpm install && pnpm test
```

Expected: all package tests + example validation PASS

- [ ] **Step 6: Commit**

```bash
git add examples package.json pnpm-lock.yaml
git commit -m "test: add example intent contracts and validation suite"
```

---

### Task 6: NetViz retrospective exit gate

**Files:**
- Create: `docs/retrospectives/netviz-drift-score.md`
- Create: `packages/core/tests/netviz-retrospective.test.ts`

- [ ] **Step 1: Write retrospective test**

Simulate NetViz stubbed implementation paths:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { scoreDrift } from "../src/drift.js";
import type { IntentContract } from "@vaultcompass/conductor-schema";

describe("NetViz retrospective", () => {
  it("drift score >= 70 for stubbed implementation signals", () => {
    const contract = parse(
      readFileSync(
        join(import.meta.dirname, "../../../examples/intent-contracts/netviz-retrospective.yaml"),
        "utf8",
      ),
    ) as IntentContract;

    const result = scoreDrift(contract, {
      changedPaths: [
        "src-tauri/src/notification_system.rs",
        "src-tauri/src/safety_score.rs",
      ],
      signals: ["stub_println_notification", "hardcoded_safety_score"],
    });

    // Stub signals should elevate scope/constraint findings
    expect(result.overall).toBeGreaterThanOrEqual(70);
  });
});
```

Extend `scoreDrift` if needed to recognize `stub_println_notification` and `hardcoded_safety_score` signals (+40 scope_creep each).

- [ ] **Step 2: Document retrospective**

`docs/retrospectives/netviz-drift-score.md` — record actual score, findings, and "would have caught" narrative.

- [ ] **Step 3: Run test — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add docs/retrospectives packages/core/tests/netviz-retrospective.test.ts
git commit -m "docs: add NetViz retrospective drift exit gate"
```

---

### Task 7: Phase 1 release prep

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `BRAINSTORMING.md` (mark spec approved)
- Modify: `packages/README.md`

- [ ] **Step 1: Update CHANGELOG Unreleased → 0.1.0-alpha**

- [ ] **Step 2: Update README with install/test instructions**

```markdown
## Development

pnpm install
pnpm test
pnpm build
```

- [ ] **Step 3: Tag alpha (optional)**

```bash
git tag v0.1.0-alpha
git push origin v0.1.0-alpha
```

- [ ] **Step 4: Final commit and push**

```bash
git add -A
git commit -m "chore: complete Phase 1 schema and core packages"
git push origin main
```

---

## Spec coverage check

| Spec section | Task |
|--------------|------|
| §4 Intent Contract schema | Task 2 |
| §5 Drift rubric | Task 4 |
| §6 Prompt coach | Task 3 |
| §7 Memory index | Phase 2 (deferred) |
| §8 Integrations | Phase 2 (deferred) |
| §9 CLI | Phase 4 (deferred) |
| Exit gate NetViz ≥70 | Task 6 |

## Phase 1 complete when

- [ ] `pnpm test` green at repo root
- [ ] 5 example contracts validate
- [ ] NetViz retrospective drift ≥ 70
- [ ] Packages publishable locally via workspace
- [ ] Pushed to `github.com/vaultcompasshq/conductor`

---

**Plan complete.** Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks
2. **Inline Execution** — implement tasks in this session with checkpoints

Which approach?
