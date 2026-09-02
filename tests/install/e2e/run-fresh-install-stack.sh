#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# shellcheck source=tests/install/utils/helpers.sh
source "$SCRIPT_DIR/../utils/helpers.sh"
INSTALL_E2E_ARGS=("$@")

install_e2e_cleanup_auto_run coordinator_managed install-fresh-stack \
    "$PROJECT_ROOT" "$0" "${INSTALL_E2E_ARGS[@]}"

for argument in "$@"; do
    case "$argument" in
        --verbose|-v) ;;
        *) log_error "Unknown option: $argument"; exit 2 ;;
    esac
done

shared_password="${SANCTUARY_FRESH_INSTALL_CHANGED_PASSWORD:-NewSecurePassword123!}"
SANCTUARY_FRESH_INSTALL_CHANGED_PASSWORD="$shared_password" \
    "$SCRIPT_DIR/fresh-install.test.sh" "$@"
"$SCRIPT_DIR/container-health.test.sh" "$@"
SANCTUARY_AUTH_CURRENT_PASSWORD="$shared_password" \
    "$SCRIPT_DIR/auth-flow.test.sh" "$@"
