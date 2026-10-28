# The policy file

Moved here from the README. Back to the [README](../README.md).

`.guardrails.yaml`, at the repository root. `conductor init` writes one with
every gate listed and only the ones it found switched on.

```yaml
version: 1

gates:
  dependencies:
    product: dep-guard
    enabled: true
    stage: commit
    enforce: true
    options:
      fail-on: high
  secrets:
    product: vault-guard
    enabled: true
    stage: commit
    enforce: true
  intent:
    product: intent-guard
    enabled: true
    stage: ci
    # It runs and reports in CI without failing the run. Flip it to
    # true once a few pull requests show the signal is worth blocking on.
    enforce: false
    options:
      require-frozen: false
  secrets-history:
    product: gitleaks
    enabled: true
    # Enabled because gitleaks was found on the machine that ran init. CI must
    # install gitleaks itself (conductor does not); without it this gate
    # reports conductor/gate-missing and the run exits 2.
    stage: ci
    enforce: true
  vulnerabilities:
    product: osv-scanner
    enabled: true
    # Enabled because osv-scanner was found on the machine that ran init. CI must
    # install osv-scanner itself (conductor does not); without it this gate
    # reports conductor/gate-missing and the run exits 2.
    stage: ci
    enforce: true
    present-on-base: report

report:
  format: text
```

**Gates are keyed by role**, not by product. `dependencies` (dep-guard),
`secrets` (vault-guard), `intent` (intent-guard), `secrets-history`
(gitleaks, scanning git history) and `vulnerabilities` (osv-scanner, over
the resolved dependency tree). The `product` field says which binary fills
that role today. The last two are external tools you install yourself.

**`enabled`** defaults to true. A gate that is enabled and whose binary
cannot be found is a blocking finding of the umbrella's own
(`conductor/gate-missing`), never a silent skip.

**`stage`** says when a gate runs: `commit`, `push`, or `ci`. Stages are
**cumulative** in that order, so a gate runs at its own stage and at every
later one, and a run at `ci` runs everything that is enabled. The defaults
are `commit` for `dependencies` and `secrets`, and `ci` for `intent`,
`secrets-history` and `vulnerabilities`: a history scan and a registry
lookup are pull-request work, not commit-time work.

A gate held back by the stage filter is never silent. It is one line in the
text report naming the stage it is waiting for, and a `conductor/gate-deferred`
notification in the SARIF log's `conductor` run. Its binary is not even looked
for, so a gate installed only on the CI image does not fail a developer's
commit.

**`enforce`** defaults to true. A gate with `enforce: false` runs, reports,
and its findings appear in the text report and the SARIF log exactly as an
enforced gate's do. The only thing it cannot do is change the exit code: its
blocking findings do not raise it, and its failing to run at all does not
make the run exit 2. That is the adoption ramp, so a gate can be switched on
and read for a few weeks before it is allowed to refuse anybody's commit.
`init` writes it out for every gate. For the intent gate it writes `true`
(and see `present-on-base` below for the vulnerabilities gate)
when a frozen contract already exists at init time
(`.intent-guard/intent-contract.yaml`, or the pre-1.3.0
`.conductor/intent-contract.yaml`), since the ramp is already climbed by
then, and leaving it unenforced would silently let a frozen contract's
protected paths produce findings that never fail the check. It writes
`false`, with a comment explaining why, when there is no contract yet to
enforce against, and in that case it also writes `require-frozen: false`
under `options`, since intent-guard otherwise blocks on a missing contract.
The `options` comment is written per gate: gitleaks and osv-scanner have no
severity floor, so their comments point at `.gitleaks.toml` and
`osv-scanner.toml` rather than at `fail-on`.

