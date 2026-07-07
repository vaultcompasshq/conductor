# Conductor

**Intent fidelity for AI-assisted development.**

Conductor sits *above* foundation models and *below* your product code. It turns an unstructured request into an approved **Intent Contract**, coaches users when prompts cause scope expansion, and blocks intent drift before misaligned changes reach review.

The Intent Contract is a plain YAML file, so any model or coding assistant that can read a file can consume it. Conductor does not replace spec tools, coding agents, or PR review. It gives those tools a shared source of truth for what the human approved, what is out of scope, and whether the current diff has drifted.

Today the shipped surfaces are the unified `conductor` CLI, the legacy `conductor-check` gate for pre-commit and CI, Cursor/Claude skills, hook samples, handoff reports, rules audit, and spec import. Optional vault-guard pairing samples are available for teams that want intent drift and secret scanning as separate gates. See [integrations/](./integrations) for host-specific examples.

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

**Phase:** v0.3.0-beta ready to publish; unified CLI, gate, report, rules audit, spec import, and validation harness shipped — July 2026
**Repository:** https://github.com/vaultcompasshq/conductor (public, MIT)  

**Packages:** `packages/schema` · `packages/core` · `packages/skill` · `packages/cli` · **117 tests passing**

**Maintainers:** See [docs/NEXT.md](./docs/NEXT.md) (current status), [docs/TODO.md](./docs/TODO.md) (backlog), and [docs/cli-reference.md](./docs/cli-reference.md) (commands).

## Start here

| Doc | Purpose |
|-----|---------|
| [AGENTS.md](./AGENTS.md) | Agent rules, phase status, verification |
| [docs/NEXT.md](./docs/NEXT.md) | Maintainer status and next work |
| [docs/product-positioning.md](./docs/product-positioning.md) | Competitive positioning and next product bets |
| [BRAINSTORMING.md](./BRAINSTORMING.md) | Design-session index |
| [docs/repo-strategy.md](./docs/repo-strategy.md) | Public scope, licensing, org placement |
| [docs/superpowers/specs/2026-06-17-conductor-design.md](./docs/superpowers/specs/2026-06-17-conductor-design.md) | Approved design spec (review gate) |
| [docs/phases/implementation-roadmap.md](./docs/phases/implementation-roadmap.md) | 14-week build plan |
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
one place Conductor *enforces* rather than *suggests*. Wire it via
[integrations/git-hooks/pre-commit.sample](./integrations/git-hooks/pre-commit.sample),
the optional paired
[vault-guard hook](./integrations/git-hooks/pre-commit-with-vault-guard.sample),
or a CI step.

## Quickstart

### Install (npm)

```bash
npx @vaultcompass/conductor-cli@0.3.0-beta init --project .
npx @vaultcompass/conductor-cli@0.3.0-beta extract --project . --text "Add CSV export. Do not add new API endpoints."
npx @vaultcompass/conductor-cli@0.3.0-beta freeze --project . --approved-by "<you>"
npx @vaultcompass/conductor-cli@0.3.0-beta check --project . --staged
```

Pair with [vault-guard](https://www.npmjs.com/package/@vaultcompass/vault-guard) for secret scanning:

```bash
cp integrations/git-hooks/pre-commit-with-vault-guard.sample .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

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
pnpm test      # 117 tests (builds first, then schema + core + skill + cli + examples/integrations)
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
