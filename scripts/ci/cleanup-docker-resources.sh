#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/cleanup-docker-resources.sh [options]

Options:
  --manifest-inventory <request.json>
                            Run fail-closed manifest inventory; never mutates Docker.
  --manifest-plan <request.json>
                            Write a signed dry-run plan/receipt; never mutates Docker.
  --project <name>          Remove Docker Compose resources for an exact project label.
  --prefix <prefix>         Remove Compose projects whose labels start with prefix.
  --exclude-project <name>  Exclude a project from prefix cleanup.
  --runner-leftovers        Remove stale Forgejo/Gitea action leftovers.
  --verify-empty            Fail if selected Compose project resources remain after cleanup.
  --dry-run                 Print cleanup commands without running them.
  --help, -h                Show this help.

Protected app project names are never removed by this script.
EOF
}

fail() {
  echo "cleanup-docker-resources: $*" >&2
  exit 1
}

warn() {
  echo "cleanup-docker-resources: warning: $*" >&2
}

dry_run=false
runner_leftovers=false
verify_empty=false
manifest_mode=""
manifest_request=""
manifest_lock_token=""
manifest_lock_owned=false
declare -A project_lock_tokens=()
project_lock_order=()
mutation_failed=false
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
query_timeout="${SANCTUARY_DOCKER_CLEANUP_QUERY_TIMEOUT_SECONDS:-15}"
command_timeout="${SANCTUARY_DOCKER_CLEANUP_COMMAND_TIMEOUT_SECONDS:-30}"
projects=()
prefixes=()
excluded_projects=()
protected_projects=(sanctuary beacon building-monkeys tax-planner swarm-intelligence)

is_safe_name() {
  [[ "${1:-}" =~ ^[A-Za-z0-9_.-]+$ ]]
}

is_protected_project() {
  local project="$1"
  local protected

  for protected in "${protected_projects[@]}"; do
    if [ "$project" = "$protected" ]; then
      return 0
    fi
  done

  return 1
}

validate_name() {
  local kind="$1"
  local value="$2"

  [ -n "$value" ] || fail "$kind must not be empty"
  is_safe_name "$value" || fail "$kind contains unsupported characters: $value"
}

validate_project_arg() {
  local project="$1"

  validate_name "project" "$project"
  if is_protected_project "$project"; then
    fail "refusing to remove protected project: $project"
  fi
}

is_excluded_project() {
  local project="$1"
  local excluded

  for excluded in "${excluded_projects[@]}"; do
    if [ "$project" = "$excluded" ]; then
      return 0
    fi
  done

  return 1
}

print_command() {
  local arg

  printf 'DRY-RUN:'
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\n'
}

run_command() {
  if [ "$dry_run" = true ]; then
    print_command "$@"
    return 0
  fi

  if ! docker_command "$command_timeout" "$@"; then
    warn "command failed: $*"
    mutation_failed=true
  fi
}

docker_command() {
  local timeout_seconds="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_seconds" "$@"
  else
    "$@"
  fi
}

docker_query() {
  docker_command "$query_timeout" docker "$@"
}

remove_ids() {
  local resource="$1"
  shift

  [ "$#" -gt 0 ] || return 0

  case "$resource" in
    container)
      run_command docker rm -f "$@"
      ;;
    network)
      run_command docker network rm "$@"
      ;;
    volume)
      run_command docker volume rm -f "$@"
      ;;
    *)
      fail "unknown Docker resource type: $resource"
      ;;
  esac
}

collect_project_resource_ids() {
  local resource="$1"
  local project="$2"

  case "$resource" in
    container)
      docker_query ps -a --filter "label=com.docker.compose.project=$project" -q 2>/dev/null | sed '/^$/d'
      ;;
    network)
      docker_query network ls --filter "label=com.docker.compose.project=$project" -q 2>/dev/null | sed '/^$/d'
      ;;
    volume)
      docker_query volume ls --filter "label=com.docker.compose.project=$project" -q 2>/dev/null | sed '/^$/d'
      ;;
    *)
      fail "unknown Docker resource type: $resource"
      ;;
  esac
}

