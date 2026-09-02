#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly pid_output=${1:?PID output path is required}
readonly mode=${2:-success}
readonly fixture="$PROJECT_ROOT/tests/ci/registered-collector-fixture.mjs"
readonly gate="$PROJECT_ROOT/scripts/ci/registered-start-gate.mjs"
readonly started_output="$pid_output.started"
start_token="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"

coproc SANCTUARY_TEST_COLLECTOR {
  SANCTUARY_COLLECTOR_START_TOKEN="$start_token" \
  SANCTUARY_COLLECTOR_STARTED_PATH="$started_output" \
    exec setsid node --import "$gate" "$fixture" 2>"$pid_output.stderr"
}
collector_pid=$SANCTUARY_TEST_COLLECTOR_PID
gate_fd=${SANCTUARY_TEST_COLLECTOR[1]}
output_fd=${SANCTUARY_TEST_COLLECTOR[0]}
exec {output_fd}<&-
printf '%s\n' "$collector_pid" > "$pid_output"

if [ "$mode" = await-cancellation ]; then
  while :; do sleep 1; done
fi

if [ "$mode" = registration-failure ]; then
  if "$PROJECT_ROOT/scripts/ci/registered-collector-process.sh" register \
    "$collector_pid" "$PROJECT_ROOT/scripts/ci/registered-collector-process.sh" \
    registered-collector-failure-test; then
    echo 'Mismatched collector script unexpectedly registered' >&2
    exit 1
  fi
  exec {gate_fd}>&-
  wait "$collector_pid" >/dev/null 2>&1 || true
  [[ ! -e $started_output ]]
  grep -Fq 'closed without exact registration authorization' "$pid_output.stderr"
  exit 0
fi
[[ $mode == success ]] || { echo "Unsupported fixture mode: $mode" >&2; exit 2; }

registration=$("$PROJECT_ROOT/scripts/ci/registered-collector-process.sh" register \
  "$collector_pid" "$fixture" registered-collector-live-test)
IFS=$'\t' read -r heartbeat terminal <<< "$registration"
[[ -s $heartbeat && -n $terminal ]]
printf 'registered %s\n' "$start_token" >&"$gate_fd"
exec {gate_fd}>&-
for _ in $(seq 1 100); do
  [[ -s $started_output ]] && break
  sleep 0.01
done
[[ -s $started_output ]]
"$PROJECT_ROOT/scripts/ci/registered-collector-process.sh" terminal "$terminal"
