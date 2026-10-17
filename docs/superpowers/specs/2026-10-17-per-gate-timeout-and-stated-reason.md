# Per-gate timeout, a timed-out reason, and the stated reason that names the cause

Date: 2026-10-17
Status: design, written before the code. Reviewed once (FIX ROUND: one
blocker, twelve non-blocking items, several of them rulings); this revision
applies all of them, listed in section 13. Line numbers are the tree at
5102d5e.
Scope: conductor only. Dogfood plan items 2.2 (policy schema and the
could-not-run path), 2.3 (the stated reason, reporting only) and 2.5 (docs).
Closes: F03 (a full-history gitleaks scan outlives a hard-coded limit and is
reported as a spawn failure with an unrelated warning beside it) and F07
(a could-not-run summary quotes an informational stderr line as the cause).

## 1. Rulings this design implements (not reopened here)

- Open question 3, option (a): a per-gate timeout knob in the policy, plus
  docs. REJECTED and not reintroduced anywhere below: conductor bounding a
  full-history run to a recent window, or applying any default size cap,
  because either silently narrows coverage. An adopter may narrow coverage
  on purpose through the existing passthrough (gitleaks'
  `max-target-megabytes`), and the docs state what that costs.
- The timeout lives OUTSIDE `options`, beside `enforce`, and on a pull
  request it is read from the base policy like every other key.
- A timeout is its own could-not-run reason, `timed-out`, and could-not-run
  stays red.
- 2.3 changes reporting only. The verdict, the exit code and the reason are
  decided before the stated reason is looked at, and stay so.
- Release shape: 2.2 is a minor change, 2.3 a patch-level change riding in
  the same pull request.

Constraints (AGENTS.md): the umbrella scans nothing, never writes a gate's
config, and every finding it raises is about a gate. None of the five
umbrella finding codes changes; a timed-out gate raises the existing
`conductor/gate-failed`.

## 2. What the code does today

Measured or read on 5102d5e:

- The limit is a profile constant: `timeoutMs` in `ProductProfile`
  (src/products.ts:40), 120_000 for the three family gates
  (src/products.ts:216), 600_000 for gitleaks (src/products.ts:245) and
  300_000 for osv-scanner (src/products.ts:280).
- `runGateInner` takes `options.timeoutMs ?? profileFor(gate.product).timeoutMs`
  (src/gate-runner.ts:1187). `RunGateOptions.timeoutMs`
  (src/gate-runner.ts:568) and `RunOptions.timeoutMs` (src/run.ts:229,
  forwarded at src/run.ts:582 and :632) exist, but nothing in src/cli.ts or
  src/policy.ts sets them: the `runAll` call at src/cli.ts:818-827 passes no
  limit. They are a test hook.
- The same value bounds the version probe (src/gate-runner.ts:967-971), the
  scan (src/gate-runner.ts:1704-1714) and, for osv-scanner on a compared pull
  request, the base run (src/gate-runner.ts:1948-1953). The intent gate's
  preparation spawns use their own `options.timeoutMs ?? 120_000`
  (src/intent-prepare.ts:609, spawned at :453-458).
- A version probe that times out returns null like any unreadable version
  (src/gate-runner.ts:972-974, called at :1330). On a pull request that is a
  `trust-base-unverified` refusal (src/gate-runner.ts:1378-1408); locally the
  gate runs with its version unknown.
- An intent preparation spawn that times out is `preparation-failed` with
  the spawnSync message as the detail (src/intent-prepare.ts:732-734 and
  :820-827, composed at src/run.ts:606-618).
- A spawnSync timeout sets `child.error`, and the runner labels every
  `child.error` `spawn-failed` with `child.error.message` as the detail
  (src/gate-runner.ts:1737-1748). The detail a reader sees is
  "spawnSync gitleaks ETIMEDOUT". That branch runs before any status check,
  which is the only reason a timed-out child that exited 0 is not read as a
  verdict today (section 6.1).
- The text report then prints the gate's whole stderr under the detail
  (src/output-text.ts:187-191). On a large repository gitleaks' first stderr
  lines are git's rename-detection warnings, so the only words on screen
  besides "ETIMEDOUT" are a warning that has nothing to do with the stop.
- `gateStatedReason` (src/gate-runner.ts:228-266) returns the first
  non-empty sanitized stderr line. It is called only on the gate-error
  branch, for a gate that exited with a code that is not a verdict
  (src/gate-runner.ts:1814-1817), and its value is stored only in
  `couldNotRun.gateSaid`.
- The gitleaks reserved list (src/policy.ts:154-165) is report-format,
  report-path, exit-code, log-opts, config, gitleaks-ignore-path,
  ignore-gitleaks-allow, redact, no-banner and log-level. `timeout` and
  `max-target-megabytes` are not on it, so both pass through today.
- On a pull request the policy is parsed from the base ref only
  (src/cli.ts:399 and :464-469). Section 5 has the detail.

Measured on the design machine against gitleaks 8.30.1, osv-scanner 2.4.0
and the family gates at the versions action.yml pins (dep-guard 0.11.1,
vault-guard 1.10.0, intent-guard 1.8.1, installed into a scratch prefix;
the first draft of this table used older globally installed builds and was
wrong for vault-guard), with a synthetic repository (twenty
commits, each adding a plain-text file of about 2 MB; the last one holds
one secret-shaped line) and a second one built to make git skip rename
detection (`diff.renameLimit` set to 1, six renamed files):

| observation | result |
|---|---|
| spawnSync `timeout` firing on gitleaks | `status` null, `signal` SIGTERM, `error.code` ETIMEDOUT, `error.message` "spawnSync gitleaks ETIMEDOUT"; returned at the limit; no report file existed afterwards; no gitleaks or git process left running |
| spawnSync `timeout` firing on `/bin/sh -c "...; /bin/sleep 5"` | returned at the limit with ETIMEDOUT and SIGTERM, although the orphaned `sleep` still held the inherited stderr, and the orphan kept running |
| a child that traps SIGTERM and exits 0 (clean JSON printed to stdout before the deadline, or `[]` written to a report file inside the trap) | `status` 0, `signal` null, `error.code` ETIMEDOUT; the stdout and the report file are both there and both clean (also reproduced in review) |
| a child that traps SIGTERM and exits 3 | `status` 3, `signal` null, `error.code` ETIMEDOUT |
| a child that ignores SIGTERM, then exits 0 two seconds later | `status` 0, `signal` null, ETIMEDOUT; spawnSync returned only when the child exited, after the limit, and never sent SIGKILL (review: a 1 s limit returned at 3.03 s) |
| a child that writes to stdout after the deadline | the output is lost: spawnSync closes its end of the pipes at the deadline. A shell or Go child is then killed by SIGPIPE (measured, shell); a Node child ignores SIGPIPE, gets EPIPE and can still exit 0 with the output gone (review). Either way only output written before the deadline, or to a file, survives |
| spawnSync `maxBuffer` exceeded | `status` null, `signal` SIGTERM, `error.code` ENOBUFS: the same signal as a timeout |
| gitleaks' own `--timeout 1`, `git` mode | exit 1 (with `--exit-code 3` passed); stderr "INF 9 commits scanned.", "ERR failed to scan Git repository error=\"context deadline exceeded\"", "WRN scanned ~23390042 bytes", "WRN partial scan completed in ...", "WRN no leaks found in partial scan"; the report file held `[]` |
| gitleaks' own `--timeout 1`, `dir` mode | exit 0, "no leaks found", 4.25 MB of 51.5 MB read, no warning |
| gitleaks' own `--timeout` with a leak found before the deadline (re-measured in the second review round: forty commits of about 2 MB, then a newest small commit holding a secret; `git --exit-code 3 --timeout 1 --log-level info` with conductor's log-opts) | exit 1, not 3; stderr "INF 10 commits scanned.", "ERR failed to scan Git repository error=context deadline exceeded", "WRN partial scan completed in 1.01s", "WRN 1 leaks found in partial scan"; the report file held one finding |
| gitleaks `--max-target-megabytes 1`, `git` mode, at `--log-level info` (the level conductor pins) | exit 0, no finding (the secret sits in a 2 MB file), "20 commits scanned", the full byte count reported, and no line naming any skipped file. At debug level gitleaks logs "skipping fragment" (found in review); `log-level` is reserved, so conductor never runs it at that level |
| gitleaks `--max-target-megabytes 1`, `dir` mode | exit 0, one "WRN skipping file: too large" line per file |
| git skipping rename detection under gitleaks | exit 0; the first two stderr lines are "WRN warning: exhaustive rename detection was skipped due to too many files." and "WRN warning: you may want to set your diff.renameLimit variable to at least 6 and retry the command." |
| an unknown `--timeout` flag, pinned versions | dep-guard 0.11.1 `scan`: "error: unknown option '--timeout'", exit 2. vault-guard 1.10.0 `scan`: same line, exit 2 (from 1.9.0 a usage error exits 2; the older build measured first exited 1). intent-guard 1.8.1 `check`: same line plus usage, exit 1, empty stdout. osv-scanner 2.4.0 `scan source`: "Incorrect Usage: flag provided but not defined: -timeout", exit 127 |
| vault-guard 1.10.0, exit 2 with one unreadable file (captured bytes, colour forced on) | stderr raw line 1: a colour code, a cross-mark emoji, "INCOMPLETE:", then "1 file(s) or target(s) could not be read and were not scanned". Raw line 2: colour codes only, empty after `stripAnsi`. Then the file path indented two spaces, the error and the exclude hint indented four, another colour-only line, and a closing paragraph whose raw lines start with a colour code and then three spaces. The leading whitespace is visible only after `stripAnsi` |
| gitleaks `--timeout-seconds` | "Error: unknown flag: --timeout-seconds", exit 126 |

