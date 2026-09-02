#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$ROOT_DIR/scripts/ownership/producer-hooks.sh"

export SANCTUARY_PROJECT_DIR="$ROOT_DIR"
export SANCTUARY_PROJECT=test-project
export SANCTUARY_DEPLOYMENT_ID=deploy-test
export SANCTUARY_OWNER_ID=owner-test
export SANCTUARY_OPERATION_RUN_ID=run-test
export SANCTUARY_RELEASE=v0.8.69
export SANCTUARY_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
export SANCTUARY_CLEANUP_CREATED_AT=2026-08-30T00:00:00.000Z
export SANCTUARY_OWNERSHIP_ROOT="$(mktemp -d)/ownership"

ownership_label_args compose_container exact_delete
[ "${#OWNERSHIP_LABEL_ARGS[@]}" -eq 20 ]
printf '%s\n' "${OWNERSHIP_LABEL_ARGS[@]}" | grep -q '^io.sanctuary.deployment-id=deploy-test$'

for invalid_created_at in null invalid 2026-08-30T00:00:00Z 2026-02-31T00:00:00.000Z; do
  if (SANCTUARY_CLEANUP_CREATED_AT="$invalid_created_at"; ownership_initialize_build_identity) \
      >/dev/null 2>&1; then
    echo "build identity accepted invalid creation timestamp: $invalid_created_at" >&2
    exit 1
  fi
  if (SANCTUARY_CLEANUP_CREATED_AT="$invalid_created_at"; ownership_label_args compose_container exact_delete) \
      >/dev/null 2>&1; then
    echo "ownership labels accepted invalid creation timestamp: $invalid_created_at" >&2
    exit 1
  fi
done

recovery_id="$(printf 'a%.0s' {1..64})"
recovery_calls="$(mktemp)"
recovery_inspect="$(jq -cn --arg id "$recovery_id" \
  --arg name '/sanctuary-response-lost' --arg project "$SANCTUARY_PROJECT" \
  --arg deployment "$SANCTUARY_DEPLOYMENT_ID" --arg owner "$SANCTUARY_OWNER_ID" \
  --arg run "$SANCTUARY_OPERATION_RUN_ID" --arg created "$SANCTUARY_CLEANUP_CREATED_AT" \
  --arg release "$SANCTUARY_RELEASE" --arg commit "$SANCTUARY_COMMIT" '
  [{Id:$id,Name:$name,State:{Status:"created",Running:false},Config:{Labels:{
    "io.sanctuary.project":$project,"io.sanctuary.deployment-id":$deployment,
    "io.sanctuary.owner-id":$owner,"io.sanctuary.resource-class":"compose_container",
    "io.sanctuary.lifecycle":"obsolete","io.sanctuary.cleanup-policy":"exact_delete",
    "io.sanctuary.created-at":$created,"io.sanctuary.created-by-release":$release,
    "io.sanctuary.created-by-commit":$commit,"io.sanctuary.creation-run-id":$run
  }}}]')"
docker() {
  printf '%s\n' "$*" >> "$recovery_calls"
  printf '%s\n' "$recovery_inspect"
}
test "$(recover_exact_created_container sanctuary-response-lost)" = "$recovery_id"
grep -Fxq "container inspect sanctuary-response-lost" "$recovery_calls"
grep -Fxq "container inspect $recovery_id" "$recovery_calls"
foreign_inspect="$(jq -c '.[0].Config.Labels["io.sanctuary.owner-id"] = "foreign"' \
  <<< "$recovery_inspect")"
recovery_inspect="$foreign_inspect"
if recover_exact_created_container sanctuary-response-lost >/dev/null 2>&1; then
  echo 'foreign response-lost container was recovered' >&2
  exit 1
fi
recovery_inspect="$(jq -c '.[0].Config.Labels["io.sanctuary.owner-id"] = "owner-test" | .[0].State = {Status:"running",Running:true}' <<< "$foreign_inspect")"
if recover_exact_created_container sanctuary-response-lost >/dev/null 2>&1; then
  echo 'running response-lost container was recovered' >&2
  exit 1
fi
recovery_inspect="[$(jq -c '.[0]' <<< "$foreign_inspect"),$(jq -c '.[0]' <<< "$foreign_inspect")]"
if recover_exact_created_container sanctuary-response-lost >/dev/null 2>&1; then
  echo 'ambiguous response-lost container inspection was recovered' >&2
  exit 1
fi
unset -f docker

image_id="sha256:$(printf 'b%.0s' {1..64})"
image_ref='proof:test-run'
image_inspect="$(jq -cn --arg id "$image_id" --arg ref "$image_ref" \
  '[{Id:$id,Created:"2026-08-31T00:00:00Z",RepoTags:[$ref,"shared:keep"],Config:{Labels:{"io.sanctuary.build-id":"test-run"}}}]')"
