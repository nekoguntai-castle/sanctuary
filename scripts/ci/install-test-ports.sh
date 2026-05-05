#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <job-port-offset>" >&2
  exit 2
fi

case "$1" in
  ''|*[!0-9]*)
    echo "install-test-ports: offset must be a non-negative integer" >&2
    exit 2
    ;;
esac

run_id="$(ci_run_id)"
case "$run_id" in
  *[!0-9]*)
    # Local fallback can include "$$-<epoch>" — keep only the trailing digits.
    run_id="${run_id##*[!0-9]}"
    [ -n "$run_id" ] || run_id=0
    ;;
esac
if [ -z "$run_id" ]; then
  run_id=0
fi
if [ "${#run_id}" -gt 3 ]; then
  run_id_suffix="${run_id: -3}"
else
  run_id_suffix="$run_id"
fi

offset="$1"
base=$((20000 + 10#$run_id_suffix * 40 + offset))
https_port="$base"
http_port=$((base + 1))
gateway_port=$((base + 2))

if [ "$gateway_port" -gt 65535 ]; then
  echo "install-test-ports: computed port exceeds 65535" >&2
  exit 1
fi

ci_emit_env \
  "HTTPS_PORT=$https_port" \
  "HTTP_PORT=$http_port" \
  "GATEWAY_PORT=$gateway_port"

echo "Assigned install test ports: HTTPS=$https_port HTTP=$http_port GATEWAY=$gateway_port"
