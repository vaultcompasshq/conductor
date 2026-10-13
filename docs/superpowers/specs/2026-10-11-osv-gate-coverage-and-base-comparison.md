# osv gate: ecosystem coverage and base-vs-head comparison

Date: 2026-10-11
Status: reviewed three times; implemented on
feat/osv-coverage-and-base-comparison. Two points from the final review are
folded into 4.3 and test 17a below, and what the implementation found is in
"Deviations found during implementation" at the end.
Scope: conductor only. Plan items 1.1 (coverage, ruling Q1) and 1.3 (base
comparison, ruling Q2) of the 2026-10-11 dogfood plan.
Closes: F01 (Go and Python repositories get a false "nothing to scan") and
F02 (a pre-existing advisory backlog blocks every pull request).

## 1. Rulings this design implements (not reopened here)

- Q1. The vulnerabilities gate hands osv-scanner the lock formats listed in
  section 2.1 plus requirements files whose every requirement is pinned with
  `==`. A requirements file with any unpinned requirement is not scanned and
  is named on the coverage line with the reason. Matching stays by tracked
  basename.
- Q2. On a `--trust-base` run the gate also runs osv-scanner on the base
  copies of the same lockfiles, labels each head finding `introduced` or
  `present-on-base` by a stable fingerprint, reports both, and a gate-level
  policy key decides whether present-on-base findings block. A policy that
  lacks the key blocks on all of them. `conductor init` writes the key as
  introduced-only. A base that cannot be read means every finding counts as
  introduced.

Constraints (AGENTS.md; 2026-09-26 decisions 1, 2, 4): the umbrella scans
nothing, downloads nothing, never writes a gate's config, and could-not-run
stays red. The pin check (2.2) only selects what the tool is handed, like
the basename list today, and raises no finding of its own.

## 2. Item 1.1: what the gate hands over

### 2.1 File list

Observed against osv-scanner 2.4.0 on the design machine (`--lockfile` with
each file, and with the `type:path` parse-as form):

| tracked basename | handed as | note |
|---|---|---|
| package-lock.json, pnpm-lock.yaml, yarn.lock, bun.lock | bare path | unchanged |
| npm-shrinkwrap.json | bare path | unchanged; NOT a valid parse-as type in 2.4.0 ("could not determine extractor", exit 127) |
| go.mod | bare path | read as a lockfile, 2 packages from a one-require fixture |
| poetry.lock, Pipfile.lock, uv.lock, pdm.lock | bare path | recognised |
| Cargo.lock, Gemfile.lock, composer.lock, gradle.lockfile, packages.lock.json | bare path | recognised |
| requirements.txt | bare path, if it passes the pin check | |
| requirements variants (below) | `requirements.txt:<path>` | the parse-as form; a bare `requirements-dev.txt` is not recognised |

Reviewer measurements, recorded as facts: go.sum handed with `--lockfile`
exits 127 with "could not determine extractor"; the parse-as form
`npm-shrinkwrap.json:<path>` is unsupported while the bare path works; aliases
(PYSEC and GHSA) come back on both runs, so the comparison key is stable.

