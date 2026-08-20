#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/install-test-ports.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

run_case() {
  local run_id="$1"
  local offset="$2"
  local output_file="$tmp_dir/env-$run_id-$offset"

  GITHUB_RUN_ID="$run_id" GITHUB_ENV="$output_file" bash "$SCRIPT" "$offset" >/dev/null
  cat "$output_file"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "Expected output to contain: $needle" >&2
    echo "$haystack" >&2
    exit 1
  fi
}

# 144 % 170 = 144 -> 10240 + 144*128 + 15
output="$(run_case 144 15)"
assert_contains "$output" "HTTPS_PORT=28687"
assert_contains "$output" "HTTP_PORT=28688"
assert_contains "$output" "GATEWAY_PORT=28689"

output="$(run_case not-a-number 3)"
assert_contains "$output" "HTTPS_PORT=10243"
assert_contains "$output" "HTTP_PORT=10244"
assert_contains "$output" "GATEWAY_PORT=10245"

# 123 % 170 = 123 -> 10240 + 123*128 + 6
output="$(run_case 00000123 6)"
assert_contains "$output" "HTTPS_PORT=25990"
assert_contains "$output" "HTTP_PORT=25991"
assert_contains "$output" "GATEWAY_PORT=25992"

if bash "$SCRIPT" nope >/dev/null 2>&1; then
  echo "Expected non-numeric offsets to fail" >&2
  exit 1
fi

# The invariant the arithmetic exists to serve: no lane, on any run id, at any
# offset the workflows use, may touch the kernel's ephemeral range. Ports drawn
# from that pool are handed out to outbound connections, and a lane then fails
# to bind its own correctly-allocated port — observed on v0.8.65-rc1 (39562)
# and rc2 (39936).
ephemeral_floor=32768
if [ -r /proc/sys/net/ipv4/ip_local_port_range ]; then
  read -r kernel_low _ < /proc/sys/net/ipv4/ip_local_port_range
  case "$kernel_low" in
    ''|*[!0-9]*) ;;
    *) ephemeral_floor="$kernel_low" ;;
  esac
fi
# +106 is the optional-profiles fixture's derivation from HTTPS_PORT.
derived_span=106
for run_id in 0 1 169 170 171 999 11489 11498 123456789; do
  for offset in 0 3 6 9 12 15; do
    ports="$(run_case "$run_id" "$offset")"
    highest=$(( $(sed -n 's/.*GATEWAY_PORT=\([0-9]*\).*/\1/p' <<< "$ports") + derived_span ))
    if [ "$highest" -ge "$ephemeral_floor" ]; then
      echo "run $run_id offset $offset reaches $highest, at or above the ephemeral floor $ephemeral_floor" >&2
      exit 1
    fi
  done
done

# Concurrent lanes must not share a port. Each lane takes three, so the offsets
# the workflows use have to be at least three apart.
declare -A claimed=()
for offset in 0 3 6 9 12 15; do
  ports="$(run_case 4242 "$offset")"
  while read -r port; do
    [ -n "$port" ] || continue
    if [ -n "${claimed[$port]:-}" ]; then
      echo "offset $offset collides with offset ${claimed[$port]} on port $port" >&2
      exit 1
    fi
    claimed[$port]="$offset"
  done < <(sed -n 's/.*PORT=\([0-9]*\).*/\1/p' <<< "$ports")
done

echo "install-test-ports regression checks passed"
