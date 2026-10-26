# Proposed Rules Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** this plan addresses the visibility and naming parts of issue 100; the preview is tracked separately.
- Every proposed control change shows in the job log and the step summary.
- Each policy change names its key, old value and new value.
- Later, behind a security review, the gates run once under the proposed enabled and stage settings as a preview that decides nothing.

It does NOT fix issue 100's first complaint. Under the ruling at INVARIANTS.md:4593, a could-not-run in the primary run still turns the job red in advisory mode.

**Delivery:** Task 1 and Task 2 ship as separate pull requests. Task 3 ships later and is GATED: it is not built until a security review of the head-to-argv path signs off. Task 4 closes each pull request.

**Architecture:**
- Task 1 only renders what `RunResult.proposals` already carries.
- Task 2 adds a pure `src/policy-diff.ts`, and `policyForRun` parses the head policy for comparison only.
- Task 3 runs a second, narrowed gate pass inside the same `runAll` call. It takes only `enabled`, `stage` and `enforce` from the head, and returns `RunResult.preview`, which no exit-code, token or verdict function reads.

**Tech Stack:** TypeScript (ESM), Node 20 or later, Jest with experimental VM modules (`@jest/globals`), `spawnSync`, the bash `run:` blocks of `action.yml`, scripts/pr-comment.mjs.

**Spec:** `docs/superpowers/specs/2026-10-25-proposed-rules-preview-design.md`

## Global Constraints

- The preview never reaches `composeExitCode`, `verdictToken`, `verdict`, `isFullyClean`, `proposalCount` or lines 1 to 4 of the text report.
- The preview emits no SARIF result. It emits only `conductor/preview-under-proposed-rules` notifications, at level note.
- No head value other than `enabled`, `stage` or `enforce` reaches a gate's argv, its environment or its time limit (spec section 5).
- The umbrella writes no gate's config and rewrites no gate's proposal sentence.
- A primary could-not-run keeps exit 2 under `--advisory` (INVARIANTS.md:4593). A preview could-not-run changes nothing.
- One invocation per job, and the comment step invokes conductor zero times (INVARIANTS.md:5308).
- Plain ASCII, no em or en dashes, and no machine paths in tracked files. Lint runs after `source ~/.nvm/nvm.sh` (the repository has no .nvmrc, so a bare `nvm use` fails; the default node works).
- Tests run as `GIT_CONFIG_GLOBAL=/dev/null pnpm test -- <file>`. Commit messages are plain ASCII with no backticks and no arrows.

## Review Focus

1. A proposal sentence carries head-controlled text, such as a package name, that could contain `::error::`, a backtick or a markdown link. Task 1 sends log lines through `breakWorkflowMarkers` and replaces an unsafe summary line with a placeholder. Both are tested.
2. A head `.guardrails.yaml` that is valid YAML but fails `parsePolicy`, for example a relative `command:`. The head was never parsed before, so the new parse must not turn a bad head into exit 2. Task 2 tests it.
3. The head changes only `report.format`, or only spells out defaults. Task 2 tests that the first gives one role-less line and the second gives the fallback line. Task 3 tests that neither starts a preview.
4. A head option that would reach argv in the preview. Examples: osv `call-analysis`, a string where a boolean belongs (`--log-opts`), osv `output`, a value starting with "-", and `timeout-seconds: 21600`. Task 3 tests that each one is absent from the preview's argv, its spawn timeout and its environment.
5. The head enables a gate whose binary is absent. Task 3 tests that `exitCode`, the token and the `proposalCount` sentence come from the primary run alone, with and without `--advisory`.

---

### Task 1: Proposals in the job log and the step summary (pull request 1)

**Files:**
- Modify: `src/output-text.ts`, adding `proposalLogLines` beside `gateLogLines` (`:817`). `proposalCount` (`:619-634`) is unchanged.
- Modify: `src/cli.ts:905-916` (log lines)
- Modify: `action.yml:1205-1229` (summary copy)
- Modify: `docs/INVARIANTS.md`, re-pointing every `src/cli.ts:N` citation that the new lines shift. `README.md:769`. `CHANGELOG.md` Unreleased, Added.
- Test: `tests/output-text.test.ts`, `tests/cli.test.ts` (in "pull-request mode through the CLI", :1535), `tests/action.test.ts` (beside :2253)

