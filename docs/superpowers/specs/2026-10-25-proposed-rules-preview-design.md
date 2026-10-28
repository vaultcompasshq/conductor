# A pull request that changes the rules is shown under them, and still judged by the old ones

Date: 2026-10-25
Status: security review done 2026-10-26: build with constraints. Design
written before the code, with the operator's rulings of 2026-10-25 applied,
revised the same day after an independent audit (section 5.1), and revised
on 2026-10-26 after the Task 3 security review (section 5.2), whose verdict
was "build with nine additional constraints".
Scope: conductor only.
Addresses issue 100: the visibility and naming parts (Tasks 1 and 2,
merged as PR 132 and PR 133) and the preview (Task 3). Issue 101 (no
policy on the base) is out of scope.
Delivery: Task 1 (visibility) and Task 2 (per-key naming) shipped as
separate pull requests. Task 3 (preview) is built as three sub-tasks, 3a
core, 3b output, 3c docs and invariants, and ships as one pull request
after all three, or as three if the diff exceeds about 1500 lines.

## 1. Intent and why

On a pull request the umbrella judges under the base ref's
`.guardrails.yaml`. That stays: a pull request must not pick its own judge.
There are two gaps. The proposed rules are never exercised before merge,
and the line that says they changed says almost nothing. Issue 100, from
two adopters on 0.8.1:

> A pull request that turned the dependencies gate OFF still ran dep-guard
> under the base rules, which had it on. dep-guard 0.10.1 exited 2
> (manifests-unresolved) and the job went red even in advisory mode.

> A pull request that turned the dependencies gate ON never ran dep-guard at
> all, because the base had it off. The new gate was first exercised on
> main, after merge, where a withdrawn gate version was found only then.

A third case, site PR 710, changed only dep-guard's own `.dep-guard.json`
(minAgeDays 0 to 7). The conductor action ran in advisory mode and passed,
and no control-change line was visible anywhere.
- dep-guard 0.11.1 does report the change: `config changed in this pull
  request`, with `minAgeDays raised to 7`.
- Conductor carries it into the text report.
- But the job log and the step summary never print a proposal, and the
  report is shown only when `pr-comment` is on, which is not the default.

