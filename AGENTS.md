# Agent notes

`@vaultcompass/conductor` is the umbrella over three independently
installable guardrail gates (dep-guard, vault-guard, intent-guard): one
policy file, one init, one hook, and one report across all three. See
README.md for the full shape of the policy file, the hook, and the Action.

## The one rule that matters here

This repository is a convenience layer, not a fourth gate. It scans nothing
and has no rules about anybody's code: the only findings it raises are about
the gates themselves, `conductor/gate-missing`,
`conductor/gate-output-unparseable` and `conductor/gate-failed`, plus the two
diagnostics it raises when it cannot reconcile a gate's own blocking count,
`conductor/blocking-count-mismatch` and
`conductor/blocking-threshold-unknown`. It never writes into a gate's own
config.

Pull-request mode does not change that. On a run with `--trust-base` the
umbrella reads its OWN policy file from the base ref and passes the same ref
down to each gate that understands the flag; what a gate then does with its
own control files is that gate's decision, and the umbrella only reports
what each one said was proposed. If this repository disappeared, all three gates
would still install, configure, and run exactly as they do today, each on
its own. Keep every change consistent with that: nothing here should make a
gate depend on the umbrella to function.

## Running the gates locally

    pnpm install
    pnpm build
    pnpm typecheck
    pnpm lint
    pnpm test

`pnpm lint` runs `scripts/check-public-hygiene.mjs`, the public-repository
hygiene guard (see below). `pnpm test` builds first, since some tests spawn
the compiled `dist/` output.

## Hygiene rules for tracked files

`pnpm lint` fails a tracked file that contains any of the following:

- an em dash or an en dash. Prose and commit messages here are plain ASCII.
- a machine-specific absolute path: a home directory (`/Users`, `/home`) or
  a temporary directory (`/var/folders`, `/private`) with two or more path
  segments under it.
- a token whose SHA-256 hash matches the blocklist in
  `scripts/check-public-hygiene.mjs`. The blocklist holds hashes only; the
  internal product names it stands for are never written down in this
  repository.

See CONTRIBUTING.md, public repository hygiene section, for the full detail
and for how to add a blocklist entry.

## Branch and pull request discipline

Never commit directly to `main`. Feature branches and pull requests only.
Never use `--no-verify`; a pre-commit hook failure is a finding, not an
obstacle.

## License

MIT, see [LICENSE](./LICENSE)