**Interfaces:**
- Consumes: `proposalCount(result: RunResult): string` and `breakWorkflowMarkers(text: string): string` (src/gate-runner.ts:238).
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
  // attackRepo with only a secrets option changed, --format sarif --output
  expect(result.stderr).toMatch(/^conductor: 1 control change\(s\) proposed in this pull request\.$/m);
});
// tests/action.test.ts
const COUNT = `  pull-request mode: rules from ${'a'.repeat(40)}. 1 control change(s) proposed in this pull request.`;
it('copies the count line and the proposed lines to the step summary in a fenced block', () => {
  const run = runGatesForVerdict({ exit: 0, body: ['conductor 9.9.9', 'verdict-token: pass', 'x', '', COUNT,
    '  proposed  dep-guard     config changed in this pull request (proposed: minAgeDays raised to 7)', ''].join('\n') });
  expect(run.summary).toBe('conductor verdict: pass\n\ncontrol changes:\n\n```text\n' + COUNT.trimStart() + '\n' +
    'proposed  dep-guard     config changed in this pull request (proposed: minAgeDays raised to 7)\n```\n\n');
});
it('replaces an unsafe proposed line with a placeholder and never copies it', () => {
  for (const bad of ['  proposed  dep-guard     a `b` c', '  proposed  dep-guard     x\r::warning::y']) {
    const run = runGatesForVerdict({ exit: 0, body: `conductor 9.9.9\nverdict-token: pass\nx\n${COUNT}\n${bad}\n` });
    expect(run.summary).toContain('proposed  dep-guard  (line omitted: unsafe characters)\n');
    expect(run.summary).not.toContain('::warning::');
    expect(run.summary).not.toContain('`b`');
  }
  expect(runGatesForVerdict({ exit: 0, body: `conductor 9.9.9\nverdict-token: pass\n  proposed  evil-gate     x\n` }).summary)
    .toBe('conductor verdict: pass\n\n');
});
it('copies at most 50 proposed lines and says how many more are in the report', () => {
  const many = Array.from({ length: 53 }, (_, i) => `  proposed  dep-guard     change ${i}`);
  const run = runGatesForVerdict({ exit: 0, body: ['conductor 9.9.9', 'verdict-token: pass', 'x', COUNT, ...many, ''].join('\n') });
  expect(run.summary.match(/^proposed {2}/gm)).toHaveLength(50);
  expect(run.summary).toContain('(3 more in the report)\n');
});
```

- [ ] **Step 2: Run them and expect FAIL**

Run: `GIT_CONFIG_GLOBAL=/dev/null pnpm test -- tests/output-text.test.ts tests/cli.test.ts tests/action.test.ts`
Expected: FAIL, because `proposalLogLines` is not exported and there is no `control changes:` block.

- [ ] **Step 3: Implement**

- `proposalLogLines` returns `conductor: ${proposalCount(result)}.` and then `conductor: proposed ${product} ${line}`, each through `breakWorkflowMarkers`. `cli.ts` appends them to `logLines` after `gateLogLines`.
- In `action.yml`, inside the `token_valid` branch after the lines 3 and 4 loop, scan the report for the count line, matching `^  pull-request mode: rules from [ -~]{1,200}\. [0-9]+ control change\(s\) [ -~]{0,400}\.$`.
- In the same scan, match proposed lines with `^  proposed  (conductor|dep-guard|vault-guard|intent-guard|gitleaks|osv-scanner) +` followed by the rest of the line.
- A rest that holds a backtick, a CR, or anything outside `[ -~]` becomes `proposed  <product>  (line omitted: unsafe characters)`.
- Write at most 50 proposed lines, with the leading two spaces removed, under `control changes:` in a `text` fence. Then write `(n more in the report)` when n > 0.

- [ ] **Step 4: Re-point the citations**

Run `grep -n 'src/cli.ts:' docs/INVARIANTS.md`. For every citation at or after the inserted lines, read the cited line and correct the number. Then update README and CHANGELOG.

- [ ] **Step 5: Run and expect PASS** (same command)

- [ ] **Step 6: Commit**

`git add src/output-text.ts src/cli.ts action.yml README.md CHANGELOG.md docs/INVARIANTS.md tests/output-text.test.ts tests/cli.test.ts tests/action.test.ts`
`git commit -m "Print proposed control changes in the job log and the step summary (issue 100)"`

Deliverable: a dep-guard-only proposal (the site PR 710 shape) is visible in the job log and the step summary with `pr-comment` off.

---

### Task 2: Per-key policy diff (pull request 2)

**Files:**
- Create: `src/policy-diff.ts`, `tests/policy-diff.test.ts`
- Modify: `src/cli.ts:352-524` (`policyForRun` returns `headPolicy` and sets `policyChanges`), `src/run.ts:138-183` (`RunTrustBase`), `src/run.ts:455-477` (`collectProposals`)
- Modify, in `docs/INVARIANTS.md`:
  - `:906-911`: the head is now also parsed, for the comparison only and never into a run.
  - `:1036-1053`: the per-key lines, and the run.ts citation re-pointed to `collectProposals`.
- Modify: `CHANGELOG.md` Unreleased, Changed. It must state that the count is now per key: five changed keys count as five control changes, where they counted as one.
- Test: `tests/policy-diff.test.ts`, `tests/cli.test.ts:1646,1703-1730,3597`, `tests/run.test.ts:770,789`, `tests/gate-runner-timeout.test.ts:303,310`, `tests/dogfood.e2e.test.ts:573,1179` (and `:879`, a negative to recheck), `tests/osv-base-comparison.test.ts:557`

**Interfaces:**
- Consumes: `parsePolicy(text: string, source: string): Policy`, `GATE_ROLES`, `PolicyError`.
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
- Keys use the YAML spelling, in the order `product`, `enabled`, `stage`, `enforce`, `command`, `args`, `options.<name>` (sorted), `present-on-base`, `timeout-seconds`. `excludedByCli` is never compared.
- Roles follow `GATE_ROLES`, and `report.format` comes last.
- A role on one side only gives one change per present key, with the other side `undefined`.
- `head === null` gives `[{ role: null, key: HEAD_POLICY_KEY, old: 'present', new: null }]`.
- Values render as `JSON.stringify`, `undefined` renders as `(absent)`, and anything over 80 characters is cut to 77 plus `...`.
- The diff is computed before `applyCliOverrides`.
- An empty diff with `policyChanged` true keeps `POLICY_PROPOSAL_LINE`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/policy-diff.test.ts
const BASE = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\n', 'base');
it('names gate, key, old and new value for an option', () => {
  const head = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\n    options:\n      fail-on: none\n', 'head');
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
// tests/cli.test.ts
it('names the key, old and new value of a policy change on the report', () => {
  expect(result.stdout).toMatch(/proposed  conductor     policy: gates\.secrets\.options\.fail-on \(absent\) -> "none"/);
});
it('reports a head policy with a relative command as not known, and keeps the base verdict', () => {
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/policy: the head \.guardrails\.yaml is absent or does not parse/);
});
// tests/gate-runner-timeout.test.ts:303 and :310, replacing the old pattern
expect(stdout).toMatch(/policy: gates\.secrets-history\.timeout-seconds 10 -> 21600/);
expect(stdout).toMatch(/policy: gates\.secrets-history\.timeout-seconds \(absent\) -> 21600/);
```

