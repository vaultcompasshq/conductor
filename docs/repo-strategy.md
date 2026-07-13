# Repository Strategy - vaultcompasshq/conductor

**Date:** 2026-06-17  
**Decision:** Public open-source repository under the VaultCompass GitHub org

---

## Should this be public?

**Yes.** Conductor is infrastructure other developers can adopt without exposing Vault & Compass product IP.

| Public (this repo) | Downstream / private repos |
|--------------------|-------------------------------------|
| Intent Contract schema | Product-specific gold-standard tests |
| Superpowers skills | Issue-tracker API keys, product portfolio data |
| CLI (`conductor contract`, `drift`, `coach`) | Proprietary scoring rubrics for ideation |
| Drift detection algorithms | Customer-specific audit thresholds |
| Integration guides | Internal agent prompt versions |
| Example contracts (synthetic) | Real project specs with business data |

**Analogy:** Like ESLint (public rules engine) vs your company's internal eslint config (private).

---

## GitHub organization placement

```
github.com/vaultcompasshq/
├── conductor             (public OSS — this repo)
└── …                     (private product repositories — not named here)
```

**Why `vaultcompasshq` not personal:**

- Aligns with other V&C open tooling (GitHub org enablement docs already exist)
- Signals credibility for B2D / developer adoption
- Separates personal experiments from company-backed OSS

**Why a standalone repo:**

Conductor has its own package graph, issues, releases, and semver. Keeping it separate makes installation, contribution, and release management clearer.

---

## License

**MIT** — maximizes adoption for skills and CLI. Downstream products can depend on it without license friction.

Contributions from Superpowers community possible if skills are contributed upstream separately (Superpowers uses its own license — check before PR).

## Monorepo structure (planned)

```
conductor/
├── packages/
│   ├── schema/                 # @vaultcompass/conductor-schema
│   ├── skill/                  # Superpowers skill files
│   ├── cli/                    # conductor binary
│   └── memory/                 # constraint index
├── integrations/
│   ├── superpowers/
│   ├── cursor/
│   └── downstream-pipeline/
├── docs/
├── examples/
│   └── intent-contracts/       # synthetic only in public repo
└── LICENSE
```

Publish to npm eventually as `@vaultcompass/conductor-cli` (optional, phase 4).

---

## Relationship to Downstream Products

```
┌─────────────────────────────────────────────────────────┐
│  vaultcompasshq/conductor (PUBLIC)                      │
│  Schema, skills, CLI, drift engine, docs                │
└───────────────────────────┬─────────────────────────────┘
                            │ npm / git submodule / path dependency
                            ▼
┌─────────────────────────────────────────────────────────┐
│  downstream product or internal automation repo         │
│  host runtime wiring, product data, private thresholds  │
└─────────────────────────────────────────────────────────┘
```

Conductor should expose stable packages and integration samples. Product-specific runtime wiring, private scoring thresholds, and customer data belong in downstream repos.

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

- `.env`, API keys, issue tracker tokens
- Real customer project specs
- Internal product portfolio data

**CI (when implemented):**

- Schema validation tests only
- No live model API calls in public CI (cost + key exposure)

---

## Marketing / positioning (public README)

**One-liner:** *Superpowers tells you how to work with AI. Conductor makes sure you're still building what you meant.*

**Tags:** `ai-agents`, `cursor`, `claude`, `intent-alignment`, `drift-detection`, `superpowers`

**Not marketed as:** autonomous coding agent, product studio replacement, or model provider.
