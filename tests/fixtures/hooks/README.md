# Hook-manager fixtures

Each file here is the pre-commit hook a real hook manager generated on a
real install, captured in a scratch repository and committed. They exist
because the strings init.ts uses to recognise a generated hook are a claim
about what another tool writes, and a claim about another tool is worth
exactly as much as the run that checked it. Every one of these was captured
by installing the manager and reading the file it produced, not by
transcribing its documentation.

The manager version is in each file name, so a fixture that stops matching
a newer release is visible as a stale name rather than as a silent
disagreement.

**One redaction, applied by hand and listed here rather than left for a
reader to spot.** All three files embed an absolute path to whatever
installed them, which on the capture machine sat under a temporary
directory carrying a user name. Each such path is rewritten to sit under
`/opt/probe/` in the committed copy. Nothing else is changed, and no line
the detection depends on is touched.

## lefthook 2.1.12 and 1.7.18

    pnpm add -D lefthook@<version>
    lefthook install

with a `lefthook.yml` declaring one `pre-commit` command.

`lefthook-2.1.12-pre-commit.sh` and `lefthook-1.7.18-pre-commit.sh`.

The finding worth recording: **neither version writes a
`lefthook_version:` line.** The string does not appear in the generated
hook, and it does not appear anywhere in the 2.1.12 binary either. Both
versions do write `call_lefthook`, twice: once as the shell function they
define and once as the call at the end. So of the two strings init.ts
matched on, only the second corresponds to anything lefthook produces
today. See the comment on `detectGeneratedHook`.

## pre-commit 4.6.2

    pre-commit install

with a `.pre-commit-config.yaml` declaring one local hook.

`pre-commit-4.6.2-pre-commit.sh`. Its marker line is exactly the one
init.ts matches, and the `ID:` line below it is a constant of the
framework rather than of the repository: this capture's value is identical
to the one an earlier hand-written fixture in the suite already carried.
