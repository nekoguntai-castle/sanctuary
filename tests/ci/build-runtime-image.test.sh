#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/ci/build-runtime-image.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/build-runtime-image-test.XXXXXX")"
REAL_NODE="$(command -v node)"

pass=0
fail=0

ok() { printf 'PASS: %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; fail=$((fail + 1)); }
assert_true() {
  local label="$1"
  shift
  if "$@"; then ok "$label"; else bad "$label"; fi
}

mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/state" "$TEST_ROOT/build-logs"
cat > "$TEST_ROOT/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$DOCKER_CALLS"

has_reference() {
  grep -Fxq -- "$(canonical_reference "$1")" "$FAKE_DOCKER_STATE/references" 2>/dev/null
}

canonical_reference() {
  local reference="$1" repository="${1%%:*}" first="${1%%/*}"
  if [ "${FAKE_PODMAN_NORMALIZE:-0}" = 1 ] && [ "$repository" != "$first" ] \
      && [[ "$first" != *.* ]] && [[ "$first" != *:* ]] && [ "$first" != localhost ]; then
    printf 'localhost/%s\n' "$reference"
  else
    printf '%s\n' "$reference"
  fi
}

inspection() {
  local selector="$1" id output_id count
  id="$(cat "$FAKE_DOCKER_STATE/image-id")"
  if [ "$selector" != "$id" ] && [ "$selector" != "${id#sha256:}" ] && ! has_reference "$selector"; then exit 1; fi
  if [ ! -s "$FAKE_DOCKER_STATE/references" ]; then exit 1; fi
  count="$(cat "$FAKE_DOCKER_STATE/inspect-count" 2>/dev/null || printf '0')"
  count=$((count + 1))
  printf '%s' "$count" > "$FAKE_DOCKER_STATE/inspect-count"
  if [ "${FAKE_DRIFT_ON_ID_INSPECT:-0}" = 1 ] \
      && [ "$count" -ge 2 ]; then
    id="sha256:$(printf 'd%.0s' {1..64})"
  fi
  output_id="$id"
  if [ "${FAKE_PODMAN_IMAGE_ID:-0}" = 1 ]; then output_id="${id#sha256:}"; fi
  jq -cn \
    --arg id "$output_id" \
    --arg source "$(cat "$FAKE_DOCKER_STATE/source")" \
    --arg lock "$(cat "$FAKE_DOCKER_STATE/lock")" \
    --arg version "$(cat "$FAKE_DOCKER_STATE/version")" \
    --arg build "$(cat "$FAKE_DOCKER_STATE/build")" \
    --argjson tags "$(jq -Rsc 'split("\n") | map(select(length > 0))' "$FAKE_DOCKER_STATE/references")" \
    --argjson digests "$(printf '%s\n' "${FAKE_REPO_DIGEST:-}" | jq -Rsc 'split("\n") | map(select(length > 0))')" \
    '[{Id:$id,RepoTags:$tags,RepoDigests:$digests,Config:{Labels:{
      "org.opencontainers.image.source":"https://github.com/nekoguntai-castle/sanctuary",
      "org.opencontainers.image.revision":$source,
      "dev.sanctuary.image-lock-sha256":$lock,
      "org.opencontainers.image.version":$version,
      "io.sanctuary.build-id":$build
    }}}]'
}

