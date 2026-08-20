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
# Lane ports must live BELOW the kernel's ephemeral range, not merely below
# 65535. The previous scheme spanned 20000-59972, and the ephemeral range here
# is 32768-60999 with no reservations, so any run whose id ended in 320 or above
# — roughly two thirds of them — drew its listen ports from the same pool the
# kernel hands out for outbound connections. CI opens thousands of those, and a
# transient holder made `rootlessport` fail the bind. Observed twice during
# v0.8.65: run 11489 lost 39562 and run 11498 lost 39936, each having been
# assigned that exact port. Neither was lane-versus-lane contention; both lanes
# were binding a port that was correctly theirs.
PORT_RANGE_START=10240
# 128 per run, not 40: the optional-profiles upgrade fixture derives its own
# ports as HTTPS_PORT+100..+106, which under a 40-wide block reached into the
# NEXT run's block. A 128-wide block keeps a lane's whole footprint — including
# that derived range — inside the run's own reservation.
PORT_BLOCK_SIZE=128
# 10240 + 170*128 = 32000, leaving headroom under the 32768 floor below.
PORT_SLOT_COUNT=170
# How far past its own base a single lane reaches: the optional-profiles upgrade
# fixture derives HTTPS_PORT+100..+106. Measured from the lane's base, not the
# block's, so the offset is added separately below.
LANE_SPAN=106

ephemeral_floor=32768
if [ -r /proc/sys/net/ipv4/ip_local_port_range ]; then
  read -r kernel_low _ < /proc/sys/net/ipv4/ip_local_port_range || kernel_low=""
  case "$kernel_low" in
    ''|*[!0-9]*) ;;
    *) ephemeral_floor="$kernel_low" ;;
  esac
fi

offset="$1"
slot=$((10#$run_id % PORT_SLOT_COUNT))
base=$((PORT_RANGE_START + slot * PORT_BLOCK_SIZE + offset))
https_port="$base"
http_port=$((base + 1))
gateway_port=$((base + 2))

if [ $((offset + LANE_SPAN)) -ge "$PORT_BLOCK_SIZE" ]; then
  echo "install-test-ports: offset $offset plus its derived ports overflows the ${PORT_BLOCK_SIZE}-port block" >&2
  exit 1
fi

# The guard that actually matters: the lane's whole footprint has to clear the
# ephemeral floor. Checking only the gateway port would pass a configuration
# whose derived optional-profile ports land in the kernel's pool.
if [ $((base + LANE_SPAN)) -ge "$ephemeral_floor" ]; then
  echo "install-test-ports: port span $base-$((base + LANE_SPAN)) reaches the ephemeral range (floor $ephemeral_floor)" >&2
  exit 1
fi

ci_emit_env \
  "HTTPS_PORT=$https_port" \
  "HTTP_PORT=$http_port" \
  "GATEWAY_PORT=$gateway_port"

echo "Assigned install test ports: HTTPS=$https_port HTTP=$http_port GATEWAY=$gateway_port"
