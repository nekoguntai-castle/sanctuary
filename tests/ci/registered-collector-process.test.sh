#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$PROJECT_ROOT"

production_files=(
  scripts/ci/run-jade-emulator-proof.sh
  scripts/ci/run-ledger-emulator-proof.sh
  scripts/ci/run-trezor-emulator-proof.sh
  scripts/ci/docker-exec-tcp-forwarder.mjs
  scripts/ci/run-browser-e2e-subject.sh
  .github/workflows/test.yml
)

if grep -En 'bounded-child-process[.]mjs|(^|[^[:alnum:]_-])kill([^[:alnum:]_]|$)|[.]kill[(]' \
  "${production_files[@]}"; then
  echo 'Registered collector callsites retain raw or bounded-child process retirement' >&2
  exit 1
fi

for proof in scripts/ci/run-{jade,ledger,trezor}-emulator-proof.sh; do
  grep -Fq 'registered-collector-process.sh" register' "$proof"
  grep -Fq 'registered-collector-process.sh" terminal' "$proof"
  grep -Fq -- '--control-token' "$proof"
  grep -Fq 'coproc SANCTUARY_FORWARDER' "$proof"
  grep -Fq -- '--import "$SCRIPT_DIR/registered-start-gate.mjs"' "$proof"
  grep -Fq 'printf '\''registered %s\n'\''' "$proof"
  grep -Fq 'finish_forwarder' "$proof"
  grep -Fq "trap 'exit 143' TERM" "$proof"
done

grep -Fq 'register_owned_resource collector_process obsolete exact_delete authority' \
  scripts/ci/registered-collector-process.sh
grep -Fq 'describe-host-authority.mjs"' scripts/ci/registered-collector-process.sh
grep -Fq 'collector "$pid" "$script" "$heartbeat" "$terminal"' \
  scripts/ci/registered-collector-process.sh
grep -Fq "'{operationRunId: \$operationRunId, state: \$state}'" \
  scripts/ci/registered-collector-process.sh

grep -Fq 'cleanup-ci-callsite.sh auto-run' .github/workflows/test.yml
grep -Fq -- '--engine host' .github/workflows/test.yml
grep -Fq -- '-- scripts/ci/run-browser-e2e-subject.sh' .github/workflows/test.yml
grep -Fq 'coproc SANCTUARY_BACKEND' scripts/ci/run-browser-e2e-subject.sh
grep -Fq -- '--import "$SCRIPT_DIR/registered-start-gate.mjs"' \
  scripts/ci/run-browser-e2e-subject.sh
grep -Fq 'registered-collector-process.sh" register' scripts/ci/run-browser-e2e-subject.sh
grep -Fq 'registered-collector-process.sh" terminal' scripts/ci/run-browser-e2e-subject.sh
grep -Fq "trap 'exit 143' TERM" scripts/ci/run-browser-e2e-subject.sh

grep -Fq 'request.headers.authorization === `Bearer ${controlToken}`' \
  scripts/ci/docker-exec-tcp-forwarder.mjs
grep -Fq 'request.method !== "POST"' scripts/ci/docker-exec-tcp-forwarder.mjs
grep -Fq 'request.url !== "/shutdown"' scripts/ci/docker-exec-tcp-forwarder.mjs

bash -n scripts/ci/registered-collector-process.sh
bash -n scripts/ci/run-browser-e2e-subject.sh
bash -n scripts/ci/run-jade-emulator-proof.sh
bash -n scripts/ci/run-ledger-emulator-proof.sh
bash -n scripts/ci/run-trezor-emulator-proof.sh
node --check scripts/ci/registered-start-gate.mjs

live_root=$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-registered-collector-test.XXXXXX")
chmod 700 "$live_root"
pid_output="$live_root/collector.pid"
process_stat_is_runnable() {
  local stat_tail=$1 state
  [[ $stat_tail == *') '* ]] || return 0
  stat_tail=${stat_tail##*) }
  state=${stat_tail%% *}
  case "$state" in
    Z|X|x) return 1 ;;
    *) return 0 ;;
  esac
}
process_is_runnable() {
  local pid=$1 process_stat
  [[ -r /proc/$pid/stat ]] || return 1
  process_stat=$(<"/proc/$pid/stat") || return 0
  process_stat_is_runnable "$process_stat"
}
process_stat_is_runnable '1 (fixture) S 0 0 0' \
  || fail 'runnable process state was classified as exited'
for dead_state in Z X x; do
  if process_stat_is_runnable "1 (fixture) $dead_state 0 0 0"; then
    fail "dead process state was classified as runnable: $dead_state"
  fi
