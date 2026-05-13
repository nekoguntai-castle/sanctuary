#!/usr/bin/env bash
# Emit a small fixed payload describing the runner state at the moment
# this script runs. Designed to be invoked through scripts/ci/run-with-log.sh
# so its output is captured and redacted alongside other diagnostic logs.
#
# The payload is a deliberately minimal set of host-shape checks plus a
# narrowly allowlisted CI environment summary. It must NOT dump full
# `env`, container internals, or anything that grows proportionally to
# host complexity. Each unbounded command is bounded with `head -n N`
# so total output stays small even on hosts with many networks/containers.
#
# Usage: scripts/ci/write-preflight-diagnostics.sh
#   (intended to be wrapped by run-with-log.sh in CI workflows)
#
# Behavior:
#   - Always exits 0. Diagnostic helpers should never themselves fail
#     a build by being unable to gather information; the absence of a
#     section is itself diagnostic.
#   - Each tool invocation is wrapped in `|| true` so a missing tool
#     (e.g. docker not installed) does not abort.
#   - Each section is annotated with a clear header.

# Note: do NOT enable `set -e`. Diagnostic gathering must be best-effort.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
source "$SCRIPT_DIR/provider-context.sh"

SECTION_LIMIT_LINES="${SANCTUARY_CI_PREFLIGHT_LINES:-200}"
case "$SECTION_LIMIT_LINES" in
  ''|*[!0-9]*)
    SECTION_LIMIT_LINES=200
    ;;
esac

COMMAND_TIMEOUT_SECONDS="${SANCTUARY_CI_PREFLIGHT_TIMEOUT_SECONDS:-10}"
case "$COMMAND_TIMEOUT_SECONDS" in
  ''|*[!0-9]*)
    COMMAND_TIMEOUT_SECONDS=10
    ;;
esac

# Allowlist of CI/runtime env vars considered safe to surface for
# diagnostic context. Anything matching the redactor's secret patterns
# (KEY/PASSWORD/TOKEN/etc.) is redacted by run-with-log's redactor stack
# anyway, but the allowlist keeps unexpected names from sneaking in.
ENV_ALLOWLIST=(
  CI
  RUNNER_NAME
  RUNNER_OS
  RUNNER_ARCH
  RUNNER_LABELS
  COMPOSE_PROJECT_NAME
  HTTPS_PORT
  HTTP_PORT
  GATEWAY_PORT
  PORT_OFFSET
  SANCTUARY_INSTALL_WORKSPACE
  SANCTUARY_RUNNER_LOCK_DIR
  SANCTUARY_CI_PROJECT_PREFIXES
  SANCTUARY_CI_DEBUG_TRACE
  DOCKER_HOST
  PATH
  HOME
  USER
  SHELL
  TMPDIR
)

section() {
  printf '\n===== %s =====\n' "$1"
}

run_bounded() {
  # Bound each section's captured output. Drains stdin via head's
  # fixed-line cap; downstream tools that produce huge output are not
  # SIGPIPE-killed because we discard their tail explicitly via cat.
  local label="$1"
  shift
  section "$label"
  ( run_with_timeout "$@" 2>&1 || true ) | { head -n "$SECTION_LIMIT_LINES"; cat >/dev/null; }
}

run_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "$COMMAND_TIMEOUT_SECONDS" "$@"
    return "$?"
  fi

  "$@"
}

stat_path() {
  local label="$1"
  local path="$2"

  if [ -e "$path" ]; then
    printf '%s=%s\n' "${label}_path" "$path"
    stat -c "${label}_stat=device:%d inode:%i mode:%a uid:%u gid:%g type:%F" "$path" 2>/dev/null || true
    return 0
  fi

  printf '%s=%s\n' "${label}_path" "$path"
  printf '%s_exists=false\n' "$label"
}

