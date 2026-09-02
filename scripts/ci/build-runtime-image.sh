#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$SCRIPT_DIR/../ownership/producer-hooks.sh"

fail() {
  echo "build-runtime-image: $*" >&2
  return 1
}

usage() {
  echo "Usage: $0 ROLE DOCKERFILE CONTEXT IMAGE_REPOSITORY" >&2
  exit 2
}

validate_inputs() {
  local role="$1" image_repository="$2"
  [[ "$role" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]] \
    || fail 'role must be a lowercase path-safe identifier'
  [[ "$image_repository" =~ ^[a-z0-9][a-z0-9._/-]{0,254}$ ]] \
    || fail 'image repository must not include a tag or digest'
  [ "${SANCTUARY_CLEANUP_COORDINATED:-}" = 1 ] \
    || fail 'canonical cleanup coordinator authority is required'
}

run_scope_digest() {
  printf '%s\0%s\0%s' "$SANCTUARY_OPERATION_RUN_ID" "$(ci_run_attempt)" "$1" \
    | ownership_sha256
}

image_reference() {
  local repository="$1" role="$2" digest
  digest="$(run_scope_digest "$role")"
  printf '%s:%s-%s-%s' "$repository" "${SANCTUARY_SOURCE_COMMIT:0:12}" "${digest:0:16}" "$role"
}

canonical_image_repository() {
  local repository="$1" first="${1%%/*}"
  case "$first" in
    localhost|*.*|*:*) printf '%s\n' "$repository" ;;
    *) printf 'localhost/%s\n' "$repository" ;;
  esac
}

image_inspection() {
  docker image inspect "$1"
}