The first complaint is NOT fixed by this design. The ruling at
INVARIANTS.md:4605 ("advisory maps exit 1 to exit 0, and never touches
exit 2") stands: a could-not-run in the primary run is exit 2 even in
advisory mode. A gate that the base enables and that cannot run still turns
the job red, and the preview does not change that.

## 2. Goals

1. A proposed control change is visible under the Action without opting in.
   The job log and the step summary carry the count and every `proposed`
   line. (Task 1, merged: PR 132.)
2. The umbrella's policy line names the gate, the key, the old value and
   the new value. This changes what the count means: a policy change of
   five keys now counts as five control changes, not one. (Task 2, merged:
   PR 133.)
3. (Task 3) When the pull request switches a gate on or off, or moves it
   to another stage, the gates also run once as a labelled preview that
   decides nothing. Under the Action this is on by default (`preview`
   input); on the command line it is opt-in (`--preview`).

## 3. Non-goals and anti-goals

Non-goals:
- A preview under the head's gate version inputs. On `pull_request` the
  workflow file is the pull request's own, so the installed gates already
  are the head's pins.
- Base-vs-head pin deltas read from the workflow file. Finding the right
  `with:` block (matrices, expressions, several `uses:`) is heuristic.

Anti-goals:
- The preview reaching the exit code, the verdict token, the verdict line,
  `isFullyClean`, `summary`, or lines 1 to 4 of the text report.
- The preview emitting a SARIF result, run, rule, fingerprint or category.
- Any head value other than `enabled`, `stage` or `enforce` reaching a
  gate's argv, environment or time limit.
- The preview switching off any pull-request protection: `options.trustBase`
  stays set for every preview spawn (section 5.2, finding 1).
- The umbrella writing a gate's config, or rewriting a gate's own proposal
  sentence.

## 4. Constraints

- AGENTS.md, the one rule: the umbrella is a convenience layer, not a fourth
  gate. It never writes into a gate's config, each gate decides about its
  own control files, and no gate depends on the umbrella.
- docs/INVARIANTS.md, which this design must keep (line numbers as of
  main at 207554e):
  - :767, no backward version pin.
  - :893, the rules come from the base ref.
  - :1018, the proposal count never counts a gate that could not run as
    zero.
  - :1040, a rule change is proposed, not refused, and is never a finding.
  - :1306-1312, proposals are notifications.
  - :1320-1323, the head-policy attacker script does not run.
  - :2092, an off-pin gate does not run.
  - :3650, coverage is a notification.
  - :4605, advisory never touches exit 2.
  - :5332-5345, one run decides the comment, the token and the exit code.
- Task 3 must rewrite these, not append beside them, because it builds a
  GatePolicy from the head and spawns a gate a second time:
  - INVARIANTS.md:904-914, the head policy is never parsed into a run.
  - INVARIANTS.md:1306-1312, the notification list.
  - INVARIANTS.md:1320-1323, the attacker-script claim.
  - INVARIANTS.md:1388-1401, no path builds a GatePolicy from the head.
  - INVARIANTS.md:4605-4630, advisory and exit 2.
  - INVARIANTS.md:5332-5345, "each gate spawned once".
  - The `timeout-seconds` description in schema/guardrails.schema.json:62.

## 5. Security

### 5.1 Every head-to-argv path, and what closes it (audit, 2026-10-25)

The primary run never sends a head option value to a gate. A preview built
from the head policy would, through `renderOptionFlags`
(src/policy.ts:610-630). These are the paths the audit named:

1. osv-scanner `call-analysis` compiles the project, and a pull request can
   ship a `build.rs`. Closed: no head options for gitleaks or osv-scanner at
   all.
2. A boolean option given a string renders as a flag the pull request
   chose. For example, a second gitleaks `--log-opts` overrides conductor's
   own (src/gate-runner.ts:1278), or an output flag writes attacker text to
   a predictable path, such as the pr-comment script that later runs with
   GH_TOKEN. Closed: options come only from the base role, and in the
   preview any option value starting with "-" is refused.
3. osv-scanner `output` is not reserved (src/policy.ts:182). Closed by the
   same rule: no head options.
4. A head `timeout-seconds` of 21600 is a denial-of-service lever and
   contradicts INVARIANTS.md:1388-1401. Closed: `timeout-seconds` comes from
   the base, and the whole preview has a hard 300 second deadline (5.2,
   finding 2).
5. A head `command:` or `args:` runs a program the pull request chose.
   Closed: they come from the base role, or from the profile default for a
   role only the head has.

So `previewPolicy` takes only `enabled`, `stage` and `enforce` from the
head. `command`, `args`, `options`, `timeout-seconds` and `present-on-base`
come from the base role, or from the profile default for a head-only role.
PATH pinning, the node_modules skip and `refuseHeadControlledProgram` stay
in force.

### 5.2 Security review, 2026-10-26: nine findings and the constraint that closes each

Verdict: build with these constraints. Citations are to main at 207554e;
where the review cited a line that has since moved, the current line is
given.

1. High. The trust base must stay set; only the flag is withheld.
   Every pull-request protection keys off `options.trustBase`: the
   node_modules skip (src/gate-runner.ts:1758), the program refusal
   (:1827-1840), the history-gate checks (:1850), forced enforce (:1887,
   :1911, :2015) and the intent-program refusal (src/run.ts:602-606). With
   it undefined, a `node_modules/.bin` installed by the head's lockfile
   outranks PATH. `decidedRef` is derived from `withheld` (:2028, :2086), so
   a plain withheld trust base also drops dep-guard's `--base` (:1191),
   moves gitleaks' scope to `HEAD` (:1266), drops `--ignore-gitleaks-allow`
   (:1285), and skips base config materialisation (:2030).
   Constraint: `options.trustBase` stays set on every preview spawn, and the
   `CONDUCTOR_EXPECTED_*` pins stay in force. `decideTrustBase` takes a
   `preview` argument and returns `withheld(PREVIEW_WITHHELD)` for dep-guard
   and vault-guard only, decided AFTER the version floor and the
   unreadable-version refusal, so a refused gate stays refused. For those
   two the withholding removes only the `--trust-base` argv flag: dep-guard
   keeps `--base <ref>` through an explicit `changeBase` argument to
   `gateArgs`. gitleaks and osv-scanner are never withheld in the preview:
   their `decidedRef` equals the base, so scope, `--ignore-gitleaks-allow`
   and base config are exactly the primary run's.

2. Medium. Head control files can make a gate slow, not run code.
   dep-guard's config keys are data only (dep-guard
   packages/core/src/config.ts:21-33), but `online: true` with a large
   `onlineBudgetMs`, or vault-guard `extra_patterns_unsafe: true`, runs a
   gate to its limit. Every spawn gets the full base limit
   (src/gate-runner.ts:1741-1746), up to 21600 s (src/policy.ts:230), and a
   gate has up to three spawns.
   Constraint: 300 s is a hard deadline for the whole preview. Each preview
   spawn's timeout is min(the gate's base limit, budget left), with
   `killSignal: 'SIGKILL'`; a spawn with no budget left is not started.
   Preview spawns get `XDG_CACHE_HOME` set to a fresh temporary directory,
   removed afterwards, because dep-guard's online cache
   (`XDG_CACHE_HOME` or `~/.cache`, dep-guard
   packages/core/src/online/cache.ts:37) persists on self-hosted runners.

