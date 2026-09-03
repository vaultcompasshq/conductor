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
same command in a project with no `.conductor` directory at all.

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