verified_image_id() {
  local image_ref="$1" expected_id="${2:-}"
  jq -er \
    --arg ref "$image_ref" --arg expected "$expected_id" \
    --arg source "$SANCTUARY_SOURCE_COMMIT" --arg lock "$SANCTUARY_IMAGE_LOCK_SHA256" \
    --arg version "$SANCTUARY_VERSION" --arg build "$SANCTUARY_BUILD_ID" '
      (if (.[0].Id | type == "string" and test("^[0-9a-f]{64}$"))
        then "sha256:\(.[0].Id)" else .[0].Id end) as $id
      | if length == 1
        and ($id | type == "string" and test("^sha256:[0-9a-f]{64}$"))
        and ($expected == "" or $id == $expected)
        and ((.[0].RepoTags // []) | index($ref) != null)
        and .[0].Config.Labels["org.opencontainers.image.source"]
          == "https://github.com/nekoguntai-castle/sanctuary"
        and .[0].Config.Labels["org.opencontainers.image.revision"] == $source
        and .[0].Config.Labels["dev.sanctuary.image-lock-sha256"] == $lock
        and .[0].Config.Labels["org.opencontainers.image.version"] == $version
        and .[0].Config.Labels["io.sanctuary.build-id"] == $build
      then $id else error("runtime image provenance mismatch") end
    '
}

recover_exact_runtime_image() {
  local image_ref="$1" first_id second_id
  first_id="$(image_inspection "$image_ref" | verified_image_id "$image_ref")" || return 1
  second_id="$(image_inspection "$image_ref" | verified_image_id "$image_ref" "$first_id")" \
    || return 2
  [ "$first_id" = "$second_id" ] || return 2
  printf '%s\n' "$first_id"
}

other_image_reference_state() {
  local image_ref="$1" image_id="$2"
  image_inspection "$image_ref" | jq -cer --arg ref "$image_ref" --arg id "$image_id" '
    (if (.[0].Id | type == "string" and test("^[0-9a-f]{64}$"))
      then "sha256:\(.[0].Id)" else .[0].Id end) as $observed
    | if length == 1 and $observed == $id
      and ((.[0].RepoTags // []) | index($ref) != null)
      and ((.[0].RepoTags // []) | all(type == "string" and length > 0))
      and ((.[0].RepoDigests // []) | all(type == "string" and length > 0))
    then {
      otherTags: ((.[0].RepoTags // []) - [$ref] | unique | sort),
      digests: ((.[0].RepoDigests // []) | unique | sort)
    }
    else error("runtime image reference set mismatch") end
  '
}

prove_shared_image_survived() {
  local image_id="$1" expected_state="$2" selector first second inspection
  selector="$(jq -er '.otherTags[0]' <<< "$expected_state")" || return 1
  first="$(image_inspection "$selector")" || return 1
  second="$(image_inspection "$selector")" || return 1
  for inspection in "$first" "$second"; do
    INSPECTION="$inspection" jq -en \
      --arg id "$image_id" --argjson expected "$expected_state" '
        (env.INSPECTION | fromjson) as $records
        | $records | length == 1
          and ((if (.[0].Id | type == "string" and test("^[0-9a-f]{64}$"))
            then "sha256:\(.[0].Id)" else .[0].Id end) == $id)
          and ((.[0].RepoTags // []) | unique | sort) == $expected.otherTags
          and ((.[0].RepoDigests // []) | unique | sort) == $expected.digests
      ' >/dev/null || return 1
  done
}

retire_exact_runtime_reference() {
  local image_ref="$1" image_id="$2" reference_state listed_references listed_ids id_matches rm_status=0
  reference_state="$(other_image_reference_state "$image_ref" "$image_id")" || return 1
  docker image rm "$image_ref" >/dev/null || rm_status=$?
  listed_references="$(docker image ls --no-trunc --filter "reference=$image_ref" \
    --format '{{.ID}}')" || return 1
  [ -z "$listed_references" ] || return 1
  if [ "$(jq -r '.otherTags | length' <<< "$reference_state")" -eq 0 ]; then
    listed_ids="$(docker image ls --all --no-trunc --format '{{.ID}}')" || return 1
    id_matches="$(printf '%s\n' "$listed_ids" | sed 's/^sha256://' \
      | grep -Fxc -- "${image_id#sha256:}" || true)"
    [ "$id_matches" -eq 0 ] || return 1
  else
    prove_shared_image_survived "$image_id" "$reference_state" || return 1
  fi
  [ "$rm_status" -eq 0 ] || echo "build-runtime-image: reconciled lost image-rm response for $image_ref" >&2
}

owned_image_ref=''
owned_image_id=''

retire_on_exit() {
  local subject_status="$?" retirement_status=0 recovered_id
  trap - EXIT HUP INT TERM
  if [ -z "$owned_image_id" ] && [ -n "$owned_image_ref" ]; then
    if recovered_id="$(recover_exact_runtime_image "$owned_image_ref")"; then
      owned_image_id="$recovered_id"
      register_exact_built_image "$owned_image_ref" "$owned_image_id" || retirement_status=$?
    fi
  fi
  if [ -n "$owned_image_id" ]; then
    retire_exact_runtime_reference "$owned_image_ref" "$owned_image_id" || retirement_status=$?
  fi
  if [ "$subject_status" -eq 0 ] && [ "$retirement_status" -ne 0 ]; then
    subject_status="$retirement_status"
  fi
  exit "$subject_status"
}

[ "$#" -eq 4 ] || usage
role="$1"
dockerfile="$2"
context="$3"
image_repository="$4"
validate_inputs "$role" "$image_repository"
image_repository="$(canonical_image_repository "$image_repository")"

export SANCTUARY_PROJECT_DIR="$(pwd -P)"
ownership_refresh_checkout_build_identity
owned_image_ref="$(image_reference "$image_repository" "$role")"
trap retire_on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

cache_args=()
if [ "${SANCTUARY_IMAGE_CACHE:-true}" = true ]; then
  # The provider cache is deliberately stable across runs and therefore shared.
  # It has no exact run-owned identity and must never be pruned by this lane.
  cache_args+=(--cache-from "type=gha,scope=runtime-image-$role")
  cache_args+=(--cache-to "type=gha,mode=max,scope=runtime-image-$role,ignore-error=true")
fi

build_status=0
docker buildx build \
  --file "$dockerfile" \
  --load \
  --tag "$owned_image_ref" \
  --build-arg "SANCTUARY_SOURCE_COMMIT=$SANCTUARY_SOURCE_COMMIT" \
  --build-arg "SANCTUARY_IMAGE_LOCK_SHA256=$SANCTUARY_IMAGE_LOCK_SHA256" \
  --build-arg "SANCTUARY_BUILD_VERSION=$SANCTUARY_VERSION" \
  --build-arg "SANCTUARY_BUILD_ID=$SANCTUARY_BUILD_ID" \
  "${cache_args[@]}" \
  "$context" || build_status=$?

recovery_status=0
owned_image_id="$(recover_exact_runtime_image "$owned_image_ref")" || recovery_status=$?
if [ "$recovery_status" -ne 0 ]; then
  echo "build-runtime-image: exact loaded image recovery is ambiguous for $owned_image_ref" >&2
  if [ "$recovery_status" -eq 2 ]; then owned_image_ref=''; fi
  [ "$build_status" -ne 0 ] && exit "$build_status"
  exit 1
fi

registration_status=0
register_exact_built_image "$owned_image_ref" "$owned_image_id" || registration_status=$?

evidence_status=0
if [ "$registration_status" -eq 0 ]; then
  node scripts/ci/write-runtime-image-evidence.mjs \
    --role "$role" \
    --image "$owned_image_ref" \
    --commit "$SANCTUARY_SOURCE_COMMIT" \
    --image-lock config/container-image-lock.json \
    --output-dir "${SANCTUARY_IMAGE_EVIDENCE_DIR:-.tmp/runtime-image-evidence}/$role" \
    || evidence_status=$?
fi

[ "$build_status" -eq 0 ] || exit "$build_status"
[ "$registration_status" -eq 0 ] || exit "$registration_status"
[ "$evidence_status" -eq 0 ] || exit "$evidence_status"
