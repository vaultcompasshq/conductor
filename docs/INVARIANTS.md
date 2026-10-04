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
rather than silent: rewriting a tracked lockfile to `{}` makes osv-scanner
exit 128, which is reported as `conductor/lockfiles-empty` naming the file
and treated as clean.

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

## The exit code is composed, not maximised

Three codes and nothing else. 0 means every enabled gate ran and none
blocked. 1 means every enabled gate ran and at least one blocked. 2 means
an enabled gate could not run, so nothing in the report is a clean result.
2 outranks 1 and 1 outranks 0, and the composition is written as two
ordered predicates rather than as an arithmetic maximum
(`composeExitCode`, src/exit-codes.ts:76-85).

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
it is treated as could-not-run (src/gate-runner.ts:1347-1365 for an exit
outside the product's clean and blocked codes, 1414-1435 for unparseable
output). So the composed code can differ from the maximum of the children's,
deliberately.

Which child exits are verdicts is per product since 0.5.0, read from the
profile (`profile.exit`, src/products.ts; applied at
src/gate-runner.ts:1316-1365). The three family gates keep exactly the old
reading, clean 0 and blocked 1, anything else could-not-run. gitleaks is
handed `--exit-code 3`, so its 3 is blocked and its 1, which it also uses
for errors, is could-not-run. osv-scanner's 128 ("no package sources
found") is clean with a `conductor/nothing-to-scan` diagnostic and outcome
exit code 0, so it never reaches the composition as non-zero; the same
outcome is produced without spawning it when the repository tracks no
lockfile (see "External gates"). And a clean
gitleaks exit whose stderr carries an `ERR` log line is could-not-run
(src/gate-runner.ts:1367-1391), because gitleaks 8.30.1 reports a git
failure as exit 0 with an empty report.

The per-finding `blocking` flag can only ADD to the answer, never subtract
from it: the second predicate is `(gate.exitCode ?? 0) !== 0 ||
gate.hasBlockingFinding` (src/exit-codes.ts:77). A gate that exited
non-zero produces a non-zero composed code whatever the umbrella made of
its output. The flag exists only so a gate whose exit code somehow said
clean while its own report carried a blocking finding still fails the run.

