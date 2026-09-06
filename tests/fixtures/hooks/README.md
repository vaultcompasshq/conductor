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

**One redaction, applied by hand to four files and listed here rather than
left for a reader to spot.** `lefthook-2.1.12-pre-commit.sh` and
`pre-commit-4.6.2-pre-commit.sh` each embed an absolute path to what
installed them, which on the capture machine sat under a temporary
directory carrying a user name; both paths are rewritten to sit under
`/opt/probe/` in the committed copy. Both yorkie captures name the capture
machine's home directory in their `load_nvm` line, and
`yorkie-1.0.2-pre-commit.sh` names an absolute path to its own runner as
well; those are rewritten under `/opt/probe/` the same way.
`lefthook-1.7.18-pre-commit.sh` is unmodified: that version's generated
hook names no absolute path at all, which is itself one of the differences
between the two lefthook captures. The two simple-git-hooks captures are
unmodified as well. Nothing else is changed in any file here, and no line
the detection depends on is touched.

**One file here is not another tool's.** `conductor-0.2.0-pre-commit.sh` is
conductor's own hook body as v0.2 shipped it, the bytes actually sitting in
the repositories that installed it. It is kept because changing the body
makes every one of those hooks a hook "from an older conductor", and the
upgrade path that recognises them works on the digest of the previous body:
a synthetic stand-in tests the mechanism, and only the real bytes test the
upgrade those repositories will actually take. It carries the old message
that named a bypass flag, which is the thing that changed; the test that
reads it asserts it is NOT what init writes today, so the fixture cannot
quietly drift into being the current body and pass for the wrong reason.

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

## simple-git-hooks 2.14.0 and 2.8.0

    pnpm add -D simple-git-hooks@<version>
    pnpm exec simple-git-hooks

with a top-level `"simple-git-hooks": { "pre-commit": "npx lint-staged" }`
key in package.json.

**package.json is not the only home for that declaration.** The tool's own
README also reads `.simple-git-hooks.cjs`, `.simple-git-hooks.js`,
`.simple-git-hooks.mjs`, `.simple-git-hooks.json`, and
`simple-git-hooks.{cjs,js,mjs,json}`. init.ts treats any of those at the
repository root as the declaration too, and that is not belt and braces:
a repository configured through one of them AND installed with a version
old enough to write no marker has nothing else to recognise it by.

`simple-git-hooks-2.14.0-pre-commit.sh` and
`simple-git-hooks-2.8.0-pre-commit.sh`.

The finding worth recording, and the reason init.ts reads package.json at
all: **2.8.0 writes no marker of any kind.** Its whole generated hook is
`#!/bin/sh` and the user's own command, so there is no string in that file
that belongs to simple-git-hooks and no content rule can recognise it. The
`SKIP_SIMPLE_GIT_HOOKS` opt-out that 2.14.0 tests on its first line arrived
somewhere between the two; 2.11.1 was installed during the same capture
session and carries it as well, differing from 2.14.0 only in blank lines,
which is why it is not committed here. A repository on an older version is
identifiable only by the package.json key.

## yorkie 2.0.0 and 1.0.2

    npm install --save-dev yorkie@<version>

with a top-level `"gitHooks": { "pre-commit": "lint-staged" }` key. yorkie
installs from its own postinstall script and has no CLI to run afterwards.
npm rather than pnpm on purpose: under pnpm's store layout the installer
finds itself inside a nested `node_modules` and skips the installation,
saying so, which is a capture of nothing.

`yorkie-2.0.0-pre-commit.sh` and `yorkie-1.0.2-pre-commit.sh`.

Two things worth recording. **The path to the runner differs between the
versions**: 2.0.0 writes `./node_modules/yorkie/src/runner.js` relative,
1.0.2 writes the same suffix under an absolute path, so the suffix is what
both captures have in common and what init.ts matches. **The generated hook
collapses every non-zero exit into 1**, in both versions, with
`... || { echo; echo "pre-commit hook failed"; exit 1; }`. That is the
claim the refusal guidance makes to a yorkie user about the umbrella's exit
2, and a test holds it against these files rather than against anybody's
memory of them.
