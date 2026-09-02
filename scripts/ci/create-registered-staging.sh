#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
# shellcheck source=scripts/ownership/producer-hooks.sh
source "$PROJECT_ROOT/scripts/ownership/producer-hooks.sh"

fail() { printf 'create-registered-staging: %s\n' "$*" >&2; return 1; }

private_runtime() {
  local runtime=${SANCTUARY_RUNTIME_DIR:-} resolved owner mode
  [[ ${SANCTUARY_CLEANUP_COORDINATED:-0} == 1 && -n $runtime && $runtime == /* \
      && -d $runtime && ! -L $runtime ]] \
    || fail 'a coordinated owner-only runtime is required' || return
  resolved=$(cd "$runtime" && pwd -P) || return
  owner=$(stat -c '%u' -- "$runtime") || return
  mode=$(stat -c '%a' -- "$runtime") || return
  [[ $resolved == "$runtime" && $owner == "${UID:-$(id -u)}" && $mode == 700 ]] \
    || fail 'cleanup runtime authority is not canonical and owner-only' || return
  printf '%s' "$runtime"
}

ensure_staging_parent() {
  local runtime=$1 parent="$1/subject-staging" owner mode
  if [[ ! -e $parent ]]; then
    (umask 077; mkdir -- "$parent") || [[ -d $parent && ! -L $parent ]] || return
  fi
  [[ -d $parent && ! -L $parent ]] || fail 'staging parent is not a real directory' || return
  owner=$(stat -c '%u' -- "$parent") || return
  mode=$(stat -c '%a' -- "$parent") || return
  [[ $owner == "${UID:-$(id -u)}" && $mode == 700 ]] \
    || fail 'staging parent is not owner-only' || return
  printf '%s' "$parent"
}

main() {
  [[ $# == 1 && $1 =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] \
    || fail 'usage: create-registered-staging.sh LABEL' || return
  local label=$1 runtime parent artifact authority_bundle execution_authority identity
  runtime=$(private_runtime) || return
  parent=$(ensure_staging_parent "$runtime") || return
  ownership_initialize
  authority_bundle=$(node "$SANCTUARY_OWNERSHIP_TOOL_DIR/describe-host-authority.mjs" \
    temporary "$parent" "$SANCTUARY_OPERATION_RUN_ID") || return
  execution_authority=$(printf '%s' "$authority_bundle" | jq -c '.executionAuthority') || return
  identity=$(printf '%s' "$authority_bundle" | jq -r '.immutableIdentity') || return
  register_owned_resource temporary_artifact obsolete exact_delete path \
    "$parent" "$identity" --execution-authority "$execution_authority" \
    "$SANCTUARY_OPERATION_RUN_ID" || return

  # Every returned payload directory is created only after its exact 0700
  # ancestor is durably registered. The host adapter quarantines and removes
  # that ancestor descriptor-relatively after the subject is terminal, so a
  # crash at any later child-creation point cannot leave an unregistered tree.
  if [[ ${SANCTUARY_TEST_FAIL_AFTER_STAGING_REGISTRATION:-0} == 1 \
      && ${SANCTUARY_LOCAL_CLEANUP_AUTHORITY:-0} == 1 ]]; then
    fail 'injected failure after staging registration'
    return
  fi
  artifact=$(mktemp -d "$parent/$label.XXXXXX") || return
  [[ -d $artifact && ! -L $artifact && $(stat -c '%a' -- "$artifact") == 700 ]] \
    || fail 'mktemp did not create an owner-only directory' || return
  printf '%s\n' "$artifact"
}

main "$@"
