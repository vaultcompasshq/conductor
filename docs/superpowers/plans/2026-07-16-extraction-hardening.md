# Extraction & Constraint-Loader Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five concrete extraction/constraint-loader bugs found by running the built `conductor` CLI against real local repos (EngineeringAgents, Sheetful, vault-guard, kitchen-spell-lab) with realistic multi-clause asks, instead of the canned synthetic asks the existing test suite and `scripts/validate-public-repos.mjs` use.

**Architecture:** All five bugs live in two existing pure functions files — `packages/core/src/extract.ts` (contract drafting: in_scope/out_of_scope extraction) and `packages/core/src/constraints.ts` (AGENTS.md/CLAUDE.md rule loading). No new files, no new public API surface — each fix is a targeted change to an existing function plus regression tests reproducing the exact real-world input that triggered it.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces (existing `packages/core` package).

## Global Constraints

- All work lands on `main` via PR — never push directly to `main` (repo convention, see `[[always-pr-to-main]]`).
- CI must be green before merge: install → build → typecheck → portfolio-name guard → test → release smoke, Node 22.
- Baseline is 143 passing tests (`pnpm test`, which builds first). Every task must leave the full suite green — no regressions in the existing 143.
- Match existing code style in both files: no comments except load-bearing ones (the existing files already follow this — short "why" comments above non-obvious regex/logic, nothing describing "what").
- Update `CHANGELOG.md` under `## [Unreleased]` as the final task, per this repo's established pattern of one changelog entry per shipped fix.

---

## File Structure

- Modify: `packages/core/src/extract.ts` — `extractInScope` (Task 1), `extractOutOfScope` (Task 2), `expandProhibitionLists` (Task 3).
- Modify: `packages/core/src/constraints.ts` — `isRuleLine` + new helper (Task 4), `NORMATIVE` regex (Task 5).
- Modify: `packages/core/tests/extract.test.ts` — regression tests for Tasks 1–3.
- Modify: `packages/core/tests/constraints.test.ts` — regression tests for Tasks 4–5.
- Modify: `CHANGELOG.md` — Task 6.

---

### Task 1: `extractInScope` drops a legitimate clause when its verb isn't in the curated `ACTION_VERBS` list

**Bug:** Ask: *"Blend the celebration audio cue with the existing background music in audioManager.ts. and fix the related accessibility labels for the Missing Sound station. Do not touch level unlock order or add new levels. Done when the audio blend has test coverage and a11y checks pass."* → `in_scope` contains **only** the accessibility-labels clause. The "Blend…" clause — the primary ask — silently disappears.

**Root cause:** `textClauses` splits an "X and Y" imperative sentence into two clauses whenever the *second* clause's verb is in `ACTION_VERBS` (that's the split trigger — see `extract.ts:162-174`). `parseActionClauses` correctly classifies both resulting clauses as imperatives (neither is a prohibition). But `extractInScope` (`extract.ts:298-301`) then re-filters every imperative through `ACTION_RE.test(c)` independently. Since "blend" isn't in the 30-word `ACTION_VERBS` whitelist, clause 1 fails this second filter and is dropped — even though the split that produced it already proved it's part of a genuine multi-part imperative sentence.

**Files:**
- Modify: `packages/core/src/extract.ts:287-305` (`extractInScope`)
- Test: `packages/core/tests/extract.test.ts`

