#!/bin/bash
# Regression tests for re-running an exited one-shot container (backup-volume-init)
# without an attached start, which races Podman's next-exit wait.
set -euo pipefail
unset COMPOSE_PROJECT_NAME SANCTUARY_PROJECT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TEST_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP_DIR"' EXIT

# shellcheck source=tests/install/utils/helpers.sh
source "$PROJECT_ROOT/tests/install/utils/helpers.sh"
eval "$(awk '/^test_backup_volume_init_idempotent\(\)/{f=1} f{print} f&&/^}/{exit}' "$PROJECT_ROOT/tests/install/e2e/container-health.test.sh")"

TESTS_RUN=0
TESTS_FAILED=0
export SANCTUARY_ONESHOT_SETTLE_ATTEMPTS=5

make_fake() {
    mkdir -p "$TEST_TMP_DIR/bin"
    printf 'exited|0|t0|0|t0|0\n' > "$TEST_TMP_DIR/state"
    : > "$TEST_TMP_DIR/docker.log"
    cat > "$TEST_TMP_DIR/bin/docker" <<'EOF'
#!/bin/bash
state="$FAKE_STATE"
printf '%s\n' "$*" >> "$FAKE_LOG"
IFS='|' read -r status exit_code finished runs prev lag < "$state"
save() { printf '%s|%s|%s|%s|%s|%s\n' "$status" "$exit_code" "$finished" "$runs" "$prev" "$lag" > "$state"; }
case "$1" in
    ps) echo sanctuary-backup-volume-init-1 ;;
    start)
        if [ "$2" = -a ] || [ "$2" = --attach ]; then exit 124; fi
        if [ "${FAKE_START_NOOP:-0}" = 1 ]; then exit 0; fi
        prev="$finished"; runs=$((runs + 1)); finished="t$runs"; exit_code="${FAKE_RERUN_EXIT:-0}"
        lag="${FAKE_STATE_LAG:-2}"; save ;;
    wait) echo "$exit_code" ;;
    inspect)
        shown="$finished"
        if [ "$lag" -gt 0 ]; then shown="$prev"; lag=$((lag - 1)); save; fi
        out="$3"
        out="${out//\{\{.State.ExitCode\}\}/$exit_code}"
        out="${out//\{\{.State.FinishedAt\}\}/$shown}"
        out="${out//\{\{.State.Status\}\}/$status}"
        echo "$out" ;;
    logs) echo 'chown ok' ;;
    *) echo "unexpected docker $*" >&2; exit 1 ;;
esac
EOF
    chmod +x "$TEST_TMP_DIR/bin/docker"
}

with_fake() {
    make_fake
    FAKE_STATE="$TEST_TMP_DIR/state" FAKE_LOG="$TEST_TMP_DIR/docker.log" PATH="$TEST_TMP_DIR/bin:$PATH" "$@"
}

runs() { cut -d'|' -f4 "$TEST_TMP_DIR/state"; }

test_e2e_idempotency_check_survives_fast_exit() {
    with_fake test_backup_volume_init_idempotent >"$TEST_TMP_DIR/out" 2>&1 || { cat "$TEST_TMP_DIR/out" "$TEST_TMP_DIR/docker.log"; return 1; }
    [ "$(runs)" = 1 ] || return 1
    local s w
    s="$(grep -nx 'start sanctuary-backup-volume-init-1' "$TEST_TMP_DIR/docker.log" | head -n1 | cut -d: -f1)"
    w="$(grep -nx 'wait sanctuary-backup-volume-init-1' "$TEST_TMP_DIR/docker.log" | head -n1 | cut -d: -f1)"
    [ -n "$s" ] && [ -n "$w" ] && [ "$s" -lt "$w" ]
}

test_rerun_failure_is_reported() {
    if FAKE_RERUN_EXIT=3 with_fake test_backup_volume_init_idempotent >"$TEST_TMP_DIR/out" 2>&1; then return 1; fi
    grep -Fq 'exited with code 3' "$TEST_TMP_DIR/out" && grep -Fq 'chown ok' "$TEST_TMP_DIR/out" || { cat "$TEST_TMP_DIR/out"; return 1; }
}

test_stale_state_is_not_accepted_as_a_rerun() {
    local rc=0
    FAKE_START_NOOP=1 with_fake rerun_exited_oneshot_container sanctuary-backup-volume-init-1 >/dev/null 2>&1 || rc=$?
    [ "$rc" = 6 ] || { echo "rc=$rc"; return 1; }
    if FAKE_START_NOOP=1 with_fake test_backup_volume_init_idempotent >"$TEST_TMP_DIR/out" 2>&1; then return 1; fi
    grep -Fq 'step 6' "$TEST_TMP_DIR/out" && grep -Fq 'before=' "$TEST_TMP_DIR/out" || { cat "$TEST_TMP_DIR/out"; return 1; }
}

test_state_lag_converges() {
    local out
    out="$(FAKE_STATE_LAG=3 with_fake rerun_exited_oneshot_container sanctuary-backup-volume-init-1)" || return 1
    [ "$out" = 0 ]
}

test_e2e_suites_do_not_attach_to_one_shots() {
    local hits
    hits="$(grep -nE 'docker[[:space:]]+(container[[:space:]]+)?start[[:space:]]+(-[a-zA-Z]*a|--attach)' "$PROJECT_ROOT"/tests/install/e2e/*.sh "$PROJECT_ROOT"/tests/install/utils/*.sh || true)"
    if [ -n "$hits" ]; then echo "$hits"; return 1; fi
}

run_case() {
    TESTS_RUN=$((TESTS_RUN + 1))
    if ( "$2" ); then echo "PASS: $1"; else echo "FAIL: $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); fi
}

run_case "e2e idempotency check survives a fast exit" test_e2e_idempotency_check_survives_fast_exit
run_case "re-run failure is reported" test_rerun_failure_is_reported
run_case "stale state is not accepted as a re-run" test_stale_state_is_not_accepted_as_a_rerun
run_case "state lag converges" test_state_lag_converges
run_case "e2e suites do not attach to one-shots" test_e2e_suites_do_not_attach_to_one_shots
printf '%s tests, %s failures\n' "$TESTS_RUN" "$TESTS_FAILED"
[ "$TESTS_FAILED" -eq 0 ]
