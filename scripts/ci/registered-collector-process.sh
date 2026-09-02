#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
# shellcheck source=scripts/ownership/producer-hooks.sh
source "$PROJECT_ROOT/scripts/ownership/producer-hooks.sh"

fail() {
  printf 'registered-collector-process: %s\n' "$*" >&2
  return 1
}

require_runtime() {
  local runtime=${SANCTUARY_RUNTIME_DIR:-} resolved owner mode
  [[ ${SANCTUARY_CLEANUP_COORDINATED:-0} == 1 && -n $runtime && $runtime == /* \
      && -d $runtime && ! -L $runtime ]] \
    || fail 'a coordinated owner-only runtime is required' || return
  resolved=$(cd "$runtime" && pwd -P) || return
  owner=$(stat -c '%u' -- "$runtime") || return
  mode=$(stat -c '%a' -- "$runtime") || return
  [[ $resolved == "$runtime" && $owner == "${UID:-$(id -u)}" && $mode == 700 ]] \
    || fail 'cleanup runtime authority is not canonical and owner-only' || return
  printf '%s' "$runtime"
}

marker_directory() {
  local runtime=$1 directory="$1/collector-markers" owner mode
  if [[ ! -e $directory ]]; then
    (umask 077; mkdir -- "$directory") || [[ -d $directory && ! -L $directory ]] || return
  fi
  [[ -d $directory && ! -L $directory ]] \
    || fail 'collector marker directory is not a real directory' || return
  owner=$(stat -c '%u' -- "$directory") || return
  mode=$(stat -c '%a' -- "$directory") || return
  [[ $owner == "${UID:-$(id -u)}" && $mode == 700 ]] \
    || fail 'collector marker directory is not owner-only' || return
  printf '%s' "$directory"
}

write_marker() {
  local path=$1 state=$2
  (umask 077; set -o noclobber
    jq -cSjn --arg operationRunId "$SANCTUARY_OPERATION_RUN_ID" --arg state "$state" \
      '{operationRunId: $operationRunId, state: $state}' > "$path")
}

wait_for_final_argv() {
  local pid=$1 script=$2 attempt argument matched
  for attempt in $(seq 1 100); do
    matched=0
    while IFS= read -r -d '' argument; do
      [[ $argument == "$script" ]] && matched=1
    done < "/proc/$pid/cmdline" 2>/dev/null || true
    [[ $matched == 1 ]] && return 0
    sleep 0.01
  done
  fail 'collector did not reach its final registered argv'
}

register_collector() {
  [[ $# == 3 && $1 =~ ^[1-9][0-9]{0,9}$ \
      && $3 =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] \
    || fail 'usage: registered-collector-process.sh register PID SCRIPT LABEL' || return
  local pid=$1 script=$2 label=$3 runtime directory heartbeat terminal authority_bundle confirmed_bundle
  local execution_authority identity
  [[ $script == /* && -f $script && ! -L $script ]] \
    || fail 'collector script must be an absolute regular file' || return
  runtime=$(require_runtime) || return
  directory=$(marker_directory "$runtime") || return
  heartbeat="$directory/$label-$pid.heartbeat.json"
  terminal="$directory/$label-$pid.terminal.json"
  [[ ! -e $heartbeat && ! -e $terminal ]] \
    || fail 'collector marker paths already exist' || return
  write_marker "$heartbeat" heartbeat || return
  wait_for_final_argv "$pid" "$script" || return

  ownership_initialize
  authority_bundle=$(node "$SANCTUARY_OWNERSHIP_TOOL_DIR/describe-host-authority.mjs" \
    collector "$pid" "$script" "$heartbeat" "$terminal") || return
  sleep 0.01
  confirmed_bundle=$(node "$SANCTUARY_OWNERSHIP_TOOL_DIR/describe-host-authority.mjs" \
    collector "$pid" "$script" "$heartbeat" "$terminal") || return
  [[ $authority_bundle == "$confirmed_bundle" ]] \
    || fail 'collector identity changed during registration capture' || return
  execution_authority=$(printf '%s' "$authority_bundle" | jq -c '.executionAuthority') || return
  identity=$(printf '%s' "$authority_bundle" | jq -r '.immutableIdentity') || return
  register_owned_resource collector_process obsolete exact_delete authority \
    "$pid" "$identity" --execution-authority "$execution_authority" \
    "$SANCTUARY_OPERATION_RUN_ID" || return
  printf '%s\t%s\n' "$heartbeat" "$terminal"
}

mark_terminal() {
  [[ $# == 1 && $1 == /* ]] \
    || fail 'usage: registered-collector-process.sh terminal TERMINAL_PATH' || return
  local runtime directory terminal=$1
  runtime=$(require_runtime) || return
  directory=$(marker_directory "$runtime") || return
  [[ $(dirname "$terminal") == "$directory" && $(basename "$terminal") == *.terminal.json \
      && ! -e $terminal ]] \
    || fail 'terminal marker is not a fresh path in the collector marker directory' || return
  write_marker "$terminal" terminal
}

case ${1:-} in
  register) shift; register_collector "$@" ;;
  terminal) shift; mark_terminal "$@" ;;
  *) fail 'expected register or terminal command' ;;
esac
