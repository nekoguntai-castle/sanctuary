#!/bin/bash
#
# Create matching Release objects on Forgejo and GitHub for a tag that already
# exists on both repositories. Release notes are derived from the bounded commit
# log between the prior tag and this one.
#
# Usage:
#   ./scripts/create-forge-release.sh v0.8.50
#   ./scripts/create-forge-release.sh v0.8.50-rc1
#
# Auth: tokens are read from ~/.config/sanctuary/forge-tokens.env or env vars.
# The following values are required:
#
#   FORGEJO_URL=https://forgejo.example.invalid
#   FORGEJO_OWNER=nekoguntai-castle
#   FORGEJO_REPO=sanctuary
#   FORGEJO_TOKEN=...
#
#   GITHUB_API_URL=https://api.github.com
#   GITHUB_OWNER=nekoguntai-castle
#   GITHUB_REPO=sanctuary
#   GITHUB_RELEASE_TOKEN=...
#
# Tags matching -rc / -alpha / -beta / -dev are marked as prereleases.

set -euo pipefail

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

if ! git rev-parse --verify --quiet "${TAG}^{commit}" >/dev/null; then
  echo -e "${RED}Error: tag '$TAG' does not exist locally${NC}"
  exit 1
fi

CONFIG_FILE="${SANCTUARY_FORGE_TOKENS:-${HOME}/.config/sanctuary/forge-tokens.env}"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

FORGEJO_URL="${FORGEJO_URL:-}"
FORGEJO_OWNER="${FORGEJO_OWNER:-}"
FORGEJO_REPO="${FORGEJO_REPO:-}"
FORGEJO_TOKEN="${FORGEJO_TOKEN:-}"

GITHUB_API_URL="${GITHUB_API_URL:-https://api.github.com}"
GITHUB_OWNER="${GITHUB_OWNER:-}"
GITHUB_REPO="${GITHUB_REPO:-}"
GITHUB_RELEASE_TOKEN="${GITHUB_RELEASE_TOKEN:-}"

require_config() {
  local missing=()
  local variable

  for variable in \
    FORGEJO_URL FORGEJO_OWNER FORGEJO_REPO FORGEJO_TOKEN \
    GITHUB_API_URL GITHUB_OWNER GITHUB_REPO GITHUB_RELEASE_TOKEN; do
    if [[ -z "${!variable}" ]]; then
      missing+=("$variable")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    echo -e "${RED}Error: missing required release configuration:${NC} ${missing[*]}" >&2
    return 1
  fi
}

require_config

for token_variable in FORGEJO_TOKEN GITHUB_RELEASE_TOKEN; do
  [[ "${!token_variable}" != *$'\n'* \
    && "${!token_variable}" != *$'\r'* \
    && "${!token_variable}" != *'"'* \
    && "${!token_variable}" != *'\'* ]] \
    || {
      echo -e "${RED}Error: ${token_variable} contains an unsafe HTTP-header character${NC}" >&2
      exit 1
    }
done
export -n FORGEJO_TOKEN GITHUB_RELEASE_TOKEN

PRERELEASE=false
if [[ "$TAG" =~ -(rc|alpha|beta|dev) ]]; then
  PRERELEASE=true
fi

# Stable releases measure from the previous STABLE tag, not the nearest one
# (which is their own RC). Shared with prepare-release-assets.mjs so the Release
# body and the signed release-notes.md asset cannot drift apart. See #720.
PREV_TAG="$("$SCRIPT_DIR/release/previous-release-tag.sh" "$TAG" "$ROOT_DIR")"
if [[ -n "$PREV_TAG" ]]; then
  BODY="$(git log --oneline --no-decorate -n 100 "${PREV_TAG}..${TAG}")"
else
  BODY="$(git log --oneline --no-decorate -n 20 "$TAG")"
fi
[[ -n "$BODY" ]] || BODY="Tag: ${TAG}"

PAYLOAD="$(TAG="$TAG" PRERELEASE="$PRERELEASE" BODY="$BODY" python3 - <<'PY'
import json
import os

print(json.dumps({
    "tag_name": os.environ["TAG"],
    "name": os.environ["TAG"],
    "body": os.environ["BODY"],
    "draft": False,
    "prerelease": os.environ["PRERELEASE"] == "true",
}))
PY
)"

GITHUB_PAYLOAD="$(printf '%s' "$PAYLOAD" | jq -c \
  --arg make_latest "$([[ "$PRERELEASE" == "false" ]] && printf true || printf false)" \
  '. + {make_latest: $make_latest}')"

ENCODED_TAG="$(TAG="$TAG" python3 - <<'PY'
import os
import urllib.parse

print(urllib.parse.quote(os.environ["TAG"], safe=""))
PY
)"

RESPONSE_FILE="$(mktemp "${TMPDIR:-/tmp}/sanctuary-release-response.XXXXXX")"
trap 'rm -f "$RESPONSE_FILE"' EXIT

request() {
  local auth_header="$1"
  local method="$2"
  local url="$3"
  shift 3
  local http_code

  if http_code="$(printf 'header = \"Authorization: %s\"\\n' "$auth_header" \
    | curl --config - -sS -o "$RESPONSE_FILE" -w "%{http_code}" \
      --max-time 30 \
      -X "$method" \
      "$@" \
      "$url")"; then
    echo "$http_code"
    return 0
  fi

  echo "${http_code:-000}"
  return 1
}

