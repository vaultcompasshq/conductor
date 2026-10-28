# The pull-request trust boundary

Moved here from the README. Back to the [README](../README.md).

Every gate reads its own rules out of the repository it is judging. On a pull
request the author controls that repository, so without this a pull request
could turn a gate off in the same commit that carries the thing the gate
exists to catch, and the report would say the run was clean. For the umbrella
the sharpest version is `command:`, which names a program to run: a pull
request could point a gate at a script it added in the same commit.

**On a pull-request run the rules come from the base branch.** With
`--trust-base <ref>` the umbrella reads `.guardrails.yaml` from that ref with
git and judges the head tree against it. A trusted file at the base that git
cannot read as a regular file (a symlink, a directory, a submodule, or a file
below a symlinked or submodule directory) is could-not-run, never replaced by
a default. Clear it by making the file a regular file on the base branch; the
pull request that does so is judged against that same base, so it has to be
merged by someone allowed to merge without this check passing. A `.guardrails.yaml` in the
pull request never takes effect for that run, `command:` and `args:`
included, so **a pull request cannot change the rules it is judged by, and
cannot choose the program that judges it, as long as that program is
self-contained** (see the directory rule below). "The program" includes a
script handed to an interpreter: with `command: /usr/bin/node` and
`args: [tools/gate/run.mjs]`, the script is what judges, and it is vetted
exactly as a `command:` inside the tree would be. The same ref is passed
down to every gate that supports it, so their contracts, configs and
baselines come from the base branch too.

**The program is checked as well as the rules.** Reading the rules from the
base ref is worth nothing if the pull request supplies the binary that
applies them, and without this it could, two ways that both look ordinary in
a diff: a base `command:` pointing at a path inside the repository, where the
head replaces the file behind the approved path; and no `command:` at all,
where a head-committed `node_modules/.bin/<gate>` shadows the real gate,
because resolution prefers the repository's own copy over PATH so that a
project pin beats a global install.

**On a pull-request run `node_modules/.bin` is not consulted at all.** That
second shape is closed one step earlier than the first, and this is why: what
is installed there is chosen by the head's own manifest and lockfile, so it is
never approved by any ref, and a repository whose gates are devDependencies
would otherwise meet the program refusal on every ordinary pull request. So
that location is simply not searched when a trust base is set. PATH and an
absolute `command:` remain, and both still go through the program check below.
The skip is never silent: one line in the full report and one
`conductor/node-modules-skipped` note in the SARIF log name each gate and the
copy that was not taken, and a gate with nothing on PATH either is
could-not-run with `npm install -g` and the Action's version input named as
the remedy. **Outside pull-request mode nothing changes**: your own checkout
and your pre-commit hook still run the pin, which is what `pnpm exec` does in
the same repository.

**The versions that judge a pull request are pinned in the workflow file**,
and that is the point: the pull request can change its own lockfile,
manifest and `node_modules`, and none of those decide which conductor and
which gates run over it any more. Be clear about what that does not cover.
On a `pull_request` event GitHub runs the workflow as it is in the pull
request's merge commit, so a pull request that edits the workflow file can
change the pins or remove the gates step, exactly as it could rewrite any
other step in your CI. The boundary here is against the tree choosing its
own judge; the control for a workflow edit is branch protection on your
base branch with review required for `.github/workflows`, and no action can
provide that for you. Only `pull_request_target` runs the base branch's copy
of a workflow, and that event exposes the base's secrets to the pull
request's code, which is the wrong trade for a gate over untrusted changes.

