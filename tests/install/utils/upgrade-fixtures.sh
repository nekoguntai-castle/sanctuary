#!/bin/bash

UPGRADE_UTILS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPGRADE_FIXTURE_DIR="$UPGRADE_UTILS_DIR/../fixtures/upgrade"
UPGRADE_ENV_LAYOUT="${UPGRADE_ENV_LAYOUT:-runtime}"
UPGRADE_ENABLE_MONITORING="${UPGRADE_ENABLE_MONITORING:-no}"
UPGRADE_ENABLE_TOR="${UPGRADE_ENABLE_TOR:-no}"
UPGRADE_BROWSER_BASE_URL="${UPGRADE_BROWSER_BASE_URL:-}"
UPGRADE_BROWSER_ORIGIN="${UPGRADE_BROWSER_ORIGIN:-}"
UPGRADE_EXPECT_WEBSOCKET="${UPGRADE_EXPECT_WEBSOCKET:-true}"
UPGRADE_MONITORING_BIND_ADDR="${UPGRADE_MONITORING_BIND_ADDR:-127.0.0.1}"
UPGRADE_GRAFANA_PORT="${UPGRADE_GRAFANA_PORT:-}"
UPGRADE_PROMETHEUS_PORT="${UPGRADE_PROMETHEUS_PORT:-}"
UPGRADE_ALERTMANAGER_PORT="${UPGRADE_ALERTMANAGER_PORT:-}"
UPGRADE_JAEGER_UI_PORT="${UPGRADE_JAEGER_UI_PORT:-}"
UPGRADE_LOKI_PORT="${UPGRADE_LOKI_PORT:-}"
UPGRADE_JAEGER_OTLP_GRPC_PORT="${UPGRADE_JAEGER_OTLP_GRPC_PORT:-}"
UPGRADE_JAEGER_OTLP_HTTP_PORT="${UPGRADE_JAEGER_OTLP_HTTP_PORT:-}"
UPGRADE_GRAFANA_CONTAINER_NAME="${UPGRADE_GRAFANA_CONTAINER_NAME:-}"
UPGRADE_PROMETHEUS_CONTAINER_NAME="${UPGRADE_PROMETHEUS_CONTAINER_NAME:-}"
UPGRADE_ALERTMANAGER_CONTAINER_NAME="${UPGRADE_ALERTMANAGER_CONTAINER_NAME:-}"
UPGRADE_LOKI_CONTAINER_NAME="${UPGRADE_LOKI_CONTAINER_NAME:-}"
UPGRADE_PROMTAIL_CONTAINER_NAME="${UPGRADE_PROMTAIL_CONTAINER_NAME:-}"
UPGRADE_JAEGER_CONTAINER_NAME="${UPGRADE_JAEGER_CONTAINER_NAME:-}"

if [ -f "$UPGRADE_UTILS_DIR/upgrade-assertions.sh" ]; then
    # shellcheck source=/dev/null
    source "$UPGRADE_UTILS_DIR/upgrade-assertions.sh"
fi

