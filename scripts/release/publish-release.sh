#!/usr/bin/env bash
#
# Trusted operator release command. Forgejo remains the CI authority; this
# command verifies an already-tested stable tag and creates matching
# Forgejo/GitHub Release objects. It does not publish runtime artifacts.
#
# Usage:
#   scripts/release/publish-release.sh v0.8.57
#   scripts/release/publish-release.sh v0.8.57-rc.1 --dry-run
#
# Configuration is read from SANCTUARY_RELEASE_CONFIG (default:
# ~/.config/sanctuary/forge-tokens.env) and/or the environment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CREATE_RELEASE_SCRIPT="${SANCTUARY_CREATE_RELEASE_SCRIPT:-$ROOT_DIR/scripts/create-forge-release.sh}"

TAG=""
DRY_RUN=false
TEMP_DIR=""

usage() {
  cat <<'EOF'
Usage: scripts/release/publish-release.sh <tag> [--dry-run]

Real publication accepts stable vX.Y.Z tags only. --dry-run also accepts
prerelease tags and verifies release readiness without API mutations.
EOF
}

fail() {
  echo "release publication failed: $*" >&2
  exit 1
}

# shellcheck source=scripts/release/release-operator-api.sh
source "$SCRIPT_DIR/release-operator-api.sh"

parse_args() {
  if [[ $# -lt 1 || $# -gt 2 ]]; then
    usage >&2
    exit 2
  fi
  TAG="$1"
  if [[ $# -eq 2 ]]; then
    [[ "$2" == "--dry-run" ]] || { usage >&2; exit 2; }
    DRY_RUN=true
  fi

  [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]] \
    || fail "tag must be a v-prefixed semantic version"
  if [[ "$DRY_RUN" == "false" && ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    fail "only stable tags may be published; use --dry-run for prereleases"
  fi
}

load_config() {
  local config_file="${SANCTUARY_RELEASE_CONFIG:-${HOME}/.config/sanctuary/forge-tokens.env}"
  if [[ -f "$config_file" ]]; then
    # shellcheck disable=SC1090
    source "$config_file"
  fi

  FORGEJO_URL="${FORGEJO_URL:-}"
  FORGEJO_OWNER="${FORGEJO_OWNER:-nekoguntai-castle}"
  FORGEJO_REPO="${FORGEJO_REPO:-sanctuary}"
  FORGEJO_TOKEN="${FORGEJO_TOKEN:-}"
  GITHUB_API_URL="${GITHUB_API_URL:-https://api.github.com}"
  GITHUB_OWNER="${GITHUB_OWNER:-nekoguntai-castle}"
  GITHUB_REPO="${GITHUB_REPO:-sanctuary}"
  GITHUB_RELEASE_TOKEN="${GITHUB_RELEASE_TOKEN:-}"
  require_values FORGEJO_URL FORGEJO_OWNER FORGEJO_REPO FORGEJO_TOKEN \
    GITHUB_API_URL GITHUB_OWNER GITHUB_REPO GITHUB_RELEASE_TOKEN
  reject_unsafe_tokens FORGEJO_TOKEN GITHUB_RELEASE_TOKEN
  # Keep every release credential out of child-process environments. API helpers
  # pass only the required token through curl's stdin configuration, and the
  # release-object helper receives only its two explicit credentials below.
  export -n FORGEJO_TOKEN GITHUB_RELEASE_TOKEN GHCR_USER GHCR_TOKEN \
    UMBREL_DISPATCH_TOKEN UMBREL_OWNER UMBREL_REPO
}

require_values() {
  local variable
  local missing=()
  for variable in "$@"; do
    [[ -n "${!variable:-}" ]] || missing+=("$variable")
  done
  (( ${#missing[@]} == 0 )) || fail "missing required configuration: ${missing[*]}"
}

reject_unsafe_tokens() {
  local variable
  for variable in "$@"; do
    [[ "${!variable:-}" != *$'\n'* \
      && "${!variable:-}" != *$'\r'* \
      && "${!variable:-}" != *'"'* \
      && "${!variable:-}" != *'\'* ]] \
      || fail "$variable contains a character that is unsafe in an HTTP header"
  done
}

cleanup() {
  local cleanup_status=0
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    if ! find "$TEMP_DIR" -type f -delete 2>/dev/null \
      || ! find "$TEMP_DIR" -depth -type d -empty -delete 2>/dev/null; then
      echo "release cleanup failed: temporary release files were not removed" >&2
      cleanup_status=1
    fi
  fi
  return "$cleanup_status"
}

on_exit() {
  local command_status=$?
  trap - EXIT
  if ! cleanup; then
    (( command_status != 0 )) || command_status=1
  fi
  exit "$command_status"
}

validate_checkout() {
  cd "$ROOT_DIR"
  git rev-parse --verify --quiet "refs/tags/${TAG}^{commit}" >/dev/null \
    || fail "local tag $TAG does not exist"

  local tag_commit head_commit
  tag_commit="$(git rev-parse "refs/tags/${TAG}^{commit}")"
  head_commit="$(git rev-parse HEAD)"
  [[ "$head_commit" == "$tag_commit" ]] \
    || fail "checkout must be at $TAG ($tag_commit), got $head_commit"
  [[ -z "$(git status --porcelain)" ]] || fail "release checkout must be clean"
  RELEASE_COMMIT="$tag_commit"
}

verify_wallet_safety_audit_review() {
  local previous_release evidence_path
  previous_release="$("$SCRIPT_DIR/previous-release-tag.sh" "$TAG" "$ROOT_DIR")"
  evidence_path="${SANCTUARY_WALLET_SAFETY_AUDIT_REVIEW:-}"
  local arguments=(--base "$previous_release" --head "$TAG")
  if [[ -n "$evidence_path" ]]; then
    arguments+=(--evidence "$evidence_path")
  fi
  node "$SCRIPT_DIR/verify-wallet-safety-audit-review.mjs" "${arguments[@]}" \
    || fail "wallet-safety audit review gate did not pass"
}

create_release_objects() {
  env -u GHCR_USER -u GHCR_TOKEN -u UMBREL_DISPATCH_TOKEN \
    -u UMBREL_OWNER -u UMBREL_REPO \
    SANCTUARY_FORGE_TOKENS=/dev/null \
    FORGEJO_URL="$FORGEJO_URL" \
    FORGEJO_OWNER="$FORGEJO_OWNER" \
    FORGEJO_REPO="$FORGEJO_REPO" \
    FORGEJO_TOKEN="$FORGEJO_TOKEN" \
    GITHUB_API_URL="$GITHUB_API_URL" \
    GITHUB_OWNER="$GITHUB_OWNER" \
    GITHUB_REPO="$GITHUB_REPO" \
    GITHUB_RELEASE_TOKEN="$GITHUB_RELEASE_TOKEN" \
    bash "$CREATE_RELEASE_SCRIPT" "$TAG"
}

main() {
  parse_args "$@"
  load_config
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-publish-release.XXXXXX")"
  trap on_exit EXIT
  validate_checkout
  verify_wallet_safety_audit_review
  verify_forgejo_tag
  verify_forgejo_release_gate
  verify_github_actions_disabled

  if [[ "$DRY_RUN" == "true" ]]; then
    verify_github_tag
    echo "Dry run passed for $TAG; no API mutations were performed."
    return
  fi

  ensure_github_tag
  create_release_objects
  echo "Release $TAG published to Forgejo and GitHub."
}

main "$@"
