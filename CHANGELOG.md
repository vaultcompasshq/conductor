# Changelog

Notable changes to conductor. Format based on
[Keep a Changelog](https://keepachangelog.com/). What a version number
promises is the same contract the guard repositories use: the action tag and
the published package version are two numbers, and an action-only release
moves the tag while the package stays where it is.

This file starts at 0.4.1. Releases before it are described by their GitHub
release notes, which are generated from the commit history. It exists from
here because `scripts/lib/release-kind.mjs` now requires an entry before it
will classify a tag as an action-only release: a tag with no entry is far more
likely to be a version bump someone forgot to commit than a deliberate one.

## [Unreleased]

## [0.14.0] - 2026-10-26

**A package release.** `@vaultcompass/conductor` moves to 0.14.0 on npm and the
action's `conductor-version` default moves to `0.14.0` in lockstep, because the
new `preview` input needs a CLI that understands `--preview`. The gate defaults
are unchanged.

### Added

- A preview under the proposed rules on pull-request runs (issue 100). Each
  gate whose `enabled` or `stage` the pull request changes runs once more (a
  role the head switches off is skipped)
  under the base policy with only `enabled`, `stage` and `enforce` taken from
  the head, and what it would have said prints after the verdict, in the job
  log, as note-level `conductor/preview-under-proposed-rules` SARIF
  notifications and as one line in the step summary. It decides nothing: the
  exit code, the verdict token and the SARIF results are unchanged; in the
  full (`--verbose`) report lines 1 to 4 are untouched, and in the one-line
  clean form the primary report is a byte-for-byte prefix. The intent gate is
  deferred. New `conductor run --preview` flag and Action `preview` input,
  which defaults to `true`.
- Upgrading: a workflow on the old `timeout-minutes: 5` recipe can be killed
  mid-preview on a pull request that flips a gate's `enabled` or `stage`.
  Raise it to the primary run's need plus 5 minutes, or set `preview: 'false'`.
- The whole preview has a hard deadline of 300 seconds, each spawn is killed
  with SIGKILL at it, and the pull-request comment is cut at 60000 characters,
  preview block first.
- README recommendations: set the step's `timeout-minutes` to at least the
  primary run's need plus 300 seconds, and check out with
  `persist-credentials: false`.
- SARIF run properties carry the rendered per-key policy change lines under
  policyChanges.
- The Action's job log and step summary now print the control changes a pull
  request proposes (issue 100). `conductor run` writes the count and one
  `conductor: proposed <product> <line>` line per proposal to stderr, and the
  gates step copies the count line and up to 50 proposed lines into the step
  summary under `control changes:`, with `pr-comment` off or on. A line that
  holds a backtick or a character outside printable ASCII is replaced by a placeholder.

### Changed

- A changed `.guardrails.yaml` on a pull request is now reported one line per
  changed key (issue 100), naming the gate, the key and the old and new value
  (`policy: gates.dependencies.enabled true -> false`), where it used to say
  `policy changed in this pull request`. The head file is parsed for the
  comparison only and never acted on. A head that is absent or does not parse
  gets one line saying its changes are not known. The count in "N control
  change(s) proposed" is now per key: five changed keys count as five control
  changes, where they counted as one.

## [0.13.2] - 2026-10-20

**A patch package release that can turn a green run red.**
`@vaultcompass/conductor` moves to 0.13.2 on npm and the action's
`conductor-version` default moves to `0.13.2` in lockstep. The gate defaults
are unchanged (dep-guard 0.16.1, vault-guard 1.12.1, intent-guard 1.10.1).

### Fixed

- **An off-pin intent-guard whose preparation fails is now version-skew,
  exit 2, instead of a pass.** On a pull-request-shaped run the intent
  gate's preparation (import-spec, then freeze) ran the resolved
  intent-guard before the expected-version check, and a failed preparation
  ended the gate before that check was reached. So on an Action push run
  with the `spec` or `base-ref` input set, `enforce: false` on the intent
  gate, and an older intent-guard devDependency in node_modules/.bin whose
  import-spec or freeze failed, the run reported an unenforced
  preparation-failed and exited 0. The version is now decided before the
  preparation, with the same probe and the same message as every other
  gate: an off-pin build is `version-skew` and an unreadable one
  `version-unverified`, both enforced, and neither is spawned for
  import-spec or freeze. This can turn a green push run red. Under a trust
  base the exit was already 2; the reason now reads `version-skew` instead
  of `preparation-failed`. Because the version is decided first, an
  off-pin build is `version-skew` on a pull-request-shaped run even when
  the repository has no spec or waives it, where it used to be skipped;
  that matches what the gate already reported on any other run. Runs
  without the Action's expected version are unchanged, and so is an on-pin
  build whose preparation fails.

### Changed

- **The action tag now ships conductor 0.13.2, and the gate defaults are
  unchanged.** **The consumer cost.** An explicit `conductor-version` below
  `0.13.2` (0.13.0 or 0.13.1 included) is refused on pull requests once this
  tag ships; remove the input or raise it. Workflows that leave the input
  unset take the new default.

## [0.13.1] - 2026-10-19

**An action-only release. The tag moves; the npm package does not.**
`@vaultcompass/conductor` stays at 0.13.0 on npm and the action's
`conductor-version` default stays `0.13.0`.

### Changed

- **The umbrella now installs `dep-guard` 0.16.1 by default, up from
  0.15.0.** This covers dep-guard 0.16.0 and 0.16.1 together. The gate now
  judges a manifest under `ignorePaths` when the change makes it a project,
  follows symbolic links physically, fails closed on an online name it could
  not check, and holds Python commit pins to a strict form. The
  `TAG_DEP_GUARD_*` constants in `action.yml` move in lockstep with the
  default, since those constants are what the pull-request backward-pin rule
  measures a pin against; the dep-guard pull-request-mode floor
  (`TRUST_BASE_MIN_VERSION` in `src/gate-runner.ts`) stays at 0.10.1.

  **What can newly turn a run red.** A repository that is green today can
  newly fail where a manifest sits under an ignored path, where a symbolic
  link led the old scan elsewhere, where an online name could not be
  checked, or where a Python commit pin is not in the strict form. **The
  consumer cost.** On a pull request, an explicit `dep-guard-version` below
  `0.16.1` is refused; remove the input or raise it. Outside a pull request
  an explicit pin is unaffected. To hold back, stay on the previous action
  tag, v0.13.0.

## [0.13.0] - 2026-10-18

**A minor release: it adds two exit 2 cases.**

### Security

- **On a pull request, a deleted or moved lockfile is cleared only by a
  replacement of its own ecosystem, and never by a symbolic link.** Since
  0.12.0 a lockfile the base had packages in and the head deleted or moved
  is could-not-run unless a populated lockfile new in the pull request sits
  in the same directory. Any lockfile counted: a new one-package Cargo.lock
  cleared a deleted package-lock.json, and so did a committed symbolic link
  named pnpm-lock.yaml pointing at another directory's populated lockfile,
  which osv-scanner follows. The replacement must now also be of the
  removed file's ecosystem family (JavaScript, Python, Rust, Go, Ruby,
  PHP, JVM, .NET, Hex, Dart, Swift, Conan, R or Haskell, read from the same
  table that lists the lockfile names osv-scanner is handed; a name with no
  family matches nothing) and a regular file in the head's index (git mode
  100644 or 100755, not a 120000 symbolic link). An npm-to-pnpm or
  npm-to-yarn migration in the same directory still passes. A regular-file
  copy of a same-family lockfile from elsewhere still clears a removed one;
  that needs a content tie and is still open. (Operator ruling 2026-10-18,
  from the adversarial review of 0.12.0's lockfile check.)

  **The consumer cost.** A pull request that deletes or moves a lockfile
  and adds only a lockfile of another ecosystem beside it, or only a
  symbolic link, now exits 2 with reason `lockfile-emptied` instead of
  passing. Plain runs are unchanged. **Remedy:** add the real replacement
  lockfile for the same manifest (a regular file, of the same ecosystem) in
  the same pull request, or remove the manifest's dependencies with it.

### Changed

- **Under the Action, a gate whose version is not the action's pin is
  could-not-run (exit 2).** 0.12.0 warned and still ran it; its changelog
  announced this. When the Action's expected-version signal is set (the
  `CONDUCTOR_EXPECTED_*_VERSION` variables its run step passes from the
  `dep-guard-version`, `vault-guard-version` and `intent-guard-version`
  inputs) and the resolved dep-guard, vault-guard or intent-guard reports
  another version, wherever it was found (`node_modules/.bin`, `PATH` or a
  policy `command:`), conductor does not run it: reason `version-skew`,
  naming the expected and found versions, where the binary came from and
  the remedy. A gate whose version cannot be read at all under the signal
  is could-not-run too, reason `version-unverified`: the run was told which
  build must judge it and cannot show that this is it. Both are enforced
  whatever the policy's `enforce` says, and `advisory` never touches exit
  2. The job-log line, annotation and step-summary line 0.12.0 printed as
  warnings are now errors (`::error::`), and the text report and SARIF note
  say the gate was not run. Resolution order is unchanged, and a plain
  `conductor run` without the signal is unchanged.

  **The consumer cost.** A push run whose repository has a gate
  devDependency at a version other than the action's pin, which
  `node_modules/.bin` resolves ahead of the action's install, now exits 2
  instead of running the stale gate with a warning. So does a run with a
  second install of a gate earlier on `PATH`, or a policy `command:`
  pointing at another build. **Remedy:** bump the devDependency to the
  pin, or remove it (the action installs the gate itself); remove the
  other install from `PATH`; or point the `command:` at the pinned
  version, or remove it. **Watch the push run, not the pull request.** A
  pull request never consults `node_modules/.bin`, so the pull request
  that moves the action, or a gate devDependency, on its own is green, and
  the exit 2 first shows on the push run to the default branch after
  merge. The pin includes the action's default gate versions, which move
  with action releases, so a Dependabot or Renovate bump of the action
  alone, or of one gate devDependency alone, gives a green pull request and
  a red default branch: move the action and the gate devDependencies in
  the same pull request. A version probe that times out under the Action
  is enforced too, whatever the policy's `enforce` says.

- **The action tag now ships conductor 0.13.0, and the gate defaults are
  unchanged** (dep-guard 0.15.0, vault-guard 1.12.1, intent-guard 1.10.1).
  **The consumer cost.** An explicit `conductor-version: 0.12.0` (or any
  lower version) is refused on pull requests once this tag ships; remove
  the input or raise it. Workflows that leave the input unset take the new
  default.

## [0.12.0] - 2026-10-18

**A minor release: it adds an exit 2.**

### Security

- **On a pull request, emptying, deleting or moving a lockfile no longer
  hides the dependencies it held.** A head that rewrote a tracked lockfile
  to `{}` (or to anything osv-scanner reads no packages from), deleted it,
  or moved it with `git mv` silenced the vulnerabilities gate for it and
  could pass with only a `lockfiles-empty` or `lockfile-no-longer-scanned`
  note. On a run with a trust base, conductor now copies the base version of
  each such lockfile (every handed lockfile when osv-scanner read nothing at
  all) and runs osv-scanner once on those copies, under what is left of the
  gate's time limit. If a base copy had packages, the gate is
  could-not-run, reason `lockfile-emptied`, naming the file and the base
  count, even when the head also blocked. A deleted or moved file is
  cleared only by a populated replacement lockfile in the same directory
  that is new in the pull request and is not a requirements file (an
  npm-to-pnpm migration, for example); a lockfile the base already had
  there, such as a Cargo.lock, does not count. The check fails closed, with
  reason `lockfile-emptied-unverified`: a base run that fails or prints no
  package count, an unreadable base copy, and a head run whose stderr has no
  package count for a handed lockfile, which is what a verbosity option in
  the policy's osv-scanner options causes (remove it; conductor does not
  edit it). A base run past the limit is `timed-out`. Plain runs are
  unchanged, and requirements files are not yet checked. (Audit 2026-10-18
  N1.)

  **The consumer cost.** A pull request that empties a lockfile the base
  had packages in, or deletes or moves one, now exits 2 instead of passing,
  unless a populated replacement new in the pull request sits beside the
  same manifest. A policy
  that lowers osv-scanner's verbosity now makes every pull-request run of
  the vulnerabilities gate exit 2. When osv-scanner reads nothing at all
  (its exit 128) on a pull request, the gate now pays one extra osv-scanner
  run under the remaining time limit, and can time out where it passed
  before. **Remedy:** regenerate the lockfile, or add its replacement in
  the same pull request, or remove the manifest's dependencies with it. A
  lockfile that is absent on the base, or was already empty there, is
  unaffected.

- **This repository's lockfile now pins `fast-uri` 3.1.8** (through
  `ajv`), which carries a security fix over 3.1.7, so its own builds and
  CI no longer run the affected version. The published package does not
  ship that lockfile and its dependency ranges are unchanged; an install
  already resolves the newest `fast-uri` the range allows.

