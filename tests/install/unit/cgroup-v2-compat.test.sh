#!/usr/bin/env bash
#
# cgroup v2 removed memory.swappiness. There is no per-cgroup swappiness knob
# under v2 at all, so `mem_swappiness` cannot take effect on any host running it
# — which is every current Linux distribution (Debian 11+, Ubuntu 21.10+,
# Fedora 31+, RHEL 9+), including all of this project's runners.
#
# Docker silently discards the setting there, so it looked harmless for as long
# as CI ran on Docker. Podman's crun refuses it instead:
#
#   Error response from daemon: crun: cannot set memory swappiness with
#   cgroupv2: OCI runtime error
#
# That aborts the whole `compose up`, so postgres never starts and the lane dies
# on an unrelated-looking "database container failed to become healthy"
# (install-test run 8718).
#
# The setting was therefore inert on modern hosts and fatal on Podman. This
# guards against reintroducing it, and against the same class of cgroup v1-only
# knob being added elsewhere.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

PASS=0
FAILURES=()

check() {
  local description="$1"
  shift
  if "$@"; then
    PASS=$((PASS + 1))
    printf 'PASS: %s\n' "$description"
  else
    FAILURES+=("$description")
    printf 'FAIL: %s\n' "$description" >&2
  fi
}

compose_files() {
  printf '%s\n' \
    "$PROJECT_ROOT/docker-compose.yml" \
    "$PROJECT_ROOT"/docker/compose/*.yml
}

no_setting() {
  local setting="$1" f offenders=""
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    local hit
    hit="$(grep -nE "^[[:space:]]*${setting}:" "$f" || true)"
    [ -n "$hit" ] && offenders+="${f#$PROJECT_ROOT/}: $hit"$'\n'
  done < <(compose_files)
  if [ -n "$offenders" ]; then
    printf 'cgroup v1-only setting "%s" found:\n%s' "$setting" "$offenders" >&2
    return 1
  fi
  return 0
}

# memory.swappiness does not exist under cgroup v2; crun errors rather than
# ignoring it, which takes down the entire stack.
check "no compose file sets mem_swappiness" no_setting mem_swappiness

# kernelMemory was removed from the kernel in 5.4 and is rejected likewise.
check "no compose file sets kernel_memory" no_setting kernel_memory

# The limits that DO work under cgroup v2 must still be present, so this test
# cannot be satisfied by deleting resource management wholesale.
memory_limits_intact() {
  grep -qE '^[[:space:]]*memory:' "$PROJECT_ROOT/docker-compose.yml"
}
check "docker-compose.yml still sets memory limits" memory_limits_intact

printf '\n====================\n'
printf 'Passed: %d\n' "$PASS"
printf 'Failed: %d\n' "${#FAILURES[@]}"

if [ "${#FAILURES[@]}" -gt 0 ]; then
  printf 'Failing checks:\n'
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
