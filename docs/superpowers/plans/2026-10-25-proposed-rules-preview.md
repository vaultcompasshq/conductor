# Proposed Rules Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** this plan addresses issue 100.
- Every proposed control change shows in the job log and the step summary (Task 1, merged: PR 132).
- Each policy change names its key, old value and new value (Task 2, merged: PR 133).
- The gates whose `enabled` or `stage` a pull request changes run once more, under the proposed settings, as a preview that decides nothing (Task 3). The security review of 2026-10-26 signed this off as "build with constraints"; its nine constraints are spec section 5.2.

It does NOT fix issue 100's first complaint. Under the ruling at INVARIANTS.md:4605, a could-not-run in the primary run still turns the job red in advisory mode.

**Delivery:** Task 1 and Task 2 shipped as separate pull requests (merged: PR 132 / PR 133). Task 3 is built as sub-tasks 3a (core), 3b (output) and 3c (docs and invariants), each ending in a commit, and ships as one pull request after 3a-3c, or as three if the diff exceeds about 1500 lines. Task 4 closes each pull request.

**Architecture:**
- Task 1 only renders what `RunResult.proposals` already carries.
- Task 2 adds a pure `src/policy-diff.ts`, and `policyForRun` parses the head policy for comparison only, into a local.
- Task 3 runs a second, narrowed gate pass inside the same `runAll` call, after the primary result is fixed and inside a throw wrapper. It takes only `enabled`, `stage` and `enforce` from the head, keeps `options.trustBase` set, withholds only the `--trust-base` flag and only from dep-guard and vault-guard, runs under a hard 300 s deadline, and returns `RunResult.preview`, which no exit-code, token or verdict function reads.

**Tech Stack:** TypeScript (ESM), Node 20 or later, Jest with experimental VM modules (`@jest/globals`), `spawnSync`, the bash `run:` blocks of `action.yml`, scripts/lib/pr-comment.mjs.

**Spec:** `docs/superpowers/specs/2026-10-25-proposed-rules-preview-design.md`

## Global Constraints

- The preview never reaches `composeExitCode`, `verdictToken`, `verdict`, `isFullyClean`, `summary`, `proposalCount` or lines 1 to 4 of the text report.
- The preview emits no SARIF result, run, rule, fingerprint or category. It emits only `conductor/preview-under-proposed-rules` notifications, at level note, on the umbrella's run.
- No head value other than `enabled`, `stage` or `enforce` reaches a gate's argv, its environment or its time limit (spec section 5.1).
- The preview never leaves `options.trustBase` unset. Only the `--trust-base` argv flag is withheld, for dep-guard and vault-guard only; gitleaks and osv-scanner keep `decidedRef` equal to the base; the `CONDUCTOR_EXPECTED_*` pins stay in force (spec 5.2, finding 1).
- The umbrella writes no gate's config and rewrites no gate's proposal sentence.
- A primary could-not-run keeps exit 2 under `--advisory` (INVARIANTS.md:4605). A preview could-not-run changes nothing.
- One invocation per job, and the comment step invokes conductor zero times on the normal path (INVARIANTS.md:5332-5345). The render step's fallback never passes `--preview`.
- Plain ASCII, no em or en dashes, and no machine paths in tracked files. Lint runs after `source ~/.nvm/nvm.sh` (the repository has no .nvmrc, so a bare `nvm use` fails; the default node works).
- Tests run as `GIT_CONFIG_GLOBAL=/dev/null pnpm test -- <file>`. Commit messages are plain ASCII with no backticks and no arrows.

## Review Focus

1. A proposal sentence carries head-controlled text, such as a package name, that could contain `::error::`, a backtick or a markdown link. Task 1 sends log lines through `breakWorkflowMarkers` and replaces an unsafe summary line with a placeholder. Both are tested.
2. A head `.guardrails.yaml` that is valid YAML but fails `parsePolicy`, for example a relative `command:`. The head was never parsed before, so the new parse must not turn a bad head into exit 2. Task 2 tests it, and Task 3a tests that such a head runs no preview.
3. The head changes only `report.format`, or only spells out defaults. Task 2 tests that the first gives one role-less line and the second gives the fallback line. Task 3a tests that neither starts a preview.
4. A head option that would reach argv in the preview. Examples: osv `call-analysis`, a string where a boolean belongs (`--log-opts`), osv `output`, a value starting with "-", and `timeout-seconds: 21600`. Task 3a tests that `previewPolicy` drops each one, that a dash-led value is refused before any spawn, and that no preview spawn gets the head's timeout.
5. The head enables a gate that blocks or cannot run. Task 3a tests that `exitCode`, `findings`, `summary` and `proposals` come from the primary run alone, and Task 3b that the token and lines 1 to 4 do.
6. A preview that switches a protection off. Task 3a tests that the node_modules skip, the program refusal and the gitleaks and osv-scanner trust inputs are the same in the preview as in the primary run.

Each sub-task of Task 3 ends with its own Review Focus line.

---

### Task 1: Proposals in the job log and the step summary (pull request 1, merged: PR 132)

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

### Task 2: Per-key policy diff (pull request 2, merged: PR 133)

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

### Task 3: The preview under the proposed rules (security review done 2026-10-26: build with constraints)

Task 3 is three sub-tasks, each independently testable and each ending in a commit. They ship as one pull request after 3c, or as three (3a, 3b, 3c) if the diff exceeds about 1500 lines. Citations are to main at 207554e. The nine constraints are spec section 5.2; each sub-task names the findings it closes.

Two corrections to the earlier draft of this task, forced by the review:
- `options.trustBase` is NEVER left unset in the preview. Every pull-request protection keys off it (spec 5.2, finding 1). Only the `--trust-base` argv flag is withheld, for dep-guard and vault-guard only, through a `withheld` value from `decideTrustBase`. gitleaks and osv-scanner keep `decidedRef` equal to the base, and the `CONDUCTOR_EXPECTED_*` pins stay in force.
- PR 133 removed `headPolicy` from `PolicyForRun`; the parsed head is a local of `policyForRun` (src/cli.ts:486-493). Task 3a does not put it back. `policyForRun` builds the preview policy itself and returns only that, as an explicit `previewPolicy: Policy | null`.

---

### Task 3a: The preview pass, core

Closes findings 1, 2, 3 (the wrapper and the deadline), 7, 8 (no preview on an unparseable head) and 9, and the audit's five head-to-argv paths (spec 5.1).

**Files:**
- Modify: `src/policy-diff.ts`, appending `previewRoles` and `previewPolicy` after `policyChangeLine` (`:127-136`).
- Modify: `src/cli.ts:308-311` (`PolicyForRun` gains `previewPolicy`), `:481-511` (`policyForRun` builds it from its local `headPolicy`, `:486-493`), `:741` (the `--preview` option, beside `--staged`), `:846-855` (the `runAll` call passes `preview`).
- Modify: `src/run.ts:205-245` (`RunResult.preview`), `:247-308` (`RunOptions.preview`, `RunOptions.previewClock`), `:569-778` (`runAll`: the preview pass runs after `exitCode` is fixed at `:748-755`, through `guardPreview(() => runPreview(...))`).
- Modify: `src/gate-runner.ts:171` (`TimeLimitSource` gains `'preview-budget'`), `:748-822` (`decideTrustBase` gains `preview`), `:914-957` (`RunGateOptions.preview`), `:1149-1192` (`gateArgs` gains `changeBase`), `:1652-1760` (`runGate`: the two preview refusals, before any spawn), and the four spawn sites `:1374` (version probe), `:2149` and `:2755` (osv-scanner base run), `:2423-2432` (scan), each taking its timeout, `killSignal` and `env` from `previewSpawnOptions` when `options.preview` is set.
- Modify: `tests/helpers/stub-gate.ts:62-66` (`envLog` takes `envVar?: string`, default `GIT_NO_REPLACE_OBJECTS`).
- Test: `tests/policy-diff.test.ts`, `tests/gate-runner.test.ts`, `tests/run.test.ts` (in "pull-request mode through a whole run", `:654`), `tests/cli.test.ts` (in "pull-request mode through the CLI", `:1535`, and "the program a pull-request run is allowed to execute", `:2362`), `tests/gate-runner-timeout.test.ts` (the spy at `:15-23` also records `killSignal` and `env`; the twins go after `:311`).
- Spawn-count review: the CLI default is no preview, so only tests that pass `--preview` or `RunOptions.preview` change counts. Run `grep -n 'toHaveLength' tests/run.test.ts tests/cli.test.ts tests/dogfood.e2e.test.ts` after the change and correct any count that moved to its exact new value, never a range.

