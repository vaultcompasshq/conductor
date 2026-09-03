# Conductor

The name is conductor. The package is not yet published. This repository is
the umbrella over the Vault & Compass guardrail gates: one policy file, one
init, one hook, and one report across three tools that each install,
version, and run on their own. The word conductor previously belonged to
the intent gate, which is now intent-guard.

## What it is

Three gates cover three boundaries of an AI-assisted coding session.
dep-guard checks what comes in: hallucinated package names, typosquats,
tampered lockfile entries. vault-guard checks what goes out: credentials
about to be committed. intent-guard checks what was approved: drift from a
frozen intent contract, and change budgets.

Run all three and you have three inits, three config files, three output
shapes, and three pre-commit hooks fighting over one file. That is the
friction this repository removes, and that is all it removes:

- **one policy file**, `.guardrails.yaml`, keyed by the role each gate
  fills rather than by the product filling it;
- **one init**, which writes that file and a single pre-commit hook running
  every enabled gate;
- **one report**, as text for a terminal or as a single SARIF 2.1.0 log
  with one run per gate.

## What it deliberately is not

It is not a fourth gate. It finds no bugs of its own, has no rules, and
scans nothing. Every finding in its report came from one of the three gates
and is labelled with which one.

It is not something you adopt before the gates are useful. Each gate keeps
its own config file, its own baseline, its own thresholds, and its own exit
codes. The umbrella never writes into any of them: it passes a policy to
each gate as command-line flags, which every one of the three already
treats as higher precedence than its own config. Delete this tool and every
gate still runs, with exactly the configuration it had, because nothing
here ever touched it.

It does not overrule a gate. A gate that says a commit is blocked blocks
the commit. The umbrella can add to that decision and never subtracts from
it.

## The policy file

`.guardrails.yaml`, at the repository root. `conductor init` writes one with
every gate listed and only the ones it found switched on.

```yaml
version: 1

gates:
  dependencies:
    product: dep-guard
    enabled: true
    stage: commit
    options:
      fail-on: high
  secrets:
    product: vault-guard
    enabled: true
    stage: commit
  intent:
    product: intent-guard
    enabled: true
    stage: ci
    options:
      require-frozen: false

report:
  format: text
```

**Gates are keyed by role**, not by product. `dependencies`, `secrets`,
`intent`. The `product` field says which binary fills that role today. This
is worth one extra line: it makes a product rename a one-line edit rather
than a rename of the key your CI reads, and it leaves room for a fourth
role to arrive without the schema moving.

**`enabled`** defaults to true. A gate that is enabled and whose binary
cannot be found is a blocking finding of the umbrella's own
(`conductor/gate-missing`), never a silent skip. A gate that is switched on
and quietly absent is the failure this whole family exists to prevent.

**`stage`** says when a gate runs: `commit`, `push`, or `ci`. Stages are
**cumulative** in that order, so a gate runs at its own stage and at every
later one, and a run at `ci` runs everything that is enabled. The defaults
are `commit` for `dependencies` and `secrets` and `ci` for `intent`.

Runtime is not what decides that split. All three gates together take under
a second on a staged commit. Ceremony is the cost, and only the intent gate
has any: it wants a contract approved before the work starts, which is a
per-task human step and belongs at a pull request. The other two are silent
until they find something, and a secret that reaches a pull request is
already on a remote, so the earliest stage is the only honest place for
them.

A gate held back by the stage filter is never silent. It is one line in the
text report naming the stage it is waiting for, and a `conductor/gate-deferred`
note in the SARIF log's `conductor` run. It gets no SARIF run of its own,
for the same reason a gate that could not run gets none: it produced no tool
output, and an empty run named for that product would put its name on
something it never did. Its binary is not even looked for, so a gate
installed only on the CI image does not fail a developer's commit.

**`enforce`** defaults to true. A gate with `enforce: false` runs, reports,
and appears in the text report and the SARIF log exactly as an enforced gate
does. The only thing it cannot do is change the exit code: its blocking
findings do not raise it, and its failing to run at all is a note rather
than exit 2. That is the adoption ramp, so a gate can be switched on and
read for a few weeks before it is allowed to refuse anybody's commit.

