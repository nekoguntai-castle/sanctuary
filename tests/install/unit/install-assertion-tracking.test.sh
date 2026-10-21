#!/usr/bin/env bash
# Unit tests for tests/install/utils/assertion-tracking.sh and its wiring.
#
# The install suites' run_test used to take only the test body's final status,
# so a failed non-final assertion printed "ASSERTION FAILED" while the test and
# the suite passed. These checks prove the shared runner catches that, keeps an
# in-body `set -e` fatal, and that every suite and assertion helper is wired to
# it.
#
# Run: ./install-assertion-tracking.test.sh [--verbose]

set -euo pipefail

for arg in "$@"; do
    case "$arg" in
        --verbose|-v) ;;
        *)
            echo "Unknown option: $arg" >&2
            exit 2
            ;;
    esac
done

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TRACKING_FILE="$PROJECT_ROOT/tests/install/utils/assertion-tracking.sh"
HELPERS_FILE="$PROJECT_ROOT/tests/install/utils/helpers.sh"

RUNNER_SUITES=(
    tests/install/unit/reset-user-2fa-script.test.sh
    tests/install/unit/upgrade-helpers.test.sh
    tests/install/unit/install-script.test.sh
    tests/install/e2e/fresh-install.test.sh
)

CHECKS_RUN=0
CHECKS_FAILED=0

pass() {
    CHECKS_RUN=$((CHECKS_RUN + 1))
    echo "  ok: $1"
}

fail() {
    CHECKS_RUN=$((CHECKS_RUN + 1))
    CHECKS_FAILED=$((CHECKS_FAILED + 1))
    echo "  FAIL: $1"
}

expect_equal() {
    local expected="$1"
    local actual="$2"
    local name="$3"

    if [ "$expected" = "$actual" ]; then
        pass "$name"
    else
        fail "$name (expected '$expected', got '$actual')"
    fi
}

fixture_non_final_failure() {
    assert_equals a b "deliberate non-final failure" >/dev/null
    true
}

fixture_pass() {
    assert_equals a a
    true
}

fixture_return_one() {
    return 1
}

# Sets ERREXIT_STATE; $- is read directly because a command substitution
# runs with errexit cleared.
read_errexit_state() {
    case $- in
        *e*) ERREXIT_STATE=on ;;
        *) ERREXIT_STATE=off ;;
    esac
}

check_runner_status() {
    local fixture="$1"
    local expect_failed="$2"
    local returned

    INSTALL_TEST_LAST_STATUS=unset
    install_test_run_function "$fixture"
    returned=$?
    expect_equal 0 "$returned" "$fixture: runner returns 0"

    if [ "$expect_failed" = true ]; then
        if [ "$INSTALL_TEST_LAST_STATUS" != unset ] && [ "$INSTALL_TEST_LAST_STATUS" -ne 0 ]; then
            pass "$fixture: INSTALL_TEST_LAST_STATUS is non-zero"
        else
            fail "$fixture: INSTALL_TEST_LAST_STATUS should be non-zero, got '$INSTALL_TEST_LAST_STATUS'"
        fi
    else
        expect_equal 0 "$INSTALL_TEST_LAST_STATUS" "$fixture: INSTALL_TEST_LAST_STATUS is 0"
    fi
}

check_errexit_restored() {
    set -e
    install_test_run_function fixture_return_one
    read_errexit_state
    expect_equal on "$ERREXIT_STATE" "errexit stays on for a set -e caller"

    set +e
    install_test_run_function fixture_pass
    read_errexit_state
    set -e
    expect_equal off "$ERREXIT_STATE" "errexit stays off for a set +e caller"
}

# The mandated plain-statement call keeps a test body's own `set -e` fatal, as
# the base run_test did. Under `install_test_run_function ... || rc=$?` bash
# would ignore errexit for the whole call tree and the child would exit 0.
check_in_body_errexit_stays_fatal() {
    local output status

    set +e
    output="$(bash -c '
        set -e
        source "$1"
        in_body_errexit() { set +e; true; set -e; false; echo continued; true; }
        install_test_run_function in_body_errexit; status="$INSTALL_TEST_LAST_STATUS"
        echo "suite continued status=$status"
    ' _ "$TRACKING_FILE" 2>&1)"
    status=$?
    set -e

    if [ "$status" -ne 0 ] && [[ "$output" != *continued* ]]; then
        pass "in-body set -e failure ends the suite non-zero"
    else
        fail "in-body set -e failure should end the suite non-zero (status $status, output: $output)"
    fi
}

run_test_body() {
    awk '/^run_test\(\)/ { inside = 1 } inside { print } inside && /^}/ { exit }' "$1"
}

