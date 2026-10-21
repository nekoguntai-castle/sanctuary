#!/bin/bash
# ============================================
# Install test assertion tracking
# ============================================
#
# Assertion helpers only `return 1` on failure, and a test body's exit status
# is that of its last statement, so a failed non-final assertion used to be
# swallowed. Every assertion helper's failure branch calls
# install_test_record_assertion_failure, and run_test calls
# install_test_run_function, which fails the test when the body returned
# non-zero or recorded an assertion failure.
#
# Call it as a plain statement (never inside ||, &&, if or !):
#
#   install_test_run_function "$test_func"; local exit_code="$INSTALL_TEST_LAST_STATUS"
#
# bash ignores errexit for the whole call tree of a command in a conditional
# context, which would swallow a failure after a test body's own `set -e`.
#
# An assertion inside a ( ... ) or $( ... ) subshell cannot reach this
# counter; the subshell's exit status must carry the failure instead.
#
# Usage: source ./utils/assertion-tracking.sh
# ============================================

# Not reset on re-source: helpers.sh and a suite may both source this file.
: "${INSTALL_TEST_ASSERTION_FAILURES:=0}"
INSTALL_TEST_LAST_STATUS="${INSTALL_TEST_LAST_STATUS:-0}"

install_test_record_assertion_failure() {
    INSTALL_TEST_ASSERTION_FAILURES=$((INSTALL_TEST_ASSERTION_FAILURES + 1))
}

# Runs one test function with errexit off (as the suites' run_test always
# did), sets INSTALL_TEST_LAST_STATUS, restores the caller's errexit state and
# always returns 0 so a failing test never aborts the suite.
install_test_run_function() {
    local test_function="$1"
    local failures_before="$INSTALL_TEST_ASSERTION_FAILURES"
    local caller_errexit=false
    local status

    case $- in
        *e*) caller_errexit=true ;;
    esac

    set +e
    "$test_function"
    status=$?

    if [ "$status" -ne 0 ]; then
        INSTALL_TEST_LAST_STATUS="$status"
    elif [ "$INSTALL_TEST_ASSERTION_FAILURES" -gt "$failures_before" ]; then
        INSTALL_TEST_LAST_STATUS=1
    else
        INSTALL_TEST_LAST_STATUS=0
    fi

    if [ "$caller_errexit" = true ]; then
        set -e
    else
        set +e
    fi
    return 0
}