3. Medium. The preview can change the verdict indirectly.
   Reports are written only after `runAll` returns (src/cli.ts:874-903). A
   throw in preview code lands in the catch at src/cli.ts:960: exit 2 and no
   report, which breaks INVARIANTS.md:5332-5345. If `timeout-minutes` kills
   the step, line 2 has no token and the step rewrites the verdict to
   could-not-run or unknown (action.yml:1165-1203). That fails closed but
   turns the run into could-not-run.
   Constraint: every preview entry point (the pass in `runAll`, its text
   block, its SARIF notifications, its log lines) runs inside a throw
   wrapper, so any throw becomes one printed preview line and
   `RunResult.preview.threw`. The hard deadline of finding 2 applies. The
   README tells adopters to set `timeout-minutes` to at least the primary
   run's need plus 300 s. The render step's fallback (action.yml:1372-1377,
   argv at :1400-1420) runs with the preview off.

4. High if naive. SARIF alerts.
   SARIF has one run per entry in `result.gates` (src/output-sarif.ts:
   1132-1171); `executionSuccessful` (:1245-1247) and the exit code
   (src/run.ts:748-755) come from the same outcomes. Appending preview
   outcomes to `gates` would create duplicate runs and alerts and flip
   `executionSuccessful`.
   Constraint: preview outcomes live in a separate `RunResult.preview`
   field and are rendered only as note-level `toolExecutionNotifications`
   on the umbrella's run. No new runs, results, rules, fingerprints or
   category.

5. Medium. Head-controlled text reaches the log, the comment and the
   summary. vault-guard's `ruleId` takes `extra_patterns` type names
   (src/normalize.ts:358), which in the preview come from the head's
   `.vault-guard` config. The comment is fenced
   (scripts/lib/pr-comment.mjs:39-42).
   Constraint: every `conductor: preview` log line goes through
   `cleanOutputLine` (src/gate-runner.ts:447, which applies
   `breakWorkflowMarkers` at :238). The comment report is cut to
   `COMMENT_LIMIT` (60000) before fencing, cutting the preview block first
   and the primary report only if it alone is over the limit. Only the
   fixed-shape `preview: N gate(s), M finding(s), K could-not-run` line is
   copied to the step summary.

6. Low. Exfiltration. The gates step has no token of its own
   (action.yml:967-973), but a job-level `GH_TOKEN` the caller sets is
   inherited (:1144-1146). Normalizers never copy match bytes
   (src/normalize.ts:352-368). Existing risk, not new: a failing gate's
   stderr summary (`summariseStderr`, src/normalize.ts:1589-1601) could quote
   a prefix of a head-symlinked file.
   Constraint: the README recommends `persist-credentials: false` on the
   checkout step.

7. Medium. A base-pinned command inside the repository.
   `refuseHeadControlledProgram` (src/trust-base.ts:885-984) checks only the
   program file's blob; its imports and `node_modules` come from the head
   tree. The preview widens this to roles the base has disabled, whose
   `command:` nobody has exercised.
   Constraint: in the preview, a base `command:` that resolves inside the
   working tree is could-not-run `gate-program-refused`, without a spawn.

8. Low. A cheap trigger. A one-line stage flip triggers a preview capped at
   300 s.
   Constraint: the Action's `preview` input (default `true`) turns it off.
   No preview when the head `.guardrails.yaml` does not parse.

9. Medium. Intent deferral. `prepareIntent` (src/run.ts:633) spawns the
   intent program.
   Constraint: the preview never reaches it. The intent role is listed as
   deferred before the preview loop and never enters it.

