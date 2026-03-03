#!/bin/bash

# =============================================
# Sanctuary - Test Runner Script
# =============================================
#
# Runs the full test suite locally or in Docker.
# Usage: ./scripts/run-tests.sh [options]
#
# Options:
#   --docker     Run tests in Docker (recommended for CI parity)
#   --coverage   Generate coverage reports
#   --backend    Run backend tests only
#   --frontend   Run frontend tests only
#   --watch      Run in watch mode (frontend only, not with --docker)
#   --integration  Run integration tests with database (backend only)
#   --help       Show this help message
#
# Examples:
#   ./scripts/run-tests.sh                    # Run all tests locally
#   ./scripts/run-tests.sh --docker           # Run all tests in Docker
#   ./scripts/run-tests.sh --backend --coverage  # Backend with coverage
#   ./scripts/run-tests.sh --frontend --watch    # Frontend in watch mode
#   ./scripts/run-tests.sh --backend --integration  # Backend integration tests
#
# =============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default options
USE_DOCKER=false
WITH_COVERAGE=false
RUN_BACKEND=true
RUN_FRONTEND=true
WATCH_MODE=false
INTEGRATION_MODE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --docker)
            USE_DOCKER=true
            shift
            ;;
        --coverage)
            WITH_COVERAGE=true
            shift
            ;;
        --backend)
            RUN_FRONTEND=false
            shift
            ;;
        --frontend)
            RUN_BACKEND=false
            shift
            ;;
        --watch)
            WATCH_MODE=true
            shift
            ;;
        --integration)
            INTEGRATION_MODE=true
            RUN_FRONTEND=false
            shift
            ;;
        --help)
            head -30 "$0" | tail -25
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

cd "$PROJECT_ROOT"

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}  Sanctuary Test Runner${NC}"
echo -e "${BLUE}=============================================${NC}"
echo ""

# Docker mode
if [ "$USE_DOCKER" = true ]; then
    if [ "$INTEGRATION_MODE" = true ]; then
        echo -e "${YELLOW}Running integration tests in Docker...${NC}"
    else
        echo -e "${YELLOW}Running tests in Docker...${NC}"
    fi
    echo ""

    if [ "$INTEGRATION_MODE" = true ]; then
        # Run integration tests with database in Docker
        docker compose -f docker-compose.test.yml run --rm backend-test sh -c "
            npx prisma generate &&
            npx prisma migrate deploy &&
            npm run test:integration -- --ci
        "
    elif [ "$WITH_COVERAGE" = true ]; then
        if [ "$RUN_BACKEND" = true ] && [ "$RUN_FRONTEND" = true ]; then
            npm run test:docker:coverage
        elif [ "$RUN_BACKEND" = true ]; then
            docker compose -f docker-compose.test.yml run --rm backend-coverage
        else
            docker compose -f docker-compose.test.yml run --rm frontend-coverage
        fi
    else
        if [ "$RUN_BACKEND" = true ] && [ "$RUN_FRONTEND" = true ]; then
            npm run test:docker
        elif [ "$RUN_BACKEND" = true ]; then
            npm run test:docker:backend
        else
            npm run test:docker:frontend
        fi
    fi

    echo ""
    echo -e "${GREEN}Docker tests completed!${NC}"
    exit 0
fi

# Local mode
BACKEND_RESULT=0
FRONTEND_RESULT=0

# Run backend tests
if [ "$RUN_BACKEND" = true ]; then
    if [ "$INTEGRATION_MODE" = true ]; then
        echo -e "${YELLOW}Running backend integration tests...${NC}"
    else
        echo -e "${YELLOW}Running backend tests...${NC}"
    fi
    echo ""

    if [ "$INTEGRATION_MODE" = true ]; then
        cd "$PROJECT_ROOT"
        npm run test:integration || BACKEND_RESULT=$?
    elif [ "$WITH_COVERAGE" = true ]; then
        cd "$PROJECT_ROOT/server"
        npm run test:coverage || BACKEND_RESULT=$?
    else
        cd "$PROJECT_ROOT/server"
        npm test || BACKEND_RESULT=$?
    fi

    cd "$PROJECT_ROOT"
    echo ""
fi

# Run frontend tests
if [ "$RUN_FRONTEND" = true ]; then
    echo -e "${YELLOW}Running frontend tests...${NC}"
    echo ""

    if [ "$WATCH_MODE" = true ]; then
        npm run test
    elif [ "$WITH_COVERAGE" = true ]; then
        npm run test:coverage || FRONTEND_RESULT=$?
    else
        npm run test:run || FRONTEND_RESULT=$?
    fi

    echo ""
fi

# Summary
echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}  Test Summary${NC}"
echo -e "${BLUE}=============================================${NC}"

if [ "$RUN_BACKEND" = true ]; then
    if [ "$INTEGRATION_MODE" = true ]; then
        TEST_NAME="Integration"
    else
        TEST_NAME="Backend"
    fi
    if [ $BACKEND_RESULT -eq 0 ]; then
        echo -e "  ${TEST_NAME}:  ${GREEN}PASSED${NC}"
    else
        echo -e "  ${TEST_NAME}:  ${RED}FAILED${NC}"
    fi
fi

if [ "$RUN_FRONTEND" = true ] && [ "$WATCH_MODE" = false ]; then
    if [ $FRONTEND_RESULT -eq 0 ]; then
        echo -e "  Frontend: ${GREEN}PASSED${NC}"
    else
        echo -e "  Frontend: ${RED}FAILED${NC}"
    fi
fi

echo ""

# Exit with error if any tests failed
if [ $BACKEND_RESULT -ne 0 ] || [ $FRONTEND_RESULT -ne 0 ]; then
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi

echo -e "${GREEN}All tests passed!${NC}"
