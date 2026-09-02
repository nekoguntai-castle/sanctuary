#!/bin/bash
# Upgrade fixture selection and defaults.

UPGRADE_ENABLE_MONITORING="${UPGRADE_ENABLE_MONITORING:-no}"
UPGRADE_ENABLE_TOR="${UPGRADE_ENABLE_TOR:-no}"
UPGRADE_ENABLE_MCP="${UPGRADE_ENABLE_MCP:-no}"
UPGRADE_USE_LEGACY_RUNTIME_ENV="${UPGRADE_USE_LEGACY_RUNTIME_ENV:-false}"
UPGRADE_RUN_BROWSER_SMOKE="${UPGRADE_RUN_BROWSER_SMOKE:-true}"
UPGRADE_SEED_APP_STATE="${UPGRADE_SEED_APP_STATE:-true}"
UPGRADE_SEED_NOTIFICATION_STATE="${UPGRADE_SEED_NOTIFICATION_STATE:-false}"
UPGRADE_BROWSER_HOST="${UPGRADE_BROWSER_HOST:-}"
UPGRADE_EXPECT_OPTIONAL_PROFILES="${UPGRADE_EXPECT_OPTIONAL_PROFILES:-false}"

restore_tracked_worktree_file_for_cleanup() {
    local worktree_root="$1"
    local relative_path="$2"
    local target_path="$worktree_root/$relative_path"
    local restore_path="${target_path}.cleanup-restore-$$"
    local tracked_entry
    local tracked_mode

    tracked_entry="$(git -C "$worktree_root" ls-tree HEAD -- "$relative_path")" || return 1
    tracked_mode="${tracked_entry%% *}"
    case "$tracked_mode" in
        100644|100755)
            ;;
        *)
            echo "Unsupported tracked mode for cleanup restore: $relative_path ($tracked_mode)" >&2
            return 1
            ;;
    esac

    git -C "$worktree_root" show "HEAD:$relative_path" > "$restore_path" || {
        rm -f "$restore_path"
        return 1
    }
    if [ "$tracked_mode" = "100755" ]; then
        chmod 755 "$restore_path"
    else
        chmod 644 "$restore_path"
    fi
    mv "$restore_path" "$target_path"
}

