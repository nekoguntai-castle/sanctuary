#!/usr/bin/env bash
# Shared producer-side ownership labels and signed external registration hooks.

ownership_source_dir="${BASH_SOURCE[0]%/*}"
[ "$ownership_source_dir" != "${BASH_SOURCE[0]}" ] || ownership_source_dir=.
SANCTUARY_OWNERSHIP_TOOL_DIR="${SANCTUARY_OWNERSHIP_TOOL_DIR:-$(cd "$ownership_source_dir" && pwd)}"
unset ownership_source_dir
source "$SANCTUARY_OWNERSHIP_TOOL_DIR/../ci/provider-context.sh"

ownership_sanitize_id() {
  local value="${1,,}"
  value="${value//[^a-z0-9._:-]/-}"
  [[ "$value" =~ ^[a-z0-9] ]] || value="x-$value"
  while [ "${value%-}" != "$value" ]; do value="${value%-}"; done
  printf '%s' "$value"
}

ownership_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 | awk '{print $1}'
  else openssl dgst -sha256 -r | awk '{print $1}'
  fi
}

ownership_initialize() {
  local checkout_root="${SANCTUARY_PROJECT_DIR:-$(pwd -P)}"
  local project_basename="${checkout_root##*/}"
  local ci_identity temp_root
  ci_identity="$(ci_run_id)"
  temp_root="$(ci_temp_dir)"
  SANCTUARY_PROJECT="${SANCTUARY_PROJECT:-$(ownership_sanitize_id "$project_basename")}"
  SANCTUARY_DEPLOYMENT_ID="${SANCTUARY_DEPLOYMENT_ID:-deploy-$SANCTUARY_PROJECT}"
  SANCTUARY_OWNER_ID="${SANCTUARY_OWNER_ID:-owner-${UID:-0}}"
  SANCTUARY_OPERATION_RUN_ID="${SANCTUARY_OPERATION_RUN_ID:-run-$ci_identity}"
  SANCTUARY_RELEASE="${SANCTUARY_RELEASE:-$(git -C "$checkout_root" describe --tags --always 2>/dev/null || printf unreleased)}"
  SANCTUARY_COMMIT="${SANCTUARY_COMMIT:-$(git -C "$checkout_root" rev-parse HEAD 2>/dev/null || printf '0000000000000000000000000000000000000000')}"
  SANCTUARY_CLEANUP_CREATED_AT="${SANCTUARY_CLEANUP_CREATED_AT:-$(TZ=UTC printf '%(%Y-%m-%dT%H:%M:%S.000Z)T' -1)}"
  SANCTUARY_RESOURCE_LIFECYCLE="${SANCTUARY_RESOURCE_LIFECYCLE:-active}"
  if [ -z "${SANCTUARY_OWNERSHIP_ROOT:-}" ]; then
    if ci_temp_is_ephemeral; then
      SANCTUARY_OWNERSHIP_ROOT="$temp_root/sanctuary-ownership/$SANCTUARY_OPERATION_RUN_ID"
    else
      SANCTUARY_OWNERSHIP_ROOT="${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}/ownership"
    fi
  fi
  export SANCTUARY_PROJECT SANCTUARY_DEPLOYMENT_ID SANCTUARY_OWNER_ID
  export SANCTUARY_OPERATION_RUN_ID SANCTUARY_RELEASE SANCTUARY_COMMIT
  export SANCTUARY_CLEANUP_CREATED_AT SANCTUARY_RESOURCE_LIFECYCLE SANCTUARY_OWNERSHIP_ROOT
}

