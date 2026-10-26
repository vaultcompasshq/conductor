# Proposed Rules Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pull request that changes the rules shows every proposed control change in the job log and step summary, names each policy key with its old and new value, and, when a gate key changed, runs the gates once more under the proposed policy as a labelled preview that never decides anything.

**Architecture:** Task 1 only renders what `RunResult.proposals` already carries. Task 2 adds a pure `src/policy-diff.ts` and has `policyForRun` parse the head policy without ever acting on it. Task 3 runs the gate loop a second time inside the same `runAll` call, with the family gates' trust base withheld, and returns its outcomes in a separate `RunResult.preview` that no exit-code, token or verdict function reads.

**Tech Stack:** TypeScript (ESM), Node 20 or later, Jest with experimental VM modules (`@jest/globals`; the repository uses Jest, not vitest), `spawnSync`, the bash `run:` blocks of `action.yml`.

**Spec:** `docs/superpowers/specs/2026-10-25-proposed-rules-preview-design.md`

## Global Constraints

- The preview never reaches `composeExitCode`, `verdictToken`, `verdict`, `isFullyClean`, `proposalCount` or lines 1 to 4 of the text report.
- The preview emits no SARIF result, only `conductor/preview-under-proposed-rules` notifications at level note.
- The preview never runs a head `command:` or `args:`. PATH pinning, the node_modules skip and `refuseHeadControlledProgram` apply to it exactly as to the primary run.
- The umbrella writes no gate's config and rewrites no gate's proposal sentence. Only its own `policy:` lines are new text.
- A primary could-not-run keeps exit 2 under `--advisory` (INVARIANTS.md:4593). A preview could-not-run changes nothing.
- One invocation spawns each gate at most twice: once for the primary run and once for the preview. The comment step still invokes conductor zero times (INVARIANTS.md:5308).
- Plain ASCII, no em or en dashes, and no machine paths in any tracked file. `pnpm lint` enforces this.
- Tests run as `GIT_CONFIG_GLOBAL=/dev/null pnpm test -- <file>` on this machine. Commit messages are plain ASCII with no backticks and no arrows.

## Review Focus

1. A proposal sentence carries head-controlled text, such as a package name or a ref, that could contain `::error::`, a backtick or a markdown link. In the job log it would become a workflow command, and in the step summary it would render as markup. Task 1 passes every log line through `breakWorkflowMarkers`, copies to the summary only whole fixed-shape lines with no backtick inside a fenced block, and tests both.
2. A head `.guardrails.yaml` that is valid YAML but fails `parsePolicy`, for example a relative `command:`. Today the head is never parsed, so a new parse must not turn a bad head into exit 2. Task 2 tests that it yields the not-known line and the primary verdict is unchanged.
3. The head adds `command:` on a role the base does not have, so there is no base value to fall back on. Task 3 tests that the preview drops it and the marker script never runs.
4. The head changes only `report.format`, or only spells out defaults (`enabled: true`). Task 2 tests that the first gives one role-less line and the second gives the old fallback line. Task 3 tests that neither starts a preview.
5. The head enables a gate whose binary is absent, so the preview has a could-not-run. Task 3 tests that `exitCode`, the token and the `proposalCount` sentence are those of the primary run alone, with and without `--advisory`.

---

### Task 1: Proposals in the job log and the step summary

**Files:**
- Modify: `src/output-text.ts:619-634` (`proposalCount`, unchanged), add `proposalLogLines` beside `gateLogLines` (`:817`)
- Modify: `src/cli.ts:905-916` (log lines)
- Modify: `action.yml:1205-1229` (summary copy)
- Modify: `README.md:769` (pull-request trust boundary section), `CHANGELOG.md` Unreleased, Added
- Test: `tests/output-text.test.ts`, `tests/cli.test.ts` (describe "pull-request mode through the CLI", :1535), `tests/action.test.ts` (beside :2253)

