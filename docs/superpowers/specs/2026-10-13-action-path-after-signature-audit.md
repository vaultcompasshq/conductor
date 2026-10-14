# Action: the gate prefix goes on PATH only after the signature audit

Status: design note for audit finding F1 (2026-10-12 conductor audit),
written before the code. Line numbers are action.yml at 107bd4a.

## 1. Current ordering

The install step ("Install the gates outside the workspace", action.yml:461)
does, in order:

1. `npm install -g --ignore-scripts` of the four gate packages into
   `${{ runner.temp }}/conductor-gates` (action.yml:594-598).
2. Appends `<prefix>/bin` to `GITHUB_PATH` (action.yml:656).
3. Runs `npm audit signatures` (action.yml:683, retried once at :695).
4. On failure writes `verification-failed`, `verification-reason` and
   `verdict=could-not-run`, prints the error and exits non-zero (:701-732).
5. On success writes `verification-ok=true` (:743).

The comment at :639-646 says the PATH write "is bookkeeping, not a privilege
grant: the gates step does not run when this step fails". docs/INVARIANTS.md
(the "PATH write precedes the signature audit" paragraph) and
docs/design-notes.md:563-567 say the same.

That is true of the gates step and false of the two steps after it. "Render
the report" (pr-render, :1187) and "Post the report" (pr-post, :1374) both
carry `if: always()`, so they run after the install step has failed. A file
command written by a step that later exits non-zero is still honoured (the
render step depends on exactly that: it reads `verification-failed` from the
failed install step), so the prefix is on PATH, prepended, for both. pr-post
holds `GH_TOKEN: ${{ github.token }}` (:1391) and runs `node` by bare name
(:1412); scripts/pr-comment.mjs then runs `gh` by bare name (:64). pr-render
runs `mktemp`, `rm` and `env` by bare name and can write GITHUB_ENV for the
post step.

## 2. The attack

A gate package that FAILS the signature audit (a tampered tarball served by a
mirror or proxy the consumer's npm points at, or a compromised publish that
the registry does not sign) declares a bin named `node` or `gh`. The audit
reproduced that `npm install -g --ignore-scripts` still links such bins into
`<prefix>/bin`: `--ignore-scripts` stops lifecycle scripts, not bin links.
The audit fails, the gates step is correctly skipped, and then pr-post runs
the tampered `node` with the job token in its environment (pull-requests:
write when pr-comment is on). The one control whose job is "do not run what
could not be verified" is bypassed for the one step that holds a write
token.

Reasoned, not reproduced: the runner resolves the `shell: bash` program of a
step through the same prepended PATH, so a bin named `bash` would take over
every later `always()` step, not only the commands inside it. That is why the
fix below is an ordering fix first and an absolute-path fix second: no
change inside the render and post scripts can protect the shell that runs
them.

## 3. The fix

**(a) GITHUB_PATH is written only after the audit passes.** The append moves
below the failure block (after `exit "$audit_status"`) and stays above the
`verification-ok=true` write, so a failure of the append itself still leaves
the run unverified. On a failed audit nothing from the prefix is on PATH for
any later step.

This reverses the 2026-09-22 rule that the PATH write must come first. That
rule existed because a later step reached for `conductor` by name and a
missing binary disguised the refusal. Both halves of that are gone: conductor
is invoked by absolute path (`CONDUCTOR_BIN`) in the gates and render steps,
and the render step branches on `verification-ok`, written only after the
audit, so a failed audit produces the could-not-run note without touching
the prefix. Nothing on the failure path resolves anything from the prefix.

**(b) pr-post runs node and gh by absolute path, resolved before the
install.** A new first step, "Resolve node and gh for the comment step"
(`id: tools`, no `if:`, never fails), resolves both with `type -P -a`,
takes the first hit that is NOT under `${{ runner.temp }}/conductor-gates`,
and publishes `node` and `gh` outputs. It is the first step, so it runs on
every event and before anything in this action can have written GITHUB_PATH.
pr-post reads them as `NODE_BIN` and `GH_BIN`, runs
`"$NODE_BIN" "$ACTION_PATH/scripts/pr-comment.mjs" ... --gh "$GH_BIN"`, and
when either is empty prints a `::warning::` and skips the comment (exit 0,
like every other posting failure). scripts/pr-comment.mjs gains a `--gh`
option; without it the script still runs `gh` by name, which keeps a local
or manual invocation working and is never the action's path.