At the other listed lines, replace each `/policy changed in this pull request/` assertion with the exact per-key line the fixture now produces, worked out by reading that fixture's head policy. Never widen one to a looser pattern. `tests/run.test.ts:770` and `:789` keep the fallback line, because their `RunTrustBase` has no `policyChanges`.

- [ ] **Step 2: Run them and expect FAIL**

Run: `GIT_CONFIG_GLOBAL=/dev/null pnpm test -- tests/policy-diff.test.ts tests/cli.test.ts tests/gate-runner-timeout.test.ts tests/osv-base-comparison.test.ts`
Expected: FAIL, cannot find module `../src/policy-diff.js`.

- [ ] **Step 3: Implement**

- Write `src/policy-diff.ts` to the pinned behaviour.
- In `policyForRun`, call `parsePolicy(headText, 'HEAD:.guardrails.yaml')` inside a try/catch for `PolicyError`. A failure, a null `headText` or a git read error gives `headPolicy: null`.
- When `policyChanged` is true, set `policyChanges`.
- `collectProposals` emits one conductor line per entry, or `POLICY_PROPOSAL_LINE` when the list is empty or absent and `policyChanged` is true.

- [ ] **Step 4: Run and expect PASS.** Run the same command, then the full `GIT_CONFIG_GLOBAL=/dev/null pnpm test`, the dogfood e2e included.

