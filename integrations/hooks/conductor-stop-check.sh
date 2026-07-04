#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=conductor-lib.sh
source "$SCRIPT_DIR/conductor-lib.sh"

ROOT="$(conductor_git_root)"
CHECK_CMD="$(conductor_bin "$ROOT" conductor-check || true)"

if [[ -z "$CHECK_CMD" ]]; then
  echo "Conductor: conductor-check not found; cannot enforce intent gate." >&2
  exit 1
fi

PATHS="$(conductor_changed_paths_csv "$ROOT")"

if [[ -n "$PATHS" ]]; then
  eval "$CHECK_CMD --project \"\$ROOT\" --paths \"\$PATHS\""
else
  eval "$CHECK_CMD --project \"\$ROOT\""
fi
