# An emptied, deleted or moved lockfile under a trust base is could-not-run

Date: 2026-10-18
Status: design, written before the code, with the operator's rulings of
2026-10-18 applied (section 1). Revised in the fix round after review (two
blocking gaps: a deleted or moved lockfile, and a lowered osv verbosity).
Revised again for 0.13.0 (operator ruling of 2026-10-18 from the
adversarial review of PR #121): a replacement must be of the same
ecosystem family and a regular file (section 1, last two rulings; written
before the code).
Scope: conductor only, the vulnerabilities gate (osv-scanner).
Closes: audit 2026-10-18 N1, INVARIANTS known-open 5, on a run with a trust
base. Plain runs and requirements files stay open.

## 1. Rulings (not reopened here)

- Under a decided trust base, a base lockfile with packages whose
  dependencies the head no longer hands to osv-scanner makes the gate
  could-not-run (exit 2): the head copy reads no packages (emptied), or
  the file is gone from the head (deleted, or moved by `git mv`). Not a
  code finding (AGENTS.md): the gate cannot judge what the head removed.
- A deleted or moved file passes only when the head hands ANOTHER lockfile
  in the SAME directory that reads packages (the npm-to-pnpm migration:
  the replacement carries them). A moved-and-emptied file fails (its
  replacement reads 0); a replacement in another directory does not count.
  Second review: the replacement must also be absent from the base tree
  (a lockfile the base already had, such as a Cargo.lock beside the
  deleted package-lock.json, carries its own manifest's packages) and must
  not be a requirements file. A base listing that errors does not count.
- 0.13.0, SAME ECOSYSTEM FAMILY: the replacement must belong to the same
  ecosystem family as the removed file. A new Cargo.lock beside a deleted
  package-lock.json carries a Rust manifest's packages, not the npm ones
  the head removed, and no longer clears it. The family is derived from
  the one table that says which names osv-scanner is handed
  (`OSV_LOCKFILE_ECOSYSTEMS` in src/products.ts, whose keys ARE the name
  list, so a name cannot be handed without a family). Families:
  javascript (package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml,
  yarn.lock, bun.lock), go (go.mod), python (poetry.lock, Pipfile.lock,
  uv.lock, pdm.lock, pylock.toml, and requirements files, which are
  refused as replacements anyway), rust (Cargo.lock), ruby (Gemfile.lock,
  gems.locked), php (composer.lock), jvm (gradle.lockfile,
  buildscript-gradle.lockfile, gradle/verification-metadata.xml), dotnet
  (packages.lock.json, packages.config), hex (mix.lock), dart
  (pubspec.lock), swift (Package.resolved), conan (conan.lock), r
  (renv.lock), haskell (cabal.project.freeze, stack.yaml.lock). bun.lockb
  is not handed to osv-scanner at all, so it has no family. A path with
  no family (an unknown kind) matches nothing, on either side: fail
  closed.
- 0.13.0, NOT A SYMBOLIC LINK: the replacement must be a regular file in
  the head's index, git mode 100644 or 100755. The index is the listing
  the gate's handed files come from (`git ls-files`), so the mode is read
  from the same place (`git ls-files --stage`). A 120000 entry (a symbolic
  link to a populated lockfile elsewhere), a missing entry, or an index
  that cannot be read does not count (fail closed).
- Not ruled, and kept: one replacement still clears every removed
  lockfile of its family in its directory. Still open: a regular-file
  COPY of a same-family lockfile from elsewhere still clears a removed
  one; only a content tie would close that.
- Two reasons: `lockfile-emptied` when the base had N packages, and
  `lockfile-emptied-unverified` when the check could not clear the head (a
  base run that fails, an unreadable copy, a missing count line, an argv
  mismatch). Timeouts are `timed-out`, step `base-check`. Token and SARIF
  level are those of every could-not-run.
- FAIL CLOSED, unlike the base comparison: the check exists only to stop a
  head from removing what the gate judges.
- A lowered osv-scanner verbosity fails closed: on the verdict path, a
  handed non-requirements lockfile with no count line in the head stderr is
  `lockfile-emptied-unverified`, naming the file and saying the policy's
  verbosity option hides the counts the check needs. conductor never edits
  the option.
- Budget: what is left of the gate's limit after the head scan (the whole
  limit when nothing was handed and no head scan ran). None left is
  `timed-out` with nothing spawned (spawnSync reads 0 as no limit).
- Exit 128: the base copy of every handed lockfile is checked.
- Order: a head could-not-run stands and nothing more is spawned. A head
  that blocks is checked too, so the token is could-not-run, not blocked.
- Requirements files (and their include closures) are known-open.
- No trust base: nothing changes. Release: 0.12.0, a minor.

## 2. What the code did before

- `emptiedLockfiles` (src/osv-coverage.ts) names handed files whose
  "Scanned <path> file and found N packages" line says 0, as the note
  `conductor/lockfiles-empty`; with no count line nothing is named.
- `noLongerScanned` lists base lockfiles the head no longer tracks as the
  note `conductor/lockfile-no-longer-scanned`.
- `compareWithBase` reads base copies only for a head that blocked, and
  only for lockfiles with findings: no base count of a removed or emptied
  file exists to reuse, so a new spawn is required.

## 3. The rule

Candidates, decided in gate-runner (`removedOrEmptied` inputs):

- emptied: handed non-requirements files whose head count is 0 (every
  handed file on exit 128);
- removed: `noLongerScannedFiles` at the ref, non-requirements;
- a replacement map: each head-handed file's head count, for the
  same-directory rule.

On the verdict path, BEFORE the candidates: a handed non-requirements file
with no head count line is `lockfile-emptied-unverified`, nothing spawned.

When there are no handed lockfiles at all (everything deleted), the head
is not spawned; the removed candidates are still checked under the whole
limit, and with no head command line the symmetry check is skipped
(`gateArgs` builds no osv-scanner command line without a lockfile, so
there is none to compare). A base tree that cannot be listed is unverified.

`checkEmptiedAgainstBase` (src/osv-baseline.ts):

1. For each candidate, `readFileAtRefBytes`. Absent: skip. Error:
   unverified. Present: `placeCopy` under `<workDir>/osv-base/emptied/`.
   The work directory inside the repository: unverified.
2. No copies: clear. Symmetry check as in the comparison: unverified.
3. Budget at or below 0: timed-out, nothing spawned. Otherwise one spawn,
   cwd the copy directory, timeout the budget.
4. ETIMEDOUT: timed-out. Other spawn error, null status, exit not 0, 1 or
   128: unverified. Exit 128: every copy read 0, clear.
5. Counts via `packageCounts` (the same line pattern and path match as
   `emptiedLockfiles`). A copy with no count line: unverified.
6. A copy with N > 0 is emptied, unless it is a removed file and a head
   file in the same directory reads more than 0, is not a requirements
   file, is absent from the base tree, has a known ecosystem family equal
   to the removed file's (0.13.0), and is a regular file in the head's
   index (0.13.0). Any left: emptied, each named with N; none: clear.

   Before (0.12.0): same directory, count above 0, not requirements,
   absent from the base. After (0.13.0): the same four, plus
   `osvLockfileFamily(other) !== null && osvLockfileFamily(other) ===
   osvLockfileFamily(removed)`, plus an index mode of 100644 or 100755.

## 4. Fail-closed edges

| Edge | Outcome |
|---|---|
| head 127, timeout, spawn failure, unparseable | head outcome, no base spawn |
| no trust base | unchanged, notes only |
| head count line missing (verdict path) | unverified |
| base copy absent, or at 0 packages | clear for that file |
| base copy read error, argv mismatch, workDir in repo | unverified |
| base copy N > 0, emptied | emptied |
| base copy N > 0, removed, populated same-directory replacement new on the head, not requirements, same family, regular file | clear |
| base copy N > 0, removed, no or empty replacement, or elsewhere | emptied |
| base copy N > 0, removed, the only populated neighbour on the base too, or a requirements file | emptied |
| base copy N > 0, removed, the only populated new neighbour is another family (a new Cargo.lock beside a deleted package-lock.json) | emptied |
| base copy N > 0, removed, the only populated new neighbour is a symbolic link (index mode 120000), or its index entry cannot be read | emptied |
| base copy N > 0, removed, either side has no family (a name outside the table) | emptied |
| base copy N > 0, removed, a regular-file copy of a same-family lockfile from elsewhere | clear (known-open) |
| no budget left, or base spawn ETIMEDOUT | timed-out, step base-check |
| base spawn error, exit not 0/1/128, copy with no count | unverified |
| emptied or removed requirements file | not checked (known-open) |

## 5. Reporting

Emptied: "<file> read no packages at the head but N at the base (<ref>)".
Removed: "<file> is not in this pull request but had N packages at the base
(<ref>)". Then: the dependencies cannot be judged; regenerate the lockfile,
or add its replacement beside the same manifest in the same pull request,
or remove the manifest's dependencies with it. Unverified names the file
and the cause. Everything renders from `couldNotRun`; nothing new.

## 6. Tests and mutations

tests/osv-emptied-base.test.ts, with the osv stub's opt-in count line (and
an opt-out per side, for the missing-count cases), plus direct
`checkEmptiedAgainstBase` calls for the budget and no-count branches.
Cases: the audit case (runGate and the CLI token); a head that blocks; a
plain run; a populated head; a base already empty; a lockfile new in the
pull request; a base run that fails; a base run that times out; a head
127 with zero base spawns; exit 128; `git mv` plus empty; delete with no
replacement (the only lockfile, and beside another directory's); delete
with a populated pnpm-lock.yaml in the same directory; no head count line,
under a trust base and on a plain run; a budget of 0; a base copy with no
count line. Each could-not-run asserts its reason.

| Mutation | Must go red |
|---|---|
| skip the base spawn | the emptied, removed and failure cases |
| ignore N | the emptied and removed cases |
| treat a base failure as clear | base fails, times out, no count, budget 0 |
| run the check on plain runs | the plain-run case |
| skip the removed candidates | git mv, both deletes |
| accept a replacement anywhere | the other-directory delete |
| accept a replacement the base already had | both Cargo.lock cases |
| accept a requirements file as a replacement | the head-only requirements case |
| treat a missing head count as clear | no head count under a trust base |
| 0.13.0: drop the family half of the replacement rule | the new-Cargo.lock cases (runGate and direct) |
| 0.13.0: let a null family match a null family | the unknown-kind case |
| 0.13.0: drop the regular-file half | the symbolic-link cases (runGate and direct) |

0.13.0 cases, added in a new block at the end of
tests/osv-emptied-base.test.ts so earlier citations keep their lines:
delete package-lock.json and add a new populated Cargo.lock beside it
(could-not-run, through runGate and directly); delete package-lock.json
and add a symbolic link pnpm-lock.yaml to a populated lockfile elsewhere
(could-not-run, through runGate and directly); the npm-to-pnpm rename as a
positive control (clear); an unknown kind on both sides does not clear
(direct call, since the gate is never handed such a file); the family
table itself (every handed name has a family, and the documented groups).

## 7. Release

0.12.0, minor; CHANGELOG under Security with the consumer cost and remedy,
and the extra spawn on exit 128; INVARIANTS known-open 5 rewritten. The
bump is the release round's.

The family and regular-file rulings ship in 0.13.0, a minor: a pull
request that cleared a deleted lockfile with a lockfile of another
ecosystem, or with a symbolic link, now exits 2.
