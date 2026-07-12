# Conductor Agent Playbook

**Repo:** `github.com/vaultcompasshq/conductor` (public OSS, MIT)

Conductor is the intent-fidelity layer for AI-assisted development: Intent Contract schema, prompt coaching, drift scoring, correction capture, and session resume. It is a governance layer for coding assistants, not a replacement for planning, review, or CI.

---

## Read Order

| # | File | Purpose |
|---|------|---------|
| 1 | [docs/NEXT.md](./docs/NEXT.md) | Maintainer status and next work |
| 2 | [docs/TODO.md](./docs/TODO.md) | File-level task backlog |
| 3 | [docs/cli-reference.md](./docs/cli-reference.md) | Every CLI command and flag |
| 4 | [README.md](./README.md) | Product overview, package layout, dev commands |
| 5 | [docs/superpowers/specs/2026-06-17-conductor-design.md](./docs/superpowers/specs/2026-06-17-conductor-design.md) | Approved product spec |
| 6 | [docs/phases/implementation-roadmap.md](./docs/phases/implementation-roadmap.md) | 14-week implementation plan |

Phase 1 reference: [docs/superpowers/plans/2026-06-17-conductor-phase1.md](./docs/superpowers/plans/2026-06-17-conductor-phase1.md)

---

## Phase Status

| Phase | Weeks | Status |
|-------|-------|--------|
| 1 - Schema + core | 1-2 | Complete |
| 2 - Runtime + skills | 3-6 | Complete (`packages/skill`, CLIs, config, init) |
| 3a - Correction log + brief | - | Complete (PR #4) |
| Hardening - generic scorer, gate, approval | - | Complete (PRs #1, #3, #5) |
| 3 - Memory-index persistence | 7-10 | Core complete (`history`, generated index, resume, pivot, cross-session drift) |
| 3b - decay/dedup, LLM normalization | - | Deferred |
| 4 - Unified CLI + public release | 11-14 | **Complete** — `1.0.0` on npm ([release](https://github.com/vaultcompasshq/conductor/releases/tag/v1.0.0)) |

---

## Packages

```
packages/
├── schema/     # @vaultcompass/conductor-schema - AJV validator + types
├── core/       # @vaultcompass/conductor-core - coach, drift, gate, correction, brief, history
├── skill/      # @vaultcompass/conductor-skill - skills + legacy CLIs
├── cli/        # @vaultcompass/conductor-cli - unified conductor binary
└── memory/     # deferred; file-backed memory currently lives in core
```

CLIs are documented in [docs/cli-reference.md](./docs/cli-reference.md).
Lifecycle: coach -> extract (draft) -> freeze (approve) -> check (gate) -> pivot/correct -> brief/resume.

---

## Current Work

The Phase 3 core build is complete: frozen contracts archive to `.conductor/contracts/`, `index.md` is generated from real data, resume emits a Session Brief, pivots are logged, and `conductor-check` can surface prior-contract drift.

The unified `conductor` CLI is published to npm at **`1.0.2`** (`@vaultcompass/conductor-*`, trusted-publisher OIDC). Tier 0 dogfood + PR drift gate complete ([CapitalCanvas PR #109](https://github.com/vaultcompasshq/CapitalCanvas/pull/109)); latest patch addresses CapitalCanvas extraction dogfood ([PR #29](https://github.com/vaultcompasshq/conductor/pull/29)). Stability policy: [docs/release/stability-policy.md](./docs/release/stability-policy.md).

**Skills shipped:** `intent-contract`, `prompt-coach`, `drift-guard`, `capture-correction` (`packages/skill/*/SKILL.md`).

**Process:** Use a written plan before implementing multi-step work. All work lands on `main` via PR; never push directly to `main`. CI must be green before merge.

---

## Verification

```bash
pnpm install
pnpm test      # 133 tests: schema (7), core (74), skill (30), cli (11), examples/integrations (11)
pnpm build
pnpm typecheck
pnpm release:smoke
pnpm validate:public-repos   # manual; clones public GitHub repos
```

`pnpm test` builds first because the skill CLI tests spawn compiled `dist/` files.

Paste actual test output before claiming tests pass.

---

## Boundaries

- Keep this repo focused on Conductor packages, docs, examples, and integration samples.
- Do not commit local per-project `.conductor/intent-contract.yaml` files here; consuming application repos own their active contracts.
- Keep examples synthetic. Do not commit customer data, private project specs, API keys, or internal portfolio data.
- Runtime wiring for downstream products belongs in those downstream repos. This repo should expose packages and documented integration surfaces.

---

## License

MIT - see [LICENSE](./LICENSE)
