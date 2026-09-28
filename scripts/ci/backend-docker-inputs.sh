#!/usr/bin/env bash
# Source from the canonical host subject; never mount a private Git directory.
resolve_backend_git_inputs() {
  local root=$1 common
  SANCTUARY_BACKEND_SOURCE_SHA=$(git -C "$root" rev-parse --verify HEAD) || return
  common=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir) || return
  SANCTUARY_BACKEND_GIT_OBJECTS=$(cd "$common/objects" && pwd -P) || return
  [[ $(git -C "$root" rev-parse --is-shallow-repository) == false ]] || {
    echo 'Backend provenance requires complete local history' >&2; return 1;
  }
  [[ ! -s "$SANCTUARY_BACKEND_GIT_OBJECTS/info/alternates" ]] || {
    echo 'Backend provenance refuses unresolved external object alternates' >&2; return 1;
  }
  git -C "$root" cat-file -e "$SANCTUARY_BACKEND_SOURCE_SHA^{commit}" || return
  export SANCTUARY_BACKEND_SOURCE_SHA SANCTUARY_BACKEND_GIT_OBJECTS
}

prepare_backend_output() {
  local scripts=$1
  SANCTUARY_BACKEND_TEST_OUTPUT=$("$scripts/create-registered-staging.sh" backend-test-output) || return
  export SANCTUARY_BACKEND_TEST_OUTPUT
}

retain_backend_output() {
  local destination="${SANCTUARY_RUNTIME_DIR:?}/backend-test-receipts"
  (umask 077; mkdir -p "$destination") || return
  cp -R "$SANCTUARY_BACKEND_TEST_OUTPUT/." "$destination/" || return
  printf 'Backend test receipts: %s\n' "$destination"
}