### Changed

- **The umbrella now installs `vault-guard` 1.12.1 and `intent-guard`
  1.10.1 by default, up from 1.12.0 and 1.10.0.** Both are patch releases
  published with provenance; `dep-guard` stays at 0.15.0. **The consumer
  cost.** The action tag now ships conductor 0.12.0, so an explicit
  `conductor-version: 0.11.0` (or any lower version) is refused on pull
  requests once this tag ships; remove the input or raise it. On a pull
  request an explicit `vault-guard-version` below 1.12.1 or
  `intent-guard-version` below 1.10.1 is refused too, so a workflow that
  pins the previous patch must raise or remove the pin when it moves to
  this tag. Workflows that leave the inputs unset take the new defaults.

### Fixed

- **SARIF from a gitleaks finding with an end column of 0 was
  schema-invalid, since about 2026-09-26.** gitleaks 8.30.1 reports
  `"EndColumn": 0` on its private-key rule over a PEM file, one of its
  commonest hits, and conductor copied it into `region.endColumn`, which
  SARIF 2.1.0 requires to be at least 1. `github/codeql-action/upload-sarif`,
  which the README recipe feeds, refuses an invalid file, so code scanning
  broke for the whole run. A gitleaks line or column below 1 now becomes 1, and the
  end column is kept only when it is an integer of at least 1, not before the
  start column, on a finding that starts and ends on one line; otherwise it
  is left out, which SARIF reads as the end of the line. No finding is
  added or removed. (Audit 2026-10-18 B1.)

- **A gate whose version is not the action's pin now warns wherever it was
  found, not only on PATH.** On a push run a repository's own devDependency
  on a gate in `node_modules/.bin` outranks the action's global install, by
  design, and the warning fired only for a PATH binary, so a repository with
  stale gate devDependencies ran them with nothing said. The skew is now
  printed on the job log line for every resolution source, as a
  `! conductor/version-skew` line in the gate block of the text report (and
  so in the pull request comment), as a note-level `conductor/version-skew`
  notification in SARIF, and in GitHub Actions as a `::warning::` annotation
  and a step-summary line. Which binary runs, the exit code and the verdict
  token are unchanged. **In the next minor release the Action will make a
  version skew a could-not-run** (exit 2), so this release is the one release
  of warning: bump or remove a gate devDependency that differs from the pin.
  (Intent-guard audit 2026-10-18 MB3.)

- **"gate said" for an osv-scanner that could not run now quotes its
  error.** osv-scanner 2.4.0 always prints its filesystem walk banner first,
  so every osv could-not-run quoted "Starting filesystem walk for root: /".
  Its progress lines are now skipped, and the extraction error is quoted.
  (Audit 2026-10-18 N4.)

- **A tracked `Gopkg.lock` is named in the unread-manifests note.**
  osv-scanner 2.4.0 has no extractor for it, so it was neither handed over
  nor named. (Audit 2026-10-18 N8.)

- The per-gate rollup count over grouped osv-scanner lines is now pinned by
  a test; the behaviour is unchanged. (Audit 2026-10-18 N2.)

- The dates of 0.11.0 and 0.11.1 below were swapped and are corrected.
  (Audit 2026-10-18 N5.)

## [0.11.1] - 2026-10-18

**An action-only release. The tag moves; the npm package does not.**
`@vaultcompass/conductor` stays at 0.11.0 on npm and the action's
`conductor-version` default stays `0.11.0`.

### Changed

- **The umbrella now installs `vault-guard` 1.12.0 by default, up from
  1.11.0.** vault-guard 1.12.0 lowers to low a key-shaped match that is
  entirely base64, sits strictly inside a base64 run of 1024 or more
  characters, and whose run decodes to the binary format its declared media
  type names (or to a PNG or JPEG header for a run with no data: prefix). It
  also shows five or more matches of one rule in one column of a data file as
  one grouped finding in the text output. No finding is removed, fingerprints
  and baselines are unchanged, and every match stays in JSON and SARIF. JSON
  `results[].file` and text paths are now relative to the scan root. The
  `TAG_VAULT_GUARD_*` constants in `action.yml` move in lockstep with the
  default, since those constants are what the pull-request backward-pin rule
  measures a pin against; the vault-guard pull-request-mode floor
  (`TRUST_BASE_MIN_VERSION` in `src/gate-runner.ts`) stays at 1.9.1.

  **What can newly turn a run green.** Under the default gate (medium), and
  under fail-on high or critical, a demoted finding no longer blocks. Under
  fail-on low it still blocks. **The consumer cost.** On a pull request, an
  explicit `vault-guard-version` below `1.12.0` is refused; remove the input
  or raise it. Outside a pull request an explicit pin is unaffected. To hold
  back, stay on the previous action tag, v0.11.0.

- **The umbrella now installs `dep-guard` 0.15.0 by default, up from
  0.14.0.** dep-guard 0.15.0 makes a manifest that does not parse fatal
  (exit 2) in more positions on every side and scan prefix, whatever
  `ignorePaths` says: a `pyproject.toml`, `Pipfile` or `uv.toml` beside a
  Python or npm-family lockfile or named by a uv workspace's `members`, a
  Python manifest under a skipped directory name beside a Python lockfile,
  and the target of a `file:`, `link:` or `portal:` dependency. It lists every
  such manifest in one error instead of the first only, and adds `notParsed`
  counts to the JSON ecosystem summaries. No verdict is loosened. The
  `TAG_DEP_GUARD_*` constants in `action.yml` move in lockstep with the
  default, since those constants are what the pull-request backward-pin rule
  measures a pin against; the dep-guard pull-request-mode floor
  (`TRUST_BASE_MIN_VERSION` in `src/gate-runner.ts`) stays at 0.10.1.

  **What can newly turn a run red.** A repository that is green today and
  carries a deliberately broken manifest in one of those positions can newly
  exit 2. Fix the file it names. **The consumer cost.** On a pull request, an
  explicit `dep-guard-version` below `0.15.0` is refused; remove the input or
  raise it. Outside a pull request an explicit pin is unaffected. To hold
  back, stay on the previous action tag, v0.11.0.

## [0.11.0] - 2026-10-17

**A minor release.** The intent gate's branch-name spec match moves to whole
words, a tie is reported instead of guessed, and a weak match says so; the
gate defaults move to dep-guard 0.14.0 and intent-guard 1.10.0 (both
published 2026-10-17 with provenance). dep-guard 0.14.0 adds per-ecosystem
coverage lines, collapses the install-script findings on a wholly new npm
lockfile into one, and lets ignorePaths from the base drop an unparseable
fixture manifest. intent-guard 1.10.0 reads whole paragraphs and labelled spec
sections and stops counting a file name alone as drift, so what blocks changes.

**Consumer cost.** The action tag now ships conductor 0.11.0, so an explicit
`conductor-version: 0.10.0` (or any lower version) is refused on pull requests
once this tag ships; remove the input or raise it. Workflows that leave the
inputs unset take the new defaults. Because intent-guard 1.10.0 changes what
counts as drift, a pull request that passed before can newly block, and one
that blocked on a file name alone can newly pass. On a pull request an
explicit gate pin below the new defaults is refused too, so the way to hold
back is to stay on the previous action tag. Existing branch-to-spec bindings
can change: a branch that matched a spec only inside a word, a branch made
only of short or common words, and a branch that two specs match equally no
longer choose a spec. To keep a binding, rename the branch after the spec, or
pin the spec with a Spec: line in the pull request body or with --spec.

### Changed

- **The intent gate's branch-name spec match is on whole words, not
  substrings.** A spec under docs/superpowers/specs is chosen for a
  branch only when one name's words appear, in order and together, in
  the other's, and at least one shared word has three or more
  characters, a letter, and is not a common branch word. Before this a
  branch called pr could be bound to any spec with "pr" inside a word,
  and the run reported that spec's verdict as the intent gate's. This is
  a behaviour change: a branch that matched only inside a word (pr in
  prepare, widget in widgets), a branch made only of short or common
  words (fix/pr, wip), and a branch that two specs match equally no
  longer choose a spec, and the report says so, including, for this
  release, which spec 0.10.0 would have chosen. To keep a binding, add
  a "Spec: <path>" line to the pull request body or name the branch
  after the spec. A repository that wants one contract whatever the
  branch is called should freeze a native contract on the base branch,
  which outranks every other source. Measured against the merged pull
  request branch names of the four public guard repositories and their
  current spec listings (tests/fixtures/intent-spec-selection-baseline.json),
  the one binding found is unchanged; three of the four carry no
  docs/superpowers/specs directory, so that measurement is thin.
- **A tie is reported, never guessed.** Two specs that match a branch
  equally are both named, and the gate is skipped as
  intent-guard/spec-ambiguous: advisory, like a branch with no spec, and
  never in the exit code. Previously the longer stem won.

### Added

- **A weak match says so.** A spec chosen on one shared word, or on word
  length alone, is still used, and the report says the match is weak in
  the intent gate's block, the --verbose block, an
  intent-guard/spec-weak-match SARIF note and the Action's step summary,
  with how to pin it. Its verdict and enforcement are unchanged.
- **The spec-ambiguous skip.** A third reason a skipped intent gate can
  carry, beside no-contract and contract-waived, with its own SARIF
  notification id (intent-guard/spec-ambiguous) whose details list every
  tied spec, and its own wording on the skipped line and the verdict.

## [0.10.0] - 2026-10-17

**A minor release.** The per-gate time limit, readable osv-scanner and
gitleaks lines with a capped report, the `dependency_groups` verdict fix and
a safer release pipeline ship together, and the gate defaults move to
vault-guard 1.11.0 and dep-guard 0.13.0 (both published 2026-10-17).

**Consumer cost.** The action tag now ships conductor 0.10.0, so an explicit
`conductor-version: 0.9.0` (or any lower version) is refused on pull requests
once this tag ships; remove the input or raise it. Workflows that leave the
inputs unset take the new defaults. vault-guard 1.11.0 can newly find, or
stop skipping, things, so adopters may see new secrets findings. dep-guard
0.13.0 adds Python name checks that can newly block a run on a PyPI 404.
On a pull request an explicit gate pin below the new defaults is refused too,
so the way to hold back is to stay on the previous action tag.

### Security

- **The release workflow keeps the npm publish token out of the job that
  installs dependencies.** It now installs, builds, tests and packs in a job
  with no publish token, then publishes the packed tarball from a separate
  job that holds the token and does not install this repository's
  dependencies. The scope is the token only: the tarball is still built
  where dependency install scripts run, so the split does not by itself
  guarantee the integrity of what was built.

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
- **`conductor init` on an existing policy names the gate roles the file
  has no entry for**, with the two lines that add each one. The file is
  still never rewritten.
- **`conductor init` adds `.guardrails/` to `.gitignore`** when git does not
  already ignore the manifest: appended to the end of an existing file
  (every other line is left as it is) or written as a new file, and said in
  the output. A `.gitignore` that is a symbolic link or not a regular file is
  left alone and the line to add is printed instead. `--revert` does not
  remove the line.
- **`conductor init --hook` recognises husky on a fresh clone.** husky
  declared in `package.json` (a `husky` dependency or devDependency, or a
  `prepare` script that runs husky) or a tracked `.husky/` directory, with
  `core.hooksPath` not yet set, now targets the tracked `.husky/pre-commit`
  instead of `.git/hooks/pre-commit`, which husky's install would bypass,
  and says the install still has to run. Any `core.hooksPath` that is set,
  `.git/hooks` included, is left alone. The prepare script must run husky as
  a command (`husky`, `husky install`, `is-ci || husky`, `npx husky`); the
  word inside another name (`no-husky`, `echo skip husky`) does not count.

### Known open

