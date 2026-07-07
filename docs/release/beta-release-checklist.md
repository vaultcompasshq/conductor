# Beta Release Checklist

Use this checklist before tagging or publishing `v0.3.0-beta`.

## Required Verification

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm release:smoke
pnpm audit --audit-level low
```

Expected baseline: 110 tests passing.

## Package Smoke

`pnpm release:smoke` builds the workspace and locally packs:

- `@vaultcompasshq/conductor-schema`
- `@vaultcompasshq/conductor-core`
- `@vaultcompasshq/conductor-skill`
- `@vaultcompasshq/conductor-cli`

It verifies required package files and ensures packed manifests do not contain
`workspace:*` dependency ranges.

## Publish Order

Publish dependencies before dependents:

1. `@vaultcompasshq/conductor-schema`
2. `@vaultcompasshq/conductor-core`
3. `@vaultcompasshq/conductor-skill`
4. `@vaultcompasshq/conductor-cli`

Use `--access public` for scoped packages.

## Tag

After CI is green on `main` and packages are publish-ready:

```bash
git tag v0.3.0-beta
git push origin v0.3.0-beta
```

Do not tag before the release commit has landed on `main`.
