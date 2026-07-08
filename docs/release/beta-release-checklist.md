# Beta Release Checklist

Use this checklist before tagging or publishing `v0.3.0-beta`.

See [v1-launch-checklist.md](./v1-launch-checklist.md) for the path from beta to **`1.0.0`**.

## Required Verification

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm release:smoke
pnpm audit --audit-level low
```

Expected baseline: 128 tests passing.

## Package Smoke

`pnpm release:smoke` builds the workspace and locally packs:

- `@vaultcompass/conductor-schema`
- `@vaultcompass/conductor-core`
- `@vaultcompass/conductor-skill`
- `@vaultcompass/conductor-cli`

It verifies required package files and ensures packed manifests do not contain
`workspace:*` dependency ranges.

## Publish Order

Publish dependencies before dependents:

1. `@vaultcompass/conductor-schema`
2. `@vaultcompass/conductor-core`
3. `@vaultcompass/conductor-skill`
4. `@vaultcompass/conductor-cli`

Use `--access public` for scoped packages.

## Tag

After CI is green on `main` and packages are publish-ready:

```bash
git tag v0.3.0-beta
git push origin v0.3.0-beta
```

Do not tag before the release commit has landed on `main`.

## Publish

After verification:

```bash
pnpm publish:beta:dry-run
pnpm publish:beta
git tag v0.3.0-beta
git push origin v0.3.0-beta
```

`scripts/publish-beta.mjs` builds, runs release smoke, then publishes schema →
core → skill → cli with `--access public`. Requires `npm login` with publish
access to `@vaultcompass`, or use the GitHub Actions release workflow on tag push.

### Trusted publishing (recommended)

Configure npm [trusted publishers](https://docs.npmjs.com/trusted-publishers)
for each `@vaultcompass/conductor-*` package (workflow: `release.yml`, repo:
`vaultcompasshq/conductor`). Then:

```bash
git tag v0.3.0-beta
git push origin v0.3.0-beta
```
