#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then
  exec "$SCRIPT_DIR/cleanup-ci-callsite.sh" auto-run \
    --lane jade-protocol-harness --checkout-root "$PROJECT_ROOT" -- "$0" "$@"
fi

# shellcheck source=scripts/ownership/producer-hooks.sh
. "$SCRIPT_DIR/../ownership/producer-hooks.sh"

readonly manifest='config/jade-protocol-harness.json'
readonly runtime_image="$(jq -er '.runtime.image' "$manifest")"
readonly run_identity="$(ci_run_id)-${SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE:-0}-$$"
readonly evidence_root="$(ci_workspace)/.tmp/ci-evidence/jade-protocol/${run_identity}"
readonly diagnostics_dir="$evidence_root/diagnostics"
readonly container_name="sanctuary-jade-protocol-${run_identity}"
readonly cidfile="$diagnostics_dir/container.cid"
readonly create_output="$diagnostics_dir/container.create-output"
case "$container_name" in
  sanctuary-jade-protocol-[A-Za-z0-9._-]*) ;;
  *) echo "Unsafe Jade protocol container name: $container_name" >&2; exit 1 ;;
esac
export SANCTUARY_PROJECT='jade-protocol-proof'
export SANCTUARY_PROJECT_DIR="$PROJECT_ROOT"
export SANCTUARY_OPERATION_RUN_ID="run-jade-protocol-${run_identity}"
export SANCTUARY_RESOURCE_LIFECYCLE='obsolete'
ownership_label_args compose_container exact_delete
readonly -a container_ownership_labels=("${OWNERSHIP_LABEL_ARGS[@]}")
mkdir -p "$diagnostics_dir"
readonly ci_environment_file="$(ci_env_file)"
if [ "$ci_environment_file" != '/dev/stdout' ]; then
  ci_emit_env "JADE_PROTOCOL_PROOF_DIR=$evidence_root"
fi

jq -e -f scripts/ci/validate-jade-protocol-manifest.jq "$manifest" >/dev/null

container_id=''
container_identity_verified=0

assert_registered_transient() {
  local exact_id="$1"
  docker container inspect "$exact_id" | jq -e \
    --arg id "$exact_id" --arg name "$container_name" \
    --arg project "$SANCTUARY_PROJECT" --arg deployment "$SANCTUARY_DEPLOYMENT_ID" \
    --arg owner "$SANCTUARY_OWNER_ID" --arg run "$SANCTUARY_OPERATION_RUN_ID" \
    --arg created "$SANCTUARY_CLEANUP_CREATED_AT" --arg release "$SANCTUARY_RELEASE" \
    --arg commit "$SANCTUARY_COMMIT" '
      length == 1 and .[0].Id == $id and .[0].Name == ("/" + $name)
      and .[0].Config.Labels["io.sanctuary.project"] == $project
      and .[0].Config.Labels["io.sanctuary.deployment-id"] == $deployment
      and .[0].Config.Labels["io.sanctuary.owner-id"] == $owner
      and .[0].Config.Labels["io.sanctuary.resource-class"] == "compose_container"
      and .[0].Config.Labels["io.sanctuary.lifecycle"] == "obsolete"
      and .[0].Config.Labels["io.sanctuary.cleanup-policy"] == "exact_delete"
      and .[0].Config.Labels["io.sanctuary.created-at"] == $created
      and .[0].Config.Labels["io.sanctuary.created-by-release"] == $release
      and .[0].Config.Labels["io.sanctuary.created-by-commit"] == $commit
      and .[0].Config.Labels["io.sanctuary.creation-run-id"] == $run
    ' >/dev/null
}

container_absence_proven() {
  local exact_id="$1" listed
  if docker container inspect "$exact_id" >/dev/null 2>&1; then return 1; fi
  listed="$(docker container ls --all --no-trunc --filter "id=$exact_id" --format '{{.ID}}')" \
    || return 2
  [ -z "$listed" ]
}

retire_registered_transient() {
  local exact_id="$1" identity_was_verified="${2:-0}" absence_status=0 remove_status=0
  if ! assert_registered_transient "$exact_id"; then
    container_absence_proven "$exact_id" || absence_status=$?
    if [ "$absence_status" -ne 0 ] || [ "$identity_was_verified" -ne 1 ]; then
      echo "Jade protocol container identity or absence is ambiguous: $exact_id" >&2
      return 1
    fi
    return 0
  fi
  timeout --foreground --kill-after=5s 20s docker container rm --force "$exact_id" >/dev/null \
    || remove_status=$?
  container_absence_proven "$exact_id" || absence_status=$?
  if [ "$absence_status" -ne 0 ]; then
    echo "Jade protocol container removal is unproven: $exact_id (remove=$remove_status, inspect=$absence_status)" >&2
    return 1
  fi
}

