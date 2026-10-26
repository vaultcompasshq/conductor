# A pull request that changes the rules is shown under them, and still judged by the old ones

Date: 2026-10-25
Status: design, written before the code, with the operator's rulings of
2026-10-25 applied.
Scope: conductor only. Closes conductor issue 100. Not issue 101.

## 1. Intent and why

On a pull request the umbrella judges under the base ref's
`.guardrails.yaml`. That stays: a pull request must not pick its own judge.
The gap is that the proposed rules are never exercised before merge, and
the line saying they changed says almost nothing. Issue 100, from two
adopters on 0.8.1:

> A pull request that turned the dependencies gate OFF still ran dep-guard
> under the base rules, which had it on. dep-guard 0.10.1 exited 2
> (manifests-unresolved) and the job went red even in advisory mode.

> A pull request that turned the dependencies gate ON never ran dep-guard at
> all, because the base had it off. The new gate was first exercised on
> main, after merge, where a withdrawn gate version was found only then.

Site PR 710 changed only dep-guard's own `.dep-guard.json` (minAgeDays 0 to
7). The conductor action ran advisory and passed, and no control-change line
was visible. dep-guard 0.11.1 does report it (`config changed in this pull
request`, `minAgeDays raised to 7`) and conductor carries it into the text
report. But the job log and the step summary never print a proposal, and the
report is shown only when `pr-comment` is on, which is not the default.

## 2. Goals

1. Proposed control changes are visible under the Action without opt-in:
   the count and every `proposed` line in the job log and step summary.
2. The umbrella's own policy line names gate, key, old value and new value.
3. When the policy changes a gate key, the gates also run once under the
   proposed policy, as a labelled preview that decides nothing.

## 3. Non-goals and anti-goals

Non-goals:
- A preview under head gate version inputs. On `pull_request` the workflow
  file is the pull request's own, so the installed gates already are the
  head's pins; the preview would be the run that already happens.
- Base-vs-head pin deltas from the workflow file. Finding the file and its
  `with:` block (matrices, expressions, several `uses:`) is heuristic, and a
  heuristic line about a control is worse than none.
- Issue 101 (no policy on the base), tracked separately.

Anti-goals: the preview reaching the exit
code, the verdict token or line, `isFullyClean`, or lines 1 to 4 of the
text report; the preview emitting a SARIF result; the preview running a
program the pull request chose; the umbrella writing a gate's config or
rewriting a gate's proposal sentence.

## 4. Constraints

- AGENTS.md: the umbrella is a convenience layer, not a fourth gate. It
  raises findings only about the gates, never writes into a gate's config,
  each gate decides what to do with its own control files, and no gate may
  depend on the umbrella.
- docs/INVARIANTS.md: :767 no backward version pin; :893 rules come from
  the base ref; :1014 the proposal count never counts a could-not-run gate
  as zero; :1036-1053 a rule change is proposed, not refused, compared as
  parsed documents through one reader, and never a finding; :1296-1302
  proposals are notifications; :1310 the head-policy attacker script does
  not run; :2080 an off-pin gate does not run; :3638 coverage is a
  notification; :4593 advisory maps 1 to 0 and never touches 2; :5308 one
  run decides comment, token and exit code.
- Ruling: only a preview could-not-run is advisory; a primary could-not-run
  keeps exit 2 (:4593).

## 5. The decided how

1. Visibility. `cli.ts` writes, after the per-gate log lines, a
   `conductor: <count sentence>.` line and one `conductor: proposed
   <product> <line>` per proposal, through `breakWorkflowMarkers`. The
   gates step in `action.yml` copies the count line and the `proposed`
   lines from the text report to the step summary: whole fixed-shape lines
   only, in a fenced block, stopping at the preview header.
2. Per-key diff. New `src/policy-diff.ts`:
   `diffPolicies(base: Policy, head: Policy | null): PolicyKeyChange[]`.
   `policyForRun` also returns the parsed head policy. Each change is one
   conductor `ControlProposal`, `policy: gates.<role>.<key> <old> -> <new>`;
   an unparseable head is one line saying its changes are not known.
   `policyDiffers` stays as the fail-closed boolean, and with an empty diff
   the old `POLICY_PROPOSAL_LINE` is kept.
3. Preview. `RunOptions.preview?: { policy: Policy }`, set only when a
   change names a role; `RunResult.preview?: { gates: GateOutcome[];
   findings: Finding[]; skipped: SkippedGate[] }`, no exit code. Same
   invocation, after the primary run. The family gates run without
   `--trust-base` and read their own head control files; dep-guard keeps
   `--base`. gitleaks and osv-scanner keep the primary mechanics (history
   `base..HEAD`, config from the base): there the umbrella supplies
   pull-request mode, and selecting a head config for them would be the
   umbrella choosing a gate's rules. Head `command:` and `args:` are
   replaced by the base values (dropped where the base has none). PATH
   pinning, the node_modules skip and `refuseHeadControlledProgram` stay.
   Text gets a block after the verdict line headed
   `Preview under the proposed rules (does not affect the verdict)`; SARIF
   gets one note-level notification per preview gate and no results.

## 6. Left to the builder

- How the intent gate is prepared in the preview (head spec, change set
  from the base), within the program and version checks.
- Whether the `runAll` gate loop is extracted or parameterised.
