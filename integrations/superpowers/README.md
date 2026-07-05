# Superpowers Integration

**Status:** Phase 2 draft — skills + CLIs in `packages/skill/`

---

## Overview

Conductor extends Superpowers; it does not replace any existing skill.

**Install path (v0.2):**

```bash
# From conductor repo root
pnpm conductor:install-skills
# or:
bash integrations/superpowers/install-skills.sh ~/.cursor/skills
```

**Option B:** Superpowers plugin declares conductor as dependency (future)

---

## Quickstart: the enforcement gate

SKILL.md files are advisory — an agent can ignore them. `conductor-check` is the
gate that can't be ignored: it returns a non-zero exit code when no frozen
contract exists or staged changes drift past a blocking threshold.

```bash
# 1. Draft intent for the task (writes an UNFROZEN draft)
conductor-extract --project . --text "…the ask…"

# 2. Approve it — a deliberate step; an agent must not self-approve
conductor-freeze --project .                  # interactive confirm, or:
conductor-freeze --project . --approved-by "alice"

# 3. Check staged work before committing (used by the pre-commit hook)
conductor-check --project . --staged
#   exit 0 → ok    exit 1 → blocked (missing/unapproved contract or drift)
```

Wire it as a pre-commit hook via
[`integrations/git-hooks/pre-commit.sample`](../git-hooks/pre-commit.sample) or a
CI step so the gate runs outside the agent's control.

---

## Skill: `intent-contract`

**Runs:** Before `brainstorming` (creative work) or `writing-plans` (if no brainstorm)

**Hard gate:** Agent must not invoke implementation skills until contract is `frozen`.

### Workflow

1. Load constraint files from project root
2. Extract `original_ask`, `in_scope`, `out_of_scope`, `constraints`, `acceptance_criteria`
3. Run `prompt-coach` if quality score < 60
4. Present draft to user — one question at a time if gaps
5. Write `.conductor/intent-contract.yaml`
6. Wait for explicit user approval → set `frozen_by: user`

### Output

```yaml
# .conductor/intent-contract.yaml
metadata:
  superpowers_spec_path: docs/superpowers/specs/YYYY-MM-DD-topic-design.md
```

---

## Skill: `prompt-coach`

**Runs:** Inside `intent-contract` or standalone when user message is vague

**Never blocks** — only suggests rewrites.

---

## Skill: `drift-guard`

**Runs:**

- After `brainstorming` → before `writing-plans`
- After `writing-plans` → before `test-driven-development`
- Before `verification-before-completion`
- Configurable: on file save (opt-in)

**Actions by score:** See design spec §5.1

---

## Skill priority order

Per Superpowers `using-superpowers` skill:

1. User instructions (AGENTS.md, CLAUDE.md) — highest
2. **Conductor skills** (intent-contract, drift-guard)
3. Superpowers process skills (brainstorming, TDD, etc.)
4. Default system prompt

Document this in skill frontmatter so users know Conductor overrides casual implementation.

---

## Upstream contribution (Phase 4+)

**Target repo:** [obra/superpowers](https://github.com/obra/superpowers)

**Proposed PR:** Add optional `intent-contract` and `drift-guard` skills with link to vaultcompasshq/conductor schema.

**Prerequisite:** v0.3 beta stable, with at least two weeks of validation.

---

## Testing integration

```markdown
1. Start session on repo with AGENTS.md
2. Ask vague feature request
3. Verify intent-contract skill activates
4. Verify coaching message appears
5. Approve contract
6. Run brainstorming — spec links contract_id
7. Attempt out-of-scope file change
8. Verify drift-guard warns
```