cleanup() {
  local subject_status=$? cleanup_status=0 final_status
  trap - EXIT INT TERM
  if [ -n "$container_id" ]; then
    retire_registered_transient "$container_id" "$container_identity_verified" \
      || cleanup_status=$?
  fi
  final_status="$subject_status"
  if [ "$cleanup_status" -ne 0 ]; then
    echo "Jade protocol registered-transient retirement failed (exit=$cleanup_status)" >&2
    [ "$final_status" -ne 0 ] || final_status="$cleanup_status"
  fi
  exit "$final_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

resolve_created_container() {
  local create_status="$1" cid_id='' recovered_id invalid_cidfile=0
  if [ -f "$cidfile" ]; then
    cid_id="$(tr -d '\r\n' < "$cidfile")"
    if ! [[ "$cid_id" =~ ^[0-9a-f]{64}$ ]]; then
      echo 'Jade protocol cidfile contains an invalid container ID' >&2
      cid_id=''
      invalid_cidfile=1
    fi
  fi
  recovered_id="$(recover_exact_created_container "$container_name")" || {
    [ "$create_status" -ne 0 ] && return "$create_status"
    return 1
  }
  # Arm exact cleanup before evaluating any potentially corrupt client output.
  container_id="$recovered_id"
  container_identity_verified=1
  if [ -n "$cid_id" ] && [ "$cid_id" != "$recovered_id" ]; then
    echo 'Jade protocol cidfile disagrees with the exact created container' >&2
    return 1
  fi
  printf '%s\n' "$container_id" > "$cidfile"
  [ "$invalid_cidfile" -eq 0 ] || return 1
  [ "$create_status" -eq 0 ] || return "$create_status"
  [ "$(tr -d '\r\n' < "$create_output")" = "$container_id" ] || {
    echo 'Jade protocol create output disagrees with its durable container ID' >&2
    return 1
  }
}

create_protocol_container() {
  local create_status=0
  [ ! -e "$cidfile" ] || { echo 'Jade protocol cidfile already exists before create' >&2; return 1; }
  timeout --foreground --kill-after=10s 60s docker create --rm --interactive \
    --cidfile "$cidfile" --name "$container_name" \
    "${container_ownership_labels[@]}" \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
    --tmpfs /workspace:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
    --tmpfs /evidence:rw,noexec,nosuid,nodev,size=1m,mode=1777 \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 128 \
    --memory 256m \
    --cpus 1 \
    --user "$(id -u):$(id -g)" \
    --env PYTHONDONTWRITEBYTECODE=1 \
    --workdir /workspace \
    "$runtime_image" \
    sh -eu -c '
      tar -xf - -C /workspace
      python tests/ci/jade-vendor-protocol-harness.test.py >&2
      python scripts/ci/jade-vendor-protocol-harness.py "$@" >&2
      tar -cf - -C /evidence summary.json
    ' sh "$manifest" /evidence/summary.json > "$create_output" || create_status=$?
  resolve_created_container "$create_status"
}

create_and_register_protocol_container() {
  local create_status=0 registration_status=0
  create_protocol_container || create_status=$?
  if [ -z "$container_id" ]; then
    [ "$create_status" -ne 0 ] && return "$create_status"
    echo 'Jade protocol create completed without a recovered container ID' >&2
    return 1
  fi
  assert_registered_transient "$container_id" || registration_status=$?
  if [ "$registration_status" -eq 0 ]; then
    register_owned_resource compose_container obsolete exact_delete engine_id \
      "$container_id" "$container_id" "$SANCTUARY_OPERATION_RUN_ID" \
      || registration_status=$?
  fi
  # A lost create response remains the subject failure, but only after the
  # recovered immutable ID has been attested and durably registered.
  [ "$create_status" -eq 0 ] || return "$create_status"
  return "$registration_status"
}

if ! docker image inspect "$runtime_image" >/dev/null 2>&1; then
  timeout --foreground --kill-after=10s 180s docker pull "$runtime_image" >/dev/null
fi
docker image inspect "$runtime_image" > "$evidence_root/runtime-image.json"

# The job container's workspace path is not necessarily a valid bind source on
# the sibling Docker daemon. Create one exactly named and labeled container,
# recover its immutable ID before start, and stream both inputs and proof over
# the attached connection. The EXIT/signal trap owns that exact ID if the
# client-side timeout or workflow cancellation interrupts the attachment.
create_and_register_protocol_container
container_identity_verified=1
tar -cf - \
  "$manifest" \
  scripts/ci/jade-vendor-protocol-harness.py \
  tests/ci/jade-vendor-protocol-harness.test.py \
  | timeout --foreground --kill-after=30s 180s \
      docker start --attach --interactive "$container_id" \
      > "$evidence_root/proof-output.tar"
tar -xf "$evidence_root/proof-output.tar" -C "$evidence_root"
rm "$evidence_root/proof-output.tar"

jq -e '
  .status == "passed"
  and .vendorRelease == "1.0.40"
  and (.cases | sort) == ([
    "auth-http-continuation",
    "binary-psbt-extended-data",
    "rpc-error-propagation"
  ] | sort)
' "$evidence_root/summary.json" >/dev/null
sha256sum \
  "$manifest" \
  scripts/ci/jade-vendor-protocol-harness.py \
  scripts/ci/run-jade-protocol-harness.sh \
  scripts/ci/validate-jade-protocol-manifest.jq \
  tests/ci/jade-vendor-protocol-harness.test.py \
  docs/adr/0003-jade-plus-authentication-boundary.md \
  > "$evidence_root/proof-sources.sha256"