**Interfaces:**
- Consumes: `diffPolicies`, `PolicyKeyChange`, `applyCliOverrides(policy: Policy, overrides: CliOverrides): Policy`, `resolveTimeLimit(gate: GatePolicy, override: number | undefined): TimeLimit`, `refuseHeadControlledBinary`, `runGate(gate: GatePolicy, options: RunGateOptions): GateOutcome`.
- Produces:
  ```ts
  // src/policy-diff.ts
  export function previewRoles(changes: PolicyKeyChange[]): GateRole[];
  export function previewPolicy(base: Policy, head: Policy, roles: GateRole[]): Policy;

  // src/run.ts
  export const PREVIEW_BUDGET_MS = 300_000;
  export interface PreviewSkipped { role: GateRole; product: Product; reason: 'stage' | 'disabled' | 'excluded' }
  export interface RunPreview {
    gates: GateOutcome[];
    findings: Finding[];
    skipped: PreviewSkipped[];
    deferred: GateRole[];
    overBudget: GateRole[];
    threw: string | null;
  }
  export function guardPreview<T>(work: () => T, fallback: (message: string) => T): T;
  export function runPreview(policy: Policy, options: RunOptions): RunPreview;
  // RunOptions gains:  preview?: { policy: Policy }; previewClock?: () => number  (a test hook; no CLI path sets it)
  // RunResult gains:   preview?: RunPreview  (absent, not empty, when RunOptions.preview is absent)

  // src/gate-runner.ts
  export const PREVIEW_WITHHELD = 'preview under the proposed rules: this gate read its own control files from the head';
  export function decideTrustBase(gate: GatePolicy, intent: IntentPreparation | undefined, trustBase: string | undefined, productVersion: string | null, preview?: boolean): GateTrustBase | undefined;
  export function gateArgs(gate: GatePolicy, staged: boolean, intent: IntentPreparation | undefined, trustBase?: string, external?: ExternalArgs, intentBase?: string, changeBase?: string): string[];
  export interface PreviewSpawn { deadline: number; clock: () => number; cacheDir: string }
  // RunGateOptions gains: preview?: PreviewSpawn
  export function previewSpawnTimeout(limitMs: number, preview: PreviewSpawn): number;
  export function previewSpawnOptions(limitMs: number, preview: PreviewSpawn, env: NodeJS.ProcessEnv): { timeout: number; killSignal: 'SIGKILL'; env: NodeJS.ProcessEnv };

  // src/cli.ts
  // PolicyForRun 'policy' branch gains: previewPolicy: Policy | null
  // conductor run gains: --preview
  ```

Pinned behaviour:
- `previewRoles` returns, in `GATE_ROLES` order and without duplicates, every role with an `enabled` or `stage` change. A role whose only changes are `enforce` or keys the preview takes from the base is dropped, and so is `report.format` (role null).
- `previewPolicy` holds only the roles in `roles`, plus the base `report`. For a role on both sides it is the base `GatePolicy` with `enabled`, `stage` and `enforce` from the head. For a head-only role it is the gate `parsePolicy` gives for `product` alone, with `enabled`, `stage` and `enforce` from the head: `options: {}`, no `command`, no `args`, no `timeoutSeconds`, no `presentOnBase`. For a role the head removed it is the base gate with `enabled: false`.
- `policyForRun` sets `previewPolicy` to `applyCliOverrides(previewPolicy(baseParsed, headPolicy, roles), overrides)` when `headPolicy` is not null and `previewRoles(diffPolicies(baseParsed, headPolicy))` is non-empty, and to null otherwise. A head that does not parse gives null (finding 8). The parsed head is never returned.
- `cli.ts` passes `preview: { policy: source.previewPolicy }` only when `--preview` is given, `--staged` is absent, `source.kind === 'policy'`, `source.trustBase` is set and `source.previewPolicy` is not null. Without `--preview` nothing changes for any existing caller.
- `runAll` computes `outcomes`, `findings`, `summary`, `exitCode` and `proposals` exactly as today, and only then, when `options.preview` is set, `preview: guardPreview(() => runPreview(options.preview.policy, options), (message) => ({ gates: [], findings: [], skipped: [], deferred: [], overBudget: [], threw: message }))`. Nothing computed before it reads `preview`.
- `guardPreview` returns `work()`, or `fallback(message)` when `work` throws, where `message` is the error's message through `cleanOutputLine` and cut to 200 characters. It never rethrows.
- `runPreview`:
  - Lists an enabled `intent` role in `deferred` and never runs it or calls `prepareIntent` for it (finding 9).
  - Lists a role the run's `--stage` leaves out as `skipped` with `reason: 'stage'`, a disabled role as `'disabled'`, and a `--gate` exclusion as `'excluded'`.
  - Takes `start = (options.previewClock ?? Date.now)()` and `deadline = start + PREVIEW_BUDGET_MS`. Before each gate, when `deadline - clock() <= 0`, that gate and every gate after it go to `overBudget`.
  - Makes one `cacheDir` with `mkdtempSync` under `options.tempRoot ?? os.tmpdir()`, removed in a `finally`.
  - Calls `runGate` with the same options as the primary run, `trustBase` included, plus `preview: { deadline, clock, cacheDir }`.
- `decideTrustBase(..., preview = true)` returns `withheld(PREVIEW_WITHHELD)` for dep-guard and vault-guard, and only after the unreadable-version refusal (`:785-792`) and the version-floor refusal (`:797-804`). A refused gate stays refused. For every other product it returns exactly what it returns without `preview`.
- `runGate`, when `options.preview` is set and `trustBase.withheld === PREVIEW_WITHHELD`, calls `gateArgs` with `trustBase` undefined and `changeBase = options.trustBase`, so the preview dep-guard argv is exactly `['--format', 'json', '--base', REF]` and vault-guard's is `['-f', 'json']`. `decidedRef` stays undefined for those two, as for any withheld gate.
- gitleaks and osv-scanner in the preview get `decidedRef === options.trustBase`: the same `--log-opts` scope, `--ignore-gitleaks-allow`, base config and osv base run as the primary run.
- Two refusals in `runGate`, only when `options.preview` is set, before any spawn, the version probe included:
  - Any option value that is a string starting with "-", or an array holding one: could-not-run `preparation-failed`, detail `preview under the proposed rules: option <name> has a value starting with "-", so this gate was not run`.
  - A base `command:` whose real path is inside `options.repoRoot`: could-not-run `gate-program-refused`, detail `preview under the proposed rules: the base command <command> is inside the working tree, so this gate was not run` (finding 7).