## 6. The decided how

1. Visibility (Task 1, merged: PR 132).
   - `cli.ts` writes `conductor: <count sentence>.` and then one
     `conductor: proposed <product> <line>` per proposal, each through
     `breakWorkflowMarkers`.
   - The gates step copies the count line and the `proposed` lines from the
     text report to the step summary, as whole fixed-shape lines in a fence,
     at most 50 of them.
   - A line with a backtick or a CR becomes a placeholder.
   - Past the cap the summary says how many more are in the report.
2. Per-key naming (Task 2, merged: PR 133).
   - `diffPolicies(base: Policy, head: Policy | null): PolicyKeyChange[]`
     in src/policy-diff.ts.
   - Each change is one conductor proposal,
     `policy: gates.<role>.<key> <old> -> <new>`.
   - A head that will not parse gives one line saying its changes are not
     known.
   - `policyDiffers` stays as the fail-closed boolean.
   - PR 133 left the parsed head as a local of `policyForRun`; it is not on
     `PolicyForRun`.
3. Preview (Task 3).
   - Which roles: only roles whose `enabled` or `stage` changed. A role
     whose only change is `enforce`, or a key taken from the base, is
     skipped, because its preview would be the primary run again.
   - When: `cli.ts` passes a preview only when `--preview` is given,
     `--staged` is absent, the trust base was not refused, the head parsed,
     and at least one role qualifies. `policyForRun` builds the preview
     policy itself from its local parsed head and returns it as an explicit
     `previewPolicy: Policy | null` on the `policy` branch of
     `PolicyForRun`; the parsed head itself is still never returned. The
     same `--gate` overrides are applied to it.
   - The policy: `previewPolicy` takes only `enabled`, `stage` and `enforce`
     from the head and holds only the previewed roles (section 5.1).
   - The trust base: `options.trustBase` stays set and the
     `CONDUCTOR_EXPECTED_*` pins stay in force. `decideTrustBase(...,
     preview = true)` returns `withheld(PREVIEW_WITHHELD)` for dep-guard and
     vault-guard only, after the version floor and the refusal. The argv
     loses only `--trust-base`; dep-guard keeps `--base <ref>`. gitleaks
     and osv-scanner keep `decidedRef` equal to the base (5.2, finding 1).
   - Refusals the primary run does not need: an option value starting with
     "-" is could-not-run `preparation-failed`, and a base `command:` inside
     the working tree is could-not-run `gate-program-refused`, neither
     spawned.
   - The intent gate is deferred from the preview, with a printed line, and
     `prepareIntent` is never called for it.
   - Budget: a hard 300 s deadline for the whole preview. Each spawn's
     timeout is min(the gate's base limit, budget left), killed with
     SIGKILL. A gate reached with no budget left, and every gate after it,
     is listed as over budget and printed as `preview skipped: over budget
     (...)`. Preview spawns get `XDG_CACHE_HOME` set to a temporary
     directory.
   - Containment: the preview is computed after the primary outcomes, from
     which `exitCode`, `summary`, `findings` and `proposals` are already
     fixed, inside a throw wrapper. A throw becomes `preview.threw` and one
     printed line.
   - Reporting:
     - The preview is in the same invocation.
     - Its text block comes after the verdict line, opening with
       `PREVIEW_HEADER` and `preview: N gate(s), M finding(s), K
       could-not-run`, then the deferred and over-budget lines.
     - Each preview gate gets a `conductor: preview <role> ...` job log
       line through `cleanOutputLine`, and a note-level SARIF notification
       on the umbrella's run.
     - The step summary copies only the fixed-shape `preview:` line.
     - The PR comment report is cut at 60000 characters before fencing,
       the preview block first, with a trailing note.
   - A could-not-run in the preview is advisory and never produces exit 2.
     One in the primary run is not advisory.
   - The Action: a `preview` input, default `true`. The gates step passes
     `--preview` only when the input is `true` and the installed
     conductor's `run --help` lists the flag (the same probe as
     `--text-report`). The render step's fallback never passes it.
   - Documentation: the README's pull-request section says to set the
     job's `timeout-minutes` to at least the primary run's need plus 300 s,
     and to check out with `persist-credentials: false`.

## 7. Left to the builder

- How the gate loop in `runAll` is parameterised for the second pass.
- The exact wording of the deferred-intent line, the over-budget line and
  the threw line, within the fixed shapes in the plan.
