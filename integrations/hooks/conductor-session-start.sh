#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=conductor-lib.sh
source "$SCRIPT_DIR/conductor-lib.sh"

ROOT="$(conductor_git_root)"
RESUME_CMD="$(conductor_bin "$ROOT" conductor-resume || true)"

if [[ -z "$RESUME_CMD" ]]; then
  echo "Conductor: conductor-resume not found; skipping session brief." >&2
  exit 0
fi

if [[ ! -f "$ROOT/.conductor/intent-contract.yaml" ]]; then
  echo "Conductor: no active intent contract found."
  exit 0
fi

echo "Conductor session brief:"
eval "$RESUME_CMD --project \"\$ROOT\""