original_image_inspect="$image_inspect"
image_calls="$(mktemp)"
image_stale_inspections="$(mktemp)"
printf '0\n' > "$image_stale_inspections"
image_rm_mode=success

bounded_timeout_calls="$(mktemp)"
timeout() { printf '%s\n' "$*" >> "$bounded_timeout_calls"; return 124; }
set +e
ownership_run_docker_before_deadline "$(( $(ownership_image_now_ms) + 1000 ))" \
  image inspect "$image_ref" >/dev/null 2>&1
bounded_inspect_status=$?
set -e
test "$bounded_inspect_status" -eq 124
grep -Eq -- "^--foreground --kill-after=0.1s 0\.[0-9]{3}s docker image inspect $image_ref$" \
  "$bounded_timeout_calls"
unset -f timeout

docker() {
  local stale_count
  printf '%s\n' "$*" >> "$image_calls"
  case "$1 $2" in
    'image inspect')
      stale_count="$(cat "$image_stale_inspections")"
      if [ "$stale_count" -gt 0 ]; then
        printf '%s\n' "$((stale_count - 1))" > "$image_stale_inspections"
        jq -c '.[0].Config.Labels["io.sanctuary.build-id"] = "stale-build"' \
          <<< "$image_inspect"
      else
        printf '%s\n' "$image_inspect"
      fi
      ;;
    'image rm')
      if [ "$image_rm_mode" != response-lost-present ]; then
        image_inspect="$(jq -c --arg ref "$3" '.[0].RepoTags -= [$ref]' <<< "$image_inspect")"
      fi
      [ "$image_rm_mode" = success ] || return 74
      ;;
    'image ls')
      jq -er --arg ref "$image_ref" --arg id "$image_id" \
        'select(.[0].RepoTags | index($ref)) | $id' <<< "$image_inspect" 2>/dev/null || true
      ;;
    *) return 1 ;;
  esac
}
original_ownership_run_docker_before_deadline="$(declare -f ownership_run_docker_before_deadline)"
original_ownership_bounded_image_remove="$(declare -f ownership_bounded_image_remove)"
ownership_run_docker_before_deadline() { shift; docker "$@"; }
ownership_bounded_image_remove() { shift; docker image rm "$1"; }
original_bounded_image_inspect="$(declare -f ownership_bounded_image_inspect)"
ownership_bounded_image_inspect() { docker image inspect "$1"; }
test "$(recover_exact_built_image "$image_ref" test-run)" = "$image_id"
printf '1\n' > "$image_stale_inspections"
test "$(recover_exact_loaded_image "$image_ref" test-run)" = "$image_id"
image_inspect="$(jq -c '.[0].Config.Labels["io.sanctuary.build-id"] = "foreign-build"' \
  <<< "$original_image_inspect")"
if recover_exact_loaded_image "$image_ref" test-run >/dev/null 2>&1; then
  echo 'persistently foreign image provenance converged' >&2
  exit 1
fi
provenance_diagnostic="$(
  recover_exact_loaded_image "$image_ref" test-run 2>&1 >/dev/null || true
)"
printf '%s\n' "$provenance_diagnostic" | grep -Fq '"buildIdentityMatches":false'
image_inspect="$original_image_inspect"
eval "$original_bounded_image_inspect"
image_inspect="$(jq -c '.[0].Id |= sub("^sha256:"; "")' <<< "$image_inspect")"
test "$(recover_exact_built_image "$image_ref" test-run)" = "$image_id"
image_inspect="$original_image_inspect"
image_inspect="$(jq -c '.[0].Config.Labels["io.sanctuary.build-id"] = "foreign-build"' \
  <<< "$original_image_inspect")"
set +e
retirement_diagnostic="$(
  retire_exact_built_image "$image_ref" "$image_id" test-run 2>&1 >/dev/null
)"
retirement_status=$?
set -e
test "$retirement_status" -ne 0
printf '%s\n' "$retirement_diagnostic" \
  | grep -Fq "Exact image retirement precondition is unavailable: $image_ref"
image_inspect="$original_image_inspect"
other_image_id="sha256:$(printf 'c%.0s' {1..64})"
set +e
retirement_diagnostic="$(
  retire_exact_built_image "$image_ref" "$other_image_id" test-run 2>&1 >/dev/null
)"
retirement_status=$?
set -e
test "$retirement_status" -ne 0
printf '%s\n' "$retirement_diagnostic" \
  | grep -Fq "Exact image retirement identity changed: $image_ref"
retire_exact_built_image "$image_ref" "$image_id" test-run
grep -Fxq "image rm $image_ref" "$image_calls"
test "$(jq -r '.[0].RepoTags[]' <<< "$image_inspect")" = 'shared:keep'
image_inspect="$original_image_inspect"
image_rm_mode=response-lost-absent
retire_exact_built_image "$image_ref" "$image_id" test-run
test "$(jq -r '.[0].RepoTags[]' <<< "$image_inspect")" = 'shared:keep'
image_inspect="$original_image_inspect"
image_rm_mode=response-lost-present
set +e
retirement_diagnostic="$(
  retire_exact_built_image "$image_ref" "$image_id" test-run 2>&1 >/dev/null
)"
retirement_status=$?
set -e
test "$retirement_status" -ne 0
printf '%s\n' "$retirement_diagnostic" \
  | grep -Fq "Image reference retirement remains present after Docker failure: $image_ref"
