# Intent at a pull request

Moved here from the README. Back to the [README](../README.md).

The intent gate is the only one of the five with any ceremony: its native
flow wants a contract approved before the work starts, which is a per-task
human step. That step is exactly what a pull request cannot carry, so at the
`ci` stage the umbrella stands in for it.

**What it measures.** With `--base <ref>`, the changed-path set is what this
branch changed since it forked, from
`git diff --name-only --no-renames <base>...HEAD` in the repository root.

With no `--base`, `GITHUB_BASE_REF` is used when it is set, spelled in full:
`refs/conductor/trust-base` (the Action's private fetch of the base) if that
exists, else `refs/remotes/origin/<value>`, so a tag of that name cannot
shadow it. The text report says which. An explicit `--base` that matches both
a tag and a branch is refused as ambiguous. With neither but a `--trust-base`
(merge_group, workflow_dispatch, a CLI run), the change set is measured from
the trust base. With none of the three, the intent gate runs the way
it does at a commit: against the staged index, or the paths you name.

**This is why a local preview and a pull-request run can disagree about a
missing contract.** The contract-discovery rules below (`--spec`, a frozen
native contract, a `Spec:` line, the `docs/superpowers/specs` convention)
only engage once `--base` resolves to something, or `--spec` is given.
Neither is true of a plain `conductor run` on your own checkout, so a
repository with no contract gets intent-guard's own native answer instead:
`BLOCKING critical intent-guard/gate-blocked`, because that flow wants an
approved contract and none exists. On a pull request `--base` is set, this
whole section's machinery engages, and a branch with nothing to import
lands in the no-contract state below instead: reported, and never reaching
the exit code. Read a local `BLOCKING` line on the intent gate as "there is
no contract for the umbrella to import here yet," not as "this pull request
will fail."

A git failure here is **fail-closed**: could-not-run, so exit 2 for an
enforced gate and a note for an unenforced one. There is deliberately no
fallback to an empty path set, because an empty path set is what a passing
gate looks like. In Actions this is almost always a shallow checkout, so
**`actions/checkout` needs `fetch-depth: 0`** for the merge base to exist.

**On a pull-request run the base decides.** With `--trust-base`, whether a
frozen contract governs the pull request is read from the base ref alone. A
frozen contract on the base is used, ahead of everything in the list below,
`--spec` included (the report says so when `--spec` was given), and the gate
judges any edit to it against the base copy. That holds for every
intent-guard that can run on a pull-request run, since one older than its
pull-request-mode minimum is could-not-run rather than run without the base
ref. With no frozen contract on the
base, nothing in the pull request becomes the contract: a spec on the base,
found by rules 1, 3 and 4 below, is imported from its base copy (so on such a
run `--spec` must be a plain path inside the repository that the base
carries), and otherwise
the gate is skipped with "No contract on the base". A contract or spec the
pull request adds is reported as a proposal, so adopting the intent gate
merges, and the next pull request is judged against it. Retiring or replacing
a frozen contract through a judged pull request is refused by the intent gate
itself and needs an administrator to merge it.

**Where the contract comes from**, in order:

1. `--spec <path>` on the umbrella's own command line. Typed just now, so it
   outranks everything else in this list, and a path here that is not on
   disk is reported rather than replaced: running a different contract than
   the one somebody named is the wrong kindness. On a pull-request run it is
   read from the base, and a frozen contract on the base takes precedence.
2. `<repo>/.intent-guard/intent-contract.yaml`, when it is **frozen**, and
   `<repo>/.conductor/intent-contract.yaml` after it. The native flow wins
   wherever a team has done it. Frozen is the test rather than present: an
   unfrozen contract is a draft somebody left behind, and running the gate
   against it fails every pull request on "not frozen by user" without
   checking anything.

   The second path is the directory intent-guard used before 1.3.0, which
   renamed it because `.conductor` had become the name of a different product
   in this family. Both are read, so a repository on either version is
   checked rather than blocked, and a run that used the old one says so: one
   line on the gate's contract line in the text report, and an
   `intent-guard/legacy-state-dir` notification in the SARIF log. If the
   repository holds **both** directories, the gate does not run and says so,
   naming both: that is the state intent-guard itself refuses every command
   in, so the umbrella refuses on exactly the gate's rule rather than a
   softer one. A `.conductor` holding nothing intent-guard wrote belongs to
   something else and is ignored.
3. The **first** `Spec: <path>` line in the pull request body, read from the
   event payload at `GITHUB_EVENT_PATH`. A path here that is not on disk, or
   one that leaves the repository, falls through to the next rule.
   `Spec: none` is a **waiver**: it says this pull request deliberately has
   no spec, so rule 4 is not tried and the gate reports itself skipped with
   `intent-guard/contract-waived` instead of `intent-guard/no-contract`. The
   token is exact and lowercase, a frozen contract at rule 2 still wins over
   it, and `--spec` at rule 1 still overrides it.
4. A markdown file **directly under** `docs/superpowers/specs` whose name
   matches the branch on **whole words**. The branch slug is the branch name
   with its first segment (`feat/`, `fix/`) removed; a filename is reduced by
   stripping a `YYYY-MM-DD-` prefix and a trailing `-design`. Both have their
   ASCII letters lower-cased and are split into words on `-`, `_`, `/` and
   spaces. A spec is a candidate when one name's words appear, in order and
   together, inside the other's, and at least one shared word is three or
   more characters, contains a letter, and is not a common branch word
   (`fix`, `feat`, `wip`, `docs`, and the rest of the list in
   `src/intent-spec.ts`). Candidates are ranked by an equal name first, then
   the most shared words, then the longest shared word, then the lexically
   greatest filename among files with the same name (the newest date when
   every spec is dated `YYYY-MM-DD-`, so **date every spec** in that form).
   Two different specs that tie are **not** guessed between: the gate is
   skipped as `intent-guard/spec-ambiguous`, naming both. A spec chosen on
   one shared word, or on word length alone, is used and the report says the
   match is weak. Branch names like `pr` or `fix/wip` choose nothing. When
   the choice matters, say it: a `Spec:` line in the pull request body, or a
   branch named after the spec.

**A branch with neither** is a third state beside deferred and could-not-run:
the gate is switched on, it ran, and it had nothing to check. It gets one
line in the text report and one `intent-guard/no-contract` notification
in the `conductor` run, and it **never** reaches the exit code, enforced or
not. A branch with no spec is a branch this gate has no opinion about, and
turning that into a failed build is how a gate gets switched off across a
repository. A waived pull request lands in the same state and is reported
under its own `intent-guard/contract-waived` id, with its own wording on the
skipped line, in the verdict and on the one-line summary of a clean run, so a
reader can tell "nobody has written one" from "somebody decided against one"
wherever they meet it. An ambiguous branch, one two specs match equally,
lands in the same advisory state under its own `intent-guard/spec-ambiguous`
id, and never reaches the exit code either.

**A repository with no contract yet is not a repository this gate can act
on**, and the no-contract skip line names `docs/superpowers/specs`, which is
a convention from this family's own tooling and not one an outside adopter
has reason to recognise. The next step, if you want this gate to have an
opinion here, is the one intent-guard's own documentation describes: draft a
contract naming the paths worth protecting, then freeze it, and keep the
frozen file committed so rule 2 above finds it on every pull request from
then on. Until you do that, a project rule that lives only in `AGENTS.md`
never blocks anything through this gate. intent-guard does read prose rules
files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, cursor rules) as constraint
sources, but by its own design a constraint from that source is advisory
and leaves the exit code alone; only a user-stated constraint, or one
promoted with `intent-guard correct --promote`, can block. Conductor itself
never opens that file. What is enforced is the frozen contract or the
imported spec, never project convention documented in prose.

