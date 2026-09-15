#!/usr/bin/env bash
# Regression: the supervised Compose e2e subject must actually observe the
# migrate container's outcome instead of a fixed timeout-then-sleep that
# proceeds regardless of it.
#
# Before the fix, the migration wait was an inline
#   timeout 120 bash -c 'until docker compose ps migrate ... | grep -q Exited; do sleep 5; done' || true
#   sleep 30
# `docker compose ps` (no --all) never sees an exited one-shot container, so
# the `until` loop always burned its full 120s budget, the `|| true` swallowed
# that timeout, and a fixed `sleep 30` ran regardless -- roughly 150s spent
# proceeding no matter what the migrate container reported, including a
# non-zero exit.
#
# scripts/ci/wait-for-migration.sh already implements the correct `ps --all`
# wait (see tests/ci/wait-for-migration.test.sh); this test proves
# run-compose-e2e-subject.sh actually delegates to it: a failed migration
# fails the subject before it ever reaches health checks, and a successful
# migration proceeds without the old fixed delay.
#
# docker is stubbed, so this needs no daemon and runs in the normal CI lane.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SUBJECT="$REPO_ROOT/scripts/ci/run-compose-e2e-subject.sh"

PASS=0
FAIL=0
FAILURES=()
ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); echo "FAIL: $1" >&2; }

bash -n "$SUBJECT" || bad 'run-compose-e2e-subject.sh does not parse'

if grep -q 'wait-for-migration.sh' "$SUBJECT"; then
  ok 'the subject delegates migration waiting to wait-for-migration.sh'
else
  bad 'the subject does not delegate to wait-for-migration.sh'
fi
if grep -qE '^\s*sleep 30\s*$' "$SUBJECT"; then
  bad 'the fixed 30s post-timeout sleep is still present'
else
  ok 'the fixed 30s post-timeout sleep was removed'
fi
if grep -q "ps migrate --format" "$SUBJECT"; then
  bad 'the subject still runs a bare (no --all) migrate ps lookup'
else
  ok 'the subject no longer runs its own bare migrate ps lookup'
fi

# ----- fixture: a minimal fake workspace the subject can run against --------
#
# The real script builds real Compose stacks and registers real ownership
# resources; none of that is needed to prove migration-wait delegation, so the
# fixture stubs those collaborators directly rather than the (heavy, jq- and
# label-dependent) real ones. `wait-for-migration.sh` conditionally sources
# scripts/ownership/producer-hooks.sh only `if [ -f ... ]`, so omitting that
# file from the fixture workspace is itself sufficient to keep it out of scope
# here.
make_workspace() {
  local ws="$1"
  mkdir -p "$ws/tests/install/utils" "$ws/tests/install/e2e" "$ws/docker/nginx/ssl"
  cat > "$ws/tests/install/utils/helpers.sh" <<'HELPERS'
initialize_install_test_ownership() { return 0; }
export_lane_image_tag() { return 0; }
default_install_test_root() { printf '%s\n' "${1:-.}/it-root"; }
docker_visible_path() { printf '%s\n' "$1"; }
register_ci_compose_resources() { return 0; }
HELPERS
  cat > "$ws/docker/nginx/ssl/generate-certs.sh" <<'CERTS'
#!/usr/bin/env bash
mkdir -p "${SANCTUARY_SSL_DIR:-.}"
CERTS
  chmod +x "$ws/docker/nginx/ssl/generate-certs.sh"
  cat > "$ws/tests/install/e2e/container-health.test.sh" <<HEALTH
#!/usr/bin/env bash
: > "$ws/health-ran"
HEALTH
  chmod +x "$ws/tests/install/e2e/container-health.test.sh"
}