It is not a downgrade of what the gate said. Findings keep their own
severities and their own `blocking` flags, in both formats, because
rewriting a critical finding to a note would put this repository's
enforcement policy into the field a code-scanning UI uses to describe the
finding itself. What changes is that the text report says in words that the
gate blocked and was not enforced, on the same screen as the findings, so a
green exit next to red findings is never a surprise. In SARIF that gate's
own run carries `properties.enforced: false`, and the `conductor` run
carries a `conductor/gate-not-enforced` note as well, because a gate that
could not run has no run of its own to hang the property on and that is
exactly the case worth saying out loud. That run's properties bag also
carries the `stage` the gate ran at, so a log from a commit-stage run is
distinguishable from a full one rather than looking like the same run with
fewer findings in it.

**`options`** is handed to that gate unchanged. Each key is one of that
gate's own long flags with the leading dashes stripped: `fail-on: high`
becomes `--fail-on high`, `online: true` becomes `--online`,
`require-frozen: false` becomes `--no-require-frozen`, and a list becomes
one flag per entry. Nothing here interprets any of them, which is why a
gate can grow a flag without this package needing a release. The handful of
flags the umbrella supplies itself (the JSON format flag, `--staged`, and
the intent gate's `--project`) are rejected if you also set them, rather
than being silently overridden.

**There is no shared severity threshold, on purpose.** Two of the three
products share a four-level scale exactly; the third scores a weighted
rubric from 0 to 100 and has two budget outcomes with no severity in them
at all. One top-level `failOn` would read as one decision and mean three
different things, so setting one is an error rather than a knob that half
works. Each gate keeps its own threshold in its own `options` block,
spelled the way that gate spells it.

**`command`** takes an absolute path and overrides binary resolution for
that gate, for pointing at a build that is not installed anywhere.
Otherwise resolution tries each of that product's binary names in order,
looking in the repository's `node_modules/.bin` and then on `PATH`. The
repository's own copy wins, so a project pin beats a global install, which
is what `pnpm exec` does in the same repository. The name is the outer
loop and the location the inner one, so a product's current name still
wins over an older one wherever each is installed: a repository has no say
in which product a name means, and every say in which build of it to run.

**`report.format`** is `text` or `sarif`, and `--format` overrides it.

### Precedence

1. the gate's own config file, which the umbrella never reads or writes;
2. this policy file, delivered to the gate as command-line flags;
3. a flag on the umbrella's own command line.

Layer three is narrow in v0.1: `--gate <role>` restricts a run to named
roles. There is no umbrella flag that rewrites a gate's threshold, for the
reason above.

## Commands

`conductor init` writes the policy file and one pre-commit hook.

- `--dry-run` prints every file it would write or change and writes nothing.
- `--revert` removes exactly what a previous init wrote, and nothing else.
  A file changed since init is reported and left alone.
- `--adopt` replaces one gate's own pre-commit hook with the umbrella hook.
  Without it, init reports the collision and stops rather than stacking a
  second invocation of a gate that is already hooked. A hook the umbrella
  does not recognise is never replaced, with or without `--adopt`.
- `--force` acts on a file **conductor itself wrote** and that has changed
  since: on its own it replaces a managed hook somebody has edited, and with
  `--revert` it removes one, restoring an adopted hook if there was one. It
  never overrides a foreign-hook or gate-hook refusal, with or without
  `--adopt`: those hooks were never conductor's, and no flag here turns
  somebody else's file into one this tool may overwrite.

Re-running init over a hook a **previous version of conductor** wrote
replaces it, rather than reporting it already installed. The marker in the
hook says whose it is, not which version, so the decision is the hook's
digest: identical to what this version writes means nothing to do;
identical to the digest the manifest recorded means an older conductor
wrote it and it is updated in place; anything else means it has been edited
by hand, and it is refused with the same guidance a changed file gets under
`--revert`. A marked hook with no manifest to check against is treated as
edited. Skipping an old hook left it running a command line this version no
longer writes, and left it out of the new manifest, so a later `--revert`
walked past it.

The manifest is rebuilt when it is the part that has gone missing. A hook
that is already byte for byte what this version writes, in a repository
whose manifest no longer records it, is left alone on disk and entered in
the manifest. Nothing is written to the hook, because nothing is wrong with
it; without the entry, `--revert` has no record that the hook is the
umbrella's, reports success, and leaves it running. A `git clean`, a
deleted `.guardrails` directory, and an install from before there were
manifests all reach that state.

A revert that cannot remove everything removes nothing that would leave the
repository half-wired, keeps the manifest describing what is left, and
exits non-zero. In particular, if the hook has been edited by hand it is
left alone and so is the policy file, because a hook running the umbrella
with no policy file to read would refuse every commit.

Two of the three gates write a marker comment into the hook they install,
so init recognises those exactly. The secret scanner writes no marker, so
its hook is recognised **by content**: a hook that mentions that tool and
runs a staged scan. That is the same test its own installer applies to its
own hook, but it is a heuristic, and a hand-written hook that happens to
call that tool the same way will be treated as its. Read what `--dry-run`
reports before running `--adopt` on a hook you did not write.

`conductor run` runs every enabled gate and prints one report.

- `--staged` gates the git index against HEAD, which is what the hook does.
- `--format text|sarif`.
- `--stage commit|push|ci` runs the gates at that stopping point and every
  earlier one. With no `--stage` at all, every enabled gate runs, whatever
  its stage. An unknown value is a usage error and exits 2 rather than
  quietly running everything or nothing: a typo in a CI file that runs every
  gate and one that runs none both look like a passing build.
- `--base <ref>` measures the intent gate against what this branch changed
  since `<ref>`, rather than against the index. See "Intent at a pull
  request" below.
- `--spec <path>` names the spec the intent gate imports its contract from.
- `--output <path>` writes the report to a file instead of to stdout, for a
  CI step that uploads it. One line still goes to stdout, because a job whose
  only product is an uploaded artifact otherwise reads as a job that did
  nothing. A path that cannot be written is exit 2, not a green run beside a
  report nobody can read.
- `--verbose` prints the full per-gate report even when the run is clean.
  Text output only; the SARIF log never changes shape with it.
- `--gate <role>`, repeatable.

### Exit codes

- **0** every enabled gate ran and none blocked.
- **1** every enabled gate ran and at least one blocked.
- **2** an enabled gate could not run: its binary is missing, it exited with
  its own could-not-run code, or it exited 1 with nothing parseable on
  stdout, which is what a rejected config file looks like from two of the
  three.

A gate carrying `enforce: false` is left out of that composition entirely,
and a gate the stage filter deferred never gets as far as it. Both are the
policy file's own decisions, written down in the repository; nothing here
reads a gate's output and decides on its own to ignore it.

This is not the numeric maximum of the children's exit codes, because the
codes do not mean the same thing in each product. One of the three uses 2
for "could not run the checks at all"; the other two have only 0 and 1 and
use 1 both for a real finding and for a broken config. So the composed code
can differ from the maximum of its children's, and a gate that could not
run outranks a gate that blocked. A report that reads clean because nothing
looked is worse than one that says it failed.

## Intent at a pull request

The intent gate is the only one of the three with any ceremony: its native
flow wants a contract approved before the work starts, which is a per-task
human step. That step is exactly what a pull request cannot carry, so at the
`ci` stage the umbrella stands in for it.

**What it measures.** With `--base <ref>`, the changed-path set is what this
branch changed since it forked, from
`git diff --name-only --no-renames <base>...HEAD` in the repository root. The
three-dot form is the point: two-dot would attribute every commit that landed
on the base branch after this branch forked to this branch, so somebody else's
merge would breach this pull request's change budget. A rename lists both its
old and its new path, so moving a file out of a protected directory still
blocks; the cost is that a rename counts as two paths against `max_files`.

With no `--base`, `GITHUB_BASE_REF` is used as `origin/<value>` when it is
set, and the text report says so. With neither, the intent gate runs exactly
as it did in v0.1.

A git failure here is **fail-closed**: could-not-run, so exit 2 for an
enforced gate and a note for an unenforced one. There is deliberately no
fallback to an empty path set, because an empty path set is what a passing
gate looks like. In Actions this is almost always a shallow checkout, so
**`actions/checkout` needs `fetch-depth: 0`** for the merge base to exist.

**Where the contract comes from**, in order:

1. `--spec <path>` on the umbrella's own command line. Typed just now, so it
   outranks everything, and a path here that is not on disk is reported
   rather than replaced: running a different contract than the one somebody
   named is the wrong kindness.
2. `<repo>/.conductor/intent-contract.yaml`, when it is **frozen**. The
   native flow wins wherever a team has done it. Frozen is the test rather
   than present: an unfrozen contract is a draft somebody left behind, and
   running the gate against it fails every pull request on "not frozen by
   user" without checking anything.
3. The **first** `Spec: <path>` line in the pull request body, read from the
   event payload at `GITHUB_EVENT_PATH`. Written by whoever opened the pull
   request, which is a weaker claim, so a path here that is not on disk falls
   through to the next rule: a typo in a description must not fail a build. A
   path that leaves the repository falls through the same way, because on a
   fork pull request that body is written by somebody with no write access,
   and an unchecked `../` there imports an arbitrary readable file from the
   runner and puts its path in the contract. `--spec` is deliberately not held
   to that rule: a person typed it, and a spec kept outside the checkout is a
   real thing to want.
4. A markdown file **directly under** `docs/superpowers/specs` whose name
   relates to the branch. The branch slug is the branch name with its first
   segment (`feat/`, `fix/`) removed; a filename is reduced by stripping a
   `YYYY-MM-DD-` prefix and a trailing `-design`; the two are candidates when
   either contains the other.

   Several candidates are ranked: a stem **equal** to the slug first, then
   the **longest** stem, and only then the newest name. Newest alone was the
   rule, and it put a pull request against another feature's requirements: a
   vaguer spec carrying a later date beat the one named for the branch.

   The newest-name tie-break is still a lexical one, so **date every spec**.
   Where two names reduce to the same stem and one has no `YYYY-MM-DD-`
   prefix, the undated one sorts last and wins. That is a different revision
   of the right feature's spec rather than a different feature's, which is
   why the ranking leaves it alone, but it is not necessarily the revision
   you meant.

   The plan under `docs/superpowers/plans` is paired only when its stem is
   **equal** to the chosen spec's, and passed as `--plan`. Equal rather than
   related, because pairing a spec with a neighbouring feature's plan freezes
   one set of requirements against the other's change budget, and the block
   or pass that follows is about neither. No plan is fine; intent-guard
   imports a spec on its own.

**How it is frozen.** `intent-guard import-spec --from superpowers
--dry-run` drafts a contract, that YAML is written into a **temporary**
directory, `intent-guard freeze` approves it there with an `--approved-by`
naming the spec and the short commit, and the gate runs with `--project`
pointed at that directory. Nothing is ever written under the repository's own
`.conductor`: a contract is a committed artifact with an approver's name on
it, and one dropped into a working tree by a CI run is either committed by
accident or read by the next run as though a person had approved it. Any
failure in that chain is could-not-run for the gate, and the report names the
step it failed at, because the gate itself said nothing and that sentence is
all there is to tell a shallow checkout from a spec the importer choked on.

**A branch with neither** is a third state beside deferred and could-not-run:
the gate is switched on, it ran, and it had nothing to check. It gets one
line in the text report and one note-level `intent-guard/no-contract` result
in the `conductor` run, and it **never** reaches the exit code, enforced or
not. A branch with no spec is a branch this gate has no opinion about, and
turning that into a failed build is how a gate gets switched off across a
repository.

**What blocks is unchanged.** Blocking stays where intent-guard puts it:
budget breaches block, subject to `enforce`. Drift on its own is reported and
not blocked, which is already intent-guard's own behaviour. The umbrella adds
no severity threshold of its own here either.

**Which budget applies** is intent-guard's rule, not this package's, and it
is worth knowing before you write one: the importer takes the **first** fenced
`yaml` block whose whole content is a single `budget` key, searching the
**spec first** and the plan only after it. So a budget in the spec wins, and a
budget in the plan applies only when the spec has none. Putting one in each
is not a merge; the plan's is simply never read.

Both reports say what the verdict is about. The text report carries one line
naming the contract source and the base ref; the gate's SARIF run carries
`contractSource` and `baseRef` in its properties bag, beside `enforced` and
`stage`.

## The Action

`action.yml` at the root is a composite action that runs the gates at the
`ci` stage and writes one SARIF log for the caller to upload.

It **installs nothing**. The package is unpublished, so an install step would
either fail or fetch something else under a name it does not own; instead the
action checks for `node_modules/.bin/conductor` and fails with a sentence
saying to add it as a devDependency. `--base` is passed only when the
`base-ref` input names one; left empty, the umbrella reads `GITHUB_BASE_REF`
itself and treats an empty value as "not a pull request", which is what a
push build wants.

`output` is relative to `working-directory`, and the `sarif` output reports
it relative to the **workspace**, which is where the caller's upload step
runs. It is published before the gates run, because the log is most worth
having on the run that failed.

```yaml
name: guardrails
on: pull_request

jobs:
  gates:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
        with:
          # Required. Without it there is no merge base to diff against, and
          # the intent gate fails closed rather than checking an empty set.
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - id: conductor
        uses: ./
        with:
          output: conductor.sarif
      - uses: github/codeql-action/upload-sarif@v3
        # Always: the log is most worth having on the run that failed.
        if: always()
        # The sarif path is published BEFORE the gates run, so on the exit 2
        # cases that fail before anything is written (a policy error, an
        # unknown stage, an unwritable output path) it names a file that was
        # never created. Publishing early is the right trade for the common
        # case, which is exit 1 with a real log; this step just has to
        # tolerate the file being missing rather than failing the job a second
        # time over it.
        continue-on-error: true
        with:
          sarif_file: ${{ steps.conductor.outputs.sarif }}
```

`continue-on-error` there hides nothing: a gate that blocked has already
failed the job through `conductor`'s own exit code, before this step runs.

The intent gate starts at `enforce: false` in the policy file while a
repository reads a few pull requests' worth of drift before letting it refuse
anybody's merge:

```yaml
gates:
  intent:
    product: intent-guard
    stage: ci
    enforce: false
```

## The hook

One hook, running `conductor run --staged --stage commit`. It names the
stage rather than running everything, because a pre-commit hook is the
commit stopping point, and a hook that runs the per-task ceremony of the
intent gate on every commit is a hook a team switches off. It fails closed:
a missing umbrella binary blocks the commit with one line saying so, because
a guardrail that is off when the tool is missing is a guardrail an attacker
turns off by making the tool missing. It passes the exit code straight
through, so 2 does not collapse into 1 and report findings that were never
looked for.

The hook prepends the repository's own `node_modules/.bin` to `PATH`
before looking for the binary, so a conductor installed only as a project
devDependency is visible to its own hook. The root comes from
`git rev-parse --show-toplevel` rather than from the working directory,
because a hook invoked from a subdirectory would otherwise prepend a path
that does not exist. Fail-closed is unchanged: no conductor there and none
on `PATH` still blocks the commit. The hook also survives being run under
`sh -e`, which is what husky's dispatcher does, so the line explaining a
blocked commit is printed there too rather than being cut off by the
shell.

A relative `core.hooksPath` is resolved against the working-tree root,
which is where git actually looks. An absolute one pointing outside the
repository is refused rather than written to, since that directory serves
every repository on the machine.

**Where git looks is not always the file to write.** husky 9 points
`core.hooksPath` at `.husky/_`, a generated and gitignored directory it
rewrites on every install; the file git executes there is a dispatcher
that adds `node_modules/.bin` to `PATH` and runs the tracked hook one
directory up. Init recognises that arrangement and then reads, detects,
adopts, writes and reverts `.husky/pre-commit`, never anything under
`.husky/_`. Reading the dispatcher instead reports the repository's real
gate hook as foreign, so `--adopt` cannot adopt it, and writing the
dispatcher puts the hook where the next install deletes it without saying
so. Both were found by running this tool against a real husky 9
repository rather than against a fixture.

Recognition is structural: the hooks directory is named `_` and its parent
is named `.husky`. Only husky creates that path, so the shape alone
identifies it, and two things that look like useful corroboration are
deliberately excluded.

The **contents** of the file git executes are not a signal, because under
husky 8 that file is the tracked hook itself: husky 8 points
`core.hooksPath` at `.husky`, and every tracked hook there opens by
sourcing `_/husky.sh` as a preamble. Reading that preamble as a dispatcher
sends init one directory above `.husky`, which is the repository root.
husky 8 therefore takes the ordinary path, where `.husky/pre-commit` is
already both the file git runs and the file init reads.

The **presence of husky's shim** is not a signal either. husky gitignores
`.husky/_`, so `git clean -xdf` deletes that directory while
`core.hooksPath=.husky/_` sits in `.git/config` and survives. A repository
in that state has no shim and no dispatcher to find, and requiring one
would send init back to writing `.husky/_/pre-commit`, the very file the
next install wipes. The shim says whether husky ran recently, not whose
directory this is, so `--dry-run` reports it and the rule ignores it.

lefthook and the pre-commit framework also install a generated script
where git looks, and neither has a tracked counterpart to write instead,
so both are recognised and refused with a pointer at the manager's own
config file (`lefthook-local.yml`, `.pre-commit-config.yaml`). A gate run
from either of those is subject to that manager's exit code rather than
the umbrella's, so 1 and 2 stop meaning different things there; that is
why init names the file rather than editing it.

## The report

**A clean run prints one line.** Most runs are clean, and the design
constraint on all of this is that the gates must not slow development down,
with ceremony rather than runtime named as the cost. A screenful of per-gate
detail on a commit that found nothing is that cost, paid on every commit, and
it is what makes a team switch a hook off. The line names the gates that ran,
names any gate deferred to a later stage or left with nothing to check,
counts any notes, and says to re-run with `--verbose` for the rest.

Clean means all three of: the composed exit code is 0, no gate blocked, and
no gate could not run. The second and third are not implied by the first. A
gate with `enforce: false` is left out of the composed code entirely, so one
that blocked, or one that could not run at all, still leaves the run at exit
0, and those are exactly the runs whose report must not be collapsed to a
line. A run where no gate ran at all prints the full report too, so the
distinct verdicts for "none is enabled", "every gate was deferred" and
"nothing had a contract to check" survive. Notes and diagnostics on their own
do not force the full report; they are counted on the summary line, because a
standing note about a lockfile format is a permanent property of that format
rather than news about this commit.

This is a text-format decision and nothing else. The SARIF log is unchanged
either way, and there is deliberately no policy key for it: the schema
describes what a repository gates on, and how loud one developer wants their
own terminal to be is not that.

The full text report is one section per gate, blocking findings first, with each
gate's own threshold, its own suppressed and ignored counts, and its own
exit code and duration in the header. The counts are printed even at zero,
because they are the user's earlier decisions and hiding them makes a
repository with two hundred baselined findings read as clean.

The SARIF output is one log with one run per gate, each run's tool name and
version taken from that gate. Rule ids are product-namespaced, each result
carries the gate's own fingerprint verbatim in `partialFingerprints` under
a key naming the product, and the properties bag carries `blocking`,
`severity`, whether that severity was assigned by the umbrella rather than
by the gate, how durable that fingerprint is, and the gate's own details
bag with its values unchanged. A value in that bag is never converted, so
where a gate's own units differ from SARIF's the key says so:
`columnZeroBased` is the secret scanner's own 0-based column, sitting
beside the 1-based `startColumn` mapped from it. No location is invented:
a finding with no known line gets no region, and a finding about a missing
binary gets no location at all.

## Scope of v0.1

In: the policy file and its schema, `init` with dry-run, revert, and adopt,
`run` producing the combined text report and a combined SARIF log, and the
composed exit code.

Out, deliberately: a unified baseline (each gate keeps its own, and their
fingerprints are not equally durable, so one shared file would expire
entries silently for one product and not another), an MCP registration,
running the gates concurrently, and any finding of the umbrella's own beyond
`conductor/gate-missing`.

## Scope of v0.2

In: per-gate `stage` and `enforce`, `run --stage`, the intent gate at a pull
request (`--base`, `--spec`, the imported contract, the no-contract
advisory), and the composite Action.

Still out: intent at the cohesion level, which is what a merge or a
promotion would want and which the audits do by hand today; anything that
runs inside an agent session or on save, which intent-guard's own optional
session hooks already cover; and a unified baseline or ledger.

Also out: a published package. The gates are the product; this is the
convenience layer over them, and it stays unpublished until it has earned a
config file worth keeping.

## License

MIT, [Vault & Compass](https://vaultcompass.io)