case "${1:-} ${2:-}" in
  'buildx build')
    shift 2
    build_count="$(cat "$FAKE_DOCKER_STATE/build-count" 2>/dev/null || printf '0')"
    build_count=$((build_count + 1))
    printf '%s' "$build_count" > "$FAKE_DOCKER_STATE/build-count"
    if [ "${FAKE_IMPORTED_CACHE_404_FIRST:-0}" = 1 ] && [ "$build_count" -eq 1 ]; then
      printf '%s\n' '#5 importing cache manifest from gha:17052313735773212804' >&2
      if [ "${FAKE_CACHE_404_WITH_OWNED_TAG:-0}" = 1 ]; then
        cache_failure_after_load=true
      else
        printf '%s\n' 'ERROR: failed to build: failed to solve: failed to compute cache key: failed to copy: invalid status response 404 Not Found for http://host.containers.internal:4000/59c770efb6214b3e6420b228ee713560/_apis/artifactcache/artifacts/10952' >&2
        exit 73
      fi
    elif [ "${FAKE_GENERIC_404_FIRST:-0}" = 1 ] && [ "$build_count" -eq 1 ]; then
      printf '%s\n' '#5 importing cache manifest from gha:17052313735773212804' >&2
      printf '%s\n' 'ERROR: generic HTTP 404 while loading image' >&2
      exit 73
    fi
    tag= source= lock= version= build=
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --tag) tag="$2"; shift 2 ;;
        --build-arg)
          case "$2" in
            SANCTUARY_SOURCE_COMMIT=*) source="${2#*=}" ;;
            SANCTUARY_IMAGE_LOCK_SHA256=*) lock="${2#*=}" ;;
            SANCTUARY_BUILD_VERSION=*) version="${2#*=}" ;;
            SANCTUARY_BUILD_ID=*) build="${2#*=}" ;;
          esac
          shift 2 ;;
        *) shift ;;
      esac
    done
    printf '%s\n' "sha256:$(printf 'b%.0s' {1..64})" > "$FAKE_DOCKER_STATE/image-id"
    canonical_reference "$tag" > "$FAKE_DOCKER_STATE/references"
    [ -z "${FAKE_SHARED_REFERENCE:-}" ] \
      || canonical_reference "$FAKE_SHARED_REFERENCE" >> "$FAKE_DOCKER_STATE/references"
    if [ "${FAKE_BAD_PROVENANCE:-0}" = 1 ]; then source="$(printf '0%.0s' {1..40})"; fi
    printf '%s' "$source" > "$FAKE_DOCKER_STATE/source"
    printf '%s' "$lock" > "$FAKE_DOCKER_STATE/lock"
    printf '%s' "$version" > "$FAKE_DOCKER_STATE/version"
    printf '%s' "$build" > "$FAKE_DOCKER_STATE/build"
    if [ "${FAKE_SIGNAL_AFTER_BUILD:-0}" = 1 ]; then
      kill -TERM "$PPID"
      sleep 0.1
      exit 143
    fi
    if [ "${cache_failure_after_load:-false}" = true ]; then
      printf '%s\n' 'ERROR: failed to build: failed to solve: failed to compute cache key: failed to copy: invalid status response 404 Not Found for http://host.containers.internal:4000/59c770efb6214b3e6420b228ee713560/_apis/artifactcache/artifacts/10952' >&2
      exit 73
    fi
    if [ "$build_count" -eq 2 ] && [ -n "${FAKE_SECOND_BUILD_STATUS:-}" ]; then
      exit "$FAKE_SECOND_BUILD_STATUS"
    fi
    exit "${FAKE_BUILD_STATUS:-0}"
    ;;
  'image inspect') inspection "$3" ;;
  'image rm')
    grep -Fvx -- "$(canonical_reference "$3")" "$FAKE_DOCKER_STATE/references" > "$FAKE_DOCKER_STATE/references.next" || true
    mv "$FAKE_DOCKER_STATE/references.next" "$FAKE_DOCKER_STATE/references"
    exit "${FAKE_IMAGE_RM_STATUS:-0}"
    ;;
  'image ls')
    [ "${FAKE_IMAGE_LIST_FAILURE:-0}" != 1 ] || exit 81
    reference=''
    for argument in "$@"; do
      case "$argument" in reference=*) reference="${argument#reference=}" ;; esac
    done
    [ -n "$reference" ] && has_reference "$reference" && cat "$FAKE_DOCKER_STATE/image-id"
    exit 0
    ;;
  *) exit 97 ;;
esac
SH
chmod +x "$TEST_ROOT/bin/docker"