ownership_run_docker_before_deadline() {
  shift
  [ "$1 $2" != 'image ls' ] || return 88
  docker "$@"
}
set +e
retirement_diagnostic="$(
  retire_exact_built_image "$image_ref" "$image_id" test-run 2>&1 >/dev/null
)"
retirement_status=$?
set -e
test "$retirement_status" -ne 0
printf '%s\n' "$retirement_diagnostic" \
  | grep -Fq "Exact image retirement postcondition is unavailable: $image_ref"
ownership_run_docker_before_deadline() { shift; docker "$@"; }
unset -f docker

original_list_ci_compose_lane_images="$(declare -f list_ci_compose_lane_images)"
original_recover_exact_loaded_image="$(declare -f recover_exact_loaded_image)"
original_recover_exact_loaded_image_id="$(declare -f recover_exact_loaded_image_id)"
original_register_exact_built_image="$(declare -f register_exact_built_image)"
original_register_exact_built_image_id="$(declare -f register_exact_built_image_id)"
original_ownership_bounded_image_inspect="$(declare -f ownership_bounded_image_inspect)"
original_retire_exact_built_image="$(declare -f retire_exact_built_image)"
original_ownership_new_image_deadline="$(declare -f ownership_new_image_deadline)"
compose_image_calls="$(mktemp)"
compose_list_state="$(mktemp)"
compose_recover_frontend_available=1
compose_recover_backend_available=1

export SANCTUARY_BUILD_ID=test-run SANCTUARY_IMAGE_TAG=test-run COMPOSE_PROJECT_NAME=test-compose
compose_deadline=9999999999999
sleep() { :; }
recover_exact_loaded_image() {
  printf 'recover %s %s\n' "$1" "$2" >> "$compose_image_calls"
  case "$1" in
    sanctuary-backend:test-run)
      [ "$compose_recover_backend_available" -eq 1 ] || return 1
      printf 'sha256:%064d\n' 1
      ;;
    sanctuary-frontend:test-run)
      [ "$compose_recover_frontend_available" -eq 1 ] || return 1
      printf 'sha256:%064d\n' 2
      ;;
    test-compose-rogue:test-run) printf 'sha256:%064d\n' 3 ;;
    *) return 1 ;;
  esac
}
recover_exact_loaded_image_id() {
  printf 'recover-id %s %s\n' "$1" "$2" >> "$compose_image_calls"
  [ "$1" = "sha256:$(printf '5%.0s' {1..64})" ] || return 1
  printf '%s\n' "$1"
}
register_exact_built_image() { printf 'register %s %s\n' "$1" "$2" >> "$compose_image_calls"; }
register_exact_built_image_id() { printf 'register-id %s\n' "$1" >> "$compose_image_calls"; }

# An incomplete expected set may exhaust discovery, but observed partial images
# must still be recovered under a fresh registration budget.
ownership_new_image_deadline() { printf '%s\n' 9999999999999; }
list_ci_compose_lane_images() { printf 'sha256:%064d\t%s\n' 1 'sanctuary-backend:test-run'; }
: > "$compose_image_calls"
set +e
register_ci_compose_images 0 0 \
  sanctuary-backend:test-run sanctuary-frontend:test-run 2>/dev/null
expired_discovery_status=$?
set -e
test "$expired_discovery_status" -ne 0
grep -Fq 'register sanctuary-backend:test-run' "$compose_image_calls"

# Candidate order must not matter: an earlier missing expectation cannot spend
# the later observed image's recovery budget.
list_ci_compose_lane_images() { printf 'sha256:%064d\t%s\n' 2 'sanctuary-frontend:test-run'; }
compose_recover_backend_available=0
: > "$compose_image_calls"
set +e
register_ci_compose_images 0 0 \
  sanctuary-backend:test-run sanctuary-frontend:test-run 2>/dev/null
reverse_partial_status=$?
set -e
test "$reverse_partial_status" -ne 0
grep -Fq 'register sanctuary-frontend:test-run' "$compose_image_calls"
compose_recover_backend_available=1
eval "$original_ownership_new_image_deadline"

printf '0\n' > "$compose_list_state"
list_ci_compose_lane_images() { :; }
register_ci_compose_images 1 "$compose_deadline"
test "${#REGISTERED_CI_COMPOSE_IMAGE_REFS[@]}" -eq 0
if register_ci_compose_images 0 "$compose_deadline" >/dev/null 2>&1; then
  echo 'implicit empty Compose image contract was accepted' >&2
  exit 1
fi