- **gitleaks' own `--timeout` (`options.timeout`) hides what it found before
  its deadline.** When it fires gitleaks exits 1 whether or not it found a
  leak, so the gate is could-not-run, and leaks found before the deadline
  are never shown as findings; only the echoed gitleaks log line ("N leaks
  found in partial scan") mentions them.
- **A real full-history scan stopped at the policy limit is checked only
  locally.** That test needs a repository large enough to outlive a real
  10 second limit, so it runs only against a local gitleaks with
  `CONDUCTOR_REAL_GITLEAKS_SLOW=1` set; CI runs the stubbed timeout tests.
- **husky with a custom hooks directory is not followed.** The fresh-clone
  redirect always targets `.husky/pre-commit`. A `prepare` script that
  installs husky into another directory (`husky install .config/husky`, or
  husky 9's `husky .config/husky`) leaves the written hook where husky will
  not run it; run the install first and re-run `conductor init --hook`.
- **An osv-scanner.toml reason shaped like a suppression line is still
  read.** Control bytes are stripped and only an advisory-id-shaped id is
  read, but a forged line made of printable text adds a plain id to the
  `suppressed-by-osv-scanner.toml` fact. It is display only, authored by
  whoever edits that file, and feeds no count, verdict or exit.

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
- **osv-scanner findings are easier to read.** Each line shows
  `package@installed-version`, the fixed version or `no fix listed`, and `dev`
  when osv-scanner marks the package a dev dependency. One advisory on one
  installed package in several lockfiles is one line ("N lockfiles"), with
  the lockfiles listed under `--verbose`. The finding count, SARIF and the
  exit code still have one finding per lockfile.
- **osv-scanner.toml suppressions are counted.** The vulnerabilities gate's
  `suppressed` number was always 0; it is now osv-scanner's own count from
  its "Filtered N vulnerabilities" line (once per advisory per lockfile),
  and the ids and reasons are listed. osv-scanner reports no expiry, so none
  is shown. osv-scanner prints a reason verbatim, control bytes included, so
  only an id-shaped id is read and every id and reason is cut to printable
  ASCII; a count that is not a safe integer is ignored. `sources-with-findings` now counts the lockfiles that findings
  name, so a lockfile with only a licence or deprecation verdict is not
  counted.
- **gitleaks findings show the short commit and the fingerprint** (the
  value `.gitleaksignore` takes), and the commits a duplicate was folded
  from. The run fact `entries` is now `entries-raw` (records in gitleaks'
  report) and `entries-distinct` (findings after the merge collapse), in the
  text report and in SARIF `properties.details`. Two records from different
  commits that agree on rule, file, columns and entropy but not line (a merge
  reporting a moved line again) are both kept and each names the other as
  possibly the same secret.
- **Long reports are capped per gate.** Without `--verbose`, a gate prints
  its first 20 findings (blocking first) and one line saying how many more
  there are. Every count, the verdict, the token and SARIF still include all
  of them.
- **A gate that could not run prints its reason and its stderr once.** The
  umbrella's own finding under it no longer repeats both; SARIF keeps the
  full message.
- **A refused trust base on a terminal prints the refusal once**, with one
  line per gate in the report and one line on stderr. A file, a pipe, the
  `--text-report` copy and a job log are unchanged.
- **A dep-guard run whose online lookups hit its deadline says so** on the
  one-line clean summary and on its job-log line, read from dep-guard's own
  `online-deadline-exceeded` diagnostic. Still exit 0.
- **`conductor init` warns harder about external gates.** An external gate
  (gitleaks, osv-scanner) is still enabled only when its binary is found;
  the policy file now carries a comment under it saying CI must install it,
  and the printed note is a WARNING naming the `conductor/gate-missing`
  result a run without it gets.

### Fixed

- **A dev dependency no longer blocks a present-on-base run on its own.**
  osv-scanner 2.4.0 writes `dependency_groups` (for example `["dev"]`) on a
  dev dependency, and the vulnerabilities gate counted that key as a verdict
  that is not an advisory, so a compared run under `present-on-base: report`
  still blocked when every advisory was already on the base. It fails closed
  by over-blocking, and has since the key set was written. VERDICT CHANGE: a
  compared run where every finding is present-on-base under report, and
  whose only non-advisory verdict was `dependency_groups`, moves from exit 1
  to exit 0; any real non-advisory verdict (a licence or deprecation
  verdict) still blocks.

## [0.9.0] - 2026-10-14

**A minor release.** Ecosystem coverage for the vulnerabilities gate and its
comparison with the base branch ship together: coverage alone would turn a
Python or Go backlog from a false "nothing to scan" into a red on every pull
request, and the comparison is what lets those repositories enforce on new
advisories from their first pull request.

### Security

- **The action puts the gate install on `PATH` only after the signature
  audit passes.** The write used to come before the audit, on the claim that
  it granted nothing because the gates step does not run after a failed
  install. The pull request comment steps run `if: always()`, though, so on
  a failed audit they ran with the unverified packages' bins ahead of the
  system's own, and the post step holds the job token. npm links a
  package's bins even under `--ignore-scripts`, so a tampered gate package
  declaring a bin named `node` or `gh` would have run with that token. The
  post step now also runs `node` and `gh` by absolute paths that a new
  first step, "Resolve node and gh for the comment step", resolves before
  anything is installed. Nothing changes for a run whose audit passes. A
  runner with no `node` or `gh` on `PATH` when the action starts gets a
  warning and no comment, as it effectively did before.

### Fixed

- **A lockfile emptied beside another lockfile is named.** A pull request
  that rewrote one lockfile to `{}` while another was present got
  `lockfiles 2 (...)` with the emptied file listed as scanned, no note, and
  every advisory it carried gone; only a sole emptied lockfile was named.
  The vulnerabilities gate now reads osv-scanner's own per-file package
  count and names each handed file it read no packages from in a
  `conductor/lockfiles-empty` note, and the `lockfiles` line marks it
  `[no packages read]`. The verdict over the other files is unchanged. The
  count is the line osv-scanner prints at its default verbosity, so a policy
  that lowers its verbosity turns the naming off.
- **Lockfile formats osv-scanner reads are now handed to it.** `mix.lock`,
  `pubspec.lock`, `Package.resolved`, `conan.lock`, `renv.lock`,
  `packages.config`, `buildscript-gradle.lockfile`, `gems.locked`,
  `pylock.toml`, `cabal.project.freeze`, `stack.yaml.lock`, and
  `verification-metadata.xml` inside a `gradle` directory were neither
  scanned nor named; a repository whose only lockfile was one of them got
  "nothing to scan". Each was measured against osv-scanner 2.4.0. **This can
  newly turn a run red**: an Elixir, Dart, Swift, C/C++, R, .NET, Gradle,
  Ruby, Python or Haskell repository with a known advisory in one of these
  files now blocks on it, and on a pull request the base comparison labels
  advisories already on the base the same way as for every other lockfile.
  `Podfile.lock` and `deno.lock`, which osv-scanner 2.4.0 rejects, are named
  in the not-handed note along with `mix.exs` and `pubspec.yaml`. That note
  is now written whenever a tracked manifest was not handed over, also when
  other lockfiles were (as a `conductor/manifests-not-handed` run note);
  before, it appeared only when nothing at all was handed over.
- **The verdict token is `nothing-checked`, not `pass`, when every gate
  that ran checked nothing**: the vulnerabilities gate with no lockfile it
  reads, or whose every lockfile parsed to no packages (a sole lockfile
  rewritten to `{}`), or the intent gate with no contract to check against.
  The vulnerabilities line then also carries `packages-read 0`. The verdict
  sentence says "nothing was checked" in that state too. The exit code is
  unchanged (0). A workflow that reads the Action's `verdict` output and
  treats only `pass` as clean will now see `nothing-checked` for such a run,
  which is the point.

### Changed

- **The vulnerabilities gate no longer says "no tracked lockfile; treated
  as clean".** With nothing to scan it now says that nothing was scanned and
  that the verdict is clean because there was nothing to read, and names the
  tracked manifests that were not handed to osv-scanner (`pyproject.toml`,
  `go.sum`, a requirements file the pin check left out, `Dockerfile`,
  compose files, workflows and similar; vendor and testdata directories are
  skipped). A `go.mod` or a pinned requirements file is handed over (see
  Added) and is never on that list. It
  makes no claim about what other gates read. The verdict and exit code are
  unchanged.
- **The exit 0 verdict no longer says "every enabled gate ran and none
  blocked" when a gate was deferred, left out by `--gate`, skipped, had
  nothing to scan, or (intent) ran with no contract to check against.** It says no gate blocked and names what was not checked.
- **The exit 1 verdict counts gates that blocked.** "N blocking finding(s)
  across M gate(s)" counted enforced gates; it now reads "N blocking
  finding(s) in K of M enforced gate(s)".
- **Gates switched off with `enabled: false` are listed** in the full report
  and on the one-line clean summary, as a new optional `disabled` list on the
  run result.
- **`conductor init` writes `require-frozen: false` under the intent gate's
  `options` when it writes `enforce: false`**, so a full run with no contract
  does not print a blocking critical finding. It also writes the `options`
  comment per gate: gitleaks and osv-scanner no longer get a `fail-on`
  example, since neither has a severity floor, and point at `.gitleaks.toml`
  and `osv-scanner.toml` instead.

### Documentation

- An "Adoption ramp" section in the README: advisory first, each gate's own
  baseline or config file, a `.gitleaksignore` recipe for an old history
  finding, and the switch to enforce.
### Added

- **What can newly turn a run red.** The vulnerabilities gate now hands
  osv-scanner go.mod, poetry.lock, Pipfile.lock, uv.lock, pdm.lock,
  Cargo.lock, Gemfile.lock, composer.lock, gradle.lockfile,
  packages.lock.json and requirements files whose every requirement is
  pinned with `==`, as well as the npm-family lockfiles it read before. A
  Go, Python, Rust, Ruby, PHP, Java or .NET repository that used to get
  "nothing to scan" now gets real results, and a known advisory there
  blocks. A requirements file with an unpinned requirement is not scanned
  and is named in the report with the line that stopped it. Requirements
  files are scanned with osv-scanner's `--no-resolve`: direct requirements
  only, as written, with no lookup of transitive packages, because without a
  lockfile any transitive version would be the registry's latest rather than
  the one installed. The report says so per file. An `options.no-resolve`
  key in the policy is not passed on runs that scan a requirements file; a
  note says so. Lockfiles are scanned as before.
- **The base comparison.** On a pull-request run whose vulnerabilities scan
  blocked, osv-scanner also scans the base branch copies of the lockfiles
  that carry findings, and labels each finding `introduced` or
  `present-on-base` in the text report, in SARIF (`baselineState` `new` or
  `unchanged`) and on a base comparison line. A new gate-level policy key,
  `present-on-base: block | report` on the vulnerabilities gate only,
  decides whether present-on-base findings block. `conductor init` writes
  `report`. On a pull-request run osv-scanner is also handed
  `--no-call-analysis=all` on both runs unless the policy names a
  call-analysis key.

### The consumer cost

A policy written before this release has no `present-on-base` key, so it
blocks on every known vulnerability, including ones already on the base
branch: no policy is loosened by the upgrade. A repository with a backlog in
a newly scanned ecosystem sees every pull request blocked until it fixes the
backlog, ignores advisories in osv-scanner.toml on the base branch, or adds
`present-on-base: report` under the vulnerabilities gate on the base branch,
after which only advisories a pull request introduces block. Move the action
to this release first: older conductor versions reject the key and exit 2.
A renamed or moved lockfile, and a partial upgrade still inside an
advisory's range, count as introduced. So does every advisory in a
requirements file that a pull request pins for the first time: under
`report`, that good-hygiene pull request is blocked once on the file's whole
backlog. Land the pin with the action in advisory mode, or ignore the
specific advisories in osv-scanner.toml on the base branch first. Deleting a
requirements file, or renaming it to a name the gate does not match, drops
it with a note rather than a block. A pull request that changes a lockfile
may run osv-scanner twice. When `present-on-base: report` leaves known
advisories unblocked, the report and the job summary both say
`present-on-base: N reported, not blocking`.

On pull requests osv-scanner's call analysis is off (`--no-call-analysis=all`
on both runs, unless the policy names `call-analysis` or `no-call-analysis`).
For a Go repository, advisories osv-scanner would otherwise hide as
unreachable now appear, and a local run (call analysis on, when a Go
toolchain is present) can pass while the same tree's pull-request run
blocks. Existing npm adopters are unaffected: npm has no call analysis, and
Go was not scanned before.

## [0.8.2] - 2026-10-07

**An action-only release. The tag moves; the npm package does not.**
`@vaultcompass/conductor` stays at 0.8.1 on npm and the action's
`conductor-version` default stays `0.8.1`.

### Changed

- **The umbrella now installs `dep-guard` 0.11.1 by default, up from
  0.10.1.** dep-guard 0.11.1 resolves manifests and lockfiles below the
  repository root (a `frontend/` plus `backend/` layout with nothing at the
  root, a `dashboard/package.json` beside its own `pnpm-lock.yaml`), judges
  lockfile coverage per directory, and names the lockfile a finding is
  about. It replaces 0.11.0, which was withdrawn and deprecated on npm the
  same day it shipped: its skip list dropped workspace members and lockfiles
  under build, dist, vendor and venv names, and its pyproject reader was
  broken. The umbrella never shipped 0.11.0; this release moves straight
  from 0.10.1 to 0.11.1. The `TAG_DEP_GUARD_*` constants in `action.yml`
  move in lockstep with the default, since those constants are what the
  pull-request backward-pin rule measures a pin against. The dep-guard
  pull-request-mode floor (`TRUST_BASE_MIN_VERSION` in `src/gate-runner.ts`)
  stays at 0.10.1: a locally installed 0.10.1 still runs. `vault-guard-version`
  stays at `1.9.1`, `intent-guard-version` at `1.8.1` and `conductor-version`
  at `0.8.1`.

  **What can newly turn a run red.** dep-guard 0.11.1 reads manifests it
  used to ignore, so a repository whose only manifests sit below the root
  gets dependency findings for the first time, and a deleted lockfile below
  the root is a `lockfile-downgrade` (exit 2) when its manifest still
  declares dependencies, with a root lockfile not standing in for it. See
  dep-guard's own 0.11.1 changelog for the full list and the new note codes.

  **The consumer cost.** On a pull request, the backward-pin rule now
  refuses `dep-guard-version` below `0.11.1`, which includes `0.10.1` and
  the withdrawn `0.11.0`. A workflow carrying that line pinned explicitly to
  the old default is refused rather than run. The migration is to remove
  the input, whose default is the version this tag ships, or to raise it to
  `0.11.1` or newer. Outside a pull request an explicit pin is unaffected.

## [0.8.1] - 2026-10-04

**A patch package release that can turn a green run red.**
`@vaultcompass/conductor` moves to 0.8.1 on npm and the action's
`conductor-version` default moves to `0.8.1` in lockstep. The three gate
defaults move too: intent-guard 1.8.1, dep-guard 0.10.1 and vault-guard
1.9.1. Each of those is itself a patch release that can turn a run red.

### What can newly turn a run red, and how to clear each

- **A pull-request job in GitHub Actions with no `--trust-base` is
  could-not-run (exit 2)** when `GITHUB_BASE_REF` is set, a pre-commit hook
  run inside such a job included. Clear it by using the Action, which always
  passes a trust base, by passing `--trust-base
  refs/remotes/origin/<base branch>` yourself (with `fetch-depth: 0`), or by
  not running the hook in CI. Outside Actions this prints one notice and the
  run goes on.
- **A family gate older than its pull-request-mode minimum is could-not-run
  on a pull-request run**, enforced whatever the policy says, instead of
  running without `--trust-base`. The minimums are intent-guard 1.8.1,
  vault-guard 1.9.1 and dep-guard 0.10.1, the versions this release's action
  defaults install. Clear it by installing the named minimum or newer, or by
  removing an explicit older version pin (a `*-guard-version` input, or an
  older copy earlier on PATH). Runs without a trust base are unchanged.
- **The action's four version inputs below this tag's defaults are refused
  on a pull request**, as before, and the defaults now end in patch 1, so an
  explicit `conductor-version: 0.8.0`, `dep-guard-version: 0.10.0`,
  `vault-guard-version: 1.9.0` or `intent-guard-version: 1.8.0` kept while
  moving the action to this tag is refused before any gate runs. Remove the
  input, or raise it to this tag's default or newer.
- **A control file that is a symbolic link on the base is could-not-run.** A
  base `.guardrails.yaml`, intent contract, or external-tool config, ignore
  file or extended file that is a symlink, a directory, a submodule or a
  missing object at the base ref, or that sits below a symlinked or
  submodule directory there, stops the run with git's reason. Clear it by
  making that path a regular file on the base branch. The pull request that
  does so is judged against the same base, so it has to be merged by someone
  allowed to merge without this check passing.
- **PATH is cleaned on a pull-request run.** Empty and relative PATH entries
  are removed, with one notice naming them, and conductor runs the first git
  on PATH that is outside the repository's work tree. A gate found only
  through a removed entry is now reported missing; clear it with an absolute
  PATH entry or an absolute `command:`. With no git outside the repository on
  PATH the run is could-not-run; clear it by putting git's own directory on
  PATH as an absolute entry. On POSIX every gate also finds conductor's
  pinned git first on PATH, through a private directory outside the
  repository that holds only that git and is removed when the run ends; a
  system temporary directory inside the repository, or one where that
  directory cannot be made, is could-not-run, cleared by setting TMPDIR to a
  writable directory outside the repository. On Windows the PATH cleaning
  and the git pin apply, no private directory is made, and the gates look git
  up through the cleaned PATH. Runs without a trust base are unchanged.
- **git 2.31 or later when gitleaks runs on a pull-request run.** conductor
  hands gitleaks `git log --diff-merges=first-parent`, which arrived in git
  2.31. An older git, or one whose version cannot be read, is a named
  could-not-run for that gate before it is spawned. Clear it by upgrading git.
- **Paths an intent gate older than 1.8.1 cannot be handed.** On a
  pull-request run such a gate no longer runs at all (see the minimums
  above). On a run without a trust base that names `--base`, a change set
  with a comma, a backslash or edge whitespace in a path, or in which every
  path starts with "-", is could-not-run for a native contract on
  intent-guard below 1.8.1; clear it by upgrading intent-guard to 1.8.1,
  which reads the change set from git itself. For an imported contract, on
  any version, the change set can only be handed over as a list; clear it by
  freezing the contract and committing it to the base branch, with
  intent-guard 1.8.1 or later.
- **The intent contract is taken from the base ref on a pull-request run,
  `--spec` included.** When the base has a frozen contract it is used even if
  the pull request edits or deletes it, or passes `--spec`, and every
  intent-guard that can run on such a run judges that edit against the base
  copy. Clear a contract change by landing it on the base branch first;
  retiring or replacing a frozen contract through a judged pull request needs
  an administrator (see the README). When the base has none, nothing in the
  pull request becomes the contract: a spec on the base is imported from its
  base copy (so `--spec` must be a plain path inside the repository that the
  base carries), and otherwise the gate is skipped with "No contract on the
  base" (exit 0). A contract or spec the pull request adds is reported as a
  proposal, so a first adoption merges and is judged from the next pull
  request.
- **A trust base on its own makes the run pull-request shaped.** With
  `--trust-base` and no `--base` or `GITHUB_BASE_REF` (merge_group,
  workflow_dispatch, a CLI run), the intent gate now judges the branch
  change set since the trust base. A change outside its budget now blocks
  there. Clear it as on any pull request: keep the change inside the
  contract, or land the contract change on the base branch first.
- **A moved submodule pointer counts against the intent budget** even where
  `.gitmodules` says `ignore = all`. Clear it by keeping the pointer move
  inside the contract, as any other changed path.
- **A specs or plans directory linked out of the repository**, on a run
  WITHOUT a trust base, is could-not-run at the spec step. Clear it by
  replacing the link with the directory itself, or by naming the spec with
  `--spec`. On a pull-request run nothing in the working tree is followed:
  the spec and plan are read from the base ref, a spec named by `--spec` or a
  `Spec:` line under a directory that is a symbolic link on the base is
  could-not-run at the spec step with git's reason (clear it by committing
  the directory itself to the base branch), and the branch-name convention
  finds no spec or plan inside such a directory.