**Interfaces:**
- Consumes: `parseActionClauses(text)` (existing, `extract.ts:251`) — returns `{ imperatives: string[], prohibitions: string[] }`.
- No signature changes; `extractInScope(text: string): string[]` keeps its existing signature and is only called internally by `draftContract`.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/tests/extract.test.ts`, inside the existing `describe("draftContract", ...)` block:

```ts
  it("keeps a multi-clause imperative even when the first verb isn't in the curated action list", () => {
    const contract = draftContract({
      userText:
        "Blend the celebration audio cue with the existing background music in audioManager.ts. and fix the related accessibility labels for the Missing Sound station. Do not touch level unlock order or add new levels. Done when the audio blend has test coverage and a11y checks pass.",
    });
    expect(contract.in_scope.some((s) => /blend/i.test(s))).toBe(true);
    expect(contract.in_scope.some((s) => /accessibility labels/i.test(s))).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vaultcompass/conductor-core test -- extract.test.ts`
Expected: FAIL — `contract.in_scope.some((s) => /blend/i.test(s))` is `false`.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/extract.ts`, replace the `extractInScope` body's middle section:

```ts
function extractInScope(text: string): string[] {
  const { imperatives } = parseActionClauses(text);
  const bullets = bulletItems(text);

  if (bullets.length > 0) {
    return uniqueItems(
      imperatives.filter((item) => !isLeadingProhibitionClause(item)),
      12,
    );
  }

  // A multi-clause "X and Y" imperative sentence only needs its *second*
  // clause to contain a recognized action verb to trigger the split (see
  // textClauses). Once split, trust every resulting clause instead of
  // re-filtering each one through the same curated verb list — otherwise a
  // legitimate first clause phrased with an uncommon verb (e.g. "blend")
  // is silently dropped even though the split already proved this is a
  // genuine multi-part imperative sentence.
  const clauses =
    imperatives.length > 1
      ? imperatives.filter((c) => !isLeadingProhibitionClause(c))
      : imperatives.filter(
          (c) => ACTION_RE.test(c) && !isLeadingProhibitionClause(c),
        );
  if (clauses.length > 0) return uniqueItems(clauses, 8);

  const fallback = oneSentence(text, 200);
  return fallback.length >= 5 ? [fallback] : ["Describe the requested change"];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vaultcompass/conductor-core test -- extract.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full core suite to check for regressions**

Run: `pnpm --filter @vaultcompass/conductor-core test`
Expected: PASS, no regressions. If a pre-existing test now fails, read it — it likely relied on the multi-clause path dropping a non-verb fragment. Do not weaken the new test to fix it; instead check whether the failing fixture's second "clause" is actually meaningful content (if so, the old assertion was wrong and should be updated) or noise (if so, tighten `isLeadingProhibitionClause`/`textClauses` for that fixture's specific shape, not this filter). Ask before changing an existing test's expected values.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/extract.ts packages/core/tests/extract.test.ts
git commit -m "fix: keep multi-clause in_scope items with verbs outside the curated list"
```

---

### Task 2: `extractOutOfScope` bleeds into the next sentence and truncates mid-word

**Bug 1 (cross-sentence bleed):** Ask ending *"…add new GitHub Actions jobs. Done when CI passes on the bumped action versions."* → `out_of_scope` contains `"Do not change the scanning rule set or add new GitHub Actions jobs. Done when CI passes"` — the acceptance-criteria sentence bleeds in and gets cut off mid-clause.

**Bug 2 (mid-word truncation):** Ask containing *"Do not change the Google OAuth drive.file scope configuration or the Plaid removeItem ordering."* → `out_of_scope` contains a truncated duplicate `"...removeItem or"` alongside the correct `"...removeItem ordering"`.

**Root cause:** `extractOutOfScope` (`extract.ts:324-360`) runs its regex patterns via `text.matchAll(pattern)` over the **entire raw multi-sentence text at once**, with a tail character class `[\w\s/.\-]{3,80}` that (a) includes a literal `.`, so a match doesn't stop at real sentence boundaries, and (b) caps at only 80 characters, which real prohibition clauses (verb + full object) routinely exceed, producing mid-word cutoffs. Both symptoms share one fix: bound each match to its own sentence.

**Files:**
- Modify: `packages/core/src/extract.ts:324-360` (`extractOutOfScope`)
- Test: `packages/core/tests/extract.test.ts`

**Interfaces:**
- Consumes: `splitSentences(text)` (existing, `extract.ts:64-85`) — already correctly treats filename-extension periods (e.g. `.ts.`, `package.json.`) as non-terminal, so per-sentence processing doesn't reintroduce the 1.0.2/1.0.3 filename-boundary bugs.
- No signature changes; `extractOutOfScope(text: string): string[]` keeps its existing signature.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/tests/extract.test.ts`, inside `describe("draftContract", ...)`:

```ts
  it("does not bleed acceptance-criteria text into out_of_scope", () => {
    const contract = draftContract({
      userText:
        "Bump github/codeql-action/init and github/codeql-action/analyze to 4.37.0 and actions/checkout to 7.0.0 in the CI workflow files. Do not change the scanning rule set or add new GitHub Actions jobs. Done when CI passes on the bumped action versions.",
    });
    expect(contract.out_of_scope.some((s) => /done when/i.test(s))).toBe(false);
    expect(contract.out_of_scope.some((s) => /^Do not change the scanning rule set/i.test(s))).toBe(true);
  });

  it("does not truncate a long prohibition clause mid-word", () => {
    const contract = draftContract({
      userText:
        "Fix the auth callback bug. Do not change the Google OAuth drive.file scope configuration or the Plaid removeItem ordering. Done when tests pass.",
    });
    expect(contract.out_of_scope.some((s) => /removeitem or$/i.test(s))).toBe(false);
    expect(contract.out_of_scope.some((s) => /removeitem ordering$/i.test(s))).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @vaultcompass/conductor-core test -- extract.test.ts`
Expected: FAIL on both new tests.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/extract.ts`, replace `extractOutOfScope`:

```ts
function extractOutOfScope(text: string): string[] {
  const tail = String.raw`[\w\s/.\-]{3,200}`;
  const patterns = [
    new RegExp(String.raw`\bdo\s+not\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bmust\s+not\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bshould\s+not\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bshall\s+not\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bcannot\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bcan't\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bnever\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bavoid\s+([a-z]${tail})`, "gi"),
    new RegExp(String.raw`\bno\s+([a-z]${tail})`, "gi"),
    new RegExp(
      String.raw`\bwithout\s+(approval|permission|changing|modifying|adding|removing|introducing|writing)\s+([a-z]${tail})`,
      "gi",
    ),
  ];
  const items: string[] = [];
  items.push(...expandProhibitionLists(text));
  // Match within one sentence at a time so a prohibition clause can't run
  // past its own sentence boundary into the next one (e.g. an acceptance
  // criteria "Done when..." clause), and so the capture isn't capped at a
  // fixed small character budget that truncates real-world clauses
  // mid-word — each sentence is already correctly bounded by
  // splitSentences, including filename-extension periods.
  for (const sentence of splitSentences(text)) {
    for (const pattern of patterns) {
      for (const match of sentence.matchAll(pattern)) {
        const item = match[0].trim().replace(/\s+/g, " ");
        if (item.length >= 5 && item.length <= 200 && isValidOutOfScopeItem(item)) {
          items.push(item);
        }
      }
    }
  }
  const unique = uniqueItems(items, 12);
  return unique
    .filter((item, index) => {
      const key = item.toLowerCase();
      return !unique
        .slice(0, index)
        .some((previous) => previous.toLowerCase().includes(key));
    })
    .slice(0, 8);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vaultcompass/conductor-core test -- extract.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full core suite to check for regressions**

Run: `pnpm --filter @vaultcompass/conductor-core test`
Expected: PASS. Pay particular attention to any existing test in `extract.test.ts` that asserts an exact `out_of_scope` array length — raising the tail cap from 80 to 200 could change truncation-dependent expectations. If one exists and now captures more (correct) text than before, update its expected value; do not shrink the tail cap back down to make it pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/extract.ts packages/core/tests/extract.test.ts
git commit -m "fix: bound out_of_scope prohibition matches to their own sentence"
```

---

### Task 3: `expandProhibitionLists` fabricates nonsense text for compound "do not A or B, and do not C" prohibitions

**Bug:** Ask: *"Do not modify the agents' verification protocol logic in agents/4b or agents/4c, and do not add new agent capabilities."* → `out_of_scope` includes:

```
"Do not modify do not add new agent capabilities"
```

This sentence appears nowhere in the input — it splices clause 1's verb ("Do not modify") onto clause 2's object ("do not add new agent capabilities").

**Root cause:** `expandProhibitionLists` (`extract.ts:266-285`) matches `do not <verb> <rest>`, then splits `rest` on commas and prepends the *original* `prefix + verb` to every resulting fragment — assuming each fragment is always a bare object continuing the same verb (e.g. "do not touch A, B, or C"). It doesn't handle the case where a fragment is itself a second independent clause ("...**and do not add** new agent capabilities").

**Files:**
- Modify: `packages/core/src/extract.ts:266-285` (`expandProhibitionLists`)
- Test: `packages/core/tests/extract.test.ts`

**Interfaces:**
- No signature changes; `expandProhibitionLists(text: string): string[]` keeps its existing signature and remains called only from `extractOutOfScope`.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/tests/extract.test.ts`, inside `describe("draftContract", ...)`:

```ts
  it("does not fabricate a garbled prohibition from a compound do-not clause", () => {
    const contract = draftContract({
      userText:
        "Fix the vulnerabilities in package.json. Do not modify the verification protocol logic in agents/4b or agents/4c, and do not add new agent capabilities.",
    });
    expect(contract.out_of_scope.some((s) => /modify do not add/i.test(s))).toBe(false);
    expect(contract.out_of_scope.some((s) => /^do not add new agent capabilities$/i.test(s))).toBe(true);
    expect(contract.out_of_scope.some((s) => /agents\/4b or agents\/4c/i.test(s))).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vaultcompass/conductor-core test -- extract.test.ts`
Expected: FAIL — `some((s) => /modify do not add/i.test(s))` is `true` (the fabricated string is present).

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/extract.ts`, add a helper above `expandProhibitionLists` and update the function:

```ts
// A comma-separated fragment that itself starts a new "and/or do not …"
// clause is an independent prohibition, not a bare object of the outer
// verb — gluing the outer prefix onto it fabricates text that never
// appeared in the input (e.g. "do not modify do not add new agent
// capabilities").
const NEW_CLAUSE_PROHIBITION_RE =
  /^(?:and|or)\s+(do not|don't|must not|should not|shall not|cannot|can't|never|avoid|no)\s+(.+)$/i;

function expandProhibitionLists(text: string): string[] {
  const items: string[] = [];
  const pattern =
    /\b(do not|don't|must not|should not|shall not|cannot|can't|never|avoid|no)\s+([a-z]+)\s+([^.!?]{3,200})/gi;

  for (const match of text.matchAll(pattern)) {
    const prefix = match[1].replace(/\s+/g, " ");
    const verb = match[2];
    const rest = match[3];
    if (!rest.includes(",")) continue;

    for (const part of rest.split(",")) {
      const trimmedPart = part.trim();
      const newClause = trimmedPart.match(NEW_CLAUSE_PROHIBITION_RE);
      if (newClause) {
        const target = normalizeItem(newClause[2]);
        if (target.length < 5) continue;
        items.push(`${newClause[1].toLowerCase()} ${target}`);
        continue;
      }
      const target = normalizeItem(trimmedPart.replace(/^(and|or)\s+/i, ""));
      if (target.length < 5) continue;
      items.push(`${prefix} ${verb} ${target}`);
    }
  }

  return items;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vaultcompass/conductor-core test -- extract.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full core suite to check for regressions**

Run: `pnpm --filter @vaultcompass/conductor-core test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/extract.ts packages/core/tests/extract.test.ts
git commit -m "fix: stop expandProhibitionLists from fabricating garbled compound prohibitions"
```

---

### Task 4: constraint loader captures bare file-path reference bullets as "rules" under a rules-style heading

**Bug:** A real `AGENTS.md` has:

```markdown
## Vault & Compass workspace rules

When working inside `Desktop/Projects`, also respect:

- `.cursor/rules/vault-compass-conventions.mdc`
- `.cursor/rules/security.mdc`
```

`conductor rules audit` reports both bullets as standalone "rules" with the rule text literally being just the backtick-quoted file path — not a natural-language statement of any kind.

**Root cause:** `underRuleHeading` (`constraints.ts:107-121`) is sticky — it stays `true` for every line until the *next* `#`-prefixed line, no matter how much unrelated content follows. `isRuleLine` (`constraints.ts:78-87`) treats *any* bullet under a rule-flavored heading as a rule, including a bullet whose entire content is a bare code-span reference with no descriptive prose.

**Files:**
- Modify: `packages/core/src/constraints.ts:52-87` (add helper, update `isRuleLine`)
- Test: `packages/core/tests/constraints.test.ts`

**Interfaces:**
- No signature changes; `extractConstraintsFromMarkdown` keeps its existing signature.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/tests/constraints.test.ts`, inside `describe("extractConstraintsFromMarkdown precision", ...)`:

```ts
  it("does not capture a bare file-path reference bullet as a rule, even under a rules heading", () => {
    const md = [
      "## Workspace rules",
      "",
      "When working here, also respect:",
      "",
      "- `.cursor/rules/conventions.mdc`",
      "- `.cursor/rules/security.mdc`",
    ].join("\n");
    const rules = extractConstraintsFromMarkdown(md, "AGENTS.md");
    expect(rules).toHaveLength(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vaultcompass/conductor-core test -- constraints.test.ts`
Expected: FAIL — `rules` has length 2, not 0.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/constraints.ts`, add a helper above `isRuleLine` and update it:

```ts
// A bullet that's just a code-span reference (e.g. a file path) has no
// natural-language content and isn't a rule statement on its own, even
// under a rules-style heading.
function isBareCodeSpanReference(rule: string): boolean {
  const withoutCodeSpans = rule.replace(/`[^`]*`/g, "").trim();
  return withoutCodeSpans.length === 0;
}

function isRuleLine(
  rule: string,
  wasBullet: boolean,
  underRuleHeading: boolean,
): boolean {
  if (NORMATIVE.test(rule)) return true;
  if (LEADING_PROHIBITION.test(rule)) return true;
  if (underRuleHeading && wasBullet && !isBareCodeSpanReference(rule)) return true;
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vaultcompass/conductor-core test -- constraints.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full core suite to check for regressions**

Run: `pnpm --filter @vaultcompass/conductor-core test`
Expected: PASS. In particular, confirm `"captures bullets under a rules heading even without keywords"` (existing test, asserts `"Per-project config lives in app repos, not here"` is captured) still passes — it has no backticks, so `isBareCodeSpanReference` returns `false` for it and it's unaffected.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/constraints.ts packages/core/tests/constraints.test.ts
git commit -m "fix: don't capture bare code-span reference bullets as constraint rules"
```

---

### Task 5: `NORMATIVE` regex treats ordinary descriptive "require" as rule language

**Bug:** A real `CLAUDE.md` under an "Implementation Progress" heading (not a rules heading) has:

```markdown
- 23 remaining tests require mock authenticated data
```

This status note gets captured as a constraint with priority `low`. In a live `conductor check` run, the drift scorer then flagged it as "at risk" on an unrelated file change — a false positive on prose that isn't a rule at all.

**Root cause:** `NORMATIVE` (`constraints.ts:68-69`) includes `required?` as an alternative, which is `\brequired?\b` — this matches the bare word "require" (not just "required") whenever it appears as a standalone word, which happens constantly in ordinary descriptive English ("N tests require Y") with no normative intent.

**Files:**
- Modify: `packages/core/src/constraints.ts:68-69` (`NORMATIVE` regex)
- Test: `packages/core/tests/constraints.test.ts`

**Interfaces:**
- No signature changes.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/tests/constraints.test.ts`, inside `describe("extractConstraintsFromMarkdown precision", ...)`:

```ts
  it("does not treat descriptive prose using bare 'require' as a rule", () => {
    const md = [
      "## Implementation Progress",
      "",
      "- 23 remaining tests require mock authenticated data",
    ].join("\n");
    const rules = extractConstraintsFromMarkdown(md, "CLAUDE.md");
    expect(rules).toHaveLength(0);
  });

  it("still treats 'required' as normative language", () => {
    const rules = extractConstraintsFromMarkdown(
      "- Approval is required before merging to main",
      "AGENTS.md",
    );
    expect(rules.map((r) => r.rule)).toContain(
      "Approval is required before merging to main",
    );
  });
```

- [ ] **Step 2: Run tests to verify the first fails**

Run: `pnpm --filter @vaultcompass/conductor-core test -- constraints.test.ts`
Expected: `"does not treat descriptive prose..."` FAILS (`rules` has length 1, not 0). `"still treats 'required'..."` already PASSES (confirms the fix must not regress this case).

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/constraints.ts`, change:

```ts
const NORMATIVE =
  /\b(must not|must|never|do not|don't|dont|shall not|shall|always|required?|avoid|prefer|cannot|can't|should not|should|minimi[sz]e)\b/i;
```

to:

```ts
const NORMATIVE =
  /\b(must not|must|never|do not|don't|dont|shall not|shall|always|required|avoid|prefer|cannot|can't|should not|should|minimi[sz]e)\b/i;
```

(Drop the `?` after `require` so only the adjectival/passive form "required" — e.g. "is required", "Required:" — counts as normative, not the bare descriptive verb "require".)

- [ ] **Step 4: Run tests to verify both pass**

Run: `pnpm --filter @vaultcompass/conductor-core test -- constraints.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full core suite to check for regressions**

Run: `pnpm --filter @vaultcompass/conductor-core test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/constraints.ts packages/core/tests/constraints.test.ts
git commit -m "fix: stop NORMATIVE regex from matching descriptive 'require' as rule language"
```

---

### Task 6: Changelog and full verification

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a changelog entry**

In `CHANGELOG.md`, under the existing `## [Unreleased]` heading (currently empty, right below `## [1.0.7] - 2026-07-13`), add:

```markdown
## [Unreleased]

### Fixed

- **Extraction:** a multi-clause "X and Y" imperative ask no longer drops
  clause X from `in_scope` when its verb isn't in the curated action-verb
  list (found via local-repo validation).
- **Extraction:** out-of-scope prohibition matches are now bounded to their
  own sentence, so a long prohibition clause no longer bleeds into the
  following acceptance-criteria sentence or gets truncated mid-word.
- **Extraction:** compound "do not A or B, and do not C" prohibitions no
  longer produce a fabricated, spliced-together `out_of_scope` entry.
- **Constraints:** a bare code-span reference bullet (e.g. a file path)
  under a rules-style heading is no longer captured as a standalone rule.
- **Constraints:** the constraint loader no longer treats descriptive prose
  using the bare word "require" (e.g. progress notes like "N tests require
  X") as normative rule language.
```

- [ ] **Step 2: Run the full test suite**

Run: `pnpm install && pnpm test`
Expected: All tests pass, count is 143 + the 7 new tests added in Tasks 1–5 = 150.

- [ ] **Step 3: Run typecheck and build**

Run: `pnpm build && pnpm -r typecheck`
Expected: No errors.

- [ ] **Step 4: Run the local-repo validation script again to confirm the original findings are fixed**

Re-run the ad-hoc validation against the same real local repos used to find these bugs (EngineeringAgents, Sheetful, vault-guard, kitchen-spell-lab) and confirm:
- The "Blend..." clause now appears in kitchen-spell-lab's `in_scope`.
- No `out_of_scope` entry crosses into "Done when..." text for any of the four repos.
- EngineeringAgents' `out_of_scope` no longer contains "Do not modify do not add new agent capabilities".
- EngineeringAgents' `rules audit` no longer lists the two `.cursor/rules/*.mdc` bare-path bullets.
- Sheetful's `rules audit` no longer lists "23 remaining tests require mock authenticated data".

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for extraction/constraint hardening fixes"
```

---

## Self-Review

**Spec coverage:** All 5 bugs from the audit (compound-prohibition fabrication, silent scope-clause drop, AC-bleed/truncation in out_of_scope, sticky-heading bare-reference rules, overbroad `require` matching) map 1:1 to Tasks 1–5. Task 6 covers changelog + full verification, matching this repo's established per-fix changelog convention.

**Placeholder scan:** No TBD/TODO/"add appropriate handling" — every step has literal code or an exact command with an expected result.

**Type consistency:** No new exported functions or type signatures; all changes are internal to existing non-exported functions (`extractInScope`, `extractOutOfScope`, `expandProhibitionLists`, `isRuleLine`) plus one new non-exported helper each in `extract.ts` (`NEW_CLAUSE_PROHIBITION_RE`, used only within the file) and `constraints.ts` (`isBareCodeSpanReference`, used only within the file).