cat > "$TEST_ROOT/bin/node" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  */register-resource.mjs|scripts/ownership/register-resource.mjs)
    printf 'register %s\n' "$*" >> "$NODE_CALLS"
    exit "${FAKE_REGISTER_STATUS:-0}"
    ;;
  scripts/ci/write-runtime-image-evidence.mjs)
    printf 'evidence %s\n' "$*" >> "$NODE_CALLS"
    exit "${FAKE_EVIDENCE_STATUS:-0}"
    ;;
  *) exec "$REAL_NODE" "$@" ;;
esac
SH
chmod +x "$TEST_ROOT/bin/node"

export PATH="$TEST_ROOT/bin:$PATH"
export REAL_NODE
export DOCKER_CALLS="$TEST_ROOT/docker.calls"
export NODE_CALLS="$TEST_ROOT/node.calls"
export FAKE_DOCKER_STATE="$TEST_ROOT/state"
export TMPDIR="$TEST_ROOT/build-logs"
export GITHUB_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
export GITHUB_RUN_ID=4107
export GITHUB_RUN_ATTEMPT=3
export SANCTUARY_CLEANUP_COORDINATED=1
export SANCTUARY_PROJECT=runtime-images
export SANCTUARY_DEPLOYMENT_ID=runtime-images-4107-3
export SANCTUARY_OWNER_ID=owner-runtime-images
export SANCTUARY_OPERATION_RUN_ID=runtime-images-4107-3-backend
export SANCTUARY_RELEASE=unreleased
export SANCTUARY_COMMIT="$GITHUB_SHA"
export SANCTUARY_CLEANUP_CREATED_AT=2026-09-01T00:00:00.000Z
export SANCTUARY_RESOURCE_LIFECYCLE=obsolete
export SANCTUARY_OWNERSHIP_ROOT="$TEST_ROOT/ownership"
# A prior deployment environment must never supply build provenance for the
# current checkout; the subject recomputes all four fields before building.
export SANCTUARY_SOURCE_COMMIT=stale-source
export SANCTUARY_IMAGE_LOCK_SHA256=stale-lock
export SANCTUARY_VERSION=stale-version
export SANCTUARY_BUILD_ID=stale-build

reset_case() {
  : > "$DOCKER_CALLS"
  : > "$NODE_CALLS"
  : > "$FAKE_DOCKER_STATE/references"
  printf '0' > "$FAKE_DOCKER_STATE/inspect-count"
  unset FAKE_BUILD_STATUS FAKE_SHARED_REFERENCE FAKE_BAD_PROVENANCE FAKE_DRIFT_ON_ID_INSPECT
  unset FAKE_SIGNAL_AFTER_BUILD FAKE_PODMAN_NORMALIZE FAKE_PODMAN_IMAGE_ID
  unset FAKE_REGISTER_STATUS FAKE_EVIDENCE_STATUS FAKE_IMAGE_RM_STATUS FAKE_REPO_DIGEST
  unset FAKE_IMPORTED_CACHE_404_FIRST FAKE_CACHE_404_WITH_OWNED_TAG FAKE_GENERIC_404_FIRST
  unset FAKE_SECOND_BUILD_STATUS FAKE_IMAGE_LIST_FAILURE SANCTUARY_IMAGE_CACHE
  printf '0' > "$FAKE_DOCKER_STATE/build-count"
}

reset_case
export FAKE_SHARED_REFERENCE='shared/runtime:keep'
export FAKE_PODMAN_NORMALIZE=1
export FAKE_PODMAN_IMAGE_ID=1
(cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend)
runtime_ref="$(awk '/buildx build/{for(i=1;i<=NF;i++) if($i=="--tag") print $(i+1)}' "$DOCKER_CALLS")"
image_id="sha256:$(printf 'b%.0s' {1..64})"
runtime_prefix="${GITHUB_SHA:0:12}"

assert_true 'runtime image reference is run-unique instead of commit-only' \
  grep -Eq "^localhost/sanctuary-ci/backend:${runtime_prefix}-[0-9a-f]{16}-backend$" <<< "$runtime_ref"
