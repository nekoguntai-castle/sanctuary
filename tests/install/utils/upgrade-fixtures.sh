#!/bin/bash
# Upgrade fixture selection and defaults.

UPGRADE_ENABLE_MONITORING="${UPGRADE_ENABLE_MONITORING:-no}"
UPGRADE_ENABLE_TOR="${UPGRADE_ENABLE_TOR:-no}"
UPGRADE_USE_LEGACY_RUNTIME_ENV="${UPGRADE_USE_LEGACY_RUNTIME_ENV:-false}"
UPGRADE_RUN_BROWSER_SMOKE="${UPGRADE_RUN_BROWSER_SMOKE:-true}"
UPGRADE_SEED_APP_STATE="${UPGRADE_SEED_APP_STATE:-true}"
UPGRADE_SEED_NOTIFICATION_STATE="${UPGRADE_SEED_NOTIFICATION_STATE:-false}"
UPGRADE_BROWSER_HOST="${UPGRADE_BROWSER_HOST:-}"
UPGRADE_EXPECT_OPTIONAL_PROFILES="${UPGRADE_EXPECT_OPTIONAL_PROFILES:-false}"

apply_optional_profile_isolation_defaults() {
    local profile_slug="${COMPOSE_PROJECT_NAME:-sanctuary-upgrade-optional}"

    MONITORING_BIND_ADDR="${MONITORING_BIND_ADDR:-127.0.0.1}"
    GRAFANA_PORT="${GRAFANA_PORT:-19400}"
    PROMETHEUS_PORT="${PROMETHEUS_PORT:-19401}"
    ALERTMANAGER_PORT="${ALERTMANAGER_PORT:-19402}"
    JAEGER_UI_PORT="${JAEGER_UI_PORT:-19403}"
    LOKI_PORT="${LOKI_PORT:-19404}"
    JAEGER_OTLP_GRPC_PORT="${JAEGER_OTLP_GRPC_PORT:-19405}"
    JAEGER_OTLP_HTTP_PORT="${JAEGER_OTLP_HTTP_PORT:-19406}"

    JAEGER_CONTAINER_NAME="${JAEGER_CONTAINER_NAME:-${profile_slug}-jaeger}"
    LOKI_CONTAINER_NAME="${LOKI_CONTAINER_NAME:-${profile_slug}-loki}"
    PROMTAIL_CONTAINER_NAME="${PROMTAIL_CONTAINER_NAME:-${profile_slug}-promtail}"
    PROMETHEUS_CONTAINER_NAME="${PROMETHEUS_CONTAINER_NAME:-${profile_slug}-prometheus}"
    ALERTMANAGER_CONTAINER_NAME="${ALERTMANAGER_CONTAINER_NAME:-${profile_slug}-alertmanager}"
    GRAFANA_CONTAINER_NAME="${GRAFANA_CONTAINER_NAME:-${profile_slug}-grafana}"
    TOR_CONTAINER_NAME="${TOR_CONTAINER_NAME:-${profile_slug}-tor}"
}

isolate_legacy_optional_profile_compose() {
    local project_dir="$1"
    local target_project_dir="${2:-}"
    local tor_compose="$project_dir/docker-compose.tor.yml"
    local target_tor_compose="$target_project_dir/docker-compose.tor.yml"

    if [ "$UPGRADE_EXPECT_OPTIONAL_PROFILES" != "true" ] || [ ! -f "$tor_compose" ]; then
        return 0
    fi

    if grep -q '^    command: -l "sanctuary_payjoin:80:backend:3001"$' "$tor_compose" \
        && [ -n "$target_project_dir" ] \
        && [ -f "$target_tor_compose" ]; then
        cp "$target_tor_compose" "$tor_compose"
        return 0
    fi

    if grep -q '^    container_name: sanctuary-tor$' "$tor_compose"; then
        sed -i 's/container_name: sanctuary-tor/container_name: ${TOR_CONTAINER_NAME:-sanctuary-tor}/' "$tor_compose"
    fi
}

