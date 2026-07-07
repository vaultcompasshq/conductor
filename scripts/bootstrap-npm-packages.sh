#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGES=(
  "packages/schema"
  "packages/core"
  "packages/skill"
  "packages/cli"
)

echo "Bootstrap first publish for @vaultcompass/conductor-*"
echo "Requires: npm login with publish access to @vaultcompass"
echo ""

if ! npm whoami >/dev/null 2>&1; then
  echo "Not logged in. Run: npm login"
  exit 1
fi

echo "Logged in as: $(npm whoami)"
cd "$ROOT"
pnpm build
pnpm release:smoke

for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "Publishing ${pkg}..."
  (cd "$ROOT/$pkg" && pnpm publish --access public --tag beta)
done

cat <<'EOF'

Next on npmjs.com (each package -> Settings -> Trusted Publisher):
  Publisher: GitHub Actions
  Organization or user: vaultcompasshq
  Repository: conductor
  Workflow filename: release.yml

Then re-run the Release workflow or push the tag again:
  git tag -d v0.3.0-beta && git push origin :refs/tags/v0.3.0-beta
  git tag v0.3.0-beta && git push origin v0.3.0-beta
EOF
