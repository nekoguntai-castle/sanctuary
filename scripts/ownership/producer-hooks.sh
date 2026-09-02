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
  if ! [[ "${SANCTUARY_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]]; then
    echo 'ownership producer requires a full source commit' >&2
    return 1
  fi
  if ! [[ "${SANCTUARY_CLEANUP_CREATED_AT:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$ ]] \
      || ! node -e '
        const value = process.argv[1];
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) process.exit(1);
      ' "$SANCTUARY_CLEANUP_CREATED_AT"; then
    echo 'ownership producer requires a canonical creation timestamp' >&2
    return 1
  fi
}

ownership_initialize_build_identity() {
  ownership_initialize || return $?
  ownership_require_identity || return $?
  local checkout_root="${SANCTUARY_PROJECT_DIR:-$(pwd -P)}"
  SANCTUARY_SOURCE_COMMIT="${SANCTUARY_SOURCE_COMMIT:-$SANCTUARY_COMMIT}"
  SANCTUARY_IMAGE_LOCK_SHA256="${SANCTUARY_IMAGE_LOCK_SHA256:-$(ownership_sha256 < "$checkout_root/config/container-image-lock.json")}"
  SANCTUARY_VERSION="${SANCTUARY_VERSION:-$(awk -F'"' '/"version":/{print $4; exit}' "$checkout_root/package.json")}"
  SANCTUARY_BUILD_ID="${SANCTUARY_BUILD_ID:-$SANCTUARY_OPERATION_RUN_ID}"
  export SANCTUARY_SOURCE_COMMIT SANCTUARY_IMAGE_LOCK_SHA256 SANCTUARY_VERSION SANCTUARY_BUILD_ID
}

export_lane_image_tag() {
  local project="${COMPOSE_PROJECT_NAME:-}"
  [ -n "$project" ] || return 0
  local tag
  tag="$(printf '%s' "$project" | tr -c 'A-Za-z0-9._-' '-' | cut -c1-128)"
  case "$tag" in [A-Za-z0-9_]*) ;; *) tag="x$tag" ;; esac
  if [ -n "${SANCTUARY_IMAGE_TAG:-}" ] && [ "$SANCTUARY_IMAGE_TAG" != "$tag" ]; then
    echo 'coordinated Compose image tag does not match its lane authority' >&2
    return 1
  fi
  SANCTUARY_IMAGE_TAG="$tag"
  export SANCTUARY_IMAGE_TAG
}

ci_compose_volume_identity() {
  node --input-type=module -e '
    const { dockerImmutableIdentity } = await import(process.argv[1]);
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    const value = JSON.parse(text);
    if (!Array.isArray(value) || value.length !== 1) process.exit(2);
    process.stdout.write(dockerImmutableIdentity("compose_volume", value[0]));
  ' "file://$SANCTUARY_OWNERSHIP_TOOL_DIR/docker-observation.mjs"
}

# shellcheck source=scripts/ownership/compose-image-registration.sh
source "$SANCTUARY_OWNERSHIP_TOOL_DIR/compose-image-registration.sh"

register_ci_compose_volumes() {
  local deadline="$1"
  shift
  local deadline_mode="${1:-per-resource}"
  [ "$#" -eq 0 ] || shift
  local volume_name identity volume_names recovery_deadline status=0
  case "$deadline_mode" in per-resource|shared) ;; *) return 2 ;; esac
  if [ "$#" -gt 0 ]; then
    volume_names="$(printf '%s\n' "$@" | sed '/^$/d' | sort -u)"
    [ "$#" -eq "$(printf '%s\n' "$volume_names" | wc -l)" ] || return 2
  else
    volume_names="$(ownership_run_docker_before_deadline "$deadline" volume ls \
      --filter "label=io.sanctuary.project=$SANCTUARY_PROJECT" \
      --filter "label=io.sanctuary.creation-run-id=$SANCTUARY_OPERATION_RUN_ID" --format '{{.Name}}')" \
      || return 1
  fi
  while IFS= read -r volume_name; do
    [ -n "$volume_name" ] || continue
    recovery_deadline="$deadline"
    [ "$deadline_mode" = shared ] || recovery_deadline="$(ownership_new_image_deadline)"
    if identity="$(recover_exact_owned_ci_volume "$volume_name" "$recovery_deadline")" \
        && register_owned_resource compose_volume obsolete exact_delete name \
          "$volume_name" "$identity" "$SANCTUARY_OPERATION_RUN_ID"; then
      :
    else
      status=1
    fi
  done < <(printf '%s\n' "$volume_names" | sort -u)
  return "$status"
}

recover_exact_owned_ci_volume() {
  local volume_name="$1" deadline="${2:-}" first_inspect second_inspect first_identity second_identity
  [ -n "$deadline" ] || deadline="$(ownership_new_image_deadline)"
  first_inspect="$(ownership_run_docker_before_deadline \
    "$deadline" volume inspect "$volume_name")" || return 1
  first_identity="$(printf '%s' "$first_inspect" | inspect_owned_ci_volume "$volume_name")" || return 1
  second_inspect="$(ownership_run_docker_before_deadline \
    "$deadline" volume inspect "$volume_name")" || return 1
  second_identity="$(printf '%s' "$second_inspect" | inspect_owned_ci_volume "$volume_name")" || return 1
  [ "$first_identity" = "$second_identity" ] || return 1
  printf '%s\n' "$first_identity"
}

