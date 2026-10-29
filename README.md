# conductor

conductor is the one required check for a repository an AI agent edits. It
runs the scanners a maintainer already trusts beside the three family
gates, which check what those scanners do not: a hallucinated package name,
a credential caught before the edit lands, a pull request that edits its
own gate, a change that reaches outside what was approved for it.

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

## Quick start

Install the umbrella and the three gates, look at what init would write, then
write it with one pre-commit hook:

```sh
npm install -g @vaultcompass/conductor @vaultcompass/dep-guard @vaultcompass/vault-guard @vaultcompass/intent-guard
conductor init --dry-run   # prints every file it would write, writes nothing
conductor init --hook      # writes .guardrails.yaml and one pre-commit hook
```

The hook runs every enabled gate on each commit and, when the commit is
clean, prints one summary line, plus one status line per gate on stderr.
Each gate can also be installed and run on its own.

Then the same gates on every pull request, as one pinned workflow:

```yaml
name: guardrails
on: [pull_request, push]
permissions:
  contents: read
  security-events: write
jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
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
      - uses: vaultcompasshq/conductor@be3f33defcca091c403af6d2dc6e377ef5b94af7 # v0.16.0
      - uses: github/codeql-action/upload-sarif@v4
        if: always()
        with:
          sarif_file: conductor.sarif
```

One pin, not five: the action tag decides which version of each of the four
npm packages is installed. The install step for gitleaks and osv-scanner is
needed when the policy enables the secrets-history and vulnerabilities gates,
and it pins both by version and checksum. On a pull request every gate reads
its rules from the base branch, so a change cannot turn off the check that
exists to catch it. The first pull request under a new policy cannot be judged
by that policy, so read the careful path below before you make the check
required.

## Part of the Vault & Compass guardrails