ownership_require_identity() {
  [[ "${SANCTUARY_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]] && return 0
  echo 'ownership producer requires a full source commit' >&2
  return 1
}

ownership_initialize_build_identity() {
  ownership_initialize
  ownership_require_identity
  local checkout_root="${SANCTUARY_PROJECT_DIR:-$(pwd -P)}"
  SANCTUARY_SOURCE_COMMIT="${SANCTUARY_SOURCE_COMMIT:-$SANCTUARY_COMMIT}"
  SANCTUARY_IMAGE_LOCK_SHA256="${SANCTUARY_IMAGE_LOCK_SHA256:-$(ownership_sha256 < "$checkout_root/config/container-image-lock.json")}"
  SANCTUARY_VERSION="${SANCTUARY_VERSION:-$(awk -F'"' '/"version":/{print $4; exit}' "$checkout_root/package.json")}"
  SANCTUARY_BUILD_ID="${SANCTUARY_BUILD_ID:-$SANCTUARY_OPERATION_RUN_ID}"
  export SANCTUARY_SOURCE_COMMIT SANCTUARY_IMAGE_LOCK_SHA256 SANCTUARY_VERSION SANCTUARY_BUILD_ID
}

# Recompute artifact provenance after an existing runtime env has been loaded.
# Stable deployment identity may come from that file, but a rebuild must never
# inherit the previous checkout's commit, lock digest, version, or build ID.
ownership_refresh_checkout_build_identity() {
  ownership_initialize
  local checkout_root="${SANCTUARY_PROJECT_DIR:-$(pwd -P)}"
  local checkout_commit checkout_release
  if checkout_commit="$(git -C "$checkout_root" rev-parse HEAD 2>/dev/null)"; then
    SANCTUARY_COMMIT="$checkout_commit"
    checkout_release="$(git -C "$checkout_root" describe --tags --always 2>/dev/null || true)"
    [ -z "$checkout_release" ] || SANCTUARY_RELEASE="$checkout_release"
  fi
  ownership_require_identity
  SANCTUARY_SOURCE_COMMIT="$SANCTUARY_COMMIT"
  SANCTUARY_IMAGE_LOCK_SHA256="$(ownership_sha256 < "$checkout_root/config/container-image-lock.json")"
  SANCTUARY_VERSION="$(awk -F'"' '/"version":/{print $4; exit}' "$checkout_root/package.json")"
  SANCTUARY_BUILD_ID="$SANCTUARY_OPERATION_RUN_ID"
  export SANCTUARY_RELEASE SANCTUARY_COMMIT SANCTUARY_SOURCE_COMMIT
  export SANCTUARY_IMAGE_LOCK_SHA256 SANCTUARY_VERSION SANCTUARY_BUILD_ID
}

# Load the operator-owned runtime environment and export the complete identity
# required by the strict Compose contract. Read-only/operator commands do not
# create a deployment generation, so checkout-derived build metadata is the
# only canonical source available to Compose interpolation.
ownership_prepare_operator_compose() {
  local checkout_root="${1:-${SANCTUARY_PROJECT_DIR:-$(pwd -P)}}"
  local runtime_dir="${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}"
  local env_file="${SANCTUARY_ENV_FILE:-$runtime_dir/sanctuary.env}"

  if [ ! -f "$env_file" ]; then
    if [ -f "$checkout_root/.env" ]; then env_file="$checkout_root/.env"
    elif [ -f "$checkout_root/.env.local" ]; then env_file="$checkout_root/.env.local"
    fi
  fi
  if [ -f "$env_file" ]; then
    set -a
    # shellcheck disable=SC1090 -- operator-selected runtime environment
    source "$env_file"
    set +a
  fi

  SANCTUARY_PROJECT_DIR="$checkout_root"
  SANCTUARY_RUNTIME_DIR="$runtime_dir"
  SANCTUARY_ENV_FILE="$env_file"
  SANCTUARY_SSL_DIR="${SANCTUARY_SSL_DIR:-$runtime_dir/ssl}"
  SANCTUARY_COMPOSE_SSL_DIR="${SANCTUARY_COMPOSE_SSL_DIR:-$SANCTUARY_SSL_DIR}"
  SANCTUARY_PROJECT="${SANCTUARY_PROJECT:-${COMPOSE_PROJECT_NAME:-sanctuary}}"
  export SANCTUARY_PROJECT_DIR SANCTUARY_RUNTIME_DIR SANCTUARY_ENV_FILE SANCTUARY_PROJECT
  export SANCTUARY_SSL_DIR SANCTUARY_COMPOSE_SSL_DIR
  ownership_initialize_build_identity
}

ownership_label_args() {
  local resource_class="$1" cleanup_policy="$2"
  ownership_initialize
  ownership_require_identity
  OWNERSHIP_LABEL_ARGS=(
    --label "io.sanctuary.project=$SANCTUARY_PROJECT"
    --label "io.sanctuary.deployment-id=$SANCTUARY_DEPLOYMENT_ID"
    --label "io.sanctuary.owner-id=$SANCTUARY_OWNER_ID"
    --label "io.sanctuary.resource-class=$resource_class"
    --label "io.sanctuary.lifecycle=$SANCTUARY_RESOURCE_LIFECYCLE"
    --label "io.sanctuary.cleanup-policy=$cleanup_policy"
    --label "io.sanctuary.created-at=$SANCTUARY_CLEANUP_CREATED_AT"
    --label "io.sanctuary.created-by-release=$SANCTUARY_RELEASE"
    --label "io.sanctuary.created-by-commit=$SANCTUARY_COMMIT"
    --label "io.sanctuary.creation-run-id=$SANCTUARY_OPERATION_RUN_ID"
  )
}

register_owned_resource() {
  local resource_class="$1" lifecycle="$2" cleanup_policy="$3" locator_kind="$4"
  local locator="$5" immutable_identity="$6"
  shift 6
  ownership_initialize
  ownership_require_identity
  local checkout_root="${SANCTUARY_PROJECT_DIR:-$(pwd -P)}"
  local args=(
    --root "$SANCTUARY_OWNERSHIP_ROOT" --checkout-root "$checkout_root"
    --deployment-id "$SANCTUARY_DEPLOYMENT_ID" --run-id "$SANCTUARY_OPERATION_RUN_ID"
    --owner-id "$SANCTUARY_OWNER_ID" --class "$resource_class" --lifecycle "$lifecycle"
    --policy "$cleanup_policy" --release "$SANCTUARY_RELEASE" --commit "$SANCTUARY_COMMIT"
    --created-at "$SANCTUARY_CLEANUP_CREATED_AT" --locator-kind "$locator_kind"
    --locator "$locator" --identity "$immutable_identity"
  )
  local reference
  for reference in "$@"; do args+=(--reference "$reference"); done
  node "$SANCTUARY_OWNERSHIP_TOOL_DIR/register-resource.mjs" "${args[@]}" >/dev/null
}
