#!/usr/bin/env bash
# Exact expected-image discovery and registration for coordinated Compose subjects.

ownership_image_id_from_inspect() {
  local image_ref="$1" build_id="$2"
  jq -er --arg ref "$image_ref" --arg build "$build_id" '
    (if (.[0].Id | type == "string" and test("^[0-9a-f]{64}$"))
      then "sha256:\(.[0].Id)" else .[0].Id end) as $id
    | if length == 1
      and ($id | type == "string" and test("^sha256:[0-9a-f]{64}$"))
      and (.[0].Created | type == "string" and length > 0)
      and .[0].Config.Labels["io.sanctuary.build-id"] == $build
    then $id else error("image provenance mismatch") end
  '
}

ownership_image_id_from_id_inspect() {
  local expected_id="$1" build_id="$2"
  jq -er --arg id "$expected_id" --arg build "$build_id" '
    (if (.[0].Id | type == "string" and test("^[0-9a-f]{64}$"))
      then "sha256:\(.[0].Id)" else .[0].Id end) as $observed
    | if length == 1
      and ($id | test("^sha256:[0-9a-f]{64}$"))
      and $observed == $id
      and (.[0].Created | type == "string" and length > 0)
      and .[0].Config.Labels["io.sanctuary.build-id"] == $build
    then $observed else error("image identity provenance mismatch") end
  '
}

ownership_image_now_ms() {
  date +%s%3N
}

ownership_new_image_deadline() {
  printf '%s\n' "$(( $(ownership_image_now_ms) + 3500 ))"
}

ownership_timeout_window_before_deadline() {
  local deadline="$1" now remaining window
  now="$(ownership_image_now_ms)" || return 1
  remaining=$((deadline - now))
  # Reserve time for timeout's forced-kill interval and the caller's
  # postcondition. A stuck daemon therefore cannot consume the coordinator's
  # five-second subject grace period.
  [ "$remaining" -gt 150 ] || return 124
  window=$((remaining - 100))
  # Keep every daemon call independently bounded while allowing a final
  # post-removal observation to consume the budget left by earlier fast calls.
  # Docker can hold its image-store lock for more than a second after a large
  # --load. The shared 3.5s deadline, not this slice, remains the hard
  # end-to-end bound and still leaves 400ms for forced termination/return.
  [ "$window" -le 3000 ] || window=3000
  if [ "$window" -ge 1000 ]; then
    printf '%d.%03ds\n' "$((window / 1000))" "$((window % 1000))"
  else
    printf '0.%03ds\n' "$window"
  fi
}

ownership_retry_before_deadline() {
  local deadline="$1" attempt="$2" now
  [ "$attempt" -lt 5 ] || return 1
  now="$(ownership_image_now_ms)" || return 1
  [ "$((deadline - now))" -gt 250 ] || return 1
  sleep 0.1
}

ownership_run_docker_before_deadline() {
  local deadline="$1" window
  shift
  window="$(ownership_timeout_window_before_deadline "$deadline")" || return $?
  timeout --foreground --kill-after=0.1s "$window" docker "$@"
}

ownership_bounded_image_remove() {
  local deadline="$1" image_ref="$2" window
  window="$(ownership_timeout_window_before_deadline "$deadline")" || return $?
  timeout --foreground --kill-after=0.1s "$window" docker image rm "$image_ref"
}

ownership_bounded_image_inspect() {
  local image_ref="$1" deadline="${2:-}"
  [ -n "$deadline" ] || deadline="$(ownership_new_image_deadline)"
  ownership_run_docker_before_deadline "$deadline" image inspect "$image_ref"
}

