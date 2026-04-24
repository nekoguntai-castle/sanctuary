#!/bin/bash
# ============================================
# Run All Install Tests
# ============================================
#
# This script runs all install-related tests in sequence.
#
# Usage:
#   ./run-all-tests.sh [options]
#
# Options:
#   --unit-only        Run only unit tests
#   --e2e-only         Run only E2E tests
#   --skip-cleanup     Keep containers after tests
#   --verbose          Show detailed output
#   --fast             Skip slow tests
#   --upgrade-source-ref <ref>  Older tag/ref or named lane (latest-stable, n-1, n-2)
#   --upgrade-fixture <name>    Upgrade fixture to apply during the upgrade lane
#   --upgrade-mode <mode>       Upgrade lane mode (core or full)
#   --https-port <port>         Override the HTTPS port used by install E2E tests
#   --http-port <port>          Override the HTTP port used by install E2E tests
#   --gateway-port <port>       Override the gateway port used by install E2E tests
#
# ============================================

set -e

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source helpers
source "$SCRIPT_DIR/utils/helpers.sh"

# ============================================
# Configuration
# ============================================

RUN_UNIT=true
RUN_E2E=true
SKIP_CLEANUP=false
VERBOSE=""
FAST_MODE=false
UPGRADE_SOURCE_REF=""
UPGRADE_FIXTURE=""
UPGRADE_MODE=""
HTTPS_PORT_OVERRIDE=""
HTTP_PORT_OVERRIDE=""
GATEWAY_PORT_OVERRIDE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --unit-only)
            RUN_E2E=false
            shift
            ;;
        --e2e-only)
            RUN_UNIT=false
            shift
            ;;
        --skip-cleanup)
            SKIP_CLEANUP=true
            shift
            ;;
        --verbose|-v)
            VERBOSE="--verbose"
            export DEBUG=true
            shift
            ;;
        --fast)
            FAST_MODE=true
            shift
            ;;
        --upgrade-source-ref)
            UPGRADE_SOURCE_REF="$2"
            shift 2
            ;;
        --upgrade-source-ref=*)
            UPGRADE_SOURCE_REF="${1#*=}"
            shift
            ;;
        --upgrade-fixture)
            UPGRADE_FIXTURE="$2"
            shift 2
            ;;
        --upgrade-fixture=*)
            UPGRADE_FIXTURE="${1#*=}"
            shift
            ;;
        --upgrade-mode)
            UPGRADE_MODE="$2"
            shift 2
            ;;
        --upgrade-mode=*)
            UPGRADE_MODE="${1#*=}"
            shift
            ;;
        --https-port)
            HTTPS_PORT_OVERRIDE="$2"
            shift 2
            ;;
        --https-port=*)
            HTTPS_PORT_OVERRIDE="${1#*=}"
            shift
            ;;
        --http-port)
            HTTP_PORT_OVERRIDE="$2"
            shift 2
            ;;
        --http-port=*)
            HTTP_PORT_OVERRIDE="${1#*=}"
            shift
            ;;
        --gateway-port)
            GATEWAY_PORT_OVERRIDE="$2"
            shift 2
            ;;
        --gateway-port=*)
            GATEWAY_PORT_OVERRIDE="${1#*=}"
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --unit-only      Run only unit tests"
            echo "  --e2e-only       Run only E2E tests"
            echo "  --skip-cleanup   Keep containers after tests"
            echo "  --verbose        Show detailed output"
            echo "  --fast           Skip slow tests (upgrade)"
            echo "  --upgrade-source-ref <ref>  Older tag/ref or named lane (latest-stable, n-1, n-2)"
            echo "  --upgrade-fixture <name>    Upgrade fixture to apply during the upgrade lane"
            echo "  --upgrade-mode <mode>       Upgrade lane mode (core or full)"
            echo "  --https-port <port>         Override the HTTPS port used by install E2E tests"
            echo "  --http-port <port>          Override the HTTP port used by install E2E tests"
            echo "  --gateway-port <port>       Override the gateway port used by install E2E tests"
            echo "  --help           Show this help"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

for port_name in HTTPS_PORT_OVERRIDE HTTP_PORT_OVERRIDE GATEWAY_PORT_OVERRIDE; do
    port_value="${!port_name}"
    if [ -n "$port_value" ] && [[ ! "$port_value" =~ ^[0-9]+$ ]]; then
        log_error "Invalid ${port_name}: $port_value"
        exit 1
    fi
done

# Track results
TOTAL_SUITES=0
PASSED_SUITES=0
FAILED_SUITES=0
declare -a SUITE_RESULTS

# ============================================
# Test Runner
# ============================================

