# Normalizer fixtures

Every file here is the literal stdout of a real gate binary, captured once
and committed unchanged. Nothing in this directory was written by hand,
because a hand-written fixture only proves the normalizer agrees with
whoever wrote the fixture. The gate version is in each file name, so a
fixture that stops matching a newer release is visible as a stale name
rather than as a silent disagreement.

The scratch repository behind every capture is one commit of a two-file
Node project, with a second commit staged but not committed:
`package.json` gains two dependency names that are not real packages
(`lodahs`, a near-miss for `lodash`, and `reqeusts-http-client`), and a new
`src/config.js` carries a fabricated GitHub token that matches no real
account. The clean captures come from a sibling repository with an
ordinary new source file staged and nothing else.

Paths below are written relative to each product's own checkout.

## dep-guard 0.2.0

    dep-guard scan --staged --format json --corpus-dir <corpus>

`dep-guard-0.2.0-blocking.json` is the staged squat plus the unknown name;
`dep-guard-0.2.0-clean.json` is the same command in the clean repository.
`--corpus-dir` points at a locally built corpus, which is why the
`corpusBuiltAt` timestamp in the fixture is a date rather than a release.

## vault-guard 1.4.2

    vault-guard scan --staged -f json

`vault-guard-1.4.2-blocking.json` is the staged token;
`vault-guard-1.4.2-clean.json` is the clean repository.

## intent-guard 1.2.0

    intent-guard-check --project . --staged --json

Run after `intent-guard init`, `intent-guard extract`, and
`intent-guard freeze`, with a `budget` block hand-added to the frozen
contract so the change-budget rules have something to fire on.

`intent-guard-1.2.0-budget-blocking.json` has three budget violations and
no drift findings. `intent-guard-1.2.0-drift.json` is the same command with
`--signals` and `--message` added so the drift half is non-empty too; it is
the fixture that covers `finding_details`, which 1.2.0 added and which
earlier design notes assumed would not exist.

## intent-guard 1.2.1

The four captures behind the pull-request flow, taken from
`@vaultcompass/intent-guard@1.2.1` installed from the registry into a
throwaway package, run against a throwaway project holding
`superpowers/specs/2026-09-03-widget-cache-design.md` and
`superpowers/plans/2026-09-03-widget-cache.md` from this directory as its
`docs/superpowers` tree. Every command below ran with the project directory
as the working directory and `--project .`, which is why no absolute path
appears in any of them: with an absolute `--project`, 1.2.1 echoes absolute
paths back in `spec_dir` and `imported_files`.

    intent-guard import-spec --project . --from superpowers --dry-run
    intent-guard freeze --project . --approved-by "conductor: ..." --yes --json
    intent-guard check --project . --paths <changed> --json

`intent-guard-1.2.1-import-spec-superpowers-dry-run.json` is the drafted
contract the umbrella freezes for one run. `contract_id` and `frozen_at` are
minted per invocation, so this capture's id differs from the one in the
freeze capture beside it; nothing reads either.

`intent-guard-1.2.1-freeze.json` is the approval step.
`intent-guard-1.2.1-check-budget-blocking.json` is three changed paths
against the spec's `allowed_paths: ["src/widget/**"]` and `max_files: 2`,
which breaches both rules. `intent-guard-1.2.1-check-passing.json` is one
path inside the budget. `intent-guard-1.2.1-check-no-contract.json` is the
same command in a project with no state directory at all.

These are captures of **1.2.1**, so the `.conductor` paths inside them are
that version's output and must stay exactly as they are. intent-guard 1.3.0
renamed the state directory to `.intent-guard`, and the umbrella reads both;
rewriting these files to the new name would turn a record of what 1.2.1
really printed into a guess about what 1.3.0 prints, which is the whole
failure this directory exists to prevent. A 1.3.0 capture is worth adding
beside them rather than instead of them.

### Why the spec here is not one of the real org specs

The captured chain was also run against a real spec and plan pair from a
sibling repository, and the drafted contract that came back carries two
things this repository's own lint refuses in a tracked file: absolute
machine paths, lifted verbatim out of the plan's `Run:` lines, and em
dashes out of the spec's prose. That is a true property of the tool on real
input rather than a problem with the capture, and it is the reason
intent-guard's own docs tell you to scrub a draft before freezing it. The
committed fixtures therefore come from a spec and plan written for the
purpose, in the same shape and with a budget block; the real-artifact run
is recorded in the branch's report instead of here.

## gitleaks 8.30.1

Release `v8.30.1`, the `darwin_arm64` tarball from the gitleaks GitHub
release, checked against `gitleaks_8.30.1_checksums.txt` with
`shasum -a 256` before use. The version probe is a subcommand, not a flag:

    $ gitleaks version
    8.30.1

It prints that one line and exits 0 without scanning, so the candidate is
marked version-safe.

