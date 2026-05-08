#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/retry-playwright-infrastructure-failure.sh LABEL COMMAND [ARG...]

Retries COMMAND only when Playwright fails, or reports a flaky pass, with a
native/browser infrastructure signature such as exit 139, segmentation-fault
text, or a browser target crash. Test assertion failures and ordinary
Playwright failures are not retried.
EOF
}

fail() {
  echo "retry-playwright-infrastructure-failure: $*" >&2
  exit 1
}

has_playwright_infrastructure_signature() {
  local log_file="$1"
  if grep -Eiq \
    'Segmentation fault|core dumped|browser (has )?closed unexpectedly|browser process .*exited|Target page, context or browser has been closed|Target crashed|(^|[^[:alnum:]_])EPIPE([^[:alnum:]_]|$)|ERR_IPC_CHANNEL_CLOSED' \
    "$log_file"; then
    return 0
  fi

  return 1
}

is_retryable_playwright_infrastructure_failure() {
  local status="$1"
  local log_file="$2"

  if [ "$status" -eq 139 ]; then
    return 0
  fi

  has_playwright_infrastructure_signature "$log_file"
}

main() {
  if [ "$#" -lt 2 ]; then
    usage
    fail 'expected a label and command'
  fi

  local label="$1"
  shift

  local attempts="${SANCTUARY_PLAYWRIGHT_INFRA_ATTEMPTS:-2}"
  if [[ ! "$attempts" =~ ^[1-9][0-9]*$ ]]; then
    fail 'SANCTUARY_PLAYWRIGHT_INFRA_ATTEMPTS must be a positive integer'
  fi

  local log_dir="${SANCTUARY_PLAYWRIGHT_INFRA_LOG_DIR:-.tmp/playwright-infra-retries}"
  mkdir -p "$log_dir"

  local attempt status log_file
  for attempt in $(seq 1 "$attempts"); do
    log_file="${log_dir}/${label//[^A-Za-z0-9._-]/-}-attempt-${attempt}.log"
    set +e
    "$@" 2>&1 | tee "$log_file"
    status="${PIPESTATUS[0]}"
    set -e

    if [ "$status" -eq 0 ] && ! has_playwright_infrastructure_signature "$log_file"; then
      return 0
    fi

    if [ "$status" -ne 0 ] && ! is_retryable_playwright_infrastructure_failure "$status" "$log_file"; then
      return "$status"
    fi

    if [ "$attempt" -eq "$attempts" ]; then
      if [ "$status" -eq 0 ]; then
        echo "retry-playwright-infrastructure-failure: ${label} completed with retryable Playwright infrastructure signature after ${attempts} attempt(s)" >&2
        return 1
      fi
      echo "retry-playwright-infrastructure-failure: ${label} failed with retryable Playwright infrastructure signature after ${attempts} attempt(s)" >&2
      return "$status"
    fi

    if [ "$status" -eq 0 ]; then
      echo "retry-playwright-infrastructure-failure: retrying ${label} after Playwright reported success with retryable infrastructure signature (attempt $((attempt + 1))/${attempts})" >&2
    else
      echo "retry-playwright-infrastructure-failure: retrying ${label} after retryable Playwright infrastructure failure (attempt $((attempt + 1))/${attempts})" >&2
    fi
    sleep $((attempt * 10))
  done
}

main "$@"