<!-- guardrails-family: shared block, keep it identical in dep-guard, vault-guard, intent-guard and conductor -->
The Vault & Compass guardrails are three gates over an AI-assisted coding
session, plus an optional umbrella: [dep-guard](https://www.npmjs.com/package/@vaultcompass/dep-guard)
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

## Adopting conductor: the careful path

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
   run changed, but under the Action keep it at the Action's pin or a push
   run is could-not-run (see "The Action" below). It is not what gates
   your pull requests: on a pull-request
   run the umbrella never looks in `node_modules/.bin` at all, because what
   is installed there is chosen by the head's own manifest and lockfile. The
   Action installs all four packages itself, globally, at versions pinned in
   your workflow file. See
   [The pull-request trust boundary](docs/pull-request-trust-boundary.md) and
   [The Action](#the-action) below.

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
   file alike. That path is specific to your checkout, so do not commit the
   file: init appends `.guardrails/` to `.gitignore` when git does not already
   ignore it, and prints the line instead when it cannot append safely. The file
   lives inside your working tree so `--revert` can find it later, and
   recording repo-relative paths there instead of absolute ones is a known
   gap, not a design; it has not been fixed yet.

   Commit something, now that `--hook` above has installed the pre-commit
   hook (this walkthrough's output below only appears when the hook is
   installed; a bare `conductor init` with no `--hook` runs no gate on
   commit at all). A clean commit prints one summary line on stdout:

   ```
   conductor: clean, nothing blocked. 2 gate(s) ran: dependencies (dep-guard), secrets (vault-guard). Deferred to a later stage: intent (intent-guard) from stage ci. 0 gate(s) left out by --gate. 0 gate(s) not enforced. 1 note(s). 0 suppressed across all gates. Re-run with --verbose for the full report.
   ```

   The line names every disposition a gate can have on that run, with its
   count, even when the count is zero: ran, deferred to a later stage, left
   out by `--gate`, not enforced, and suppressed findings. Which gates appear
   in each depends on your policy file.

   Your terminal also shows one status line per gate, written to stderr so a
   CI job log has a per-gate record even when the report goes to a file,
   such as `conductor: gate dependencies (dep-guard 0.18.0): ok, exit 0` or
   a `skipped (deferred to stage ci)` line for a deferred gate. They carry
   nothing the summary does not; to see only the summary, redirect stderr
   (`conductor run --staged --stage commit 2>/dev/null` in the hook).

   A commit with a staged credential in it prints the full report and exits 1:

   ```
   conductor 0.16.0
   verdict-token: blocked (1)
   conductor run: 2 gate(s), 1 finding(s)

   dependencies  dep-guard 0.18.0  exit 0  153ms  via dep-guard on path
     threshold medium   suppressed 0   ignored 0
     mode staged   corpusBuiltAt 2026-09-20T06:16:40.340Z   lockfileFormat npm   online false   lookups 0   skipped-by-deadline 0

   secrets  vault-guard 1.13.0  exit 1  105ms  via vault-guard on path
     BLOCKING  critical  vault-guard/anthropic  jest.config.mjs:14:12
         Possible secret of type 'anthropic'
     threshold medium   suppressed 0   ignored not reported
     filesScanned 1   patternsActive 59

     deferred  intent  intent-guard  did not run here; it runs from stage ci onwards

   verdict: exit 1, 1 blocking finding(s) in 1 of 2 enforced gate(s).
   ```

   The `mode`, `corpusBuiltAt`, `lockfileFormat`, `online`, `lookups` and
   `skipped-by-deadline` line under
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
   See [Intent at a pull request](docs/intent-at-a-pull-request.md) for the
   full mechanism.

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
   honest report of an unfinished adoption, not a broken tool. The same
   refusal recurs once on every new base branch; see "Why the first pull
   request still exits 2 under `advisory: true`" below.

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

## Adoption ramp

A repository with history will not start clean, and a gate that is red on its
first pull request gets switched off. The order that works:

1. **Advisory first.** The first pull request runs with `advisory: true` and
   `pr-comment: true`, as in "Adopting conductor: the careful path" above. Findings print and
   are commented, and none of them fails the run.

2. **Record what is already there, in each gate's own file.** conductor does
   not write these and does not read them for the gates; each tool does.
   - vault-guard keeps its own baseline of accepted findings. See the
     [vault-guard documentation](https://github.com/vaultcompasshq/vault-guard)
     for the file and how it is produced.
   - osv-scanner reads `osv-scanner.toml` for ignored advisories, each with a
     reason and an optional expiry. See the
     [osv-scanner configuration docs](https://google.github.io/osv-scanner/configuration/).
   - gitleaks reads `.gitleaks.toml` for rule tuning. Generic rules such as
     `generic-api-key` are the usual noise on test fixtures and doc
     placeholders; allowlist those paths there. See the
     [gitleaks documentation](https://github.com/gitleaks/gitleaks).

3. **Accept an old history finding.** A secret that is already in history and
   already rotated stays in every history scan. Put its fingerprint on its own
   line in a `.gitleaksignore` file at the repository root. gitleaks' own
   report carries the fingerprint, in the form `commit:path:rule:line`:

   ```
   0a1b2c3d4e5f60718293a4b5c6d7e8f901234567:docs/example.md:generic-api-key:12
   ```

   conductor reads `.gitleaksignore` from the base branch on a pull request,
   so adding the line takes effect after its own merge, like any other
   control change.

4. **Switch to enforce.** When a few ordinary pull requests report only what
   you expect, remove `advisory: true`, and set `enforce: true` on the gates
   you want to be able to refuse a merge. `conductor init` writes the intent
   gate with `enforce: false` and `require-frozen: false` until a contract is
   frozen, so a repository with no contract is not blocked by that gate.

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

## Reference

- The policy file: see [docs/policy-file.md](docs/policy-file.md).
- Commands, exit codes and the verdict token: see [docs/commands.md](docs/commands.md).
- The pull-request trust boundary: see [docs/pull-request-trust-boundary.md](docs/pull-request-trust-boundary.md).
- Intent at a pull request: see [docs/intent-at-a-pull-request.md](docs/intent-at-a-pull-request.md).
- Upgrading and the defaults per action tag: see [docs/upgrading.md](docs/upgrading.md).
- The Action recipes and inputs are the section [The Action](#the-action) below.

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
path rather than one that matters and one that nobody exercises. On a push
run, though, a repository's own devDependency on a gate in
`node_modules/.bin` outranks that install and shadows the action's pin. Since
0.13.0, when a gate's version differs from the pin, wherever it was found
(`node_modules/.bin`, `PATH` or a policy `command:`), conductor does not run
it: the gate is could-not-run, reason `version-skew`, and the run exits 2,
whatever the policy's `enforce` and whatever `advisory` say. It is named in
the job log, as a `::error::` annotation, in the step summary and in the
reports. A gate whose version cannot be read under the Action is
could-not-run too, reason `version-unverified`. The fix is to bump the
devDependency to the pin or remove it. A plain `conductor run` outside the
Action sets no pin and is unchanged.

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
> `45d2ecc2213244408495c22d0b8da1dc0f1ed288` (v0.4.0), which does not verify,
> if it blocks you.

`--base` is passed only when the `base-ref` input names one; left empty, the
umbrella reads `GITHUB_BASE_REF` itself and treats an empty value as "not a
pull request", which is what a push build wants.

On a `pull_request` event a dedicated step fetches the base branch into a
private ref and the action passes **`--trust-base <the fetched commit id>`**
of its own accord (the job needs `contents: read`; a failed fetch fails the job
rather than running without a trust base; the token exists only in that fetch
step and never in the gates), so the run takes
its configuration from the base branch and the pull request cannot change the
rules it is judged by; a change to the rules shows as a proposal line and
takes effect after merge. See
[The pull-request trust boundary](docs/pull-request-trust-boundary.md). On any
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
action already derives the private `refs/conductor/trust-base` itself on that
event.

There is deliberately **no input that turns pull-request mode off**.
Base-ref judging is the floor rather than a knob, and on a `pull_request`
event the workflow file itself runs from the pull request's own ref, so an
opt-out here would be settable by the very pull request the mode exists to
judge: the knob and the thing it protects against would be the same file.

**Pin the action by full commit SHA, with the version in a trailing comment, not by tag and not by path.** `uses: ./` reads
`action.yml` out of whichever tree the workflow runs against, which is
correct only for this repository's own workflows testing themselves; on a
pull request from anywhere else it would read `action.yml` out of the pull
request being judged, and the version-pin protection described above
"protects nothing" against a tree that controls its own judge (the
validate step's own comment in `action.yml` says so in those words). A tag
moves when someone pushes it. Name this action by owner and the full commit
SHA instead. The recipes in this README name v0.16.0 that way, as
`vaultcompasshq/conductor@be3f33defcca091c403af6d2dc6e377ef5b94af7 # v0.16.0`.

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
          # From 0.8.0 a shallow checkout on a pull-request run is
          # could-not-run for the history gate.
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          node-version: '22.23.4'
      - id: conductor
        uses: vaultcompasshq/conductor@be3f33defcca091c403af6d2dc6e377ef5b94af7 # v0.16.0
        with:
          output: conductor.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        continue-on-error: true
        with:
          sarif_file: ${{ steps.conductor.outputs.sarif }}
```

The job has `permissions: contents: read`. Add `pull-requests: write` only
where the recipe posts a comment. `security-events: write` is there because
the upload step publishes the SARIF log.

The examples leave the trigger unnarrowed on purpose, so the job runs for a
pull request into any branch. If you narrow it with a `branches:` filter,
include every branch whose merges reach users, release branches and the
production branch included, for instance `branches: [main, 'release/**',
production]`. The pull request that promotes a release is where a bad
dependency or a leaked secret actually ships, and a job that is not triggered
leaves no red check and no report to notice.

A job marked `continue-on-error` always concludes green, so a crash of the
action is invisible unless someone opens the log. A workflow triggered only
on pull requests to main never runs on a stacked pull request whose base is
another branch, and no comment on such a pull request does not mean clean.

Omit `conductor-version`. Left unset, the action installs the default in the
pinned `action.yml`, which is the version that commit ships, so the installed
umbrella follows the pin and a Dependabot bump is the one `uses` line. If the
input is set and is older than the constants in that pinned action.yml, a
pull request run is refused and the validate step says to remove the input. A
newer value is accepted and is what gets installed.

**Omit the three gate version inputs too, unless you need to pin a gate
forward** (issue 145). Each one then takes the default in the pinned
action.yml, so the defaults travel with the tag and a Dependabot or Renovate
bump of the `uses:` line moves the gates with it. Pinned by hand, they do
not move: after the bump `dep-guard-version`, `vault-guard-version` or
`intent-guard-version` sits below the new tag's defaults, a pull request
refuses a pin below them, and that bump's own pull request goes red with
nothing wrong in it. The fix is in the same pull request: raise each pinned
line to the new tag's default (the CHANGELOG entry for the tag lists them,
and so does the table in [Upgrading](docs/upgrading.md)), or delete it. The
spelled-out example below names them when a workflow wants that
transparency, and carries that cost.

**The gates the Action installs are as new as the tag** (issue 146). A
tag's defaults can reach npm the same day the tag does, so they can be
younger than the minimum release age dep-guard holds your own dependencies
to (7 days by default, a check that runs when dep-guard runs with
`--online`). The Action installs them itself, outside your
lockfile, so dep-guard does not see them. To run older gates, pin the action
ref to an older tag, whose defaults are older; pinning the version inputs
below the tag's own defaults is refused on a pull request, because a pull
request must not choose an older, weaker judge. A Dependabot `cooldown`
setting on the `github-actions` ecosystem delays the bump itself by the
same number of days.

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
          # Required. From 0.8.0 a shallow checkout on a pull-request run is
          # could-not-run for the history gate. Without a full history there
          # is no merge base to diff against, and the intent gate fails closed
          # rather than checking an empty set. And the base ref itself has to
          # be in the clone, because on a pull request the rules are read from
          # it: a base ref that will not resolve is exit 2 for every enabled
          # gate.
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          # Not a bare major: Node 22.0.0 ships npm 10.5.1, which the action
          # refuses because that client reports a clean install as tampered
          # with. 22.1.0 or later, or 20.13.0 or later, carries an npm that
          # can verify. 22.23.4 is the patched release this repository's own
          # release job pins after the 2026-10-21 Node security release; the
          # gates run over pull-request content under whatever Node you pick.
          node-version: '22.23.4'
      # NOTHING FROM THE PULL REQUEST RUNS BEFORE THE ACTION IN THIS JOB.
      # No `pnpm install`, `npm ci`, build or test step: an install runs the
      # repository's own lifecycle scripts (a root postinstall), and that code
      # could write the PATH the gates are resolved from, or the refs the
      # policy is read from, before the gates ever start. Your own
      # dependencies, build and tests belong in a separate job (see below).
      # The gates are not among the things that job has to install: the action
      # installs those itself, globally. Leave conductor-version unset so the
      # umbrella is the default in the pinned action.yml.
      - id: conductor
        uses: vaultcompasshq/conductor@be3f33defcca091c403af6d2dc6e377ef5b94af7 # v0.16.0
        with:
          output: conductor.sarif
          # Exact versions, never a range and never "latest". These three
          # lines decide which gate programs judge a pull request, so a pull
          # request's own lockfile no longer does. They are only as protected
          # as this file is: require review on .github/workflows in your
          # branch protection. Bump them like any other pin, in a pull
          # request of their own. On a pull request the action refuses a pin
          # below what the pinned action.yml ships, and the three lines can
          # be left out entirely to take that action's own versions.
          dep-guard-version: 0.18.0
          vault-guard-version: 1.13.0
          intent-guard-version: 1.10.3
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

  # Your own dependencies, build and tests: a different job, so the code they
  # run shares no runner, PATH or workspace with the gates.
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v7
        with:
          node-version: '22.23.4'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
```

**Run the gates in a job that runs no code from the pull request.** Do not
run `pnpm install`, `npm ci`, a build or a test step before the conductor
action in the same job, and do not put the action in a job whose earlier steps
run the repository's own scripts. Anything that runs first shares the runner
with the gates: it can write to `GITHUB_PATH`, to the runner's temp directory
where the action installs the gates, or to the git refs the base policy is
read from, and then it is the pull request choosing the program that judges
it. The action fetches the base branch into its own private ref and judges by
that, which closes a moved or tag-shadowed base ref and nothing else. Only
keeping pull-request code out of the job covers the rest: `GITHUB_ENV`
(`NODE_OPTIONS=--require`, `GIT_CONFIG_*`, `GIT_DIR`), `GITHUB_PATH`,
`.git/config` changes (a remote URL, `url.insteadOf`, `core.fsmonitor`,
credential helpers, `core.sshCommand`), git hooks such as
`reference-transaction`, and replace refs or grafts. Say it plainly:
package.json lifecycle scripts (`preinstall`, `install`, `postinstall`,
`prepare`) run by an install bypass "require review on `.github/workflows`",
because the pull request supplies them, not the workflow file. Branch
protection on the workflow directory does not stop them, so the gates must
not share a job with head code that runs first.

**With gitleaks enabled the checkout must be `fetch-depth: 0`.** From 0.8.0 a
shallow checkout on a pull-request run is could-not-run for the history gate,
naming `fetch-depth: 0` (exit 2, whatever `enforce` says). At the default
depth of 1 the checkout is shallow, the range from the base to HEAD holds one
grafted commit, and a secret added and then removed inside the pull request
would never be seen. conductor does not deepen the checkout for you.

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

`fetch-depth: 0` on the checkout is required with gitleaks enabled: on a
pull request conductor scans `<base>..HEAD`. At depth 1 the checkout is
shallow and that range holds a single commit, so a secret added and removed
inside the pull request would go unseen; conductor detects the shallow
checkout and reports the gate as could-not-run instead of scanning it. (A
base that was never fetched at all is a git error gitleaks itself would
report as a clean scan of nothing; conductor reads that error off gitleaks'
log and reports the gate as could-not-run too.) A missing tool is
could-not-run as well, with the install step named in the report.

The `@v4` pins there are readable, not safe: a tag moves, so pinning by one
runs whatever its author pushes to it next. Pin every third-party action by
commit digest in a workflow you actually run, the way this repository's own
workflows do.

### What a history scan costs

What the history gate reads depends on the event. On a pull request it is
`<base>..HEAD`, with first-parent diffs for merge commits; on a push, a
schedule or a local run it is every commit reachable from HEAD. So a pull
request's cost follows its own range, and a full run's cost follows the
whole history and the size of every blob ever committed. Separately,
`fetch-depth: 0` means the checkout fetches the whole history on every run,
whatever the scan range.

The time limit is per gate. The defaults are 120 seconds for the three
family gates, 600 for gitleaks and 300 for osv-scanner, and you change one
with `timeout-seconds` beside `enforce`; on a pull request it comes from the
base branch. Every spawn of a gate gets the full limit (the version probe,
the scan, the intent gate's preparation steps, osv-scanner's base run), so
a gate's wall time can be a multiple of it. A gate stopped at its limit is
could-not-run (`timed-out`), never a pass.

- The limit is a SIGTERM deadline. A gate that ignores SIGTERM keeps the run
  waiting until it exits on its own; conductor does not escalate to SIGKILL.
- A gate's own child processes are not stopped with it. A gate behind a
  shell-wrapper `command` can keep running after the report says
  `timed-out`.
- On a hosted runner the six-hour job limit includes checkout, setup and
  every other gate, so a limit near the 21600 ceiling is cancelled with the
  job before it can fire. Keep it well under.

Measure your own full scan once, on the runner it will run on, and set the
limit with headroom. The recommended split: every pull request scans its own
range, and the full history is scanned on a schedule with a limit sized for
it. Two existing ways to make it: by stage, since `secrets-history` defaults
to stage `ci` and a push workflow run with the Action's `stage: push` input
(or `conductor run --stage push`) leaves ci-stage gates out; or by trigger,
running the workflow on pull requests and a schedule and not on push. With
the CLI, `--gate secrets-history` on the scheduled job also works.

`max-target-megabytes`, passed under `options`, skips every file larger
than the cap. Measured with gitleaks 8.30.1 in the mode conductor runs, at
the log level conductor runs it at: a secret inside a file over the cap was
not reported, no line in gitleaks' log named the skipped file, and the scan
summary still reported the full byte count. It is a coverage decision, made
in the policy file where a reviewer can see it, and conductor never applies
it by default.

`options.timeout` on the secrets-history gate is gitleaks' own deadline,
not conductor's. A `conductor/option-is-gate-own` note says so: always in
the SARIF log, and in the text report under the gate header whenever the
full report is printed (with `--verbose`, or on any run that is not fully
clean; a clean run without `--verbose` prints only its one-line summary).
When it fires
gitleaks exits 1, whether or not it had found a leak, and the gate is
could-not-run. Leaks it found before the deadline are not listed as
findings; the echoed gitleaks log line ("N leaks found in partial scan") is
the only mention of them.

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
Action already caps each gate's own subprocess (by default 120 seconds for
the three family gates, 600 for gitleaks and 300 for osv-scanner, see the
time limits above) and reports one that exceeds it as could-not-run, so the
timeout is an outer bound around the whole run rather than the primary
control. It must not undercut those limits, because a step killed by its
own timeout has no verdict at all, where a gate stopped at its limit is
reported. Make it at least the sum of the enabled gates' limits plus 300
seconds for the preview under the proposed rules, which can use up to that
much on a pull request that changes a gate's `enabled` or `stage`, plus the
time the step spends installing the gates before any of them runs. With all
five gates at their defaults that is 1260 plus 300 seconds, 26 minutes,
before the install, so the recipe below says 30; raise it with any
`timeout-seconds` you raise. Check
out with `persist-credentials: false` so the gates never run with a token
left in the checkout's git config.

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
          # From 0.8.0 a shallow checkout on a pull-request run is
          # could-not-run for the history gate.
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: '22.23.4'
      - id: conductor
        # The enabled gates' own limits (all five at their defaults: 1260
        # seconds) plus 300 seconds for the preview, rounded up. A step
        # timeout below that can kill a full gitleaks scan and leave no verdict.
        timeout-minutes: 30
        uses: vaultcompasshq/conductor@be3f33defcca091c403af6d2dc6e377ef5b94af7 # v0.16.0
        with:
          pr-comment: true
          advisory: true
```

`action.yml` fetches the trust base itself on every pull-request run, into its
own private ref (depth 1 only when the checkout is already shallow, and always,
whether or not the checkout carries the base), so this recipe needs no separate
"fetch the base ref" step. None of
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

See "Adopting conductor: the careful path" near the top of this README for the ordered
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

The same refusal happens once on every new base branch, not only on the
default branch, because rules are read from whatever branch the pull request
targets. A release or release-candidate branch cut before the policy existed,
or any long-lived branch that has never received `.guardrails.yaml`, refuses
its first pull request the same way. There are two remedies. Carry the policy
onto the branch before opening a pull request against it; a sync from the
default branch does this. Or expect exactly one could-not-run run there, and
leave the check out of that branch's protection for that one pull request.

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
      # ... checkout and setup-node, as in the example above. Nothing from
      # the pull request runs before the action in this job: no install, build
      # or test step here; those belong in a separate job. ...
      - id: conductor
        uses: vaultcompasshq/conductor@be3f33defcca091c403af6d2dc6e377ef5b94af7 # v0.16.0
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
carries the verdict token (see [The verdict token](docs/commands.md#the-verdict-token)), and when the
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

**The poster runs the `node` and `gh` that were on `PATH` when the Action
started**, resolved by the Action's first step before any gate package is
installed, and never a binary from the gate install directory. The gate
install goes on `PATH` only after its signature audit passes. GitHub-hosted
runners carry both; on a runner that has neither on `PATH` at that point the
comment is skipped with a warning and the verdict is unaffected.

**Running this Action more than once against the same pull request** (for
example, once per package in a monorepo) needs its own marker per run, or
those runs fight over one shared comment. Set `pr-comment-marker` to a
distinct string per invocation and each run stays sticky to its own
comment; left unset (the default), every invocation uses the same built-in
marker, which is the existing, unchanged behaviour for a single invocation
per pull request.

```yaml
      - id: conductor-package-a
        uses: vaultcompasshq/conductor@be3f33defcca091c403af6d2dc6e377ef5b94af7 # v0.16.0
        with:
          pr-comment: true
          pr-comment-marker: 'package-a'
      - id: conductor-package-b
        uses: vaultcompasshq/conductor@be3f33defcca091c403af6d2dc6e377ef5b94af7 # v0.16.0
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