inspect_owned_ci_volume() {
  local volume_name="$1" inspected
  inspected="$(cat)" || return 1
  printf '%s' "$inspected" | jq -e --arg name "$volume_name" --arg project "$SANCTUARY_PROJECT" \
      --arg deployment "$SANCTUARY_DEPLOYMENT_ID" --arg owner "$SANCTUARY_OWNER_ID" \
      --arg run "$SANCTUARY_OPERATION_RUN_ID" --arg created "$SANCTUARY_CLEANUP_CREATED_AT" \
      --arg release "$SANCTUARY_RELEASE" --arg commit "$SANCTUARY_COMMIT" '
        length == 1 and .[0].Name == $name
        and .[0].Labels["io.sanctuary.project"] == $project
        and .[0].Labels["io.sanctuary.deployment-id"] == $deployment
        and .[0].Labels["io.sanctuary.owner-id"] == $owner
        and .[0].Labels["io.sanctuary.resource-class"] == "compose_volume"
        and .[0].Labels["io.sanctuary.lifecycle"] == "obsolete"
        and .[0].Labels["io.sanctuary.cleanup-policy"] == "exact_delete"
        and .[0].Labels["io.sanctuary.created-at"] == $created
        and .[0].Labels["io.sanctuary.created-by-release"] == $release
        and .[0].Labels["io.sanctuary.created-by-commit"] == $commit
        and .[0].Labels["io.sanctuary.creation-run-id"] == $run' >/dev/null || return 1
  printf '%s' "$inspected" | ci_compose_volume_identity
}

create_and_register_owned_volume() {
  local volume_name="$1" create_status failure_status identity registration_status=0
  shift
  if docker volume create "$@" "$volume_name"; then create_status=0
  else create_status=$?
  fi
  failure_status="$create_status"
  [ "$failure_status" -ne 0 ] || failure_status=1
  identity="$(recover_exact_owned_ci_volume "$volume_name")" || return "$failure_status"
  register_owned_resource compose_volume obsolete exact_delete name \
    "$volume_name" "$identity" "$SANCTUARY_OPERATION_RUN_ID" || registration_status=$?
  [ "$create_status" -eq 0 ] || return "$create_status"
  return "$registration_status"
}

register_ci_compose_resources() {
  local allow_no_owned_images=0 defer_image_retirement=0 interrupt_fallback=0 argument
  local image_status=0 volume_status=0 retire_status=0
  local image_discovery_deadline volume_deadline retirement_deadline
  local -a expected_images=() expected_refs=() expected_volumes=()
  [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = 1 ] || {
    echo 'CI Compose registration requires the signed cleanup coordinator' >&2
    return 1
  }
  while [ "$#" -gt 0 ]; do
    argument="$1"
    case "$argument" in
      --allow-no-owned-images) allow_no_owned_images=1; shift ;;
      --defer-image-reference-retirement) defer_image_retirement=1; shift ;;
      --interrupt-fallback) interrupt_fallback=1; shift ;;
      --expected-image)
        [ "$#" -ge 2 ] && [[ "$2" =~ ^[a-z0-9][a-z0-9._/-]*$ ]] || {
          echo 'CI Compose --expected-image requires an untagged image name' >&2
          return 2
        }
        expected_images+=("$2")
        shift 2
        ;;
      --expected-volume)
        [ "$#" -ge 2 ] && [[ "$2" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || {
          echo 'CI Compose --expected-volume requires a Compose volume key' >&2
          return 2
        }
        expected_volumes+=("${COMPOSE_PROJECT_NAME}_$2")
        shift 2
        ;;
      *) echo "Unknown CI Compose registration option: $argument" >&2; return 2 ;;
    esac
  done
  if [ "$allow_no_owned_images" -eq 1 ] && [ "${#expected_images[@]}" -ne 0 ]; then
    echo 'CI Compose no-image and expected-image contracts are mutually exclusive' >&2
    return 2
  fi
  ownership_initialize_build_identity || return $?
  export_lane_image_tag || return $?
  for argument in "${expected_images[@]}"; do
    expected_refs+=("$argument:$SANCTUARY_IMAGE_TAG")
  done
  image_discovery_deadline="$(ownership_new_image_deadline)"
  if [ "$interrupt_fallback" -eq 1 ]; then
    register_observed_ci_compose_images "$image_discovery_deadline" || image_status=$?
    # Use the same deadline so the entire EXIT callback remains below the
    # coordinator's five-second TERM-to-KILL grace. Retirement is nonessential
    # here and is left to signed cleanup.
    register_ci_compose_volumes "$image_discovery_deadline" shared || volume_status=$?
    [ "$image_status" -eq 0 ] || return "$image_status"
    return "$volume_status"
  fi
  register_ci_compose_images \
    "$allow_no_owned_images" "$image_discovery_deadline" "${expected_refs[@]}" || image_status=$?
  volume_deadline="$(ownership_new_image_deadline)"
  register_ci_compose_volumes "$volume_deadline" per-resource \
    "${expected_volumes[@]}" || volume_status=$?
  if [ "$defer_image_retirement" -eq 0 ] \
      && [ "$image_status" -eq 0 ] && [ "$volume_status" -eq 0 ]; then
    retirement_deadline="$(ownership_new_image_deadline)"
    retire_shared_ci_compose_image_references "$retirement_deadline" || retire_status=$?
  fi
  [ "$image_status" -eq 0 ] || return "$image_status"
  [ "$volume_status" -eq 0 ] || return "$volume_status"
  return "$retire_status"
}