- **`conductor init` and `--revert` refuse a `.guardrails` directory or
  manifest that is a symlink out of the checkout** (exit 2, nothing
  written). Clear it by replacing the link with a real directory.
- **conductor sets `GIT_NO_REPLACE_OBJECTS` on every git call it makes**,
  hook runs included, and on gitleaks' history scan. A repository that uses
  `git replace` to change what its history looks like is judged on the
  original objects. There is no setting to turn this off.

### Moving to vault-guard 1.9.1 under conductor

- A file the secrets gate cannot scan (unreadable, over 32 MiB, over its
  per-file time budget, or tracked but missing on disk in pull-request mode)
  makes vault-guard exit 2, which conductor reports as could-not-run (exit 2
  for an enforced gate). Clear it by fixing the file or declaring it in
  `ignore.paths` in `.vault-guard.json`; vault-guard's stderr prints the
  exact entry.
- On a pull request vault-guard reads `.vault-guard.json` from the base, so
  the `ignore.paths` entry must be merged in its OWN pull request before the
  pin moves to 1.9.1. A pull request that adds the entry and moves the pin
  together only proposes the entry, and is judged without it.
- `--advisory` (the Action's `advisory` input) does not soften exit 2: it
  turns a blocking result (exit 1) into exit 0 and leaves could-not-run
  alone.
- On a pull request an explicit `vault-guard-version` input older than this
  action's default (1.9.1) is refused before any gate runs, as for the other
  three version inputs. Remove the input, or set it to 1.9.1 or newer.

### Moving to dep-guard 0.10.1 under conductor

- dep-guard 0.10.1 refuses a pull request whose lockfile set loses what it
  reads (`lockfile-downgrade`, exit 2): a new or changed root lockfile it
  does not read beside one it does, or every read lockfile removed while a
  manifest declares dependencies. Clear it by adding the entries the message
  prints to `acknowledgedLockfiles` in `.dep-guard.json` on the base branch,
  by deleting the stale lockfile in the pull request, or by an administrator
  merge after reviewing the lockfile by hand.
- dep-guard 0.10.0 and earlier reject a config containing the
  `acknowledgedLockfiles` key, so add it only after the pin has moved to
  0.10.1 everywhere conductor runs dep-guard (the Action, a pre-commit hook,
  a devDependency).

### Fixed

- A changed path with a comma, a backslash, edge whitespace or a leading
  "-" is judged through intent-guard's own `--base` for a native contract
  on intent-guard 1.8.1 or later. Below that, a leading "-" is handled by
  ordering the path list, and the remaining refusals now say to upgrade
  the gate, or, for an imported contract, to freeze the contract on the
  base branch.
- A proposal line for an external tool's config now says the neutral
  stand-in was used when the base carries no copy, instead of naming a base
  copy that does not exist.
- When the base's frozen contract outranks `--spec`, the report says so in
  one line.

### Reporting and wording

- `conductor run` now writes one plain line per gate to stderr on every run,
  naming the gate, the version it ran, its outcome (ok, findings with a count,
  could-not-run, missing, or skipped with the reason) and its exit code, so the
  job log says which gate did what without opening a report. stdout is
  unchanged.
- A gate that exits with a code conductor does not read as a verdict (an exit 2)
  now has the first line it printed on stderr, or a `reason` field in its JSON,
  carried into the report and the log line as `gate said: "..."`, cut to 160
  ASCII characters, with double quotes replaced and workflow-command markers
  broken up. Each raw stderr line in the report is cleaned the same way
  (control characters become spaces). It never changes the outcome or the exit
  code.
- A failed npm signature audit of the gate packages now says in the job error
  and in the pull request comment which audit ran (`npm audit signatures`, over
  the installed gate packages and their dependencies), that npm's output is the
  reason, and what to do next: this step already retried once, so re-run the
  job once, and treat a repeat as real. Wording only; the audit, the single
  retry and the exit status are unchanged.
- When a gate resolved from PATH reports a version other than the one the
  action pinned, the job log now carries a warning naming both versions and
  where the binary was found. The action hands its three gate pins to conductor
  as CONDUCTOR_EXPECTED_DEP_GUARD_VERSION, CONDUCTOR_EXPECTED_VAULT_GUARD_VERSION
  and CONDUCTOR_EXPECTED_INTENT_GUARD_VERSION for this and nothing else. A
  warning only: resolution, the gate that ran and the exit code are unchanged.
- conductor now runs its own gates on its own pull requests: a new
  `self-check.yml` workflow runs this repository's action from the checkout
  (`uses: ./`) in advisory mode with `fetch-depth: 0`, `persist-credentials:
  false`, a read-only token and no secrets. It runs the published conductor
  version from the action's default against this repository's pull requests,
  not the pull request's own source. The repository gains a `.guardrails.yaml` (dependencies and
  secrets) for it to read from the base branch.
- The report no longer states a bare "0 control change(s) proposed" when a gate
  that was in pull-request mode could not run: it counts what the gates that
  ran proposed and names the gate whose proposals are not known. SARIF emits no
  statement about proposals for that gate. Reporting only.
- Refusal wording now leads with what happened and ends on the one fix: a pull
  request pinning a gate backward, a base branch that could not be fetched, a
  base branch missing from the checkout (intent gate), a shallow checkout for a
  history gate, and a gate older than the floor conductor speaks. Wording only.
- A gate that could not run because of conductor's own decision (a git below
  the floor, a path list it cannot pass, a PATH or private git directory
  failure, a gate below its minimum) now carries conductor's reason into its
  per-gate job log line as `conductor said: "..."`, cleaned, on one line,
  capped and quoted the same way as `gate said`. Reporting only.
- The `NOT in pull-request mode` report line and the
  `conductor/trust-base-not-passed` SARIF notification now describe the one
  case left that reaches them, an intent gate judging a contract imported
  from the base for the run, and no longer say the gate read its rules from
  the tree being judged.

## [0.8.0] - 2026-09-30

**A minor package release.** `@vaultcompass/conductor` moves to 0.8.0 on npm
and the action's `conductor-version` default moves to `0.8.0` in lockstep,
the same number the `v0.8.0` tag names. The three gate defaults move too:
intent-guard 1.8.0, dep-guard 0.10.0 and vault-guard 1.9.0.

**The consumer cost.** Read this before moving your action tag.

