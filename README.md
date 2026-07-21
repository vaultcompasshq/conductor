# Conductor

**Approved Intent Contract + drift gate for AI-assisted development.**

Conductor turns an unstructured request into a frozen **Intent Contract**, then
blocks scope drift in pre-commit and CI before misaligned changes reach review.
It complements Spec Kit, Kiro, Cursor, Claude Code, Codex, and CodeRabbit — it
does not replace planning, coding agents, or PR review.

The contract is plain YAML any model can read. Pair with
[vault-guard](https://www.npmjs.com/package/@vaultcompass/vault-guard) when you
also want secret scanning as a separate gate. See [integrations/](./integrations).

```
User conversation
        |
   Conductor layer       intent contract, drift guard, prompt coach
        |
   Coding assistants     planning, TDD, build, review
        |
   Shipped product
```

## Status

**Version:** `1.0.10` — stable CLI/API on npm (`@vaultcompass/conductor-*`); see [docs/release/stability-policy.md](./docs/release/stability-policy.md) — July 2026  
**Repository:** https://github.com/vaultcompasshq/conductor (public, MIT)

**Packages:** `packages/schema` · `packages/core` · `packages/skill` · `packages/cli` · **152 tests** (see [docs/NEXT.md](./docs/NEXT.md))

**Maintainers:** [docs/NEXT.md](./docs/NEXT.md) · [docs/TODO.md](./docs/TODO.md) · [docs/cli-reference.md](./docs/cli-reference.md)

## Start here

| Doc | Purpose |
|-----|---------|
| [AGENTS.md](./AGENTS.md) | Agent rules, phase status, verification |
| [docs/NEXT.md](./docs/NEXT.md) | Maintainer status and next work |
| [docs/product-positioning.md](./docs/product-positioning.md) | Competitive positioning and next product bets |
| [BRAINSTORMING.md](./BRAINSTORMING.md) | Design-session index |
| [docs/repo-strategy.md](./docs/repo-strategy.md) | Public scope, licensing, org placement |
| [docs/superpowers/specs/2026-06-17-conductor-design.md](./docs/superpowers/specs/2026-06-17-conductor-design.md) | Approved design spec (review gate) |
| [docs/release/v1-launch-checklist.md](./docs/release/v1-launch-checklist.md) | Beta → v1.0.0 launch gate |
| [docs/release/stability-policy.md](./docs/release/stability-policy.md) | Schema and package semver policy |
| [docs/superpowers/plans/2026-06-17-conductor-phase1.md](./docs/superpowers/plans/2026-06-17-conductor-phase1.md) | Phase 1 plan (complete) |

## What Conductor is / isn't

| Is | Isn't |
|----|-------|
| Governance layer for AI coding sessions | A foundation model or fine-tune |
| Intent Contract + drift detection | A full autonomous coding agent |
| User prompt coaching | Replacement for planning, review, or CI |
| Multi-model (Claude, Codex, Gemini) | Cursor-only or single-vendor lock-in |

## Packages

```
conductor/
├── packages/
│   ├── schema/          # @vaultcompass/conductor-schema
│   ├── core/            # @vaultcompass/conductor-core incl. history/index
│   ├── skill/           # Superpowers skills + legacy CLIs
│   ├── cli/             # unified conductor binary
│   └── memory/          # separate package deferred; file memory lives in core
├── integrations/
│   ├── superpowers/     # skills + install script
│   ├── git-hooks/       # pre-commit gate samples
│   ├── hooks/           # shared lifecycle hook scripts
│   ├── codex/           # Codex hooks.json sample
│   ├── claude-code/     # Claude Code settings sample
│   ├── github-actions/  # drift CI and optional vault-guard workflow samples
│   ├── cursor/          # Cursor rule + git hook setup
│   └── downstream-pipeline/  # design notes
└── docs/
```

The enforcement gate (`conductor check`, legacy `conductor-check`) returns a non-zero exit code when no
frozen contract exists or staged changes drift past a blocking threshold — the
one place Conductor *enforces* rather than *suggests*. Install it with
`conductor hook install` (add `--with-vault-guard` to pair secret scanning), or
wire the sample hooks
([pre-commit.sample](./integrations/git-hooks/pre-commit.sample),
[vault-guard hook](./integrations/git-hooks/pre-commit-with-vault-guard.sample))
or a CI step from a source checkout.

## Quickstart

### Install (npm)

```bash
npx @vaultcompass/conductor-cli@latest init --project .
npx @vaultcompass/conductor-cli@latest extract --project . --text "Add CSV export. Do not add new API endpoints."
npx @vaultcompass/conductor-cli@latest freeze --project . --approved-by "<you>"
npx @vaultcompass/conductor-cli@latest check --project . --staged
```

Install the pre-commit gate (and optionally pair [vault-guard](https://www.npmjs.com/package/@vaultcompass/vault-guard) secret scanning):

```bash
npx @vaultcompass/conductor-cli@latest hook install --project . --with-vault-guard
```

This writes a self-contained `.git/hooks/pre-commit`; drop `--with-vault-guard` for intent-only enforcement.

### AI session guardrails

Conductor and vault-guard are independent gates for the same workflow:

| Gate | Tool | Blocks |
|------|------|--------|
| Intent drift | `conductor check --staged` | Work outside the approved contract |
| Secret leakage | `vault-guard scan --staged` | Credentials in staged files |

Use `conductor doctor` to verify setup, `conductor report --staged` for PR/agent handoffs, and `conductor report --staged --with-secrets` when vault-guard is installed.

### Develop from source

```bash
pnpm install
pnpm build
pnpm conductor -- init --project .
pnpm conductor -- doctor --project .
pnpm conductor -- extract --project . --text "Add CSV export. Do not add new API endpoints. Verify the file downloads."
pnpm conductor -- import-spec --project . --from kiro --spec-dir .kiro/specs/export
pnpm conductor -- freeze --project . --approved-by "<name>"
pnpm conductor -- check --project . --staged
pnpm conductor -- report --project . --staged
pnpm conductor -- rules audit --project .
```

## Development

```bash
pnpm install
pnpm test      # full suite (builds first; see docs/NEXT.md for current count)
pnpm dogfood:cursor-hooks   # Cursor rule + hook install pass/fail fixture
pnpm dogfood:claude-hooks   # Claude Code SessionStart/Stop lifecycle fixture
pnpm build
pnpm release:smoke
pnpm validate:public-repos
pnpm conductor:install-skills   # copy skills to ~/.cursor/skills
```

### Session lifecycle (CLIs)

```bash
pnpm conductor -- extract --project . --text "the ask"   # 1. draft (unfrozen)
pnpm conductor -- import-spec --project . --from auto     # optional spec import
pnpm conductor -- freeze  --project . --approved-by me    # 2. approve
pnpm conductor -- doctor  --project .                     # 3. diagnose setup
pnpm conductor -- check   --project . --staged            # 4. gate (exit 1 = blocked)
pnpm conductor -- report  --project . --staged            # PR/CI handoff
pnpm conductor -- rules   audit --project .               # project-rule hygiene
pnpm conductor -- pivot   --project . --change "..." --acknowledge
pnpm conductor -- correct --project . --wrong "..." --right "..." --rule "..." --acknowledge
pnpm conductor -- brief   --project .                     # clean re-injectable context
pnpm conductor -- resume  --project .                     # brief + recent history
```

Full flags: [docs/cli-reference.md](./docs/cli-reference.md). Release steps:
[docs/release/beta-release-checklist.md](./docs/release/beta-release-checklist.md).
The gate
(`conductor check`, legacy `conductor-check`) is the one place Conductor
*enforces* rather than *suggests* —
wire it via [integrations/git-hooks/pre-commit.sample](./integrations/git-hooks/pre-commit.sample)
or [integrations/github-actions/conductor-drift-ci.yml.sample](./integrations/github-actions/conductor-drift-ci.yml.sample).
Use [pre-commit-with-vault-guard.sample](./integrations/git-hooks/pre-commit-with-vault-guard.sample)
or [conductor-vault-guard-ci.yml.sample](./integrations/github-actions/conductor-vault-guard-ci.yml.sample)
when you want a separate secret-scanning gate beside Conductor.

## Origin

Conductor grew out of repeated intent-drift failures in AI-assisted development workflows: vague prompts expanded scope, long sessions lost the original request, and reviews caught implementation quality more reliably than direction. See [docs/brainstorming/01-context-and-problem.md](./docs/brainstorming/01-context-and-problem.md).

## License

MIT — see [LICENSE](./LICENSE)