Why the prefix filter as well as the early position: a second use of this
action in the same job (a monorepo running it per package) reuses the same
prefix, and the first use's verified PATH entry is already in place when the
second one starts. The filter keeps the capture off that directory in that
case. What it cannot do is protect the second use's own install from the
first use's PATH entry: see section 6.

pr-render needs no node or gh. Its bare `mktemp`, `rm` and `env` now resolve
against a PATH that carries the prefix only when the audit passed, which is
the same trust the gates step already extends to the verified packages.

## 4. Documentation that must change

- docs/INVARIANTS.md, "The PATH write precedes the signature audit": becomes
  "The PATH write follows the signature audit", stating that a failed audit
  leaves nothing from the prefix on PATH for the two `always()` steps, and
  that the comment step's node and gh are absolute paths resolved before the
  install. The sentence "The PATH write grants nothing on its own" is
  removed; it was false.
- docs/design-notes.md, "A fail-closed check must not sit in front of the
  line that makes the tool reachable": replaced. The new rule is that what a
  later step needs to say "could not run" must be keyed on a verification
  output, never on reachability, and the prefix is put on PATH only once
  verified. The old ordering is recorded as superseded, with this reason.
- The install-step comment at action.yml:639-650 and the "puts the install
  on PATH before the signature audit" test title and comment.

## 5. Test plan

action.yml is bash inside YAML; tests/action-hardening-drift.test.ts reads
the install step's script with comments stripped, and
tests/action-pr-comment.test.ts parses the YAML and runs the render and post
scripts under bash with shims.

1. Drift test, inverted: within the install step's executable lines, the
   `>> "$GITHUB_PATH"` write comes after `exit "$audit_status"` and before
   the `verification-ok=true` write. Mutation: move the write back above the
   audit; the test goes red.
2. Text test: the pr-render and pr-post scripts, comments stripped, contain
   no command-position `node` or `gh` token.
3. Behaviour test: run the post script with a `node` and a `gh` shim on PATH
   that record a hijack, and `NODE_BIN` and `GH_BIN` pointing at recording
   shims elsewhere. The PATH shims are never run; the poster gets
   `--gh <GH_BIN>`. With `NODE_BIN` empty, nothing runs, a warning is
   printed, and the step exits 0.
4. The tools step: run it with a PATH whose first `node` is under a fake
   prefix and whose second is elsewhere; the output names the second. It is
   the first step and has no `if:`.
5. scripts/pr-comment.mjs: `--gh <path>` is parsed and the given binary is
   the one spawned (scripts/tests/pr-comment-cli.test.mjs).

## 6. Adopter-visible change

None when the audit passes: the prefix is on PATH for the gates step exactly
as before, and the comment is posted as before. When the audit fails, the
comment says the same thing it says today. A runner with no `node` or `gh`
on PATH before the action starts gets a warning and no comment instead of a
"command not found" warning and no comment; the posting step is already
documented as needing gh.

Residual, corrected after review: a second use of the action in one job
installs into the same prefix, and the first use's GITHUB_PATH entry for it
is already live, from the start of the second use's own install step
onward. Three places resolve through it after the second `npm install -g`
has put new, not yet verified bins there:

1. The second install step itself. bash first looks up `tr`, `sed` and
   `sleep` after the install, so a planted `tr` or `sed` would run inside
   that step on a failed audit and could append `verification-ok=true` to
   GITHUB_OUTPUT, which the render step trusts. HARDENED: the install step
   now drops the gate prefix from its own PATH before running any command
   (builtins only until PATH is rebuilt), pinned by "runs nothing from the
   gate prefix inside the install step, even when an earlier use put it on
   PATH" in tests/action.test.ts.
2. The render and post steps' `shell: bash`, which the runner resolves
   through the prepended PATH (confirmed from the runner source by the
   reviewer). Nothing inside a step can protect the program that runs it.
3. The render step's `mktemp`, `rm` and `env`. Not stripped there: its
   fallback conductor run resolves the gates by name and needs the prefix.

Items 2 and 3 are documented and accepted for now. The fix is a
per-invocation prefix (for example one directory per use, published as a
step output), so no use ever inherits another's entry; recorded as an open
item.