go.sum is NOT handed over. osv-scanner 2.4.0 rejects it outright ("could not
determine extractor suitable to this file", exit 127), which would make every
Go pull request could-not-run. The Q1 ruling's "go.sum as osv needs" is met by
handing go.mod, which is what osv reads for Go. go.sum stays in the coverage
line from item 1.2 as "read through go.mod".

Requirements variants, matched on basename only:
`requirements.txt`, `/^requirements[-_.][A-Za-z0-9._-]+\.txt$/`
(requirements-dev.txt, requirements_test.txt, requirements.prod.txt) and
`/^[A-Za-z0-9._-]+[-_]requirements\.txt$/` (dev-requirements.txt). Not
matched: requirements.in (pip-tools input, unpinned by design), constraints
files, pyproject.toml, and `.txt` files under a `requirements/` directory
whose basename does not match (open question 4).

A path with a colon handed bare is split by osv-scanner and exits 127
(measured), a fail-closed limit that exists today; the parse-as form splits
on the first colon only, so requirements variants are unaffected.

Code: `OSV_LOCKFILE_NAMES` (src/products.ts:98-117) becomes a matcher with an
exact-name set and the two requirements patterns, and
`ProductProfile.lockfileNames` (src/products.ts:68-73) becomes
`lockfileMatcher: ((basename: string) => 'bare' | 'requirements' | null) | null`.
The filter in `spawnAndRead` (src/gate-runner.ts:1461-1466) calls it; the
`node_modules` exclusion and sort stay. `gateArgs` (src/gate-runner.ts:855-867)
emits the parse-as form for `requirements` entries. The comment block at
src/products.ts:98-110 ("only the npm family is listed") is rewritten.

### 2.2 The pin check

Applied to each matched requirements file, from the file on disk (the copy
osv-scanner reads), after the tracked listing. Logical lines are built first:
a trailing backslash joins the next line, a `#` that starts a line or follows
whitespace starts a comment, blank lines drop.

Per logical line:

| line | verdict |
|---|---|
| `name==1.2.3`, `name[extra]==1.2.3` | pinned |
| the same with an environment marker (`; python_version >= "3.8"`) | pinned |
| the same with `--hash=...` options | pinned |
| `==1.2.*` (prefix match) | unpinned |
| `===1.2.3` | unpinned (open question 3) |
| `>=`, `<=`, `~=`, `!=`, `>`, `<`, a range, two specifiers, no specifier | unpinned |
| a version containing `$` (environment substitution) | unpinned |
| `-r path` / `--requirement path` | followed (below) |
| `-c` / `--constraint`, `-i`, `--index-url`, `--extra-index-url`, `-f`, `--find-links`, `--trusted-host`, `--pre`, `--prefer-binary`, `--only-binary`, `--no-binary`, `--require-hashes`, `--use-feature` | ignored for the check |
| `-e ...`, `--editable ...`, a local path, a URL, `name @ url` | excluded from the check, counted (open question 2) |
| any other line or option | unpinned, reason "unrecognised line" |

Includes. osv-scanner 2.4.0 follows `-r` (measured: a top file with
`-r requirements-dev.txt` reported the included packages under the top file's
path) and ignores `-c`. It also swallows a missing include: one stderr line,
the rest of the file scanned, exit decided by what it did read (measured). It
resolves an include relative to the including file's directory, not its
working directory, and survives a file that includes itself (both measured:
`sub/requirements-dev.txt` with `-r base.txt` and `-r requirements-dev.txt`,
run from another directory, reported `sub/base.txt`'s pin once). So the pin
check follows `-r` itself, relative to the including file's directory, depth
at most 8, visiting each file once: a cycle is fine, not a reason to leave
the file unscanned. An include that is absent, not a
tracked regular file, absolute, outside the repository, or a URL makes the
top file not scanned, because osv-scanner would silently under-read it.
Every requirement in the closure must be pinned.

Coverage wording. One diagnostic per file not scanned, code
`conductor/requirements-not-scanned`:

    services/api/requirements.txt not scanned: line 4 "flask>=2.0" is not
    pinned with ==, so any version osv-scanner reported would be a guess.

with the reason replaced by "includes ../shared.txt, which is outside the
repository" and so on. The gate's run details gain `not-scanned: N (paths)`
beside `lockfiles`. When every candidate was skipped the existing
nothing-to-scan return (src/gate-runner.ts:1467-1486) keeps exit 0 and its
message becomes "osv-scanner had nothing it could scan: N requirements
file(s) not pinned (paths)". Item 1.2 owns the wider coverage line; this
design fixes only these two messages.

Correction to the plan's Q1 rationale (the ruling stands): 2.4.0 resolves
requirements through deps.dev by default, so `flask>=0.12` was reported as
flask 3.1.3 plus eight transitive packages; only `--no-resolve` reads the
lower bound (0.12, 8 advisories). Either way an unpinned line is a guess.

### 2.4 Resolution mode: `--no-resolve` for requirements files

OPERATOR RULING (2026-10-11, closes open question 5). Every osv-scanner
invocation that carries at least one requirements file is handed
`--no-resolve`, on the head run AND on the base run. Recorded rationale:

- Deterministic across the two runs: no deps.dev lookup between them, so
  the same written pins give the same packages on both sides.
- Matches the Q1 pin ruling: scan what is written, nothing else.
- Default resolution reports latest-from-registry transitive versions the
  adopter never installs, and misses the older ones they actually have; it
  is a guess in both directions.

Lock formats keep osv's normal handling. `--no-resolve` only switches off
transitive resolution of manifests; a lockfile is already complete and is
not resolved, so passing the flag on an invocation that also carries
lockfiles changes nothing for them. An invocation with no requirements file
gets no flag, so a repository without requirements files sees an unchanged
command line.

Coverage wording for every scanned requirements file, in the gate's run
details and the verbose report: "<path>: direct requirements only; no
lockfile, so transitive packages are not scanned."

Not overridable. `no-resolve` is NOT added to the reserved list (that would
refuse existing policies), but on an invocation carrying a requirements file
conductor's own flag wins: a passthrough `no-resolve` key from the policy is
dropped from that invocation's argv and conductor's `--no-resolve` is
written instead, with a note, `conductor/option-overridden`: "options.no-resolve
in .guardrails.yaml was not passed: requirements files are always scanned
with --no-resolve (direct requirements only)." Without this, `no-resolve:
false` renders `--no-no-resolve` (src/policy.ts:548-568), which osv would
reject. On an invocation with no requirements file the passthrough is
passed as written, as today.

Symmetry check. The base argv is built from the head argv by replacing only
the `--lockfile` arguments (3.3). Before the base run, conductor compares the
two argvs with the lockfile arguments removed; any difference makes the
comparison unavailable for every lockfile in the run (all introduced, a
`conductor/base-comparison-unavailable` note naming the differing flag). An
asymmetric resolution mode can therefore never label a finding
present-on-base.

### 2.3 The pin check is a ratchet on a pull request

Without this, a pull request adds one `foo>=1` line to a pinned
requirements.txt and every vulnerable pin in it stops being scanned: the
gate goes green by removal. So on a trust-base run, a requirements file whose
BASE copy (and base include closure, read from the base) passes the pin check
is handed over whatever its head copy says, with the head's unpinned lines
named in a `conductor/requirements-not-pinned` diagnostic. Only a file that
is unpinned on the base too, or new in the pull request, is left out. Local
runs have no base and simply leave unpinned files out.

The coverage line shows the HEAD state (what this run handed over), with a
note when the base differed ("pinned on the base; scanned under the ratchet"
or "newly pinned in this pull request"). Deleting a requirements file, or
renaming it to a name the matcher does not take (requirements.in), is an
accepted way to drop it: it gets the note-only
`conductor/lockfile-no-longer-scanned` (3.2) and is visible in the diff.

## 3. Item 1.3: the base run

### 3.1 When it runs

Only when the trust base is decided and not withheld (`decidedRef` in
`spawnAndRead`, src/gate-runner.ts:1410-1411), the head run exited with a
blocked code (osv 1), and the head normalizer produced at least one finding.
A clean head, a nothing-to-scan, a lockfiles-empty, or any could-not-run
return before it, so every existing path is untouched and costs nothing new.
The equal-tree skip in `runAll` already keeps osv off a pull request whose
tree matches the base.

### 3.2 Which lockfiles, and how their base copies are obtained

For each head lockfile that carries at least one finding, by its
repository-relative path P:

1. Unchanged shortcut. `git ls-tree` on the trust base for P (the existing
   `treeEntryAt`, src/trust-base.ts:672) against
   `git hash-object --no-filters --stdin-paths` for the head files on disk,
   one call for all of them. `--no-filters` because clean filters come from
   the head's `.gitattributes`. For a requirements file the whole include
   closure must match. Equal ids: every finding in P is present-on-base
   with no base scan; identical input, identical config, identical database.
   Most pull requests touch no lockfile, so most compared runs spawn no
   second osv-scanner.
2. Absent on the base (new lockfile): every finding in P is introduced.
3. Unreadable on the base (`readFileAtRef` returns `error`: a symlink,
   submodule or directory at P or above it, or a failed `cat-file`): every
   finding in P is introduced, with a diagnostic (3.5).
4. Present and different: the bytes are copied to
   `<workDir>/osv-base/<P>`. A requirements file whose base copy fails the
   pin check, or whose base include closure cannot be materialised the same
   way, counts as unreadable (introduced), never as clean.

THE ONE READER. Every base byte comes through `readFileAtRef`
(src/trust-base.ts:593-614) on the trust base ref, never from the working
tree, the index or HEAD. One addition: a byte-exact variant (encoding
`buffer`) for these copies, since the current reader decodes UTF-8 and a
lockfile with invalid bytes would otherwise be rewritten before osv reads it.

The directory. `workDir` already exists on every trust-base osv run because
`needsConfig` is true (src/gate-runner.ts:1354-1360), is made with
`mkdtemp` under `options.tempRoot ?? tmpdir()`, and is removed in the
`finally` at src/gate-runner.ts:1375-1379, including on a throw. The base
copies live under it. A new guard: if the real path of `workDir` is inside
the real path of the repository root (a TMPDIR set inside the checkout),
the comparison is unavailable (every finding introduced) and a diagnostic
says why. Each P is placed with the containment check `materializeRelative`
already applies (src/external-config.ts:142-166): absolute or climbing paths
are refused.

Deleted lockfiles are not scanned on either side: the base list is the head
list. A diagnostic, `conductor/lockfile-no-longer-scanned`, names any
basename-matched path tracked on the base and absent from the head, so a
pull request that removes a lockfile is visible in the report (it is already
visible in the diff). It never blocks.

Renamed or moved lockfiles get NO rename mapping. The base copy for P is
exactly the base blob at P. Mapping by git rename detection would let a pull
request choose the comparison: delete a clean `api/package-lock.json`, move a
vulnerable `legacy/package-lock.json` onto that path with small edits, and
the legacy backlog would compare as present-on-base for a service that never
had it. A rename therefore shows every finding in the new path as
introduced. That is noise on rename pull requests, and it fails closed.

### 3.3 How osv-scanner is invoked on the base copies

The same resolved binary, already cleared by `refuseHeadControlledBinary`
and the version floor. One invocation for all copies:

    osv-scanner --format json --config <the same materialised base config>
      --lockfile <workDir>/osv-base/P1 --lockfile requirements.txt:<...>/P2
      <the same passthrough options>

built by the same `gateArgs` with `external.lockfiles` set to the absolute
copy paths (parse-as forms preserved), `cwd` set to `<workDir>/osv-base`, and
the same timeout as the head run. `--config` is always present on a
trust-base run (src/external-config.ts:168-178), so no nested
osv-scanner.toml is loaded and both runs see the base's config and the base
policy's passthrough. The base argv carries `--no-resolve` exactly when the
head argv does, whatever subset of files it scans (harmless for lockfiles,
2.4), and the symmetry check in 2.4 runs before spawning. Flags checked against
`scan source --help` on 2.4.0.

Call analysis. 2.4.0 attempts Go call analysis when Go is installed (it
printed "Skipping call analysis on Go code since Go is not installed"), which
hides uncalled advisories using the source tree. The head has source, the
base copies do not, so a newly reachable advisory could compare as
present-on-base. Proposed: on a compared run both invocations get
`--no-call-analysis=all` (accepted by 2.4.0, measured), making present-on-base
a dependency fact, and the head can only gain findings. If the base policy
sets `call-analysis` or `no-call-analysis`, that value is used on both runs
(open question 6).

Base exits. 0 and 1 are read; 128 means the copies parsed to no packages, so
every finding is introduced. Any other exit, a timeout, a spawn failure,
unparseable JSON or a normalizer error makes the comparison unavailable for
every lockfile in that invocation: all introduced, with a diagnostic. The
base run NEVER makes the gate could-not-run and never removes a head
finding; the head run's failure modes are unchanged.

Paths. osv-scanner prints `source.path` absolute (src/normalize.ts:1079-1093).
Base results are made relative to every spelling of `<workDir>/osv-base`
(as `rootSpellings` does, src/gate-runner.ts:942). A path that cannot be made
relative matches nothing, so the head finding stays introduced.

### 3.4 The fingerprint and the comparison key

Today's osv fingerprint is `id|name|version|manifest`, marked stable
(src/normalize.ts:1158-1163). The comparison key is that value plus the
package ecosystem: advisory id, ecosystem, package name, installed version,
repository-relative lockfile path. A head finding is present-on-base when a
base finding has the same key; otherwise it is introduced. The published
fingerprint value does not change, so SARIF consumers keep their identity.

Why each part:

- Path: adding a vulnerable package to a second lockfile introduces it
  there; without the path, moving a dependency into a new service would
  compare as present-on-base.
- Version: keeps a second copy at a new vulnerable version (npm nesting, a
  new workspace member) from collapsing onto the base's. Cost: a partial
  upgrade inside one advisory's range (lodash 4.17.15 to 4.17.19), or
  reformatting `==1.0` to `==1.0.0`, is introduced. Fail-closed, and in the
  changelog.
- Advisory id, not alias group: osv lists aliases as separate entries
  (GO-2020-0015 and GHSA-5rcv-m4m3-hfh7, measured here; the reviewer
  measured PYSEC and GHSA ids both coming back on both runs for a Python
  pin), so each id matches itself across runs and the key is stable. The
  head run goes first and the base run seconds later; an advisory published
  in between appears only on the base side and matches nothing, and one
  withdrawn in between leaves a head finding with no base partner, which is
  introduced. Either way the error is toward introduced.
- Ecosystem: cheap insurance for a format that mixes ecosystems.

A second dependent of an already-present vulnerable version (same package,
version and lockfile) compares as present-on-base. That version was already
in that lockfile; stated as a limit.

Trust boundary summary. Everything on the base side comes from the trust
base ref through the one reader, into a directory the head cannot write,
read by a binary the head did not choose, under the config and policy the
base chose. Nothing the pull request controls can move a finding from
introduced to present-on-base except by making the head lockfile byte-equal
to the base's at the same path, in which case the label is true.

### 3.5 Diagnostics

All are diagnostics (notes), not findings, and none changes a verdict by
itself: `conductor/base-comparison-unavailable` (which lockfiles, why, "every
finding there counts as introduced"), `conductor/requirements-not-scanned`,
`conductor/requirements-not-pinned`, `conductor/lockfile-no-longer-scanned`.
The rule list in AGENTS.md (five umbrella finding codes) is unchanged.

## 4. The policy key and the verdict

### 4.1 Key

    vulnerabilities:
      product: osv-scanner
      present-on-base: report   # or: block

- Name `present-on-base`, values `block` (block on every finding, the
  ruling's "block all") and `report` (report present-on-base findings,
  block on introduced ones; the ruling's "introduced-only"). Open question 1.
- Gate-level, beside `enforce`, never under `options` (options are a pure
  passthrough, src/policy.ts:22-29).
- Schema: a new optional property on the gate definition in
  schema/guardrails.schema.json (the gate object at lines 40-75 has
  `additionalProperties: false`), enum `block`, `report`.
- Loader: `parsePolicy` (src/policy.ts:440-457) sets
  `GatePolicy.presentOnBase: 'block' | 'report'`, `'block'` when absent. The
  key on any role other than `vulnerabilities` is a PolicyError with a reason
  (only that gate has a base comparison). An older conductor reading a policy
  with the key fails its schema check and exits 2, loudly.
- Trust: on a pull request the policy comes from the base (src/cli.ts:399-469),
  so a pull request cannot switch itself to `report`; a head-side edit is a
  policy proposal like any other.
- Local and push runs: no base, no labels, the key has no effect, every
  finding blocks as today (open question 7).
- `init` (src/init-policy.ts:143-148) writes, under the vulnerabilities gate
  only:

        # On a pull request, findings already on the base branch are reported
        # and do not block; only advisories the pull request introduces do.
        # Set present-on-base: block to block on every known vulnerability.
        present-on-base: report

  It never rewrites an existing policy file (unchanged rule).

### 4.2 Labels and blocking

After the comparison, each head finding gets `details.baseline`:
`introduced` or `present-on-base`. Under `block` every finding keeps
`blocking: true` (the exit said blocked). Under `report`, present-on-base
findings get `blocking: false`.

### 4.3 Exit composition

Today a gate that exited non-zero always yields a non-zero composed code
(src/exit-codes.ts:32-36 and :81). Under `report` an osv run whose findings
are all present-on-base exits 1, and the run must not block. That is a new,
second written-decision exception beside `enforce: false`, and it is narrow:

`gateExitBlocks(outcome)` (new, src/exit-codes.ts) returns false for a
non-zero exit only when all of these hold: (a) the gate is the
vulnerabilities gate (osv-scanner product); (b) the policy said `report`;
(c) a base comparison ran (3.1); (d) at least one finding was parsed;
(e) every finding is labelled present-on-base; and (f) no package in the
head run's raw JSON carries a non-empty `license_violations`, and none
carries deprecated-package output from
`--experimental-flag-deprecated-packages`. Exit 1 with zero parsed findings
still blocks.

(e) is redundant by construction: under `report` an introduced finding
keeps `blocking: true`, so the composed exit is 1 through
`hasBlockingFinding` whatever `gateExitBlocks` returns. It stays in the
predicate so the predicate states the whole rule.

Why (f). osv exits 1 for a licence violation as well as for an advisory.
`licenses` is not a reserved option (src/policy.ts:365-373), so a base
policy can pass it, and the normalizer reads only `vulnerabilities`
(src/normalize.ts:1138-1141). The reviewer measured `--licenses=Apache-2.0`
on `click==8.1.7`: `license_violations` present, zero vulnerabilities,
exit 1. Without (f), a run with one present-on-base advisory and a licence
violation has every PARSED finding present-on-base and would pass. The
normalizer therefore records, as a run-level fact, whether any package
carried a verdict that is not an advisory, and (f) reads that fact. Exactly:

- The PACKAGE-level keys it knows are `package`, `vulnerabilities`,
  `groups` and `licenses`. `license_violations` is the verdict field (f)
  names, and it is deliberately not among the known keys.
- Any other non-empty PACKAGE-level key counts the same as
  `license_violations`, so a future osv verdict field fails closed rather
  than open. The catch-all is scoped to package-level keys only: the
  top-level `license_summary` and `experimental_config` and the
  result-level `source` are summaries and settings, outside it.
- Deprecated-package output, MEASURED on 2.4.0 with
  `--experimental-flag-deprecated-packages` over a package-lock.json
  resolving `querystring@0.2.1` (and again over `request@2.88.2`): it is
  `"deprecated": true` INSIDE the `package` object, not a package-level key,
  and a deprecated package with no advisory exits 1. The package-level
  catch-all would therefore miss it, so the normalizer reads
  `package.deprecated` explicitly (see Deviations, D1). Both captures are
  committed as tests/fixtures/osv-scanner-2.4.0-license-violation.json and
  tests/fixtures/osv-scanner-2.4.0-deprecated.json. The key is NOT reserved: reserving it would refuse policies that pass
it today. The inputs ride on a new optional
`GateOutcome.baseComparison` (`ref`, `policy`, counts, unavailable paths;
src/gate-runner.ts:473-528), so a report never needs the policy file to
explain itself, as with `enforce`. `ExitInput` gains a REQUIRED
`exitBlocks: boolean` in place of reading `exitCode` directly, wired from
`run.ts` (src/run.ts:650-657).

Every other reader of "the child exited non-zero" moves to the same predicate,
or the verdict token and the verdict sentence disagree with the exit code:
`enforcementNote` (src/output-text.ts:93), `unenforcedClauses`
(src/output-text.ts:439-443), `blockingCount` (src/output-text.ts:617-623, which
would otherwise count the osv gate as 1 when another gate blocked), the
mismatch branch at src/output-text.ts:808, and the gate-not-enforced
notification at src/output-sarif.ts:940-957 (its message at :946 included).
Two more sites read the raw exit for a different question, "did this gate
say anything at all", and keep it on purpose: the job-log outcome
(src/output-text.ts:549, `total === 0 && exitCode === 0`) and `isFullyClean`
(src/output-text.ts:931). A report-mode run with present-on-base findings has
findings and a non-zero child exit, so it is never "ok" and never folded into
the one-line summary; that is the intended reading. The source-text test
(test 18) catches both `!== 0` and `=== 0` readers of `exitCode` and holds an
explicit allowlist of exactly these two sites, each with its reason. The
child's own `exitCode` stays on the outcome and in the header, untouched.

### 4.4 Output

Text. `findingLines` (src/output-text.ts:52-60) appends the label to the head
line: `BLOCKING  high*  osv-scanner/GHSA-...  lodash (package-lock.json)
introduced`, or `report ... present-on-base`. `gateSection`
(src/output-text.ts:134-) adds one line under the threshold line:
`base comparison  origin/main  introduced 2  present-on-base 14
present-on-base: report (not blocking)`, or `... unavailable for P: reason;
counted as introduced`. The exit-0 verdict (src/output-text.ts:825-835) gains
a clause when present-on-base findings were reported and not enforced:
"verdict: exit 0, every enabled gate ran and none blocked; 14 known
vulnerabilities already on the base were reported, not blocking
(vulnerabilities: present-on-base: report)."

Verdict token: unchanged closed set (open question 8). `pass` stays correct
by its README definition, since report-mode present-on-base findings are not
blocking findings, and the action's token check (action.yml:1106-1120) is
unchanged.

Job summary. The step summary prints only the token
(action.yml:1134-1139), so a `pass` with 14 reported advisories would read as
spotless there. Following the `unenforced-findings (N)` precedent
(README.md:582-584, "exit 0 here is not a pass, and the token says so"), the
full text report gains a fixed third line, printed only when N is above
zero: `present-on-base: N reported, not blocking`. action.yml changes in one
place: after the token line, the gates step reads line 3 of the text report
and, only if it matches `^present-on-base: [0-9]+ reported, not blocking$`,
appends it to `GITHUB_STEP_SUMMARY`; anything else on line 3 is ignored. The
earlier claim that action.yml needs no change is withdrawn. A test in
tests/action.test.ts drives the gates step against a shim and asserts the
summary carries the line, and does not for a non-matching line 3.

SARIF. `toResult` (src/output-sarif.ts:335-359) sets the standard SARIF
`baselineState` on compared osv results: `new` for introduced, `unchanged`
for present-on-base, and copies `details.baseline` as today's details bag
does. Run-level `properties.details` gains `baseline-ref`, `introduced`,
`present-on-base`, `present-on-base-policy` and `not-scanned`. Non-compared
runs carry no `baselineState`.

Normalizer. `normalizeOsvScanner` (src/normalize.ts:1106-1194) is reused for
the base output with the base roots; the labelling is a separate pure
function `labelAgainstBase(head, base, unavailable, unchanged)` so it can be
tested without spawning anything.

## 5. Invariants: what changes

Amended in docs/INVARIANTS.md:

- "The exit code is composed, not maximised" (and the exit-codes.ts header,
  lines 32-46): "a gate that exited non-zero produces a non-zero composed
  code" gains the 4.3 exception with all six conditions, (a) to (f).
- "An unenforced gate is filtered out": "nothing reads a gate's output and
  decides to ignore it" gains "on its own judgment"; report mode is a set
  difference of two runs of the same tool under a line in the base policy.
- "Blocking is reconstructed, checked against the gate, and the gate wins"
  (INVARIANTS.md:3568-3581). Today: "Nothing about the composed exit code
  depends on this field either way; that comes from the child's own exit
  code". Replacement: "For every gate but one, nothing about the composed
  exit code depends on this field; it comes from the child's own exit code.
  The exception is the vulnerabilities gate on a compared pull-request run
  under `present-on-base: report`, where `gateExitBlocks` reads the
  present-on-base labels, conditions (a) to (f) in the osv design, and a
  non-zero exit with every parsed finding present-on-base and no licence or
  deprecation output does not block."
- "The clean-run summary line, and what it may not swallow"
  (INVARIANTS.md:3297). `isFullyClean` (src/output-text.ts:931) keeps
  reading the raw child exit. Added sentence: "A report-mode osv run whose
  findings are all present-on-base exits 0 but is never fully clean: its
  child exit is non-zero and it has findings, so the full report, the
  present-on-base line and the verdict clause are always printed."
- "SARIF says only what it can support" (INVARIANTS.md:3360). Added
  sentence: "`baselineState` is set only on osv results from a compared
  pull-request run, `new` for introduced and `unchanged` for present-on-base,
  and never on a run with no base comparison, where the umbrella has no
  baseline to support it. A comparison that was unavailable for a lockfile
  yields `new` for its results, matching the introduced label."
- "External gates", the osv lockfile paragraph: new list, parse-as form, pin
  check and ratchet. Known-open 1 (npm names only) closes; replaced by
  "unpinned requirements files are named, not scanned; go.sum is never
  handed over".

New entries: (1) base copies come only through `readFileAtRef` on the trust
base, byte-exact, into the gate's work directory outside the repository,
removed on every path; (2) the base run never makes the gate could-not-run,
and every failure labels `introduced`; (3) the comparison key is advisory
id, ecosystem, package, installed version and repository-relative path,
with no rename mapping; (4) the shortcut compares object ids with filters
off, never decoded text; (5) `present-on-base` comes from the base policy,
absent means `block`; (6) the pin check is a ratchet on a pull request;
(7) every "child exited non-zero" decision goes through `gateExitBlocks`.

New known-open: a renamed or moved lockfile is all introduced; a deleted one
is not scanned (now with a diagnostic); same-version duplicates within one
lockfile compare as present-on-base.

README: the osv paragraph (README.md:542-557) gets the list and pin rule,
the policy reference gains `present-on-base`, and the verdict-token section
says `pass` can carry reported present-on-base findings.

## 6. Test plan

Unit tests use the stub gate (tests/helpers/stub-gate.ts), taught to answer
per `--lockfile` argument and record the bytes and cwd it saw, and real
base and head commits in a temporary repository. Each test names the
mutation it must kill.

Coverage (1.1):

1. Matcher: accepts every new basename and the three requirements shapes;
   rejects go.sum, requirements.in, pyproject.toml, node_modules. Kills:
   dropping a name; adding go.sum.
2. argv: variants as `requirements.txt:<path>`, exact names (npm-shrinkwrap
   included) bare. Kills: a variant handed bare; parse-as for shrinkwrap.
3. Pin-check table, one case per row of 2.2 (continuation plus `--hash`,
   comments, markers, extras). Kills: accepting `>=`, `==1.*` or `===`;
   reading `-c` as a requirement.
4. Includes: pinned, unpinned, missing, outside the repository, untracked,
   depth 9, all left unscanned where 2.2 says so; a cycle and a self-include
   of pinned files are scanned (fine, not unscanned); an include in a
   subdirectory resolves against the including file's directory. Kills: not
   following `-r`; accepting a missing include; treating a cycle as
   unscanned; resolving against the working directory.
4a. Resolution mode: on a compared run with a changed requirements file and
   a changed package-lock.json, the stub records `--no-resolve` in BOTH the
   head and the base argv; a run with no requirements file has it in
   neither; a policy `no-resolve: false` is dropped with the
   `option-overridden` note; the per-file "direct requirements only" line is
   printed. Mutation: drop the flag from the BASE run only; the symmetry
   check must report the comparison unavailable (all introduced, note naming
   `--no-resolve`), so the test's expected present-on-base label goes red.
   Kills also: dropping the symmetry check itself.
5. Wording: exact diagnostic text, the `not-scanned` detail, the new
   nothing-to-scan text at exit 0. Kills: a silent drop.
6. Ratchet: base pinned, head adds `foo>=1`; on a trust-base run the file is
   still scanned and its pinned vulnerable line still blocks. Kills: pin
   check on the head copy only.

Comparison (1.3):

7. Pair: base lockfile with advisory A, head adds B. A present-on-base, B
   introduced; absent key: both BLOCKING, exit 1; `report`: exit 1 on B;
   without B under `report`: exit 0, token `pass`, A printed with its label.
   Kills: labelling all present-on-base; skipping the base run; absent key
   read as `report`.
8. Rename attack: base has `legacy/package-lock.json` with A and a clean
   `api/package-lock.json`; head moves legacy's onto api's path. A is
   introduced, exit 1 under `report`. Kills: rename mapping; basename key.
9. Cross-lockfile move: A in lockfile X on the base, head adds the same
   package and version to Y. Introduced in Y. Kills: path dropped from key.
10. Version change inside one advisory: introduced. Kills: version dropped.
11. Base unreadable four ways (P a symlink on the base; base run exits 127;
    times out; prints non-JSON): all introduced, a diagnostic, gate not
    could-not-run. Kills: failure read as "all present"; or as could-not-run.
12. Trust boundary: the HEAD commit's blob, the index and the working tree
    all differ from the base blob (three different contents); the stub's
    recorded base bytes equal the base blob exactly, invalid UTF-8 byte
    included. Kills: base copy from the working tree, the index, or HEAD;
    UTF-8 decoding.
13. Temp directory: nothing appears under the repository; the work
    directory is gone after a run and after a throw; a tempRoot inside the
    repository makes the comparison unavailable. Kills: removing rmSync or
    the guard.
14. Shortcut: an untouched lockfile spawns no base run and is
    present-on-base; an unchanged requirements file whose include changed
    does get one; a head clean filter changes nothing. Kills: top file only;
    filters on.
15. Policy: absent is `block`; `report` parses; other roles rejected with a
    reason; bad value fails the schema; a head-only edit has no effect and
    is a proposal. Kills: default `report`; key read from head.
16. init writes `present-on-base: report` with its comment, under
    vulnerabilities only; an existing policy is untouched. Kills: `block`.
17. `gateExitBlocks`: report, exit 1, all present-on-base: not blocked;
    exit 1 with no parsed finding: blocked; block mode: blocked. Kills:
    dropping the at-least-one guard.
17a. Licence violation: report mode, one present-on-base advisory, and a
    package with `license_violations` (stub JSON shaped like the reviewer's
    `--licenses=Apache-2.0` on click==8.1.7 capture), exit 1: still blocks.
    Same with a deprecated-package entry. Kills: dropping (f). It does NOT
    kill dropping (e): (e) is redundant by construction (4.3), because an
    introduced finding is blocking under `report` and blocks through
    `hasBlockingFinding` whatever the predicate says. Dropping (e) is caught
    only by test 17's direct predicate case (exit 1 with an introduced
    finding), and that is the expected result, not a gap.
17b. Non-osv gate: a hand-built dep-guard (and vault-guard) outcome carrying
    a `baseComparison` with policy `report` and all findings labelled
    present-on-base, exit 1: blocks. Kills: dropping (a), the osv-only pin.
18. Readers: another gate blocks while osv in report mode holds only
    present-on-base findings; token `blocked (1)`, not `(2)`. Plus a
    source-text test over src/ that finds every reader of `exitCode`
    compared with `!== 0` OR `=== 0` outside exit-codes.ts and fails unless
    it is one of the two allowlisted sites in 4.3. Kills: `blockingCount`
    (or any of the six sites) left on the raw exit code.
19. Output: label, base comparison line, verdict clause, SARIF
    `baselineState`, none on a local run. Kills: label or state omitted, or
    emitted without a comparison.
20. Real binary (tests/external-gates.real.e2e.test.ts, skipped without
    osv-scanner): go.mod with golang.org/x/text v0.3.0 blocks; go.sum never
    handed; pinned requirements-dev.txt scanned via parse-as; unpinned file
    named; test 7's pair in a temporary repository. These are SKIPPED in CI:
    no workflow installs osv-scanner, and they query osv.dev over the
    network. They run locally only with the binary available: its path in
    CONDUCTOR_OSV_SCANNER_BIN, or a copy at .local/bin/osv-scanner in the
    checkout (gitignored); an osv-scanner merely on PATH is not picked up. Observations go into
    tests/fixtures/README.md with the version: existing notes are against
    2.6.0, these were taken on 2.4.0.

## 7. Release shape

Minor: conductor 0.9.0 (with 1.2 and 1.4 per the plan). 1.1 and 1.3 ship in
the same release because 1.1 alone turns a Python or Go backlog from a false
green into a red on every pull request (the C group repositories would all
flip), with only per-id osv-scanner.toml entries as a remedy. 1.3 is what lets
those repositories enforce on new advisories from their first pull request.
1.1 is the smaller change and could be reviewed first, but it is not released
alone.

CHANGELOG draft:

> **What can newly turn a run red.** The vulnerabilities gate now hands
> osv-scanner go.mod, poetry.lock, Pipfile.lock, uv.lock, pdm.lock,
> Cargo.lock, Gemfile.lock, composer.lock, gradle.lockfile,
> packages.lock.json and requirements files whose every requirement is
> pinned with `==`, as well as the npm-family lockfiles it read before. A Go,
> Python, Rust, Ruby, PHP, Java or .NET repository that used to get
> "nothing to scan" now gets real results, and a known advisory there blocks.
> A requirements file with an unpinned requirement is not scanned and is
> named in the report with the line that stopped it. Requirements files are
> scanned with osv-scanner's `--no-resolve`: direct requirements only, as
> written, with no lookup of transitive packages, because without a lockfile
> any transitive version would be the registry's latest rather than the one
> installed. The report says so per file. An `options.no-resolve` key in the
> policy is not passed on runs that scan a requirements file; a note says
> so. Lockfiles are scanned as before.
>
> **The consumer cost.** A policy written before this release has no
> `present-on-base` key, so it blocks on every known vulnerability,
> including ones already on the base branch: no policy is loosened by the
> upgrade. A repository with a backlog in a newly scanned ecosystem sees
> every pull request blocked until it fixes the backlog, ignores advisories
> in osv-scanner.toml on the base branch, or adds `present-on-base: report`
> under the vulnerabilities gate on the base branch, after which only
> advisories a pull request introduces block. Move the action to this
> release first: older conductor versions reject the key and exit 2. A
> renamed or moved lockfile, and a partial upgrade still inside an
> advisory's range, count as introduced. So does every advisory in a
> requirements file that a pull request pins for the first time: under
> `report`, that good-hygiene pull request is blocked once on the file's
> whole backlog. Land the pin with the action in advisory mode, or ignore
> the specific advisories in osv-scanner.toml on the base branch first.
> Deleting a requirements file, or renaming it to a name the gate does not
> match, drops it with a note rather than a block. A pull request that
> changes a lockfile may run osv-scanner twice. When `present-on-base:
> report` leaves known advisories unblocked, the report and the job summary
> both say `present-on-base: N reported, not blocking`.

## 8. Open questions

1. Key spelling. Recommend `present-on-base: block | report`; alternative
   `block-on: all | introduced` mirrors the ruling's words.
2. Direct references (`-e .`, paths, URLs, `name @ url`). Counting them as
   unpinned would drop nearly every file with `-e .`, and osv ignores them
   (measured). Recommend: excluded from the check, counted in the diagnostic.
3. `===`. A pin; osv's resolver errors on it (measured), though with
   `--no-resolve` (2.4) it is read as written. Recommend unpinned anyway, as
   the Q1 ruling says `==`, with the reason naming `===`.
4. `requirements/*.txt` (Django layout) is invisible to basename matching.
   Recommend asking the operator whether a parent-directory rule fits "keep
   tracked-basename matching"; until then item 1.2's coverage line names them.
5. CLOSED by operator ruling 2026-10-11: requirements files are scanned
   with `--no-resolve` on both runs, not overridable by passthrough (2.4).
6. Call analysis. Recommend `--no-call-analysis=all` on both runs of a
   compared pull request unless the base policy sets either key (stricter on
   head than today). Alternative: accept and document the asymmetry.
7. Push and local runs have no base, so a backlog keeps push-to-main red
   under `report`. Recommend keeping that and documenting the ratchet as a
   pull-request feature.
8. Verdict token. Recommend no new token: `pass` already means "no blocking
   finding", the sentence carries the clause, and action.yml's closed-set
   check stays as it is; the job summary gets the line in 4.4 instead.

The implementation follows the recommendation on every open question above
(1, 2, 3, 4, 6, 7 and 8); question 5 was ruled.

## 9. Deviations found during implementation

Each is a place where the design and the code or the tool disagreed, or
left a choice open, and the fail-closed option was taken.

D1. Deprecated-package output sits inside the package object. 4.3 assumed a
key beside `vulnerabilities`; osv-scanner 2.4.0 writes
`packages[].package.deprecated: true` (measured, fixture committed). The
package-level catch-all cannot see it, so the normalizer reads
`package.deprecated` explicitly in addition to the catch-all. Fail-closed:
both shapes count for (f). Known gap: `deprecated` is the ONLY field read
inside the package object. A future verdict field osv-scanner writes inside
`package` (a `yanked` flag, for example) is not covered by the catch-all,
which is scoped to package-level keys; it would need its own explicit read.

D2. Ratchet with an unreadable base copy. 2.3 leaves out only a file that is
unpinned on the base or new in the pull request. A head-unpinned
requirements file whose base copy EXISTS but cannot be read (a symlink or
submodule at the path, a failed cat-file) is neither, so it is handed over
with a `conductor/requirements-not-pinned` note saying the base copy could
not be read. Fail-closed: an unreadable base cannot take a file out of the
scan. An include the base cannot provide still makes the base check fail,
which leaves the file out exactly as an unpinned base would.

D3. Call analysis on every pull-request run, not only compared ones. The
head run happens before it is known whether the comparison will run (3.1),
so both invocations are only symmetric if the head gets the flag on every
run with a decided trust base. `--no-call-analysis=all` is therefore on
every pull-request osv invocation unless the base policy names
`call-analysis` or `no-call-analysis`. That is stricter on the head than
before (the head can only gain findings), and it changes the command line of
existing pull-request runs; local runs are unchanged. Like `no-resolve`, the
key is written but not reserved, and the reserved-option drift test carries
an explicit two-entry exemption with a test that the umbrella and a policy
never both write either flag on one command line. CONFIRMED by operator
ruling at review: the flag stays on both pull-request runs, keeping the
base and head command lines symmetric, rather than relaxing the symmetry
check for this one flag. The consumer cost (a Go repository can pass
locally with call analysis on and block on the pull request) is in the
CHANGELOG.

D4. Two strictness additions to `gateExitBlocks`, beyond (a) to (f): the
role must be `vulnerabilities` AND the product `osv-scanner` (an osv
outcome filed under another role blocks), and an outcome with a
could-not-run blocks. Neither path is reachable from the runner today.

D5. Where the new notes live. `conductor/requirements-direct-only` (the
per-file "direct requirements only" line of 2.4) is a run note, so it does
not by itself force the full report on every run with a requirements file.
`requirements-not-scanned`, `requirements-not-pinned`, `option-overridden`,
`lockfile-no-longer-scanned` and `base-comparison-unavailable` are the
umbrella's own diagnostics, which do force it. None changes a verdict.
`not-scanned` appears in the run details only when N is above zero, so a run
with nothing left out reports the same details as before.

D6. `conductor/lockfile-no-longer-scanned` is computed on every pull-request
osv run, not only compared ones, from one `git ls-tree -r` of the trust
base; a listing git cannot make yields no note rather than a guess, since
the note never blocks.

D7. Tests, as built. Test 8 carries a third lockfile with the same
advisory on both sides, touched, so it also kills a key that keeps only the
base name of the path (the design listed "basename key" under test 8, and
without it only test 9 caught that). The stub answers from the bytes it is
handed (lines `OSV <name> <version> <ecosystem> <id>` in the fixture
lockfile), so a base copy from the wrong place or a rename mapping changes
what it reports. Test 13's "after a throw" is a throw inside the comparison
(placing a base copy under a work directory whose `osv-base` the head stub
turned into a file); the comparison catches it, labels introduced, and the
existing `finally` removes the work directory.

## 10. Extensions after the 2026-10-12 audit

### 10.1 More formats handed over (audit finding F3)

A tracked mix.lock was neither scanned nor named (reproduced by the audit on
a public Elixir repository). Each candidate below was handed to osv-scanner
2.4.0 (osv-scalibr 0.4.5) with `--lockfile <absolute path>` on the
implementation machine, one minimal fixture each:

| file | result | decision |
|---|---|---|
| mix.lock, pubspec.lock, Package.resolved, conan.lock, renv.lock, packages.config, buildscript-gradle.lockfile, gems.locked, pylock.toml, stack.yaml.lock | read, 1 package each | handed over, by base name |
| cabal.project.freeze | read, 2 packages | handed over, by base name |
| gradle/verification-metadata.xml | read, 1 package | handed over only when the parent directory is `gradle` |
| verification-metadata.xml anywhere else | exit 127 | not handed |
| Podfile.lock, deno.lock | exit 127, "could not determine extractor" | not handed; named by the unread-manifests note |

Not measured and not added: pom.xml (a manifest whose read resolves
transitive versions over the network, not a lockfile), `*.deps.json` (a
pattern, not a name), and anything else osv-scanner reads only through its
own directory walk. `osvLockfileKind` now takes the repository-relative path
so the gradle parent rule can be applied; every other name still matches on
the base name at any depth. The unread-manifests list gains Podfile.lock,
deno.lock, mix.exs and pubspec.yaml.

### 10.2 An emptied lockfile beside another (audit finding F2)

Measured on 2.4.0: with `package-lock.json` rewritten to `{}` beside a
pinned `requirements.txt`, the exit is decided by the requirements file and
stderr carries one line per handed file at the default verbosity,
"Scanned <absolute path> file and found 0 packages" and "... found 1
package". The JSON lists only sources with findings, so it cannot tell an
empty file from a clean one. `emptiedLockfiles` (src/osv-coverage.ts) reads
those lines, and the runner adds `conductor/lockfiles-empty` naming each
handed file with zero packages and marks it `[no packages read]` on the
`lockfiles` fact. Annotation only; a file with no count line is not named.

### 10.3 The token when every gate that ran checked nothing (audit finding F4)

`verdictToken` returned `nothing-checked` only when no gate ran at all, so
the vulnerabilities gate alone with nothing to scan printed `pass`. It now
returns `nothing-checked` when every gate in the run checked nothing
(`conductor/nothing-to-scan`, or the intent gate with no contract), through
the same predicate the verdict sentence uses. `could-not-run` was rejected:
it means exit 2, the action's pair check refuses it beside status 0, and
making nothing-to-scan exit 2 would redden every docs-only repository, which
section 4 and the Q rulings rule out. A distinct new token was rejected too:
`nothing-checked` already means "exit 0, nothing was verified", and a new
word would widen the closed set every reader validates against.

Review fix (same day): the exit-128 outcome, every handed lockfile parsing
to no packages, also counts as checked nothing, so a sole lockfile
rewritten to `{}` is labelled like no lockfile. The runner marks that branch
with the run detail `packages-read 0`; the partial-empty note of 10.2 shares
the `conductor/lockfiles-empty` code but never the marker, and the
predicate reads the marker.