- History gates need `fetch-depth: 0`. Any shallow checkout, on any event, is
  now could-not-run for a history gate (gitleaks), not only on pull requests.
- Run the action in a job with no pull request code before it. The README
  example shows the shape. The action reads its trust base and its rules from
  places that code run earlier in the same job could otherwise move.
- On a pull request the job needs `permissions: contents: read`, because the
  action now fetches the base branch itself for the trust base. A failed fetch
  fails the job; conductor never runs with a stale or absent trust base.
- `nothing-checked` is a new sixth verdict token, for a run in which no gate
  ran. A workflow that tests the `verdict` output for `pass`, or that lists
  the five earlier tokens, must handle it. The exit status is unchanged.
- An explicit `conductor-version` below `0.8.0` is refused on a pull request
  after this bump, because `TAG_CONDUCTOR_MINOR` moved with the default. The
  same holds for the three gate inputs below the new defaults. Pins must move
  with the action tag: raise them, or remove the inputs to take this tag's
  own versions.
- The gate default pins moved, which brings each guard's stricter behaviour.
  dep-guard 0.10.0: a private registry must be named in `.npmrc`, and a
  lockfile format switch is refused. vault-guard 1.9.0: a key in documentation
  is no longer downgraded, and JSON paths use forward slashes. intent-guard
  1.8.0: the Stop hook needs SessionStart, or it fails closed.

### Fixed

- A base branch that advances between checkout and the action's fetch no
  longer makes a pull-request run exit 2. The private `refs/conductor/trust-base`
  is the authority and is no longer compared with `refs/remotes/origin/<base>`
  (fixed at checkout time, and the side pull-request code can move); the
  comparison is kept only for an explicit trust base, and the intent gate's
  base follows the same rule.
- The intent gate is now handed changed paths NUL-separated from git
  (`--name-only -z`), so a file name with a quote, backslash, tab or newline
  arrives intact. Before, git C-quoted it (`"secrets/a\"b.txt"`) and
  intent-guard, which refuses a backslash in a path, left every pull request
  touching such a name permanently could-not-run. A comma in a path is still
  could-not-run, naming the file.
- Security: the intent gate's base is now spelled in full as well. A tag named
  `origin/<base>` at an earlier commit used to make the gate judge only the
  last commit. On a pull request it now uses `refs/conductor/trust-base` if
  present, else `refs/remotes/origin/<base>`, refuses (exit 2) when both exist
  and disagree, and an explicit `--base` that a tag shadows is refused. A
  depth-1 checkout still fails closed, naming `fetch-depth: 0`.
- The public-hygiene guard's allowlist (CONTRIBUTING.md and the guard script)
  now exempts the two path checks only. The hashed-token scan runs on every
  tracked file, allowlisted ones included; before, a blocked name could sit in
  CONTRIBUTING.md unseen.
- Security: `--output` (default `conductor.sarif` in the checkout) and
  `--text-report` are no longer written through a symbolic link. A pull
  request could commit a symlink by that name and have the run overwrite its
  target (a hook, `.git/config`, a runner file). A link at the final path,
  dangling or not, is refused with exit 2, and the file is opened with
  O_NOFOLLOW where the platform has it. The write order is unchanged.
- The pull request comment no longer blames the registry for every
  did-not-verify state. It branches on what happened: a refusal by the
  action's own validate step (a backward pin, a trust-base input on a pull
  request) says the inputs were refused and nothing was installed; an install
  failure before the audit (npm too old to verify, npm install failing) says
  so; only a signature audit that actually failed carries the reason and the
  registry-or-sigstore-outage sentence. In every case conductor is not run.
- Every missing-gate remedy now names the scoped package
  `@vaultcompass/<product>` for dep-guard, vault-guard and intent-guard: the
  missing-gate finding, the could-not-run detail on a local run (which used to
  print no install remedy at all), and the comment `conductor init` writes
  for a gate it did not find. The unscoped dep-guard and intent-guard names
  are unclaimed on npm, so a bare "install dep-guard" could lead to a
  squatted package.
- Security: a history gate (gitleaks) in ANY shallow checkout is now
  could-not-run with reason `history-shallow`, naming `fetch-depth: 0`. This
  applies on any event (push, merge_group, a pull request, `fetch-depth: 50`),
  not only trust-base runs; under a trust base it is also enforced (exit 2)
  whatever `enforce` says, and on other runs the policy's own `enforce`
  stands. Workflows that ran gitleaks on a shallow checkout and passed will
  now report could-not-run until the checkout uses `fetch-depth: 0`. With the
  default depth of 1, `<base>..HEAD` held one grafted commit and a secret
  added then removed inside the pull request was never scanned (0 hits
  shallow against 2 full). conductor does not deepen the checkout itself.
  The README and INVARIANTS no longer say depth 1 fails closed for this.
  The gitleaks spawn also sets `GIT_NO_REPLACE_OBJECTS=1`.
- Security: the action no longer trusts `origin/<base>` as the trust base.
  A new step, "Fetch the trust base", runs only on a pull request. Exactly two
  steps hold a token, and neither runs conductor: that fetch step
  (`github.token`, to read the base branch; it moves the token into a
  non-exported variable before its first git call, so only the fetch subshell
  has it) and "Post the report" (`GH_TOKEN`, to write the pull request comment;
  it runs only the comment poster). The gates step and the new "Render the
  report" step, the only two that run conductor, have no token in their
  environment on any event (a job-level `GH_TOKEN` or `GITHUB_TOKEN` that the
  calling workflow sets is inherited by every step and is not stripped), and
  conductor is started there with
  `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN` removed
  (a job with `id-token: write` has the runner expose them to every step).
  The comment used to be one step holding `GH_TOKEN` whose fallback path ran
  conductor with it. It fetches the base branch (forced,
  from `$GITHUB_SERVER_URL/$GITHUB_REPOSITORY.git`, the token in GIT_CONFIG_*
  environment variables and never in argv) into the private ref
  `refs/conductor/trust-base`, checks it equals the fetched commit, and
  publishes the FULL COMMIT ID, which is what conductor and every gate receive:
  never a ref name, because git resolves a name through refs/tags/ too (a
  pushed tag named `refs/conductor/trust-base` or `origin/<base>` would have
  been taken for the ref). A failed fetch, or a stale private ref that cannot be
  removed, fails the step, so conductor never runs with a stale or absent trust
  base. The CLI resolves no `refs/` name through name resolution, sees through
  `origin/main~0`-style suffixes, and accepts a commit id on a pull request only
  if it equals the private ref, or `refs/remotes/origin/<base>` only when the
  private ref does not exist. An intent gate `--base` starting with a dash is
  refused (it was option injection: `--output=/x` produced an empty change
  set), and a name with a literal `@` is no longer cut short in the ambiguity
  check.
  `url.insteadOf` and other repository git config remain covered only by the
  no-pull-request-code-before-the-action precondition.
  Two holes closed: code from the pull request that ran earlier in the job
  could move `origin/<base>`, and a tag named `origin/<base>`, which anyone
  who can push tags can create, is resolved by git before the remote-tracking
  ref, so it chose the commit the rules came from. conductor now spells every
  ref it resolves in full, refuses a short ref name that matches more than
  one kind of ref, and refuses a `refs/remotes/origin/<base>` that
  disagrees with the private ref. The fetch is depth 1 only when the checkout
  is already shallow. If the fetch fails the step fails with an error naming the
  cause (the job needs `permissions: contents: read`); only the private ref is
  ever removed, and `refs/remotes/origin/*` is never touched.
  The job now needs `contents: read`. The README example runs the action in a
  job that runs no code from the pull request, and says that package.json
  lifecycle scripts bypass "require review on .github/workflows".
- A run in which no gate ran at all (none enabled, or every one deferred,
  tree-unchanged or skipped) no longer carries the verdict token `pass`. It
  carries the new closed-set token `nothing-checked`, a SIXTH token that
  consumers will now see (docs-only pull requests, equal-tree pull requests,
  all-deferred runs). A workflow that tests the `verdict` output for `== 'pass'`
  to mean "clean", or that lists the five earlier tokens, must add
  `nothing-checked`. The
  action's `verdict` output no longer reports a pass for a run that verified
  nothing. The exit
  status is unchanged (0). The action accepts `nothing-checked` only beside
  exit status 0, and its job summary says that nothing was checked.

### Changed

- The action's gate defaults: intent-guard 1.7.0 to 1.8.0, dep-guard 0.9.0 to
  0.10.0, vault-guard 1.8.0 to 1.9.0, with the matching `TAG_` constants in
  the backward-pin rule.

## [0.7.0] - 2026-09-29

**A minor package release.** `@vaultcompass/conductor` moves to 0.7.0 on npm
and the action's `conductor-version` default moves to `0.7.0` in lockstep,
the same number the `v0.7.0` tag names. This is a minor bump rather than a
patch: a new CLI option (`--text-report`), a new action output (`verdict`),
and the action now running the gates once for the job and the comment all
change what the umbrella does and exposes, not just how it reports it. The
0.6.1 action-only change (the signature-audit retry) is included, and is
described in its own section below.

### Added