- `previewSpawnTimeout(limitMs, p)` is `Math.max(0, Math.min(limitMs, p.deadline - p.clock()))`. Every preview spawn uses `previewSpawnOptions`: that timeout, `killSignal: 'SIGKILL'`, and `env` equal to the spawn's own env plus `XDG_CACHE_HOME: p.cacheDir`. A spawn whose timeout is 0 is not started and the gate is could-not-run `timed-out`. When the budget is the smaller limit the outcome's `timeLimit.source` is `'preview-budget'`.
- Primary spawns are unchanged: no `killSignal`, no `XDG_CACHE_HOME`, the full base limit.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/policy-diff.test.ts
const ONLY = (role: string, product: string) =>
  parsePolicy(`version: 1\ngates:\n  ${role}:\n    product: ${product}\n`, 'only').gates;
it('takes only enabled, stage and enforce from the head', () => {
  const base = parsePolicy('version: 1\ngates:\n  vulnerabilities:\n    product: osv-scanner\n    enabled: false\n    timeout-seconds: 60\n', 'b');
  const head = parsePolicy('version: 1\ngates:\n  vulnerabilities:\n    product: osv-scanner\n    stage: ci\n    enforce: false\n    timeout-seconds: 21600\n    options:\n      call-analysis: all\n      output: /x/y\n  secrets:\n    product: vault-guard\n    enforce: false\n    command: /x/evil\n    args: [a]\n    options:\n      fail-on: none\n', 'h');
  const preview = previewPolicy(base, head, ['vulnerabilities', 'secrets']);
  expect(preview.gates.vulnerabilities).toEqual({ ...base.gates.vulnerabilities, enabled: true, stage: 'ci', enforce: false });
  expect(preview.gates.secrets).toEqual({ ...ONLY('secrets', 'vault-guard').secrets, enforce: false });
});
it('holds only the previewed roles, and previews a removed role as disabled', () => {
  const base = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\n  secrets:\n    product: vault-guard\n', 'b');
  const head = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\n', 'h');
  const preview = previewPolicy(base, head, ['secrets']);
  expect(Object.keys(preview.gates)).toEqual(['secrets']);
  expect(preview.gates.secrets).toEqual({ ...base.gates.secrets, enabled: false });
  expect(preview.report).toEqual(base.report);
});
it('previews only a role with an enabled or stage change', () => {
  expect(previewRoles([
    { role: 'dependencies', key: 'enforce', old: true, new: false },
    { role: 'dependencies', key: 'command', old: undefined, new: '/x' },
    { role: 'secrets', key: 'options.fail-on', old: undefined, new: 'none' },
    { role: null, key: 'report.format', old: 'text', new: 'sarif' },
  ])).toEqual([]);
  expect(previewRoles([
    { role: 'secrets', key: 'stage', old: 'commit', new: 'ci' },
    { role: 'secrets', key: 'enabled', old: false, new: true },
    { role: 'dependencies', key: 'enabled', old: false, new: true },
  ])).toEqual(['dependencies', 'secrets']);
  const head = parsePolicy('version: 1\ngates:\n  dependencies:\n    product: dep-guard\n  secrets-history:\n    product: gitleaks\n', 'h');
  expect(previewRoles(diffPolicies(BASE, head))).toEqual(['secrets-history']);
});

// tests/gate-runner.test.ts
const G = (role: GateRole, product: Product): GatePolicy =>
  ({ role, product, enabled: true, stage: 'ci', enforce: true, excludedByCli: false, options: {} });
it('withholds only the flag, for dep-guard and vault-guard only, in the preview', () => {
  expect(decideTrustBase(G('dependencies', 'dep-guard'), undefined, 'origin/main', '9.9.9', true))
    .toEqual({ ref: 'origin/main', withheld: PREVIEW_WITHHELD, refused: null, proposals: [] });
  expect(decideTrustBase(G('secrets', 'vault-guard'), undefined, 'origin/main', '9.9.9', true)?.withheld).toBe(PREVIEW_WITHHELD);
  for (const [role, product] of [['secrets-history', 'gitleaks'], ['vulnerabilities', 'osv-scanner'], ['intent', 'intent-guard']] as const) {
    expect(decideTrustBase(G(role, product), undefined, 'origin/main', '9.9.9', true))
      .toEqual(decideTrustBase(G(role, product), undefined, 'origin/main', '9.9.9'));
  }
});
it('refuses a gate below its floor or with no readable version in the preview exactly as in the primary run', () => {
  for (const version of ['0.5.0', null]) {
    expect(decideTrustBase(G('dependencies', 'dep-guard'), undefined, 'origin/main', version, true))
      .toEqual(decideTrustBase(G('dependencies', 'dep-guard'), undefined, 'origin/main', version));
  }
});
it('keeps --base for dep-guard when the preview withholds --trust-base', () => {
  expect(gateArgs(G('dependencies', 'dep-guard'), false, undefined, undefined, {}, undefined, 'origin/main'))
    .toEqual(['--format', 'json', '--base', 'origin/main']);
  expect(gateArgs(G('secrets', 'vault-guard'), false, undefined, undefined, {}, undefined, 'origin/main'))
    .toEqual(['-f', 'json']);
});
it('gives a preview spawn the smaller of its limit and the budget left, and SIGKILL', () => {
  const p = { deadline: 1_000_000, clock: () => 998_500, cacheDir: 'cache' };
  expect(previewSpawnTimeout(21_600_000, p)).toBe(1_500);
  expect(previewSpawnTimeout(10_000, { ...p, clock: () => 700_000 })).toBe(10_000);
  expect(previewSpawnTimeout(10_000, { ...p, clock: () => 1_000_001 })).toBe(0);
  expect(previewSpawnOptions(10_000, p, { A: '1' })).toEqual({ timeout: 1_500, killSignal: 'SIGKILL', env: { A: '1', XDG_CACHE_HOME: 'cache' } });
});

