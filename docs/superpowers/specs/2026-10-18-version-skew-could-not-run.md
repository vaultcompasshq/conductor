# A gate version that is not the Action's pin is could-not-run

Date: 2026-10-18
Status: design, written before the code, with the operator's ruling of
2026-10-18 applied (section 1).
Scope: conductor only; the three family gates (dep-guard, vault-guard,
intent-guard), the only ones the Action pins.
Release: 0.13.0, a minor. 0.12.0 warned on the same condition and its
CHANGELOG announced this change.

## 1. Ruling (not reopened here)

- When the expected-version signal the Action sets is present and the
  resolved gate reports a different version, that gate is could-not-run
  (exit 2), with a reason naming the expected and found versions, where
  the binary came from, and the remedy (bump or remove the
  devDependency). From every resolution location: node_modules/.bin, PATH
  or a policy command.
- A run without the signal (every plain CLI run) is unchanged.
- Resolution order is unchanged.

## 2. The signal

The Action's run step sets CONDUCTOR_EXPECTED_DEP_GUARD_VERSION,
CONDUCTOR_EXPECTED_VAULT_GUARD_VERSION and
CONDUCTOR_EXPECTED_INTENT_GUARD_VERSION from its three version inputs.
`expectedVersionOption` (src/run.ts) reads them and hands runGate an
`expectedVersion` only for an exact x.y.z; anything else is no signal,
unchanged from 0.12.0. Under the Action that branch is unreachable: the
validate step refuses any input that is not an exact x.y.z before
conductor runs.

The signal becomes a control input, but a one-directional one: it can
only add a could-not-run, never remove a finding or clear a gate. A run
that sets it wrongly fails closed; a run that leaves it out is the plain
run it was before. On a same-repository pull request the workflow file is
the head's, so the head writes the inputs; the backward-pin rule already
bounds them, and the worst the head can do with this signal is fail its
own run.

## 3. The rule (runGate, src/gate-runner.ts)

Placed directly after the version probe, where 0.12.0 recorded the skew:
after the head-controlled-program refusal, the git floor and the shallow
check (none of which runs the gate), and after a timed-out probe (which
stays `timed-out`). Before the command-line floor and before
`decideTrustBase`, so nothing past the probe runs.

- `expectedVersion` set, version read and different: could-not-run,
  reason `version-skew`. `versionSkew` is recorded as before (expected,
  found, source, path) and every surface that showed the 0.12.0 warning
  still shows it, worded as a could-not-run.
- `expectedVersion` set, version NOT read: could-not-run, reason
  `version-unverified`. FAIL CLOSED: the run was told which build must
  judge it and cannot show that this one is it. Reachable with an
  unreadable or non-zero probe, a first line the product pattern does not
  match, and the legacy intent-guard-check binary with no version-safe
  sibling. Its own reason rather than `version-skew`, because nothing was
  shown to differ; the remedy points at the same install.
- Both are ENFORCED whatever the policy says (`enforce: true`, like a
  refused program): the gate produced no verdict for `enforce: false` to
  be a decision about, and the ruling is exit 2. `--advisory` never
  touches exit 2.
- Both are conductor's own reasons (`CONDUCTOR_OWN_REASONS`), so the
  text log line carries "conductor said".

Detail sentence (reaches reports, so no machine path, and the found
version cut to version characters as 0.12.0 already did on the GitHub
surfaces): "<product> did not run: the build resolved from <place> reports
version <found>, but this run expects <expected> (the version the action
pinned). <remedy>". `<place>` is the repository-relative
node_modules/.bin path, "PATH" or "the policy command". The remedy is the
one 0.12.0 printed, per source, now kept in one function in
src/gate-runner.ts and used by every renderer.

## 4. Edges

| Edge | Outcome |
|---|---|
| no signal (plain run), any version | unchanged: runs, no skew |
| signal not exact x.y.z | no signal |
| signal, version equal | runs, no skew |
| signal, version differs, node_modules/.bin, PATH or policy | could-not-run `version-skew`, enforced |
| signal, version unreadable | could-not-run `version-unverified`, enforced |
| signal, probe timed out | `timed-out`, as before |
| signal, binary missing | `binary-missing`, as before, no skew |
| signal, external gate (gitleaks, osv-scanner) | no signal for it, unchanged |

## 5. Known residual

The intent gate's pull-request preparation (src/run.ts) spawns the binary
(import-spec, freeze) before runGate probes its version, so a skewed
PATH intent-guard still runs its preparation steps before the gate is
declared could-not-run. The outcome is the same exit 2; on a pull request
node_modules/.bin is never consulted, and the program check has already
refused a head-controlled binary.

## 6. Tests and mutations

runGate (tests/gate-runner.test.ts) and the CLI (tests/cli.test.ts):
skewed node_modules/.bin gate under the signal is could-not-run and the
CLI exits 2; a PATH skew too; a matching version runs; no signal is
unchanged (runs, exit 0); an unreadable version under the signal is
`version-unverified`, and runs without the signal; `enforce: false` does
not hide it.

| Mutation | Must go red |
|---|---|
| drop the skew return (record only, as 0.12.0) | the could-not-run skew cases |
| drop the unreadable branch | the version-unverified case |
| keep the policy's enforce | the enforce: false case |
| fire without the signal | the plain-run case |