upgrade_fixture_usage() {
    cat <<'EOF'
Upgrade fixtures:
  baseline             Changed admin password, encrypted 2FA, seeded app state, browser-path smoke.
  browser-origin-ip    Baseline plus 127.0.0.1 browser-visible origin.
  legacy-runtime-env   Baseline using repo-root .env compatibility path across source/target checkouts.
  notification-delivery Baseline plus seeded notification config and post-upgrade worker/DLQ proof.
  optional-profiles    Baseline with monitoring and Tor enabled through setup/start paths.
  seeded-app-state     Explicit app-state fixture; useful when combined with other fixture names.

Fixtures can be comma-separated, for example:
  --fixture browser-origin-ip,seeded-app-state
EOF
}

fixture_list_contains() {
    local fixture_list="$1"
    local needle="$2"
    local fixture

    IFS=',' read -ra fixtures <<< "$fixture_list"
    for fixture in "${fixtures[@]}"; do
        fixture="${fixture//[[:space:]]/}"
        if [ "$fixture" = "$needle" ]; then
            return 0
        fi
    done

    return 1
}

validate_upgrade_fixture() {
    local fixture_list="$1"
    local fixture

    IFS=',' read -ra fixtures <<< "$fixture_list"
    for fixture in "${fixtures[@]}"; do
        fixture="${fixture//[[:space:]]/}"
        case "$fixture" in
            baseline|browser-origin-ip|legacy-runtime-env|notification-delivery|optional-profiles|seeded-app-state)
                ;;
            "")
                echo "Fixture list contains an empty fixture" >&2
                return 1
                ;;
            *)
                echo "Unknown upgrade fixture: $fixture" >&2
                return 1
                ;;
        esac
    done
}

apply_upgrade_fixture_defaults() {
    local fixture_list="$1"

    if fixture_list_contains "$fixture_list" "browser-origin-ip"; then
        UPGRADE_BROWSER_HOST="${UPGRADE_BROWSER_HOST:-127.0.0.1}"
    fi

    UPGRADE_BROWSER_HOST="${UPGRADE_BROWSER_HOST:-localhost}"

    if fixture_list_contains "$fixture_list" "legacy-runtime-env"; then
        UPGRADE_USE_LEGACY_RUNTIME_ENV=true
    fi

    if fixture_list_contains "$fixture_list" "optional-profiles"; then
        UPGRADE_ENABLE_MONITORING=yes
        UPGRADE_ENABLE_TOR=yes
        UPGRADE_EXPECT_OPTIONAL_PROFILES=true
        apply_optional_profile_isolation_defaults
    fi

    if fixture_list_contains "$fixture_list" "notification-delivery"; then
        UPGRADE_SEED_NOTIFICATION_STATE=true
    fi

    if fixture_list_contains "$fixture_list" "seeded-app-state"; then
        UPGRADE_SEED_APP_STATE=true
    fi

    export UPGRADE_ENABLE_MONITORING
    export UPGRADE_ENABLE_TOR
    export UPGRADE_USE_LEGACY_RUNTIME_ENV
    export UPGRADE_RUN_BROWSER_SMOKE
    export UPGRADE_SEED_APP_STATE
    export UPGRADE_SEED_NOTIFICATION_STATE
    export UPGRADE_BROWSER_HOST
    export UPGRADE_EXPECT_OPTIONAL_PROFILES
    export MONITORING_BIND_ADDR
    export GRAFANA_PORT
    export PROMETHEUS_PORT
    export ALERTMANAGER_PORT
    export JAEGER_UI_PORT
    export LOKI_PORT
    export JAEGER_OTLP_GRPC_PORT
    export JAEGER_OTLP_HTTP_PORT
    export JAEGER_CONTAINER_NAME
    export LOKI_CONTAINER_NAME
    export PROMTAIL_CONTAINER_NAME
    export PROMETHEUS_CONTAINER_NAME
    export ALERTMANAGER_CONTAINER_NAME
    export GRAFANA_CONTAINER_NAME
    export TOR_CONTAINER_NAME
}