# Fake `docker`: same fidelity as tests/ci/wait-for-migration.test.sh's stub
# (an exited one-shot is invisible to `compose ps` without --all), extended
# for the other invocations run-compose-e2e-subject.sh itself makes.
make_docker_stub() {
  local dir="$1" ps_output="$2"
  mkdir -p "$dir/bin"
  printf '%s\n' "$ps_output" > "$dir/ps-output"
  cat > "$dir/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${STUB_DIR:?}/argv.log"
case "$*" in
  *"compose ps"*)
    case "$*" in
      *migrate*)
        if grep -q '^Exited' "$STUB_DIR/ps-output" && [[ "$*" != *--all* ]]; then
          : # invisible without --all, as real compose would be
        else
          cat "$STUB_DIR/ps-output"
        fi
        ;;
      *) : ;;
    esac
    ;;
  *"compose logs"*) echo "(stub logs)" ;;
  *"compose exec"*) exit 1 ;; # backend health stays advisory either way
  *"compose up"*) exit 0 ;;
esac
exit 0
STUB
  chmod +x "$dir/bin/docker"
}

run_subject() {
  local ws="$1" mode="${2:-container-health}"
  ( export STUB_DIR="$ws" PATH="$ws/bin:$PATH" \
           SANCTUARY_CLEANUP_COORDINATED=1 SANCTUARY_OWNERSHIP_ROOT="$ws" \
           HTTPS_PORT=8443 HTTP_PORT=8080 COMPOSE_PROJECT_NAME=subject-test \
           SANCTUARY_MIGRATION_ATTEMPTS=3 SANCTUARY_MIGRATION_INTERVAL=0 \
           SANCTUARY_BACKEND_ATTEMPTS=1 SANCTUARY_BACKEND_INTERVAL=0
    bash "$SUBJECT" --workspace "$ws" --mode "$mode" --run-health false --run-auth false 2>&1 )
}

# ----- 1. a migration that exits non-zero fails the subject before health ---
d="$(mktemp -d)"
make_workspace "$d"
make_docker_stub "$d" 'Exited (1) 2 seconds ago'
: > "$d/argv.log"
start="$(date +%s)"
out="$(run_subject "$d")"; rc=$?
elapsed="$(( $(date +%s) - start ))"
if [ "$rc" -ne 0 ]; then
  ok 'a non-zero migration exit fails the subject'
else
  bad "a non-zero migration exit did not fail the subject (rc=$rc)"
fi
if [ ! -e "$d/health-ran" ]; then
  ok 'the subject never reaches the health check after a failed migration'
else
  bad 'the subject ran the health check despite a failed migration'
fi
if [ "$elapsed" -lt 60 ]; then
  ok "a failed migration is reported without the old ~150s timeout-then-sleep (${elapsed}s)"
else
  bad "a failed migration still took the old fixed delay (${elapsed}s): $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
fi
if printf '%s' "$out" | grep -q 'Migration failed'; then
  ok 'the failure names itself as a migration failure'
else
  bad "the failure output does not name the migration: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
fi
rm -rf "$d"

# ----- 2. a migration that exits zero proceeds without the fixed sleep ------
d="$(mktemp -d)"
make_workspace "$d"
make_docker_stub "$d" 'Exited (0) 1 second ago'
start="$(date +%s)"
out="$(run_subject "$d")"; rc=$?
elapsed="$(( $(date +%s) - start ))"
if [ "$rc" -eq 0 ]; then
  ok 'a successful migration lets the subject succeed'
else
  bad "a successful migration still failed the subject (rc=$rc): $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
fi
if [ -e "$d/health-ran" ]; then
  ok 'the subject reaches the health check after a successful migration'
else
  bad 'the subject never reached the health check after a successful migration'
fi
if [ "$elapsed" -lt 20 ]; then
  ok "a successful migration proceeds without the old fixed 30s sleep (${elapsed}s)"
else
  bad "a successful migration still paid the old fixed delay (${elapsed}s)"
fi
if grep -qE 'compose ps .*--all.* migrate|compose ps .*migrate.*--all' "$d/argv.log"; then
  ok 'the migrate lookup itself passes --all'
else
  bad "migrate lookup has no --all: $(tr '\n' '|' < "$d/argv.log" | cut -c1-140)"
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
