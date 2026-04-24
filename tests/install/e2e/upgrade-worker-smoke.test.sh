#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SANCTUARY_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SUPPORT_PACKAGE_FILE="${SANCTUARY_UPGRADE_SUPPORT_PACKAGE_FILE:-/tmp/sanctuary-upgrade-support-package.json}"

# shellcheck source=/dev/null
source "$SCRIPT_DIR/../utils/helpers.sh"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../utils/upgrade-assertions.sh"

if ! assert_upgrade_worker_ready; then
    exit 1
fi

if ! assert_upgrade_support_package_json "$PROJECT_ROOT" "$SUPPORT_PACKAGE_FILE"; then
    exit 1
fi

log_success "Worker/support-package smoke checks passed"