assert_true 'build binds the complete immutable provenance tuple' \
  grep -Eq -- "--load --tag $runtime_ref .*SANCTUARY_SOURCE_COMMIT=$GITHUB_SHA .*SANCTUARY_IMAGE_LOCK_SHA256=[0-9a-f]{64} .*SANCTUARY_BUILD_VERSION=[0-9]+\.[0-9]+\.[0-9]+ .*SANCTUARY_BUILD_ID=$SANCTUARY_OPERATION_RUN_ID" "$DOCKER_CALLS"
assert_true 'stable shared BuildKit cache is imported without becoming cleanup-owned' \
  grep -Fq -- '--cache-from type=gha,scope=runtime-image-backend --cache-to type=gha,mode=max,scope=runtime-image-backend,ignore-error=true' "$DOCKER_CALLS"
assert_true 'exact reference and immutable IID are stably reinspected' \
  bash -c 'test "$(grep -Fxc "image inspect $1" "$2")" -ge 2' _ "$runtime_ref" "$DOCKER_CALLS"
assert_true 'disposable OCI image is signed-registered by exact reference and IID' \
  grep -Eq -- "register .*register-resource.mjs .*--class oci_image .*--lifecycle obsolete .*--policy exact_delete .*--locator-kind reference .*--locator $runtime_ref .*--identity $image_id .*--reference $SANCTUARY_OPERATION_RUN_ID" "$NODE_CALLS"
assert_true 'runtime evidence is emitted while the exact reference exists' \
  grep -Fq -- "evidence scripts/ci/write-runtime-image-evidence.mjs --role backend --image $runtime_ref --commit $GITHUB_SHA" "$NODE_CALLS"
assert_true 'only the run-unique reference is retired' \
  grep -Fxq "image rm $runtime_ref" "$DOCKER_CALLS"
assert_true 'shared reference and immutable image survive exact retirement' \
  bash -c 'test "$(cat "$1")" = "localhost/shared/runtime:keep" && grep -Fq "image inspect $2" "$3"' _ \
    "$FAKE_DOCKER_STATE/references" 'localhost/shared/runtime:keep' "$DOCKER_CALLS"
assert_true 'BuildKit cache is never pruned, removed, or registered as disposable' \
  bash -c '! grep -Eq "buildx (rm|prune)|builder (rm|prune)|--class buildkit_cache" "$1" "$2"' _ "$DOCKER_CALLS" "$NODE_CALLS"

reset_case
(cd "$REPO_ROOT" && "$SCRIPT" prisma-migration server/Dockerfile . sanctuary-ci/migrate migration)
assert_true 'optional Docker build target is forwarded for migration images' \
  grep -Fq -- '--target migration' "$DOCKER_CALLS"

reset_case
export FAKE_PODMAN_NORMALIZE=1
export FAKE_PODMAN_IMAGE_ID=1
export FAKE_REPO_DIGEST="localhost/sanctuary-ci/backend@sha256:$(printf 'c%.0s' {1..64})"
(cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend)
assert_true 'an intrinsic Podman RepoDigest is not mistaken for an alternate tag owner' \
  grep -q -- '--class oci_image' "$NODE_CALLS"
assert_true 'a singly tagged Podman image is absent by immutable ID after retirement' \
  test ! -s "$FAKE_DOCKER_STATE/references"

