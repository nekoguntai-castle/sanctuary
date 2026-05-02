#!/bin/bash
#
# Create matching Release objects on Forgejo and Codeberg for a tag that
# already exists on each instance. Body is auto-derived from the commit
# log between the prior tag and this one (same shape as the historical
# backfill).
#
# Usage:
#   ./scripts/create-forge-release.sh v0.8.50
#   ./scripts/create-forge-release.sh v0.8.50-rc1
#
# Auth: tokens read from ~/.config/sanctuary/forge-tokens.env or env vars.
# Format of the file:
#
#   FORGEJO_URL=http://10.14.23.20:3000
#   FORGEJO_OWNER=nekoguntai
#   FORGEJO_REPO=sanctuary
#   FORGEJO_TOKEN=...
#
#   CODEBERG_URL=https://codeberg.org
#   CODEBERG_OWNER=nekoguntai-castle
#   CODEBERG_REPO=sanctuary
#   CODEBERG_TOKEN=...
#
# Tags marked prerelease automatically when matching -rc / -alpha / -beta / -dev.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <tag-name>"
  echo "Example: $0 v0.8.50"
  exit 1
fi

TAG="$1"

if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  echo -e "${RED}Error: tag '$TAG' does not exist locally${NC}"
  exit 1
fi

CONFIG_FILE="${SANCTUARY_FORGE_TOKENS:-$HOME/.config/sanctuary/forge-tokens.env}"
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; source "$CONFIG_FILE"; set +a
fi

FORGEJO_URL="${FORGEJO_URL:-}"
FORGEJO_OWNER="${FORGEJO_OWNER:-}"
FORGEJO_REPO="${FORGEJO_REPO:-}"
FORGEJO_TOKEN="${FORGEJO_TOKEN:-}"

CODEBERG_URL="${CODEBERG_URL:-https://codeberg.org}"
CODEBERG_OWNER="${CODEBERG_OWNER:-}"
CODEBERG_REPO="${CODEBERG_REPO:-}"
CODEBERG_TOKEN="${CODEBERG_TOKEN:-}"

# prerelease detection
PRERELEASE=false
if [[ "$TAG" =~ -(rc|alpha|beta|dev) ]]; then
  PRERELEASE=true
fi

# body = oneline log since previous tag
PREV_TAG=$(git describe --tags --abbrev=0 "${TAG}^" 2>/dev/null || echo "")
if [ -n "$PREV_TAG" ]; then
  BODY=$(git log --oneline --no-decorate "${PREV_TAG}..${TAG}" | head -100)
else
  BODY=$(git log --oneline --no-decorate "${TAG}" | head -20)
fi
[ -z "$BODY" ] && BODY="Tag: ${TAG}"

echo -e "${YELLOW}Creating release for ${TAG}${NC}"
echo "  prerelease: $PRERELEASE"
echo "  prev tag:   ${PREV_TAG:-(none)}"
echo "  body lines: $(echo "$BODY" | wc -l)"
echo ""

# JSON payload — escape body via python (handles newlines/quotes/backslashes safely)
PAYLOAD=$(TAG="$TAG" PRERELEASE="$PRERELEASE" BODY="$BODY" python3 - <<'PY'
import json, os
print(json.dumps({
    "tag_name": os.environ["TAG"],
    "name": os.environ["TAG"],
    "body": os.environ["BODY"],
    "draft": False,
    "prerelease": os.environ["PRERELEASE"] == "true",
}))
PY
)

post_release() {
  local NAME="$1" URL="$2" TOKEN="$3" OWNER="$4" REPO="$5"

  if [ -z "$TOKEN" ] || [ -z "$URL" ] || [ -z "$OWNER" ] || [ -z "$REPO" ]; then
    echo -e "  ${YELLOW}skip $NAME${NC} (missing config: URL/OWNER/REPO/TOKEN)"
    return 0
  fi

  HTTP_CODE=$(curl -sS -o /tmp/forge-release-resp.$$ -w "%{http_code}" \
    -H "Authorization: token ${TOKEN}" \
    -H "Content-Type: application/json" \
    -X POST "${URL}/api/v1/repos/${OWNER}/${REPO}/releases" \
    --max-time 30 \
    -d "$PAYLOAD")

  if [[ "$HTTP_CODE" =~ ^2 ]]; then
    echo -e "  ${GREEN}✓${NC} $NAME: created (HTTP $HTTP_CODE)"
    rm -f /tmp/forge-release-resp.$$
    return 0
  fi

  if [ "$HTTP_CODE" = "409" ] || grep -qi "already exists" /tmp/forge-release-resp.$$ 2>/dev/null; then
    echo -e "  ${YELLOW}~${NC} $NAME: release already exists, skipping"
    rm -f /tmp/forge-release-resp.$$
    return 0
  fi

  echo -e "  ${RED}✗${NC} $NAME: HTTP $HTTP_CODE"
  cat /tmp/forge-release-resp.$$ 2>/dev/null | head -3 | sed 's/^/      /'
  rm -f /tmp/forge-release-resp.$$
  return 1
}

post_release "Forgejo " "$FORGEJO_URL"  "$FORGEJO_TOKEN"  "$FORGEJO_OWNER"  "$FORGEJO_REPO"
post_release "Codeberg" "$CODEBERG_URL" "$CODEBERG_TOKEN" "$CODEBERG_OWNER" "$CODEBERG_REPO"

echo ""
echo -e "${GREEN}Done.${NC}"