read_project_ids() {
  local resource="$1" project="$2" output
  local -n destination="$3"

  if ! output="$(collect_project_resource_ids "$resource" "$project")"; then
    warn "failed to query $resource resources for Compose project $project"
    mutation_failed=true
    destination=()
    return
  fi
  mapfile -t destination < <(printf '%s' "$output")
}

cleanup_project() {
  local project="$1"
  local -a ids

  if is_protected_project "$project"; then
    warn "skipping protected project: $project"
    return 0
  fi

  read_project_ids container "$project" ids
  remove_ids container "${ids[@]}"

  read_project_ids network "$project" ids
  remove_ids network "${ids[@]}"

  read_project_ids volume "$project" ids
  remove_ids volume "${ids[@]}"
}

verify_project_empty() {
  local project="$1"
  local resource
  local failed=0
  local -a ids

  for resource in container network volume; do
    read_project_ids "$resource" "$project" ids
    if [ "${#ids[@]}" -gt 0 ]; then
      warn "resources remain for Compose project $project ($resource): ${ids[*]}"
      failed=1
    fi
  done

  return "$failed"
}

collect_projects_by_prefix() {
  local prefix="$1" containers networks volumes

  containers="$(docker_query ps -a --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null)" || return
  networks="$(docker_query network ls --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null)" || return
  volumes="$(docker_query volume ls --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null)" || return
  printf '%s\n%s\n%s\n' "$containers" "$networks" "$volumes" \
    | awk -v prefix="$prefix" 'index($0, prefix) == 1 { print }' | sort -u
}

cleanup_prefix() {
  local prefix="$1" discovered
  local project

  if ! discovered="$(collect_projects_by_prefix "$prefix")"; then
    warn "failed to query Compose projects for prefix $prefix"
    mutation_failed=true
    return
  fi
  while IFS= read -r project; do
    [ -n "$project" ] || continue
    if is_excluded_project "$project"; then
      continue
    fi
    cleanup_project "$project"
  done <<< "$discovered"
}

verify_prefix_empty() {
  local prefix="$1" discovered
  local project
  local failed=0

  if ! discovered="$(collect_projects_by_prefix "$prefix")"; then
    warn "failed to verify Compose projects for prefix $prefix"
    mutation_failed=true
    return 1
  fi
  while IFS= read -r project; do
    [ -n "$project" ] || continue
    if is_excluded_project "$project"; then
      continue
    fi
    verify_project_empty "$project" || failed=1
  done <<< "$discovered"

  return "$failed"
}

# Only containers older than this are eligible for removal. The runner reuses the
# FORGEJO-ACTIONS-TASK-* / GITEA-ACTIONS-TASK-* naming for containers belonging to
# IN-FLIGHT jobs, and this sweep is not scoped by Compose project, so without an
# age gate a concurrent run's container can be removed out from under it — the
# runner then recreates it empty, which is indistinguishable from a mid-run wipe.
# See #606.
runner_leftover_min_age_seconds="${SANCTUARY_RUNNER_LEFTOVER_MIN_AGE_SECONDS:-7200}"

# Seconds since the container was created, or empty when it cannot be determined.
container_age_seconds() {
  local created="$1"
  local created_epoch now_epoch normalized

  # Docker renders CreatedAt as '2026-08-01 11:42:02 -1000 HST'. GNU date cannot
  # parse the trailing zone abbreviation after a numeric offset, so keep only
  # date, time and offset.
  normalized="$(printf '%s' "$created" | awk '{print $1, $2, $3}')"
  created_epoch="$(date -d "$normalized" +%s 2>/dev/null || true)"
  [ -n "$created_epoch" ] || return 0

  now_epoch="$(date +%s)"
  printf '%s' "$((now_epoch - created_epoch))"
}