**Interfaces:**
- Consumes: `proposalCount(result: RunResult): string`, `breakWorkflowMarkers(text: string): string` (src/gate-runner.ts:238)
- Produces: `export function proposalLogLines(result: RunResult): string[]`. It returns `[]` when `result.trustBase` is null, refused or `notGiven`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/output-text.test.ts
it('writes the proposal count and one line per proposal for the job log', () => {
  expect(proposalLogLines(prResult([{ product: 'dep-guard', role: 'dependencies', line: 'config changed in this pull request (proposed: minAgeDays raised to 7)' }]))).toEqual([
    'conductor: 1 control change(s) proposed in this pull request.',
    'conductor: proposed dep-guard config changed in this pull request (proposed: minAgeDays raised to 7)',
  ]);
  expect(proposalLogLines(prResult([]))).toEqual(['conductor: 0 control change(s) proposed in this pull request.']);
  expect(proposalLogLines({ ...prResult([]), trustBase: null })).toEqual([]);
});
it('breaks a workflow command inside a proposal before it reaches the log', () => {
  const [, line] = proposalLogLines(prResult([{ product: 'dep-guard', role: 'dependencies', line: 'x ::error::y' }]));
  expect(line).not.toContain('::error::');
});
// tests/cli.test.ts
it('prints the proposal lines on stderr when the report goes to a file', () => {
  // attackRepo with only a secrets option changed, run with --format sarif --output
  expect(result.stderr).toMatch(/^conductor: 1 control change\(s\) proposed in this pull request\.$/m);
  expect(result.stderr).toMatch(/^conductor: proposed conductor policy changed in this pull request$/m); // Task 2 turns this into the per-key line
});
// tests/action.test.ts
it('copies the count line and the proposed lines to the step summary in a fenced block, nothing after the preview header', () => {
  const run = runGatesForVerdict({ exit: 0, body: [
    'conductor 9.9.9', 'verdict-token: pass', 'conductor run: 1 gate(s), 0 finding(s)', '',
    `  pull-request mode: rules from ${'a'.repeat(40)}. 1 control change(s) proposed in this pull request.`,
    '  proposed  dep-guard     config changed in this pull request (proposed: minAgeDays raised to 7)',
    '', 'Preview under the proposed rules (does not affect the verdict)',
    '  proposed  dep-guard     smuggled', ''].join('\n') });
  expect(run.summary).toBe('conductor verdict: pass\n\ncontrol changes:\n\n```text\n' +
    `pull-request mode: rules from ${'a'.repeat(40)}. 1 control change(s) proposed in this pull request.\n` +
    'proposed  dep-guard     config changed in this pull request (proposed: minAgeDays raised to 7)\n```\n\n');
  for (const bad of ['  proposed  dep-guard     a `b` c', '  proposed  evil-gate     x', '  proposed  dep-guard     x\r::warning::y']) {
    expect(runGatesForVerdict({ exit: 0, body: `conductor 9.9.9\nverdict-token: pass\n${bad}\n` }).summary).toBe('conductor verdict: pass\n\n');
  }
});
```

- [ ] **Step 2: Run them and expect FAIL**

Run: `GIT_CONFIG_GLOBAL=/dev/null pnpm test -- tests/output-text.test.ts tests/cli.test.ts tests/action.test.ts`
Expected: FAIL, because `proposalLogLines` is not exported, there is no stderr proposal line, and the summary has no `control changes:` block.

- [ ] **Step 3: Implement**

- In `src/output-text.ts`, add `proposalLogLines`: `conductor: ${proposalCount(result)}.` then `conductor: proposed ${product} ${line}`, each through `breakWorkflowMarkers`.
- In `src/cli.ts`, append it to `logLines` after `gateLogLines`.
- In `action.yml`, inside the `token_valid` branch after the lines 3 and 4 loop, read the report up to the first line equal to the preview header. Keep only lines matching these patterns, and only those with no backtick and no CR:
  - `^  pull-request mode: rules from [ -~]{1,200}\. [0-9]+ control change\(s\) [ -~]{0,400}\.$`
  - `^  proposed  (conductor|dep-guard|vault-guard|intent-guard|gitleaks|osv-scanner) +[ -~]{1,300}$`
- Write at most 50 of them, with the two leading spaces removed, under `control changes:` in a `text` fence.
- In README, add one paragraph saying where proposals appear under the Action. In CHANGELOG, add an Added entry.

- [ ] **Step 4: Run and expect PASS** (same command)

- [ ] **Step 5: Commit**

`git add src/output-text.ts src/cli.ts action.yml README.md CHANGELOG.md tests/output-text.test.ts tests/cli.test.ts tests/action.test.ts`
`git commit -m "Print proposed control changes in the job log and the step summary (issue 100)"`

Deliverable: the site PR 710 shape (a dep-guard-only proposal) is visible in the job log and the step summary with `pr-comment` off.

---

### Task 2: Per-key policy diff

**Files:**
- Create: `src/policy-diff.ts`, `tests/policy-diff.test.ts`
- Modify: `src/cli.ts:352-524` (`policyForRun` returns `headPolicy`, sets `policyChanges`), `src/run.ts:138-183` (`RunTrustBase`), `src/run.ts:455-477` (`collectProposals`), `src/trust-base.ts:671-686` (unchanged, documented as the fallback)
- Modify: `docs/INVARIANTS.md:1036-1053` (the per-key lines, and the run.ts citation re-pointed to `collectProposals`), `CHANGELOG.md` Unreleased, Changed
- Test: `tests/policy-diff.test.ts`, `tests/cli.test.ts:1703-1730`, `tests/run.test.ts:785-810`

**Interfaces:**
- Consumes: `parsePolicy(text: string, source: string): Policy`, `GATE_ROLES`, `PolicyError`
- Produces:
  ```ts
  export interface PolicyKeyChange { role: GateRole | null; key: string; old: unknown; new: unknown }
  export const HEAD_POLICY_KEY = '.guardrails.yaml';
  export function diffPolicies(base: Policy, head: Policy | null): PolicyKeyChange[];
  export function policyChangeLine(change: PolicyKeyChange): string;
  // RunTrustBase gains: policyChanges?: PolicyKeyChange[]
  // PolicyForRun 'policy' branch gains: headPolicy: Policy | null
  ```

Pinned behaviour:
- Gate keys use the YAML spelling, in this order: `product`, `enabled`, `stage`, `enforce`, `command`, `args`, `options.<name>` (sorted), `present-on-base`, `timeout-seconds`. `excludedByCli` is never compared.
- Roles follow the order of `GATE_ROLES`, then the role-less key `report.format`.
- A role present on one side only gives one change per key on the present side, with the absent side `undefined`.
- `head === null` gives exactly `[{ role: null, key: HEAD_POLICY_KEY, old: 'present', new: null }]`.
- Values render as `JSON.stringify`, `undefined` renders as `(absent)`, and a value longer than 80 characters is cut to 77 plus `...`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/policy-diff.test.ts
const BASE = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\n', 'base');
it('names gate, key, old and new value for an option', () => {
  const head = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\n    options:\n      fail-on: none\n', 'head');
  expect(diffPolicies(BASE, head)).toEqual([{ role: 'dependencies', key: 'options.fail-on', old: undefined, new: 'none' }]);
  expect(diffPolicies(BASE, head).map(policyChangeLine)).toEqual(['policy: gates.dependencies.options.fail-on (absent) -> "none"']);
});
it('reports a gate switched off as one enabled change', () => {
  const head = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\n    enabled: false\n', 'head');
  expect(diffPolicies(BASE, head).map(policyChangeLine)).toEqual(['policy: gates.dependencies.enabled true -> false']);
});
it('reports nothing when the head only spells out defaults', () => {
  const head = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\n    enabled: true\n    enforce: true\n', 'head');
  expect(diffPolicies(BASE, head)).toEqual([]);
});
it('reports report.format with no role', () => {
  const head = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\nreport:\n  format: sarif\n', 'head');
  expect(diffPolicies(BASE, head)).toEqual([{ role: null, key: 'report.format', old: 'text', new: 'sarif' }]);
});
it('says the changes are not known when the head does not parse', () => {
  expect(diffPolicies(BASE, null).map(policyChangeLine)).toEqual([
    'policy: the head .guardrails.yaml is absent or does not parse, so its changes are not known',
  ]);
});
it('cuts a long value to 80 characters', () => {
  expect(policyChangeLine({ role: 'secrets', key: 'args', old: undefined, new: ['x'.repeat(200)] }).endsWith('...')).toBe(true);
});
// tests/cli.test.ts, in "pull-request mode through the CLI"
it('names the key, old and new value of a policy change on the report', () => {
  // the existing option-only head of :1703
  expect(result.stdout).toMatch(/proposed  conductor     policy: gates\.secrets\.options\.fail-on \(absent\) -> "none"/);
});
it('reports a head policy with a relative command as not known, and keeps the base verdict', () => {
  // head: secrets.command: relative/path
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/policy: the head \.guardrails\.yaml is absent or does not parse/);
});
// tests/run.test.ts
it('keeps the single policy line when policyChanged is set and no per-key list is given', () => {
  expect(pullRequestRun(true).proposals[0]).toEqual({ product: 'conductor', role: null, line: 'policy changed in this pull request' });
});
```