Four of those rows change the design from the plan's sketch:

1. gitleaks has a real `--timeout` flag, in seconds. `options.timeout` on the
   secrets-history gate is therefore not an unknown flag: it is gitleaks'
   own deadline, it works today, and in `git` mode (the only mode conductor
   runs, src/resolve.ts:129) it fails closed, exit 1 and an ERR line, which
   the runner already reads as could-not-run.
2. `max-target-megabytes` in `git` mode drops a large file without one log
   line. The coverage trade-off has to be stated as "silently", not as "with
   a warning".
3. ENOBUFS and ETIMEDOUT both arrive with SIGTERM, so a timeout is detected
   by the error code, never by the signal.
4. A timed-out child can come back with `status` 0, `signal` null and a
   clean report or clean stdout. The error code is the only field that says
   the deadline passed; `status` and `signal` say nothing reliable on a
   timeout, so nothing on the timed-out path may read them as a verdict.

No timing in the table is reported here as a number about a real
repository. The synthetic scans ran on a machine doing other work, and the
cost model in section 9 makes no numeric claim for that reason.

## 3. Item 2.2: the policy key

### 3.1 Name and placement

    secrets-history:
      product: gitleaks
      stage: ci
      enforce: true
      timeout-seconds: 1800
      options: {}

- Name `timeout-seconds` (open point 1: the plan wrote `timeout`). The unit
  is in the name for the same reason the Actions key is `timeout-minutes`,
  and because measurement 1 above means `options.timeout` on the same gate
  is gitleaks' own deadline, also in seconds. `timeout` beside `enforce`
  and `timeout` under `options` would be two keys with one spelling and
  different effects, one line apart. If the operator keeps `timeout`, every
  rule below holds with the key renamed, and section 4.2 becomes more
  important, not less.
- Gate level, beside `enforce` and `present-on-base`, never under
  `options`: options are a pure passthrough (src/policy.ts:22-29), and this
  is the umbrella's own setting.
- Every gate accepts it. The limit applies to every product, unlike
  `present-on-base`, which only the vulnerabilities gate can act on
  (src/policy.ts:445-452).

### 3.2 Type, unit and bounds

An integer number of seconds, at least 10 and at most 21600.

- Integer seconds, not milliseconds and not a duration string: the policy is
  read by people, the umbrella's other limits in docs are stated in seconds
  or minutes, and a string format (`10m`) is a parser this package would
  have to own. YAML `600.0` validates as an integer under Ajv; a quoted
  `"600"` does not.
- Floor 10 (RULED in review, stays). The same value bounds the version
  probe (src/gate-runner.ts:967-971). A limit of one or two seconds can kill
  the probe of a cold-started Node gate, and a probe that times out is now
  itself `timed-out` (6.5), so a too-small limit would stop the gate before
  it ever scanned. Ten seconds is above any probe and below any scan budget
  anybody means.
- Ceiling 21600, six hours (RULED, stays). A GitHub-hosted job is cancelled
  at six hours; a larger limit could never fire there, and the run would end
  as a cancelled job with no report rather than as `timed-out` with
  remedies. Even 21600 itself cannot fire on a hosted runner: the job's six
  hours also hold checkout, setup and the other gates, so a gate given the
  whole ceiling is cancelled with the job first. The docs say a hosted
  workflow should stay well under it. On a self-hosted runner, where jobs
  may run longer, six hours of one gate is still not a decision this tool
  should help anybody make by accident.
- The bounds are schema facts, so an editor pointed at the schema shows
  them.

### 3.3 Absent key, and no policy-level default

Absent means the profile value for that product, exactly as today: 120 s
for dep-guard, vault-guard and intent-guard, 600 s for gitleaks, 300 s for
osv-scanner. No existing policy changes behaviour on upgrade.

No `timeout-seconds` at the top level or under `report`. The five products
differ in cost by orders of magnitude: the family gates take under a second
on a staged commit, a gitleaks full-history scan grows with history. One
shared default would either hold a hung family gate for as long as a
history scan needs, or cut the history scan to what a family gate needs.
That is the same argument as "there is no shared severity threshold"
(src/policy.ts:13-20), and the schema already refuses unknown top-level
keys (schema/guardrails.schema.json:7).

### 3.4 Precedence

`RunGateOptions.timeoutMs` (the test hook, set by no CLI path) first, then
`gate.timeoutSeconds * 1000`, then the profile value. ONE resolver computes
this (RULED in review): `resolveTimeLimit(gate, override)` in
src/gate-runner.ts, returning `{ ms, source }` with `source` one of
`override` (the test hook), `policy` or `default`. It replaces the
expression at src/gate-runner.ts:1187, and run.ts calls the same function
for the intent preparation (src/run.ts:576-585) instead of forwarding
`options.timeoutMs`. `prepareIntent` has that one caller, so
`IntentPrepareOptions.timeoutMs` (src/intent-prepare.ts:212) becomes
REQUIRED and the `?? 120_000` fallback at src/intent-prepare.ts:609 is
deleted: the type checker then enforces that the preparation's limit comes
from the resolver and nowhere else. The precedence is written once. The
result is carried on the
outcome as `timeLimit: { ms, source }`, so the report and the timed-out
message never need the policy file, as with `enforce`.

What the resolved value bounds, and every spawn gets the FULL limit, not a
share of it:

- Every gate: the version probe and the scan.
- The intent gate on a prepared run: the version probe, then import-spec,
  freeze and check, each with the full limit (src/intent-prepare.ts:719-730
  and :799-818 for the first two).
- osv-scanner on a compared pull request: the version probe, the head run
  and the base run (src/gate-runner.ts:1948-1953). A base-run timeout makes
  the comparison unavailable, never could-not-run
  (src/gate-runner.ts:1958-1963), and that is unchanged.
- Not the umbrella's own git calls. Those are not the gate.

So the wall time one gate can take is the limit times its number of spawns,
plus the SIGTERM slack in 6.1. The docs say "every spawn of the gate gets
the full limit", not a number of spawns.

### 3.5 Code

- schema/guardrails.schema.json, `$defs.gate.properties` (lines 42-90, the
  object is `additionalProperties: false` at :40): add `timeout-seconds`,
  `"type": "integer", "minimum": 10, "maximum": 21600`, with a description
  naming the unit, the bounds, the per-product default and the base-ref
  rule.
