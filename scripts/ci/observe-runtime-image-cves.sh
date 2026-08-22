#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

readonly TRIVY_IMAGE='docker.io/aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969'
readonly -a IMAGE_ROLES=(backend frontend gateway llm-egress-proxy)

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/observe-runtime-image-cves.sh \
  --project PROJECT --candidate SHA --image-lock FILE --output DIR
EOF
}

fail() {
  printf 'observe-runtime-image-cves: %s\n' "$*" >&2
  exit 2
}

require_value() {
  [ "$#" -ge 2 ] && [ -n "$2" ] || fail "$1 requires a value"
}

parse_args() {
  project=''
  candidate=''
  image_lock=''
  output_dir=''

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --project) require_value "$@"; project="$2"; shift 2 ;;
      --candidate) require_value "$@"; candidate="$2"; shift 2 ;;
      --image-lock) require_value "$@"; image_lock="$2"; shift 2 ;;
      --output) require_value "$@"; output_dir="$2"; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) usage; fail "unknown argument: $1" ;;
    esac
  done
}

validate_inputs() {
  [[ "$project" =~ ^sanctuary-rc-fresh-[A-Za-z0-9_.-]+$ ]] || \
    fail 'project must be a run-scoped sanctuary-rc-fresh-* name'
  [ "${#project}" -le 128 ] || fail 'project must not exceed the Docker tag length limit'
  [[ "$candidate" =~ ^[0-9a-f]{40}$ ]] || fail 'candidate must be a lowercase 40-character SHA'
  [ -f "$image_lock" ] || fail "image lock is not a regular file: $image_lock"
  [ -n "$output_dir" ] || fail 'output directory must not be empty'

  local command
  for command in docker jq sha256sum; do
    command -v "$command" >/dev/null 2>&1 || fail "required command is unavailable: $command"
  done
}

cleanup_cache() {
  [ -n "${cache_volume:-}" ] || return 0
  docker volume rm -f "$cache_volume" >/dev/null 2>&1 || true
}

prepare_output() {
  mkdir -p -- "$output_dir" "$role_status_dir" || fail 'could not create the report directory'
  rm -f -- "$output_dir/status.json" "$output_dir/database-update.log" \
    "$output_dir/socket-probe.log"

  local role
  for role in "${IMAGE_ROLES[@]}"; do
    rm -f -- "$output_dir/$role.json" "$output_dir/$role.json.tmp" \
      "$output_dir/$role-inspect.log" "$output_dir/$role-scan.log" \
      "$role_status_dir/$role.json"
  done
}

valid_socket_candidate() {
  [[ "$1" =~ ^/[A-Za-z0-9._/-]+\.sock$ ]] && \
    [[ "$1" != *'//'* && "$1" != *'/./'* && "$1" != *'/../'* ]]
}

probe_socket_candidate() {
  local socket_path="$1"
  valid_socket_candidate "$socket_path" || return 1

  docker run --rm --entrypoint /bin/sh \
    --mount "type=bind,source=$socket_path,target=/var/run/docker.sock,readonly" \
    "$TRIVY_IMAGE" -c 'test -S /var/run/docker.sock' \
    >>"$output_dir/socket-probe.log" 2>&1
}

discover_daemon_socket() {
  local -a candidates=()
  if [ "${SANCTUARY_DOCKER_SOCKET_PATH+x}" = x ]; then
    candidates+=("$SANCTUARY_DOCKER_SOCKET_PATH")
  else
    candidates+=(/run/user/1001/podman/podman.sock /var/run/docker.sock)
  fi

  local socket_path discovered='' matches=0
  for socket_path in "${candidates[@]}"; do
    if probe_socket_candidate "$socket_path"; then
      discovered="$socket_path"
      matches=$((matches + 1))
    fi
  done

  [ "$matches" -eq 1 ] || return 1
  printf '%s\n' "$discovered"
}

write_role_status() {
  local role="$1" status="$2" image="$3" image_id="$4"
  local critical="$5" high="$6" fixable="$7" unfixable="$8" reason="$9"

  jq -n \
    --arg role "$role" --arg status "$status" --arg image "$image" \
    --arg imageId "$image_id" --arg reason "$reason" \
    --argjson critical "$critical" --argjson high "$high" \
    --argjson fixable "$fixable" --argjson unfixable "$unfixable" \
    '{role:$role,status:$status,image:$image,imageId:$imageId,
      findings:{critical:$critical,high:$high,fixable:$fixable,unfixable:$unfixable},
      reason:$reason}' > "$role_status_dir/$role.json"
}