// tests/run.test.ts, inside "pull-request mode through a whole run"
const P = (body: string) => parsePolicy(`version: 1\ngates:\n${body}`, 'preview-test');
const SECRETS = P('  secrets:\n    product: vault-guard\n');
const FAMILY = P('  dependencies:\n    product: dep-guard\n  secrets:\n    product: vault-guard\n');
function previewRun(base: Policy, preview: Policy, extra: Partial<RunOptions> = {}) {
  const bin = tempDir();
  lastArgvLog = path.join(tempDir(), 'argv.txt');
  stubGate(bin, 'dep-guard', { stdout: CLEAN_DEP_GUARD, argvLog: lastArgvLog });
  stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD, argvLog: lastArgvLog });
  stubGate(bin, 'intent-guard', { stdout: PROPOSING_INTENT, version: '1.8.1', argvLog: lastArgvLog });
  return runAll(base, {
    repoRoot: prRepo(), staged: false, pathValue: bin,
    trustBase: { ref: 'origin/main', policyChanged: true, refusal: null },
    preview: { policy: preview }, ...extra,
  });
}
it('preview omits --trust-base only for dep-guard and vault-guard', () => {
  const result = previewRun(SECRETS, FAMILY);
  expect(readFileSync(lastArgvLog, 'utf8').trim().split('\n')).toEqual([
    '-f json --trust-base origin/main',
    '--format json --base origin/main',
    '-f json',
  ]);
  expect(result.preview?.gates.map((gate) => gate.trustBase?.withheld)).toEqual([PREVIEW_WITHHELD, PREVIEW_WITHHELD]);
});
it('preview hands gitleaks and osv-scanner the same trust inputs as the primary run', () => {
  // historyPreviewRun: fiveStubs() (:92) on PATH, prRepo() (:985), the same
  // secrets-history + vulnerabilities policy as the base and as the preview.
  const result = historyPreviewRun();
  const strip = (argv: string[]) => argv.map((arg) => (arg.startsWith(os.tmpdir()) ? '<tmp>' : arg));
  expect(result.preview?.gates.map((gate) => strip(gate.argv))).toEqual(result.gates.map((gate) => strip(gate.argv)));
  expect(result.preview?.gates.map((gate) => gate.trustBase?.withheld)).toEqual([null, null]);
  expect(result.preview?.gates[0].argv).toContain('--diff-merges=first-parent origin/main..HEAD');
  expect(result.preview?.gates[0].argv).toContain('--ignore-gitleaks-allow');
});
it('never lets a blocking or could-not-run preview gate change the primary result', () => {
  const without = previewRun(SECRETS, FAMILY, { preview: undefined });
  // dep-guard stubbed blocking (exit 1, one finding) for the preview only:
  // the base does not enable it, so only the preview spawns it.
  const result = blockingDepGuardPreviewRun(SECRETS, FAMILY);
  expect(result.preview?.gates[0].findings.some((finding) => finding.blocking)).toBe(true);
  expect(result.exitCode).toBe(0);
  expect(result.findings).toEqual([]);
  expect(result.summary).toEqual(without.summary);
  expect(result.proposals).toEqual(without.proposals);
});
it('a preview that throws leaves the exit code, the verdict token and lines 1-4 identical to the run without it', () => {
  const boom = { version: 1, report: { format: 'text' }, get gates() { throw new Error('boom'); } } as unknown as Policy;
  const without = previewRun(SECRETS, FAMILY, { preview: undefined });
  const result = previewRun(SECRETS, boom);
  expect(result.preview).toEqual({ gates: [], findings: [], skipped: [], deferred: [], overBudget: [], threw: 'boom' });
  expect(result.exitCode).toBe(without.exitCode);
  expect(verdictToken(result, false)).toBe(verdictToken(without, false));
  expect(renderText(result).split('\n').slice(0, 4)).toEqual(renderText(without).split('\n').slice(0, 4));
});
it('the preview never calls prepareIntent and prints the deferred line', () => {
  const result = previewRun(SECRETS, P('  intent:\n    product: intent-guard\n'));
  expect(result.preview?.deferred).toEqual(['intent']);
  expect(result.preview?.gates).toEqual([]);
  expect(readFileSync(lastArgvLog, 'utf8').trim().split('\n')).toEqual(['-f json --trust-base origin/main']);
});
it('stops the preview at the budget and lists the rest as over budget', () => {
  // The clock reads 0 until the preview dep-guard has written its argv line,
  // then 300 000: dependencies runs inside the budget, secrets finds none left.
  const result = previewRun(SECRETS, FAMILY, {
    previewClock: () => (readFileSync(lastArgvLog, 'utf8').includes('--format json --base') ? 300_000 : 0),
  });
  expect(result.preview?.gates.map((gate) => gate.role)).toEqual(['dependencies']);
  expect(result.preview?.overBudget).toEqual(['secrets']);
});
it('refuses a preview option value that starts with a dash without spawning the gate', () => {
  const result = previewRun(SECRETS, P('  dependencies:\n    product: dep-guard\n    options:\n      fail-on: "--output=/tmp/x"\n'));
  expect(result.preview?.gates[0].couldNotRun?.reason).toBe('preparation-failed');
  expect(readFileSync(lastArgvLog, 'utf8').trim().split('\n')).toEqual(['-f json --trust-base origin/main']);
});
it('preview of a family gate keeps the node_modules skip and refuses a head-controlled program', () => {
  // familyRepo(): prRepo() plus, in the head commit only, node_modules/.bin/vault-guard
  // and tools/bin/vault-guard, both writing `marker` when run.
  const { repo, marker } = familyRepo();
  const skip = runAll(SECRETS_OFF, { repoRoot: repo, staged: false, pathValue: cleanBin(),
    trustBase: { ref: 'origin/main', policyChanged: true, refusal: null }, preview: { policy: SECRETS } });
  expect(skip.preview?.gates[0].nodeModulesSkipped).toBeDefined();
  expect(skip.preview?.gates[0].couldNotRun).toBeNull();
  const refused = runAll(SECRETS_OFF, { repoRoot: repo, staged: false, pathValue: path.join(repo, 'tools', 'bin'),
    trustBase: { ref: 'origin/main', policyChanged: true, refusal: null }, preview: { policy: SECRETS } });
  expect(refused.preview?.gates[0].couldNotRun?.reason).toBe('gate-program-refused');
  expect(existsSync(marker)).toBe(false);
});

// tests/gate-runner-timeout.test.ts, a new describe after :312, using the
// spy at :15-23 extended to record killSignal and env
it('a preview gate whose base limit is 21600 is killed when the 300 s budget runs out', () => {
  // sleepingVaultGuard(bin): answers --version, then `sleep 30` on a scan.
  const ticks = [0, 298_500];
  const result = runAll(P('  dependencies:\n    product: dep-guard\n    enabled: false\n'), {
    repoRoot: gitRepo(), staged: false, pathValue: sleepingVaultGuard(tempDir()),
    trustBase: { ref: 'HEAD', policyChanged: true, refusal: null },
    preview: { policy: P('  secrets:\n    product: vault-guard\n    timeout-seconds: 21600\n') },
    previewClock: () => ticks.shift() ?? 298_500,
  });
  const scan = calls.find((call) => call.args.includes('-f'));
  expect(scan?.timeout).toBe(1_500);
  expect(scan?.killSignal).toBe('SIGKILL');
  expect(result.preview?.gates[0].couldNotRun?.reason).toBe('timed-out');
  expect(result.preview?.gates[0].timeLimit?.source).toBe('preview-budget');
  expect(result.exitCode).toBe(0);
});
it('preview spawns get a temporary XDG_CACHE_HOME and SIGKILL, and primary spawns get neither', () => {
  const bin = tempDir();
  stubGate(bin, 'vault-guard', { stdout: CLEAN_VAULT_GUARD });
  runAll(P('  secrets:\n    product: vault-guard\n'), {
    repoRoot: gitRepo(), staged: false, pathValue: bin,
    trustBase: { ref: 'HEAD', policyChanged: true, refusal: null },
    preview: { policy: P('  secrets:\n    product: vault-guard\n') },
    previewClock: () => 0,
  });
  const spawns = spawnsOf(bin, 'vault-guard');
  // version probe and scan, once for the primary run and once for the preview
  expect(spawns).toHaveLength(4);
  expect(spawns.slice(0, 2).map((call) => [call.killSignal, call.env?.XDG_CACHE_HOME])).toEqual([[undefined, undefined], [undefined, undefined]]);
  for (const call of spawns.slice(2)) {
    expect(call.killSignal).toBe('SIGKILL');
    expect(call.env?.XDG_CACHE_HOME?.startsWith(os.tmpdir())).toBe(true);
    expect(call.env?.XDG_CACHE_HOME).not.toBe(process.env.XDG_CACHE_HOME);
  }
});
// Twins of :296 and :306, through prRun with '--preview' added to the argv.
// The head now also switches the gate on, so the preview runs it.
it('the preview of a gate the head switches on keeps the base 10 s limit, never 21600', async () => {
  const { stdout, exitCode, bin } = await prRun(
    'version: 1\ngates:\n  secrets-history:\n    product: gitleaks\n    enabled: false\n    timeout-seconds: 10\n',
    policy('21600'), ['--preview']);
  const scans = spawnsOf(bin, 'gitleaks').filter((c) => c.args.includes('--report-path'));
  expect(scans.map((c) => c.timeout)).toEqual([10_000]);
  expect(calls.some((c) => c.timeout === 21_600_000)).toBe(false);
  expect(exitCode).toBe(0);
  expect(stdout).toMatch(/policy: gates\.secrets-history\.enabled false -> true/);
});
it('the preview of a head-only gate stays inside the 300 s budget, never the 600 s default or 21600', async () => {
  const { bin } = await prRun('version: 1\ngates:\n  secrets-history:\n    product: gitleaks\n    enabled: false\n', policy('21600'), ['--preview']);
  const [scan] = spawnsOf(bin, 'gitleaks').filter((c) => c.args.includes('--report-path'));
  // Wall clock, not an injected one: the CLI path sets no previewClock.
  expect(scan?.timeout).toBeLessThanOrEqual(300_000);
  expect(scan?.timeout).toBeGreaterThan(290_000);
});

