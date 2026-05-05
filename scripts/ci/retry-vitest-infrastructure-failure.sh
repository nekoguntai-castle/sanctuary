#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/retry-vitest-infrastructure-failure.sh LABEL COMMAND [ARG...]

Retries COMMAND only when Vitest fails with a native/worker infrastructure
signature such as exit 139, EPIPE, closed IPC channels, or segmentation-fault
text. Assertion failures and coverage-threshold failures are not retried.
EOF
}

fail() {
  echo "retry-vitest-infrastructure-failure: $*" >&2
  exit 1
}

is_retryable_vitest_infrastructure_failure() {
  local status="$1"
  local log_file="$2"

  if [ "$status" -eq 139 ]; then
    return 0
  fi

  if grep -Eiq \
    '(^|[^[:alnum:]_])EPIPE([^[:alnum:]_]|$)|ERR_IPC_CHANNEL_CLOSED|IPC channel|channel closed|worker (exited unexpectedly|terminated|died)|Failed to terminate worker|Segmentation fault|core dumped' \
    "$log_file"; then
    return 0
  fi

  return 1
}

main() {
  if [ "$#" -lt 2 ]; then
    usage
    fail 'expected a label and command'
  fi

  local label="$1"
  shift

  local attempts="${SANCTUARY_VITEST_INFRA_ATTEMPTS:-3}"
  if [[ ! "$attempts" =~ ^[1-9][0-9]*$ ]]; then
    fail 'SANCTUARY_VITEST_INFRA_ATTEMPTS must be a positive integer'
  fi

  local log_dir="${SANCTUARY_VITEST_INFRA_LOG_DIR:-.tmp/vitest-infra-retries}"
  mkdir -p "$log_dir"

  local attempt status log_file
  for attempt in $(seq 1 "$attempts"); do
    log_file="${log_dir}/${label//[^A-Za-z0-9._-]/-}-attempt-${attempt}.log"
    set +e
    "$@" 2>&1 | tee "$log_file"
    status="${PIPESTATUS[0]}"
    set -e

    if [ "$status" -eq 0 ]; then
      return 0
    fi

    if ! is_retryable_vitest_infrastructure_failure "$status" "$log_file"; then
      return "$status"
    fi

    if [ "$attempt" -eq "$attempts" ]; then
      echo "retry-vitest-infrastructure-failure: ${label} failed with retryable Vitest infrastructure signature after ${attempts} attempt(s)" >&2
      return "$status"
    fi

    echo "retry-vitest-infrastructure-failure: retrying ${label} after retryable Vitest infrastructure failure (attempt $((attempt + 1))/${attempts})" >&2
    sleep $((attempt * 10))
  done
}

main "$@"
