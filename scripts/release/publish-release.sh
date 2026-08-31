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
if [[ -f "$ROOT_DIR/scripts/ownership/producer-hooks.sh" ]]; then
  # shellcheck source=scripts/ownership/producer-hooks.sh
  . "$ROOT_DIR/scripts/ownership/producer-hooks.sh"
fi

TAG=""
DRY_RUN=false
TEMP_DIR=""
CANDIDATE_TAG=""
CANARY_RECEIPT=""
CANARY_EVIDENCE=""
REHEARSAL_MANIFEST=""
RELEASE_PUBLIC_KEY=""

usage() {
  cat <<'EOF'
Usage: scripts/release/publish-release.sh <tag> [--dry-run] [promotion evidence]

Real publication accepts stable vX.Y.Z tags only. --dry-run also accepts
prerelease tags and verifies release readiness without API mutations. Stable
publication requires --candidate, --receipt, --evidence, --rehearsal-manifest,
and --public-key from the accepted pre-stable promotion.
EOF
}

fail() {
  echo "release publication failed: $*" >&2
  exit 1
}

# shellcheck source=scripts/release/release-operator-api.sh
source "$SCRIPT_DIR/release-operator-api.sh"

parse_args() {
  if [[ $# -lt 1 ]]; then
    usage >&2
    exit 2
  fi
  TAG="$1"; shift
  DRY_RUN=false
  CANDIDATE_TAG=""; CANARY_RECEIPT=""; CANARY_EVIDENCE=""
  REHEARSAL_MANIFEST=""; RELEASE_PUBLIC_KEY=""
  while (( $# > 0 )); do
    case "$1" in
      --dry-run) DRY_RUN=true; shift ;;
      --candidate) CANDIDATE_TAG="${2:-}"; shift 2 ;;
      --receipt) CANARY_RECEIPT="${2:-}"; shift 2 ;;
      --evidence) CANARY_EVIDENCE="${2:-}"; shift 2 ;;
      --rehearsal-manifest) REHEARSAL_MANIFEST="${2:-}"; shift 2 ;;
      --public-key) RELEASE_PUBLIC_KEY="${2:-}"; shift 2 ;;
      *) usage >&2; exit 2 ;;
    esac
  done

  [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]] \
    || fail "tag must be a v-prefixed semantic version"
  if [[ "$DRY_RUN" == "false" && ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    fail "only stable tags may be published; use --dry-run for prereleases"
  fi
  if [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    local candidate_number="${CANDIDATE_TAG#"$TAG-rc"}"
    [[ "$CANDIDATE_TAG" == "$TAG-rc"* && "$candidate_number" =~ ^[1-9][0-9]*$ \
      && "$CANARY_RECEIPT" == /* && "$CANARY_EVIDENCE" == /* \
      && "$REHEARSAL_MANIFEST" == /* && "$RELEASE_PUBLIC_KEY" == /* ]] \
      || fail "stable publication requires explicit accepted RC, canary, rehearsal manifest, and public key paths"
  fi
}

verify_promotion_evidence() {
  if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    return 0
  fi
  local stable_tag="$TAG"
  local candidate_commit
  candidate_commit="$(git rev-parse --verify "refs/tags/${CANDIDATE_TAG}^{commit}")" \
    || fail "accepted RC tag does not exist locally"
  [[ "$candidate_commit" == "$RELEASE_COMMIT" ]] \
    || fail "accepted RC does not match stable release commit"
  git fetch origin main >/dev/null
  git merge-base --is-ancestor "$RELEASE_COMMIT" origin/main \
    || fail "stable release commit is not an ancestor of fresh origin/main"

  TAG="$CANDIDATE_TAG"
  verify_forgejo_tag
  verify_forgejo_exact_workflow_gate release-candidate.yml "$CANDIDATE_TAG" "$RELEASE_COMMIT"
  verify_forgejo_exact_workflow_gate install-test.yml "$CANDIDATE_TAG" "$RELEASE_COMMIT"
  node "$SCRIPT_DIR/verify-release-candidate-canary.mjs" \
    --repo "$ROOT_DIR" --receipt "$CANARY_RECEIPT" --evidence "$CANARY_EVIDENCE" \
    --tag "$CANDIDATE_TAG" --commit "$RELEASE_COMMIT"
  node "$SCRIPT_DIR/verify-prestable-rehearsal.mjs" \
    --repo "$ROOT_DIR" --manifest "$REHEARSAL_MANIFEST" --public-key "$RELEASE_PUBLIC_KEY" \
    --tag "$CANDIDATE_TAG" --commit "$RELEASE_COMMIT"
  TAG="$stable_tag"
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

create_release_objects() {
  local publication_result="$TEMP_DIR/publication-result.json"
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
    SANCTUARY_PUBLICATION_RESULT="$publication_result" \
    bash "$CREATE_RELEASE_SCRIPT" "$TAG"

  if ! declare -F register_owned_resource >/dev/null; then
    return 0
  fi
  [[ -f "$publication_result" ]] || fail 'release publisher did not write its required publication result'

  SANCTUARY_PROJECT_DIR="$ROOT_DIR"
  SANCTUARY_RELEASE="$TAG"
  SANCTUARY_COMMIT="$RELEASE_COMMIT"
  SANCTUARY_OPERATION_RUN_ID="${SANCTUARY_OPERATION_RUN_ID:-publish-${TAG#v}}"
  ownership_initialize
  local provider provider_id outcome identity
  for provider in forgejo github; do
    provider_id="$(jq -r ".providers.${provider}.id" "$publication_result")"
    outcome="$(jq -r ".providers.${provider}.outcome" "$publication_result")"
    identity="${provider}-${provider_id}"
    register_owned_resource provider_publication retained retain_reconcile provider_id \
      "$provider_id" "$identity" "$SANCTUARY_OPERATION_RUN_ID" "$outcome"
  done
  register_owned_resource temporary_artifact active exact_delete path "$publication_result" \
    "path-$(stat -c '%d-%i' "$publication_result" 2>/dev/null || stat -f '%d-%i' "$publication_result")" \
    "$SANCTUARY_OPERATION_RUN_ID"
}

register_publication_inputs() {
  declare -F register_owned_resource >/dev/null || return 0
  SANCTUARY_PROJECT_DIR="$ROOT_DIR"
  SANCTUARY_RELEASE="$TAG"
  SANCTUARY_COMMIT="$RELEASE_COMMIT"
  SANCTUARY_OPERATION_RUN_ID="${SANCTUARY_OPERATION_RUN_ID:-publish-${TAG#v}}"
  ownership_initialize
  local input digest
  for input in "$CANARY_RECEIPT" "$CANARY_EVIDENCE" "$REHEARSAL_MANIFEST" \
    "${REHEARSAL_MANIFEST}.sig" "$RELEASE_PUBLIC_KEY"; do
    digest="$(ownership_sha256 < "$input")"
    register_owned_resource cleanup_evidence referenced retain path "$input" \
      "sha256:$digest" "$SANCTUARY_OPERATION_RUN_ID"
  done
  register_owned_resource temporary_artifact active exact_delete path "$TEMP_DIR" \
    "path-$(stat -c '%d-%i' "$TEMP_DIR" 2>/dev/null || stat -f '%d-%i' "$TEMP_DIR")" \
    "$SANCTUARY_OPERATION_RUN_ID"
}

main() {
  parse_args "$@"
  local parsed_tag="$TAG" parsed_dry_run="$DRY_RUN" parsed_candidate="$CANDIDATE_TAG"
  local parsed_receipt="$CANARY_RECEIPT" parsed_evidence="$CANARY_EVIDENCE"
  local parsed_manifest="$REHEARSAL_MANIFEST" parsed_public_key="$RELEASE_PUBLIC_KEY"
  load_config
  TAG="$parsed_tag"; DRY_RUN="$parsed_dry_run"; CANDIDATE_TAG="$parsed_candidate"
  CANARY_RECEIPT="$parsed_receipt"; CANARY_EVIDENCE="$parsed_evidence"
  REHEARSAL_MANIFEST="$parsed_manifest"; RELEASE_PUBLIC_KEY="$parsed_public_key"
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-publish-release.XXXXXX")"
  trap on_exit EXIT
  validate_checkout
  verify_promotion_evidence
  verify_forgejo_tag
  verify_forgejo_release_gate
  verify_github_actions_disabled

  if [[ "$DRY_RUN" == "true" ]]; then
    verify_github_tag
    echo "Dry run passed for $TAG; no API mutations were performed."
    return
  fi

  ensure_github_tag
  register_publication_inputs
  create_release_objects
  echo "Release $TAG published to Forgejo and GitHub."
}

main "$@"
