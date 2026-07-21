#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=conductor-lib.sh
source "$SCRIPT_DIR/conductor-lib.sh"

ROOT="$(conductor_git_root)"
CHECK_CMD="$(conductor_bin "$ROOT" conductor-check || true)"

# Claude Code only hard-blocks Stop hooks on exit code 2. Exit 1 is treated as
# a non-blocking error (turn still ends). Map blocked / missing-check failures
# to 2 for lifecycle hosts. Git pre-commit uses conductor-check directly (exit 1).
lifecycle_block() {
  exit 2
}

if [[ -z "$CHECK_CMD" ]]; then
  echo "Conductor: conductor-check not found; cannot enforce intent gate." >&2
  lifecycle_block
fi

PATHS="$(conductor_changed_paths_csv "$ROOT")"

set +e
if [[ -n "$PATHS" ]]; then
  eval "$CHECK_CMD --project \"\$ROOT\" --paths \"\$PATHS\""
else
  eval "$CHECK_CMD --project \"\$ROOT\""
fi
status=$?
set -e

if [[ "$status" -ne 0 ]]; then
  lifecycle_block
fi

exit 0
