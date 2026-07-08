#!/usr/bin/env bash
# Dogfood Conductor on a real application repo (Vault & Compass Tier 0 or any app).
# Usage: ./scripts/dogfood-tier0.sh /path/to/app-repo [conductor-version]
set -euo pipefail

TARGET="${1:-}"
VERSION="${2:-latest}"
VG_BIN="${VAULT_GUARD_BIN:-}"

if [[ -z "$TARGET" || ! -d "$TARGET" ]]; then
  echo "Usage: $0 /path/to/app-repo [npm-version]"
  echo "  VERSION defaults to 'latest' (@vaultcompass/conductor-cli@latest)"
  exit 1
fi

TARGET="$(cd "$TARGET" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "=== Conductor dogfood ==="
echo "Target repo: $TARGET"
echo "CLI version: $VERSION"
echo ""

cd "$WORK"
npm init -y >/dev/null 2>&1
npm install "@vaultcompass/conductor-cli@${VERSION}"
CONDUCTOR="$WORK/node_modules/.bin/conductor"

"$CONDUCTOR" --version
echo ""

echo "--- init ---"
"$CONDUCTOR" init --project "$TARGET" --human
test -f "$TARGET/.conductor/config.yaml"

echo ""
echo "--- extract (dry run) ---"
"$CONDUCTOR" extract --project "$TARGET" --dry-run --text \
  "Dogfood smoke: document one-line scope only. Do not modify source files."

echo ""
echo "Next steps (manual, in $TARGET):"
echo "  1. conductor extract --project . --text \"<real task for this app>\""
echo "  2. conductor freeze --project . --approved-by <you>"
echo "  3. Make a small aligned change, then: conductor check --project . --staged"
echo "  4. Make an out-of-scope change, confirm check blocks or warns"
echo "  5. Optional: cp integrations/git-hooks/pre-commit-with-vault-guard.sample .git/hooks/pre-commit"
echo ""
echo "See docs/release/v1-launch-checklist.md — mark dogfood items when done."

if [[ -n "$VG_BIN" && -x "$VG_BIN" ]]; then
  echo ""
  echo "vault-guard found at $VG_BIN — run paired hook sample from conductor integrations."
fi

echo ""
echo "Dogfood bootstrap: OK"