Pinned by the twelve cases in tests/exit-codes.test.ts, of which the ones
that matter are tests/exit-codes.test.ts:43 ("does not take the numeric
maximum of the children codes"), 34 ("lets could-not-run outrank a
blocking gate rather than the other way round") and 22 ("is 1 when a gate
reported a blocking finding even if its exit code did not"). The first of
those has a single gate that exited 1 and is could-not-run, so the answer
is 2 where the maximum would be 1. The wiring from a real run into that
function is tests/run.test.ts:159 ("composes to 2, not to 1"), which
drives a gate whose output has drifted shape and asserts the composed code
is 2 and not 1.

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
decides to ignore it. The umbrella reads a line somebody wrote in their
own policy file, and the line changes exactly one number.

Two consequences are worth stating because they look like bugs:

A run can exit 0 with BLOCKING on the screen above it. The text verdict
therefore carries the reason on the same line rather than leaving it to
the sections: the clauses are built in `unenforcedClauses`
(src/output-text.ts:394-415) and appended to the exit 0 verdict at
src/output-text.ts:690-699, with the same clauses carried as an aside on
the exit 1 and exit 2 verdicts (src/output-text.ts:629-633, 644, 678 and 683).

An unenforced gate that could not run still produces a critical,
error-level RESULT in the SARIF log, not a note. `conductor/gate-missing`
and `conductor/gate-failed` keep their severity and their result standing
whatever the policy says about enforcement (src/normalize.ts:1219 for the
severity, src/output-sarif.ts:136-142 for the level, and 1015-1020 for the
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
to arrive at that number (src/output-text.ts:1008-1013). `header`
(src/output-text.ts:57-68) is the per-gate line under that inventory, not
the count. The verdict counts only enforced gates, because it answers what
failed the run (src/output-text.ts:569-575). Two questions, two numbers.

Pinned by tests/exit-codes.test.ts:52, 58, 66 and 75;
tests/output-text.test.ts:473, 481, 488 and 493 (an unenforced gate that
blocked: the findings and their BLOCKING marker survive, the header is
marked, and the verdict does not claim none blocked), 520, 525 and 532
(an unenforced gate that could not run is loud, is not exit 2, and is not
also called a gate that blocked), 563, 576 and 584 (only enforced gates
are named as the reason and counted), and especially 604 ("lets the
header count everything on screen while the verdict counts what failed",
which asserts the header says 3 findings while the verdict says 2 across
1 gate); tests/cli.test.ts:483, 499, 529 and 543, end to end through the
CLI; and tests/output-sarif.test.ts:1015, 1027, 1060, 1080 and 1094.

## A gate that could not run is a result, never a note

Eleven reasons, enumerated as a union so a new one cannot be spelled freely
(`CouldNotRunReason`, src/gate-runner.ts:58-105; the last three, `gate-version-unsupported`,
`report-missing` and `history-shallow`, came after the description below was
written): a missing binary, a
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
for the three family gates), or does not exit normally at all because it was
killed or timed out, is could-not-run (src/gate-runner.ts:1347-1365). A gate
that exits 1 with stdout that will not parse as JSON is could-not-run
(the `normalizeUnparseableGate` return in `spawnAndRead`, src/gate-runner.ts). Reporting the second as a policy violation
would tell a user their code is at fault when their config is.

What the gate itself said rides along on the could-not-run result as
`couldNotRun.gateSaid`: the first non-empty stderr line, or for a gate whose
output is JSON on stdout a string `reason` field, sanitised to ASCII and cut
to 160 characters. It is read after the exit code has been judged, never
changes the outcome or the exit code, and its absence is not an error. Pinned
by tests/gate-runner.test.ts ("carries the first stderr line of an exit 2
gate as a bounded, sanitised excerpt"), tests/gate-runner.test.ts ("falls back to a reason field in
stdout JSON when stderr is empty, and never changes the exit 2") and tests/gate-runner.test.ts
("carries no excerpt, and does not throw, when an exit 2 gate printed nothing
usable"). The excerpt is also written to the job log on stderr in the per-gate
log line, cleaned and capped.

Pinned by tests/gate-runner.test.ts ("treats exit 2 as could-not-run
rather than as a policy violation") and tests/gate-runner.test.ts ("treats exit 1 with
unparseable stdout as could-not-run, the rejected-config shape"), and end
to end by tests/run.test.ts:245 ("is visible as an umbrella finding, so it
reaches the published format too") and 538 ("reaches
gate-output-unparseable too, which is the same reader problem"), and by
tests/cli.test.ts:122 ("prints no stack frames when a gate exits with its
could-not-run code"), which asserts the CLI exits 2.

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
(src/run.ts:479-568), so an escaping error does not merely lose one gate's
report, it loses every gate after it. What still escapes `runGate` is one
line on stderr and exit 2 (`fail` in src/cli.ts:465-468, reached from the
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
(`parseStage`, src/cli.ts:443-451). Both directions of the quiet failure look like
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
in `main` and printed as one line with exit 2 (src/cli.ts:776-792), so
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
  silently raises the other. As of 0.8.1 they hold the same numbers for all
  three gates (intent-guard 1.8.1, vault-guard 1.9.1, dep-guard 0.10.1); a
  later tag that ships a newer gate raises the TAG constants and need not
  raise the floor.
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
with `GITHUB_BASE_REF` unset. There are 66 such pins: the registry count of
2026-10-04 (13 conductor versions below 0.8.0, 12 dep-guard below 0.10.0, 27
vault-guard below 1.9.0 and 10 intent-guard below 1.8.0) plus the one version
each that the 0.8.0 constants named and the 0.8.1 constants sit one patch
above, giving 14, 13, 28 and 11. Because every constant now ends in patch 1,
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
PARSED INTO A RUN in that mode, which is the whole of the fix. It is read
for exactly two things, and neither can change what happens: a comparison
so the difference can be reported, and, when the ref itself cannot be used,
an inventory of gate names so the report can say which gates did not run.

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
bypass it, so a differing policy is one line and the run continues under
the base ref's rules (`POLICY_PROPOSAL_LINE` in src/trust-base.ts). The
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
`collectProposals`, src/run.ts:113-119 and 401-415). Nothing there reaches a
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
(`refusedTrustBase`, src/run.ts:348-391). TWO THINGS THERE ARE DELIBERATELY
NOT READ OFF THE POLICY, because the policy in hand is the head's:
`enforce` is forced true on every synthesized outcome, since enforcement is
itself a control input living in the file that could not be read; and the
exit code is WRITTEN rather than composed, since a head policy enabling no
gate at all would compose to 0 over an empty list and report a run that
checked nothing as a clean one.

AND THE REFUSAL IS CARRIED ON THE RESULT, so both renderers lead with it
before any question about how many gates there are (`RunTrustBase.refusal`,
src/run.ts:128-147). That is not tidiness. The gate list on a refused run is
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
(`refusalLines`, src/output-text.ts:428-437, and the branch at the top of
`verdict`, src/output-text.ts:552-566); and in SARIF it earns the umbrella
run unconditionally and raises `conductor/trust-base-refused` at ERROR level
(`trustBaseRefusedNotifications`, src/output-sarif.ts:772-787, with the
unconditional clause at src/output-sarif.ts:985-989).

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
from src/gate-runner.ts:947 and, for the intent gate's preparation, from
src/run.ts:409-423): a program OUTSIDE the working tree is
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
probe RUNS the program (called at src/gate-runner.ts:980, after the check at
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
src/gate-runner.ts:873-874 from whether a trust base is set). The answer would
be the same refusal every time, and that was the defect: correct, and it
turned every ordinary pull request in a repository whose gates are
devDependencies into three refusals and exit 2. The paragraph above still
states the rule, because the rule is what makes the skip safe rather than a
weakening: the skip removes a location whose every answer was "refused",
and it removes nothing the check would have accepted.

BOTH PULL-REQUEST-MODE REFUSALS ARE ENFORCED WHATEVER THE POLICY SAYS
(src/gate-runner.ts:443 for a refused program, src/gate-runner.ts:1036 for an
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
`gateProgramRefused` (src/gate-runner.ts:433-456) and returned by both the places
that can refuse one, `runGate` and the intent gate's preparation. An
unverifiable VERSION (src/gate-runner.ts:1036). And an intent PREPARATION that
failed under a trust base (src/run.ts:454), which arrived with the
preparation check above: a pull-request run whose intent gate could not be
prepared is one where nothing judged the intent, and reading the flag there
let a base policy carrying `enforce: false` report the failure and still exit
0. The fourth is the whole-run one: `refusedTrustBase` synthesizes every
enabled gate as could-not-run with `enforce` forced true (src/run.ts:314),
because the policy in hand there is the HEAD's and `enforce` is itself a
control input living in the file that could not be read. All four are the
same reasoning applied at two scopes, which is why the miscount keeps
happening: the gate that could not be judged, and the run that could not be
judged. Nothing else reads a gate's output and decides to ignore the policy.

THE PASS-DOWN IS CAPABILITY-GATED PER GATE (`TRUST_BASE_MIN_VERSION` and
`decideTrustBase`, src/gate-runner.ts:203-266, decided after the
version probe and before the command line is built at
src/gate-runner.ts:1014).
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
decision, because the floor check at src/gate-runner.ts:982-1006 returns
`gate-version-unsupported` first. It stays a TABLE: a new role can arrive
without an entry, and the "no pull-request mode yet" branch is what keeps
that gate from being handed a flag it would reject.
That branch is unreachable by any gate this package knows today and is kept
for the next one, which is the honest description of it.

FOR A PRODUCT IN THE TABLE, AN UNREADABLE VERSION IS COULD-NOT-RUN, not a
downgrade (src/gate-runner.ts:248-256). A gate in the table is one this
repository expects to be inside the boundary, and a probe that fails leaves
that unestablished for an unexplained reason; running it anyway would put it
quietly outside the boundary on exactly the runs where something is already
wrong. For a product outside the table nothing is unknown and the withheld
line stands. The two are separate for that reason and not for symmetry.

WITHHOLDING IS NEVER SILENT. A gate that was not handed the base ref gets a
line in the full report, a clause on the clean one-line summary, and a
`conductor/trust-base-not-passed` notification (`withheldTrustBase` and
`trustBaseLines` in src/output-text.ts, and
`trustBaseWithheldNotifications` in src/output-sarif.ts).

Both new SARIF statements are NOTIFICATIONS by the discriminator further
down this file, and neither is a close call once that rule is applied. A
proposed control change is a statement about configuration: nothing went
wrong, it did not take effect, and it stays true of every push to the
branch until it merges, so as a result it would be a fingerprint-less alert
reappearing on every run. A gate that was not handed the base ref is a
coverage statement in the same shape.

Pinned at four levels. The decisions: tests/trust-base.test.ts, against real
git repositories rather than a mock. The capability gate:
tests/gate-runner.test.ts, under "deciding whether a gate can be put into
pull-request mode" and "the trust base on the command line and on the
outcome". The run:
tests/run.test.ts:585-651 (the refusal, including that a head policy of
all-unenforced or of no enabled gate still exits 2) and 693-877. The CLI,
against a real repository whose feature commit rewrites the policy to point
the secrets gate at a script it adds: tests/cli.test.ts:1622-1644, where the
marker file appears without `--trust-base` and does not appear with it. End
to end against the real gates, tests/dogfood.e2e.test.ts:461-647. The
proposal notifications are pinned separately at
tests/output-sarif.test.ts:1877-1986, and the `Self-approval refused:` reason
at tests/normalize.test.ts:898-966.

The three additions of the fix round are pinned separately, because each of
them is a way the mechanism above was true and the REPORT of it was not:

- The refusal as its own outcome: tests/output-text.test.ts:1598 ("says
  exit 2 and the reason when the inventory names no gate at all"), 1607
  ("carries the fetch-depth remedy, which is the fix in nine cases out of
  ten"), 1611 ("leads with the refusal rather than burying it under the gate
  sections"), 1623 ("still names the gates the inventory did hold") and 1639
  ("never prints the clean one-line summary for a refusal"), and
  tests/output-sarif.test.ts:2013 ("writes the umbrella run even when there
  is no gate and no finding"), 2022 ("carries a conductor/trust-base-refused
  notification naming the ref"), 2035 ("raises it at error level, unlike
  every other notification here"), 2047 ("says the analysis did not
  complete"), 2053 ("keeps the could-not-run results for whatever gates the
  inventory named") and 2067 ("says nothing of the kind on a run that was
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
  outcome"), with the summed proposal at tests/run.test.ts:736 ("sums a
  proposal raised by the secrets gate alongside the intent gate own") and
  the real gate at tests/dogfood.e2e.test.ts:855 ("takes the config from
  the base ref and reports the secret anyway") and 863 ("reports the muting
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
all four control changes are reported as proposed, and the run blocks on the
secret, the dependency and the self-approval. It runs twice, once against the
sibling builds through `command:` and once against whatever is on PATH, and
the PATH half skips loudly when a binary is below its floor.

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
src/resolve.ts:208-233; decided at src/gate-runner.ts:873-874). The version
probe takes the same skip (src/resolve.ts:251-257) because a probe RUNS the
binary, and so does the intent gate's preparation (src/run.ts:228-240), which
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
spawns anything (src/run.ts:409-423), through the same
`refuseHeadControlledBinary` and the same `gateProgramRefused` builder
`runGate` uses, and a preparation that FAILED under a trust base is enforced
(src/run.ts:454). Pinned by tests/intent-run.test.ts:771 (the head-rewritten
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
(src/gate-runner.ts:401-416) and a refusal on either is the same outcome.
Pinned by tests/gate-runner.test.ts ("refuses when the head rewrote the
sibling the probe would run") and tests/gate-runner.test.ts ("runs as usual
when the branch left that sibling alone"), where the program a base policy
names is unchanged and the sibling the probe would run is not.

THE SKIP IS NEVER SILENT, by the same rule that makes a withheld trust base
never silent: one `conductor/node-modules-skipped` notification per run at
NOTE level (`nodeModulesSkippedNotifications`, src/output-sarif.ts:880-901)
and one line in the full text report (`nodeModulesSkippedLine`,
src/output-text.ts:345-359), each naming every gate and the repository
relative path it declined. ONE FOR THE RUN, not one per gate: it is a
statement about the run's mode, and in the shape it happens in most, gates
installed as devDependencies and nothing else, it is true of all three at
once. A gate with nothing on PATH either is could-not-run under the
EXISTING `binary-missing` reason, with a sentence naming `npm install -g`
and that product's own action input appended (`missingGateRemedy`,
src/gate-runner.ts:754-778). A new reason would have been wrong: nothing
was found, which is what `binary-missing` has always meant. The install
sentence comes from the product's profile (`remedy`, src/products.ts), and
it differs by kind: a family gate's names `npm install -g` and, on a
pull-request run, its action input. The install sentence is returned on a
local run too (`missingGateRemedy` calls `profile.remedy(false)` whenever
`skipNodeModules` is false, src/gate-runner.ts:766-770, and
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
and the composed test's PATH variant, tests/dogfood.e2e.test.ts:1210
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
cli.ts (src/cli.ts:423), immediately after `refuseTrustBaseRef` has already
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
(src/run.ts:446-463, called from `runAll` at src/run.ts:467) partitions the
gates a stage and a `--gate` flag already left in: every gate whose profile
says `readsHistory` is kept and spawned with its ORDINARY arguments -- for
gitleaks that already means `--log-opts <base>..HEAD` (`gateArgs`,
src/gate-runner.ts:600-624), which is the range that still holds whatever was
committed and backed out even though neither tree shows it -- and every other
enabled gate is recorded in a new `RunResult.treeUnchanged` list instead of
being spawned at all. `treeUnchanged` is false, and the split is a no-op,
outside this one shape.

`TreeUnchangedGate` (src/run.ts) is deliberately the same shape as
`DeferredGate` and `ExcludedGate`, and for the same reason those two are not a
`GateOutcome`: no binary was looked for, nothing was spawned, and there is no
exit code to report. It is reported the same way those two are, at all three
levels: one line in the full text report (`treeUnchangedLines`,
src/output-text.ts:300-305, folded into the aside alongside deferred,
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
at action.yml:432-436). Modelled on the backward-pin rule earlier in the same
step: the same event test, `GITHUB_BASE_REF` non-empty, declared in the
step's own `env:` mapping from `github.base_ref` so it cannot come from the
workflow file; and the same scope, `pull_request` and `pull_request_target`
only, for the same reason the backward-pin rule is scoped there (a push to an
unprotected branch runs its own author's workflow file regardless, and
`merge_group` never sets `GITHUB_BASE_REF` at all). Off those events the
input works exactly as before, since that is what it exists for. Refused with
the value given and the fix, which is to remove the input: the action already
fetches the base commit and passes that commit id (`--trust-base "$TRUST_BASE_SHA"`, action.yml:1011). THE TWO EVENTS ARE
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
`policyForRun` in src/cli.ts:350-351 and read from `process.env` at
src/cli.ts:653). `GITHUB_BASE_REF` is Actions' own pull-request signal: the
base branch's NAME on `pull_request` and `pull_request_target`, empty
everywhere else. When it is set, the given `--trust-base` is accepted only
when it resolves to the SAME COMMIT as `origin/<githubBaseRef>`, which is
exactly the commit the composite action fetches into
`refs/conductor/trust-base` and then passes (`--trust-base "$TRUST_BASE_SHA"`,
action.yml:1011; an explicit `trust-base` input is passed only when it is
set, action.yml:993-994, and the validate step has already refused that
input on a pull request), so an ordinary pull-request run is unaffected. A ref naming the pull request's own branch,
or anything else that disagrees, is refused naming both refs and both
commits.

CHECKED BEFORE `refuseTrustBaseRef`, AND DELIBERATELY NARROWER THAN IT: this
check says nothing about HEAD or about tree equality, only about whether the
given ref agrees with the one Actions says this run must use
(`policyForRun`, src/cli.ts:350-351, `pullRequestRefusal ??
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
refuses it (src/cli.ts:336-338, the `trustBase === undefined` branch, which
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

- Conductor's own `--base <ref>` option (src/cli.ts:598-601) feeds only
  the intent gate: it becomes `RunOptions.base` (src/run.ts:215) and is
  passed straight through to `prepareIntent` (src/run.ts:506-514), which
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
(src/gate-runner.ts:493-640, exported for exactly this) over the six
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
(src/run.ts:296-307). The comment on that filter still says the partition
happens "before any binary is even looked for". That sentence is true of
the filter and invites the reading that resolution is hoisted. Resolution
is NOT hoisted out of the loop: each surviving gate is resolved one at a
time inside it, by `runGate` (the loop is src/run.ts:480-568, resolving at
src/gate-runner.ts:884). What the filter guarantees is therefore about the
gates it holds back, not about the ones it keeps: A GATE THE FILTER HELD
BACK NEVER REACHES RESOLUTION OR SPAWN AT ALL, because it never enters the
loop. A gate that will not run at this stage must not be able to fail the
run by being uninstalled here, and an intent gate that lives only on the
CI image is the ordinary case rather than an error.

A future change that moved resolution above the loop would break exactly
this rule while still satisfying the comment on the filter.

A deferred gate is recorded rather than dropped (`DeferredGate`,
src/run.ts:33-38). It is deliberately not a `GateOutcome`: no binary was
looked for, nothing was spawned, and there is no exit code to report. It
still has to be visible, or a run at `commit` reads exactly like a run
that checked everything.

Pinned by tests/policy.test.ts:541 ("runs a gate at its own stage"), tests/policy.test.ts:547 ("runs an earlier gate at every later stage"), tests/policy.test.ts:553 ("does not run a later gate at an earlier stage") and tests/policy.test.ts:559 ("names the three stages in order, earliest first"); tests/run.test.ts:310 ("still runs the commit gates at push, because stages are cumulative"), tests/run.test.ts:315 ("runs everything at ci, which is the last stage"), tests/run.test.ts:320 ("says which stage a deferred gate is waiting for") and tests/run.test.ts:330 ("honours an explicit stage over the role default in both directions"),
tests/run.test.ts:385 ("does not treat a deferred gate as a missing one"). That one runs with
an empty PATH and an empty repository root and still gets exit 0 and no
findings, so nothing was looked for. tests/run.test.ts:354 ("never lets a deferred gate reach the exit code, since it was not asked to run"), and tests/run.test.ts:453 ("leaves a disabled gate out of the deferred list rather than reporting it twice"); and end to end by tests/cli.test.ts:197 ("runs the commit gates and defers the intent gate at --stage commit"), tests/cli.test.ts:211 ("runs every gate at --stage ci"), tests/cli.test.ts:223 ("runs every gate with no --stage at all, exactly as v0.1 did") and tests/cli.test.ts:248 ("names the deferred gate in the SARIF log rather than dropping it").

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

It is carried on the run result as `ExcludedGate` (src/run.ts:39-53),
read off the POLICY rather than off the enabled list, because these gates
are exactly the ones the override took out of that list, and in role order
so the report never depends on the order the flags were typed
(src/run.ts:273-278). Like `DeferredGate` it is deliberately not a
`GateOutcome`: no binary was looked for and there is no exit code to
report. Pinned by tests/run.test.ts:320 (both excluded gates are carried,
with only the named one running), 338 (nothing excluded without `--gate`)
and 347, which is the one that matters: a `--gate` run gets the SAME exit
code a policy declaring only that gate would, so reporting the excluded
gates never gives them a vote. That test stubs an excluded gate that would
have blocked, so the two numbers would differ if any of this reached
`composeExitCode`.

Both formats say it. One line in the text report
(src/output-text.ts:284-289), a clause on the one-line summary of a clean
run (src/output-text.ts:872-874), and a `conductor/gate-excluded`
notification in the umbrella's SARIF run
(src/output-sarif.ts:602-609). A notification rather than a result by the
discriminator below: nothing went wrong, and how much of the policy a run
covered is a statement about the run. Pinned by
tests/output-text.test.ts:1207 ("names the excluded gates in the full report"), tests/output-text.test.ts:1220 ("names them on the one-line summary of a clean run too") and tests/output-text.test.ts:1229 ("reports exclusion as a zero count on the summary, and the full report stays silent"). The zero case still prints "0 gate(s) left out by --gate" on the summary; the full report with verbose stays silent. And by tests/output-sarif.test.ts:190 ("records a gate --gate excluded as a notification, beside the deferred ones").

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
(src/cli.ts:484-488, src/init-hook-detect.ts:415-421, README.md:119-120).

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
(src/cli.ts:553), and the human rendering goes to stderr rather than
stdout so a pipe cannot carry it past the reader who needed it
(src/cli.ts:545-552).

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
(src/cli.ts:538-541) and maps `ok` to the exit code as always.

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
did (src/run.ts:569-578). The failure half is pinned by
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
no-preparation run reports (`nativeContractOption`, src/run.ts:425-428,
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
report's contract line (src/output-text.ts:113-120) and one
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
the opposite rule; and tests/intent-spec.test.ts:246 covers `--spec`
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
kindness (src/intent-spec.ts:284-290, reported at
src/intent-prepare.ts:454-462).

A `Spec:` line in the pull request body comes next, anchored to the start
of a line so a sentence containing the words in prose is not read as
somebody naming a file, and the FIRST such line wins when a body carries
two (src/intent-spec.ts:118-121). A path here that does not exist falls
through to the convention, because a typo in a pull request description
must not be able to fail a build.

`Spec: none` in that same first line is the one value that does NOT fall
through. It is a WAIVER: a statement that this pull request deliberately
has no spec, answered with a `waived` discovery before the convention is
tried, because an explicit statement beats an inferred one
(src/intent-spec.ts:294-302, with the token itself at
src/intent-spec.ts:51-59). The token is exact and lowercase; anything else
unusable keeps the silent fall-through, so a sentence with "None" in it
cannot switch a gate off. The waiver sits BELOW `--spec` in this file and
below a frozen native contract in prepareIntent
(src/intent-prepare.ts:491-504, the branch after the native contract
rather than before it), which is the whole meaning of it: it says there is
nothing to import, never that a contract this repository froze should be
ignored.

The convention is a markdown file DIRECTLY under `docs/superpowers/specs`
whose stem relates to the branch slug. Directly under, not nested, because
that is the layout the gate's own importer discovers and an archive
subdirectory is not a candidate for this branch's contract
(src/intent-spec.ts:146-156).

Candidacy and victory are different questions. `stemMatches` decides who
is a candidate; `bestMatch` decides who wins, ranking an exact stem first,
then the most specific stem by length, and only then the newest filename
(src/intent-spec.ts:184-203). Ranking on the newest name alone answered
the second question with the first: a loose candidate carrying a later
date beat the spec whose stem was the branch slug exactly, and an undated
name beat everything because it sorts after every date. A pull request was
then measured against a different feature's requirements with nothing in
the report saying so.

A plan is paired only on an EQUAL stem (src/intent-spec.ts:219-226). No
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

The waiver is pinned by tests/intent-spec.test.ts:460 (it beats the
convention with a matching spec sitting on disk), 475 (it answers `waived`
rather than `none`, which is what lets the report tell the two apart), 483
(`--spec` still wins), 500 (`Spec: None` with a capital falls through to
the convention instead), and 518 (the first `Spec:` line decides, so a
later real path does not undo it).

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

Pinned by tests/intent-spec.test.ts:295, 312, 324, 332, 354, 375 and 392.

## A branch with no spec is advisory, and never changes the exit code

A `SkippedGate` is not a deferred gate, not a could-not-run, and not a
finding (src/run.ts:76-97). Nobody asked for a different
stage, nothing broke, and a branch that has no spec is a branch this gate
has no opinion about. Turning that into a failed build is how a gate gets
switched off repository-wide.

It never reaches the exit code, enforced or not, because a skipped gate
produces no `GateOutcome` and `composeExitCode` only ever sees outcomes.
It is still on screen: one line in the text report
(src/output-text.ts:231-236), one notification in the SARIF log
(src/output-sarif.ts:650-663), and a distinct verdict sentence when it is
the only thing that happened (src/output-text.ts:578-617), because telling
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
src/output-text.ts:253-274): the skipped line, the verdict sentence for a
run whose gate list is empty, and the clause on the one-line summary of a
clean run.

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
(src/gate-runner.ts:554-576), because the two path sources are ADDITIVE in
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
than to `process.env` (src/run.ts:226-235 for why, src/run.ts:469 for the
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
`conductor/gate-not-enforced` (src/output-sarif.ts:929-962), and
`intent-guard/legacy-state-dir` (src/output-sarif.ts:566-590), all of them
collected at src/output-sarif.ts:1022-1035 and written into
`invocations[0].toolExecutionNotifications` on the umbrella's run
(src/output-sarif.ts:475-482 and 1054-1078). As results they were
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
keep agreeing. `isFullyClean` (src/output-text.ts:788-799) forces the full
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

In the text report, pinned by tests/output-text.test.ts:396 and 404 (an
umbrella diagnostic forces the full report and is not counted as a note)
and 320, which is the other half and was uncited here: two of a gate's
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
(src/output-sarif.ts:1034). It never gains a severity, a fingerprint, or a
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

## The clean-run summary line, and what it may not swallow

A fully clean run prints one line rather than a screenful
(`summaryLine`, src/output-text.ts:822-952, reached at
src/output-text.ts:996-997, and NOT reached when the trust base was refused,
which is the one thing that outranks a clean run). Twelve lines of per-gate
detail on a commit
that found nothing is a cost paid on every commit, and it is what makes a
team switch a hook off.

The predicate is not simply the exit code (`isFullyClean`,
src/output-text.ts:788-799). Three extra conditions, and each one exists
because collapsing it would swallow the only report anybody sees. A gate
with `enforce: false` is left out of the composed code, so a run where
such a gate blocked or could not run still exits 0. An umbrella
diagnostic forces the full report. And a run where no gate ran at all is
not clean whatever the exit code says: "none is enabled", "every gate was
deferred" and "nothing had a contract to check" are three distinct states
with three distinct verdict sentences, and a summary line naming no gates
would be the exact confusion this family exists to prevent.

Pinned by tests/output-text.test.ts:277, 288 and 295 (one line, none of
the per-gate detail, and how to see the rest), 299 (`--verbose` prints
the full report anyway), 416 (an unenforced gate that blocked forces the
full report even though the run exits 0), 428 (so does one that could not
run), 396 (so does an umbrella diagnostic) and 449 (a run where no gate
ran at all). The half that must NOT force it, a gate's own note, is
pinned at tests/output-text.test.ts:320.

What the one line still has to carry: which gates ran, which were deferred
to a later stage, which had nothing to check, which the command line left
out, which could not have blocked because they are unenforced, a count of
non-blocking findings, a count of the gates' own notes, and how to see the
rest. Pinned by tests/output-text.test.ts:596 ("names the gates that ran"), tests/output-text.test.ts:619 ("names a gate the stage filter deferred, on the same line"), tests/output-text.test.ts:634 ("counts the gate own notes rather than hiding them or printing them all"), tests/output-text.test.ts:666 ("names a gate that ran but could not have blocked anything"), tests/output-text.test.ts:609 ("says how to see the detail"), tests/output-text.test.ts:1374 ("counts and names the gates that are not enforced") and tests/output-text.test.ts:1387 ("counts and names the gates the command line left out").

Three of those are suppression, and print as a count EVEN AT ZERO
(src/output-text.ts:872-874 for gates the command line left out, 894-897
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
tests/output-text.test.ts:1370 ("prints the not-enforced count even when it is zero") and tests/output-text.test.ts:1383 ("prints the excluded count even when it is zero"), tests/output-text.test.ts:1374 ("counts and names the gates that are not enforced") and tests/output-text.test.ts:1387 ("counts and names the gates the command line left out"), tests/output-text.test.ts:1393 ("sums the suppressed and ignored counts across gates, even at zero") and tests/output-text.test.ts:1397 ("adds the suppressed and ignored counts the gates reported"), and tests/output-text.test.ts:1410 ("drops the ignored total when a gate that ran reported no ignore count"). Zeroing any of the three counts turns its tests red.

`--verbose` is a command-line flag rather than a policy key
(`TextOptions`, src/output-text.ts:702-757), because the schema describes
what a repository gates on and how loud one developer's terminal is is
not that.

SARIF IS UNAFFECTED BY IT. `renderSarif` takes no verbosity argument at
all (src/output-sarif.ts:971), and the format branch in the CLI passes the
flag only to `renderText` (src/cli.ts:689-697). Pinned by
tests/cli.test.ts:276, 288 and 295, and by
tests/output-sarif.test.ts:526, which asserts the log is byte for byte
what it was before the summary line existed, against a literal written
out by hand rather than against whatever the renderer currently produces.

## SARIF says only what it can support

One run per gate, in gate order. SARIF puts the tool name and version on
the run, so a single run cannot honestly describe three tools
(src/output-sarif.ts:974-1006).

A gate that never ran gets NO run. The tempting alternative is an empty
run named for the missing product, which puts that tool's name on
something it never did. The umbrella's own findings about it go into a
final run whose driver is the umbrella, the only honest owner of a
statement about a tool that is not installed
(src/output-sarif.ts:978-980 for the skip and 1015-1078 for the run).

THE SAME RULE CURRENTLY CATCHES A GATE THAT RAN AND FAILED, and those are
two different things. A gate that exited 2 did run; the SARIF-native shape
for it is its own run with `invocations[0].executionSuccessful: false`,
and that is deliberately NOT done, because it changes the run list of
every log with a failing gate in it. The consequence is load-bearing
rather than cosmetic: `conductor/gate-failed` in the umbrella's run is
then the only place in the whole log that can say anything about the
failure, which is why that finding carries the failing child's own stderr
(`normalizeFailedGate`, src/normalize.ts:1394-1409, fed from
src/gate-runner.ts:1361). Before it did, a dogfood run against a
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
src/normalize.ts:1318-1339, fed from src/gate-runner.ts:1431, 1478 and the
backstop at 842). That
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

Pinned by tests/run.test.ts:418, 428, 442, 452 (the unparseable carry) and
472, by tests/output-sarif.test.ts:1306, 1314, 1322 and 1333, and by
tests/intent-prepare.test.ts:859 (the real error survives a notice line
ahead of it) and 879 (that stderr is capped too).

No invented version. A gate whose version could not be read gets no
`version` field rather than a placeholder (src/output-sarif.ts:459-462).

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
src/normalize.ts:883 and `StartColumn` at 888). When `StartColumn` is absent,
that line sets it to 1. gitleaks also carries
`endColumn` when the report has `EndColumn` (src/normalize.ts:889, written
into the region at src/output-sarif.ts:263-264). vault-guard's JSON has no
match length, so that gate's region has no `endColumn`
(src/normalize.ts:377-378).

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
src/output-sarif.ts:1075-1077). Emitting it alongside the notifications made
the field present when the answer was true and absent when it was false,
which is the one direction that matters.

Enforcement is recorded in two places and neither is redundant:
`properties.enforced` on the gate's own run, emitted for enforced gates
too so an absent property never has to be read as either answer
(src/output-sarif.ts:993), and a notification in the umbrella's run,
which is the only place left to say it for a gate that could not run and
so has no run of its own (src/output-sarif.ts:929-962). What is
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
Nothing about the composed exit code depends on this field either way;
that comes from the child's own exit code, which is the only number the
gate actually decided.

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
count with what they reported (src/output-text.ts:663-681).

Pinned by tests/output-text.test.ts:1079 ("does not print a blocking count when the threshold was never reported") and tests/output-text.test.ts:1091 ("does not print a blocking count when the gate own count and the umbrella count disagree"), one for each branch of
`reconcileBlocking`, both of which assert the precondition first (the
normalizer marked nothing blocking and raised exactly one diagnostic) and
then that the verdict carries no "0 blocking finding(s)" and does say
which gate exited non-zero. The unenforced aside survives on that verdict
too, tests/output-text.test.ts:1103 ("keeps the unenforced aside on that verdict").

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
(src/output-text.ts:49 and 1037-1039).

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
src/gate-runner.ts:733-738; src/normalize.ts:1318-1339; src/cli.ts:465-468
and 789-791). A stack
reaching the terminal puts a local filesystem path in front of a user who
cannot act on any of it, and puts one into a report that gets uploaded.
The message is the part that says what went wrong.

Pinned by tests/cli.test.ts:104 ("reports a drifted gate output as exit 2
with no stack frames"), 122 ("prints no stack frames when a gate exits with
its could-not-run code"), 136 ("prints no stack frames when a gate binary
is missing"), 147 ("prints a one-line message and no stack for a policy
file that will not parse") and 157 ("prints a one-line message and no stack
when there is no policy file at all"), and by tests/run.test.ts:188
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
(src/gate-runner.ts:1182 and 1264).

The umbrella anchors everything at the working-tree root as reported by
git, so a run from a subdirectory behaves exactly like a run from the top
(`repoRoot`, src/cli.ts:152-186). A relative `--output` is the one exception: it
resolves against the directory the command was typed in
(src/cli.ts:702-710), which is the conventional reading of a path a human
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
with, are four different sentences (src/cli.ts:152-186). It is called inside `run`'s own try, so each one
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

Gates run SEQUENTIALLY (src/run.ts:473-568). That is a legibility decision
rather than a rule: interleaved stderr from three gates is unreadable
exactly when a commit has just been refused. It is explicitly flagged in
the source as the obvious thing to revisit with a measurement, and nothing
depends on the ordering.

The per-gate timeout comes from the product's profile when the caller sets
none (src/gate-runner.ts:868): 120 seconds for the three family gates, as
before, 600 for gitleaks, whose full-history scan outlives two minutes on a
large repository, and 300 for osv-scanner (src/products.ts). The child
output buffer is 64MB (src/gate-runner.ts:1267). Both are values, not
rules; the only invariant near them is that a timeout lands in the
could-not-run path rather than being read as a clean exit.

`report.format` in the policy file is a default that `--format` overrides
(src/cli.ts:655). There is no rule about which one a repository should
choose.

The `dist/` directory and `schema/` are the published files
(package.json:18-21). The schema ships because a user should be able to
point an editor at it, and because the published contract should be a
thing on disk that can be diffed between releases; that is a reason, not
an invariant anything else depends on.

## The compact refusal body can never hide a gate result

`--compact-on-refusal` only takes the short branch in `renderText` when
`refusalLines(result)` is non-empty (src/output-text.ts:979-981), which is
exactly when `result.trustBase.refusal` is a non-null string
(`refusalLines`, src/output-text.ts:428-437, reading
`result.trustBase?.refusal`). There is exactly ONE place in the codebase
that ever sets that field to a non-null value: `refusedTrustBase`
(src/run.ts:348-391, the field itself at line 382). The only other place a
`RunResult`'s `trustBase` is built, src/cli.ts:414-425, always sets
`refusal: null`, which is why an ordinary policy run can never take the
compact branch no matter what `--compact-on-refusal` and `--verbose` say
together (pinned by the "does nothing to a run that was not refused" case
in tests/output-text.test.ts's compact-mode describe block).

That single writer is what makes the compact body safe to still call a
`RunResult` even though it never prints a gate section: every outcome
`refusedTrustBase` produces is synthesized through `preparationFailed`
(src/run.ts:313-315) rather than run, so a `RunResult` that reaches the
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
docs/design-notes.md, "Why a failed signature check must say so". Four rules
hold it shut, and each is pinned.

**The PATH write precedes the signature audit.** action.yml:647 writes the
install prefix to `GITHUB_PATH`; action.yml:673-674 is the audit. Ordered the
other way, a failing audit left the install unreachable and the NEXT step
reported a missing binary rather than a refusal. The PATH write grants
nothing on its own, because the gates step does not run when the install
step fails. Pinned by "puts the install on PATH before the signature audit,
not after" in tests/action-hardening-drift.test.ts, which compares the two
positions within the install step's own script and strips trailing comments
as well as whole-line ones. Both halves were added after a reviewer defeated
the first version by appending the phrase to an unrelated line as a trailing
comment.

**The audit's failure carries its reason.** action.yml:675-726 captures the
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
install-step failure is tests/action-pr-comment.test.ts:440 ("an install-step failure before the audit (npm floor, npm install) makes no outage claim either").

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
from a different angle.

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
advisory must never touch" in tests/cli.test.ts. The Action's own wiring: tests/action.test.ts:243 ("adds --advisory to the gates invocation only when the input is exactly "true"") and tests/action-pr-comment.test.ts:699 ("adds --advisory to the render run only when the input is exactly "true", proven by running the step"), both of which run the real step script
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
8.30.1 and osv-scanner 2.6.0 running for real; the observations are in
tests/fixtures/README.md.

CONDUCTOR DOWNLOADS NO THIRD-PARTY BINARY. The external gates are resolved
from `PATH` (or an absolute `command:`) only, exactly like the family gates
outside node_modules; their profiles say `managed: false`
(src/products.ts:163 and 201); and the Action installs exactly its four
npm packages and has no input for either tool (action.yml:585-589). A
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
(src/gate-runner.ts:1226-1251), because gitleaks loads the scan root's own
ignore file whatever the flag says; the flag alone was measured not to
close it. History is scoped by `--log-opts`, `HEAD` locally and
`<base>..HEAD` on a pull request (src/gate-runner.ts:600), so another
branch's secret never reddens this one.

ON A PULL REQUEST GITLEAKS RUNS FROM A DIRECTORY THE HEAD CANNOT WRITE.
gitleaks resolves a relative `[extend] path` against its working
directory, which was the repository root: a base config extending
`gl-extra.toml` read the pull request's copy, and a pull request that
allowlisted `src/.*` there passed with 0 findings and no proposal. Now the
base config's extend chain (and a relative `baseline-path` policy option)
is materialised from the base ref into `<work dir>/cwd`
(`materializeExternalConfig`, src/external-config.ts), gitleaks is spawned
there (src/gate-runner.ts:1263), a head-side edit to any materialised file
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
withheld (src/gate-runner.ts:619): an inline `gitleaks:allow` lives in
the tree being judged, so the pull request controls it, and a legitimate
allow belongs in the base ref's `.gitleaks.toml` or `.gitleaksignore`,
which are already read from the base. Local runs keep inline allows.
Pinned by "ignores inline gitleaks:allow comments on a pull request, and
keeps them on a local run" in tests/policy.test.ts and the runner test
beside it in tests/gate-runner.test.ts; checked against the real binary
(tests/fixtures/README.md).

OSV-SCANNER IS HANDED TRACKED LOCKFILES, NEVER A DIRECTORY. The runner
lists tracked files with `git ls-files` and passes each whose base name is
in `OSV_LOCKFILE_NAMES` (src/products.ts) with `--lockfile`, skipping
anything under `node_modules` (src/gate-runner.ts:1108-1170). osv-scanner's
own walk skips `.gitignore`d files even when they are tracked, which was
measured: a tracked, ignored `package-lock.json` gave exit 128 to the walk.
On a pull request the list is the head's index, deliberately not a base-ref
read: the lockfiles are the tree being judged and a change to them is in
the diff. None tracked means the tool is not spawned and the gate is clean
with `conductor/nothing-to-scan`; a listing that fails is
`preparation-failed`, never "none". When lockfiles WERE handed and
osv-scanner still exits 128, they parsed to no packages, and the diagnostic
is the distinct `conductor/lockfiles-empty` naming them.

THE VULNERABILITIES LINE'S LOCKFILE LIST COMES FROM THE UMBRELLA'S OWN
ARGV, NEVER FROM OSV-SCANNER'S OUTPUT (issue #72). osv-scanner 2.x prints
`results[]` only for a source with findings, so a clean scan of one
lockfile and a run that scanned none both have `results: []`, and reading
`results.length` cannot tell them apart. `runGate` already knows every
lockfile it handed over with `--lockfile` before osv-scanner is ever
spawned (`external.lockfiles`, src/gate-runner.ts:1108-1170); that same
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
(`argv.includes('--online')`, src/gate-runner.ts:1443) -- worded as a flag
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
bag is non-empty (src/output-sarif.ts:998-1003), so the lockfile list and the
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

Known open, each a limit rather than a bypass on a pull request:

1. KNOWN-OPEN: only npm-family lockfile names are listed
   (`OSV_LOCKFILE_NAMES`), so a repository whose only lockfile is another
   ecosystem's gets nothing-to-scan from this gate.
2. KNOWN-OPEN: lockfiles inside git submodules are never listed, because
   `git ls-files` does not descend into a submodule; a submodule's
   dependencies are not scanned by this gate.
3. KNOWN-OPEN: in a sparse checkout a tracked lockfile absent from disk is
   still listed and handed over, and osv-scanner exits 127 on it: a false
   red, which fails closed rather than open.
4. KNOWN-OPEN: on a LOCAL run a `.gitattributes` binary mark hides a file
   from gitleaks (see above); pull requests are protected.
5. KNOWN-OPEN: a PULL REQUEST that rewrites a tracked lockfile to `{}`
   silences the vulnerabilities gate for that lockfile: osv-scanner exits
   128, reported as `conductor/lockfiles-empty` naming the file and treated
   as clean. It is the one visible exception to "a pull request cannot
   suppress its own finding", and the rewrite is in the diff.
6. KNOWN-OPEN: a base `.gitleaks.toml` whose `[extend] path` target is a
   symbolic link, or which writes the extend as an inline table or a quoted
   key, fails closed on every pull request (`preparation-failed`, or a
   missing file for gitleaks) until it is rewritten as a plain relative path.

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
existed, byte for byte (src/cli.ts:531-533, the `options.project ===
undefined` branch of the ternary that assigns `cwd`). `run` has no
equivalent structured-conflict path to preserve -- it always threw through
`repoRoot` before this flag existed -- so its own call (src/cli.ts:646)
passes `options.project` to `resolveProjectRoot` unconditionally and that
was correct from the start.

RESOLUTION FOR AN EXPLICIT --project IS ONE FUNCTION, CALLED FROM BOTH
COMMANDS. `resolveProjectRoot` (src/cli.ts:210-229) resolves the value
against the process's own working directory with `path.resolve` before
anything else runs, so a relative value means what the person typing it
expects rather than something resolved against a path discovered later. The
resolved path is then checked to exist and be a directory with `statSync`,
and only then handed to `repoRoot` (src/cli.ts:152-186) exactly as the bare
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
(src/gate-runner.ts:873-874), the program-vetting rule is called with that
same `options.repoRoot` (src/gate-runner.ts:947, calling
`refuseHeadControlledBinary`, src/gate-runner.ts:401-416, which itself calls
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
(src/gate-runner.ts:1263, with the vault-guard rationale for why the
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
check. `isGitDirectory` (src/cli.ts:138-150) asks `git rev-parse
--is-inside-git-dir` only once `--show-toplevel` has already failed, so the
extra spawn is on a path already about to fail the command; `repoRoot`
(src/cli.ts:152-186) reads it to choose between "is a git directory, not a
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
report: `conductor run --format sarif --text-report PATH`, one invocation,
each gate spawned once (`--text-report` in src/cli.ts renders the SAME
`RunResult` a second time and never calls `runAll` again). The gates step in
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