cleanup_action_containers() {
  local id names status created age discovered
  local -a stale_ids=()

  # Every runner-named container considered is reported with the decision taken.
  # This is the only place that observes runner container naming, and whether the
  # runner applies the ACTIONS-TASK prefix to SERVICE containers (not just job
  # containers) decides whether this sweep could ever have removed a live
  # database. Logging it makes the next run answer that question. See #606.
  echo "cleanup-docker-resources: runner leftover sweep (min age ${runner_leftover_min_age_seconds}s)"

  if ! discovered="$(docker_query ps -a --format '{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.CreatedAt}}' 2>/dev/null)"; then
    warn "failed to query runner leftover containers"
    mutation_failed=true
    return
  fi
  while IFS=$'\t' read -r id names status created; do
    [ -n "${id:-}" ] && [ -n "${names:-}" ] || continue
    case "$names" in
      FORGEJO-ACTIONS-TASK-*|GITEA-ACTIONS-TASK-*) ;;
      *) continue ;;
    esac
    # Restarting and Paused are ACTIVE states, not leftovers. A healthcheck can
    # bounce a healthy service container through Restarting; removing it there
    # kills a live job's database.
    case "$status" in
      Up*|Running*|Created*|Restarting*|Paused*)
        echo "  keep    $names ($status) — active"
        continue
        ;;
    esac

    age="$(container_age_seconds "${created:-}")"
    if [ -z "$age" ]; then
      # Fail safe: never remove a container whose age cannot be established.
      warn "skipping $names: could not determine container age from '${created:-}'"
      continue
    fi
    if [ "$age" -lt "$runner_leftover_min_age_seconds" ]; then
      echo "  keep    $names ($status) — ${age}s old, under the age gate"
      continue
    fi

    echo "  remove  $names ($status) — ${age}s old"
    stale_ids+=("$id")
  done <<< "$discovered"

  remove_ids container "${stale_ids[@]}"
}

workflow_network_container_count() {
  local network_id="$1"

  docker_query network inspect --format '{{len .Containers}}' "$network_id" 2>/dev/null
}

cleanup_workflow_networks() {
  local id name count discovered
  local -a empty_network_ids=()

  if ! discovered="$(docker_query network ls --format '{{.ID}}\t{{.Name}}' 2>/dev/null)"; then
    warn "failed to query workflow networks"
    mutation_failed=true
    return
  fi
  while IFS=$'\t' read -r id name; do
    [ -n "${id:-}" ] && [ -n "${name:-}" ] || continue
    case "$name" in
      WORKFLOW-*) ;;
      *) continue ;;
    esac
    if ! count="$(workflow_network_container_count "$id")"; then
      warn "failed to inspect workflow network $id"
      mutation_failed=true
      continue
    fi
    if [ "$count" = "0" ]; then
      empty_network_ids+=("$id")
    fi
  done <<< "$discovered"

  remove_ids network "${empty_network_ids[@]}"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --manifest-inventory|--manifest-plan)
        [ "$#" -ge 2 ] || fail "$1 requires a request file"
        [ -z "$manifest_mode" ] || fail "only one manifest mode may be selected"
        manifest_mode="${1#--manifest-}"
        manifest_request="$2"
        shift 2
        ;;
      --project)
        [ "$#" -ge 2 ] || fail "--project requires a value"
        validate_project_arg "$2"
        projects+=("$2")
        shift 2
        ;;
      --prefix)
        [ "$#" -ge 2 ] || fail "--prefix requires a value"
        validate_name "prefix" "$2"
        prefixes+=("$2")
        shift 2
        ;;
      --exclude-project)
        [ "$#" -ge 2 ] || fail "--exclude-project requires a value"
        validate_name "excluded project" "$2"
        excluded_projects+=("$2")
        shift 2
        ;;
      --runner-leftovers)
        runner_leftovers=true
        shift
        ;;
      --verify-empty)
        verify_empty=true
        shift
        ;;
      --dry-run)
        dry_run=true
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        usage
        fail "unknown option: $1"
        ;;
    esac
  done
}