reset_case
export FAKE_SHARED_REFERENCE='shared/runtime:keep'
export FAKE_IMAGE_RM_STATUS=74
if (cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >/dev/null 2>&1; then
  ok 'lost image removal response is reconciled by exact postcondition'
else
  bad 'lost image removal response was not reconciled'
fi
assert_true 'response-lost retirement removes only the exact run reference and preserves shared identity' \
  bash -c 'test "$(cat "$1")" = "shared/runtime:keep" && grep -q "image inspect $2" "$3"' _ \
    "$FAKE_DOCKER_STATE/references" 'shared/runtime:keep' "$DOCKER_CALLS"

reset_case
export FAKE_SHARED_REFERENCE='shared/runtime:keep'
export FAKE_BUILD_STATUS=73
set +e
(cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >/dev/null 2>&1
response_loss_status=$?
set -e
assert_true 'nonzero build/load response loss preserves the original failure status' \
  test "$response_loss_status" -eq 73
assert_true 'response-lost loaded image is recovered, registered, and exactly retired' \
  bash -c 'grep -q -- "--class oci_image" "$1" && grep -q "image rm localhost/sanctuary-ci/backend:" "$2" && test "$(cat "$3")" = "shared/runtime:keep"' _ \
    "$NODE_CALLS" "$DOCKER_CALLS" "$FAKE_DOCKER_STATE/references"

reset_case
export FAKE_SHARED_REFERENCE='shared/runtime:keep'
export FAKE_SIGNAL_AFTER_BUILD=1
set +e
(cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >/dev/null 2>&1
interrupted_status=$?
set -e
assert_true 'interrupted build/load preserves the terminating signal status' \
  test "$interrupted_status" -eq 143
assert_true 'exit-time reconciliation registers and retires a loaded response-lost reference' \
  bash -c 'grep -q -- "--class oci_image" "$1" && grep -q "image rm localhost/sanctuary-ci/backend:" "$2" && test "$(cat "$3")" = "shared/runtime:keep"' _ \
    "$NODE_CALLS" "$DOCKER_CALLS" "$FAKE_DOCKER_STATE/references"

reset_case
export FAKE_BAD_PROVENANCE=1
if (cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >/dev/null 2>&1; then
  bad 'foreign provenance was accepted'
else
  ok 'foreign provenance fails closed before registration or retirement'
fi
assert_true 'ambiguous provenance is neither registered nor mutated' \
  bash -c '! grep -q "register-resource.mjs" "$1" && ! grep -q "image rm" "$2"' _ "$NODE_CALLS" "$DOCKER_CALLS"

reset_case
export FAKE_DRIFT_ON_ID_INSPECT=1
if (cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >/dev/null 2>&1; then
  bad 'identity drift during double inspection was accepted'
else
  ok 'identity drift during double inspection fails closed'
fi
assert_true 'identity drift is neither registered nor mutated' \
  bash -c '! grep -q "register-resource.mjs" "$1" && ! grep -q "image rm" "$2"' _ "$NODE_CALLS" "$DOCKER_CALLS"

reset_case
export FAKE_SHARED_REFERENCE='shared/runtime:keep'
export FAKE_REGISTER_STATUS=41
if (cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >/dev/null 2>&1; then
  bad 'registration failure was ignored'
else
  ok 'signed registration failure remains blocking'
fi
assert_true 'registration failure still retires only the recovered exact reference' \
  bash -c 'grep -q "image rm localhost/sanctuary-ci/backend:" "$1" && test "$(cat "$2")" = "shared/runtime:keep"' _ \
    "$DOCKER_CALLS" "$FAKE_DOCKER_STATE/references"

reset_case
export FAKE_SHARED_REFERENCE='shared/runtime:keep'
export FAKE_BUILD_STATUS=73
export FAKE_REGISTER_STATUS=41
set +e
(cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >/dev/null 2>&1
build_registration_status=$?
set -e
assert_true 'original build failure takes precedence over nested registration failure' \
  test "$build_registration_status" -eq 73
assert_true 'failed registration suppresses evidence but exact retirement still runs' \
  bash -c '! grep -q "^evidence " "$1" && grep -q "image rm localhost/sanctuary-ci/backend:" "$2"' _ \
    "$NODE_CALLS" "$DOCKER_CALLS"

reset_case
export FAKE_SHARED_REFERENCE='shared/runtime:keep'
export FAKE_EVIDENCE_STATUS=42
set +e
(cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >/dev/null 2>&1
evidence_failure_status=$?
set -e
if [ "$evidence_failure_status" -eq 0 ]; then
  bad 'runtime evidence failure was ignored'
else
  ok 'runtime evidence failure remains blocking'
fi
assert_true 'runtime evidence failure status is preserved when the build succeeds' \
  test "$evidence_failure_status" -eq 42
assert_true 'runtime evidence failure still preserves the shared image identity' \
  bash -c 'grep -q "image rm localhost/sanctuary-ci/backend:" "$1" && test "$(cat "$2")" = "shared/runtime:keep"' _ \
    "$DOCKER_CALLS" "$FAKE_DOCKER_STATE/references"

reset_case
export FAKE_SHARED_REFERENCE='shared/runtime:keep'
export FAKE_BUILD_STATUS=73
export FAKE_EVIDENCE_STATUS=42
set +e
(cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >/dev/null 2>&1
combined_failure_status=$?
set -e
assert_true 'original build failure takes precedence over nested evidence failure' \
  test "$combined_failure_status" -eq 73
assert_true 'combined failure still registers and retires the exact loaded reference' \
  bash -c 'grep -q -- "--class oci_image" "$1" && grep -q "image rm localhost/sanctuary-ci/backend:" "$2" && test "$(cat "$3")" = "shared/runtime:keep"' _ \
    "$NODE_CALLS" "$DOCKER_CALLS" "$FAKE_DOCKER_STATE/references"

reset_case
if (unset SANCTUARY_CLEANUP_COORDINATED; cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >/dev/null 2>&1; then
  bad 'uncoordinated runtime image build was accepted'
else
  ok 'runtime image creation requires canonical coordinator authority'
fi
assert_true 'uncoordinated rejection occurs before Docker mutation' test ! -s "$DOCKER_CALLS"

reset_case
export FAKE_IMPORTED_CACHE_404_FIRST=1
export FAKE_SHARED_REFERENCE='shared/runtime:keep'
if (cd "$REPO_ROOT" && "$SCRIPT" prisma-migration server/Dockerfile . sanctuary-ci/migrate migration) >"$TEST_ROOT/retry-output" 2>&1; then
  ok 'matching imported-cache artifact 404 retries once and succeeds'
else
  bad 'matching imported-cache artifact 404 retry failed'
fi
assert_true 'matching cache 404 uses exactly two builds and one exact-tag preflight' \
  bash -c 'test "$(grep -c "buildx build" "$1")" -eq 2 && first_list=$(grep -n "image ls --no-trunc --filter reference=" "$1" | head -n1 | cut -d: -f1) && second_build=$(grep -n "buildx build" "$1" | tail -n1 | cut -d: -f1) && test "$first_list" -lt "$second_build"' _ "$DOCKER_CALLS"
assert_true 'cache retry preserves target, tag, provenance, context, and drops provider cache' \
  bash -c 'a=$(grep "buildx build" "$1" | head -n1); b=$(grep "buildx build" "$1" | tail -n1); atag=$(awk "{for(i=1;i<=NF;i++) if(\$i==\"--tag\") print \$(i+1)}" <<< "$a"); btag=$(awk "{for(i=1;i<=NF;i++) if(\$i==\"--tag\") print \$(i+1)}" <<< "$b"); [[ "$a" == *"--target migration"* && "$b" == *"--target migration"* && "$a" == *"--cache-from type=gha,scope=runtime-image-prisma-migration"* && "$b" == *"--no-cache"* && "$b" != *"--cache-from"* && "$b" != *"--cache-to"* && "$atag" = "$btag" && "$a" == *"SANCTUARY_SOURCE_COMMIT=$GITHUB_SHA"* && "$b" == *"SANCTUARY_SOURCE_COMMIT=$GITHUB_SHA"* && "$b" == *" ."* ]]' _ "$DOCKER_CALLS"
assert_true 'retry streams original failure diagnostics and retains normal registration/evidence' \
  bash -c 'grep -q "invalid status response 404 Not Found" "$1" && grep -q "register-resource.mjs" "$2" && grep -q "write-runtime-image-evidence.mjs" "$2"' _ "$TEST_ROOT/retry-output" "$NODE_CALLS"
assert_true 'successful retry preserves shared image and removes its temporary log' \
  bash -c 'test "$(cat "$1")" = "shared/runtime:keep" && test -z "$(find "$2" -maxdepth 1 -type f -print -quit)"' _ "$FAKE_DOCKER_STATE/references" "$TEST_ROOT/build-logs"

reset_case
export FAKE_IMPORTED_CACHE_404_FIRST=1
export FAKE_SECOND_BUILD_STATUS=74
set +e
(cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >"$TEST_ROOT/retry-failure-output" 2>&1
retry_failure_status=$?
set -e
assert_true 'second failed build status is returned without a third attempt' \
  bash -c 'test "$1" -eq 74 && test "$(grep -c "buildx build" "$2")" -eq 2' _ "$retry_failure_status" "$DOCKER_CALLS"
assert_true 'failed retry capture is removed on exit' \
  test -z "$(find "$TEST_ROOT/build-logs" -maxdepth 1 -type f -print -quit)"

reset_case
export FAKE_GENERIC_404_FIRST=1
set +e
(cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >/dev/null 2>&1
generic_404_status=$?
set -e
assert_true 'generic 404 does not trigger a retry' \
  bash -c 'test "$1" -eq 73 && test "$(grep -c "buildx build" "$2")" -eq 1' _ "$generic_404_status" "$DOCKER_CALLS"

reset_case
export FAKE_IMPORTED_CACHE_404_FIRST=1
export SANCTUARY_IMAGE_CACHE=false
set +e
(cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >/dev/null 2>&1
cache_off_status=$?
set -e
assert_true 'matching 404 with provider cache disabled does not retry or change initial cache mode' \
  bash -c 'test "$1" -eq 73 && test "$(grep -c "buildx build" "$2")" -eq 1 && ! grep -q -- "--cache-from\|--no-cache" "$2"' _ "$cache_off_status" "$DOCKER_CALLS"

reset_case
export FAKE_IMPORTED_CACHE_404_FIRST=1
export FAKE_CACHE_404_WITH_OWNED_TAG=1
export FAKE_SHARED_REFERENCE='shared/runtime:keep'
set +e
(cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >/dev/null 2>&1
tag_loaded_status=$?
set -e
assert_true 'loaded exact tag blocks retry while original recovery and cleanup proceed' \
  bash -c 'test "$1" -eq 73 && test "$(grep -c "buildx build" "$2")" -eq 1 && grep -q "image ls --no-trunc --filter reference=" "$2" && grep -q "register-resource.mjs" "$3" && grep -q "image rm" "$2" && test "$(cat "$4")" = "shared/runtime:keep"' _ "$tag_loaded_status" "$DOCKER_CALLS" "$NODE_CALLS" "$FAKE_DOCKER_STATE/references"

reset_case
export FAKE_IMPORTED_CACHE_404_FIRST=1
export FAKE_IMAGE_LIST_FAILURE=1
set +e
(cd "$REPO_ROOT" && "$SCRIPT" backend server/Dockerfile . sanctuary-ci/backend) >"$TEST_ROOT/list-failure-output" 2>&1
list_failure_status=$?
set -e
assert_true 'failed exact-tag listing blocks retry and preserves build failure' \
  bash -c 'test "$1" -eq 73 && test "$(grep -c "buildx build" "$2")" -eq 1 && grep -q "not retrying" "$3"' _ "$list_failure_status" "$DOCKER_CALLS" "$TEST_ROOT/list-failure-output"
assert_true 'failed-listing capture is still cleaned at exit' \
  test -z "$(find "$TEST_ROOT/build-logs" -maxdepth 1 -type f -print -quit)"

printf '\nTotal: %s Passed: %s Failed: %s\n' "$((pass + fail))" "$pass" "$fail"
[ "$fail" -eq 0 ]
