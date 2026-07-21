# Cursor Integration

**Status:** Project rule (advisory) + Git pre-commit enforcement  
**Validated:** [cursor-hook-dogfood-2026-07-21.md](../../docs/validation/cursor-hook-dogfood-2026-07-21.md)

---

## Recommended setup (npm)

```bash
npx @vaultcompass/conductor-cli@latest init --project .
mkdir -p .cursor/rules
# From a Conductor source checkout, or paste the rule from this folder:
cp /path/to/conductor/integrations/cursor/conductor.mdc .cursor/rules/conductor.mdc

npx @vaultcompass/conductor-cli@latest extract --project . --text "<approved task>"
npx @vaultcompass/conductor-cli@latest freeze --project . --approved-by "<you>"
npx @vaultcompass/conductor-cli@latest hook install --project .
```

Re-verify anytime:

```bash
npx @vaultcompass/conductor-cli@latest doctor --project .
npx @vaultcompass/conductor-cli@latest check --project . --staged
```

### Machine-wide `core.hooksPath`

If Git is configured with a global hooks directory (common with vault-guard),
`conductor hook install` sets **local** `core.hooksPath=.git/hooks` and installs
there so it does not overwrite the shared hooks dir. Repo-local paths such as
`.githooks` are left alone and receive the hook directly.

---

## From a Conductor source checkout

### 1. Skills

```bash
pnpm conductor:install-skills
```

### 2. Project rule

```bash
mkdir -p .cursor/rules
cp integrations/cursor/conductor.mdc .cursor/rules/conductor.mdc
```

**Conductor repo maintainers only** — also install the public-content guard:

```bash
cp integrations/cursor/no-portfolio-names.mdc .cursor/rules/no-portfolio-names.mdc
```

### 3. Mechanical gate

```bash
pnpm conductor -- hook install --project .
# or: pnpm dogfood:cursor-hooks   # full pass/fail fixture
```

Do **not** copy `integrations/git-hooks/*.sample` by hand for npm users — that
path is not in the published packages. Use `conductor hook install`.

### 4. Optional gitignore

```
.conductor/drift-log.jsonl
```

Commit `intent-contract.yaml` on feature branches when the team should see the
approved ask. The Conductor OSS repo itself does not keep a frozen root contract
on `main`.

---

## Constraint loading

| File | Loaded as |
|------|-----------|
| `AGENTS.md` | `source: AGENTS.md` |
| `CLAUDE.md` | `source: CLAUDE.md` |
| `GEMINI.md` | `source: GEMINI.md` |
| `.cursor/rules/*.mdc` | `source: cursor-rules` |

---

## Multi-model usage

| Environment | How Conductor runs |
|-------------|-------------------|
| Cursor | Project rule + skills; gate via `hook install` |
| Codex CLI | `integrations/codex` sample + same CLI gate |
| Claude Code | `integrations/claude-code` sample + same CLI gate |
| CI | `conductor drift --ci` / `conductor check` |

Same `intent-contract.yaml` — any model that can read a file can consume it.

---

## Future

- Native MCP server for contract status
- Status panel showing active contract + drift score

---

## Coexistence with Cursor Bugbot / review

| Tool | When |
|------|------|
| Conductor drift gate | During session / pre-commit |
| Bugbot | PR time |
| Conductor `drift --ci` | CI optional |

No conflict — different lifecycle stages.
