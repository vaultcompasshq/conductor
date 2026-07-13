# Public content policy (Conductor OSS)

Conductor is a **public** repository. It must not name Vault & Compass portfolio
products, private application repositories, or links to private downstream PRs.

## Never commit

- Product or venture codenames (internal app/repo names)
- Links to private `github.com/vaultcompasshq/<app-repo>` PRs or issues
- Dogfood validation notes that identify which private repo supplied a prompt
- Domain-specific test fixtures that fingerprint a private app
- Maintainer session handoffs, audits, or week-ahead plans (use gitignored
  `.local/` or `TODO.local.md` instead)
- Internal workspace paths (`/Users/.../Projects/...`)

## Use instead

Generic placeholders (`private downstream app repo`, synthetic paths). Describe the
**pattern** (e.g. drift replay, extraction edge case), not the source product.

## Synthetic examples OK

- Fictional paths in tests and docs
- The `vaultcompasshq/conductor` repo itself and `@vaultcompass/conductor-*` packages

## Enforcement

```bash
pnpm validate:portfolio-names
```

CI runs this on every PR (SHA-256 hash blocklist in `scripts/validate-no-portfolio-names.mjs` — no plaintext codenames in git). To add a blocked token, hash it and paste into `BANNED_HASHES`; see the script header comment.

Agents and maintainers: read [AGENTS.md](../../AGENTS.md) Boundaries.

## Git history

Commits before **1.0.6** may still name portfolio products. **HEAD must stay clean.**
Rewriting history (`git filter-repo` + force-push) is optional and disruptive; prefer
forward fixes unless the org explicitly requires history purge.