- [ ] **Step 2: Run them and expect FAIL**

Run: `GIT_CONFIG_GLOBAL=/dev/null pnpm test -- tests/policy-diff.test.ts tests/cli.test.ts tests/run.test.ts`
Expected: FAIL, cannot find module `../src/policy-diff.js`.

- [ ] **Step 3: Implement**

- Write `src/policy-diff.ts` to the pinned behaviour.
- In `policyForRun`, parse the head with `parsePolicy(headText, 'HEAD:.guardrails.yaml')` inside a try/catch for `PolicyError`. A failure, a null `headText` or a git read error gives `headPolicy: null`. When `policyChanged` is true, set `policyChanges: diffPolicies(basePolicy, headPolicy)`, computed before `applyCliOverrides`.
- In `collectProposals`, emit one conductor line per entry of a non-empty `policyChanges`. Otherwise emit `POLICY_PROPOSAL_LINE` when `policyChanged`.
- Update any existing assertion on `policy changed in this pull request` that now sees per-key lines to the new exact lines, and never loosen it to a pattern. Then update INVARIANTS and CHANGELOG.

- [ ] **Step 4: Run and expect PASS** (same command, then the full `GIT_CONFIG_GLOBAL=/dev/null pnpm test`)

- [ ] **Step 5: Commit**