done
emit_live_failure_evidence() {
  local upload="$live_root/artifacts/final-upload.json" receipt
  if [[ -f $upload ]]; then
    jq -c '{state, failureClasses, resourceCounts, resultCounts}' "$upload" >&2 || true
  fi
  for receipt in "$live_root"/runtime/ownership/cleanup-executions/*/cleanup-receipt.json; do
    [[ -f $receipt ]] || continue
    jq -c '{state, results: [.results[] | {sequence, resourceClass, result, failureClass}]}' \
      "$receipt" >&2 || true
  done
}
cleanup_live_test() {
  local status=$? pid
  if [[ $status -ne 0 ]]; then emit_live_failure_evidence; fi
  if [[ -s $pid_output ]]; then
    pid=$(<"$pid_output")
    if [[ $pid =~ ^[1-9][0-9]*$ ]] && process_is_runnable "$pid"; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  fi
  rm -rf -- "$live_root"
  if [[ -n ${failure_root:-} && -d $failure_root ]]; then
    rm -rf -- "$failure_root"
  fi
  if [[ -n ${cancel_root:-} && -d $cancel_root ]]; then
    rm -rf -- "$cancel_root"
  fi
  return "$status"
}
trap cleanup_live_test EXIT

SANCTUARY_LOCAL_CLEANUP_AUTHORITY=1 \
SANCTUARY_LOCAL_CLEANUP_RUN_ID="registered-collector-test-$$" \
SANCTUARY_CI_TEMP_DIR_OVERRIDE="$live_root" \
  scripts/ci/cleanup-ci-callsite.sh run \
    --lane registered-collector-live-test \
    --runtime "$live_root/runtime" \
    --artifact-dir "$live_root/artifacts" \
    --engine host \
    --checkout-root "$PROJECT_ROOT" \
    -- tests/ci/registered-collector-subject.sh "$pid_output"

collector_pid=$(<"$pid_output")
if process_is_runnable "$collector_pid"; then
  echo "Registered collector remains runnable after coordinator receipt: $collector_pid" >&2
  exit 1
fi
jq -e '.state == "cleaned" and .resourceCounts.cleaned == 1 and .resultCounts.cleaned == 1' \
  "$live_root/artifacts/final-upload.json" >/dev/null

failure_root=$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-registered-collector-failure.XXXXXX")
chmod 700 "$failure_root"
failure_pid_output="$failure_root/collector.pid"
SANCTUARY_LOCAL_CLEANUP_AUTHORITY=1 \
SANCTUARY_LOCAL_CLEANUP_RUN_ID="registered-collector-failure-$$" \
SANCTUARY_CI_TEMP_DIR_OVERRIDE="$failure_root" \
  scripts/ci/cleanup-ci-callsite.sh run \
    --lane collector-register-fail \
    --runtime "$failure_root/runtime" \
    --artifact-dir "$failure_root/artifacts" \
    --engine host \
    --checkout-root "$PROJECT_ROOT" \
    -- tests/ci/registered-collector-subject.sh "$failure_pid_output" registration-failure
failure_pid=$(<"$failure_pid_output")
if process_is_runnable "$failure_pid" || [[ -e $failure_pid_output.started ]]; then
  echo 'Registration-failure gate allowed an unregistered collector to start or survive' >&2
  exit 1
fi
jq -e '.state == "no_op" and .resourceCounts.total == 0' \
  "$failure_root/artifacts/final-upload.json" >/dev/null
rm -rf -- "$failure_root"
failure_root=''

cancel_root=$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-registered-collector-cancel.XXXXXX")
chmod 700 "$cancel_root"
cancel_pid_output="$cancel_root/collector.pid"
SANCTUARY_LOCAL_CLEANUP_AUTHORITY=1 \
SANCTUARY_LOCAL_CLEANUP_RUN_ID="registered-collector-cancel-$$" \
SANCTUARY_CI_TEMP_DIR_OVERRIDE="$cancel_root" \
  scripts/ci/cleanup-ci-callsite.sh run \
    --lane collector-register-cancel \
    --runtime "$cancel_root/runtime" \
    --artifact-dir "$cancel_root/artifacts" \
    --engine host \
    --checkout-root "$PROJECT_ROOT" \
    -- tests/ci/registered-collector-subject.sh "$cancel_pid_output" await-cancellation \
    >"$cancel_root/coordinator.log" 2>&1 &
coordinator_pid=$!
for _ in $(seq 1 200); do
  [[ -s $cancel_pid_output ]] && break
  sleep 0.01
done
[[ -s $cancel_pid_output ]]
cancel_collector_pid=$(<"$cancel_pid_output")
kill -TERM "$coordinator_pid"
cancel_status=0
wait "$coordinator_pid" || cancel_status=$?
if [[ $cancel_status -eq 0 ]] || process_is_runnable "$cancel_collector_pid" \
    || [[ -e $cancel_pid_output.started ]]; then
  echo 'Cancellation gate allowed an unregistered collector to start or survive' >&2
  exit 1
fi
jq -e '.state == "no_op" and .resourceCounts.total == 0' \
  "$cancel_root/artifacts/final-upload.json" >/dev/null
rm -rf -- "$cancel_root"
cancel_root=''

echo 'registered collector process callsite checks passed'