manifest_enabled() {
  [ -n "${SANCTUARY_RUNTIME_DIR:-}" ] \
    && [ -n "${SANCTUARY_DEPLOYMENT_ID:-}" ] \
    && [ -d "$SANCTUARY_RUNTIME_DIR/ownership/deployments/$SANCTUARY_DEPLOYMENT_ID/revisions" ]
}

is_explicit_premanifest_fixture() {
  [ "${SANCTUARY_PRE_MANIFEST_NONPRODUCTION:-}" = "true" ]
}

discover_manifest_deployment_ids() {
  local project="$1" containers networks volumes
  local format='d={{.Label "io.sanctuary.deployment-id"}}\tp={{.Label "io.sanctuary.project"}}\to={{.Label "io.sanctuary.owner-id"}}\tc={{.Label "io.sanctuary.resource-class"}}\tl={{.Label "io.sanctuary.lifecycle"}}\ty={{.Label "io.sanctuary.cleanup-policy"}}\tt={{.Label "io.sanctuary.created-at"}}\tr={{.Label "io.sanctuary.created-by-release"}}\tm={{.Label "io.sanctuary.created-by-commit"}}\tu={{.Label "io.sanctuary.creation-run-id"}}\ta={{.Labels}}'

  containers="$(docker_query ps -a --filter "label=com.docker.compose.project=$project" \
    --format "$format" 2>/dev/null)" || return
  networks="$(docker_query network ls --filter "label=com.docker.compose.project=$project" \
    --format "$format" 2>/dev/null)" || return
  volumes="$(docker_query volume ls --filter "label=com.docker.compose.project=$project" \
    --format "$format" 2>/dev/null)" || return
  {
    validate_manifest_label_rows "$project" compose_container "$containers"
    validate_manifest_label_rows "$project" compose_network "$networks"
    validate_manifest_label_rows "$project" compose_volume "$volumes"
  } | sort -u
}

validate_manifest_label_rows() {
  local expected_project="$1" expected_class="$2" rows="$3"
  local deployment project owner resource_class lifecycle policy created release commit run_id all_labels

  while IFS=$'\t' read -r deployment project owner resource_class lifecycle policy created release commit run_id all_labels; do
    [ -n "$all_labels" ] || continue
    if [[ "$deployment" != d=* || "$project" != p=* || "$owner" != o=* \
        || "$resource_class" != c=* || "$lifecycle" != l=* || "$policy" != y=* \
        || "$created" != t=* || "$release" != r=* || "$commit" != m=* \
        || "$run_id" != u=* || "$all_labels" != a=* ]]; then
      fail "Compose project $expected_project returned a malformed ownership observation"
    fi
    deployment="${deployment#d=}" project="${project#p=}" owner="${owner#o=}"
    resource_class="${resource_class#c=}" lifecycle="${lifecycle#l=}" policy="${policy#y=}"
    created="${created#t=}" release="${release#r=}" commit="${commit#m=}"
    run_id="${run_id#u=}" all_labels="${all_labels#a=}"
    case "$all_labels" in *io.sanctuary.*) ;; *) continue ;; esac
    if [ -z "$deployment" ] || [ "$project" != "$expected_project" ] || [ -z "$owner" ] \
      || [ "$resource_class" != "$expected_class" ] || [ -z "$lifecycle" ] || [ -z "$policy" ] \
      || [ -z "$created" ] || [ -z "$release" ] || [ -z "$commit" ] || [ -z "$run_id" ]; then
      fail "Compose project $expected_project has a partial or inconsistent ownership tuple"
    fi
    validate_name "manifest deployment ID" "$deployment"
    printf '%s\n' "$deployment"
  done <<< "$rows"
}

append_project() {
  local candidate="$1" existing
  for existing in "${projects[@]}"; do
    [ "$existing" != "$candidate" ] || return
  done
  projects+=("$candidate")
}

