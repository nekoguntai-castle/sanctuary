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
    if [ $((10#$optional_port_base + 6)) -gt 65535 ]; then
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
    local tor_compose
    local target_tor_compose=""

    tor_compose="$(resolve_compose_overlay "$project_dir" tor 2>/dev/null || true)"
    if [ -n "$target_project_dir" ]; then
        target_tor_compose="$(resolve_compose_overlay "$target_project_dir" tor 2>/dev/null || true)"
    fi

    if [ "$UPGRADE_EXPECT_OPTIONAL_PROFILES" != "true" ] || [ -z "$tor_compose" ]; then
        return 0
    fi

    if grep -q '^    command: -l "sanctuary_payjoin:80:backend:3001"$' "$tor_compose" \
        && [ -n "$target_project_dir" ] \
        && [ -n "$target_tor_compose" ]; then
        cp "$target_tor_compose" "$tor_compose"
        return 0
    fi

    if grep -q '^    container_name: sanctuary-tor$' "$tor_compose"; then
        sed -i 's/container_name: sanctuary-tor/container_name: ${TOR_CONTAINER_NAME:-sanctuary-tor}/' "$tor_compose"
    fi
}

# Released tags cannot be changed, and every tag up to v0.8.59 sets
# mem_swappiness on nine services. cgroup v2 does not implement
# memory.swappiness at all: Docker discards the key silently, but Podman's crun
# refuses it and aborts the entire compose up, so the upgrade lanes cannot even
# install their own source ref on a rootless Podman runner.
#
# Stripping it costs nothing that was working — the key was already inert on
# every cgroup v2 host, which is every host in this project. Only this one dead
# key is removed; the legacy stack's real resource policy (limits, reservations,
# swap limits) is left exactly as shipped, so the upgrade test still exercises
# the released configuration in every respect that has an effect.
#
# Remove this adapter once no supported upgrade source ref predates the fix.
# Released tags up to v0.8.59 hardcode host paths as mount SOURCES:
# /var/run/docker.sock for docker-proxy and promtail, and
# /var/lib/docker/containers for promtail. Rootless Podman exposes the socket
# under /run/user/<uid>/podman/ and cannot mkdir under /var/run, so the legacy
# source install aborts its entire compose up with "permission denied" — the
# same failure #682 fixed on main, reappearing from a tag that cannot be
# changed (run 8788).
#
# Rewrites the sources to the parameterised form main now uses, so the runner's
# SANCTUARY_DOCKER_SOCKET applies. Container-side paths are untouched, and a
# checkout already carrying the parameterised form is left alone.
#
# Remove once every supported upgrade source ref includes #682.
# Released tags up to v0.8.59 write the gateway healthcheck as
#   ["CMD", "sh", "-c", '<script with shell syntax>']
# which does not survive the compose -> Podman path: the script reaches sh
# truncated and every probe fails with
#   [: line 0: syntax error: unexpected end of file (expecting "then")
# leaving the container permanently unhealthy. Confirmed from run 8824's
# captured health log. #678 fixed this on main by switching to CMD-SHELL; a
# released tag cannot be changed.
#
# Collapses the CMD/sh/-c triple to CMD-SHELL, which is semantically identical
# (both run the script through the container's shell) and round-trips intact on
# both engines. Bare CMD arrays carry no shell syntax and are left alone.
#
# Remove once every supported upgrade source ref includes #678.
adapt_legacy_healthcheck_shell_form() {
    local project_dir="$1"
    local -a compose_files=()
    local f

    [ -d "$project_dir" ] || return 0

    [ -f "$project_dir/docker-compose.yml" ] && compose_files+=("$project_dir/docker-compose.yml")
    for f in "$project_dir"/docker/compose/*.yml; do
        [ -f "$f" ] && compose_files+=("$f")
    done
    [ "${#compose_files[@]}" -gt 0 ] || return 0

    local rewritten=0
    for f in "${compose_files[@]}"; do
        # Only the multi-line array form is affected; a single-line
        # ["CMD", "redis-cli", "ping"] has no shell to truncate.
        grep -qE '^[[:space:]]*"sh",[[:space:]]*$' "$f" || continue

        local tmp_file
        tmp_file="$(mktemp "${f}.XXXXXX")"
        awk '
            { line[NR] = $0 }
            END {
                for (i = 1; i <= NR; i++) {
                    if (line[i]   ~ /^[[:space:]]*"CMD",[[:space:]]*$/ &&
                        line[i+1] ~ /^[[:space:]]*"sh",[[:space:]]*$/  &&
                        line[i+2] ~ /^[[:space:]]*"-c",[[:space:]]*$/) {
                        match(line[i], /^[[:space:]]*/)
                        printf "%s\"CMD-SHELL\",\n", substr(line[i], 1, RLENGTH)
                        i += 2
                        continue
                    }
                    print line[i]
                }
            }
        ' "$f" > "$tmp_file"
        mv "$tmp_file" "$f"
        rewritten=$((rewritten + 1))
    done

    if [ "$rewritten" -gt 0 ]; then
        log_info "Rewrote CMD/sh/-c healthchecks to CMD-SHELL in $rewritten legacy compose file(s); the array form truncates on Podman"
    fi
}