// tests/cli.test.ts, inside "pull-request mode through the CLI"
const SECRETS_OFF_BASE = 'version: 1\ngates:\n  dependencies:\n    product: dep-guard\n  secrets:\n    product: vault-guard\n    enabled: false\n';
it('the head-policy attacker script does not run during the preview', () => {
  const { repo, bin, marker } = attackRepo({
    basePolicy: SECRETS_OFF_BASE,
    headPolicy: 'version: 1\ngates:\n  dependencies:\n    product: dep-guard\n  secrets:\n    product: vault-guard\n    command: ATTACKER\n    args: []\n',
  });
  const result = runCli(repo, ['run', '--trust-base', 'base', '--preview', '--verbose'], bin);
  expect(existsSync(marker)).toBe(false);
  expect(result.stdout).toContain('Preview under the proposed rules (does not affect the verdict)');
  expect(result.stdout).toContain('preview: 1 gate(s), 0 finding(s), 0 could-not-run');
});
it('an unparseable head runs no preview', () => {
  const { repo, bin } = attackRepo({ basePolicy: SECRETS_OFF_BASE, headPolicy: 'version: 1\ngates:\n  secrets:\n    product: vault-guard\n    command: relative/gate\n' });
  const result = runCli(repo, ['run', '--trust-base', 'base', '--preview', '--verbose'], bin);
  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain('Preview under the proposed rules');
});
it('starts no preview without --preview, on --staged, or when only report.format changed', () => {
  const { repo, bin } = attackRepo({ basePolicy: SECRETS_OFF_BASE, headPolicy: SECRETS_OFF_BASE.replace('    enabled: false\n', '') });
  for (const args of [['run', '--trust-base', 'base'], ['run', '--staged', '--trust-base', 'base', '--preview']]) {
    expect(runCli(repo, args, bin).stdout).not.toContain('Preview under the proposed rules');
  }
  const format = attackRepo({ basePolicy: SECRETS_OFF_BASE, headPolicy: `${SECRETS_OFF_BASE}report:\n  format: sarif\n` });
  expect(runCli(format.repo, ['run', '--trust-base', 'base', '--preview', '--format', 'text'], format.bin).stdout)
    .not.toContain('Preview under the proposed rules');
});
// tests/cli.test.ts, inside "the program a pull-request run is allowed to execute" (:2362)
it('preview refuses a base command inside the working tree', () => {
  // Base: secrets disabled, command: <repo>/tools/base-gate.sh, committed on the
  // base so refuseHeadControlledProgram alone would let it run. Head: enabled.
  const result = runCli(repo, ['run', '--trust-base', 'base', '--preview', '--verbose'], bin);
  expect(existsSync(baseGateMarker)).toBe(false);
  expect(result.stdout).toContain('the base command');
  expect(result.stdout).toContain('is inside the working tree, so this gate was not run');
  expect(result.status).toBe(0);
});
```

In the attacker test, `ATTACKER` is replaced with the absolute path `attackRepo` gives `tools/nice-gate.sh`; extend `attackRepo` (`:1563`) so a `headPolicy` string can name it, for example through a `{{attacker}}` placeholder. In tests/gate-runner-timeout.test.ts, `P` is the same one-line helper as in tests/run.test.ts. `familyRepo`, `cleanBin`, `SECRETS_OFF`, `historyPreviewRun`, `blockingDepGuardPreviewRun` and `sleepingVaultGuard` are local helpers built from `prRepo`, `stubGate` and `fiveStubs` in the same file; `prRun` (`tests/gate-runner-timeout.test.ts:245`) gains an `extraArgs: string[] = []` parameter appended after `--verbose`.

- [ ] **Step 2: Run them and expect FAIL**

Run: `GIT_CONFIG_GLOBAL=/dev/null pnpm test -- tests/policy-diff.test.ts tests/gate-runner.test.ts tests/run.test.ts tests/cli.test.ts tests/gate-runner-timeout.test.ts`
Expected: FAIL, because `previewPolicy`, `previewRoles`, `PREVIEW_WITHHELD`, `previewSpawnTimeout` and `previewSpawnOptions` are not exported, and `--preview` is an unknown option.

- [ ] **Step 3: Implement** to the pinned behaviour, in this order: `previewRoles` and `previewPolicy`; `decideTrustBase`'s `preview` argument and `gateArgs`' `changeBase`; `previewSpawnTimeout`, `previewSpawnOptions` and the four spawn sites; the two preview refusals in `runGate`; `RunPreview`, `guardPreview`, `runPreview` and the call at the end of `runAll`; `PolicyForRun.previewPolicy`, `--preview` and the `runAll` call in `cli.ts`. `runAll`'s existing return object gains only `...(preview === undefined ? {} : { preview })`.

- [ ] **Step 4: Run and expect PASS.** The same command, then the full `GIT_CONFIG_GLOBAL=/dev/null pnpm test`, and correct any spawn count that moved (see Files).

- [ ] **Step 5: Commit**

`git add src/policy-diff.ts src/run.ts src/gate-runner.ts src/cli.ts tests/policy-diff.test.ts tests/gate-runner.test.ts tests/run.test.ts tests/cli.test.ts tests/gate-runner-timeout.test.ts tests/helpers/stub-gate.ts`
`git commit -m "Run the gates whose enabled or stage a pull request changes once more as a preview that decides nothing (issue 100)"`

Deliverable: `conductor run --trust-base <ref> --preview` on a pull request that switches the dependencies gate on spawns dep-guard once more with `--base <ref>` and without `--trust-base`, under a 300 s deadline, and the exit code is that of the base rules alone.

Review Focus (3a): `options.trustBase` is set on every preview `runGate` call; `PREVIEW_WITHHELD` is decided after both version refusals and only for dep-guard and vault-guard; no head value other than `enabled`, `stage` and `enforce` reaches `previewPolicy`'s output; every preview spawn site takes `previewSpawnOptions`; `exitCode`, `summary`, `findings` and `proposals` are computed before `runPreview` is called and nothing after reads them back.

---

### Task 3b: The preview in the report, the log, SARIF, the comment and the Action

Closes findings 3 (the render-step fallback), 4, 5 and 8 (the Action input). Depends on 3a.

**Files:**
- Modify: `src/output-text.ts`: `PREVIEW_HEADER`, `previewLines` and `previewLogLines` beside `proposalLogLines` (`:806`); `renderText` (`:1702-1784`) appends `previewLines` after the verdict line (`:1782`) and after the one-line clean summary (`:1720-1722`). The compact refusal form (`:1705-1718`) never has a preview, because a refused run never gets one.
- Modify: `src/output-sarif.ts`: `previewNotifications` beside `proposalNotifications` (`:813`), appended to the umbrella's notification list (`:1187-1203`).
- Modify: `src/cli.ts:926-930` (`logLines` gains `...previewLogLines(result)` after `proposalLogLines`).
- Modify: `scripts/lib/pr-comment.mjs`: `COMMENT_LIMIT`, `PREVIEW_HEADER`, `truncateReport`, and `buildCommentBody` (`:48-50`) cutting the report before `fenceReport` (`:39-42`). `scripts/pr-comment.mjs` is unchanged: it already builds the body through `postReport` from the lib (`:28`).
- Modify: `action.yml`:
  - inputs: `preview` after `advisory` (`:107`), default `'true'`.
  - gates step env (`:975-990`): `PREVIEW: ${{ inputs.preview }}`.
  - gates step, beside the `--text-report` help probe (`:1041-1060`): `ARGS+=(--preview)` when `$PREVIEW` is `true` and `run --help` lists `--preview`.
  - gates step summary copy (`:1237-1275`): the proposal scan stops at the `PREVIEW_HEADER` line, and the fixed-shape `preview:` line after it is copied in its own fence.
  - render step (`:1400-1420`): unchanged, and pinned never to pass `--preview`.
- Test: `tests/output-text.test.ts`, `tests/output-sarif.test.ts`, `tests/cli.test.ts` (in "the per-gate job log lines on stderr", `:3382`), `scripts/tests/pr-comment.test.mjs`, `tests/action.test.ts` (in "action.yml: the verdict token from the gates step", `:1936`; `runGatesForVerdict` at `:1948` gains `previewFlag?: boolean` and `preview?: string`), `tests/action-pr-comment.test.ts` (`prCommentScript`, `:52`).

**Interfaces:**
- Consumes: `RunPreview`, `guardPreview`, `gateSection(gate: GateOutcome, verbose: boolean, refusedOnTerminal?: boolean): string[]` (`:354`), `cleanOutputLine(raw: string): string` (src/gate-runner.ts:447), the `gateLogLines` outcome words (`:837`).
- Produces:
  ```ts
  // src/output-text.ts
  export const PREVIEW_HEADER = 'Preview under the proposed rules (does not affect the verdict)';
  export function previewLines(result: RunResult, verbose: boolean): string[];
  export function previewLogLines(result: RunResult): string[];
  // src/output-sarif.ts
  function previewNotifications(result: RunResult): Notification[];
  ```
  ```js
  // scripts/lib/pr-comment.mjs
  export const COMMENT_LIMIT = 60000;
  export const PREVIEW_HEADER = 'Preview under the proposed rules (does not affect the verdict)';
  export function truncateReport(reportText, limit = COMMENT_LIMIT) { /* string */ }
  ```
  ```yaml
  # action.yml inputs
  preview:
    description: ...
    required: false
    default: 'true'
  ```

Pinned behaviour:
- `previewLines` returns `[]` when `result.preview` is absent. Otherwise, through `guardPreview`, in this order:
  - `''`
  - `PREVIEW_HEADER`
  - `preview: <n> gate(s), <m> finding(s), <k> could-not-run`, where n is `preview.gates.length`, m is `preview.findings.length`, and k counts gates with `couldNotRun !== null`
  - one `gateSection` per preview gate
  - `preview: intent (intent-guard) deferred, the preview does not prepare the intent gate` when `deferred` holds `intent`
  - `preview skipped: over budget (<role> (<product>), ...)` when `overBudget` is non-empty
  - `preview: could not be completed (<threw>)` when `threw` is not null
  - `  a could-not-run in the preview is advisory: it does not change the exit code.` when k > 0
- `renderText(result)` with a preview starts with exactly `renderText` of the same result without one, byte for byte, and only then the preview lines. `verdictToken`, `verdict` and `isFullyClean` never read `preview`.
- `previewLogLines` returns `[]` with no preview, and otherwise one `conductor: preview <role> (<product>) <outcome>` per preview gate, in the `gateLogLines` outcome words, then one `conductor: preview <role> (<product>) over budget` per over-budget role and `conductor: preview intent (intent-guard) deferred` for a deferred intent, every line through `cleanOutputLine`.
- `previewNotifications` gives one notification per preview gate, id `conductor/preview-under-proposed-rules`, level `note`, message `Preview under the proposed rules, which does not affect the verdict: <role> (<product>) <outcome>, <m> finding(s).` It is appended only when the notification list without it is non-empty, so the preview never creates the umbrella's run. It never adds a run, a result, a rule, a fingerprint or a category, and `executionSuccessful` (`:1245-1247`) still reads only `result.gates`.
- `truncateReport(text)`: unchanged when `text.length <= COMMENT_LIMIT`. Otherwise, when `text` holds `'\n\n' + PREVIEW_HEADER + '\n'` at index i, the result is `text.slice(0, i + 1) + '\n(preview under the proposed rules omitted: the report is over 60000 characters)\n'`. Only if that is still over the limit, or there is no preview block, is the result `text.slice(0, COMMENT_LIMIT) + '\n\n(report truncated at 60000 characters)'`. `buildCommentBody` fences `truncateReport(reportText)`.
- The gates step copies to the step summary, after the `control changes:` block, `preview under the proposed rules:` and a `text` fence holding the first line after `PREVIEW_HEADER` only when it matches `^preview: [0-9]+ gate\(s\), [0-9]+ finding\(s\), [0-9]+ could-not-run$`. Nothing else after `PREVIEW_HEADER` is copied, and no `proposed` line after it is counted.
- The gates step adds `--preview` only when `PREVIEW` is exactly `true` and the same successful `run --help` output that is probed for `--text-report` also contains `--preview`. The render step's fallback argv never contains `--preview`: the fallback conductor predates `--text-report`, so it predates the preview too, and passing the flag would turn its run into an unknown-option exit 2.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/output-text.test.ts
it('prints the preview after the verdict and leaves lines 1 to 4 and the token alone', () => {
  const without = renderText(prResult([]), { verbose: true });
  const withPreview = renderText({ ...prResult([]), preview: ONE_CLEAN_PREVIEW_GATE }, { verbose: true });
  expect(withPreview.startsWith(without)).toBe(true);
  expect(withPreview.split('\n').slice(0, 4)).toEqual(without.split('\n').slice(0, 4));
  expect(withPreview.slice(without.length).split('\n').slice(0, 3)).toEqual([
    '', PREVIEW_HEADER, 'preview: 1 gate(s), 0 finding(s), 0 could-not-run',
  ]);
  expect(verdictToken({ ...prResult([]), preview: ONE_CLEAN_PREVIEW_GATE }, false)).toBe(verdictToken(prResult([]), false));
});
it('prints the deferred, over-budget, threw and advisory lines in their fixed shapes', () => {
  const text = renderText({ ...prResult([]), preview: { ...ONE_COULD_NOT_RUN_PREVIEW_GATE, deferred: ['intent'], overBudget: ['secrets-history'], threw: 'boom' } });
  expect(text).toContain('\npreview: 1 gate(s), 0 finding(s), 1 could-not-run\n');
  expect(text).toContain('\npreview: intent (intent-guard) deferred, the preview does not prepare the intent gate\n');
  expect(text).toContain('\npreview skipped: over budget (secrets-history (gitleaks))\n');
  expect(text).toContain('\npreview: could not be completed (boom)\n');
  expect(text).toContain('\n  a could-not-run in the preview is advisory: it does not change the exit code.\n');
});
it('a preview log line carrying ::error:: is neutralised', () => {
  const lines = previewLogLines({ ...prResult([]), preview: previewWithDetail('x ::error::y\u001b[31m') });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/^conductor: preview dependencies \(dep-guard\) /);
  expect(lines[0]).not.toContain('::');
  expect(lines[0]).not.toContain('\u001b');
  expect(previewLogLines(prResult([]))).toEqual([]);
});

// tests/output-sarif.test.ts
it('a run with a preview renders SARIF whose runs, results and partialFingerprints deep-equal the same run without it, apart from umbrella notifications', () => {
  const plain = JSON.parse(renderSarif(BLOCKING_PR_RESULT, '9.9.9'));
  const shown = JSON.parse(renderSarif({ ...BLOCKING_PR_RESULT, preview: ONE_BLOCKING_PREVIEW_GATE }, '9.9.9'));
  const dropPreview = (log: any) => {
    for (const run of log.runs) {
      for (const invocation of run.invocations ?? []) {
        invocation.toolExecutionNotifications = (invocation.toolExecutionNotifications ?? [])
          .filter((n: any) => n.descriptor?.id !== 'conductor/preview-under-proposed-rules');
      }
    }
    return log;
  };
  expect(dropPreview(shown)).toEqual(dropPreview(plain));
  expect(shown.runs).toHaveLength(plain.runs.length);
  const notes = shown.runs.at(-1).invocations[0].toolExecutionNotifications
    .filter((n: any) => n.descriptor?.id === 'conductor/preview-under-proposed-rules');
  expect(notes).toHaveLength(1);
  expect(notes[0].level).toBe('note');
});
it('a preview could-not-run leaves executionSuccessful and the exit code unchanged', () => {
  const result = { ...CLEAN_PR_RESULT, preview: ONE_COULD_NOT_RUN_PREVIEW_GATE };
  const umbrella = JSON.parse(renderSarif(result, '9.9.9')).runs.at(-1);
  expect(umbrella.invocations[0].executionSuccessful).toBe(true);
  expect(result.exitCode).toBe(CLEAN_PR_RESULT.exitCode);
});

// tests/cli.test.ts, in "the per-gate job log lines on stderr"
it('writes one conductor: preview line per preview gate after the proposal lines', () => {
  // attackRepo with SECRETS_OFF_BASE and a head that only switches secrets on
  expect(result.stderr).toMatch(/^conductor: preview secrets \(vault-guard\) /m);
  expect(result.stderr.indexOf('conductor: preview ')).toBeGreaterThan(result.stderr.indexOf('conductor: proposed '));
});
```