expand_prefix_projects() {
  local prefix discovered project
  for prefix in "${prefixes[@]}"; do
    if ! discovered="$(collect_projects_by_prefix "$prefix")"; then
      fail "failed to query Compose projects for prefix $prefix"
    fi
    while IFS= read -r project; do
      [ -n "$project" ] || continue
      is_excluded_project "$project" || append_project "$project"
    done <<< "$discovered"
  done
}

acquire_manifest_guard() {
  local lock_output project discovered detected_id="" detected_project=""

  for project in "${projects[@]}"; do
    if ! discovered="$(discover_manifest_deployment_ids "$project")"; then
      fail "failed to determine whether Compose project $project is manifest-enabled"
    fi
    if [ "$(printf '%s\n' "$discovered" | sed '/^$/d' | wc -l)" -gt 1 ]; then
      fail "Compose project $project has multiple manifest deployment identities"
    fi
    if [ -n "$discovered" ]; then
      validate_name "manifest deployment ID" "$discovered"
      if [ -n "$detected_id" ] && [ "$detected_id" != "$discovered" ]; then
        fail "legacy cleanup cannot lock multiple manifest deployments"
      fi
      detected_id="$discovered"
      detected_project="$project"
    fi
  done

  if [ -n "$detected_id" ]; then
    if [ -n "${SANCTUARY_DEPLOYMENT_ID:-}" ] && [ "$SANCTUARY_DEPLOYMENT_ID" != "$detected_id" ]; then
      fail "manifest deployment identity does not match SANCTUARY_DEPLOYMENT_ID"
    fi
    export SANCTUARY_DEPLOYMENT_ID="$detected_id"
    export SANCTUARY_RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/sanctuary}"
    manifest_enabled || fail "manifest-labeled project has no canonical deployment state"
  fi

  if ! manifest_enabled; then
    for project in "${projects[@]}"; do
      is_explicit_premanifest_fixture "$project" \
        || fail "unregistered legacy cleanup requires an explicit non-production fixture"
    done
    for prefix in "${prefixes[@]}"; do
      is_explicit_premanifest_fixture "$prefix" \
        || fail "unregistered prefix cleanup requires an explicit non-production fixture"
    done
    return 0
  fi
  [ "${#prefixes[@]}" -eq 0 ] || fail "manifest-enabled prefix cleanup requires manifest inventory and planning"
  [ "${#projects[@]}" -eq 1 ] || fail "manifest-enabled legacy cleanup requires one exact project"
  detected_project="${detected_project:-${projects[0]}}"
  export SANCTUARY_PROJECT="$detected_project"
  export SANCTUARY_PROJECT_LOCK_TOKEN="${project_lock_tokens[$detected_project]}"
  export SANCTUARY_PROJECT_LOCK_OWNERSHIP=inherited
  export SANCTUARY_OPERATION_RUN_ID="${SANCTUARY_OPERATION_RUN_ID:-legacy-cleanup-$$}"
  export SANCTUARY_LOCK_CONTROLLER_PID="$$"
  lock_output="$(node "$script_root/scripts/ownership/deployment-session.mjs" lock-only)"
  IFS=$'\t' read -r manifest_lock_token lock_mode <<< "$lock_output"
  [ -n "$manifest_lock_token" ] || fail "manifest deployment lock did not return a token"
  export SANCTUARY_DEPLOYMENT_LOCK_TOKEN="$manifest_lock_token"
  if [ "$lock_mode" = "owned" ]; then
    manifest_lock_owned=true
  fi
  for project in "${projects[@]}"; do
    node "$script_root/scripts/ownership/deployment-session.mjs" guard-legacy-cleanup "$project" >/dev/null
  done
}