- src/policy.ts, `GatePolicy` (lines 174-213): add `timeoutSeconds?: number`,
  set by `parsePolicy` (lines 463-483) only when the key is present.
- src/gate-runner.ts:1187: `resolveTimeLimit` (3.4), also called from
  src/run.ts for `prepareIntent`.
- src/products.ts: `timeoutMs` stays and keeps its values; the comment at
  :243-244 gains "the default when the policy sets no timeout-seconds".
  A new profile field, `timeoutRemedies: (role: GateRole) => string`, holds
  the per-product remedy sentence of 6.2.

## 4. Validation

### 4.1 An invalid value

Out of range, not an integer, a string, or `null`: the schema check in
`parsePolicy` (src/policy.ts:405-408) fails and `describeErrors`
(src/policy.ts:265-278) names it, for example
`/gates/secrets-history/timeout-seconds must be <= 21600`. That is a
`PolicyError`, which the run command prints as one line on stderr and turns
into exit 2 (src/cli.ts:922-926). It is never a pass:

- Local run or push: exit 2, no report. The Action's verdict for a non-zero
  exit with no readable token is `could-not-run` (action.yml:1179-1198).
- Pull request with the invalid value on the BASE: every pull request exits
  2 until the base is fixed. That is the existing behaviour for every
  invalid key and the fail-closed direction.
- Pull request with the invalid value only on the HEAD: the head policy is
  never schema-checked on a pull-request run (section 5); it is a policy
  proposal in the report. The push run after merge reads it and goes red.
  Same as every other key today; stated in the docs, not changed here.

No additional semantic check beyond the schema: the bounds are the whole
rule.

### 4.2 `timeout` and `timeout-seconds` under `options`

Two additions to `RESERVED_OPTIONS` (src/policy.ts:123-170), each with its
own `reservedReason` sentence (src/policy.ts:294-337):

- `timeout-seconds` is reserved under `options` for all five products. No
  tool has the flag (gitleaks exits 126 on it, measured; the family gates
  and osv-scanner reject unknown flags the way the table shows), so no
  working policy can contain it, and the only way to write it there is to
  mean conductor's key in the wrong place. Reason: "timeout-seconds is
  conductor's own limit for this gate. Set it beside enforce, as
  gates.<role>.timeout-seconds, not under options."
- `timeout` is reserved under `options` for dep-guard, vault-guard,
  intent-guard and osv-scanner (RULED in review, on clarity grounds). All
  four reject `--timeout` at the pinned versions (measured: exits 2, 2, 1
  and 127), so no working policy breaks. Without the reservation the run is
  could-not-run, but the reader is told something other than "you set
  conductor's limit in the wrong place": dep-guard and vault-guard are
  gate-error with "gate said: error: unknown option '--timeout'", which
  reads as a tool rejecting a flag rather than as a misplaced conductor
  setting; osv-scanner is gate-error with "Incorrect Usage: flag provided
  but not defined: -timeout"; and intent-guard exits 1 with empty stdout,
  which the runner reports as `unparseable-output`, "a rejected config file
  looks exactly like this" (src/gate-runner.ts:1891-1895), with no stated
  reason at all. Reason: "this gate has no --timeout flag; conductor's own
  limit is gates.<role>.timeout-seconds, beside enforce."
- `timeout` is NOT reserved for gitleaks. It is gitleaks' own flag, it
  works, and in `git` mode it fails closed (measured: exit 1, an ERR line,
  read as gate-error). Reserving it would refuse policies that pass it
  today, which the reserved-list comment rules out for a standing document
  (src/policy.ts:124-130). It stays a passthrough, and two things make it
  legible:
  - A note, `conductor/option-is-gate-own`, whenever
    `gates.secrets-history.options.timeout` is set: "options.timeout is
    gitleaks' own --timeout (N s); conductor stops the gate at M s
    (gates.secrets-history.timeout-seconds, or the default)." It lives on
    the OUTCOME, as a new optional field `gateOwnOption` assigned onto
    `progress` before the spawn, the way `nodeModulesSkipped` is
    (src/gate-runner.ts:1194-1198), so every return path from there on
    carries it. Not in `run.diagnostics`: every could-not-run outcome
    carries `EMPTY_RUN` (src/gate-runner.ts:1745, :1831), so a run note
    would vanish on exactly the outcome that needs it, the gate-error that
    gitleaks' own deadline produces. The text report prints it under the
    gate header and SARIF carries it as a notification. Like a run note,
    it does not by itself push a clean run off its one-line summary.
  - The timed-out message (6.2) repeats the same sentence when the key is
    set.

What the reservations do not cover (stated so nobody reads them as a
boundary): they match exact `options` keys only. `args` beside `command`
(src/policy.ts:478, schema/guardrails.schema.json:70-74) can still carry a
literal `--timeout`, and a `no-timeout: true` key (or `timeout: false` on
gitleaks, where `timeout` stays a passthrough) renders `--no-timeout`
(src/policy.ts:578-584), which no tool accepts, so that run is
could-not-run with the tool's own rejection. On a pull request only the
base policy is read (section 5), so none of this is reachable from the
pull request; it is a clarity measure for the policy author, not a trust
control.

The reserved-without-writing drift test in tests/policy.test.ts holds that
list to exactly two entries (format on vault-guard, base on intent-guard;
src/policy.ts:280-293). It gains a second, separately named allowlist:
"reserved because the key names conductor's own setting", holding exactly
the nine entries above, so a further entry still has to say why.

Open point 2 covers the alternative of not reserving `timeout` at all.

## 5. Trust base

On a run with `--trust-base`, `policyForRun` reads the base copy and the
head copy through `readFileAtRef` (src/cli.ts:399-400). Only the base text
is parsed into a `Policy` (src/cli.ts:464-469). The head text goes to
`policyDiffers` (src/cli.ts:474), which compares parsed YAML and never
builds a `GatePolicy` (src/trust-base.ts:671-683). On every refusal path the
head is parsed by `inventoryFromHead` (src/cli.ts:332-338), and those gates
are reported as not run by `refusedTrustBase` (src/run.ts:382) and never
spawned. So no path hands the head's `timeout-seconds` to a spawn.

What that means, stated in the docs:

- A pull request cannot raise, lower or remove its own gates' limits. A
  head-side edit is a policy proposal, reported like any other.
- A base policy with a short limit is the base's decision. A pull request
  that times out under it is red, and the fix is on the base branch.
- Push, schedule and local runs read the working-tree policy
  (src/cli.ts:375), which on a push or schedule is the commit being built.
- The pre-commit hook runs `conductor run --staged --stage commit`
  (src/init.ts:185) without a trust base, so it reads the working tree, as
  for every key.

The implementer adds no new policy read. A test (8.2, T7) proves the head
value never reaches spawnSync.

## 6. Detection and output

### 6.1 Telling a timeout from other spawn errors

In the `child.error !== undefined` branch (src/gate-runner.ts:1737-1748),
which must stay the FIRST thing read after spawnSync returns, ahead of
every status, signal, report or stdout check:

- `(child.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'` is
  `timed-out`. Nothing else is. The branch tests the error code alone: no
  `status === null` or `signal !== null` condition may be added to it,
  because a child that traps SIGTERM, or ignores it and exits on its own,
  comes back with `status` 0 (or its blocked code) and `signal` null
  (measured, section 2). The signal is recorded for the report, may be
  null, and is never used to classify: ENOBUFS arrives with the same
  SIGTERM.
- The outcome's `exitCode` is forced to null on the timed-out path,
  whatever `child.status` says. A status from a child that was told to stop
  is not a verdict, and carrying it would let a reader (or a later change
  to the composition) treat a timed-out 0 as clean or a timed-out blocked
  code as a block.
- Every other code (ENOENT, EACCES, ENOBUFS, anything new) stays
  `spawn-failed`, unchanged, and keeps the same position before any status
  check.
