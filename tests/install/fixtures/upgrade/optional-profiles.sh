#!/bin/bash

UPGRADE_FIXTURE_LABEL="optional-profiles"

upgrade_fixture_before_source_install() {
    enable_upgrade_monitoring

    # #660: the runner's job and DIND daemon do not share a filesystem, so the
    # monitoring config bind mounts resolve to nothing daemon-side. Seed them,
    # then report what the daemon actually sees.
    sync_monitoring_configs_to_daemon "$PROJECT_ROOT"
    probe_monitoring_bind_sources "$PROJECT_ROOT"

    return 0
}

upgrade_fixture_after_source_install() {
    seed_upgrade_baseline_admin_state
}

upgrade_fixture_before_upgrade() {
    sync_monitoring_configs_to_daemon "$TARGET_PROJECT_ROOT"
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