**A waiver is a decision, recorded by whoever wrote the pull request body,
and that includes a contributor from a fork.** On the ordinary path, where a
repository has no frozen contract of its own, `Spec: none` means the intent
gate does not run at all on that pull request, and budget breaches are the
thing this gate blocks on. The one thing a waiver cannot override is a frozen
native contract, under either of the two paths above, which is checked first:
a repository that wants the gate to be non-waivable freezes a native contract
and keeps it committed. The branch-name convention is not a control either:
whoever names the branch chooses among the base's specs.

**What blocks is unchanged.** Blocking stays where intent-guard puts it:
budget breaches block, subject to `enforce`. Drift on its own is reported and
not blocked, which is already intent-guard's own behaviour. The umbrella adds
no severity threshold of its own here either, and intent-guard 1.7.0's own
advance-notice warnings about an unmatchable `protected_paths` or
`allowed_paths` entry never reach the exit code either, right up until the
2.0.0 release where intent-guard turns that same shape into a blocking
reason. Where they print depends on how much of the report is showing: as a
note under the intent gate in the full report (`--verbose`, a non-clean run,
or the pull-request comment, which the Action always renders with
`--verbose`), and, on an otherwise-clean run with neither, counted without
their text in the one-line summary's own note count instead.

**A prose-sourced constraint finding is never marked blocking, even when the
run blocks for an unrelated reason.** intent-guard 1.6.0 caps a constraint
whose source is one of those same prose rules files at advisory: a strong
match is still reported, but it never raises the gate's own exit code. A run
that blocks on scope creep alone still carries that capped finding in its
report, and it is rendered as a non-blocking, lower-severity line in the text
report and with `properties.blocking: false` in SARIF, rather than inheriting
the run's own blocking flag the way every other drift finding does.
