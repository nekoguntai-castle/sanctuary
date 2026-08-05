#!/bin/bash

UPGRADE_FIXTURE_LABEL="optional-profiles"

upgrade_fixture_before_source_install() {
    enable_upgrade_monitoring

    # Diagnostic for #660: this lane fails in CI on the Loki config bind mount
    # but passes locally, so report whether the source is visible to the job
    # and to the daemon before the stack starts.
    probe_monitoring_bind_sources "$PROJECT_ROOT"

    return 0
}

upgrade_fixture_after_source_install() {
    seed_upgrade_baseline_admin_state
}

upgrade_fixture_before_upgrade() {
    probe_monitoring_bind_sources "$TARGET_PROJECT_ROOT"

    return 0
}

upgrade_fixture_after_upgrade() {
    if ! load_runtime_env; then
        return 1
    fi

    if [ "${ENABLE_MONITORING:-no}" != "yes" ]; then
        log_error "Optional profiles fixture expected ENABLE_MONITORING=yes after upgrade"
        return 1
    fi

    if ! docker inspect -f '{{.State.Health.Status}}' "$UPGRADE_GRAFANA_CONTAINER_NAME" 2>/dev/null | grep -q '^healthy$'; then
        log_error "Monitoring profile container $UPGRADE_GRAFANA_CONTAINER_NAME is not healthy after upgrade"
        return 1
    fi

    if ! docker inspect -f '{{.State.Health.Status}}' "$UPGRADE_PROMETHEUS_CONTAINER_NAME" 2>/dev/null | grep -q '^healthy$'; then
        log_error "Monitoring profile container $UPGRADE_PROMETHEUS_CONTAINER_NAME is not healthy after upgrade"
        return 1
    fi

    return 0
}