apply_optional_profile_isolation_defaults() {
    local profile_slug="${COMPOSE_PROJECT_NAME:-sanctuary-upgrade-optional}"
    local optional_port_base="${UPGRADE_OPTIONAL_PROFILE_PORT_BASE:-}"

    if [ -z "$optional_port_base" ] && [ -n "${HTTPS_PORT:-}" ]; then
        case "$HTTPS_PORT" in
            ''|*[!0-9]*)
                ;;
            *)
                optional_port_base=$((10#$HTTPS_PORT + 100))
                ;;
        esac
    fi

    optional_port_base="${optional_port_base:-19400}"
    case "$optional_port_base" in
        ''|*[!0-9]*)
            log_error "UPGRADE_OPTIONAL_PROFILE_PORT_BASE must be a non-negative integer"
            return 1
            ;;
    esac
    if [ $((10#$optional_port_base + 7)) -gt 65535 ]; then
        log_error "Optional profile port range exceeds 65535"
        return 1
    fi

    set_optional_profile_port_default() {
        local name="$1"
        local offset="$2"
        if [ -z "${!name:-}" ]; then
            printf -v "$name" '%s' "$((10#$optional_port_base + offset))"
        fi
    }

    MONITORING_BIND_ADDR="${MONITORING_BIND_ADDR:-127.0.0.1}"
    set_optional_profile_port_default GRAFANA_PORT 0
    set_optional_profile_port_default PROMETHEUS_PORT 1
    set_optional_profile_port_default ALERTMANAGER_PORT 2
    set_optional_profile_port_default JAEGER_UI_PORT 3
    set_optional_profile_port_default LOKI_PORT 4
    set_optional_profile_port_default JAEGER_OTLP_GRPC_PORT 5
    set_optional_profile_port_default JAEGER_OTLP_HTTP_PORT 6
    MCP_BIND_ADDRESS="${MCP_BIND_ADDRESS:-127.0.0.1}"
    set_optional_profile_port_default MCP_PORT 7

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
    local base_compose="$project_dir/docker-compose.yml"
    local tor_compose
    local target_tor_compose=""
    local target_tor_ingress=""

    if [ "$UPGRADE_EXPECT_OPTIONAL_PROFILES" != "true" ]; then
        return 0
    fi

    # v0.8.66 binds MCP to an IPv4 socket but probes localhost, which Alpine
    # resolves to ::1. Normalize only the disposable fixture checkout so the
    # source service can become healthy before exercising the real upgrade.
    if [ -f "$base_compose" ]; then
        sed -i 's#http://localhost:3003/health#http://127.0.0.1:3003/health#g' "$base_compose"
    fi

    tor_compose="$(resolve_compose_overlay "$project_dir" tor 2>/dev/null || true)"
    if [ -n "$target_project_dir" ]; then
        target_tor_compose="$(resolve_compose_overlay "$target_project_dir" tor 2>/dev/null || true)"
        target_tor_ingress="$target_project_dir/docker/tor/payjoin-ingress.conf"
    fi

    if [ -z "$tor_compose" ]; then
        return 0
    fi

    if grep -q '^    command: -l "sanctuary_payjoin:80:backend:3001"$' "$tor_compose" \
        && [ -n "$target_project_dir" ] \
        && [ -n "$target_tor_compose" ]; then
        if [ ! -f "$target_tor_ingress" ]; then
            echo "Target Tor ingress configuration is unavailable: $target_tor_ingress" >&2
            return 1
        fi
        cp "$target_tor_compose" "$tor_compose"
        mkdir -p "$project_dir/docker/tor"
        cp "$target_tor_ingress" "$project_dir/docker/tor/payjoin-ingress.conf"
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
  optional-profiles    Baseline with monitoring, Tor, and MCP enabled through setup/start paths.
  seeded-app-state     Explicit app-state fixture; useful when combined with other fixture names.
  wallet-sync-retirement Legacy scheduler/job retirement from a below-floor source.

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
    local fixture_count=0

    IFS=',' read -ra fixtures <<< "$fixture_list"
    for fixture in "${fixtures[@]}"; do
        fixture="${fixture//[[:space:]]/}"
        fixture_count=$((fixture_count + 1))
        case "$fixture" in
            baseline|browser-origin-ip|legacy-runtime-env|notification-delivery|optional-profiles|seeded-app-state|wallet-sync-retirement)
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

    if [ "$fixture_count" -gt 1 ] \
        && fixture_list_contains "$fixture_list" "wallet-sync-retirement"; then
        echo "wallet-sync-retirement must run as an isolated fixture" >&2
        return 1
    fi
}

apply_upgrade_fixture_defaults() {
    local fixture_list="$1"

    if fixture_list_contains "$fixture_list" "browser-origin-ip"; then
        if command -v is_containerized_runtime >/dev/null 2>&1 &&
           is_containerized_runtime &&
           command -v default_install_test_host >/dev/null 2>&1; then
            UPGRADE_BROWSER_HOST="${UPGRADE_BROWSER_HOST:-$(default_install_test_host)}"
        else
            UPGRADE_BROWSER_HOST="${UPGRADE_BROWSER_HOST:-127.0.0.1}"
        fi
    fi

    UPGRADE_BROWSER_HOST="${UPGRADE_BROWSER_HOST:-${UPGRADE_TEST_DEFAULT_BROWSER_HOST:-localhost}}"

    if fixture_list_contains "$fixture_list" "legacy-runtime-env"; then
        UPGRADE_USE_LEGACY_RUNTIME_ENV=true
    fi

    if fixture_list_contains "$fixture_list" "optional-profiles"; then
        UPGRADE_ENABLE_MONITORING=yes
        UPGRADE_ENABLE_TOR=yes
        UPGRADE_ENABLE_MCP=yes
        UPGRADE_EXPECT_OPTIONAL_PROFILES=true
        apply_optional_profile_isolation_defaults
    fi

    if fixture_list_contains "$fixture_list" "notification-delivery"; then
        UPGRADE_SEED_NOTIFICATION_STATE=true
    fi

    if fixture_list_contains "$fixture_list" "seeded-app-state"; then
        UPGRADE_SEED_APP_STATE=true
    fi

    if fixture_list_contains "$fixture_list" "wallet-sync-retirement"; then
        # The fixture carries no wallet/address coverage. Its dedicated helper
        # fast-forwards the live observed header target so this lane can prove
        # scheduler retirement without duplicating the header-reconciliation lane.
        UPGRADE_SEED_APP_STATE=false
        UPGRADE_RUN_BROWSER_SMOKE=false
    fi

    export UPGRADE_ENABLE_MONITORING
    export UPGRADE_ENABLE_TOR
    export UPGRADE_ENABLE_MCP
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
    export MCP_BIND_ADDRESS
    export MCP_PORT
    export JAEGER_CONTAINER_NAME
    export LOKI_CONTAINER_NAME
    export PROMTAIL_CONTAINER_NAME
    export PROMETHEUS_CONTAINER_NAME
    export ALERTMANAGER_CONTAINER_NAME
    export GRAFANA_CONTAINER_NAME
    export TOR_CONTAINER_NAME
}