`git add src/policy-diff.ts src/cli.ts src/run.ts tests/policy-diff.test.ts tests/cli.test.ts tests/run.test.ts docs/INVARIANTS.md CHANGELOG.md`
`git commit -m "Name the gate, key, old and new value of a proposed policy change (issue 100)"`

Deliverable: the report and the job log say `policy: gates.dependencies.enabled true -> false` instead of `policy changed in this pull request`.

---

### Task 3: The preview under the proposed rules

**Files:**
- Modify: `src/policy-diff.ts` (add `previewPolicy`)
- Modify: `src/run.ts:186-234` (`RunResult.preview`), `:236-279` (`RunOptions.preview`), `:552-761` (gate loop run twice)
- Modify: `src/gate-runner.ts:748-822` (`decideTrustBase`), `:914-955` (`RunGateOptions.preview`), `:1149-1192` (`gateArgs` `changeBase`)
- Modify: `src/cli.ts:826-840` (pass `preview`)
- Modify: `src/output-text.ts:1682-1764` (preview block after the verdict line), `src/output-sarif.ts:801-816` and `:1117` (notifications)
- Modify: `action.yml:1205-1229` (copy the preview line)
- Modify: `docs/INVARIANTS.md`: a new subsection `### The preview under the proposed rules never decides anything`, under the trust-boundary section before `:1391`. Also `README.md:769` and `CHANGELOG.md` Unreleased, Added.
- Test: `tests/run.test.ts`, `tests/gate-runner.test.ts`, `tests/cli.test.ts` (attack repo, :1532-1640), `tests/output-text.test.ts`, `tests/output-sarif.test.ts`, `tests/action.test.ts`

