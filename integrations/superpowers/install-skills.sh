#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SKILLS_SRC="$ROOT/packages/skill"
DEST="${1:-$HOME/.cursor/skills}"

mkdir -p "$DEST"

for skill in intent-contract prompt-coach drift-guard; do
  rm -rf "$DEST/$skill"
  cp -r "$SKILLS_SRC/$skill" "$DEST/$skill"
  echo "Installed $skill -> $DEST/$skill"
done

echo "Done. Run pnpm build in conductor repo before using CLIs."