One part of that is closed, and only one. Because the pins are written in a
file the pull request controls, a pull request could otherwise pin a gate
**backward** to a published version that predates the rule which would have
caught it: an exact version, so the validate step's shape check accepts it,
and a change that reads as ordinary version management. **On a pull request
the action now refuses any of the four `*-version` inputs naming a version
below the one the action tag ships.** Pinning forward is still accepted.
See [The Action](../README.md#the-action).

So on a pull-request run a gate's program must be **outside the working tree**
(on PATH, or an absolute `command:` elsewhere on the machine), or else meet
**both** of these:

- it is a **tracked regular file whose contents are identical** at the base
  ref and at the head commit; and
- **the tree object id of its containing directory is identical** at those
  two refs, which is to say the pull request changed nothing anywhere in that
  directory's subtree.

Both are compared with `git ls-tree` on both refs and never read from the
working tree. The second is not belt and braces. A vendored gate is rarely
one file: `vendor/vault-guard` execs `vendor/impl.sh`, and a pull request
that leaves the wrapper byte for byte alone and rewrites the helper beside it
passes a per-file check while running its own code. Comparing the directory
covers every file under it at once, without this tool having to know what a
wrapper calls.

**What is and is not vetted**, exactly: the program file and everything in
its directory subtree. Anything the program reaches **outside** that
directory is not vetted at all, so an in-repo gate must be **self-contained
within its own directory**. A program at the repository ROOT is refused, and
the message says to give it a directory: at the root the containing directory
is the whole repository, so the rule would mean "no pull request may change
anything".

**In-tree script arguments are vetted too.** Since 0.15.0 every entry of a
gate's `args:` that names something inside the working tree goes through the
same rule as the program, because an interpreter `command:` (Node, Python, a
shell) takes the program it runs as an argument. Before that, a base policy
of `command: /usr/bin/node` with `args: [tools/gate/run.mjs, scan]` let a
pull request rewrite `tools/gate/run.mjs` and report itself clean. Exactly
what counts:

- An entry is resolved against the repository root. Everything an
  interpreter could load for it is vetted: the entry as written, and every
  `<entry>.js`, `.mjs`, `.cjs`, `.json` or `.node` beside it, with or
  without a slash. Node loads `tools/gate.js` before the directory
  `tools/gate/`, and runs `run.js` for a bare `run`, so a sibling file the
  pull request adds is refused because the base does not have it.
- A file (or a symbolic link) must meet the two conditions above; a
  directory must have the same tree object id at the base and the head; the
  repository root itself (`.`) is refused, since conductor already hands
  each gate the repository it scans. A directory's `package.json` `main`
  that points outside the directory is not vetted.
- `--name=value` is read for the value, so `--config=tools/gate/rules.json`
  and `--import=./tools/gate/hook.mjs` are vetted. An option with no `=` and
  a word that names nothing on disk are not paths and are never refused.
- The gate's own subcommand words (`scan`, `git`, `source`, `check`) are not
  read as paths only when `command:` is the gate itself (its file name is
  the gate's name, such as a vendored `vault-guard`). For an interpreter
  they are paths like any other word: `node scan` runs `scan/index.js`.
  A renamed gate binary, or any wrapper whose name is not a gate name, is
  treated as an interpreter, so its `scan` or `source` is vetted if a file
  or directory of that name exists, and a pull request touching it is
  refused.
- Not recognised as a path, and **not** vetted: a Python `-m` module name, a
  bare package name an interpreter resolves for itself, code passed as a
  string (`node -e`, `bash -c`), and a package runner such as `npx`, which
  resolves the gate from the head's own `node_modules`. Name the script by
  its path, and do not run a gate through a package runner on pull requests.
- The sibling extensions tried are Node's (`.js`, `.mjs`, `.cjs`, `.json`,
  `.node`). A TypeScript runner such as `tsx`, `ts-node` or `bun` also
  resolves `.ts`, `.mts` and `.cts`, which are not tried, so name a
  TypeScript script with its extension (`tools/gate/run.ts`, not
  `tools/gate/run`).
- A script outside the working tree is accepted, as a program there is.

The version probe asks the script, not the interpreter: the args up to the
first non-option entry, when that entry names something loadable, then
`--version`, so `node tools/gate/run.mjs scan` is asked `node
tools/gate/run.mjs --version` and `node tools/gate` is asked `node
tools/gate --version`. The version conductor reports and checks against an
expected-version pin is then the gate's own. When the first non-option
entry names nothing loadable, or the command is the gate itself, the probe
is the command's own. One shape still reports the interpreter's version: a
flag that takes a file as its own entry before the script (`node -r
./setup.js tools/gate/run.mjs`) makes `./setup.js` the first entry, so the
probe is `node -r ./setup.js --version`; under an expected-version pin that
gate is could-not-run. Write `--require=./setup.js` instead.

A symlink inside the repository is refused on **its own entry**, before its
target is considered: it is either untracked, or its tree entry is a link
rather than a regular file, and either refuses. (A symlink whose own path is
outside the tree but which points into it has its target vetted; that is the
case following the link exists for.)

Anything else is could-not-run for that gate, naming the path, and it reaches
the exit code even where the policy sets `enforce: false`, because the gate
produced no findings to un-enforce: the umbrella declined to run a program
the pull request chose.

Nothing under `node_modules` is ever base-approved, which is why the rule
above does not look there at all. Were it to look, the answer would always be
the same refusal: what is there is chosen by the head's own manifest and
lockfile and installed by a step that runs before the gates, so git has no
record of those bytes at either ref. A pull request that edits its lockfile to
pull a different build of a gate has chosen its own judge just as surely as
one that commits a stub. **Vendoring a gate still works**, on those
terms: put it in its own directory, keep everything it needs inside that
directory, and leave the whole directory alone in a pull request the gate is
meant to judge. Changing it is not forbidden, it just has to land on the base
branch first, like any other rule change.

**A change to the rules is not refused, it is proposed.** Rules legitimately
change, and a gate that blocked every such pull request would train people to
bypass it. So a policy file that differs from the base ref's is reported as
one line per changed key, `policy: gates.<role>.<key> <old> -> <new>`, counted
as one proposal each; a head `.guardrails.yaml` that is absent or does not
parse gives one line saying its changes are not known, and when no effective
key differs (a default spelled out, or the YAML reordered) the old single line,
`policy changed in this pull request`, is kept. The run continues under the
base ref's rules, and the change takes effect **after merge**, on the first
run whose base branch carries it. The gates' own proposals are summed with it
into one sentence, `N control change(s) proposed in this pull request`, on the
one-line summary and on the verdict, with a line each under `--verbose` and a
`conductor/control-change-proposed` notification each in the SARIF log. A
reflow, a re-quote or an edited comment is not a proposal: the two files are
compared as parsed documents.

**An explicit `--trust-base` redirect gets a refusal on a pull request, at two
places (issue #58), and neither closes the whole hole by itself.**
`refuseTrustBaseRef` above only refuses a ref that resolves to HEAD's own
commit or to HEAD's own tree, which covers HEAD itself and an *unmoved*
`origin/<pr-branch>`. Once the base branch has moved, `origin/<pr-branch>` no
longer matches either test, so a same-repo pull request could set
`trust-base` to its own branch, in its own workflow file, and have conductor
read `.guardrails.yaml` from the pull request after all, at which point the
pull request controls the whole policy. dep-guard's own base input took the
stronger line for its base input in 0.8.0: on a `pull_request` event an
explicit value is refused outright.

**The Action refuses an explicit redirect on `pull_request` and
`pull_request_target` events.** Its validate step refuses a `trust-base`
input outright on those events, naming the value given and the fix, which is
to remove the input; see [The Action](../README.md#the-action).

**The CLI check catches a misconfigured or innocent-looking redirect when
`GITHUB_BASE_REF` is set**, for anyone invoking the CLI directly in CI. When
that variable is set, an explicit `--trust-base` is accepted only when it is
`refs/conductor/trust-base`, the private ref the Action fetches the base
branch into and always passes (that ref is the authority and is not compared
with anything), or resolves to the same commit as
`refs/remotes/origin/$GITHUB_BASE_REF`. So an ordinary pull-request run is
unaffected. A ref naming the pull request's own branch, or anything else that
disagrees, is refused with both refs and both commits named, through the same
could-not-run path as every other trust-base refusal: exit 2, the report
leads with the reason, and nothing is checked. A short name that matches both
a tag and a branch or remote-tracking ref (a tag named `origin/main`) is
refused as ambiguous: spell the ref in full. When neither resolves, this fails
closed too, naming it, for the same reason the fetch-depth remedy below
exists.

**Neither layer closes anything against a pull request that edits its own
workflow file.** A CLI invocation on a pull request can simply omit
`--trust-base`, or a workflow step can blank `GITHUB_BASE_REF` in its own env,
and nothing here refuses either; the Action has the matching gap, since a
pull request can pin `uses:` to a tag published before this fix, in its own
workflow file. This is exactly the boundary "On a pull request those four
inputs may not pin backward" (in [The Action](../README.md#the-action)) already draws for
the four `*-version` inputs: the control for a workflow edit is branch
protection on the base branch with review required for `.github/workflows`,
and nothing in this section, or in that one, substitutes for it.

**It fails closed.** A `--trust-base` that does not resolve is not a reason to
fall back to the pull request's own file, because that fallback is the hole:
the run exits 2 and the report **leads with the refusal**, naming the ref and
the remedy, whether or not it can name any gate. That last part matters: with
no base ref there is no base policy, so the only list of gates available is
the head's, and a head that switches every gate off leaves it empty. So is a
base ref that resolves to the head commit, or to a different commit carrying
the head's tree, both of which would put the rules back inside the tree being
judged while still reporting pull-request mode as on. Pass the base
**branch**, never a SHA: on a `pull_request` event `github.sha` is the merge
commit, which is HEAD. If the base branch has no `.guardrails.yaml` at all,
the run has no rules and exits 2 rather than using the pull request's; the
file the pull request adds decides what runs once it is on the base branch.

**One narrow exception to the equal-tree refusal (issue #69).** When a pull
request's net diff is empty -- a value committed and then backed out inside
the same pull request -- the merge ref GitHub builds has a tree
byte-identical to the base's, and the refusal above would stop
secrets-history from running on exactly the shape it exists to catch: the
value is gone from the tree but still in the history between the base and
HEAD. So the refusal makes one exception, and only one: when HEAD is a real
merge commit (two or more parents) and `--trust-base` resolves to HEAD's
**first** parent, the run is not refused. First-parent identity is the
discriminator, not ancestry, because GitHub always builds the merge ref with
the base branch as the first parent and the pull request's own head as the
second: a trust base resolving to HEAD's **second** parent is also an
ancestor and also carries the same tree, and it is exactly the ref this rule
must keep refusing. In the accepted shape the umbrella still does not judge
the unchanged tree as if it were the change: it runs every enabled gate
whose input is git history rather than the tree -- gitleaks today -- with its
ordinary arguments (already scoped to `<base>..HEAD`), and every other
enabled gate is reported as tree-unchanged rather than spawned: one line in
the full report, a clause on the one-line summary, and a
`conductor/tree-unchanged` notification in the SARIF log, never reaching the
exit code. Every other equal-tree shape -- a non-merge HEAD, the second
parent, any other ancestor -- keeps refusing exactly as before.

The exception needs HEAD's own parents, so it needs the same non-shallow
checkout the rest of pull-request mode already requires: `fetch-depth: 0`
(see below). On a depth-1 checkout git reports the merge commit with no
parents at all, so the first-parent check cannot match and the run keeps
refusing with the ordinary equal-tree message -- it fails closed rather than
guessing. That loss costs nothing real: at depth 1 gitleaks could not have
seen the backed-out commit either, since its own history scan has nothing
before HEAD to scope `<base>..HEAD` against.

That is why adopting conductor takes one merge before the gates can judge
anything, and it is not an oversight: the policy file can name a program to
run, so a run that read it from the pull request would let the pull request
choose its own judge on exactly the repositories that have no rules yet. See
[Adopting conductor](../README.md#adopting-conductor-the-careful-path) in the
README for the sequence and for how to see what your policy will do before you
merge it.

**Which gates are covered.** All five: dep-guard from **0.10.1**,
intent-guard from **1.8.1**, vault-guard from **1.9.1**, and the two
external gates at their command-line floors, gitleaks **8.19.0** and
osv-scanner **2.0.0**. On a pull-request run an older family gate is
could-not-run rather than run outside pull-request mode.

**The external gates get their pull-request mode from the umbrella.**
Neither tool has a `--trust-base`, and both auto-load a config from the tree
they scan, which on a pull request is the head: a pull request could add an
allowlist entry for exactly the secret or advisory it introduces. So on a
pull-request run the umbrella reads `.gitleaks.toml` and `osv-scanner.toml`
from the base ref with `git show` and passes each tool that copy with
`--config`. When the base has none, the tool gets a neutral one (gitleaks'
built-in rules, an empty osv-scanner config) rather than nothing, because
nothing would let it find the head's file on its own. gitleaks'
`.gitleaksignore` is handled the same way, and because gitleaks also loads
the ignore file at the root of whatever it scans, the umbrella scans the
repository's git directory instead of the working tree on a pull request:
the same history, without the head's ignore file. A head-side change to any
of these files is reported as a proposal line and takes effect after merge,
exactly like a change to `.guardrails.yaml`. History is scoped to
`<base>..HEAD` on a pull request and to `HEAD` locally, so a secret on
another branch never reddens this one. Merge commits are scanned by their
first-parent diff, so a secret added inside a merge (while resolving a
conflict, say) is found; the same leak seen in a pull request's commit and
again in its merge is reported once, with the other commit listed.

A base `.gitleaks.toml` can name another file with `[extend] path`, which
gitleaks resolves against its working directory. On a pull request
conductor copies every file in that chain from the base ref into a
directory of its own and runs gitleaks from there, so the head's copy of an
extended file is never read; a head-side edit to one is a proposal, and an
extended file the base does not have makes the gate could-not-run, naming
it. gitleaks' log level is pinned at `info` and `log-level` is reserved,
because conductor reads gitleaks' error lines to tell a failed scan from a
clean one. Write the extend as a plain relative path in an `[extend]` table:
a base `.gitleaks.toml` whose extend target is a symbolic link, or which
writes the extend as an inline table or a quoted key, fails closed on every
pull request until it is rewritten that way.

**Local runs and `.gitattributes`.** On a pull request gitleaks scans the
repository's git directory, where the head's `.gitattributes` is not read.
A local run scans the working tree, so a file your own `.gitattributes`
marks `binary` is skipped by gitleaks there. Pull requests are not affected.

On a pull request gitleaks is also passed `--ignore-gitleaks-allow`, so an
inline `gitleaks:allow` comment does not hide a secret: an inline allow
lives in the tree being judged, so the pull request controls it. A
legitimate allow belongs in the base branch's `.gitleaks.toml` allowlist or
`.gitleaksignore`, both of which conductor already reads from the base.
Local runs keep inline allows.

osv-scanner is never pointed at a directory to walk, because its own walk
skips anything `.gitignore` matches, tracked or not, so one ignore line in a
pull request could hide a committed lockfile. conductor lists the tracked
lockfiles with `git ls-files` and hands each one over with `--lockfile`. On
a pull request that list comes from the head's index, not the base ref: the
lockfiles are the tree being judged, and adding or removing one is visible
in the diff. Only the root `osv-scanner.toml` is read from the base and
passed with `--config`, which overrides any nested one for the run; a
nested one the pull request adds or edits is reported as a proposal.

The umbrella asks each gate its version before it runs it. On a run with a
trust base, a gate older than its pull-request-mode minimum (intent-guard
1.8.1, vault-guard 1.9.1, dep-guard 0.10.1) is could-not-run (exit 2),
never run without the flag: without it the gate would take its rules from
the tree being judged. The fix is to install that minimum or newer, or to
remove an explicit older version pin. A version that cannot be read at all
is could-not-run too: the umbrella cannot establish that the gate would
take its rules from the base ref. The one gate that runs without the flag
is an intent gate judging a contract imported from the base for the run,
whose project is a temporary directory with no repository to resolve a ref
in; that is never silent: it gets a line in the report, a clause on the
clean one-line summary, and a `conductor/trust-base-not-passed`
notification in the SARIF log.

Outside pull-request mode nothing changes. A pre-commit hook and a direct run
on your own checkout are already inside the trust boundary, and neither passes
the flag.

**In CI, pull-request mode needs a trust base.** A run in GitHub Actions with
`GITHUB_BASE_REF` set and no `--trust-base` is could-not-run (exit 2): its
rules have to come from the base branch, and no base was named. Pass `--trust-base
refs/remotes/origin/<base branch>` with `fetch-depth: 0`, or use the Action,
which always passes one. A pre-commit hook run inside a pull-request job hits
this too: skip the hook in CI, or pass the trust base to it.

**On a pull-request run PATH holds only absolute entries, and conductor's own
git comes from outside the repository.** Empty and relative entries are
removed for conductor and every gate it starts, with one notice naming them,
and conductor runs the first git on PATH that lives outside the repository's
work tree; with none, the run is could-not-run and says to put git's own
directory on PATH. A gate found only through a removed entry is reported
missing; put it on an absolute PATH entry or name it with an absolute
`command:`. Every gate conductor starts, and everything a gate starts, gets
a PATH whose first entry is a private directory outside the repository
holding only that same git, so a gate that runs git by name runs it too; on
Windows no such directory is made and the gates look git up through the
cleaned PATH, and a system temp directory inside the repository is
could-not-run until TMPDIR names one outside it.

**git 2.31 or later** is needed on a pull-request run with the secrets-history
gate (gitleaks) enabled, because conductor hands it `git log --diff-merges`,
which arrived in git 2.31. Only that gate checks: an older git makes it
could-not-run, naming the version, and the other gates run.

## Trying pull-request mode locally

To see roughly what CI would say about a branch, check it out and name the
base as the trust base:

```
conductor run --trust-base refs/remotes/origin/main --verbose
```

`--trust-base` takes any ref git resolves in your clone, so use a clone with
the base branch present (the CI recipes use `fetch-depth: 0` for the same
reason). With no `GITHUB_BASE_REF` set, as on a laptop, the change set for the
intent gate is measured from the trust base, so `--base` is optional; add
`--base <ref>` to measure from a different ref. Add `--stage ci` to run at
the stage the Action runs at.

The gotcha is the same locally as in CI: the policy and the other control
files are read from the base ref, not from your working tree. A local edit to
`.guardrails.yaml` has no effect on a `--trust-base` run until the change is
on the base; it shows up as a proposal line in the report instead. To preview
a policy edit, run `conductor run` without `--trust-base`, as in
[Adopting conductor](../README.md#adopting-conductor-the-careful-path).

Where the proposals appear under the Action: the job log gets a
`conductor: N control change(s) proposed in this pull request.` line followed
by one `conductor: proposed <product> <line>` line per proposal, and the step
summary gets the same count and up to 50 proposed lines under `control
changes:` in a text block, with a `(n more in the report)` line when there are
more. This does not depend on `pr-comment`. A proposed line that holds a
backtick or a character outside printable ASCII is replaced by a placeholder.

### The preview under the proposed rules

A pull request that switches a gate on or off, or moves its `stage`, is judged
under the base's rules, so the author would not otherwise see what the
proposed rules say until after merge. With the preview, each role whose
`enabled` or `stage` changed runs once more (a role the head switches off is skipped), after the verdict, under the base
policy with only `enabled`, `stage` and `enforce` taken from the head. Every
other head value, `command:`, `args:`, `options` and `timeout-seconds`
included, never reaches it: the base's command and the base's limit are what
run, and a base `command:` that resolves inside the working tree is refused
there, as is a base `args:` entry that names a path inside it (an
interpreter's script). A gate's own config is another matter: in the preview, dep-guard and
vault-guard read their own `.dep-guard.json` and `.vault-guard.json` from the
head, because previewing the proposed rules means their rules too, while
gitleaks and osv-scanner keep the base's config. osv-scanner call analysis is
refused in the preview, because it would build the head's code. The intent
gate is deferred and not previewed.

**The preview decides nothing.** The exit code, the verdict token and the SARIF
results are those of the run under the base rules, whatever the preview finds
or however it fails. In the full report (`--verbose`, the form the Action
reads) the first four lines are untouched; in the one-line clean form the
primary report is a byte-for-byte prefix and the preview follows it. It prints after
the verdict under `Preview under the proposed rules (does not affect the
verdict)`, as `conductor: preview ...` lines in the job log, as note-level
`conductor/preview-under-proposed-rules` notifications on the umbrella's SARIF
run, and as one `preview: N gate(s), M finding(s), K could-not-run` line in
the step summary. The whole preview has a hard deadline of 300 seconds; a
gate reached with no budget left is listed as over budget, and one that starts and is killed at the deadline is could-not-run (timed-out). A gate section in the preview
uses the same words as a primary section, so a finding may read `BLOCKING`
there: it means the finding would block under the proposed rules, and it does
not affect this run. A pull-request comment is cut at 60000 characters, the
preview block first. Every character outside printable ASCII in the preview
(in the report, the job log and the SARIF notes) is written as a `\uXXXX`
escape, because a gate there can read text the head chose, a
right-to-left override in a pattern name included. The primary text report
escapes finding file paths the same way, since a pull request names its own
files; other primary gate text, and every path in the SARIF log, is printed
as the gate gave it.

Ask for it with `--preview` on `conductor run`, or with the Action's `preview`
input, which defaults to `true`; any other value turns it off. There is no
preview when the head `.guardrails.yaml` does not parse.
