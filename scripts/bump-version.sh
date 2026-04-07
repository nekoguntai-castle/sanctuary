#!/bin/bash
#
# Version Bump Script
#
# Updates version across all package files and umbrel config.
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

get_version() {
  local file=$1
  if [[ "$file" == *.yml ]]; then
    grep '^version:' "$file" | sed 's/version: "\([^"]*\)"/\1/'
  else
    grep '"version"' "$file" | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/'
  fi
}

get_umbrel_image_versions() {
  local image=$1
  grep "ghcr.io/nekoguntai/sanctuary-${image}:v" sanctuary/docker-compose.yml \
    | sed -E 's/.*sanctuary-[^:]+:v([0-9]+\.[0-9]+\.[0-9]+).*/\1/' \
    | sort -u
}

check_versions() {
  local root_ver=$(get_version "package.json")
  local all_match=true
  local frontend_versions
  local backend_versions

  echo -e "${YELLOW}Checking version sync...${NC}"
  echo ""

  for file in package.json server/package.json gateway/package.json ai-proxy/package.json sanctuary/umbrel-app.yml; do
    local ver=$(get_version "$file")
    if [[ "$ver" == "$root_ver" ]]; then
      echo -e "  ${GREEN}✓${NC} $file: $ver"
    else
      echo -e "  ${RED}✗${NC} $file: $ver (expected $root_ver)"
      all_match=false
    fi
  done

  frontend_versions=$(get_umbrel_image_versions "frontend" | paste -sd ', ' -)
  backend_versions=$(get_umbrel_image_versions "backend" | paste -sd ', ' -)

  if [[ "$frontend_versions" == "$root_ver" ]]; then
    echo -e "  ${GREEN}✓${NC} sanctuary/docker-compose.yml frontend image: $frontend_versions"
  else
    echo -e "  ${RED}✗${NC} sanctuary/docker-compose.yml frontend image: ${frontend_versions:-missing} (expected $root_ver)"
    all_match=false
  fi

  if [[ "$backend_versions" == "$root_ver" ]]; then
    echo -e "  ${GREEN}✓${NC} sanctuary/docker-compose.yml backend images: $backend_versions"
  else
    echo -e "  ${RED}✗${NC} sanctuary/docker-compose.yml backend images: ${backend_versions:-missing} (expected $root_ver)"
    all_match=false
  fi

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

# Update all package.json files
for file in package.json server/package.json gateway/package.json ai-proxy/package.json; do
  sed -i "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$NEW_VERSION\"/" "$file"
  echo -e "  ${GREEN}✓${NC} $file"
done

# Update umbrel-app.yml
sed -i "s/^version: \"[0-9]*\.[0-9]*\.[0-9]*\"/version: \"$NEW_VERSION\"/" sanctuary/umbrel-app.yml
echo -e "  ${GREEN}✓${NC} sanctuary/umbrel-app.yml"

# Update release notes date
TODAY=$(date +%Y-%m-%d)
sed -i "s/releaseNotes: \"Version [0-9]*\.[0-9]*\.[0-9]* released on [0-9-]*/releaseNotes: \"Version $NEW_VERSION released on $TODAY/" sanctuary/umbrel-app.yml
echo -e "  ${GREEN}✓${NC} Updated release notes date"

echo ""
echo -e "${GREEN}Version updated to $NEW_VERSION${NC}"
echo ""
echo "Next steps:"
echo "  1. Update lock files:"
echo "     npm install --package-lock-only"
echo "     cd server && npm install --package-lock-only"
echo "     cd gateway && npm install --package-lock-only"
echo "  2. Update sanctuary/docker-compose.yml image tags to v$NEW_VERSION"
echo "     with the matching GHCR digests once the images are published"
echo "  3. Commit: git add -A && git commit -m 'Bump version to $NEW_VERSION'"
echo "  4. Tag: git tag v$NEW_VERSION"
echo "  5. Push: git push origin main --tags"
echo ""
echo "NOTE: ./scripts/bump-version.sh --check now verifies the Umbrel image tags"
echo "      in sanctuary/docker-compose.yml match the release version."
