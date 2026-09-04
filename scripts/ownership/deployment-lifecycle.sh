#!/usr/bin/env bash
# Shell controller bridge for immutable deployment generations.

DEPLOYMENT_LIFECYCLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

deployment_lifecycle_initialize() {
  SANCTUARY_LOCK_CONTROLLER_PID="${SANCTUARY_LOCK_CONTROLLER_PID:-$$}"
  export SANCTUARY_LOCK_CONTROLLER_PID
  DEPLOYMENT_SESSION_SCRIPT="$DEPLOYMENT_LIFECYCLE_DIR/deployment-session.mjs"
}

deployment_begin() {
  local monitoring="$1" tor="$2" mcp="$3" upgrade="${4:-false}" result args_file lock_ownership_result
  deployment_lifecycle_initialize
  result="$(SANCTUARY_INCLUDE_MONITORING="$monitoring" SANCTUARY_INCLUDE_TOR="$tor" \
    SANCTUARY_INCLUDE_MCP="$mcp" SANCTUARY_UPGRADE_MODE="$upgrade" node "$DEPLOYMENT_SESSION_SCRIPT" begin)"
  IFS=$'\t' read -r SANCTUARY_DEPLOYMENT_STATE SANCTUARY_DEPLOYMENT_GENERATION \
    SANCTUARY_PENDING_DIGEST SANCTUARY_DEPLOYMENT_LOCK_TOKEN lock_ownership_result \
    SANCTUARY_DEPLOYMENT_STAGE <<< "$result"
  if [ "${DEPLOYMENT_LOCK_OWNERSHIP:-}" != owned ]; then
    DEPLOYMENT_LOCK_OWNERSHIP="$lock_ownership_result"
  fi
  [ -n "$SANCTUARY_DEPLOYMENT_LOCK_TOKEN" ] || return 1
  SANCTUARY_PROJECT_LOCK_TOKEN="$SANCTUARY_DEPLOYMENT_LOCK_TOKEN"
  SANCTUARY_PROJECT_LOCK_OWNERSHIP="${SANCTUARY_PROJECT_LOCK_OWNERSHIP:-owned}"
  export SANCTUARY_DEPLOYMENT_STATE SANCTUARY_DEPLOYMENT_GENERATION SANCTUARY_PENDING_DIGEST
  export SANCTUARY_DEPLOYMENT_STAGE
  export SANCTUARY_DEPLOYMENT_LOCK_TOKEN SANCTUARY_PROJECT_LOCK_TOKEN SANCTUARY_PROJECT_LOCK_OWNERSHIP DEPLOYMENT_LOCK_OWNERSHIP
  args_file="$(mktemp "${TMPDIR:-/tmp}/sanctuary-compose-args.XXXXXX")" || return 1
  if ! node "$DEPLOYMENT_SESSION_SCRIPT" compose-args "$SANCTUARY_DEPLOYMENT_GENERATION" > "$args_file"; then
    rm -f "$args_file"
    return 1
  fi
  mapfile -d '' -t COMPOSE_FILE_ARGS < "$args_file"
  rm -f "$args_file"
  [ "${#COMPOSE_FILE_ARGS[@]}" -gt 0 ]
}

deployment_verify_legacy_upgrade() {
  deployment_lifecycle_initialize
  node "$DEPLOYMENT_SESSION_SCRIPT" verify-legacy-upgrade >/dev/null
}

deployment_verify_legacy_preconditions() {
  deployment_lifecycle_initialize
  node "$DEPLOYMENT_SESSION_SCRIPT" verify-legacy-preconditions >/dev/null
}

deployment_verify_legacy_compose_volume() {
  deployment_lifecycle_initialize
  node "$DEPLOYMENT_SESSION_SCRIPT" verify-legacy-compose-volume "$1" "$2"
}

deployment_lock_only_acquire() {
  local result
  deployment_lifecycle_initialize
  result="$(node "$DEPLOYMENT_SESSION_SCRIPT" lock-only)"
  IFS=$'\t' read -r SANCTUARY_DEPLOYMENT_LOCK_TOKEN DEPLOYMENT_LOCK_OWNERSHIP <<< "$result"
  [ -n "$SANCTUARY_DEPLOYMENT_LOCK_TOKEN" ] || return 1
  SANCTUARY_PROJECT_LOCK_TOKEN="$SANCTUARY_DEPLOYMENT_LOCK_TOKEN"
  SANCTUARY_PROJECT_LOCK_OWNERSHIP="${SANCTUARY_PROJECT_LOCK_OWNERSHIP:-owned}"
  export SANCTUARY_DEPLOYMENT_LOCK_TOKEN SANCTUARY_PROJECT_LOCK_TOKEN SANCTUARY_PROJECT_LOCK_OWNERSHIP DEPLOYMENT_LOCK_OWNERSHIP
}

deployment_assert_lock() {
  deployment_lifecycle_initialize
  node "$DEPLOYMENT_SESSION_SCRIPT" assert-lock >/dev/null
}

