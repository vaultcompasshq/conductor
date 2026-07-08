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
- [ ] **`latest` on npm points to newest beta** — run once if needed:
  ```bash
  for pkg in conductor-schema conductor-core conductor-skill conductor-cli; do
    npm dist-tag add "@vaultcompass/$pkg@0.3.0-beta.2" latest
  done
  ```

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

- [ ] Init creates `.conductor/config.yaml` and skeleton
- [ ] Extract → freeze → check passes on aligned work
- [ ] Check blocks or warns on an intentional out-of-scope change
- [ ] `conductor report` useful in a PR or handoff
- [ ] Optional: paired vault-guard pre-commit from `integrations/git-hooks/`

Record results in your local notes (do not commit app-repo contracts to this public repo).

## Runtime verification (minimum one path)

- [ ] Git pre-commit hook OR GitHub Actions `conductor drift --ci` on a real repo PR
- [ ] Cursor rule or Claude/Codex hook sample validated in one real session (optional but recommended)

## Stability declaration

- [x] [stability-policy.md](./stability-policy.md) documents semver for packages and schema
- [ ] README status line updated to **v1.0.0** on launch day
- [ ] CHANGELOG `## [1.0.0]` section with launch summary

## Release `v1.0.0`

1. Bump all four package versions to `1.0.0` (root `package.json` too).
2. Update `scripts/release-smoke.mjs` expected version and CLI version test.
3. Verify locally:

   ```bash
   pnpm install && pnpm test && pnpm release:smoke
   ```

4. Merge PR to `main`, then:

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

5. Confirm [Release workflow](https://github.com/vaultcompasshq/conductor/actions/workflows/release.yml) publishes all four packages and post-publish smoke passes.
6. Smoke from a clean directory:

   ```bash
   npx @vaultcompass/conductor-cli@latest init --project .
   ```

## Post-v1 (not blockers)

- Phase 3b: correction decay/dedup, LLM rule normalization
- Cursor extension / MCP status panel
- Superpowers upstream PR
