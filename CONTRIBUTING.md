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

## Superpowers upstream

Skills may be contributed to [obra/superpowers](https://github.com/obra/superpowers) after v0.3 beta. Coordinate via issue before duplicating skill names.

---

## License

By contributing, you agree your contributions are licensed under MIT.