The blocking capture comes from a throwaway two-commit repository. The
first commit adds `config.json` carrying a synthetic Doppler-shaped token
(`dp.pt.` and 43 alphanumerics) which belongs to no account. Only its first
twelve characters, `dp.pt.q7ZkR2`, are written here, so this file does not
itself carry a token shape for push protection or a secrets gate to stop
on; the normalizer tests assert that prefix never reaches a finding. The
second commit deletes the file, so the secret exists only in
history. Both commits use the throwaway identity `Fixture
<fixture@example.invalid>`, which is why that name appears in the report.
The command is exactly the argv the umbrella builds on a local run:

    gitleaks git --report-format json --report-path <out> --exit-code 3 \
      --redact --no-banner --log-opts HEAD <repo>

`gitleaks-8.30.1-history-blocking.json` is the report file (exit 3). It
has one entry, rule `doppler-api-token`, with `Match` and `Secret` both
`REDACTED`. The field names match the gitleaks README: `RuleID`,
`Description`, `StartLine`, `EndLine`, `StartColumn`, `EndColumn`,
`Match`, `Secret`, `File`, `SymlinkFile`, `Commit`, `Entropy`, `Author`,
`Email`, `Date`, `Message`, `Tags`, `Fingerprint`. `Fingerprint` is
`commit:file:rule:line`. `gitleaks-8.30.1-history-clean.json` is the same
command against a one-commit repository holding only a README (exit 0,
report `[]`).

Two error observations the runner depends on:

- A missing `--config` file is a fatal log line (`FTL`), exit 1, and no
  report file is written.
- A git failure is NOT an error exit. With `--log-opts origin/main..HEAD`
  in a repository that has no `origin/main` (the shape of a shallow
  pull-request checkout that never fetched its base), and equally with the
  scan path pointing at a directory that is not a repository at all,
  gitleaks logs the git error at `ERR` level, scans 0 commits, writes a
  report of `[]`, and exits **0**. `gitleaks-8.30.1-unknown-base-ref.stderr.txt`
  is that run's stderr, byte for byte, ANSI colour codes included: gitleaks
  colours its log even when stderr is not a terminal. Read by exit code
  alone this is a clean pass over nothing, so the runner also reads
  stderr for an `ERR` line.

One suppression observation, from a throwaway pull-request branch that
added the token and then a `.gitleaksignore` naming its fingerprint:
gitleaks loads `<scan root>/.gitleaksignore` even when
`--gitleaks-ignore-path` points somewhere else, so the flag alone does not
stop a head-side ignore file. With the scan root given as the repository's
git directory (`git rev-parse --absolute-git-dir`) instead of `.`, the same
history is scanned, `File` values are still repository-relative, the head's
ignore file is not loaded, and an ignore file passed through the flag still
applies. That is what the umbrella does on a pull request.

## osv-scanner 2.6.0

Release `v2.6.0`, the `osv-scanner_darwin_arm64` binary from the
osv-scanner GitHub release, checked against `osv-scanner_SHA256SUMS` with
`shasum -a 256` before use. The version probe prints four lines; only the
first is read:

    $ osv-scanner --version
    osv-scanner version: 2.6.0
    osv-scalibr version: 0.5.2
    commit: e840a6e8adb14b7777c78e26cfbf6e2abc1d1fc6
    built at: 2026-09-14T01:44:58Z

It exits 0 without scanning, so the candidate is marked version-safe.

    osv-scanner scan source --format json --recursive <dir>

osv-scanner writes `results[].source.path` as an ABSOLUTE path whatever
scan root it is given, `.` included, so a run in CI names the runner's
checkout directory. The umbrella makes it repository-relative before it
reaches a report. For these captures `<dir>` was a symbolic link at
`/tmp/conductor-osv-fixture` (and `-clean`, `-empty`) pointing at the
scratch directory, because osv-scanner keeps the path it was given rather
than resolving the link, and a scratch directory's own path is a
machine-specific one this repository's lint refuses.

`osv-scanner-2.6.0-blocking.json` is a `package-lock.json` resolving
`lodash@4.17.20` (exit 1): five advisories in three `groups[]` entries,
each group carrying `max_severity` as a CVSS base score string (`5.3`,
`8.1`, `6.9`) and listing every advisory id it merges, and every advisory
naming a `fixed` event (`4.17.21`, `4.17.23` or `4.18.0`).

The first blocking capture was `nanoid@5.0.9`, the package the proof
repository hit. It is not committed: one of its advisories carries an em
dash in its upstream `details` text, which this repository's lint refuses
in a tracked file, and a fixture is never edited by hand. That capture did
show one shape the lodash one does not, and the normalizer handles it: an
advisory with several `affected[]` ranges for the same package (nanoid's
GHSA-28wg-ghj8-5hjv fixes at `3.3.16` for the `0` range and at `5.1.16`
for the `4.0.0` range), so the fixed version has to come from the range the
installed version falls in rather than from the first `fixed` event.

`osv-scanner-2.6.0-clean.json` is a lockfile resolving only
`is-number@7.0.0` (exit 0, `results: []`).

Two exit observations the runner depends on:

- An empty directory prints nothing on stdout, `No package sources found,
  --help for usage information.` on stderr, and exits **128**.
- A `--config` path that does not exist prints `Failed to read config
  file` on stderr and exits **127**.
