# One required check for agent-edited repos: program design

Date: 2026-09-26
Status: approved in conversation, awaiting written review
Scope: conductor, dep-guard, vault-guard, intent-guard, plus one public demo repo

## 1. Thesis

Conductor is the one required check for a repo edited by AI agents. It runs the
scanners a maintainer already trusts, and adds the checks those scanners cannot
do: a hallucinated package name, a key caught before the edit lands, a pull
request that edits its own gate, a change outside the approved contract.

Every item in this document is tested against that sentence. Anything that does
not serve it is out of scope, however reasonable it sounds on its own.

## 2. Why this program exists

### 2.1 What the evidence says

- Four public repos, zero external adopters. Every adopter to date is a seat
  inside the same org, so all product feedback so far is the org talking to
  itself.
- The day-one run (2026-09-26) reached a green required check in one sitting
  with no gate-repo fix, and two of three gates caught their planted canary.
  Verdict under the pre-stated rule: keep investing.
- Three internal adopter seats were asked directly whether they would delete
  their hand-rolled security job for one action at parity. All three said yes
  to that pitch and "not yet earned" to the current product.
- A parity matrix (2026-09-26, read-only, against the first adopter's real
  security workflow) found one of five rows covered: secrets in the working
  tree. Missing: full-history secrets, a lockfile blocklist of known-bad
  versions, a publish-age floor, and vulnerability matching.

### 2.2 What went wrong in planning

- The pitch changed three times in one day: gates for an empty repo, then
  replace your security job, then catches what your job misses. Each came from
  one new input.
- The morning program listed a vault-guard history mode. vault-guard's own
  scope document says history mining is out by design. Nobody checked before
  it went on the runway; the matrix caught it.
- The parity target was measured against a check that is nearly switched off:
  the adopter's publish-age script runs with a zero-day floor, so it blocks
  only future-dated publishes. Parity with production is trivial. The seven
  days another adopter asked for is the real target.