list_ci_compose_lane_images() {
  local count
  count="$(cat "$compose_list_state")"
  printf '%s\n' "$((count + 1))" > "$compose_list_state"
  printf 'sha256:%064d\t%s\n' 1 'sanctuary-backend:test-run'
  [ "$count" -eq 0 ] || printf 'sha256:%064d\t%s\n' 2 'sanctuary-frontend:test-run'
}
: > "$compose_image_calls"
printf '0\n' > "$compose_list_state"
register_ci_compose_images 0 "$compose_deadline" sanctuary-backend:test-run sanctuary-frontend:test-run
test "${#REGISTERED_CI_COMPOSE_IMAGE_REFS[@]}" -eq 2
test "$(grep -Fc 'register ' "$compose_image_calls")" -eq 2

list_ci_compose_lane_images() {
  printf 'sha256:%064d\t%s\n' 1 'sanctuary-backend:test-run'
  printf 'sha256:%064d\t%s\n' 2 'sanctuary-frontend:test-run'
}
: > "$compose_image_calls"
register_observed_ci_compose_images "$compose_deadline"
test "${#REGISTERED_CI_COMPOSE_IMAGE_REFS[@]}" -eq 2
test "$(grep -Fc 'register ' "$compose_image_calls")" -eq 2

list_ci_compose_lane_images() { printf 'sha256:%064d\t%s\n' 1 'sanctuary-backend:test-run'; }
: > "$compose_image_calls"
compose_recover_frontend_available=0
set +e
register_ci_compose_images 0 "$compose_deadline" \
  sanctuary-backend:test-run sanctuary-frontend:test-run 2>/dev/null
partial_registration_status=$?
set -e
test "$partial_registration_status" -ne 0
grep -Fq 'register sanctuary-backend:test-run' "$compose_image_calls"
if grep -Fq 'register sanctuary-frontend:test-run' "$compose_image_calls"; then
  echo 'missing expected Compose image was registered' >&2
  exit 1
fi
compose_recover_frontend_available=1

list_ci_compose_lane_images() { :; }
: > "$compose_image_calls"
set +e
register_ci_compose_images 0 "$compose_deadline" \
  sanctuary-backend:test-run sanctuary-frontend:test-run 2>/dev/null
missing_list_registration_status=$?
set -e
test "$missing_list_registration_status" -ne 0
grep -Fq 'register sanctuary-backend:test-run' "$compose_image_calls"
grep -Fq 'register sanctuary-frontend:test-run' "$compose_image_calls"

printf '0\n' > "$compose_list_state"
list_ci_compose_lane_images() {
  local count
  count="$(cat "$compose_list_state")"
  printf '%s\n' "$((count + 1))" > "$compose_list_state"
  [ "$count" -lt 4 ] || return 70
  printf 'sha256:%064d\t%s\n' 1 'sanctuary-backend:test-run'
}
: > "$compose_image_calls"
set +e
register_ci_compose_images 0 "$compose_deadline" \
  sanctuary-backend:test-run sanctuary-frontend:test-run 2>/dev/null
terminal_list_failure_status=$?
set -e
test "$terminal_list_failure_status" -ne 0
grep -Fq 'register sanctuary-backend:test-run' "$compose_image_calls"

list_ci_compose_lane_images() {
  printf 'sha256:%064d\t%s\n' 1 'sanctuary-backend:test-run'
  printf 'sha256:%064d\t%s\n' 3 'test-compose-rogue:test-run'
}
: > "$compose_image_calls"
set +e
register_ci_compose_images 0 "$compose_deadline" sanctuary-backend:test-run 2>/dev/null
unexpected_registration_status=$?
set -e
test "$unexpected_registration_status" -ne 0
grep -Fq 'register sanctuary-backend:test-run' "$compose_image_calls"
grep -Fq 'register test-compose-rogue:test-run' "$compose_image_calls"

dangling_id="sha256:$(printf '5%.0s' {1..64})"
list_ci_compose_lane_images() {
  printf 'sha256:%064d\t%s\n' 1 'sanctuary-backend:test-run'
  printf '%s\t%s\n' "$dangling_id" '<none>:<none>'
}
: > "$compose_image_calls"
set +e
register_ci_compose_images 0 "$compose_deadline" sanctuary-backend:test-run 2>/dev/null
dangling_registration_status=$?
set -e
test "$dangling_registration_status" -ne 0
grep -Fq "recover-id $dangling_id test-run" "$compose_image_calls"
grep -Fq "register-id $dangling_id" "$compose_image_calls"

list_ci_compose_lane_images() { printf 'sha256:%064d\t%s\n' 1 'sanctuary-backend:test-run'; }
recover_exact_loaded_image() { return 1; }
if register_ci_compose_images 0 "$compose_deadline" sanctuary-backend:test-run >/dev/null 2>&1; then
  echo 'foreign Compose image provenance was registered' >&2
  exit 1