acquire_project_guards() {
  local project token
  local -a ordered=()

  [ "${#projects[@]}" -gt 0 ] || return 0
  export SANCTUARY_RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/sanctuary}"
  export SANCTUARY_OPERATION_RUN_ID="${SANCTUARY_OPERATION_RUN_ID:-legacy-cleanup-$$}"
  export SANCTUARY_LOCK_CONTROLLER_PID="$$"
  mapfile -t ordered < <(printf '%s\n' "${projects[@]}" | sort -u)
  for project in "${ordered[@]}"; do
    token="$(node "$script_root/scripts/ownership/project-lock-cli.mjs" acquire "$project")" \
      || fail "failed to acquire the project mutation lock for $project"
    [ -n "$token" ] || fail "project mutation lock did not return a token for $project"
    project_lock_tokens["$project"]="$token"
    project_lock_order+=("$project")
  done
}

release_manifest_guard() {
  if [ "$manifest_lock_owned" = true ] && [ -n "$manifest_lock_token" ]; then
    if ! node "$script_root/scripts/ownership/deployment-session.mjs" release; then
      warn "failed to release the canonical deployment mutation lock"
      return 1
    fi
    manifest_lock_owned=false
    manifest_lock_token=""
  fi
}

release_project_guards() {
  local index project token failed=0
  local -a retained=()
  for ((index=${#project_lock_order[@]} - 1; index >= 0; index--)); do
    project="${project_lock_order[$index]}"
    token="${project_lock_tokens[$project]}"
    if [ "$manifest_lock_owned" = true ] && [ "$project" = "${SANCTUARY_PROJECT:-}" ]; then
      warn "retaining the project mutation lock because the deployment lock release failed for $project"
      retained+=("$project")
      failed=1
      continue
    fi
    if ! node "$script_root/scripts/ownership/project-lock-cli.mjs" release "$project" "$token"; then
      warn "failed to release the project mutation lock for $project"
      retained+=("$project")
      failed=1
      continue
    fi
    unset 'project_lock_tokens[$project]'
  done
  project_lock_order=("${retained[@]}")
  return "$failed"
}

release_cleanup_guards() {
  local failed=0
  release_manifest_guard || failed=1
  release_project_guards || failed=1
  return "$failed"
}

cleanup_guards_on_exit() {
  local status="$?" release_status=0
  trap - EXIT
  release_cleanup_guards || release_status=1
  if [ "$status" -eq 0 ] && [ "$release_status" -ne 0 ]; then
    status=1
  fi
  exit "$status"
}

main() {
  local project prefix
  local verification_failed=false

  parse_args "$@"

  if [ -n "$manifest_mode" ]; then
    if [ "${#projects[@]}" -gt 0 ] || [ "${#prefixes[@]}" -gt 0 ] \
      || [ "$runner_leftovers" = true ] || [ "$verify_empty" = true ] || [ "$dry_run" = true ]; then
      fail "manifest modes cannot be combined with legacy cleanup options"
    fi
    node "$script_root/scripts/ownership/cleanup-cli.mjs" "$manifest_mode" "$manifest_request"
    return
  fi

  if [ "${#projects[@]}" -eq 0 ] && [ "${#prefixes[@]}" -eq 0 ] && [ "$runner_leftovers" = false ]; then
    usage
    fail "at least one cleanup target is required"
  fi

  expand_prefix_projects

  trap cleanup_guards_on_exit EXIT
  acquire_project_guards
  acquire_manifest_guard

  for project in "${projects[@]}"; do
    cleanup_project "$project"
  done

  if [ "$runner_leftovers" = true ]; then
    cleanup_action_containers
    cleanup_workflow_networks
  fi

  if [ "$verify_empty" = true ]; then
    for project in "${projects[@]}"; do
      verify_project_empty "$project" || verification_failed=true
    done

    for prefix in "${prefixes[@]}"; do
      verify_prefix_empty "$prefix" || verification_failed=true
    done

    if [ "$verification_failed" = true ]; then
      fail "cleanup verification found remaining Compose resources"
    fi
  fi

  if [ "$mutation_failed" = true ]; then
    fail "one or more Docker cleanup commands failed"
  fi

  if ! release_cleanup_guards; then
    trap - EXIT
    fail "one or more cleanup mutation locks could not be released"
  fi
  trap - EXIT
}

main "$@"
