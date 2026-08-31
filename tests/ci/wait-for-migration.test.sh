#!/usr/bin/env bash
# Regression: the migration wait must be able to observe a one-shot container
# that has already exited.
#
# The original lookup ran `docker compose ps migrate` without `--all`. Compose
# lists only running containers, and migrate exits as soon as it finishes, so
# the loop waited for a state it could never see: every attempt reported
# `not_found`, all 60 attempts burned (300s), and the lane continued anyway.
#
# The expensive part was not the time. Because the loop could not distinguish
# "exited cleanly" from "never observed", the branch that reports a FAILED
# migration and dumps its logs was unreachable -- a broken migration and a
# successful one produced identical output. These tests pin both halves.
#
# docker is stubbed, so this needs no daemon and runs in the normal CI lane.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/ci/wait-for-migration.sh"

PASS=0
FAIL=0
FAILURES=()
ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); echo "FAIL: $1" >&2; }

bash -n "$SCRIPT" || bad 'wait-for-migration.sh does not parse'
if grep -q 'ownership_initialize_build_identity' "$SCRIPT"; then
  ok 'standalone migration wait initializes strict Compose identity when the checkout supports it'
else
  bad 'standalone migration wait does not initialize strict Compose identity'
fi

# Build a fake `docker` whose `compose ps` answers from a fixture file, and which
# records every argv it was called with.
make_stub() {
  local dir="$1" ps_output="$2" backend_rc="${3:-0}"
  mkdir -p "$dir/bin"
  printf '%s\n' "$ps_output" > "$dir/ps-output"
  printf '%s\n' "$backend_rc" > "$dir/backend-rc"
  cat > "$dir/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_DIR/argv.log"
case "$*" in
  *"compose ps"*)
    # Model real compose: without --all it lists only RUNNING containers, so an
    # exited one-shot is invisible. Without this fidelity the behavioural test
    # below passes whether or not the fix is present -- which is exactly how the
    # original defect survived review.
    case "$*" in
      *migrate*)
        if grep -q '^Exited' "$STUB_DIR/ps-output" && [[ "$*" != *--all* ]]; then
          : # invisible, as the real thing would be
        else
          cat "$STUB_DIR/ps-output"
        fi
        ;;
      *) : ;;
    esac
    ;;
  *"compose logs"*) echo "(stub migrate logs)" ;;
  *"compose exec"*) exit "$(cat "$STUB_DIR/backend-rc")" ;;
esac
exit 0
STUB
  chmod +x "$dir/bin/docker"
}

run_wait() {
  local dir="$1"
  ( export STUB_DIR="$dir" PATH="$dir/bin:$PATH" \
           SANCTUARY_MIGRATION_ATTEMPTS=3 SANCTUARY_MIGRATION_INTERVAL=0 \
           SANCTUARY_BACKEND_ATTEMPTS=2 SANCTUARY_BACKEND_INTERVAL=0
    bash "$SCRIPT" "$dir" 2>&1 )
}

# ----- 1. an already-exited migrate is observed ------------------------------
# The regression. Without --all the stub's `compose ps` would be asked without
# it and this would report not_found until the attempts ran out.
d="$(mktemp -d)"
make_stub "$d" 'Exited (0) 3 seconds ago'
out="$(run_wait "$d")"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'Migration completed successfully'; then
  ok 'an already-exited migrate is seen as complete'
else
  bad "exited migrate not recognised (rc=$rc): $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-140)"
fi

# ----- 2. the lookup actually passes --all -----------------------------------
# Guards the specific flag, so a future edit cannot quietly drop it and leave
# the loop passing for the wrong reason on a fast-exiting fixture.
# Must be --all on the *migrate lookup* specifically. Matching --all anywhere in
# the log is not enough: the failure path dumps `docker compose ps --all`, so a
# broken lookup would satisfy a looser grep via its own error handling.
if grep -E 'compose ps .*--all.* migrate|compose ps .*migrate.*--all' "$d/argv.log" >/dev/null 2>&1; then
  ok 'the migrate lookup itself passes --all'
else
  bad "migrate lookup has no --all: $(tr '\n' '|' < "$d/argv.log" | cut -c1-140)"
fi
rm -rf "$d"

# ----- 3. a failed migration is reported, not silently passed ----------------
# This branch was unreachable before the fix.
d="$(mktemp -d)"
make_stub "$d" 'Exited (1) 2 seconds ago'
out="$(run_wait "$d")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'Migration failed'; then
  ok 'a non-zero migration exit fails the wait and names itself'
else
  bad "failed migration not reported (rc=$rc): $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-140)"
fi
if printf '%s' "$out" | grep -q 'stub migrate logs'; then
  ok 'a failed migration dumps the container logs'
else
  bad 'failed migration did not dump logs'
fi
rm -rf "$d"

# ----- 4. a migrate that never appears is a failure, not a fall-through ------
# The old loop could not tell this apart from success and continued regardless.
d="$(mktemp -d)"
make_stub "$d" ''
out="$(run_wait "$d")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'never reached Exited'; then
  ok 'a migrate that never appears fails the wait'
else
  bad "absent migrate did not fail (rc=$rc): $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-140)"
fi
rm -rf "$d"

# ----- 5. backend readiness stays advisory ----------------------------------
# Unchanged on purpose: if the backend never answers, the lane's own test runs
# next and reports it with better context. Pinned so the behaviour is not
# altered by accident.
d="$(mktemp -d)"
make_stub "$d" 'Exited (0) 1 second ago' 1
out="$(run_wait "$d")"; rc=$?
if [ "$rc" -eq 0 ]; then
  ok 'an unreachable backend does not fail phase 2 (left to the lane test)'
else
  bad "backend timeout wrongly failed the wait (rc=$rc)"
fi
rm -rf "$d"

echo
echo "===================="
echo "Total:  $((PASS + FAIL))"
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Failures:" >&2
  for f in "${FAILURES[@]}"; do echo "  - $f" >&2; done
  exit 1
fi