fi
test "${#REGISTERED_CI_COMPOSE_IMAGE_REFS[@]}" -eq 0

REGISTERED_CI_COMPOSE_IMAGE_REFS=(sanctuary-backend:test-run)
REGISTERED_CI_COMPOSE_IMAGE_IDS=("sha256:$(printf '4%.0s' {1..64})")
ownership_bounded_image_inspect() {
  jq -cn --arg id "${REGISTERED_CI_COMPOSE_IMAGE_IDS[0]}" \
    '[{Id:$id,RepoTags:["sanctuary-backend:test-run","shared:keep"]}]'
}
retire_exact_built_image() { printf 'retire %s %s %s\n' "$1" "$2" "$3" >> "$compose_image_calls"; }
list_ci_compose_lane_images() {
  echo 'retirement performed a fresh image-list discovery' >&2
  return 1
}
: > "$compose_image_calls"
retire_shared_ci_compose_image_references "$compose_deadline"
grep -Fq 'retire sanctuary-backend:test-run' "$compose_image_calls"

unset -f sleep list_ci_compose_lane_images recover_exact_loaded_image recover_exact_loaded_image_id
unset -f register_exact_built_image register_exact_built_image_id
unset -f ownership_bounded_image_inspect retire_exact_built_image
eval "$original_list_ci_compose_lane_images"
eval "$original_recover_exact_loaded_image"
eval "$original_recover_exact_loaded_image_id"
eval "$original_register_exact_built_image"
eval "$original_register_exact_built_image_id"
eval "$original_ownership_bounded_image_inspect"
eval "$original_retire_exact_built_image"
eval "$original_ownership_run_docker_before_deadline"
eval "$original_ownership_bounded_image_remove"

register_owned_resource temporary_artifact active exact_delete path /tmp/owned path-123 run-test
test "$(find "$SANCTUARY_OWNERSHIP_ROOT/registrations/temporary_artifact" -name '*.json' | wc -l)" -eq 1

runtime_dir="$(mktemp -d)/runtime"
local_root="$(env -i \
  HOME="${HOME:-}" PATH="$PATH" \
  SANCTUARY_RUNTIME_DIR="$runtime_dir" \
  bash -c 'set -eu; source "$1"; ownership_initialize; printf "%s" "$SANCTUARY_OWNERSHIP_ROOT"' \
  _ "$ROOT_DIR/scripts/ownership/producer-hooks.sh")"
[ "$local_root" = "$runtime_dir/ownership" ]

ci_root="$(env -i \
  HOME="${HOME:-}" PATH="$PATH" \
  SANCTUARY_CI_PROVIDER_OVERRIDE=fixture-ci \
  SANCTUARY_CI_RUN_ID_OVERRIDE=fixture-run \
  SANCTUARY_CI_TEMP_DIR_OVERRIDE=/tmp/sanctuary-fixture-temp \
  bash -c 'set -eu; source "$1"; ownership_initialize; printf "%s" "$SANCTUARY_OWNERSHIP_ROOT"' \
  _ "$ROOT_DIR/scripts/ownership/producer-hooks.sh")"
[ "$ci_root" = /tmp/sanctuary-fixture-temp/sanctuary-ownership/run-fixture-run ]

build_identity="$(env -i \
  HOME="${HOME:-}" PATH="$PATH" \
  SANCTUARY_PROJECT_DIR="$ROOT_DIR" \
  SANCTUARY_PROJECT=test-build \
  SANCTUARY_OPERATION_RUN_ID=run-build \
  SANCTUARY_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)" \
  bash -c 'set -eu; source "$1"; ownership_initialize_build_identity; for name in SANCTUARY_PROJECT SANCTUARY_DEPLOYMENT_ID SANCTUARY_OWNER_ID SANCTUARY_OPERATION_RUN_ID SANCTUARY_RELEASE SANCTUARY_COMMIT SANCTUARY_CLEANUP_CREATED_AT SANCTUARY_SOURCE_COMMIT SANCTUARY_IMAGE_LOCK_SHA256 SANCTUARY_VERSION SANCTUARY_BUILD_ID; do test -n "${!name:-}"; export -p | grep -q "declare -x $name="; done; printf "%s\n%s\n%s\n%s" "$SANCTUARY_SOURCE_COMMIT" "$SANCTUARY_IMAGE_LOCK_SHA256" "$SANCTUARY_VERSION" "$SANCTUARY_BUILD_ID"' \
  _ "$ROOT_DIR/scripts/ownership/producer-hooks.sh")"
expected_lock_sha="$(ownership_sha256 < "$ROOT_DIR/config/container-image-lock.json")"
expected_version="$(awk -F'"' '/"version":/{print $4; exit}' "$ROOT_DIR/package.json")"
expected_commit="$(git -C "$ROOT_DIR" rev-parse HEAD)"
test "$build_identity" = "$expected_commit
$expected_lock_sha
$expected_version
run-build"

