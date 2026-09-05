#!/usr/bin/env bash
# Validate one explicit accepted RC and push one exact immutable stable tag.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REGISTERED_STAGING="$ROOT_DIR/scripts/ci/create-registered-staging.sh"
CLEANUP_COORDINATOR="$ROOT_DIR/scripts/ci/cleanup-ci-callsite.sh"
TAG=""
RELEASE_COMMIT=""
TEMP_DIR=""
RC_TAG=""
STABLE_TAG=""
RECEIPT=""
EVIDENCE=""
OUTPUT_DIR=""
SIGNING_KEY=""
PUBLIC_KEY=""

fail() { echo "release promotion failed: $*" >&2; exit 1; }

# shellcheck source=scripts/release/release-operator-api.sh
source "$SCRIPT_DIR/release-operator-api.sh"

usage() {
  cat <<'EOF'
Usage: scripts/release/promote-release.sh --rc-tag vX.Y.Z-rcN --stable-tag vX.Y.Z \
  --receipt /absolute/canary.json --evidence /absolute/raw-evidence \
  --output-dir /absolute/new-rehearsal-dir --signing-key /absolute/private.pem \
  --public-key /absolute/public.pem
EOF
}

parse_args() {
  RC_TAG=""; STABLE_TAG=""; RECEIPT=""; EVIDENCE=""
  OUTPUT_DIR=""; SIGNING_KEY=""; PUBLIC_KEY=""
  while (( $# > 0 )); do
    case "$1" in
      --rc-tag) RC_TAG="${2:-}"; shift 2 ;;
      --stable-tag) STABLE_TAG="${2:-}"; shift 2 ;;
      --receipt) RECEIPT="${2:-}"; shift 2 ;;
      --evidence) EVIDENCE="${2:-}"; shift 2 ;;
      --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
      --signing-key) SIGNING_KEY="${2:-}"; shift 2 ;;
      --public-key) PUBLIC_KEY="${2:-}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; exit 2 ;;
    esac
  done
  [[ "$RC_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-rc[1-9][0-9]*$ ]] \
    || fail "RC tag must use vX.Y.Z-rcN"
  [[ "$STABLE_TAG" == "${RC_TAG%-rc*}" ]] || fail "stable tag does not match RC tag"
  for value in "$RECEIPT" "$EVIDENCE" "$OUTPUT_DIR" "$SIGNING_KEY" "$PUBLIC_KEY"; do
    [[ "$value" == /* ]] || fail "all evidence, output, and key paths must be absolute"
  done
}

load_config() {
  local config_file="${SANCTUARY_RELEASE_CONFIG:-${HOME}/.config/sanctuary/forge-tokens.env}"
  [[ ! -f "$config_file" ]] || source "$config_file"
  FORGEJO_URL="${FORGEJO_URL:-}"
  FORGEJO_OWNER="${FORGEJO_OWNER:-nekoguntai-castle}"
  FORGEJO_REPO="${FORGEJO_REPO:-sanctuary}"
  FORGEJO_TOKEN="${FORGEJO_TOKEN:-}"
  GITHUB_API_URL="${GITHUB_API_URL:-https://api.github.com}"
  GITHUB_OWNER="${GITHUB_OWNER:-nekoguntai-castle}"
  GITHUB_REPO="${GITHUB_REPO:-sanctuary}"
  GITHUB_RELEASE_TOKEN="${GITHUB_RELEASE_TOKEN:-}"
  [[ -n "$FORGEJO_URL" && -n "$FORGEJO_OWNER" && -n "$FORGEJO_REPO" && -n "$FORGEJO_TOKEN" \
    && -n "$GITHUB_API_URL" && -n "$GITHUB_OWNER" && -n "$GITHUB_REPO" \
    && -n "$GITHUB_RELEASE_TOKEN" ]] || fail "missing required Forgejo/GitHub configuration"
  for credential in FORGEJO_TOKEN GITHUB_RELEASE_TOKEN; do
    [[ "${!credential}" != *$'\n'* && "${!credential}" != *$'\r'* \
      && "${!credential}" != *'"'* && "${!credential}" != *'\'* ]] \
      || fail "$credential contains an unsafe HTTP header character"
  done
  export -n FORGEJO_TOKEN GITHUB_RELEASE_TOKEN GHCR_TOKEN GHCR_USER \
    UMBREL_DISPATCH_TOKEN UMBREL_OWNER UMBREL_REPO
}

validate_checkout() {
  cd "$ROOT_DIR"
  [[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail "release checkout must be clean"
  git fetch origin main >/dev/null
  RELEASE_COMMIT="$(git rev-parse --verify "refs/tags/${RC_TAG}^{commit}")" \
    || fail "local RC tag does not exist"
  [[ "$(git rev-parse HEAD)" == "$RELEASE_COMMIT" ]] || fail "checkout must be at $RC_TAG"
  git merge-base --is-ancestor "$RELEASE_COMMIT" origin/main \
    || fail "$RC_TAG is not an ancestor of fresh origin/main"
  # An RC tag may be annotated (the remote lists the tag object plus a peeled
  # commit) or lightweight (the remote lists only the commit). Require the remote
  # ref to name the same object as the local tag, and its commit to be the
  # release commit, so either spelling is accepted only when identical.
  local remote_object remote_commit
  read -r remote_object remote_commit < <(git ls-remote origin "refs/tags/$RC_TAG" "refs/tags/$RC_TAG^{}" \
    | awk -v ref="refs/tags/$RC_TAG" '$2 == ref {object=$1} $2 == ref "^{}" {commit=$1} END {print object, commit}')
  [[ -n "$remote_object" && "$remote_object" == "$(git rev-parse --verify "refs/tags/$RC_TAG")" ]] \
    || fail "remote RC tag identity does not match checkout"
  [[ "${remote_commit:-$remote_object}" == "$RELEASE_COMMIT" ]] \
    || fail "remote RC tag identity does not match checkout"
}

validate_output_location() {
  local candidate parent worktree relative
  [[ ! -L "$OUTPUT_DIR" ]] || fail "rehearsal output directory must not be a symlink"
  parent="$(realpath "$(dirname "$OUTPUT_DIR")")" \
    || fail "rehearsal output parent must already exist"
  candidate="$parent/$(basename "$OUTPUT_DIR")"
  [[ "$candidate" == "$OUTPUT_DIR" ]] || fail "rehearsal output path must be canonical"
  while IFS= read -r worktree; do
    worktree="$(realpath "$worktree")"
    relative="$(realpath -m --relative-to="$worktree" "$candidate")"
    if [[ "$relative" == "." || "$relative" != ../* ]]; then
      fail "rehearsal output directory must be outside every Git worktree"
    fi
  done < <(git worktree list --porcelain | sed -n 's/^worktree //p')
}

verify_key_pair() {
  [[ -f "$SIGNING_KEY" && ! -L "$SIGNING_KEY" ]] || fail "signing key must be a regular non-symlink file"
  [[ -f "$PUBLIC_KEY" && ! -L "$PUBLIC_KEY" ]] || fail "public key must be a regular non-symlink file"
  openssl pkey -in "$SIGNING_KEY" -pubout -outform DER -out "$TEMP_DIR/private-public.der" >/dev/null 2>&1 \
    || fail "signing key is invalid"
  openssl pkey -pubin -in "$PUBLIC_KEY" -outform DER -out "$TEMP_DIR/public.der" >/dev/null 2>&1 \
    || fail "public key is invalid"
  cmp -s "$TEMP_DIR/private-public.der" "$TEMP_DIR/public.der" || fail "signing and public keys do not match"
}

run_canary_gate() {
  node "$SCRIPT_DIR/verify-release-candidate-canary.mjs" \
    --repo "$ROOT_DIR" --receipt "$RECEIPT" --evidence "$EVIDENCE" \
    --tag "$RC_TAG" --commit "$RELEASE_COMMIT"
}

prepare_or_verify_rehearsal() {
  local manifest="$OUTPUT_DIR/release-manifest.json"
  if [[ ! -e "$OUTPUT_DIR" ]]; then
    node "$SCRIPT_DIR/prepare-release-assets.mjs" --tag "$RC_TAG" --output-dir "$OUTPUT_DIR" \
      --signing-key "$SIGNING_KEY" --public-key "$PUBLIC_KEY" \
      --staging-root "$TEMP_DIR" \
      --run-id "prestable-${RC_TAG}"
  fi
  verify_rehearsal
}

verify_rehearsal() {
  node "$SCRIPT_DIR/verify-prestable-rehearsal.mjs" \
    --repo "$ROOT_DIR" --manifest "$OUTPUT_DIR/release-manifest.json" \
    --public-key "$PUBLIC_KEY" --tag "$RC_TAG" --commit "$RELEASE_COMMIT"
}

remote_stable_identity() {
  git ls-remote origin "refs/tags/$STABLE_TAG" "refs/tags/$STABLE_TAG^{}" \
    | awk -v ref="refs/tags/$STABLE_TAG" '$2 == ref {object=$1} $2 == ref "^{}" {commit=$1} END {print object, commit}'
}

push_stable_tag() {
  # Evidence is external and mutable. Recheck its cheap identity/signature gates
  # after the potentially long asset build and immediately before the tag write.
  run_canary_gate
  verify_key_pair
  verify_rehearsal
  verify_github_actions_disabled
  git fetch origin main >/dev/null
  [[ -z "$(git status --porcelain --untracked-files=all)" \
    && "$(git rev-parse HEAD)" == "$RELEASE_COMMIT" ]] || fail "checkout changed after promotion gates"
  git merge-base --is-ancestor "$RELEASE_COMMIT" origin/main \
    || fail "accepted RC is no longer an ancestor of origin/main"

  local remote_object remote_commit local_object local_commit local_type
  read -r remote_object remote_commit < <(remote_stable_identity)
  if [[ -n "$remote_object" ]]; then
    [[ -n "$remote_commit" && "$remote_commit" == "$RELEASE_COMMIT" ]] \
      || fail "stable tag already exists with a different identity"
    if ! git rev-parse --verify --quiet "refs/tags/$STABLE_TAG" >/dev/null; then
      git fetch origin "refs/tags/$STABLE_TAG:refs/tags/$STABLE_TAG" >/dev/null \
        || fail "existing stable tag could not be fetched for exact verification"
    fi
    [[ "$(git rev-parse "refs/tags/$STABLE_TAG")" == "$remote_object" \
      && "$(git rev-parse "refs/tags/${STABLE_TAG}^{commit}")" == "$RELEASE_COMMIT" ]] \
      || fail "stable tag already exists with a different identity"
    echo "Stable tag $STABLE_TAG was already promoted at $RELEASE_COMMIT."
    return
  fi
  if git rev-parse --verify --quiet "refs/tags/$STABLE_TAG" >/dev/null; then
    local_object="$(git rev-parse "refs/tags/$STABLE_TAG")"
    local_commit="$(git rev-parse "refs/tags/${STABLE_TAG}^{commit}")"
    local_type="$(git cat-file -t "$local_object")"
    [[ "$local_type" == tag && "$local_commit" == "$RELEASE_COMMIT" ]] \
      || fail "local stable tag already exists with a different identity"
  else
    git tag -a "$STABLE_TAG" "$RELEASE_COMMIT" -m "Release $STABLE_TAG"
    local_object="$(git rev-parse "refs/tags/$STABLE_TAG")"
  fi
  if git push origin "refs/tags/$STABLE_TAG:refs/tags/$STABLE_TAG"; then
    :
  else
    read -r remote_object remote_commit < <(remote_stable_identity)
    [[ "$remote_object" == "$local_object" && "$remote_commit" == "$RELEASE_COMMIT" ]] \
      || fail "stable tag push failed without exact remote reconciliation"
  fi
  read -r remote_object remote_commit < <(remote_stable_identity)
  [[ "$remote_object" == "$local_object" && "$remote_commit" == "$RELEASE_COMMIT" ]] \
    || fail "remote stable tag verification failed"
  echo "Promoted $RC_TAG to immutable $STABLE_TAG at $RELEASE_COMMIT."
}

main() {
  if [[ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]]; then
    exec "$CLEANUP_COORDINATOR" auto-run --lane promote-release --engine host \
      --checkout-root "$ROOT_DIR" -- bash "$0" "$@"
  fi
  parse_args "$@"
  local parsed_rc_tag="$RC_TAG" parsed_stable_tag="$STABLE_TAG"
  local parsed_receipt="$RECEIPT" parsed_evidence="$EVIDENCE"
  local parsed_output="$OUTPUT_DIR" parsed_signing_key="$SIGNING_KEY" parsed_public_key="$PUBLIC_KEY"
  load_config
  RC_TAG="$parsed_rc_tag"; STABLE_TAG="$parsed_stable_tag"
  RECEIPT="$parsed_receipt"; EVIDENCE="$parsed_evidence"; OUTPUT_DIR="$parsed_output"
  SIGNING_KEY="$parsed_signing_key"; PUBLIC_KEY="$parsed_public_key"
  TEMP_DIR="$($REGISTERED_STAGING promote-release)"
  validate_checkout
  validate_output_location
  TAG="$RC_TAG"
  verify_forgejo_tag
  verify_forgejo_exact_workflow_gate release-candidate.yml "$RC_TAG" "$RELEASE_COMMIT"
  verify_forgejo_exact_workflow_gate install-test.yml "$RC_TAG" "$RELEASE_COMMIT"
  verify_github_actions_disabled
  run_canary_gate
  verify_key_pair
  prepare_or_verify_rehearsal
  push_stable_tag
}

main "$@"
