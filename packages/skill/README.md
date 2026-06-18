# Conductor skills

Superpowers-compatible skills for Intent Contract, prompt coaching, and drift detection.

## Skills

| Skill | Path | Gate |
|-------|------|------|
| `intent-contract` | `intent-contract/SKILL.md` | Hard — blocks implementation until frozen |
| `prompt-coach` | `prompt-coach/SKILL.md` | Soft — suggests rewrites |
| `drift-guard` | `drift-guard/SKILL.md` | Warn / soft-block by score |

## Build CLIs

```bash
pnpm --filter @vaultcompasshq/conductor-skill build
```

## CLI helpers

| Command | Purpose |
|---------|---------|
| `conductor-coach "<text>"` | Prompt quality score + coaching |
| `conductor-extract --text "..." --project <root>` | Draft/write intent contract |
| `conductor-drift --contract <path> --paths a,b` | Drift score + optional log |

Run via pnpm from repo root:

```bash
pnpm --filter @vaultcompasshq/conductor-skill exec conductor-coach "Add export like Notion"
```

## Install into Cursor

```bash
cp -r packages/skill/intent-contract ~/.cursor/skills/intent-contract
cp -r packages/skill/prompt-coach ~/.cursor/skills/prompt-coach
cp -r packages/skill/drift-guard ~/.cursor/skills/drift-guard
```

See [integrations/superpowers/README.md](../../integrations/superpowers/README.md) for hook order and upstream contribution plan.