override_identity="$(env -i \
  HOME="${HOME:-}" PATH="$PATH" \
  SANCTUARY_PROJECT_DIR="$ROOT_DIR" \
  SANCTUARY_PROJECT=explicit-project \
  SANCTUARY_DEPLOYMENT_ID=explicit-deployment \
  SANCTUARY_OWNER_ID=explicit-owner \
  SANCTUARY_OPERATION_RUN_ID=explicit-run \
  SANCTUARY_RELEASE=explicit-release \
  SANCTUARY_COMMIT="$expected_commit" \
  SANCTUARY_CLEANUP_CREATED_AT=2000-01-01T00:00:00.000Z \
  SANCTUARY_SOURCE_COMMIT=explicit-source \
  SANCTUARY_IMAGE_LOCK_SHA256=explicit-lock \
  SANCTUARY_VERSION=explicit-version \
  SANCTUARY_BUILD_ID=explicit-build \
  bash -c 'set -eu; source "$1"; ownership_initialize_build_identity; printf "%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s" "$SANCTUARY_PROJECT" "$SANCTUARY_DEPLOYMENT_ID" "$SANCTUARY_OWNER_ID" "$SANCTUARY_OPERATION_RUN_ID" "$SANCTUARY_RELEASE" "$SANCTUARY_COMMIT" "$SANCTUARY_CLEANUP_CREATED_AT" "$SANCTUARY_SOURCE_COMMIT" "$SANCTUARY_IMAGE_LOCK_SHA256" "$SANCTUARY_VERSION" "$SANCTUARY_BUILD_ID"' \
  _ "$ROOT_DIR/scripts/ownership/producer-hooks.sh")"
test "$override_identity" = "explicit-project
explicit-deployment
explicit-owner
explicit-run
explicit-release
$expected_commit
2000-01-01T00:00:00.000Z
explicit-source
explicit-lock
explicit-version
explicit-build"

refreshed_identity="$(SANCTUARY_PROJECT_DIR="$ROOT_DIR" \
  SANCTUARY_PROJECT=refresh-project \
  SANCTUARY_OPERATION_RUN_ID=refresh-run \
  SANCTUARY_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  SANCTUARY_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  SANCTUARY_IMAGE_LOCK_SHA256=stale-lock \
  SANCTUARY_VERSION=stale-version \
  SANCTUARY_BUILD_ID=stale-build \
  bash -c 'set -eu; source "$1"; ownership_refresh_checkout_build_identity; printf "%s\n%s\n%s\n%s\n%s" "$SANCTUARY_COMMIT" "$SANCTUARY_SOURCE_COMMIT" "$SANCTUARY_IMAGE_LOCK_SHA256" "$SANCTUARY_VERSION" "$SANCTUARY_BUILD_ID"' \
  _ "$ROOT_DIR/scripts/ownership/producer-hooks.sh")"
test "$refreshed_identity" = "$expected_commit
$expected_commit
$expected_lock_sha
$expected_version
refresh-run"

rendered_test_compose="$(env -i HOME="${HOME:-}" PATH="$PATH" \
  "$ROOT_DIR/scripts/ownership/run-compose.sh" --project-directory "$ROOT_DIR" \
  -f "$ROOT_DIR/docker/compose/test.yml" config --format json)"
RENDERED_TEST_COMPOSE="$rendered_test_compose" node - <<'NODE'
const rendered = JSON.parse(process.env.RENDERED_TEST_COMPOSE);
const projects = new Set(Object.values(rendered.services).map((service) => service.labels['io.sanctuary.project']));
if (projects.size !== 1 || !projects.has(rendered.name)) {
  throw new Error(`Compose project ${rendered.name} does not match ownership labels: ${[...projects].join(',')}`);
}
NODE

rendered_operator_compose="$(env -i HOME="${HOME:-}" PATH="$PATH" \
  SANCTUARY_RUNTIME_DIR="$runtime_dir/operator" \
  SANCTUARY_ENV_FILE=/dev/null \
  SANCTUARY_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  SANCTUARY_SOURCE_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  SANCTUARY_IMAGE_LOCK_SHA256=stale-lock SANCTUARY_VERSION=stale-version SANCTUARY_BUILD_ID=stale-build \
  JWT_SECRET=test-jwt ENCRYPTION_KEY=12345678901234567890123456789012 ENCRYPTION_SALT=test-salt \
  GATEWAY_SECRET=test-gateway POSTGRES_PASSWORD=test-postgres GRAFANA_PASSWORD=test-grafana REDIS_PASSWORD=test-redis \
  WORKER_DIAGNOSTICS_SECRET=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
  LLM_EGRESS_PROXY_SECRET=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
  "$ROOT_DIR/scripts/ownership/run-operator-compose.sh" config --format json)"
RENDERED_OPERATOR_COMPOSE="$rendered_operator_compose" EXPECTED_COMMIT="$expected_commit" \
  EXPECTED_LOCK="$expected_lock_sha" EXPECTED_VERSION="$expected_version" node - <<'NODE'
