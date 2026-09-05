# conductor invariants

This is the list of cross-cutting rules the umbrella depends on. It exists
because a cohesion audit should read a checked-in file rather than
re-derive a list from whatever the auditor happened to remember, and
because most of the rules below are true in one file and depended on in
another, with nothing between them that would notice if one side moved.

conductor is a convenience layer on purpose. It runs three gates that are
installed, versioned and released separately, and if this package
disappeared all three would still work. That shape is the source of nearly
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
one direction and held to three justified exceptions in the other
(tests/policy.test.ts:338 and 347), and
`conductor/blocking-threshold-unknown` is exercised at the normalizer
(tests/normalize.test.ts:62). The remaining four were closed in 0.2.1,
one of them by fixing a real bug rather than only testing around it:

1. A MALFORMED MANIFEST ON REVERT. `revertInit` parsed it with a bare
   `JSON.parse`, so a corrupt one threw where `readManifest` treats the
   same file as missing. Revert now answers `manifest-unreadable`, which
   is deliberately a different conflict from `no-manifest`, and removes
   nothing. Pinned by tests/init.test.ts:926.
2. THE SUCCESS HALF OF THE TEMPORARY-DIRECTORY CLEANUP. Pinned by
   tests/intent-run.test.ts:151, which drives a full passing `runAll`
   through the import and freeze chain and counts `conductor-intent-`
   entries in the system temporary directory either side. The failure
   half was already pinned; this half is the caller's `finally`, and it
   was correct, so no code changed.
3. `--spec` OUTRANKING A FROZEN NATIVE CONTRACT. Pinned by
   tests/intent-prepare.test.ts:220 and 231, which put both in one
   repository and assert the flag's spec is what gets imported and frozen
   and that the gate is not pointed at the repository itself.
4. THE SUBDIRECTORY ANCHORING OF THE CLI. Pinned by tests/cli.test.ts:393,
   which runs the built CLI from two levels down and asserts it produces
   the same report, byte for byte, as the same run from the top.

Two more things belong on this list without being invariants of the same
kind, and neither has changed. `ExitInput.enforce` is REQUIRED rather
than defaulted, which is a compile-time property that no test pins and no
test could. And the generated hook's own `exit 1` is asserted on one of
its two fail-closed branches only, which is a partial gap rather than an
absent one; the section on it says which half is which.

## The exit code is composed, not maximised

Three codes and nothing else. 0 means every enabled gate ran and none
blocked. 1 means every enabled gate ran and at least one blocked. 2 means
an enabled gate could not run, so nothing in the report is a clean result.
2 outranks 1 and 1 outranks 0, and the composition is written as two
ordered predicates rather than as an arithmetic maximum
(`composeExitCode`, src/exit-codes.ts:72-81).

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
it is treated as could-not-run (src/gate-runner.ts:404-423). So the
composed code can differ from the maximum of the children's, deliberately.

The per-finding `blocking` flag can only ADD to the answer, never subtract
from it: the second predicate is `(gate.exitCode ?? 0) !== 0 ||
gate.hasBlockingFinding` (src/exit-codes.ts:77). A gate that exited
non-zero produces a non-zero composed code whatever the umbrella made of
its output. The flag exists only so a gate whose exit code somehow said
clean while its own report carried a blocking finding still fails the run.

Pinned by tests/exit-codes.test.ts, twelve cases, of which the ones that
matter are "does not take the numeric maximum of the children codes"
(line 43, whose single gate exited 1 and is could-not-run, so the answer
is 2 where the maximum would be 1), "lets could-not-run outrank a
blocking gate rather than the other way round" (line 34), and "is 1 when
a gate reported a blocking finding even if its exit code did not" (line
22). The wiring from a real
run into that function is tests/run.test.ts:73, which drives a gate whose
output has drifted shape and asserts the composed code is 2 and not 1.

`ExitInput.enforce` is REQUIRED rather than defaulted
(src/exit-codes.ts:69), so a call site that has not thought about
enforcement does not compile. That is a compile-time property and no test
pins it; a test could not.

## An unenforced gate is filtered out, and nothing else about it changes

`enforce: false` in the policy file removes a gate from the exit-code
composition entirely (src/exit-codes.ts:73). It is not a downgrade. The
gate still runs, its findings keep their own severities, their `blocking`
flags are untouched, and both output formats report it exactly as they
report an enforced gate, with one added sentence saying its verdict did
not reach the exit code.

This is the adoption ramp. `conductor init` writes `enforce: false` for
the intent gate and `enforce: true` for the other two
(src/init.ts:589-595), so a fresh repository gets the ramp rather than
three repositories being hand-edited into it.

The rule that makes it safe is that nothing reads a gate's output and
decides to ignore it. The umbrella reads a line somebody wrote in their
own policy file, and the line changes exactly one number.

Two consequences are worth stating because they look like bugs:

A run can exit 0 with BLOCKING on the screen above it. The text verdict
therefore carries the reason on the same line rather than leaving it to
the sections: the clauses are built in `unenforcedClauses`
(src/output-text.ts:254-275) and appended to the exit 0 verdict at
src/output-text.ts:352-360, with the same clauses carried as an aside on
the exit 1 and exit 2 verdicts (src/output-text.ts:313-317).

