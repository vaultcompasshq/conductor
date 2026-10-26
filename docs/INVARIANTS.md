# conductor invariants

This is the list of cross-cutting rules the umbrella depends on. It exists
because a cohesion audit should read a checked-in file rather than
re-derive a list from whatever the auditor happened to remember, and
because most of the rules below are true in one file and depended on in
another, with nothing between them that would notice if one side moved.

conductor is a convenience layer on purpose. It runs five gates that are
installed, versioned and released separately, three from this family and
two external tools the adopter installs (gitleaks and osv-scanner, profiled
in src/products.ts:161-224), and if this package disappeared all five would
still work. That shape is the source of nearly
every rule here: the umbrella has no library dependency on any gate, so
everything it knows about a gate is reconstructed from that gate's
command-line output, and every reconstruction is a place where the report
can start saying something the gate never said.

Read this before changing anything that decides an exit code, anything
that writes into somebody's repository, and anything that decides whether
a statement goes in a SARIF log as a result or as a notification.

## How to use this file, and how not to

This file records what the code is TRYING to do. That is not the same as
what it does, and it is not coverage. Each claim names the file and the
line that implements it and the test that pins it, so the checking is
repeatable rather than something you have to take on trust.

Where a rule is NOT pinned by any test, this file says so in those words.
Those admissions are the most valuable lines in it. A document that
claimed uniform coverage would be worse than no document at all, because
the next audit would read it, believe it, and confirm the gaps instead of
finding them. A sibling repository's invariants file was written by the
agent doing the fixing and a later audit found three of its claims simply
false, each one sitting exactly where the prose waved a hand at coverage
the code did not have.

That failure mode is not hypothetical here either. This file was written
in one pass, audited by somebody else, and then overtaken by fixes to the
code it describes. The audit found roughly a third of one section's
citations pointing at tests ADJACENT to the claim rather than at the
claim, and two justifications resting on facts about the other gates that
had stopped being true. Every citation has since been re-checked by
reading the TEST BODY rather than the test title, which is the shortcut
that produced almost all of those errors: a title that sounds like the
claim is not evidence, and a citation that sends an audit past a gap
rather than into it is worse than no citation at all.

So: assume this file has the same failure mode until you have checked the
line numbers yourself. Line numbers move. When one does not resolve to
what the sentence beside it says, the code is the fact.

Where prose and code disagree, the code is the fact. That includes the
prose in this file, the README, and the comments in the source. Five such
disagreements were recorded here when this file was written; all five have
since been fixed in the code or the README rather than in this file, and
each is now recorded as history in the section it belongs to.

## What is NOT pinned by any test

The whole list, in one place, so the next audit starts here rather than
reading for it. Each is stated again in its own section with the reason
it is there and what would break in practice.

Six were admitted when this file was written. ALL SIX ARE NOW PINNED.
Two went first: the `RESERVED_OPTIONS` list is derived from `gateArgs` in
one direction and held to two justified exceptions in the other
(tests/policy.test.ts:390 ("reserves every flag the umbrella writes, which is the direction that can hurt") and tests/policy.test.ts:399 ("reserves nothing else without a stated reason")), and
`conductor/blocking-threshold-unknown` is exercised at the normalizer
(tests/normalize.test.ts:70). The remaining four were closed in 0.2.1,
one of them by fixing a real bug rather than only testing around it:

1. A MALFORMED MANIFEST ON REVERT. `revertInit` parsed it with a bare
   `JSON.parse`, so a corrupt one threw where `readManifest` treats the
   same file as missing. Revert now answers `manifest-unreadable`, which
   is deliberately a different conflict from `no-manifest`, and removes
   nothing. Pinned by tests/init.test.ts:1170.
2. THE SUCCESS HALF OF THE TEMPORARY-DIRECTORY CLEANUP. Pinned by
   tests/intent-run.test.ts:171, which drives a full passing `runAll`
   through the import and freeze chain and finds no `conductor-intent-`
   entry in the temporary root it injected. The failure
   half was already pinned; this half is the caller's `finally`, and it
   was correct, so no code changed.
3. `--spec` OUTRANKING A FROZEN NATIVE CONTRACT. Pinned by
   tests/intent-prepare.test.ts:230 and 241, which put both in one
   repository and assert the flag's spec is what gets imported and frozen
   and that the gate is not pointed at the repository itself.
4. THE SUBDIRECTORY ANCHORING OF THE CLI. Pinned by tests/cli.test.ts:400,
   which runs the built CLI from two levels down and asserts it produces
   the same report, byte for byte, as the same run from the top.

0.2.2 removed the last defect this section used to record as OPEN rather
than fixed: the CLI's `repoRoot` no longer answers the working directory
when git cannot be asked, so a missing git and a directory outside any
repository are now two named sentences rather than one wrong diagnosis.
All three of its branches are pinned; the section on anchoring says where.
This paragraph briefly admitted the third one, git present but unable to
run at all, as untestable "because a spawn failure that is neither ENOENT
nor an exit code needs a machine in a state a test cannot ask for". That
was wrong, and it is the shape of admission this file exists to catch: a
test writes a `git` with no execute bit into the controlled PATH and the
spawn fails with EACCES. Pinned by tests/cli.test.ts:802.

Three more things belong on this list without being invariants of the
same kind. The first two are unchanged since this file was first written;
the third is new in 0.2.1. `ExitInput.enforce` is REQUIRED
rather than defaulted, which is a compile-time property that no test pins
and no test could. The generated hook's own `exit 1` is asserted on one
of its two fail-closed branches only, which is a partial gap rather than
an absent one; the section on it says which half is which. And
revertInit's `umbrellaHookGone` derivation, which replaces a flag this
release removed, is exercised only through its dry-run branch (by the
dry-run adopt revert); its real-mode branch is not distinguished on its
own, because every other state a test can construct short-circuits at the
changed-hook early return first; the section on what revert guarantees
says why.

Two more arrived in 0.2.3, both about the intent gate's state directory,
and both belong here rather than only in their own sections because this
list is supposed to be the whole of it:

1. THE CANONICAL-FIRST ORDER OF `NATIVE_CONTRACT_PATHS` IS A DECLARATION
   WITH NO OBSERVABLE EFFECT. One test pins the declaration and nothing
   can pin more, because no consumer distinguishes the two entries today:
   the conflict rule refuses every repository that could hold both, so
   `frozenNativeContracts` never returns more than one and only `[0]` is
   read, and `frozenContractIn` is compared to `null` with its value
   discarded. Reversing the pair turns one assertion red and changes no
   behaviour. This is a convention until something reads WHICH of the two
   answered.
2. THE IMPORT-AND-FREEZE CHAIN IS NEVER DRIVEN AGAINST A REAL
   INTENT-GUARD. Every test of it uses `stubIntentGuard`, and the dogfood
   suite exercises only the native flow: it passes neither `--base` nor
   `--spec`, so nothing in the repository runs a real gate through
   import-spec and freeze. This release rests on a behaviour of the real
   1.3.0 build -- that a freeze into a temporary project holding only
   `.conductor/` renames it to `.intent-guard/` and writes there -- and
   that behaviour is verified by READING the gate's `ensureStateDir`, not
   by running it. The post-freeze lookup is written to survive being wrong
   about it, since it accepts either name and fails closed naming both, but
   the claim itself is unchecked. A dogfood case passing `--spec` would
   close this and is the single most valuable test this file is missing.

One more arrives in 0.3.0 with the pull-request trust boundary, and it is a
gap in the FEATURE rather than in its tests: everything the umbrella does
here is pinned, and what is missing is a hole nothing in this release closes.

All three family gates are inside the boundary as of 0.3.0: dep-guard 0.6.0,
intent-guard 1.4.0, vault-guard 1.7.0. The composed test the design document
calls the acceptance criterion for the wave now runs, in the dogfood suite,
against all three at once. The two external gates join it in 0.5.0 by a
different mechanism, since neither tool has a `--trust-base`: see "External
gates" at the end of this file. What is still open for them is listed there
as KNOWN-OPEN: coverage limits and a local-run limit. One of them is a way
for a pull request to silence the vulnerabilities gate, and it is visible
rather than silent: rewriting a tracked lockfile to `{}` is reported as
`conductor/lockfiles-empty` naming the file, whether it was the only
lockfile (osv-scanner exits 128) or one of several (osv-scanner's own
per-file count; until 2026-10-13 that case was silent, audit finding F2),
and the gate's verdict over the remaining files stands.

1. KNOWN-OPEN: THE INTENT GATE'S IMPORTED-CONTRACT PATH IS OUTSIDE THE
   BOUNDARY, and this one is a HOLE rather than work in flight, so it is
   listed here as open rather than as pending. When a repository has no frozen contract
   and a spec is imported instead, that spec is a file in the head tree: the
   contract being judged against is derived from something the pull request
   controls, and a pull request that adds or edits its own spec is choosing
   part of what it is judged by. Neither the base-ref rule nor the program
   rule closes it. The flag is deliberately withheld there rather than
   pointed at a temporary directory with no repository in it, and the
   withholding is reported like any other, so the state is visible; it is
   not fixed. Freezing a native contract and keeping it committed is a
   workaround, not the fix. The fix is to read the spec from the base ref
   too, and it is not in this release.

Four more arrive in 0.10.0 with the per-gate time limit, each stated again
under "A gate that could not run is a result, never a note":

1. THAT A REAL GITLEAKS FULL-HISTORY SCAN IS STOPPED AT THE POLICY LIMIT IS
   CHECKED ONLY AGAINST A LOCAL BINARY. The case is in
   tests/external-gates.real.e2e.test.ts behind CONDUCTOR_REAL_GITLEAKS_SLOW
   as well as an available gitleaks, because the repository has to be large
   enough to outlive a real 10 s limit; CI runs the stubbed timeout suites
   only. Measured with it: a gitleaks scan stopped early, by conductor's
   limit or by its own --timeout, prints no rename-detection warning at all.
2. KNOWN-OPEN: the time limit is a SIGTERM deadline with no SIGKILL
   escalation, so a gate that ignores SIGTERM holds the run until it exits.
3. KNOWN-OPEN: a stopped gate's own child processes are not killed.
4. KNOWN-OPEN: gitleaks' own --timeout always ends in exit 1 and
   could-not-run, and leaks it found before its deadline are never shown as
   findings.

## The exit code is composed, not maximised

Three codes and nothing else. 0 means every enabled gate ran and none
blocked. 1 means every enabled gate ran and at least one blocked. 2 means
an enabled gate could not run, so nothing in the report is a clean result.
2 outranks 1 and 1 outranks 0, and the composition is written as two
ordered predicates rather than as an arithmetic maximum
(`composeExitCode`, src/exit-codes.ts:148-157).

The maximum is the obvious implementation and it is wrong, which is why
the function is shaped to make it hard to write. The three products do not
mean the same thing by the same number: dep-guard has a third code, 2, for
"could not run the checks at all", while the other two have only 0 and 1
and use 1 both for a real finding and for a config file they rejected.
Taking a maximum would flatten dep-guard's distinction and would report a
broken config as a policy violation.

Because 2 covers cases the products themselves report as 1, the umbrella
cannot read the child's exit code alone. "Exited 1 and printed nothing
parseable on stdout" is the reliable signature of a rejected config, and
it is treated as could-not-run (src/gate-runner.ts:2754-2786 for an exit
outside the product's clean and blocked codes, 2836-2856 for unparseable
output). So the composed code can differ from the maximum of the children's,
deliberately.

Which child exits are verdicts is per product since 0.5.0, read from the
profile (`profile.exit`, src/products.ts; applied at
src/gate-runner.ts:2754-2786). The three family gates keep exactly the old
reading, clean 0 and blocked 1, anything else could-not-run. gitleaks is
handed `--exit-code 3`, so its 3 is blocked and its 1, which it also uses
for errors, is could-not-run. osv-scanner's 128 ("no package sources
found") is clean with a `conductor/nothing-to-scan` diagnostic and outcome
exit code 0, so it never reaches the composition as non-zero; the same
outcome is produced without spawning it when the repository tracks no
lockfile (see "External gates"). And a clean
gitleaks exit whose stderr carries an `ERR` log line is could-not-run
(src/gate-runner.ts:1485-1513), because gitleaks 8.30.1 reports a git
failure as exit 0 with an empty report.

The per-finding `blocking` flag can only ADD to the answer, never subtract
from it: the second predicate is `gate.exitBlocks ||
gate.hasBlockingFinding` (src/exit-codes.ts:153), where `exitBlocks` is
`gateExitBlocks(outcome)` (src/exit-codes.ts:98-112), a REQUIRED field of
`ExitInput` in place of the raw exit code (src/exit-codes.ts:128). A gate
that exited non-zero produces a non-zero composed code whatever the
umbrella made of its output, with ONE exception since the osv design
(docs/superpowers/specs, 2026-10-11, section 4.3): `gateExitBlocks` returns
false for a non-zero exit only when all six of these hold. (a) The gate is
the vulnerabilities gate, osv-scanner in that role. (b) Its policy, read
from the base ref on a pull request, says `present-on-base: report`. (c) A
base comparison ran, which is the only time `baseComparison` is on the
outcome. (d) At least one finding was parsed. (e) Every finding is labelled
present-on-base; this one is redundant by construction, since under report
an introduced finding stays blocking and blocks through
`hasBlockingFinding` whatever the predicate says, and it is kept so the
predicate states the whole rule. (f) The head run's raw output carried no
verdict that is not an advisory: no `license_violations`, no deprecated
package (`package.deprecated`, inside the package object in osv-scanner
2.4.0), and no other non-empty package-level key the normalizer does not
map. The keys it maps are `OSV_KNOWN_PACKAGE_KEYS` in src/normalize.ts:
`package`, `vulnerabilities`, `groups`, `licenses` and, since 2026-10-17,
`dependency_groups`, the dev marker osv-scanner 2.4.0 writes as ["dev"] and
the normalizer reads for the dev label. Before that date it was missing, so
any dev dependency counted as a non-advisory verdict under (f) and a
compared run where every finding was present-on-base under report still
exited 1. VERDICT CHANGE: such a run whose only non-advisory verdict was
`dependency_groups` now exits 0; a real non-advisory verdict (a licence or
deprecation verdict) still blocks. Pinned by tests/osv-exit.test.ts ("exits
0 with token pass under report when dependency_groups is the only key
beside the advisories") over the real 2.4.0 capture
tests/fixtures/osv-scanner-2.4.0-two-lockfiles.json, which goes red with the
key removed, and by tests/osv-exit.test.ts ("still exits 1 when a real
licence verdict sits beside the dependency_groups package"), which stays
green with it removed. The flag exists only so a gate whose exit code
somehow said clean while its own report carried a blocking finding still
fails the run.

Every other reader of "the child exited non-zero" goes through the same
predicate, or the verdict token and the verdict sentence would disagree
with the exit code: the not-enforced note, `unenforcedClauses`,
`blockingCount` (the token's count), the mismatch sentence on an exit 1
with nothing marked blocking, and the SARIF `gate-not-enforced`
notification. Two readers keep the raw exit on purpose, because they ask
"did this gate say anything at all": the job-log outcome (the words come from `gateOutcomeWords`
in src/output-text.ts, which `gateLogLines` uses) and `isFullyClean`. A report-mode run with present-on-base findings has
findings and a non-zero child exit, so it is never "ok" and never folded
into the one-line summary. Pinned by tests/osv-exit.test.ts ("finds no
reader of a gate exit code compared with 0 outside gateExitBlocks and the
two allowlisted sites"), a source-text test over src/ that names those two
sites and fails on any other `exitCode` compared with 0; by
tests/osv-exit.test.ts ("counts the token over the gate that blocked, not
the report-mode osv gate"); condition (d) by tests/osv-exit.test.ts
("blocks on exit 1 with no parsed finding, which is the at-least-one guard
(d)"), the role half of (a) by tests/osv-exit.test.ts ("blocks an
osv-scanner outcome filed under another role") and its product half by
tests/osv-exit.test.ts ("blocks a vulnerabilities-role outcome whose product
is not osv-scanner"), and (f) by tests/osv-exit.test.ts ("still blocks on a
licence violation") and tests/osv-exit.test.ts ("still blocks on a
deprecated package"). Dropping (e) turns only tests/osv-exit.test.ts
("blocks when any finding is introduced (e), and says nothing about an exit
of 0") red, as the redundancy above says it should.

Pinned by the twelve cases in tests/exit-codes.test.ts, of which the ones
that matter are tests/exit-codes.test.ts:43 ("does not take the numeric
maximum of the children codes"), 34 ("lets could-not-run outrank a
blocking gate rather than the other way round") and 22 ("is 1 when a gate
reported a blocking finding even if its exit code did not"). The first of
those has a single gate that exited 1 and is could-not-run, so the answer
is 2 where the maximum would be 1. The wiring from a real run into that
function is tests/run.test.ts:161 ("composes to 2, not to 1"), which
drives a gate whose output has drifted shape and asserts the composed code
is 2 and not 1.

`ExitInput.enforce` is REQUIRED rather than defaulted
(src/exit-codes.ts:145), so a call site that has not thought about
enforcement does not compile. That is a compile-time property and no test
pins it; a test could not.

## An unenforced gate is filtered out, and nothing else about it changes

`enforce: false` in the policy file removes a gate from the exit-code
composition entirely (src/exit-codes.ts:149). It is not a downgrade. The
gate still runs, its findings keep their own severities, their `blocking`
flags are untouched, and both output formats report it exactly as they
report an enforced gate, with one added sentence saying its verdict did
not reach the exit code.

This is the adoption ramp. `conductor init` writes the dependencies and
secrets gates `enforce: true` always, so a fresh repository gets the ramp
rather than three repositories being hand-edited into it. The intent gate is
the one exception: it starts unenforced only when no contract is frozen at
init time (issue #57). `conductor init` writes it enforced instead when a
frozen intent contract already exists at init time (`src/init-policy.ts`'s
`renderPolicy`, handed the path `src/intent-prepare.ts`'s own
`frozenNativeContractPath` actually returned, rather than re-deriving
"frozen" from the contract schema, so init and the umbrella's own intent
preparation cannot disagree about which file counts, while the gate itself
additionally validates the approval block and refuses symlinks), and
unenforced with an explanatory comment otherwise. The ramp reasoning above
still holds for a repository with nothing frozen yet; it stops applying once
a contract IS frozen, because enforcement being off at that point is what let
a frozen contract's protected paths produce findings that never failed the
check on the public demo repository.

The rule that makes it safe is that nothing reads a gate's output and
decides on its own judgment to ignore it. The umbrella reads a line
somebody wrote in their own policy file, and the line changes exactly one
number. The vulnerabilities gate's `present-on-base: report` is the one
other written decision of this kind (see "The exit code is composed"
above): it is a set difference of two runs of the same tool, under a line
in the BASE policy, not a judgment about any finding, and every finding it
leaves unblocked is still printed with its label.

Two consequences are worth stating because they look like bugs:

A run can exit 0 with BLOCKING on the screen above it. The text verdict
therefore carries the reason on the same line rather than leaving it to
the sections: the clauses are built in `unenforcedClauses`
(src/output-text.ts:395-416) and appended to the exit 0 verdict at
src/output-text.ts:691-700, with the same clauses carried as an aside on
the exit 1 and exit 2 verdicts (src/output-text.ts:630-634, 645, 679 and 684).

An unenforced gate that could not run still produces a critical,
error-level RESULT in the SARIF log, not a note. `conductor/gate-missing`
and `conductor/gate-failed` keep their severity and their result standing
whatever the policy says about enforcement (src/normalize.ts:1219 for the
severity, src/output-sarif.ts:136-142 for the level, and 1046-1051 for the
findings going into the umbrella's run rather than being reclassified),
and only the umbrella's own `gate-not-enforced` notification says the
verdict did not reach the exit code.

This was recorded here as a disagreement with the README, which used to
summarise enforcement as making such a gate "a note rather than exit 2".
That was true of the exit code and false of the published log. The README
was the wrong one and now says the same thing this section does
(README.md:187-193), and the rule is pinned by
tests/output-sarif.test.ts:1027, which renders an unenforced gate that
could not run and asserts the result's level is `error` and its severity
`critical`, with the `gate-not-enforced` notification beside it.

The report header and the verdict deliberately count different things.
The header line counts gates and findings across every gate, because it is
an inventory of what follows it and a reader counting lines on screen has
to arrive at that number (src/output-text.ts:1087-1092). `header`
(src/output-text.ts:58-69) is the per-gate line under that inventory, not
the count. The verdict counts only enforced gates, because it answers what
failed the run (src/output-text.ts:570-576). Two questions, two numbers.

Pinned by tests/exit-codes.test.ts:52, 58, 66 and 75;
tests/output-text.test.ts:480, 488, 495 and 500 (an unenforced gate that
blocked: the findings and their BLOCKING marker survive, the header is
marked, and the verdict does not claim none blocked), 527, 532 and 539
(an unenforced gate that could not run is loud, is not exit 2, and is not
also called a gate that blocked), 570, 583 and 591 (only enforced gates
are named as the reason and counted), and especially 604 ("lets the
header count everything on screen while the verdict counts what failed",
which asserts the header says 3 findings while the verdict says 2 across
1 gate); tests/cli.test.ts:483, 499, 529 and 543, end to end through the
CLI; and tests/output-sarif.test.ts:1015, 1027, 1060, 1080 and 1094.

## A gate that could not run is a result, never a note

Twelve reasons, enumerated as a union so a new one cannot be spelled freely
(`CouldNotRunReason`, src/gate-runner.ts:76-136; the last four, `gate-version-unsupported`,
`report-missing`, `history-shallow` and, in 0.10.0, `timed-out`, came after
the description below was written): a missing binary, a
configured command that is not there, a spawn failure, the gate's own
error exit, output the umbrella could not read, a preparation that never
got as far as spawning anything, and the two pull-request-mode refusals
added in 0.3.0, `trust-base-unverified` for a gate in the version table
whose version could not be read and `gate-program-refused` for a gate whose
program is a file the head controls. The last two are separate rather than
one shape of the other because they send a reader to different places: one
is a packaging problem with the installed gate, the other is a pull request
choosing the program that judges it.

Each one produces a finding of the umbrella's own, critical and blocking,
with no SUBJECT (`gateProblem`, src/normalize.ts:1207-1235, and the four
functions that call it at src/normalize.ts:1257-1409). Its SARIF result is
still filed against the policy file, by the rule on locations below, since
a result with no location at all makes code scanning reject the whole log.
The subject and the location are two different things here and the
distinction is the point: nothing about the scanned tree is claimed, and
the file the result is filed against is where the gate is enabled. That is
not symmetry
for its own sake. A gate that never ran gets no SARIF run of its own, by
the rule below, so without one of these findings the published report
would carry no trace of the most important thing that happened.

A gate that exits outside its product's clean and blocked codes (above 1,
for the three family gates), is stopped at its time limit, which is
`timed-out`, decided by the spawn error code ETIMEDOUT and never by the
signal (ENOBUFS shares SIGTERM), or is killed by anything else, which is
`gate-error`; both are could-not-run (`spawnFailure`,
src/gate-runner.ts:267-280, called at src/gate-runner.ts:2268; pinned by
tests/timed-out.test.ts:154 ("keeps ENOBUFS, which arrives with the same
SIGTERM, and ENOENT and EACCES as spawn-failed")). A gate
that exits 1 with stdout that will not parse as JSON is could-not-run
(the `normalizeUnparseableGate` return in `spawnAndRead`, src/gate-runner.ts). Reporting the second as a policy violation
would tell a user their code is at fault when their config is.

What the gate itself said rides along on the could-not-run result as
`couldNotRun.gateSaid`: the first stderr line that is not informational (a
`note:` block, gitleaks' rename-detection warnings, osv-scanner's progress
lines), preferring a block that
starts at an INCOMPLETE or ERR marker, or for a gate whose output is JSON on
stdout a string `reason` field; absent when every line is informational
(`statedReasonFromStderr`, src/gate-runner.ts:465-512, with osv-scanner's
progress patterns at src/gate-runner.ts:437-441). It is sanitised to
ASCII and cut to 160 characters. It is read after the exit code has been
judged and never changes the outcome or the exit code, and its absence is
not an error. The rule is pinned case by case against captured bytes by
tests/stated-reason.test.ts:53 ("captured vault-guard 1.10.0 INCOMPLETE:
joins the file lines across the colour-only blank line"),
tests/stated-reason.test.ts:70 ("the captured note block then a plain
reason (constructed): the continuation lines are skipped too"),
tests/stated-reason.test.ts:75 ("a note block, a blank line, then an
indented real reason (constructed): the reason is chosen") and, for
osv-scanner (audit 2026-10-18 N4, whose first line is always its walk
banner), tests/stated-reason.test.ts:121 ("captured osv-scanner 2.4.0
truncated lockfile: the extraction error, never the progress lines"), 128
("osv-scanner progress lines then a plain failure line (constructed from
the capture): the failure line") and 135 ("osv-scanner progress lines
alone (cut from the capture): no excerpt at all"); disabling the osv rule
turned those three red. Its purity
by tests/stated-reason.test.ts:150 ("gateSaid is read nowhere in the exit
code, the run composition or the verdict token") and
tests/stated-reason.test.ts:164 ("a gate-error outcome over every captured
input is the first-line rule outcome, gateSaid aside"). Also pinned
by tests/gate-runner.test.ts ("carries the first stderr line of an exit 2
gate as a bounded, sanitised excerpt"), tests/gate-runner.test.ts ("falls back to a reason field in
stdout JSON when stderr is empty, and never changes the exit 2") and tests/gate-runner.test.ts
("carries no excerpt, and does not throw, when an exit 2 gate printed nothing
usable"). The excerpt is also written to the job log on stderr in the per-gate
log line, cleaned and capped.

Pinned by tests/gate-runner.test.ts ("treats exit 2 as could-not-run
rather than as a policy violation") and tests/gate-runner.test.ts ("treats exit 1 with
unparseable stdout as could-not-run, the rejected-config shape"), and end
to end by tests/run.test.ts:247 ("is visible as an umbrella finding, so it
reaches the published format too") and 540 ("reaches
gate-output-unparseable too, which is the same reader problem"), and by
tests/cli.test.ts:122 ("prints no stack frames when a gate exits with its
could-not-run code"), which asserts the CLI exits 2.

A TIMED-OUT GATE'S REPORT IS NEVER READ, AND ITS STATUS IS NEVER A VERDICT.
The spawn-error branch is the first thing read after spawnSync returns and
tests the error code alone (src/gate-runner.ts:2268-2292); a child that
handled SIGTERM can return status 0 or its blocked code with a clean or
complete report, and the outcome's exitCode is null whatever the status
was. The report path is a fresh directory removed on every path (the
`finally` at src/gate-runner.ts:1969-1973). Pinned by
tests/timed-out.test.ts:143 ("reads ETIMEDOUT as timed-out when the child
handled SIGTERM and exited 0, signal null"), tests/timed-out.test.ts:150
("reads ETIMEDOUT as timed-out when the child exited 3, its blocked code,
signal null"), and against real child processes by
tests/timed-out.test.ts:297 ("never reads a clean report written in the
trap, with exit 0"), tests/timed-out.test.ts:320 ("never reads a
one-finding report written in the trap with exit 3, the blocked code"),
tests/timed-out.test.ts:328 ("never reads clean JSON printed before the
deadline") and tests/timed-out.test.ts:285 ("never reads a complete, valid
one-finding report"), each of which also asserts the work directory is gone.

A VERSION PROBE OR AN INTENT PREPARATION STEP THAT TIMES OUT IS
`timed-out`, never an unreadable version and never preparation-failed; a
timed-out probe stops the gate before the scan (src/gate-runner.ts:1774-1794),
and is enforced on a trust-base run. The preparation's steps report it
through `timedOutStep` (src/intent-prepare.ts:489-496) and
`preparationTimedOut` (src/gate-runner.ts:926-955, mapped at
src/run.ts:762-777). Pinned by tests/gate-runner-timeout.test.ts:499 ("stops
the gate at the probe on a local run, and never spawns the scan"),
tests/gate-runner-timeout.test.ts:511 ("is enforced on a trust-base run under
enforce: false, and is not trust-base-unverified") and, for import-spec and
freeze, the generated cases at tests/gate-runner-timeout.test.ts:549.

ONE FUNCTION RESOLVES A GATE'S TIME LIMIT, AND EVERY SPAWN OF THAT GATE GETS
THE FULL LIMIT. `resolveTimeLimit` (src/gate-runner.ts:242-250): the test
hook, then the policy's `timeout-seconds`, then the product default. runGate
calls it (src/gate-runner.ts:1621) and run.ts calls the same function for the
intent preparation (src/run.ts:728); `IntentPrepareOptions.timeoutMs` is
required (src/intent-prepare.ts:224), so the type checker, not a test, keeps
a fallback from coming back. Pinned by tests/timed-out.test.ts:170 ("takes
the test hook first, then the policy, then the profile default"),
tests/timed-out.test.ts:179 ("is the only expression in src that turns
timeoutSeconds or a profile timeoutMs into a limit"),
tests/gate-runner-timeout.test.ts:419 ("sends 30 s to the probe, import-spec,
freeze and check alike") and tests/gate-runner-timeout.test.ts:441 ("gets the
policy limit too, not the profile constant").

`options.timeout` on the secrets-history gate is gitleaks' own deadline, and
the `conductor/option-is-gate-own` note saying so lives on the OUTCOME
(`gateOwnOption`, set on `progress` before any spawn,
src/gate-runner.ts:1621-1631), not in `run.diagnostics`, because every
could-not-run outcome carries an empty run and the gate-error gitleaks' own
deadline produces is exactly the outcome that needs it. Pinned by
tests/gate-runner-timeout.test.ts:226 ("keeps the note on the gate-error that
gitleaks own deadline produces, in text and in SARIF").

KNOWN-OPEN, limits documented rather than behaviour the code promises, so
not pinned:

- The time limit is a SIGTERM deadline, not a hard bound. spawnSync sends
  SIGTERM and waits; it never escalates to SIGKILL, so a gate that ignores
  SIGTERM holds the run until it exits on its own.
- A stopped gate's own children are not killed. spawnSync has no detached
  option, so there is no process group to signal; a gate behind a
  shell-wrapper command can keep running after it is reported timed-out. A
  group kill would need an async spawn, signal forwarding in the hook, and
  taskkill on Windows; not done in 0.10.0.
- gitleaks' own --timeout (options.timeout) always ends in exit 1, which is
  could-not-run whether or not a leak was found before the deadline. Leaks
  found before it are never shown as findings, because the report is not
  read on a could-not-run path; only the echoed stderr line "N leaks found
  in partial scan" mentions them.

AGENTS.md and README.md both used to say the umbrella raises no findings
of its own "beyond conductor/gate-missing". That was false and always had
been: the union at src/normalize.ts:1202-1205 has three members, and the
README named `conductor/gate-failed` elsewhere in the same document.
Three, plus the two normalization diagnostics, is the number, and both
documents now list all five (AGENTS.md:12-16, README.md:980-984).

The README half of that pair was pointing at the wrong place and had been
since it was written. It named the paragraph about mirroring the Action's
inputs into the pull request comment step, which has nothing to do with the
umbrella's own findings; the list of five is in the "what is in and what is
out" section. Found in 0.3.0 by doing what the top of this file asks and
reading the body at the cited line rather than trusting the number.

## runGate is total

`runGate` never throws. That is a contract and not a hope, and the reason
is structural: the caller maps over the enabled gates in order
(src/run.ts:526-615), so an escaping error does not merely lose one gate's
report, it loses every gate after it. What still escapes `runGate` is one
line on stderr and exit 2 (`fail` in src/cli.ts:480-483, reached from the
run action's catch and from `main`), which is could-not-run, not "a gate
blocked".

The backstop is the `catch` in `runGate` itself, around `runGateInner`. The
`catch` around the `normalizeFor` call in `spawnAndRead` is deliberately NOT
narrowed to `NormalizeError`: that narrowing was the original defect, when
a normalizer reading a property off a null array element threw a
`TypeError`, which escaped everything. The normalizers now validate every
field they read before reading it (src/normalize.ts:52-93), and the broad
catch is the second line of that defence rather than the only one. The two
catches in `spawnAndRead` around the external tools' base-ref config
(`nestedConfigProposals` and `materializeExternalConfig`) ARE narrowed, to
`ExternalConfigError`, which becomes `preparation-failed`; anything else
they meet is rethrown, and lands in the `runGate` backstop as could-not-run.

Pinned by tests/gate-runner-total.test.ts ("turns a TypeError thrown while
normalizing into could-not-run, with no stack") and
tests/gate-runner-total.test.ts ("runs every gate after the one whose
normalizer threw, and the run exits 2"), which go red with the normalization
catch narrowed to `NormalizeError` and the backstop made to rethrow; and by
tests/gate-runner-total.test.ts ("turns an error thrown before normalization
into could-not-run through the outer backstop"), which goes red with the
backstop alone defeated. They mock a module to throw a non-`NormalizeError`,
because a malformed payload now raises a `NormalizeError` and reaches
neither catch.

## Where the tool refuses rather than guesses

The umbrella has no built-in default policy. A missing `.guardrails.yaml`
is a `PolicyError` naming the file and telling the user to run
`conductor init` (src/policy.ts:466-477). A run that gates a commit has to
be explainable from a file in the repository rather than from something
compiled into a binary. Pinned by tests/cli.test.ts:157.

An unusable changed-path set fails closed. `changedPathsSince` returns a
failure rather than an empty list on any git error, because an empty path
set is indistinguishable from a clean run. A change set that `--paths`
cannot carry stays clearable rather than being refused outright
(`pathsFlagRefusal` and `orderForPathsFlag` in src/intent-base.ts,
`intentChangeChannel` in src/gate-runner.ts). For a native contract on
intent-guard 1.8.1 or later the gate is handed its own `--base`, which
reads the paths from git, so a comma, a backslash, edge whitespace or a
leading "-" is judged. Below that, `--paths` is led by a path that does
not start with "-", and the run is refused only when a path has a comma,
a backslash or edge whitespace, or every path starts with "-"; the
refusal says to upgrade the gate. For an imported contract `--paths` is
the only channel, and the refusal says to freeze the contract on the base
branch. A space in the middle of a filename is ordinary and passes through
untouched. Pinned by tests/intent-run.test.ts ("hands a native contract
to intent-guard's own --base from 1.8.1, so a dash-leading path is
judged"), tests/intent-run.test.ts ("below 1.8.1, leads the --paths list
with a path that does not start with a dash"), tests/intent-run.test.ts
("below 1.8.1, refuses only when every path starts with a dash, and says
how to clear it") and tests/intent-run.test.ts ("refuses a comma in a
path for an imported contract, saying how to clear it").

A missing umbrella binary blocks the commit. The generated hook exits 1
rather than warning and letting the commit through (src/init.ts:165-171).
A guardrail that switches itself off when the tool is missing is a
guardrail an attacker turns off by making the tool missing. The hook says
two different things depending on whether git was available to locate
`node_modules/.bin`, because "git is not on this hook's PATH" and
"conductor is not installed" send a reader to two different fixes.

The coverage here is uneven and worth stating precisely, because the two
halves are pinned differently. That the commit is REFUSED is pinned by
tests/init.test.ts:1712 and 1802, which drive a real `git commit` with no
conductor anywhere and assert git's own status is non-zero and the
message says NOT checked. That the HOOK ITSELF exits 1 is asserted in one
place only, tests/init.test.ts:1729, and only on the git-missing branch:
it runs the hook directly and asserts `run.status` is 1. Nothing asserts
the hook's own exit code on the ordinary "conductor: command not found"
branch, where a hook that exited 127 or 2 would still make the commit
fail and still pass those tests. The message on that branch IS pinned
(tests/init.test.ts:1712). A neighbouring test also asserts `run.status`
is 1 (tests/init.test.ts:1790), but that 1 is passed through from the
stub conductor it installs and is not this branch of the hook at all.

An unknown `--stage` is a usage error and never a silent full run
(`parseStage`, src/cli.ts:458-466). Both directions of the quiet failure look like
success: a typo that runs every gate reads as a passing build with more
coverage than it has, and a typo that runs none reads as a passing build
with no coverage at all. Pinned by tests/cli.test.ts:226.

One place reads the same file two ways, on purpose, and the reason is
worth stating because it used to be an asymmetry rather than a decision.
`readManifest` treats an unparseable manifest as a missing one, because
"the record is unreadable" is not evidence that a file on disk is the
umbrella's (src/init-manifest.ts:138-148). `revertInit` does NOT reuse it, because
revert has to tell the two apart: a missing manifest means there is no
record to act on, an unreadable one means there is a record and it cannot
be trusted, and those send a reader to different fixes. It answers
`no-manifest` for the first and `manifest-unreadable` for the second, and
removes nothing either way (src/init.ts:956-987).

What `manifest-unreadable` actually covers is narrower than the names
above suggest. It is raised when the file does not PARSE at all:
truncation, conflict markers left behind by a bad merge, anything
`JSON.parse` itself rejects (src/init.ts:973-987). It is not raised for
valid JSON of the wrong shape: an empty object, a `files` key that is
`null`, a manifest missing `files` entirely all parse cleanly and then
reach `manifest.files.map` a few lines later, where they throw a raw
TypeError instead of returning either named conflict. That reaches the
user as a one-line exit 2 with a runtime message, which is the pre-fix
behaviour the rest of this section describes as fixed; it is not, for
this shape of file. `recordedHookSha` (src/init-manifest.ts:151-153) makes the same
shape assumption on the init side, and that one predates this release.

`revertInit` used to parse that file with a bare `JSON.parse` and no
guard, so a corrupt manifest made `--revert` throw. The throw was caught
in `main` and printed as one line with exit 2 (src/cli.ts:827-843), so
nothing leaked a stack, but the message was a JSON parser's: a user whose
manifest was truncated by a crash or a bad merge got `Unexpected end of
JSON input` and no indication which file was unreadable or that the fix
is to repair or delete it by hand. Nothing pinned it, because every test
that touched the manifest wrote valid JSON back. Now pinned by
tests/init.test.ts:1170.

## The gates are installed without scripts, and verified before they are trusted

The four packages this action installs are CONTROL INPUTS: they decide whether a
pull request may merge. Two properties follow, and both are properties of the
install step rather than of any gate.

`--ignore-scripts`, because the step runs on a runner holding the job's token.
Without it every package in the resolved tree gets arbitrary code execution
there on every run, which is a strange amount of trust to extend from the tools
whose job is deciding whether this repository can be trusted. Checked against
the real registry rather than assumed to carry over from one gate: all four
install and report their own versions correctly with the flag set.

A ROOT MANIFEST, and it is load-bearing rather than tidiness. `npm audit
signatures` audits the tree's EDGES OUT, and a global install leaves
`<prefix>/lib` with a `node_modules` and no manifest, so the root declares
nothing and the four packages just installed sit on the far end of no edge.
Without it the audit covers their dependencies and SKIPS ALL FOUR GATES.
Measured on this exact tree: 32 signatures and 8 attestations without the file,
36 and 12 with it, and the four missing ones are the gates. The single-package
version of this step shipped in vault-guard without the manifest and recorded
the short count as evidence that it worked.

WHAT THE VERIFICATION PROVES, narrowly, because the obvious summary is wrong. It
asks the registry for each name and version in the tree and checks the signature
served back. It does NOT read the installed files, so a tampered install is
invisible to it. It does NOT defeat a compromised registry, which signs what it
serves. And a MISSING attestation is not a failure, only a missing or invalid
signature is, so it does not require provenance despite all four packages
publishing it. What remains is that every name and version in the tree, gates
included, has to be one npmjs currently serves with a valid signature.

THE CLIENT HAS A FLOOR, AND IT IS npm 10.5.2. `npm audit signatures` is not
version-stable: below 10.5.2 it fails on a CLEAN install of these very
packages, because the client's bundled keys and TUF root are stale. On 10.5.0
it says "Someone might have tampered with these packages", naming ours; on
10.2.4 it is `EEXPIREDSIGNATUREKEY`. Bisected against a real four-gate install,
with a cold cache and a fresh home so no newer client could have primed the TUF
root or the key set: 8.19.4, 9.9.4, 10.2.4, 10.5.0 and 10.5.1 fail; 10.5.2 and
later pass, and 10.5.2 verifies the same package and attestation counts as
current npm rather than a reduced set. That band maps to Node 18.19.x and 20.10
through 20.12. An earlier draft of this paragraph put the floor at 10.6.0, from
a bisection that tested 10.5.0 and then 10.6.0 and never tested what lay
between: Node 20.13.0 and 20.13.1 ship npm 10.5.2, so that floor refused
working clients while telling them they could not verify.

**A BARE MAJOR DOES NOT CLEAR THE FLOOR.** Node 22.0.0 ships npm 10.5.1, inside
the failing band, and `setup-node` satisfies a major-only spec from the runner's
tool cache when it can. The sibling actions pin `node-version: '22'` and still
carry this floor for that reason: an earlier version of that wave left it out on
the grounds that the pin covered it, and it does not.

The floor extracts the first version-shaped token rather than validating the
string and then splitting it. A `grep -Eq` shape check matches PER LINE while
the arithmetic reads the WHOLE string, so a client printing an upgrade notice
above its version passed the check and then failed the comparison, leaving the
floor skipped. That shipped twice here. An output with no version in it is
refused, because a guard that fails open when it cannot see is not a guard.

KNOWN CONSEQUENCE OF FAILING CLOSED: a runner pointed at a mirror or proxy that
does not serve `/-/npm/v1/keys`, or a sigstore outage, installs fine and then
fails this step with `EMISSINGSIGNATUREKEY`. Documented in the README rather
than left to be discovered from a red required check.

**Enforced by:** `tests/action.test.ts`, which runs the real install script
against a stubbed npm and asserts the full argv in order (so a second npm
invocation cannot be added or removed unnoticed), that the manifest names all
four packages, and that a version override reaches the manifest as well as the
install.

A precision that matters, because the obvious reading is wrong: the audit
resolves each edge BY NAME and audits the version on disk. A manifest declaring
a wrong or nonexistent version still audits the installed one and exits 0, and a
manifest naming a package that is not installed is skipped silently, also
exiting 0. So the NAMES are what make the check cover the gates; the version
assertions keep the file from drifting away from the install, and are not
themselves a security property. The stub is npm, so these prove the action ASKS; the counts
above are what a real npm does.

## On a pull request, no version input may pin BACKWARD

New in the v0.4.3 action tag. The shape check above asks whether each of the
four inputs is an exact version. It says nothing about WHICH one, and it is not
the control for version choice. On a same-repo `pull_request` event GitHub runs
the workflow file from the HEAD, so all four inputs are written by the pull
request being judged. Once a gate has two published versions that is a bypass
with an innocent shape: deleting a control reads as deleting a control, while
`intent-guard-version: 1.4.0` reads as version management. It is not
hypothetical here, because this tag ships intent-guard 1.8.1 and 1.4.0 is
published.

So where `GITHUB_BASE_REF` is non-empty the validate step refuses any of the
four inputs naming a version BELOW the one this action tag ships, and accepts
anything at or above it. Pinning FORWARD stays allowed, which is the direction
the inputs exist for. That rests on an ASSUMPTION the rule does not enforce:
that a newer gate is at least as strict. Nothing bounds a forward pin, so a
version ahead of the tag's is accepted whatever its rules turn out to be.

Five properties, each load-bearing:

- `TAG_<GATE>_MAJOR/MINOR/PATCH` in `action.yml` are SEPARATE constants from any
  floor, and must not be merged with one even where they hold the same number.
  `TRUST_BASE_MIN_VERSION` in `src/gate-runner.ts` is the oldest build of each
  gate conductor runs on a pull-request run, however it was installed; a
  build below it is could-not-run there. The TAG constants are the tested
  versions this TAG ships. One constant serving both is how raising one
  silently raises the other. As of v0.13.2 the two differ for dep-guard (TAG
  constant 0.16.1, floor 0.10.1), vault-guard (TAG constant 1.12.1, floor
  1.9.1) and intent-guard (TAG constant 1.10.1, floor 1.8.1); a tag that ships
  a newer gate raises the TAG constants and need not raise the floor.
- The comparison is against those hardcoded constants, never against anything
  derived from an input. An input looks identical whether a consumer pinned the
  current version or the default supplied it, so the step cannot tell a pin from
  a default; the constant is the only source of truth. It is trustworthy because
  `action.yml` comes from the ref the consumer's workflow names, not from the
  pull request's tree. That holds for `vaultcompasshq/conductor` at a ref and
  NOT for a local-path reference, which reads `action.yml` out of the pull
  request's own tree. This repository's own workflows do not use the action.
- One comparison function, called four times. Four hand-written copies would be
  four places for one to drift into a weaker shape, on a check where the weaker
  shape is the failure.
- The event test is `GITHUB_BASE_REF` being non-empty, the same one the run step
  uses to decide whether to pass `--trust-base`, rather than a second detector
  to keep in step. A same-repo pull request's author writes the workflow file, so
  the obvious bypass is `env: GITHUB_BASE_REF: ""` at job level, and TWO separate
  things close it. First, the validate step DECLARES
  `GITHUB_BASE_REF: ${{ github.base_ref }}` in its own `env:` mapping, the same
  spelling the gates step uses. A step-level entry wins over a job-level one, and
  `github.base_ref` is read out of the event payload rather than out of anything
  the workflow author writes, so the value cannot come from the workflow file.
  Second, as a further line of defence the step does not depend on, GitHub
  documents that the default `GITHUB_*` and `RUNNER_*` variables cannot be
  overwritten and that such an assignment is ignored
  (https://docs.github.com/en/actions/reference/workflows-and-actions/variables).
  The guarantee is recorded here as a second, separate line of defence, not as
  the sole control either form is depended on. The declared form is defense in
  depth and is stronger than a bare read of the runner default, because its
  value comes from the event payload rather than from anything a workflow
  author can write, but it is not absolute immunity: a job-level
  `env: BASH_ENV: <a file>` that runs `unset GITHUB_BASE_REF` would still
  defeat it, because BASH_ENV is sourced before the step script runs and is
  not itself one of the GITHUB_*/RUNNER_* variables the no-overwrite guarantee
  covers.
- Written accept-only-if, not refuse-if, for the same reason as the npm floor:
  `[` exits 2 on a malformed or out-of-range comparison and an `if` reads 2 as
  false, so a refuse-if shape turns an arithmetic error into permission.

**What this does NOT cover, stated because the obvious summary is wider than the
rule.** It closes pinning backward on a SAME-REPO pull request, and nothing
else.

- Not forks, and on forks the rule costs something rather than merely doing
  nothing. A fork's `pull_request` run uses the BASE repository's workflow file,
  so a fork author never writes the pins that judge them and there is no hole
  there to close. But `GITHUB_BASE_REF` IS set on a fork pull request, so the
  check fires anyway and judges the base repository's own trusted workflow file.
  A maintainer's deliberate backward pin there fails EVERY fork pull-request
  run: a false refusal, on a pin nobody untrusted wrote. The remedy is the same
  as for any consumer, which is to remove the input.
- Not a pull request that deletes the step, moves the `uses:` pin to an older
  action tag, or edits the job away. Those are workflow-file edits, and the
  control is branch protection on the base branch with review required for
  `.github/workflows`. Nothing in `action.yml` can substitute for it, and this
  entry claims no more than the rest of this file does about that boundary.
- Not push events. The rule fires exactly where `GITHUB_BASE_REF` is set, which
  is `pull_request` and `pull_request_target`; push runs are out of scope and
  the shape check remains their only version gate. Read that as SCOPE, not as
  safety: a push to an UNPROTECTED branch runs that branch's own workflow file,
  written by the same author, with `GITHUB_BASE_REF` empty, so it is as
  author-controlled as a pull request and the rule does not cover it.
- Not `merge_group` events. `GITHUB_BASE_REF` is set on `pull_request` and
  `pull_request_target` only, so on a merge-queue run it is empty and the check
  does not fire, while the merge-queue branch carries the pull request's commits
  and its workflow file. A consumer whose ONLY required check runs on
  `merge_group` therefore gets nothing from this rule. Where the `pull_request`
  run is also required, it still catches the pin before the queue is reached.
- Not the version the gates are compared against being right. The constants say
  what this tag ships, not what is good.

**Enforced by:** the `refuses a pull request that pins a gate backward` cases in
`tests/action.test.ts`. EVERY ONE of the four inputs has real published versions
below its constant, so the UNMODIFIED step refuses real pins today and the cases
say so with real numbers: `conductor-version: 0.3.0`, `dep-guard-version: 0.5.0`,
`vault-guard-version: 1.6.0` and `intent-guard-version: 1.4.0` are each driven
through the shipped step text and refused on a pull-request run, and accepted
with `GITHUB_BASE_REF` unset. There are 68 such pins: the registry count of
2026-10-04 (13 conductor versions below 0.8.0, 12 dep-guard below 0.10.0, 27
vault-guard below 1.9.0 and 10 intent-guard below 1.8.0) plus the versions each
constant has since passed (0.8.0; 0.10.0, 0.10.1 and the withdrawn 0.11.0;
1.9.0; 1.8.0), giving 14, 15, 28 and 11. Because every constant ends in patch 1,
the same-minor lower-patch arm of the comparison is driven on the unmodified
step by each gate's patch-0 release.

A second set of cases drives a COPY of the step with one constant advanced a
minor version, which is the action as it will be the day a newer gate ships.
That device is there to prove DRIFT-FORWARD behaviour, that the comparison
follows the constant rather than a number frozen into the test, and not because
the rule would otherwise be unobservable. Each copy asserts the replacement
MATCHED, so deleting or renaming a constant turns those red rather than quietly
re-testing the unmodified step. Plus a drift case tying each constant to its
input's default, a `1.10.0` case on the accepted side that a lexicographic
comparison would refuse, a case asserting the step declares
`GITHUB_BASE_REF: ${{ github.base_ref }}` in its `env:` mapping, and a text case
pinning the accept-only-if shape and the event gate in order.

## The pull-request trust boundary: the rules come from the base ref

New in 0.3.0. Every gate reads its own rules out of the repository it is
judging, and on a pull request the author controls that repository. The
umbrella's version is the sharpest in the family because its policy file
can name a program to run: one commit could point a gate's `command:` at a
script the same commit added, or set `enabled: false` on the gate that
would have caught what else was in it, and the report said the run was
clean. The gate ran. It ran the pull request's own program under the pull
request's own rules.

With `--trust-base <ref>` the policy is read from that ref and the head
tree is judged against it (`policyForRun` in src/cli.ts, reading through
`readFileAtRef` in src/trust-base.ts). THE HEAD'S POLICY FILE IS NEVER
PARSED INTO THE RUN THAT DECIDES in that mode, which is the whole of the
fix. It is read for three things, and none can change what that run does: a
comparison so the difference can be reported; when the ref itself cannot be
used, an inventory of gate names so the report can say which gates did not
run; and, when it parses, a preview policy (`previewPolicy`,
src/policy-diff.ts) that takes only `enabled`, `stage` and `enforce` from
it, for the preview under the proposed rules, which decides nothing (see the
subsection of that name below). Pinned by tests/policy-diff.test.ts ("takes
only enabled, stage and enforce from the head"). For the comparison and the
preview the head file is parsed into a local variable of `policyForRun`, and
that parsed document is used by `diffPolicies` and `previewPolicy`
(src/policy-diff.ts) and by nothing else: it is never handed to the run that
decides the exit code, the verdict token and the report's first four lines,
and a head that will not parse gives null, not an error.

READS ONLY, AND NEVER INTO THE REPOSITORY: `git rev-parse`, `git show-ref`,
`git rev-list`, `git ls-tree` and `git cat-file`. No checkout switch, no
worktree, no stash, no write of any kind (the header of src/trust-base.ts
states the rule; `resolveRev` and `readFileAtRef` are the readers). An
umbrella that moved somebody's HEAD to do its job would be a worse bug than
the one it fixes.

ONE READER FOR A FILE AT A REF, AND ABSENT, FILE AND ERROR KEPT APART.
`readFileAtRef` looks the path up in the ref's tree with
`git ls-tree <ref> -- ./<path>` and reads the blob by id with
`git cat-file blob`, so a file name is never read as part of a revision. A
listing that succeeds and names nothing is absent; a failed listing, an
entry that is not a regular file (a symlink, a directory, a submodule), a
symlink or submodule at any directory above the path, and a blob git cannot
return are each an error. No
caller turns an error into empty text or a default: the base policy read
refuses the run with the true reason (`policyForRun`), and an external
tool's base config, ignore file or extended file throws
`ExternalConfigError`, so the neutral config is used only when the base
carries none, and the proposal line then says the neutral stand-in was used
rather than the base copy (`materializeExternalConfig`). Every git-calling
function in src/trust-base.ts and `changedPathsSince` refuses a dash-leading
revision itself and ends its revisions with `--` where the command takes
paths; `--end-of-options` is not used. Pinned by tests/trust-base.test.ts
("reads the right file when the working tree holds a file named like the
revision and path"), tests/trust-base.test.ts ("answers error, never absent
or empty, for a symlink entry"), tests/trust-base.test.ts ("answers error
when the tree lists a blob git does not have"), tests/cli.test.ts ("refuses
with the true reason when the base policy cannot be read, never as absent"),
tests/gate-runner.test.ts ("is could-not-run, and never spawns gitleaks,
when the base config exists but cannot be read"), tests/intent-base.test.ts
("lists the change when the working tree holds a file named like the range")
and tests/trust-base.test.ts ("keeps the first-parent exception when the
base carries a file named HEAD"). Every such refusal for the policy, an
external tool's config or the intent contract ends with how it is cleared
(`unreadableBaseRemedy` in src/trust-base.ts): make the file a regular file
on the base branch, merged by someone allowed to merge without this check,
since the fixing pull request is judged against the same base. Pinned by
tests/trust-base.test.ts ("answers error, never absent, for a path below a
symlinked or submodule directory") and tests/intent-prepare.test.ts ("is
could-not-run at contract-source, with the remedy, when the base state
directory is a symlinked directory").

ON A RUN WITH A TRUST BASE, PATH HOLDS ONLY ABSOLUTE ENTRIES, AND CONDUCTOR'S
GIT IS OUTSIDE THE WORK TREE. Before any git call the CLI removes empty and
relative PATH entries, for itself and for every child, and prints one
notice naming them. It then pins git to the first git on PATH whose real
path is outside the work tree (found without running git, and checked again
against the root git reports); with none, the run is could-not-run, saying
to put git's own directory on PATH (`pinPathForTrustBase` in src/cli.ts,
`pinGitOutside` and `runGit` in src/git.ts). Every conductor git call runs
that program, the two startup calls that find the repository root
included, and sets GIT_NO_REPLACE_OBJECTS. An absolute PATH entry inside the
tree is kept for gates, which the program check governs. A gate that can
then no longer be found is the ordinary gate-missing outcome. Runs without
a trust base keep PATH as given. Pinned by tests/git.test.ts ("pins an
absolute program, so a git that appears on PATH afterwards never runs"),
tests/git.test.ts ("skips a git whose real path is inside the excluded work
tree, including through a symlink"), tests/cli.test.ts ("never runs a git
the pull request committed through an empty PATH entry, and says what it
removed"), tests/cli.test.ts ("pins the first git outside the repository,
skipping one an absolute PATH entry finds inside it"), tests/cli.test.ts
("is could-not-run, saying how to clear it, when the only git on PATH is
inside the repository") and tests/cli.test.ts ("leaves PATH alone on a run
without a trust base").

ON A RUN WITH A TRUST BASE, THE FIRST PATH ENTRY OF EVERY CHILD IS A PRIVATE
DIRECTORY HOLDING ONLY THE PINNED GIT. After pinning git, the CLI creates a
fresh mode 0700 directory under the system temp directory with one entry,
`git`, a symbolic link to the pinned program, and puts it first on PATH for
itself and every child, so a gate, or anything a gate starts, that runs git
by name runs the pinned git even when an absolute PATH entry inside the
tree holds a git. The directory is removed when the run ends, on success,
on a gate failure and on a failure before any gate runs. A temp directory
inside the work tree, or one where the directory cannot be made, is
could-not-run naming TMPDIR; there is no fallback to the unprotected PATH.
On Windows no directory is made and the gates look git up through the
cleaned PATH (`createGitShim` and `removeGitShim` in src/git.ts,
`pinPathForTrustBase` in src/cli.ts). Pinned by tests/cli.test.ts ("runs the
pinned git for a gate that looks git up through PATH, never one an absolute
in-tree entry finds first"), tests/cli.test.ts ("leaves PATH unchanged for
a gate on a run without a trust base"), tests/cli.test.ts ("removes the
private git directory when a gate fails"), tests/cli.test.ts ("removes the
private git directory when the intent preparation fails"),
tests/cli.test.ts ("is could-not-run, saying what to set, when the temp
directory is inside the repository"), tests/git.test.ts ("holds exactly one
entry, git, linked to the pinned program, in a directory only its owner can
enter"), tests/git.test.ts ("refuses, saying why and what to set, when the
directory cannot be created") and tests/git.test.ts ("makes nothing on
Windows, where the gates look git up through the cleaned PATH").

A PULL-REQUEST JOB IN ACTIONS WITH NO TRUST BASE IS REFUSED. With
GITHUB_ACTIONS and GITHUB_BASE_REF set and no `--trust-base`, the run is
could-not-run, and the message names the ref to pass, the Action, and the
pre-commit hook run in a pull-request job (`policyForRun` in src/cli.ts).
Outside Actions the same situation prints one notice and the run goes on.
Pinned by tests/cli.test.ts ("is refused, exit 2, in GitHub Actions, naming
how to clear it") and tests/cli.test.ts ("only prints a notice outside
Actions, and the run goes on as before"). The reports then say this is a
pull-request job, no trust base was given and no rules were read
(`RunTrustBase.notGiven`), and never name a ref or print a proposal count.

THE PROPOSAL COUNT NEVER COUNTS A GATE THAT COULD NOT RUN AS ZERO
(`proposalCount` in src/output-text.ts). On a trust-base run a gate that
could not run is named as "not known" whether it stopped after its
pull-request mode was decided or before (a failed preparation, a git older
than the floor, a missing binary). Pinned by tests/intent-run.test.ts
("names the intent gate as not known rather than counting zero") and
tests/gate-runner.test.ts ("is a named could-not-run, enforced, when git is
older than 2.31, and gitleaks is never spawned").

THE GIT FLOOR IS WHERE THE OPTION IS. The newest git option conductor
relies on is the one it hands gitleaks, `git log --diff-merges` (git 2.31,
per git's release notes); every option conductor passes itself is older
(rev-parse --is-shallow-repository is git 2.15). So on a trust-base run a
gate that reads history asks git for its version once, and a git older
than 2.31 makes that gate a named could-not-run, enforced, before it is
spawned; a run with no such gate is not probed (`probeGitVersion` and
`HISTORY_GIT_FLOOR` in src/gate-runner.ts). Pinned by
tests/gate-runner.test.ts ("is a named could-not-run, enforced, when git is
older than 2.31, and gitleaks is never spawned") and
tests/gate-runner.test.ts ("does not probe on a run without a trust
base").

A CHANGE TO THE RULES IS PROPOSED, NOT REFUSED. Rules legitimately change,
and a gate that blocked every such pull request would train people to
bypass it, so a differing policy is reported and the run continues under
the base ref's rules. The report names each changed key as its own line
(`policy: gates.dependencies.enabled true -> false`), built by `diffPolicies`
and `policyChangeLine` in src/policy-diff.ts from the parsed base and head,
before any `--gate` override so an override is never a policy change. A head
that is absent or will not parse gives one line saying its changes are not
known. When the list of keys is empty or absent on a changed policy, the
single `POLICY_PROPOSAL_LINE` in src/trust-base.ts is kept. The
comparison is of PARSED DOCUMENTS, so a reflow or a re-quote is not a
proposal (`policyDiffers` in src/trust-base.ts); when either side
will not parse the raw text is compared instead, which is the fail-closed
direction. Both sides are read from git through the one reader,
`readFileAtRef` (`git ls-tree` then `git cat-file`), base and head alike,
because intent-guard learned the other way: it read its head side from the
working tree with a call that follows symlinks, so a pull request that
replaced a control file with a link compared equal and was reported as
changing nothing.

Proposals are summed and never counted as findings (`ControlProposal` and
`collectProposals`, src/run.ts:132-138 and 464-488). The sum counts one per
changed policy key, so five changed keys are five control changes. Nothing there reaches a
severity, a fingerprint, a summary or the exit code, and that is
deliberate: a pull request is ALLOWED to propose changing the rules.

IT FAILS CLOSED SIX WAYS, all mirroring intent-guard's own refusals so
the two gates give one answer to one mistake (`refuseTrustBaseRef`,
src/trust-base.ts:275-335): a ref that starts with a dash, a ref that is
ambiguous, a ref that will not resolve, a HEAD that will not resolve
(src/trust-base.ts:293-300), a ref that resolves to the head
commit, and a different commit carrying the head's tree. The
last two are not hypothetical typos. On a `pull_request` event
`github.sha` IS the merge commit, which is HEAD, and what GitHub publishes
as the merge ref carries the head branch's tree whenever the base has not
moved since the fork.

Each of the six makes every enabled gate could-not-run and exits 2
(`refusedTrustBase`, src/run.ts:395-438). TWO THINGS THERE ARE DELIBERATELY
NOT READ OFF THE POLICY, because the policy in hand is the head's:
`enforce` is forced true on every synthesized outcome, since enforcement is
itself a control input living in the file that could not be read; and the
exit code is WRITTEN rather than composed, since a head policy enabling no
gate at all would compose to 0 over an empty list and report a run that
checked nothing as a clean one.

AND THE REFUSAL IS CARRIED ON THE RESULT, so both renderers lead with it
before any question about how many gates there are (`RunTrustBase.refusal`,
src/run.ts:134-153). That is not tidiness. The gate list on a refused run is
the HEAD's, because the base policy is the thing that could not be read, and
a head that switches every gate off, or that will not parse, leaves it
empty. Both reports asked the gate-count question first and fell straight
through: the text verdict printed "exit 0, no gate ran because none is
enabled. Set enabled: true", and SARIF emitted `{"runs": []}` with
`executionSuccessful` absent, while the process exited 2 and nothing had
been checked. An empty log uploads cleanly and is indistinguishable from a
scan of a repository nobody gated. Reachable through the CLI on the DEFAULT
actions/checkout, which fetches depth 1 and so carries no base ref. (The
Action now fetches the base ref itself, so on the Action a depth-1 checkout
reaches the shallow-history could-not-run for gitleaks instead; see the
history-gate paragraph in the trust-base ref section.)

So a refusal is its own outcome in both formats: the first line, the reason,
the fetch-depth remedy and its own verdict sentence in text
(`refusalLines`, src/output-text.ts:429-438, and the branch at the top of
`verdict`, src/output-text.ts:553-567); and in SARIF it earns the umbrella
run unconditionally and raises `conductor/trust-base-refused` at ERROR level
(`trustBaseRefusedNotifications`, src/output-sarif.ts:772-787, with the
unconditional clause at src/output-sarif.ts:1016-1020).

THAT NOTIFICATION IS ONE OF TWO IN THIS PACKAGE THAT ARE NOT A NOTE. The
other is `conductor/gate-program-refused`
(`programRefusedNotifications`, src/output-sarif.ts:802-821), also at
error level, for a program the pull request controls. Every remaining
notification says how much of the policy a run covered; these two say a
gate, or the whole run, did not happen. It is
still a notification rather than a result because there is no code and no
configuration it is about, and the could-not-run results for whatever gates
the inventory did name sit beside it carrying the same sentence, so a
consumer reading only results still learns that nothing ran.
`executionSuccessful` is false on a refusal whatever the gate list says:
`every` over an empty list is vacuously true, which would have claimed the
analysis completed on the one run where nothing was attempted.

THE PROGRAM IS CHECKED AS WELL AS THE RULES, and without this the rest of
this section is worth nothing. Two shapes, both of which look ordinary in a
diff and both of which were live before 0.3.0:

  A base `command:` pointing INSIDE the repository, at something like
  `vendor/vault-guard`. The path came from the base and is approved; the
  file at that path is whatever the head put there. The umbrella runs the
  pull request's own program, is told the scan was clean, and reports a
  clean scan.

  No `command:` at all. Resolution prefers the repository's own
  `node_modules/.bin` over PATH, deliberately, so a project pin beats a
  global install (the rule two sections down). A head that commits
  `node_modules/.bin/<gate>` shadows the real gate, and a stub answering
  `--version` with a plausible number passes every other check. Through
  0.3.0 the composite action installed nothing, so the plant survived the
  install step. CLOSED ONE STEP EARLIER SINCE 0.4.0: on a pull-request run
  that location is not searched at all, so this shape no longer reaches the
  program rule below. See "The Action installs outside the tree" further
  down, which is where the description of the current behaviour lives; the
  program rule is still what catches the other two shapes, and it is still
  what would catch this one if the skip were ever removed.

A third shape defeats a per-file check on its own, and it was found by a
reviewer AFTER the first two were closed, which is the reason the unit of
approval is what it is:

  A base-approved WRAPPER. `vendor/vault-guard` is byte for byte what the
  base approved and is the path the policy names; it execs `vendor/impl.sh`,
  which the head rewrote. Nothing in the diff touches the path the policy
  names. Measured before the fix: exit 0, secret missed, zero proposals. The
  same shape reached `trust-base-unverified` with `enforce: false` and exit 0
  when the replaced helper exited 3 on `--version`.

The rule (`refuseHeadControlledProgram`, src/trust-base.ts:714-802, called
from src/gate-runner.ts:984 and, for the intent gate's preparation, from
src/run.ts:456-470): a program OUTSIDE the working tree is
accepted, since a pull request cannot write it, UNDER THE PRECONDITION that no
code from the pull request ran earlier in the same job (a lifecycle script
from an earlier install can write the runner's temp directory or PATH; see
the install entry). A program inside is accepted
only when BOTH hold: it is a tracked regular file whose blob is identical at
the trust base and at HEAD, AND the tree object id of its CONTAINING
DIRECTORY is identical at those two refs. Both sides come from `git ls-tree`
and neither from the working tree, so an uncommitted edit cannot make a file
look approved.

WHAT IS VETTED IS THE PROGRAM FILE AND EVERYTHING IN ITS DIRECTORY SUBTREE,
and nothing else. A tree object id covers the whole subtree in one
comparison, so this needs no knowledge of what a wrapper calls. Anything the
program reaches OUTSIDE that directory is NOT vetted, which is a real limit
rather than a hedge: an in-repo gate has to be self-contained within its own
directory, and that is stated in the README in those words because an
adopter has to be able to satisfy it.

A PROGRAM AT THE REPOSITORY ROOT IS REFUSED, with a message saying to give it
a directory. At the root the containing directory is the whole repository, so
the comparison is the root tree and every pull request that changed anything
differs, which is every pull request. Refusing with the remedy beats a rule
that silently means "no pull request may change anything". (The root trees
also cannot be equal by the time this runs: `refuseTrustBaseRef` has already
refused a base whose tree matches HEAD's.)

A SYMLINK INSIDE THE REPOSITORY IS REFUSED ON ITS OWN ENTRY, before its
target is considered: it is either untracked, or its tree entry is a link
rather than a regular file, and either one refuses. The TARGET is vetted too,
and that is what catches a link whose own path is outside the tree pointing
into it; it never decides the in-repo case. An earlier wording here said the
symlink was "followed and its target vetted", which reads as accepted when
the target is fine, and was doubly wrong: it described a check the code does
not make, and on a machine whose working tree sits under a symlinked mount
the link's own entry was not being vetted at all (see `withResolvedParent`,
src/trust-base.ts:625-628). The repository root arrives realpath'd and the
program path did not, so the link's own spelling compared as OUTSIDE the tree
and was skipped in silence. Pinned now by tests/cli.test.ts ("refuses an in-repo symlink on its own entry, before the target matters").

IT RUNS BEFORE THE VERSION PROBE, and that ordering is the whole of it: the
probe RUNS the program (called at src/gate-runner.ts:1087, after the check at
947), so checking provenance afterwards would already have executed the
plant. A stub answering `--version` with a plausible number is the cheapest
form of this attack.

NOTHING UNDER `node_modules` IS EVER BASE-APPROVED, and this is the correct
answer rather than a limitation of the check. What is there is chosen by the
head's own manifest and lockfile and installed by a step that runs before
the gates, so git has no record of those bytes at either ref and `ls-tree`
finds nothing. A pull request that edits its lockfile to pull a different
build of a gate has chosen its own judge as surely as one that commits a
stub. Vendoring still works, as long as the pull request does not change it.

SINCE 0.4.0 THE RULE IS NEVER ASKED THAT QUESTION, because resolution does
not offer it a `node_modules` program on a pull-request run
(`skipNodeModules`, src/resolve.ts:190-205, decided at
src/gate-runner.ts:910-911 from whether a trust base is set). The answer would
be the same refusal every time, and that was the defect: correct, and it
turned every ordinary pull request in a repository whose gates are
devDependencies into three refusals and exit 2. The paragraph above still
states the rule, because the rule is what makes the skip safe rather than a
weakening: the skip removes a location whose every answer was "refused",
and it removes nothing the check would have accepted.

BOTH PULL-REQUEST-MODE REFUSALS ARE ENFORCED WHATEVER THE POLICY SAYS
(src/gate-runner.ts:455 for a refused program, src/gate-runner.ts:1143 for an
unverifiable version). `enforce: false` is a standing decision about what a
gate's FINDINGS are worth, and neither of these gates produced any: the
umbrella declined to run at all. Letting an unenforced gate swallow the
program refusal would let a pull request pick its own judge and keep the run
green, and that was reachable: through the wrapper shape, a head-replaced
inner script exiting 3 on `--version` landed on the version refusal with
`enforce: false` and exit 0. The directory rule closes that path, so what is
left on the version side is a packaging problem, and one that fails a build
loudly beats a boundary that quietly downgrades itself on the runs where
something is already wrong.

THERE ARE FOUR PLACES ENFORCEMENT IS OVERRIDDEN IN THIS PACKAGE, and earlier
wordings here said two and then three, each of them false the day it was
written. Three are per-gate. A refused PROGRAM, written once in
`gateProgramRefused` (src/gate-runner.ts:445-468) and returned by both the places
that can refuse one, `runGate` and the intent gate's preparation. An
unverifiable VERSION (src/gate-runner.ts:1143). And an intent PREPARATION that
failed under a trust base (src/run.ts:501), which arrived with the
preparation check above: a pull-request run whose intent gate could not be
prepared is one where nothing judged the intent, and reading the flag there
let a base policy carrying `enforce: false` report the failure and still exit
0. The fourth is the whole-run one: `refusedTrustBase` synthesizes every
enabled gate as could-not-run with `enforce` forced true (src/run.ts:361),
because the policy in hand there is the HEAD's and `enforce` is itself a
control input living in the file that could not be read. All four are the
same reasoning applied at two scopes, which is why the miscount keeps
happening: the gate that could not be judged, and the run that could not be
judged. Nothing else reads a gate's output and decides to ignore the policy.

THE PASS-DOWN IS CAPABILITY-GATED PER GATE (`TRUST_BASE_MIN_VERSION` and
`decideTrustBase`, src/gate-runner.ts:207-270, decided after the
version probe and before the command line is built at
src/gate-runner.ts:1121).
The flag goes only to a build at or above its entry in the table, and ON A
RUN WITH A TRUST BASE A BUILD BELOW ITS ENTRY IS COULD-NOT-RUN, reason
`gate-version-unsupported`, enforced whatever the policy says: running it
without the flag would let it take its rules from the tree being judged.
The message leads with what happened and ends on the fix (install the named
minimum or newer, or remove an explicit older version pin). Without a trust
base nothing about the version changes. The flag is withheld, with the run
continuing, in one case only: an intent gate judging a contract imported
from the base into a temporary directory, because the flag names a git ref
and the gate resolves it against its own `--project`, where there is no
repository. That case is decided after the version checks, so it cannot
let an older gate run. Pinned per family gate by the cases generated over
the three family products in the two trust-base describe blocks of the
gate-runner tests, by tests/gate-runner.test.ts ("refuses an intent-guard below the minimum
even when the contract was imported") and by tests/run.test.ts ("runs no
gate below its minimum through a whole run, and exits 2 for it").

The table holds all five: dep-guard at 0.10.1, intent-guard at 1.8.1,
vault-guard at 1.9.1 (raised in 0.8.1 from the releases each first took
`--trust-base` in, 0.6.0, 1.4.0 and 1.7.0, to the releases that close the
gates' own pull-request gaps), gitleaks at 8.19.0 and osv-scanner at 2.0.0. For the
two external tools the entry is their command-line floor (the same value as
`minVersion` in src/products.ts), not a flag floor: they are never handed
`--trust-base`, and being in the table is what makes an unreadable version
a refusal on a pull request. A build below the floor never reaches the
decision, because the floor check at src/gate-runner.ts:1089-1113 returns
`gate-version-unsupported` first. It stays a TABLE: a new role can arrive
without an entry, and the "no pull-request mode yet" branch is what keeps
that gate from being handed a flag it would reject.
That branch is unreachable by any gate this package knows today and is kept
for the next one, which is the honest description of it.

FOR A PRODUCT IN THE TABLE, AN UNREADABLE VERSION IS COULD-NOT-RUN, not a
downgrade (src/gate-runner.ts:252-260). A gate in the table is one this
repository expects to be inside the boundary, and a probe that fails leaves
that unestablished for an unexplained reason; running it anyway would put it
quietly outside the boundary on exactly the runs where something is already
wrong. For a product outside the table nothing is unknown and the withheld
line stands. The two are separate for that reason and not for symmetry.

WITHHOLDING IS NEVER SILENT. A gate that was not handed the base ref gets a
line in the full report, a clause on the clean one-line summary, and a
`conductor/trust-base-not-passed` notification (`withheldTrustBase` and
`trustBaseLines` in src/output-text.ts, and
`trustBaseWithheldNotifications` in src/output-sarif.ts). The one exception
is a preview gate: dep-guard and vault-guard are not handed `--trust-base`
in the preview (`PREVIEW_WITHHELD`), and that withholding is not stated per
gate, because preview outcomes are never in `result.gates`, which is what
both renderers read. What the reader sees instead is the preview header,
which says the block runs under the proposed rules and does not affect the
verdict. That dep-guard and vault-guard read their head control files in
that block is the preview's definition, not a per-gate statement.

Both new SARIF statements are NOTIFICATIONS by the discriminator further
down this file, and neither is a close call once that rule is applied. A
proposed control change is a statement about configuration: nothing went
wrong, it did not take effect, and it stays true of every push to the
branch until it merges, so as a result it would be a fingerprint-less alert
reappearing on every run. A gate that was not handed the base ref is a
coverage statement in the same shape. A third notification joins them, the
preview under the proposed rules: `conductor/preview-under-proposed-rules`,
level note, one per previewed gate, on the umbrella's run only. It adds no
run, result, rule, fingerprint or category, and never changes
`executionSuccessful`. Pinned by tests/output-sarif.test.ts ("a run with a
preview renders SARIF whose runs, results and partialFingerprints deep-equal
the same run without it, apart from umbrella notifications").

Pinned at four levels. The decisions: tests/trust-base.test.ts, against real
git repositories rather than a mock. The capability gate:
tests/gate-runner.test.ts, under "deciding whether a gate can be put into
pull-request mode" and "the trust base on the command line and on the
outcome". The run:
tests/run.test.ts:587-653 (the refusal, including that a head policy of
all-unenforced or of no enabled gate still exits 2) and 693-877. The CLI,
against a real repository whose feature commit rewrites the policy to point
the secrets gate at a script it adds: tests/cli.test.ts:1626-1648, where the
marker file appears without `--trust-base` and does not appear with it, and
the same script does not run during the preview either, whose spawns are the
base's command under the base's policy (tests/cli.test.ts ("the head-policy
attacker script does not run during the preview"), and a base `command:`
inside the working tree is refused there, tests/cli.test.ts ("preview refuses
a base command inside the working tree")). End
to end against the real gates, tests/dogfood.e2e.test.ts:461-647. The
proposal notifications are pinned separately at
tests/output-sarif.test.ts:1877-1986, and the `Self-approval refused:` reason
at tests/normalize.test.ts:898-966.

The three additions of the fix round are pinned separately, because each of
them is a way the mechanism above was true and the REPORT of it was not:

- The refusal as its own outcome: tests/output-text.test.ts:1605 ("says
  exit 2 and the reason when the inventory names no gate at all"), 1614
  ("carries the fetch-depth remedy, which is the fix in nine cases out of
  ten"), 1618 ("leads with the refusal rather than burying it under the gate
  sections"), 1630 ("still names the gates the inventory did hold") and 1646
  ("never prints the clean one-line summary for a refusal"), and
  tests/output-sarif.test.ts:2056 ("writes the umbrella run even when there
  is no gate and no finding"), 2065 ("carries a conductor/trust-base-refused
  notification naming the ref"), 2078 ("raises it at error level, unlike
  every other notification here"), 2090 ("says the analysis did not
  complete"), 2096 ("keeps the could-not-run results for whatever gates the
  inventory named") and 2110 ("says nothing of the kind on a run that was
  not refused"). End to end through the CLI on a real repository at
  tests/cli.test.ts ("still reports the refusal when the head policy
  enables no gate at all"), tests/cli.test.ts ("writes a SARIF log with the refusal even
  when the head policy enables no gate") and tests/cli.test.ts ("reports the refusal when
  the head policy will not parse at all").
- The program rule: tests/cli.test.ts ("the program a pull-request run is
  allowed to execute"), eighteen cases on real repositories. All THREE
  attack shapes are driven BEFORE and after, so each refusal is measured
  against a run where the planted program demonstrably did execute rather
  than against an assumption that it would have. The wrapper shape is
  tests/cli.test.ts ("a base-approved wrapper whose helper the head
  replaced"), with the two directions that keep the directory rule usable
  rather than a ban on vendoring beside it: tests/cli.test.ts
  ("accepts a vendored directory the pull request left entirely alone") and
  tests/cli.test.ts ("does not refuse over a change elsewhere in the repository"). The
  mutation that matters for those two is comparing the ROOT tree instead of
  the directory tree, which reddens four.
- The version refusal and the vault-guard pass-down:
  tests/gate-runner.test.ts ("deciding whether a gate can be put into
  pull-request mode" and "the trust base on the command line and on the
  outcome"), with the summed proposal at tests/run.test.ts:738 ("sums a
  proposal raised by the secrets gate alongside the intent gate own") and
  the real gate at tests/dogfood.e2e.test.ts:862 ("takes the config from
  the base ref and reports the secret anyway") and 870 ("reports the muting
  attempt as that gate's own proposal"), which drive the sibling's built
  vault-guard through the policy's absolute `command:` and are skipped,
  with a warning, when there is no such build on the machine.

All three gates are in the table as of 0.3.0, and THE COMPOSED TEST THE
DESIGN CALLS THE ACCEPTANCE CRITERION FOR THIS WAVE NOW RUNS
(tests/dogfood.e2e.test.ts:926-1208). One fixture repository with all three
gates adopted and a frozen contract; one pull request that, in a single
commit, rewrites the contract's scope and its approval, adds
`severity_overrides` and `ignore: **` to vault-guard's config, adds an allow
entry to dep-guard's config, points conductor's own `command:` for the
secrets gate at a script the same commit adds, and carries a real-shaped
secret, a dependency name the committed fixture corpus does not know, and a
file outside the contract's scope. Without a trust base the run is green and
the pull request's own script has executed; with one, the script never runs,
all five control changes are reported as proposed, and the run blocks on the
secret, the dependency and the self-approval. It runs twice, once against the
sibling builds through `command:` and once against whatever is on PATH, and
the PATH half skips loudly when a binary is below its floor.

A GATE'S TIME LIMIT, `timeout-seconds`, COMES FROM THE POLICY THE RUN WAS
JUDGED BY: the base ref's on a pull request. Only the preview builds a
GatePolicy from the head policy on a pull-request run, and it takes
`enabled`, `stage` and `enforce` from it and nothing else: its
`timeout-seconds` is the base's, or the profile default for a head-only
role, and every preview spawn is further capped at what is left of a hard
300 s deadline and killed with SIGKILL. The run that decides parses only the
base text (`baseParsed`, src/cli.ts:499). The head text is also parsed, for
the key comparison and the preview policy only, and goes to `policyDiffers`;
on every refusal path the head's gates are reported as not run and never
spawned. So a pull request cannot raise, lower or remove its own limits; a
head-side edit is a policy proposal. Pinned through the CLI path with the
spawnSync spy by
tests/gate-runner-timeout.test.ts:307 ("a head policy raising the limit to
21600 leaves the scan at the base 10 s, as a proposal") and
tests/gate-runner-timeout.test.ts:317 ("a key only on the head leaves the
scan at the gitleaks default"), and for an invalid head value by
tests/cli.test.ts:3812 ("only in the head of a pull-request run leaves the
run on the base policy, as a proposal"). The preview twins:
tests/gate-runner-timeout.test.ts ("the preview of a gate the head switches
on keeps the base 10 s limit, never 21600"), ("the preview of a head-only
gate stays inside the 300 s budget, never the 600 s default or 21600") and
("a preview gate whose base limit is 21600 is killed when the 300 s budget
runs out").

### The preview under the proposed rules never decides anything

New with issue 100. On a pull-request run the gates whose `enabled` or
`stage` the pull request changes run once more (a role the head switches off
is skipped, not run) under a preview policy built
from the base with only `enabled`, `stage` and `enforce` taken from the head
(`previewPolicy`, src/policy-diff.ts; `runPreview`, src/run.ts), so the
author sees what the proposed rules would say. Nothing in it is an answer:
the exit code, the verdict token, `result.gates`, the SARIF runs and results
and report lines 1 to 4 are the primary run's alone. The head's policy file
is attacker-controlled input to this code path, so nine constraints hold,
one per finding of the Task 3 security review.

1. THE TRUST BASE STAYS SET; ONLY THE FLAG IS WITHHELD. Every
pull-request protection keys off `options.trustBase`: the node_modules skip,
the program refusal, the history-gate checks, forced enforce and the
intent-program refusal. A preview spawn keeps `options.trustBase` and the
`CONDUCTOR_EXPECTED_*` pins, which `gateRunOptions` passes through
(src/run.ts:620-636); no preview test sets those pins or checks forced
enforce, so those two are unpinned by a preview test. `decideTrustBase` returns `PREVIEW_WITHHELD`
for dep-guard and vault-guard only, after the version floor and the
unreadable-version refusal, so a refused gate stays refused; for those two
only the `--trust-base` argv flag is removed, and dep-guard keeps `--base`.
gitleaks and osv-scanner are never withheld and get exactly the primary
run's scope, `--ignore-gitleaks-allow` and base config. The safety of the
two withheld gates rests on neither gate's control files being able to name
a program, a network endpoint or a credential source; if either ever can,
preview spawns of that gate must strip CI tokens from the environment.
Pinned by tests/gate-runner.test.ts ("withholds only the flag, for dep-guard
and vault-guard only, in the preview"), tests/gate-runner.test.ts ("refuses
a gate below its floor or with no readable version in the preview exactly as
in the primary run"), tests/gate-runner.test.ts ("keeps --base for dep-guard
when the preview withholds --trust-base"), tests/run.test.ts ("preview omits
--trust-base only for dep-guard and vault-guard"), tests/run.test.ts
("preview hands gitleaks and osv-scanner the same trust inputs as the
primary run") and tests/run.test.ts ("preview of a family gate keeps the
node_modules skip and refuses a head-controlled program").

2. THE PREVIEW HAS A HARD 300 SECOND DEADLINE. A head control file can make
a gate slow without running code (dep-guard's `online` with a large budget,
vault-guard's `extra_patterns_unsafe`), and a gate has up to three spawns.
Each preview spawn's timeout is the smaller of the gate's base limit and
what is left of the budget (`PREVIEW_BUDGET_MS`, src/run.ts), is killed with
SIGKILL, and a spawn with no budget left is not started; the gates left
over are listed as over budget. Preview spawns get a fresh temporary
`XDG_CACHE_HOME`, removed afterwards, so dep-guard's online cache cannot
persist on a self-hosted runner. Pinned by tests/gate-runner.test.ts
("gives a preview spawn the smaller of its limit and the budget left, and
SIGKILL"), tests/gate-runner-timeout.test.ts ("a preview gate whose base
limit is 21600 is killed when the 300 s budget runs out"),
tests/gate-runner-timeout.test.ts ("preview spawns get a temporary
XDG_CACHE_HOME and SIGKILL, and primary spawns get neither") and
tests/run.test.ts ("stops the preview at the budget and lists the rest as
over budget").

3. A THROW IN THE PREVIEW CANNOT CHANGE THE RUN. Reports are written only
after `runAll` returns, so a throw in preview code would otherwise land in
the CLI catch as exit 2 with no report. Every preview entry point (the pass
in `runAll`, its text block, its SARIF notifications, its log lines) runs
inside `guardPreview` (src/run.ts), and a throw becomes one printed preview
line and `RunResult.preview.threw`. The exit code, the findings and the
summary are computed before the preview runs and nothing reads it back. The
Action's render-step fallback runs with the preview off, and the README
tells adopters to give the step `timeout-minutes` of at least the primary
run's need plus 300 seconds. Pinned by tests/run.test.ts ("a preview that
throws leaves the exit code, the verdict token and lines 1-4 identical to
the run without it"), tests/run.test.ts ("never lets a blocking or
could-not-run preview gate change the primary result", blocking half), and for a
could-not-run preview gate, tests/gate-runner-timeout.test.ts ("a preview gate
whose base limit is 21600 is killed when the 300 s budget runs out") and
tests/cli.test.ts ("preview refuses a base command inside the working tree"),
both of which end in exit 0, and
tests/action-pr-comment.test.ts ("never passes --preview from the render
step, so the fallback run has the preview off").

4. PREVIEW OUTCOMES NEVER BECOME SARIF RUNS OR RESULTS. SARIF has one run
per entry of `result.gates`, and `executionSuccessful` and the exit code come
from the same outcomes, so appending preview outcomes there would create
duplicate alerts and flip both. They live in `RunResult.preview` and render
only as note-level `toolExecutionNotifications` on the umbrella's run, never
creating that run on their own: no new run, result, rule, fingerprint or
category. Pinned by tests/output-sarif.test.ts ("a run with a preview renders
SARIF whose runs, results and partialFingerprints deep-equal the same run
without it, apart from umbrella notifications"), tests/output-sarif.test.ts
("a preview could-not-run leaves executionSuccessful and the exit code
unchanged") and tests/output-sarif.test.ts ("never creates the umbrella run
on its own").

5. HEAD-DERIVED TEXT IS CLEANED AND BOUNDED. The preview's gate output can
carry text the head chose (vault-guard's rule ids take the head's
`extra_patterns` type names). Every `conductor: preview` log line and every
line of the preview block goes through `cleanOutputLine`
(src/gate-runner.ts), which neutralises workflow commands. The PR comment is
cut to `COMMENT_LIMIT` (60000, scripts/lib/pr-comment.mjs) before fencing,
cutting the preview block first, at the last preview header, and the primary
report only if it alone is over the limit. Only the fixed-shape
`preview: N gate(s), M finding(s), K could-not-run` line reaches the step
summary. Pinned by tests/output-text.test.ts ("a preview log line carrying
::error:: is neutralised"), tests/output-text.test.ts ("cleans every preview
line of the report, the gate sections included"),
scripts/tests/pr-comment.test.mjs ("a comment over 60000 characters keeps
the primary report and cuts the preview first"),
scripts/tests/pr-comment.test.mjs ("cuts at the last preview header, so a
header-shaped line in the primary report cannot cut it short"),
tests/action.test.ts ("copies only the fixed-shape preview line to the step
summary") and tests/action.test.ts ("copies no preview line whose shape is
not the fixed one").

6. THE PREVIEW ADDS NO CREDENTIAL EXPOSURE, AND THE CHECKOUT SHOULD NOT
LEAVE ONE. The gates step has no token of its own, but a job-level token the
caller sets is inherited, and a failing gate's stderr summary could quote a
prefix of a file the head symlinked; the normalizers never copy match bytes.
This is an existing risk, not a new one, and the control is documentation:
the README recommends `actions/checkout` with `persist-credentials: false`.
No test can pin a recommendation; the README section "The Action" carries
it, and constraint 1 above states what would make a preview spawn need more.

7. A BASE COMMAND INSIDE THE REPOSITORY IS REFUSED IN THE PREVIEW.
`refuseHeadControlledProgram` checks only the program file's blob, while its
imports and `node_modules` come from the head tree, and the preview widens
the exposure to roles the base has disabled, whose `command:` nobody has
exercised. In the preview, a base `command:` that resolves inside the
working tree is could-not-run `gate-program-refused` with no spawn. Pinned by
tests/cli.test.ts ("preview refuses a base command inside the working tree")
and tests/run.test.ts ("preview refuses a base command inside the working
tree before any spawn").

8. THE PREVIEW CAN BE TURNED OFF AND NEVER RUNS ON A HEAD THAT DOES NOT PARSE.
A one-line stage flip triggers a preview of up to 300 seconds, so the Action
has a `preview` input (default `true`) that passes `--preview` only when it
is true and the installed conductor lists the flag. A head `.guardrails.yaml`
that does not parse gives no preview policy and so no preview. Pinned by
tests/action.test.ts ("declares the preview input, defaulting to true"),
tests/action.test.ts ("passes --preview only when the input is true and the
installed conductor lists it"), tests/cli.test.ts ("an unparseable head runs
no preview") and tests/cli.test.ts ("starts no preview without --preview, on
--staged, or when only report.format changed").

9. THE INTENT GATE IS DEFERRED, NEVER PREVIEWED. `prepareIntent` spawns the
intent program, and the preview never reaches it: the intent role is listed
as deferred before the preview loop and never enters it. A role the head
switches off stays off in the preview whatever `--gate` names. Pinned by
tests/run.test.ts ("the preview never calls prepareIntent and prints the
deferred line") and tests/cli.test.ts ("a role the head switches off stays
off in the preview whatever --gate names").

### The branch-name convention is a convenience, not a control

The branch-name convention is a convenience, not a control against the
pull request's author: the head branch name only chooses among the base's
specs and the chosen text is the base's, but the author can equally choose
any base spec, or none, with a Spec: line. A spec the head adds is never a
candidate, and is reported as a proposal only when the base selects
nothing. The control is a frozen native contract on the base. The
candidate list is `markdownFilesAtRef` at the trust base and the selection
is the same `selectByBranch` as the working tree
(src/intent-prepare.ts:1285-1308); the head-spec proposal is reached only
after the found return and the spec-ambiguous return
(src/intent-prepare.ts:1446-1476). Pinned by tests/intent-prepare.test.ts
("chooses only among the base specs at the trust base, never a spec the
head adds").

### The Action installs outside the tree, and the umbrella is one of the four

New in 0.4.0, and it closes the half of the boundary 0.3.0 left open. Every
rule above is about the GATE's program. THE UMBRELLA'S OWN BINARY WAS NEVER
CHECKED AT ALL, and the action ran it out of `node_modules/.bin/conductor`,
which is the head's own install: a pull request that repointed
`@vaultcompass/conductor` at a tarball it controlled, keeping the version
number, got its own umbrella and every rule in this section with it. Nothing
in this package could have caught that, because by then the compromised
program is the one doing the catching.

So the action installs, rather than checking that somebody else did
(action.yml, the `validate` and `install` steps). Four inputs name exact
versions, `conductor-version`, `dep-guard-version`, `vault-guard-version`
and `intent-guard-version`. `npm install -g` puts all four under the runner
temp, outside the workspace, and that directory's `bin` goes on `PATH`
through `GITHUB_PATH`; the run step then invokes `conductor` by absolute path
(`CONDUCTOR_BIN`, see the entry near the end of this file) and the umbrella
resolves each GATE by name from that PATH. The pull request can rewrite its
own lockfile, manifest and `node_modules`, and none of them now decide which
programs judge it, PROVIDED NO CODE FROM THE PULL REQUEST HAS RUN EARLIER IN
THE SAME JOB. That is a precondition, not a property the action enforces:
code the head runs before the action (an install whose lifecycle script, such
as a root `postinstall`, runs) can append to `GITHUB_PATH`, write files under
the runner temp where the install prefix lives, or move
`refs/remotes/origin/<base>`, and package.json lifecycle scripts run by an
install are not stopped by branch protection on `.github/workflows`.

WHICH STEPS HOLD A TOKEN (pinned by "exactly two steps have a token in their
env: fetch-base and pr-post" in tests/action-pr-comment.test.ts): exactly TWO, and neither runs
conductor. "Fetch the trust base" holds `github.token` (as TRUST_BASE_TOKEN;
the script copies it into a non-exported variable and unsets it before its
first git call, so only the fetch subshell has it, as the extraheader; pinned
by "no git call in the fetch step inherits the token"). "Post the report"
holds GH_TOKEN and runs only `node scripts/pr-comment.mjs` on the file the
"Render the report" step wrote under the runner temp. The gates step and the
render step, the only two that run conductor (the render step only on the
old-conductor fallback), have no token in their env on any event, so
conductor and every gate inherit none (on pull_request_target the token
usually has write scope). Both also start conductor with
`ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN` removed
(`env -u`), because a caller's `id-token: write` has the runner expose them to
every step; pinned by the OIDC tests in tests/action.test.ts and
tests/action-pr-comment.test.ts. A token a CALLER puts in the job's own env is
theirs and is not stripped: a job-level `GH_TOKEN` or `GITHUB_TOKEN` that the
calling workflow sets is inherited by every step. THIS IS AN ENVIRONMENT
PROPERTY, NOT ISOLATION. A gate that executes code can still append to
GITHUB_ENV or GITHUB_PATH (BASH_ENV, NODE_OPTIONS, a planted `node` or `gh`) and
so reach the post step, and the checkout's persisted credential is readable
from disk anyway. "Post the report" sets `working-directory: ${{ runner.temp }}`
so gh never runs inside the checkout (pinned by "the post step runs from the
runner temp"); that narrows the exposure and does not close it.

WHAT THE PRIVATE REF CLOSES, AND ONLY THAT. The action's own step "Fetch the
trust base" (it runs only when
`github.base_ref` is non-empty, so no push, merge_group, schedule or
workflow_dispatch run ever has one) fetches
the base into `refs/conductor/trust-base` (forced, from `$GITHUB_SERVER_URL/
$GITHUB_REPOSITORY.git`, with the token in GIT_CONFIG_* environment variables,
never argv), verifies the ref equals FETCH_HEAD, and publishes the FULL COMMIT
ID. The gates step hands conductor and every gate that id, NEVER a ref name: git
resolves a name through DWIM rules that include `refs/tags/<name>`, so a pushed
tag named `refs/conductor/trust-base` or `origin/<base>` would otherwise be
taken for the ref, while a full 40- or 64-hex id is the object (pinned by "a
full commit id is the object even when a branch is named like it" in
tests/trust-base.test.ts). A stale private ref is removed with
`update-ref --no-deref -d` after `symbolic-ref -q` detects a SYMBOLIC one, live
or dangling (a dangling one is invisible to `show-ref --verify`, and the forced
fetch would then write through it into `refs/remotes/origin/<base>`; a plain
delete of a live one deletes its target); pinned by the two "symbolic ref"
tests in tests/action.test.ts, which also assert `refs/remotes/origin/main` is
untouched. Any fetch failure, a stale private ref that cannot be
removed (pinned by "fails when a stale private ref cannot be removed even
though the fetch itself would succeed", which fails if only that check is
removed), or a ref that does not equal the
fetched commit FAILS THE STEP (exit 1), so conductor is never invoked with a
stale or absent trust base; an empty id on a pull request is exit 2 in the gates
step. The explicit URL does NOT make the fetch immune to `url.insteadOf` or any
other repository git configuration: those are covered only by the precondition
below. In the CLI no `refs/` name is ever resolved through name resolution
(`resolveRev` reads the exact ref with `show-ref`), so a tag stored as
`refs/tags/refs/conductor/trust-base` is not the private ref, and
`refuseAmbiguousRef` looks through revision suffixes (`origin/main~0`,
`origin/main^{commit}`; only `~`, `^`, `:` and `@{` start a suffix, so a name
with a literal `@`, such as a branch and a tag both called `feature@x`, is
still checked). On a pull request the CLI accepts a full commit id only
if it equals the private ref when that ref exists, and equals
`refs/remotes/origin/<base>` ONLY when the private ref does not exist (both via
`show-ref`): the remote-tracking ref is the side pull-request code can move, so
an id that matches only it is refused once the authority exists (pinned by
"refuses a full commit id equal to a MOVED refs/remotes/origin/<base> when the
private ref exists"). An explicit intent gate `--base` that starts with a dash
is refused (git would read it as an option: `--output=/x` wrote a file and
returned an empty change set), and `changedPathsSince` refuses one again
itself and ends the range with `--`. Conductor also refuses a short name that a tag shadows
(src/trust-base.ts, `refuseAmbiguousRef`). THE PRIVATE REF IS THE AUTHORITY when it is the ref in
use: nothing reads `refs/remotes/origin/<base>` for trust, and the two are NOT
compared, because that ref is fixed at checkout time (it is the side
pull-request code can move) while the private ref is fetched later, so a
comparison would refuse every run whose base branch advanced in between and
protect nothing. Only an explicit trust base other than the private ref is
compared with `refs/remotes/origin/<base>`, which is then its one reference
(`refuseTrustBaseForPullRequest`). That closes a MOVED
or SHADOWED base ref and nothing else. Pinned by "accepts the private ref when
the base branch advanced between checkout and the private fetch (N2)" in
tests/trust-base.test.ts. It does not cover, and only the
precondition (no pull-request code before the action in the job) covers: the
files behind `GITHUB_ENV` (`NODE_OPTIONS=--require`, `GIT_CONFIG_*`,
`GIT_DIR`), `GITHUB_PATH`, `.git/config` changes (a remote URL,
`url.insteadOf`, `core.fsmonitor`, credential helpers, `core.sshCommand`), git
hooks such as `reference-transaction`, and replace refs or grafts. (The
gitleaks spawn sets `GIT_NO_REPLACE_OBJECTS=1`, which narrows the last one for
that gate only.)

THE INTENT GATE'S BASE IS SPELLED IN FULL TOO (`resolveBaseRefInRepo`,
src/intent-base.ts). On a pull request with no explicit `--base` it is
`refs/conductor/trust-base` when that exists, else
`refs/remotes/origin/<GITHUB_BASE_REF>`; when the private ref exists it wins
and is not compared with the remote-tracking ref (it is the authority, for the
same reason as above). Paths come from `git diff --name-only -z` split on NUL,
so a name with a quote, a tab or a newline arrives byte for byte
(without `-z` git C-quotes it). A path with a backslash or a comma is
listed as it is; whether it can be handed over is decided where the
channel is (see "Where the tool refuses rather than guesses").
Pinned by "hands over names with a quote, a tab and a newline byte for byte, never C-quoted (N3)" and "lists a path with a backslash as it is, and names it as one --paths cannot carry" in tests/intent-base.test.ts. An explicit `--base` keeps its meaning but goes through `refuseAmbiguousRef`, so
a shadowed short name is refused. Nothing is deepened: a depth-1 private ref
has no merge base and the diff fails closed naming `fetch-depth: 0`, as a
depth-1 `origin/<base>` always did. Pinned by "a tag origin/main at HEAD~1 no longer narrows the change set", "uses the private ref, without a refusal, when both exist and differ: the base advanced after checkout (N2)" and "refuses an explicit --base that a tag shadows, and keeps an unambiguous explicit one" in tests/intent-base.test.ts. When both refs exist and differ, the private ref is used and the run is not refused.

WHAT THE PIN DOES NOT PROTECT, stated here because an earlier revision of
this entry claimed it did. That revision said the workflow file is read from
the base branch on a `pull_request` event and so the pin was "the protected
side". THAT IS FALSE. GitHub runs a `pull_request` workflow as it is in the
pull request's merge commit, and the first hosted run of this action was
its own counterexample: the adopter's pull request that bumped the action
pin ran under the bumped pin. Only `pull_request_target` runs the base
branch's copy, and that event hands the base's secrets to the pull
request's code, which is the wrong event for a gate over untrusted changes.
So a pull request that edits the workflow file can change the pins, or
remove the step, exactly as it can rewrite any other CI step. The boundary
this package draws is against the TREE choosing its own judge: policy from
the base ref, programs from outside the tree, base-approved or refused.
Against a workflow edit the only control is branch protection on the base
branch with review required for `.github/workflows`, and this package
neither provides it nor can. The README, the action's input descriptions
and its validate-step error text say the same thing in the same words, and
none of them may claim more than this.

EXACT VERSIONS ONLY, refused in a validate step against
`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$` before anything is
fetched. That pattern also refuses a leading zero, because npm reads
`01.2.3` as a dist-tag rather than a version. A range or a dist-tag would
move the decision out of the workflow file and onto whatever the registry
served that morning, which is the same defect in a slower form.
`latest` is the case worth naming because it is the one somebody reaches for.

ANYTHING THAT READS action.yml PARSES IT, AND NEVER MATCHES LINES IN IT.
`scripts/lib/release-kind.mjs` reads all four `-version` defaults out of this
file to decide whether a tag is a package release or an action-only one, and a
hand-written line parser got that wrong twice. Searching for the input's name
anywhere landed inside a description that mentioned another input and read the
next input's default. Anchoring to `  <name>:` at the start of a line fixed
that and left a worse hole: every description here is a `>-` block scalar, so
a line of PROSE reading `default: 1.7.0` was taken as the key. That one is
reachable in the ACCEPT direction, which is the direction that cuts a Release
page for an action whose consumers die at `npm install -g`. The `yaml` package
is already a dependency and `tests/action.test.ts` already parses this same
file with it; a parser knows a key from the text of a block scalar, and knows
that `default: '1.7.0'` is the string `1.7.0`. Quoting a default here is
therefore safe, and adding a fifth input does not need a parser change.

THE INSTALL IS UNCONDITIONAL, on push and `pull_request` alike. A
conditional install would mean the action behaves one way on the runs that
matter and another way on every other run, and the second path is the one
nobody exercises before it is needed.

AND RESOLUTION STOPS LOOKING IN `node_modules/.bin` ON THOSE RUNS
(`skipNodeModules`, src/resolve.ts:190-205; `nodeModulesCandidate`,
src/resolve.ts:208-233; decided at src/gate-runner.ts:910-911). The version
probe takes the same skip (src/resolve.ts:251-257) because a probe RUNS the
binary, and so does the intent gate's preparation (src/run.ts:234-246), which
spawns that gate three times before `runGate` has looked at anything.
The remedy the program refusal has always printed, "install the gate on
PATH", is now what the action does for the adopter rather than advice.

THE PREPARATION TAKES THE PROGRAM RULE TOO, and an earlier wording here said
only that it "takes the same skip", which was presented as coverage it did
not have. The skip closes one location; it says nothing about a base policy
that vendors the intent gate in the tree through an absolute `command:`. That
shape ran the head's own rewritten program three times before the check the
whole boundary rests on had run once, and with `enforce: false` in the base
policy the run then exited 0. So the same check runs before the preparation
spawns anything (src/run.ts:456-470), through the same
`refuseHeadControlledBinary` and the same `gateProgramRefused` builder
`runGate` uses, and a preparation that FAILED under a trust base is enforced
(src/run.ts:501). Pinned by tests/intent-run.test.ts:771 (the head-rewritten
vendored program is never spawned and the run exits 2), 780 (enforced even
with `enforce: false` in the policy), 794 (a vendored program the branch left
alone still prepares), 807 (the same rewritten program runs as before with no
trust base), 843 and 858 (the preparation failure, enforced under a trust
base and read off the policy without one), and 884 (the node_modules half of
the skip, with a marker binary planted under `node_modules/.bin`).

AND WHAT IS VETTED IS EVERY PATH THAT WOULD BE SPAWNED, not only
`binary.program`. The version probe can resolve to a DIFFERENT file: a
per-command binary ignores `--version`, so resolution asks a version-safe
sibling found elsewhere (`versionProbeFor`, src/resolve.ts:238-262). Vetting
only the program left that second file unchecked, and a probe executes it as
thoroughly as a scan does. Both go through `refuseHeadControlledBinary`
(src/gate-runner.ts:413-428) and a refusal on either is the same outcome.
Pinned by tests/gate-runner.test.ts ("refuses when the head rewrote the
sibling the probe would run") and tests/gate-runner.test.ts ("runs as usual
when the branch left that sibling alone"), where the program a base policy
names is unchanged and the sibling the probe would run is not.

THE SKIP IS NEVER SILENT, by the same rule that makes a withheld trust base
never silent: one `conductor/node-modules-skipped` notification per run at
NOTE level (`nodeModulesSkippedNotifications`, src/output-sarif.ts:911-932)
and one line in the full text report (`nodeModulesSkippedLine`,
src/output-text.ts:346-360), each naming every gate and the repository
relative path it declined. ONE FOR THE RUN, not one per gate: it is a
statement about the run's mode, and in the shape it happens in most, gates
installed as devDependencies and nothing else, it is true of all three at
once. A gate with nothing on PATH either is could-not-run under the
EXISTING `binary-missing` reason, with a sentence naming `npm install -g`
and that product's own action input appended (`missingGateRemedy`,
src/gate-runner.ts:781-805). A new reason would have been wrong: nothing
was found, which is what `binary-missing` has always meant. The install
sentence comes from the product's profile (`remedy`, src/products.ts), and
it differs by kind: a family gate's names `npm install -g` and, on a
pull-request run, its action input. The install sentence is returned on a
local run too (`missingGateRemedy` calls `profile.remedy(false)` whenever
`skipNodeModules` is false, src/gate-runner.ts:793-797, and
`managedRemedy` names `npm install -g` on both branches,
src/products.ts:128-134); an external
tool's names installing it on the runner (conductor does not download it)
or disabling the role, and is appended on every run, because it is never
in `node_modules` and never installed by the Action.

OUTSIDE PULL-REQUEST MODE NOTHING CHANGES. A pre-commit hook and a direct
run on your own checkout are already inside the boundary, and the
repository's own pin still wins there, which is what `pnpm exec` does in
the same repository.

Pinned at three levels, and the parity direction is pinned at every one of
them, because a skip that also fired on ordinary runs would silently change
what a hook executes. The resolution decision: tests/resolve.test.ts
("resolution on a pull-request run" and "naming the candidate a
pull-request run skipped"), with the parity direction at
tests/resolve.test.ts:316 ("leaves the ordinary run alone, node_modules/.bin
first"). The gate: tests/gate-runner.test.ts ("a pull-request run and the
repository own node_modules"), where each case plants a marker binary under
`node_modules/.bin` so "the other one ran" is a fact about the filesystem
rather than about a `source` field, with the parity direction at
tests/gate-runner.test.ts ("says nothing and changes nothing outside
pull-request mode"). The reports: tests/output-text.test.ts ("the
node_modules candidate a pull-request run skipped") and
tests/output-sarif.test.ts ("the node_modules candidate a pull-request run
skipped"). Through the CLI on a real repository: tests/cli.test.ts
("never reaches it under a trust base, and the gate on PATH reports what it
hid"), where the same plant that 0.3.0 refused is now unreachable AND the
gate on PATH reports the secret it was hiding, with the parity direction at
tests/cli.test.ts ("changes nothing outside pull-request mode"). End to
end against the real gates: tests/dogfood.e2e.test.ts ("the gates also
installed as devDependencies, which is every repository here"), which
plants two marker binaries in the dogfood clone's own `node_modules/.bin`,
and the composed test's PATH variant, tests/dogfood.e2e.test.ts:1235
("reaches the same verdict with no command: override anywhere"), asserts
the line is ABSENT, which is what keeps it from being decoration that
appears on every run. The action itself: tests/action.test.ts ("action.yml
installs the gates outside the tree"), which RUNS both scripts under bash
with npm replaced by a recorder rather than pattern-matching the YAML.

WHAT THIS STILL DOES NOT DO, stated here because a reader should not infer
more coverage than there is:

1. KNOWN-OPEN: THE INTENT GATE'S IMPORTED-CONTRACT PATH IS OUTSIDE THE
   BOUNDARY. When a repository has no frozen contract and a spec is imported
   instead, that spec is a file in the HEAD tree, so the contract the gate
   judges against is derived from something the pull request controls. A
   pull request that adds or edits its own spec is therefore choosing part
   of what it is judged by, and neither the base-ref rule nor the program
   rule closes that: the flag is deliberately withheld in that case, because
   the imported contract lives in a temporary directory with no repository
   in it, and the withholding is reported like any other. This is listed
   again in the "what is NOT pinned" section at the top so an audit meets it
   without reading this far. The workaround, not the fix, is that a
   repository wanting the boundary freezes a native contract and keeps it
   committed; the fix is to read the spec from the base ref too, and it is
   not in this release.

### The equal-tree exception: first-parent identity, and only that

New for issue #69. The identical-tree refusal above is right for what it was
built for -- a trust base that IS the head, or the merge commit, or the pull
request's own branch, puts the policy back inside the tree under judgment --
and it was also blinding secrets-history (gitleaks) on the one shape it
exists to catch: a value committed and then backed out inside one pull
request. The merge ref GitHub builds for such a pull request has a tree
byte-identical to the base's, because the net diff is empty, so the refusal
fired before any gate ran, including the one whose whole job is history
rather than the tree. Found in the proof repository at commit 21aebe9 on
`proof/secret-in-history`, before a third commit was added to move the tree
and make the ordinary (non-empty-diff) shape run instead.

THE DISCRIMINATOR IS FIRST-PARENT IDENTITY, NOT ANCESTRY, and that is the
whole of the fix (`refuseTrustBaseRef`, src/trust-base.ts:275-335, the
exception at 315-324; `headParents`, src/trust-base.ts:221-234). GitHub
always builds a pull request's merge ref with the base branch as the FIRST
parent and the pull request's own head as the SECOND, so a trust base that
resolves to HEAD's first parent is the ref the merge commit was actually
built from. HEAD's second parent -- the pull request's own branch -- is an
ancestor of HEAD too, and carries the identical tree too, so an ancestor
check alone cannot tell the two apart and would trust the pull request's own
branch, which is exactly the hole this whole file exists to close. The
exception applies ONLY when HEAD has two or more parents (a real merge
commit, `git rev-list --parents -n 1 HEAD`) and the ref IS that first parent;
every other equal-tree shape -- a non-merge HEAD, the second parent, any
other ancestor -- keeps refusing with the unchanged message. The
same-commit refusal above it is untouched.

`refuseTrustBaseRef`'s return type is unchanged, `string | null`, on purpose:
folding the tree-matched fact into it would have touched every existing
caller and test of a function whose contract every other refusal already
depends on. Instead a separate function, `headTreeEqualsBase`
(src/trust-base.ts:248-252), answers the one question the accepted path still
needs answered, and it is called from exactly one place, `policyForRun` in
cli.ts (src/cli.ts:438), immediately after `refuseTrustBaseRef` has already
returned null. That ordering matters: `headTreeEqualsBase` is not itself a
second opinion about whether to refuse, it only tells the caller which of the
two ways an unrefused run can be true -- the trees differ, the ordinary case,
or they match, this one -- so the caller can decide which gates have
something to judge.

THE RUN DOES NOT JUDGE THE UNCHANGED TREE AS IF IT WERE THE CHANGE. A new
`readsHistory` flag on the product profile (src/products.ts) is true only for
gitleaks, because it is the only one of the five gates whose input is git
history rather than the tree being judged: dep-guard and vault-guard scan the
tree, intent-guard reads a diff of paths, osv-scanner reads lockfiles in the
tree. When `RunTrustBase.treeUnchanged` is true, `splitOnTreeUnchanged`
(src/run.ts:493-510, called from `runAll` at src/run.ts:514) partitions the
gates a stage and a `--gate` flag already left in: every gate whose profile
says `readsHistory` is kept and spawned with its ORDINARY arguments -- for
gitleaks that already means `--log-opts <base>..HEAD` (`gateArgs`,
src/gate-runner.ts:612-636), which is the range that still holds whatever was
committed and backed out even though neither tree shows it -- and every other
enabled gate is recorded in a new `RunResult.treeUnchanged` list instead of
being spawned at all. `treeUnchanged` is false, and the split is a no-op,
outside this one shape.

`TreeUnchangedGate` (src/run.ts) is deliberately the same shape as
`DeferredGate` and `ExcludedGate`, and for the same reason those two are not a
`GateOutcome`: no binary was looked for, nothing was spawned, and there is no
exit code to report. It is reported the same way those two are, at all three
levels: one line in the full text report (`treeUnchangedLines`,
src/output-text.ts:301-306, folded into the aside alongside deferred,
skipped and excluded lines), a clause on the one-line clean summary
(`summaryLine`, src/output-text.ts) and its own verdict branch for the case
where every enabled gate landed in this list, and a `conductor/tree-unchanged`
notification in the SARIF log (`treeUnchangedNotifications`,
src/output-sarif.ts:623-631, a NOTE by the same discriminator as
`gate-deferred` and `gate-excluded`: this is a statement about how much of
the policy the run covered, not about anybody's code). None of the three
reaches the exit code, which composes only from `outcomes`
(`composeExitCode`, src/exit-codes.ts), and `outcomes` never contains a
tree-unchanged gate.

WHY THIS MATTERS CONCRETELY: dep-guard 0.8.0, handed both `--trust-base` and
`--base` where `--base` resolves to a ref whose tree equals HEAD's, refuses
with exit 2 (its own equal-tree guard, mirroring this file's). Running it
anyway on an unchanged tree would turn the whole conductor run into
could-not-run and defeat the fix by making the one accepted shape as broken
as the refusal it replaces. Not running it at all is therefore not an
economy, it is the second half of the fix.

Pinned by: the acceptance and refusal decisions themselves, in
tests/trust-base.test.ts (a merge commit whose first parent is the trust base
is not refused even with an identical tree; the same shape with the trust
base at the SECOND parent is refused with the identical-tree message; a
non-merge HEAD with an equal-tree ancestor is still refused; and
`headTreeEqualsBase` is true on the accepted path and false when the trees
differ). The split itself, in tests/run.test.ts ("the equal-tree exception
(issue #69)"): only the history gate is spawned and every other enabled gate
is recorded as tree-unchanged, dep-guard and the other three are deliberately
left unstubbed so a mutation that spawned one anyway surfaces as a
could-not-run gate rather than passing silently; the exit code comes from the
history gate alone in both directions (clean and blocking); and a run with
`treeUnchanged: false` skips nothing, so the ordinary pull-request path is
pinned not to have moved. End to end through the CLI, tests/cli.test.ts ("the
equal-tree exception through the CLI (issue #69)"), against a real repository built with
an actual `git merge --no-ff`, asserting the history gate's own section
appears, the tree-unchanged line names the skipped gate, and neither a
could-not-run finding nor `conductor/gate-missing` appears for the gate that
was never spawned. The reports, in tests/output-text.test.ts ("a gate
skipped because the head tree is unchanged (issue #69)") and
tests/output-sarif.test.ts ("records a gate skipped because the head tree
is unchanged, as a note beside the others (issue #69)"): the full-report line, the one-line summary clause, the verdict
branch for an empty gate list, and the SARIF notification at note level,
absent entirely when nothing was skipped this way.

### An explicit trust-base redirect gets a refusal at two places, and neither closes the whole hole

New for issue #58. `refuseTrustBaseRef` above only refuses a ref that
resolves to HEAD's own commit or to HEAD's own tree, which covers HEAD itself
and an UNMOVED `origin/<pr-branch>`. Once the base branch has moved,
`origin/<pr-branch>` no longer matches either test, so a same-repo pull
request could set `trust-base` to its own branch, in its own workflow file,
and have this package read `.guardrails.yaml` from the pull request after
all, handing the pull request the whole policy. Found in review of #53.
dep-guard's own base input took the stronger line for its base input in
0.8.0: on a `pull_request` event an explicit value is refused outright rather
than merely checked against HEAD. This package now does the same, at two
places, and the two do not depend on each other; neither is the fix for a
pull request that edits its own workflow file, which is a different, wider
gap this entry states last and precisely.

THE ACTION REFUSES AN EXPLICIT REDIRECT ON `pull_request` AND
`pull_request_target` EVENTS, in the validate step (`action.yml`, the check
at action.yml:494-498). Modelled on the backward-pin rule earlier in the same
step: the same event test, `GITHUB_BASE_REF` non-empty, declared in the
step's own `env:` mapping from `github.base_ref` so it cannot come from the
workflow file; and the same scope, `pull_request` and `pull_request_target`
only, for the same reason the backward-pin rule is scoped there (a push to an
unprotected branch runs its own author's workflow file regardless, and
`merge_group` never sets `GITHUB_BASE_REF` at all). Off those events the
input works exactly as before, since that is what it exists for. Refused with
the value given and the fix, which is to remove the input: the action already
fetches the base commit and passes that commit id (`--trust-base "$TRUST_BASE_SHA"`, action.yml:1124). THE TWO EVENTS ARE
REFUSED FOR DIFFERENT REASONS, and the validate step's own message says so:
on `pull_request` the workflow file IS the pull request's own, so the input
is settable by the thing it judges; on `pull_request_target` the workflow
file is the BASE branch's own instead, so that particular attack does not
apply, but the input is refused there too because pull-request mode already
derives the trust base on both events and an explicit redirect has no
legitimate use on either.

THE CLI CHECK CATCHES A MISCONFIGURED OR INNOCENT-LOOKING REDIRECT WHEN
`GITHUB_BASE_REF` IS SET, for anyone invoking the CLI directly in CI, whether
or not the Action's validate step ran first
(`refuseTrustBaseForPullRequest`, src/trust-base.ts:385-491, wired into
`policyForRun` in src/cli.ts:364-365 and read from `process.env` at
src/cli.ts:700). `GITHUB_BASE_REF` is Actions' own pull-request signal: the
base branch's NAME on `pull_request` and `pull_request_target`, empty
everywhere else. When it is set, the given `--trust-base` is accepted only
when it resolves to the SAME COMMIT as `origin/<githubBaseRef>`, which is
exactly the commit the composite action fetches into
`refs/conductor/trust-base` and then passes (`--trust-base "$TRUST_BASE_SHA"`,
action.yml:1124; an explicit `trust-base` input is passed only when it is
set, action.yml:1105-1106, and the validate step has already refused that
input on a pull request), so an ordinary pull-request run is unaffected. A ref naming the pull request's own branch,
or anything else that disagrees, is refused naming both refs and both
commits.

CHECKED BEFORE `refuseTrustBaseRef`, AND DELIBERATELY NARROWER THAN IT: this
check says nothing about HEAD or about tree equality, only about whether the
given ref agrees with the one Actions says this run must use
(`policyForRun`, src/cli.ts:364-365, `pullRequestRefusal ??
refuseTrustBaseRef(...)`). The `??` means the SECOND function still runs
whenever the first returns null, in either order, so the ORDER between the
two is not what keeps the equal-tree first-parent exception from issue
#69/#73 available: on an ordinary pull-request run BOTH checks independently
return null (the given ref is the identical spelling of
`origin/<githubBaseRef>`, and, separately, its relationship to HEAD's commit
and tree passes the exception), so either order reaches the same accepted
outcome. What the order DOES decide is which REFUSAL MESSAGE wins on a ref
that both checks would refuse: checking `refuseTrustBaseForPullRequest`
first means a pull-request-scoped redirect is named as exactly that, in a
sentence that says GITHUB_BASE_REF and the base branch, rather than
surfacing as the same-commit or equal-tree message a reader would have to
already know implies a pull-request problem. Every ref is spelled in full
(`refs/remotes/origin/<githubBaseRef>`), because a short name resolves through
`refs/tags/` first, and a short given ref that matches more than one kind of
ref is refused (`refuseAmbiguousRef`). When `refs/remotes/origin/<githubBaseRef>`
exists an explicit given ref must resolve to the same commit, and a mismatch is
a refusal naming both. The action's private `refs/conductor/trust-base` is the
authority and is accepted with no comparison at all (a base branch that
advanced since checkout is benign). FAILS CLOSED when
`refs/remotes/origin/<githubBaseRef>` does not exist, naming it, unless the
given ref is the private ref, accepted the same way: reachable on the default `actions/checkout`
(fetch-depth: 1) when the base branch was not fetched. The ACTION fetches the
base into that private ref itself (depth 1 on a shallow checkout, always
forced, from the explicit server URL, and it fails the step, deleting only a
stale private ref, if the fetch fails), so on the action a depth-1 checkout does NOT fail closed
here any more: the private ref resolves. What a depth-1 checkout now fails closed on is the history gate
(gitleaks), described in the next paragraph. When the GIVEN ref does not
resolve at all, this returns null rather than refusing a second time under a
different message: `refuseTrustBaseRef` is the function with its own sentence
for that shape.

A HISTORY GATE IN A SHALLOW CHECKOUT IS COULD-NOT-RUN, AND ENFORCED UNDER A
TRUST BASE. With the default depth 1 the action's own depth-1 fetch of the base
makes the trust base resolve while HEAD is a grafted shallow merge commit, so
`<base>..HEAD` holds ONE commit and gitleaks, which reads history and not the
tree (`readsHistory` in src/products.ts), never sees a secret added and then
removed inside the pull request. Measured: 0 hits shallow against 2 full for
the same pull request. `runGateInner` (src/gate-runner.ts, before the version
probe) therefore asks `git rev-parse --is-shallow-repository` for every gate
whose profile says `readsHistory` and, when it says true, returns
could-not-run with reason `history-shallow` and a remedy naming
`fetch-depth: 0`. Under a trust base `enforce` is forced true whatever the
policy says (exit 2); on a local run the policy's own `enforce` stands.
conductor NEVER deepens the checkout itself. An earlier revision of this file
said depth 1 fails closed for the base ref only, and that the history gate
was covered by the same remedy; it was not covered, it silently passed.
Pinned by tests/gate-runner.test.ts ("is could-not-run and ENFORCED under a trust base, naming fetch-depth: 0, without spawning gitleaks") and tests/gate-runner.test.ts ("is could-not-run on a local run too, keeping the policy enforce value"), against a real depth-1 clone.

WHAT NEITHER LAYER CLOSES, stated because the obvious summary is wider than
either rule, the same discipline the backward-pin section above holds itself
to. A CLI invocation on a pull request can simply not pass `--trust-base` at
all, in which case `policyForRun` reads HEAD's own policy and nothing here
refuses it (src/cli.ts:350-352, the `trustBase === undefined` branch, which
this feature does not touch). A workflow step can blank `GITHUB_BASE_REF` in
its own `env:` mapping, which turns `refuseTrustBaseForPullRequest` into a
no-op by its own contract (the function returns null immediately when its
third argument is empty, src/trust-base.ts:367-369) exactly as it is supposed
to off a pull request, so a workflow that empties the variable on purpose
gets the same no-op a push build gets on merit. And the Action has the
matching gap at the workflow-file level: a pull request can pin `uses:` to an
action tag published before this fix, in its own workflow file, the same way
the backward-pin rule's own "what this does not cover" already states for
the four `*-version` inputs. Nothing here is a second control against a
workflow edit; the control for that remains branch protection on the base
branch with review required for `.github/workflows`, exactly as the
backward-pin rule says of itself, and neither of the two checks in this
entry claims to be a substitute for it.

Pinned by tests/trust-base.test.ts ("refusing an explicit trust-base that
disagrees with GITHUB_BASE_REF (issue #58)"): the no-op with `GITHUB_BASE_REF` unset, the
accepted case where the given ref resolves to the same commit as
`origin/<githubBaseRef>`, the refusal naming both refs and both commits on the
simplest disagreeing shape, the fail-closed case when
`origin/<githubBaseRef>` does not resolve, the given-ref-unresolvable case
deferring to `refuseTrustBaseRef`, and the equal-tree first-parent exception
from issue #69/#73 left reachable afterward. Separately, "refuses the real
#58 shape" is the one case where `refuseTrustBaseRef` ALONE (no #58 fix)
genuinely accepts the ref: a merge commit whose first parent is a base that
moved since the fork and whose second parent is the pull request's own
branch, where the merge tree matches neither parent's tree, so neither of
`refuseTrustBaseRef`'s own checks fires, and the test asserts that directly
(`refuseTrustBaseRef(repo, prBranchTip)` returns null) before asserting that
`refuseTrustBaseForPullRequest` refuses it. End to end through the CLI,
tests/cli.test.ts ("the CLI refuses an explicit trust-base that disagrees
with GITHUB_BASE_REF (issue #58)"): the same simplest-shape refusal, the accepted
`origin/<base>` shape, GITHUB_BASE_REF unset leaving the ORIGINAL (pre-#58)
refusal message in place (what tells apart a correctly-scoped check from one
that fires unconditionally), and the same real #58 merge-commit shape driven
through a real repository and the built CLI. The Action, tests/action.test.ts
("action.yml refuses an explicit trust-base input on a pull request" and,
separately, "declares TRUST_BASE in the validate step, so the pull-request
refusal below can read it"), driven by running
the real validate step's script: refused on a pull_request event, accepted
off one, accepted when no input was given at all, and the step's own `env:`
wiring for `TRUST_BASE` pinned on its own, since nothing else in the suite
would go red if that one line were deleted.

## The intent gate's own reasons are classified by prefix, and every prefix is a liability

The intent gate can block for reasons that are neither a budget violation
nor drift, and it pushes all of them into one `reasons` array with nothing
structured saying which is which. So the umbrella matches them by PREFIX,
copied from that gate's own source (`GATE_STATE_REASON_PREFIXES`,
src/normalize.ts:593-604). Five kinds today: an invalid contract, a missing
one, an unfrozen one, and the two pull-request-mode refusals 1.4.0 added.

TWO DEFECTS OF THIS DESIGN HAVE NOW BOTH HAPPENED, and both were silent,
which is why the mechanism is written down here rather than left in a
comment.

1. A PREFIX GOES STALE WHEN UPSTREAM REWORDS. The no-contract sentence
   interpolates the state directory name, and intent-guard 1.3.0 renamed
   that directory. The umbrella matched only the old spelling, so from
   1.3.0 onward the classifier was DEAD: a no-contract block was filed as
   the unattributed backstop instead of `contract-missing`, and the SARIF
   details said `unattributed` where a consumer filters on the kind. Fixed
   in 0.3.0 by matching both names, canonical first, which is the order the
   umbrella already uses when reading the two state directories. Pinned by
   tests/normalize.test.ts:483-538.
2. AN UNCLASSIFIED REASON DISAPPEARS FROM THE REPORT WHEN SOMETHING ELSE
   BLOCKS. The backstop that catches unclassified reasons fires only when
   NOTHING ELSE blocked (src/normalize.ts:807), so a pull request that
   forged a contract approval AND breached a change budget reported only
   the budget breach. The run still failed; the report never said the
   approval was self-granted, which is the one sentence pull-request mode
   exists to produce. Found by running the real 1.4.0 gate against a
   crafted pull request rather than by reading the code, which is the only
   way this class of defect surfaces. Fixed by classifying both refusals.
   Pinned by tests/normalize.test.ts:589, which puts a self-approval
   refusal and a budget violation in one run and asserts both survive.

The prefixes are enumerated against the real strings in
tests/normalize.test.ts:384-419 and 540-762, so an upstream rewording turns
a test red rather than dropping a reason out of every report. That is the
whole of the defence, and it is only as good as somebody re-running it
against a new gate release.

## Gate resolution: the name outranks the location, and the location outranks nothing

Resolution loops over CANDIDATE NAMES on the outside and LOCATIONS on the
inside (src/resolve.ts:346-366, with `locate` at 185-206). The obvious
loop is the other way round, and it pins a repository to whatever name
happens to be global: a machine with a leftover pre-rename install on PATH
would beat the repository's own current-name dev dependency, silently, for
as long as the old package stayed installed.

Within one name, the repository's own `node_modules/.bin` beats PATH
(src/resolve.ts:195-200). This was the other way round until a dogfood run
found a global gate build running over a repository's own pinned one, with
the report naming a version that repository had deliberately not chosen.
`pnpm exec` in the same repository runs the pin, and the package manager
is the one the lockfile agrees with.

The two orderings are opposite on purpose. A NAME is a statement about
which product, and the repository has no say in that. A LOCATION is a
statement about which build, and the repository does.

AND ON A PULL-REQUEST RUN `node_modules/.bin` IS NOT A LOCATION AT ALL,
because there the repository making that statement about which build is the
pull request. That is rule 1c in the source comment, it is decided by the
caller rather than here (`skipNodeModules`, src/resolve.ts:190-205) and it
is described in full in the trust-boundary section above. Nothing else in
this section changes on such a run: the name ordering, the `command:`
override and the version probe are the same, and the probe takes the skip
too because a probe runs the binary.

A `command:` in the policy overrides resolution entirely. It must be an
absolute path, refused at parse time otherwise, because a bare name would
be resolved against PATH, which is what resolution already does
(src/policy.ts:332-338). A configured command that is not a file THROWS
rather than falling back, because the user named one specific file and
running something else would run a different tool than the one they asked
for (src/resolve.ts:290-296). A configured `.js` file without the
executable bit is run through this same Node, which is what its shebang
asks for (src/resolve.ts:303-327).

There is no npx fallback, deliberately. It would make what ran depend on a
package cache the report cannot describe, and a gate that ran from an
unknown version is worse than one honestly reported missing.

Only a binary the candidate table marks version-safe is asked
`--version`. The per-command binaries shipped before their product's 1.2.0
ignored the flag and RAN THE GATE against the current directory instead,
so a probe there would have side effects on the user's repository. When
the resolved binary is one of those, the unified binary of the same
product is resolved separately and asked instead, and when that is not
installed either the version is reported unknown rather than guessed
(`versionProbeFor`, src/resolve.ts:236-260, driven from the candidate
table's `versionSafe` field at src/resolve.ts:113-126).

THIS IS BELT AND BRACES AGAINST A CLASS OF BUG, NOT A LIVE HAZARD, and
the difference matters to anyone deciding whether the fallback still
earns its keep. No published version under the names this file resolves
has the bug: the fix is the commit v1.2.0 points at, only 1.2.0 and 1.2.1
were ever published under these names, and the releases that had it were
the pre-rename packages the resolver already refuses to resolve at all
(the comment at src/resolve.ts:116-121 says which, and
tests/resolve.test.ts:130 pins the refusal). An earlier draft of this file
said the fix was merged upstream but unpublished, which had stopped being
true; the source comment at src/resolve.ts:40-55 is the corrected one.

It is kept anyway, because it costs one field on a candidate and a
fallback nobody exercises, and because the failure it prevents is silent
and happens in the user's own repository rather than in this one.

Pinned by tests/resolve.test.ts:64 (repository pin over global install),
80 (current name over older name wherever each is installed), 112 (null
rather than a guess), 130 (a binary literally named conductor never
satisfies the intent gate), 146, 159, 166 and 177 (the `command:`
override and its refusals), 188, 199 and 211 (the version probe: the safe
binary is probed, the per-command one is never probed, and the unified
binary of the same product is probed in its place), and by
tests/policy.test.ts:141 for the absolute-path rule. The candidate table
itself is pinned at tests/resolve.test.ts:232 and 239.

### Under the Action, a gate that is not at the pin does not run, from every location

The Action hands conductor the versions it pinned
(CONDUCTOR_EXPECTED_DEP_GUARD_VERSION and its two siblings, src/run.ts:582;
exact x.y.z only, src/run.ts:589, and the Action's validate step refuses
anything else before conductor runs). Since 0.13.0 (operator ruling
2026-10-18, design
docs/superpowers/specs/2026-10-18-version-skew-could-not-run.md), when that
expectation is present and the resolved family gate reports a different
version, WHEREVER the binary came from (node_modules/.bin, PATH or a policy
command), the gate is could-not-run, reason `version-skew`; when the
version cannot be read at all it is could-not-run, reason
`version-unverified` (fail closed: the run cannot show the build is the
pinned one). Both are decided in one place, directly after the version
probe and before the command-line floor and `decideTrustBase`, so nothing
past the probe runs (src/gate-runner.ts:2108, one builder at
src/gate-runner.ts:1533), and both are ENFORCED whatever the policy's
`enforce` says; `--advisory` never touches exit 2. A timed-out probe stays
`timed-out`, and under the expectation it is enforced too, for the same
reason. With no expectation (every plain CLI run) none of this runs and
nothing changed. Resolution order is unchanged.

The intent gate's preparation is no exception (residual 3, closed
2026-10-20). On a pull-request-shaped run the preparation spawns the
resolved intent-guard for import-spec and freeze before runGate, and a
failed or timed-out preparation ends the gate there. Before this fix that
skipped the version decision entirely: on an Action push run (no trust
base, so node_modules/.bin outranks the Action's install) with the `spec`
or `base-ref` input set and `enforce: false`, an off-pin devDependency
whose import-spec failed read `preparation-failed`, not enforced, exit 0.
Now runAll makes the same decision first, after the head-controlled
program check and before any preparation spawn
(`expectedVersionBeforePreparation`, src/gate-runner.ts:1601, called at
src/run.ts:749), with the same probe and the same builder, so an off-pin
or unreadable build is `version-skew` or `version-unverified`, enforced,
and only its `--version` is ever spawned. An on-pin build whose
preparation fails keeps the existing rule: enforced under a trust base,
the policy's `enforce` otherwise. Pinned by
tests/intent-run.test.ts:1615 ("is version-skew and exit 2 for an off-pin intent-guard whose preparation would fail, with enforce: false and no trust base"),
tests/intent-run.test.ts:1630 ("never spawns an off-pin intent-guard for import-spec or freeze, even when its preparation would succeed"),
tests/intent-run.test.ts:1642 ("is version-unverified before the preparation when the version cannot be read under the expectation"),
tests/intent-run.test.ts:1654 ("is an enforced time-out before the preparation when the version probe is stopped under the expectation"),
tests/intent-run.test.ts:1679 ("is version-skew, not preparation-failed, for an off-pin PATH intent-guard under a trust base"),
tests/intent-run.test.ts:1705 ("keeps the policy enforce for an on-pin intent-guard whose preparation fails with no trust base")
and tests/intent-run.test.ts:1721 ("changes nothing without the expectation: an off-pin intent-guard is prepared as before").

STILL OPEN: a policy `command:`
naming the legacy intent-guard-check is version-checked through the first
version-safe `intent-guard` sibling found, which under the Action is the
pinned install, so an old build named that way is not caught; it needs a
maintainer-written base policy pointing at a pre-1.2.0 build.

The expectation is a control input in ONE DIRECTION ONLY: it can add a
could-not-run and never clear a gate or drop a finding, so a wrong value
fails closed. History: until audit 2026-10-18 (the intent-guard audit's
MB3) the 0.12.0 warning fired for PATH alone, so on a push run a
repository's own devDependency in node_modules/.bin (which outranks the
Action's global install by the rule above) ran stale gates with nothing
printed; 0.12.0 warned from every location and announced this change. A
pull-request run never consults node_modules/.bin, so a skew there comes
from PATH or a policy command.

Where it is said: the could-not-run detail names the found and expected
versions, the place in words or repository-relative (never a machine path),
and the remedy for its source (`versionSkewRemedy`, src/gate-runner.ts:292,
the one place it is written); the `versionSkew` record is kept on a
`version-skew` outcome only, for the job-log error line on stderr
(`versionSkewWarnings`, src/output-text.ts:1002), which names the file; a
`! conductor/version-skew` line under the gate header in the text report
(`versionSkewLine`, src/output-text.ts:1047), and so in the pull request
comment; a note-level `conductor/version-skew` notification in the SARIF
umbrella run (src/output-sarif.ts:1004) beside the gate's own could-not-run;
and, in GitHub Actions only (GITHUB_ACTIONS=true), an `::error::`
annotation and a step-summary paragraph (src/cli.ts:989). The found
version is cut to version characters (`versionCharacters`,
src/gate-runner.ts:277) before it reaches any of those surfaces, because
the family probe accepts anything after x.y.z.

Pinned by tests/gate-runner.test.ts:1922 ("is could-not-run, version-skew,
for a skewed node_modules/.bin gate, and never runs its scan"), 1948 ("is
could-not-run for a skewed PATH gate, naming PATH and never its machine
path"), 1960 ("is enforced even when the policy says enforce: false"), 1974
("runs a gate at the expected version, with no skew"), 1984 ("changes
nothing without the signal: the skewed gate runs"), 1997 ("is
could-not-run, version-unverified, when the version cannot be read under
the signal"), 2015 ("runs a gate whose version cannot be read when there
is no signal, as before") and 2025 ("enforces a version probe that timed out
under the signal, whatever the policy says"); by the record tests 1818 ("records version skew
for a node_modules/.bin gate, the location named repository-relative") and
1835 ("records version skew for a PATH gate, with its absolute path"); and
through the CLI by tests/cli.test.ts:3573 ("names both versions and where
the binary was found, and is could-not-run with exit 2"), 3585 ("says
nothing when the versions match, or when nothing says what to expect"),
3631 ("outside Actions, under the signal, names the location and exits 2
without running that binary"), 3645 ("puts the skew in the SARIF log and in
the gate block of the text report"), 3678 ("in GitHub Actions also writes
an error annotation and a step-summary line"), 3696 ("warns for a PATH gate
in Actions the same way"), 3731 ("says nothing anywhere when the
node_modules/.bin gate matches the pin"), 3858 ("exits 2 for a skew even
when the policy says enforce: false, and even with --advisory") and 3873
("exits 2 when the version cannot be read under the signal, and 0 without
it"). Mutations, each run against tests/gate-runner.test.ts and
tests/cli.test.ts: recording the skew and running the gate anyway (the
0.12.0 behaviour) turned 8 red; dropping the skew branch and its record
turned 13 red; dropping the unreadable branch turned 2 red (the two
version-unverified cases); keeping the policy's `enforce` turned 2 red (the
two enforce: false cases); leaving a timed-out probe under the signal to
the policy's `enforce` turned 1 red; failing an unreadable version closed WITHOUT the
signal turned 6 red (the two no-signal controls and four trust-base and
plain-run cases elsewhere). The version cut is pinned by
tests/cli.test.ts:3714 ("cuts a probed version with junk after x.y.z to
version characters on every GitHub surface").

## The policy file is a passthrough, and the reserved list is the only exception

Gates are keyed by the ROLE they fill, and the product filling it is a
field inside (src/policy.ts:41-45, and the shipped schema). A product
rename or a swap is then a one-line edit rather than a rename of the key a
repository wrote its CI around. A policy that puts a product in a role it
does not fill is rejected at parse time, because the failure mode of
accepting it is confusing rather than loud: the secrets section of the
report would carry dependency findings (`PRODUCT_FOR_ROLE`,
src/policy.ts:109-115, enforced at src/policy.ts:412-416).

There is deliberately no shared severity threshold. Two of the three
products share a four-level scale; the third scores a weighted rubric from
0 to 100 and has no per-finding severity at all. A top-level `failOn`
would read as one decision and mean three different things, so the schema
refuses it outright rather than ignoring it. Each gate keeps its own
threshold in its own `options` block, spelled the way that gate spells it.

`options` keys are the gate's own long-flag names with the dashes
stripped, and this package never maps, renames or interprets one
(`renderOptionFlags`, src/policy.ts:546-566). `true` renders as `--key`,
`false` as `--no-key` (commander's own convention, and the one negation
rendering that is right without knowing the flag), a scalar as `--key
value`, and an array as one pair per entry. Keys are sorted, so two policy
files differing only in key order produce the same command line and a
diffable report. That passthrough is what keeps the umbrella from growing
a second, drifting copy of three CLIs, and it is why a gate can gain a
flag without this package needing a release.

Pinned by tests/policy.test.ts:37 ("keys gates by role, not by product"), tests/policy.test.ts:145 ("rejects a product that does not belong to the role"), tests/policy.test.ts:155 ("rejects a top-level shared severity threshold, which the draft calls a trap"), tests/policy.test.ts:185 ("keeps each gate threshold in its own passthrough block"), tests/policy.test.ts:194 ("renders option keys as the gate own flag spellings, unchanged"), tests/policy.test.ts:201 ("renders an array option once per value"), tests/policy.test.ts:205 ("renders options in a deterministic order regardless of file order") and tests/policy.test.ts:211 ("rejects an option key that is not a flag spelling").

The one exception is `RESERVED_OPTIONS` (src/policy.ts:123-170): the
handful of keys the umbrella writes itself are refused, because two
writers of one flag is a fight the user would have to debug from a stack
trace. Pinned by tests/policy.test.ts:220 ("rejects an option the umbrella itself owns, rather than letting it fight the wrapper").

Four keys get their own message rather than the generic "the umbrella
passes that flag" sentence, because a rejection that gives the wrong
reason sends somebody looking in the command line for a flag that is not
there under that name, or is not there on every run, and concluding the
rejection is a bug in this tool (`reservedReason`, src/policy.ts:281-324).
Two of them, intent-guard's `base` and vault-guard's `format`, name a flag
the umbrella never writes under that name at all. The other two, `trust-base` on dep-guard, vault-guard and intent-guard, and
dep-guard's `base`, are flags the umbrella does write, but only on some runs.
gitleaks and osv-scanner are never handed `--trust-base`.

- `trust-base` on dep-guard, vault-guard and intent-guard
  (src/policy.ts:284-290). The umbrella writes it on a pull-request run for
  those three, pointing at the base ref it read its own policy from. It is
  not written for gitleaks (tests/policy.test.ts:491 ("scopes gitleaks to base..HEAD and passes the base-ref config on a pull-request run") and tests/gate-runner.test.ts ("on a pull request, hands gitleaks the base config and ignore file and scopes history to base..HEAD")) or for osv-scanner (tests/policy.test.ts:518 ("asks osv-scanner for json on stdout over exactly the tracked lockfiles, with the base-ref config on a pull request")).
- `base` on the intent gate, because the umbrella computes the change set
  itself and passes `--paths`, and a `--base` inside the gate would be
  resolved against a `--project` that may be a temporary directory with
  no repository in it (src/policy.ts:290-296). Pinned by
  tests/policy.test.ts:235 ("rejects base on the intent gate, naming the key rather than failing in CI") and tests/policy.test.ts:255 ("explains base on the intent gate for the reason it is actually rejected"), the second of which asserts the
  message names `--paths`.
- `base` on the dependency gate, reserved on every run despite the
  umbrella writing `--base` itself on some of them. On a pull-request run
  the umbrella writes `--base` to dep-guard itself, pointing at the same
  ref as `--trust-base` (dep-guard issue #62; src/gate-runner.ts, the
  dep-guard branch of `gateArgs`), so a policy-supplied value would be a
  second writer. Otherwise the umbrella writes `--staged` on a staged
  run, and a policy-supplied base would fight that, since dep-guard's own
  CLI refuses `--staged` and `--base` together; on a plain run the
  umbrella writes neither flag, and a policy-supplied base would silently
  decide what that run compares dependencies against, without going
  through the trust base the umbrella itself decided
  (src/policy.ts:298-307). Pinned by tests/policy.test.ts:282 ("explains base on the dependencies gate as whichever flag it collides with or silently changes"), which
  asserts the message names `--staged`, and by tests/policy.test.ts:425 ("gives dep-guard both --trust-base and --base, naming the same ref, when trust base is decided and the run is not staged"), which
  asserts the umbrella's own `--base` and `--trust-base` name the same
  ref.
- `format` on the secrets gate, because the umbrella writes that option
  under its SHORT name, `-f json` (src/policy.ts:309-314). Pinned by
  tests/policy.test.ts:268 ("explains format on the secrets gate as the short flag the umbrella actually writes"), which asserts the message names `-f`.

The last two were recorded here as the prose giving the wrong reason: the
generic sentence said "the umbrella passes that flag to this gate
itself", which is false of both. The code was the wrong one and both
messages have been rewritten.

Two more facts about dep-guard's `--base`, recorded for completeness;
neither changes behaviour.

- Conductor's own `--base <ref>` option (src/cli.ts:645-648) feeds only
  the intent gate: it becomes `RunOptions.base` (src/run.ts:221) and is
  passed straight through to `prepareIntent` (src/run.ts:553-561), which
  resolves it into the base ref the intent gate diffs against.
  `isPullRequestShaped` in src/run.ts reads the same option only to
  decide whether this run counts as pull-request shaped at all (a trust
  base on its own also makes it so, and then the change set is measured
  from the trust base). `--base`
  never reaches dep-guard, which follows the decided TRUST base instead
  (`trustBase.ref`, above). So `conductor run --trust-base origin/main
  --base origin/release` compares intent against `release` and
  dependencies against `main`, not the same ref for both.
- `--base` reaches dep-guard only when `--trust-base` does (the same
  `trustBase.withheld !== null` check in `spawnAndRead` that blanks the ref
  passed to `gateArgs`). A dep-guard older than its entry in
  `TRUST_BASE_MIN_VERSION` never runs on a trust-base run at all: it is
  could-not-run, so it is handed neither flag. Keying `--base` to the
  trust decision is broader than `--base` itself needs, since dep-guard's
  `--base` has been part of its CLI since the first published version with
  no version floor of its own.

THE PAIRING IS NOW HELD IN ONE DIRECTION BY DERIVATION AND IN THE OTHER
BY HAND, and which is which is the whole of the guarantee
(tests/policy.test.ts:390 ("reserves every flag the umbrella writes, which is the direction that can hurt") and tests/policy.test.ts:399 ("reserves nothing else without a stated reason")). `flagsWritten` calls `gateArgs`
(src/gate-runner.ts:505-652, exported for exactly this) over the six
shapes of run there are, pull-request mode included, and collects every
token starting with a dash. So the DANGEROUS direction is derived:
tests/policy.test.ts:390 ("reserves every flag the umbrella writes, which is the direction that can hurt") asserts that every flag `gateArgs` writes is in
`RESERVED_OPTIONS`, and a flag added to `gateArgs` and forgotten in the
list turns that test red rather than letting a policy file write the same
flag a second time.

The other direction cannot be derived for the keys that are reserved
WITHOUT the umbrella writing them. Those are listed by hand in
`RESERVED_WITHOUT_WRITING` (tests/policy.test.ts:336-349) and held to
exactly that set by tests/policy.test.ts:360, so a new one cannot be
added without somebody writing down why. `dep-guard`'s entry moved from
`['base']` to `[]` when the umbrella started writing `--base` to
dep-guard on a pull-request run (dep-guard issue #62); `base` on
dep-guard is derived on that shape of run like `trust-base` is, but it
stays reserved on every other shape for the reasons in its own
`reservedReason` message above, so only `vault-guard`'s `format` and
`intent-guard`'s `base` are absent from every shape `flagsWritten` covers
and need a hand-maintained entry. That list is still hand maintained, but
it is two entries long rather than the whole table, it is held against
the derived set rather than restated beside it, and each of the two has
its own message test above.

A SECOND CATEGORY, added in 0.10.0: keys reserved because they name
CONDUCTOR'S OWN setting written in the wrong place, not a flag the
umbrella writes (`CONDUCTOR_SETTING_KEYS` and its sentences in
`reservedReason`, src/policy.ts:186 and src/policy.ts:318-325).
`timeout-seconds` is reserved under `options` on all five gates: it is the
gate-level time limit beside `enforce`, no tool has the flag (gitleaks exits
126 on it), so the only way to write it under `options` is to mean
conductor's key. `timeout` is reserved on dep-guard, vault-guard,
intent-guard and osv-scanner, which all reject `--timeout` at the pinned
versions, so no working policy breaks; it is reserved for clarity, because
without it intent-guard's rejection reads as a rejected config file. It is
NOT reserved on gitleaks, where `--timeout` is gitleaks' own deadline and
works today: reserving it would refuse policies that pass it, which the
reserved-list comment rules out for a standing document. It stays a
passthrough and carries the `conductor/option-is-gate-own` note instead
(see "A gate that could not run is a result, never a note"). The nine
entries are a second hand-maintained list, `RESERVED_FOR_CONDUCTOR_SETTING`
(tests/policy.test.ts:738), subtracted in the "reserves nothing else"
check and held to exactly nine by tests/policy.test.ts:826 ("reserves
exactly the nine keys that name conductor own setting, each of them
reserved"); the sentences are pinned by tests/policy.test.ts:800
("refuses options.timeout-seconds on every gate, pointing at the
gate-level key") and tests/policy.test.ts:811 ("refuses options.timeout on
the four gates that have no such flag"), and the gitleaks passthrough by
tests/policy.test.ts:820 ("passes options.timeout through on gitleaks,
where it is gitleaks own flag").

WHAT THE RESERVATIONS DO NOT COVER, so nobody reads them as a boundary:
they match exact `options` keys only. `args` beside `command` can still
carry a literal `--timeout`, and a `no-timeout: true` key (or
`timeout: false` on gitleaks, where `timeout` stays a passthrough) renders
`--no-timeout`, which no tool accepts, so that run is could-not-run with the
tool's own rejection. On a pull request only the base policy's options are used (the head is read for the comparison and the preview), so
none of this is reachable from the pull request: the reservations are a
clarity measure for the policy author, not a trust control. Not pinned by
any test, since it is a statement of what is not covered.

## Stages are cumulative, and a gate the filter holds back is never resolved

`GATE_STAGES` is one ordered array and the order is the whole rule
(src/policy.ts:70). A gate runs at its own stage and at every later one,
so a run at `ci` runs everything enabled (`runsAtStage`,
src/policy.ts:95-97). Adding a fourth stopping point is an entry in that
array and nothing else.

Defaults are per role: `commit` for dependencies and secrets, `ci` for
intent (src/policy.ts:69-73). Runtime is not what decides this. All three
together take under a second on a staged commit; the cost is CEREMONY, and
only the intent gate has any, because it wants a contract approved before
the work starts. A secret that reaches a pull request is already on a
remote, so the earliest stage is the only honest place for that one.

The protective half is about what a held-back gate never reaches, and it
is worth saying exactly rather than loosely. The partition itself is one
filter over the enabled list, taken before the run loop starts
(src/run.ts:343-354). The comment on that filter still says the partition
happens "before any binary is even looked for". That sentence is true of
the filter and invites the reading that resolution is hoisted. Resolution
is NOT hoisted out of the loop: each surviving gate is resolved one at a
time inside it, by `runGate` (the loop is src/run.ts:527-615, resolving at
src/gate-runner.ts:921). What the filter guarantees is therefore about the
gates it holds back, not about the ones it keeps: A GATE THE FILTER HELD
BACK NEVER REACHES RESOLUTION OR SPAWN AT ALL, because it never enters the
loop. A gate that will not run at this stage must not be able to fail the
run by being uninstalled here, and an intent gate that lives only on the
CI image is the ordinary case rather than an error.

A future change that moved resolution above the loop would break exactly
this rule while still satisfying the comment on the filter.

A deferred gate is recorded rather than dropped (`DeferredGate`,
src/run.ts:39-44). It is deliberately not a `GateOutcome`: no binary was
looked for, nothing was spawned, and there is no exit code to report. It
still has to be visible, or a run at `commit` reads exactly like a run
that checked everything.

Pinned by tests/policy.test.ts:541 ("runs a gate at its own stage"), tests/policy.test.ts:547 ("runs an earlier gate at every later stage"), tests/policy.test.ts:553 ("does not run a later gate at an earlier stage") and tests/policy.test.ts:559 ("names the three stages in order, earliest first"); tests/run.test.ts:312 ("still runs the commit gates at push, because stages are cumulative"), tests/run.test.ts:317 ("runs everything at ci, which is the last stage"), tests/run.test.ts:322 ("says which stage a deferred gate is waiting for") and tests/run.test.ts:332 ("honours an explicit stage over the role default in both directions"),
tests/run.test.ts:387 ("does not treat a deferred gate as a missing one"). That one runs with
an empty PATH and an empty repository root and still gets exit 0 and no
findings, so nothing was looked for. tests/run.test.ts:356 ("never lets a deferred gate reach the exit code, since it was not asked to run"), and tests/run.test.ts:455 ("leaves a disabled gate out of the deferred list rather than reporting it twice"); and end to end by tests/cli.test.ts:197 ("runs the commit gates and defers the intent gate at --stage commit"), tests/cli.test.ts:211 ("runs every gate at --stage ci"), tests/cli.test.ts:223 ("runs every gate with no --stage at all, exactly as v0.1 did") and tests/cli.test.ts:248 ("names the deferred gate in the SARIF log rather than dropping it").

## A gate `--gate` left out is recorded, not silently dropped

Added after this file was first written, and it is the same rule as the
deferred gate one applied to a different cause. `--gate secrets` narrows a
run, and before this the narrowing left no trace: an uploaded log from a
`--gate` run was indistinguishable from a log of a full one, which is
exactly the confusion the deferred notification exists to prevent.

The two facts are kept apart deliberately. A gate the POLICY FILE disables
is a standing decision somebody wrote down and is not news. A gate the
COMMAND LINE left out was on in the file and did not run this once. So
`excludedByCli` is set only for a gate that WAS enabled and is not now
(`GatePolicy.excludedByCli`, src/policy.ts:145-156, set at
src/policy.ts:419-428 and initialised false at parse time,
src/policy.ts:351-353). Pinned by tests/policy.test.ts:415 (the gate
`--gate` switched off is marked and the named one is not), 428 (a gate the
file had already disabled is NOT marked, or the user's own decision is
read back to them as something the command line did) and 438 (nothing is
marked when there was no `--gate` at all).

It is carried on the run result as `ExcludedGate` (src/run.ts:45-59),
read off the POLICY rather than off the enabled list, because these gates
are exactly the ones the override took out of that list, and in role order
so the report never depends on the order the flags were typed
(src/run.ts:311-316). Like `DeferredGate` it is deliberately not a
`GateOutcome`: no binary was looked for and there is no exit code to
report. Pinned by tests/run.test.ts:322 (both excluded gates are carried,
with only the named one running), 338 (nothing excluded without `--gate`)
and 347, which is the one that matters: a `--gate` run gets the SAME exit
code a policy declaring only that gate would, so reporting the excluded
gates never gives them a vote. That test stubs an excluded gate that would
have blocked, so the two numbers would differ if any of this reached
`composeExitCode`.

Both formats say it. One line in the text report
(src/output-text.ts:285-290), a clause on the one-line summary of a clean
run (src/output-text.ts:951-953), and a `conductor/gate-excluded`
notification in the umbrella's SARIF run
(src/output-sarif.ts:602-609). A notification rather than a result by the
discriminator below: nothing went wrong, and how much of the policy a run
covered is a statement about the run. Pinned by
tests/output-text.test.ts:1214 ("names the excluded gates in the full report"), tests/output-text.test.ts:1227 ("names them on the one-line summary of a clean run too") and tests/output-text.test.ts:1236 ("reports exclusion as a zero count on the summary, and the full report stays silent"). The zero case still prints "0 gate(s) left out by --gate" on the summary; the full report with verbose stays silent. And by tests/output-sarif.test.ts:190 ("records a gate --gate excluded as a notification, beside the deferred ones").

## The hook: one hook, one command, one exit code

`conductor init` writes no pre-commit hook by default (issue #48, spec
decision 6). `--hook` opts in, and everything below this paragraph is
about what happens once it is given. Without `--hook`, planInit skips hook
detection and hook writing entirely (src/init.ts, the `wantsHook` branch in
`planInit`) and writes only the policy file and the manifest; `--adopt` and
`--force` on an init with no `--hook` are refused with `flag-requires-hook`
rather than silently ignored, because both flags are about the hook alone.
`--revert` is unaffected by this flag: it still removes a hook a previous
`--hook` run wrote, whether or not the `--revert` invocation itself carries
`--hook`. This exists because `.git/hooks` is never part of a clone, so a
hook written unconditionally could not reach a second contributor's checkout
regardless, and every CI-only adopter that never wanted a local hook got one
it never asked for (spec section 2.2).

When `--hook` IS given, `conductor init` writes exactly one pre-commit hook,
and it runs the umbrella once rather than three gates (src/init.ts). It runs
`conductor run --staged --stage commit`, not every stage: a pre-commit
hook IS the commit stopping point, and running the intent gate's ceremony
there is what makes a team switch the hook off.

The exit code is passed through unchanged (src/init.ts:205-207). The hook
written the natural way, `if conductor run; then exit 0; fi; exit 1`,
collapses 2 into 1 and so reports findings that were never looked for.
There is one message per code and not one message for both
(src/init.ts:183-203), because calling exit 2 a blocked commit describes a
decision nobody made.

Neither message mentions a bypass flag, in any branch. Every gate already
has a recorded, reviewable, scoped escape: an allow entry, an ignore path,
a baseline, or `enforce: false`. A bypass skips every gate invisibly,
including the ones that would have caught something unrelated to the
finding somebody disagreed with.

The hook has no `set -e` of its own and is written to survive somebody
else's, because husky's dispatcher runs it as `sh -e` and under `-e` the
shell exits at the failing command before its status can be captured,
which keeps the exit code and loses the line that explains it.

Two strings in the source used to contradict this: `conductor init`'s own
command description and the adopt guidance both said the hook runs "every
enabled gate", when it runs the commit stage, so a gate whose stage is
`ci`, which is the intent gate's default, is deferred rather than run.
The README said it correctly in its stages section and incorrectly in its
opening summary. All three now say the commit stage
(src/cli.ts:679-683, src/init-hook-detect.ts:415-421, README.md:119-120).

The hook is written with the executable bit set after the write rather
than through the write's mode option, because an existing file keeps its
own mode when written through and git will not run a hook it cannot
execute (src/init.ts:838-843).

Pinned by tests/init.test.ts:241 (one hook, running the umbrella and not
three gates), 252 (`--stage commit` is in the hook text), 1390 and 1569
(a real commit through husky 9's dispatcher and through husky 8, not a
fixture), 1704 to 1802 (fail closed), 1819 (`sh -e`: the explanation
survives, which is the half `-e` destroys), 1841 (the exit code passed
through: a stub conductor exits 2 and the hook exits 2), 1858 (a clean
run commits), 1900 to 1926 (one message per code, each taken by running
the generated script against a stub rather than by reading the template)
and 1937 (no bypass advertised in either the native or the husky hook).

## What init refuses to touch

Six refusals, each returning early with a conflict and writing nothing. Five
of them (foreign-hook, gate-hook, generated-hook, managed-hooks,
hooks-path-outside-repository, the five below that mention a hook or
`core.hooksPath`) live inside the `--hook` branch of `planInit` and cannot
fire at all without `--hook`: `finishPlanWithoutHook` (src/init.ts) skips
hook detection entirely when `--hook` is not given, so a plain
`conductor init` refuses none of them. Only the sixth, the existing-policy-
file rule below, is unconditional: the policy file is checked in
`finishPlan`, which every init reaches whether or not `--hook` was given.

There is a seventh refusal outside this list, and it is the one that fires
on exactly the runs that do NOT have `--hook`: `flag-requires-hook`.
`--adopt` or `--force` given WITHOUT `--hook` errors rather than being
silently ignored, since both flags are entirely about the hook and there is
no hook for either to act on without it (src/init.ts, checked in `planInit`
ahead of `repoRootOf`, so it fires even against a directory that is not a
git repository). Pinned by tests/init.test.ts's "init without --hook"
describe block (the two "errors clearly rather than silently doing nothing"
cases).

A foreign hook is never replaced (src/init.ts:634-638). That hook is
somebody's working setup and init has no standing to have an opinion about
it. A whitespace-only file is treated as absent rather than foreign
(src/init.ts:634), pinned by tests/init.test.ts:1275. The refusal itself
is pinned by tests/init.test.ts:1205.

Another gate's own pre-commit hook is reported and left alone unless
`--adopt` is passed (src/init.ts:634-654). Adding the umbrella's hook
alongside it would run that gate twice and report its findings twice.
`--adopt` replaces it and stores the original in the manifest so revert can
put it back. Pinned by tests/init.test.ts:1230, a parameterised case over
all three gates' own hooks, and by 1240 and 1255 for the adopt-and-restore
pair. `--adopt` never touches a FOREIGN hook, pinned by
tests/init.test.ts:1217.

A hook generated by lefthook or by the pre-commit framework is left alone
and the user is told the stanza to add to that manager's own config
(src/init.ts:514-523, guidance at src/init-hook-detect.ts:157-170). Those managers rewrite the
file on every install, so anything written there is lost without a word,
and the guidance says out loud that the manager owns the commit's exit
code so the umbrella's 1 and 2 do not survive it. Recognition is by
strings captured from real installs, kept as fixtures under
tests/fixtures/hooks, and the code comment records honestly that the
`lefthook_version:` alternative recognises nothing any live version writes
and is kept only because a spare alternative in an OR cannot cause a false
negative (src/init-hook-detect.ts:129-139).

The BEHAVIOURAL pin is tests/init.test.ts:1669, a parameterised case that
writes each captured file into a real repository, runs init, and asserts
the conflict, the manager it was classified as, and that nothing was
written. That is the test to keep. Two others beside it assert only what
is IN the captured text, that lefthook's real hooks carry `call_lefthook`
and never `lefthook_version:` (tests/init.test.ts:1692) and that the
pre-commit framework's marker line is character for character the string
init.ts looks for (tests/init.test.ts:1704). Those two are worth having,
because they are what would catch an upstream rewording, but neither one
runs init, so neither is evidence about what init does with the file.
The pair at tests/init.test.ts:1626 and 1637 exercise the same refusal
against HAND-WRITTEN approximations, which proves only that the code
agrees with whoever wrote the approximation.

A repository wired to simple-git-hooks or yorkie is refused too, with the
separate conflict `managed-hooks` (src/init.ts:547-558, recognition at
src/init-hook-detect.ts:197-205, guidance at src/init-hook-detect.ts:316-365). It is separate from `generated-hook`
because the remedy is: those two keep the hook TEXT in a declaration
rather than in a config file the generated hook points at, so there is no
file to name a stanza in, and the guidance names the entry to edit
instead.

THE DECLARATION IS A SIGNAL IN ITS OWN RIGHT, not corroboration of the
hook's contents (`declaredManagedHooks`, src/init-hook-detect.ts:246-290, the exact
config-file list at src/init-hook-detect.ts:53-62). It is the
only signal that exists on a fresh clone, where the manager has never run
and `.git/hooks/pre-commit` does not exist yet, which is exactly the state
somebody adds the umbrella in. It is also the only signal at all for
simple-git-hooks 2.8.0, whose generated hook is the shebang and the user's
own command and contains no string belonging to simple-git-hooks; no
content rule can recognise that file at any price.

The declaration is the `simple-git-hooks` or `gitHooks` key in
package.json, and for simple-git-hooks also any of the standalone config
files its own README lists. That list is EXACT
rather than a prefix or extension test, so a `simple-git-hooks.yaml` is
somebody's notes and not a reason to refuse an install. The combination
needing all three signals is real rather than hypothetical: a standalone
config file plus a version old enough to write no marker is invisible to
both of the others.

Presence is the whole test and is deliberately not narrowed to a declared
`pre-commit` entry, because yorkie's installer writes every hook file
whatever the key contains and simple-git-hooks removes hooks it previously
managed. The cost of the wide rule is a refusal somebody has to read; the
cost of the narrow one is a hook silently deleted.

THE GUIDANCE NAMES THE FILE THE DECLARATION IS ACTUALLY IN, which is why
the detection carries WHERE it fired rather than just which manager
(`ManagedDetection`, src/init-hook-detect.ts:236-239). simple-git-hooks resolves
package.json LAST, so while a standalone config file exists an entry added
to package.json is exactly the one it ignores: guidance naming package.json
there would send somebody to edit a file that will not be read and leave
them with the umbrella uninstalled and no error to explain it. The config
files are checked before package.json for the same reason, in the same
order the tool resolves them. Pinned by tests/init.test.ts:2200.

THE REFUSAL FIRES ONLY WHERE GIT ACTUALLY RUNS `.git/hooks`
(`hooks.isDefault`, src/init.ts:360-391, used at src/init.ts:546). Both
managers write that directory and neither reads `core.hooksPath`, so under
husky or any other configured hooks directory the file they rewrite is not
the file git runs: the umbrella's hook is in no danger from them, and
refusing would name a file the manager never touches while blocking an
install that is safe. The test compares the RESOLVED directory against the
git directory's own `hooks/` through `realpath` (`samePath`,
src/init.ts:407-416) rather than asking whether `core.hooksPath` is set,
because a repository may set it to exactly where git already looks, and a
rule phrased as "nothing is configured" would answer differently for two
repositories git treats identically. The realpath matters on macOS, where
the temporary directory is a symlink and the two sides of that comparison
arrive by different routes.

INIT DOES NOT OFFER TO WRITE THE ENTRY, and `--force` does not override
the refusal, which puts it with `foreign-hook` and `gate-hook` rather than
with `changed-since-init`. Init writes a policy file and a manifest, and
with `--hook` a hook too, and the manifest is what makes `--revert` honest;
an edit merged into somebody's package.json has no revert story that is not
a guess about which of their later edits were theirs. The guidance says a
later release
may offer to, and says to put the umbrella LAST and as its own command
rather than chained behind `&&`: a chain stops at the first failure, so an
umbrella in front hides the other command's verdict and one behind an `&&`
never runs once anything ahead of it fails.

Pinned by tests/init.test.ts:2066 (the bare clone: the key alone, with no
hook file, for both managers), 2079 (`--force` and `--adopt` together do
not override it), 2090 (the same refusal under `--dry-run`, with no
actions), 2100 (the file each tool really wrote, with no package.json at
all, over three captured fixtures), 2126 (a custom `core.hooksPath` takes
both managers out of play and init says nothing about them), 2148 (setting
`core.hooksPath` to the default `.git/hooks` does NOT, which is what makes
the rule a path comparison rather than a "is it configured" test), 2167 (a
standalone config file alone, parameterised over all eight the README
lists), 2208 (a `simple-git-hooks.yaml` is not one of them), 2219 (a
package.json with neither key takes the native path and init writes
normally), 2231 (a package.json that will not parse is no declaration
rather than a throw) and 2241 (the guidance names the command, says
conductor does not edit package.json, and mentions `--force`). Four more
assert what is IN the captures rather than what init does with them: 2260,
2266 (2.8.0 carries no marker at all, which is the finding the declaration
rule rests on), 2276 and 2282 (the `exit 1` wrapper behind the claim the
guidance makes to a yorkie user about the umbrella's exit 2).

A `core.hooksPath` pointing outside the repository is refused
(src/init.ts:482-491). Writing there would install this repository's hook
on every repository on the machine. Pinned by tests/init.test.ts:1315.

An existing policy file is never rewritten (src/init.ts:728-735). It is
the one artifact a user edits by hand. Pinned by tests/init.test.ts:624.

One resolution rule underneath all of these: a RELATIVE `core.hooksPath`
resolves against the WORKING-TREE ROOT, not against the `.git` directory
(src/init.ts:385-388). A sibling tool resolved it against the `.git`
directory and the test covering the case asserted the same wrong location,
so the two agreed with each other and neither was ever checked against
git. The test here drives a real commit instead
(tests/init.test.ts:1285).

## The husky rule is structural, and content is never a signal

Where git looks and where the hook a human maintains lives are not always
the same file. husky 9 sets `core.hooksPath` to `.husky/_`, a generated
and gitignored directory it rewrites on every install, and the file git
executes there is a dispatcher that execs the TRACKED hook one directory
up.

The recognition rule is the SHAPE of the path and nothing else: the hooks
directory is named `_` and its parent is named `.husky`, both halves
required (`huskyDirectoryFor`, src/init-hook-detect.ts:104-113). Only husky creates
that path. The tracked target is that `.husky` directory's own
`pre-commit`, never a computed parent of whatever directory git happens to
point at (src/init.ts:563).

Two things are deliberately excluded from the rule, and each cost a bug.

THE CONTENT of the executed file is not a signal. The line that sources
husky's shim appears in two completely different places: under husky 9 the
file at `.husky/_/pre-commit` is a dispatcher, and under husky 8
`core.hooksPath` is `.husky` and the file there IS the tracked hook with
the shim as a preamble. Reading content therefore fired against husky 8's
tracked hook, and "one directory up" then pointed at the parent of
`.husky`, which is the repository root. Init wrote a hook there, never
read the real one so never saw the gate hook in it, reported success, and
left every commit ungated. The structural rule excludes husky 8 on its
own, because there the hooks directory is `.husky` and not `_`.

THE PRESENCE OF THE SHIM is not a signal either. Requiring it looks like
useful confirmation and quietly reintroduces the original trap: husky
gitignores `.husky/_`, so `git clean -xdf` deletes the whole directory
while `core.hooksPath=.husky/_` survives in `.git/config`. In that state
there is no shim and nothing to confirm, so a shim requirement sends init
down the ordinary path to write the very file husky's next prepare step
wipes. The shim is evidence that husky ran recently, not evidence about
whose directory this is, so it is REPORTED in the dry-run detail line and
never TESTED against (src/init-hook-detect.ts:115-118 and src/init.ts:665-673).

The husky redirect is decided before the generated-hook detection runs
(src/init.ts:508-520), so a husky dispatcher is never misread as
lefthook's or the pre-commit framework's.

Pinned by tests/init.test.ts:1345 (the tracked hook, not the dispatcher,
decides what is there), 1350 and 1375 (adopts the tracked hook, leaves
the dispatcher alone, restores byte for byte), 1390 (a real commit
through the dispatcher), 1424 (survives the reinstall that rewrites the
generated directory), 1446 (redirects on the path alone with no shim),
1470 (redirects after a clean), 1484 (survives the install that
repopulates a wiped generated directory), 1509 (does not redirect out of
a generated directory that is not husky's), 1537, 1550 and 1569 (husky 8
takes the native path, and a real commit proves it), and 1591 (a
dispatcher-shaped hook sitting in the ORDINARY hooks directory is foreign
rather than a reason to write somewhere else).

## The digest ladder: the marker says whose, the digest says which version

A hook carrying the umbrella's marker used to end the matter, and that was
a bug with a long fuse: a hook an OLDER conductor wrote carries the same
marker, so it was skipped for ever. It kept running that version's command
line after the hook text changed, and it never entered the new manifest,
so a later `--revert` walked past it and left it behind.

So the marker settles WHOSE hook this is, and the digest decides the rest
(src/init.ts:572-633), in four rungs:

- The installed bytes equal this version's hook. Nothing is written. If
  the manifest does not record that digest, the hook is RECORDED anyway,
  because a file init put there but cannot prove it put there is one
  revert walks past. A `git clean`, a deleted `.guardrails` directory and
  an install from before manifests existed all land in that state.
- The installed bytes equal what the manifest says a previous init wrote.
  Nobody has touched it, so it is the umbrella's to replace, and it is
  rewritten as an upgrade.
- `--force` was passed. It is replaced whatever it says.
- Anything else, which includes having no manifest to check against. The
  marker says it started as the umbrella's; the digest says it is not any
  more, and an edited hook is somebody's working setup whatever comment
  sits at the top of it. Conflict, nothing written.

Pinned by tests/init.test.ts:681, 698, 720, 787, 805, 814, 824, 833, 854,
880 (no manifest at all treated the same way) and 1999 to 2030, which
drive the upgrade using the captured previous hook body in
tests/fixtures/hooks, with tests/init.test.ts:1999 guarding the fixture
against drifting into being what init writes today, which would make
every assertion in that block pass for the wrong reason.

## The manifest is what makes revert honest

Without a record, "undo the init" means guessing which files were the
tool's, and a tool that guesses about deletion in somebody's repository
has to be wrong only once.

The manifest records each file's path, its sha256 and its KIND
(src/init-manifest.ts:9-18). The kind is recorded rather than inferred from the
path, because revert's whole decision turns on whether the HOOK survived
and sniffing that from a filename is a guess.

A rewrite carries forward everything a previous manifest held that this
run did not rewrite (src/init.ts:858-869). An upgrade rewrites the hook
and nothing else, so a manifest built purely from this run's writes would
forget the policy file it wrote last time. It also carries forward the
adopted hook, and that one matters more: the manifest is the ONLY copy of
the gate hook `--adopt` replaced, so forgetting it makes that hook
unrestorable (src/init.ts:798-806).

Pinned by the tests that actually OPEN the manifest and read the fields
this section is about: tests/init.test.ts:698 (the hook entry's kind and
sha256 are the new hook's, and not the old digest still sitting there),
779 (a lost manifest is rebuilt with a hook entry carrying the digest of
the file on disk), 724 (the policy entry survives an upgrade that
rewrote only the hook) and 735 (the adopted hook survives one). The
restore side is pinned by tests/init.test.ts:1079, which reads
`adopted.content` back out after a partial revert.

Not by tests/init.test.ts:911, which this file used to cite first. That
test inits and then reverts and asserts the hook file is gone; it never
opens the manifest, so it is evidence that the round trip works and no
evidence at all about what the manifest records. It is the clearest
example in this file of a citation that reads right from the test title
and proves something adjacent to the claim beside it.

## What revert guarantees

Revert removes exactly what init wrote and nothing else. Four rules, and
all four were bugs here first.

IF THE HOOK SURVIVES, NOTHING IS REMOVED. Files are classified first and
acted on second (src/init.ts:1017-1026), and a hook that has changed
since init wrote it returns before the removal loop is ever entered
(src/init.ts:1028-1050), because deciding as it went is what let the old
version remove the policy file before discovering it could not remove the
hook. Removing the policy file while leaving an edited hook in place
leaves that hook running the umbrella with nothing to read, so every
commit afterwards is refused with exit 2, while revert reported success.

Pinned in BOTH directions now. tests/init.test.ts:995 asserts the policy
file and the hook are both still there, which is the specific pair that
caused the incident. tests/init.test.ts:1010 asserts the guarantee itself
rather than a list of paths: no action on the result is a `remove` and
every one is a `skip`, so a file added to what init writes is covered
without anybody remembering to come back to this test.

A CHANGED FILE IS LEFT ALONE AND REPORTED (src/init.ts:1061-1068). That
file is now the user's whatever it started as, and a revert that deletes
edited work is a revert nobody runs twice. Pinned by
tests/init.test.ts:968 (an edited policy file survives and the run is not
a success) and 1034 (the conflict says `changed-since-init` and names
`--force`).

THE MANIFEST OUTLIVES A PARTIAL REVERT (src/init.ts:1124-1183). It is
deleted only once it holds nothing, because it is the only record of what
is left and, after an `--adopt`, the only copy of the replaced hook. The
`.guardrails` directory goes with it only when it is empty, using
`rmdirSync` rather than `rmSync`, and when it is not empty that is
REPORTED rather than passed over (src/init.ts:1129-1165). Pinned by
tests/init.test.ts:1028 (the manifest survives and still holds entries),
917 (the directory goes with the last file), 929 (it stays, and is
reported as skipped, when somebody else's file is in it) and 950 (it is
reported as removed when it went).

A PARTIAL REVERT IS NOT A SUCCESS. It returns `ok: false`, so the exit
code is non-zero and a script does not read "some of it" as "all of it"
(src/cli.ts:600), and the human rendering goes to stderr rather than
stdout so a pipe cannot carry it past the reader who needed it
(src/cli.ts:592-599).

AN ADOPTED HOOK IS NOT WRITTEN BACK WHILE THE UMBRELLA HOOK SURVIVES, or
the user ends up with two hooks at one path and the edit they asked to
keep is gone. Pinned by tests/init.test.ts:1095, which edits the umbrella
hook after an `--adopt`, reverts, and asserts the file on disk is still
the edit and that no action on the result is a `restore`. That test
exercises the changed-hook early return below, not the `umbrellaHookGone`
condition itself: an edited umbrella hook is a `changed` hook, so revert
refuses before the condition is ever read. The positive
half, that the gate's own hook does come back once the umbrella hook is
gone, is pinned at tests/init.test.ts:1114 (under `--force`), 1119 (the
hook deleted by hand, on a revert too partial to finish) and 1144 (without
`--force`, when the umbrella hook was never touched).

THE FLAG THIS FILE USED TO POINT AT HAS BEEN REMOVED. The restore used to
be guarded by a `hookRemoved` boolean raised while removing files, and
that guard was dead defence: a manifest that records an adoption also
records the hook init wrote in the same run, and every path that reached
the restore with a hook entry in the manifest had already set the flag.
The hook was either gone, removed, or removed under `--force`; the one
remaining case, a hook that changed with no `--force`, returned at the
changed-hook check long before. So the changed-hook early return was what
actually held the guarantee, and a refactor that kept the flag while
flattening that return would have satisfied the flag and broken the rule.

The condition is now read off the world rather than off the flag: the
manifest records at least one hook, and no path it records is on disk any
more (src/init.ts:1094-1107). That is a statement about what is there,
which is what the rule is about, so a future refactor of the early return
cannot restore a hook next to a surviving one. The flag is gone rather
than kept as a second line, because two conditions that must agree are a
place for them to disagree.

One test now reaches `umbrellaHookGone` rather than short-circuiting
before it: the dry-run adopt revert (tests/init.test.ts:2457) reaches it in
the matched state, where there is no changed hook to refuse at the early
return. Every OTHER state a test constructs still short-circuits at the
changed-hook early return (src/init.ts:1029-1050) first: a changed hook refuses
there directly, and a hook that is gone, matched, or force-replaced reaches
the condition only after the early return has already let it through, so in
real mode the condition and the flag it replaced agree either way, which is
why the real-mode `existsSync` derivation is defence in depth rather than a
thing a test pins on its own. The dry-run branch is NOT defence in depth: a
dry run leaves the hook on disk, so it must predict removal from the plan
instead of reading `existsSync`, and tests/init.test.ts:2457 goes red if
that branch reads the world. The init suite is 155 tests.

No manifest shape with an adoption and no hook entry is reachable from
init's own writes, which is what makes the removal safe. Init sets
`adopted` in exactly two ways (src/init.ts:798-806): the run that adopts,
which pushes the hook it writes into the same manifest, and the carry
across a re-init, which keeps a previous manifest's entries that this run
did not rewrite. Revert's own rewrite (src/init.ts:1171-1176) can only drop
the hook entry on a pass that also nulls `adopted`. A hand-edited
manifest could hold that shape, and there the code does what the old flag
did: nothing is restored.

No manifest at all means nothing is removed and the command fails
(src/init.ts:956-964). Pinned by tests/init.test.ts:1164.

A manifest that will not parse is a SECOND conflict rather than the same
one (src/init.ts:973-987). Revert deliberately does not go through
`readManifest`, which answers null for both: missing means there is no
record to act on, unreadable means there is a record and it cannot be
trusted, and the two send a reader to different fixes. Nothing is removed
and nothing is guessed either way. Pinned by tests/init.test.ts:1170,
which corrupts the manifest of a real install and asserts the reason is
`manifest-unreadable`, that the guidance says nothing was removed and
sends the user to the file by hand, and that the hook, the policy file and
the manifest itself are all still exactly as they were.

End to end by tests/dogfood.e2e.test.ts:417 and 435, which revert a real
repository with a hand-edited policy file and then finish the job under
`--force`. The ordinary case, that revert removes what init wrote and
leaves an unrelated file alone, is tests/init.test.ts:911, and the second
`--force` revert that cleans up after a refused one is
tests/init.test.ts:1053.

## The manifest is untrusted input: every path it names is contained to the repository

`.guardrails/manifest.json` is committed to the repository, so a person
who can land a commit can put any path in it. It is untrusted input, and
both revert and apply treat it that way: every `files[].path` and the
`adopted.path` is contained to the repository before anything is written
or deleted. A path is refused if it resolves outside the repository, AND
refused if any component of it is a symlink. Without this, a crafted
manifest made revert delete a file anywhere on disk through a `files[]`
entry, or write an executable one anywhere through `adopted.path` on the
umbrella-hook-gone restore, and exit 0. Every case was reproduced against
the built CLI, and the symlink case end to end through a real `git clone`.

Containment (`manifestPathInsideRepo`, src/init-manifest.ts:58-119) has two
conditions, because a path escapes two ways. Its string form, resolved
against the repository root, must be inside it: this refuses an absolute
path and one that climbs out with `../`, the same reasoning as
`resolvesInsideRoot` (src/intent-spec.ts:267-279). And no component of the
tail below the deepest existing ancestor may be a SYMLINK. The paths here
need not exist yet, because an adopted hook is restored to a path revert
has just removed and a recorded file may be legitimately gone, so the scan
resolves the deepest EXISTING ancestor with `existsSync` (which follows
links) and then `lstatSync`s only the tail below that ancestor. That
ancestor is then `realpath`'d, so its own components are already real. A
committed DANGLING symlink in the tail is caught: `existsSync` follows it
to a missing target and reports it absent, and `lstatSync` on the tail
sees the link. The scan stops at the first component that does not exist,
because nothing below a missing component exists, which keeps a
legitimately gone in-repo path revertible. A symlink above the deepest
existing ancestor is not walked with `lstatSync`; it is followed by
`existsSync` and then judged by where `realpath` lands.

Revert checks every recorded path up front and refuses the whole
operation, rather than skipping one path at a time, with a new conflict
`manifest-path-outside-repository` whose guidance names the offending path
(src/init.ts:998-1014). Apply contains every path it writes the same way,
including the `adopted` record carried forward from the committed manifest
(src/init.ts:808-832). The conflict reason is at src/init.ts:223-229.

Pinned by tests/init.test.ts:2319 (an absolute `files[]` path outside the
repository is refused and the file it aimed at is untouched), 2336 (a
`../` path that climbs out is refused and nothing is removed), 2355 (an
escaping `adopted.path` is refused and no file is written where it
pointed), and 2394 (apply refuses a write path outside the repository and
writes nothing). The symlink class is pinned by tests/init.test.ts:2523 (a
committed dangling relative symlink as `adopted.path`), 2538 (its symlink
pointing at an absolute outside target), 2557 (a dangling symlink component
mid-path), and 2578 (a `files[]` path that is a dangling symlink, on the
delete side); each asserts nothing is created outside. The regression that
an ordinary in-repo manifest still reverts is tests/init.test.ts:2391 and,
with no symlink anywhere, 2597. Removing the string check turns the
non-symlink escape tests red, and reverting the component scan to the
`existsSync` ancestor walk turns the symlink tests red.

THE MANIFEST'S OWN PATH IS CONTAINED TOO, on init and on revert, before
anything is written: a symlinked `.guardrails` directory or `manifest.json`
pointing out of the checkout is the `manifest-path-outside-repository`
conflict, and the manifest is written without following a link at its own
path (`applyInit`, `revertInit` and `writeManifestFile` in src/init.ts). A
link that stays inside the repository still works. Pinned by
tests/init.test.ts ("refuses a symlinked manifest file, writes nothing, and
leaves the target alone"), tests/init.test.ts ("refuses a symlinked
.guardrails directory, and creates nothing behind it") and
tests/init.test.ts ("refuses a revert that would rewrite a manifest reached
through a symlinked directory").

## Revert honours --dry-run: it plans and prints, and touches nothing

`--dry-run` promises to write nothing, and `--revert` promises to remove
what init wrote. Together they must plan the revert and change nothing, but
the CLI routed `--revert` to `revertInit` before `--dry-run` was consulted
and `revertInit` had no dry-run branch, so `init --revert --dry-run`
performed a real destructive revert.

`revertInit` now takes `dryRun` and skips every write while running every
read and every decision, so what it reports is exactly what a real revert
from the same state would do (src/init.ts:937-942, the flag; the guarded
writes are the file removals at src/init.ts:1071-1073, the adopted-hook
restore at src/init.ts:1111-1114, the manifest removal at src/init.ts:1125-1127 and its rewrite at
src/init.ts:1171-1176). `ok` is unchanged by the flag, so `--revert --dry-run` exits
the way the revert it previews would: the CLI threads the flag through
(src/cli.ts:585-588) and maps `ok` to the exit code as always.

One prediction cannot be read off the disk. Whether an adopted hook would
be restored turns on whether the umbrella hook would be gone after the
pass, which a real revert reads with `existsSync` after removing it. A dry
run did not remove it, so the dry-run branch asks the plan instead: a
recorded hook that reached this point is already gone, was matched (so it
would be removed), or is changed under `--force`, and any changed hook with
no `--force` returned far above (src/init.ts:1098-1106). Without this a dry
run of an adopted revert would mispredict `ok`.

The directory line is decided read-only on a dry run, since it cannot
rmdir to learn whether `.guardrails` would be left empty
(src/init.ts:1134-1145). `renderRevertHuman` says "(dry run)" and turns
every action verb into "would ..." (src/init.ts:1256-1268).

Pinned by tests/init.test.ts:2434 (an installed hook, policy and manifest
are byte for byte identical after a dry-run revert, and it still reports
success so the CLI exits 0), 2449 (a dry-run revert of an adopted setup
restores nothing on disk and still predicts success), and 2467, which
drives the real built CLI with `init --revert --dry-run` and asserts exit 0
with every file unchanged. Forcing `dryRun` to false turns all three red.

## Intent at pull request time: nothing is ever written under the repository's own state directory

The intent gate refuses to check anything against a contract nobody
approved, and approving one is a per-task human step. That step is the
ceremony the stopping-points design exists to keep out of a pull request,
so the umbrella imports the document the work was actually approved from,
freezes it in a TEMPORARY directory, and points the gate at that directory
for the length of one run (the import chain in `finishPreparation`,
src/intent-prepare.ts).

Nothing is written under the repository's own state directory, under
either of its two names. A contract is a committed artifact with an
approver's name on it. A pull-request run that dropped one into the
working tree would either be committed by accident or picked up by the
next run as though a person had approved it, and the second failure is
silent. Pinned by tests/intent-prepare.test.ts:306, which asserts the
repository has no `.conductor` AND no `.intent-guard` directory
afterwards. Both names, because checking only the one the draft is written
under would pass for a version that migrated the temporary project and
then wrote into the repository under the new name.

THE DRAFT IS WRITTEN UNDER THE LEGACY NAME inside that temporary
directory (`LEGACY_NATIVE_CONTRACT_PATH`, written in `finishPreparation`),
and that is a version
independence decision rather than an oversight. A 1.2.x intent-guard reads
only `.conductor/`; a 1.3.0 one reads it as the legacy fallback and
renames it to the canonical name on its first write, which the freeze is.
Writing the canonical name would work on 1.3.0 and leave 1.2.x freezing an
empty project. Pinned by tests/intent-prepare.test.ts:813.

FREEZE EXITING 0 IS NOT PROOF THERE IS A CONTRACT TO HAND THE GATE. After
the freeze the contract is looked for under both names, canonical first,
and its absence is a named preparation failure at the freeze step rather
than a confusing verdict from the gate three steps later
(`frozenContractIn` in src/intent-prepare.ts, called right after the
freeze in `finishPreparation`). That lookup asks EXISTS rather than FROZEN,
unlike the repository-side one, because reading `frozen_by` here would be
the umbrella second-guessing a decision it has just asked intent-guard to
make. Pinned by tests/intent-prepare.test.ts:825, whose stub freezes
successfully and removes both directories.

The freeze is attributed to the umbrella and to a commit, never to a
person, and the spec path in that attribution is repository-relative
because the string ends up inside a contract (the `--approved-by` argument
of the freeze in `finishPreparation`; on a trust-base run the commit named
is the base's, where the spec was read from).
Pinned by tests/intent-prepare.test.ts:335 ("freezes the temporary contract, attributing it to the spec and the commit"), which asserts the freeze argv contains the spec path.

The temporary directory is always removed. Every failure path after the
directory exists calls `cleanup` before returning
(every failure return in `finishPreparation` after the directory is made),
and the success path is removed by the
caller's `finally` once every gate has run, whatever happened while they
did (src/run.ts:715-724). The failure half is pinned by
tests/intent-prepare.test.ts:440, which drives the chain to a freeze that
refuses and then finds no directory carrying `TEMP_PREFIX`.

THE SUCCESS HALF IS PINNED AT tests/intent-run.test.ts:171, which drives a
full passing run through the import and freeze chain and looks in the same
place, the same way. It asserts the run really did import a contract
before it looks, so it cannot pass on a directory that was never created.
Nothing in the code changed for it: removing the `cleanup()` call from the
`finally` in src/run.ts turns that one test red and leaves every other
test in the file green, which is what makes it the thing holding the rule.

BOTH LOOK IN A ROOT OF THEIR OWN rather than in the system temporary
directory, and that is not cosmetic. They live in two files, jest runs
those in separate workers, and each was counting the other's directories:
the count could move in either direction between the two reads for reasons
that had nothing to do with a leak. The root is injected
(`IntentPrepareOptions.tempRoot`, threaded through `RunOptions.tempRoot`),
the same seam the environment and the clock already use, and nothing in
production passes it. TMPDIR would have been the smaller change and does
not work: node reads it from the real process environment, and a jest
test's `process.env` is a copy that never reaches it.

The cost of being wrong is one leaked directory per pull request on a
shared CI runner, with nothing in any report pointing at the cause. Note
that tests/intent-prepare.test.ts:355 does NOT cover this: it only proves
that calling `cleanup` yourself works.

## The repository's own frozen contract wins, and "frozen" means one specific thing

Where a team has done the native flow, the native flow is what runs. The
import is the fallback for a repository that has not, never a replacement
for one that has (`prepareIntent` in src/intent-prepare.ts).

ON A RUN WITH A TRUST BASE THE DECISION IS MADE FROM THE BASE ALONE
(`prepareAgainstTrustBase` in src/intent-prepare.ts). A trust base always
makes the run pull-request shaped, and the change set is measured from it
when no other base is named (`isPullRequestShaped` in src/run.ts,
`resolveBaseRefInRepo` in src/intent-base.ts). Nothing the head carries is
consulted for whether a frozen contract governs the pull request:

- The base has a frozen contract: it is used, native, with the trust base
  handed to the gate, ahead of `--spec`, a `Spec:` line or the convention.
  An edit or deletion in the pull request is judged by the gate against
  the base copy. That holds for every intent-guard that can run on such a
  run: one below its pull-request-mode minimum is could-not-run rather than
  run without the flag, so no gate on a trust-base run reads the head's
  contract instead. When `--spec` was given, the report says in one line that
  it was not used, and such a run always prints the full report.
- The base has none: nothing in the pull request becomes the contract. A
  spec on the base, found by the usual three sources, is imported from its
  BASE copy, staged in the temporary project, which is the importer's
  `--project` and working directory, so no file in the tree being judged
  is opened. Otherwise the gate is skipped with "No contract on the base".
  A contract or spec the pull request adds, and an edit to the imported
  spec, is reported as a proposal of the intent gate, so a first adoption
  merges and is judged from the next pull request.
- A base contract that is a symlink, a directory, a submodule or a missing
  blob is could-not-run at the contract-source step.

Pinned by tests/intent-prepare.test.ts ("uses the base frozen contract,
native, when the pull request deletes it"), tests/intent-prepare.test.ts
("uses the base contract path when the head carries a different frozen
contract elsewhere"), tests/intent-prepare.test.ts ("never lets a frozen
contract the head adds become the contract: a skip, with the addition as a
proposal"), tests/intent-prepare.test.ts ("imports the base copy of a spec
the pull request edits, from a temporary project"),
tests/intent-prepare.test.ts ("is could-not-run at contract-source when the
base contract is a symlink, a directory, a submodule or a missing blob"),
tests/intent-run.test.ts ("judges the branch change set against the trust
base with no --base and no GITHUB_BASE_REF") and tests/intent-run.test.ts
("says in one line, even on a clean run, that --spec was not used because
the base has a frozen contract").

"Exists" is not the test. `frozen_by: user` and nothing else, because that
is the marker THE GATE ITSELF reads
(`contractIsFrozenAt`, src/intent-prepare.ts:191-214). BOTH halves of the
gate's own test, `frozen_by: "user"` AND an `approval` record present,
because that is what `isContractFrozen` does and its comment says
`frozen_by` alone, hand-set in YAML, is not enough; accepting half of it
calls a contract frozen that the gate will call unfrozen, which skips the
import and then blocks the pull request on "not frozen by user" without
checking anything. A real freeze on either version writes both, so
requiring both excludes no contract either tool produced. Pinned by
tests/intent-prepare.test.ts:841. Accepting an
`approval` block as an alternative was a guess dressed up as tolerance: a
real freeze writes both, so the only contracts the second test admitted
were hand-edited or half-written ones, and admitting those skipped the
import and then let the gate block every pull request with "exists but is
not frozen by user". A file that will not parse is treated as not frozen,
which sends the run down the import path rather than handing the gate
something it will reject.

THE CONTRACT LIVES UNDER ONE OF TWO NAMES, CANONICAL FIRST. intent-guard
1.3.0 renamed its per-project state directory from `.conductor` to
`.intent-guard`, because `.conductor` had become the name of a different
product in this same family, and a repository adopting both showed
`.conductor/` and `.guardrails/` side by side with nothing to say which
tool owned which. Both are read, so a repository on either version is
checked rather than blocked; the pair and its order are declared once
(`NATIVE_CONTRACT_PATHS`, src/intent-prepare.ts:84-87) and every consumer
reads that rather than spelling the order itself. The filter that applies
it is `frozenNativeContracts` (src/intent-prepare.ts:231-235).

THE ORDER DECIDES WHICH PATH A RUN WITH NO PREPARATION NAMES when both
files are frozen. `frozenNativeContractPath` (src/intent-prepare.ts:252-254)
returns `frozenNativeContracts(repoRoot)[0]`, and that path is what a
no-preparation run reports (`nativeContractOption`, src/run.ts:472-475,
and the same helper from init). `prepareIntent` refuses a repository that
holds both state directories (`stateDirsConflict`) before it would have to
choose, so inside a prepared run the order is not which contract is used.
`frozenContractIn` (src/intent-prepare.ts:350-354) finds the first existing
path and the call at src/intent-prepare.ts:699 compares it to `null` and
discards the value. tests/intent-prepare.test.ts ("declares the two paths canonical first") pins the array order.

A REPOSITORY WITH BOTH STATE DIRECTORIES IS COULD-NOT-RUN
(`stateDirsConflict`, src/intent-prepare.ts:334-339, over the marker list
at src/intent-prepare.ts:264-270 and `holdsIntentGuardState` at 304-309,
raised at src/intent-prepare.ts:471-483 as a `contract-source` step of its
own).

THIS MIRRORS THE GATE'S OWN CONFLICT RULE EXACTLY, and the exactness is
the point: the canonical directory merely EXISTING, even empty, beside a
legacy directory holding any of intent-guard's own state markers
(`config.yaml`, `intent-contract.yaml`, `index.md`, `drift-log.jsonl`,
`contracts`), frozen or not. A `.conductor` holding none of them belongs
to something else and is left alone, which is the one case where the two
coexist legitimately.

THE TWO SIDES TEST DIRECTORY-NESS DIFFERENTLY, and the asymmetry is the
gate's own rather than an oversight. The legacy side uses `lstat`
(`isRealDirectory`, src/intent-prepare.ts:296-302), so
`ln -s .intent-guard .conductor` -- the obvious workaround for a script
that still names the old path -- is not a legacy state directory at all;
following it would make ONE directory look like two and fail the run closed
on a conflict that does not exist. The canonical side keeps `stat`
(src/intent-prepare.ts:272-278), because a canonical directory reached
through a symlink is still one intent-guard reads and writes. Making both
sides `lstat` would look neater and would miss that conflict. Both halves
are pinned: tests/intent-prepare.test.ts:696 (the legacy symlink is not a
conflict) and 715 (the canonical symlink still is).

An earlier version of this rule was NARROWER -- both directories holding a
FROZEN contract -- and this file argued for it: a stale unfrozen draft
beside a real contract has an obvious right answer, and refusing would
fail pull requests over a file nobody had looked at in months. That
argument was about the wrong tool, and an independent review found it
against the real 1.3.0 build. In that exact state the gate's `stateDir`
throws and every intent-guard command exits 1, so the narrower rule saved
none of those pull requests; it moved where they broke. conductor handed
the gate a repository the gate refuses to run in, the child exited
non-zero with no JSON, and the run surfaced as
`conductor/gate-output-unparseable` with a message about the umbrella
being out of date with the gate. The lesson is the one at the top of this
file: a claim about another tool is worth exactly as much as the run that
checked it, and this one had not been checked.

The check sits ABOVE the `--spec` branch, because the import path runs
`import-spec --project .` in that same repository, where the gate fails
closed on the same conflict and reports it as an opaque non-zero exit from
a subcommand. The guidance says to MOVE the old directory aside and never
to delete it: conductor has not read what else is in there.

Pinned by tests/intent-prepare.test.ts:640 (both frozen, the case a reader
thinks of first, now subsumed), 656 (an unfrozen draft beside a real
contract, which is the case the narrow rule got wrong), 675 (a
parameterised case over all five of the gate's own state markers), 734 (a
`.conductor` holding none of them is somebody else's and is ignored), 751
(the message names both directories and says move rather than delete) and
796 (the flag does not get past it).

READING THE OLD DIRECTORY IS SAID OUT LOUD, as one aside on the text
report's contract line (src/output-text.ts:114-121) and one
`intent-guard/legacy-state-dir` notification in the SARIF log
(src/output-sarif.ts:564-588). Both go through one predicate over the
source path (`isLegacyContractPath`, src/intent-prepare.ts:97-99) rather
than a boolean carried beside it: the path is already the fact, and a flag
travelling next to it is a second copy that can disagree with the first.
It is a NOTIFICATION rather than a result, and it is the closest call of
the five: nothing went wrong, the gate ran, and the verdict is exactly
what it will be after the migration, so as a result it would be a
fingerprint-less alert reappearing on every pull request until somebody
upgrades. Pinned by tests/intent-run.test.ts:608 (in the log as a
notification, naming both paths), 632 (never a result, in the other
direction), 646 (the text report) and 658 (silent on the canonical
directory, in both formats).

An explicit `--spec` outranks even a frozen native contract
(src/intent-prepare.ts:487-490, where the `flag` branch is taken before
the native contract is consulted), because a person typed it just now.

The native-contract rule is pinned by tests/intent-prepare.test.ts:153,
163, 169, 179 and 197, and by 607 and 621 for the two directories. THE
`--spec` PRECEDENCE IS PINNED BY
tests/intent-prepare.test.ts:230 and 241, which build one repository
holding both a `frozen_by: user` native contract and a spec, pass the
spec by flag, and assert the reported source is the imported spec and
that the gate is handed a temporary directory rather than `.`, with
`import-spec` and `freeze` both recorded as having run. Note that the
native tests above have a DISCOVERED spec beside the contract, which is
the opposite rule; and tests/intent-spec.test.ts ("lets --spec win over a Spec: line in the PR body") covers `--spec`
beating a pull request body, a different question in a different file.
Neither covers this.

The branch order at src/intent-prepare.ts:487-490 is still the mechanism.
Before those two tests, a reordering that tested `nativeContractIsFrozen`
first would have looked correct in review, because every existing test
passed either way: none of them had both. What a user would have seen is
`--spec` ignored in exactly the repositories that have done the native
flow, with the report naming the native contract as the source, so the run
would be honest about what it used and silent about what it was asked
for. Swapping the two branches now turns both tests red.

## Spec discovery: three sources, and the order is the whole decision

`--spec` on the command line outranks everything. A path there that does
not exist is REPORTED rather than replaced by a discovered one, because
running a different contract than the one a person just named is the wrong
kindness (src/intent-spec.ts:533-539, reported at
src/intent-prepare.ts:673-681).

A `Spec:` line in the pull request body comes next, anchored to the start
of a line so a sentence containing the words in prose is not read as
somebody naming a file, and the FIRST such line wins when a body carries
two (src/intent-spec.ts:373-376). A path here that does not exist falls
through to the convention, because a typo in a pull request description
must not be able to fail a build.

`Spec: none` in that same first line is the one value that does NOT fall
through. It is a WAIVER: a statement that this pull request deliberately
has no spec, answered with a `waived` discovery before the convention is
tried, because an explicit statement beats an inferred one
(src/intent-spec.ts:541-551, with the token itself at
src/intent-spec.ts:60-70). The token is exact and lowercase; anything else
unusable keeps the silent fall-through, so a sentence with "None" in it
cannot switch a gate off. The waiver sits BELOW `--spec` in this file and
below a frozen native contract in prepareIntent
(src/intent-prepare.ts:711-724, the branch after the native contract
rather than before it), which is the whole meaning of it: it says there is
nothing to import, never that a contract this repository froze should be
ignored.

The convention is a markdown file DIRECTLY under `docs/superpowers/specs`
whose name matches the branch slug on whole tokens. Directly under, not
nested, because that is the layout the gate's own importer discovers and an
archive subdirectory is not a candidate for this branch's contract
(src/intent-spec.ts:401-411).

The convention matches whole tokens, never a substring. Branch slug and
spec stem have their ASCII letters lower-cased (no other character is
folded, so no non-ASCII character can fold into a match) and are split on
hyphen, underscore, slash and ASCII whitespace only (never Unicode
whitespace); a spec is a candidate only when the shorter token sequence is
one contiguous run of the longer and that run holds a significant token
(three or more characters, letters digits and dots only, at least one
letter, not a stop word). A slug with no significant token selects nothing
(`tokens`, `isSignificant` and `candidateRun` at src/intent-spec.ts:150-212,
the closed stop list at src/intent-spec.ts:124-135). A stop word is ignored
as evidence but keeps its place in the sequence, so deleting one cannot make
two names contiguous. Pinned by tests/intent-spec.test.ts ("folds ASCII
case and splits on hyphen, underscore, slash and ASCII whitespace", "keeps
a dot inside a token", "rejects short tokens", "rejects stop words",
"rejects a token with no letter", "rejects a token outside letters, digits
and dots", "is exactly the closed list of the design", "rejects a match
inside a word, which the substring rule accepted", "rejects tokens that are
all present but not one contiguous run", "keeps a stop word in the sequence
for the contiguity test", "rejects an equal name made only of
non-significant tokens", and "selects nothing for the dogfood branch pr,
and names what 0.10.0 chose").

Candidacy and victory are different questions. Candidates are grouped by
their folded stem sequence, and a group's member is its lexically greatest
filename (the newest date only when every name carries a well-formed one);
groups are ranked by an exact sequence, then the number of significant
shared tokens, then the length of the longest shared token
(`selectByBranch` and `compareScore`, src/intent-spec.ts:270-358). 0.10.0's stem-length key is
gone: it let a long vague stem beat a short precise one whenever both
contained the slug. Ranking on the newest name alone, before that, answered
the second question with the first: a loose candidate carrying a later date
beat the spec whose stem was the branch slug exactly, and an undated name
beat everything because it sorts after every date. A pull request was then
measured against a different feature's requirements with nothing in the
report saying so.

An ambiguous selection is reported, never guessed. When the top two stem
groups tie on every ranking key, no spec is chosen, the gate is a
`spec-ambiguous` skip on the working tree and at the trust base alike, and
every tied spec is named (src/intent-spec.ts:333-337, the skip at
src/intent-prepare.ts:219-246, reached at the trust base before the
head-spec proposal at src/intent-prepare.ts:1446-1448). Pinned by
tests/intent-spec.test.ts ("names both of two equally matching specs and
chooses neither", and "says ambiguous where the longer-stem key would have
picked one"), tests/intent-prepare.test.ts ("skips as spec-ambiguous on the
working tree, naming both specs", and "skips as spec-ambiguous at the trust
base, naming the base ref and its files, and keeps the proposals") and
tests/intent-run.test.ts ("reports a tie as spec-ambiguous on every
surface, with exit 0").

A spec chosen by the branch name on one significant token, or by the
token-length key alone, is selected and labelled weak in the gate block,
the --verbose block, a SARIF note and the step summary; the label never
changes its verdict or enforcement. Pinned by tests/intent-spec.test.ts
("labels a single shared token weak", and "labels a win on token length
alone weak, naming the runner-up") and tests/intent-run.test.ts ("labels a
single-token choice weak in the gate block, --verbose, SARIF and line 3",
"names the runner-up when the longer word decided", "keeps a weak
selection blocking and enforced", and "handles a weak selection under
enforce: false exactly as an exact one").

On the normalisation `tokens(x).join("-")`, the token rule only removes
bindings: every branch and spec pair that is a candidate is one the
substring rule accepts on those normalised strings. On raw strings it
gains exactly five kinds of pair and no others: ASCII case, underscore for
hyphen, slash for hyphen, whitespace for hyphen, and doubled, leading or
trailing delimiters. No non-ASCII character contributes. Pinned by
tests/intent-spec.test.ts ("makes no candidate the substring rule rejects
on the hyphen-joined tokens of both sides", "gains, on the raw strings,
only pairs that differ from their normalised form by the five foldings",
"does not let a Kelvin sign fold into an ASCII k", and "does not let a
no-break space act as a delimiter").

One function, selectByBranch, makes the convention choice on the working
tree and at the trust base (defined at src/intent-spec.ts:300, called from
`discoverSpec` at src/intent-spec.ts:565-582 and from `discoverSpecAtRef`
at src/intent-prepare.ts:1292; the trust-base head-spec proposal reuses
`discoverSpec`). Pinned by tests/intent-spec.test.ts ("leaves no
stemMatches or bestMatch in src, and calls selectByBranch from the two
selection paths").

Known open, time-limited: the legacy substring answer is computed for
reporting only, until the release after 0.11.x removes it; it never decides
a selection (`legacySelection`, src/intent-spec.ts:249-268, read only into
the `legacy` field). Pinned by tests/intent-prepare.test.ts ("skips a branch
0.10.0 bound inside a word, on both paths, saying so") and
tests/intent-run.test.ts ("says a branch 0.10.0 bound is now skipped, on
line 3, in SARIF, and off the one-line summary", "notes a changed winner in
the gate block, SARIF and line 3", and "prints the changed-winner line, not
the weak one, when the new winner is weak").

A plan is paired only on an EQUAL stem (src/intent-spec.ts:436-450). No
plan is a fine outcome, since the gate imports a spec on its own; the
wrong plan freezes one feature's requirements against another's change
budget, and the resulting block or pass is about neither of them.

Pinned by tests/intent-spec.test.ts ("finds a spec by branch slug, with
the date prefix and -design suffix stripped", and "pairs the plan matched
by the same stem rule"), the ranking by tests/intent-spec.test.ts ("takes
the lexically newest filename when several specs match", "prefers the spec
whose stem IS the branch slug over a newer looser one", "does not let an
undated looser spec win by sorting last", "takes the most specific match
when none is exact", "lets an exact stem beat a candidate it ties on count
and length", "lets a higher count beat a longer token", "treats two files
with one stem and different dates as one group, the lexically greatest
winning", "puts a plain .md after its -design.md twin, by lexical order",
and "reports a malformed date as a different stem, and so an ambiguous
pair"), and by tests/intent-spec.test.ts ("pairs no plan at all rather than
another feature plan", "lets a Spec: line in the PR body win over the
branch-slug match", "lets --spec win over a Spec: line in the PR body",
"falls through to the convention when the PR body names a file that is not
there", "reports a --spec path that is not there rather than quietly
discovering another", "finds nothing when no spec matches the branch",
"finds nothing when the spec directory does not exist at all", "ignores a
spec nested in a subdirectory, which is not the convention", "ignores a
file under the spec directory that is not markdown", and "pairs a plan
with a spec that came from the PR body"). A named spec is never subject to
the token rule: tests/intent-prepare.test.ts ("takes a --spec or a Spec:
line as named, with no match record, on a branch the rule rejects").

The waiver is pinned by tests/intent-spec.test.ts ("beats the branch-slug
convention, even with a matching spec on disk", "is waived rather than
none, so the report can tell the two apart", "loses to --spec, which is the
most explicit statement of all", "is the exact lowercase token and nothing
else", and "takes the FIRST Spec: line, so a later real path does not undo
it").

## Containment applies to the pull request body, the convention spec and the plan, and to --spec only on a pull-request run

A path named in a pull request body must RESOLVE inside the repository
(`resolvesInsideRoot`, src/intent-spec.ts:267-279). That body is written
by whoever opened the pull request, and on a fork pull request that is
somebody with no write access at all. Without the check, a
`Spec: ../../etc/something` line imports an arbitrary readable file from
the runner into a contract, and its path then appears in the reported
`contractSource` and inside the `--approved-by` string.

The test is on the RESOLVED path, not on the spelling. A string test left
a two-step route to the same escape, and one pull request can take both
steps: on a `pull_request` event the checkout is of the merge ref, so a
fork's own commits are in the tree, and the same pull request can add a
symlink pointing outside AND the `Spec:` line naming it. To a string test
that line is an ordinary relative path.

This is containment, not a ban on symlinks: one pointing at a file inside
the repository resolves inside it and is used. A path that will not
resolve at all is not contained either, which lands it in the same place
as a path that is simply not there. The repository root is itself resolved
before the comparison, because on macOS a temporary directory reaches the
caller through a symlink and comparing a resolved candidate against an
unresolved root would report every path in such a tree as an escape.

On a run WITHOUT a trust base, `--spec` is deliberately NOT held to any of
this. A person typed it on the command line just now, and pointing at a
spec kept outside the checkout is a real thing to want (`discoverSpec` goes
straight to `exists` for it). On a run WITH a trust base it is held to
more: the spec is read from the base ref, so `--spec` must be a plain path
inside the repository (no absolute path outside it, no "." or ".."
segment) that the base carries, and a frozen contract on the base takes
precedence over it (`discoverSpecAtRef` and `prepareAgainstTrustBase` in
src/intent-prepare.ts).

The convention spec and the plan for any spec are held to it as well, but
an escape there is REFUSED, could-not-run at the spec step naming the file
and how to clear it, and never reported as nothing to check
(`discoverSpec` and `planFor` in src/intent-spec.ts). Pinned by
tests/intent-spec.test.ts ("refuses a convention spec reached through a
symlinked specs directory, naming it") and tests/intent-spec.test.ts
("refuses a plan reached through a symlinked plans directory, rather than
dropping it").

Pinned by tests/intent-spec.test.ts ("falls through to the convention
rather than importing it", "finds nothing at all when there is no
convention match to fall through to", "refuses an absolute path out of the
tree the same way", "refuses a committed symlink that points out of the
tree", "still follows a symlink that stays inside the tree", "treats a
dangling symlink as a path that is not there", and "still lets --spec point
outside, because a person typed it").

## A branch with no spec is advisory, and never changes the exit code

A `SkippedGate` is not a deferred gate, not a could-not-run, and not a
finding (src/run.ts:82-103). Nobody asked for a different
stage, nothing broke, and a branch that has no spec is a branch this gate
has no opinion about. Turning that into a failed build is how a gate gets
switched off repository-wide.

It never reaches the exit code, enforced or not, because a skipped gate
produces no `GateOutcome` and `composeExitCode` only ever sees outcomes.
It is still on screen: one line in the text report
(src/output-text.ts:232-237), one notification in the SARIF log
(src/output-sarif.ts:650-663), and a distinct verdict sentence when it is
the only thing that happened (src/output-text.ts:579-618), because telling
somebody to set `enabled: true` is the wrong advice for a gate that is
already on and had nothing to check.

The contract source is decided before the base ref is resolved
(src/intent-prepare.ts:434-452). `discoverSpec` runs first.
`currentBranch` may still run `git rev-parse --abbrev-ref HEAD` when
`GITHUB_HEAD_REF` is empty (src/intent-base.ts:144-158), which reads the
branch name and does not resolve the base ref. The promise is that a
repository with no spec is not turned into exit 2 by a shallow history.

There are TWO reasons a gate lands here, and they are carried apart rather
than flattened into one sentence: `no-contract`, the ordinary state of a
branch nobody has written a spec for, and `contract-waived`, a pull request
body that said `Spec: none`. The reason travels from prepareIntent through
`SkippedGate` into both reports. In the SARIF log it IS the second half of
the notification id, so `intent-guard/no-contract` stays exactly where
consumers already have it and the waiver gets an id of its own. In the text
report it decides the wording in ALL THREE places that report a skip, and
one function answers for all three (`skipWording`,
src/output-text.ts:254-275): the skipped line, the verdict sentence for a
run whose gate list is empty, and the clause on the one-line summary of a
clean run.

A third reason arrived in 0.11.0, `spec-ambiguous`: two or more specs
matched the branch name equally, so the convention chose none (see "Spec
discovery" above). It is advisory exactly like the other two and reaches no
exit code. Its summary-line clause exists in `skipWording` but is never
printed: `isFullyClean` keeps any run with a `spec-ambiguous` skip, or with
a skip carrying the 0.10.0 legacy answer, off the one-line summary, so the
sentence naming the tied specs is always on screen. Pinned by
tests/intent-run.test.ts ("keeps a tie off the one-line summary, beside a
second clean gate, while the token stays pass").

Three, not one, and this was wrong when it was first written. Only the
skipped line was reason-aware; the verdict still said "had no contract to
check against" and the summary still said "Nothing to check against". Both
of those tell a reader to go and write a spec, on a pull request whose
author has just written down that there is none, and the two that were
wrong are the ones people actually read: the verdict is the last line of
the report, and the summary line is the WHOLE report on a clean run, which
is what a pre-commit hook and the pull request comment step in the README
print. The paragraph above claimed the reason reached "both reports"
before it did.

Pinned by tests/intent-run.test.ts:269, 283, 287, 291 and 316, and
tests/intent-prepare.test.ts ("is a skip naming the reason, not a failure")
and tests/intent-prepare.test.ts ("never runs git, so a shallow
checkout cannot turn a missing spec into a failure"). The waiver half is
pinned at tests/intent-prepare.test.ts:544 and 557 (the reason is the
waiver, and a frozen native contract still outranks it) and
tests/intent-run.test.ts:477, 491 and 517 (the reason reaching the run
result, the SARIF notification under its own id, and the skipped line plus
the summary clause, which asserts the summary does NOT say "Nothing to
check against"). The verdict is pinned separately at
tests/intent-run.test.ts:573, with an INTENT-ONLY policy, because that is
the only shape that reaches it: the policy declared at line 452 puts a
second, clean gate beside the waived one, so its run has a `GateOutcome` and never takes the
empty-gates branch. An intent-only policy is not a corner case, it is what
`--gate intent` produces.

## The change set is the umbrella's own, and each flag is a decision

The umbrella computes what the branch changed, because `--base` inside the
gate resolves git relative to `--project`, which may be a temporary
directory with no repository in it (`changedPathsSince` in
src/intent-base.ts). The one exception is a native contract on
intent-guard 1.8.1 or later, whose project IS the repository: that gate is
handed its own `--base` instead of `--paths` (see "Where the tool refuses
rather than guesses").

`--ignore-submodules=none`, so a moved submodule pointer is listed even
where `ignore = all` in .gitmodules or diff.ignoreSubmodules in git config
would hide it. Pinned by tests/intent-base.test.ts ("is listed even when
.gitmodules says ignore = all").

Three more flags, each one a decision. `-c core.quotePath=false` is passed
beside `-z`. Under `-z` git does not C-quote, so removing
`core.quotePath=false` would not turn the unquoted-path test red.
`--no-renames`, so a
rename lists BOTH its old and its new path, since moving a file out of a
protected directory still has to block and cannot if only the destination
is listed. And the three-dot range, which asks what the branch changed
since it forked rather than how it differs from the base branch right now.
A two-dot diff attributes every commit that landed on the base branch
after this branch forked to this branch, so somebody else's merge breaches
this pull request's change budget.

Output is NUL-separated (`-z`) and split on NUL and NOTHING else (src/intent-base.ts:207).
Trimming each line was corrupting a filename with leading or trailing
whitespace into a different filename, which is worse than refusing it: the
gate would then check a path that does not exist and never check the one
that changed.

A prepared run replaces `--staged` entirely rather than adding to it
(src/gate-runner.ts:566-588), because the two path sources are ADDITIVE in
the gate, so leaving `--staged` on would silently widen a pull request's
change set with whatever happens to be in the index of the machine running
it. `--paths` is passed even when the branch changed nothing, so the empty
set is stated rather than left for the gate to fill in from the index.

`GITHUB_BASE_REF` is a branch name and not a ref anything local can
resolve, so it is prefixed with `origin/`; Actions defines it and leaves
it EMPTY outside a pull request, so an empty value has to mean "no pull
request" rather than "origin/", which would fail every push build closed
(src/intent-base.ts:40-52). The branch name comes from `GITHUB_HEAD_REF`
first, because a pull request build is on a detached head and git answers
"HEAD" there, matching no spec at all (`currentBranch`, src/intent-base.ts:144-158).

The environment is INJECTED into `runAll` and defaults to EMPTY rather
than to `process.env` (src/run.ts:232-241 for why, src/run.ts:516 for the
default itself). Without that, running this package's own suite inside a
pull request build would put every gate into the pull-request flow,
because Actions sets `GITHUB_BASE_REF` for the whole job.

Pinned by tests/intent-base.test.ts ("takes --base when it is given"), tests/intent-base.test.ts ("defaults to origin/<GITHUB_BASE_REF> in a pull request build"), tests/intent-base.test.ts ("lets --base win over GITHUB_BASE_REF"), tests/intent-base.test.ts ("resolves to nothing when neither is present, which is the v0.1 run") and tests/intent-base.test.ts ("ignores an empty GITHUB_BASE_REF, which is what a push build sets"), tests/intent-base.test.ts ("lists what the branch changed and not what landed on the base afterwards"), tests/intent-base.test.ts ("lists both sides of a rename, because a move out of a protected path still counts"), tests/intent-base.test.ts ("lists an unquoted path for a file name that git would otherwise escape") and tests/intent-base.test.ts ("keeps a space in the middle of a path, which is an ordinary filename"); and
tests/intent-run.test.ts:198 (the branch diff rather than the index), 227
(the base taken from the pull request environment), 425 ("is never read
unless the caller passes it in") and 538.

## Reporting: a statement about coverage is a notification, a statement that something went wrong is a result

This is the discriminator, and it is written here because it has now been
taken four times and should decide the fifth case itself.

A statement about HOW MUCH OF THE POLICY A RUN COVERED is a NOTIFICATION.
It is true of the configuration rather than of this change, identical on
every run until somebody edits the policy file, and on the adoption ramp
deliberately true for weeks. A permanent alert is a dismissed alert, and
it teaches the reader to dismiss the next one. Five cases live here:
`conductor/gate-deferred` (src/output-sarif.ts:538-546),
`conductor/gate-excluded` (src/output-sarif.ts:602-609), the per-product
skipped advisory, whose id is the product and the skip reason and so is
either `no-contract` or `contract-waived` (src/output-sarif.ts:673-685),
`conductor/gate-not-enforced` (src/output-sarif.ts:960-993), and
`intent-guard/legacy-state-dir` (src/output-sarif.ts:566-590), all of them
collected at src/output-sarif.ts:1053-1066 and written into
`invocations[0].toolExecutionNotifications` on the umbrella's run
(src/output-sarif.ts:475-482 and 1085-1109). As results they were
fingerprint-less note alerts that reappeared on every run, so a repository
on the adoption ramp accrued permanent alerts about this tool's own
configuration.

A statement that SOMETHING WENT WRONG is a RESULT. It is about this run,
it goes away when somebody fixes it, and a reviewer of this change is the
person who should see it. `conductor/gate-missing`,
`conductor/gate-failed` and `conductor/gate-output-unparseable` stay
results, because a gate that could not run means a class of problem went
unlooked-for on this change. So do the umbrella's own normalization
diagnostics (src/output-sarif.ts:501-519), because a disagreement between
the umbrella's report and the gate's own verdict is a defect in this run
rather than a property of anybody's configuration.

The text report answers the same question the same way, and the two must
keep agreeing. `isFullyClean` (src/output-text.ts:789-800) forces the full
report when the umbrella has a diagnostic and does NOT force it for a
gate's own note, for exactly this reason: the standing note that pnpm
lockfiles do not record install-script metadata is a permanent property of
that file format, true on every run forever.

The notification descriptor id keeps the id the statement was filed under
when it was a result, so a consumer that had rules for these still
recognises them, and the descriptors are declared beside the rules so the
reference resolves rather than dangling (src/output-sarif.ts:406-416,
declared at 418-423 and attached at 464-466). Level is always `note`; a
notification arriving as a warning would push these straight back into
the alert list they were moved out of.

Pinned by tests/output-sarif.test.ts:142 (gate-deferred moved out of
results and into the notifications), 149 (gate-excluded, the same way),
171 (nothing said about exclusion when there was no `--gate`), 180
(gate-not-enforced), 189 (the no-contract advisory, keeping the GATE'S
own namespace on its descriptor id), 196 (that advisory at note level),
210 (the message text unchanged in the move), 217 and 254 (gate-missing
and gate-failed staying results, in both directions), 285 (the
notification objects are shaped as SARIF 2.1.0 wants, every level is
`note`, and the descriptor ids are declared on the driver), 957 (a
normalization diagnostic as a note-level result carrying blocking: false
and, since 0.3.0, the policy file as its location rather than none at all)
and 996 (naming the gate it came from). The remaining
result id, `conductor/gate-output-unparseable`, is pinned end to end by
tests/cli.test.ts:163, which runs the CLI over a gate whose output has
drifted and finds that id among the umbrella run's RESULTS.

In the text report, pinned by tests/output-text.test.ts:403 and 411 (an
umbrella diagnostic forces the full report and is not counted as a note)
and 327, which is the other half and was uncited here: two of a gate's
OWN notes leave the run clean, are counted rather than printed, and do
not force the full report.

A naming disagreement used to live here, and the shape of it is worth
keeping even though it is gone. Two source comments and the README all
named this diagnostic `conductor/blocking-mismatch`, and nothing had ever
emitted that string; the codes the code emits are
`conductor/blocking-count-mismatch` and
`conductor/blocking-threshold-unknown` (src/normalize.ts:29-30). Worse,
two tests built fixtures using the phantom name and then looked for what
they had just constructed, so the phantom had a green test beside it.
The phantom is now gone from the code, the README and the fixtures, and
BOTH codes are pinned at the normalizer, which is the only place either
is minted: tests/normalize.test.ts:57 ("records a diagnostic rather than overruling the gate when the counts disagree") drives the count-mismatch branch by
tampering with the gate's reported count, and tests/normalize.test.ts:70 ("records a diagnostic rather than guessing when the gate reported no threshold")
drives the `threshold === null` branch (src/normalize.ts:113-122) by
deleting `run.failOn`, asserting the emitted code and that nothing is
left marked blocking.

A sixth notification joined the five above after this section was written,
and it differs from all five in provenance rather than in kind. intent-guard
1.7.0 added its own advance notice that a frozen contract's
`protected_paths` or `allowed_paths` carries an entry no git path can ever
match, sent as strings on a `warnings` array in its own check JSON, and
says the shape will become a blocking reason in 2.0.0. The other five
notifications above are synthesized by conductor itself from a gate-state
fact it observed (deferred, excluded, skipped, unenforced, legacy state
dir); this one is a sentence intent-guard sends verbatim, so it is read by
`readIntentWarnings` (src/normalize.ts:513-518) into a run-level diagnostic
namespaced `intent-guard/warning` (the constant at src/normalize.ts:495,
attached to `run.diagnostics` at src/normalize.ts:832) rather than into the
umbrella's own top-level `diagnostics` field, which stays reserved for
conductor's five fixed ids and never a gate's own statement. Reading it is
tolerant on purpose, unlike everything else this normalizer validates:
absent on intent-guard 1.6.0 and earlier, and ignored rather than thrown on
a non-array or an array holding a non-string entry, because this is
reporting and a malformed shape must never turn into a could-not-run for
the gate.

`intentWarningNotifications` (src/output-sarif.ts:709-719) reads that
diagnostic back out of each gate's `run.diagnostics`, filtered to the
`intent-guard/warning` code so a future run-level diagnostic on some other
gate does not silently start appearing here too, and folds each one into
the same notifications array the five above already share
(src/output-sarif.ts:1065). It never gains a severity, a fingerprint, or a
place in the exit code: `composeExitCode` (src/exit-codes.ts:76-85) reads
only `couldNotRun`, `exitCode` and `hasBlockingFinding`, none of which this
diagnostic ever touches, in either direction.

Pinned by tests/normalize.test.ts's "intent-guard 1.7.0 warnings" describe
block (each warning string becomes a run-level note and never a finding,
an intent-guard old enough to have never sent `warnings` stays silent, and
a malformed value is ignored without throwing a could-not-run) and
tests/output-sarif.test.ts's "intent-guard's own 1.7.0 advance-notice
warnings" describe block (moved out of results and into notifications
while keeping the gate's own namespace, sent at note level with the
message text unchanged, and silent when the gate sent no warnings).
The exit-code assertion is a different test, tests/output-sarif.test.ts:484 ("leaves the exit code alone in every one of those cases"), and it sits before that describe.

The intent-spec header line is one of four fixed strings and carries no
repository text; the Action copies it only on a whole-line match on line 3
or 4. The strings are `INTENT_SPEC_LINES` (src/output-text.ts:1427-1432),
printed after the present-on-base line, at most one, in the precedence
ambiguous, none-changed, winner-changed, weak; the Action matches each of
lines 3 and 4 whole (action.yml:1249-1255). Pinned by
tests/action.test.ts ("copies an intent-spec line from line 3 or 4 to the
step summary, whole lines only") and tests/intent-run.test.ts ("prints the
changed-winner line, not the weak one, when the new winner is weak", and
"prints no character of the branch name beyond the shared words"). The weak
note is `intent-guard/spec-weak-match` and the tie is
`intent-guard/spec-ambiguous`, both notifications by the rule above: each
says how much of the intent policy this run's verdict covered.

## The clean-run summary line, and what it may not swallow

A fully clean run prints one line rather than a screenful
(`summaryLine`, src/output-text.ts:918-1031, reached at
src/output-text.ts:1075-1076, and NOT reached when the trust base was refused,
which is the one thing that outranks a clean run). Twelve lines of per-gate
detail on a commit
that found nothing is a cost paid on every commit, and it is what makes a
team switch a hook off.

The predicate is not simply the exit code (`isFullyClean`,
src/output-text.ts:789-800). Three extra conditions, and each one exists
because collapsing it would swallow the only report anybody sees. A gate
with `enforce: false` is left out of the composed code, so a run where
such a gate blocked or could not run still exits 0. An umbrella
diagnostic forces the full report. And a run where no gate ran at all is
not clean whatever the exit code says: "none is enabled", "every gate was
deferred" and "nothing had a contract to check" are three distinct states
with three distinct verdict sentences, and a summary line naming no gates
would be the exact confusion this family exists to prevent.

`isFullyClean` keeps reading the raw child exit (it is one of the two
allowlisted readers in "The exit code is composed"). A report-mode osv run
whose findings are all present-on-base exits 0 but is never fully clean:
its child exit is non-zero and it has findings, so the full report, the
present-on-base line and the verdict clause are always printed. Pinned by
tests/osv-output.test.ts ("never folds that run into the one-line clean
summary").

Pinned by tests/output-text.test.ts:284, 295 and 302 (one line, none of
the per-gate detail, and how to see the rest), 306 (`--verbose` prints
the full report anyway), 423 (an unenforced gate that blocked forces the
full report even though the run exits 0), 435 (so does one that could not
run), 403 (so does an umbrella diagnostic) and 456 (a run where no gate
ran at all). The half that must NOT force it, a gate's own note, is
pinned at tests/output-text.test.ts:327.

What the one line still has to carry: which gates ran, which were deferred
to a later stage, which had nothing to check, which the command line left
out, which could not have blocked because they are unenforced, a count of
non-blocking findings, a count of the gates' own notes, and how to see the
rest. Pinned by tests/output-text.test.ts:603 ("names the gates that ran"), tests/output-text.test.ts:626 ("names a gate the stage filter deferred, on the same line"), tests/output-text.test.ts:641 ("counts the gate own notes rather than hiding them or printing them all"), tests/output-text.test.ts:673 ("names a gate that ran but could not have blocked anything"), tests/output-text.test.ts:616 ("says how to see the detail"), tests/output-text.test.ts:1381 ("counts and names the gates that are not enforced") and tests/output-text.test.ts:1394 ("counts and names the gates the command line left out").

Three of those are suppression, and print as a count EVEN AT ZERO
(src/output-text.ts:951-953 for gates the command line left out, 894-897
for gates that are not enforced, 925-933 for the suppressed and ignored
totals summed across gates). This is the family rule dep-guard's stability
policy states: a gate that can be turned off, dropped by `--gate`, or a
finding count baselined away is the user's decision, and a clean line that
said nothing about it would let a repository whose gate had no vote read as
fully gated. The suppressed total always prints because it is always a
number the gate reported; the ignored total prints only when every gate
that ran reported one, because a gate that drops ignored files before its
own output has no count, and "0 ignored" there would state a fact no gate
stated. SARIF is unchanged: these stay coverage clauses on the text line
and the notification-versus-result rule below is untouched. Pinned by
tests/output-text.test.ts:1377 ("prints the not-enforced count even when it is zero") and tests/output-text.test.ts:1390 ("prints the excluded count even when it is zero"), tests/output-text.test.ts:1381 ("counts and names the gates that are not enforced") and tests/output-text.test.ts:1394 ("counts and names the gates the command line left out"), tests/output-text.test.ts:1400 ("sums the suppressed and ignored counts across gates, even at zero") and tests/output-text.test.ts:1404 ("adds the suppressed and ignored counts the gates reported"), and tests/output-text.test.ts:1417 ("drops the ignored total when a gate that ran reported no ignore count"). Zeroing any of the three counts turns its tests red.

`--verbose` is a command-line flag rather than a policy key
(`TextOptions`, src/output-text.ts:703-758), because the schema describes
what a repository gates on and how loud one developer's terminal is is
not that.

SARIF IS UNAFFECTED BY IT. `renderSarif` takes no verbosity argument at
all (src/output-sarif.ts:1002), and the format branch in the CLI passes the
flag only to `renderText` (src/cli.ts:736-744). Pinned by
tests/cli.test.ts:276, 288 and 295, and by
tests/output-sarif.test.ts:526, which asserts the log is byte for byte
what it was before the summary line existed, against a literal written
out by hand rather than against whatever the renderer currently produces.

## SARIF says only what it can support

One run per gate, in gate order. SARIF puts the tool name and version on
the run, so a single run cannot honestly describe three tools
(src/output-sarif.ts:1005-1037).

A gate that never ran gets NO run. The tempting alternative is an empty
run named for the missing product, which puts that tool's name on
something it never did. The umbrella's own findings about it go into a
final run whose driver is the umbrella, the only honest owner of a
statement about a tool that is not installed
(src/output-sarif.ts:1009-1011 for the skip and 1046-1109 for the run).

THE SAME RULE CURRENTLY CATCHES A GATE THAT RAN AND FAILED, and those are
two different things. A gate that exited 2 did run; the SARIF-native shape
for it is its own run with `invocations[0].executionSuccessful: false`,
and that is deliberately NOT done, because it changes the run list of
every log with a failing gate in it. The consequence is load-bearing
rather than cosmetic: `conductor/gate-failed` in the umbrella's run is
then the only place in the whole log that can say anything about the
failure, which is why that finding carries the failing child's own stderr
(`normalizeFailedGate`, src/normalize.ts:1394-1409, fed from
src/gate-runner.ts:2784). Before it did, a dogfood run against a
repository with an unparseable lockfile printed dep-guard naming the file
and the reason in the text report, and put "the gate exited 2, which it
uses for could not run" and nothing else in both `message.text` and
`properties.details.detail` of the log beside it. The stderr is trimmed,
capped at 2000 characters and truncated out loud rather than silently
(`summariseStderr`, src/normalize.ts:1350 and 1360-1372), and a gate that
failed silently keeps the
message it had. The fingerprint is unaffected, because it is computed over
the rule, the role and the product and never over the message.

`conductor/gate-output-unparseable` CARRIES IT TOO, for the same reason
and through the same helper (`normalizeUnparseableGate`,
src/normalize.ts:1318-1339, fed from src/gate-runner.ts:3041, 2854 and the
backstop at 1827). That
result had the identical gap and one very live case: a gate refusing to
run at all exits 1 with no JSON and says why on stderr, which is exactly
what a state-directory conflict looks like from the umbrella's side.

`summariseStderr` is also what the intent gate's PREPARE-step failures
report with (`complaint`, src/intent-prepare.ts:420-422). That one
replaced a first-line
guess, and the replacement was a bug fix rather than a tidy-up: the
prepared project is written under the legacy directory name, so
intent-guard 1.3.0 prints its rename notice as line one of stderr on every
import-spec and every freeze there. Reporting line one therefore named the
rename notice as the reason the step failed and discarded the sentence
saying what was actually wrong, on every failure, on the version this
release exists to support.

Pinned by tests/run.test.ts:420, 428, 442, 452 (the unparseable carry) and
472, by tests/output-sarif.test.ts:1306, 1314, 1322 and 1333, and by
tests/intent-prepare.test.ts:859 (the real error survives a notice line
ahead of it) and 879 (that stderr is capped too).

No invented version. A gate whose version could not be read gets no
`version` field rather than a placeholder (src/output-sarif.ts:459-462).

`baselineState` is set only on osv results from a compared pull-request
run, `new` for introduced and `unchanged` for present-on-base, and never on
a run with no base comparison, where the umbrella has no baseline to
support it. A comparison that was unavailable for a lockfile yields `new`
for its results, matching the introduced label. It is read off the
finding's own `details.baseline`, which only the comparison sets
(`toResult`, src/output-sarif.ts). Pinned by tests/osv-output.test.ts
("marks SARIF results new and unchanged, and carries the comparison on the
run") and tests/osv-output.test.ts ("sets no baselineState and no
comparison details in SARIF").

`%SRCROOT%` is attached only to a path genuinely under the source root
(`placeArtifact`, src/output-sarif.ts:170-211). An absolute path is
positive evidence the file is NOT under the root, since one of the gates
keeps a path absolute exactly when the file is outside the directory it
scanned; stripping the leading slash fabricates a source-root-relative
path pointing at a different file, or at none, and `%SRCROOT%` then
vouches for it. Those get a `file:` uri with no `uriBaseId`. A path still
carrying a `..` segment after normalizing NEVER BECOMES A URI, and the raw
path is kept in the properties bag under `unresolvablePaths` instead. The
normalizing is real rather than a prefix test, so `a/../../b` is caught
too.

Until 0.3.0 such a result had no physical location at all, and that had a
consequence nobody had measured: GitHub code scanning rejects the WHOLE
uploaded log with "locationFromSarifResult: expected at least one
location" as soon as one result has none, so a single location-less result
lost the entire report rather than one alert. Every main-branch run of a
sibling repository's guardrails job carried that annotation, and running
the umbrella against that checkout found the offender.

So every result now carries at least one location, and the fallback is a
real file rather than an invented one: the control file the result is a
statement about (`fallbackLocationFor`, src/output-sarif.ts:303-309, and
`withFallbackLocation`, src/output-sarif.ts:322-333, applied in `toResult`
at src/output-sarif.ts:363). That is the policy file for the umbrella's own
results and for the two gates whose control files the umbrella does not
read, and the frozen contract for the intent gate when the run recorded
which state directory it read. Nothing that already had a location is
touched, no region is invented, and an unresolvable path is still not
turned into a uri, so the two rules above are unchanged rather than
softened. A result that had only a LOGICAL location keeps it and gains the
physical one beside it, since the logical location is what a consumer
groups on.

Pinned by tests/output-sarif.test.ts:1427 (no result in a log built from
every subject shape has an empty locations array), 1437 (every location
resolves to an artifact uri), 1450 (the umbrella's own are filed against
the policy file), 1496 (the intent gate's against its contract), 1526 (a
logical location survives and gains a physical one) and 1544 (a result
that named a real file still points at that file). End to end against the
real gates by tests/dogfood.e2e.test.ts:622.

No invented region. The secret gate and gitleaks both report a line and a
column (vault-guard at src/normalize.ts:348-349, gitleaks `StartLine` at
src/normalize.ts:887-888 and `StartColumn` at 906-909). When `StartColumn` is
absent, that line sets it to 1. gitleaks also carries `endColumn` when the
report has a usable `EndColumn` (src/normalize.ts:910-918, written into the
region at src/output-sarif.ts:264-266). vault-guard's JSON has no match
length, so that gate's region has no `endColumn` (src/normalize.ts:377-378).

A gitleaks column below 1 never reaches a region (audit 2026-10-18 B1).
SARIF 2.1.0 gives `startColumn` and `endColumn` a minimum of 1, and
gitleaks 8.30.1 writes `"EndColumn": 0` on its private-key rule over a PEM
file, one of its commonest hits; until this fix (from about 2026-09-26)
that 0 went straight into the region, the file failed schema validation,
and github/codeql-action/upload-sarif, which the README recipe feeds,
refuses an invalid file. `StartLine` and `StartColumn` below 1, or not an
integer, become 1 (startLine has the same minimum). `EndColumn` is kept only when it is an integer, at least 1, at least the
start column, and the entry's `EndLine` is absent or equals its
`StartLine`: the subject has no end line, so a region built from it ends
on its start line and an end column from a later line would mark the
wrong span. Pinned by tests/normalize.test.ts:1217 ("drops the EndColumn 0
gitleaks writes on a private key (captured on a public repository)") over
tests/fixtures/gitleaks-8.30.1-private-key-endcolumn-zero.json, 1223
("raises a StartColumn 0 to 1"), 1227 ("raises a StartLine below 1, or not
an integer, to 1 (SARIF startLine has a minimum of 1)"), 1233 ("drops an
end column before the start column on a single-line finding"), 1238
("drops a negative or fractional end column") and 1243 ("drops the end
column of a finding that spans lines, since the subject has no end line"),
and end to end in SARIF
by tests/output-sarif.test.ts:774 ("writes a schema-valid region for the
EndColumn 0 gitleaks reports on a private key (audit 2026-10-18 B1)").
That SARIF test asserts the region constraints directly, because no SARIF
schema is vendored here; the fixed output for the whole captured plug
report was validated once by hand against the 2.1.0 rtm.5 schema with
ajv (valid, 7 results; the 0.11.1 output for the same report was invalid
at region.endColumn). Mutations, each run: removing the `>= 1` and
`>= column` conditions on the end column turned 4 tests red (the capture,
the before-start case, the negative case and the SARIF test); removing the
`>= 1` floor on the start column turned "raises a StartColumn 0 to 1" red;
removing the floor on the start line turned the StartLine test red;
dropping the one-line condition turned the spans-lines test red.

The reason is narrower than this file used to state it, and the narrower
version is the useful one. That gate DOES know the match length: it
hashes it into its own fingerprint and puts an end column in its own
SARIF. What it omits is `matchLength` on the match object in the JSON
output, which is the one channel the umbrella reads. So the end of the
match is unknown FROM THIS CHANNEL rather than unknown to the product,
which makes it a fixable upstream ask (carry `matchLength` on the match)
rather than a permanent limitation of the finding. Until it is carried it
is not guessed, and the renderer already emits `endColumn` when the
envelope has one (src/output-sarif.ts:261-263), so the day the field
arrives the only change needed is in the normalizer.

`partialFingerprints` carries each product's own fingerprint unhashed,
under a key naming the product and a version
(src/output-sarif.ts:147-149 and 358). Hashing it together with
anything would mint a second identity for every finding, one that moves
when the first does not, and every alert would resurface on the next scan.
The key is versioned so a future change to a product's fingerprint inputs
ships as a `/v2` and a consumer can tell the two apart rather than
silently comparing hashes of different things.

`properties.blocking` is the gate's decision as reconciled in
src/normalize.ts and is never recomputed in the renderer
(src/output-sarif.ts:346). A second copy of the gate living in the
renderer would drift silently.

`executionSuccessful` is written whenever the umbrella's run is written,
in both directions (`Invocation`, src/output-sarif.ts:432-443, emitted
unconditionally at src/output-sarif.ts:477 and computed at
src/output-sarif.ts:1106-1108). Emitting it alongside the notifications made
the field present when the answer was true and absent when it was false,
which is the one direction that matters.

Enforcement is recorded in two places and neither is redundant:
`properties.enforced` on the gate's own run, emitted for enforced gates
too so an absent property never has to be read as either answer
(src/output-sarif.ts:1024), and a notification in the umbrella's run,
which is the only place left to say it for a gate that could not run and
so has no run of its own (src/output-sarif.ts:960-993). What is
deliberately not done is touching the results: a critical finding stays
critical and `blocking` stays whatever the gate decided, because writing
this repository's policy about its own exit code into the field a
code-scanning UI uses to describe a finding would make the finding lie
about what the gate found.

Pinned, claim by claim rather than by a block of numbers, because the
previous list here carried about ten citations that pinned envelope facts
this section never claims and two that belong to the reporting section
above:

- One run per gate, in gate order, with each driver's name and version
  from that gate: tests/output-sarif.test.ts:561 and 569.
- A gate that never ran gets no run: tests/output-sarif.test.ts:887,
  1094 (which also asserts the gate-missing result is still there), 1135
  (a deferred gate), 1161 (no umbrella run when there is nothing to say)
  and 1168 (a gate that ran and found nothing still gets one).
- No invented version: tests/output-sarif.test.ts:576.
- `%SRCROOT%` placement: tests/output-sarif.test.ts:759 (backslashes and
  a leading dot-slash), 776 (an absolute path, posix and Windows, gets a
  `file:` uri and no `uriBaseId`), 803 (an escaping path never becomes a
  uri, is kept in `unresolvablePaths`, and the result falls back to the
  policy file), 829 (one that escapes only after the segments cancel),
  846 (an inner `..` that stays inside), and 860 (a secret finding whose
  file escapes loses its REGION, which is the half that would otherwise
  annotate a line of the wrong file). `placeArtifact` is also exercised
  directly, one rule at a time, at tests/output-sarif.test.ts:1185 to
  1247.
- No invented region: tests/output-sarif.test.ts:711 (a real position
  becomes a region with the 1-based column), 722 (no `startLine` anywhere
  for a finding with no known line), 727 (a path list gets one location
  each and no region) and 741 (a drift finding gets a logical location,
  with the control file beside it and still no region). The absent
  `endColumn` is pinned at the normalizer,
  tests/normalize.test.ts:170.
- `partialFingerprints`: tests/output-sarif.test.ts:660 (keyed by product,
  value unhashed), 669 (stability recorded beside it), 675 (omitted
  entirely when the product mints none) and 1252 (the `/v1` key).
- `properties.blocking` never recomputed: tests/output-sarif.test.ts:622,
  which is the discriminating fixture and the one that matters. Every
  other fixture in that file has blocking agreeing with severity, so a
  renderer that derived blocking from the level would pass all of them;
  this one renders a BLOCKING finding at note level and asserts both. The
  wholesale properties assertion at tests/output-sarif.test.ts:644 cannot
  stand for this claim on its own, which is exactly the gap that let the
  regression through before 622 was written.
- `executionSuccessful` in both directions: tests/output-sarif.test.ts:468
  (false, with no notification to hang it on, which is the case that
  produced no invocation at all before), 479 (true when every gate ran),
  317 (false for a gate that could not run) and 495 (a gate's run gets no
  invocation of its own).
- Enforcement recorded twice, results untouched:
  tests/output-sarif.test.ts:1060 (present on both an enforced and an
  unenforced run), 1070 (the stage beside it), 1080 (the notification),
  1094 (still said for a gate with no run of its own), 1015 (an unenforced
  gate's results keep their own level) and 1027 (a gate that could not run
  keeps an error-level, critical result).

## Blocking is reconstructed, checked against the gate, and the gate wins

Neither dep-guard nor vault-guard marks findings individually. Each
reports the threshold it used and a count of findings at or above it. So
the per-finding flag is RECONSTRUCTED from that threshold on that gate's
own ladder and then CHECKED against that count
(`reconcileBlocking`, src/normalize.ts:106-143).

When the two disagree, every flag drops to false and a diagnostic says
why. The umbrella reporting "blocking" about a finding the tool that
blocks commits disagrees with is the failure the rule exists to prevent.
For every gate but one, nothing about the composed exit code depends on
this field; it comes from the child's own exit code. The exception is the
vulnerabilities gate on a compared pull-request run under
`present-on-base: report`, where `gateExitBlocks` reads the present-on-base
labels, conditions (a) to (f) in the osv design, and a non-zero exit with
every parsed finding present-on-base and no licence or deprecation output
does not block.

`run.blocking_matches` is the COUNT of findings at or above the threshold,
not the threshold. The threshold is `run.fail_on` for the secret gate
(src/normalize.ts:328) and `run.failOn` for the dependency gate
(src/normalize.ts:225). The secret gate's own documentation says an
integrator gating a build must read `blocking_matches` and that
`summary.secrets` ignores the threshold. A sibling tool in this family
read the summary, and that is the bug not to copy. src/normalize.ts:236-243
is dep-guard's severity identity, not this read.

The intent gate is different in kind and is handled separately: it has no
threshold, so a budget violation is blocking because the gate raises one
reason per violation and blocks on having any reason at all, and a drift
finding is blocking exactly when the OVERALL action blocks, since the gate
raises one reason for the score and none per finding
(src/normalize.ts:660-697 for the budget half and 699-753 for the drift
half).

THE VERDICT HAS A CLAUSE FOR THE STATE THIS RULE PRODUCES, and it was
added after this file was first written. Both branches of
`reconcileBlocking` drop every flag to false while the gate's own non-zero
exit code still stands, and `composeExitCode` returns 1 for a non-zero
gate exit code OR a blocking finding. So a run can exit 1 with nothing on
screen marked blocking, and "verdict: exit 1, 0 blocking finding(s)"
contradicts the number printed beside it on the one line somebody reads
when they read nothing else. That branch instead names the enforced gates
that exited non-zero and says the umbrella could not reconcile a blocking
count with what they reported (src/output-text.ts:664-682).

Pinned by tests/output-text.test.ts:1086 ("does not print a blocking count when the threshold was never reported") and tests/output-text.test.ts:1098 ("does not print a blocking count when the gate own count and the umbrella count disagree"), one for each branch of
`reconcileBlocking`, both of which assert the precondition first (the
normalizer marked nothing blocking and raised exactly one diagnostic) and
then that the verdict carries no "0 blocking finding(s)" and does say
which gate exited non-zero. The unenforced aside survives on that verdict
too, tests/output-text.test.ts:1110 ("keeps the unenforced aside on that verdict").

Pinned by tests/normalize.test.ts:52 ("agrees with the count the gate itself reported blocking"), tests/normalize.test.ts:57 ("records a diagnostic rather than overruling the gate when the counts disagree"), tests/normalize.test.ts:70 ("records a diagnostic rather than guessing when the gate reported no threshold"), tests/normalize.test.ts:319 ("gates on run.blocking_matches, not on summary.secrets"), tests/normalize.test.ts:371 ("blocks on every violation, because the gate itself raises a reason for each"), tests/normalize.test.ts:408 ("does not block on a drift finding whose overall action is not blocking") and tests/normalize.test.ts:689 ("never lets a blocked gate report zero blocking findings").

## An advisory-capped constraint finding is never blocking, whatever the run does (issue #34)

The rule above is "a drift finding is blocking exactly when the OVERALL
action blocks", and intent-guard 1.6.0 broke its premise. A constraint
whose `source` is a prose rules file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
cursor rules) is capped at advisory by intent-guard itself: a strong match
is still reported, but it never raises `constraint_violation`,
`criticalViolated`, or the gate's own exit code. Before this fix, every
drift finding inherited `driftBlocks` regardless, so a run that blocked for
an unrelated reason (scope creep, say) rendered the capped finding as
blocking too, in both the text report and SARIF's `properties.blocking`.

There is no field to key on. `finding_details[]` carries `strength: "strong"`
for a capped prose match exactly the same as an uncapped one, and the
constraint's `source` is never carried onto the finding at all
(confirmed by grepping intent-guard's packages/core/src for `advisory`,
`source`, and `prose`, and by running the built 1.7.0 `check` command
against a throwaway repository with a frozen contract; see
tests/fixtures/README.md, "intent-guard 1.7.0 (advisory-capped constraint
findings, issue #34)" section). The only surviving signal is the literal
`"advisory "` prefix intent-guard's own drift.ts puts on the message for
this one case.

Matched anyway (the `ADVISORY_CONSTRAINT_PREFIX` constant just above
`normalizeIntentGuard`, src/normalize.ts). A `constraint_violation` finding
whose message starts with that exact, case-sensitive prefix is never
blocking and is downgraded to `low` severity regardless of `drift.action`
(inside `normalizeIntentGuard`'s drift-finding loop, src/normalize.ts);
every other drift finding, including an uncapped `constraint_violation` in
the same run, is unaffected. An intent-guard JSON from before 1.6.0 never
has the prefix, so this never fires against it.

**THIS IS NOT A SAFETY NET, and the earlier version of this entry
overstated it.** Unlike the gate-state reason prefixes elsewhere in this
file, which ARE pinned against the literal upstream strings in a test that
enumerates them, nothing here tests against a live intent-guard binary.
`tests/fixtures/intent-guard-1.7.0-check-advisory-capped.json` is a static
capture, taken once; a future intent-guard release that rewords the
`"advisory "` prefix, or replaces it with a field, changes nothing this
repository would notice on its own. The cap detection would simply stop
matching, silently: no test would fail, no CI signal would fire, and a
capped finding would go back to rendering as blocking exactly as it did
before this fix, with no warning anywhere in the report. This is the
reason to prefer an upstream fix over this one: filed as intent-guard #114
(https://github.com/vaultcompasshq/intent-guard/issues/114), asking for a
machine-readable per-finding field so conductor can stop keying on message
text. Until that lands, this repository's only defense against upstream
drift is a human noticing a capped finding rendering as blocking again and
re-reading this entry.

This changes only the per-finding `blocking` flag and its severity, in the
text report and in SARIF's `properties.blocking`. Nothing about the
composed exit code depends on it, for the same reason as the rule above:
that comes from intent-guard's own exit code, never recomputed here.

Pinned by tests/normalize.test.ts (describe block "intent-guard
advisory-capped constraint findings (issue 34)"): the capped finding is
never blocking and its severity is `low` even though `drift.action` is
`soft_block`, the uncapped `scope_creep` finding in the same run stays
blocking at `high`, and an older fixture with no `"advisory "` prefix keeps
its previous severity and blocking. A second, sibling test (using
`intent-guard-1.7.0-check-uncapped-constraint-blocking.json`, the same
reproduction with the constraint's `source` changed to `user-stated`) pins
that an UNCAPPED `constraint_violation` finding specifically, not only an
unrelated `scope_creep` finding, stays blocking in a run that blocks -- the
gap an earlier review round named, since every other uncapped case tested
here happened to be `scope_creep`. A third describe block
("the advisory-cap match is case-sensitive and anchored to the start of
the message") constructs two finding shapes intent-guard itself would never
produce -- `"advisory "` appearing mid-message rather than as a prefix, and
a capitalised `"Advisory "` -- and asserts both stay blocking, which is
what makes the match `startsWith` rather than `includes` or
case-insensitive a tested fact rather than an unverified claim in a
comment. Pinned in rendering by tests/output-sarif.test.ts ("an
advisory-capped constraint finding in SARIF (issue #34)": `properties.blocking`
false and `note` level for the capped finding, `properties.blocking` true
and `error` level for the uncapped one) and tests/output-text.test.ts ("an
advisory-capped constraint finding in the text report (issue #34)": the
capped finding's line reads `report`, not `BLOCKING`).

## Nothing invents a position, a fingerprint, or a severity

Severity is carried by identity where the product's ladder is the shared
one and `severityIsDerived` is false; it is the umbrella's own invention
for the intent gate, which has no per-finding severity at all, and
`severityIsDerived` is true there for every finding
(src/envelope.ts:16-23; identity at src/normalize.ts:239-241; the
umbrella's own two ladders for the intent gate at src/normalize.ts:476-487,
marked derived at src/normalize.ts:684, 735 and 775). An unrecognised level
from the secret gate lands on `info` and is marked derived, so a
downstream consumer never sees a level outside the union
(src/normalize.ts:359-363). The text report marks a derived severity with
a trailing asterisk and explains the asterisk only when one is on screen
(src/output-text.ts:50 and 1116-1118).

Fingerprints are carried verbatim and namespaced by product; nothing is
hashed together with anything else, because a new digest would match no
existing baseline file and would silently invalidate every one in the wild
(src/envelope.ts:25-32). `stability` records what the value is actually
worth: `stable` survives edits elsewhere in the file, `positional` does
not, `none` means there is no id to keep. Where a product mints no
fingerprint, the field is null and no `partialFingerprints` object is
emitted, rather than an invented id no baseline anywhere contains
(src/normalize.ts:779-781).

The umbrella's OWN findings are the one thing it fingerprints, and the
digest is over the rule, the role and the product and deliberately NOT
over the message (src/normalize.ts:1225-1229), so a repeat run is the same
alert rather than a new one every commit and a reworded detail is not a
new problem. Pinned by tests/normalize.test.ts:460, which asserts two
calls with the same role and product agree and that a different role and
product does not.

`subject` is a union rather than a lowest common denominator
(src/envelope.ts:62-69). Flattening a package, a byte position, a path set
and a contract into file-and-line would mean inventing a line number, and
an invented line number is indistinguishable from a real one once it
reaches a code-scanning UI.

The secret gate's 0-based column becomes 1-based in the envelope, and the
gate's own number is kept in the details bag under a key that names its
base (`columnZeroBased`), because calling it `column` put it next to a
1-based SARIF `startColumn` in the same result where it read as an
off-by-one in this tool (src/normalize.ts:396-408 for the key; the
conversion to 1-based is in src/output-sarif.ts).

Pinned by tests/normalize.test.ts:38 (severity by identity, not derived),
204 (an unrecognised level lands on info AND is marked derived), 82 (a
package subject rather than a fabricated file position), 240 (a path list
rather than an invented line number), 90, 176 and 247 (the three
fingerprint stabilities carried verbatim), 147 and 162 (the 1-based
subject column and the 0-based one kept under its own key, with the bag
asserted NOT to carry a plain `column`), 170 (no `endColumn`), 230 (the
intent gate's derived severity and that every one of its findings says
so) and 460 (the umbrella's own deterministic fingerprint).

## No stack trace reaches a terminal or a report

An error's message, never its stack (`messageOf`,
src/gate-runner.ts:1717-1723; src/normalize.ts:1318-1339; src/cli.ts:480-483
and 790-792). A stack
reaching the terminal puts a local filesystem path in front of a user who
cannot act on any of it, and puts one into a report that gets uploaded.
The message is the part that says what went wrong.

Pinned by tests/cli.test.ts:104 ("reports a drifted gate output as exit 2
with no stack frames"), 122 ("prints no stack frames when a gate exits with
its could-not-run code"), 136 ("prints no stack frames when a gate binary
is missing"), 147 ("prints a one-line message and no stack for a policy
file that will not parse") and 157 ("prints a one-line message and no stack
when there is no policy file at all"), and by tests/run.test.ts:190
("carries no stack frame anywhere in the outcome"), which walks the whole
outcome object looking for a stack frame.

## The child's working directory is the repository root

Not a style choice, and it came from running the tools rather than from
reading them. One of the three gates resolves both its config file and its
baseline from the process working directory rather than from its path
argument, so a child spawned from anywhere else scans the right files with
the wrong configuration and the wrong baseline, and says nothing about it.
The other two resolve from their own arguments, so setting the working
directory correctly is the single approach that is right for all three
(src/gate-runner.ts:1296 and 1264).

The umbrella anchors everything at the working-tree root as reported by
git, so a run from a subdirectory behaves exactly like a run from the top
(`repoRoot`, src/cli.ts:154-188). A relative `--output` is the one exception: it
resolves against the directory the command was typed in
(src/cli.ts:749-757), which is the conventional reading of a path a human
typed, and the generated hook always runs from the root, so only a human
running the CLI by hand from a subdirectory ever hits the difference. The
test proves content equality against absolute paths, which is what keeps
this exception from being a gap in that test.

The child working directory is pinned by tests/gate-runner.test.ts ("runs the child with the repository root as its working directory").
THE SUBDIRECTORY ANCHORING IS PINNED AT tests/cli.test.ts:453 ("finds the policy file at the root and reports exactly what a run from the top does"), which runs
the built CLI from `packages/app` two levels inside a repository and
asserts it exits 0, never prints the run-init message, names all three
gates in the report, and writes a report byte for byte identical to the
same run from the top. The equivalent rule inside the generated hook is
pinned at tests/init.test.ts:1790, which runs the hook from `packages/app`
and proves it still finds `node_modules/.bin` at the root.

Every test in tests/cli.test.ts has git on its controlled PATH, and the
reason is worth recording. That file replaces PATH wholesale so the gates
resolve to stubs, which takes git away from the spawned CLI too, and the
CLI needs git to find the root. The shim used to live in the subdirectory
suite alone, because everywhere else the working directory IS the root and
the old fallback made the absence invisible; it now lives in `runCli`
itself, so a spawn site cannot forget it and pass for the wrong reason.

THE FALLBACK IS GONE, and this paragraph used to record it as an OPEN
defect. `repoRoot` no longer catches every failure and answers `cwd`: git
missing from PATH, a directory outside any repository, a path that is a
git directory rather than a working tree, and anything else git can fail
with, are four different sentences (src/cli.ts:154-188). It is called inside `run`'s own try, so each one
arrives as one line on stderr with no stack and the could-not-run exit
code, the same shape as every other refusal the CLI makes. What the
fallback did instead was answer "no .guardrails.yaml here, run conductor
init" in a repository that has one, which is a confident answer to a
question nobody asked. The generated hook has always named a missing git
plainly (src/init.ts:165-167); this is the CLI catching up with it.

ALL FOUR BRANCHES ARE PINNED. tests/cli.test.ts:1429 ("names the missing git rather than guessing at the working directory"), tests/cli.test.ts:1445 ("says a directory outside any repository is not one, and names it"), tests/cli.test.ts:601 (points --project at .git) and tests/cli.test.ts:1457 ("says git could not be run when the binary is there and will not start"). The last of those puts a `git` file with no execute bit on the controlled PATH: the spawn fails with EACCES, which is neither ENOENT nor an exit code.

The unexecutable-binary case was written down here as untestable first, and it was
testable in six lines. The claim was that a spawn failure which is neither
ENOENT nor an exit code needs a machine in a state a test cannot ask for;
a file with mode 0 is that state, it is refused for every user including
root, and nothing about the machine has to be arranged. Worth keeping as a
worked example of what this file warns about at the top: an admission of
missing coverage is a claim like any other, and the reason attached to it
is the part most likely to be wrong.

## Public-repository hygiene is a gate, not a habit

This repository is public, so three classes of content must never appear
in a tracked file: a product or venture codename from elsewhere in the
family, a machine-specific absolute path, and a non-ASCII em or en dash.
"Remember not to paste the wrong thing" is not a control, so the
constraint lives in scripts/check-public-hygiene.mjs and runs as
`pnpm lint`, wired into CI at .github/workflows/ci.yml.

The codename list is stored as SHA-256 digests of the lowercased tokens
and never as plaintext, because a plaintext blocklist would itself leak
the names it exists to hide. It is the UNION across the family rather than
a per-repository subset, since a blocklist that differs per repository
protects the intersection and advertises the difference.

Three details of the matching are load-bearing. Tokens are extracted from
a copy with underscores and camelCase humps split apart, because `_` is a
word character to a word boundary and a codename most plausibly appears as
an identifier or an environment variable. The allowlist exempts a file's
CONTENTS from the two PATH rules only (an earlier revision of this entry, and
the code, also exempted the token scan, so CONTRIBUTING.md could carry a
blocked name; fixed). It never exempts the token scan, the file's NAME, or the
dash rule, since the name is visible on a public file tree either way. And
the machine-path pattern requires two or more segments under any of four
roots, the same rule for all four, after an earlier version used two for
home directories and one for temporary ones and so flagged prose that
merely named a root.

Pinned by scripts/tests/check-public-hygiene.test.mjs, 26 declarations and
33 cases once the three `it.each` rows are expanded, including
scripts/tests/check-public-hygiene.test.mjs:193 ("flags a token whose hash is in the injected blocklist"), scripts/tests/check-public-hygiene.test.mjs:345 ("catches a banned token embedded in a snake_case identifier"), scripts/tests/check-public-hygiene.test.mjs:353 ("catches a banned token embedded in a SCREAMING_SNAKE_CASE env var"), scripts/tests/check-public-hygiene.test.mjs:362 ("catches a banned token embedded in a camelCase identifier"), scripts/tests/check-public-hygiene.test.mjs:285 ("skips only the path rules for allowlisted files: the dash rule and the token scan still apply"), scripts/tests/check-public-hygiene.test.mjs:300 ("flags a blocked token in the body of an allowlisted file (C7)") and scripts/tests/check-public-hygiene.test.mjs:156 ("passes on a URL whose path happens to start with a root directory name").

Three honest limits. The blocklist is hashes, so nobody can audit its
COVERAGE from inside this repository; only that the mechanism works.
The guard reads `git ls-files`, so the untracked design notes in the
working tree are out of scope by construction, which is correct while they
stay untracked and silently wrong the moment one is added. And there is no
tracked pre-commit hook in this repository running it, so the only
enforcement is CI and whoever remembers to run `pnpm lint` before pushing.

## Things that look like invariants and are not

Recorded so a future audit does not spend time proving them.

Gates run SEQUENTIALLY (src/run.ts:520-615). That is a legibility decision
rather than a rule: interleaved stderr from three gates is unreadable
exactly when a commit has just been refused. It is explicitly flagged in
the source as the obvious thing to revisit with a measurement, and nothing
depends on the ordering.

The per-gate timeout comes from the gate's `timeout-seconds` in the policy,
else from the product's profile (`resolveTimeLimit`,
src/gate-runner.ts:242-250): 120 seconds for the three family gates, as
before, 600 for gitleaks, whose full-history scan outlives two minutes on a
large repository, and 300 for osv-scanner (src/products.ts). The child
output buffer is 64MB (src/gate-runner.ts:2231). The defaults are values,
not rules; the rule that stays is that a timeout is could-not-run
(`timed-out`), never a clean exit.

`report.format` in the policy file is a default that `--format` overrides
(src/cli.ts:702). There is no rule about which one a repository should
choose.

The `dist/` directory and `schema/` are the published files
(package.json:18-21). The schema ships because a user should be able to
point an editor at it, and because the published contract should be a
thing on disk that can be diffed between releases; that is a reason, not
an invariant anything else depends on.

## The compact refusal body can never hide a gate result

`--compact-on-refusal` only takes the short branch in `renderText` when
`refusalLines(result)` is non-empty (src/output-text.ts:1058-1060), which is
exactly when `result.trustBase.refusal` is a non-null string
(`refusalLines`, src/output-text.ts:429-438, reading
`result.trustBase?.refusal`). There is exactly ONE place in the codebase
that ever sets that field to a non-null value: `refusedTrustBase`
(src/run.ts:395-438, the field itself at line 382). The only other place a
`RunResult`'s `trustBase` is built, src/cli.ts:429-440, always sets
`refusal: null`, which is why an ordinary policy run can never take the
compact branch no matter what `--compact-on-refusal` and `--verbose` say
together (pinned by the "does nothing to a run that was not refused" case
in tests/output-text.test.ts's compact-mode describe block).

That single writer is what makes the compact body safe to still call a
`RunResult` even though it never prints a gate section: every outcome
`refusedTrustBase` produces is synthesized through `preparationFailed`
(src/run.ts:360-362) rather than run, so a `RunResult` that reaches the
compact branch by construction has no gate that actually executed for the
compact body to be hiding. This is not true by accident of the current two
call sites; it is true because `refusal` has exactly one writer. A future
second writer that sets `refusal` on a `RunResult` which also carries real
gate outcomes would break this invariant silently -- the compact branch
would start swallowing an actual gate section -- and would need to be
weighed against this note rather than added without noticing what it
changes.

## A gate that could not run says so, and is never mistaken for a missing tool

Learned from an incident on 2026-09-22, in which an adopter's gate posted a
red check having scanned nothing for two days and the only visible symptom
was `conductor: command not found`. The reasoning is in
docs/design-notes.md, "Why a failed signature check must say so". Five rules
hold it shut, and each is pinned. The first was reversed on 2026-10-13; see
docs/superpowers/specs/2026-10-13-action-path-after-signature-audit.md.

**The PATH write follows the signature audit (audit finding F1,
2026-10-12).** The install step writes the install prefix to `GITHUB_PATH`
only after the audit's failure branch has exited and before
`verification-ok` is written. It used to come first, on the claim that it
"grants nothing on its own, because the gates step does not run when the
install step fails". That claim was false: the render and post steps run
`if: always()`, so they run after a failed install step, the runner honours
the file commands a failed step wrote, and the post step holds the job
token. An early entry put the bins of a package that FAILED verification
(npm links bins even under `--ignore-scripts`; a bin named node, gh or bash)
ahead of the system's own there. The 2026-09-22 reason for the old order is
gone: conductor is invoked by absolute path, and the render step branches on
`verification-ok`, never on whether a binary is reachable, so a failed audit
is still reported as a refusal. Pinned by "puts the install on PATH only
after the signature audit has passed" in
tests/action-hardening-drift.test.ts, which compares positions within the
install step's own script, strips trailing comments as well as whole-line
ones, and requires exactly one GITHUB_PATH line; and by "writes nothing to
GITHUB_PATH when the signature audit fails, so no unverified bin reaches a
later step" in tests/action.test.ts, which runs the step.

**The comment step runs node and gh by absolute path.** The first step,
"Resolve node and gh for the comment step" (`id: tools`, no condition, no
token), resolves both from the job's PATH before this action has installed
or written anything, skipping any hit under the gate prefix, and the post
step runs `"$NODE_BIN"` and hands the poster `--gh "$GH_BIN"`; an empty
value is a warning and no comment. This guards the post step's commands,
not the shell that runs it: the runner resolves `shell: bash` against the
same PATH, which is why the ordering above is the fix and this is the
second layer. Pinned by "neither the render nor the post script invokes a
bare node or gh" and "runs the poster by NODE_BIN and hands it GH_BIN, and
never runs the node or gh on PATH" in tests/action-pr-comment.test.ts.
Residual: a second use of this action in one job reuses the same prefix,
and the first use's GITHUB_PATH entry for it is live from the start of the
second use's own install step. After the second `npm install -g` that entry
names new, unverified bins. Inside that install step bash first looks up
`tr`, `sed` and `sleep` after the install, so a planted one could run on a
failed audit and append `verification-ok=true` to GITHUB_OUTPUT; the step
therefore drops the gate prefix from its own PATH before running any
command, pinned by "runs nothing from the gate prefix inside the install
step, even when an earlier use put it on PATH" in tests/action.test.ts.
What stays open, documented and accepted: the render and post steps'
`shell: bash` (resolved by the runner through the prepended PATH) and the
render step's `mktemp`, `rm` and `env` (its fallback run needs the prefix
to find the gates). The fix is a per-invocation prefix, so no use inherits
another's entry.

**The audit's failure carries its reason.** action.yml:738-788 captures the
audit through a command substitution, writes `verification-failed` and
`verification-reason` to the step outputs, prints a workflow error naming
that no gate ran, which audit failed (over the installed tree), and what to do
next (the step already retried once; re-run the job once and treat a repeat as
real), and then exits non-zero. Fail-closed is unchanged: the
exit is still non-zero and the gates step still does not run. Pinned by
"records why signature verification failed and still exits non-zero" in
tests/action.test.ts, which strips trailing comments as well as whole-line
ones before matching. Verified by replacing the real `exit` line with a
no-op and keeping the original after a `#` on the same line: with the
whole-line-only filter that left the entire suite green, and with the
current filter it goes red.

**Conductor invokes itself by absolute path.** `CONDUCTOR_BIN` is declared
in the gates step and in the pull-request comment step, and both invoke
`"$CONDUCTOR_BIN"` rather than a bare name. PATH still carries the prefix,
because the umbrella resolves each GATE by name and that is the only thing
that needs it. This matches dep-guard, vault-guard and intent-guard, which
all call their own binaries by absolute path and document it as resistance
to a workflow that prepends its own `node_modules/.bin`. Pinned by "invokes
conductor by absolute path, never by bare name" in tests/action.test.ts,
which asserts zero bare invocations and exactly two by `CONDUCTOR_BIN`.

**An unverified umbrella is never executed to render a comment, and the
guard accepts only if provably ok.** The comment step runs `if: always()`,
so it reaches this point on a failed install. It branches on
`verification-ok`, which the install step writes only AFTER the audit has
passed, and runs the umbrella only when that is positively `true`.

The direction matters and was got wrong first: keyed on a "did it fail"
flag instead, every install failure OTHER than the audit itself left the
flag unset and fell through to executing an umbrella nothing had verified.
The packages are on disk from the install onward, so the root manifest
write, the PATH write, and any fail-closed check a future edit adds between
them are all places this step can die with nothing verified. This is the
same rule the npm floor states a few hundred lines above, for the same
reason.

Pinned behaviourally by "actually skips the render run when verification
failed, proven by running it" in tests/action-pr-comment.test.ts: the
conductor stub leaves a marker. The test sets `VERIFICATION_FAILED` and a
reason, asserts the marker is absent, asserts the note that was actually
written carries the reason, and a control run with `verification-ok`
asserts the marker appears. The case with no verification reason and an
install-step failure is tests/action-pr-comment.test.ts:470 ("an install-step failure before the audit (npm floor, npm install) makes no outage claim either").

The redundant backstop is deliberate. scripts/pr-comment.mjs replaces an
empty or whitespace-only report with a note saying the gate could not
produce one. The action now branches before that point, so it should be
unreachable -- and the incident this section exists for was three
individually correct mechanisms composing into silence, which is why
"unreachable by design" is not treated as load-bearing here.

Not covered by any of the above, and named so a later reader does not
mistake it for solved: the run-level conclusion stays green while the
check-run goes red, so `gh run list` shows an unbroken history across a
run whose gate did nothing. That was a property of the `continue-on-error`
the pre-advisory recipe carried on every step, README.md's own "Running the
gates as an advisory check" section before it was rewritten to use
`advisory: true` instead. The section below records the replacement: advisory
mode removes the NEED for `continue-on-error` in that recipe, because a
blocking finding no longer produces a non-zero exit for it to swallow. It is
not a removal of the mechanism itself. An adopter who keeps
`continue-on-error` on the step anyway, or adds it back, still swallows a
real crash exactly as before; advisory mode only changes what the recipe this
repository documents recommends, not what `continue-on-error` does when it is
present.

## advisory maps exit 1 to exit 0, and never touches exit 2

New in the advisory-mode fix. `conductor run --advisory` and the Action's
matching `advisory` input exist because "advisory" had come to mean two
different things in this repository's own README: "findings do not block"
in the flag's own name, and "the step cannot fail" in the recipe that set
`continue-on-error: true` on every step including the umbrella's own. Those
are not the same promise. A crashed `npm audit signatures` and a blocking
finding both produce a non-zero exit from the gates step, and
`continue-on-error` cannot tell them apart: it swallowed both alike, which
is how a genuine crash read as nothing wrong for two days (issue #36,
recorded in the 0.4.6 entry above this one).

THE MAPPING IS ONE LINE AND DELIBERATELY NARROW (`applyAdvisory`,
src/cli.ts): `advisory && exitCode === EXIT_BLOCKED ? EXIT_OK : exitCode`.
EXIT_BLOCKED is the only code ever rewritten, and it is only ever rewritten
to EXIT_OK. EXIT_COULD_NOT_RUN (2) passes through unchanged whatever
`advisory` says, because a gate that could not run has not verified
anything, which is the one fact `composeExitCode` already treats as
outranking everything else: it checks for an `EXIT_COULD_NOT_RUN` condition
before it checks for an `EXIT_BLOCKED` one, so a could-not-run gate wins the
composed code over any blocking finding (src/exit-codes.ts, and the comment
above `composeExitCode`). Advisory mode is not permitted to reopen that hole
from a different angle. A preview could-not-run is the other way round: it
is advisory and never produces exit 2, with or without `--advisory`, because
preview outcomes are never in `result.gates` and the exit code is composed
from `result.gates` alone. A primary could-not-run is unchanged. Pinned by
tests/gate-runner-timeout.test.ts ("a preview gate whose base limit is 21600
is killed when the 300 s budget runs out") and tests/cli.test.ts ("preview
refuses a base command inside the working tree"), which assert a preview
could-not-run with exit 0, and, for `executionSuccessful` only,
tests/output-sarif.test.ts ("a preview could-not-run leaves
executionSuccessful and the exit code unchanged").

THE PROCESS EXIT CODE AND THE VERDICT LINE ARE DECIDED FROM THE SAME
`result.exitCode`, deliberately, so they cannot say two different things
about one run. `applyAdvisory` in src/cli.ts sets `process.exitCode`;
`verdictForRun`'s own `advisory` branch in src/output-text.ts rewrites only
the wording of the EXIT_BLOCKED verdict, and both call sites in `renderText`
pass the identical `Boolean(options.advisory)` that was threaded in from the
same command-line flag. Neither function reads the other's output: they
agree because they are both fed from the one flag and the one
`RunResult.exitCode`, not because one checks the other.

THE REWRITE IS TWO DIFFERENT SENTENCES, NOT ONE, because `composeExitCode`
already lands two distinguishable shapes on EXIT_BLOCKED and the wording has
to stay true to whichever one this run actually is. Where at least one
finding is marked blocking it appends "Findings were advisory and did not
block". Where none is (the blocking-count-mismatch or
blocking-threshold-unknown branch: an enforced gate exited non-zero but
nothing reconciled as blocking, see the section on `reconcileBlocking` in
normalize.ts), that sentence would claim a finding this branch explicitly
says there is none of, so it appends "This run was advisory, so exit 1
became exit 0" instead, which says nothing about findings and is true either
way.

NOTHING ABOUT A FINDING ITSELF CHANGES. Every finding's own `blocking` flag,
its severity, and the per-gate section's `BLOCKING` marker in the text
report are printed exactly as they are without the flag; `--advisory` is
read nowhere in gate-runner.ts, run.ts or normalize.ts, only in cli.ts (the
exit code) and output-text.ts (the verdict sentence). A reader scrolling up
from an exit-0 verdict still sees BLOCKING findings above it, the same
asymmetry an unenforced gate's exit-0-with-BLOCKING-on-screen report already
has (see "An unenforced gate is filtered out" above) and for the same
reason: the report says what was found, and a flag about the exit code must
not quietly rewrite that.

SARIF HAS NO EQUIVALENT LINE TO REWRITE, so it is not touched at all. There
is no verdict sentence in a SARIF log, only per-result `properties.blocking`
(the gate's own decision, carried through normalize.ts unchanged) and the
umbrella run's `invocations[0].executionSuccessful` (whether every gate ran,
which --advisory does not affect either). A consumer parsing SARIF for a
pass/fail signal was already expected to read `properties.blocking` per
result rather than infer one from the file's presence, so there is nothing
here for the flag to rewrite; this was a decision made while implementing
the flag, not an oversight discovered afterward.

THE ACTION PASSES THE SAME FLAG TO BOTH INVOCATIONS THAT RENDER A REPORT.
The gates step gets it unconditionally from the `advisory` input
(`ADVISORY: ${{ inputs.advisory }}`, gated with the same
`if [ "${ADVISORY:-}" = "true" ]` text in both scripts); the pr-comment
step mirrors it exactly, spelled the same way, so a sticky comment's own
"verdict: exit 0" or "verdict: exit 1" line agrees with the job's actual
exit code rather than reporting the pre-advisory sentence beside a job that
no longer fails the same way. This is the same "mirror whatever you gave
the Action" rule README.md's own manual pull-request-comment recipe states
for `--base`/`--trust-base`/`--spec` (the "Mirror whatever you gave the
Action" paragraph following that recipe's script, README.md, "The report as
a pull request comment"); advisory joins that list there too, and that
paragraph now says so.

Pinned by "says exit 1 and never mentions advisory when the flag is not
passed" and "says exit 0 and that findings were advisory when the flag is
passed" in tests/output-text.test.ts, plus "leaves exit 2 alone: advisory
only maps exit 1, never a could-not-run verdict" in the same file for the
load-bearing asymmetry. The two-sentences point above is pinned by "maps
this branch to exit 0 under --advisory, without claiming a finding it does
not have", also in tests/output-text.test.ts, which asserts the
blocking-count-mismatch branch gets the "This run was advisory" wording and
never the "Findings were advisory" one. End to end through the CLI: "maps a blocking run to
exit 0 with the advisory wording, and pins the same run at exit 1 without
the flag" and "leaves a could-not-run gate at exit 2, the load-bearing case
advisory must never touch" in tests/cli.test.ts. The Action's own wiring: tests/action.test.ts:244 ("adds --advisory to the gates invocation only when the input is exactly "true"") and tests/action-pr-comment.test.ts:901 ("adds --advisory to the render run only when the input is exactly "true", proven by running the step"), both of which run the real step script
against a conductor stub that records its argv rather than pattern-matching
the YAML, following the same device tests/action.test.ts already uses for
the trust-base fetch guard (commit f32c638, "Parse action.yml instead of
matching lines in it"). The README's own advisory recipe is pinned by
"uses advisory: true, keeps timeout-minutes, and never continue-on-error in
the recipe itself" in tests/action-pr-comment.test.ts, scoped to the fenced
code block rather than the surrounding prose, which is the one place in the
section still allowed to name the setting it replaced.

## External gates

Added in 0.5.0 (spec docs/superpowers/specs/2026-09-26-one-required-check-program-design.md,
section 3 decisions 2 to 4). Every claim below was checked against gitleaks
8.30.1 and osv-scanner 2.6.0 running for real, and the osv coverage and base
comparison claims against osv-scanner 2.4.0; the observations are in
tests/fixtures/README.md.

CONDUCTOR DOWNLOADS NO THIRD-PARTY BINARY. The external gates are resolved
from `PATH` (or an absolute `command:`) only, exactly like the family gates
outside node_modules; their profiles say `managed: false`
(src/products.ts:163 and 201); and the Action installs exactly its four
npm packages and has no input for either tool (action.yml:667-671). A
missing external binary is `binary-missing`, could-not-run, exit 2 for an
enforced gate, never a skip. Pinned by "exits 1 when only an external gate
blocks, and 2 when an external binary is missing" in tests/run.test.ts.

THE THREE FAMILY GATES DID NOT MOVE. Profiles restate the runner's old
behaviour (`managedProfile` and `managedRemedy`, src/products.ts:128-155): `--version` with the whole first line
kept, stdout JSON, 0 clean and 1 blocked, 120 seconds, no config handling,
no stderr reading. Pinned by "keeps the three npm gates on the behaviour
the runner had before profiles existed" in tests/products.test.ts and "keeps
the npm gates on the old exit reading: exit 2 is gate-error" in tests/gate-runner.test.ts.

AN EXTERNAL GATE'S PULL-REQUEST MODE IS THE UMBRELLA'S, NOT THE TOOL'S.
Neither tool takes `--trust-base`. On a pull-request run the umbrella reads
the tool's config from the base ref through `readFileAtRef` (`git ls-tree`
then `git cat-file`, the one reader) and passes it with
`--config`, a neutral stand-in when the base has none, and reports a
head-side difference as a proposal (`materializeExternalConfig`,
src/external-config.ts, wired in `spawnAndRead` in src/gate-runner.ts). gitleaks'
`.gitleaksignore` gets the same treatment through `--gitleaks-ignore-path`,
AND the scan root becomes the repository's git directory
(src/gate-runner.ts:1341-1366), because gitleaks loads the scan root's own
ignore file whatever the flag says; the flag alone was measured not to
close it. History is scoped by `--log-opts`, `HEAD` locally and
`<base>..HEAD` on a pull request (src/gate-runner.ts:612), so another
branch's secret never reddens this one.

ON A PULL REQUEST GITLEAKS RUNS FROM A DIRECTORY THE HEAD CANNOT WRITE.
gitleaks resolves a relative `[extend] path` against its working
directory, which was the repository root: a base config extending
`gl-extra.toml` read the pull request's copy, and a pull request that
allowlisted `src/.*` there passed with 0 findings and no proposal. Now the
base config's extend chain (and a relative `baseline-path` policy option)
is materialised from the base ref into `<work dir>/cwd`
(`materializeExternalConfig`, src/external-config.ts), gitleaks is spawned
there (src/gate-runner.ts:1378), a head-side edit to any materialised file
is a proposal, and an extend target the base does not have, or one that is
absolute or climbs out, is `preparation-failed` naming it. Every other path
handed to gitleaks is absolute. Pinned against the real binary by "reads an
[extend] target from the base, so a pull request cannot allowlist through
it" in tests/external-gates.real.e2e.test.ts. That file skips the whole describe when gitleaks is not installed, which is how CI runs it. And by the stubbed
working-directory test in tests/gate-runner.test.ts.

A PULL REQUEST'S HEAD .gitattributes DOES NOT HIDE A FILE. Because the
pull-request scan root is the git directory, the head tree's
`.gitattributes` is not read, so a file it marks binary is still scanned
(pinned by the real-binary test "on a pull request, finds a secret in a
file the head marks binary"). A LOCAL run scans the working tree and does
honour it; that limit is pinned in the same test and stated in the README.

MERGE COMMITS ARE SCANNED, AND A LEAK IS ONE FINDING. `--log-opts` carries
`--diff-merges=first-parent`, because `git log -p` shows no diff for a
merge, so a secret added inside a merge's own changes was invisible. That
shows an ordinary pull request's change twice under an Actions-style merge,
so `normalizeGitleaks` (src/normalize.ts) collapses entries sharing rule,
file, line and column to the earliest-dated one and lists the other commits
in `details.alsoIn`. Both are pinned against the real binary in
tests/external-gates.real.e2e.test.ts.

GITLEAKS LOGS AT INFO, ALWAYS. The ERR-line check above depends on gitleaks
printing its errors, so the umbrella passes `--log-level info` and reserves
`log-level` (src/policy.ts), and a policy that sets it is rejected at load
with the reason.

A CLEAN EXIT IS NOT ALWAYS CLEAN. gitleaks reports a git failure (an
unfetched base, a path that is not a repository) as exit 0 with an empty
report and an `ERR` line on stderr; the profile's `stderrError`
(src/products.ts:190) turns that into could-not-run. A report-file tool
that exits with a verdict but leaves no report is `report-missing`.

INLINE ALLOWS DO NOT COUNT ON A PULL REQUEST. gitleaks is handed
`--ignore-gitleaks-allow` whenever the trust base is decided and not
withheld (src/gate-runner.ts:631): an inline `gitleaks:allow` lives in
the tree being judged, so the pull request controls it, and a legitimate
allow belongs in the base ref's `.gitleaks.toml` or `.gitleaksignore`,
which are already read from the base. Local runs keep inline allows.
Pinned by "ignores inline gitleaks:allow comments on a pull request, and
keeps them on a local run" in tests/policy.test.ts and the runner test
beside it in tests/gate-runner.test.ts; checked against the real binary
(tests/fixtures/README.md).

OSV-SCANNER IS HANDED TRACKED LOCKFILES, NEVER A DIRECTORY. The runner
lists tracked files with `git ls-files` and passes each whose base name
`osvLockfileKind` accepts (src/products.ts) with `--lockfile`, skipping
anything under `node_modules` (`selectOsvInputs`, src/osv-coverage.ts).
Since the osv design (docs/superpowers/specs, 2026-10-11) the exact names
are the npm family plus go.mod, poetry.lock, Pipfile.lock, uv.lock,
pdm.lock, Cargo.lock, Gemfile.lock, composer.lock, gradle.lockfile and
packages.lock.json, each handed as a bare path, and go.sum is never handed
over (osv-scanner 2.4.0 exits 127 on it; it reads go.mod for Go). Since
2026-10-13 (audit finding F3) also mix.lock, pubspec.lock, Package.resolved,
conan.lock, renv.lock, packages.config, buildscript-gradle.lockfile,
gems.locked, pylock.toml, cabal.project.freeze and stack.yaml.lock, each
measured against 2.4.0, and gradle's verification-metadata.xml only when its
parent directory is `gradle` (2.4.0 exits 127 on it anywhere else, so
`osvLockfileKind` takes the repository-relative path). Podfile.lock and
deno.lock are measured rejects (exit 127) and are never handed; the
unread-manifests note names them (section 10.1 of the osv design), in the
nothing-to-scan diagnostic when nothing was handed and, since the 1b.2
review, as a `conductor/manifests-not-handed` run note when other lockfiles
were (a note, so it never by itself pushes a clean run off the one-line
summary; pinned by "names unread manifests even when other lockfiles were
handed over, as a note (review of 1b.2, item 5)" in
tests/gate-runner.test.ts). Pinned
by "hands over mix.lock and the other formats osv-scanner reads, and gradle
metadata only under gradle/ (audit F3)" in tests/gate-runner.test.ts. pip
requirements files (requirements.txt, requirements-dev.txt and its `_` and
`.` spellings, dev-requirements.txt) are handed only when they pass the PIN
CHECK (`checkRequirementsPins`, src/requirements-pin.ts): every
requirement, in the file and in every file it includes with `-r` (followed
relative to the including file, at most 8 deep, each file once, a cycle
fine), is pinned with `==`; an include that is absent, untracked, not a
regular file, absolute, outside the repository or a URL leaves the top file
out. A variant is handed in the parse-as form `requirements.txt:<path>`,
requirements.txt itself bare. An invocation carrying a requirements file
gets `--no-resolve`, on the base run exactly when on the head run, and a
policy `no-resolve` is dropped from it with `conductor/option-overridden`.
A requirements file left out is named in `conductor/requirements-not-scanned`
with the line that stopped it and counted in the `not-scanned` run detail;
the pin check SELECTS and raises no finding of its own. On a pull request
it is a RATCHET: a file whose base copy and base include closure pass is
handed over whatever its head copy says, with the head's unpinned lines in
`conductor/requirements-not-pinned`, so adding one `foo>=1` line cannot take
a pinned file out of the scan. Pinned by tests/requirements-pin.test.ts,
tests/products.test.ts ("matches every osv lockfile basename and the three
requirements shapes, and nothing else") and tests/osv-coverage.test.ts. osv-scanner's
own walk skips `.gitignore`d files even when they are tracked, which was
measured: a tracked, ignored `package-lock.json` gave exit 128 to the walk.
On a pull request the list is the head's index, deliberately not a base-ref
read: the lockfiles are the tree being judged and a change to them is in
the diff. None tracked means the tool is not spawned and the gate is clean
with `conductor/nothing-to-scan`; a listing that fails is
`preparation-failed`, never "none". When lockfiles WERE handed and
osv-scanner still exits 128, they parsed to no packages, and the diagnostic
is the distinct `conductor/lockfiles-empty` naming them. When it exits 0 or
1 having read packages from some handed files and none from others, the
same diagnostic names the empty ones and the `lockfiles` fact marks each
`[no packages read]` (audit finding F2): osv-scanner 2.4.0 prints one
"Scanned <path> file and found N packages" line per file on stderr at its
default verbosity, and `emptiedLockfiles` (src/osv-coverage.ts) reads it,
matching whole paths in their written and resolved spellings. Annotation
only: the verdict is still osv-scanner's. A file with no count line is not
named, so a policy that lowers osv-scanner's verbosity turns this off.
Pinned by "names an emptied lockfile beside one that was read, on a clean
run and on a blocked one (audit F2)" in tests/gate-runner.test.ts and, against
the real binary, "names a lockfile emptied to {} beside one that was read
(audit F2, for real)" in tests/external-gates.real.e2e.test.ts.

THE VULNERABILITIES LINE'S LOCKFILE LIST COMES FROM THE UMBRELLA'S OWN
ARGV, NEVER FROM OSV-SCANNER'S OUTPUT (issue #72). osv-scanner 2.x prints
`results[]` only for a source with findings, so a clean scan of one
lockfile and a run that scanned none both have `results: []`, and reading
`results.length` cannot tell them apart. `runGate` already knows every
lockfile it handed over with `--lockfile` before osv-scanner is ever
spawned (`external.lockfiles`, src/gate-runner.ts:1215-1284); that same
list, never the tool's report, is what `normalizeOsvScanner` renders as the
`lockfiles` fact (`describeLockfiles`, src/normalize.ts:1100-1102, used at
src/normalize.ts:1183). `results.length` is kept under a renamed key,
`sources-with-findings`, so the count that really did come from the tool is
never confused with the count that came from the umbrella. The two existing
nothing-to-scan paths are unchanged: both return before
`normalizeOsvScanner` is ever called, so neither prints a lockfile fact at
all, and a reader tells "scanned one lockfile, clean" from "scanned
nothing" by whether the fact is there.

DEP-GUARD'S OWN CLAIM ABOUT WHETHER IT RAN ONLINE WINS OVER THE UMBRELLA'S
FLAG, BECAUSE THE FLAG IS NOT THE ONLY WAY ONLINE CHECKS TURN ON (issue #72,
fix round). dep-guard also turns them on from `"online": true` in its own
`.dep-guard.json`, with no `--online` flag involved at all, so a
config-driven run can have the umbrella's argv say the flag was never
passed while dep-guard's own JSON says it ran online anyway. The umbrella
CANNOT answer "did dep-guard run online" from its own argv; it can only
answer "did I pass the flag", and printing the second as if it were the
first states a fact the umbrella does not have and dep-guard's own JSON can
directly contradict. So the umbrella now prints two different things
depending on what it actually knows: when dep-guard's own run-level
`online` object (present from a release after 0.8.0, read leniently by
`readOnlineInfo`, src/normalize.ts:187-214) is present and its `enabled`
field is a valid boolean, THAT field wins and prints as `online true` or
`online false` (src/normalize.ts:303-305) -- dep-guard's own statement about
what it did, never recomputed from the flag. Only when there is no such
claim to read (the object is absent, or invalid, or has no `enabled` field)
does the line fall back to `online-flag passed` or `online-flag not
passed`, from the umbrella's own constructed argv
(`argv.includes('--online')`, src/gate-runner.ts:1565) -- worded as a flag
rather than as `online`, so it is never mistaken for the claim about what
dep-guard actually did that only dep-guard's own JSON can make. `enabled`
is validated the same way as the lookup and skipped-by-deadline fields it
sits beside in `readOnlineInfo`: a wrong-typed value for any field the
umbrella actually displays makes the whole object read as absent rather
than throwing, so a shape dep-guard has not shipped yet, or ships wrong,
degrades to the flag-derived line alone and never to could-not-run. This is
reporting, not judgment, so none of it -- the flag, the enabled claim, or
the lookup and skipped-by-deadline counts -- reaches `blocking`, a
severity, or the gate's own exit code; only the child's exit code decides
that, exactly as for every other gate.

THE UMBRELLA NEVER MINTS ITS OWN NOTE ABOUT DEP-GUARD'S BUDGET RUNNING OUT,
BECAUSE DEP-GUARD ALREADY STATES IT (issue #72 fix round). An earlier draft
of this fix synthesized a `conductor/online-budget-cut-short` diagnostic
from the online object's `deadlineExceeded` field, pushed into the GATE's
own `run.diagnostics` rather than the umbrella's `gate.diagnostics` -- an id
prefixed `conductor/` describing something the gate itself said is not what
that prefix means anywhere else in this file, it never reached SARIF (only
`gate.diagnostics` renders there, src/output-sarif.ts:501-502), and it duplicated
dep-guard's own `online-deadline-exceeded` diagnostic (deadline.ts's
`ONLINE_DEADLINE_CODE`, in the parallel dep-guard branch) whenever both were
present, printing one event as two notes. dep-guard's own diagnostic
already names the count and the budget, so `readOnlineInfo` and
`normalizeDepGuard` (src/normalize.ts:187-214, 228) read only `enabled`,
`lookupsAttempted` and `lookupsSkippedByDeadline` -- the facts the umbrella
states as its own -- and dep-guard's `online-deadline-exceeded` diagnostic
reaches the report through the ordinary, unconditional
`readDiagnostics(run.diagnostics, ...)` pass-through every dep-guard
diagnostic always went through, unchanged by any of this.

BOTH FACTS ARE CARRIED INTO SARIF, NOT JUST THE TEXT REPORT, AND NEITHER IS
SPECIAL (issue #72). `renderSarif` adds a gate's WHOLE `run.details` bag to
that gate's SARIF run as `properties.details`, verbatim and only when the
bag is non-empty (src/output-sarif.ts:1029-1034), so the lockfile list and the
online facts reach a published log the same way every other gate's own run
facts do -- vault-guard's `ignoredReported`, intent-guard's `reasons` and
`driftCategories`, gitleaks' `entries` -- through the one normalized bag
rather than a second, SARIF-only rendering that could drift from it. SARIF
gets the RAW bag, unfiltered: `ignoredReported` and any array or object
value a gate's `run.details` carries reach SARIF even though the text
report's facts line drops them (output-text.ts's `gateSection`, scalars
only, so a structured value does not render as `[object Object]`), because
`properties.details` is a JSON bag with no such constraint.

Only the ROOT `osv-scanner.toml` is read from the base and passed with
`--config`, which overrides any nested one for the run (measured on 2.6.0:
a nested file ignoring lodash passes without `--config` and blocks with
it). A nested `osv-scanner.toml` the pull request adds or edits is reported
as a proposal like the root one (`nestedConfigProposals`,
src/external-config.ts), since it takes effect once merged and the run
never sees it.

THE VULNERABILITIES GATE COMPARES A PULL REQUEST WITH ITS BASE (osv
design, item 1.3). On a decided trust base, when the head run exited
blocked with at least one finding, osv-scanner also scans the BASE copies
of the lockfiles carrying findings, and each finding is labelled
`introduced` or `present-on-base` (`compareWithBase` and
`labelAgainstBase`, src/osv-baseline.ts). Seven rules hold it together:

- (1) Base copies come only through the one reader on the trust base:
  a lockfile byte-exact through `readFileAtRefBytes` (src/trust-base.ts),
  and a requirements file and its include closure through `baseReader`
  (src/osv-coverage.ts) on that same reader. What is pinned is narrower
  than the rule. For a lockfile, tests/osv-base-comparison.test.ts
  ("copies the base blob byte for byte, never the HEAD commit, the index or
  the working tree") pins that the copy is the base blob and not the HEAD
  commit, the index or the working tree, invalid UTF-8 byte included. For a
  requirements file, tests/osv-base-comparison.test.ts ("copies the base
  requirements blob, so a pin the pull request adds is introduced, not
  present-on-base") pins that the TOP file is the base blob, not any of
  those three; no test pins where an INCLUDED file's base copy comes from,
  or byte exactness for a requirements file. The copies go into the gate's
  work directory outside the repository, removed on every path by the
  `finally` that already removed it, and a work directory whose real path
  is inside the repository makes the comparison unavailable; pinned by the
  tests under tests/osv-base-comparison.test.ts ("the work directory (test
  13)").
- (2) The base run never makes the gate could-not-run, and every failure
  (an unreadable base, an exit other than 0, 1 or 128, a timeout, output
  that is not JSON, a command line that differs from the head's in anything
  but the lockfile arguments) labels the lockfile's findings `introduced`
  with `conductor/base-comparison-unavailable`. Pinned by
  tests/osv-base-comparison.test.ts ("a base that cannot be compared (test
  11)").
- (3) The comparison key is advisory id, ecosystem, package, installed
  version and repository-relative lockfile path, with no rename mapping: a
  renamed or moved lockfile is all introduced. Pinned by
  tests/osv-base-comparison.test.ts ("the rename attack (test 8)") and
  tests/osv-base-comparison.test.ts ("the comparison key (tests 9 and 10)").
- (4) The unchanged shortcut compares object ids with filters off, never
  decoded text, over the whole include closure of a requirements file.
  Pinned by tests/osv-base-comparison.test.ts ("the unchanged shortcut
  (test 14)").
- (5) `present-on-base` comes from the base policy, and an absent key means
  `block`. Pinned by tests/policy.test.ts ("present-on-base on the
  vulnerabilities gate") and tests/osv-base-comparison.test.ts ("ignores
  present-on-base: report added by the pull request itself, and reports the
  change as a proposal").
- (6) The pin check is a ratchet on a pull request (above).
- (7) Every "child exited non-zero" decision goes through `gateExitBlocks`
  (see "The exit code is composed").

On a pull-request run both osv-scanner invocations also get
`--no-call-analysis=all` unless the base policy names `call-analysis` or
`no-call-analysis`: the base copies carry no source, so call analysis could
hide on the head what the base reports.

Known open, each a limit rather than a bypass on a pull request:

1. KNOWN-OPEN: unpinned requirements files are named, not scanned; go.sum
   is never handed over (go.mod is read for Go); a `.txt` under a
   `requirements/` directory whose own base name does not match is not
   matched.
2. KNOWN-OPEN: lockfiles inside git submodules are never listed, because
   `git ls-files` does not descend into a submodule; a submodule's
   dependencies are not scanned by this gate.
3. KNOWN-OPEN: in a sparse checkout a tracked lockfile absent from disk is
   still listed and handed over, and osv-scanner exits 127 on it: a false
   red, which fails closed rather than open.
4. KNOWN-OPEN: on a LOCAL run a `.gitattributes` binary mark hides a file
   from gitleaks (see above); pull requests are protected.
5. CLOSED UNDER A TRUST BASE (audit 2026-10-18 N1, design
   docs/superpowers/specs/2026-10-18-emptied-lockfile-under-trust-base.md);
   KNOWN-OPEN on a plain run and for requirements files. A pull request
   that rewrote a tracked lockfile to `{}` (or to anything osv-scanner
   reads no packages from), deleted it, or moved it used to silence the
   vulnerabilities gate for it, with only a `conductor/lockfiles-empty` or
   `conductor/lockfile-no-longer-scanned` note: the one visible exception
   to "a pull request cannot suppress its own finding". On a decided trust
   base the candidates are the emptied handed lockfiles (every handed one
   on exit 128) and the base lockfiles the head no longer tracks
   (`noLongerScannedFiles`). The gate copies their base blobs and runs
   osv-scanner once on the copies, with the head's argv minus its
   lockfiles, under what is left of the gate's time limit
   (`checkEmptiedAgainstBase`, src/osv-baseline.ts:305, driven by
   `removalCheck`, src/gate-runner.ts:2194, which runs at
   src/gate-runner.ts:2353 when nothing at all was handed, at
   src/gate-runner.ts:2602 on exit 128 and at src/gate-runner.ts:2823
   before the base comparison). A copy with packages makes the gate
   could-not-run, reason `lockfile-emptied`, naming the file and the base
   count, even when the head also blocked; a deleted or moved file is
   cleared only by a head-handed lockfile in the SAME directory that read
   packages, is not a requirements file, is absent from the base tree, is
   of the removed file's ecosystem family, and is a regular file in the
   head's index (src/osv-baseline.ts:391-402): a lockfile the base already
   had, such as a Cargo.lock beside the deleted package-lock.json, carries
   another manifest's packages and does not count, and a base listing that
   errors does not count either. The last two halves are 0.13.0 (operator
   ruling 2026-10-18, from the adversarial review of PR #121). The family
   comes from the one table that also IS the list of names osv-scanner is
   handed (`OSV_LOCKFILE_ECOSYSTEMS`, src/products.ts:147, read through
   `osvLockfileFamily`, src/products.ts:225, which is derived from
   `osvLockfileKind`: requirements files are python, gradle's
   verification-metadata.xml is jvm), so a name cannot be handed without a
   family, and a file with no family matches nothing, itself included
   (`sameOsvFamily`, src/products.ts:243). The regular-file half reads the
   head's index, the listing the handed files come from, with a literal
   pathspec (`regularInHeadIndex`, src/osv-baseline.ts:268): mode 100644 or
   100755 at stage 0, and a symbolic link (120000), a missing or conflicted
   entry, or an unreadable index does not count. Unlike the base comparison this FAILS CLOSED, reason
   `lockfile-emptied-unverified`: an unreadable base copy or base tree, an
   asymmetric command line, a base run that fails or prints no count for a
   copy, and (src/gate-runner.ts:2802) a head run that printed no count
   line for a handed non-requirements lockfile, which is what a verbosity
   option in the policy's osv-scanner options causes; conductor names it
   and does not edit it. No budget left, or a base run stopped at it, is
   `timed-out`, step `base-check`. A base copy that is absent or read no
   packages changes nothing, and a head that could not run is left as it
   was with no base spawn. Pinned by tests/osv-emptied-base.test.ts:114
   ("is could-not-run, naming the file and the base count"), 129 ("is
   could-not-run, not blocked, when the head also blocks"), 140 ("changes
   nothing on a plain run: the lockfiles-empty line, no base run"), 149
   ("changes nothing when the head lockfile still has packages"), 161
   ("changes nothing when the base lockfile was already empty"), 170
   ("changes nothing when the lockfile is new in this pull request"), 178
   ("is could-not-run when the base run fails"), 185 ("is timed-out, step
   base-check, when the base run outlives the remaining limit"), 192
   ("leaves a head that could not run as it was, and spawns no base run"),
   200 ("on exit 128 checks the base copy of every handed lockfile"), 219
   ("is could-not-run after git mv plus an emptied copy (the replacement
   reads 0)"), 234 ("is could-not-run when the only lockfile is deleted"),
   243 ("is could-not-run when the replacement sits in another
   directory"), 255 ("changes nothing when a populated replacement sits in
   the same directory"), 269 ("is could-not-run when the only
   same-directory lockfile was already on the base (Cargo.lock)"), 312
   ("does not count a pinned requirements file the base already had"), 323
   ("does not count a requirements file new in the pull request"), 332
   ("does not count a lockfile the base already had in the same
   directory"), 341 ("counts a populated lockfile new in the pull request
   in the same directory"), 354 ("is could-not-run, unverified, under a
   trust base, naming the file"), 363 ("changes nothing on a plain run"),
   388 ("is timed-out, with nothing spawned, when no budget is left"), 404
   ("is unverified when the base run printed no count line for a copy")
   and, through the CLI with the token, 415 ("exits 2 with token could-not-run
   beside another lockfile and another gate"); for the 0.13.0 halves by
   478 ("is could-not-run when the only replacement is a new lockfile of
   another ecosystem (Cargo.lock)"), 489 ("does not count a new lockfile of
   another ecosystem, called directly"), 498 ("is could-not-run when the
   only replacement is a symbolic link to a populated lockfile elsewhere"),
   517 ("does not count a symbolic link, called directly"), 527 ("does not
   count a replacement with no entry in the head index"), 534 ("changes
   nothing for an npm-to-pnpm rename with a populated regular file"), 546
   ("counts a same-family regular file new in the pull request, called
   directly"), 555 ("does not clear when the replacement has no ecosystem
   family"), 564 ("does not clear when neither side has an ecosystem family
   (two unknown kinds never match)") and 573 ("gives every handed name a
   family, from the one table, and none to an unknown name"); and by
   tests/osv-base-comparison.test.ts:193 ("is could-not-run when the
   lockfile that left had packages on the base and nothing replaced it").
   Mutations, each run on the fix-round tree: skipping the base spawn
   turned 13 red; ignoring the base count turned 8 red; treating a failed
   or timed-out base check as clear turned 2 red; dropping the budget
   branch turned 1 red, as did treating a missing base count as clear;
   running the check on plain runs turned 1 red; skipping the removed
   candidates turned 5 red; accepting a replacement in any directory
   turned 2 red; treating a missing head count as clear turned 1 red;
   dropping the base-absence half of the replacement rule turned 2 red
   (the two Cargo.lock cases), and dropping the requirements-file half
   turned 1 red (the requirements file new in the pull request). 0.13.0
   mutations, each run against tests/osv-emptied-base.test.ts: dropping
   the family half turned 4 red (the two new-Cargo.lock cases and the two
   no-family cases); letting an unknown family match an unknown family
   turned 1 red (the two-unknown-kinds case); dropping the regular-file
   half turned 3 red (the two symbolic-link cases and the no-index-entry
   case); accepting mode 120000 inside it turned 2 red (the two
   symbolic-link cases).
   CLOSED in 0.13.0: a new populated lockfile of ANOTHER ecosystem in the
   same directory (a one-package Cargo.lock beside a deleted
   package-lock.json) and a symbolic link to a populated lockfile from
   elsewhere no longer clear a removed one.
   STILL OPEN: on a plain run there is no base to compare against, so the
   notes are all there is (and a lowered verbosity turns the
   lockfiles-empty note off); an emptied, deleted or moved requirements
   file is not checked under a trust base either (its include closure is
   out of scope); and when nothing at all was handed the base run has no
   head command line to be held against, so the symmetry check is skipped
   there. The replacement rule has no content tie: a regular-file COPY of a
   same-family lockfile from elsewhere (another directory's
   package-lock.json committed as pnpm-lock.yaml beside the deleted one)
   still clears it, and one replacement clears every removed lockfile of
   its family in its directory (not ruled, kept). Each needs a deliberate
   added file visible in the diff, and the
   `conductor/lockfile-no-longer-scanned` note still fires. Closing the
   copy residual needs a content tie, an open operator decision.
   The fail-closed branch for a base listing error (a replacement whose base
   lookup errors does not count) has no test; it is reachable only through a
   symbolic link or submodule parent on the base.
6. KNOWN-OPEN: a base `.gitleaks.toml` whose `[extend] path` target is a
   symbolic link, or which writes the extend as an inline table or a quoted
   key, fails closed on every pull request (`preparation-failed`, or a
   missing file for gitleaks) until it is rewritten as a plain relative path.
7. KNOWN-OPEN: a renamed or moved lockfile compares as all introduced; a
   deleted one is not scanned on either side, now with the note-only
   `conductor/lockfile-no-longer-scanned`; and a second dependent of a
   version already in the same lockfile (same package, version and path)
   compares as present-on-base.

## The repository root comes from --project or the cwd, and is passed explicitly everywhere

Unreleased, issue #55. dep-guard, vault-guard and intent-guard each take a
path or `--project`, so a script can point any of them at a repository
without changing into it first; conductor took nothing, which forced a `cd`
compound onto every scripted call. `--project <dir>` closes that on `init`
and `run`, the only two commands that resolve a repository root, and it
changes WHERE the repository is, never WHAT is trusted.

OMITTING THE FLAG IS UNTOUCHED, ON BOTH COMMANDS, AND DELIBERATELY NOT
ROUTED THROUGH THE NEW RESOLVER. A fix round found this the hard way:
`resolveProjectRoot(cwd, undefined)` returns `repoRoot(cwd)`, which THROWS
on a non-repository, while `init`'s own `planInit` and `revertInit` (through
their own `repoRootOf`, src/init.ts:351-353) REPORT a non-repository as a
structured conflict and return it rather than throwing -- `not-a-git-
repository`, the "Run git init first" guidance, JSON on stdout under
`--json`, exit 2 through the ordinary `result.ok` branch. Calling
`resolveProjectRoot` unconditionally at the top of `init`'s action, which an
earlier draft of this feature did, made a plain `conductor init` or `init
--revert` outside a repository throw a differently-worded, JSON-less error
instead, and it changed the CHECK ORDER besides: `planInit` refuses
`--adopt` or `--force` without `--hook` (`flag-requires-hook`) BEFORE it
ever asks whether it is in a repository at all (src/init.ts:447-458), and
the unconditional resolver asked the repository question first, so
`--adopt` without `--hook` outside a repository reported the wrong
conflict. The fix, and the invariant this section now states: `src/cli.ts`
calls `resolveProjectRoot` for `init` ONLY when `options.project` is
defined; when it is not, `process.cwd()` is passed straight through to
`planInit`/`applyInit`/`revertInit` exactly as it was before this flag
existed, byte for byte (src/cli.ts:578-580, the `options.project ===
undefined` branch of the ternary that assigns `cwd`). `run` has no
equivalent structured-conflict path to preserve -- it always threw through
`repoRoot` before this flag existed -- so its own call (src/cli.ts:693)
passes `options.project` to `resolveProjectRoot` unconditionally and that
was correct from the start.

RESOLUTION FOR AN EXPLICIT --project IS ONE FUNCTION, CALLED FROM BOTH
COMMANDS. `resolveProjectRoot` (src/cli.ts:212-231) resolves the value
against the process's own working directory with `path.resolve` before
anything else runs, so a relative value means what the person typing it
expects rather than something resolved against a path discovered later. The
resolved path is then checked to exist and be a directory with `statSync`,
and only then handed to `repoRoot` (src/cli.ts:154-188) exactly as the bare
working directory always was for `run`, the same `git rev-parse
--show-toplevel` call, so a subdirectory of a repository resolves to that
repository's top level exactly as it does with no flag at all. A path that
does not exist, is not a directory, or is not inside a git repository is a
thrown `Error` naming it, never a silent fall back to the cwd. This
resolve-then-validate-then-discover shape is new behaviour that `--project`
introduces on purpose; only the NO-FLAG path is required to match what
existed before it.

BOTH CALL SITES THREAD THE RESULT EXPLICITLY FROM THERE ON, WHICHEVER PATH
PRODUCED IT. `run`'s action passes the root on as `root` into `policyForRun`,
`loadPolicy` and `runAll`'s own `repoRoot` option, the same wiring that
existed before this release; nothing downstream reads `process.cwd()`
again. `init`'s action passes the root on as the `cwd` field of
`InitOptions`, which `planInit`, `applyInit` and `revertInit` already
treated as the repository's anchor rather than as the literal process cwd:
on the `--project` path they re-derive the root from it with their own
`repoRootOf`, which is the same `git rev-parse --show-toplevel` call under a
different name, so a root `resolveProjectRoot` already found resolves to
itself again there; on the no-flag path they are the ONLY place the root is
discovered, exactly as before this issue.

NO `process.cwd()` READ SURVIVES RESOLUTION. Before this release exactly two
sites read it, both in `src/cli.ts`: the `init` action and the `run` action,
each immediately below its own `.action(...)` call. Both still read it
exactly once, at the same place, and pass it on: `run` always through
`resolveProjectRoot`, `init` through `resolveProjectRoot` only when
`--project` is given and directly to `InitOptions.cwd` otherwise. Neither
action reads `process.cwd()` a second time afterward. Grepped for across
`src/` at the time this was written: those were the only two `process.cwd()`
calls in the package outside a comment; every other module that needs the
repository root already took it as an explicit parameter (`repoRoot` on
`RunOptions` in src/run.ts, `repoRoot` on `GateRunnerOptions` in
src/gate-runner.ts, `repoRoot` in src/trust-base.ts's exported functions,
`cwd` in `InitOptions`), which is what made this a small change at the two
entry points rather than a rewrite of everything a gate or a git call
touches.

THE TRUST BOUNDARY DOES NOT MOVE WITH THE FLAG. `--project` selects a
directory before any of the pull-request-mode logic runs, and everything
that logic already did against the resolved root is unchanged: the
`node_modules/.bin` skip on a pull-request run is decided from
`options.trustBase !== undefined` and reads `options.repoRoot`
(src/gate-runner.ts:910-911), the program-vetting rule is called with that
same `options.repoRoot` (src/gate-runner.ts:984, calling
`refuseHeadControlledBinary`, src/gate-runner.ts:413-428, which itself calls
`refuseHeadControlledProgram`, src/trust-base.ts:714-802), and
`refuseTrustBaseRef` (src/trust-base.ts:275-335) runs its own `git` calls
with `cwd: repoRoot` exactly as before -- `--project` only changes what
that `repoRoot` variable holds once, at the top of `run`'s action, never
which checks run against it or how. The composite Action gains no matching
input: it always runs from the checkout it is given and never passes
`--project`, so this is for scripted and local use outside it and does not
touch the Action's own boundary.

EVERY CHILD GATE'S OWN WORKING DIRECTORY IS UNAFFECTED, BECAUSE IT WAS
ALREADY THE RESOLVED ROOT, NOT THE PROCESS CWD. `runGate` spawns every gate
with `cwd: spawnCwd`, itself derived from `options.repoRoot`
(src/gate-runner.ts:1378, with the vault-guard rationale for why the
child's cwd matters at all recorded at src/gate-runner.ts:11-19), and
`options.repoRoot` is the value `run`'s action received back from
`resolveProjectRoot`. That path predates this release and did not change:
`--project` only changes what is fed into a parameter that was already
threaded through explicitly, which is the reason no gate-runner or
trust-base source file needed an edit for this issue, only `src/cli.ts`
did.

A `.git` DIRECTORY GETS ITS OWN MESSAGE, NOT THE GENERIC ONE. `git
rev-parse --show-toplevel` run with `cwd` set to a repository's own `.git`
directory fails the same way an ordinary non-repository does, "this
operation must be run in a work tree", so `--project <repo>/.git` used to
read as "not a git repository" -- true of neither shape without a second
check. `isGitDirectory` (src/cli.ts:140-152) asks `git rev-parse
--is-inside-git-dir` only once `--show-toplevel` has already failed, so the
extra spawn is on a path already about to fail the command; `repoRoot`
(src/cli.ts:154-188) reads it to choose between "is a git directory, not a
working tree" and the ordinary "not a git repository" message. This applies
to the bare working directory too, not just to `--project`, since `repoRoot`
is the one function both paths share.

PINNED, WITH THE COVERAGE STATED PRECISELY BECAUSE IT IS UNEVEN. All three
of `resolveProjectRoot`'s usage-error branches -- missing, not a directory,
outside any repository -- are driven through the real, built CLI on the
`run` command in tests/cli.test.ts, under "conductor run --project (issue
#55)", each asserting exit 2, the path named in `stderr`, and no stack
frame; the same suite pins the `.git`-directory message separately. `init`'s
own wiring is pinned separately, under "conductor init --project (issue
#55)": that a real `init` run writes the policy file and the manifest into
the named repository and not into the cwd it was invoked from, that a
`--hook` init writes byte-identical hook content whether or not `--project`
was given (the flag moves WHERE init writes, never WHAT), that `--revert
--project` finds the manifest in the named repository rather than the cwd,
and that a directory outside any git repository is refused naming the path.
`init` is NOT separately pinned for the missing-path and not-a-directory
branches, because both commands call the same `resolveProjectRoot` on the
`--project` path and `run`'s suite already exercises both against the
shared function; this is stated here rather than left implicit, per this
file's own rule that an admitted gap is worth more than a citation that
quietly walks past one. The NO-FLAG regression itself -- a plain `init` and
`init --revert` outside a repository, and `--adopt` without `--hook`
outside a repository -- is pinned directly under "conductor init without
--project (regression guard, issue #55)", against the exact JSON body and
conflict reason `planInit`/`revertInit` return, not merely against the exit
code, because the exit code alone was still 2 on both the correct and the
regressed behaviour and would not have caught this. The
subdirectory-resolves-to-top and relative-resolves-against-cwd cases, and
running from an unrelated cwd producing a byte-identical report to running
inside the repository, are pinned on `run` only, for the same reason:
`init`'s own repository-root discovery, `repoRootOf`, is a separate
function from `run`'s `repoRoot` and is exercised by `init.test.ts`'s
existing suite on its own terms; this section's claim is only that
`--project` reaches `init` correctly, which the `init`-specific tests above
establish, not that it re-proves `repoRootOf` itself.

## The comment and the job verdict come from the same run

New with the verdict token (issue #85). The pull request comment, the
verdict token printed under it, the job summary line, the `verdict` output
and the job's exit code are all ONE run's answer. Until this change the
comment step re-ran conductor purely to render text, because a run has one
format, so the job's exit code came from the first run and the comment's
verdict from the second, and the two could disagree whenever a gate's answer
was time or network dependent (dep-guard's online lookups run under a
deadline budget). A token copied from that comment would have been a token
for a run that did not decide the job.

THE RULE. The run that sets the exit code is the run that writes the text
report: `conductor run --format sarif --text-report PATH`, one invocation. The run
that decides spawns each gate once, and the preview in the same invocation
may spawn a previewed gate once more; the preview never reaches the token,
the exit code or report lines 1 to 4 (`--text-report` in src/cli.ts renders
the SAME `RunResult` a second time and never calls `runAll` again). Pinned
by tests/run.test.ts ("a preview that throws leaves the exit code, the
verdict token and lines 1-4 identical to the run without it") and
tests/output-text.test.ts ("prints the preview after the verdict and leaves
lines 1 to 4 and the token alone"). The gates step in
action.yml reads the token from line 2 of that file for the summary and the
`verdict` output, and the comment step posts that file byte for byte and
invokes conductor ZERO times on that path. The token function
(`verdictToken`, src/output-text.ts) and the process exit code
(`applyAdvisory`, src/cli.ts) take the same `advisory` boolean from the same
call site, so the label and the process exit code agree by construction in
the CLI. The report is written LAST, after the SARIF log, and is deleted
again if any write throws, so a run that exits 2 by write failure leaves no
text report. In the action, a token that does not match the exit status is
never published: the gates step accepts a token only as one of the pairs
status 0 with pass, nothing-checked, advisory-blocked (N) or
unenforced-findings (N), status 1
with blocked (N), status 2 with could-not-run, and otherwise publishes
could-not-run (non-zero status) or unknown (status 0) and deletes the report
file, so the comment step says it produced none.

REPORT FILES ARE NEVER WRITTEN THROUGH A SYMBOLIC LINK. `--output` defaults to
`conductor.sarif` in the checkout, and a pull request can commit a symlink of
that name pointing at a hook, `.git/config` or a runner file. `writeReportFile`
(src/cli.ts) lstats the final path and refuses a link, dangling or not, with a
could-not-run exit (2), and opens with O_NOFOLLOW where the platform has it so
a link swapped in after the check is refused by the kernel. Applies to
`--output` and `--text-report` alike; the refusal for the text report happens
before its cleanup path is armed, so a refused link is never unlinked. Only the
FINAL path component is covered: a symlinked parent directory is not, which is
a known limit. Pinned by tests/cli.test.ts:1291 ("refuses an --output that is a symlink, leaves its target untouched, and exits 2"), tests/cli.test.ts:1313 ("refuses a dangling --output symlink too, so it cannot create a file at its target") and tests/cli.test.ts:1327 ("refuses a --text-report that is a symlink, leaves its target untouched, and exits 2").

THE TOKEN DECIDES NOTHING. `verdictToken` reads `result.exitCode`, which
`composeExitCode` already produced, and the `enforce` flags already on the
gates. It is a label for the umbrella's own exit decision, never a verdict
about a gate, so the rule in AGENTS.md (the umbrella never decides a gate's
verdict for it) is untouched. Precedence: could-not-run, then blocked or
advisory-blocked, then unenforced-findings, then nothing-checked, then pass.
`unenforced-findings` exists because `composeExitCode` ignores `enforce: false`
gates, so a run whose only blocking findings sit on one exits 0; calling that
`pass` would hide exactly what the exit code hid. `nothing-checked` is the same
rule for the other silent exit 0: a run where no gate ran at all (none enabled,
or every one deferred, tree-unchanged or skipped) keeps its exit status of 0 but
is labelled `nothing-checked`, never `pass`, because a run where no gate ran at
all is not clean whatever the exit code says. Pinned by tests/verdict-token.test.ts
("is nothing-checked, never pass, for a run with no gate at all (exit stays 0)") and tests/action.test.ts (the closed-set pair
check).

Since 2026-10-13 (audit finding F4) the same token covers a run where gates
DID run and every one of them checked nothing: a gate with
`conductor/nothing-to-scan`; osv-scanner whose every handed lockfile parsed
to no packages (its exit 128, which the runner marks with the run detail
`packages-read 0`, so a sole lockfile rewritten to `{}` is labelled exactly
like no lockfile at all); or the intent gate with no contract to check
against. Before, one vulnerabilities gate with no lockfile it reads printed
`pass` beside a verdict sentence saying it had nothing to scan. The token
and the verdict sentence share one predicate, `gateCheckedNothing`
(src/output-text.ts), so they cannot disagree; in that state the sentence
reads "nothing was checked" and the one-line clean summary is not used. Not
`could-not-run`: that token is exit 2 by construction (the action's pair
check refuses it beside status 0), and a repository with nothing to scan
must stay exit 0, so the existing exit-0 token whose meaning is "nothing was
verified" is the one that fits; no new token and no change to the closed
set. The PARTIAL-empty case (audit finding F2: some handed lockfiles read,
one parsed to nothing) shares the `conductor/lockfiles-empty` code but never
carries `packages-read 0`, so that gate counts as having checked something;
the marker, not the diagnostic code, is what the predicate reads. Pinned by
"is nothing-checked, never pass, when every gate that ran scanned nothing
(audit F4)" and "is nothing-checked when every lockfile handed over parsed
to no packages, and pass when only some did" in tests/verdict-token.test.ts,
and by "labels a run whose sole lockfile is {} nothing-checked, the same as
a run with no lockfile" in tests/gate-runner.test.ts.

THE ONE PLACE A SECOND RUN REMAINS, and why. The action installs whatever
`conductor-version` says, and a version older than the one that added
`--text-report` exits 2 on the unknown option. The gates step therefore asks
the installed binary (`run --help` contains `--text-report`) rather than
comparing version numbers: the backward-pin rule in the validate step only
guards `pull_request` events and compares against `TAG_CONDUCTOR_*`
constants that move with a release, so it does not by itself guarantee the
flag. An older binary gets no token and the comment step's old render run,
marked by the `report-fallback` step output. That path has no token, so the
comment/verdict agreement claimed above holds for every installed conductor
that has the flag and, by construction, says nothing for one that does not.

WHAT IS AND IS NOT CLAIMED. Pinned by execution in tests/action.test.ts
(the gates step run against a conductor shim: token and exit status for pass,
blocked, could-not-run and advisory-blocked; the token read from line 2 only;
CR, LF and tab flattened before GITHUB_OUTPUT and the summary, and the result
checked against the closed set and the exit status; the exit
status kept when the summary cannot be written; the fallback for a binary
without the flag) and tests/action-pr-comment.test.ts (zero conductor
invocations when the gates step wrote a report). Mutation-checked: making the
gates step `exit 0` after the summary, and putting a conductor run back on the
comment step's primary path, each turn a named test red. NOT claimed: that the
token in a comment matches the job when the gates step wrote no report (the
comment then says it produced none), or that a clean non-verbose one-line
summary carries a token (it is one line by design; the action always passes
`--verbose`).

THE TEXT REPORT'S PER-GATE CAP HIDES LINES, NEVER FINDINGS (phase 3, item
3.3). Without `--verbose` a gate section prints its first
`FINDINGS_SHOWN_PER_GATE` (src/output-text.ts:181) entries, blocking first, and
rolls the rest into one line counting them (src/output-text.ts:343). The cap
is applied inside `gateSection` only, after every number on the report has
already been taken from `gate.findings`: the inventory line, the verdict
sentence, the verdict token and the exit code (composed in exit-codes.ts,
which never sees the text report) all count every finding, and SARIF renders
every finding whatever the cap. The osv-scanner grouping beside it (one line
per advisory on one installed package, across lockfiles) is the same kind of
thing: presentation over unchanged findings. Pinned by "never drops a capped
finding from the counts, the verdict, the token or SARIF" and "keeps every
finding behind a grouped line: the count line, SARIF and the verdict are
unchanged" in tests/readable-reports.test.ts. The rollup counts FINDINGS
under the hidden lines, not lines, which differ exactly when a hidden osv
line groups several lockfiles: pinned by "counts findings, not lines, when
the hidden osv lines group several lockfiles" in the same file (audit
2026-10-18 N2; counting entries instead of findings turned it red, and it
was the only test to go red).

INIT ENABLES AN EXTERNAL GATE ONLY WHEN ITS BINARY IS FOUND, AND SAYS CI MUST
INSTALL IT (phase 3, item 3.4). `renderPolicy` writes `enabled: true` for a
role only when `detectGates` found its binary (src/init-policy.ts:110), and
under an enabled external gate (a product whose profile is not `managed`) it
writes a comment that CI must install that tool (src/init-policy.ts:123-127),
because nothing in this family installs gitleaks or osv-scanner and a run
without it is `conductor/gate-missing`, exit 2. init prints a WARNING line
saying the same. Init never rewrites an existing policy file; on one it only
lists the roles the file lacks. Pinned by "writes an external gate enabled
only when its binary is found, with a CI comment in the file" and "names each
role the file lacks, with the two lines that add it, and leaves the file
alone" in tests/init-phase3.test.ts.

OSV-SCANNER STDERR IS UNTRUSTED TEXT, AND NO CONTROL BYTE FROM IT REACHES A
REPORT (phase 3 review, B1). `osvSuppressions` (src/normalize.ts) reads the
osv-scanner.toml suppression lines from stderr, where osv-scanner 2.4.0
prints a reason verbatim, newlines and escape bytes included, so a reason can
forge a line of its own. Only an id of advisory-id shape is read, and every
id and reason is cut to printable ASCII before it reaches the
`suppressed-by-osv-scanner.toml` fact, which the text report prints
uncleaned; a count that is not a safe integer is ignored. An id-shaped forged line made of printable text is still read and listed; that is display only and feeds no count, verdict or exit. Pinned by "never
lets a control byte from osv-scanner stderr reach the fact, the text report,
SARIF or the comment body (B1)" in tests/readable-reports.test.ts.

THE HUSKY FRESH-CLONE REDIRECT FIRES ONLY WHEN core.hooksPath IS NOT SET AT
ALL (phase 3 review, B2). A `core.hooksPath` set to `.git/hooks` by hand is
the default directory but is configured, so git runs `.git/hooks` and init
writes there; only an unset `core.hooksPath` with husky declared in
package.json or a tracked `.husky/` sends the hook to `.husky/pre-commit`.
Pinned by "does not redirect when core.hooksPath is set explicitly to
.git/hooks, the path git then runs (B2)" in tests/init-phase3.test.ts.
