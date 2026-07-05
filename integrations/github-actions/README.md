# GitHub Actions Integration

Use this sample when a repository already has a frozen
`.conductor/intent-contract.yaml` and wants CI to fail on blocking drift.

Copy [conductor-drift-ci.yml.sample](./conductor-drift-ci.yml.sample) to:

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
