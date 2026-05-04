#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/retry-command.sh LABEL COMMAND [ARG...]

Runs COMMAND up to SANCTUARY_RETRY_ATTEMPTS times, sleeping an increasing
delay between attempts. Intended for idempotent CI setup/build commands that
can fail from transient runner or native toolchain crashes.
EOF
}

fail() {
  echo "retry-command: $*" >&2
  exit 1
}

main() {
  if [ "$#" -lt 2 ]; then
    usage
    fail 'expected a label and command'
  fi

  local label="$1"
  shift

  local attempts="${SANCTUARY_RETRY_ATTEMPTS:-3}"
  local delay_seconds="${SANCTUARY_RETRY_DELAY_SECONDS:-10}"

  if [[ ! "$attempts" =~ ^[1-9][0-9]*$ ]]; then
    fail 'SANCTUARY_RETRY_ATTEMPTS must be a positive integer'
  fi
  if [[ ! "$delay_seconds" =~ ^[0-9]+$ ]]; then
    fail 'SANCTUARY_RETRY_DELAY_SECONDS must be a non-negative integer'
  fi

  local attempt status
  for attempt in $(seq 1 "$attempts"); do
    echo "${label}, attempt ${attempt}"
    set +e
    "$@"
    status="$?"
    set -e

    if [ "$status" -eq 0 ]; then
      return 0
    fi
    if [ "$attempt" -eq "$attempts" ]; then
      return "$status"
    fi
    sleep $((attempt * delay_seconds))
  done
}

main "$@"
