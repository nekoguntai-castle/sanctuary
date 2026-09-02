#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
cd "$PROJECT_ROOT"

[[ ${SANCTUARY_CLEANUP_COORDINATED:-0} == 1 ]] || {
  echo 'Browser E2E subject requires the signed cleanup coordinator' >&2
  exit 1
}

readonly api_port="${BROWSER_E2E_API_PORT:?}"
readonly backend_script="$PROJECT_ROOT/server/dist/server/src/index.js"
readonly backend_log="$PROJECT_ROOT/.tmp/browser-e2e-backend.log"
backend_pid=0
backend_terminal=''
backend_gate_fd=''

mark_backend_terminal() {
  local subject_status=$? marker_status=0
  trap - EXIT
  if [ -n "$backend_gate_fd" ]; then
    exec {backend_gate_fd}>&-
    backend_gate_fd=''
    wait "$backend_pid" >/dev/null 2>&1 || true
    backend_pid=0
  fi
  if [ "$backend_pid" -ne 0 ] && [ -n "$backend_terminal" ]; then
    "$SCRIPT_DIR/registered-collector-process.sh" terminal "$backend_terminal" \
      || marker_status=$?
  fi
  if [ "$subject_status" -eq 0 ] && [ "$marker_status" -ne 0 ]; then
    subject_status=$marker_status
  fi
  exit "$subject_status"
}
trap mark_backend_terminal EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

mkdir -p "$(dirname "$backend_log")"
backend_start_token="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
coproc SANCTUARY_BACKEND {
  PORT="$api_port" SANCTUARY_COLLECTOR_START_TOKEN="$backend_start_token" \
    exec setsid node --import "$SCRIPT_DIR/registered-start-gate.mjs" \
      "$backend_script" >"$backend_log" 2>&1
}
backend_pid=$SANCTUARY_BACKEND_PID
backend_gate_fd=${SANCTUARY_BACKEND[1]}
backend_output_fd=${SANCTUARY_BACKEND[0]}
exec {backend_output_fd}<&-
registration=$("$SCRIPT_DIR/registered-collector-process.sh" register \
  "$backend_pid" "$backend_script" browser-e2e-backend)
IFS=$'\t' read -r _ backend_terminal <<< "$registration"
[[ -n $backend_terminal ]]
printf 'registered %s\n' "$backend_start_token" >&"$backend_gate_fd"
exec {backend_gate_fd}>&-
backend_gate_fd=''

echo 'Waiting for backend server...'
for attempt in $(seq 1 60); do
  if curl -s "http://localhost:${api_port}/health" >/dev/null 2>&1; then
    echo 'Backend is ready!'
    break
  fi
  if ! jobs -pr | grep -Fxq "$backend_pid"; then
    echo 'Backend process exited before becoming ready' >&2
    tail -200 "$backend_log" || true
    exit 1
  fi
  if [ "$attempt" -eq 60 ]; then
    echo 'Backend failed to start' >&2
    tail -200 "$backend_log" || true
    exit 1
  fi
  echo "Attempt $attempt: Backend not ready yet..."
  sleep 2
done

while IFS= read -r browser_group; do
  echo "::group::Browser E2E ${browser_group}"
  mapfile -t browser_specs < <("$SCRIPT_DIR/browser-e2e-groups.sh" "$browser_group")
  if [ "${#browser_specs[@]}" -eq 0 ]; then
    echo "No browser-flow E2E specs found for ${browser_group}."
    echo '::endgroup::'
    continue
  fi

  printf 'Running browser-flow E2E group %s:\n' "$browser_group"
  printf '  %s\n' "${browser_specs[@]}"
  VITE_API_URL="${BROWSER_E2E_API_URL:?}" \
    "$SCRIPT_DIR/retry-playwright-infrastructure-failure.sh" "browser-flow E2E ${browser_group}" \
      "$SCRIPT_DIR/time-command.sh" "browser-flow E2E ${browser_group}" \
      npm run test:e2e -- --project=chromium "${browser_specs[@]}"
  echo '::endgroup::'
done < <("$SCRIPT_DIR/browser-e2e-groups.sh" --groups)