- A fail-open request (degrade the action's own errors to advisory) is the
  2026-09-22 incident with a new name. continue-on-error hid a crashed action
  for two days. The coupling worry behind the request is real, but this is
  the wrong fix.
- The 2026-09-22 audit said to stop adding adversarial controls because no org
  repo requires review on workflow edits. This program cites the base-ref
  trust boundary as a differentiator. Both hold only if the adversary is the
  agent, not a human attacker: a pull request that edits its own gate is
  drift, not an attack, and that is the original thesis.
- Two prerequisites were never on any list: dep-guard's tamper signals never
  run on a pull request at all (dep-guard #62), and `conductor init` writes a
  pre-commit hook unconditionally, which every CI-only adopter rejected.

### 2.3 Problems this family is for

There are two distinct problems and they overlap on two rows only.

1. An AI agent changes more than you asked. Drift, a wrong dependency
   hallucinated in, a key pasted into a file, tokens burned on a path nobody
   wanted. Nobody else builds for this. Its weakness is proof: on a healthy
   repo it finds nothing.
2. A maintainer already runs four scanners and wants fewer moving parts.
   History mining, vulnerability matching, cooling windows. Free, mature tools
   already solve this better than anything rebuilt here. Its strength is
   proof: a red check with a real finding is visible value.

The overlap is what an agent brings in (dep-guard's unknown-package and
typosquat rules) and what an agent lets out (vault-guard's tree scan). The
program builds only on the overlap and wraps the rest.

## 3. Decisions

These are settled. Reopening one requires a new spec, not a message.

1. **Could-not-run stays red.** No fail-open on the action's own errors.
   Reaffirms the 2026-09-22 decision. Coupling is answered by decision 2 and
   by the migration protocol in section 6, not by softening exit codes.
2. **Wrapped tools are pinned by the adopter, not by conductor.** The
   versions and checksums of external gates live in the repo's own policy
   file, so the adopter owns the upgrade cadence and one bad upstream release
   cannot block every repo at once.
3. **vault-guard's scope stands.** No history mode. Full-history secrets
   scanning comes from wrapping gitleaks as an external gate.
4. **No vulnerability scanner is reimplemented.** osv-scanner is wrapped.
   dep-guard #60 (npm audit advisories) is deferred, not closed.
5. **The README carries the thesis in section 1 and nothing else.** The
   day-one framing for empty repos is removed.
6. **The hook is opt-in.** `conductor init` does not write a pre-commit hook
   unless asked.
7. **No further adversarial hardening** until an external adopter exists.
8. **The throwaway day-one repo is deleted** once the public demo repo in
   section 5 exists and has replaced it as the reference run.

## 4. Build order

Each item is its own pull request. Items with a failure direction (anything
that can turn a red check green or a green check red) get test-first
development and an independent review by a different agent before merge.
Docs-only items get no review gate.

| # | Repo | Change | Closes | Review |
|---|------|--------|--------|--------|
| 1 | dep-guard | Accept a base ref in pull-request mode so tamper signals run on PRs. Small, and it blocks every demo. | #62 | yes |
| 2 | conductor | External gates: gitleaks in history mode and osv-scanner, each with version and checksum pinned in the policy file. A checksum mismatch or a missing binary is could-not-run. Findings map into the combined report and SARIF like any other gate. This item needs its own implementation plan. | new | yes |
| 3 | dep-guard | Minimum publish age, default seven days, measured per resolved version's registry publish time, with an allowlist; plus a configurable list of known-bad `name@version` pairs. | #58, new | yes |
| 4 | conductor | `init` writes no hook by default; a flag opts in. Second-clone behaviour documented. | #48 | yes |
| 5 | conductor | Job log line reports what ran, not a finding count when nothing ran. | #46 | small |
| 6 | conductor | README rewrite around the thesis, folding the day-one docs findings. | #43 #44 #45 #47 #49 #50 | no |

Ordering rationale: item 1 is a prerequisite for any pull-request demo of
dep-guard. Item 2 is the only piece that changes conductor's shape and is the
one that makes "replace your security job" true. Items 3 and 4 are the two
adopter conditions the family can meet without changing scope. Items 5 and 6
are docs and can run in parallel with anything after item 1.

Item 2 is the only item that needs a written implementation plan under this
spec. Items 1, 3, 4 and 5 are bounded changes to code that already exists and
get a short in-chat design each. Item 6 is docs.

## 5. Proof

A public demo repo under the org runs an ordinary gitleaks-plus-osv-scanner
security job beside conductor. Four planted pull requests, one per check in
the thesis, each left open so the two checks can be compared:

1. A dependency added under a name that does not exist on the registry.
2. A pull request that edits its own gate configuration.
3. A credential-shaped string added to a test fixture.
4. A change that touches paths outside the repo's intent contract.

Expected result: the ordinary job is green on at least three of the four,
conductor is red on all four. The README opens with that table and links to
the runs. The demo can start after item 1 using the gates that already work,
and gains rows as items 2 through 4 land.

The demo is the compelling artifact. It replaces the per-repo parity table
the adopters asked for with something stronger: a table of what their current
job misses.

## 6. Migration protocol

Applies to every adopter, internal or external.

1. Add conductor beside the existing security job with `advisory: true`.
2. Run both for at least two weeks on real pull requests.
3. Diff the two reports on every pull request. Record misses in both
   directions.
4. Delete the old job only on that evidence. Keep its configuration in the
   tree for one further release cycle.
5. After deletion, a canary pull request must turn the required check red on
   demand. Repeat the canary after every major version of a wrapped tool.

The first migration is the internal adopter whose security job was used for
the parity matrix. The other two internal adopters follow only after that one
has deleted its job.

## 7. Out of scope

- vault-guard history mode.
- Reimplementing OSV or npm audit matching inside dep-guard.
- Fail-open of any kind on the action's own errors.
- New adversarial controls against human attackers.
- Any change to the thesis outside a new spec.

## 8. Success and stop criteria

Decided in advance, in the same spirit as the day-one rule.

By the end of the quarter (2026-12-31):

- The first internal adopter has deleted its hand-rolled security job on the
  evidence in section 6.
- At least one repo outside the org has adopted conductor or filed an issue
  against any repo in the family.

If neither is true, that is the stop signal for further investment in the
family beyond maintenance.

## 9. Cost

Roughly eight to ten subagent dispatches across the quarter, never more than
two concurrently. Implementation on the mechanical seat, review on the
judgment seat, coordination and adjudication on the top seat only. Each item
in section 4 states its own cost before dispatch.

## 10. Open questions carried into the item 2 plan

- How a wrapped tool's findings map to conductor's severity model when the
  tool has no severity of its own (gitleaks reports match or no match).
- Whether the adopter's existing gitleaks and osv-scanner config files are
  read from the base ref like conductor's own policy, or from the head.
- How the policy file expresses a checksum per platform for a binary
  release.
- The "help with costs" intent from the original product brief is assumed to
  mean agent rework bounded by intent-guard's change budgets. If it meant
  something else, it is not served by this program and needs its own spec.
