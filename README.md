# conductor

conductor is the one required check for a repository an AI agent edits. It
runs the scanners a maintainer already trusts, and adds the checks those
scanners cannot do on their own: a hallucinated package name, a credential
caught before the edit lands, a pull request that edits its own gate, a
change that reaches outside what was approved for it.

It does that by running five gates over one policy file, one init, one
hook and one report: three from this family, and two the adopter already
installs, gitleaks for secrets anywhere in git history and osv-scanner for
known vulnerabilities. conductor scans nothing itself and installs nothing
that is not its own. Delete conductor and every one of those five still
runs, with exactly the configuration it had.

The claim is checked in public. The
[conductor-proof](https://github.com/vaultcompasshq/conductor-proof)
repository runs an ordinary gitleaks and osv-scanner job beside conductor,
with six pull requests left open on purpose, one planted problem each.
Read the checks on each pull request rather than this table.

| Planted problem | Ordinary job | conductor |
| --- | --- | --- |
| [A dependency whose name does not exist on npm](https://github.com/vaultcompasshq/conductor-proof/pull/6) | pass | fail |
| [A pull request that turns off its own checks, then adds that dependency](https://github.com/vaultcompasshq/conductor-proof/pull/7) | skipped | fail |
| [A credential-shaped string in a test fixture](https://github.com/vaultcompasshq/conductor-proof/pull/8) | fail | fail |
| [An edit to a path the intent contract protects](https://github.com/vaultcompasshq/conductor-proof/pull/11) | pass | fail |
| [A credential-shaped string committed, then replaced, so only history carries it](https://github.com/vaultcompasshq/conductor-proof/pull/15) | fail | fail |
| [A dependency at a version with a known advisory](https://github.com/vaultcompasshq/conductor-proof/pull/16) | fail | fail |

The rows where both fail are parity, not a catch: both jobs run gitleaks
and osv-scanner, so both see a credential shape, a credential in history,
and a known advisory. The other three are what a scanner that only knows
about vulnerabilities and secrets has no way to know.

<!-- guardrails-family: shared block, keep it identical in dep-guard, vault-guard, intent-guard and conductor -->
The Vault & Compass guardrails are three gates over an AI-assisted coding
session: [dep-guard](https://www.npmjs.com/package/@vaultcompass/dep-guard)
checks what comes in (hallucinated package names, typosquats, tampered
lockfile entries),
[vault-guard](https://www.npmjs.com/package/@vaultcompass/vault-guard) checks
what goes out (credentials about to be committed), and
[intent-guard](https://www.npmjs.com/package/@vaultcompass/intent-guard)
checks the change against what was approved (drift from a frozen intent
contract, and change budgets). Each one installs, configures and runs on its
own;
[conductor](https://www.npmjs.com/package/@vaultcompass/conductor) is the
optional umbrella that runs them from one policy file, one hook and one
report, beside two scanners you install yourself:
[gitleaks](https://github.com/gitleaks/gitleaks) for secrets anywhere in git
history and [osv-scanner](https://github.com/google/osv-scanner) for known
vulnerabilities. conductor scans nothing itself and installs nothing that
is not its own.
<!-- /guardrails-family -->

## Adopting conductor

The first pull request under a policy conductor just added cannot be judged
by that policy, so plan for a short, ordered sequence rather than one
command: init, a first pull request in advisory mode, merge, then go
required.

1. **Init.** Install the gates. Each of them is a working tool on its own,
   and none of them needs this one:

   ```
   npm install -g @vaultcompass/dep-guard @vaultcompass/vault-guard @vaultcompass/intent-guard
   ```

   The umbrella is optional. Install it when running the three separately
   has become the annoying part:

   ```
   npm install -g @vaultcompass/conductor
   ```

   The two external gates are installed by you, on your machine and in your
   workflow, from their own releases: [gitleaks](https://github.com/gitleaks/gitleaks)
   8.19 or later and [osv-scanner](https://github.com/google/osv-scanner)
   2.x. conductor never downloads either one. It finds them on `PATH`, and
   when one is enabled in the policy and missing, the run reports
   could-not-run (exit 2) with the install step in the report. Two policy
   lines switch them on:

   ```yaml
   gates:
     secrets-history:
       product: gitleaks
     vulnerabilities:
       product: osv-scanner
   ```

   **Globally, and that is the guidance for CI too.** A devDependency is
   fine beside it for your own pre-commit hook, and nothing about a local
   run changed. It is not what gates your pull requests: on a pull-request
   run the umbrella never looks in `node_modules/.bin` at all, because what
   is installed there is chosen by the head's own manifest and lockfile. The
   Action installs all four packages itself, globally, at versions pinned in
   your workflow file. See "The pull-request trust boundary" and "The
   Action" below.

   From the repository root, look before you write:

   ```
   conductor init --dry-run
   ```

   That prints every file it would write or change and writes nothing. Then:

   ```
   conductor init
   ```

   which writes `.guardrails.yaml` with every gate listed and only the ones
   it found switched on, and `.guardrails/manifest.json`, the record init
   reads back on a later `--revert`. The intent gate is written unenforced
   unless a frozen contract already exists at `.intent-guard/intent-contract.yaml`,
   in which case init enforces it from the start rather than leaving a
   frozen contract's protected paths reporting without blocking. **It writes
   no pre-commit hook unless you ask for one:**

   ```
   conductor init --hook
   ```

   adds one pre-commit hook on top of that, running every enabled gate whose
   stage is `commit`. A CI-only adopter that never runs conductor locally can
   stop at the first `conductor init`, with no hook at all.

   **`.git/hooks` is never part of a clone**, so a hook one checkout has does
   not follow a teammate's clone, or a fresh clone of your own: hooks are per
   clone and per machine. Each clone that wants the hook runs
   `conductor init --hook` once; a repository that already has
   `.guardrails.yaml` gets only the hook from that run, since init never
   rewrites a policy file that already exists.

   Do not wire this into a `package.json` `prepare` script. A failing init
   (no `.git` in a Docker build, a foreign hook already installed, husky's
   own `prepare` key, or conductor not yet installed at install time) would
   fail `npm install` itself for everyone who runs it, not only for the
   person who wanted the hook.

   **`.guardrails/manifest.json` records the absolute path on the machine
   that ran `init`**, for the hook, when there is one, and for the policy
   file alike, and
   conductor does not add a `.gitignore` entry for it. That path is specific
   to your checkout, so do not commit the file: add
   `.guardrails/manifest.json` to your own `.gitignore` today. The file
   lives inside your working tree so `--revert` can find it later, and
   recording repo-relative paths there instead of absolute ones is a known
   gap, not a design; it has not been fixed yet.

   Commit something, now that `--hook` above has installed the pre-commit
   hook (this walkthrough's output below only appears when the hook is
   installed; a bare `conductor init` with no `--hook` runs no gate on
   commit at all). A clean commit prints one line:

   ```
   conductor: clean, nothing blocked. 2 gate(s) ran: dependencies (dep-guard), secrets (vault-guard). Deferred to a later stage: intent (intent-guard) from stage ci. 0 gate(s) left out by --gate. 0 gate(s) not enforced. 1 note(s). 0 suppressed across all gates. Re-run with --verbose for the full report.
   ```

   The line names every disposition a gate can have on that run, with its
   count, even when the count is zero: ran, deferred to a later stage, left
   out by `--gate`, not enforced, and suppressed findings. Which gates appear
   in each depends on your policy file.

   A commit with a staged credential in it prints the full report and exits 1:

   ```
   conductor 0.6.0
   conductor run: 2 gate(s), 1 finding(s)

   dependencies  dep-guard 0.7.0  exit 0  153ms  via dep-guard on path
     threshold medium   suppressed 0   ignored 0
     mode staged   corpusBuiltAt 2026-09-20T06:16:40.340Z   lockfileFormat npm   online-flag not passed

   secrets  vault-guard 1.8.0  exit 1  105ms  via vault-guard on path
     BLOCKING  critical  vault-guard/anthropic  jest.config.mjs:14:12
         Possible secret of type 'anthropic'
     threshold medium   suppressed 0   ignored not reported
     filesScanned 1   patternsActive 59

     deferred  intent  intent-guard  did not run here; it runs from stage ci onwards

   verdict: exit 1, 1 blocking finding(s) across 2 gate(s).
   ```

   The `mode`, `corpusBuiltAt`, `lockfileFormat` and `online-flag` line under
   `dependencies`, and the `filesScanned`/`patternsActive` line under
   `secrets`, are each gate's own run facts, one line per gate, added to the
   full report so a reader can see what a gate actually scanned and with
   what, not only its verdict.

   Both gates there are the ones you installed a moment ago, running with
   their own thresholds and their own baselines. The umbrella found nothing
   of its own, because it looks for nothing of its own.

   Before opening anything, run `conductor run --verbose` on this same
   checkout. That is the full report your policy will produce for the
   dependency and secrets gates, with no `--trust-base` involved: a direct
   run on your own checkout is already inside the trust boundary, so it
   reads the policy you just wrote. **It is not the full preview for the
   intent gate.** Locally, with no `--base`, the intent gate runs the way it
   runs at a commit: intent-guard's own native flow, which wants an approved
   contract and reports `BLOCKING critical intent-guard/gate-blocked` when
   there is none. On a pull request a base ref resolves (conductor reads
   `GITHUB_BASE_REF`, which GitHub sets for the whole job on a
   `pull_request` event), and the umbrella instead prepares a contract for the
   intent gate itself; with no contract to import, that path reports the
   gate `skipped ... no contract` and never reaches the exit code. So a
   first pull request with no contract yet is not blocked by the intent gate
   on the pull request, whatever the local preview showed a moment before.
   See "Intent at a pull request" below for the full mechanism.

2. **Open the first pull request in advisory mode.** Add `.guardrails.yaml`
   and the workflow together, with `advisory: true` and `pr-comment: true`
   on the conductor step -- the recipe under "Running the gates as an
   advisory check" below is a complete copy-paste job -- and leave the check
   out of branch protection for this one pull request. The step still exits
   2 on this pull request even with `advisory: true`: the base branch has no
   policy yet, so the run has no rules, and `advisory` never touches that
   exit code, only a blocking finding's. Leaving the check out of branch
   protection is what keeps that expected exit 2 from blocking the merge;
   the step posts a comment saying so with the remedy on it, which is the
   honest report of an unfinished adoption, not a broken tool.

3. **Merge.** Every pull request after that is judged by the policy on the
   base branch, and a change to that policy shows up as a proposal line and
   takes effect after its own merge.

4. **Go required.** Once a few ordinary pull requests have shown the report
   reads the way you expect, remove `advisory: true` from the conductor step
   and require the job's own check context in branch protection -- `gates`
   in the recipes below, the job name, never the context the SARIF-upload
   step reports under. That is the whole of turning this from an advisory
   job into the one required check.

There is deliberately no mode in which the pull request's own policy file
decides the run, not even as a preview: step 1's preview gives you the same
report without putting a file the pull request controls behind a verdict on
the pull request page.

## Why

Run all three family gates and you have three inits, three config files,
three output shapes, and three pre-commit hooks fighting over one file, and
a separate job for the two external scanners. That is the
friction this repository removes, and that is all it removes:

- **one policy file**, `.guardrails.yaml`, keyed by the role each gate
  fills rather than by the product filling it;
- **one init**, which writes that file, and with `--hook` a single
  pre-commit hook running every enabled gate whose stage is `commit`, which
  by default is every gate but the intent one;
- **one report**, as text for a terminal or as a single SARIF 2.1.0 log
  with one run per gate.

**A clean run prints one line.** Most runs are clean, and the design
constraint on all of this is that the gates must not slow development down,
with ceremony rather than runtime named as the cost. A screenful of per-gate
detail on a commit that found nothing is that cost, paid on every commit, and
it is what makes a team switch a hook off.

## What it deliberately is not

It is not a sixth gate. It finds no bugs of its own and scans nothing.
Every finding about your code came from one of the five gates and is
labelled with which one. The only findings it adds are about the gates
themselves, and they are labelled `conductor`: a gate that is switched on
and could not run, and a gate whose output it could not read. Those exist
because a report that reads clean when nothing looked is the failure this
whole family exists to prevent.

It is not something you adopt before the gates are useful. Each gate keeps
its own config file, its own baseline, its own thresholds, and its own exit
codes. The umbrella never writes into any of them: it passes a policy to
each gate as command-line flags, which every one of them already treats as
higher precedence than its own config. Delete this tool and every
gate still runs, with exactly the configuration it had, because nothing
here ever touched it.

It does not overrule a gate. A gate that says a commit is blocked blocks
the commit. The umbrella can add to that decision and never subtracts from
it.

## The policy file

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
    stage: ci
    enforce: true
  vulnerabilities:
    product: osv-scanner
    enabled: true
    stage: ci
    enforce: true

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
when a frozen contract already exists at init time
(`.intent-guard/intent-contract.yaml`, or the pre-1.3.0
`.conductor/intent-contract.yaml`), since the ramp is already climbed by
then, and leaving it unenforced would silently let a frozen contract's
protected paths produce findings that never fail the check. It writes
`false`, with a comment explaining why, when there is no contract yet to
enforce against.

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
instead.

**There is no shared severity threshold, on purpose.** One top-level
`failOn` would read as one decision and mean five different things, so
setting one is an error rather than a knob that half works. Each gate keeps
its own threshold in its own `options` block, spelled the way that gate
spells it.

**`command`** takes an absolute path and overrides binary resolution for
that gate, for pointing at a build that is not installed anywhere.

**`report.format`** is `text` or `sarif`, and `--format` overrides it.

## Commands

`conductor init` writes the policy file and `.guardrails/manifest.json`, the
record `--revert` reads back later. The manifest currently records absolute
machine paths rather than repo-relative ones (see "Adopting conductor"
above); do not commit it.

- `--hook` also writes one pre-commit hook running every enabled gate whose
  stage is `commit`. Without it, init writes only the policy file and the
  manifest: no hook, and none of the hook-manager detection below runs
  either. `.git/hooks` is never part of a clone, so a hook one checkout has
  does not follow a teammate's clone, or a fresh clone of your own; each
  needs its own `conductor init --hook`. `--revert` still removes a hook a
  previous `--hook` run left behind, whether or not this invocation passes
  `--hook` itself.
- `--dry-run` prints every file it would write or change and writes nothing.
- `--revert` removes exactly what a previous init wrote, and nothing else.
  A file changed since init is reported and left alone.
- `--adopt` replaces one gate's own pre-commit hook with the umbrella hook.
  Without it, init reports the collision and stops rather than stacking a
  second invocation of a gate that is already hooked. A hook the umbrella
  does not recognise is never replaced, with or without `--adopt`. Only
  meaningful together with `--hook`; without it, init errors rather than
  silently ignoring the flag, because there is no hook for it to act on.
- `--force` acts on a file **conductor itself wrote** and that has changed
  since: on its own it replaces a managed hook somebody has edited, and with
  `--revert` it removes one, restoring an adopted hook if there was one. It
  never overrides a foreign-hook or gate-hook refusal, with or without
  `--adopt`: those hooks were never conductor's, and no flag here turns
  somebody else's file into one this tool may overwrite. Like `--adopt`,
  only meaningful together with `--hook` on an init (not on a `--revert`);
  without it, init errors.
- `--project <dir>` writes into that repository instead of the current
  directory, resolved to its git top level the same way the current
  directory already is, so a script can point init at a repository without a
  `cd` compound.

The rest of this section, on hook managers already wired into the
repository, applies only when `--hook` is given: none of it is consulted,
and none of it can block the policy file from being written, on a plain
`conductor init`.

Init recognises the hook manager already wired into the repository. husky is
redirected to the tracked hook it maintains rather than the generated
dispatcher git runs. lefthook and the pre-commit framework are refused, with
the stanza to add to their own config file. simple-git-hooks and yorkie are
refused too, and recognised from the declaration as well as from the hook
file, because the declaration is there on a fresh clone where the generated
hook is not yet: the `simple-git-hooks` or `gitHooks` key in package.json, or
any of the standalone config files simple-git-hooks reads. Their hook text
lives in package.json, which conductor does not write, so the guidance names
the entry to add and `--force` does not override the refusal.

That refusal applies only where git actually runs `.git/hooks`. Both managers
write that directory and neither reads `core.hooksPath`, so a repository that
has pointed git somewhere else has taken their file out of play, and init
proceeds normally without mentioning them.

`conductor run` runs every enabled gate and prints one report.

- `--staged` gates the git index against HEAD, which is what the hook does.
- `--format text|sarif`.
- `--stage commit|push|ci` runs the gates at that stopping point and every
  earlier one. With no `--stage` at all, every enabled gate runs, whatever
  its stage. An unknown value is a usage error and exits 2 rather than
  quietly running everything or nothing: a typo in a CI file that runs every
  gate and one that runs none both look like a passing build.
- `--base <ref>` measures the intent gate against what this branch changed
  since `<ref>`, rather than against the index. See "Intent at a pull
  request" below.
- `--trust-base <ref>` reads the **rules** from `<ref>` instead of from the
  tree being judged: this repository's own `.guardrails.yaml`, and every
  control input of the gates that support it. See "The pull-request trust
  boundary" below. `--base` and `--trust-base` are independent and a
  pull-request run passes both: `--base` decides which paths are judged,
  `--trust-base` decides what they are judged by. When `GITHUB_BASE_REF` is
  set, an explicit `--trust-base` is accepted only when it resolves to the
  same commit as `origin/$GITHUB_BASE_REF` (issue #58); anyone invoking the
  CLI directly on a pull request, rather than through the Action, gets this
  as its own refusal, named below.
- `--spec <path>` names the spec the intent gate imports its contract from.
- `--output <path>` writes the report to a file instead of to stdout, for a
  CI step that uploads it. One line still goes to stdout, because a job whose
  only product is an uploaded artifact otherwise reads as a job that did
  nothing. A path that cannot be written is exit 2, not a green run beside a
  report nobody can read. A relative value resolves against the current
  directory the command was invoked from, not against `--project` or the
  repository root: with `--project` pointing elsewhere, a relative
  `--output` still lands next to where you are, not next to the repository
  being judged.
- `--text-report <path>`, with `--format sarif`, also writes the text report
  to that file **from the same run**: exactly what `--format text` would have
  rendered for this result (`--verbose`, `--compact-on-refusal` and
  `--advisory` respected), and no gate is run a second time. This is how the
  Action gets a SARIF log, a comment body and a verdict token that are one
  run's answer. With `--format text` it is refused as a usage error (exit 2),
  before any gate runs: the text report is the output already, so a second
  copy in a file would only duplicate it. A path that cannot be written is
  exit 2, like `--output`. See "The verdict token" below.
- `--verbose` prints the full per-gate report even when the run is clean.
  Text output only; the SARIF log never changes shape with it.
- `--compact-on-refusal` shrinks the report to the version, the verdict and
  the refusal reason when the trust base was refused and no gate ran,
  instead of the full per-gate report. Built for the pull-request-comment
  step. It has no effect on a run that was not refused, whatever `--verbose`
  says. Text output only; it has no effect on the SARIF log and never
  changes the exit code.
- `--gate <role>`, repeatable. A gate the policy file enables and this flag
  leaves out is named as excluded, on one line in the text report and as a
  `conductor/gate-excluded` notification in the SARIF log's `conductor` run.
  It never reaches the exit code.
- `--advisory` maps exit 1 to exit 0: a run whose only failure is a blocking
  finding no longer fails. A gate that could not run is unaffected and still
  exits 2, so a crashed install or a missing policy still shows red rather
  than a silent green: this flag changes what a **finding** does, never what
  a **broken gate** does. The report is unchanged, a blocking finding still
  prints with its `BLOCKING` marker, and only the process exit and the
  verdict line's own wording (it says findings were advisory and did not
  block) change. Text output only; the SARIF log has no verdict line to
  change and its `properties.blocking` on each result is unaffected.
- `--project <dir>` runs against that repository instead of the current
  directory, resolved to its git top level the same way the current
  directory already is, so a subdirectory resolves to that repository's top
  level. A relative value resolves against the current directory. A path
  that does not exist, is not a directory, or is not inside a git repository
  is a usage error naming the path and exits 2 rather than falling back to
  the current directory.

### Exit codes

- **0** every enabled gate ran and none blocked.
- **1** every enabled gate ran and at least one blocked.
- **2** an enabled gate could not run: its binary is missing, it exited with
  its own could-not-run code, or it exited 1 with nothing parseable on
  stdout, which is what a rejected config file looks like from two of the
  three family gates.

The external gates' exits are read per tool. gitleaks exits 1 for an error
as well as for a leak, so the umbrella hands it `--exit-code 3`: 3 is a leak
(blocked), 1 is could-not-run. gitleaks also exits 0 with an empty report
when git itself fails (a base ref the checkout never fetched), so a clean
exit that logged an `ERR` line is could-not-run too, never a pass. A
gitleaks exit with no report file behind it is could-not-run. osv-scanner is
handed every tracked lockfile by name (`package-lock.json`,
`npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, at any
depth, never under `node_modules`); when the repository tracks none, it is
not spawned at all and the gate is reported clean with a
`conductor/nothing-to-scan` note, so a docs-only repository is not red on
every pull request. Its 1 is blocked. Its own 128 ("no package sources
found") on lockfiles it WAS handed means they parsed to no packages; that is
clean too, with a distinct `conductor/lockfiles-empty` note naming the
files. Only those npm-family names are handed over today: a repository
whose only lockfile belongs to another ecosystem gets nothing-to-scan from
this gate. Lockfiles inside git submodules are never listed. In a sparse
checkout a tracked lockfile that is not on disk is still handed over and
osv-scanner exits 127 on it, a false could-not-run that fails closed. Any other osv-scanner exit
(127 is its error code) is could-not-run. A gitleaks older than 8.19 or an
osv-scanner older than 2.0 is could-not-run, naming the floor.

`run --advisory` maps exit 1 to exit 0. It never touches exit 2: a gate that
could not run is a different failure from a blocking finding, and advisory
mode exists to leave that one alone. See "Running the gates as an advisory
check" below.

### The verdict token

The text report carries one more line: `verdict-token: <token>`, the **second
line**, directly under the version line (the closing `verdict:` sentence is
unchanged). It is a label for the umbrella's own exit decision, in a closed
set, so a person or a script can read the state without parsing a sentence.
It decides nothing and never overrules a gate: it is derived from the exit
code and the `enforce` flags the run already had.

- `pass`: exit 0, and no gate, enforced or not, has a blocking finding or
  could not run.
- `advisory-blocked (N)`: the run would have exited 1, and `--advisory` made
  it exit 0. N is the blocking findings on enforced gates.
- `unenforced-findings (N)`: exit 0, but a gate with `enforce: false` had
  blocking findings or could not run. N counts those findings plus those
  gates. Exit 0 here is not a pass, and the token says so.
- `blocked (N)`: exit 1. N as for `advisory-blocked`.
- `could-not-run`: exit 2, a refused trust base included.

When several apply the order is `could-not-run`, then `blocked` or
`advisory-blocked`, then `unenforced-findings`, then `pass`. A run with
`--advisory` whose only blocking findings sit on an unenforced gate is
`unenforced-findings`, not `advisory-blocked`, because the flag did nothing
there. A gate skipped for want of a contract does not by itself move the token
off `pass`; the verdict sentence is where "nothing was checked" is said. A
gate that exited non-zero with no finding marked blocking counts as one in N,
so a state that is not a pass never prints a count of zero. The one-line
summary of a clean, non-verbose run has no token line, since it is one line by
design. `conductor run` also prints the token on its job-log line,
`conductor run: 4 gate(s), 1 finding(s); verdict-token advisory-blocked (1); sarif report written to conductor.sarif`.

## The pull-request trust boundary

Every gate reads its own rules out of the repository it is judging. On a pull
request the author controls that repository, so without this a pull request
could turn a gate off in the same commit that carries the thing the gate
exists to catch, and the report would say the run was clean. For the umbrella
the sharpest version is `command:`, which names a program to run: a pull
request could point a gate at a script it added in the same commit.

**On a pull-request run the rules come from the base branch.** With
`--trust-base <ref>` the umbrella reads `.guardrails.yaml` from that ref with
`git show` and judges the head tree against it. A `.guardrails.yaml` in the
pull request never takes effect for that run, `command:` and `args:`
included, so **a pull request cannot change the rules it is judged by, and
cannot choose the program that judges it, as long as that program is
self-contained** (see the directory rule below). The same ref is passed
down to every gate that supports it, so their contracts, configs and
baselines come from the base branch too.

**The program is checked as well as the rules.** Reading the rules from the
base ref is worth nothing if the pull request supplies the binary that
applies them, and without this it could, two ways that both look ordinary in
a diff: a base `command:` pointing at a path inside the repository, where the
head replaces the file behind the approved path; and no `command:` at all,
where a head-committed `node_modules/.bin/<gate>` shadows the real gate,
because resolution prefers the repository's own copy over PATH so that a
project pin beats a global install.

**On a pull-request run `node_modules/.bin` is not consulted at all.** That
second shape is closed one step earlier than the first, and this is why: what
is installed there is chosen by the head's own manifest and lockfile, so it is
never approved by any ref, and a repository whose gates are devDependencies
would otherwise meet the program refusal on every ordinary pull request. So
that location is simply not searched when a trust base is set. PATH and an
absolute `command:` remain, and both still go through the program check below.
The skip is never silent: one line in the full report and one
`conductor/node-modules-skipped` note in the SARIF log name each gate and the
copy that was not taken, and a gate with nothing on PATH either is
could-not-run with `npm install -g` and the Action's version input named as
the remedy. **Outside pull-request mode nothing changes**: your own checkout
and your pre-commit hook still run the pin, which is what `pnpm exec` does in
the same repository.

**The versions that judge a pull request are pinned in the workflow file**,
and that is the point: the pull request can change its own lockfile,
manifest and `node_modules`, and none of those decide which conductor and
which gates run over it any more. Be clear about what that does not cover.
On a `pull_request` event GitHub runs the workflow as it is in the pull
request's merge commit, so a pull request that edits the workflow file can
change the pins or remove the gates step, exactly as it could rewrite any
other step in your CI. The boundary here is against the tree choosing its
own judge; the control for a workflow edit is branch protection on your
base branch with review required for `.github/workflows`, and no action can
provide that for you. Only `pull_request_target` runs the base branch's copy
of a workflow, and that event exposes the base's secrets to the pull
request's code, which is the wrong trade for a gate over untrusted changes.

One part of that is closed, and only one. Because the pins are written in a
file the pull request controls, a pull request could otherwise pin a gate
**backward** to a published version that predates the rule which would have
caught it: an exact version, so the validate step's shape check accepts it,
and a change that reads as ordinary version management. **On a pull request
the action now refuses any of the four `*-version` inputs naming a version
below the one the action tag ships.** Pinning forward is still accepted.
See "The Action" below.

So on a pull-request run a gate's program must be **outside the working tree**
(on PATH, or an absolute `command:` elsewhere on the machine), or else meet
**both** of these:

- it is a **tracked regular file whose contents are identical** at the base
  ref and at the head commit; and
- **the tree object id of its containing directory is identical** at those
  two refs, which is to say the pull request changed nothing anywhere in that
  directory's subtree.

Both are compared with `git ls-tree` on both refs and never read from the
working tree. The second is not belt and braces. A vendored gate is rarely
one file: `vendor/vault-guard` execs `vendor/impl.sh`, and a pull request
that leaves the wrapper byte for byte alone and rewrites the helper beside it
passes a per-file check while running its own code. Comparing the directory
covers every file under it at once, without this tool having to know what a
wrapper calls.

**What is and is not vetted**, exactly: the program file and everything in
its directory subtree. Anything the program reaches **outside** that
directory is not vetted at all, so an in-repo gate must be **self-contained
within its own directory**. A program at the repository ROOT is refused, and
the message says to give it a directory: at the root the containing directory
is the whole repository, so the rule would mean "no pull request may change
anything".

A symlink inside the repository is refused on **its own entry**, before its
target is considered: it is either untracked, or its tree entry is a link
rather than a regular file, and either refuses. (A symlink whose own path is
outside the tree but which points into it has its target vetted; that is the
case following the link exists for.)

Anything else is could-not-run for that gate, naming the path, and it reaches
the exit code even where the policy sets `enforce: false`, because the gate
produced no findings to un-enforce: the umbrella declined to run a program
the pull request chose.

Nothing under `node_modules` is ever base-approved, which is why the rule
above does not look there at all. Were it to look, the answer would always be
the same refusal: what is there is chosen by the head's own manifest and
lockfile and installed by a step that runs before the gates, so git has no
record of those bytes at either ref. A pull request that edits its lockfile to
pull a different build of a gate has chosen its own judge just as surely as
one that commits a stub. **Vendoring a gate still works**, on those
terms: put it in its own directory, keep everything it needs inside that
directory, and leave the whole directory alone in a pull request the gate is
meant to judge. Changing it is not forbidden, it just has to land on the base
branch first, like any other rule change.

**A change to the rules is not refused, it is proposed.** Rules legitimately
change, and a gate that blocked every such pull request would train people to
bypass it. So a policy file that differs from the base ref's is reported as
one line, `policy changed in this pull request`, the run continues under the
base ref's rules, and the change takes effect **after merge**, on the first
run whose base branch carries it. The gates' own proposals are summed with it
into one sentence, `N control change(s) proposed in this pull request`, on the
one-line summary and on the verdict, with a line each under `--verbose` and a
`conductor/control-change-proposed` notification each in the SARIF log. A
reflow, a re-quote or an edited comment is not a proposal: the two files are
compared as parsed documents.

**An explicit `--trust-base` redirect gets a refusal on a pull request, at two
places (issue #58), and neither closes the whole hole by itself.**
`refuseTrustBaseRef` above only refuses a ref that resolves to HEAD's own
commit or to HEAD's own tree, which covers HEAD itself and an *unmoved*
`origin/<pr-branch>`. Once the base branch has moved, `origin/<pr-branch>` no
longer matches either test, so a same-repo pull request could set
`trust-base` to its own branch, in its own workflow file, and have conductor
read `.guardrails.yaml` from the pull request after all, at which point the
pull request controls the whole policy. dep-guard's own base input took the
stronger line for its base input in 0.8.0: on a `pull_request` event an
explicit value is refused outright.

**The Action refuses an explicit redirect on `pull_request` and
`pull_request_target` events.** Its validate step refuses a `trust-base`
input outright on those events, naming the value given and the fix, which is
to remove the input; see "The Action" below.

**The CLI check catches a misconfigured or innocent-looking redirect when
`GITHUB_BASE_REF` is set**, for anyone invoking the CLI directly in CI. When
that variable is set, an explicit `--trust-base` is accepted only when it
resolves to the same commit as `origin/$GITHUB_BASE_REF`, which is exactly
what the Action itself always passes, so an ordinary pull-request run is
unaffected. A ref naming the pull request's own branch, or anything else that
disagrees, is refused with both refs and both commits named, through the same
could-not-run path as every other trust-base refusal: exit 2, the report
leads with the reason, and nothing is checked. When `origin/$GITHUB_BASE_REF`
itself does not resolve, this fails closed too, naming it, for the same
reason the fetch-depth remedy below exists.

**Neither layer closes anything against a pull request that edits its own
workflow file.** A CLI invocation on a pull request can simply omit
`--trust-base`, or a workflow step can blank `GITHUB_BASE_REF` in its own env,
and nothing here refuses either; the Action has the matching gap, since a
pull request can pin `uses:` to a tag published before this fix, in its own
workflow file. This is exactly the boundary "On a pull request those four
inputs may not pin backward" (below, under "The Action") already draws for
the four `*-version` inputs: the control for a workflow edit is branch
protection on the base branch with review required for `.github/workflows`,
and nothing in this section, or in that one, substitutes for it.

**It fails closed.** A `--trust-base` that does not resolve is not a reason to
fall back to the pull request's own file, because that fallback is the hole:
the run exits 2 and the report **leads with the refusal**, naming the ref and
the remedy, whether or not it can name any gate. That last part matters: with
no base ref there is no base policy, so the only list of gates available is
the head's, and a head that switches every gate off leaves it empty. So is a
base ref that resolves to the head commit, or to a different commit carrying
the head's tree, both of which would put the rules back inside the tree being
judged while still reporting pull-request mode as on. Pass the base
**branch**, never a SHA: on a `pull_request` event `github.sha` is the merge
commit, which is HEAD. If the base branch has no `.guardrails.yaml` at all,
the run has no rules and exits 2 rather than using the pull request's; the
file the pull request adds decides what runs once it is on the base branch.

**One narrow exception to the equal-tree refusal (issue #69).** When a pull
request's net diff is empty -- a value committed and then backed out inside
the same pull request -- the merge ref GitHub builds has a tree
byte-identical to the base's, and the refusal above would stop
secrets-history from running on exactly the shape it exists to catch: the
value is gone from the tree but still in the history between the base and
HEAD. So the refusal makes one exception, and only one: when HEAD is a real
merge commit (two or more parents) and `--trust-base` resolves to HEAD's
**first** parent, the run is not refused. First-parent identity is the
discriminator, not ancestry, because GitHub always builds the merge ref with
the base branch as the first parent and the pull request's own head as the
second: a trust base resolving to HEAD's **second** parent is also an
ancestor and also carries the same tree, and it is exactly the ref this rule
must keep refusing. In the accepted shape the umbrella still does not judge
the unchanged tree as if it were the change: it runs every enabled gate
whose input is git history rather than the tree -- gitleaks today -- with its
ordinary arguments (already scoped to `<base>..HEAD`), and every other
enabled gate is reported as tree-unchanged rather than spawned: one line in
the full report, a clause on the one-line summary, and a
`conductor/tree-unchanged` notification in the SARIF log, never reaching the
exit code. Every other equal-tree shape -- a non-merge HEAD, the second
parent, any other ancestor -- keeps refusing exactly as before.

The exception needs HEAD's own parents, so it needs the same non-shallow
checkout the rest of pull-request mode already requires: `fetch-depth: 0`
(see below). On a depth-1 checkout git reports the merge commit with no
parents at all, so the first-parent check cannot match and the run keeps
refusing with the ordinary equal-tree message -- it fails closed rather than
guessing. That loss costs nothing real: at depth 1 gitleaks could not have
seen the backed-out commit either, since its own history scan has nothing
before HEAD to scope `<base>..HEAD` against.

That is why adopting conductor takes one merge before the gates can judge
anything, and it is not an oversight: the policy file can name a program to
run, so a run that read it from the pull request would let the pull request
choose its own judge on exactly the repositories that have no rules yet. See
"Adopting conductor" below for the sequence and for how to see what your
policy will do before you merge it.

**Which gates are covered.** All five: dep-guard from **0.6.0**,
intent-guard from **1.4.0**, vault-guard from **1.7.0**, and the two
external gates at their command-line floors, gitleaks **8.19.0** and
osv-scanner **2.0.0**.

**The external gates get their pull-request mode from the umbrella.**
Neither tool has a `--trust-base`, and both auto-load a config from the tree
they scan, which on a pull request is the head: a pull request could add an
allowlist entry for exactly the secret or advisory it introduces. So on a
pull-request run the umbrella reads `.gitleaks.toml` and `osv-scanner.toml`
from the base ref with `git show` and passes each tool that copy with
`--config`. When the base has none, the tool gets a neutral one (gitleaks'
built-in rules, an empty osv-scanner config) rather than nothing, because
nothing would let it find the head's file on its own. gitleaks'
`.gitleaksignore` is handled the same way, and because gitleaks also loads
the ignore file at the root of whatever it scans, the umbrella scans the
repository's git directory instead of the working tree on a pull request:
the same history, without the head's ignore file. A head-side change to any
of these files is reported as a proposal line and takes effect after merge,
exactly like a change to `.guardrails.yaml`. History is scoped to
`<base>..HEAD` on a pull request and to `HEAD` locally, so a secret on
another branch never reddens this one. Merge commits are scanned by their
first-parent diff, so a secret added inside a merge (while resolving a
conflict, say) is found; the same leak seen in a pull request's commit and
again in its merge is reported once, with the other commit listed.

A base `.gitleaks.toml` can name another file with `[extend] path`, which
gitleaks resolves against its working directory. On a pull request
conductor copies every file in that chain from the base ref into a
directory of its own and runs gitleaks from there, so the head's copy of an
extended file is never read; a head-side edit to one is a proposal, and an
extended file the base does not have makes the gate could-not-run, naming
it. gitleaks' log level is pinned at `info` and `log-level` is reserved,
because conductor reads gitleaks' error lines to tell a failed scan from a
clean one. Write the extend as a plain relative path in an `[extend]` table:
a base `.gitleaks.toml` whose extend target is a symbolic link, or which
writes the extend as an inline table or a quoted key, fails closed on every
pull request until it is rewritten that way.

**Local runs and `.gitattributes`.** On a pull request gitleaks scans the
repository's git directory, where the head's `.gitattributes` is not read.
A local run scans the working tree, so a file your own `.gitattributes`
marks `binary` is skipped by gitleaks there. Pull requests are not affected.

On a pull request gitleaks is also passed `--ignore-gitleaks-allow`, so an
inline `gitleaks:allow` comment does not hide a secret: an inline allow
lives in the tree being judged, so the pull request controls it. A
legitimate allow belongs in the base branch's `.gitleaks.toml` allowlist or
`.gitleaksignore`, both of which conductor already reads from the base.
Local runs keep inline allows.

osv-scanner is never pointed at a directory to walk, because its own walk
skips anything `.gitignore` matches, tracked or not, so one ignore line in a
pull request could hide a committed lockfile. conductor lists the tracked
lockfiles with `git ls-files` and hands each one over with `--lockfile`. On
a pull request that list comes from the head's index, not the base ref: the
lockfiles are the tree being judged, and adding or removing one is visible
in the diff. Only the root `osv-scanner.toml` is read from the base and
passed with `--config`, which overrides any nested one for the run; a
nested one the pull request adds or edits is reported as a proposal.

The umbrella asks each gate its version and passes the flag only to a build
that understands it, so an older gate is not handed a flag it would reject. A
gate that was not put into pull-request mode read its own rules out of the
tree being judged, which is the thing this exists to prevent, so it is never
silent: it gets a line in the report, a clause on the clean one-line summary,
and a `conductor/trust-base-not-passed` notification in the SARIF log. For a
gate that IS in the table, a version that cannot be read at all is
could-not-run rather than a quiet downgrade: the umbrella cannot establish
that the gate would take its rules from the base ref, and running it anyway
would put it outside the boundary on exactly the runs where something is
already wrong.

Outside pull-request mode nothing changes. A pre-commit hook and a direct run
on your own checkout are already inside the trust boundary, and neither passes
the flag.

## Intent at a pull request

The intent gate is the only one of the five with any ceremony: its native
flow wants a contract approved before the work starts, which is a per-task
human step. That step is exactly what a pull request cannot carry, so at the
`ci` stage the umbrella stands in for it.

**What it measures.** With `--base <ref>`, the changed-path set is what this
branch changed since it forked, from
`git diff --name-only --no-renames <base>...HEAD` in the repository root.

With no `--base`, `GITHUB_BASE_REF` is used as `origin/<value>` when it is
set, and the text report says so. With neither, the intent gate runs the way
it does at a commit: against the staged index, or the paths you name.

**This is why a local preview and a pull-request run can disagree about a
missing contract.** The contract-discovery rules below (`--spec`, a frozen
native contract, a `Spec:` line, the `docs/superpowers/specs` convention)
only engage once `--base` resolves to something, or `--spec` is given.
Neither is true of a plain `conductor run` on your own checkout, so a
repository with no contract gets intent-guard's own native answer instead:
`BLOCKING critical intent-guard/gate-blocked`, because that flow wants an
approved contract and none exists. On a pull request `--base` is set, this
whole section's machinery engages, and a branch with nothing to import
lands in the no-contract state below instead: reported, and never reaching
the exit code. Read a local `BLOCKING` line on the intent gate as "there is
no contract for the umbrella to import here yet," not as "this pull request
will fail."

A git failure here is **fail-closed**: could-not-run, so exit 2 for an
enforced gate and a note for an unenforced one. There is deliberately no
fallback to an empty path set, because an empty path set is what a passing
gate looks like. In Actions this is almost always a shallow checkout, so
**`actions/checkout` needs `fetch-depth: 0`** for the merge base to exist.

**Where the contract comes from**, in order:

1. `--spec <path>` on the umbrella's own command line. Typed just now, so it
   outranks everything, and a path here that is not on disk is reported
   rather than replaced: running a different contract than the one somebody
   named is the wrong kindness.
2. `<repo>/.intent-guard/intent-contract.yaml`, when it is **frozen**, and
   `<repo>/.conductor/intent-contract.yaml` after it. The native flow wins
   wherever a team has done it. Frozen is the test rather than present: an
   unfrozen contract is a draft somebody left behind, and running the gate
   against it fails every pull request on "not frozen by user" without
   checking anything.

   The second path is the directory intent-guard used before 1.3.0, which
   renamed it because `.conductor` had become the name of a different product
   in this family. Both are read, so a repository on either version is
   checked rather than blocked, and a run that used the old one says so: one
   line on the gate's contract line in the text report, and an
   `intent-guard/legacy-state-dir` notification in the SARIF log. If the
   repository holds **both** directories, the gate does not run and says so,
   naming both: that is the state intent-guard itself refuses every command
   in, so the umbrella refuses on exactly the gate's rule rather than a
   softer one. A `.conductor` holding nothing intent-guard wrote belongs to
   something else and is ignored.
3. The **first** `Spec: <path>` line in the pull request body, read from the
   event payload at `GITHUB_EVENT_PATH`. A path here that is not on disk, or
   one that leaves the repository, falls through to the next rule.
   `Spec: none` is a **waiver**: it says this pull request deliberately has
   no spec, so rule 4 is not tried and the gate reports itself skipped with
   `intent-guard/contract-waived` instead of `intent-guard/no-contract`. The
   token is exact and lowercase, a frozen contract at rule 2 still wins over
   it, and `--spec` at rule 1 still overrides it.
4. A markdown file **directly under** `docs/superpowers/specs` whose name
   relates to the branch. The branch slug is the branch name with its first
   segment (`feat/`, `fix/`) removed; a filename is reduced by stripping a
   `YYYY-MM-DD-` prefix and a trailing `-design`; the two are candidates when
   either contains the other. Several candidates are ranked: a stem **equal**
   to the slug first, then the **longest** stem, and only then the newest
   name, which is a lexical tie-break, so **date every spec**.

**A branch with neither** is a third state beside deferred and could-not-run:
the gate is switched on, it ran, and it had nothing to check. It gets one
line in the text report and one `intent-guard/no-contract` notification
in the `conductor` run, and it **never** reaches the exit code, enforced or
not. A branch with no spec is a branch this gate has no opinion about, and
turning that into a failed build is how a gate gets switched off across a
repository. A waived pull request lands in the same state and is reported
under its own `intent-guard/contract-waived` id, with its own wording on the
skipped line, in the verdict and on the one-line summary of a clean run, so a
reader can tell "nobody has written one" from "somebody decided against one"
wherever they meet it.

**A repository with no contract yet is not a repository this gate can act
on**, and the no-contract skip line names `docs/superpowers/specs`, which is
a convention from this family's own tooling and not one an outside adopter
has reason to recognise. The next step, if you want this gate to have an
opinion here, is the one intent-guard's own documentation describes: draft a
contract naming the paths worth protecting, then freeze it, and keep the
frozen file committed so rule 2 above finds it on every pull request from
then on. Until you do that, a project rule that lives only in `AGENTS.md`
never blocks anything through this gate. intent-guard does read prose rules
files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, cursor rules) as constraint
sources, but by its own design a constraint from that source is advisory
and leaves the exit code alone; only a user-stated constraint, or one
promoted with `intent-guard correct --promote`, can block. Conductor itself
never opens that file. What is enforced is the frozen contract or the
imported spec, never project convention documented in prose.

**A waiver is a decision, recorded by whoever wrote the pull request body,
and that includes a contributor from a fork.** On the ordinary path, where a
repository has no frozen contract of its own, `Spec: none` means the intent
gate does not run at all on that pull request, and budget breaches are the
thing this gate blocks on. The one thing a waiver cannot override is a frozen
native contract, under either of the two paths above, which is checked first:
a repository that wants the gate to be non-waivable freezes a native contract
and keeps it committed.

**What blocks is unchanged.** Blocking stays where intent-guard puts it:
budget breaches block, subject to `enforce`. Drift on its own is reported and
not blocked, which is already intent-guard's own behaviour. The umbrella adds
no severity threshold of its own here either, and intent-guard 1.7.0's own
advance-notice warnings about an unmatchable `protected_paths` or
`allowed_paths` entry never reach the exit code either, right up until the
2.0.0 release where intent-guard turns that same shape into a blocking
reason. Where they print depends on how much of the report is showing: as a
note under the intent gate in the full report (`--verbose`, a non-clean run,
or the pull-request comment, which the Action always renders with
`--verbose`), and, on an otherwise-clean run with neither, counted without
their text in the one-line summary's own note count instead.

**A prose-sourced constraint finding is never marked blocking, even when the
run blocks for an unrelated reason.** intent-guard 1.6.0 caps a constraint
whose source is one of those same prose rules files at advisory: a strong
match is still reported, but it never raises the gate's own exit code. A run
that blocks on scope creep alone still carries that capped finding in its
report, and it is rendered as a non-blocking, lower-severity line in the text
report and with `properties.blocking: false` in SARIF, rather than inheriting
the run's own blocking flag the way every other drift finding does.

## The Action

`action.yml` at the root is a composite action that runs the gates at the
`ci` stage and writes one SARIF log for the caller to upload.

It **installs all four packages itself**, and outside the workspace. Until
0.4.0 it installed nothing and ran the `node_modules/.bin/conductor` your
repository already had, which put every program in the family inside the tree
under judgment: the install step runs the head's lockfile, so a pull request
could repoint any gate, or the umbrella itself, at a build it controls while
leaving the version number alone.

Now four inputs name exact versions, `conductor-version`,
`dep-guard-version`, `vault-guard-version` and `intent-guard-version`, each
defaulting to the version this release pins. A validate step refuses anything
that is not an exact version, a range and `latest` included: the version that
judges a pull request has to be a decision taken on the base branch rather
than one the registry takes on the morning of the run. An install step then
runs `npm install -g --ignore-scripts` under the runner temp, never into the
workspace, and prepends that bin directory to `PATH`, so the run step invokes
`conductor` off `PATH` and each gate resolves by name the same way. The install
is **unconditional**, on push and `pull_request` alike, so there is one code
path rather than one that matters and one that nobody exercises.

**On a pull request those four inputs may not pin backward.** The shape check
asks whether an input is an exact version; it says nothing about which one, and
on a `pull_request` event the workflow file comes from the head, so the pins are
written by the pull request being judged. Once a gate has two published versions
that is a bypass with an innocent shape: pin back to the release that predates
the rule which would have caught the change, and the change picks the rules it
is judged by. So where `GITHUB_BASE_REF` is set, the validate step refuses an
input naming a version below the one the action tag ships, naming both numbers,
and the fix is to **remove the input**: the default is that version. Pinning
**forward** is still accepted, on an assumption the rule does not enforce, that
a newer gate is at least as strict; nothing bounds how far forward you pin.

Three things follow from that, stated because the summary is wider than the rule.
It fires on fork pull requests too, where the base repository's workflow file is
the one that runs, so a deliberate backward pin you wrote yourself will refuse
every fork run until you remove it. Push runs are out of scope rather than safe:
a push to an unprotected branch runs that branch's own workflow file, written by
the same author. And `merge_group` runs are not covered at all: `GITHUB_BASE_REF`
is set on `pull_request` and `pull_request_target` only, so it is empty in a
merge queue even though the queue branch carries the pull request's commits and
its workflow file. If your only required check runs on `merge_group`, this rule
does nothing for you; keep the `pull_request` run required as well and the pin is
caught before the queue. Neither this nor anything else in `action.yml`
replaces branch protection with review required for `.github/workflows`, which
is still the only control over a pull request that edits the workflow.

`--ignore-scripts` is there because the step holds the job's token and the four
things it installs decide whether a pull request may merge; without it every
package in the resolved tree would run code on the runner. The step then runs
`npm audit signatures` over what it installed.

**What that verification proves, and what it does not.** It asks the registry
for each name and version in the tree, the four gates included, and checks the
signature served back, so an unpublished, replaced or unsigned package fails the
step. It does **not** read the installed files, so it will not detect a tampered
install; it does **not** defeat a compromised registry, which signs what it
serves; and a **missing** attestation is not a failure, so it does not require
provenance even though all four packages publish it.

> **This step needs a registry that serves `/-/npm/v1/keys`.** If your runner
> points npm at a mirror or proxy that does not (via `actions/setup-node`'s
> `registry-url:`, a corporate `~/.npmrc`, or `npm_config_registry`), the
> install succeeds and this step then fails with `EMISSINGSIGNATUREKEY`. A
> sigstore outage has the same effect. The audit is retried once after a short
> pause before the step fails, to absorb a one-off registry hiccup. It fails
> closed on purpose, so that is a red gate rather than a skipped check; pin to
> `@v0.4.0`, which does not verify, if it blocks you.

`--base` is passed only when the `base-ref` input names one; left empty, the
umbrella reads `GITHUB_BASE_REF` itself and treats an empty value as "not a
pull request", which is what a push build wants.

On a `pull_request` event the action passes
**`--trust-base origin/$GITHUB_BASE_REF`** of its own accord, so the run takes
its configuration from the base branch and the pull request cannot change the
rules it is judged by; a change to the rules shows as a proposal line and
takes effect after merge. See "The pull-request trust boundary" above. On any
other event it passes nothing and behaviour is unchanged. The `trust-base`
input names the ref explicitly, for a platform where `GITHUB_BASE_REF` is not
set. **On a `pull_request` or `pull_request_target` event this input is
refused outright, in the validate step** (issue #58). On `pull_request` the
workflow file is the pull request's own, so a value here that redirects the
trust base is settable by the thing it judges; on `pull_request_target` the
workflow file is the *base* branch's own instead, but the input is refused
there too, because pull-request mode already derives the trust base on both
events and an explicit redirect has no legitimate use on either. The refusal
names the value that was given and the fix, which is to remove the input: the
action already derives `origin/$GITHUB_BASE_REF` itself on that event.

There is deliberately **no input that turns pull-request mode off**.
Base-ref judging is the floor rather than a knob, and on a `pull_request`
event the workflow file itself runs from the pull request's own ref, so an
opt-out here would be settable by the very pull request the mode exists to
judge: the knob and the thing it protects against would be the same file.

**The normal way to use this is by tag, not by path.** `uses: ./` reads
`action.yml` out of whichever tree the workflow runs against, which is
correct only for this repository's own workflows testing themselves; on a
pull request from anywhere else it would read `action.yml` out of the pull
request being judged, and the version-pin protection described above
"protects nothing" against a tree that controls its own judge (the
validate step's own comment in `action.yml` says so in those words). Name
this action by owner and tag instead:

```yaml
name: guardrails
on: pull_request

jobs:
  gates:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          node-version: '22.11.0'
      - id: conductor
        uses: vaultcompasshq/conductor@v0.6.1
        with:
          output: conductor.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        continue-on-error: true
        with:
          sarif_file: ${{ steps.conductor.outputs.sarif }}
```

No version inputs there at all: left out, the four gates run at the versions
this tag ships, which is the intended default. The fully spelled-out example
below adds explicit version pins and comments explaining each one, for a
workflow that wants that transparency; the four lines can still be left out
entirely to take the tag's own versions, exactly as the form above does.

```yaml
name: guardrails
on: pull_request

jobs:
  gates:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v7
        with:
          # Required, for two reasons now. Without it there is no merge base
          # to diff against, and the intent gate fails closed rather than
          # checking an empty set. And the base ref itself has to be in the
          # clone, because on a pull request the rules are read from it: a
          # base ref that will not resolve is exit 2 for every enabled gate.
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v7
        with:
          # Not a bare major: Node 22.0.0 ships npm 10.5.1, which the action
          # refuses because that client reports a clean install as tampered
          # with. 22.1.0 or later, or 20.13.0 or later, carries an npm that
          # can verify.
          node-version: '22.11.0'
          cache: pnpm
      # Your own dependencies. The gates are NOT among the things this has to
      # install: the action installs those itself, globally, at the versions
      # pinned below.
      - run: pnpm install --frozen-lockfile
      - id: conductor
        uses: vaultcompasshq/conductor@v0.6.1
        with:
          output: conductor.sarif
          # Exact versions, never a range and never "latest". These four
          # lines decide which programs judge a pull request, so a pull
          # request's own lockfile no longer does. They are only as protected
          # as this file is: require review on .github/workflows in your
          # branch protection. Bump them like any other pin, in a pull
          # request of their own. Forward only on a pull request: the action
          # refuses a pin below what its tag ships, and the four lines can be
          # left out entirely to take that tag's own versions.
          conductor-version: 0.6.0
          dep-guard-version: 0.9.0
          vault-guard-version: 1.8.0
          intent-guard-version: 1.7.0
      - uses: github/codeql-action/upload-sarif@v3
        # Always: the log is most worth having on the run that failed.
        if: always()
        # The sarif path is published BEFORE the gates run, so on the exit 2
        # cases that fail before anything is written (a policy error, an
        # unknown stage, an unwritable output path) it names a file that was
        # never created. Publishing early is the right trade for the common
        # case, which is exit 1 with a real log; this step just has to
        # tolerate the file being missing rather than failing the job a second
        # time over it.
        continue-on-error: true
        with:
          sarif_file: ${{ steps.conductor.outputs.sarif }}
```

**The two external gates are installed by your workflow, not by the
Action.** The Action still installs exactly its four npm packages and has no
input for gitleaks or osv-scanner; conductor downloads, pins and checksums
no third-party binary. If the policy enables `secrets-history` or
`vulnerabilities`, add a step before the conductor step that puts both tools
on `PATH`, pinned by version and checked against the release's own
checksum, the same way you would for a standalone security job:

```yaml
      - name: Install gitleaks and osv-scanner
        run: |
          set -euo pipefail
          bin="$RUNNER_TEMP/external-gates"
          mkdir -p "$bin"
          cd "$RUNNER_TEMP"
          curl -sSLO https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz
          echo "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  gitleaks_8.30.1_linux_x64.tar.gz" | sha256sum -c -
          tar -xzf gitleaks_8.30.1_linux_x64.tar.gz -C "$bin" gitleaks
          curl -sSL -o "$bin/osv-scanner" https://github.com/google/osv-scanner/releases/download/v2.6.0/osv-scanner_linux_amd64
          echo "ca69b3d3cd08f889a49dc0a383122f71cc528b83803671df5fd874d97485b108  $bin/osv-scanner" | sha256sum -c -
          chmod +x "$bin/osv-scanner"
          echo "$bin" >> "$GITHUB_PATH"
```

`fetch-depth: 0` on the checkout matters more with gitleaks enabled: on a
pull request conductor scans `<base>..HEAD`, and a base that was never
fetched is a git error gitleaks itself would report as a clean scan of
nothing. conductor reads that error off gitleaks' log and reports the gate
as could-not-run instead. A missing tool is could-not-run as well, with the
install step named in the report.

The `@v4` pins there are readable, not safe: a tag moves, so pinning by one
runs whatever its author pushes to it next. Pin every third-party action by
commit digest in a workflow you actually run, the way this repository's own
workflows do.

### Running the gates as an advisory check

To run the gates without blocking a merge, set `advisory: true` on the
`conductor` step and leave the check not required in branch protection.
`advisory: true` maps a blocking finding to exit 0, so it never fails this
run; a gate that **could not run** is unaffected and still exits 2, so a
crashed install or a missing policy on the base ref still shows red rather
than a silent green. That distinction is why the recipe below carries no
`continue-on-error` anywhere: an earlier version of this recipe put
`continue-on-error: true` on every step, including the umbrella's own, and a
transient `npm audit signatures` failure then read as nothing wrong for two
days (issue #36) because the step's exit code was swallowed regardless of
which of the two reasons produced it. `advisory` fixes the failure that
caused that; `continue-on-error` is the thing that let it happen, so the two
do not belong in the same recipe. Set a step `timeout-minutes` as well: the
Action already caps each gate's own subprocess at 120 seconds and reports one
that exceeds it as could-not-run, so the timeout is an outer bound around the
whole run rather than the primary control.

A complete copy-paste job, rather than the one step above in isolation:

```yaml
name: guardrails-advisory
on: pull_request

jobs:
  gates:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          node-version: '22.11.0'
      - id: conductor
        timeout-minutes: 5
        uses: vaultcompasshq/conductor@v0.6.1
        with:
          pr-comment: true
          advisory: true
```

`action.yml` already shallow-fetches the trust base itself as of 0.4.5 when
the checkout does not already carry it (see the changelog entry for that
version), so this recipe needs no separate "fetch the base ref" step. None of
the three steps above swallows its own exit code: a checkout or setup-node
failure is an infrastructure problem this recipe should still surface, and
the `conductor` step's own advisory behaviour comes from `advisory: true`
rather than from hiding a failing step, for the reason above. `pr-comment:
true` is what makes the advisory finding visible at all: a `pull_request`
check that is not required posts nothing anywhere else a developer would
look, so without it the run's only trace is a step that exited 0 and nobody
opens. See "The report as a pull request comment" below for what that input
needs and what it does on a fork.

`advisory` changes the umbrella's own process exit code only: it does not
reach the SARIF log, so a GitHub Code Scanning tab shows the same results and
the same alerts either way, and Code Scanning's own merge protection can
still block on them regardless of what this step's exit code says. `advisory`
is also an input on the `conductor` step, which means it is read from the
pull request's own workflow file on a same-repo `pull_request` event, the
same as every other input this Action takes; that gives a pull request
author nothing they could not already do by editing the workflow to add
`continue-on-error` themselves, and the control for that, as for any workflow
edit, is branch protection requiring review on `.github/workflows`, not
anything in `action.yml`.

**A `paths:` filter on this job is a real trade, not a free speedup, and the
honest default is to skip it.** The biggest reason is not about coverage, it
is about merging at all: `paths:` applies to the workflow's own trigger, and
a required check whose workflow a `paths:` filter kept from running is
reported as never having run at all, not as passed. That check then sits
**pending**, and a pull request cannot merge while a required check is
pending, regardless of how trivial the change is. GitHub's own documentation
describes exactly this failure mode for a required, `paths:`-filtered
workflow, and its usual workaround: a job that always runs, regardless of
what changed, and reports success or failure on its own rather than relying
on the whole workflow being skipped or not.

The coverage cost is real too, separately from the merge-blocking one. Every
gate in the default policy reads the whole changed set, not a slice of it:
gitleaks scans git history, so a secret can land in any file regardless of
what kind of pull request carries it; vault-guard's own staged scan is the
same, over whatever paths changed; dep-guard and osv-scanner only care about
manifests and lockfiles, but they still need to see a pull request touch one
to react to it; and intent-guard's drift and budget checks are evaluated
against every changed path, not only source. A `paths:` filter keyed on
`package.json`, the lockfile, and your source globs is exactly right for
dep-guard and osv-scanner and exactly wrong for the two secrets gates: it
makes a docs-only pull request skip the whole job, gitleaks and vault-guard
included, which means a secret pasted into a docs-only change, a comment, or
a config file the filter did not list is never scanned at all. That is the
cost, plainly: fewer runs bought by turning off secrets scanning on the pull
requests the filter excludes.

If your workflow already has its own required security job and you only
want this one to skip clean docs-only changes, add GitHub's own `paths:`
(or `paths-ignore:`) to the `on: pull_request` block, the same syntax GitHub
documents for any workflow trigger, and account for both traps above before
you make the job required: the pull requests it would leave permanently
pending, and the coverage this recipe would then lose on exactly the pull
requests it skips. The alternative this README recommends is to leave
the job triggering on every pull request: a run with nothing to report is
not a run worth avoiding, and this recipe has no documented time budget to
promise you here, because that number depends on your repository's size and
the gates you enable, not on anything conductor fixes. Measure it once on
your own repository if you need a number to plan around.

**Renaming the job changes what branch protection is watching for.** GitHub
matches a required check by its context, which is the JOB's name (`gates`
here), never the workflow's name (`guardrails-advisory`). If you split this
into a paths-filtered job with a different name, or rename the job for any
other reason, a pull request that no longer produces the old context name
will sit waiting on a check that will never report, until you also update
the required-checks list in
the branch protection ruleset to match. That edit lives on the repository's
settings, not in the workflow file, so it is easy to make the workflow
change and forget the other half.

### Adopting conductor

See "Adopting conductor" near the top of this README for the ordered
walkthrough: init, a first pull request in advisory mode, merge, then go
required. This subsection is the mechanism behind two of those steps.

**Why the first pull request still exits 2 under `advisory: true`.**
`advisory: true` maps a blocking **finding** to exit 0; it has no opinion
about a run that never had a policy to be judged by. The pull request that
first adds `.guardrails.yaml` is judged against the base branch, which has
none yet, so the run is refused outright before any gate produces a finding
for `advisory` to act on. Leaving the check out of branch protection for
that one pull request is what keeps the expected exit 2 from blocking the
merge; the step posts a comment naming the ref and the remedy.

**Why "go required" means the job's own context, never the SARIF-upload
row.** The recipes above upload conductor's SARIF log with
`github/codeql-action/upload-sarif`, which can add its own code-scanning
check to a pull request's checks list alongside the workflow job's own
check. Branch protection's required-checks picker can then show both. Only
the job's own context (`gates` in the recipes above, the job key, not any
step name) carries conductor's actual exit code; a code-scanning check can
read green from an old scan, or from `continue-on-error` on the upload step
itself, independent of whether the gates step passed. Require the job.

### The report as a pull request comment

**Built in, opt-in.** This matters most for an advisory job: a `pull_request`
check that is not marked required does not block anything when it fails, and
without a comment its findings live only in the job's exit code and log,
which teaches a developer nothing. Set `pr-comment: true` on the Action's own
step and add `pull-requests: write` to the job's `permissions`:

```yaml
    permissions:
      contents: read
      security-events: write
      pull-requests: write
    steps:
      # ... checkout, pnpm, setup-node, install, as in the example above ...
      - id: conductor
        uses: vaultcompasshq/conductor@v0.6.1
        with:
          output: conductor.sarif
          pr-comment: true
```

That posts conductor's own text report, the one the README quotes above
("conductor: clean, nothing blocked. 2 gate(s) ran: ..."), as a comment on
the pull request. It is **the report of the run that decided the job**: the
gates step asks that one run for the SARIF log and the text report together
(`--text-report`), and the comment step posts the file it wrote without
running the gates again. Before this the comment came from a second run, which
could disagree with the first whenever a gate's answer was time or network
dependent, and doubled the gate time on every pull request. An installed
`conductor-version` too old to have `--text-report` is detected by asking the
binary, and gets the second-run behaviour it always had, without a token. It is **sticky**: a hidden marker in the comment body lets
a re-run find and update that same comment, so a push does not pile up a new
comment every time, the way the manual recipe below does. It runs on a
`pull_request` or `pull_request_target` event only, and it runs whether the
gates step passed or failed, since a blocking run is the one an advisory
check most needs a developer to actually see. The first line of every
comment carries the version of conductor that produced it, the second line
carries the verdict token (see "The verdict token" above), and when the
trust base was refused and no gate ran at all, the comment shrinks to the
version, the verdict, and the refusal reason (with its remedy, when one
applies) rather than the full per-gate report, so an adopter with no policy
on the base ref yet does not get a full sticky comment whose only content is
"refused, nothing checked" on every push.

**It is a no-op on a pull request from a fork.** The default `GITHUB_TOKEN`
there is read-only regardless of the `pull-requests: write` permission you
grant, so the post fails; the step catches that, prints a `::warning::`
naming the likely cause, and continues. The gate's own pass/fail is decided
entirely by the earlier "Run the gates" step and never depends on whether
the comment posted, on a fork or anywhere else. `pull_request_target` runs
with a writable token and the base repository's own workflow instead, which
is a different security decision to take on purpose rather than a flag to
add; nothing here does that for you.

Off by default, so an existing consumer of this action is unaffected.

**The verdict, whether or not the comment is on.** The gates step reads the
token out of the text report its own run wrote and publishes it twice: as a
line on the job summary, `conductor verdict: advisory-blocked (1)`, and as the
Action's `verdict` output, spelled exactly as the report's second line spells
it (`steps.conductor.outputs.verdict`). It is flattened to one line before it
goes to either. It is a label for conductor's own exit decision, and the
step's exit status is conductor's own in every state. When the gate packages
could not be verified and no gate ran, the summary says
`conductor verdict: could-not-run (<reason>)` and the output is
`could-not-run`. The output is empty when the installed `conductor-version`
predates the token.

**The sticky match only ever adopts conductor's own comment.** On
`pull_request_target` this step runs with a write token even though the
pull request itself is untrusted, so anyone who can comment on the pull
request could, in principle, author a comment carrying the same hidden
marker before conductor's first run. The match requires the marker AND that
the comment was authored by the GitHub Actions bot; a marker in anyone
else's comment is never adopted, and conductor creates its own comment
instead, exactly as if no marked comment existed.

**Running this Action more than once against the same pull request** (for
example, once per package in a monorepo) needs its own marker per run, or
those runs fight over one shared comment. Set `pr-comment-marker` to a
distinct string per invocation and each run stays sticky to its own
comment; left unset (the default), every invocation uses the same built-in
marker, which is the existing, unchanged behaviour for a single invocation
per pull request.

```yaml
      - id: conductor-package-a
        uses: vaultcompasshq/conductor@v0.6.1
        with:
          pr-comment: true
          pr-comment-marker: 'package-a'
      - id: conductor-package-b
        uses: vaultcompasshq/conductor@v0.6.1
        with:
          pr-comment: true
          pr-comment-marker: 'package-b'
```

**A note for anyone changing this surface, not for a consumer of the
Action**: the comment body reaches `gh` with `-F body=@<file>` (`gh api`'s
file-read form), never `-f`, which sends the value as a literal string
instead of reading the file. The offline test suite
(`scripts/tests/pr-comment.test.mjs`, `scripts/tests/pr-comment-cli.test.mjs`)
replaces `gh` with a recorder or a shim, and neither can tell `-f` from `-F`
apart, since both simply accept a `key=value` string and neither actually
reads the `@file` form. `scripts/tests/pr-comment-smoke.test.mjs` is what
actually proves the distinction, against a real `gh` binary; it is skipped
by an ordinary offline `pnpm test` run and only runs with `GH_TOKEN` (or
`GITHUB_TOKEN`), `CONDUCTOR_PR_COMMENT_SMOKE_REPO`, and
`CONDUCTOR_PR_COMMENT_SMOKE_ISSUE` set. Run it for real against a scratch
issue or pull request before any release that touches
`scripts/lib/pr-comment.mjs` or `scripts/pr-comment.mjs`; the file itself
documents the exact invocation.

**The manual recipe below still has a reason to exist**: a non-sticky
comment (one per run, never edited), a report you want to post yourself with
different formatting, or a workflow that would rather not add
`pull-requests: write` to the same job the gates run in. For the common
case, `pr-comment: true` is the built-in answer.

The SARIF upload produces no alerts on a private repository without GitHub
Code Security, which is why that step carries `continue-on-error`. A comment
is free there. Add `pull-requests: write` to the job's `permissions` and this
step after the gates. It **runs the gates a second time**, because a run has
one format and the recipe below asks for text, so the job costs roughly twice
the gate time and the comment can in principle disagree with the first run;
the built-in `pr-comment: true` does not, since it posts the file the first
run wrote (`--text-report`). `--verbose` because a clean run otherwise
collapses to one line.

```yaml
      - name: Comment the report on the pull request
        # always: the report is most worth reading on the run that failed,
        # and the gates step has already failed the job by then.
        if: always()
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
          # The same derivation the Action makes for its own --trust-base.
          # github.base_ref is a BRANCH NAME and is empty outside a pull
          # request, so an empty value has to mean "not a pull request":
          # passing --trust-base unconditionally would hand a push build the
          # literal ref "origin/" and fail it closed.
          BASE: ${{ github.base_ref }}
        # || true: a blocking finding is a non-zero exit, and that verdict
        # belongs to the gates step rather than to this one.
        run: |
          ARGS=(run --stage ci --format text --verbose --output conductor.txt)
          if [ -n "$BASE" ]; then
            ARGS+=(--trust-base "origin/$BASE")
          fi
          conductor "${ARGS[@]}" || true
          gh pr comment "$PR" --body-file conductor.txt
```

`conductor` and not `node_modules/.bin/conductor`: the gates step put the
installed one on `PATH`. Reaching into `node_modules` here would report a
different program's verdict from the one in the uploaded log.

`--trust-base` for the same reason, and the two together are what make this
the run the uploaded log is about: same binary AND same trust base. Without
it this second run reads the head's own policy file, consults
`node_modules/.bin` like any local run, and never asks where a gate's program
came from, so a pull request that plants one gets a clean comment beside a
SARIF log that refused it.

**Mirror whatever you gave the Action**, or the two runs can report different
contracts, or different verdicts. The step above matches the example, which
passes neither `base-ref`, `trust-base`, `spec` nor `advisory`, so both runs
read `GITHUB_BASE_REF` and the `Spec:` line out of the job environment
themselves and land on the same contract and the same ref, and neither one
maps a blocking finding to exit 0. If you set any of those inputs on the
gates step, pass the same values here: `--base`, `--trust-base` and `--spec`
for the first three, and `--advisory` if you set `advisory: true`. Missing
one of the first three means the comment is a report of a contract source,
or of a boundary, the uploaded log never used; missing `--advisory` means the
comment's own verdict line reads "exit 1" underneath a gates step that just
exited 0, which is confusing in the opposite direction from silence.

**On a pull request from a fork the token is read-only**, so `gh pr comment`
fails, `continue-on-error` swallows the failure, and no comment appears on
exactly the pull requests a reviewer knows least about. Nothing here fixes
that: `pull_request_target` runs with a writable token and the base
repository's own workflow, which is a different security decision to take on
purpose rather than a flag to add.

This is a substitute for code-scanning alerts, not the same thing. A comment
is one snapshot of one run: no per-finding state, nothing to dismiss, no
history between runs, and a new comment every time rather than an alert that
closes when the finding goes away.

## What is in and what is out

In: the policy file and its schema, `init` with dry-run, revert, and adopt,
`run` producing the combined text report and a combined SARIF log, the
composed exit code, per-gate `stage` and `enforce`, `run --stage`, the intent
gate at a pull request (`--base`, `--spec`, the imported contract, the
no-contract advisory), the two external gates (gitleaks over git history and
osv-scanner over the dependency tree, run from `PATH`, their config read
from the base ref on a pull request), and the composite Action.

Out, deliberately: a unified baseline or ledger (each gate keeps its own, and
their fingerprints are not equally durable, so one shared file would expire
entries silently for one product and not another), an MCP registration,
running the gates concurrently, downloading or pinning any third-party
binary (the adopter installs gitleaks and osv-scanner), and any finding of
the umbrella's own about
anybody's CODE. The findings it does raise are all about the gates
themselves: `conductor/gate-missing`, `conductor/gate-output-unparseable`
and `conductor/gate-failed`, plus the two diagnostics
`conductor/blocking-count-mismatch` and
`conductor/blocking-threshold-unknown`.

Also out: intent at the cohesion level, which is what a merge or a
promotion would want and which the audits do by hand today; and anything that
runs inside an agent session or on save, which intent-guard's own optional
session hooks already cover.

This is a young tool rather than a finished one. The gates are still the
product, two of them are not this family's, and this is the layer that
makes them one required check.

## Design notes

The reasoning behind the decisions above lives in
[docs/design-notes.md](docs/design-notes.md): the digest ladder that lets a
re-install replace an older hook, how husky and lefthook are recognised and
why one of them is refused, what the hook says on each exit code, why a clean
report collapses to one line, the rule separating a SARIF notification from a
SARIF result, how the exit code is composed, and the mechanism behind the
intent gate at a pull request. Several of them were learned from running this
tool against real repositories rather than reasoned out in advance.

Adopter feedback is a row in [FINDINGS.md](FINDINGS.md). How to change this repository is in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. Built by [Vault & Compass](https://vaultcompass.io).
