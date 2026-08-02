#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/cleanup-docker-resources.sh [options]

Options:
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
      docker_query ps -a --filter "label=com.docker.compose.project=$project" -q 2>/dev/null | sed '/^$/d' || true
      ;;
    network)
      docker_query network ls --filter "label=com.docker.compose.project=$project" -q 2>/dev/null | sed '/^$/d' || true
      ;;
    volume)
      docker_query volume ls --filter "label=com.docker.compose.project=$project" -q 2>/dev/null | sed '/^$/d' || true
      ;;
    *)
      fail "unknown Docker resource type: $resource"
      ;;
  esac
}

cleanup_project() {
  local project="$1"
  local -a ids

  if is_protected_project "$project"; then
    warn "skipping protected project: $project"
    return 0
  fi

  mapfile -t ids < <(collect_project_resource_ids container "$project")
  remove_ids container "${ids[@]}"

  mapfile -t ids < <(collect_project_resource_ids network "$project")
  remove_ids network "${ids[@]}"

  mapfile -t ids < <(collect_project_resource_ids volume "$project")
  remove_ids volume "${ids[@]}"
}

verify_project_empty() {
  local project="$1"
  local resource
  local failed=0
  local -a ids

  for resource in container network volume; do
    mapfile -t ids < <(collect_project_resource_ids "$resource" "$project")
    if [ "${#ids[@]}" -gt 0 ]; then
      warn "resources remain for Compose project $project ($resource): ${ids[*]}"
      failed=1
    fi
  done

  return "$failed"
}

collect_projects_by_prefix() {
  local prefix="$1"

  {
    docker_query ps -a --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null || true
    docker_query network ls --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null || true
    docker_query volume ls --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null || true
  } | awk -v prefix="$prefix" 'index($0, prefix) == 1 { print }' | sort -u
}

cleanup_prefix() {
  local prefix="$1"
  local project

  while IFS= read -r project; do
    [ -n "$project" ] || continue
    if is_excluded_project "$project"; then
      continue
    fi
    cleanup_project "$project"
  done < <(collect_projects_by_prefix "$prefix")
}

verify_prefix_empty() {
  local prefix="$1"
  local project
  local failed=0

  while IFS= read -r project; do
    [ -n "$project" ] || continue
    if is_excluded_project "$project"; then
      continue
    fi
    verify_project_empty "$project" || failed=1
  done < <(collect_projects_by_prefix "$prefix")

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
  local id names status created age
  local -a stale_ids=()

  # Every runner-named container considered is reported with the decision taken.
  # This is the only place that observes runner container naming, and whether the
  # runner applies the ACTIONS-TASK prefix to SERVICE containers (not just job
  # containers) decides whether this sweep could ever have removed a live
  # database. Logging it makes the next run answer that question. See #606.
  echo "cleanup-docker-resources: runner leftover sweep (min age ${runner_leftover_min_age_seconds}s)"

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
  done < <(docker_query ps -a --format '{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.CreatedAt}}' 2>/dev/null || true)

  remove_ids container "${stale_ids[@]}"
}

workflow_network_container_count() {
  local network_id="$1"

  docker_query network inspect --format '{{len .Containers}}' "$network_id" 2>/dev/null || echo unknown
}

cleanup_workflow_networks() {
  local id name count
  local -a empty_network_ids=()

  while IFS=$'\t' read -r id name; do
    [ -n "${id:-}" ] && [ -n "${name:-}" ] || continue
    case "$name" in
      WORKFLOW-*) ;;
      *) continue ;;
    esac
    count="$(workflow_network_container_count "$id")"
    if [ "$count" = "0" ]; then
      empty_network_ids+=("$id")
    fi
  done < <(docker_query network ls --format '{{.ID}}\t{{.Name}}' 2>/dev/null || true)

  remove_ids network "${empty_network_ids[@]}"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
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

main() {
  local project prefix
  local verification_failed=false

  parse_args "$@"

  if [ "${#projects[@]}" -eq 0 ] && [ "${#prefixes[@]}" -eq 0 ] && [ "$runner_leftovers" = false ]; then
    usage
    fail "at least one cleanup target is required"
  fi

  for project in "${projects[@]}"; do
    cleanup_project "$project"
  done

  for prefix in "${prefixes[@]}"; do
    cleanup_prefix "$prefix"
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
}

main "$@"
