# Repository Strategy — vaultcompasshq/conductor

**Date:** 2026-06-17  
**Decision:** Public open-source repository under the VaultCompass GitHub org

---

## Should this be public?

**Yes.** Conductor is infrastructure other developers can adopt without exposing Vault & Compass venture IP.

| Public (this repo) | Private (Venture Studio / internal) |
|--------------------|-------------------------------------|
| Intent Contract schema | Venture-specific gold-standard tests |
| Superpowers skills | Linear API keys, portfolio data |
| CLI (`conductor contract`, `drift`, `coach`) | Proprietary scoring rubrics for ideation |
| Drift detection algorithms | Customer-specific audit thresholds |
| Integration guides | Internal agent prompt versions |
| Example contracts (synthetic) | Real project specs with business data |

**Analogy:** Like ESLint (public rules engine) vs your company's internal eslint config (private).

---

## GitHub organization placement

```
github.com/vaultcompasshq/
├── sheetful              (product)
├── prismfolio            (product)
├── capitalcanvas         (product)
├── conductor             (OSS tooling)  ← this repo
└── ai-venture-studio     (private or public pipeline — separate)
```

**Why `vaultcompasshq` not personal:**

- Aligns with other V&C open tooling (GitHub org enablement docs already exist)
- Signals credibility for B2D / developer adoption
- Separates personal experiments from company-backed OSS

**Why not inside `vaultcompasshq` meta-repo:**

The existing `/Projects/vaultcompasshq` folder is an HQ ops placeholder. Conductor deserves its own repo with own issues, releases, and semver.

---

## License

**MIT** — maximizes adoption for skills and CLI. Venture Studio can depend on it without license friction.

Contributions from Superpowers community possible if skills are contributed upstream separately (Superpowers uses its own license — check before PR).

---

## Local path

```
/Users/melroysaldanha/Projects/conductor/
```

Sibling to `Vault & Compass LLC/`, `Engineering/`, `vaultcompasshq/`.  
Intended remote: `git@github.com:vaultcompasshq/conductor.git`

---

## Monorepo structure (planned)

```
conductor/
├── packages/
│   ├── schema/                 # @vaultcompasshq/conductor-schema
│   ├── skill/                  # Superpowers skill files
│   ├── cli/                    # conductor binary
│   └── memory/                 # constraint index
├── integrations/
│   ├── superpowers/
│   ├── cursor/
│   └── ai-venture-studio/
├── docs/
├── examples/
│   └── intent-contracts/       # synthetic only in public repo
└── LICENSE
```

Publish to npm eventually as `@vaultcompasshq/conductor-cli` (optional, phase 4).

---

## Relationship to AI Venture Studio

```
┌─────────────────────────────────────────────────────────┐
│  vaultcompasshq/conductor (PUBLIC)                      │
│  Schema, skills, CLI, drift engine, docs                │
└───────────────────────────┬─────────────────────────────┘
                            │ npm / git submodule / path dep
                            ▼
┌─────────────────────────────────────────────────────────┐
│  ai-venture-studio (PRIVATE or public pipeline repo)    │
│  Agent #0–#8, pollers, Linear, gold standards         │
└─────────────────────────────────────────────────────────┘
```

Conductor **feeds** Venture Studio:

- Agent #0 evolves from venture go/no-go → **session + intent governance**
- Agent #4f idea-alignment consumes Intent Contracts as input
- Drift-resistant template imports guardrails from Conductor schema

Venture Studio does **not** compete with Conductor — it consumes it.

---

## Release strategy

| Milestone | Tag | Contents |
|-----------|-----|----------|
| v0.1.0 | `0.1.0-alpha` | Schema + example contracts + skill draft |
| v0.2.0 | `0.2.0-alpha` | CLI read-only (`contract validate`, `drift check`) |
| v0.3.0 | `0.3.0-beta` | Superpowers skill installable |
| v1.0.0 | `1.0.0` | Stable schema, CLI, Cursor integration docs |

Pre-1.0: schema may change. Document breaking changes in `CHANGELOG.md`.

---

## Security & secrets policy

**Never commit:**

- `.env`, API keys, Linear tokens
- Real customer project specs
- Internal venture portfolio data

**CI (when implemented):**

- Schema validation tests only
- No live model API calls in public CI (cost + key exposure)

---

## Marketing / positioning (public README)

**One-liner:** *Superpowers tells you how to work with AI. Conductor makes sure you're still building what you meant.*

**Tags:** `ai-agents`, `cursor`, `claude`, `intent-alignment`, `drift-detection`, `superpowers`

**Not marketed as:** autonomous coding agent, venture studio replacement, or model provider.