**`options`** is handed to that gate unchanged. Each key is one of that
gate's own long flags with the leading dashes stripped: `fail-on: high`
becomes `--fail-on high`, `online: true` becomes `--online`,
`require-frozen: false` becomes `--no-require-frozen`, and a list becomes
one flag per entry. The handful of flags the umbrella supplies itself (the
JSON format flag, `--staged`, and the intent gate's `--project`) are
rejected if you also set them, rather than being silently overridden. For
the external gates the umbrella writes `--report-format`, `--report-path`,
`--exit-code`, `--log-opts`, `--config`, `--gitleaks-ignore-path`,
`--ignore-gitleaks-allow`, `--log-level`, `--redact` and `--no-banner` to
gitleaks, and
`--format`, `--config` and `--lockfile` to osv-scanner, so those are
reserved too. Narrow what either
tool reports in its own config file (`.gitleaks.toml`, `osv-scanner.toml`)
instead. Two osv-scanner flags are written without being reserved: a run
that scans a requirements file always gets `--no-resolve`, and a
`no-resolve` key here is dropped from that run with a note; and a
pull-request run gets `--no-call-analysis=all` unless this block names
`call-analysis` or `no-call-analysis`, in which case that value is used.
`timeout-seconds` is refused under `options` on every gate, and `timeout`
on every gate but gitleaks, where it is gitleaks' own `--timeout` flag and
is passed through (see `timeout-seconds` below and
[What a history scan costs](../README.md#what-a-history-scan-costs) in the
README).

**`present-on-base`** (the `vulnerabilities` gate only, beside `enforce`,
never under `options`) is `block` or `report`. On a pull-request run whose
osv-scanner scan blocked, the umbrella also scans the base branch copies of
the lockfiles that carry findings and labels each finding `introduced` or
`present-on-base`. `block` blocks on every finding; `report` reports the
present-on-base ones without blocking and blocks only on what the pull
request introduced. A policy without the key blocks on every finding, so no
existing policy is loosened; `init` writes `report` for a new repository.
On a pull request the key is read from the base branch's policy like every
other key, so a pull request cannot set it for itself. A run with no base (a
local run, a push) has no labels, and every finding blocks. The key on any
other gate is an error, and an older conductor rejects it, so move the
Action first.

**`timeout-seconds`** (any gate, beside `enforce`, never under `options`)
is how long conductor lets that gate run before stopping it: a whole number
of seconds from 10 to 21600. The floor is there because the same limit
bounds the gate's version probe, and a limit of a second or two can stop the
probe of a gate that starts slowly before it ever scans. The ceiling is the
six hours after which a GitHub-hosted job is cancelled; a larger limit could
never fire there. Without the key each gate keeps the default for its
product: 120 seconds for dep-guard, vault-guard and intent-guard, 600 for
gitleaks, 300 for osv-scanner. There is no policy-wide default, for the same
reason there is no shared severity threshold: the five gates differ in cost
by orders of magnitude. Every spawn of the gate gets the full limit (the
version probe, the scan, the intent gate's preparation steps, osv-scanner's
base run on a pull request). A gate stopped at its limit could not run, with
the reason `timed-out` and what to do about it, and an enforced one makes
the run exit 2. On a pull request the key is read from the base branch's
policy like every other key, so a pull request cannot raise, lower or
remove its own limit; an invalid value on the base fails every pull request
with exit 2 until the base is fixed, and an invalid value only on the head
is a policy proposal there and fails the push run after merge. An older
conductor rejects the key, so move the Action first.

**There is no shared severity threshold, on purpose.** One top-level
`failOn` would read as one decision and mean five different things, so
setting one is an error rather than a knob that half works. Each gate keeps
its own threshold in its own `options` block, spelled the way that gate
spells it.

**`command`** takes an absolute path and overrides binary resolution for
that gate, for pointing at a build that is not installed anywhere. `args`
beside it sets the argument prefix. conductor's history gate assumes
gitleaks' `git` mode; an `args` that switches it to `dir` mode changes what
gitleaks' own `--timeout` does (in `dir` mode it exits 0 after a partial
scan, with no warning).

**`report.format`** is `text` or `sarif`, and `--format` overrides it.