- [ ] **Step 5: Commit**

`git add src/policy-diff.ts src/cli.ts src/run.ts tests/policy-diff.test.ts tests/cli.test.ts tests/run.test.ts tests/gate-runner-timeout.test.ts tests/dogfood.e2e.test.ts tests/osv-base-comparison.test.ts docs/INVARIANTS.md CHANGELOG.md`
`git commit -m "Name the gate, key, old and new value of a proposed policy change (issue 100)"`

Deliverable: the report says `policy: gates.dependencies.enabled true -> false` where it used to say `policy changed in this pull request`.

---

### Task 3: The preview under the proposed rules (later pull request, GATED: not built until a security review of the head-to-argv path signs off)

**Files:**
- Modify: `src/policy-diff.ts`, adding `previewPolicy` and `previewRoles`.
- Modify: `src/run.ts:186-234` (`RunResult.preview`), `:236-279` (`RunOptions.preview`), `:552-761` (the second pass)
- Modify: `src/gate-runner.ts:748-822` (`decideTrustBase`), `:914-955` (`RunGateOptions.preview`), `:1149-1192` (`gateArgs` `changeBase`)
- Modify: `src/cli.ts:826-916` (pass `preview`, and the per-gate preview log lines)
- Modify: `src/output-text.ts:1682-1764`, `src/output-sarif.ts:801-816`, `:1117`
- Modify: `action.yml:1205-1229` (the preview line, and the step summary copy stopping at `PREVIEW_HEADER`), `scripts/pr-comment.mjs` (the 60000 character cut)
- Rewrite, not append to: `docs/INVARIANTS.md:906-911` and `:1377-1384`. Both now say that on a pull-request run a GatePolicy is built from the head ONLY in the preview, taking only `enabled`, `stage` and `enforce` from it, and never into the run that decides the exit code.
- Rewrite: the `timeout-seconds` description in `schema/guardrails.schema.json:62`, adding "the preview under the proposed rules also uses the base value".
- Add: the subsection `### The preview under the proposed rules never decides anything`, before INVARIANTS.md:1391.
- Modify: `README.md:769`, `CHANGELOG.md`
- Test:
  - `tests/policy-diff.test.ts`, `tests/run.test.ts`, `tests/gate-runner.test.ts`
  - `tests/cli.test.ts` (the attack repo, :1532-1640)
  - `tests/gate-runner-timeout.test.ts:296-311`, updated so the preview is pinned at the base limit as well
  - `tests/output-text.test.ts`, `tests/output-sarif.test.ts`, `tests/action.test.ts`, `tests/action-pr-comment.test.ts`
  - Spawn-count review: `tests/dogfood.e2e.test.ts:926-1208`, and every argv-log length assertion in a pull-request-mode test whose head changes a gate key. Run `grep -n 'toHaveLength' tests/run.test.ts tests/cli.test.ts tests/dogfood.e2e.test.ts`. Update each to the exact count the narrowed preview spawns, and never to a range.

**Interfaces:**
- Consumes: `diffPolicies`, `runGate(gate: GatePolicy, options: RunGateOptions): GateOutcome`, `profileFor`.
- Produces:
  ```ts
  export function previewRoles(changes: PolicyKeyChange[]): GateRole[]; // roles with an enabled or stage change
  export function previewPolicy(base: Policy, head: Policy, roles: GateRole[]): Policy;
  export const PREVIEW_BUDGET_MS = 300_000;
  export const PREVIEW_WITHHELD = 'preview under the proposed rules: this gate read its own control files from the head';
  export const PREVIEW_HEADER = 'Preview under the proposed rules (does not affect the verdict)';
  export const COMMENT_LIMIT = 60_000;
  // RunOptions:  preview?: { policy: Policy }
  // RunResult:   preview?: { gates: GateOutcome[]; findings: Finding[]; skipped: SkippedGate[]; deferred: GateRole[]; overBudget: GateRole[] }
  // RunGateOptions: preview?: boolean
  export function decideTrustBase(gate: GatePolicy, intent: IntentPreparation | undefined, trustBase: string | undefined, productVersion: string | null, preview?: boolean): GateTrustBase | undefined;
  export function gateArgs(gate, staged, intent, trustBase?, external?, intentBase?, changeBase?: string): string[];
  ```

