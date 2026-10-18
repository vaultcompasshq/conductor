# An emptied, deleted or moved lockfile under a trust base is could-not-run

Date: 2026-10-18
Status: design, written before the code, with the operator's rulings of
2026-10-18 applied (section 1). Revised in the fix round after review (two
blocking gaps: a deleted or moved lockfile, and a lowered osv verbosity).
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
   file, and is absent from the base tree. Any left: emptied, each named
   with N; none: clear.

## 4. Fail-closed edges

| Edge | Outcome |
|---|---|
| head 127, timeout, spawn failure, unparseable | head outcome, no base spawn |
| no trust base | unchanged, notes only |
| head count line missing (verdict path) | unverified |
| base copy absent, or at 0 packages | clear for that file |
| base copy read error, argv mismatch, workDir in repo | unverified |
| base copy N > 0, emptied | emptied |
| base copy N > 0, removed, populated same-directory replacement new on the head, not requirements | clear |
| base copy N > 0, removed, no or empty replacement, or elsewhere | emptied |
| base copy N > 0, removed, the only populated neighbour on the base too, or a requirements file | emptied |
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

## 7. Release

0.12.0, minor; CHANGELOG under Security with the consumer cost and remedy,
and the extra spawn on exit 128; INVARIANTS known-open 5 rewritten. The
bump is the release round's.