const rendered = JSON.parse(process.env.RENDERED_OPERATOR_COMPOSE);
const args = rendered.services.backend.build.args;
if (args.SANCTUARY_SOURCE_COMMIT !== process.env.EXPECTED_COMMIT
  || args.SANCTUARY_IMAGE_LOCK_SHA256 !== process.env.EXPECTED_LOCK
  || args.SANCTUARY_BUILD_VERSION !== process.env.EXPECTED_VERSION
  || args.SANCTUARY_BUILD_ID === 'stale-build') {
  throw new Error(`operator Compose retained stale provenance: ${JSON.stringify(args)}`);
}
if (rendered.services.backend.labels['io.sanctuary.created-by-commit'] !== process.env.EXPECTED_COMMIT) {
  throw new Error('operator Compose retained a stale creation commit');
}
NODE

volume_recovery_calls="$(mktemp)"
ownership_run_docker_before_deadline() { shift; docker "$@"; }
docker() {
  printf '%s\n' "$*" >> "$volume_recovery_calls"
  case "$1 $2" in
    'volume create') return 23 ;;
    'volume inspect') printf '[{"Name":"canary-volume"}]\n' ;;
    *) return 1 ;;
  esac
}
inspect_owned_ci_volume() { cat >/dev/null; printf '%064d' 0; }
register_owned_resource() { printf 'registered %s\n' "$*" >> "$volume_recovery_calls"; }
set +e
create_and_register_owned_volume canary-volume --label io.sanctuary.project=test-project
volume_status=$?
set -e
test "$volume_status" -eq 23
grep -Fq 'volume inspect canary-volume' "$volume_recovery_calls"
grep -Fq 'registered compose_volume obsolete exact_delete name canary-volume' "$volume_recovery_calls"

: > "$volume_recovery_calls"
register_owned_resource() { printf 'registration failed\n' >> "$volume_recovery_calls"; return 41; }
set +e
create_and_register_owned_volume canary-volume
combined_volume_status=$?
set -e
test "$combined_volume_status" -eq 23
grep -Fq 'registration failed' "$volume_recovery_calls"

: > "$volume_recovery_calls"
inspect_owned_ci_volume() { cat >/dev/null; return 1; }
set +e
create_and_register_owned_volume ambiguous-volume
ambiguous_status=$?
set -e
test "$ambiguous_status" -eq 23
if grep -Fq 'registered ' "$volume_recovery_calls"; then
  echo 'ambiguous response-loss volume was registered' >&2
  exit 1
fi
docker() {
  printf '%s\n' "$*" >> "$volume_recovery_calls"
  case "$1 $2" in
    'volume create') return 23 ;;
    'volume inspect')
      inspect_count="$(grep -Fc 'volume inspect replacement-volume' "$volume_recovery_calls")"
      printf '[{"Name":"replacement-%s"}]\n' "$inspect_count"
      ;;
    *) return 1 ;;
  esac
}
inspect_owned_ci_volume() { jq -r '.[0].Name'; }
: > "$volume_recovery_calls"
set +e
create_and_register_owned_volume replacement-volume
replacement_status=$?
set -e
test "$replacement_status" -eq 23
if grep -Fq 'registered ' "$volume_recovery_calls"; then
  echo 'name-replaced response-loss volume was registered' >&2
  exit 1
fi
unset -f docker inspect_owned_ci_volume register_owned_resource
eval "$original_ownership_run_docker_before_deadline"

registration_chain_calls="$(mktemp)"
registration_deadline_calls="$(mktemp)"

# Volume discovery and every exact recovery have independent budgets so slow
# signing or an earlier missing volume cannot starve later observed volumes.
(
  volume_calls="$(mktemp)"
  volume_deadline_counter="$(mktemp)"
  printf '%s\n' 0 > "$volume_deadline_counter"
  ownership_new_image_deadline() {
    local count
    count="$(cat "$volume_deadline_counter")"
    count=$((count + 1))
    printf '%s\n' "$count" > "$volume_deadline_counter"
    printf 'volume-deadline-%s\n' "$count"
  }
  ownership_run_docker_before_deadline() {
    local deadline="$1"; shift
    if [ "$1 $2" = 'volume ls' ]; then
      printf '%s\n' volume-a volume-b
    else
      return 1
    fi
  }
  recover_exact_owned_ci_volume() { printf 'recover %s %s\n' "$1" "$2" >> "$volume_calls"; printf 'id-%s\n' "$1"; }
  register_owned_resource() { printf 'register %s\n' "$5" >> "$volume_calls"; }
  register_ci_compose_volumes discovery-deadline
  grep -Fq 'recover volume-a volume-deadline-1' "$volume_calls"
  grep -Fq 'recover volume-b volume-deadline-2' "$volume_calls"
  grep -Fq 'register volume-a' "$volume_calls"
  grep -Fq 'register volume-b' "$volume_calls"

  : > "$volume_calls"
  register_ci_compose_volumes discovery-deadline per-resource \
    test-compose_volume-a test-compose_volume-b
  if grep -Fq 'volume ls' "$volume_calls"; then
    echo 'exact expected Compose volumes performed a daemon-wide discovery' >&2
    exit 1
  fi
  grep -Fq 'recover test-compose_volume-a' "$volume_calls"
  grep -Fq 'recover test-compose_volume-b' "$volume_calls"
)