# Recompute artifact provenance after an existing runtime env has been loaded.
# Stable deployment identity may come from that file, but a rebuild must never
# inherit the previous checkout's commit, lock digest, version, or build ID.
ownership_refresh_checkout_build_identity() {
  ownership_initialize || return $?
  local checkout_root="${SANCTUARY_PROJECT_DIR:-$(pwd -P)}"
  local checkout_commit checkout_release
  if checkout_commit="$(git -C "$checkout_root" rev-parse HEAD 2>/dev/null)"; then
    SANCTUARY_COMMIT="$checkout_commit"
    checkout_release="$(git -C "$checkout_root" describe --tags --always 2>/dev/null || true)"
    [ -z "$checkout_release" ] || SANCTUARY_RELEASE="$checkout_release"
  fi
  ownership_require_identity || return $?
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
  ownership_initialize_build_identity || return $?
}

ownership_label_args() {
  local resource_class="$1" cleanup_policy="$2"
  ownership_initialize || return $?
  ownership_require_identity || return $?
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

ownership_container_id_from_inspect() {
  local expected_container_name="$1"
  jq -er --arg name "$expected_container_name" \
    --arg project "$SANCTUARY_PROJECT" --arg deployment "$SANCTUARY_DEPLOYMENT_ID" \
    --arg owner "$SANCTUARY_OWNER_ID" --arg run "$SANCTUARY_OPERATION_RUN_ID" \
    --arg created "$SANCTUARY_CLEANUP_CREATED_AT" --arg release "$SANCTUARY_RELEASE" \
    --arg commit "$SANCTUARY_COMMIT" '
      if length == 1
        and (.[0].Id | type == "string" and test("^[0-9a-f]{64}$"))
        and .[0].Name == ("/" + $name)
        and .[0].State.Status == "created" and .[0].State.Running == false
        and (.[0].Config.Labels | type == "object")
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
      then .[0].Id else error("container ownership tuple mismatch") end
    '
}

# Recover only a stopped container whose create response was lost before its
# cidfile was durable. Both name and full immutable ID are reinspected so a
# concurrent name replacement can never arm retirement of an unproven object.
recover_exact_created_container() {
  local expected_container_name="$1" first_id second_id
  [[ "$expected_container_name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || return 1
  first_id="$(docker container inspect "$expected_container_name" \
    | ownership_container_id_from_inspect "$expected_container_name")" || return 1
  second_id="$(docker container inspect "$first_id" \
    | ownership_container_id_from_inspect "$expected_container_name")" || return 1
  [ "$first_id" = "$second_id" ] || return 1
  printf '%s\n' "$first_id"
}

register_owned_resource() {
  local resource_class="$1" lifecycle="$2" cleanup_policy="$3" locator_kind="$4"
  local locator="$5" immutable_identity="$6"
  shift 6
  ownership_initialize || return $?
  ownership_require_identity || return $?
  local checkout_root="${SANCTUARY_PROJECT_DIR:-$(pwd -P)}"
  local args=(
    --root "$SANCTUARY_OWNERSHIP_ROOT" --checkout-root "$checkout_root"
    --deployment-id "$SANCTUARY_DEPLOYMENT_ID" --run-id "$SANCTUARY_OPERATION_RUN_ID"
    --owner-id "$SANCTUARY_OWNER_ID" --class "$resource_class" --lifecycle "$lifecycle"
    --policy "$cleanup_policy" --release "$SANCTUARY_RELEASE" --commit "$SANCTUARY_COMMIT"
    --created-at "$SANCTUARY_CLEANUP_CREATED_AT" --locator-kind "$locator_kind"
    --locator "$locator" --identity "$immutable_identity"
  )
  if [ "${1:-}" = --execution-authority ]; then
    [ "$#" -ge 2 ] || {
      echo 'ownership producer requires execution authority JSON' >&2
      return 1
    }
    args+=(--execution-authority "$2")
    shift 2
  fi
  local reference
  for reference in "$@"; do args+=(--reference "$reference"); done
  node "$SANCTUARY_OWNERSHIP_TOOL_DIR/register-resource.mjs" "${args[@]}" >/dev/null
}