report_failure() {
  local name="$1"
  local operation="$2"
  local http_code="$3"

  echo -e "  ${RED}✗${NC} $name: $operation failed (HTTP $http_code)" >&2
  sed -n '1,3p' "$RESPONSE_FILE" 2>/dev/null | sed 's/^/      /' >&2
}

release_matches_payload() {
  local expected_payload="$1"
  jq -e --argjson expected "$expected_payload" \
    '.tag_name == $expected.tag_name
      and .name == $expected.name
      and .body == $expected.body
      and .draft == $expected.draft
      and .prerelease == $expected.prerelease' \
    "$RESPONSE_FILE" >/dev/null
}

accept_existing_release() {
  local name="$1"
  local expected_payload="$2"
  if release_matches_payload "$expected_payload"; then
    LAST_RELEASE_ID="$(jq -r '.id // empty' "$RESPONSE_FILE")"
    echo -e "  ${YELLOW}~${NC} $name: matching release already exists, skipping"
    return 0
  fi
  echo -e "  ${RED}✗${NC} $name: existing release metadata does not match the canonical payload" >&2
  return 1
}

create_release() {
  local name="$1"
  local releases_url="$2"
  local auth_header="$3"
  local payload="$4"
  shift 4
  local headers=("$@")
  local lookup_code
  local create_code

  if ! lookup_code="$(request "$auth_header" GET "${releases_url}/tags/${ENCODED_TAG}" "${headers[@]}")"; then
    report_failure "$name" "tag lookup" "$lookup_code"
    return 1
  fi

  if [[ "$lookup_code" == "200" ]]; then
    accept_existing_release "$name" "$payload"
    return
  fi

  if [[ "$lookup_code" != "404" ]]; then
    report_failure "$name" "tag lookup" "$lookup_code"
    return 1
  fi

  if ! create_code="$(request "$auth_header" POST "$releases_url" \
    "${headers[@]}" \
      -H "Content-Type: application/json" \
      -d "$payload")"; then
    report_failure "$name" "release creation" "$create_code"
    return 1
  fi

  if [[ "$create_code" =~ ^2 ]]; then
    LAST_RELEASE_ID="$(jq -r '.id // empty' "$RESPONSE_FILE")"
    echo -e "  ${GREEN}✓${NC} $name: created (HTTP $create_code)"
    return 0
  fi

  # A concurrent publisher may create the release after our initial lookup.
  if [[ "$create_code" == "409" || "$create_code" == "422" ]]; then
    if lookup_code="$(request "$auth_header" GET "${releases_url}/tags/${ENCODED_TAG}" "${headers[@]}")" \
      && [[ "$lookup_code" == "200" ]]; then
      accept_existing_release "$name" "$payload"
      return
    fi
  fi

  report_failure "$name" "release creation" "$create_code"
  return 1
}

promote_github_latest() {
  [[ "$PRERELEASE" == "false" ]] || return 0
  [[ -n "${LAST_RELEASE_ID:-}" ]] || {
    echo -e "  ${RED}✗${NC} GitHub: release response did not include an id" >&2
    return 1
  }

  local releases_url="${GITHUB_API_URL%/}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases"
  local headers=(-H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
  local update_code latest_code
  if ! update_code="$(request "Bearer ${GITHUB_RELEASE_TOKEN}" PATCH \
    "${releases_url}/${LAST_RELEASE_ID}" "${headers[@]}" \
    -H "Content-Type: application/json" -d '{"make_latest":"true"}')" \
    || [[ ! "$update_code" =~ ^2 ]]; then
    report_failure "GitHub" "latest promotion" "$update_code"
    return 1
  fi
  if ! latest_code="$(request "Bearer ${GITHUB_RELEASE_TOKEN}" GET \
    "${releases_url}/latest" "${headers[@]}")" \
    || [[ "$latest_code" != "200" ]]; then
    report_failure "GitHub" "latest verification" "$latest_code"
    return 1
  fi
  if ! jq -e --arg tag "$TAG" '.tag_name == $tag' "$RESPONSE_FILE" >/dev/null; then
    echo -e "  ${RED}✗${NC} GitHub: /releases/latest does not resolve to ${TAG}" >&2
    return 1
  fi
  echo -e "  ${GREEN}✓${NC} GitHub: latest release verified"
}

echo -e "${YELLOW}Creating release for ${TAG}${NC}"
echo "  prerelease: $PRERELEASE"
echo "  prev tag:   ${PREV_TAG:-(none)}"
echo "  body lines: $(printf '%s\n' "$BODY" | wc -l)"
echo ""

result=0
if ! create_release \
  "Forgejo" \
  "${FORGEJO_URL%/}/api/v1/repos/${FORGEJO_OWNER}/${FORGEJO_REPO}/releases" \
  "token ${FORGEJO_TOKEN}" \
  "$PAYLOAD" \
  -H "Accept: application/json"; then
  result=1
fi

if ! create_release \
  "GitHub" \
  "${GITHUB_API_URL%/}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases" \
  "Bearer ${GITHUB_RELEASE_TOKEN}" \
  "$GITHUB_PAYLOAD" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28"; then
  result=1
fi

if (( result == 0 )) && ! promote_github_latest; then
  result=1
fi

if (( result != 0 )); then
  echo -e "\n${RED}Release creation failed.${NC}" >&2
  exit "$result"
fi

echo -e "\n${GREEN}Done.${NC}"
