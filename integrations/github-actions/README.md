# GitHub Actions Integration

Use these samples when a repository already has a frozen
`.conductor/intent-contract.yaml` and wants CI to fail on blocking drift.

The package-install samples assume `@vaultcompass/conductor-cli@0.3.0-beta.0`
has been published to npm. Until publish, run Conductor from a local checkout or
a release artifact in the consuming repository's workflow.

For Conductor only, copy
[conductor-drift-ci.yml.sample](./conductor-drift-ci.yml.sample) to:

```text
.github/workflows/conductor-drift.yml
```

Then adjust the `--paths` collection if your workflow needs a different diff
range. The sample uses changed files from the pull request base and passes them
to:

```bash
conductor drift --ci --contract .conductor/intent-contract.yaml --paths "$CHANGED_PATHS"
```

`--ci` preserves the normal JSON output and exits `1` when the drift scorer
returns `block: true`.

For Conductor plus vault-guard, copy
[conductor-vault-guard-ci.yml.sample](./conductor-vault-guard-ci.yml.sample) to:

```text
.github/workflows/conductor-vault-guard.yml
```

That workflow runs the same drift check, then runs:

```bash
npx --yes @vaultcompass/vault-guard@latest -- scan . --format text
```

The two checks are independent. Conductor blocks intent drift; vault-guard
blocks leaked secrets.
