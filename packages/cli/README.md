# @vaultcompass/conductor-cli

Unified CLI for [Conductor](https://github.com/vaultcompasshq/conductor) — intent contracts, drift checks, session continuity, and setup diagnostics.

## Install

```bash
npm install -D @vaultcompass/conductor-cli
# or one-off:
npx @vaultcompass/conductor-cli@latest init --project .
```

## Quickstart

```bash
conductor init --project .
conductor extract --project . --text "Add CSV export. Do not add new API endpoints."
conductor freeze --project . --approved-by "<you>"
conductor check --project . --staged
conductor doctor --project .
conductor report --project . --staged
```

Pair with [@vaultcompass/vault-guard](https://www.npmjs.com/package/@vaultcompass/vault-guard) for secret scanning in pre-commit or CI.

## Docs

- [CLI reference](https://github.com/vaultcompasshq/conductor/blob/main/docs/cli-reference.md)
- [Integrations](https://github.com/vaultcompasshq/conductor/tree/main/integrations)
- [v1 launch checklist](https://github.com/vaultcompasshq/conductor/blob/main/docs/release/v1-launch-checklist.md)

## License

MIT