path_is_under() {
  local path="$1"
  local parent="$2"

  [ -n "$path" ] || return 1
  [ -n "$parent" ] || return 1

  case "$path" in
    "$parent"|"$parent"/*) return 0 ;;
    *) return 1 ;;
  esac
}

runner_lock_scope_inference() {
  local lock_dir="$1"
  local workspace="$2"
  local temp_dir="$3"

  if path_is_under "$lock_dir" "$workspace"; then
    printf '%s\n' "workspace-local"
    return 0
  fi

  if path_is_under "$lock_dir" "$temp_dir"; then
    printf '%s\n' "runner-temp-local"
    return 0
  fi

  printf '%s\n' "outside-workspace-or-unknown"
}

write_runner_lock_diagnostics() {
  local workspace
  local temp_dir
  local lock_dir
  local lock_file
  local parent_dir

  workspace="$(ci_workspace)"
  temp_dir="$(ci_temp_dir)"
  lock_dir="${SANCTUARY_RUNNER_LOCK_DIR:-}"
  if [ -z "$lock_dir" ]; then
    lock_dir="$(dirname "$workspace")/.sanctuary-runner-locks"
  fi
  lock_file="${lock_dir}/e2e.lock"
  parent_dir="$(dirname "$lock_dir")"

  section "runner lock diagnostics"
  printf 'runner_lock_dir=%s\n' "$lock_dir"
  printf 'runner_lock_file=%s\n' "$lock_file"
  printf 'runner_lock_scope_inference=%s\n' "$(runner_lock_scope_inference "$lock_dir" "$workspace" "$temp_dir")"
  printf 'runner_lock_dir_configured=%s\n' "$([ -n "${SANCTUARY_RUNNER_LOCK_DIR:-}" ] && echo true || echo false)"
  stat_path "runner_lock_parent" "$parent_dir"
  stat_path "runner_lock_dir" "$lock_dir"
  stat_path "runner_lock_file" "$lock_file"
}

write_compose_prefix_diagnostics() {
  local prefixes="${SANCTUARY_CI_PROJECT_PREFIXES:-}"
  local prefix

  if [ -z "$prefixes" ] && [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
    prefixes="$COMPOSE_PROJECT_NAME"
  fi

  section "docker compose leftovers for configured prefixes"
  if [ -z "$prefixes" ]; then
    echo "configured_prefixes="
    echo "no configured compose project prefixes"
    return 0
  fi

  echo "configured_prefixes=$prefixes"
  for prefix in ${prefixes//,/ }; do
    [ -n "$prefix" ] || continue
    echo "--- prefix: $prefix"
    run_with_timeout docker ps -a \
      --filter label=com.docker.compose.project \
      --format '{{.Label "com.docker.compose.project"}}	{{.Names}}	{{.Status}}' 2>/dev/null \
      | awk -v prefix="$prefix" '$1 ~ "^" prefix { print "container\t" $0 }' \
      | head -n "$SECTION_LIMIT_LINES" || true
    run_with_timeout docker network ls \
      --filter label=com.docker.compose.project \
      --format '{{.Name}}	{{.Labels}}' 2>/dev/null \
      | awk -F '\t' -v prefix="$prefix" '$2 ~ "com.docker.compose.project=" prefix { print "network\t" $0 }' \
      | head -n "$SECTION_LIMIT_LINES" || true
    run_with_timeout docker volume ls \
      --filter label=com.docker.compose.project \
      --format '{{.Name}}	{{.Labels}}' 2>/dev/null \
      | awk -F '\t' -v prefix="$prefix" '$2 ~ "com.docker.compose.project=" prefix { print "volume\t" $0 }' \
      | head -n "$SECTION_LIMIT_LINES" || true
  done
}

section "preflight-diagnostics"
echo "captured_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || true)"
echo "host=$(uname -n 2>/dev/null || echo unknown)"
echo "kernel=$(uname -srm 2>/dev/null || echo unknown)"
echo "uid=$(id -u 2>/dev/null || echo unknown) gid=$(id -g 2>/dev/null || echo unknown)"
echo "section_limit_lines=$SECTION_LIMIT_LINES"
echo "command_timeout_seconds=$COMMAND_TIMEOUT_SECONDS"
echo "ci_provider=$(ci_provider)"
echo "ci_event_name=$(ci_event_name)"
echo "ci_run_id=$(ci_run_id)"
echo "ci_workspace=$(ci_workspace)"
echo "ci_temp_dir=$(ci_temp_dir)"

write_runner_lock_diagnostics
run_bounded "docker version" docker version
run_bounded "docker info" docker info
run_bounded "docker system df" docker system df
run_bounded "docker buildx ls" docker buildx ls
run_bounded "docker buildx state volumes" bash -c 'docker volume ls --format "{{.Name}}	{{.Driver}}" 2>/dev/null | awk '"'"'$1 ~ /^buildx_buildkit_/ { print }'"'"''
run_bounded "docker compose-labeled containers" bash -c 'docker ps -a --filter label=com.docker.compose.project --format "{{.Label \"com.docker.compose.project\"}}	{{.Names}}	{{.Status}}" 2>/dev/null | sort -u'
run_bounded "docker compose-labeled networks" bash -c 'docker network ls --filter label=com.docker.compose.project --format "{{.Name}}	{{.Labels}}" 2>/dev/null | sort -u'
run_bounded "docker compose-labeled volumes" bash -c 'docker volume ls --filter label=com.docker.compose.project --format "{{.Name}}	{{.Labels}}" 2>/dev/null | sort -u'
write_compose_prefix_diagnostics
run_bounded "df -h /tmp /var/tmp" df -h /tmp /var/tmp
run_bounded "mount" mount

section "env (allowlisted)"
for var in "${ENV_ALLOWLIST[@]}"; do
  if [ "${!var+isset}" = "isset" ]; then
    printf '%s=%s\n' "$var" "${!var}"
  fi
done

section "preflight-diagnostics-end"
exit 0
