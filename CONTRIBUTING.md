# Contributing to Conductor

**Status:** Design phase — implementation contributions open after spec approval.

---

## Current phase

We are in **brainstorming / design review**. Please read:

1. [BRAINSTORMING.md](./BRAINSTORMING.md)
2. [Design spec](./docs/superpowers/specs/2026-06-17-conductor-design.md)
3. [Open questions](./docs/brainstorming/04-open-questions.md)

Do not open PRs for implementation until the design spec is approved.

---

## Design feedback

Open a GitHub issue (once remote exists) or comment on the spec with:

- `approve` / `changes: ...`
- Answers to open questions in `04-open-questions.md`

---

## Code standards (when implementation starts)

- TypeScript for `packages/*`
- JSON Schema is source of truth for Intent Contract
- Tests required for schema validation and drift rubric
- No secrets in repo
- Synthetic examples only in `examples/`

---

## Public repo hygiene (portfolio names)

Conductor is **public OSS**. Do **not** commit Vault & Compass portfolio product names,
private app-repo links, or dogfood notes that identify downstream products.

| OK in this repo | Keep out of git (use `.local/` or `TODO.local.md`) |
|-----------------|-----------------------------------------------------|
| Generic "Tier 0 app repo", "downstream integration" | Private app codenames or PR links |
| Synthetic paths in tests (`optionFilter.ts`) | Links to `vaultcompasshq/<private-app>` PRs |
| `@vaultcompass/conductor-*` (this product) | Cross-repo audit handoffs with app names |

CI runs `pnpm validate:portfolio-names` on every PR.

**Git history:** Older commits may still mention product names. Cleaning **current**
files is required; rewriting **history** needs `git filter-repo` and a force-pushed
`main` (coordinate with maintainers — breaks clone SHAs and is usually not worth it
once HEAD is clean).

---

## Superpowers upstream

Skills may be contributed to [obra/superpowers](https://github.com/obra/superpowers) after v0.3 beta. Coordinate via issue before duplicating skill names.

---

## License

By contributing, you agree your contributions are licensed under MIT.
