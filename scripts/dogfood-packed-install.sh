#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOGFOOD="${1:-/tmp/conductor-npm-dogfood}"
VG_BIN="${VAULT_GUARD_BIN:-}"

rm -rf "$DOGFOOD"
mkdir -p "$DOGFOOD"
PACK_DIR="$(mktemp -d)"

cd "$ROOT"
pnpm release:smoke >/dev/null
for tgz in /tmp/conductor-release-smoke-*/vaultcompass-*.tgz; do
  cp "$tgz" "$PACK_DIR/" 2>/dev/null || true
done
# release-smoke uses its own temp dir; pack manually
cd "$ROOT/packages/schema" && npm pack --pack-destination "$PACK_DIR" >/dev/null
cd "$ROOT/packages/core" && npm pack --pack-destination "$PACK_DIR" >/dev/null
cd "$ROOT/packages/skill" && npm pack --pack-destination "$PACK_DIR" >/dev/null
cd "$ROOT/packages/cli" && npm pack --pack-destination "$PACK_DIR" >/dev/null

cd "$DOGFOOD"
npm init -y >/dev/null 2>&1
npm install "$PACK_DIR"/*.tgz >/dev/null 2>&1
CONDUCTOR="$DOGFOOD/node_modules/.bin/conductor"

echo "=== PACKED INSTALL (npm-like) ==="
"$CONDUCTOR" --version
"$CONDUCTOR" init --project . --human
"$CONDUCTOR" extract --project . --text "Add README install example only. Do not change source or package.json."
"$CONDUCTOR" freeze --project . --approved-by dogfood --json | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('frozen:', j.frozen)"
"$CONDUCTOR" doctor --project . 2>&1 | head -10
"$CONDUCTOR" rules audit --project . 2>&1 | head -8

git init -q
git config user.name Dogfood
git config user.email dogfood@example.invalid
echo "# Dogfood" > README.md
echo '{"name":"dogfood","version":"1.0.0"}' > package.json
git add .
git commit -qm init

echo -e "\nInstall probe" >> README.md
git add README.md
"$CONDUCTOR" check --project . --staged --signals "README documentation" --json | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('readme check:', j.status, 'drift', j.drift?.overall)"

echo "" >> package.json
git add package.json
"$CONDUCTOR" check --project . --staged --json | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('package check:', j.status, j.drift?.action)"

"$CONDUCTOR" report --project . --staged --with-secrets 2>&1 | head -22

if [[ -n "$VG_BIN" && -x "$VG_BIN" ]]; then
  echo 'const K="sk-live-abcdefghijklmnopqrstuvwxyz1234567890"' > secret.ts
  git add secret.ts
  node "$VG_BIN" scan --staged --format json | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('vault-guard secrets:', j.summary.secrets)"
fi

echo "Dogfood packed install: OK"