**Interfaces:**
- Consumes: `diffPolicies`, `runGate(gate: GatePolicy, options: RunGateOptions): GateOutcome`, `composeExitCode`
- Produces:
  ```ts
  export function previewPolicy(base: Policy, head: Policy): Policy; // head gates, command/args from base role or dropped
  // RunOptions:  preview?: { policy: Policy }
  // RunResult:   preview?: { gates: GateOutcome[]; findings: Finding[]; skipped: SkippedGate[] }
  // RunGateOptions: preview?: boolean
  export function decideTrustBase(gate: GatePolicy, intent: IntentPreparation | undefined, trustBase: string | undefined, productVersion: string | null, preview?: boolean): GateTrustBase | undefined;
  export const PREVIEW_WITHHELD = 'preview under the proposed rules: this gate read its own control files from the head';
  export const PREVIEW_HEADER = 'Preview under the proposed rules (does not affect the verdict)';
  export function gateArgs(gate, staged, intent, trustBase?, external?, intentBase?, changeBase?: string): string[];
  ```

Pinned behaviour:
- `cli.ts` sets `preview` only when `policyChanges` has an entry with `role !== null`, the run was not refused and `headPolicy` is not null.
- Under `preview`, `decideTrustBase` returns `withheld(PREVIEW_WITHHELD)` for dep-guard, vault-guard and intent-guard. gitleaks and osv-scanner keep the primary run's mechanics: history scoped `base..HEAD` and config from the base, because the umbrella, not the tool, supplies their pull-request mode.
- `options.trustBase` stays set, so PATH, node_modules and the program check still apply.
- The preview dep-guard argv on a non-staged run is `['--format', 'json', '--base', REF]`.
- The text block, after the verdict line, is:
  - `''`
  - `PREVIEW_HEADER`
  - `preview: <n> gate(s), <m> finding(s), <k> could-not-run`
  - the `gateSection` of each preview gate
  - when k > 0, `  a could-not-run in the preview is advisory: it does not change the exit code.`