adapt_legacy_host_path_mounts() {
    local project_dir="$1"
    local -a compose_files=()
    local f

    [ -d "$project_dir" ] || return 0

    [ -f "$project_dir/docker-compose.yml" ] && compose_files+=("$project_dir/docker-compose.yml")
    for f in "$project_dir"/docker/compose/*.yml; do
        [ -f "$f" ] && compose_files+=("$f")
    done
    [ "${#compose_files[@]}" -gt 0 ] || return 0

    local legacy_sock='- /var/run/docker.sock:/var/run/docker.sock:ro'
    local param_sock='- ${SANCTUARY_DOCKER_SOCKET:-/var/run/docker.sock}:/var/run/docker.sock:ro'
    local legacy_ctrs='- /var/lib/docker/containers:/var/lib/docker/containers:ro'
    local param_ctrs='- ${SANCTUARY_DOCKER_CONTAINERS_DIR:-/var/lib/docker/containers}:/var/lib/docker/containers:ro'

    local adapted=0
    for f in "${compose_files[@]}"; do
        # -- : the patterns begin with "- ", which grep would parse as options.
        grep -Fq -- "$legacy_sock" "$f" || grep -Fq -- "$legacy_ctrs" "$f" || continue

        local tmp_file
        tmp_file="$(mktemp "${f}.XXXXXX")"
        while IFS= read -r line || [ -n "$line" ]; do
            line="${line//$legacy_sock/$param_sock}"
            line="${line//$legacy_ctrs/$param_ctrs}"
            printf '%s
' "$line"
        done < "$f" > "$tmp_file"
        mv "$tmp_file" "$f"
        adapted=$((adapted + 1))
    done

    if [ "$adapted" -gt 0 ]; then
        log_info "Parameterised hardcoded Docker host paths in $adapted legacy compose file(s) for engine portability"
    fi
}

adapt_legacy_cgroup_v1_keys() {
    local project_dir="$1"
    local -a compose_files=()
    local f

    [ -d "$project_dir" ] || return 0

    [ -f "$project_dir/docker-compose.yml" ] && compose_files+=("$project_dir/docker-compose.yml")
    for f in "$project_dir"/docker/compose/*.yml; do
        [ -f "$f" ] && compose_files+=("$f")
    done
    [ "${#compose_files[@]}" -gt 0 ] || return 0

    local stripped=0
    for f in "${compose_files[@]}"; do
        grep -qE '^[[:space:]]*mem_swappiness:' "$f" || continue

        local tmp_file
        tmp_file="$(mktemp "${f}.XXXXXX")"
        grep -vE '^[[:space:]]*mem_swappiness:' "$f" > "$tmp_file"
        mv "$tmp_file" "$f"
        stripped=$((stripped + 1))
    done

    if [ "$stripped" -gt 0 ]; then
        log_info "Stripped cgroup v1-only mem_swappiness from $stripped legacy compose file(s); cgroup v2 does not implement it"
    fi
}

adapt_legacy_compose_ssl_mount() {
    local project_dir="$1"
    local compose_file="$project_dir/docker-compose.yml"
    local legacy_mount='${SANCTUARY_SSL_DIR:-./docker/nginx/ssl}:/etc/nginx/ssl:ro'
    local compose_mount='${SANCTUARY_COMPOSE_SSL_DIR:-${SANCTUARY_SSL_DIR:-./docker/nginx/ssl}}:/etc/nginx/ssl:ro'

    [ -f "$compose_file" ] || return 0
    [ -n "${SANCTUARY_COMPOSE_SSL_DIR:-}" ] || return 0
    [ "${SANCTUARY_COMPOSE_SSL_DIR:-}" != "${SANCTUARY_SSL_DIR:-}" ] || return 0

    if grep -q 'SANCTUARY_COMPOSE_SSL_DIR' "$compose_file"; then
        return 0
    fi

    if ! grep -Fq "$legacy_mount" "$compose_file"; then
        return 0
    fi

    local tmp_file
    tmp_file="$(mktemp "${compose_file}.XXXXXX")"
    while IFS= read -r line || [ -n "$line" ]; do
        printf '%s\n' "${line//$legacy_mount/$compose_mount}"
    done < "$compose_file" > "$tmp_file"
    mv "$tmp_file" "$compose_file"

    log_info "Adapted legacy frontend SSL mount for Docker-visible CI path"
}

adapt_legacy_shared_backend_builds() {
    local project_dir="$1"
    local compose_file="$project_dir/docker-compose.yml"

    [ -f "$compose_file" ] || return 0

    local shared_services
    shared_services="$(
        awk '
            function flush_service() {
                if ((service == "worker" || service == "migrate") && has_backend_image) {
                    if (output != "") {
                        output = output ","
                    }
                    output = output service
                }
                has_backend_image = 0
            }

            /^  [^[:space:]#][^:]*:$/ {
                flush_service()
                service = $0
                sub(/^  /, "", service)
                sub(/:$/, "", service)
                next
            }

            service != "" && /^    image: sanctuary-backend:local([[:space:]]|$)/ {
                has_backend_image = 1
            }

            END {
                flush_service()
                print output
            }
        ' "$compose_file"
    )"

    [ -n "$shared_services" ] || return 0

    local tmp_file
    tmp_file="$(mktemp "${compose_file}.XXXXXX")"

    awk -v shared_services="$shared_services" '
        BEGIN {
            split(shared_services, names, ",")
            for (idx in names) {
                reuse_backend_image[names[idx]] = 1
            }
        }

        /^  [^[:space:]#][^:]*:$/ {
            service = $0
            sub(/^  /, "", service)
            sub(/:$/, "", service)
            skip_build = 0
        }

        skip_build {
            if ($0 ~ /^      / || $0 ~ /^[[:space:]]*$/) {
                next
            }
            skip_build = 0
        }

        reuse_backend_image[service] && $0 ~ /^    build:[[:space:]]*$/ {
            skip_build = 1
            next
        }

        { print }
    ' "$compose_file" > "$tmp_file"

    if cmp -s "$compose_file" "$tmp_file"; then
        rm -f "$tmp_file"
        return 0
    fi

    mv "$tmp_file" "$compose_file"
    log_info "Adapted shared backend-image services to reuse the backend build"
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
