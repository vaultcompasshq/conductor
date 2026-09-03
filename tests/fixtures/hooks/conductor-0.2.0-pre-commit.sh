#!/bin/sh
# Guardrail pre-commit hook. guardrails-managed-hook: v1
# Installed by "conductor init". Remove it with "conductor init --revert".
#
# No "set -e" of its own, and written to survive somebody else's. Under
# "set -e" a shell exits at the failing command before its status can be
# captured, which keeps the exit code but loses the explanatory line, so a
# blocked commit prints nothing about why. husky's dispatcher runs this
# file as "sh -e", so every command allowed to fail is in a condition
# context rather than standing alone.
#
# "command -v" rather than "which": "which" is not in POSIX, is absent from
# some minimal images, and reports success in some shells for a builtin
# that is not an executable.

# A conductor installed only as a devDependency of this repository is not
# on PATH, and was invisible to its own hook until this line existed: every
# commit reported the umbrella missing and blocked, which is the right
# answer to the wrong question. The root comes from git rather than from
# the working directory: git runs a pre-commit hook from the top level
# today, but a hook invoked by hand or by another manager can start in a
# subdirectory, where a relative "node_modules/.bin" points at nothing.
conductor_no_git=0
if command -v git >/dev/null 2>&1; then
  conductor_root=$(git rev-parse --show-toplevel 2>/dev/null) || conductor_root=""
  if [ -n "$conductor_root" ] && [ -d "$conductor_root/node_modules/.bin" ]; then
    PATH="$conductor_root/node_modules/.bin:$PATH"
    export PATH
  fi
else
  # Without git the root cannot be found, so node_modules/.bin cannot be
  # looked in, so a conductor installed only there is invisible. That is a
  # different fact from "conductor is not installed", and saying the second
  # one sends the reader off to reinstall a tool that may already be sitting
  # in the repository.
  conductor_no_git=1
fi

if ! command -v conductor >/dev/null 2>&1; then
  if [ "$conductor_no_git" -eq 1 ]; then
    echo "conductor: git is not on this hook's PATH, so the repository's node_modules/.bin could not be located and no conductor was found there or on PATH. This commit was NOT checked by any guardrail gate." >&2
  else
    echo "conductor: command not found, so this commit was NOT checked by any guardrail gate. Install the umbrella, or run 'conductor init --revert' to remove this hook." >&2
  fi
  exit 1
fi

# --stage commit, not every stage. A pre-commit hook IS the commit stopping
# point, and the gates are split across stopping points on ceremony rather
# than on runtime: the dependency and secret gates are silent until they
# find something, while the intent gate wants a contract approved before the
# work starts, which is a per-task human step and belongs at a pull request.
# Running everything here is what makes a team disable the hook.
conductor_status=0
conductor run --staged --stage commit || conductor_status=$?

if [ "$conductor_status" -ne 0 ]; then
  echo "conductor: commit blocked (conductor exit $conductor_status). Review the report above; 'git commit --no-verify' bypasses this hook at your own risk." >&2
fi

# Passed straight through. 1 means a gate blocked; 2 means a gate could not
# run at all. Collapsing 2 into 1 would report findings never looked for.
exit "$conductor_status"
