#!/usr/bin/env bash

set -euo pipefail

conductor_git_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

conductor_bin() {
  local root="$1"
  local name="$2"
  local dist="$root/packages/skill/dist/${name#conductor-}-cli.js"

  if [[ -f "$dist" ]]; then
    printf 'node %q' "$dist"
    return 0
  fi

  if command -v "$name" >/dev/null 2>&1; then
    printf '%q' "$name"
    return 0
  fi

  return 1
}

conductor_changed_paths_csv() {
  local root="$1"
  local paths

  paths=$(
    {
      git -C "$root" diff --name-only --cached 2>/dev/null || true
      git -C "$root" diff --name-only 2>/dev/null || true
    } | awk 'NF && !seen[$0]++'
  )

  if [[ -z "$paths" ]]; then
    return 0
  fi

  paste -sd, <<<"$paths"
}
