#!/bin/bash

UPGRADE_FIXTURE_LABEL="optional-profiles"

upgrade_fixture_before_source_install() {
    enable_upgrade_monitoring
    patch_upgrade_monitoring_compose_isolation "$PROJECT_ROOT/docker-compose.monitoring.yml"
    return 0
}

upgrade_fixture_after_source_install() {
    seed_upgrade_baseline_admin_state
}

upgrade_fixture_before_upgrade() {
    patch_upgrade_monitoring_compose_isolation "$TARGET_PROJECT_ROOT/docker-compose.monitoring.yml"
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
