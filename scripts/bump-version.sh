#!/bin/bash
#
# Version Bump Script
#
# Updates version across all package.json files. Release distribution is an
# operator-owned step after Forgejo tag CI succeeds; Forgejo Actions never
# publishes images, creates releases, or dispatches sanctuary-umbrel.
#
# Usage:
#   ./scripts/bump-version.sh 0.7.20      # Set explicit version
#   ./scripts/bump-version.sh patch       # 0.7.19 -> 0.7.20
#   ./scripts/bump-version.sh minor       # 0.7.19 -> 0.8.0
#   ./scripts/bump-version.sh major       # 0.7.19 -> 1.0.0
#   ./scripts/bump-version.sh --check     # Check if all versions are in sync
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PACKAGE_FILES=(
  package.json
  server/package.json
  gateway/package.json
  llm-egress-proxy/package.json
)

get_version() {
  local file=$1
  grep '"version"' "$file" | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/'
}

check_versions() {
  local root_ver=$(get_version "package.json")
  local all_match=true

  echo -e "${YELLOW}Checking version sync...${NC}"
  echo ""

  for file in "${PACKAGE_FILES[@]}"; do
    local ver=$(get_version "$file")
    if [[ "$ver" == "$root_ver" ]]; then
      echo -e "  ${GREEN}✓${NC} $file: $ver"
    else
      echo -e "  ${RED}✗${NC} $file: $ver (expected $root_ver)"
      all_match=false
    fi
  done

  echo ""
  if $all_match; then
    echo -e "${GREEN}All versions are in sync: $root_ver${NC}"
    return 0
  else
    echo -e "${RED}Version mismatch detected!${NC}"
    echo "Run: ./scripts/bump-version.sh $root_ver"
    return 1
  fi
}

calc_version() {
  local current=$1
  local bump=$2
  IFS='.' read -r major minor patch <<< "$current"

  case "$bump" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "$major.$((minor + 1)).0" ;;
    patch) echo "$major.$minor.$((patch + 1))" ;;
    *)     echo "$bump" ;;
  esac
}

# Show help
if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <version|patch|minor|major|--check>"
  echo ""
  echo "Examples:"
  echo "  $0 0.7.20    # Set explicit version"
  echo "  $0 patch     # Bump patch (0.7.19 -> 0.7.20)"
  echo "  $0 minor     # Bump minor (0.7.19 -> 0.8.0)"
  echo "  $0 major     # Bump major (0.7.19 -> 1.0.0)"
  echo "  $0 --check   # Check if all versions are in sync"
  exit 1
fi

# Check mode
if [[ "$1" == "--check" ]]; then
  check_versions
  exit $?
fi

# Calculate new version
CURRENT=$(get_version "package.json")
NEW_VERSION=$(calc_version "$CURRENT" "$1")

# Validate version format
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo -e "${RED}Error: Invalid version format: $NEW_VERSION${NC}"
  echo "Version must be in format X.Y.Z (e.g., 0.7.20)"
  exit 1
fi

echo -e "${YELLOW}Bumping version: $CURRENT -> $NEW_VERSION${NC}"
echo ""

# Update package.json AND its package-lock.json atomically per package, without re-resolving
# dependencies. `npm version --no-git-tag-version` only touches the version fields; it does not
# rewrite peer-dep resolutions the way `npm install --package-lock-only` does (the latter
# silently dropped @bitcoinerlab/descriptors-core peer-optional resolutions in v0.8.47).
PKG_DIRS=(. server gateway llm-egress-proxy)
for dir in "${PKG_DIRS[@]}"; do
  if [ -f "$dir/package.json" ]; then
    (cd "$dir" && npm version --no-git-tag-version --allow-same-version "$NEW_VERSION" > /dev/null)
    echo -e "  ${GREEN}✓${NC} $dir/package.json + package-lock.json"
  fi
done

echo ""
echo -e "${GREEN}Version updated to $NEW_VERSION${NC}"
echo ""
echo "This script only updates package.json files. The full release flow"
echo "(local validation, upgrade-test audit, PR through Forgejo, tag, CI"
echo "monitoring on Forgejo Actions, then operator-owned GitHub/GHCR distribution) lives"
echo "in the /release skill at .claude/commands/release.md — invoke that"
echo "for an end-to-end release rather than driving these steps by hand."
echo ""
echo "Quick reference for the manual path (origin = Forgejo; main is PR-only):"
echo "  1. bash scripts/quality/check-lockfile-peer-resolution.sh   # verify lockfile"
echo "  2. git checkout -b chore/bump-version-$NEW_VERSION"
echo "  3. git add -A && git commit -m 'chore: bump version to $NEW_VERSION'"
echo "  4. git push origin chore/bump-version-$NEW_VERSION"
echo "  5. Open PR via Forgejo API/UI, wait for CI, merge (squash)"
echo "  6. git checkout main && git pull --ff-only origin main"
echo "  7. git tag v$NEW_VERSION-rc1 && git push origin v$NEW_VERSION-rc1   # RC smoke"
echo "  8. After RC CI is green: git tag v$NEW_VERSION && git push origin v$NEW_VERSION"
echo "  9. Wait for stable-tag CI, then run: npm run release:publish -- v$NEW_VERSION"
echo ""
echo "The trusted operator command publishes GitHub Releases and GHCR images,"
echo "then dispatches the local sanctuary-umbrel updater after digest verification."
