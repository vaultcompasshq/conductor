# Cursor Integration

**Status:** Project rule + git hook enforcement

---

## Manual setup (no extension)

### 1. Install Conductor skills

Copy from `packages/skill/` to `~/.cursor/skills/`:

```bash
pnpm conductor:install-skills
```

Or from another project after cloning conductor:

```bash
bash /path/to/conductor/integrations/superpowers/install-skills.sh
```

### 2. User rule (recommended)

Add the committed sample rule to your project:

```bash
mkdir -p .cursor/rules
cp integrations/cursor/conductor.mdc .cursor/rules/conductor.mdc
```

Or paste this into Cursor user rules:

```markdown
Before any implementation work:
1. Ensure .conductor/intent-contract.yaml exists
2. Ensure it is frozen with conductor-freeze
3. Run conductor-resume at resumed session start
4. Run conductor-check before completion or commit

Constraint files to respect (priority order):
- AGENTS.md
- CLAUDE.md
- GEMINI.md
- .cursor/rules/*
```

### 3. Project skeleton

```bash
pnpm conductor:init
# creates .conductor/config.yaml, index.md, contracts/
```

Add to `.gitignore` (optional):

```
.conductor/drift-log.jsonl
```

Commit `intent-contract.yaml` for team visibility (recommended).

### 4. Mechanical gate

Cursor project rules are instructions, not lifecycle hooks. For enforcement,
install the Git pre-commit hook:

```bash
cp integrations/git-hooks/pre-commit.sample .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

---

## Constraint loading

| File | Loaded as |
|------|-----------|
| `AGENTS.md` | `source: AGENTS.md` |
| `CLAUDE.md` | `source: CLAUDE.md` |
| `GEMINI.md` | `source: GEMINI.md` |
| `.cursor/rules/*.mdc` | `source: cursor-rules` |

Conductor merges into `constraints[]` with priority from config (default: AGENTS > CLAUDE > cursor-rules).

---

## Multi-model usage

Conductor is model-agnostic:

| Environment | How Conductor runs |
|-------------|-------------------|
| Cursor (Claude) | Skills via skill tool |
| Codex CLI | Skill equivalent or CLI |
| Gemini CLI | `activate_skill` mapping per GEMINI.md |
| Downstream automation | Node imports `@vaultcompass/conductor-core` |

Same `intent-contract.yaml` — any model reads it.

---

## Future

- Native MCP server for contract status
- Glass panel showing active contract + drift score

---

## Coexistence with Cursor Bugbot / review

| Tool | When |
|------|------|
| Conductor drift-guard | During session |
| Bugbot | PR time |
| Conductor `drift --ci` | CI optional |

No conflict — different lifecycle stages.