deployment_use_active() {
  local result args_file lock_ownership_result
  deployment_lifecycle_initialize
  result="$(node "$DEPLOYMENT_SESSION_SCRIPT" use-active)"
  IFS=$'\t' read -r SANCTUARY_DEPLOYMENT_STATE SANCTUARY_DEPLOYMENT_GENERATION \
    SANCTUARY_PENDING_DIGEST SANCTUARY_DEPLOYMENT_LOCK_TOKEN lock_ownership_result \
    SANCTUARY_DEPLOYMENT_STAGE <<< "$result"
  if [ "${DEPLOYMENT_LOCK_OWNERSHIP:-}" != owned ]; then
    DEPLOYMENT_LOCK_OWNERSHIP="$lock_ownership_result"
  fi
  export SANCTUARY_DEPLOYMENT_STATE SANCTUARY_DEPLOYMENT_GENERATION SANCTUARY_PENDING_DIGEST
  export SANCTUARY_DEPLOYMENT_STAGE
  SANCTUARY_PROJECT_LOCK_TOKEN="$SANCTUARY_DEPLOYMENT_LOCK_TOKEN"
  SANCTUARY_PROJECT_LOCK_OWNERSHIP="${SANCTUARY_PROJECT_LOCK_OWNERSHIP:-owned}"
  export SANCTUARY_DEPLOYMENT_LOCK_TOKEN SANCTUARY_PROJECT_LOCK_TOKEN SANCTUARY_PROJECT_LOCK_OWNERSHIP DEPLOYMENT_LOCK_OWNERSHIP
  args_file="$(mktemp "${TMPDIR:-/tmp}/sanctuary-compose-args.XXXXXX")" || return 1
  if ! node "$DEPLOYMENT_SESSION_SCRIPT" compose-args "$SANCTUARY_DEPLOYMENT_GENERATION" > "$args_file"; then
    rm -f "$args_file"
    return 1
  fi
  mapfile -d '' -t COMPOSE_FILE_ARGS < "$args_file"
  rm -f "$args_file"
  [ "${#COMPOSE_FILE_ARGS[@]}" -gt 0 ]
}

deployment_transition() {
  [ "$SANCTUARY_DEPLOYMENT_STATE" = pending ] || return 0
  local current_rank next_rank
  current_rank="$(deployment_stage_rank "$SANCTUARY_DEPLOYMENT_STAGE")" || return 1
  next_rank="$(deployment_stage_rank "$1")" || return 1
  [ "$current_rank" -lt "$next_rank" ] || return 0
  SANCTUARY_PENDING_DIGEST="$(node "$DEPLOYMENT_SESSION_SCRIPT" transition "$1")"
  SANCTUARY_DEPLOYMENT_STAGE="$1"
  export SANCTUARY_PENDING_DIGEST SANCTUARY_DEPLOYMENT_STAGE
}

deployment_stage_rank() {
  case "$1" in
    prepared) echo 0 ;;
    build_started) echo 1 ;;
    build_completed) echo 2 ;;
    postgres_started) echo 3 ;;
    password_reconciled) echo 4 ;;
    stack_started) echo 5 ;;
    health_verified) echo 6 ;;
    *) echo "unknown deployment stage: $1" >&2; return 1 ;;
  esac
}

deployment_stage_before() {
  # Only a pending revision has completed stages to skip. An active revision
  # (unchanged definition) replays every operator stage: `up` is idempotent and
  # `--rebuild` must really rebuild. Stage "active" has no rank on purpose.
  [ "${SANCTUARY_DEPLOYMENT_STATE:-}" = pending ] || return 0
  [ "$(deployment_stage_rank "$SANCTUARY_DEPLOYMENT_STAGE")" -lt "$(deployment_stage_rank "$1")" ]
}

deployment_activate() {
  [ "$SANCTUARY_DEPLOYMENT_STATE" = pending ] || return 0
  node "$DEPLOYMENT_SESSION_SCRIPT" activate >/dev/null
  SANCTUARY_DEPLOYMENT_STATE=active
  SANCTUARY_DEPLOYMENT_STAGE=active
  export SANCTUARY_DEPLOYMENT_STATE SANCTUARY_DEPLOYMENT_STAGE
}

deployment_finalize_prepared() {
  [ "$SANCTUARY_DEPLOYMENT_STATE" = pending ] || return 0
  node "$DEPLOYMENT_SESSION_SCRIPT" finalize-prepared >/dev/null
  SANCTUARY_DEPLOYMENT_STATE=prepared
  export SANCTUARY_DEPLOYMENT_STATE
}

deployment_lock_release() {
  [ "${DEPLOYMENT_LOCK_OWNERSHIP:-}" = owned ] || return 0
  [ -n "${SANCTUARY_DEPLOYMENT_LOCK_TOKEN:-}" ] || return 0
  node "$DEPLOYMENT_SESSION_SCRIPT" release >/dev/null
  DEPLOYMENT_LOCK_OWNERSHIP=released
  unset SANCTUARY_DEPLOYMENT_LOCK_TOKEN SANCTUARY_PROJECT_LOCK_TOKEN SANCTUARY_PROJECT_LOCK_OWNERSHIP
}
