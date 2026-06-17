# Cursor Integration

**Status:** Design — manual setup v1, hooks v2

---

## v1: Manual setup (no extension)

### 1. Install Conductor skills

Copy from `packages/skill/` to `~/.cursor/skills-cursor/` when available.

### 2. User rule (recommended)

Add to Cursor user rules or project `.cursor/rules/conductor.mdc`:

```markdown
Before any implementation work:
1. Invoke intent-contract skill
2. Ensure .conductor/intent-contract.yaml is frozen
3. Run drift-guard at handoff boundaries

Constraint files to respect (priority order):
- AGENTS.md
- CLAUDE.md
- GEMINI.md
- .cursor/rules/*
```

### 3. Project skeleton

```bash
conductor init   # when CLI available
# creates .conductor/config.yaml, index.md
```

Add to `.gitignore` (optional):

```
.conductor/drift-log.jsonl
```

Commit `intent-contract.yaml` for team visibility (recommended).

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
| Venture Studio pollers | Node imports `@vaultcompasshq/conductor-core` |

Same `intent-contract.yaml` — any model reads it.

---

## v2 (out of scope v1)

- Cursor hook on save → `conductor drift`
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
