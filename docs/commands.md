# Commands

Moved here from the README. Back to the [README](../README.md).

`conductor init` writes the policy file and `.guardrails/manifest.json`, the
record `--revert` reads back later. The manifest currently records absolute
machine paths rather than repo-relative ones (see
[Adopting conductor](../README.md#adopting-conductor-the-careful-path)); do not
commit it. When git does not already ignore it, init appends
`.guardrails/` to `.gitignore` (or creates one) and says so; a `.gitignore`
that is a symbolic link or not a regular file is left alone and the line is
printed for you to add. On a policy file that already exists, init lists the
gate roles it has no entry for, with the two lines that add each. An external
gate (gitleaks, osv-scanner) is written enabled only when its binary is found
on the machine running init, with a comment under it that CI must install it;
a CI job without it gets `conductor/gate-missing` and exit 2.

- `--hook` also writes one pre-commit hook running every enabled gate whose
  stage is `commit`. Without it, init writes only the policy file and the
  manifest: no hook, and none of the hook-manager detection below runs
  either. `.git/hooks` is never part of a clone, so a hook one checkout has
  does not follow a teammate's clone, or a fresh clone of your own; each
  needs its own `conductor init --hook`. `--revert` still removes a hook a
  previous `--hook` run left behind, whether or not this invocation passes
  `--hook` itself.
- `--dry-run` prints every file it would write or change and writes nothing.
- `--revert` removes exactly what a previous init wrote, and nothing else.
  A file changed since init is reported and left alone. The one exception is
  the `.guardrails/` line init appends to `.gitignore`: `--revert` does not
  remove it.
- `--adopt` replaces one gate's own pre-commit hook with the umbrella hook.
  Without it, init reports the collision and stops rather than stacking a
  second invocation of a gate that is already hooked. A hook the umbrella
  does not recognise is never replaced, with or without `--adopt`. Only
  meaningful together with `--hook`; without it, init errors rather than
  silently ignoring the flag, because there is no hook for it to act on.
- `--force` acts on a file **conductor itself wrote** and that has changed
  since: on its own it replaces a managed hook somebody has edited, and with
  `--revert` it removes one, restoring an adopted hook if there was one. It
  never overrides a foreign-hook or gate-hook refusal, with or without
  `--adopt`: those hooks were never conductor's, and no flag here turns
  somebody else's file into one this tool may overwrite. Like `--adopt`,
  only meaningful together with `--hook` on an init (not on a `--revert`);
  without it, init errors.
- `--project <dir>` writes into that repository instead of the current
  directory, resolved to its git top level the same way the current
  directory already is, so a script can point init at a repository without a
  `cd` compound.

The rest of this section, on hook managers already wired into the
repository, applies only when `--hook` is given: none of it is consulted,
and none of it can block the policy file from being written, on a plain
`conductor init`.

Init recognises the hook manager already wired into the repository. husky is
redirected to the tracked hook it maintains rather than the generated
dispatcher git runs. On a fresh clone, where husky's install has not set
`core.hooksPath` yet, husky is recognised from `package.json` (a `husky`
dependency or devDependency, or a `prepare` script that runs husky) or a
tracked `.husky/` directory, and init writes `.husky/pre-commit` and says the
install still has to run, rather than writing `.git/hooks/pre-commit`, which
husky's install would bypass. This applies only when `core.hooksPath` is not
set at all: one set by hand, even to `.git/hooks`, is left alone. A prepare
script counts only when it runs husky as a command. lefthook and the pre-commit framework are refused, with
the stanza to add to their own config file. simple-git-hooks and yorkie are
refused too, and recognised from the declaration as well as from the hook
file, because the declaration is there on a fresh clone where the generated
hook is not yet: the `simple-git-hooks` or `gitHooks` key in package.json, or
any of the standalone config files simple-git-hooks reads. Their hook text
lives in package.json, which conductor does not write, so the guidance names
the entry to add and `--force` does not override the refusal.

That refusal applies only where git actually runs `.git/hooks`. Both managers
write that directory and neither reads `core.hooksPath`, so a repository that
has pointed git somewhere else has taken their file out of play, and init
proceeds normally without mentioning them.

`conductor run` runs every enabled gate and prints one report.

- `--staged` gates the git index against HEAD, which is what the hook does.
- `--format text|sarif`.
- `--stage commit|push|ci` runs the gates at that stopping point and every
  earlier one. With no `--stage` at all, every enabled gate runs, whatever
  its stage. An unknown value is a usage error and exits 2 rather than
  quietly running everything or nothing: a typo in a CI file that runs every
  gate and one that runs none both look like a passing build.
- `--base <ref>` measures the intent gate against what this branch changed
  since `<ref>`, rather than against the index. See
  [Intent at a pull request](intent-at-a-pull-request.md).
- `--trust-base <ref>` reads the **rules** from `<ref>` instead of from the
  tree being judged: this repository's own `.guardrails.yaml`, and every
  control input of the gates that support it. See
  [The pull-request trust boundary](pull-request-trust-boundary.md).
  `--base` and `--trust-base` are independent and a
  pull-request run passes both: `--base` decides which paths are judged,
  `--trust-base` decides what they are judged by. When `GITHUB_BASE_REF` is
  set, an explicit `--trust-base` is accepted only when it resolves to the
  same commit as `refs/remotes/origin/$GITHUB_BASE_REF`, or is the Action's
  private `refs/conductor/trust-base` (issue #58); anyone invoking the
  CLI directly on a pull request, rather than through the Action, gets this
  as its own refusal, named in that section.
- `--spec <path>` names the spec the intent gate imports its contract from.
- `--output <path>` writes the report to a file instead of to stdout, for a
  CI step that uploads it. One line still goes to stdout, because a job whose
  only product is an uploaded artifact otherwise reads as a job that did
  nothing. A path that cannot be written is exit 2, not a green run beside a
  report nobody can read. A relative value resolves against the current
  directory the command was invoked from, not against `--project` or the
  repository root: with `--project` pointing elsewhere, a relative
  `--output` still lands next to where you are, not next to the repository
  being judged.
- `--text-report <path>`, with `--format sarif`, also writes the text report
  to that file **from the same run**: exactly what `--format text` would have
  rendered for this result (`--verbose`, `--compact-on-refusal` and
  `--advisory` respected), and no gate is run a second time. This is how the
  Action gets a SARIF log, a comment body and a verdict token that are one
  run's answer. With `--format text` it is refused as a usage error (exit 2),
  before any gate runs: the text report is the output already, so a second
  copy in a file would only duplicate it. A path that cannot be written is
  exit 2, like `--output`. See "The verdict token" below.
- `--verbose` prints the full per-gate report even when the run is clean.
  Text output only; the SARIF log never changes shape with it. Without it a
  gate prints its first 20 findings, blocking first, and one line saying how
  many more there are; every count, the verdict and SARIF include all of
  them. `--verbose` also lists the lockfiles behind an osv-scanner line
  that groups one advisory across several ("lodash@4.17.20 2 lockfiles
  fix 4.17.21"). A gitleaks finding shows its short commit and the
  fingerprint `.gitleaksignore` takes.
- `--compact-on-refusal` shrinks the report to the version, the verdict and
  the refusal reason when the trust base was refused and no gate ran,
  instead of the full per-gate report. Built for the pull-request-comment
  step. It has no effect on a run that was not refused, whatever `--verbose`
  says. Text output only; it has no effect on the SARIF log and never
  changes the exit code.
- `--gate <role>`, repeatable. A gate the policy file enables and this flag
  leaves out is named as excluded, on one line in the text report and as a
  `conductor/gate-excluded` notification in the SARIF log's `conductor` run.
  It never reaches the exit code.
- `--advisory` maps exit 1 to exit 0: a run whose only failure is a blocking
  finding no longer fails. A gate that could not run is unaffected and still
  exits 2, so a crashed install or a missing policy still shows red rather
  than a silent green: this flag changes what a **finding** does, never what
  a **broken gate** does. The report is unchanged, a blocking finding still
  prints with its `BLOCKING` marker, and only the process exit and the
  verdict line's own wording (it says findings were advisory and did not
  block) change. Text output only; the SARIF log has no verdict line to
  change and its `properties.blocking` on each result is unaffected.
- `--project <dir>` runs against that repository instead of the current
  directory, resolved to its git top level the same way the current
  directory already is, so a subdirectory resolves to that repository's top
  level. A relative value resolves against the current directory. A path
  that does not exist, is not a directory, or is not inside a git repository
  is a usage error naming the path and exits 2 rather than falling back to
  the current directory.

### Exit codes

- **0** every enabled gate ran and none blocked.
- **1** every enabled gate ran and at least one blocked.
- **2** an enabled gate could not run: its binary is missing, it exited with
  its own could-not-run code, it exited 1 with nothing parseable on
  stdout, which is what a rejected config file looks like from two of the
  three family gates, or conductor stopped it at its time limit
  (`timed-out`, see `timeout-seconds` in [the policy file](policy-file.md)).

The external gates' exits are read per tool. gitleaks exits 1 for an error
as well as for a leak, so the umbrella hands it `--exit-code 3`: 3 is a leak
(blocked), 1 is could-not-run. gitleaks also exits 0 with an empty report
when git itself fails (a base ref the checkout never fetched), so a clean
exit that logged an `ERR` line is could-not-run too, never a pass. A
gitleaks exit with no report file behind it is could-not-run. osv-scanner is
handed every tracked lockfile by name, at any depth, never under
`node_modules`: `package-lock.json`, `npm-shrinkwrap.json`,
`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `go.mod`, `poetry.lock`,
`Pipfile.lock`, `uv.lock`, `pdm.lock`, `Cargo.lock`, `Gemfile.lock`,
`composer.lock`, `gradle.lockfile`, `packages.lock.json`, `mix.lock`,
`pubspec.lock`, `Package.resolved`, `conan.lock`, `renv.lock`,
`packages.config`, `buildscript-gradle.lockfile`, `gems.locked`,
`pylock.toml`, `cabal.project.freeze`, `stack.yaml.lock` and
`verification-metadata.xml` inside a `gradle` directory, and pip
requirements files (`requirements.txt`, `requirements-dev.txt`,
`requirements_test.txt`, `requirements.prod.txt`, `dev-requirements.txt`)
whose every requirement, includes followed, is pinned with `==`. `go.sum`
is never handed over: osv-scanner reads `go.mod` for Go. A requirements
file with an unpinned line, or an include that is missing, untracked or
outside the repository, is not scanned and is named in a
`conductor/requirements-not-scanned` note with the line that stopped it,
because any version osv-scanner reported for it would be a guess.
Requirements files are scanned with `--no-resolve`: direct requirements
only, as written, and the report says so per file. On a pull request a
requirements file that is pinned on the base stays scanned even when the
pull request adds an unpinned line to it. When the repository tracks none
of these, osv-scanner is not spawned at all and the gate is reported clean
with a `conductor/nothing-to-scan` note, so a docs-only repository is not
red on every pull request. The note says that nothing was scanned and names
the tracked manifests that were not handed to osv-scanner (a
`pyproject.toml`, a `go.sum`, a `Dockerfile`, a workflow, or a requirements
file the pin check left out), so a green gate is not read as a scan of
them. A `go.mod` or a pinned requirements file is handed over and so is
never on that list. It says nothing about what other gates read. When
other lockfiles WERE handed over, the same list (a `Podfile.lock` beside a
scanned `mix.lock`, say) is printed as a `conductor/manifests-not-handed`
note under the gate instead. Its 1 is
blocked. Its own 128 ("no package sources found") on lockfiles it WAS
handed means they parsed to no packages; that is clean too, with a distinct
`conductor/lockfiles-empty` note naming the files. When some handed
lockfiles had packages and one had none (a lockfile rewritten to `{}` beside
others), the same note names the empty one and the `lockfiles` line marks it
`[no packages read]`; the verdict over the other files is unchanged. That
naming reads osv-scanner's own per-file count, which it prints at its
default verbosity. Lockfiles inside git
submodules are never listed. In a sparse
checkout a tracked lockfile that is not on disk is still handed over and
osv-scanner exits 127 on it, a false could-not-run that fails closed. Any other osv-scanner exit
(127 is its error code) is could-not-run. A gitleaks older than 8.19 or an
osv-scanner older than 2.0 is could-not-run, naming the floor.

`run --advisory` maps exit 1 to exit 0. It never touches exit 2: a gate that
could not run is a different failure from a blocking finding, and advisory
mode exists to leave that one alone. See
[Running the gates as an advisory check](../README.md#running-the-gates-as-an-advisory-check).

### The verdict token

The text report carries one more line: `verdict-token: <token>`, the **second
line**, directly under the version line (the closing `verdict:` sentence is
unchanged). It is a label for the umbrella's own exit decision, in a closed
set, so a person or a script can read the state without parsing a sentence.
It decides nothing and never overrules a gate: it is derived from the exit
code and the `enforce` flags the run already had.

- `pass`: exit 0, and no gate, enforced or not, has a blocking finding or
  could not run. Under `present-on-base: report` a `pass` can carry known
  vulnerabilities already on the base branch, reported and not blocking;
  the report's third line then says `present-on-base: N reported, not
  blocking`, the verdict sentence says the same, and the Action copies that
  line to the job summary under the token. When the intent gate's spec was
  chosen weakly, differently than before 0.11.0, or not at all because of a
  tie or a branch 0.10.0 bound, the line after the token (after the
  present-on-base line, when there is one) is one of four fixed
  `intent-spec:` lines naming no branch or file, and the Action copies that
  one too.
- `nothing-checked`: exit 0, but nothing was checked. Either no gate ran at
  all (none is enabled, or every enabled one was deferred to a later stage,
  had nothing to judge, or was skipped), or every gate that ran examined
  nothing: the vulnerabilities gate with no lockfile it reads, or the intent
  gate with no contract to check against. The second case was `pass` in
  0.8.x. The exit status is unchanged, since nothing failed, but this is not
  a pass: nothing was verified. In the Action the `verdict` output carries
  this token, so a workflow can tell it apart from `pass`.
- `advisory-blocked (N)`: the run would have exited 1, and `--advisory` made
  it exit 0. N is the blocking findings on enforced gates.
- `unenforced-findings (N)`: exit 0, but a gate with `enforce: false` had
  blocking findings or could not run. N counts those findings plus those
  gates. Exit 0 here is not a pass, and the token says so.
- `blocked (N)`: exit 1. N as for `advisory-blocked`.
- `could-not-run`: exit 2, a refused trust base included.

When several apply the order is `could-not-run`, then `blocked` or
`advisory-blocked`, then `unenforced-findings`, then `nothing-checked` (no gate
ran, or none that ran checked anything) or `pass`. A run with
`--advisory` whose only blocking findings sit on an unenforced gate is
`unenforced-findings`, not `advisory-blocked`, because the flag did nothing
there. A gate skipped for want of a contract does not by itself move the token
off `pass` when another gate ran and checked something; when no gate ran, or
every gate that ran checked nothing, the token is `nothing-checked` and the
verdict sentence says "nothing was checked". A
gate that exited non-zero with no finding marked blocking counts as one in N,
so a state that is not a pass never prints a count of zero. The one-line
summary of a clean, non-verbose run has no token line, since it is one line by
design. `conductor run` also prints the token on its job-log line,
`conductor run: 4 gate(s), 1 finding(s); verdict-token advisory-blocked (1); sarif report written to conductor.sarif`.