An unenforced gate that could not run still produces a critical,
error-level RESULT in the SARIF log, not a note. `conductor/gate-missing`
and `conductor/gate-failed` keep their severity and their result standing
whatever the policy says about enforcement (src/normalize.ts:641 for the
severity, src/output-sarif.ts:101-107 for the level, and 633-638 for the
findings going into the umbrella's run rather than being reclassified),
and only the umbrella's own `gate-not-enforced` notification says the
verdict did not reach the exit code.

This was recorded here as a disagreement with the README, which used to
summarise enforcement as making such a gate "a note rather than exit 2".
That was true of the exit code and false of the published log. The README
was the wrong one and now says the same thing this section does
(README.md:125-137), and the rule is pinned by
tests/output-sarif.test.ts:982, which renders an unenforced gate that
could not run and asserts the result's level is `error` and its severity
`critical`, with the `gate-not-enforced` notification beside it.

The report header and the verdict deliberately count different things.
The header counts findings across every gate, because it is an inventory
of what follows it and a reader counting lines on screen has to arrive at
that number (src/output-text.ts:505-515). The verdict counts only
enforced gates, because it answers what failed the run
(src/output-text.ts:277-285). Two questions, two numbers.

Pinned by tests/exit-codes.test.ts:52, 58, 66 and 75;
tests/output-text.test.ts:446, 454, 461 and 466 (an unenforced gate that
blocked: the findings and their BLOCKING marker survive, the header is
marked, and the verdict does not claim none blocked), 493, 498 and 505
(an unenforced gate that could not run is loud, is not exit 2, and is not
also called a gate that blocked), 536, 549 and 557 (only enforced gates
are named as the reason and counted), and especially 577 ("lets the
header count everything on screen while the verdict counts what failed",
which asserts the header says 3 findings while the verdict says 2 across
1 gate); tests/cli.test.ts:400, 416, 446 and 461, end to end through the
CLI; and tests/output-sarif.test.ts:970, 982, 1015, 1035 and 1049.

## A gate that could not run is a result, never a note

Six reasons, enumerated as a union so a new one cannot be spelled freely
(`CouldNotRunReason`, src/gate-runner.ts:38-49): a missing binary, a
configured command that is not there, a spawn failure, the gate's own
error exit, output the umbrella could not read, and a preparation that
never got as far as spawning anything.

Each one produces a finding of the umbrella's own, critical and blocking,
with no location (`gateProblem`, src/normalize.ts:629-657, and the four
functions that call it at src/normalize.ts:667-742). That is not symmetry
for its own sake. A gate that never ran gets no SARIF run of its own, by
the rule below, so without one of these findings the published report
would carry no trace of the most important thing that happened.

A gate that exits above 1, or does not exit normally at all because it was
killed or timed out, is could-not-run (src/gate-runner.ts:386-402). A gate
that exits 1 with stdout that will not parse as JSON is could-not-run
(src/gate-runner.ts:404-423). Reporting the second as a policy violation
would tell a user their code is at fault when their config is.

Pinned by tests/gate-runner.test.ts:165, 175 and 199, and end to end by
tests/run.test.ts:73 and tests/cli.test.ts:95.

AGENTS.md and README.md both used to say the umbrella raises no findings
of its own "beyond conductor/gate-missing". That was false and always had
been: the union at src/normalize.ts:624-627 has three members, and the
README named `conductor/gate-failed` elsewhere in the same document.
Three, plus the two normalization diagnostics, is the number, and both
documents now list all five (AGENTS.md:12-16, README.md:669-672).

## runGate is total

`runGate` never throws. That is a contract and not a hope, and the reason
is structural: the caller maps over the enabled gates in order
(src/run.ts:179-230), so an escaping error does not merely lose one gate's
report, it loses every gate after it, and it surfaces as a stack trace
with exit 1, which the pre-commit hook then reports as "a gate blocked".

The backstop is src/gate-runner.ts:279-293. The `catch` around
normalization is deliberately NOT narrowed to `NormalizeError`
(src/gate-runner.ts:435-455): that narrowing was the original defect, when
a normalizer reading a property off a null array element threw a
`TypeError`, which escaped everything. The normalizers now validate every
field they read before reading it (src/normalize.ts:49-90), and the broad
catch is the second line of that defence rather than the only one.

Pinned by tests/run.test.ts:69 ("does not throw"), 89 ("still runs and
reports the other two gates") and 102 ("carries no stack frame anywhere in
the outcome").

## Where the tool refuses rather than guesses

The umbrella has no built-in default policy. A missing `.guardrails.yaml`
is a `PolicyError` naming the file and telling the user to run
`conductor init` (src/policy.ts:350-356). A run that gates a commit has to
be explainable from a file in the repository rather than from something
compiled into a binary. Pinned by tests/cli.test.ts:130.

An unusable changed-path set fails closed. `changedPathsSince` returns a
failure rather than an empty list on any git error, because an empty path
set is indistinguishable from a clean run (src/intent-base.ts:109-125). It
also refuses a path containing a comma, since `--paths` is comma-joined
and such a path would arrive at the gate as two paths, inventing one
breach and hiding another, and it refuses a path with leading or trailing
whitespace for the same reason (src/intent-base.ts:133-158). A space in
the middle of a filename is ordinary and passes through untouched. Pinned
by tests/intent-base.test.ts:144, 162, 174, 181 and 202, and end to end by
tests/intent-run.test.ts:309 and 331.

A missing umbrella binary blocks the commit. The generated hook exits 1
rather than warning and letting the commit through (src/init.ts:260-267).
A guardrail that switches itself off when the tool is missing is a
guardrail an attacker turns off by making the tool missing. The hook says
two different things depending on whether git was available to locate
`node_modules/.bin`, because "git is not on this hook's PATH" and
"conductor is not installed" send a reader to two different fixes.

The coverage here is uneven and worth stating precisely, because the two
halves are pinned differently. That the commit is REFUSED is pinned by
tests/init.test.ts:1409 and 1507, which drive a real `git commit` with no
conductor anywhere and assert git's own status is non-zero and the
message says NOT checked. That the HOOK ITSELF exits 1 is asserted in one
place only, tests/init.test.ts:1426, and only on the git-missing branch:
it runs the hook directly and asserts `run.status` is 1. Nothing asserts
the hook's own exit code on the ordinary "conductor: command not found"
branch, where a hook that exited 127 or 2 would still make the commit
fail and still pass those tests. The message on that branch IS pinned
(tests/init.test.ts:1423). A neighbouring test also asserts `run.status`
is 1 (tests/init.test.ts:1487), but that 1 is passed through from the
stub conductor it installs and is not this branch of the hook at all.

An unknown `--stage` is a usage error and never a silent full run
(src/cli.ts:73-81). Both directions of the quiet failure look like
success: a typo that runs every gate reads as a passing build with more
coverage than it has, and a typo that runs none reads as a passing build
with no coverage at all. Pinned by tests/cli.test.ts:204.

One place reads the same file two ways, on purpose, and the reason is
worth stating because it used to be an asymmetry rather than a decision.
`readManifest` treats an unparseable manifest as a missing one, because
"the record is unreadable" is not evidence that a file on disk is the
umbrella's (src/init.ts:471-481). `revertInit` does NOT reuse it, because
revert has to tell the two apart: a missing manifest means there is no
record to act on, an unreadable one means there is a record and it cannot
be trusted, and those send a reader to different fixes. It answers
`no-manifest` for the first and `manifest-unreadable` for the second, and
removes nothing either way (src/init.ts:998-1030).

`revertInit` used to parse that file with a bare `JSON.parse` and no
guard, so a corrupt manifest made `--revert` throw. The throw was caught
in `main` and printed as one line with exit 2 (src/cli.ts:266-280), so
nothing leaked a stack, but the message was a JSON parser's: a user whose
manifest was truncated by a crash or a bad merge got `Unexpected end of
JSON input` and no indication which file was unreadable or that the fix
is to repair or delete it by hand. Nothing pinned it, because every test
that touched the manifest wrote valid JSON back. Now pinned by
tests/init.test.ts:926.

## Gate resolution: the name outranks the location, and the location outranks nothing

Resolution loops over CANDIDATE NAMES on the outside and LOCATIONS on the
inside (src/resolve.ts:255-267, with `locate` at 149-165). The obvious
loop is the other way round, and it pins a repository to whatever name
happens to be global: a machine with a leftover pre-rename install on PATH
would beat the repository's own current-name dev dependency, silently, for
as long as the old package stayed installed.

Within one name, the repository's own `node_modules/.bin` beats PATH
(src/resolve.ts:154-159). This was the other way round until a dogfood run
found a global gate build running over a repository's own pinned one, with
the report naming a version that repository had deliberately not chosen.
`pnpm exec` in the same repository runs the pin, and the package manager
is the one the lockfile agrees with.

The two orderings are opposite on purpose. A NAME is a statement about
which product, and the repository has no say in that. A LOCATION is a
statement about which build, and the repository does.

A `command:` in the policy overrides resolution entirely. It must be an
absolute path, refused at parse time otherwise, because a bare name would
be resolved against PATH, which is what resolution already does
(src/policy.ts:309-315). A configured command that is not a file THROWS
rather than falling back, because the user named one specific file and
running something else would run a different tool than the one they asked
for (src/resolve.ts:216-222). A configured `.js` file without the
executable bit is run through this same Node, which is what its shebang
asks for (src/resolve.ts:234-244).

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
(`versionProbeFor`, src/resolve.ts:167-188, driven from the candidate
table's `versionSafe` field at src/resolve.ts:89-102).

THIS IS BELT AND BRACES AGAINST A CLASS OF BUG, NOT A LIVE HAZARD, and
the difference matters to anyone deciding whether the fallback still
earns its keep. No published version under the names this file resolves
has the bug: the fix is the commit v1.2.0 points at, only 1.2.0 and 1.2.1
were ever published under these names, and the releases that had it were
the pre-rename packages the resolver already refuses to resolve at all
(the comment at src/resolve.ts:92-97 says which, and
tests/resolve.test.ts:130 pins the refusal). An earlier draft of this file
said the fix was merged upstream but unpublished, which had stopped being
true; the source comment at src/resolve.ts:27-42 is the corrected one.

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

## The policy file is a passthrough, and the reserved list is the only exception

Gates are keyed by the ROLE they fill, and the product filling it is a
field inside (src/policy.ts:41-45, and the shipped schema). A product
rename or a swap is then a one-line edit rather than a rename of the key a
repository wrote its CI around. A policy that puts a product in a role it
does not fill is rejected at parse time, because the failure mode of
accepting it is confusing rather than loud: the secrets section of the
report would carry dependency findings (`PRODUCT_FOR_ROLE`,
src/policy.ts:90-94, enforced at src/policy.ts:291-296).

There is deliberately no shared severity threshold. Two of the three
products share a four-level scale; the third scores a weighted rubric from
0 to 100 and has no per-finding severity at all. A top-level `failOn`
would read as one decision and mean three different things, so the schema
refuses it outright rather than ignoring it. Each gate keeps its own
threshold in its own `options` block, spelled the way that gate spells it.

`options` keys are the gate's own long-flag names with the dashes
stripped, and this package never maps, renames or interprets one
(`renderOptionFlags`, src/policy.ts:425-445). `true` renders as `--key`,
`false` as `--no-key` (commander's own convention, and the one negation
rendering that is right without knowing the flag), a scalar as `--key
value`, and an array as one pair per entry. Keys are sorted, so two policy
files differing only in key order produce the same command line and a
diffable report. That passthrough is what keeps the umbrella from growing
a second, drifting copy of three CLIs, and it is why a gate can gain a
flag without this package needing a release.

Pinned by tests/policy.test.ts:36 (keyed by role), 121 (a product in the
wrong role is rejected), 131 (a top-level `failOn` is refused outright),
161 (each threshold stays in its own block), 170 (the four renderings:
`--key`, `--no-key`, `--key value`, and a scalar), 177 (an array renders
once per value), 181 (key order does not change the command line) and 187
(a key spelled with its dashes is rejected).

The one exception is `RESERVED_OPTIONS` (src/policy.ts:102-113): the
handful of keys the umbrella writes itself are refused, because two
writers of one flag is a fight the user would have to debug from a stack
trace. Pinned by tests/policy.test.ts:196.

Three keys are reserved for a different reason and each gets its own
message, because a rejection that gives the wrong reason sends somebody
looking in the command line for a flag the umbrella never writes, finding
nothing, and concluding the rejection is a bug in this tool
(`reservedReason`, src/policy.ts:224-251):

- `base` on the intent gate, because the umbrella computes the change set
  itself and passes `--paths`, and a `--base` inside the gate would be
  resolved against a `--project` that may be a temporary directory with
  no repository in it (src/policy.ts:225-232). Pinned by
  tests/policy.test.ts:211 and 231, the second of which asserts the
  message names `--paths`.
- `base` on the dependency gate, because the umbrella passes `--staged`
  and a policy-supplied base would fight it (src/policy.ts:233-239).
  Pinned by tests/policy.test.ts:258, which asserts the message names
  `--staged`.
- `format` on the secrets gate, because the umbrella writes that option
  under its SHORT name, `-f json` (src/policy.ts:240-246). Pinned by
  tests/policy.test.ts:244, which asserts the message names `-f`.

The last two were recorded here as the prose giving the wrong reason: the
generic sentence said "the umbrella passes that flag to this gate
itself", which is false of both. The code was the wrong one and both
messages have been rewritten.

THE PAIRING IS NOW HELD IN ONE DIRECTION BY DERIVATION AND IN THE OTHER
BY HAND, and which is which is the whole of the guarantee
(tests/policy.test.ts:286-358). `flagsWritten` calls `gateArgs`
(src/gate-runner.ts:151-190, exported for exactly this) over the four
shapes of run there are and collects every token starting with a dash. So
the DANGEROUS direction is derived: tests/policy.test.ts:338 asserts that
every flag `gateArgs` writes is in `RESERVED_OPTIONS`, and a flag added
to `gateArgs` and forgotten in the list turns that test red rather than
letting a policy file write the same flag a second time.

The other direction cannot be derived, because the three keys above are
reserved WITHOUT the umbrella writing them. Those are listed by hand in
`RESERVED_WITHOUT_WRITING` (tests/policy.test.ts:328-336) and held to
exactly those three by tests/policy.test.ts:347, so a fourth cannot be
added without somebody writing down why. That list is still hand
maintained, but it is three entries long rather than the whole table, it
is held against the derived set rather than restated beside it, and each
of its three has its own message test above.

## Stages are cumulative, and a gate the filter holds back is never resolved

`GATE_STAGES` is one ordered array and the order is the whole rule
(src/policy.ts:56). A gate runs at its own stage and at every later one,
so a run at `ci` runs everything enabled (`runsAtStage`,
src/policy.ts:76-78). Adding a fourth stopping point is an entry in that
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
(src/run.ts:147-159). Resolution is NOT hoisted out of the loop: each
surviving gate is resolved one at a time inside it, by `runGate`
(src/run.ts:221-229, resolving at src/gate-runner.ts:307). What the
filter guarantees is therefore about the gates it holds back, not about
the ones it keeps: A GATE THE FILTER HELD BACK NEVER REACHES RESOLUTION
OR SPAWN AT ALL, because it never enters the loop. A gate that will not
run at this stage must not be able to fail the run by being uninstalled
here, and an intent gate that lives only on the CI image is the ordinary
case rather than an error.

An earlier wording here said the partition happens "before any binary is
looked for", which is true of the filter and invites the reading that
resolution is hoisted. It is not, and a future change that moved
resolution above the loop would break exactly this rule while still
satisfying that sentence.

A deferred gate is recorded rather than dropped (`DeferredGate`,
src/run.ts:21-26). It is deliberately not a `GateOutcome`: no binary was
looked for, nothing was spawned, and there is no exit code to report. It
still has to be visible, or a run at `commit` reads exactly like a run
that checked everything.

Pinned by tests/policy.test.ts:361, 367, 373 and 379 (the cumulative rule
and the stage order); tests/run.test.ts:219, 224, 229 and 244 (which
gates run at each stage, and an explicit stage over the role default),
299 ("does not treat a deferred gate as a missing one", which runs with
an empty PATH and an empty repository root and still gets exit 0 and no
findings, so nothing was looked for), 268 ("never lets a deferred gate
reach the exit code"), and 367 (a disabled gate is not also reported as
deferred); and end to end by tests/cli.test.ts:170, 184, 196 and 221.

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
(`GatePolicy.excludedByCli`, src/policy.ts:130-141, set at
src/policy.ts:396-405 and initialised false at parse time,
src/policy.ts:328-330). Pinned by tests/policy.test.ts:406 (the gate
`--gate` switched off is marked and the named one is not), 419 (a gate the
file had already disabled is NOT marked, or the user's own decision is
read back to them as something the command line did) and 429 (nothing is
marked when there was no `--gate` at all).

It is carried on the run result as `ExcludedGate` (src/run.ts:28-42),
read off the POLICY rather than off the enabled list, because these gates
are exactly the ones the override took out of that list, and in role order
so the report never depends on the order the flags were typed
(src/run.ts:161-166). Like `DeferredGate` it is deliberately not a
`GateOutcome`: no binary was looked for and there is no exit code to
report. Pinned by tests/run.test.ts:320 (both excluded gates are carried,
with only the named one running), 338 (nothing excluded without `--gate`)
and 347, which is the one that matters: a `--gate` run gets the SAME exit
code a policy declaring only that gate would, so reporting the excluded
gates never gives them a vote. That test stubs an excluded gate that would
have blocked, so the two numbers would differ if any of this reached
`composeExitCode`.

Both formats say it. One line in the text report
(src/output-text.ts:239-244), a clause on the one-line summary of a clean
run (src/output-text.ts:462-465), and a `conductor/gate-excluded`
notification in the umbrella's SARIF run
(src/output-sarif.ts:468-476). A notification rather than a result by the
discriminator below: nothing went wrong, and how much of the policy a run
covered is a statement about the run. Pinned by
tests/output-text.test.ts:732 (the full report names them and says
`--gate`), 745 (the clean run's single line still names them) and 754
(silence on a run that had no `--gate`, verbose or not); and by
tests/output-sarif.test.ts:146 (a notification and not a result, at note
level, naming the role and the flag) and 168.

## The hook: one hook, one command, one exit code

`conductor init` writes exactly one pre-commit hook, and it runs the
umbrella once rather than three gates (src/init.ts:222-303). It runs
`conductor run --staged --stage commit`, not every stage: a pre-commit
hook IS the commit stopping point, and running the intent gate's ceremony
there is what makes a team switch the hook off.

The exit code is passed through unchanged (src/init.ts:302). The hook
written the natural way, `if conductor run; then exit 0; fi; exit 1`,
collapses 2 into 1 and so reports findings that were never looked for.
There is one message per code and not one message for both
(src/init.ts:289-298), because calling exit 2 a blocked commit describes a
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
(src/cli.ts:114-116, src/init.ts:623-629, README.md:24).

The hook is written with the executable bit set after the write rather
than through the write's mode option, because an existing file keeps its
own mode when written through and git will not run a hook it cannot
execute (src/init.ts:893-899).

Pinned by tests/init.test.ts:235 (one hook, running the umbrella and not
three gates), 246 (`--stage commit` is in the hook text), 1095 and 1274
(a real commit through husky 9's dispatcher and through husky 8, not a
fixture), 1409 to 1507 (fail closed), 1524 (`sh -e`: the explanation
survives, which is the half `-e` destroys), 1546 (the exit code passed
through: a stub conductor exits 2 and the hook exits 2), 1563 (a clean
run commits), 1590 to 1640 (one message per code, each taken by running
the generated script against a stub rather than by reading the template)
and 1642 (no bypass advertised in either the native or the husky hook).

## What init refuses to touch

Five refusals, each returning early with a conflict and writing nothing:

A foreign hook is never replaced (src/init.ts:780-785). That hook is
somebody's working setup and init has no standing to have an opinion about
it. A whitespace-only file is treated as absent rather than foreign
(src/init.ts:780), pinned by tests/init.test.ts:972. The refusal itself
is pinned by tests/init.test.ts:902.

Another gate's own pre-commit hook is reported and left alone unless
`--adopt` is passed (src/init.ts:786-800). Adding the umbrella's hook
alongside it would run that gate twice and report its findings twice.
`--adopt` replaces it and stores the original in the manifest so revert can
put it back. Pinned by tests/init.test.ts:927, a parameterised case over
all three gates' own hooks, and by 945 and 960 for the adopt-and-restore
pair. `--adopt` never touches a FOREIGN hook, pinned by
tests/init.test.ts:914.

A hook generated by lefthook or by the pre-commit framework is left alone
and the user is told the stanza to add to that manager's own config
(src/init.ts:693-704, guidance at 191-204). Those managers rewrite the
file on every install, so anything written there is lost without a word,
and the guidance says out loud that the manager owns the commit's exit
code so the umbrella's 1 and 2 do not survive it. Recognition is by
strings captured from real installs, kept as fixtures under
tests/fixtures/hooks, and the code comment records honestly that the
`lefthook_version:` alternative recognises nothing any live version writes
and is kept only because a spare alternative in an OR cannot cause a false
negative (src/init.ts:165-179).

The BEHAVIOURAL pin is tests/init.test.ts:1366, a parameterised case that
writes each captured file into a real repository, runs init, and asserts
the conflict, the manager it was classified as, and that nothing was
written. That is the test to keep. Two others beside it assert only what
is IN the captured text, that lefthook's real hooks carry `call_lefthook`
and never `lefthook_version:` (tests/init.test.ts:1389) and that the
pre-commit framework's marker line is character for character the string
init.ts looks for (tests/init.test.ts:1401). Those two are worth having,
because they are what would catch an upstream rewording, but neither one
runs init, so neither is evidence about what init does with the file.
The pair at tests/init.test.ts:1323 and 1342 exercise the same refusal
against HAND-WRITTEN approximations, which proves only that the code
agrees with whoever wrote the approximation.

A `core.hooksPath` pointing outside the repository is refused
(src/init.ts:663-674). Writing there would install this repository's hook
on every repository on the machine. Pinned by tests/init.test.ts:1012.

An existing policy file is never rewritten (src/init.ts:834-842). It is
the one artifact a user edits by hand. Pinned by tests/init.test.ts:379.

One resolution rule underneath all of these: a RELATIVE `core.hooksPath`
resolves against the WORKING-TREE ROOT, not against the `.git` directory
(src/init.ts:444-450). A sibling tool resolved it against the `.git`
directory and the test covering the case asserted the same wrong location,
so the two agreed with each other and neither was ever checked against
git. The test here drives a real commit instead
(tests/init.test.ts:982).

## The husky rule is structural, and content is never a signal

Where git looks and where the hook a human maintains lives are not always
the same file. husky 9 sets `core.hooksPath` to `.husky/_`, a generated
and gitignored directory it rewrites on every install, and the file git
executes there is a dispatcher that execs the TRACKED hook one directory
up.

The recognition rule is the SHAPE of the path and nothing else: the hooks
directory is named `_` and its parent is named `.husky`, both halves
required (`huskyDirectoryFor`, src/init.ts:140-149). Only husky creates
that path. The tracked target is that `.husky` directory's own
`pre-commit`, never a computed parent of whatever directory git happens to
point at (src/init.ts:707).

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
never TESTED against (src/init.ts:151-154 and 806-819).

The husky redirect is decided before the generated-hook detection runs
(src/init.ts:690-693), so a husky dispatcher is never misread as
lefthook's or the pre-commit framework's.

Pinned by tests/init.test.ts:1042 (the tracked hook, not the dispatcher,
decides what is there), 1055 and 1080 (adopts the tracked hook, leaves
the dispatcher alone, restores byte for byte), 1095 (a real commit
through the dispatcher), 1129 (survives the reinstall that rewrites the
generated directory), 1151 (redirects on the path alone with no shim),
1175 (redirects after a clean), 1189 (survives the install that
repopulates a wiped generated directory), 1214 (does not redirect out of
a generated directory that is not husky's), 1242, 1255 and 1274 (husky 8
takes the native path, and a real commit proves it), and 1296 (a
dispatcher-shaped hook sitting in the ORDINARY hooks directory is foreign
rather than a reason to write somewhere else).

## The digest ladder: the marker says whose, the digest says which version

A hook carrying the umbrella's marker used to end the matter, and that was
a bug with a long fuse: a hook an OLDER conductor wrote carries the same
marker, so it was skipped for ever. It kept running that version's command
line after the hook text changed, and it never entered the new manifest,
so a later `--revert` walked past it and left it behind.

So the marker settles WHOSE hook this is, and the digest decides the rest
(src/init.ts:718-779), in four rungs:

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

Pinned by tests/init.test.ts:436, 453, 475, 542, 560, 569, 588, 609, 622,
635 (no manifest at all treated the same way) and 1669 to 1727, which
drive the upgrade using the captured previous hook body in
tests/fixtures/hooks, with tests/init.test.ts:1696 guarding the fixture
against drifting into being what init writes today, which would make
every assertion in that block pass for the wrong reason.

## The manifest is what makes revert honest

Without a record, "undo the init" means guessing which files were the
tool's, and a tool that guesses about deletion in somebody's repository
has to be wrong only once.

The manifest records each file's path, its sha256 and its KIND
(src/init.ts:383-398). The kind is recorded rather than inferred from the
path, because revert's whole decision turns on whether the HOOK survived
and sniffing that from a filename is a guess.

A rewrite carries forward everything a previous manifest held that this
run did not rewrite (src/init.ts:913-924). An upgrade rewrites the hook
and nothing else, so a manifest built purely from this run's writes would
forget the policy file it wrote last time. It also carries forward the
adopted hook, and that one matters more: the manifest is the ONLY copy of
the gate hook `--adopt` replaced, so forgetting it makes that hook
unrestorable (src/init.ts:876-887).

Pinned by the tests that actually OPEN the manifest and read the fields
this section is about: tests/init.test.ts:453 (the hook entry's kind and
sha256 are the new hook's, and not the old digest still sitting there),
542 (a lost manifest is rebuilt with a hook entry carrying the digest of
the file on disk), 487 (the policy entry survives an upgrade that
rewrote only the hook) and 498 (the adopted hook survives one). The
restore side is pinned by tests/init.test.ts:834, which reads
`adopted.content` back out after a partial revert.

Not by tests/init.test.ts:258, which this file used to cite first. That
test inits and then reverts and asserts the hook file is gone; it never
opens the manifest, so it is evidence that the round trip works and no
evidence at all about what the manifest records. It is the clearest
example in this file of a citation that reads right from the test title
and proves something adjacent to the claim beside it.

## What revert guarantees

Revert removes exactly what init wrote and nothing else. Four rules, and
all four were bugs here first.

IF THE HOOK SURVIVES, NOTHING IS REMOVED. Files are classified first and
acted on second (src/init.ts:1012-1021), and a hook that has changed
since init wrote it returns before the removal loop is ever entered
(src/init.ts:1023-1046), because deciding as it went is what let the old
version remove the policy file before discovering it could not remove the
hook. Removing the policy file while leaving an edited hook in place
leaves that hook running the umbrella with nothing to read, so every
commit afterwards is refused with exit 2, while revert reported success.

Pinned in BOTH directions now. tests/init.test.ts:750 asserts the policy
file and the hook are both still there, which is the specific pair that
caused the incident. tests/init.test.ts:765 asserts the guarantee itself
rather than a list of paths: no action on the result is a `remove` and
every one is a `skip`, so a file added to what init writes is covered
without anybody remembering to come back to this test.

A CHANGED FILE IS LEFT ALONE AND REPORTED (src/init.ts:1060-1068). That
file is now the user's whatever it started as, and a revert that deletes
edited work is a revert nobody runs twice. Pinned by
tests/init.test.ts:723 (an edited policy file survives and the run is not
a success) and 797 (the conflict says `changed-since-init` and names
`--force`).

THE MANIFEST OUTLIVES A PARTIAL REVERT (src/init.ts:1097-1134). It is
deleted only once it holds nothing, because it is the only record of what
is left and, after an `--adopt`, the only copy of the replaced hook. The
`.guardrails` directory goes with it only when it is empty, using
`rmdirSync` rather than `rmSync`, and when it is not empty that is
REPORTED rather than passed over (src/init.ts:1097-1119). Pinned by
tests/init.test.ts:783 (the manifest survives and still holds entries),
680 (the directory goes with the last file), 692 (it stays, and is
reported as skipped, when somebody else's file is in it) and 713 (it is
reported as removed when it went).

A PARTIAL REVERT IS NOT A SUCCESS. It returns `ok: false`, so the exit
code is non-zero and a script does not read "some of it" as "all of it"
(src/cli.ts:150), and the human rendering goes to stderr rather than
stdout so a pipe cannot carry it past the reader who needed it
(src/cli.ts:144-149).

AN ADOPTED HOOK IS NOT WRITTEN BACK WHILE THE UMBRELLA HOOK SURVIVES, or
the user ends up with two hooks at one path and the edit they asked to
keep is gone. Pinned by tests/init.test.ts:851, which edits the umbrella
hook after an `--adopt`, reverts, and asserts the file on disk is still
the edit and that no action on the result is a `restore`. The positive
half, that the gate's own hook does come back once the umbrella hook is
gone, is pinned at tests/init.test.ts:870 (under `--force`), 883 (the
hook deleted by hand, on a revert too partial to finish) and 908 (without
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
more (src/init.ts:1109-1114). That is a statement about what is there,
which is what the rule is about, so a future refactor of the early return
cannot restore a hook next to a surviving one. The flag is gone rather
than kept as a second line, because two conditions that must agree are a
place for them to disagree.

No manifest shape with an adoption and no hook entry is reachable from
init's own writes, which is what makes the removal safe. Init sets
`adopted` in exactly two ways (src/init.ts:881-888): the run that adopts,
which pushes the hook it writes into the same manifest, and the carry
across a re-init, which keeps a previous manifest's entries that this run
did not rewrite. Revert's own rewrite (src/init.ts:1153) can only drop
the hook entry on a pass that also nulls `adopted`. A hand-edited
manifest could hold that shape, and there the code does what the old flag
did: nothing is restored.

No manifest at all means nothing is removed and the command fails
(src/init.ts:998-1009). Pinned by tests/init.test.ts:920.

A manifest that will not parse is a SECOND conflict rather than the same
one (src/init.ts:1017-1031). Revert deliberately does not go through
`readManifest`, which answers null for both: missing means there is no
record to act on, unreadable means there is a record and it cannot be
trusted, and the two send a reader to different fixes. Nothing is removed
and nothing is guessed either way. Pinned by tests/init.test.ts:926,
which corrupts the manifest of a real install and asserts the reason is
`manifest-unreadable`, that the guidance says nothing was removed and
sends the user to the file by hand, and that the hook, the policy file and
the manifest itself are all still exactly as they were.

End to end by tests/dogfood.e2e.test.ts:330 and 348, which revert a real
repository with a hand-edited policy file and then finish the job under
`--force`. The ordinary case, that revert removes what init wrote and
leaves an unrelated file alone, is tests/init.test.ts:666, and the second
`--force` revert that cleans up after a refused one is
tests/init.test.ts:808.

## Intent at pull request time: nothing is ever written under the repository's own .conductor

The intent gate refuses to check anything against a contract nobody
approved, and approving one is a per-task human step. That step is the
ceremony the stopping-points design exists to keep out of a pull request,
so the umbrella imports the document the work was actually approved from,
freezes it in a TEMPORARY directory, and points the gate at that directory
for the length of one run (src/intent-prepare.ts:334-341).

Nothing is written under the repository's own `.conductor`. A contract is
a committed artifact with an approver's name on it. A pull-request run
that dropped one into the working tree would either be committed by
accident or picked up by the next run as though a person had approved it,
and the second failure is silent. Pinned by
tests/intent-prepare.test.ts:246, which asserts the repository has no
`.conductor` directory afterwards.

The freeze is attributed to the umbrella and to a commit, never to a
person, and the spec path in that attribution is repository-relative
because the string ends up inside a contract (src/intent-prepare.ts:363-368).
Pinned by tests/intent-prepare.test.ts:271.

The temporary directory is always removed. Every failure path after the
directory exists calls `cleanup` before returning
(src/intent-prepare.ts:338-385), and the success path is removed by the
caller's `finally` once every gate has run, whatever happened while they
did (src/run.ts:231-240). The failure half is pinned by
tests/intent-prepare.test.ts:376, which counts directories carrying
`TEMP_PREFIX` in the system temporary directory before and after.

THE SUCCESS HALF IS PINNED AT tests/intent-run.test.ts:151, which drives a
full passing run through the import and freeze chain and counts entries
carrying `TEMP_PREFIX` either side, the same way the failure test does.
It asserts the run really did import a contract before it counts, so it
cannot pass on a directory that was never created. Nothing in the code
changed: removing the `cleanup()` call from the `finally` in src/run.ts
turns that one test red and leaves every other test in the file green,
which is what makes it the thing holding the rule.

The cost of being wrong is one leaked directory per pull request on a
shared CI runner, with nothing in any report pointing at the cause. Note
that tests/intent-prepare.test.ts:291 does NOT cover this: it only proves
that calling `cleanup` yourself works.

## The repository's own frozen contract wins, and "frozen" means one specific thing

Where a team has done the native flow, the native flow is what runs. The
import is the fallback for a repository that has not, never a replacement
for one that has (src/intent-prepare.ts:208-217).

"Exists" is not the test. `frozen_by: user` and nothing else, because that
is the marker THE GATE ITSELF reads
(`nativeContractIsFrozen`, src/intent-prepare.ts:101-113). Accepting an
`approval` block as an alternative was a guess dressed up as tolerance: a
real freeze writes both, so the only contracts the second test admitted
were hand-edited or half-written ones, and admitting those skipped the
import and then let the gate block every pull request with "exists but is
not frozen by user". A file that will not parse is treated as not frozen,
which sends the run down the import path rather than handing the gate
something it will reject.

An explicit `--spec` outranks even a frozen native contract
(src/intent-prepare.ts:209-212, where the `flag` branch is taken before
`nativeContractIsFrozen` is ever called), because a person typed it just
now.

The native-contract rule is pinned by tests/intent-prepare.test.ts:143,
153, 159, 169 and 187. THE `--spec` PRECEDENCE IS PINNED BY
tests/intent-prepare.test.ts:220 and 231, which build one repository
holding both a `frozen_by: user` native contract and a spec, pass the
spec by flag, and assert the reported source is the imported spec and
that the gate is handed a temporary directory rather than `.`, with
`import-spec` and `freeze` both recorded as having run. Note that the
native tests above have a DISCOVERED spec beside the contract, which is
the opposite rule; and tests/intent-spec.test.ts:246 covers `--spec`
beating a pull request body, a different question in a different file.
Neither covers this.

The branch order at src/intent-prepare.ts:209-212 is still the mechanism.
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
kindness (src/intent-spec.ts:269-275, reported at
src/intent-prepare.ts:198-206).

A `Spec:` line in the pull request body comes next, anchored to the start
of a line so a sentence containing the words in prose is not read as
somebody naming a file, and the FIRST such line wins when a body carries
two (src/intent-spec.ts:103-106). A path here that does not exist falls
through to the convention, because a typo in a pull request description
must not be able to fail a build.

The convention is a markdown file DIRECTLY under `docs/superpowers/specs`
whose stem relates to the branch slug. Directly under, not nested, because
that is the layout the gate's own importer discovers and an archive
subdirectory is not a candidate for this branch's contract
(src/intent-spec.ts:131-141).

Candidacy and victory are different questions. `stemMatches` decides who
is a candidate; `bestMatch` decides who wins, ranking an exact stem first,
then the most specific stem by length, and only then the newest filename
(src/intent-spec.ts:169-188). Ranking on the newest name alone answered
the second question with the first: a loose candidate carrying a later
date beat the spec whose stem was the branch slug exactly, and an undated
name beat everything because it sorts after every date. A pull request was
then measured against a different feature's requirements with nothing in
the report saying so.

A plan is paired only on an EQUAL stem (src/intent-spec.ts:204-211). No
plan is a fine outcome, since the gate imports a spec on its own; the
wrong plan freezes one feature's requirements against another's change
budget, and the resulting block or pass is about neither of them.

Pinned by tests/intent-spec.test.ts:137 and 149 (the convention, and the
plan paired by the same stem rule), 161, 175 and 193 (the ranking: the
newest name only among equally good candidates, an exact stem beating a
newer looser one, and an undated name not winning by sorting last), 206
and 216 (the most specific match, and no plan rather than another
feature's), 230 and 246 (a `Spec:` line beating the convention, and
`--spec` beating the `Spec:` line), 263 (a `Spec:` path that is not there
falls through), 401 (a `--spec` path that is not there is reported
instead), and 419, 425, 431 and 440 (nothing matches, no directory, a
nested spec, a non-markdown file), with 446 for a plan paired to a spec
that came from the pull request body.

## Containment applies to the pull request body and to nothing else

A path named in a pull request body must RESOLVE inside the repository
(`resolvesInsideRoot`, src/intent-spec.ts:252-265). That body is written
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

`--spec` is deliberately NOT held to any of this. A person typed it on the
command line just now, and pointing at a spec kept outside the checkout is
a real thing to want (src/intent-spec.ts:269-275 goes straight to
`exists`).

Pinned by tests/intent-spec.test.ts:295, 312, 324, 332, 354, 375 and 392.

## A branch with no spec is advisory, and never changes the exit code

A `SkippedGate` is not a deferred gate, not a could-not-run, and not a
finding (src/run.ts:54-59 and 198-206). Nobody asked for a different
stage, nothing broke, and a branch that has no spec is a branch this gate
has no opinion about. Turning that into a failed build is how a gate gets
switched off repository-wide.

It never reaches the exit code, enforced or not, because a skipped gate
produces no `GateOutcome` and `composeExitCode` only ever sees outcomes.
It is still on screen: one line in the text report
(src/output-text.ts:225-229), one notification in the SARIF log
(src/output-sarif.ts:518-525), and a distinct verdict sentence when it is
the only thing that happened (src/output-text.ts:295-301), because telling
somebody to set `enabled: true` is the wrong advice for a gate that is
already on and had nothing to check.

The contract source is decided BEFORE git is touched
(src/intent-prepare.ts:182-196). That ordering is the promise: resolving
the base ref first would turn a shallow checkout into exit 2 on a
repository the gate was never going to check anything in.

Pinned by tests/intent-run.test.ts:219, 233, 237, 241 and 268, and
tests/intent-prepare.test.ts:305 and 314 ("never runs git, so a shallow
checkout cannot turn a missing spec into a failure").

## The change set is the umbrella's own, and each flag is a decision

The umbrella computes what the branch changed rather than handing the gate
its own `--base`, because `--base` inside the gate resolves git relative
to `--project`, which may be a temporary directory with no repository in
it (`changedPathsSince`, src/intent-base.ts:76-107).

Three flags, each one a decision. `-c core.quotePath=false`, or git
escapes any byte outside ASCII and wraps the line in quotes, handing the
gate a path that matches no glob and no file on disk. `--no-renames`, so a
rename lists BOTH its old and its new path, since moving a file out of a
protected directory still has to block and cannot if only the destination
is listed. And the three-dot range, which asks what the branch changed
since it forked rather than how it differs from the base branch right now.
A two-dot diff attributes every commit that landed on the base branch
after this branch forked to this branch, so somebody else's merge breaches
this pull request's change budget.

Output is split on newlines and NOTHING else (src/intent-base.ts:131).
Trimming each line was corrupting a filename with leading or trailing
whitespace into a different filename, which is worse than refusing it: the
gate would then check a path that does not exist and never check the one
that changed.

A prepared run replaces `--staged` entirely rather than adding to it
(src/gate-runner.ts:169-187), because the two path sources are ADDITIVE in
the gate, so leaving `--staged` on would silently widen a pull request's
change set with whatever happens to be in the index of the machine running
it. `--paths` is passed even when the branch changed nothing, so the empty
set is stated rather than left for the gate to fill in from the index.

`GITHUB_BASE_REF` is a branch name and not a ref anything local can
resolve, so it is prefixed with `origin/`; Actions defines it and leaves
it EMPTY outside a pull request, so an empty value has to mean "no pull
request" rather than "origin/", which would fail every push build closed
(src/intent-base.ts:38-50). The branch name comes from `GITHUB_HEAD_REF`
first, because a pull request build is on a detached head and git answers
"HEAD" there, matching no spec at all (src/intent-base.ts:60-74).

The environment is INJECTED into `runAll` and defaults to EMPTY rather
than to `process.env` (src/run.ts:99-111 for why, src/run.ts:168 for the
default itself). Without that, running this package's own suite inside a
pull request build would put every gate into the pull-request flow,
because Actions sets `GITHUB_BASE_REF` for the whole job.

Pinned by tests/intent-base.test.ts:57, 64, 71, 78 and 82 (the base ref,
including the empty `GITHUB_BASE_REF` a push build sets), 91 (the
three-dot range: what landed on the base afterwards is not listed), 110
(both sides of a rename), and 121 and 135 (the quotePath decision, and
that an ordinary space survives it); and
tests/intent-run.test.ts:150 (the branch diff rather than the index), 179
(the base taken from the pull request environment), 372 ("is never read
unless the caller passes it in") and 400.

## Reporting: a statement about coverage is a notification, a statement that something went wrong is a result

This is the discriminator, and it is written here because it has now been
taken four times and should decide the fifth case itself.

A statement about HOW MUCH OF THE POLICY A RUN COVERED is a NOTIFICATION.
It is true of the configuration rather than of this change, identical on
every run until somebody edits the policy file, and on the adoption ramp
deliberately true for weeks. A permanent alert is a dismissed alert, and
it teaches the reader to dismiss the next one. Four cases live here:
`conductor/gate-deferred` (src/output-sarif.ts:448-456),
`conductor/gate-excluded` (src/output-sarif.ts:468-476), the per-product
`no-contract` advisory (src/output-sarif.ts:518-525), and
`conductor/gate-not-enforced` (src/output-sarif.ts:553-586), all of them
collected at src/output-sarif.ts:640-645 and written into
`invocations[0].toolExecutionNotifications` on the umbrella's run
(src/output-sarif.ts:382-395 and 651-662). As results they were
fingerprint-less note alerts that reappeared on every run, so a repository
on the adoption ramp accrued permanent alerts about this tool's own
configuration.

A statement that SOMETHING WENT WRONG is a RESULT. It is about this run,
it goes away when somebody fixes it, and a reviewer of this change is the
person who should see it. `conductor/gate-missing`,
`conductor/gate-failed` and `conductor/gate-output-unparseable` stay
results, because a gate that could not run means a class of problem went
unlooked-for on this change. So do the umbrella's own normalization
diagnostics (src/output-sarif.ts:411-431), because a disagreement between
the umbrella's report and the gate's own verdict is a defect in this run
rather than a property of anybody's configuration.

The text report answers the same question the same way, and the two must
keep agreeing. `isFullyClean` (src/output-text.ts:405-416) forces the full
report when the umbrella has a diagnostic and does NOT force it for a
gate's own note, for exactly this reason: the standing note that pnpm
lockfiles do not record install-script metadata is a permanent property of
that file format, true on every run forever.

The notification descriptor id keeps the id the statement was filed under
when it was a result, so a consumer that had rules for these still
recognises them, and the descriptors are declared beside the rules so the
reference resolves rather than dangling (src/output-sarif.ts:315-328,
declared at 330-335 and attached at 376-378). Level is always `note`; a
notification arriving as a warning would push these straight back into
the alert list they were moved out of.

Pinned by tests/output-sarif.test.ts:139 (gate-deferred moved out of
results and into the notifications), 146 (gate-excluded, the same way),
168 (nothing said about exclusion when there was no `--gate`), 177
(gate-not-enforced), 186 (the no-contract advisory, keeping the GATE'S
own namespace on its descriptor id), 193 (that advisory at note level),
207 (the message text unchanged in the move), 214 and 251 (gate-missing
and gate-failed staying results, in both directions), 282 (the
notification objects are shaped as SARIF 2.1.0 wants, every level is
`note`, and the descriptor ids are declared on the driver), 920 (a
normalization diagnostic as a note-level result carrying blocking: false
and no location) and 951 (naming the gate it came from). The remaining
result id, `conductor/gate-output-unparseable`, is pinned end to end by
tests/cli.test.ts:141, which runs the CLI over a gate whose output has
drifted and finds that id among the umbrella run's RESULTS.

In the text report, pinned by tests/output-text.test.ts:369 and 377 (an
umbrella diagnostic forces the full report and is not counted as a note)
and 293, which is the other half and was uncited here: two of a gate's
OWN notes leave the run clean, are counted rather than printed, and do
not force the full report.

A naming disagreement used to live here, and the shape of it is worth
keeping even though it is gone. Two source comments and the README all
named this diagnostic `conductor/blocking-mismatch`, and nothing had ever
emitted that string; the codes the code emits are
`conductor/blocking-count-mismatch` and
`conductor/blocking-threshold-unknown` (src/normalize.ts:26-27). Worse,
two tests built fixtures using the phantom name and then looked for what
they had just constructed, so the phantom had a green test beside it.
The phantom is now gone from the code, the README and the fixtures, and
BOTH codes are pinned at the normalizer, which is the only place either
is minted: tests/normalize.test.ts:49 drives the count-mismatch branch by
tampering with the gate's reported count, and tests/normalize.test.ts:62
drives the `threshold === null` branch (src/normalize.ts:110-121) by
deleting `run.failOn`, asserting the emitted code and that nothing is
left marked blocking.

## The clean-run summary line, and what it may not swallow

A fully clean run prints one line rather than a screenful
(`summaryLine`, src/output-text.ts:439-498, reached at
src/output-text.ts:501-503). Twelve lines of per-gate detail on a commit
that found nothing is a cost paid on every commit, and it is what makes a
team switch a hook off.

The predicate is not simply the exit code (`isFullyClean`,
src/output-text.ts:405-416). Three extra conditions, and each one exists
because collapsing it would swallow the only report anybody sees. A gate
with `enforce: false` is left out of the composed code, so a run where
such a gate blocked or could not run still exits 0. An umbrella
diagnostic forces the full report. And a run where no gate ran at all is
not clean whatever the exit code says: "none is enabled", "every gate was
deferred" and "nothing had a contract to check" are three distinct states
with three distinct verdict sentences, and a summary line naming no gates
would be the exact confusion this family exists to prevent.

Pinned by tests/output-text.test.ts:250, 261 and 268 (one line, none of
the per-gate detail, and how to see the rest), 272 (`--verbose` prints
the full report anyway), 389 (an unenforced gate that blocked forces the
full report even though the run exits 0), 401 (so does one that could not
run), 369 (so does an umbrella diagnostic) and 422 (a run where no gate
ran at all). The half that must NOT force it, a gate's own note, is
pinned at tests/output-text.test.ts:293.

What the one line still has to carry: which gates ran, which were deferred
to a later stage, which had nothing to check, which the command line left
out, which could not have blocked because they are unenforced, a count of
non-blocking findings, a count of the gates' own notes, and how to see the
rest. Pinned by tests/output-text.test.ts:255, 278, 293, 325, 345 and 745.

`--verbose` is a command-line flag rather than a policy key
(`TextOptions`, src/output-text.ts:365-374), because the schema describes
what a repository gates on and how loud one developer's terminal is is
not that.

SARIF IS UNAFFECTED BY IT. `renderSarif` takes no verbosity argument at
all (src/output-sarif.ts:595), and the format branch in the CLI passes the
flag only to `renderText` (src/cli.ts:227-230). Pinned by
tests/cli.test.ts:254, 266 and 274, and by
tests/output-sarif.test.ts:523, which asserts the log is byte for byte
what it was before the summary line existed, against a literal written
out by hand rather than against whatever the renderer currently produces.

## SARIF says only what it can support

One run per gate, in gate order. SARIF puts the tool name and version on
the run, so a single run cannot honestly describe three tools
(src/output-sarif.ts:598-624).

A gate that never ran gets NO run. The tempting alternative is an empty
run named for the missing product, which puts that tool's name on
something it never did. The umbrella's own findings about it go into a
final run whose driver is the umbrella, the only honest owner of a
statement about a tool that is not installed
(src/output-sarif.ts:598-604 for the skip and 633-662 for the run).

No invented version. A gate whose version could not be read gets no
`version` field rather than a placeholder (src/output-sarif.ts:368-372).

`%SRCROOT%` is attached only to a path genuinely under the source root
(`placeArtifact`, src/output-sarif.ts:133-173). An absolute path is
positive evidence the file is NOT under the root, since one of the gates
keeps a path absolute exactly when the file is outside the directory it
scanned; stripping the leading slash fabricates a source-root-relative
path pointing at a different file, or at none, and `%SRCROOT%` then
vouches for it. Those get a `file:` uri with no `uriBaseId`. A path still
carrying a `..` segment after normalizing gets NO physical location at
all, and the raw path is kept in the properties bag instead. The
normalizing is real rather than a prefix test, so `a/../../b` is caught
too.

No invented region. Only the secret gate reports a line and a column, and
even there no `endColumn` (src/output-sarif.ts:222-228 and
src/normalize.ts:284-291).

The reason is narrower than this file used to state it, and the narrower
version is the useful one. That gate DOES know the match length: it
hashes it into its own fingerprint and puts an end column in its own
SARIF. What it omits is `matchLength` on the match object in the JSON
output, which is the one channel the umbrella reads. So the end of the
match is unknown FROM THIS CHANNEL rather than unknown to the product,
which makes it a fixable upstream ask (carry `matchLength` on the match)
rather than a permanent limitation of the finding. Until it is carried it
is not guessed, and the renderer already emits `endColumn` when the
envelope has one (src/output-sarif.ts:226-228), so the day the field
arrives the only change needed is in the normalizer.

`partialFingerprints` carries each product's own fingerprint unhashed,
under a key naming the product and a version
(src/output-sarif.ts:110-112 and 279-281). Hashing it together with
anything would mint a second identity for every finding, one that moves
when the first does not, and every alert would resurface on the next scan.
The key is versioned so a future change to a product's fingerprint inputs
ships as a `/v2` and a consumer can tell the two apart rather than
silently comparing hashes of different things.

`properties.blocking` is the gate's decision as reconciled in
src/normalize.ts and is never recomputed in the renderer
(src/output-sarif.ts:268). A second copy of the gate living in the
renderer would drift silently.

`executionSuccessful` is written whenever the umbrella's run is written,
in both directions (`Invocation`, src/output-sarif.ts:344-355, emitted
unconditionally at src/output-sarif.ts:387 and computed at
src/output-sarif.ts:658). Emitting it alongside the notifications made
the field present when the answer was true and absent when it was false,
which is the one direction that matters.

Enforcement is recorded in two places and neither is redundant:
`properties.enforced` on the gate's own run, emitted for enforced gates
too so an absent property never has to be read as either answer
(src/output-sarif.ts:615-623), and a notification in the umbrella's run,
which is the only place left to say it for a gate that could not run and
so has no run of its own (src/output-sarif.ts:553-586). What is
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
  from that gate: tests/output-sarif.test.ts:558 and 566.
- A gate that never ran gets no run: tests/output-sarif.test.ts:857,
  1049 (which also asserts the gate-missing result is still there), 1090
  (a deferred gate), 1116 (no umbrella run when there is nothing to say)
  and 1123 (a gate that ran and found nothing still gets one).
- No invented version: tests/output-sarif.test.ts:573.
- `%SRCROOT%` placement: tests/output-sarif.test.ts:747 (backslashes and
  a leading dot-slash), 764 (an absolute path, posix and Windows, gets a
  `file:` uri and no `uriBaseId`), 791 (an escaping path loses its
  physical location and is kept in `unresolvablePaths`), 813 (one that
  escapes only after the segments cancel), 825 (an inner `..` that stays
  inside), and 839 (a secret finding loses its location entirely rather
  than keeping a region over no file). `placeArtifact` is also exercised
  directly, one rule at a time, at tests/output-sarif.test.ts:1141 to
  1203.
- No invented region: tests/output-sarif.test.ts:708 (a real position
  becomes a region with the 1-based column), 719 (no `startLine` anywhere
  for a finding with no known line), 724 (a path list gets one location
  each and no region) and 738 (a drift finding gets a logical location
  and no file). The absent `endColumn` is pinned at the normalizer,
  tests/normalize.test.ts:170.
- `partialFingerprints`: tests/output-sarif.test.ts:657 (keyed by product,
  value unhashed), 666 (stability recorded beside it), 672 (omitted
  entirely when the product mints none) and 1207 (the `/v1` key).
- `properties.blocking` never recomputed: tests/output-sarif.test.ts:619,
  which is the discriminating fixture and the one that matters. Every
  other fixture in that file has blocking agreeing with severity, so a
  renderer that derived blocking from the level would pass all of them;
  this one renders a BLOCKING finding at note level and asserts both. The
  wholesale properties assertion at tests/output-sarif.test.ts:641 cannot
  stand for this claim on its own, which is exactly the gap that let the
  regression through before 619 was written.
- `executionSuccessful` in both directions: tests/output-sarif.test.ts:465
  (false, with no notification to hang it on, which is the case that
  produced no invocation at all before), 476 (true when every gate ran),
  314 (false for a gate that could not run) and 492 (a gate's run gets no
  invocation of its own).
- Enforcement recorded twice, results untouched:
  tests/output-sarif.test.ts:1015 (present on both an enforced and an
  unenforced run), 1025 (the stage beside it), 1035 (the notification),
  1049 (still said for a gate with no run of its own), 970 (an unenforced
  gate's results keep their own level) and 982 (a gate that could not run
  keeps an error-level, critical result).

## Blocking is reconstructed, checked against the gate, and the gate wins

Neither dep-guard nor vault-guard marks findings individually. Each
reports the threshold it used and a count of findings at or above it. So
the per-finding flag is RECONSTRUCTED from that threshold on that gate's
own ladder and then CHECKED against that count
(`reconcileBlocking`, src/normalize.ts:103-140).

When the two disagree, every flag drops to false and a diagnostic says
why. The umbrella reporting "blocking" about a finding the tool that
blocks commits disagrees with is the failure the rule exists to prevent.
Nothing about the composed exit code depends on this field either way;
that comes from the child's own exit code, which is the only number the
gate actually decided.

The threshold is read from `run.blocking_matches` for the secret gate and
never from a summary count, because that gate's own documentation says an
integrator gating a build must read the former and that the latter ignores
the threshold. A sibling tool in this family read the summary, and that is
the bug not to copy (src/normalize.ts:232-236 and 324-330).

The intent gate is different in kind and is handled separately: it has no
threshold, so a budget violation is blocking because the gate raises one
reason per violation and blocks on having any reason at all, and a drift
finding is blocking exactly when the OVERALL action blocks, since the gate
raises one reason for the score and none per finding
(src/normalize.ts:439-476 for the budget half and 478-526 for the drift
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
count with what they reported (src/output-text.ts:329-348).

Pinned by tests/output-text.test.ts:639 and 651, one for each branch of
`reconcileBlocking`, both of which assert the precondition first (the
normalizer marked nothing blocking and raised exactly one diagnostic) and
then that the verdict carries no "0 blocking finding(s)" and does say
which gate exited non-zero. The unenforced aside survives on that verdict
too, tests/output-text.test.ts:663.

Pinned by tests/normalize.test.ts:44 (the reconstructed flags agree with
the count and no diagnostic is raised), 49 (a tampered count makes every
flag drop to false and raises the diagnostic), 62 (the same for a missing
threshold), 184 (the threshold is read from `run.blocking_matches`: with
that count set to 0 the finding is not blocking, while `summary.secrets`
still says 1), 236 (every budget violation blocks), 273 (a drift finding
whose overall action is "proceed" does not) and 419 (a blocked gate never
reports zero blocking findings).

## Nothing invents a position, a fingerprint, or a severity

Severity is carried by identity where the product's ladder is the shared
one and `severityIsDerived` is false; it is the umbrella's own invention
for the intent gate, which has no per-finding severity at all, and
`severityIsDerived` is true there for every finding
(src/envelope.ts:16-23; identity at src/normalize.ts:173-176; the
umbrella's own two ladders for the intent gate at src/normalize.ts:369-386,
marked derived at src/normalize.ts:463, 508 and 548). An unrecognised level
from the secret gate lands on `info` and is marked derived, so a
downstream consumer never sees a level outside the union
(src/normalize.ts:257-270). The text report marks a derived severity with
a trailing asterisk and explains the asterisk only when one is on screen
(src/output-text.ts:48 and 529-531).

Fingerprints are carried verbatim and namespaced by product; nothing is
hashed together with anything else, because a new digest would match no
existing baseline file and would silently invalidate every one in the wild
(src/envelope.ts:25-32). `stability` records what the value is actually
worth: `stable` survives edits elsewhere in the file, `positional` does
not, `none` means there is no id to keep. Where a product mints no
fingerprint, the field is null and no `partialFingerprints` object is
emitted, rather than an invented id no baseline anywhere contains
(src/normalize.ts:552-554).

The umbrella's OWN findings are the one thing it fingerprints, and the
digest is over the rule, the role and the product and deliberately NOT
over the message (src/normalize.ts:647-654), so a repeat run is the same
alert rather than a new one every commit and a reworded detail is not a
new problem. Pinned by tests/normalize.test.ts:458, which asserts two
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
off-by-one in this tool (src/normalize.ts:283 for the conversion and 315
for the key).

Pinned by tests/normalize.test.ts:38 (severity by identity, not derived),
204 (an unrecognised level lands on info AND is marked derived), 82 (a
package subject rather than a fabricated file position), 240 (a path list
rather than an invented line number), 90, 176 and 247 (the three
fingerprint stabilities carried verbatim), 147 and 162 (the 1-based
subject column and the 0-based one kept under its own key, with the bag
asserted NOT to carry a plain `column`), 170 (no `endColumn`), 230 (the
intent gate's derived severity and that every one of its findings says
so) and 458 (the umbrella's own deterministic fingerprint).

## No stack trace reaches a terminal or a report

An error's message, never its stack (`messageOf`,
src/gate-runner.ts:229-241; src/normalize.ts:708-731; src/cli.ts:249-259
and 276-280). A stack
reaching the terminal puts a local filesystem path in front of a user who
cannot act on any of it, and puts one into a report that gets uploaded.
The message is the part that says what went wrong.

Pinned by tests/cli.test.ts:77, 95, 109, 120 and 130, and by
tests/run.test.ts:102, which walks the whole outcome object looking for a
stack frame.

## The child's working directory is the repository root

Not a style choice, and it came from running the tools rather than from
reading them. One of the three gates resolves both its config file and its
baseline from the process working directory rather than from its path
argument, so a child spawned from anywhere else scans the right files with
the wrong configuration and the wrong baseline, and says nothing about it.
The other two resolve from their own arguments, so setting the working
directory correctly is the single approach that is right for all three
(src/gate-runner.ts:353-358).

The umbrella anchors everything at the working-tree root as reported by
git, so a run from a subdirectory behaves exactly like a run from the top
(src/cli.ts:32-45).

The child working directory is pinned by tests/gate-runner.test.ts:87.
THE SUBDIRECTORY ANCHORING IS PINNED AT tests/cli.test.ts:393, which runs
the built CLI from `packages/app` two levels inside a repository and
asserts it exits 0, never prints the run-init message, names all three
gates in the report, and writes a report byte for byte identical to the
same run from the top. The equivalent rule inside the generated hook is
pinned at tests/init.test.ts:1487, which runs the hook from `packages/app`
and proves it still finds `node_modules/.bin` at the root.

That test has to put git back on the PATH itself, and the reason is worth
recording. `repoRoot` falls back to the working directory when git cannot
answer (src/cli.ts:42-44), and tests/cli.test.ts replaces PATH wholesale
so the gates resolve to stubs, which takes git away from the spawned CLI
too. Everywhere else in that file the fallback is invisible, because the
working directory IS the root. Underneath the root it is the whole
question, so without the shim the test would have failed for the wrong
reason and a fix would have been made to the wrong thing.

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
CONTENTS from the token and path rules but never its NAME, since the name
is visible on a public file tree either way, and never the dash rule. And
the machine-path pattern requires exactly two segments under any of four
roots, the same rule for all four, after an earlier version used two for
home directories and one for temporary ones and so flagged prose that
merely named a root.

Pinned by scripts/tests/check-public-hygiene.test.mjs, twenty-two cases,
including the mechanism itself against an injected test-only blocklist
(line 193), the compound-word extraction (329, 337, 346), the allowlist
asymmetry (285, 320), and the URL that must not be read as a filesystem
path (156).

Three honest limits. The blocklist is hashes, so nobody can audit its
COVERAGE from inside this repository; only that the mechanism works.
The guard reads `git ls-files`, so the untracked design notes in the
working tree are out of scope by construction, which is correct while they
stay untracked and silently wrong the moment one is added. And there is no
tracked pre-commit hook in this repository running it, so the only
enforcement is CI and whoever remembers to run `pnpm lint` before pushing.

## Things that look like invariants and are not

Recorded so a future audit does not spend time proving them.

Gates run SEQUENTIALLY (src/run.ts:172-230). That is a legibility decision
rather than a rule: interleaved stderr from three gates is unreadable
exactly when a commit has just been refused. It is explicitly flagged in
the source as the obvious thing to revisit with a measurement, and nothing
depends on the ordering.

The per-gate timeout is 120 seconds (src/gate-runner.ts:302) and the child
output buffer is 64MB (src/gate-runner.ts:357). Both are values, not
rules; the only invariant near them is that a timeout lands in the
could-not-run path rather than being read as a clean exit.

`report.format` in the policy file is a default that `--format` overrides
(src/cli.ts:214). There is no rule about which one a repository should
choose.

The `dist/` directory and `schema/` are the published files
(package.json:18-21). The schema ships because a user should be able to
point an editor at it, and because the published contract should be a
thing on disk that can be diffed between releases; that is a reason, not
an invariant anything else depends on.