run_test_suite() {
    local name="$1"
    local script="$2"
    local extra_args="${3:-}"

    TOTAL_SUITES=$((TOTAL_SUITES + 1))

    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Running: $name${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""

    set +e
    $script $VERBOSE $extra_args
    local exit_code=$?
    set -e

    if [ $exit_code -eq 0 ]; then
        PASSED_SUITES=$((PASSED_SUITES + 1))
        SUITE_RESULTS+=("PASS: $name")
        log_success "$name completed successfully"
    else
        FAILED_SUITES=$((FAILED_SUITES + 1))
        SUITE_RESULTS+=("FAIL: $name")
        log_error "$name failed"
    fi

    return $exit_code
}

# ============================================
# Main
# ============================================

main() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Sanctuary Install Test Suite${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
    echo "Configuration:"
    echo "  Run Unit Tests:  $RUN_UNIT"
    echo "  Run E2E Tests:   $RUN_E2E"
    echo "  Skip Cleanup:    $SKIP_CLEANUP"
    echo "  Fast Mode:       $FAST_MODE"
    echo "  Upgrade Source:  ${UPGRADE_SOURCE_REF:-auto}"
    echo "  Upgrade Fixture: ${UPGRADE_FIXTURE:-default}"
    echo "  Upgrade Mode:    ${UPGRADE_MODE:-default}"
    echo "  HTTPS Port:      ${HTTPS_PORT_OVERRIDE:-default}"
    echo "  HTTP Port:       ${HTTP_PORT_OVERRIDE:-default}"
    echo "  Gateway Port:    ${GATEWAY_PORT_OVERRIDE:-default}"
    echo ""

    # Check prerequisites
    if ! check_docker_available; then
        log_error "Docker is not available"
        exit 1
    fi

    local start_time=$(date +%s)
    local failed=false

    # Unit tests
    if [ "$RUN_UNIT" = "true" ]; then
        if ! run_test_suite "Unit Tests" "$SCRIPT_DIR/unit/install-script.test.sh"; then
            failed=true
        fi
    fi

    # E2E tests
    if [ "$RUN_E2E" = "true" ]; then
        # Fresh install test
        local cleanup_arg=""
        if [ "$SKIP_CLEANUP" = "true" ]; then
            cleanup_arg="--keep-containers"
        fi

        if ! run_test_suite "Fresh Install E2E" "$SCRIPT_DIR/e2e/fresh-install.test.sh" "$cleanup_arg"; then
            failed=true
        fi

        # Container health test (only if fresh install passed or --skip-cleanup)
        if [ "$failed" = "false" ] || [ "$SKIP_CLEANUP" = "true" ]; then
            if ! run_test_suite "Container Health" "$SCRIPT_DIR/e2e/container-health.test.sh"; then
                failed=true
            fi
        fi

        # Auth flow test
        if [ "$failed" = "false" ] || [ "$SKIP_CLEANUP" = "true" ]; then
            if ! run_test_suite "Auth Flow" "$SCRIPT_DIR/e2e/auth-flow.test.sh"; then
                failed=true
            fi
        fi

        # Upgrade test (skip in fast mode)
        if [ "$FAST_MODE" = "false" ]; then
            local upgrade_args="$cleanup_arg"
            if [ -n "$UPGRADE_SOURCE_REF" ]; then
                upgrade_args="$upgrade_args --source-ref $UPGRADE_SOURCE_REF"
            fi
            if [ -n "$UPGRADE_FIXTURE" ]; then
                upgrade_args="$upgrade_args --fixture $UPGRADE_FIXTURE"
            fi
            if [ -n "$UPGRADE_MODE" ]; then
                upgrade_args="$upgrade_args --mode $UPGRADE_MODE"
            fi
            if [ -n "$HTTPS_PORT_OVERRIDE" ]; then
                upgrade_args="$upgrade_args --https-port $HTTPS_PORT_OVERRIDE"
            fi
            if [ -n "$HTTP_PORT_OVERRIDE" ]; then
                upgrade_args="$upgrade_args --http-port $HTTP_PORT_OVERRIDE"
            fi
            if [ -n "$GATEWAY_PORT_OVERRIDE" ]; then
                upgrade_args="$upgrade_args --gateway-port $GATEWAY_PORT_OVERRIDE"
            fi

            if ! run_test_suite "Upgrade Install" "$SCRIPT_DIR/e2e/upgrade-install.test.sh" "$upgrade_args"; then
                failed=true
            fi
        else
            log_info "Skipping upgrade test (fast mode)"
        fi

        # Cleanup unless skipped
        if [ "$SKIP_CLEANUP" = "false" ]; then
            log_info "Cleaning up containers..."
            cleanup_containers "$(cd "$SCRIPT_DIR/../.." && pwd)" 2>/dev/null || true
        fi
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # Summary
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Test Suite Summary${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
    echo "Duration: ${duration}s"
    echo ""
    echo "Results:"
    for result in "${SUITE_RESULTS[@]}"; do
        if [[ "$result" == PASS* ]]; then
            echo -e "  ${GREEN}$result${NC}"
        else
            echo -e "  ${RED}$result${NC}"
        fi
    done
    echo ""
    echo "Total:  $TOTAL_SUITES"
    echo -e "${GREEN}Passed: $PASSED_SUITES${NC}"
    echo -e "${RED}Failed: $FAILED_SUITES${NC}"
    echo ""

    if [ "$failed" = "true" ]; then
        echo -e "${RED}Some tests failed!${NC}"
        exit 1
    else
        echo -e "${GREEN}All tests passed!${NC}"
        exit 0
    fi
}

main "$@"
