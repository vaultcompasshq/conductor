# Agent notes

`@vaultcompass/conductor` is the umbrella over three independently
installable guardrail gates (dep-guard, vault-guard, intent-guard): one
policy file, one init, one hook, and one report across all three. See
README.md for the full shape of the policy file, the hook, and the Action.

## The one rule that matters here

This repository is a convenience layer, not a fourth gate. It finds no
findings of its own beyond `conductor/gate-missing`, and it never writes
into a gate's own config. If this repository disappeared, all three gates
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