- The `exitCode === null` branch without an error (src/gate-runner.ts:1806-1810),
  a child killed by somebody else, keeps `gate-error`, and its detail drops
  "or timed out": "the gate was killed by signal SIGKILL before it exited."
  A timeout no longer lands there.

The classification is a pure function, `spawnFailure(child)`, returning
`{ reason: 'timed-out' | 'spawn-failed', ... }`, so it can be tested on
hand-built results.

Elapsed time is measured around the timed-out spawnSync itself
(`spawnStarted` taken just before the call), not from `started`, which
includes resolution and the version probe. The message prints the limit
and the elapsed time, rounded to whole seconds, and never claims they are
equal, because they need not be:

- The limit is a SIGTERM deadline, not a hard bound. spawnSync sends
  SIGTERM at the limit and then waits for the child to exit; it never
  escalates to SIGKILL. A child that ignores SIGTERM keeps the run blocked
  until it exits on its own (measured: a 1 s limit returned at 3.03 s in
  review, and a 0.5 s limit at 2 s here). Known-open, documented; this
  design adds no escalation.
- A stopped gate's own children are not killed (RULED in review: a
  documented limit for 0.10.0, not a code change). spawnSync has no
  detached option, so a process-group kill would mean an async spawn and
  signal forwarding through the hook, and Windows would need taskkill.
  Measured: gitleaks left no git process behind; a shell stub's orphaned
  `sleep` kept running after spawnSync returned. So a gate behind a
  shell-wrapper `command` can keep running after it is reported
  `timed-out`. README line and INVARIANTS known-open entry in sections 9
  and 10.

### 6.2 The `timed-out` reason

`CouldNotRunReason` (src/gate-runner.ts:76-127) gains `timed-out`, with a
comment. It joins `CONDUCTOR_OWN_REASONS` (src/gate-runner.ts:191-197), whose
comment is widened from "made before the gate was spawned (or instead of
spawning it)" to "or the umbrella stopping it", so the job-log line carries
"conductor said:" with the detail (src/output-text.ts:603-613).

`couldNotRun` for a timeout:

    { reason: 'timed-out',
      detail: <the sentence below>,
      timedOut: { step: 'version-probe' | 'scan' | 'import-spec' | 'freeze',
                  limitSeconds, elapsedSeconds,
                  limitSource: 'override' | 'policy' | 'default',
                  signal: string | null } }

and on the outcome `exitCode: null` whatever the child's status was (6.1).
`signal` is whatever spawnSync reported and is null when the child handled
SIGTERM and exited on its own.

No `gateSaid`: the gate did not state a reason, it was stopped. The existing
test "carries none when the gate timed out" (tests/gate-runner.test.ts:1753)
keeps holding.

Detail, gitleaks shape (the remedy sentence comes from the profile):

    gitleaks was stopped after 600 s, at its 600 s limit (the default for
    this gate), so nothing was checked by it. Raise the limit with
    gates.secrets-history.timeout-seconds in .guardrails.yaml (on a pull
    request, on the base branch). A history scan grows with the repository's
    history and the size of what was committed: scan full history on a
    schedule and let pull requests scan only their own range, or pass
    max-target-megabytes under options, which skips every file larger than
    the cap without saying which, so a secret in such a file is not found.

With `limitSource` `policy`, "(the default for this gate)" becomes
"(gates.secrets-history.timeout-seconds on <ref>)" on a pull request and
"(gates.secrets-history.timeout-seconds)" otherwise.

Remedy sentences per product:

- gitleaks: as above.
- osv-scanner: raise the limit; osv-scanner queries osv.dev over the network,
  so a slow or unreachable service shows up as a timeout too.
- dep-guard, vault-guard, intent-guard: raise the limit; a family gate that
  needs more than two minutes is unusual, so the gate's own output below is
  worth reading first.

No remedy may name a bounded history window or a default cap (the ruling).

### 6.3 A partial report is never read

The timed-out return sits in the `child.error` branch, which returns before
the exit code is judged, before the report file is opened (the read is at
src/gate-runner.ts:1862-1878) and before stdout is parsed. Nothing on the
timed-out path calls `readFileSync` on the report path, `JSON.parse` on
stdout, or a normalizer. That matters most for the child that handled
SIGTERM: it can exit 0 with a complete, valid, clean report (gitleaks `[]`)
or clean JSON already on stdout (measured), and only the branch order keeps
that from reading as a pass. gitleaks itself, killed, wrote no report
(measured), but nothing relies on that. The report path is inside a fresh
`mkdtemp` per gate run (src/gate-runner.ts:1436-1439), so no earlier report
can be there, and the work directory is removed in the `finally`
(src/gate-runner.ts:1454-1458) on every path. The osv scan and the family
gates have no report file; their stdout is ignored on this branch the same
way.

gitleaks' own `--timeout` (the passthrough) is different and needs no new
code. When its deadline fires gitleaks exits 1 whether or not it found a
leak first (measured with no leak here, and with a leak in the second
review round; section 2). Under conductor's `--exit-code 3`, 1 is neither
clean nor blocked, so the run takes the gate-error branch, which returns
before the report is read (src/gate-runner.ts:1805-1834): could-not-run in
both cases, fail-closed, and the stated reason (7.1) picks the ERR "context
deadline exceeded" line. The cost runs the other way: when gitleaks did
find leaks before its deadline, they are never shown, because the report
is not read; the only trace is the echoed stderr line "WRN N leaks found
in partial scan". Recorded as known-open and stated in the README next to
`options.timeout`. Not changed here: reading a report on a could-not-run
path would turn an error exit into a source of findings, which this design
does not add.

### 6.4 Every surface

| surface | what changes | where |
|---|---|---|
| text report, gate header | `DID NOT RUN (timed-out)` | src/output-text.ts:105-106, no code change |
| text report, detail | the 6.2 sentence | src/output-text.ts:183 |
| text report, stderr echo | unchanged, preceded on timed-out only by `    (printed by the gate before it was stopped; not the reason it stopped)` | src/output-text.ts:187-191 |
| job log line on stderr | `could-not-run (timed-out), ... conductor said: "<detail, capped>"` | src/output-text.ts:589-614, through CONDUCTOR_OWN_REASONS |
| --verbose | the gate header of a gate that RAN gains `limit 1800s (policy)` when the limit came from the policy; nothing for a default | src/output-text.ts:108-109 |
| SARIF | the existing `conductor/gate-failed` result, message from `normalizeFailedGate` (src/normalize.ts:1458-1473) carrying the detail; its details bag gains `timedOut` (limitSeconds, elapsedSeconds, limitSource); the gate-not-enforced notification names `timed-out` (src/output-sarif.ts:963, :977) | no new rule id |
| verdict token | `could-not-run` for an enforced gate; `enforce: false` makes it a note exactly as for any other could-not-run | src/exit-codes.ts, no change |
| Action step summary | unchanged: it prints the token only (action.yml:1204-1206), and the token is `could-not-run`; the reason is in the job log line | no change |
| pull-request comment | the posted text report, so it carries the detail and the remedies | no change |
| pre-commit hook | exit 2, and the hook prints its "could not run" message, not "blocked" | src/init.ts:184-191, no change |

Open point 4 covers adding the reason to the step summary.

### 6.5 The version probe and the intent preparation (RULED in review)

Both become `timed-out`, through the same `spawnFailure` classifier, with
`timedOut.step` saying which spawn was stopped.

The version probe. `probeVersion` (src/gate-runner.ts:957-983, called at
:1330) today folds a timeout into `null`, an unreadable version. It
returns a tagged result instead: `{ kind: 'version', value }`,
`{ kind: 'unreadable' }`, or `{ kind: 'timed-out', elapsedMs, signal }`
when the probe's `error.code` is ETIMEDOUT (any status, as in 6.1). On
`timed-out` `runGateInner` returns at once, before the version floor and
before `decideTrustBase` (src/gate-runner.ts:1346-1409): reason
`timed-out`, step `version-probe`, detail "the version probe of <product>
was stopped at <N> s (<source>), so the gate was not run and nothing was
checked by it", findings `conductor/gate-failed`. This closes two wrong
readings: on a pull request it is no longer reported as
`trust-base-unverified` (a packaging problem that does not exist), and
locally a timed-out probe no longer lets the gate run with its version
unknown. On a run with a trust base the outcome is enforced whatever the
policy says, the same rule `trust-base-unverified` follows
(src/gate-runner.ts:1386-1397), since the gate could not be placed inside
the boundary; on a local run `enforce` is respected.