```js
// scripts/tests/pr-comment.test.mjs
const PRIMARY = 'conductor 9.9.9\nverdict-token: pass\n' + 'x'.repeat(1000) + '\n\nconductor verdict: pass\n';
it('a comment over 60000 characters keeps the primary report and cuts the preview first', () => {
  const text = PRIMARY + '\n' + PREVIEW_HEADER + '\n' + 'y'.repeat(70000) + '\n';
  expect(truncateReport(text)).toBe(PRIMARY + '\n(preview under the proposed rules omitted: the report is over 60000 characters)\n');
  expect(buildCommentBody(text)).toContain(PRIMARY.trimEnd());
  expect(buildCommentBody(text)).not.toContain('yyyy');
});
it('leaves a report at or under 60000 characters alone, and cuts a primary report over it with a note', () => {
  expect(truncateReport('a'.repeat(60000))).toBe('a'.repeat(60000));
  expect(truncateReport('a'.repeat(70000))).toBe('a'.repeat(60000) + '\n\n(report truncated at 60000 characters)');
});
it('spells PREVIEW_HEADER exactly as src/output-text.ts does', () => {
  expect(PREVIEW_HEADER).toBe('Preview under the proposed rules (does not affect the verdict)');
});
```

```ts
// tests/action.test.ts, in "action.yml: the verdict token from the gates step"
it('copies only the fixed-shape preview line to the step summary', () => {
  const run = runGatesForVerdict({ exit: 0, body: ['conductor 9.9.9', 'verdict-token: pass', 'x', '', COUNT, '', 'conductor verdict: pass', '',
    'Preview under the proposed rules (does not affect the verdict)', 'preview: 1 gate(s), 0 finding(s), 0 could-not-run',
    '  proposed  dep-guard     smuggled after the header', '  secrets  vault-guard  ::error::x', ''].join('\n') });
  expect(run.summary).toBe('conductor verdict: pass\n\ncontrol changes:\n\n```text\n' + COUNT.trimStart() + '\n```\n\n' +
    'preview under the proposed rules:\n\n```text\npreview: 1 gate(s), 0 finding(s), 0 could-not-run\n```\n\n');
});
it('copies no preview line whose shape is not the fixed one', () => {
  const run = runGatesForVerdict({ exit: 0, body: ['conductor 9.9.9', 'verdict-token: pass', 'x', '',
    'Preview under the proposed rules (does not affect the verdict)', 'preview: 1 gate(s) `x`', ''].join('\n') });
  expect(run.summary).toBe('conductor verdict: pass\n\n');
});
it('passes --preview only when the input is true and the installed conductor lists it', () => {
  const OK = 'conductor 9.9.9\nverdict-token: pass\n';
  expect(runGatesForVerdict({ exit: 0, body: OK, previewFlag: true }).argv).toContain('--preview');
  expect(runGatesForVerdict({ exit: 0, body: OK, previewFlag: true, preview: 'false' }).argv).not.toContain('--preview');
  expect(runGatesForVerdict({ exit: 0, body: OK, previewFlag: false }).argv).not.toContain('--preview');
});
it('declares the preview input, defaulting to true', () => {
  expect(action.inputs.preview.default).toBe('true');
});

// tests/action-pr-comment.test.ts
it('never passes --preview from the render step, so the fallback run has the preview off', () => {
  expect(prCommentScript).not.toContain('--preview');
  expect(stepEnv('pr-render').PREVIEW).toBeUndefined();
});
```

