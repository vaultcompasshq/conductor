# v1.0.0 Launch Checklist

Use this after `v0.3.0-beta` is published and trusted-publisher OIDC is verified.
Package semver **`1.0.0`** means stable CLI/API; the Intent Contract document
version is already **`1.0.0`** in schema.

## Beta exit (before tagging `v1.0.0`)

- [x] Four packages on npm under `@vaultcompass/conductor-*`
- [x] GitHub Actions trusted publisher on `release.yml`
- [x] `conductor init` works from npm install (embedded default config)
- [x] Release workflow: build → test → smoke → publish → post-publish init smoke
- [x] Publish uses `latest` dist-tag (npm page shows current version)
- [x] Package READMEs on npm (cli, schema, core, skill)
- [x] **`latest` on npm points to `1.0.0`** — shipped 2026-07-08 (was `0.3.0-beta.3`).

## Dogfood gate (required for v1)

Run on one Vault & Compass Tier 0 app repo (not this OSS repo):

```bash
# From conductor repo:
./scripts/dogfood-tier0.sh /path/to/your-app-repo
```

Or manually:

```bash
cd /path/to/your-app-repo
npx @vaultcompass/conductor-cli@latest init --project .
npx @vaultcompass/conductor-cli@latest extract --project . --text "<real task>"
npx @vaultcompass/conductor-cli@latest freeze --project . --approved-by "<you>"
npx @vaultcompass/conductor-cli@latest check --project . --staged
```

Checklist for the dogfood run:

- [x] Init creates `.conductor/config.yaml` and skeleton (CapitalCanvas Tier 0, `0.3.0-beta.3`)
- [x] Extract → freeze → check passes on aligned work (CapitalCanvas `taxBuckets.test.ts`)
- [x] Check blocks on an intentional out-of-scope API/backend path change (CapitalCanvas)
- [x] `conductor report` useful in a PR or handoff (CapitalCanvas aligned run: status ok, drift 0)
- [x] Optional: paired secret scanning via `conductor hook install --with-vault-guard` (install refused foreign hook; CapitalCanvas already has security pre-commit)
- [x] Full run on one **Vault & Compass Tier 0** app repo — **CapitalCanvas** (2026-07-08)

Record results in your local notes (do not commit app-repo contracts to this public repo).

## Runtime verification (minimum one path)

- [x] Pre-commit hook installable from npm (`conductor hook install`) — no dependency
  on the Conductor source repo; verified by dogfood audit 2026-07-07.
- [x] Git pre-commit hook AND GitHub Actions drift gate exercised on a real repo PR
  - CapitalCanvas [PR #109](https://github.com/vaultcompasshq/CapitalCanvas/pull/109) (2026-07-08):
    repo-local `.githooks/pre-commit` pairs vault-guard + soft `conductor check --staged`;
    the hook ran on the merge commit (`✓ Conductor gate: ok`) and the `Conductor Drift`
    CI job (`intent-drift`) passed on the PR. Out-of-scope frontend edits reproduced a
    drift `soft_block` (71/100) locally.
- [x] Cursor rule validated via CapitalCanvas Tier 0 adoption — see
  [cursor-integration-2026-07-09.md](../validation/cursor-integration-2026-07-09.md)
  (mechanical enforcement via repo-local `.githooks`; rule is advisory)

## Stability declaration

- [x] [stability-policy.md](./stability-policy.md) documents semver for packages and schema
- [x] README status line updated to **v1.0.0**
- [x] CHANGELOG `## [1.0.0]` section with launch summary

## Release `v1.0.0` — shipped 2026-07-08

- [x] Bump all four package versions to `1.0.0` (root `package.json` too) — [PR #25](https://github.com/vaultcompasshq/conductor/pull/25)
- [x] Update `scripts/release-smoke.mjs` expected version and CLI version test
- [x] Verify locally: `pnpm install && pnpm test && pnpm release:smoke` (128 tests)
- [x] Merge PR to `main`, tag `v1.0.0`, push tag
- [x] [Release workflow](https://github.com/vaultcompasshq/conductor/actions/workflows/release.yml) published all four packages; post-publish smoke passed
- [x] `npx @vaultcompass/conductor-cli@latest init --project .` from clean install (post-publish smoke)

## Post-v1 (not blockers)

- Phase 3b: correction decay/dedup, LLM rule normalization
- Cursor extension / MCP status panel
- Superpowers upstream PR