The intent preparation. src/intent-prepare.ts `run` (lines 447-465) gains
an `errorCode` on its `ChildResult` beside `errorMessage`. Where import-spec
(src/intent-prepare.ts:732-734) and freeze (:820-827) return
`{ kind: 'failed' }` for a spawn error, an ETIMEDOUT code returns
`{ kind: 'timed-out', step, elapsedMs, signal }` instead, checked before
the status like 6.1. run.ts (src/run.ts:606-618) maps it to a timed-out
outcome (a new `preparationTimedOut(gate, ...)` beside `preparationFailed`)
under the same enforce rule `preparationFailed` already has there: enforced
under a trust base, the policy's value otherwise. The limit is the intent
gate's resolved limit from 3.4.

## 7. Item 2.3: the stated reason names the cause

### 7.1 The rule

`gateStatedReason(stderr, stdout, stdoutIsJson)` keeps its signature and its
totality (the try/catch at src/gate-runner.ts:233-265). Its stderr half
becomes:

1. Split `stripAnsi(stderr)` into raw lines. Sanitize each with
   `sanitizeGateSaid` (non-ASCII to spaces, collapsed, trimmed). Blank
   lines are kept in place: they are never chosen, but they end a note
   block and are skipped inside a marker block (step 2 and 3). Marker
   matching is done on the sanitized text, so a leading emoji or colour
   code does not hide a marker.
   A line is BLANK when it is empty or whitespace-only after `stripAnsi`,
   so a carriage-return-only line from CRLF output is blank. Whitespace
   tests ("begins with whitespace", "blank") are made on the line after
   `stripAnsi` and before sanitizing: in the captured
   vault-guard bytes the closing paragraph's raw lines start with a colour
   code and only then with spaces, and the separator lines hold colour
   codes and nothing else.
2. Mark informational lines, which are never chosen:
   - A note block: a line whose sanitized text starts with `note:`
     (case-insensitive), plus every following line that begins with
     whitespace, up to the first line that does not. A BLANK line ENDS the
     note block (RULED in review), so an indented real reason after a blank
     line is never swallowed into a note. vault-guard's upgrade notice is a
     `note:` line and two indented continuation lines (vault-guard
     packages/cli/src/commands/scan.ts:733-744, "      This run would have
     failed before. ..."); skipping only the first line would quote the
     continuation.
   - The gitleaks rename-detection warnings, matched as a zerolog WRN line
     (`^\S+\s+WRN\s`) whose text contains `rename detection was skipped`
     or `diff.renameLimit` (the two measured lines in section 2).
3. Prefer a marker. The first remaining line that is either an INCOMPLETE
   marker (sanitized text starts with `INCOMPLETE:`) or a zerolog ERR line
   (`^\S+\s+ERR\s`, the same pattern as gitleaks' `stderrError`,
   src/products.ts:262) is the start of the block. The excerpt is that line
   joined, with single spaces, to the lines after it that begin with
   whitespace, SKIPPING blank lines (RULED in review) and stopping at the
   first non-blank line that does not begin with whitespace, then capped at
   GATE_SAID_MAX_CHARS (src/gate-runner.ts:144) as today. vault-guard
   writes INCOMPLETE through `console.error` with a trailing newline in the
   text, so a blank line sits between it and the indented file lines
   (vault-guard packages/cli/src/commands/scan.ts:137-143, and the captured
   bytes in section 2); without the skip the block would end at the count.
   The file lines are joined in, and the cap cuts the result inside them.
4. No marker: the first remaining line, as today.
5. Nothing remaining (every line informational, or stderr empty): no stderr
   excerpt, and the existing stdout `reason` fallback runs unchanged. An
   absent "gate said" is better than quoting a warning as the cause; the
   full stderr is still printed under the detail in the text report.

Applied for every product. The markers are specific enough that a family
gate's real reason is never a note or a rename warning, and the ERR and
INCOMPLETE preference only moves the excerpt toward the line a gate marks
as the failure.

Examples, from the cases above:

- vault-guard 1.10.0 exit 2, captured bytes from section 2: "INCOMPLETE:
  1 file(s) or target(s) could not be read and were not scanned
  sub/locked.txt Error: EACCES: permission denied, open '<path>..." (capped
  at 160). With the upgrade note printed first (the note fires only when
  findings exist, none blocks and no threshold was set): today the note
  line, after the same INCOMPLETE excerpt. The note-plus-INCOMPLETE stderr
  was not reproduced on the design machine (the scan produced no finding
  to trigger the note); the implementer captures it from vault-guard
  1.10.0 for T14, or builds that case from the note's source lines and
  says so in the fixture.
- gitleaks exit 1 from its own deadline: today "<time> INF 9 commits
  scanned.", after "<time> ERR failed to scan Git repository
  error='context deadline exceeded'".
- gitleaks exit 1 whose stderr starts with the two rename warnings and has
  no ERR line: the first line after them.

### 7.2 Proof the verdict is untouched

- The function's only caller is the gate-error branch, after the exit code
  and the reason are decided (src/gate-runner.ts:1805-1817), and its result
  is stored only in `couldNotRun.gateSaid`.
- The only readers of `gateSaid` are the text report and the job-log line
  (src/output-text.ts:184-185, :605, :612). exit-codes.ts, run.ts and the
  verdict token never read it.
- The stderrError check for a clean exit that logged an error
  (src/gate-runner.ts:1842-1860) has its own `.find` over the raw lines and
  is not changed: a skipped informational line is skipped for the excerpt
  only.
- Test T15 pins both: a source-text check that `gateSaid` appears in no
  decision module, and an equivalence check that the outcome minus
  `gateSaid` is identical with the old and the new rule.

## 8. Test plan

Unit tests use the stub gate (tests/helpers/stub-gate.ts) and the spawnSync
spy in tests/gate-runner-timeout.test.ts, which records the `timeout` each
spawn receives without changing behaviour. Each test names the mutation it
must kill; the implementer runs every listed mutation and shows it red.

### 8.1 Schema and validation

T1. Accepts `timeout-seconds` of 10, 600 and 21600 on each of the five
    gates; `parsePolicy` sets `timeoutSeconds`. Rejects 9, 21601, 0, -5,
    600.5, "600" and null, each with a `PolicyError` naming
    `timeout-seconds`. Kills: dropping the minimum, the maximum, or the
    integer type.
T2. Absent key: `timeoutSeconds` is undefined, and the existing three tests
    in tests/gate-runner-timeout.test.ts still see 300_000 and 120_000; a
    new one sees 600_000 for gitleaks. Kills: a non-undefined default in the
    parser.
T3. ADVERSARIAL, a policy that sets the timeout under options:
    `options: { timeout-seconds: 900 }` on each gate, and
    `options: { timeout: 900 }` on dep-guard, vault-guard, intent-guard and
    osv-scanner, are each refused at parse time with the 4.2 sentence and
    exit 2 from the CLI; `options: { timeout: 900 }` on gitleaks parses, the
    spy sees `--timeout 900` in gitleaks' argv and conductor's own limit at
    600_000, and the `conductor/option-is-gate-own` note is on the outcome.
    Then the same gate with a gitleaks stub that exits 1 with the measured
    own-deadline stderr (the ERR "context deadline exceeded" line): the
    outcome is gate-error AND still carries the note, in the text report
    and in SARIF. Kills: removing either reservation; reserving `timeout`
    for gitleaks; the note firing without the key; the note living in
    `run.diagnostics`, where the gate-error's `EMPTY_RUN` drops it.