inspect_candidate_image() {
  local role="$1" image="$2" inspected image_id revision lock_label

  if ! inspected="$(docker image inspect --format \
    '{{.Id}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "dev.sanctuary.image-lock-sha256"}}' \
    "$image" 2>"$output_dir/$role-inspect.log")"; then
    write_role_status "$role" unavailable "$image" '' 0 0 0 0 'candidate image unavailable'
    return 1
  fi

  IFS='|' read -r image_id revision lock_label <<< "$inspected"
  if [[ ! "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    write_role_status "$role" unavailable "$image" '' 0 0 0 0 'candidate image ID is invalid'
    return 1
  fi
  if [ "$revision" != "$candidate" ]; then
    write_role_status "$role" unavailable "$image" "$image_id" 0 0 0 0 'candidate revision label mismatch'
    return 1
  fi
  if [ "$lock_label" != "$image_lock_sha" ]; then
    write_role_status "$role" unavailable "$image" "$image_id" 0 0 0 0 'image-lock label mismatch'
    return 1
  fi

  printf '%s\n' "$image_id"
}

download_database() {
  local container_name="${project}-trivy-db"
  docker run --rm --name "$container_name" \
    --label "com.docker.compose.project=$project" \
    --volume "$cache_volume:/root/.cache" \
    "$TRIVY_IMAGE" image --cache-dir /root/.cache --download-db-only \
    >"$output_dir/database-update.log" 2>&1
}

scan_image() {
  local role="$1" image="$2" image_id="$3"
  local report="$output_dir/$role.json" temporary="$output_dir/$role.json.tmp"
  local container_name="${project}-trivy-${role}"

  if ! docker run --rm --name "$container_name" \
    --label "com.docker.compose.project=$project" \
    --volume "$daemon_socket:/var/run/docker.sock:ro" \
    --volume "$cache_volume:/root/.cache" \
    "$TRIVY_IMAGE" image --image-src docker --cache-dir /root/.cache \
    --skip-db-update --scanners vuln --pkg-types os,library \
    --severity HIGH,CRITICAL --exit-code 0 --format json "$image_id" \
    >"$temporary" 2>"$output_dir/$role-scan.log"; then
    rm -f "$temporary"
    write_role_status "$role" unavailable "$image" "$image_id" 0 0 0 0 'scanner execution failed'
    return 1
  fi

  if ! jq -e '.SchemaVersion == 2 and (.Results | type == "array")' "$temporary" >/dev/null; then
    rm -f "$temporary"
    write_role_status "$role" unavailable "$image" "$image_id" 0 0 0 0 'scanner returned invalid JSON'
    return 1
  fi

  mv "$temporary" "$report"
  local critical high fixable unfixable
  critical="$(jq '[.Results[].Vulnerabilities[]? | select(.Severity == "CRITICAL")] | length' "$report")"
  high="$(jq '[.Results[].Vulnerabilities[]? | select(.Severity == "HIGH")] | length' "$report")"
  fixable="$(jq '[.Results[].Vulnerabilities[]? | select((.FixedVersion // "") != "")] | length' "$report")"
  unfixable="$(jq '[.Results[].Vulnerabilities[]? | select((.FixedVersion // "") == "")] | length' "$report")"
  write_role_status "$role" observed "$image" "$image_id" "$critical" "$high" "$fixable" "$unfixable" ''
}

mark_all_unavailable() {
  local reason="$1" role image
  for role in "${IMAGE_ROLES[@]}"; do
    image="sanctuary-$role:$project"
    write_role_status "$role" unavailable "$image" '' 0 0 0 0 "$reason"
  done
}

mark_database_unavailable() {
  mark_all_unavailable 'vulnerability database unavailable'
}

write_overall_status() {
  local observed status role
  local -a status_files=()
  for role in "${IMAGE_ROLES[@]}"; do
    status_files+=("$role_status_dir/$role.json")
  done

  observed="$(jq -s '[.[] | select(.status == "observed")] | length' "${status_files[@]}")"
  if [ "$observed" -eq "${#IMAGE_ROLES[@]}" ]; then
    status=observed
  elif [ "$observed" -eq 0 ]; then
    status=unavailable
  else
    status=partial
  fi

  jq -s \
    --arg status "$status" --arg scanner "$TRIVY_IMAGE" \
    --arg candidate "$candidate" --arg project "$project" --arg imageLockSha256 "$image_lock_sha" \
    '{schemaVersion:1,observer:"sanctuary-runtime-image-cves-v1",status:$status,
      scanner:$scanner,candidate:$candidate,project:$project,imageLockSha256:$imageLockSha256,roles:.}' \
    "${status_files[@]}" > "$output_dir/status.json"
  printf '%s\n' "$status"
}

write_summary() {
  local status="$1" summary_file
  summary_file="$(ci_step_summary_file)"

  {
    printf '## Runtime image CVE observation\n\n'
    printf 'Observer status: **%s**. This report is nonblocking and is not release approval.\n\n' "$status"
    printf '| Image role | Observation | Critical | High | Fixable | Unfixable |\n'
    printf '| --- | --- | ---: | ---: | ---: | ---: |\n'
    jq -r '.roles[] | "| \(.role) | \(.status) | \(.findings.critical) | \(.findings.high) | \(.findings.fixable) | \(.findings.unfixable) |"' \
      "$output_dir/status.json"
    if [ "$status" != observed ]; then
      printf '\nMissing or invalid evidence is reported as unavailable; it must not be read as a clean scan.\n'
    fi
  } >> "$summary_file"
}

main() {
  parse_args "$@"
  validate_inputs
  role_status_dir="$output_dir/role-status"
  prepare_output
  image_lock_sha="$(sha256sum -- "$image_lock" | cut -d ' ' -f 1)"
  [[ "$image_lock_sha" =~ ^[0-9a-f]{64}$ ]] || fail 'could not digest the image lock'
  cache_volume="${project}-trivy-cache"
  trap cleanup_cache EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  daemon_socket="$(discover_daemon_socket)" || daemon_socket=''
  if [ -z "$daemon_socket" ]; then
    mark_all_unavailable 'Docker daemon socket unavailable or ambiguous'
  elif ! docker volume create --label "com.docker.compose.project=$project" "$cache_volume" >/dev/null; then
    mark_database_unavailable
  elif ! download_database; then
    mark_database_unavailable
  else
    local role image image_id
    for role in "${IMAGE_ROLES[@]}"; do
      image="sanctuary-$role:$project"
      if image_id="$(inspect_candidate_image "$role" "$image")"; then
        scan_image "$role" "$image" "$image_id" || true
      fi
    done
  fi

  local status
  status="$(write_overall_status)"
  write_summary "$status"
  [ "$status" = observed ]
}

main "$@"