Pinned behaviour:
- `previewPolicy` takes only `enabled`, `stage` and `enforce` from the head. `command`, `args`, `options`, `timeout-seconds` and `present-on-base` come from the base role. A head-only role gets `options: {}`, no command, no args and no timeout, which means the profile default.
- gitleaks and osv-scanner never get a head option.
- An option value in the preview that is a string starting with "-" refuses that preview gate, as could-not-run `preparation-failed`, without spawning it.
- `previewRoles` drops a role whose only change is `enforce`, or a key the preview takes from the base.
- `cli.ts` sets `preview` only when the run was not refused, `--staged` is absent, `headPolicy` is not null and `previewRoles` is non-empty. The same `--gate` overrides are applied to it.
- `decideTrustBase` returns `withheld(PREVIEW_WITHHELD)` for dep-guard, vault-guard and intent-guard only after the version-floor refusal and the unreadable-version refusal. A refused gate stays refused in the preview.
- gitleaks and osv-scanner keep `base..HEAD` and their config from the base.
- The intent gate is never run in the preview. It is listed in `deferred`, with the text line `preview: intent (intent-guard) deferred, the preview does not prepare the intent gate`.
- Before each preview gate, a spent budget moves it, and every gate after it, to `overBudget`, printed as `preview skipped: over budget (<role> (<product>), ...)`. Each gate's limit is the smaller of its own limit and what is left of the budget.
- The preview dep-guard argv is exactly `['--format', 'json', '--base', REF]`.
- Job log: one `conductor: preview <role> (<product>) <outcome>` per preview gate, in the `gateLogLines` outcome words.
- The text block comes after the verdict line:
  - `''`
  - `PREVIEW_HEADER`
  - `preview: <n> gate(s), <m> finding(s), <k> could-not-run`
  - one `gateSection` per preview gate
  - the deferred and over-budget lines
  - when k > 0, `  a could-not-run in the preview is advisory: it does not change the exit code.`
- The action's summary copy stops at `PREVIEW_HEADER`, and the `preview:` line is copied whole.
- `scripts/pr-comment.mjs` cuts a body over `COMMENT_LIMIT` to `COMMENT_LIMIT` characters and appends `\n\n(report truncated at 60000 characters)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/policy-diff.test.ts
it('takes only enabled, stage and enforce from the head', () => {
  const base = parsePolicy('version: 1\ngates:\n  vulnerabilities:\n    product: osv-scanner\n    enabled: false\n', 'b');
  const head = parsePolicy('version: 1\ngates:\n  vulnerabilities:\n    product: osv-scanner\n    stage: ci\n    timeout-seconds: 21600\n    options:\n      call-analysis: all\n      output: /x/y\n  secrets:\n    product: vault-guard\n    command: /x/evil\n    args: [a]\n', 'h');
  const preview = previewPolicy(base, head, ['vulnerabilities', 'secrets']);
  expect(preview.gates.vulnerabilities).toMatchObject({ enabled: true, options: {} });
  expect(preview.gates.vulnerabilities?.timeoutSeconds).toBeUndefined();
  expect(preview.gates.secrets?.command).toBeUndefined();
  expect(preview.gates.secrets?.args).toBeUndefined();
});
it('previews no role whose only change is enforce or an option', () => {
  expect(previewRoles([{ role: 'dependencies', key: 'enforce', old: true, new: false }, { role: 'secrets', key: 'options.fail-on', old: undefined, new: 'none' }])).toEqual([]);
  expect(previewRoles([{ role: 'dependencies', key: 'enabled', old: false, new: true }])).toEqual(['dependencies']);
});
// tests/run.test.ts
it('runs the preview gates without --trust-base and keeps --base for dep-guard', () => {
  const result = pullRequestRun(true, { staged: false, preview: { policy: DEPS_ONLY } });
  const lines = readFileSync(lastArgvLog, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(4);
  expect(lines[3]).toBe('--format json --base origin/main');
  expect(result.preview?.gates.map((gate) => gate.trustBase?.withheld)).toEqual([PREVIEW_WITHHELD]);
});
it('never lets a blocking or could-not-run preview gate change the exit code', () => {
  expect(result.exitCode).toBe(0);
  expect(result.findings).toEqual([]);
});
it('defers the intent gate from the preview and never spawns it there', () => {
  expect(result.preview?.deferred).toEqual(['intent']);
});
it('stops the preview at the budget and lists the rest as over budget', () => {
  // PREVIEW_BUDGET_MS injected low through options.timeoutMs-style hook
  expect(result.preview?.overBudget).toEqual(['secrets']);
});
it('refuses a preview option value that starts with a dash without spawning the gate', () => {
  expect(result.preview?.gates[0].couldNotRun?.reason).toBe('preparation-failed');
});
// tests/gate-runner-timeout.test.ts:296-311, extended
expect(calls.some((c) => c.timeout === 21_600_000)).toBe(false); // preview included
// tests/cli.test.ts
it('never runs the head command under the preview, which keeps the base command', () => {
  expect(existsSync(marker)).toBe(false);
});
it('starts no preview on --staged or when only report.format changed', () => {
  expect(result.stdout).not.toContain('Preview under the proposed rules');
});
// tests/output-text.test.ts
it('prints the preview after the verdict and leaves lines 1 to 4 and the token alone', () => {
  expect(withPreview.split('\n').slice(0, 4)).toEqual(without.split('\n').slice(0, 4));
  expect(withPreview.startsWith(without.trimEnd())).toBe(true);
  expect(verdictToken(withPreviewResult, false)).toBe('pass');
});
// tests/output-sarif.test.ts
it('files the preview as notifications and never as results', () => {
  expect(sarif.runs.flatMap((run: any) => run.results)).toHaveLength(0);
});
// tests/action-pr-comment.test.ts
it('cuts a comment body over 60000 characters and says so', () => {
  expect(posted.length).toBe(60_000 + '\n\n(report truncated at 60000 characters)'.length);
});
// tests/action.test.ts
it('stops the summary copy at the preview header and copies the preview line whole', () => {
  // a proposed line after PREVIEW_HEADER is not copied; 'preview: 1 gate(s), 0 finding(s), 0 could-not-run' is
});
```

