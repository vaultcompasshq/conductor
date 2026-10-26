# A pull request that changes the rules is shown under them, and still judged by the old ones

Date: 2026-10-25
Status: design, written before the code, with the operator's rulings of
2026-10-25 applied. Revised the same day after an independent audit, which
found that the preview opened a head-to-argv path (section 5).
Scope: conductor only.
Addresses the visibility and naming parts of conductor issue 100. The
preview is tracked separately and is gated on a security review. Issue 101
(no policy on the base) is out of scope.
Delivery: three pull requests. Task 1 (visibility) and Task 2 (per-key
naming) ship separately. Task 3 (preview) ships later, and only after a
security review of the head-to-argv path signs off.

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
INVARIANTS.md:4593 stands: a could-not-run in the primary run is exit 2
even in advisory mode. A gate that the base enables and that cannot run
still turns the job red, and the preview does not change that.

## 2. Goals

1. A proposed control change is visible under the Action without opting in.
   The job log and the step summary carry the count and every `proposed`
   line.
2. The umbrella's policy line names the gate, the key, the old value and
   the new value. This changes what the count means: a policy change of
   five keys now counts as five control changes, not one.
3. (Task 3, gated) When the pull request switches a gate on or off, or
   moves it to another stage, the gates also run once as a labelled
   preview that decides nothing.

## 3. Non-goals and anti-goals

Non-goals:
- A preview under the head's gate version inputs. On `pull_request` the
  workflow file is the pull request's own, so the installed gates already
  are the head's pins.
- Base-vs-head pin deltas read from the workflow file. Finding the right
  `with:` block (matrices, expressions, several `uses:`) is heuristic.

Anti-goals:
- The preview reaching the exit code, the verdict token, the verdict line,
  `isFullyClean`, or lines 1 to 4 of the text report.
- The preview emitting a SARIF result.
- Any head value other than `enabled`, `stage` or `enforce` reaching a
  gate's argv, environment or time limit.
- The umbrella writing a gate's config, or rewriting a gate's own proposal
  sentence.

## 4. Constraints

- AGENTS.md, the one rule: the umbrella is a convenience layer, not a fourth
  gate. It never writes into a gate's config, each gate decides about its
  own control files, and no gate depends on the umbrella.
- docs/INVARIANTS.md, which this design must keep:
  - :767, no backward version pin.
  - :893, the rules come from the base ref.
  - :1014, the proposal count never counts a gate that could not run as
    zero.
  - :1036-1053, a rule change is proposed, not refused, and is never a
    finding.
  - :1296-1302, proposals are notifications.
  - :1310, the head-policy attacker script does not run.
  - :2080, an off-pin gate does not run.
  - :3638, coverage is a notification.
  - :4593, advisory never touches exit 2.
  - :5308, one run decides the comment, the token and the exit code.
- Task 3 must rewrite these, not append beside them, because it builds a
  GatePolicy from the head:
  - INVARIANTS.md:906-911, the head policy is never parsed into a run.
  - INVARIANTS.md:1377-1384, no path builds a GatePolicy from the head.
  - The `timeout-seconds` description in schema/guardrails.schema.json:62.

## 5. Security: every head-to-argv path, and what closes it

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
   contradicts INVARIANTS.md:1377-1384. Closed: `timeout-seconds` comes from
   the base, and the whole preview has a 300 second budget.
5. A head `command:` or `args:` runs a program the pull request chose.
   Closed: they come from the base role, or from the profile default for a
   role only the head has.

So `previewPolicy` takes only `enabled`, `stage` and `enforce` from the
head. `command`, `args`, `options`, `timeout-seconds` and `present-on-base`
come from the base role, or from the profile default for a head-only role.
PATH pinning, the node_modules skip and `refuseHeadControlledProgram` stay
in force.

## 6. The decided how

1. Visibility (Task 1).
   - `cli.ts` writes `conductor: <count sentence>.` and then one
     `conductor: proposed <product> <line>` per proposal, each through
     `breakWorkflowMarkers`.
   - The gates step copies the count line and the `proposed` lines from the
     text report to the step summary, as whole fixed-shape lines in a fence,
     at most 50 of them.
   - A line with a backtick or a CR becomes a placeholder.
   - Past the cap the summary says how many more are in the report.
2. Per-key naming (Task 2).
   - `diffPolicies(base: Policy, head: Policy | null): PolicyKeyChange[]`
     in a new src/policy-diff.ts.
   - Each change is one conductor proposal,
     `policy: gates.<role>.<key> <old> -> <new>`.
   - A head that will not parse gives one line saying its changes are not
     known.
   - `policyDiffers` stays as the fail-closed boolean.
3. Preview (Task 3, gated).
   - It runs only roles whose `enabled` or `stage` changed. A role whose
     only change is `enforce`, or a key taken from the base, is skipped,
     because its preview would be the primary run again.
   - No preview on `--staged`. The same `--gate` overrides apply.
   - The family gates run without `--trust-base`. `PREVIEW_WITHHELD` is
     decided after the version floor and the refusal in `decideTrustBase`.
   - The intent gate is deferred from the preview, with a printed line.
   - Budget: 300 seconds in total. When it runs out, the report prints
     `preview skipped: over budget`.
   - Reporting:
     - The preview is in the same invocation.
     - Its text block comes after the verdict line.
     - Each preview gate gets a `conductor: preview <role> ...` job log
       line and a note-level SARIF notification.
     - The PR comment is cut at 60000 characters, with a trailing note.
   - A could-not-run in the preview is advisory. One in the primary run is
     not.

## 7. Left to the builder

- How the gate loop in `runAll` is parameterised for the second pass.
- The exact wording of the deferred-intent line and the over-budget line,
  within the fixed shapes in the plan.
