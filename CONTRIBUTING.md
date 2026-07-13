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

Conductor is **public OSS**. Never commit names, paths, or context from other Vault &
Compass products, private monorepos, or internal portfolio work.

**Do not put in committed files** (including tests, fixtures, changelogs, comments):

- Other product or venture codenames (internal app/repo names)
- Paths like `/Users/.../Projects/<private-app>/` or workspace scan notes
- Dogfood validation tied to a specific private repo
- Session handoffs or maintainer audits

**Use instead:** generic placeholders (`example-app/`, `private downstream app repo`)
and describe the *pattern*, not the source repo.

Local-only notes: `TODO.local.md`, `.local/`.

Before opening a PR, search the diff for private product names and internal paths.
CI runs `pnpm validate:portfolio-names` (hash blocklist — no plaintext codenames in
the repo). To add a hash, see the comment at the top of
`scripts/validate-no-portfolio-names.mjs`.

**Git history:** Older commits may still mention product names. Cleaning **current**
files is required; rewriting **history** needs `git filter-repo` and a force-pushed
`main` (coordinate with maintainers — usually not worth it once HEAD is clean).

---

## Superpowers upstream

Skills may be contributed to [obra/superpowers](https://github.com/obra/superpowers) after v0.3 beta. Coordinate via issue before duplicating skill names.

---

## License

By contributing, you agree your contributions are licensed under MIT.
