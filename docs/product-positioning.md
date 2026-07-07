# Product Positioning

**Updated:** 2026-07-07

Conductor should position itself as the portable intent-control layer for AI-assisted development. It should not compete with full spec-driven development systems, coding agents, or PR review tools. Those products help create plans, run agents, or review code. Conductor's job is to preserve and enforce what the human approved.

## Strongest Value Prop

AI coding tools now have planning, rules, hooks, memory, and PR review. The missing piece is a small, portable contract that answers:

- What did the user actually approve?
- What is explicitly out of scope?
- Has the current diff drifted from that contract?
- Was a pivot acknowledged, or did the session silently change direction?

Conductor makes those answers durable through an Intent Contract, then checks work against it in local CLI, hooks, and CI.

Recommended public one-liner:

> Conductor turns an AI coding request into an approved Intent Contract, then blocks scope drift before it reaches review.

## Competitive Map

| Category | Examples | What they do well | Gap Conductor should own |
|---|---|---|---|
| Spec-driven development | GitHub Spec Kit, Kiro Specs | Turn ideas into requirements, designs, tasks, and implementation workflows. | Ongoing enforcement against the approved task once coding starts, especially across multiple hosts. |
| Host rules and memory | Claude Code, Kiro Steering, Continue rules, Amp AGENTS.md | Give agents persistent project guidance and host-specific automation. | Rules are context, not a portable approved task contract with cross-host drift scoring. |
| Hooks and lifecycle automation | Claude Code hooks, Kiro hooks | Run shell commands or prompts at lifecycle events and can block specific events. | They are host-level execution points; Conductor can be the shared policy/check those hooks call. |
| Coding agents | Aider, Amp, Claude Code, Cursor, Codex | Execute changes quickly with repository context. | They optimize implementation, not durable intent approval and pivot history. |
| Review and planning platforms | CodeRabbit | Review PRs, create coding plans, integrate with issue trackers and Slack. | Review is often late. Conductor catches "not what was asked" before commit or CI. |
| Development methodologies | Superpowers | Adds disciplined planning, TDD, review, and agent workflows. | Conductor can supply the frozen intent artifact and drift gate those workflows consume. |

## Strategic Positioning

Do not lead with "we generate specs." That market is already crowded and better-funded.

Lead with:

- **Approved intent:** the contract is frozen only after explicit approval.
- **Scope boundaries:** `out_of_scope` is first-class, not an afterthought.
- **Drift enforcement:** CLI, pre-commit, and CI can block misaligned changes.
- **Pivot hygiene:** accepted changes are logged instead of silently replacing the original ask.
- **Host neutrality:** one contract can be read by Claude, Codex, Cursor, Gemini, hooks, or CI.
- **Local-first:** no hosted dependency is required.

## Recently Added

### `conductor doctor`

`conductor doctor` now gives users one command to diagnose local setup before a gate fails. It checks config, active contract state, approval/freeze status, archived contracts, index freshness, package version, and visible hook/workflow files, with readable output by default and JSON for CI/editor integrations.

### `conductor report`

`conductor report --staged` turns the gate result into a PR/CI handoff: active contract summary, score, blocking reasons, acceptance criteria coverage inferred from paths/signals, pivot/correction history, changed paths, and a recommended next action. It exits with the same status as `conductor check`.

### `conductor rules audit`

`conductor rules audit` inspects `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`, `.continue/rules`, and `.kiro/steering`; reports what is loaded; and flags duplicates, stale or overbroad rules, potential conflicts, and rules that may deserve critical priority.

### Expanded public validation

`scripts/validate-public-repos.mjs` now defaults to 8 public repositories and includes README positive controls, explicit-signal source/package drift controls, path-only source/package drift controls, and doctor diagnostics.

## What Is Missing Next

### 1. Spec Bridge

Spec Kit and Kiro are not enemies. They are good upstream sources for Conductor.

Conductor should import requirements/tasks from popular spec systems into an Intent Contract, then enforce the approved scope during implementation.

Candidate commands:

- `conductor import-spec --from spec-kit`
- `conductor import-spec --from kiro`
- `conductor export --format markdown`

### 2. Optional Semantic Classifier

The offline rule-based scorer is a good default, but nuanced drift needs an optional semantic path. This should be opt-in and preserve local/offline behavior as the baseline.

Candidate option: `conductor drift --semantic`.

## Messaging Changes To Make

- Replace casual request wording with "unstructured request."
- Replace broad quality claims with "blocks intent drift."
- Say "complements Spec Kit, Kiro, Claude Code, Cursor, Codex, and CodeRabbit" instead of implying direct replacement.
- Lead with "approved contract + drift gate" before memory, skills, or integrations.
- Treat Superpowers as a workflow consumer, not the product category.

## Sources Reviewed

- GitHub Spec Kit: https://github.com/github/spec-kit
- Kiro Specs: https://kiro.dev/docs/specs/
- Kiro Steering: https://kiro.dev/docs/steering/
- Kiro Hooks: https://kiro.dev/docs/hooks/
- Claude Code memory: https://docs.anthropic.com/en/docs/claude-code/memory
- Claude Code hooks: https://docs.anthropic.com/en/docs/claude-code/hooks
- Continue rules: https://docs.continue.dev/customize/rules
- Aider usage: https://aider.chat/docs/usage.html
- CodeRabbit docs: https://docs.coderabbit.ai/
- Superpowers: https://github.com/obra/superpowers