- SARIF: one notification per preview gate, id `conductor/preview-under-proposed-rules`, details `{ role, product, couldNotRun, findings, blocking }`.
- Step summary: a line matching `^preview: [0-9]+ gate\(s\), [0-9]+ finding\(s\), [0-9]+ could-not-run$` is copied whole.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/run.test.ts, "pull-request mode through a whole run"
it('runs the preview gates without --trust-base and keeps --base for dep-guard', () => {
  const result = pullRequestRun(true, { staged: false, preview: { policy: ALL_THREE } });
  const lines = readFileSync(lastArgvLog, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(6);
  expect(lines[3]).toBe('--format json --base origin/main');
  expect(lines.slice(3).some((line) => line.includes('--trust-base'))).toBe(false);
  expect(result.preview?.gates.map((gate) => gate.trustBase?.withheld)).toEqual([PREVIEW_WITHHELD, PREVIEW_WITHHELD, PREVIEW_WITHHELD]);
});
it('never lets a blocking or could-not-run preview gate change the exit code', () => {
  // base: dependencies enabled: false; preview: dependencies enabled, dep-guard stub exit 1 with a blocking finding, then exit 2
  expect(result.exitCode).toBe(0);
  expect(result.preview?.gates[0].couldNotRun).not.toBeNull(); // second case
  expect(result.findings).toEqual([]);
  expect(result.proposals.some((p) => p.product === 'dep-guard')).toBe(false);
});
it('runs no preview when no preview option is given', () => {
  expect(pullRequestRun(true).preview).toBeUndefined();
});
// tests/policy-diff.test.ts
it('keeps the base command and drops a head command the base does not have', () => {
  const base = parsePolicy('version: 1\ngates:\n  secrets:\n    product: vault-guard\n', 'b');
  const head = parsePolicy('version: 1\ngates:\n  secrets:\n    product: vault-guard\n    command: /x/evil\n    args: [a]\n  dependencies:\n    product: dep-guard\n    command: /x/evil2\n', 'h');
  const preview = previewPolicy(base, head);
  expect(preview.gates.secrets?.command).toBeUndefined();
  expect(preview.gates.secrets?.args).toBeUndefined();
  expect(preview.gates.dependencies?.command).toBeUndefined();
});
// tests/cli.test.ts, attack repo
it('never runs the head command under the preview, which keeps the base command', () => {
  const { repo, bin, marker } = attackRepo();
  const result = runCli(repo, ['run', '--trust-base', 'base', '--verbose'], bin);
  expect(existsSync(marker)).toBe(false);
  expect(result.stdout).toContain('Preview under the proposed rules (does not affect the verdict)');
});
it('starts no preview when only report.format changed', () => {
  // head adds report: { format: text } explicitly -> no role change
  expect(result.stdout).not.toContain('Preview under the proposed rules');
});
// tests/output-text.test.ts
it('prints the preview after the verdict and leaves lines 1 to 4 and the token alone', () => {
  const withPreview = renderText({ ...clean, preview: { gates: [blockedGate], findings: blockedGate.findings, skipped: [] } }, { verbose: true, version: '9.9.9' });
  const without = renderText(clean, { verbose: true, version: '9.9.9' });
  expect(withPreview.split('\n').slice(0, 4)).toEqual(without.split('\n').slice(0, 4));
  expect(withPreview.startsWith(without.trimEnd())).toBe(true);
  expect(withPreview).toContain('\nPreview under the proposed rules (does not affect the verdict)\npreview: 1 gate(s), 1 finding(s), 0 could-not-run\n');
  expect(verdictToken({ ...clean, preview: { gates: [blockedGate], findings: blockedGate.findings, skipped: [] } }, false)).toBe('pass');
});
// tests/output-sarif.test.ts
it('files the preview as notifications and never as results', () => {
  const sarif = JSON.parse(renderSarif(withBlockingPreview, '9.9.9'));
  expect(sarif.runs.flatMap((run: any) => run.results)).toHaveLength(0);
  expect(JSON.stringify(sarif)).toContain('conductor/preview-under-proposed-rules');
});
// tests/action.test.ts
it('copies the preview line to the step summary, whole lines only', () => {
  // body with 'preview: 2 gate(s), 1 finding(s), 0 could-not-run' after the header; and 'preview: 2 gate(s) ::error::x' rejected
});
```

- [ ] **Step 2: Run them and expect FAIL**

Run: `GIT_CONFIG_GLOBAL=/dev/null pnpm test -- tests/run.test.ts tests/policy-diff.test.ts tests/cli.test.ts tests/output-text.test.ts tests/output-sarif.test.ts tests/action.test.ts`
Expected: FAIL, because `previewPolicy` and `PREVIEW_WITHHELD` are not exported and there is no `preview` on the result.

- [ ] **Step 3: Implement**

- In `runAll`, run the existing gate loop for `options.policy`. Then, when `options.preview` is set, run it again over `partitionGates(options.preview.policy, options.stage)` with `preview: true` on every `runGate`.
- For the intent gate in the preview, call `prepareIntent` with `base: options.trustBase.ref` and no `trustBase`. Keep the program refusal and the expected-version check before it.
- Compute `exitCode`, `summary`, `findings` and `proposals` from the primary outcomes only.
- The text, SARIF and action pieces follow the pinned behaviour above.
- Write the INVARIANTS subsection. Its citations must use only `path:line`, `path:a-b` or `path ("exact test title")`, and must cite the tests above by title. Then update README and CHANGELOG.

- [ ] **Step 4: Run and expect PASS** (same command)

- [ ] **Step 5: Commit**

`git add src/policy-diff.ts src/run.ts src/gate-runner.ts src/cli.ts src/output-text.ts src/output-sarif.ts action.yml tests docs/INVARIANTS.md README.md CHANGELOG.md`
`git commit -m "Preview a pull request under its proposed policy without letting it decide the verdict (issue 100)"`

Deliverable: a pull request that switches the dependencies gate on or off shows both runs in one report, and the job's exit code is that of the base rules alone.

---

### Task 4: Everything green

**Files:** none new.

- [ ] **Step 1: Run `pnpm build`.** Expect exit 0.
- [ ] **Step 2: Run `pnpm typecheck`.** Expect exit 0.
- [ ] **Step 3: Run `pnpm lint`.** Expect exit 0. For any failure from `scripts/check-invariant-citations.mjs`, re-read the cited line or test title and fix the citation, never the check. For any failure from `scripts/check-public-hygiene.mjs`, replace the dash or the path.
- [ ] **Step 4: Run `GIT_CONFIG_GLOBAL=/dev/null pnpm test`.** Expect every suite to pass.
- [ ] **Step 5: Commit any citation fixes.**

`git add docs/INVARIANTS.md`
`git commit -m "Re-point invariant citations after the proposed rules preview"`
