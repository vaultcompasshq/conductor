# Git Hook Integration

Use these samples when a repository wants a local pre-commit gate.

## Conductor Only

```bash
cp integrations/git-hooks/pre-commit.sample .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

The hook runs:

```bash
conductor-check --project . --staged
```

It exits non-zero when no frozen Intent Contract exists or staged changes drift
past a blocking threshold.

## Conductor Plus vault-guard

```bash
cp integrations/git-hooks/pre-commit-with-vault-guard.sample .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

The paired hook runs:

```bash
conductor-check --project . --staged
vault-guard scan --staged
```

The checks are independent. Conductor blocks intent drift; vault-guard blocks
staged secrets. Set `CONDUCTOR_CHECK` or `VAULT_GUARD` if either binary is not
on `PATH`.