list_available_upgrade_fixtures() {
    local fixture_path fixture_name

    for fixture_path in "$UPGRADE_FIXTURE_DIR"/*.sh; do
        [ -e "$fixture_path" ] || continue
        fixture_name="$(basename "$fixture_path" .sh)"
        echo "$fixture_name"
    done | sort
}

resolve_upgrade_fixture_script() {
    local fixture_name="$1"
    echo "$UPGRADE_FIXTURE_DIR/${fixture_name}.sh"
}

set_upgrade_ports() {
    local https_port="$1"
    local http_port="$2"
    local gateway_port="${3:-$GATEWAY_PORT}"
    local previous_api_base_url="${API_BASE_URL:-}"

    HTTPS_PORT="$https_port"
    HTTP_PORT="$http_port"
    GATEWAY_PORT="$gateway_port"
    API_BASE_URL="https://localhost:${HTTPS_PORT}"
    if [ -z "$UPGRADE_BROWSER_BASE_URL" ] || [ "$UPGRADE_BROWSER_BASE_URL" = "$previous_api_base_url" ]; then
        UPGRADE_BROWSER_BASE_URL="$API_BASE_URL"
        UPGRADE_BROWSER_ORIGIN="$UPGRADE_BROWSER_BASE_URL"
    fi
}

set_upgrade_browser_origin() {
    local host="$1"
    local https_port="${2:-$HTTPS_PORT}"

    UPGRADE_BROWSER_BASE_URL="https://${host}:${https_port}"
    UPGRADE_BROWSER_ORIGIN="$UPGRADE_BROWSER_BASE_URL"
}

use_legacy_repo_env_layout() {
    UPGRADE_ENV_LAYOUT="legacy-repo-env"
}

enable_upgrade_monitoring() {
    UPGRADE_ENABLE_MONITORING="yes"

    if [ -z "$UPGRADE_GRAFANA_PORT" ]; then
        set_upgrade_monitoring_ports 13000 19090 19093 13100 16687 14317 14318
    fi

    if [ -z "$UPGRADE_GRAFANA_CONTAINER_NAME" ] && [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
        set_upgrade_monitoring_container_names "$COMPOSE_PROJECT_NAME"
    fi
}

enable_upgrade_tor() {
    UPGRADE_ENABLE_TOR="yes"
}

set_upgrade_monitoring_ports() {
    UPGRADE_GRAFANA_PORT="$1"
    UPGRADE_PROMETHEUS_PORT="$2"
    UPGRADE_ALERTMANAGER_PORT="$3"
    UPGRADE_LOKI_PORT="$4"
    UPGRADE_JAEGER_UI_PORT="$5"
    UPGRADE_JAEGER_OTLP_GRPC_PORT="$6"
    UPGRADE_JAEGER_OTLP_HTTP_PORT="$7"
}

set_upgrade_monitoring_container_names() {
    local prefix="$1"

    UPGRADE_GRAFANA_CONTAINER_NAME="${prefix}-grafana"
    UPGRADE_PROMETHEUS_CONTAINER_NAME="${prefix}-prometheus"
    UPGRADE_ALERTMANAGER_CONTAINER_NAME="${prefix}-alertmanager"
    UPGRADE_LOKI_CONTAINER_NAME="${prefix}-loki"
    UPGRADE_PROMTAIL_CONTAINER_NAME="${prefix}-promtail"
    UPGRADE_JAEGER_CONTAINER_NAME="${prefix}-jaeger"
}

patch_upgrade_monitoring_compose_isolation() {
    local compose_file="$1"

    [ -f "$compose_file" ] || return 0

    sed -i \
        -e 's|container_name: sanctuary-jaeger|container_name: ${JAEGER_CONTAINER_NAME:-sanctuary-jaeger}|' \
        -e 's|container_name: sanctuary-loki|container_name: ${LOKI_CONTAINER_NAME:-sanctuary-loki}|' \
        -e 's|container_name: sanctuary-promtail|container_name: ${PROMTAIL_CONTAINER_NAME:-sanctuary-promtail}|' \
        -e 's|container_name: sanctuary-prometheus|container_name: ${PROMETHEUS_CONTAINER_NAME:-sanctuary-prometheus}|' \
        -e 's|container_name: sanctuary-alertmanager|container_name: ${ALERTMANAGER_CONTAINER_NAME:-sanctuary-alertmanager}|' \
        -e 's|container_name: sanctuary-grafana|container_name: ${GRAFANA_CONTAINER_NAME:-sanctuary-grafana}|' \
        "$compose_file"
}

seed_upgrade_baseline_admin_state() {
    local login_response=""
    local password_suffix=""

    password_suffix="$(openssl rand -hex 6 2>/dev/null || printf '%s' "$TEST_ID" | tr -cd '[:alnum:]' | cut -c1-12)"
    ORIGINAL_USER_PASSWORD="UpgradeBaseline-${password_suffix}-Aa1!"

    if ! wait_for_browser_auth_ready; then
        log_error "Browser auth endpoint did not become ready before baseline fixture setup"
        return 1
    fi

    rm -f "$COOKIE_JAR"
    login_response=$(upgrade_login_capture "admin" "sanctuary" "$COOKIE_JAR" "$API_BASE_URL")

    if echo "$login_response" | grep -q '"user"'; then
        local csrf_token=""
        csrf_token="$(upgrade_extract_csrf_from_jar "$COOKIE_JAR")"
        if [ -z "$csrf_token" ]; then
            log_error "Default login succeeded but sanctuary_csrf cookie missing"
            return 1
        fi

        local password_change_response=""
        password_change_response=$(upgrade_authenticated_json_request \
            POST \
            "/api/v1/auth/me/change-password" \
            "{\"currentPassword\":\"sanctuary\",\"newPassword\":\"$ORIGINAL_USER_PASSWORD\"}" \
            "$COOKIE_JAR" \
            "$API_BASE_URL")

        if ! echo "$password_change_response" | grep -q 'Password changed successfully'; then
            log_error "Failed to set baseline admin password"
            log_error "Response: $password_change_response"
            return 1
        fi
    fi

    rm -f "$COOKIE_JAR"
    login_response=$(upgrade_login_capture "admin" "$ORIGINAL_USER_PASSWORD" "$COOKIE_JAR" "$API_BASE_URL")

    if ! echo "$login_response" | grep -q '"user"'; then
        log_error "Failed to authenticate after baseline fixture setup"
        log_error "Response: $login_response"
        return 1
    fi

    local csrf_token=""
    csrf_token="$(upgrade_extract_csrf_from_jar "$COOKIE_JAR")"
    if [ -z "$csrf_token" ]; then
        log_error "Failed to capture sanctuary_csrf cookie after baseline fixture setup"
        return 1
    fi

    return 0
}

upgrade_fixture_before_source_install() {
    return 0
}

upgrade_fixture_after_source_install() {
    return 0
}

upgrade_fixture_before_upgrade() {
    return 0
}

upgrade_fixture_after_upgrade() {
    return 0
}

initialize_upgrade_fixture() {
    local fixture_script available_fixtures

    fixture_script="$(resolve_upgrade_fixture_script "$UPGRADE_FIXTURE")"
    if [ ! -f "$fixture_script" ]; then
        available_fixtures="$(list_available_upgrade_fixtures | tr '\n' ' ' | sed 's/ $//')"
        log_error "Unknown upgrade fixture: $UPGRADE_FIXTURE"
        if [ -n "$available_fixtures" ]; then
            log_error "Available fixtures: $available_fixtures"
        fi
        return 1
    fi

    UPGRADE_FIXTURE_LABEL="$UPGRADE_FIXTURE"
    # shellcheck source=/dev/null
    source "$fixture_script"
    return 0
}

run_upgrade_fixture_hook() {
    local hook_name="$1"

    if declare -F "$hook_name" >/dev/null 2>&1; then
        "$hook_name"
    else
        return 0
    fi
}