`ONE_CLEAN_PREVIEW_GATE`, `ONE_COULD_NOT_RUN_PREVIEW_GATE`, `ONE_BLOCKING_PREVIEW_GATE` and `previewWithDetail(detail)` are `RunPreview` fixtures holding one dep-guard outcome, built from the outcome fixtures each file already has; `BLOCKING_PR_RESULT` and `CLEAN_PR_RESULT` are existing pull-request results in tests/output-sarif.test.ts ("pull-request mode in the SARIF log", `:1903`).

- [ ] **Step 2: Run them and expect FAIL**

Run: `GIT_CONFIG_GLOBAL=/dev/null pnpm test -- tests/output-text.test.ts tests/output-sarif.test.ts tests/cli.test.ts scripts/tests/pr-comment.test.mjs tests/action.test.ts tests/action-pr-comment.test.ts`
Expected: FAIL, because `PREVIEW_HEADER`, `previewLogLines`, `truncateReport` and `COMMENT_LIMIT` are not exported, and action.yml has no `preview` input.

- [ ] **Step 3: Implement** to the pinned behaviour. `previewLines`, `previewLogLines` and `previewNotifications` each run their body through `guardPreview`, falling back to the single `preview: could not be completed (<message>)` line or, for SARIF, no preview notifications.

