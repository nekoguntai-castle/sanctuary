#!/bin/bash
# Upgrade fixture selection and defaults.

UPGRADE_ENABLE_MONITORING="${UPGRADE_ENABLE_MONITORING:-no}"
UPGRADE_ENABLE_TOR="${UPGRADE_ENABLE_TOR:-no}"
UPGRADE_USE_LEGACY_RUNTIME_ENV="${UPGRADE_USE_LEGACY_RUNTIME_ENV:-false}"
UPGRADE_RUN_BROWSER_SMOKE="${UPGRADE_RUN_BROWSER_SMOKE:-true}"
UPGRADE_SEED_APP_STATE="${UPGRADE_SEED_APP_STATE:-true}"
UPGRADE_BROWSER_HOST="${UPGRADE_BROWSER_HOST:-}"
UPGRADE_EXPECT_OPTIONAL_PROFILES="${UPGRADE_EXPECT_OPTIONAL_PROFILES:-false}"

upgrade_fixture_usage() {
    cat <<'EOF'
Upgrade fixtures:
  baseline             Changed admin password, encrypted 2FA, seeded app state, browser-path smoke.
  browser-origin-ip    Baseline plus 127.0.0.1 browser-visible origin.
  legacy-runtime-env   Baseline using repo-root .env compatibility path across source/target checkouts.
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
            baseline|browser-origin-ip|legacy-runtime-env|optional-profiles|seeded-app-state)
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
    fi

    if fixture_list_contains "$fixture_list" "seeded-app-state"; then
        UPGRADE_SEED_APP_STATE=true
    fi

    export UPGRADE_ENABLE_MONITORING
    export UPGRADE_ENABLE_TOR
    export UPGRADE_USE_LEGACY_RUNTIME_ENV
    export UPGRADE_RUN_BROWSER_SMOKE
    export UPGRADE_SEED_APP_STATE
    export UPGRADE_BROWSER_HOST
    export UPGRADE_EXPECT_OPTIONAL_PROFILES
}