- A verdict token: the text report's second line, directly under the version
  line, now reads `verdict-token: <token>`, and `conductor run` prints the
  same token on its job-log line. A closed set that labels the umbrella's own
  exit decision and decides nothing: `pass`, `advisory-blocked (N)`,
  `unenforced-findings (N)`, `blocked (N)` and `could-not-run`, with that
  precedence when several apply. `unenforced-findings` is the state a plain
  exit 0 used to hide: a run whose only blocking findings, or could-not-run,
  sit on `enforce: false` gates exits 0, and calling that `pass` would repeat
  the problem the token exists to fix. The closing `verdict:` sentence and
  the SARIF log are unchanged (issue #85).
- `conductor run --text-report <path>`. With `--format sarif` it writes the
  text report to that file from the same run, exactly what `--format text`
  would have rendered for the result, and runs no gate a second time. With
  `--format text` it is refused as a usage error (exit 2) before any gate
  runs (issue #85).
- The action has a `verdict` output carrying the token of the run that decided
  the job, and the gates step writes `conductor verdict: <token>` to the job
  summary. The token is validated against the closed set and against the
  exit status before it is published: a token that does not match the exit
  status is replaced by `could-not-run` (non-zero exit) or `unknown` (exit
  0), and the text report is deleted so the comment says it produced none.
  When the gate packages could not be verified and no gate ran, both say
  `could-not-run`, and the summary carries the reason. Both are empty or
  absent when the installed `conductor-version` predates `--text-report`.

### Changed

- The action no longer runs the gates a second time to render the pull
  request comment. The gates step now asks its one run for the SARIF log and
  the text report together, and the comment step posts that file, so the
  comment, the verdict token and the job's exit code are one run's answer
  rather than two that could disagree on a time or network dependent gate,
  and a pull request with the comment on costs one gate run instead of two.
  The comment step still runs nothing when the packages could not be
  verified, and now says so plainly when the gates step wrote no report.
  An installed `conductor-version` that does not know `--text-report` is
  detected by asking the binary (`run --help`), and keeps the old second-run
  comment; the gates step exit status is conductor's own in every state.
- The README now documents that the first-pull-request refusal recurs once
  on every new base branch, and that a `branches:` filter on the workflow
  trigger must include release and production branches so the promote pull
  request is still checked (issue #87).

### Fixed

- The install step's raw print of the `npm audit signatures` output, both
  attempts, now strips carriage returns, so text after one in that output can
  no longer start a line the runner's log reader would honour as a workflow
  command. The flattened `::error::` and `::notice::` arguments already did
  (issue #83).

**The consumer cost.** On a pull request, the backward-pin rule now refuses
`conductor-version` below `0.7.0`, because `TAG_CONDUCTOR_MINOR` moved with
the default and that constant is what the rule measures a pin against. A
workflow pinning `conductor-version: 0.6.0`, the version this README's own
examples named before this release, is refused rather than run. The migration
is to remove the input, whose default is the version this tag ships, or to
raise it to `0.7.0` or newer. The other three gate defaults and their
constants do not move in this release.

## [0.6.1] - 2026-09-29

**An action-only release. The tag moves; the npm package does not.**
`@vaultcompass/conductor` stays at 0.6.0 on npm and the action's
`conductor-version` default stays `0.6.0`.

### Fixed

- The action's install step failed an advisory run on a single
  transient registry attestation failure. `npm audit signatures` is now run
  once more after a short pause (`AUDIT_RETRY_DELAY_SECONDS`, 5 seconds) when
  the first attempt exits non-zero. It happened twice in one week with
  nothing wrong: on 2026-09-22, and again on 2026-09-29 in run 36522330217,
  where the same pins had verified cleanly two hours earlier in run
  36514871399. Each cleared on a plain re-run, and the flagged package was
  verified untouched both times. A pass on the retry continues and prints a
  `::notice::` naming what the first attempt said; a second failure fails
  closed exactly as before, with the second attempt's reason prefixed by
  "attempted twice".
  One retry and no more, and `verification-ok` is still written only after an
  audit has passed (issue #81).

## [0.6.0] - 2026-09-27

**A minor package release.** `@vaultcompass/conductor` moves to 0.6.0 on npm
and the action's `conductor-version` default moves to `0.6.0` in lockstep,
the same number the `v0.6.0` tag names. This is a minor bump rather than a
patch: two trust-boundary fixes, a reporting legibility pass, a new
`--project` option and two gate default moves all change what the umbrella
does or installs, not just how it reports it.

- **Fixed:** a pull request whose net diff is empty (a value committed and
  then backed out inside the same pull request) built a merge ref whose tree
  was byte-identical to the base branch's, and the equal-tree refusal in
  `refuseTrustBaseRef` treated that exactly like a trust base that resolves
  to the head or the merge commit itself: exit 2, nothing checked, including
  secrets-history (gitleaks), whose whole job is history rather than the
  tree and which had something to find. Found in the public proof
  repository's `proof/secret-in-history` pull request, at commit 21aebe9,
  before a third commit was added to move the tree and make the ordinary
  shape run instead. The refusal now makes one exception, and only one: a
  merge commit whose first parent is the trust base is not refused, because
  that is precisely the shape GitHub's own merge ref takes on an
  empty-net-diff pull request, and first-parent identity (never ancestry) is
  what tells it apart from the pull request's own branch, which is also an
  ancestor of the merge commit, also carries the same tree, and must keep
  being refused. Nothing about the ordinary refusals relaxes: the same
  commit as HEAD, a non-merge HEAD with an equal-tree ancestor, and the
  trust base resolving to HEAD's second parent are all refused exactly as
  before. In the one accepted shape, every enabled gate whose input is git
  history rather than the tree (gitleaks today) still runs, with its
  ordinary arguments; every other enabled gate is reported as tree-unchanged
  rather than spawned, with its own line in the report, its own clause on
  the one-line summary, and its own `conductor/tree-unchanged` SARIF
  notification, and none of it reaches the exit code (issue #69).

- **Security:** `refuseTrustBaseRef` only refused a `trust-base` ref that
  resolved to HEAD's own commit or to HEAD's own tree, which covers HEAD
  itself and an unmoved `origin/<pr-branch>`; once the base branch had moved,
  `origin/<pr-branch>` matched neither test, so a same-repo pull request could
  set `trust-base` to its own branch, in its own workflow file, and have
  conductor read `.guardrails.yaml` from the pull request after all, handing
  the pull request the whole policy. Found in review of #53. dep-guard's own
  base input took the stronger line for exactly this reason in 0.8.0: on a
  `pull_request` event an explicit value is refused outright. **action.yml's
  validate step now does the same for `trust-base`**, refusing an explicit
  redirect outright on a `pull_request` or `pull_request_target` event and
  naming the value given and the fix. Separately, `refuseTrustBaseForPullRequest`
  in the CLI catches a misconfigured or innocent-looking `--trust-base` when
  `GITHUB_BASE_REF` is set in the environment: the ref is accepted only when it
  resolves to the same commit as `origin/$GITHUB_BASE_REF`, which is what the
  Action itself always passes, so an ordinary pull-request run is unaffected
  (issue #58). **Neither layer closes anything against a pull request that
  edits its own workflow file** -- omitting `--trust-base` entirely, blanking
  `GITHUB_BASE_REF` in a step's own env, or pinning `uses:` to a tag published
  before this fix are all still open there, exactly as the README's "those
  four inputs may not pin backward" boundary already says of the same
  workflow-file risk; the control for a workflow edit is branch protection on
  the base branch with review required for `.github/workflows`, and nothing
  here substitutes for it. **The one consumer cost:** a workflow
  that set `trust-base` explicitly on a pull request must remove the input;
  the Action already derives `origin/$GITHUB_BASE_REF` itself on that event.

- **Fixed:** the vulnerabilities and dependencies summary lines could not
  tell a clean run from one that checked nothing. osv-scanner 2.x prints
  `results[]` only for a lockfile with findings, so a clean scan of one
  lockfile and a run that scanned none both printed `sources 0`; the
  vulnerabilities line now names the lockfiles the umbrella actually passed
  with `--lockfile`, by count and name, and separates that from
  `sources-with-findings`, the count osv-scanner itself reported. The
  dependencies line showed dep-guard's mode and corpus date but nothing
  about whether it ran online, so a quiet run and an offline one read the
  same; the line now prints `online true` or `online false` from dep-guard's
  own run-level `online` object when the installed dep-guard sends one and
  it names the field (read when present, a dep-guard release after 0.8.0),
  including the lookup count and the count skipped by its budget, because
  dep-guard also turns online checks on from its own config with no
  `--online` flag at all, and only dep-guard's own claim can be trusted
  about what it actually did. When there is no such claim to read, the line
  prints `online-flag passed` or `online-flag not passed` instead, naming
  only what the umbrella asked for rather than asserting a fact about what
  ran. An older dep-guard's own `online-deadline-exceeded` diagnostic still
  surfaces unchanged, and the umbrella never mints a second note about the
  same budget-exceeded event. A malformed `online` object is ignored rather
  than failing the gate: this is reporting, not judgment, and none of it
  reaches a severity, `blocking`, or the exit code. Both facts are also
  carried into the normalized gate details, and every gate's whole
  `run.details` bag is now published into SARIF as that gate's run
  properties, not only these two: vault-guard's `ignoredReported`,
  intent-guard's `reasons` and `driftCategories`, and gitleaks' own entries
  all reach a published log the same way, verbatim, even where the text
  report hides or filters them (issue #72).

- **Added:** intent-guard 1.7.0's own advance-notice warnings now appear on
  the intent line. 1.7.0 warns, rather than blocks, when a frozen contract's
  `protected_paths` or `allowed_paths` carries an entry no git path can ever
  match, and says the same shape will become a blocking reason in 2.0.0.
  conductor reads that gate's optional `warnings` array and relays each
  string as a note under the intent gate in the full report (`--verbose`, a
  non-clean run, or the pull-request comment, which always renders with
  `--verbose`), the same text-report channel dep-guard's own run diagnostics
  already print under, and counts it, without its text, in the clean
  one-line summary's note count otherwise. It is also a note-level
  notification in the SARIF log, a relay this release adds for
  intent-guard's own warning code only: dep-guard's run diagnostics still
  have no SARIF path. This is reporting only: no severity, no fingerprint,
  no finding, and no change to the composed exit code. Absent on an
  installed intent-guard older than 1.7.0, and ignored rather than treated
  as a could-not-run when the field is present but malformed.

- **Fixed:** a constraint finding intent-guard 1.6.0 caps at advisory,
  because its source is a prose rules file (CLAUDE.md, AGENTS.md, GEMINI.md,
  cursor rules), was rendered as a blocking, high-severity finding whenever
  the run blocked for any other reason. `normalizeIntentGuard` derived every
  drift finding's `blocking` flag and severity from the run's own
  `drift.action`, on the rule that the gate raises one reason for the whole
  score and none per finding; intent-guard 1.6.0 broke that premise for this
  one case without adding a field to say so; `finding_details[]` still
  reports `strength: "strong"` for a capped prose match exactly like an
  uncapped one, and the constraint's source is never carried onto the
  finding. The only surviving signal is the literal "advisory " prefix
  intent-guard's own drift.ts puts on the finding's message, which the
  normalizer now matches: a `constraint_violation` finding whose message
  starts with that prefix is never blocking and renders at `low` severity,
  regardless of `drift.action`, while every other drift finding in the same
  run, including an uncapped constraint violation, is unaffected. Nothing
  about the composed exit code changes either way; that already came from
  intent-guard's own exit code. **This is an interim fix, not a closed
  loop:** conductor is keyed to intent-guard's message text, and nothing in
  this repository detects an upstream rewording of that prefix -- the
  downgrade would silently stop matching and a capped finding would render
  blocking again with no warning anywhere in the report. Filed upstream as
  intent-guard #114, asking for a machine-readable per-finding field.
  Found by independent review of intent-guard PR #93 (issue #34).

- README: the advisory-workflow recipe now says why it carries no `paths:`
  filter by default. The main reason is not coverage, it is that GitHub
  treats a `paths:`-skipped required workflow as never having run rather
  than as passed, so a required check with no matching run sits pending
  forever and a docs-only pull request cannot merge; GitHub's own docs say
  so. Coverage is the second reason: gitleaks and vault-guard read the whole
  changed set because a secret can land in any file, so a filter that skips
  a docs-only pull request skips secrets scanning on it too. The recipe
  shows GitHub's own `paths:` syntax as an explicit trade for an adopter who
  wants it anyway, plus a note that renaming the JOB (not the workflow)
  means updating branch protection's required-checks list separately, since
  GitHub matches a required check by the job's context name, never the
  workflow's name (issue #39).

- **Added:** a `--project <dir>` option on `conductor init` and `conductor
  run`. dep-guard, vault-guard and intent-guard each take a path or
  `--project`, so a script can point any of them at a repository; conductor
  took nothing, so the only way to run it against a directory was to change
  into it first, which forces a `cd` compound onto every scripted call.
  Found setting up the public proof repository as a first-time adopter
  (issue #55). Omitting the flag is untouched on both commands: `run`
  resolves the root from the current directory exactly as it always has, and
  `init` and `init --revert` pass the current directory straight through to
  their own existing repository-root discovery, which already reports a
  non-repository as a structured conflict rather than throwing. Only an
  EXPLICIT `--project <dir>` goes through new resolution: the value resolves
  against the current directory when it is relative, and the repository root
  is then discovered from the result with the same `git rev-parse
  --show-toplevel` call `repoRoot` already made for the current directory,
  so a subdirectory of a repository resolves to that repository's top level.
  A path that does not exist, is not a directory, or is not inside a git
  repository is a usage error naming the path and exits 2, never a silent
  fall back to the current directory. From there on the resolved root is
  threaded through explicitly exactly as it already was: nothing downstream
  reads the working directory again, so the trust-base checks, the
  node_modules/.bin skip on a pull-request run, the program-vetting rules,
  and every child gate's own working directory are unaffected by where the
  flag points, only by what the resolved root is.
  The Action itself gains no new input: it always runs from the checkout it
  is given, and this flag is for scripted and local use outside it.

- **The umbrella now installs `dep-guard` 0.9.0 and `intent-guard` 1.7.0 by
  default, up from 0.8.0 and 1.6.0.** dep-guard 0.9.0 makes all four online
  checks honour npmrc registry pins and the default registry, adds a
  configurable online lookup budget whose default is larger on a
  pull-request run and which the report's own summary now shows, and
  resolves an alias lookup under the vouched name. intent-guard 1.7.0 warns
  on a `protected_paths` or `allowed_paths` entry that matches no git path,
  rather than doing nothing about it, and turns that same shape into a
  blocking reason starting in 2.0.0; this is the warning the "advance-notice
  warnings" entry above teaches conductor to relay as a report note. Their
  own `TAG_DEP_GUARD_*` and `TAG_INTENT_GUARD_*` constants in `action.yml`
  move in lockstep with the defaults, since those constants are what the
  pull-request backward-pin rule measures a pin against. `vault-guard-version`
  stays at `1.8.0`; it does not move in this release.

  **The consumer cost.** On a pull request, the backward-pin rule now refuses
  `dep-guard-version` below `0.9.0` or `intent-guard-version` below `1.7.0`,
  the same as it already refused older pins of the other two inputs. A
  workflow carrying either of those lines pinned explicitly to the old
  default (`0.8.0` or `1.6.0`) is refused rather than run, because this tag
  ships the newer gates and the rule will not let a pull request judge itself
  with an older one. The migration is to remove the input, whose default is
  the version this tag ships, or to raise it to `0.9.0` / `1.7.0` or newer.
  `TAG_CONDUCTOR_MINOR` moved too, with `conductor-version` itself: a
  workflow pinning `conductor-version: 0.5.0`, the version this README's own
  examples named before this release, is now refused on a pull request for
  the same reason and needs the same fix.

## [0.5.1] - 2026-09-27

**An action-only release. The tag moves; the npm package does not.**
`@vaultcompass/conductor` stays at 0.5.0 on npm and the action's
`conductor-version` default stays `0.5.0`.

### Changed

- **The umbrella now installs `dep-guard` 0.8.0 and `intent-guard` 1.6.0 by
  default, up from 0.7.0 and 1.5.2.** What reaches an adopter through the
  umbrella: dep-guard 0.8.0 adds the publish-age check, which runs only when
  the `dependencies` gate's options set `online: true` and then reports a
  dependency published inside its age floor at high, so it blocks at the
  default threshold; the umbrella already passes dep-guard `--base` on a pull
  request, so dep-guard's own new Action input is not involved here.
  intent-guard 1.6.0 makes two changes that can REDUCE what the intent gate
  blocks: a constraint sourced from a prose rules file (`CLAUDE.md`,
  `AGENTS.md`, `GEMINI.md`, cursor rules) is now advisory and never fails the
  run, and drift matching is coverage-based, with a partial match reported
  but never reaching the exit code. A repository that relied on either to
  block will see fewer blocking intent findings after this move. (1.6.0 also
  gives `intent-guard extract` a `--protected-path` flag; the umbrella never
  calls `extract`, so that one does not reach it.) Their own `TAG_DEP_GUARD_*`
  and `TAG_INTENT_GUARD_*` constants in `action.yml` move in lockstep with
  the defaults, since those constants are what the pull-request backward-pin
  rule measures a pin against. `vault-guard-version` stays at `1.8.0` and
  `conductor-version` stays at `0.5.0`; neither changes in this release.
  Outside a pull request, a workflow that pins either input explicitly is
  unaffected by this default move, and the change only reaches an adopter
  who left the input at its default; on a pull request the next paragraph
  applies.

  **The consumer cost.** On a pull request, the backward-pin rule now refuses
  `dep-guard-version` below `0.8.0` or `intent-guard-version` below `1.6.0`,
  the same as it already refused older pins of the other two inputs. A
  workflow carrying either of those lines pinned explicitly to the old
  default (`0.7.0` or `1.5.2`) is refused rather than run, because this tag
  ships the newer gates and the rule will not let a pull request judge itself
  with an older one. The migration is to remove the input, whose default is
  the version this tag ships, or to raise it to `0.8.0` / `1.6.0` or newer.

## [0.5.0] - 2026-09-26

**A minor package release.** `@vaultcompass/conductor` moves to 0.5.0 on npm
and the action's `conductor-version` default moves to `0.5.0` in lockstep,
the same number the `v0.5.0` tag names. This is a minor bump rather than a
patch: two new gate roles and two behaviour changes to `conductor init` both
change what the umbrella does, not just how it reports it.

- **Behaviour change:** `conductor init` no longer writes a pre-commit hook
  by default. It writes only `.guardrails.yaml` and the manifest, and prints
  one line saying no hook was written and how to add one. Pass `--hook` to
  get the previous behaviour. `--adopt` and `--force` now error when given
  without `--hook` on an init, rather than being silently ignored, since both
  are entirely about the hook. `--revert` is unaffected: it still removes a
  hook a previous `--hook` run wrote. A repository whose hook came from an
  older conductor must re-run `conductor init --hook` to refresh it: a plain
  re-init no longer touches hooks at all, and now prints the no-hook line
  even while that older hook still sits on disk. `.git/hooks` is never part
  of a clone, so writing one unconditionally could never reach a second
  contributor's checkout anyway; the README now documents re-running
  `conductor init --hook` on each clone that wants it (issue #48).
- Fixed the job-log summary line `conductor run --output` prints after
  writing a report to a file: it used to report "N gate(s), N finding(s)"
  even when the trust base was refused and no gate ran at all, because a
  refused run's report carries one could-not-run outcome per enabled gate,
  which read exactly like N real findings on a log with no comment and no
  `--verbose` to explain it. It now prints the same refusal sentence the
  pull-request comment's compact body uses, naming what was refused and why,
  instead of a count. An ordinary run's line is unchanged (issue #46).
- **Behaviour change:** `conductor init` now writes the intent gate enforced
  (`enforce: true`) when a frozen intent contract already exists at init
  time (`.intent-guard/intent-contract.yaml`, or the pre-1.3.0
  `.conductor/intent-contract.yaml`), instead of always leaving it
  unenforced. Without a frozen contract it is still written unenforced,
  now with a comment explaining why and what to change once one is frozen.
  This can turn a green check red once a contract is frozen: before this, a
  frozen contract with protected paths produced findings on a pull request
  without ever failing the check, which needed a separate commit to fix on
  the public demo repository (issue #57).
- On a pull-request run, the gate runner now also passes `--base` to
  dep-guard, pointing at the same ref as `--trust-base`. Before this,
  dep-guard only ever received `--trust-base` from the umbrella, so every
  scan had no earlier revision to compare dependencies against and the
  lockfile-tamper comparison signals never ran, even through a pull request
  (dep-guard issue #62). `--base` is never added on a staged run, since
  dep-guard's own CLI refuses `--staged` and `--base` together; vault-guard
  and intent-guard are unaffected, since the umbrella never passed either
  gate a `--base` flag and still does not.
- Added: two gate roles, `secrets-history` (gitleaks 8.19 or later, git
  history mode) and `vulnerabilities` (osv-scanner 2.x). Both are installed
  by the adopter, never by conductor; a missing binary is could-not-run.
  Findings appear in the report and SARIF like any gate. On a pull request
  their config files (`.gitleaks.toml`, `.gitleaksignore`,
  `osv-scanner.toml`) are read from the base ref, with a neutral stand-in
  when the base has none, and a head-side change is reported as a proposal.
  gitleaks' exit for a leak is moved to 3 so its error exit 1 reads as
  could-not-run, and a clean gitleaks exit that logged a git error is
  could-not-run too. On a pull request gitleaks also ignores inline
  `gitleaks:allow` comments. osv-scanner is handed each tracked npm-family
  lockfile by name (`git ls-files`, never a directory walk, so `.gitignore`
  cannot hide one); with none tracked it is not spawned and the gate is
  clean with a note, as is its own exit 128. On a pull request gitleaks runs
  from a directory holding the base ref's copies of any files its config
  extends, scans merge commits by their first-parent diff (one finding per
  leak, other commits listed), and logs at a pinned info level. `init`
  says in one line when it enabled an external gate because the tool was on
  this machine's PATH. Unchanged by the two new roles: the three npm gates'
  exit reading, version probe and timeout; their argv changes only where the
  base-ref bullet above says so.

## [0.4.7] - 2026-09-26

**A package release.** `@vaultcompass/conductor` moves to 0.4.7 on npm and
the action's `conductor-version` default moves to `0.4.7` in lockstep, the
same number the `v0.4.7` tag names. The Action input this release adds
requires the CLI flag it depends on, so the two ship together.

- Added `conductor run --advisory` and the Action's matching `advisory`
  input. Advisory now means "findings do not block", never "the step cannot
  fail": the flag maps exit 1 to exit 0, and leaves exit 2 (a gate that could
  not run) untouched. Adopters running the umbrella with `continue-on-error`
  on every step had that setting swallow a real crash for two days
  (issue #36), because it could not tell a blocking finding from a gate that
  never ran. The Action passes the flag to both the gates step and, when
  `pr-comment` is on, the step that renders the pull request comment, so the
  comment's own verdict line matches the job's actual exit code. The README's
  advisory recipe now sets `advisory: true` instead of `continue-on-error`,
  with no `continue-on-error` anywhere in it. The flag and the Action input
  ship together, so this lands only in a package release: a tag moved without
  the package would offer an input the umbrella does not understand, and
  `--advisory` would be an unknown flag there, exiting 2.

## [0.4.6] - 2026-09-25

**A package release. The tag and the package converge.**
`@vaultcompass/conductor` moves to 0.4.6 on npm and the action's
`conductor-version` default moves to `0.4.6` in lockstep, the same number
the `v0.4.6` tag names.

- **A gate that could not run now says so, instead of looking like a missing
  tool.** Reported by an adopter whose check went red for two days while
  scanning nothing, with `conductor: command not found` as the only symptom.
  `npm audit signatures` had failed transiently, the step died under `set -eu`
  before the line that puts the install on `PATH`, and the pull-request comment
  step (which runs on failed runs by design) reached for a binary it could not
  resolve, swallowed that, and posted a comment built from an empty file.

  Fail-closed is unchanged: an unverified install still exits non-zero and no
  gate runs. What changed is everything around it. The `PATH` write now
  precedes the audit, so no fail-closed check can disguise itself as a missing
  tool. The audit's failure carries its reason into the step outputs and a
  workflow error. The comment step posts a compact could-not-run note naming
  the reason, and says plainly that a registry or sigstore outage produces this
  too, because the alternative is an adopter reading "signature verification
  failed" on their own pull request and fearing the worst. `pr-comment.mjs`
  never posts an empty report as if it were a result.

  The comment step runs the umbrella only when the install step positively
  recorded that verification passed, rather than when no failure was flagged.
  The packages are on disk well before the audit, so a failure anywhere earlier
  would otherwise leave nothing verified and no flag set.

- Conductor invokes **itself** by absolute path, matching dep-guard,
  vault-guard and intent-guard, which all document this as resistance to a
  workflow that prepends its own `node_modules/.bin`. `PATH` still carries the
  install prefix, because the umbrella resolves each *gate* by name and that is
  the only thing that needs it.

- Documented why the first pull request that adds `.guardrails.yaml` is inert, and that the preview of an unmerged policy is `conductor run --verbose` on your own checkout.

- Pinned the Action's npm floor (10.5.2), version-shape regex, `--ignore-scripts` install, and `npm audit signatures` step in a drift check, so a quieter edit of those lines goes red here. The hygiene blocklist comment now names all four family repositories. Adopter feedback is linked from the README, and the invariant citation for the umbrella's own finding ids now points at README.md:980-984.

- **The text report now carries conductor's own version, as its first
  line** (`conductor <version>`), sourced from the same `package.json`
  version the SARIF renderer already carries. This report is also the
  pull-request comment body, and until now nothing on it said which
  conductor produced it. Left off the one-line clean summary on purpose;
  that line stays exactly one line.
- **The `pr-comment` step's text run now takes `--compact-on-refusal`.**
  When the trust base was refused and no gate ran, the comment shrinks to
  the version, the verdict, and every refusal detail line the full report
  would have printed for this case (the reason and, when the base ref
  carries no policy file at all, the remedy that reason names), instead of
  the full per-gate report. There is no pointer at a step log: a fork's
  read-only token cannot even show the commenter that log, so the reason
  has to be readable on the comment itself. An adopter with no policy on
  the base ref yet otherwise got a full sticky comment on every push whose
  entire content was "refused, nothing checked". The new `--compact-on-refusal`
  CLI flag is a no-op on any run that was not refused; exit codes, verdict
  semantics, and when the comment posts are unchanged.
- **README: the advisory-check section now includes a complete copy-paste
  job** (checkout, setup-node, an explicit fetch of the base ref, and the
  conductor step with `pr-comment: true`), with `continue-on-error: true` on
  every fallible step so a required job never goes red over a hung or failed
  advisory step, and a note that 0.4.5 already self-fetches the base so the
  explicit fetch step is belt and braces rather than a requirement.
- README: documented running the gates as an advisory check with a step
  `timeout-minutes`, since `continue-on-error` swallows a failing exit code
  but does not bound a step that hangs. Notes that the Action already caps
  each gate's own subprocess at 120 seconds and reports a timeout as
  could-not-run, so the step timeout is an outer bound rather than the
  primary control. Surfaced by an adopter during advisory dogfooding.
- **Split `init.ts` into `init-hook-detect.ts`, `init-manifest.ts`, and
  `init-policy.ts`**, a pure refactor with no behaviour change of its own.
  Alongside it, `conductor init` now prints a note on when a written policy
  takes effect: the pre-commit hook uses the working-tree file on the very
  next commit, since it runs `conductor run --staged --stage commit` with
  no trust-base flag, while a pull request is judged by the base branch's
  copy and reports could-not-run until the file is merged there. The note
  appears on write, dry-run and already-installed runs and never on a
  conflict, and tests pin all of those renders.

## [0.4.5] - 2026-09-20

**A package release. The tag and the package converge.**
`@vaultcompass/conductor` moves to 0.4.5 on npm and the action's
`conductor-version` default moves to `0.4.5` in lockstep, the same number
the `v0.4.5` tag names. Versions 0.4.1 through 0.4.4 were action-only
releases that moved the tag while the package stayed at 0.4.0; this release
re-converges the two numbers.

- Fixed the validate step's version-shape check to refuse a leading zero
  (`01.2.3`, `0.6.00`), matching the sibling scanners' regex; npm reads a
  value it cannot parse as a version as a dist-tag instead, which is the
  exact hole this check exists to close.
- Added a test covering the same-minor, lower-patch backward-pin refusal
  (the W3 patch-comparison arm), the only one of the four version inputs
  reachable through it being intent-guard.
- README: added a canonical `uses: vaultcompasshq/conductor@v0.4.4` example
  and updated the other consumer-facing examples to match; `uses: ./` reads
  `action.yml` from the caller's own tree and is not a form a real consumer
  should copy.
- **A pull-request run against a base ref with no `.guardrails.yaml` now
  reports could-not-run through the same path as any other unusable trust
  base**, with the reason in the text report (stdout) rather than only on
  stderr, a `verdict: exit 2` line, and the head's own gates named as
  `DID NOT RUN (preparation-failed)`. This case already exited 2 before this
  change, but through an uncaught `PolicyError` that printed one line to
  stderr and left stdout (and the SARIF file) empty, so a run in advisory
  mode read as a red step with nothing useful attached, and the `pr-comment`
  step had no report text to post. Two consumer teams hit exactly this on
  their first pull request, before `conductor init` had landed on their base
  branch (see FINDINGS.md, 2026-09-20). This is a judgment call about which
  side of the line a case sits on: a base ref that DOES carry a policy file
  in which every gate is disabled or deferred is a decision someone wrote
  down on purpose and still reports a clean exit 0; only an ABSENT config on
  the base is treated as could-not-run.
- **`action.yml` now shallow-fetches the trust base for a pull-request run**
  when the checkout does not already carry it (the `actions/checkout`
  default is `fetch-depth: 1`, the head commit alone), so a consumer no
  longer has to add their own fetch step to make `origin/<base>` resolve.
  The fetch is a no-op when the ref already resolves, never fails the job
  when it cannot reach the remote (a `::warning::` names the exact command
  to add instead), and uses an explicit `<ref>:refs/remotes/origin/<ref>`
  refspec rather than a bare `git fetch origin <ref>`, which only updates
  `FETCH_HEAD` and would have left the ref just as unresolvable on a
  single-branch checkout.

## [0.4.4] - 2026-09-19

**An action-only release. The tag moves; the npm package does not.**
`@vaultcompass/conductor` stays at 0.4.0 on npm and the action's
`conductor-version` default stays `0.4.0`.

### Added

- **A `pr-comment` opt-in input on the Action**, for an advisory
  (non-required) run whose findings would otherwise live only in the job's
  exit code and log. Set to exactly `"true"` (default `"false"`, so an
  existing consumer is unaffected), it posts conductor's own text report as a
  pull request comment, only on a `pull_request` or `pull_request_target`
  event and only with `permissions: pull-requests: write` granted on the
  calling job. The comment is **sticky**: a hidden marker in the body lets a
  re-run find and update that same comment rather than adding a new one every
  push. **Fork-safe by construction**: the default `GITHUB_TOKEN` on a fork
  pull request is read-only regardless of the granted permission, so the post
  fails there; the step catches that, prints a `::warning::`, and continues
  rather than failing the job or changing the gate's own verdict. The report
  reaches `gh` by file, never interpolated into a command line, using `gh
  api`'s `-F` (file-read) form rather than `-f` (literal-string), which
  matters because they take the same `key=@path` shape and only one of them
  reads the file. The sticky match requires the marker AND that the existing
  comment was authored by the GitHub Actions bot, not the marker alone: on
  `pull_request_target`, which hands this step a write token even though the
  pull request is untrusted, anyone who can comment on the pull request
  could otherwise plant the marker in their own comment ahead of conductor's
  first run and have every later run silently PATCH it. An optional
  `pr-comment-marker` input overrides the built-in marker, for a workflow
  that runs this Action more than once against the same pull request (one
  package in a monorepo per run); left unset, behaviour for a single
  invocation is unchanged. See the README's "The report as a pull request
  comment" section, including the note there on the real-`gh` smoke test
  (`scripts/tests/pr-comment-smoke.test.mjs`) this surface needs before a
  release, since the offline suite's `gh` shim cannot distinguish `-f` from
  `-F`.

### Changed

- **The umbrella now installs `vault-guard` 1.8.0 and `dep-guard` 0.7.0 by
  default, up from 1.7.0 and 0.6.0.** Both releases fail closed on an empty
  scan rather than reporting one that never ran as a clean pass. Their own
  `TAG_VAULT_GUARD_*` and `TAG_DEP_GUARD_*` constants in `action.yml` move
  in lockstep with the defaults, since those constants are what the
  pull-request backward-pin rule measures a pin against. `intent-guard-version`
  stays at `1.5.2` and `conductor-version` stays at `0.4.0`; neither changes
  in this release.

  **The consumer cost.** On a pull request, the backward-pin rule (added in
  0.4.3) now refuses `vault-guard-version` below `1.8.0` or `dep-guard-version`
  below `0.7.0`, the same as it already refused older pins of the other two
  inputs. A workflow carrying either of those lines below the new floor is
  refused rather than run, because this tag ships the newer scanners and the
  rule will not let a pull request judge itself with an older one. The
  migration is to remove the input, whose default is the version this tag
  ships, or to raise it to `1.8.0` / `0.7.0` or newer.

## [0.4.3] - 2026-09-18

**An action-only release. The tag moves; the npm package does not.**
`@vaultcompass/conductor` stays at 0.4.0 on npm and the action's
`conductor-version` default stays `0.4.0`. What moves is the intent gate the
action installs.

### Security

- **On a pull request, the four `*-version` inputs may not pin BACKWARD.** The
  validate step checked that each input is an exact version and nothing more,
  which is not the control for version choice: on a same-repo `pull_request`
  event GitHub runs the workflow file from the head, so those four pins are
  written by the pull request being judged. Once a gate has two published
  versions, a pull request could pin back to the release that predates the rule
  which would have caught it, clear the shape check, and be judged by the rule
  set it chose for itself. That is the same class of hole as an input that
  turns pull-request mode off, which this action refuses to offer, except that
  deleting a control reads as deleting a control while `intent-guard-version:
  1.4.0` reads as ordinary version management.

  Where `GITHUB_BASE_REF` is set, the step now refuses any of the four inputs
  naming a version below the one this action tag ships, naming both numbers and
  the fix, which is to remove the input. Pinning **forward** is still accepted
  there, on an assumption the rule does not enforce: that a newer gate is at
  least as strict. Forward pins are not bounded.

  Each input has its own constant in `action.yml`, separate from
  `TRUST_BASE_MIN_VERSION` in `src/gate-runner.ts` even where the numbers
  agree. That floor is flag compatibility, the oldest build that understands
  `--trust-base`; these are the tested versions this tag ships, and one
  constant serving both is how raising one silently raises the other.

  **Where it fires** is exactly where `GITHUB_BASE_REF` is set, which is
  `pull_request` and `pull_request_target`. Push runs are out of scope and the
  shape check stays their only version gate. That is a statement of scope, not
  a safety argument: a push to an unprotected branch runs that branch's own
  workflow file, written by the same author, and is as author-controlled as a
  pull request. It is not covered.

  **What this does not cover:** forks, where the base repository's workflow
  file runs, so a fork author never writes the pins that judge them (the rule
  still fires on a fork pull request and judges the base workflow's own pins,
  so a deliberate backward pin there refuses every fork run); `merge_group`
  events, where `GITHUB_BASE_REF` is empty although the queue branch carries the
  pull request's commits and workflow file, so a consumer whose only required
  check runs there gets nothing from this rule and should keep the
  `pull_request` run required too; and a pull request that deletes the step or
  moves the `uses:` pin, for which branch protection with review required for
  `.github/workflows` remains the control.

  **The cost today** is not one refusal and not one input. Every one of the four
  has published versions below its constant, and counted from the registry on
  2026-09-18 there are 46 pins that a pull request may no longer carry:
  `conductor-version` has 6 below 0.4.0 (0.2.0 through 0.3.0),
  `dep-guard-version` 8 below 0.6.0, `vault-guard-version` 25 below 1.7.0, and
  `intent-guard-version` 7 below 1.5.2. A workflow carrying any of them now
  fails on a pull request. **The migration is to remove the input**, whose
  default is the version this tag ships, or to raise it to that version or
  newer.

  What each input loses differs, and it is worth being exact about it.
  `dep-guard-version` and `vault-guard-version` below the constant were already
  degraded rather than working: their `TRUST_BASE_MIN_VERSION` floors in
  `src/gate-runner.ts` are the same numbers, 0.6.0 and 1.7.0, so on a
  pull-request run the umbrella **withheld** `--trust-base` from those builds.
  Withheld is not a failure: the gate still ran, read its own control inputs
  from the tree under judgment, and was reported on the run's report line, in
  the summary and as a `conductor/trust-base-not-passed` SARIF notification.
  Those pins now become a hard refusal instead. `intent-guard-version` 1.4.0,
  1.5.0 and 1.5.1 were fully functional in pull-request mode, since that gate's
  floor is 1.4.0 and sits below the constant, and they are now refused outright;
  1.2.x and 1.3.x were withheld before. The sharpest cost is
  `conductor-version`: the umbrella holds no floor on itself, so its 6 older
  pins went from fully working to refused with no prior mechanism at all.

### Changed

- **The `intent-guard-version` default moves from `1.4.0` to `1.5.2`.**
  intent-guard 1.5.1 refused `--paths ''`, which is exactly what the umbrella
  sends on a pull request whose change set is empty, so that version turns an
  empty diff into a failed gate. 1.5.2 fixes it. **Never pin 1.5.1 here.** The
  pull-request rule above measures `intent-guard-version` against 1.5.2 from
  this tag on.

  Unchanged, and deliberately: `TRUST_BASE_MIN_VERSION` in
  `src/gate-runner.ts` and the "intent-guard from 1.4.0" line in the README
  both stay at 1.4.0. Those are the floor at which intent-guard understands
  `--trust-base`, which is a statement about a flag rather than about what this
  tag ships, and 1.4.0 still understands it.

## [0.4.2] - 2026-09-18

**An action-only release. The tag moves; the npm package does not.**
`@vaultcompass/conductor` stays at 0.4.0 on npm and the action's
`conductor-version` default stays `0.4.0`.

### Fixed

- The release workflow's "Decide the release kind" step ran before
  `Install dependencies`, but the classifier it runs imports the `yaml`
  package. The v0.4.1 tag failed at that step with `Cannot find package
  'yaml'` before it could decide anything: nothing was published and no
  GitHub Release was created, which is the fail-closed outcome the workflow
  is built for, but it also means v0.4.1 has no Release page. Install now
  runs first. This tag carries everything v0.4.1 described below.

## [0.4.1] - 2026-09-18

**An action-only release. The tag moves; the npm package does not.** Nothing in
the umbrella changed, so `@vaultcompass/conductor` stays at 0.4.0 on npm and
the action's `conductor-version` default stays `0.4.0`.
`vaultcompasshq/conductor@v0.4.1` installs `@vaultcompass/conductor@0.4.0`.

### Security

- **The action no longer runs install scripts, and verifies what it
  installed.** The install step ran `npm install -g` with no
  `--ignore-scripts` on a runner holding the job's token, so every package in
  the resolved tree had arbitrary code execution there on every run. The four
  things this action installs are control inputs: they decide whether a pull
  request may merge.

  It now also runs `npm audit signatures` over the installed tree. That needs
  a root manifest to cover anything: the audit walks the tree's edges out, and
  a global install leaves `<prefix>/lib` with no manifest, so without one the
  audit covers the gates' dependencies and silently skips all four gates.
  Measured on this exact tree: 32 signatures and 8 attestations without the
  manifest, 36 and 12 with it.

  **What the verification proves, stated narrowly** because the obvious
  summary is wrong: it asks the registry for each name and version in the
  tree, the four gates included, and checks the signature served back. It does
  **not** read the installed files, so a tampered install is invisible to it;
  it does **not** defeat a compromised registry, which signs what it serves;
  and a **missing** attestation is not a failure, so it does not require
  provenance even though all four packages publish it.

### Fixed

- **A floor on the npm client, so the action cannot report a clean install as
  tampered with.** `npm audit signatures` is not version-stable: below npm
  **10.5.2** it fails on an untampered install of these very packages, because
  the client's own bundled keys and TUF root are stale. On 10.5.0 it reports
  *"Someone might have tampered with these packages since they were published
  on the registry!"*, naming ours; on 10.2.4 it is `EEXPIREDSIGNATUREKEY`.
  Bisected against a real four-gate install, with a cold cache and a fresh
  home so no newer client could have primed the TUF root or the key set:
  8.19.4, 9.9.4, 10.2.4, 10.5.0 and 10.5.1 fail; 10.5.2 and later pass, with
  10.5.2 verifying the same package and attestation counts as current npm
  rather than a reduced set.

  This action does not install Node itself, by design: the documented workflow
  has the caller do that. So the floor is enforced rather than assumed, and
  the refusal names the npm it found.

  Note that a bare major is not enough: **Node 22.0.0 ships npm 10.5.1**,
  inside the failing band. Pin 20.13.0 or later, or 22.1.0 or later.

### Added

- **`scripts/lib/release-kind.mjs` and `scripts/classify-release-tag.mjs`**,
  ported from the guard repositories. The release workflow knew exactly one
  tag shape, "v" plus the package version, which is right for a package
  release and wrong for an action-only one. An action-only tag now has to
  clear every condition before anything is published: exact semver, ahead of
  the package version, an entry in this file, the package already on the
  registry, and an action default that still matches. A tag failing any of
  them is refused rather than treated as the quieter kind of release.

- **This file.**