- [ ] **Step 4: Run and expect PASS.** The same command, then the full `GIT_CONFIG_GLOBAL=/dev/null pnpm test`.

- [ ] **Step 5: Commit**

`git add src/output-text.ts src/output-sarif.ts src/cli.ts scripts/lib/pr-comment.mjs action.yml tests/output-text.test.ts tests/output-sarif.test.ts tests/cli.test.ts scripts/tests/pr-comment.test.mjs tests/action.test.ts tests/action-pr-comment.test.ts`
`git commit -m "Show the preview after the verdict, in the job log, as SARIF notes and in the step summary, and add the Action preview input (issue 100)"`

Deliverable: under the Action, with no new input set, a pull request that switches a gate on shows a labelled preview block after the verdict line, one `conductor: preview` log line per gate, one fixed-shape line in the step summary, and the same SARIF runs and results as without it.

Review Focus (3b): no preview text before the verdict line; every preview log line through `cleanOutputLine`; SARIF `runs`, `results` and `partialFingerprints` unchanged and `executionSuccessful` read from `result.gates` only; the summary copy cannot carry a head-controlled preview line; `truncateReport` cuts the preview block before the primary report; the render step never passes `--preview`.

---

### Task 3c: Invariants, schema, README and CHANGELOG

Closes the documentation half of findings 3 (`timeout-minutes`) and 6 (`persist-credentials: false`), and rewrites every invariant the preview changes. Depends on 3a and 3b, because it cites their tests.

**Files:** (line numbers are main at 207554e; the review's numbers had drifted and are corrected here: its `:906-911` is `:904-914`, `:1296-1302` is `:1306-1312`, `:1310` is `:1320-1323`, `:1377-1384` is `:1388-1401`, `:4593` is `:4605-4630`, `:5308` is `:5332-5345`. Re-read each before editing, because 3a and 3b do not touch this file but other merges may.)
- Rewrite, not append beside, in `docs/INVARIANTS.md`:
  - `:904-914`. "THE HEAD'S POLICY FILE IS NEVER PARSED INTO A RUN" becomes: the head is parsed for the comparison, and into a preview policy that takes only `enabled`, `stage` and `enforce` from it, never into the primary run that decides the exit code, the token and the report's first four lines. Cite tests/policy-diff.test.ts ("takes only enabled, stage and enforce from the head").
  - `:1300-1304`. Add: a preview gate's `PREVIEW_WITHHELD` is shown in the preview block, not as `conductor/trust-base-not-passed`, because preview outcomes are never in `result.gates`.
  - `:1306-1312`. The notification list gains `conductor/preview-under-proposed-rules`, level note, on the umbrella's run only. Cite tests/output-sarif.test.ts ("a run with a preview renders SARIF whose runs, results and partialFingerprints deep-equal the same run without it, apart from umbrella notifications").
  - `:1320-1323`. The attacker-script claim extends to the preview. Keep `tests/cli.test.ts:1622-1644` and add tests/cli.test.ts ("the head-policy attacker script does not run during the preview") and ("preview refuses a base command inside the working tree").
  - `:1388-1401`. "No path builds a GatePolicy from the head policy on a pull-request run" becomes: only the preview does, and its `timeout-seconds` is the base's, or the profile default for a head-only role, and every preview spawn is further capped at what is left of a hard 300 s deadline and killed with SIGKILL. Keep the citations of `tests/gate-runner-timeout.test.ts:296` and `:306` for the primary run, and add the twins ("the preview of a gate the head switches on keeps the base 10 s limit, never 21600"), ("the preview of a head-only gate stays inside the 300 s budget, never the 600 s default or 21600") and ("a preview gate whose base limit is 21600 is killed when the 300 s budget runs out").
  - `:4605-4630`. Add: a preview could-not-run is advisory and never produces exit 2, with or without `--advisory`; a primary could-not-run is unchanged. Cite tests/run.test.ts ("never lets a blocking or could-not-run preview gate change the primary result") and tests/output-sarif.test.ts ("a preview could-not-run leaves executionSuccessful and the exit code unchanged").
  - `:5332-5345`. "one invocation, each gate spawned once" becomes: one invocation; the run that decides spawns each gate once, and the preview in the same invocation may spawn a previewed gate once more; the preview never reaches the token, the exit code or report lines 1 to 4. Cite tests/run.test.ts ("a preview that throws leaves the exit code, the verdict token and lines 1-4 identical to the run without it") and tests/output-text.test.ts ("prints the preview after the verdict and leaves lines 1 to 4 and the token alone").
- Add: the subsection `### The preview under the proposed rules never decides anything`, before `### The branch-name convention is a convenience, not a control` (`:1403`). It states the nine constraints of spec section 5.2 in one paragraph each, each with the 3a or 3b test that pins it, in the citation forms `path:line`, `path:a-b` or `path ("exact test title")`.
- Rewrite: `schema/guardrails.schema.json:62`, the `timeout-seconds` description. After "so a pull request cannot change its own limit." add "The preview under the proposed rules also uses the base value, capped by its 300 second deadline."
- Modify: `README.md`, in "The pull-request trust boundary" (`:769`), a `### The preview under the proposed rules` subsection: what runs (roles whose `enabled` or `stage` changed), what does not reach it (any head value but those three), that it decides nothing, the `preview` input (default `true`) and `--preview`, and that the intent gate is deferred. In "The Action" (`:1312`), beside the `timeout-minutes` advice (`:1710`): set the job's `timeout-minutes` to at least what the primary run needs plus 300 seconds (5 minutes), and check out with `persist-credentials: false`, with a `with:` example.
- Modify: `CHANGELOG.md` `## [Unreleased]` (`:15`), under Added: the preview, the `--preview` flag, the Action `preview` input defaulting to true, the 300 second deadline, the 60000 character comment cut, and the two README recommendations.

**Interfaces:** none. Documentation only.

- [ ] **Step 1: Write the failing check**

Run: `grep -n "PARSED INTO A RUN\|No path builds a GatePolicy\|each gate spawned once" docs/INVARIANTS.md` and `grep -c "preview" schema/guardrails.schema.json`
Expected: FAIL, in the sense this task needs: the first prints the three old claims (at `:907`, `:1389` and `:5334`), and the second prints `0`.

- [ ] **Step 2: Rewrite the passages and the schema description** as listed, replacing each sentence the preview falsifies rather than adding a contradicting one beside it, and add the new subsection with its citations.

- [ ] **Step 3: README and CHANGELOG** as listed.

- [ ] **Step 4: Run and expect PASS.** Run the two commands of Step 1 and expect no match from the first and `1` from the second. Then run `source ~/.nvm/nvm.sh && pnpm lint` and expect exit 0. For a failure from `scripts/check-invariant-citations.mjs`, re-read the cited line or title and fix the citation, never the check. For a failure from `scripts/check-public-hygiene.mjs`, replace the dash or the path.

- [ ] **Step 5: Commit**

`git add docs/INVARIANTS.md schema/guardrails.schema.json README.md CHANGELOG.md`
`git commit -m "Rewrite the invariants the proposed rules preview changes, and document its input, deadline and checkout advice (issue 100)"`

Deliverable: no sentence in docs/INVARIANTS.md, the schema or the README says the head policy is never built into a GatePolicy or that a gate is spawned only once per invocation, and `pnpm lint` passes.

Review Focus (3c): each rewritten passage replaces the old claim instead of contradicting it from a later paragraph; every new citation points at a 3a or 3b test that pins the claim beside it (the check proves only that the title exists); the README's `timeout-minutes` figure is primary plus 300 s, not 300 s alone.

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
