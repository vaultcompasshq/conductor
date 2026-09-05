# conductor

conductor is the optional layer over three guardrail gates that each work on
their own. All it adds is one policy file, one init, one hook and one report.
Delete it and every gate still runs, with exactly the configuration it had.

<!-- guardrails-family: shared block, keep it identical in dep-guard, vault-guard, intent-guard and conductor -->
The Vault & Compass guardrails are three gates over an AI-assisted coding
session: [dep-guard](https://www.npmjs.com/package/@vaultcompass/dep-guard)
checks what comes in (hallucinated package names, typosquats, tampered
lockfile entries),
[vault-guard](https://www.npmjs.com/package/@vaultcompass/vault-guard) checks
what goes out (credentials about to be committed), and
[intent-guard](https://www.npmjs.com/package/@vaultcompass/intent-guard)
checks the change against what was approved (drift from a frozen intent
contract, and change budgets). Each one installs, configures and runs on its
own;
[conductor](https://www.npmjs.com/package/@vaultcompass/conductor) is the
optional umbrella that runs them from one policy file, one hook and one
report.
<!-- /guardrails-family -->

## Why

Run all three and you have three inits, three config files, three output
shapes, and three pre-commit hooks fighting over one file. That is the
friction this repository removes, and that is all it removes:

- **one policy file**, `.guardrails.yaml`, keyed by the role each gate
  fills rather than by the product filling it;
- **one init**, which writes that file and a single pre-commit hook running
  every enabled gate whose stage is `commit`, which by default is every gate
  but the intent one;
- **one report**, as text for a terminal or as a single SARIF 2.1.0 log
  with one run per gate.

**A clean run prints one line.** Most runs are clean, and the design
constraint on all of this is that the gates must not slow development down,
with ceremony rather than runtime named as the cost. A screenful of per-gate
detail on a commit that found nothing is that cost, paid on every commit, and
it is what makes a team switch a hook off.

## Quickstart

Install the gates. Each of them is a working tool on its own, and none of
them needs this one:

```
npm install -g @vaultcompass/dep-guard @vaultcompass/vault-guard @vaultcompass/intent-guard
```

The umbrella is optional. Install it when running the three separately has
become the annoying part:

```
npm install -g @vaultcompass/conductor
```

From the repository root, look before you write:

```
conductor init --dry-run
```

That prints every file it would write or change and writes nothing. Then:

```
conductor init
```

which writes `.guardrails.yaml` with every gate listed and only the ones it
found switched on, plus one pre-commit hook running every enabled gate whose
stage is `commit`.

Commit something. A clean commit prints one line:

```
conductor: clean, nothing blocked. 2 gate(s) ran: dependencies (dep-guard), secrets (vault-guard). Deferred to a later stage: intent (intent-guard) from stage ci. 1 note(s). Re-run with --verbose for the full report.
```

A commit with a staged credential in it prints the full report and exits 1:

```
conductor run: 2 gate(s), 1 finding(s)

dependencies  dep-guard 0.2.1  exit 0  251ms  via dep-guard on path
  threshold medium   suppressed 0   ignored 0

secrets  vault-guard 1.4.6  exit 1  97ms  via vault-guard on path
  BLOCKING  critical  vault-guard/anthropic  jest.config.mjs:27:32
      Possible secret of type 'anthropic'
  threshold medium   suppressed 0   ignored not reported

  deferred  intent  intent-guard  did not run here; it runs from stage ci onwards

verdict: exit 1, 1 blocking finding(s) across 2 gate(s).
```

Both gates there are the ones you installed a moment ago, running with their
own thresholds and their own baselines. The umbrella found nothing of its
own, because it looks for nothing of its own.

## What it deliberately is not

It is not a fourth gate. It finds no bugs of its own and scans nothing.
Every finding about your code came from one of the three gates and is
labelled with which one. The only findings it adds are about the gates
themselves, and they are labelled `conductor`: a gate that is switched on
and could not run, and a gate whose output it could not read. Those exist
because a report that reads clean when nothing looked is the failure this
whole family exists to prevent.

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
    enforce: true
    options:
      fail-on: high
  secrets:
    product: vault-guard
    enabled: true
    stage: commit
    enforce: true
  intent:
    product: intent-guard
    enabled: true
    stage: ci
    # It runs and reports in CI without failing the run. Flip it to
    # true once a few pull requests show the signal is worth blocking on.
    enforce: false
    options:
      require-frozen: false

report:
  format: text
```

**Gates are keyed by role**, not by product. `dependencies`, `secrets`,
`intent`. The `product` field says which binary fills that role today.

**`enabled`** defaults to true. A gate that is enabled and whose binary
cannot be found is a blocking finding of the umbrella's own
(`conductor/gate-missing`), never a silent skip.

**`stage`** says when a gate runs: `commit`, `push`, or `ci`. Stages are
**cumulative** in that order, so a gate runs at its own stage and at every
later one, and a run at `ci` runs everything that is enabled. The defaults
are `commit` for `dependencies` and `secrets` and `ci` for `intent`.

A gate held back by the stage filter is never silent. It is one line in the
text report naming the stage it is waiting for, and a `conductor/gate-deferred`
notification in the SARIF log's `conductor` run. Its binary is not even looked
for, so a gate installed only on the CI image does not fail a developer's
commit.

**`enforce`** defaults to true. A gate with `enforce: false` runs, reports,
and its findings appear in the text report and the SARIF log exactly as an
enforced gate's do. The only thing it cannot do is change the exit code: its
blocking findings do not raise it, and its failing to run at all does not
make the run exit 2. That is the adoption ramp, so a gate can be switched on
and read for a few weeks before it is allowed to refuse anybody's commit.
`init` writes it out for every gate, and starts the intent gate at `false`.

**`options`** is handed to that gate unchanged. Each key is one of that
gate's own long flags with the leading dashes stripped: `fail-on: high`
becomes `--fail-on high`, `online: true` becomes `--online`,
`require-frozen: false` becomes `--no-require-frozen`, and a list becomes
one flag per entry. The handful of flags the umbrella supplies itself (the
JSON format flag, `--staged`, and the intent gate's `--project`) are
rejected if you also set them, rather than being silently overridden.

**There is no shared severity threshold, on purpose.** One top-level
`failOn` would read as one decision and mean three different things, so
setting one is an error rather than a knob that half works. Each gate keeps
its own threshold in its own `options` block, spelled the way that gate
spells it.

**`command`** takes an absolute path and overrides binary resolution for
that gate, for pointing at a build that is not installed anywhere.

**`report.format`** is `text` or `sarif`, and `--format` overrides it.

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
- `--gate <role>`, repeatable. A gate the policy file enables and this flag
  leaves out is named as excluded, on one line in the text report and as a
  `conductor/gate-excluded` notification in the SARIF log's `conductor` run.
  It never reaches the exit code.

### Exit codes

- **0** every enabled gate ran and none blocked.
- **1** every enabled gate ran and at least one blocked.
- **2** an enabled gate could not run: its binary is missing, it exited with
  its own could-not-run code, or it exited 1 with nothing parseable on
  stdout, which is what a rejected config file looks like from two of the
  three.

## Intent at a pull request

The intent gate is the only one of the three with any ceremony: its native
flow wants a contract approved before the work starts, which is a per-task
human step. That step is exactly what a pull request cannot carry, so at the
`ci` stage the umbrella stands in for it.

**What it measures.** With `--base <ref>`, the changed-path set is what this
branch changed since it forked, from
`git diff --name-only --no-renames <base>...HEAD` in the repository root.

With no `--base`, `GITHUB_BASE_REF` is used as `origin/<value>` when it is
set, and the text report says so. With neither, the intent gate runs the way
it does at a commit: against the staged index, or the paths you name.

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
   event payload at `GITHUB_EVENT_PATH`. A path here that is not on disk, or
   one that leaves the repository, falls through to the next rule.
   `Spec: none` is a **waiver**: it says this pull request deliberately has
   no spec, so rule 4 is not tried and the gate reports itself skipped with
   `intent-guard/contract-waived` instead of `intent-guard/no-contract`. The
   token is exact and lowercase, a frozen contract at rule 2 still wins over
   it, and `--spec` at rule 1 still overrides it.
4. A markdown file **directly under** `docs/superpowers/specs` whose name
   relates to the branch. The branch slug is the branch name with its first
   segment (`feat/`, `fix/`) removed; a filename is reduced by stripping a
   `YYYY-MM-DD-` prefix and a trailing `-design`; the two are candidates when
   either contains the other. Several candidates are ranked: a stem **equal**
   to the slug first, then the **longest** stem, and only then the newest
   name, which is a lexical tie-break, so **date every spec**.

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
wherever they meet it.

**A waiver is a decision, recorded by whoever wrote the pull request body,
and that includes a contributor from a fork.** On the ordinary path, where a
repository has no frozen contract of its own, `Spec: none` means the intent
gate does not run at all on that pull request, and budget breaches are the
thing this gate blocks on. The one thing a waiver cannot override is a frozen
`.conductor/intent-contract.yaml`, which is checked first: a repository that
wants the gate to be non-waivable freezes a native contract and keeps it
committed.

**What blocks is unchanged.** Blocking stays where intent-guard puts it:
budget breaches block, subject to `enforce`. Drift on its own is reported and
not blocked, which is already intent-guard's own behaviour. The umbrella adds
no severity threshold of its own here either.

## The Action

`action.yml` at the root is a composite action that runs the gates at the
`ci` stage and writes one SARIF log for the caller to upload.

It **installs nothing**, on purpose. It runs the conductor your repository
already depends on, so the version gating your pull requests is the one your
lockfile pins rather than whatever the registry serves that morning; instead
of installing, the action checks for `node_modules/.bin/conductor` and fails
with a sentence saying to add it as a devDependency. `--base` is passed only when the
`base-ref` input names one; left empty, the umbrella reads `GITHUB_BASE_REF`
itself and treats an empty value as "not a pull request", which is what a
push build wants.

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

The `@v4` pins there are readable, not safe: a tag moves, so pinning by one
runs whatever its author pushes to it next. Pin every third-party action by
commit digest in a workflow you actually run, the way this repository's own
workflows do.

### The report as a pull request comment

The SARIF upload produces no alerts on a private repository without GitHub
Code Security, which is why that step carries `continue-on-error`. A comment
is free there. Add `pull-requests: write` to the job's `permissions` and this
step after the gates. It **runs the gates a second time**, because the Action
writes SARIF and nothing else, so the job costs roughly twice the gate time;
`--verbose` because a clean run otherwise collapses to one line.

```yaml
      - name: Comment the report on the pull request
        # always: the report is most worth reading on the run that failed,
        # and the gates step has already failed the job by then.
        if: always()
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
        # || true: a blocking finding is a non-zero exit, and that verdict
        # belongs to the gates step rather than to this one.
        run: |
          node_modules/.bin/conductor run --stage ci --format text --verbose --output conductor.txt || true
          gh pr comment "$PR" --body-file conductor.txt
```

**Mirror whatever you gave the Action**, or the two runs can report different
contracts. The step above matches the example, which passes neither
`base-ref` nor `spec`, so both runs read `GITHUB_BASE_REF` and the `Spec:`
line out of the job environment themselves and land on the same contract. If
you set either input on the gates step, pass the same values here as `--base`
and `--spec`; if you do not, the comment is a report of a contract source the
uploaded log never used.

**On a pull request from a fork the token is read-only**, so `gh pr comment`
fails, `continue-on-error` swallows the failure, and no comment appears on
exactly the pull requests a reviewer knows least about. Nothing here fixes
that: `pull_request_target` runs with a writable token and the base
repository's own workflow, which is a different security decision to take on
purpose rather than a flag to add.

This is a substitute for code-scanning alerts, not the same thing. A comment
is one snapshot of one run: no per-finding state, nothing to dismiss, no
history between runs, and a new comment every time rather than an alert that
closes when the finding goes away.

## What is in and what is out

In: the policy file and its schema, `init` with dry-run, revert, and adopt,
`run` producing the combined text report and a combined SARIF log, the
composed exit code, per-gate `stage` and `enforce`, `run --stage`, the intent
gate at a pull request (`--base`, `--spec`, the imported contract, the
no-contract advisory), and the composite Action.

Out, deliberately: a unified baseline or ledger (each gate keeps its own, and
their fingerprints are not equally durable, so one shared file would expire
entries silently for one product and not another), an MCP registration,
running the gates concurrently, and any finding of the umbrella's own about
anybody's CODE. The findings it does raise are all about the gates
themselves: `conductor/gate-missing`, `conductor/gate-output-unparseable`
and `conductor/gate-failed`, plus the two diagnostics
`conductor/blocking-count-mismatch` and
`conductor/blocking-threshold-unknown`.

Also out: intent at the cohesion level, which is what a merge or a
promotion would want and which the audits do by hand today; and anything that
runs inside an agent session or on save, which intent-guard's own optional
session hooks already cover.

This is a young tool rather than a finished one. The gates are still the
product; this is the convenience layer over them.

## Design notes

The reasoning behind the decisions above lives in
[docs/design-notes.md](docs/design-notes.md): the digest ladder that lets a
re-install replace an older hook, how husky and lefthook are recognised and
why one of them is refused, what the hook says on each exit code, why a clean
report collapses to one line, the rule separating a SARIF notification from a
SARIF result, how the exit code is composed, and the mechanism behind the
intent gate at a pull request. Several of them were learned from running this
tool against real repositories rather than reasoned out in advance.

## License

MIT, [Vault & Compass](https://vaultcompass.io)
