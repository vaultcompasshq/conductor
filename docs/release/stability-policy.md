# Stability Policy

**Effective:** declared at `v1.0.0` npm release  
**Packages:** `@vaultcompass/conductor-schema`, `conductor-core`, `conductor-skill`, `conductor-cli`

## Intent Contract schema (document version)

The YAML field `version` on an Intent Contract is **`1.0.0`**.

| Change type | Policy |
|-------------|--------|
| Add optional fields | Minor npm release; schema stays backward compatible |
| Rename or remove required fields | Major npm release; migration notes in CHANGELOG |
| Validation rule tightening | Minor if existing valid contracts stay valid; else major |

Frozen contracts in `.conductor/contracts/` are archives; the active contract at
`.conductor/intent-contract.yaml` is the source of truth per project.

## npm package semver

Pre-`1.0.0` (`0.3.0-beta.x`): breaking CLI or schema validation changes may land in beta
without a major bump. After **`1.0.0`**:

| Bump | When |
|------|------|
| **Patch** | Bug fixes, docs, non-breaking validation tweaks |
| **Minor** | New commands/flags, new optional contract fields, new skills |
| **Major** | Removed commands, breaking contract schema, breaking programmatic API |

## CLI stability

Commands documented in [cli-reference.md](../cli-reference.md) are stable at v1.
Legacy per-command binaries (`conductor-check`, etc.) remain available via
`@vaultcompass/conductor-skill` but the supported surface is `conductor <subcommand>`.

## Known non-guarantees (v1)

- **Extraction** is rule-based; humans must review before `freeze`.
- **Approval** is recorded via `--approved-by`; software cannot prove human intent.
- **Drift scoring** is heuristic; false positives/negatives are possible.
- **Hook samples** are integration examples; host-specific wiring lives in consumer repos.

## Deprecation

Deprecated flags or commands get one minor release with warnings, then removal in the next major.