ownership_report_image_provenance_mismatch() {
  local image_ref="$1" build_id="$2"
  jq -cer --arg ref "$image_ref" --arg build "$build_id" '
    {
      objectCount: length,
      idValid: (length == 1 and
        (.[0].Id | type == "string" and
          (test("^sha256:[0-9a-f]{64}$") or test("^[0-9a-f]{64}$")))),
      createdPresent: (length == 1 and
        (.[0].Created | type == "string" and length > 0)),
      exactReferencePresent: (length == 1 and
        ((.[0].RepoTags // []) | index($ref) != null)),
      buildIdentityMatches: (length == 1 and
        .[0].Config.Labels["io.sanctuary.build-id"] == $build)
    }
  ' >&2
}

recover_exact_loaded_image() {
  local image_ref="$1" build_id="$2" deadline="${3:-}" first_id second_id attempt
  local first_inspect='' second_inspect='' last_inspect=''
  [ -n "$deadline" ] || deadline="$(ownership_new_image_deadline)"
  # A remote Buildx --load can return just before the Docker image/tag metadata
  # converges. Admit only a bounded read-only wait for two consecutive exact
  # provenance observations; persistent drift and daemon stalls fail closed.
  for attempt in 1 2 3 4 5; do
    if first_inspect="$(ownership_bounded_image_inspect "$image_ref" "$deadline")"; then
      last_inspect="$first_inspect"
      if first_id="$(printf '%s' "$first_inspect" \
        | ownership_image_id_from_inspect "$image_ref" "$build_id" 2>/dev/null)" \
        && second_inspect="$(ownership_bounded_image_inspect "$image_ref" "$deadline")"; then
        last_inspect="$second_inspect"
        if second_id="$(printf '%s' "$second_inspect" \
          | ownership_image_id_from_inspect "$image_ref" "$build_id" 2>/dev/null)" \
          && [ "$first_id" = "$second_id" ]; then
          printf '%s\n' "$first_id"
          return 0
        fi
      fi
    fi
    ownership_retry_before_deadline "$deadline" "$attempt" || break
  done
  echo "image provenance did not converge for exact loaded reference: $image_ref" >&2
  if [ -n "$last_inspect" ]; then
    printf '%s' "$last_inspect" \
      | ownership_report_image_provenance_mismatch "$image_ref" "$build_id" || true
  else
    echo '{"inspectAvailable":false}' >&2
  fi
  return 1
}

recover_exact_built_image() {
  recover_exact_loaded_image "$@"
}

recover_exact_loaded_image_id() {
  local image_id="$1" build_id="$2" deadline="$3" first second attempt
  for attempt in 1 2 3 4 5; do
    if first="$(ownership_bounded_image_inspect "$image_id" "$deadline")" \
        && first="$(printf '%s' "$first" \
          | ownership_image_id_from_id_inspect "$image_id" "$build_id")" \
        && second="$(ownership_bounded_image_inspect "$image_id" "$deadline")" \
        && second="$(printf '%s' "$second" \
          | ownership_image_id_from_id_inspect "$image_id" "$build_id")" \
        && [ "$first" = "$second" ]; then
      printf '%s\n' "$first"
      return 0
    fi
    ownership_retry_before_deadline "$deadline" "$attempt" || break
  done
  echo "image provenance did not converge for immutable image ID: $image_id" >&2
  return 1
}

register_exact_built_image() {
  local image_ref="$1" image_id="$2"
  register_owned_resource oci_image obsolete exact_delete reference \
    "$image_ref" "$image_id" "$SANCTUARY_OPERATION_RUN_ID"
}

register_exact_built_image_id() {
  local image_id="$1"
  register_owned_resource oci_image obsolete exact_delete engine_id \
    "$image_id" "$image_id" "$SANCTUARY_OPERATION_RUN_ID"
}

# Prove that a registered reference still names the registered image with the
# expected build provenance. Returns 2 when the image cannot be observed and 1
# when the reference now names another image, so callers can tell an
# unavailable engine from a rebuilt image (#1032).
ownership_verify_registered_image_identity() {
  local image_ref="$1" image_id="$2" build_id="$3" deadline="$4" observed
  observed="$(ownership_bounded_image_inspect "$image_ref" "$deadline" \
    | ownership_image_id_from_inspect "$image_ref" "$build_id")" || return 2
  [ "$observed" = "$image_id" ] || return 1
}

retire_exact_built_image() {
  local image_ref="$1" image_id="$2" build_id="$3" deadline="${4:-}"
  local listed remove_status=0 identity_status=0
  [ -n "$deadline" ] || deadline="$(ownership_new_image_deadline)"
  ownership_verify_registered_image_identity "$image_ref" "$image_id" "$build_id" "$deadline" \
    || identity_status=$?
  if [ "$identity_status" -eq 2 ]; then
    echo "Exact image retirement precondition is unavailable: $image_ref" >&2
    return 1
  elif [ "$identity_status" -ne 0 ]; then
    echo "Exact image retirement identity changed: $image_ref" >&2
    return 1
  fi
  ownership_bounded_image_remove "$deadline" "$image_ref" \
    >/dev/null || remove_status=$?
  listed="$(ownership_run_docker_before_deadline "$deadline" image ls --no-trunc \
    --filter "reference=$image_ref" --format '{{.ID}}\t{{.Repository}}:{{.Tag}}')" || {
    echo "Exact image retirement postcondition is unavailable: $image_ref" >&2
    return 1
  }
  listed="$(printf '%s\n' "$listed" \
    | ownership_exact_reference_id_from_list "$image_ref")" || {
    echo "Exact image retirement postcondition is malformed: $image_ref" >&2
    return 1
  }
  if [ -n "$listed" ]; then
    [ "$remove_status" -eq 0 ] \
      || echo "Image reference retirement remains present after Docker failure: $image_ref" >&2
    [ "$remove_status" -ne 0 ] \
      || echo "Image reference retirement remains present after Docker success: $image_ref" >&2
    return 1
  fi
}

ownership_bounded_image_list() {
  local deadline="${1:-}"
  [ -n "$deadline" ] || deadline="$(ownership_new_image_deadline)"
  ownership_run_docker_before_deadline "$deadline" image ls --no-trunc \
    --filter "label=io.sanctuary.build-id=$SANCTUARY_BUILD_ID" \
    --format '{{.ID}}\t{{.Repository}}:{{.Tag}}'
}

ownership_exact_reference_id_from_list() {
  local expected_ref="$1"
  awk -F '\t' -v expected_ref="$expected_ref" '
    BEGIN { count = 0; malformed = 0 }
    NF == 0 { next }
    NF != 2 { malformed = 1; next }
    $1 !~ /^(sha256:)?[0-9a-f]{64}$/ { malformed = 1; next }
    $2 == expected_ref {
      count += 1
      value = $1
      if (value !~ /^sha256:/) value = "sha256:" value
      identity = value
    }
    END {
      if (malformed || count > 1) exit 1
      if (count == 1) print identity
    }
  '
}

ownership_image_reference_count_from_list() {
  local expected_ref="$1" expected_id="$2"
  awk -F '\t' -v expected_ref="$expected_ref" -v expected_id="$expected_id" '
    BEGIN { count = 0; exact = 0; malformed = 0 }
    NF == 0 { next }
    NF != 2 { malformed = 1; next }
    $1 !~ /^sha256:[0-9a-f]{64}$/ { malformed = 1; next }
    $1 == expected_id && $2 != "<none>:<none>" {
      count += 1
      if ($2 == expected_ref) exact += 1
    }
    END {
      if (malformed || exact != 1) exit 1
      print count
    }
  '
}

list_ci_compose_lane_images() {
  local deadline="$1" image_id image_ref image_rows
  image_rows="$(ownership_bounded_image_list "$deadline")" || return 1
  while IFS=$'\t' read -r image_id image_ref; do
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
    if [ "$image_ref" = '<none>:<none>' ]; then
      printf '%s\t%s\n' "$image_id" "$image_ref"
      continue
    fi
    case "$image_ref" in
      *:"$SANCTUARY_IMAGE_TAG"|"$COMPOSE_PROJECT_NAME"-*:*)
        printf '%s\t%s\n' "$image_id" "$image_ref" ;;
      *) continue ;;
    esac
  done < <(printf '%s\n' "$image_rows" | sort -u)
}

compose_tagged_refs_from_image_rows() {
  awk -F '\t' '$2 != "<none>:<none>" { print $2 }' | sort -u
}

wait_for_ci_compose_image_refs() {
  local expected_refs="$1" allow_no_owned_images="$2" deadline="$3"
  local observed_rows='' observed_refs='' last_successful_rows='' attempt
  for attempt in 1 2 3 4 5; do
    observed_rows="$(list_ci_compose_lane_images "$deadline")" || {
      ownership_retry_before_deadline "$deadline" "$attempt" && continue
      printf '%s' "$last_successful_rows"
      return 1
    }
    last_successful_rows="$observed_rows"
    observed_refs="$(printf '%s' "$observed_rows" | compose_tagged_refs_from_image_rows)"
    if [ "$observed_refs" = "$expected_refs" ] \
        && ! printf '%s\n' "$observed_rows" | grep -q $'\t<none>:<none>$'; then
      printf '%s' "$observed_rows"
      return 0
    fi
    if [ "$allow_no_owned_images" -eq 1 ] && [ -z "$observed_rows" ]; then
      return 0
    fi
    ownership_retry_before_deadline "$deadline" "$attempt" || break
  done
  printf '%s' "$last_successful_rows"
  return 1
}

declare -a REGISTERED_CI_COMPOSE_IMAGE_REFS=()
declare -a REGISTERED_CI_COMPOSE_IMAGE_IDS=()

register_ci_compose_images() {
  local allow_no_owned_images="$1" deadline="$2" expected_refs observed_rows observed_refs candidate_refs
  local image_ref image_id recovered_id dangling_ids registration_deadline
  local discovery_status=0 registration_status=0
  shift 2
  expected_refs="$(printf '%s\n' "$@" | sed '/^$/d' | sort -u)"
  if [ "$#" -ne "$(printf '%s\n' "$expected_refs" | sed '/^$/d' | wc -l)" ]; then
    echo 'CI Compose image expectations contain an empty or duplicate reference' >&2
    return 1
  fi
  if [ "$allow_no_owned_images" -ne 1 ] && [ "$#" -eq 0 ]; then
    echo 'CI Compose registration requires exact expected images or an explicit no-image contract' >&2
    return 1
  fi
  REGISTERED_CI_COMPOSE_IMAGE_REFS=()
  REGISTERED_CI_COMPOSE_IMAGE_IDS=()
  observed_rows="$(wait_for_ci_compose_image_refs \
    "$expected_refs" "$allow_no_owned_images" "$deadline")" \
    || discovery_status=$?
  observed_refs="$(printf '%s' "$observed_rows" | compose_tagged_refs_from_image_rows)"
  candidate_refs="$(printf '%s\n%s\n' "$expected_refs" "$observed_refs" | sed '/^$/d' | sort -u)"
  while IFS= read -r image_ref; do
    [ -n "$image_ref" ] || continue
    # A missing expected reference must not consume the recovery budget for a
    # later observed partial image. Bound each exact candidate independently.
    registration_deadline="$(ownership_new_image_deadline)"
    if image_id="$(recover_exact_loaded_image \
        "$image_ref" "$SANCTUARY_BUILD_ID" "$registration_deadline")" \
        && register_exact_built_image "$image_ref" "$image_id"; then
      REGISTERED_CI_COMPOSE_IMAGE_REFS+=("$image_ref")
      REGISTERED_CI_COMPOSE_IMAGE_IDS+=("$image_id")
    else
      registration_status=1
    fi
  done <<< "$candidate_refs"
  dangling_ids="$(printf '%s\n' "$observed_rows" \
    | awk -F '\t' '$2 == "<none>:<none>" { print $1 }' | sort -u)"
  while IFS= read -r image_id; do
    [ -n "$image_id" ] || continue
    registration_deadline="$(ownership_new_image_deadline)"
    if recovered_id="$(recover_exact_loaded_image_id \
        "$image_id" "$SANCTUARY_BUILD_ID" "$registration_deadline")" \
        && [ "$recovered_id" = "$image_id" ] \
        && register_exact_built_image_id "$image_id"; then
      :
    else
      registration_status=1
    fi
  done <<< "$dangling_ids"
  if [ "$discovery_status" -ne 0 ]; then
    echo 'CI Compose observed image references do not match the exact expected set' >&2
    return "$discovery_status"
  fi
  return "$registration_status"
}

# Signal fallback has less than the coordinator's five-second grace. Discover
# once and use one shared bounded deadline to sign only resources that are
# already observable; ordinary registration later enforces the complete set.
register_observed_ci_compose_images() {
  local deadline="$1" observed_rows image_id image_ref recovered_id status=0
  REGISTERED_CI_COMPOSE_IMAGE_REFS=()
  REGISTERED_CI_COMPOSE_IMAGE_IDS=()
  observed_rows="$(list_ci_compose_lane_images "$deadline")" || return 1
  while IFS=$'\t' read -r image_id image_ref; do
    [ -n "$image_id" ] || continue
    if [ "$image_ref" = '<none>:<none>' ]; then
      if recovered_id="$(recover_exact_loaded_image_id \
          "$image_id" "$SANCTUARY_BUILD_ID" "$deadline")" \
          && [ "$recovered_id" = "$image_id" ] \
          && register_exact_built_image_id "$image_id"; then
        :
      else
        status=1
      fi
    elif recovered_id="$(recover_exact_loaded_image \
        "$image_ref" "$SANCTUARY_BUILD_ID" "$deadline")" \
        && [ "$recovered_id" = "$image_id" ] \
        && register_exact_built_image "$image_ref" "$image_id"; then
      REGISTERED_CI_COMPOSE_IMAGE_REFS+=("$image_ref")
      REGISTERED_CI_COMPOSE_IMAGE_IDS+=("$image_id")
    else
      status=1
    fi
  done <<< "$observed_rows"
  return "$status"
}

retire_shared_ci_compose_image_references() {
  local deadline="$1" index image_ref image_id listed tag_count status=0
  listed="$(ownership_bounded_image_list "$deadline")" || return 1
  for index in "${!REGISTERED_CI_COMPOSE_IMAGE_REFS[@]}"; do
    image_ref="${REGISTERED_CI_COMPOSE_IMAGE_REFS[$index]}"
    image_id="${REGISTERED_CI_COMPOSE_IMAGE_IDS[$index]}"
    tag_count="$(printf '%s\n' "$listed" \
      | ownership_image_reference_count_from_list "$image_ref" "$image_id")" \
      || { status=1; continue; }
    if [ "$tag_count" -gt 1 ]; then
      retire_exact_built_image \
        "$image_ref" "$image_id" "$SANCTUARY_BUILD_ID" "$deadline" || status=1
    fi
  done
  return "$status"
}