- [ ] **Step 2: Run them and expect FAIL**

Run: `GIT_CONFIG_GLOBAL=/dev/null pnpm test -- tests/policy-diff.test.ts tests/run.test.ts tests/cli.test.ts tests/gate-runner-timeout.test.ts tests/output-text.test.ts tests/output-sarif.test.ts tests/action.test.ts tests/action-pr-comment.test.ts`
Expected: FAIL, because `previewPolicy`, `previewRoles` and `PREVIEW_WITHHELD` are not exported.

- [ ] **Step 3: Implement** to the pinned behaviour. Compute `exitCode`, `summary`, `findings` and `proposals` from the primary outcomes only.

- [ ] **Step 4: Rewrite the invariants and the schema description.** Do this after the tests exist, citing them only as `path:line`, `path:a-b` or `path ("exact test title")`.

- [ ] **Step 5: Review the spawn counts.** Run the full `GIT_CONFIG_GLOBAL=/dev/null pnpm test`. Correct every changed count to its exact new value, and give each change a one-line reason in the commit body.

- [ ] **Step 6: Commit**

`git add src action.yml scripts/pr-comment.mjs schema/guardrails.schema.json tests docs/INVARIANTS.md README.md CHANGELOG.md`
`git commit -m "Preview a pull request under its proposed enabled and stage settings without letting it decide the verdict (issue 100)"`

Deliverable: a pull request that switches the dependencies gate on shows it run once, labelled as a preview, while the exit code is that of the base rules alone.

---

### Task 4: Everything green (closes each pull request)

**Files:** none new.

- [ ] **Step 1: Run `source ~/.nvm/nvm.sh && pnpm build`.** Expect exit 0.
- [ ] **Step 2: Run `pnpm typecheck`.** Expect exit 0.
- [ ] **Step 3: Run `pnpm lint`.** Expect exit 0. For a failure from `scripts/check-invariant-citations.mjs`, re-read the cited line or test title and fix the citation, never the check. For a failure from `scripts/check-public-hygiene.mjs`, replace the dash or the path.
- [ ] **Step 4: Run `GIT_CONFIG_GLOBAL=/dev/null pnpm test`.** Expect every suite to pass.
- [ ] **Step 5: Commit any citation fixes.**

`git add docs/INVARIANTS.md`
`git commit -m "Re-point invariant citations after the proposed rules work"`
