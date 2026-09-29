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

### Fixed

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
- Security: a history gate (gitleaks) in a shallow checkout is now
  could-not-run with reason `history-shallow`, naming `fetch-depth: 0`, and
  under a trust base it is enforced (exit 2) whatever `enforce` says. With
  the default checkout depth of 1, `<base>..HEAD` held one grafted commit and a
  secret added then removed inside the pull request was never scanned (0 hits
  shallow against 2 full). conductor does not deepen the checkout itself.
  The README and INVARIANTS no longer say depth 1 fails closed for this.
- Security: the action always force-fetches the base ref
  (`+refs/heads/<base>:refs/remotes/origin/<base>`) instead of skipping the
  fetch when the ref already resolved, so code from the pull request that ran
  earlier in the job cannot point `origin/<base>` at a commit of its own. The
  fetch is depth 1 only when the checkout is already shallow (a depth on a
  full clone would turn it shallow). If the fetch fails, any existing copy of
  the ref is deleted and a warning is printed, so conductor fails closed on
  an unresolvable trust base. The README example now runs the action in a job
  that runs no code from the pull request, and says that package.json
  lifecycle scripts bypass "require review on .github/workflows".
- A run in which no gate ran at all (none enabled, or every one deferred,
  tree-unchanged or skipped) no longer carries the verdict token `pass`. It
  carries the new closed-set token `nothing-checked`, so the action's `verdict`
  output no longer reports a pass for a run that verified nothing. The exit
  status is unchanged (0). The action accepts `nothing-checked` only beside
  exit status 0, and its job summary says that nothing was checked.

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