check_run_test_wiring() {
    local suite="$1"
    local body calls exact
    local form='^[[:space:]]*install_test_run_function "\$test_func"; local exit_code="\$INSTALL_TEST_LAST_STATUS"$'

    body="$(run_test_body "$PROJECT_ROOT/$suite")"
    calls="$(grep -c 'install_test_run_function' <<<"$body" || true)"
    exact="$(grep -cE "$form" <<<"$body" || true)"
    if [ "$calls" = 1 ] && [ "$exact" = 1 ]; then
        pass "$suite: run_test uses the mandated runner form"
    else
        fail "$suite: run_test must call install_test_run_function exactly once in the mandated form (calls=$calls exact=$exact)"
    fi

    if grep -qE '^[[:space:]]*"?\$test_func"?([[:space:]]|$)' <<<"$body"; then
        fail "$suite: run_test still calls \$test_func directly"
    else
        pass "$suite: run_test has no direct \$test_func call"
    fi

    if grep -nE '(\|\||&&|\bif\b|!)[[:space:]]*install_test_run_function|install_test_run_function[^;]*(\|\||&&)' \
        "$PROJECT_ROOT/$suite"; then
        fail "$suite: install_test_run_function is called in a conditional context"
    else
        pass "$suite: install_test_run_function is never called in a conditional context"
    fi
}

# Prints "<definitions> <unrecorded>" for the column-0 assert_*() helpers between
# the lines matching start_pattern and end_pattern (an empty end means EOF), and
# names each helper whose body never calls the recorder.
scan_assertion_helpers() {
    local file="$1"
    local start_pattern="$2"
    local end_pattern="$3"

    awk -v start="$start_pattern" -v stop="$end_pattern" '
        $0 ~ start { active = 1 }
        stop != "" && $0 ~ stop { active = 0 }
        active && /^assert_[a-z_]+\(\)/ { in_helper = 1; name = $0; recorded = 0; defs++ }
        in_helper && /install_test_record_assertion_failure/ { recorded = 1 }
        in_helper && /^}/ {
            in_helper = 0
            if (!recorded) { print "unrecorded: " name > "/dev/stderr"; missing++ }
        }
        END { print defs + 0, missing + 0 }
    ' "$file"
}

# helpers.sh is scanned only inside its assertion block; the product checks
# assert_install_output_was_fresh and assert_installed_image_matches_checkout
# live outside it. The indented in-test stub
# assert_frontend_proxy_recovers_after_backend_recreate_inner in
# upgrade-helpers.test.sh is not column-0 and so is not counted.
check_assertion_helpers() {
    local file="$1"
    local start_pattern="$2"
    local end_pattern="$3"
    local expected_defs="$4"
    local result

    result="$(scan_assertion_helpers "$PROJECT_ROOT/$file" "$start_pattern" "$end_pattern")"
    expect_equal "$expected_defs 0" "$result" "$file: $expected_defs assertion helpers, all record failures"
}

check_sources_tracking() {
    local file="$1"

    if grep -qE '^[[:space:]]*(source|\.) .*assertion-tracking\.sh"?$' "$PROJECT_ROOT/$file"; then
        pass "$file sources assertion-tracking.sh"
    else
        fail "$file should source assertion-tracking.sh"
    fi
}

main() {
    echo ""
    echo "Install Assertion Tracking Unit Tests"
    echo "====================================="

    if [ ! -f "$TRACKING_FILE" ]; then
        fail "tests/install/utils/assertion-tracking.sh exists"
    else
        # shellcheck source=tests/install/utils/assertion-tracking.sh
        source "$TRACKING_FILE"
        # shellcheck source=tests/install/utils/helpers.sh
        source "$HELPERS_FILE"

        check_runner_status fixture_non_final_failure true
        check_runner_status fixture_pass false
        check_runner_status fixture_return_one true
        check_errexit_restored
        check_in_body_errexit_stays_fatal
    fi

    local suite
    for suite in "${RUNNER_SUITES[@]}"; do
        check_run_test_wiring "$suite"
    done

    check_sources_tracking tests/install/utils/helpers.sh
    check_sources_tracking tests/install/unit/reset-user-2fa-script.test.sh
    check_sources_tracking tests/install/unit/install-script.test.sh

    check_assertion_helpers tests/install/utils/helpers.sh \
        '^# Test Assertion Functions' '^# Test Environment Setup' 8
    check_assertion_helpers tests/install/unit/reset-user-2fa-script.test.sh '.' '' 4
    check_assertion_helpers tests/install/unit/upgrade-helpers.test.sh '.' '' 3
    check_assertion_helpers tests/install/unit/install-script.test.sh '.' '' 8

    echo ""
    echo "Checks: $CHECKS_RUN  Failed: $CHECKS_FAILED"
    [ "$CHECKS_FAILED" -eq 0 ]
}

main
