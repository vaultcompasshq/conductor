# Public content policy (Conductor OSS)

Conductor is a **public** repository. It must not name Vault & Compass portfolio
products, private application repositories, or links to private downstream PRs.

## Never commit

- Product names (specific app codenames or customer-facing brands from the V&C portfolio)
- Links to private `github.com/vaultcompasshq/<app-repo>` PRs or issues
- Dogfood validation notes that identify which private repo supplied a prompt
- Maintainer session handoffs, audits, or week-ahead plans (use gitignored
  `.local/` or `TODO.local.md` instead)

## Use instead

| Instead of | Write |
|------------|--------|
| Named product + PR link | "private Tier 0 app repo", "downstream integration PR" |
| App-branded validation doc filenames | `tier0-extraction-….md`, `tier0-cursor-integration-….md` |
| Replay test titled with product + PR number | `onboarding replay: vendor-link path …` |
| Portfolio tree listing app repos by name | `conductor` (public) + "private product repos" |

## Synthetic examples OK

- Fictional paths (`frontend/src/features/.../strategyFilter.ts`)
- Third-party vendors in generic integration examples
- The `vaultcompasshq/conductor` repo itself and `@vaultcompass/conductor-*` packages

## Enforcement

```bash
pnpm validate:portfolio-names
```

CI runs this on every PR. Agents and maintainers: read [AGENTS.md](../../AGENTS.md) Boundaries.

## Git history

Commits before **1.0.6** may still name portfolio products. **HEAD must stay clean.**
Rewriting history (`git filter-repo` + force-push) is optional and disruptive; prefer
forward fixes unless the org explicitly requires history purge.
