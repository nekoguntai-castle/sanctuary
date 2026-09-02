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

# 144 % 150 = 144 -> 10240 + 144*144 + 15
output="$(run_case 144 15)"
assert_contains "$output" "HTTPS_PORT=30991"
assert_contains "$output" "HTTP_PORT=30992"
assert_contains "$output" "GATEWAY_PORT=30993"

output="$(run_case not-a-number 3)"
assert_contains "$output" "HTTPS_PORT=10243"
assert_contains "$output" "HTTP_PORT=10244"
assert_contains "$output" "GATEWAY_PORT=10245"

# 123 % 150 = 123 -> 10240 + 123*144 + 6
output="$(run_case 00000123 6)"
assert_contains "$output" "HTTPS_PORT=27958"
assert_contains "$output" "HTTP_PORT=27959"
assert_contains "$output" "GATEWAY_PORT=27960"

if bash "$SCRIPT" nope >/dev/null 2>&1; then
  echo "Expected non-numeric offsets to fail" >&2
  exit 1
fi

# The invariant the arithmetic exists to serve: no lane, on any run id, at any
# offset the workflows use, may touch the kernel's ephemeral range. Ports drawn
# from that pool are handed out to outbound connections, and a lane then fails
# to bind its own correctly-allocated port — observed on v0.8.65-rc1 (39562)
# and rc2 (39936).
# The offsets under test are DERIVED, never hand-listed. #853 shipped green
# because this file only ever exercised 0 3 6 9 12 15 while the extended-fixture
# lane was really running 21 24 27 30, so the guard that rejects a too-large
# offset was never hit here — it was hit on v0.8.66-rc1 instead, taking out
# three fixtures. A hardcoded list that drifts from the callers IS the bug, so
# read every caller directly.
#
# There are three caller families, and missing any one of them recreates the
# drift:
#   1. `PORT_OFFSET:` env keys in .github/workflows/*.yml   (one per lane job)
#   2. the extended upgrade fixture table                    (one per fixture)
#   3. the isolated upgrade-baseline subject, which allocates one offset
#      per baseline source ref from a base, stepping each time — so its offsets
#      depend on how many refs the selection contract yields, not on any literal
# shellcheck source=tests/install/utils/upgrade-selection.sh
. "$ROOT_DIR/tests/install/utils/upgrade-selection.sh"

workflow_offsets_in() {
  # Quotes are optional in YAML, so match PORT_OFFSET: 0 / '0' / "0" alike. A
  # pattern that only matched one spelling would silently skip a caller, which
  # is the same class of drift this derivation exists to prevent.
  grep -rhoE "^[[:space:]]*PORT_OFFSET:[[:space:]]*['\"]?[0-9]+['\"]?" "$@" \
    | grep -oE "[0-9]+"
}

workflow_offsets() {
  workflow_offsets_in "$ROOT_DIR/.github/workflows"
}

extended_fixture_offsets() {
  upgrade_active_extended_fixture_records | awk 'NF {print $2}'
}

baseline_loop_offsets() {
  local subject="$ROOT_DIR/scripts/ci/run-upgrade-baseline-isolated-subject.sh"
  local start step count i
  start="$(grep -oE 'port_offset=[0-9]+' "$subject" | head -n1 | grep -oE '[0-9]+$' || true)"
  step="$(grep -oE 'port_offset \+ [0-9]+' "$subject" | head -n1 | grep -oE '[0-9]+' || true)"
  if [ -z "$start" ] || [ -z "$step" ]; then
    echo "could not read the upgrade-baseline port loop out of its isolated subject" >&2
    return 1
  fi
  count="$(upgrade_default_baseline_refs | awk -F',' '{print NF}')"
  for ((i = 0; i < count; i++)); do
    printf '%s\n' "$((start + i * step))"
  done
}

# Each source is checked for emptiness on its own. A combined-only check passes
# while one source silently yields nothing, which is the failure mode being
# guarded against.
for source_fn in workflow_offsets extended_fixture_offsets baseline_loop_offsets; do
  if [ -z "$("$source_fn")" ]; then
    echo "offset source $source_fn yielded nothing — the derivation has drifted" >&2
    exit 1
  fi
done

mapfile -t ALL_OFFSETS < <( { workflow_offsets; extended_fixture_offsets; baseline_loop_offsets; } | sort -n )
mapfile -t REAL_OFFSETS < <( printf '%s\n' "${ALL_OFFSETS[@]}" | sort -n -u )
echo "offsets under test: ${REAL_OFFSETS[*]}"

# Two lanes IN THE SAME RUN claiming one offset would put them on the same three
# ports. Offsets repeat harmlessly ACROSS workflows — each run gets its own block
# from run_id % PORT_SLOT_COUNT — so uniqueness is checked per workflow run, not
# globally. install-test.yml's run additionally contains the baseline loop and the
# extended fixtures; release-candidate.yml's contains only its own lane jobs.
#
# This is not hypothetical: the baseline loop starts at 15 and steps 3, so a THIRD
# baseline source ref would allocate 21 — already taken by browser-origin-ip.
# Fail here rather than in a lane.
assert_unique_within() {
  local label="$1"
  shift
  local -a all unique
  mapfile -t all < <(printf '%s\n' "$@" | sort -n)
  mapfile -t unique < <(printf '%s\n' "$@" | sort -n -u)
  if [ "${#all[@]}" -ne "${#unique[@]}" ]; then
    echo "two lanes in the $label run claim the same port offset: ${all[*]}" >&2
    exit 1
  fi
}

mapfile -t INSTALL_TEST_OFFSETS < <( {
  workflow_offsets_in "$ROOT_DIR/.github/workflows/install-test.yml"
  baseline_loop_offsets
  extended_fixture_offsets
} )
assert_unique_within "install-test.yml" "${INSTALL_TEST_OFFSETS[@]}"

mapfile -t RC_OFFSETS < <(workflow_offsets_in "$ROOT_DIR/.github/workflows/release-candidate.yml")
assert_unique_within "release-candidate.yml" "${RC_OFFSETS[@]}"


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
for run_id in 0 1 149 150 151 169 170 171 999 11489 11498 123456789; do
  for offset in "${REAL_OFFSETS[@]}"; do
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
for offset in "${REAL_OFFSETS[@]}"; do
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
