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