T4. The reserved-without-writing drift test: the second allowlist holds
    exactly the nine entries. Kills: a tenth entry without a reason.
T5. CLI: an invalid `timeout-seconds` in the working-tree policy exits 2
    with one stderr line and no stdout report; the same value only in the
    head of a pull-request run leaves the run on the base policy and
    reports a policy proposal. Kills: reading a policy error as exit 0.

### 8.2 Precedence and the trust base

T6. Policy `timeout-seconds: 45` on vault-guard: the spy sees 45_000 on the
    probe and the scan; with `RunGateOptions.timeoutMs` 5_000 as well, 5_000
    wins. Kills: ignoring the policy; the test hook losing precedence.
T7. ADVERSARIAL, a head policy that raises the timeout on a pull-request
    run: a temporary repository whose base commit has
    `secrets-history: timeout-seconds: 10` and whose head commit has 21600,
    run through the CLI path (`policyForRun` then `runAll`) with
    `--trust-base` set to the base. The spy sees 10_000 on gitleaks' scan,
    never 21_600_000, and the report lists the policy change as a proposal.
    Repeat with the key present only on the head (base absent): 600_000.
    Kills: building the policy from the head text; merging head keys into
    the base policy.
T8. Intent preparation: an intent policy with `timeout-seconds: 30` makes
    the probe, import-spec, freeze and check spawns each see 30_000 (the
    full limit, not a share). A unit test of `resolveTimeLimit` covers the
    three sources, and a source-text test finds no other expression that
    computes a gate limit from `timeoutMs` and `timeoutSeconds`. The
    120_000 fallback is caught by the type checker, not by this test:
    `IntentPrepareOptions.timeoutMs` is required (3.4), so `pnpm typecheck`
    fails if the fallback or an optional field comes back. Kills: a second
    precedence computation in run.ts; the preparation spawns not seeing the
    policy value.
T9. osv base run: on a compared run the spy sees the policy value on the
    base spawn too. Kills: a base run on the profile constant.

### 8.3 Detection

T10. `spawnFailure` on hand-built results: ETIMEDOUT with status null and
     SIGTERM is `timed-out`; ETIMEDOUT with status 0 and signal null is
     `timed-out`; ETIMEDOUT with status 3 and signal null is `timed-out`;
     ENOBUFS with SIGTERM, ENOENT and EACCES are `spawn-failed`; a result
     with no error is not classified. Kills: classifying by signal (ENOBUFS
     goes red); requiring a null status or a non-null signal for a timeout
     (the status-0 case goes red).
T11. Real spawn: a stub that prints the two measured rename-warning lines to
     stderr and sleeps, run with `RunGateOptions.timeoutMs` 300: reason
     `timed-out`, `exitCode` null, `limitSource` `override`, the detail
     names the limit and the remedies, `gateSaid` is absent, and the text
     report shows the "not the reason it stopped" line above the echoed
     warnings. The test hook is what lets this run below the 10 s floor
     without waiting; T6 and T7 prove the policy value reaches the same
     spawn. Kills: the old spawn-failed label; a remedy-free message;
     dropping the echo caption.
T12. ADVERSARIAL, a timed-out child with a partial, or a complete, report.
     Two groups of stubs, run with `RunGateOptions.timeoutMs` of a few
     hundred milliseconds. That limit also bounds the version probe, so
     every stub answers `--version` at once, and every variant asserts
     `timedOut.step` is `scan`. A `/bin/sh` stub defers a TERM trap until
     a foreground `sleep` finishes, so shell stubs wait with
     `sleep N & wait $!`, or the stubs are Node scripts.
     Killed by SIGTERM: a gitleaks stub that writes
     `[{"RuleID":"generic-api-key", ...` truncated mid object to the
     `--report-path` it was handed, and a variant that writes a complete,
     valid one-finding report, then sleeps past the limit; an osv stub that
     prints valid JSON with one vulnerability to stdout, then sleeps.
     Handling SIGTERM (the shapes measured in section 2): a gitleaks stub
     that traps SIGTERM, writes a complete clean `[]` report in the trap and
     exits 0; a vault-guard stub and an osv stub that print complete clean
     JSON to stdout BEFORE the deadline (output written after it is lost,
     because spawnSync closes the pipes), trap SIGTERM and exit 0; a
     gitleaks stub that traps SIGTERM, writes a valid one-finding report and
     exits 3, the blocked code; and stubs that ignore SIGTERM and exit 0 a
     moment after the limit, one having printed clean JSON to stdout before
     the deadline and one (gitleaks) having written a clean `[]` report, so
     each still hands the runner something parseable.
     Every variant: reason `timed-out`, outcome `exitCode` null, no finding
     from a normalizer (the only finding is `conductor/gate-failed`), run
     exit 2, and the work directory is gone afterwards. Kills: moving the
     report read or the stdout parse above the error branch; moving
     `spawnFailure` below the exit-code checks (the trap-and-exit-0 stubs
     read as a pass, the exit-3 one as a plain block); adding a
     `status === null` or `signal !== null` condition to the error branch
     (same); carrying `child.status` onto the outcome; any normalizer call
     on this path; removing the `finally`.
T12a. Probe and preparation (6.5), same stub rules as T12: a stub whose
     `--version` sleeps past the limit gives `timed-out`, step
     `version-probe`, and the scan is never
     spawned (the spy sees one call); on a trust-base run it is enforced
     even under `enforce: false`, and is NOT `trust-base-unverified`. An
     intent stub that answers `--version` at once and whose import-spec
     sleeps, and one whose freeze sleeps, give
     `timed-out` with steps `import-spec` and `freeze`, not
     `preparation-failed`. Kills: the probe still folding a timeout into an
     unreadable version; a local run going on to scan after a timed-out
     probe; the preparation keeping its spawnSync-message detail.
T13. Composition: a timed-out enforced gate makes the run exit 2 and the
     token `could-not-run`; with `enforce: false` it is the not-enforced
     note and the SARIF notification names `timed-out`; SARIF `gate-failed`
     details carry `timedOut`. The job-log line carries `conductor said:`.
     Kills: a timed-out gate composing as 0; a missing CONDUCTOR_OWN_REASONS
     entry.

### 8.4 The stated reason (2.3)

