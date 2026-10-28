# Upgrading

Moved here from the README. Back to the [README](../README.md).

An adopter pins two numbers, and they control different things.

- **The action ref**, `uses: vaultcompasshq/conductor@<tag or SHA>`, picks
  which `action.yml` runs. That file carries the defaults for the four
  version inputs and the constants the pull-request backward-pin rule
  measures a pin against.
- **The `conductor-version` input** picks which `@vaultcompass/conductor`
  the install step installs. The same step installs the three gates at
  `dep-guard-version`, `vault-guard-version` and `intent-guard-version`.
  Each input defaults to the version the tag shipped.

**The recommended shape is to leave all four version inputs unset** and move
only the action ref. On a pull request, the validate step refuses an input
naming a version below the one the tag ships, so an explicit old pin breaks
the day you upgrade the ref (see [The Action](../README.md#the-action)). Outside a pull request
an explicit pin is unaffected, which is how a stale pin can sit unnoticed
until the first pull request after the upgrade.

**Pin the action ref to a full commit SHA** with the tag as a comment, for
example `uses: vaultcompasshq/conductor@<40-character SHA> # v0.15.0`. To
find the SHA for a tag, run
`gh api repos/vaultcompasshq/conductor/git/ref/tags/v0.12.0` or read it off
the Releases page.

**Dependabot or Renovate bumping that SHA changes the action ref only.** It
does not touch a `dep-guard-version`, `vault-guard-version`,
`intent-guard-version` or `conductor-version` you set by hand, so such a pin
must be raised or removed by hand in the same pull request, or that pull
request is refused by the rule above.

**An action-only tag moves the tag while the npm package stays.** The
CHANGELOG marks these as "An action-only release" and says which
`conductor-version` default stays. `@vaultcompass/conductor` does not change
on those, so `conductor-version` need not change either; the gate defaults
may.

Defaults per tag, taken only from CHANGELOG.md entries that state them. A
tag with no row here has an entry that does not state its defaults; read
`action.yml` at that tag.

| Action tag | Kind | `conductor-version` default | Gate defaults the entry says moved |
| --- | --- | --- | --- |
| v0.15.0 | package | 0.15.0 | dep-guard 0.17.0 (from 0.16.1), intent-guard 1.10.2 (from 1.10.1) |
| v0.14.0 | package | 0.14.0 | none (gate defaults unchanged) |
| v0.13.2 | package | 0.13.2 | none (gate defaults unchanged) |
| v0.13.1 | action-only | 0.13.0 | dep-guard 0.16.1 (from 0.15.0) |
| v0.13.0 | package | 0.13.0 | none (gate defaults unchanged) |
| v0.12.0 | package | 0.12.0 | vault-guard 1.12.1 (from 1.12.0), intent-guard 1.10.1 (from 1.10.0) |
| v0.11.1 | action-only | 0.11.0 | dep-guard 0.15.0 (from 0.14.0), vault-guard 1.12.0 (from 1.11.0) |
| v0.11.0 | package | 0.11.0 | dep-guard 0.14.0, intent-guard 1.10.0 |
| v0.10.0 | package | 0.10.0 | dep-guard 0.13.0, vault-guard 1.11.0 |
| v0.8.2 | action-only | 0.8.1 | dep-guard 0.11.1 (from 0.10.1) |
| v0.8.1 | package | 0.8.1 | dep-guard 0.10.1, vault-guard 1.9.1, intent-guard 1.8.1 |
| v0.8.0 | package | 0.8.0 | dep-guard 0.10.0, vault-guard 1.9.0, intent-guard 1.8.0 |
| v0.7.0 | package | 0.7.0 | none |
| v0.6.0 | package | 0.6.0 | dep-guard 0.9.0 (from 0.8.0), intent-guard 1.7.0 (from 1.6.0) |
| v0.5.1 | action-only | 0.5.0 | dep-guard 0.8.0 (from 0.7.0), intent-guard 1.6.0 (from 1.5.2) |
| v0.4.4 | action-only | 0.4.0 | dep-guard 0.7.0 (from 0.6.0), vault-guard 1.8.0 (from 1.7.0) |
| v0.4.3 | action-only | 0.4.0 | intent-guard 1.5.2 (from 1.4.0) |