set +e
(
  export SANCTUARY_CLEANUP_COORDINATED=1
  ownership_new_image_deadline() {
    local count
    count="$(wc -l < "$registration_deadline_calls")"
    printf 'deadline-%s\n' "$((count + 1))" >> "$registration_deadline_calls"
    printf 'deadline-%s\n' "$((count + 1))"
  }
  ownership_initialize_build_identity() { printf '%s\n' identity >> "$registration_chain_calls"; }
  export_lane_image_tag() { printf '%s\n' tag >> "$registration_chain_calls"; }
  register_ci_compose_images() { printf 'images %s\n' "$2" >> "$registration_chain_calls"; return 37; }
  register_ci_compose_volumes() { printf 'volumes %s %s\n' "$1" "${2:-per-resource}" >> "$registration_chain_calls"; }
  retire_shared_ci_compose_image_references() { printf 'retire %s\n' "$1" >> "$registration_chain_calls"; }
  register_ci_compose_resources
)
registration_chain_status=$?
set -e
test "$registration_chain_status" -eq 37
test "$(cat "$registration_chain_calls")" = "identity
tag
images deadline-1
volumes deadline-2 per-resource"

: > "$registration_chain_calls"
: > "$registration_deadline_calls"
(
  export SANCTUARY_CLEANUP_COORDINATED=1
  ownership_new_image_deadline() { printf '%s\n' deadline-fast; }
  ownership_initialize_build_identity() { printf '%s\n' identity >> "$registration_chain_calls"; }
  export_lane_image_tag() { printf '%s\n' tag >> "$registration_chain_calls"; }
  register_observed_ci_compose_images() { printf 'observed %s\n' "$1" >> "$registration_chain_calls"; }
  register_ci_compose_volumes() { printf 'volumes %s %s\n' "$1" "${2:-per-resource}" >> "$registration_chain_calls"; }
  retire_shared_ci_compose_image_references() { printf '%s\n' unexpected-retire >> "$registration_chain_calls"; }
  register_ci_compose_resources --interrupt-fallback \
    --expected-image sanctuary-backend
)
test "$(cat "$registration_chain_calls")" = "identity
tag
observed deadline-fast
volumes deadline-fast shared"

: > "$registration_chain_calls"
(
  export SANCTUARY_CLEANUP_COORDINATED=1
  ownership_initialize_build_identity() { printf '%s\n' identity >> "$registration_chain_calls"; }
  export_lane_image_tag() { printf '%s\n' tag >> "$registration_chain_calls"; }
  register_ci_compose_images() { printf '%s\n' images >> "$registration_chain_calls"; }
  register_ci_compose_volumes() { printf '%s\n' volumes >> "$registration_chain_calls"; }
  retire_shared_ci_compose_image_references() { printf '%s\n' retire >> "$registration_chain_calls"; }
  register_ci_compose_resources --defer-image-reference-retirement \
    --expected-image sanctuary-backend
)
test "$(cat "$registration_chain_calls")" = "identity
tag
images
volumes"

compose_fake_root="$(mktemp -d)"
compose_fake_calls="$compose_fake_root/calls"
mkdir -p "$compose_fake_root/bin"
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\\n" "$*" >> "$COMPOSE_FAKE_CALLS"' \
  > "$compose_fake_root/bin/docker"
chmod +x "$compose_fake_root/bin/docker"
COMPOSE_FAKE_CALLS="$compose_fake_calls" PATH="$compose_fake_root/bin:$PATH" \
  "$ROOT_DIR/scripts/ownership/run-compose.sh" config >/dev/null
grep -Fq 'compose config' "$compose_fake_calls"
if COMPOSE_FAKE_CALLS="$compose_fake_calls" PATH="$compose_fake_root/bin:$PATH" \
    "$ROOT_DIR/scripts/ownership/run-compose.sh" up -d >/dev/null 2>&1; then
  echo 'direct mutating run-compose invocation was accepted' >&2
  exit 1
fi
test "$(grep -Fc 'compose up -d' "$compose_fake_calls" || true)" -eq 0
COMPOSE_FAKE_CALLS="$compose_fake_calls" PATH="$compose_fake_root/bin:$PATH" \
  SANCTUARY_CLEANUP_COORDINATED=1 "$ROOT_DIR/scripts/ownership/run-compose.sh" up -d >/dev/null
grep -Fq 'compose up -d' "$compose_fake_calls"
echo 'producer ownership hooks passed'