T14. Table test of `gateStatedReason`, one case per rule in 7.1, built from
     captured real bytes, colour codes included, committed as fixtures
     under tests/fixtures with the tool version: the vault-guard 1.10.0
     INCOMPLETE capture (colour-only blank line, then indented file lines,
     then the closing paragraph); the same with the upgrade note in front
     (captured, or built from the note's source lines and marked so); the
     two rename WRN lines then an INF line; the own-deadline gitleaks
     capture; ERR after INF; a note block, a blank line, then an indented
     real reason (the reason is chosen, not swallowed); only informational
     lines with a JSON `reason` on stdout (the reason is used); only
     informational lines and no stdout (null); a plain first line
     (unchanged from today). The three existing tests cited in
     docs/INVARIANTS.md (the "A gate that could not run" section) still
     pass. Kills: skipping only the `note:` line and not its continuation;
     letting a blank line continue a note block; ending a marker block at a
     blank line (the INCOMPLETE excerpt loses the file); testing whitespace
     before `stripAnsi`; dropping the marker preference; skipping every WRN
     line; returning the first skipped line as the fallback.
T15. Purity: a source-text test that `gateSaid` is read nowhere in
     src/exit-codes.ts, src/run.ts or the verdict-token code; and a test
     that runs the gate-error branch over the T14 inputs and asserts the
     outcome with `gateSaid` removed equals the one produced with the old
     first-line rule. Kills: any decision reading `gateSaid`.

### 8.5 Real binary

T16. tests/external-gates.real.e2e.test.ts, skipped without gitleaks as
     today: the synthetic many-commit repository under a 10 s policy limit
     is `timed-out` (the repository must be large enough on the CI machine
     to exceed it; size it so, or keep this local-only and say so); the
     rename-limit repository's warnings appear in the echo and never in
     `gateSaid`. The captured stderr lines go into tests/fixtures/README.md
     with the gitleaks version.

## 9. Item 2.5: documentation

### 9.1 README, beside the fetch-depth requirement

Placed after the two `fetch-depth: 0` paragraphs (README.md:1470-1475 and
:1501-1509), a short section, "What a history scan costs":

Claims it may make, all from the code or from the measurements in section 2:

- What the gate reads on each event: on a pull request, `<base>..HEAD`
  with first-parent merge diffs (src/gate-runner.ts:866-879); on a push, a
  schedule or a local run, every commit reachable from HEAD. A pull
  request's cost follows its own range; a full run's cost follows the whole
  history and the size of every blob ever committed.
- `fetch-depth: 0` means the checkout fetches the whole history on every
  run, whatever the scan range.
- The limit is per gate, its defaults are 120, 600 and 300 seconds, and it
  is set with `timeout-seconds` beside `enforce`; on a pull request it comes
  from the base branch. Every spawn of the gate gets the full limit (the
  version probe, the scan, the intent gate's preparation steps, osv's base
  run), so a gate's wall time can be a multiple of it.
- The limit is a SIGTERM deadline. A gate that ignores SIGTERM keeps the
  run waiting until it exits on its own; conductor does not escalate to
  SIGKILL.
- A gate's own child processes are not stopped with it. A gate behind a
  shell-wrapper `command` can keep running after the report says
  `timed-out`.
- On a hosted runner the six-hour job limit includes checkout, setup and
  every other gate, so a limit near the 21600 ceiling is cancelled with the
  job before it can fire. Keep it well under.
- The recommended split: every pull request scans its own range; the full
  history is scanned on a schedule, with a limit sized for it. Two ways to
  make it, both existing: by stage, since `secrets-history` defaults to
  stage `ci` and a push workflow run with the Action's `stage: push` input
  (action.yml:11) or `conductor run --stage push` leaves ci-stage gates out;
  or by trigger, running the workflow on pull requests and a schedule and
  not on push. With the CLI, `--gate secrets-history` on the scheduled job
  also works.
- `max-target-megabytes`, passed under `options`, skips every file larger
  than the cap. Measured with gitleaks 8.30.1 in the mode conductor runs,
  at the log level conductor runs gitleaks at: a secret inside a file over
  the cap was not reported, no line in gitleaks' log named the skipped
  file, and the scan summary still reported the full byte count. It is a
  coverage decision, made in the policy file where a reviewer can see it,
  and conductor never applies it by default.
- `options.timeout` on the secrets-history gate is gitleaks' own deadline,
  not conductor's. When it fires gitleaks exits 1, whether or not it had
  found a leak, and the gate is could-not-run. Leaks it found before the
  deadline are not listed as findings; the echoed gitleaks log line ("N
  leaks found in partial scan") is the only mention of them.

Claims it may NOT make: any duration for any repository size, any
commits-per-minute or megabytes-per-second figure, any statement that
`max-target-megabytes` makes a scan a given amount faster, and any claim
that a given limit is enough for a given repository. No timing has been
measured on an idle machine. The section says "measure your own full scan
once, on the runner it will run on, and set the limit with headroom".

### 9.2 README, policy reference

In "The policy file" (README.md:330-462): a `**`timeout-seconds`**`
paragraph after `present-on-base` (which ends at :451) with the type, the
bounds and why, the defaults, the base-ref rule, and the could-not-run
behaviour. The `options` paragraph (README.md:419-437) gains one sentence:
`timeout-seconds` is refused under options on every gate, and `timeout` on
every gate but gitleaks, where it is gitleaks' own flag. The exit-codes
section names `timed-out` among the could-not-run reasons wherever the
reasons are listed.

### 9.3 init template

src/init-policy.ts writes no `timeout-seconds` line (an absent key is the
default, and writing 600 would freeze today's default into every new
policy). Under the secrets-history gate only, after its options comment
(src/init-policy.ts:161-163), two comment lines:

    # A full-history scan can outlive the 600 s default on a large repository.
    # Set timeout-seconds beside enforce to change it; see the README.

## 10. INVARIANTS.md changes

Appended or amended by the implementer, each with its citation and test,
in the form the citation check (scripts/check-invariant-citations.mjs)
reads:

- "A gate that could not run is a result, never a note" (INVARIANTS.md:362-417):
  the reason count and list gain `timed-out`. The sentence "does not exit
  normally at all because it was killed or timed out, is could-not-run"
  becomes: "is stopped at its time limit, which is `timed-out`, decided by
  the spawn error code ETIMEDOUT and never by the signal (ENOBUFS shares
  SIGTERM), or is killed by anything else, which is `gate-error`; both are
  could-not-run." The `gateSaid` paragraph becomes: "the first stderr line
  that is not informational (a `note:` block, gitleaks' rename-detection
  warnings), preferring a block that starts at an INCOMPLETE or ERR marker,
  or for a gate whose output is JSON on stdout a string `reason` field;
  absent when every line is informational. It is read after the exit code
  has been judged and never changes the outcome or the exit code."
- New, same section: "A timed-out gate's report is never read, and its
  status is never a verdict. The spawn-error branch is the first thing read
  after spawnSync returns and tests the error code alone; a child that
  handled SIGTERM can return status 0 or its blocked code with a clean or
  complete report, and the outcome's exitCode is null whatever the status
  was. The report path is a fresh directory removed on every path." Tests
  T10 and T12.
- New, same section: "A version probe or an intent preparation step that
  times out is `timed-out`, never an unreadable version and never
  preparation-failed; a timed-out probe stops the gate before the scan, and
  is enforced on a trust-base run." Test T12a.
- New, same section: "One function resolves a gate's time limit, and every
  spawn of that gate gets the full limit." Test T8.
- New, under "The pull-request trust boundary": "A gate's time limit,
  `timeout-seconds`, comes from the policy the run was judged by: the base
  ref's on a pull request. No path builds a GatePolicy from the head policy
  on a pull-request run." Test T7.
- Amended, "The policy file is a passthrough, and the reserved list is the
  only exception": the second reservation category of 4.2, the nine keys,
  and why `timeout` is not reserved for gitleaks.
- Amended, "Things that look like invariants and are not"
  (INVARIANTS.md:3956-3962): "The per-gate timeout comes from the product's
  profile when the caller sets none" becomes "from the gate's
  `timeout-seconds` in the policy, else from the product's profile". The
  defaults stay values, not rules; the rule that stays is that a timeout is
  could-not-run (`timed-out`), never a clean exit.
- New known-open, under "What is NOT pinned by any test" if T16 stays
  local-only: "that a real gitleaks full-history scan is stopped at the
  policy limit is checked only against a local binary."
- New known-open entries (limits, documented, not pinned because they are
  not behaviour the code promises):
  - "The time limit is a SIGTERM deadline, not a hard bound. spawnSync sends
    SIGTERM and waits; it never escalates to SIGKILL, so a gate that ignores
    SIGTERM holds the run until it exits on its own."
  - "A stopped gate's own children are not killed. spawnSync has no
    detached option, so there is no process group to signal; a gate behind
    a shell-wrapper command can keep running after it is reported
    timed-out. A group kill would need an async spawn, signal forwarding
    in the hook, and taskkill on Windows; not done in 0.10.0."
  - "gitleaks' own --timeout (options.timeout) always ends in exit 1, which
    is could-not-run whether or not a leak was found before the deadline.
    Leaks found before it are never shown as findings, because the report
    is not read on a could-not-run path; only the echoed stderr line 'N
    leaks found in partial scan' mentions them."
- Amended, "The policy file is a passthrough" entry above also records 4.2's
  limit: the reservations match exact `options` keys, not `args` or a
  `no-` key, and are a clarity measure, not a trust control.

## 11. CHANGELOG (Unreleased)

### Added

- **A per-gate time limit in the policy file.** `timeout-seconds`, beside
  `enforce` on any gate, sets how long conductor lets that gate run before
  stopping it: a whole number of seconds from 10 to 21600. Without it each
  gate keeps the limit it had: 120 seconds for dep-guard, vault-guard and
  intent-guard, 600 for gitleaks, 300 for osv-scanner. On a pull request the
  value is read from the base branch's policy, so a pull request cannot
  change its own limit. Older conductor versions reject the key and exit 2,
  so move the Action first.
- **A gate stopped at its limit is reported as `timed-out`**, with the limit,
  how long it ran, where the limit came from, and what to do about it. It is
  still could-not-run, exit 2 when the gate is enforced. Every spawn of a
  gate gets the full limit. The limit is a SIGTERM deadline: a gate that
  ignores SIGTERM is waited for, and a gate's own child processes are not
  stopped with it.

### Changed

- **A timeout is no longer labelled `spawn-failed`.** Tooling that matched
  `could-not-run (spawn-failed)` for a timeout sees `could-not-run
  (timed-out)`. Every other spawn failure keeps `spawn-failed`.
- **A version probe that times out is `timed-out`**, not
  `trust-base-unverified` on a pull request, and a local run no longer goes
  on to run that gate with its version unknown. An intent-gate preparation
  step that times out is `timed-out`, not `preparation-failed`.
- **`timeout-seconds` under `options` is refused on every gate, and
  `timeout` under `options` is refused on every gate but gitleaks.** None of
  those tools accepts the flag, so no working policy is affected; a run with
  either key already could not run. On gitleaks `options.timeout` is
  gitleaks' own `--timeout` and is still passed through, with a note that it
  is not conductor's limit.
- **"gate said" quotes the cause rather than the first line.** For a gate
  that could not run, the quoted reason now skips informational lines (a
  `note:` block, git's rename-detection warnings as gitleaks logs them) and
  prefers the line a gate marks as the failure (INCOMPLETE, or an ERR log
  line). Reporting only: no verdict or exit code changes.

## 12. Open points, with the recommended default

1. Key spelling. Recommended `timeout-seconds`, because gitleaks'
   `options.timeout` is a real, different setting in the same unit on the
   same gate. The plan's `timeout` works with every rule here unchanged.
2. CLOSED by ruling at review: reserve `timeout` under options on the four
   tools that lack it, on clarity grounds. Corrected measurement on the
   pinned versions: without it dep-guard and vault-guard are gate-error with
   "unknown option '--timeout'", osv-scanner is gate-error with its usage
   line, and only intent-guard (exit 1, empty stdout) is the misleading
   "rejected config" `unparseable-output`. The cost stands: if one of those
   tools ever adds `--timeout`, using it needs a conductor release.
3. CLOSED by ruling at review: the ceiling is 21600. On a hosted runner it
   cannot fire (the six hours include setup and the other gates), which the
   docs say; raising it later is compatible, lowering it is not.
4. The Action step summary. Recommended: no change. The token is already
   `could-not-run` and the job log line names `timed-out`. A summary line
   would mean parsing a reason out of the report, the precedent for which
   (`present-on-base`) is a whole-line match on line 3 of the report; add
   one only if adopters ask.
5. A gate input on the Action. Not needed for the split: corrected at
   review, the Action already has a `stage` input (action.yml:11), and
   `secrets-history` defaults to stage `ci`, so a push workflow with
   `stage: push` leaves the full-history scan out while a scheduled or
   pull-request workflow at `ci` keeps it. The split can also be made by
   trigger. A gate input stays a separate, unrequested item.
6. Skipping gitleaks INF lines in the stated reason. Recommended: not now.
   The ERR preference covers every measured gitleaks failure, and skipping a
   whole log level could hide the only line a crash leaves.
7. CLOSED by ruling at review: a stopped gate's own children are a
   documented limit for 0.10.0, not a code change (6.1, the README line in
   9.1, the INVARIANTS known-open entry in section 10).
8. gitleaks `dir` mode under its own `--timeout` exits 0 after a partial
   scan with no warning (measured). conductor never runs `dir` mode, but a
   policy `command` plus `args` could. Recommended: a note in the README's
   `args` paragraph that conductor's history gate assumes `git` mode, and no
   code change here.
9. The note-plus-INCOMPLETE vault-guard stderr was not captured live (7.1).
   Recommended: the implementer captures it on vault-guard 1.10.0 for T14;
   if it cannot be triggered, the fixture is built from the note's source
   lines and says so.

## 13. Review fix round

What changed from the first draft, per review item:

- B1 (blocking). A timed-out child can return status 0 or its blocked
  code with signal null (re-measured here: trap and exit 0, trap and exit
  3, ignore and exit 0 later; clean stdout must be written before the
  deadline, because spawnSync closes the pipes there and later output is
  lost). Section 2 table and point 4; 6.1
  requires the error branch to stay first and to test the error code
  alone, and forces `exitCode` null; 6.2 records `signal` as possibly
  null; 6.3 names the clean-report case; T10 gains the status-0 and
  status-3 cases; T12 gains the SIGTERM-handling stubs and the mutations
  they kill; INVARIANTS entry rewritten.
- N1 (ruled). A timed-out version probe is `timed-out` and stops the gate,
  enforced on a trust-base run: 6.5, T12a, the floor rationale in 3.2,
  CHANGELOG, INVARIANTS.
- N2 (ruled). Intent preparation timeouts are `timed-out`; one resolver,
  `resolveTimeLimit`, used by run.ts and gate-runner.ts: 3.4, 3.5, 6.5, T8,
  T12a.
- N3. Every spawn gets the full limit, listed per gate type: 3.4 and the
  README claims in 9.1.
- N4. Re-measured on dep-guard 0.11.1, vault-guard 1.10.0 and intent-guard
  1.8.1 from a scratch prefix: vault-guard exits 2 (gate-error with the
  unknown-option line), intent-guard still exits 1. Table, 4.2, open point
  2 corrected; the reservation stands on clarity grounds.
- N5 (ruled). A blank line ends a note block; a marker block skips blank
  lines; whitespace is tested after `stripAnsi`. The vault-guard
  INCOMPLETE bytes were captured (section 2) and the 7.1 example rebuilt
  from them; T14 is built from captured fixtures; open point 9 records the
  one capture not made.
- N6. `conductor/option-is-gate-own` lives on the outcome (`gateOwnOption`,
  set on `progress`), not in `run.diagnostics`; T3 asserts it on the
  gitleaks own-deadline gate-error.
- N7. The limit is a SIGTERM deadline, not a hard bound; no SIGKILL
  escalation: 6.1, 9.1, INVARIANTS known-open, CHANGELOG.
- N8 (ruled). Leftover child processes are a documented limit: 6.1, 9.1,
  INVARIANTS known-open, open point 7 closed.
- N9. The split can be made by the Action's existing `stage` input as well
  as by trigger: 9.1 and open point 5. "Silent" for max-target-megabytes is
  qualified to the log level conductor pins, with the debug-level
  "skipping fragment" line noted.
- N10, corrected in the second round (B2). The first revision said
  gitleaks' own `--timeout` with a leak found first ends blocked with
  partial findings; that came from reasoning, not measurement, and was
  false. Re-measured in the second review round: gitleaks exits 1 with the
  ERR line and "1 leaks found in partial scan", so the gate is
  could-not-run either way and the found leaks go unshown. Table, 6.3
  ("presumably" removed), 9.1 and the INVARIANTS known-open entry now say
  that; the "blocked with no partial marker" entry is deleted.
- Second round, wording: the after-deadline output loss is stated by
  mechanism per child kind (SIGPIPE for shell or Go, EPIPE and exit 0 for
  Node); shell stubs use a background sleep and wait; T12 and T12a stubs
  answer --version at once and assert the step; IntentPrepareOptions
  timeoutMs becomes required with its fallback deleted; "blank" is
  defined.
- N11. The reservations match exact option keys only; `args` and a `no-`
  key are outside them, and that is clarity, not trust: 4.2 and the
  INVARIANTS passthrough amendment.
- N12. The 21600 ceiling cannot fire on a hosted runner: 3.2, 9.1, open
  point 3.
