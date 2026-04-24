#!/bin/bash

UPGRADE_FIXTURE_LABEL="browser-origin-ip"

upgrade_fixture_before_source_install() {
    set_upgrade_ports 18443 18080 14000
    set_upgrade_browser_origin "127.0.0.1" "$HTTPS_PORT"
    return 0
}

upgrade_fixture_after_source_install() {
    seed_upgrade_baseline_admin_state
}

upgrade_fixture_after_upgrade() {
    if [ "$HTTPS_PORT" != "18443" ] || [ "$HTTP_PORT" != "18080" ]; then
        log_error "Browser-origin fixture did not preserve the non-default ports"
        return 1
    fi

    if [ "$UPGRADE_BROWSER_BASE_URL" != "https://127.0.0.1:18443" ]; then
        log_error "Browser-origin fixture did not configure the expected browser-visible base URL"
        log_error "Current browser base URL: $UPGRADE_BROWSER_BASE_URL"
        return 1
    fi

    return 0
}
