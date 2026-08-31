#!/bin/bash
# ============================================
# Sanctuary Install Test Helpers
# ============================================
#
# Common utility functions for install tests.
# Source this file in your test scripts.
#
# Usage: source ./utils/helpers.sh
# ============================================

# Colors for output
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export CYAN='\033[0;36m'
export NC='\033[0m'

# Default timeouts (in seconds)
export CONTAINER_STARTUP_TIMEOUT="${CONTAINER_STARTUP_TIMEOUT:-300}"
export HEALTH_CHECK_TIMEOUT="${HEALTH_CHECK_TIMEOUT:-120}"
export API_RESPONSE_TIMEOUT="${API_RESPONSE_TIMEOUT:-30}"

# ============================================
# Logging Functions
# ============================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_debug() {
    if [ "${DEBUG:-false}" = "true" ]; then
        echo -e "${CYAN}[DEBUG]${NC} $1"
    fi
}

# ============================================
# Docker Helper Functions
# ============================================

resolve_compose_overlay() {
    local project_dir="$1"
    local overlay="$2"
    local canonical="$project_dir/docker/compose/$overlay.yml"
    local legacy="$project_dir/docker-compose.$overlay.yml"

    if [ -f "$canonical" ]; then
        printf '%s\n' "$canonical"
    elif [ -f "$legacy" ]; then
        printf '%s\n' "$legacy"
    else
        return 1
    fi
}

run_project_compose() {
    local project_dir="${1:-.}"
    local deployment_root overlay_file
    shift

    deployment_root="${SANCTUARY_RUNTIME_DIR:-${HOME:-}/.config/sanctuary}/ownership/deployments/${SANCTUARY_DEPLOYMENT_ID:-deploy-${SANCTUARY_PROJECT:-${COMPOSE_PROJECT_NAME:-sanctuary}}}"
    if [ -x "$project_dir/scripts/ownership/run-operator-compose.sh" ] \
        && { [ -e "$deployment_root/identity.json" ] || [ -e "$deployment_root/active-revision.json" ] \
          || [ -e "$deployment_root/pending-revision.json" ] || [ -e "$deployment_root/prepared-revision.json" ]; }; then
        "$project_dir/scripts/ownership/run-operator-compose.sh" "$@"
        return
    fi

    local -a compose_cmd=(docker compose --project-directory "$project_dir")
    if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
        compose_cmd+=(-p "$COMPOSE_PROJECT_NAME")
    fi
    compose_cmd+=(-f "$project_dir/docker-compose.yml")

    if [ "${ENABLE_MONITORING:-no}" = "yes" ] && overlay_file="$(resolve_compose_overlay "$project_dir" monitoring)"; then
        compose_cmd+=(-f "$overlay_file")
    fi

    if [ "${ENABLE_TOR:-no}" = "yes" ] && overlay_file="$(resolve_compose_overlay "$project_dir" tor)"; then
        compose_cmd+=(-f "$overlay_file")
    fi

    "${compose_cmd[@]}" "$@"
}

cleanup_docker_resources() {
    local helper_dir
    local project_root
    local cleanup_script

    helper_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    project_root="$(cd "$helper_dir/../../.." && pwd)"
    cleanup_script="$project_root/scripts/ci/cleanup-docker-resources.sh"

    [ -x "$cleanup_script" ] || return 127
    bash "$cleanup_script" "$@"
}

# Get container name for a service (supports dynamic project names)
# Usage: get_container_name "postgres" -> returns "sanctuary-postgres-1" or "{project}-postgres-1"
get_container_name() {
    local service="$1"
    local project="${COMPOSE_PROJECT_NAME:-sanctuary}"

    # Search by pattern (doesn't require env vars like docker compose ps does)
    # First try running containers, then all containers
    local container=$(docker ps --format '{{.Names}}' | grep -E "^${project}-${service}-[0-9]+$" | head -1)
    if [ -n "$container" ]; then
        echo "$container"
        return 0
    fi

    # Fallback: check all containers (including stopped)
    docker ps -a --format '{{.Names}}' | grep -E "^${project}-${service}-[0-9]+$" | head -1
}

# Execute command in a service container (handles dynamic names)
# Uses docker exec directly to avoid requiring env vars for docker compose
# Usage: compose_exec "backend" "wget -q -O - http://localhost:3001/health"
compose_exec() {
    local service="$1"
    shift
    local container=$(get_container_name "$service")
    if [ -n "$container" ]; then
        docker exec "$container" "$@"
    else
        log_error "Container for service '$service' not found"
        return 1
    fi
}

# Get logs from a service (handles dynamic names)
# Uses docker logs directly to avoid requiring env vars for docker compose
# Usage: compose_logs "backend" 50
compose_logs() {
    local service="$1"
    local lines="${2:-50}"
    local container=$(get_container_name "$service")
    if [ -n "$container" ]; then
        docker logs --tail "$lines" "$container" 2>&1
    else
        log_error "Container for service '$service' not found"
        return 1
    fi
}

# Dump the health log of every container in the project that is not healthy.
#
# Unlike capture_compose_failure_diagnostics this takes no view on whether the
# run failed: it keys off container state, which is the thing we actually want
# evidence about. That matters because gating on a TESTS_FAILED counter proved
# unreliable in the upgrade lane — run 8813's teardown executed while the
# counter read zero, so the capture never fired and the gateway's health log was
# destroyed by cleanup with nothing recorded.
#
# Self-limiting by construction: on a healthy run there are no unhealthy
# containers and this prints one line. On a failing run it prints exactly the
# containers that are worth reading.
capture_unhealthy_container_diagnostics() {
    local project="${1:-${COMPOSE_PROJECT_NAME:-sanctuary}}"
    local lines="${2:-${SANCTUARY_INSTALL_DIAGNOSTIC_LOG_LINES:-80}}"
    local health_template='{{if .State.Health}}{{range .State.Health.Log}}exit={{.ExitCode}} output={{printf "%q" .Output}}{{println}}{{end}}{{else}}no healthcheck{{end}}'
    local found=0
    local container state

    while IFS= read -r container; do
        [ -n "$container" ] || continue
        state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
            "$container" 2>/dev/null || echo unknown)"
        case "$state" in
            healthy|none) continue ;;
        esac

        found=$((found + 1))
        echo ""
        echo "=== Unhealthy container: $container (state: $state) ==="
        echo "--- healthcheck log ---"
        docker inspect -f "$health_template" "$container" 2>&1 | tail -20 || true
        echo "--- container log (tail $lines) ---"
        docker logs --tail "$lines" "$container" 2>&1 | tail -"$lines" || true
    done < <(docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Names}}' 2>/dev/null || true)

    if [ "$found" -eq 0 ]; then
        echo "No unhealthy containers in project '$project'"
    fi
}

capture_compose_failure_diagnostics() {
    local project_dir="${1:-.}"
    local lines="${2:-${SANCTUARY_INSTALL_DIAGNOSTIC_LOG_LINES:-200}}"
    local project="${COMPOSE_PROJECT_NAME:-sanctuary}"
    local services=(postgres redis worker backend migrate frontend gateway llm-egress-proxy docker-proxy mcp)
    local state_template
    local health_template

    state_template='name={{.Name}} status={{.State.Status}} running={{.State.Running}} exitCode={{.State.ExitCode}} oomKilled={{.State.OOMKilled}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} startedAt={{.State.StartedAt}} finishedAt={{.State.FinishedAt}}'
    health_template='{{if .State.Health}}{{range .State.Health.Log}}start={{.Start}} end={{.End}} exit={{.ExitCode}} output={{printf "%q" .Output}}{{println}}{{end}}{{else}}no healthcheck{{end}}'

    log_warning "Capturing pre-cleanup Docker diagnostics for project '$project'"

    (
        set +e

        echo ""
        echo "=== Failure Diagnostic Context ==="
        echo "project=$project"
        echo "project_dir=$project_dir"
        date -u '+captured_at=%Y-%m-%dT%H:%M:%SZ'

        echo ""
        echo "=== Docker Compose PS ==="
        run_project_compose "$project_dir" ps -a 2>&1 || true

        echo ""
        echo "=== Docker Containers By Compose Label ==="
        docker ps -a \
            --filter "label=com.docker.compose.project=$project" \
            --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>&1 || true

        echo ""
        echo "=== Docker Stats Snapshot ==="
        local container_ids=()
        mapfile -t container_ids < <(docker ps --filter "label=com.docker.compose.project=$project" -q 2>/dev/null || true)
        if [ "${#container_ids[@]}" -gt 0 ]; then
            docker stats --no-stream "${container_ids[@]}" 2>&1 || true
        else
            echo "no running containers"
        fi

        for service in "${services[@]}"; do
            local container
            container=$(get_container_name "$service")

            echo ""
            echo "=== Inspect: $service ==="
            if [ -z "$container" ]; then
                echo "container not found"
                continue
            fi

            docker inspect -f "$state_template" "$container" 2>&1 || true

            echo ""
            echo "=== Health Log: $service ==="
            docker inspect -f "$health_template" "$container" 2>&1 || true

            echo ""
            echo "=== Logs: $service (tail $lines) ==="
            docker logs --tail "$lines" "$container" 2>&1 || true
        done

        echo ""
        echo "=== Docker Compose Logs Tail ==="
        run_project_compose "$project_dir" logs --tail "$lines" 2>&1 || true
    ) || true
}

# Service name mappings (old hardcoded -> service name)
# sanctuary-db -> postgres
# sanctuary-backend -> backend
# sanctuary-frontend -> frontend
# sanctuary-gateway -> gateway
# sanctuary-migrate -> migrate
# sanctuary-llm-egress-proxy -> llm-egress-proxy

# Check if Docker is available and running
check_docker_available() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        return 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        return 1
    fi

    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose v2 is not available"
        return 1
    fi

    return 0
}

# Wait for a container to be running
wait_for_container_running() {
    local container_name="$1"
    local timeout="${2:-$CONTAINER_STARTUP_TIMEOUT}"
    local start_time=$(date +%s)

    log_info "Waiting for container '$container_name' to be running (timeout: ${timeout}s)..."

    while true; do
        local status=$(docker inspect -f '{{.State.Status}}' "$container_name" 2>/dev/null)

        if [ "$status" = "running" ]; then
            log_success "Container '$container_name' is running"
            return 0
        fi

        local elapsed=$(($(date +%s) - start_time))
        if [ $elapsed -ge $timeout ]; then
            log_error "Timeout waiting for container '$container_name' to be running"
            return 1
        fi

        sleep 2
    done
}

# Wait for a container to be healthy
wait_for_container_healthy() {
    local container_name="$1"
    local timeout="${2:-$HEALTH_CHECK_TIMEOUT}"
    local start_time=$(date +%s)

    log_info "Waiting for container '$container_name' to be healthy (timeout: ${timeout}s)..."

    local reported_unhealthy=false

    while true; do
        local health=$(docker inspect -f '{{.State.Health.Status}}' "$container_name" 2>/dev/null)

        if [ "$health" = "healthy" ]; then
            if [ "$reported_unhealthy" = true ]; then
                log_success "Container '$container_name' recovered and is healthy"
            else
                log_success "Container '$container_name' is healthy"
            fi
            return 0
        fi

        # `unhealthy` is not terminal. A healthcheck is retried by the engine,
        # so a service that is still starting can report unhealthy and then
        # recover — which is exactly what the gateway did on install-test run
        # 8650, logging "started with HTTPS on port 4000" two seconds after this
        # waiter had already given up. Keep polling until the timeout and let
        # the timeout branch be the single place that fails.
        if [ "$health" = "unhealthy" ] && [ "$reported_unhealthy" = false ]; then
            reported_unhealthy=true
            log_warning "Container '$container_name' is unhealthy; continuing to wait for recovery"
        fi

        local elapsed=$(($(date +%s) - start_time))
        if [ $elapsed -ge $timeout ]; then
            log_error "Timeout waiting for container '$container_name' to be healthy"
            log_error "Current health status: $health"
            docker logs "$container_name" --tail 50 2>&1 | head -20
            return 1
        fi

        sleep 3
    done
}

# Wait for all Sanctuary containers to be healthy
wait_for_all_containers_healthy() {
    local timeout="${1:-$CONTAINER_STARTUP_TIMEOUT}"

    log_info "Waiting for all Sanctuary containers to be healthy..."

    local services=("postgres" "backend" "frontend" "gateway")

    for service in "${services[@]}"; do
        local container=$(get_container_name "$service")
        if [ -z "$container" ]; then
            log_error "Container for service '$service' not found"
            return 1
        fi
        if ! wait_for_container_healthy "$container" "$timeout"; then
            return 1
        fi
    done

    log_success "All Sanctuary containers are healthy"
    return 0
}

# Get container status summary
get_container_status() {
    local project_dir="${1:-.}"
    local project="${COMPOSE_PROJECT_NAME:-sanctuary}"

    echo ""
    echo "Container Status:"
    echo "================="
    run_project_compose "$project_dir" ps 2>/dev/null || \
        docker ps --filter "name=${project}-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
}

# Stop and remove all Sanctuary containers
cleanup_containers() {
    local project_dir="${1:-.}"
    local project="${COMPOSE_PROJECT_NAME:-}"

    if [ -z "$project" ]; then
        log_error "cleanup_containers refused: COMPOSE_PROJECT_NAME must be set explicitly to a test-only name"
        log_error "  Refusing to default to 'sanctuary' — that would wipe production volumes."
        return 1
    fi
    if [ "$project" = "sanctuary" ]; then
        log_error "cleanup_containers refused: project name 'sanctuary' is protected"
        log_error "  Tests must use a unique COMPOSE_PROJECT_NAME (e.g. sanctuary-test-\$RUN_ID)."
        return 1
    fi

    log_info "Cleaning up Sanctuary containers (project: $project)..."

    (
        cd "$project_dir"
        if [ -n "${SANCTUARY_ENV_FILE:-}" ] && [ -f "$SANCTUARY_ENV_FILE" ]; then
            set -a
            source "$SANCTUARY_ENV_FILE"
            set +a
        elif [ -f "$project_dir/.env" ]; then
            set -a
            source "$project_dir/.env"
            set +a
        fi
        run_project_compose "$project_dir" down -v --remove-orphans 2>/dev/null || true
    )

    # The Grafana quiescence coordinator creates its migration and control-helper
    # containers directly with `podman create` (run-grafana-password-migration.sh,
    # grafana-quiescence-records.sh), labelled sanctuary.grafana.* rather than as
    # compose services -- so the `compose down --remove-orphans` above is
    # structurally unable to see them.
    #
    # v0.8.64-rc4 failed on exactly that gap. The baseline install lost the podman
    # terminal-state race, the harness retried and recovered, but the orphaned
    # migration container survived into the upgrade phase. The upgrade rebuilds the
    # migration image, and validate_migration_identity() compares
    # `image = $migration_image_id`, so a container left over from the previous
    # image can never be reconciled: the upgrade died with "the reserved migration
    # container has an unexpected identity" and took the whole optional-profiles
    # fixture with it.
    #
    # Sweep by label, not by name: it catches the migration container and the
    # control helpers alike and survives any future rename. Scoped to this
    # project, so it inherits the production-volume guard above.
    local grafana_cid
    while read -r grafana_cid; do
        [ -n "$grafana_cid" ] || continue
        docker rm -f "$grafana_cid" >/dev/null 2>&1 || true
    done < <(docker ps -aq --filter "label=sanctuary.grafana.project=$project" 2>/dev/null || true)

    cleanup_docker_resources --project "$project" 2>/dev/null || true

    log_success "Cleanup complete"
}

cleanup_compose_project_resources() {
    local project="$1"

    [ -n "$project" ] || return 0

    cleanup_docker_resources --project "$project" 2>/dev/null || true
}

disable_compose_project_restart_policy() {
    local project="$1"

    [ -n "$project" ] || return 0

    docker ps -a --filter "label=com.docker.compose.project=$project" -q | xargs -r docker update --restart=no 2>/dev/null || true
}

# Diagnostic for #660. The optional-profiles lane fails in CI with a bare
# "not a directory" mount error on docker/monitoring/loki-config.yml, which is
# what Docker reports when the bind source is absent: it creates the missing
# path as a directory, which then cannot mount onto a file in the image. The
# lane passes locally, so the open question is whether the file is missing from
# the job's filesystem or merely invisible to the Docker daemon.
#
# Mounts the project root read-only and lists the subpath from inside, so the
# probe cannot itself create the directory it is looking for. Never fails the
# caller -- it only reports.
probe_monitoring_bind_sources() {
    local project_dir="$1"
    local rel="docker/monitoring"

    # Carry the seeding outcome into the failure tail. The seeding itself runs
    # at lane start, far outside the 256 KiB the diagnostic summary echoes.
    printf '[probe] monitoring config seeding: %s\n' "${SYNC_MONITORING_STATUS:-unset}" >&2

    printf '[probe] job view of %s/%s:\n' "$project_dir" "$rel" >&2
    ls -la "$project_dir/$rel" >&2 2>&1 ||
        printf '[probe] job view: MISSING\n' >&2

    printf '[probe] daemon view of %s (mounted ro):\n' "$rel" >&2
    docker run --rm -v "$project_dir:/probe:ro" alpine:3 \
        ls -la "/probe/$rel" >&2 2>&1 ||
        printf '[probe] daemon view: MISSING or unavailable\n' >&2

    return 0
}

# CI shim for #660. On the Forgejo runner the job and the DIND daemon do not
# share a filesystem, so a bind mount of an individual config file fails: the
# daemon resolves the host path against its own filesystem, finds nothing,
# auto-creates the source as a *directory*, then cannot mount that onto a file
# in the image. Confirmed by probe_monitoring_bind_sources -- every *.yml is a
# file job-side and a directory daemon-side.
#
# Seed the daemon-side copies from the job side before the stack starts, so the
# compose files themselves stay exactly as production ships them.
#
# A no-op where the two already share a filesystem (local runs): the cleanup
# only removes directories named *.yml, which never exist when the real files
# are present, and the tar extract rewrites identical content.
#
# The proper fix is to mount the runner workspace into the DIND container at
# the same path; this only stops a runner misconfiguration from masking real
# upgrade regressions.
SYNC_MONITORING_STATUS="not attempted"

# Resolve a daemon-visible path for the monitoring configs, or echo the input
# unchanged when no translation is available.
#
# The overlay bind-mounts config files from the project directory. Compose
# resolves those against the project dir, which inside a CI job is /workspace/...
# — visible to the job container, not to the engine. docker_visible_path reads
# the job container's own mount table, so where the workspace is a host bind
# mount (rootless Podman) it yields the real host path and the engine can read
# the files directly. This is how the SSL directory has always been handled.
monitoring_config_dir_for_compose() {
    local project_dir="$1"
    local src="$project_dir/docker/monitoring"

    [ -d "$src" ] || { printf '%s\n' "$src"; return 0; }
    docker_visible_path "$src" 2>/dev/null || printf '%s\n' "$src"
}

tor_ingress_config_for_compose() {
    local project_dir="$1"
    local src="$project_dir/docker/tor/payjoin-ingress.conf"

    [ -f "$src" ] || { printf '%s\n' "$src"; return 0; }
    docker_visible_path "$src" 2>/dev/null || printf '%s\n' "$src"
}

sync_monitoring_configs_to_daemon() {
    local project_dir="$1"
    local src="$project_dir/docker/monitoring"
    local cid=""

    if [ ! -d "$src" ]; then
        SYNC_MONITORING_STATUS="skipped: $src absent job-side"
        return 0
    fi

    # When the engine can already read the configs at a translated host path,
    # copying them somewhere else is unnecessary — and on rootless Podman the
    # copy cannot work anyway: the helper container's bind mount fails with
    # "mkdir /workspace: permission denied", the same error the shim exists to
    # avoid. Stand down and let the compose mount use the real path.
    if [ -n "${SANCTUARY_MONITORING_CONFIG_DIR:-}" ] &&
       [ "${SANCTUARY_MONITORING_CONFIG_DIR}" != "$src" ]; then
        SYNC_MONITORING_STATUS="skipped: configs reachable at ${SANCTUARY_MONITORING_CONFIG_DIR}"
        printf '[sync] %s\n' "$SYNC_MONITORING_STATUS" >&2
        return 0
    fi

    # A long-lived helper holds the bind mount open. docker cp into a *running*
    # container writes through an active bind mount, which a piped `tar` into a
    # throwaway container did not reliably do -- the first attempt at this
    # silently produced nothing and, because its output was suppressed, gave no
    # indication of why.
    if ! cid="$(docker run -d -v "$project_dir/docker:/dst" alpine:3 sleep 300 2>&1)"; then
        SYNC_MONITORING_STATUS="failed: helper container did not start: $cid"
        return 0
    fi

    # Clear the bogus directories Docker auto-created for earlier failed mounts.
    # Only ever matches daemon-side wreckage: a real config is never a directory.
    docker exec "$cid" sh -c \
        'find /dst/monitoring -maxdepth 1 -type d -name "*.yml" -exec rm -rf {} + 2>/dev/null; mkdir -p /dst/monitoring' \
        2>&1 || true

    if docker cp "$src/." "$cid:/dst/monitoring/" 2>&1; then
        SYNC_MONITORING_STATUS="copied $(find "$src" -type f | wc -l) file(s) to daemon"
    else
        SYNC_MONITORING_STATUS="failed: docker cp into $cid"
    fi

    docker rm -f "$cid" >/dev/null 2>&1 || true

    printf '[sync] %s\n' "$SYNC_MONITORING_STATUS" >&2
    return 0
}

read_package_version() {
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" 2>/dev/null | head -1
}

# Give this lane its own image tag, so concurrent lanes on one daemon cannot
# alias each other's images.
#
# The `:local` tags carry no ref. Every lane on a runner shared them, and
# `pull_policy: build` skips the build whenever the tag already exists, so a
# lane installing an OLD ref could boot the image a concurrent lane had just
# built from the NEW one. purge_shared_local_images() below narrowed the window
# but could not close it: purging is a point-in-time act, and the other workflow
# rebuilds the same tag whenever it likes. install-test.yml and
# release-candidate.yml both fire on an RC tag by design, so the race is
# structural rather than occasional (#719).
#
# COMPOSE_PROJECT_NAME is already unique per lane, so reuse it as the tag rather
# than inventing a second identity that could drift from it. Docker tags allow
# [A-Za-z0-9_][A-Za-z0-9._-]* up to 128 chars; project names are lowercase
# alphanumerics and hyphens, but sanitise anyway so a caller-supplied name can
# never produce an invalid tag and an unreadable compose error.
#
# Unset or empty leaves SANCTUARY_IMAGE_TAG alone, so operator installs and the
# offline bundle keep using `:local` exactly as before.
export_lane_image_tag() {
    local project="${COMPOSE_PROJECT_NAME:-}"
    [ -n "$project" ] || return 0

    local tag
    tag="$(printf '%s' "$project" | tr -c 'A-Za-z0-9._-' '-' | cut -c1-128)"
    # A tag may not start with a separator.
    case "$tag" in
        [A-Za-z0-9_]*) ;;
        *) tag="x${tag}" ;;
    esac

    export SANCTUARY_IMAGE_TAG="$tag"
}

initialize_install_test_ownership() {
    local identity_root="${TARGET_PROJECT_ROOT:-${PROJECT_ROOT:-}}"
    if [ -z "$identity_root" ] || [ ! -f "$identity_root/scripts/ownership/producer-hooks.sh" ]; then
        log_error "Current checkout ownership producer hook is unavailable"
        return 1
    fi

    # Source the current harness even while an upgrade fixture temporarily
    # points PROJECT_ROOT at a historical checkout that predates ownership.
    # shellcheck source=scripts/ownership/producer-hooks.sh
    source "$identity_root/scripts/ownership/producer-hooks.sh"
    SANCTUARY_PROJECT="${SANCTUARY_PROJECT:-${COMPOSE_PROJECT_NAME:-sanctuary-install-test}}"
    SANCTUARY_PROJECT_DIR="$identity_root"
    export SANCTUARY_PROJECT SANCTUARY_PROJECT_DIR
    ownership_initialize_build_identity
}

initialize_install_test_ownership_for_root() {
    local checkout_root="$1"
    local identity_root="${TARGET_PROJECT_ROOT:-${PROJECT_ROOT:-}}"
    # Always use the current harness implementation, including when the source
    # checkout predates ownership support.
    # shellcheck source=scripts/ownership/producer-hooks.sh
    source "$identity_root/scripts/ownership/producer-hooks.sh"
    unset SANCTUARY_RELEASE SANCTUARY_COMMIT SANCTUARY_SOURCE_COMMIT
    unset SANCTUARY_IMAGE_LOCK_SHA256 SANCTUARY_VERSION SANCTUARY_BUILD_ID
    SANCTUARY_PROJECT_DIR="$checkout_root"
    export SANCTUARY_PROJECT_DIR
    ownership_initialize_build_identity
}

# Drop this lane's images before installing a checkout so its build cannot be
# short-circuited by a stale image of the same tag. With per-lane tags this is
# now belt-and-braces rather than the primary defence, but it still matters when
# a lane installs two checkouts in sequence (source then target) under one
# project name. Layer cache is untouched, so this stays cheap.
purge_shared_local_images() {
    local tag="${SANCTUARY_IMAGE_TAG:-}"

    # Fail closed on the tag, because the tag is the entire safety boundary.
    #
    # `docker image rm -f` means two different things on the two engines. On
    # Docker it untags. On rootless Podman -- what the runners actually run since
    # #668 -- `rmi --force` STOPS AND DELETES every container using the image,
    # across all projects, not just this lane's. Verified on Podman 5.4.2:
    #
    #   podman image rm -f solo-probe:local
    #     StopSignal SIGTERM failed to stop container ... resorting to SIGKILL
    #     Deleted: bf0226b4953f...
    #
    # So purging the shared `:local` tag destroys any concurrent lane's live
    # stack. That is what removed backend and migrate from run 9110 while
    # postgres survived (#739): a lane purged `sanctuary-*:local` at 08:01:33,
    # inside another lane's unlocked window.
    #
    # A lane-scoped tag is by construction used only by this lane, so requiring
    # one makes the blast radius this lane. `:local` is the legitimate operator
    # default in docker-compose.yml and must keep working there -- it is purging
    # it that is unsafe, never using it.
    if [ -z "$tag" ] || [ "$tag" = "local" ]; then
        log_error "Refusing to purge images for tag '${tag:-<unset>}'"
        log_error "purge_shared_local_images force-removes images, and on rootless Podman that"
        log_error "deletes running containers using them in EVERY project, not just this lane."
        log_error "Call export_lane_image_tag first so the purge is scoped to this lane."
        return 1
    fi

    # Not silenced. The previous version ended in `>/dev/null 2>&1 || true`, so
    # the single most destructive operation in the harness left no trace in any
    # diagnostic -- which is why #730 could rule out every other candidate and
    # still not find it.
    local output status=0
    output="$(docker image rm -f \
        "sanctuary-backend:${tag}" \
        "sanctuary-frontend:${tag}" \
        "sanctuary-gateway:${tag}" \
        "sanctuary-llm-egress-proxy:${tag}" 2>&1)" || status=$?

    log_info "Purged lane images for tag '${tag}' (exit ${status})"
    [ -n "$output" ] && printf '%s\n' "$output" | sed 's/^/  [purge] /'

    # A missing image is the normal first-run case, not an error.
    return 0
}

# Guard against an install running an image built from a different ref.
#
# `sanctuary-backend:local` is unversioned and shared by every lane on a
# runner, and `pull_policy: build` only builds when the image is absent, so a
# later lane can silently reuse an earlier lane's image. When that happens the
# old-version install boots new-version code and dies on a config validation
# error for an env var its own installer never generated -- surfacing only as a
# generic "container unhealthy" timeout that says nothing about the real cause.
# Compare the built image against the checkout so the failure names itself.
assert_installed_image_matches_checkout() {
    local project_dir="$1"
    local image="${2:-sanctuary-backend:${SANCTUARY_IMAGE_TAG:-local}}"
    local expected actual

    [ -f "$project_dir/package.json" ] || return 0
    expected="$(read_package_version "$project_dir/package.json")"
    [ -n "$expected" ] || return 0

    actual="$(docker run --rm --entrypoint cat "$image" /app/package.json 2>/dev/null | read_package_version /dev/stdin)"
    [ -n "$actual" ] || return 0

    if [ "$expected" != "$actual" ]; then
        # Plain stderr, not log_error: this helper is sourced by contexts that
        # do not define the logging helpers.
        printf '[ERROR] Image %s reports version %s but the checkout is %s\n' \
            "$image" "$actual" "$expected" >&2
        printf '[ERROR] The build reused an image or layer cache from a different ref.\n' >&2
        printf '[ERROR] Checkout: %s\n' "$project_dir" >&2
        return 1
    fi

    return 0
}

# Rewrite only an isolated test checkout so historical Compose files that do
# not support SANCTUARY_RESTART_POLICY cannot create restartable containers.
# The caller must pass a disposable test workspace, never a production checkout.
force_test_compose_restart_policy_no() {
    local project_dir="$1"
    local relative_path
    local compose_file
    local compose_paths=(
        docker-compose.yml
        docker-compose.ghcr.yml
        docker-compose.monitoring.yml
        docker-compose.tor.yml
        docker/compose/monitoring.yml
        docker/compose/tor.yml
    )

    for relative_path in "${compose_paths[@]}"; do
        compose_file="$project_dir/$relative_path"
        [ -f "$compose_file" ] || continue
        sed -i -E 's/^([[:space:]]*restart:).*/\1 "no"/' "$compose_file"
    done
}

cleanup_compose_projects_by_prefix() {
    local prefix="$1"
    local exclude_project="${2:-}"

    [ -n "$prefix" ] || return 0

    if [ -n "$exclude_project" ]; then
        cleanup_docker_resources --prefix "$prefix" --exclude-project "$exclude_project" 2>/dev/null || true
    else
        cleanup_docker_resources --prefix "$prefix" 2>/dev/null || true
    fi
}

# ============================================
# HTTP/API Helper Functions
# ============================================

# Wait for an HTTP endpoint to respond
wait_for_http_endpoint() {
    local url="$1"
    local timeout="${2:-$API_RESPONSE_TIMEOUT}"
    local expected_status="${3:-200}"
    local start_time=$(date +%s)

    log_info "Waiting for HTTP endpoint $url (timeout: ${timeout}s)..."

    while true; do
        local status_code=$(curl -k -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")

        if [ "$status_code" = "$expected_status" ]; then
            log_success "HTTP endpoint $url is responding with status $status_code"
            return 0
        fi

        local elapsed=$(($(date +%s) - start_time))
        if [ $elapsed -ge $timeout ]; then
            log_error "Timeout waiting for HTTP endpoint $url"
            log_error "Last status code: $status_code"
            return 1
        fi

        sleep 2
    done
}

# Make an API request and return the response
api_request() {
    local method="$1"
    local endpoint="$2"
    local data="${3:-}"
    local token="${4:-}"
    local base_url="${API_BASE_URL:-https://localhost:8443}"

    local curl_opts=("-k" "-s" "-X" "$method")

    if [ -n "$token" ]; then
        curl_opts+=("-H" "Authorization: Bearer $token")
    fi

    curl_opts+=("-H" "Content-Type: application/json")

    if [ -n "$data" ]; then
        curl_opts+=("-d" "$data")
    fi

    curl "${curl_opts[@]}" "${base_url}${endpoint}"
}

# Login and get auth token
login_and_get_token() {
    local username="$1"
    local password="$2"
    local base_url="${API_BASE_URL:-https://localhost:8443}"

    local response=$(curl -k -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"password\":\"$password\"}" \
        "${base_url}/api/v1/auth/login")

    # Extract token from response
    echo "$response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4
}

# Check if user needs to change password (usingDefaultPassword flag)
check_using_default_password() {
    local username="$1"
    local password="$2"
    local base_url="${API_BASE_URL:-https://localhost:8443}"

    local response=$(curl -k -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"password\":\"$password\"}" \
        "${base_url}/api/v1/auth/login")

    # Check if response contains usingDefaultPassword: true
    if echo "$response" | grep -q '"usingDefaultPassword":true'; then
        return 0  # true - using default password
    else
        return 1  # false - not using default password
    fi
}

# Change user password
change_password() {
    local token="$1"
    local current_password="$2"
    local new_password="$3"
    local base_url="${API_BASE_URL:-https://localhost:8443}"

    local response=$(curl -k -s -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $token" \
        -d "{\"currentPassword\":\"$current_password\",\"newPassword\":\"$new_password\"}" \
        "${base_url}/api/v1/auth/me/change-password")

    echo "$response"
}

# ============================================
# File System Helper Functions
# ============================================

# Create a clean test directory
create_test_directory() {
    local base_dir="${1:-/tmp}"
    local prefix="${2:-sanctuary-test}"

    mkdir -p "$base_dir"
    local test_dir=$(mktemp -d "${base_dir}/${prefix}-XXXXXX")
    echo "$test_dir"
}

# Pick a default install-test scratch root. Forgejo/GitHub Actions jobs that
# mount the host Docker socket must use the checked-out workspace so Docker can
# see bind-mounted certs, env files, and temporary worktrees.
default_install_test_root() {
    local project_root="${1:-${PROJECT_ROOT:-.}}"

    if [ -n "${SANCTUARY_INSTALL_TEST_ROOT:-}" ]; then
        echo "$SANCTUARY_INSTALL_TEST_ROOT"
        return 0
    fi

    if [ -n "${GITHUB_WORKSPACE:-}" ]; then
        echo "${GITHUB_WORKSPACE%/}/.tmp/$(install_test_root_name)"
        return 0
    fi

    if [ "${ACT:-false}" = "true" ]; then
        echo "${project_root%/}/.tmp/$(install_test_root_name)"
        return 0
    fi

    case "${project_root%/}" in
        /workspace/*)
            echo "${project_root%/}/.tmp/$(install_test_root_name)"
            return 0
            ;;
    esac

    echo "/tmp"
}

sanitize_install_test_root_segment() {
    local value="${1:-local}"

    value="$(printf '%s' "$value" | LC_ALL=C tr -c 'A-Za-z0-9_.-' '-')"
    value="${value#-}"
    value="${value%-}"

    if [ -z "$value" ]; then
        value="local"
    fi

    echo "$value"
}

install_test_root_name() {
    local run_id="${GITHUB_RUN_ID:-${GITHUB_RUN_NUMBER:-local}}"
    local uid

    uid="$(id -u 2>/dev/null || echo "user")"
    echo "install-tests-$(sanitize_install_test_root_segment "$run_id")-$(sanitize_install_test_root_segment "$uid")"
}

docker_visible_path() {
    local container_path="${1:-}"

    if [ -z "$container_path" ]; then
        return 1
    fi

    if ! command -v docker >/dev/null 2>&1 || [ -z "${HOSTNAME:-}" ]; then
        echo "$container_path"
        return 0
    fi

    local mount_lines
    if ! mount_lines=$(docker inspect --format '{{range .Mounts}}{{printf "%s\t%s\n" .Source .Destination}}{{end}}' "$HOSTNAME" 2>/dev/null); then
        echo "$container_path"
        return 0
    fi

    local normalized_path="${container_path%/}"
    local best_source=""
    local best_destination=""
    local best_length=0
    local source destination

    while IFS=$'\t' read -r source destination; do
        [ -n "$source" ] && [ -n "$destination" ] || continue
        destination="${destination%/}"

        if [ "$normalized_path" = "$destination" ] || [[ "$normalized_path" == "$destination/"* ]]; then
            if [ "${#destination}" -gt "$best_length" ]; then
                best_source="$source"
                best_destination="$destination"
                best_length="${#destination}"
            fi
        fi
    done <<< "$mount_lines"

    if [ -n "$best_source" ]; then
        local relative_path="${normalized_path#$best_destination}"
        echo "${best_source%/}${relative_path}"
        return 0
    fi

    echo "$container_path"
}

docker_host_gateway() {
    local gateway_hex
    gateway_hex=$(awk '$2 == "00000000" { print $3; exit }' /proc/net/route 2>/dev/null || true)

    if [[ ! "$gateway_hex" =~ ^[0-9A-Fa-f]{8}$ ]]; then
        return 1
    fi

    printf '%d.%d.%d.%d\n' \
        "$((16#${gateway_hex:6:2}))" \
        "$((16#${gateway_hex:4:2}))" \
        "$((16#${gateway_hex:2:2}))" \
        "$((16#${gateway_hex:0:2}))"
}

# Docker writes /.dockerenv; Podman writes /run/.containerenv. Checking only the
# Docker marker made a rootless Podman job look uncontainerised and fall back to
# loopback, where the published port is not reachable (see #667). The paths are
# overridable so both branches are testable.
is_containerized_runtime() {
    local docker_marker="${SANCTUARY_CONTAINER_MARKER_DOCKER:-/.dockerenv}"
    local podman_marker="${SANCTUARY_CONTAINER_MARKER_PODMAN:-/run/.containerenv}"

    [ -f "$docker_marker" ] || [ -f "$podman_marker" ]
}

default_install_test_host() {
    if [ -n "${SANCTUARY_INSTALL_TEST_HOST:-}" ]; then
        echo "$SANCTUARY_INSTALL_TEST_HOST"
        return 0
    fi

    if ! is_containerized_runtime; then
        echo "localhost"
        return 0
    fi

    # host.containers.internal is Podman's name for the host; host.docker.internal
    # is Docker's. Only one resolves on any given engine, so try both.
    local host_alias host_internal
    for host_alias in host.containers.internal host.docker.internal; do
        host_internal=$(getent hosts "$host_alias" 2>/dev/null | awk 'NR == 1 { print $1 }')
        if [ -n "$host_internal" ]; then
            echo "$host_internal"
            return 0
        fi
    done

    docker_host_gateway || echo "localhost"
}

# Check if file contains expected content
file_contains() {
    local file="$1"
    local pattern="$2"

    if [ -f "$file" ] && grep -q "$pattern" "$file"; then
        return 0
    else
        return 1
    fi
}

# ============================================
# Test Assertion Functions
# ============================================

assert_equals() {
    local expected="$1"
    local actual="$2"
    local message="${3:-Values should be equal}"

    if [ "$expected" = "$actual" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  Expected: '$expected'"
        log_error "  Actual:   '$actual'"
        return 1
    fi
}

assert_not_empty() {
    local value="$1"
    local message="${2:-Value should not be empty}"

    if [ -n "$value" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        return 1
    fi
}

assert_file_exists() {
    local file="$1"
    local message="${2:-File should exist}"

    if [ -f "$file" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  File not found: $file"
        return 1
    fi
}

assert_directory_exists() {
    local dir="$1"
    local message="${2:-Directory should exist}"

    if [ -d "$dir" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  Directory not found: $dir"
        return 1
    fi
}

assert_http_status() {
    local url="$1"
    local expected_status="$2"
    local message="${3:-HTTP status should match}"

    local actual_status=$(curl -k -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")

    if [ "$actual_status" = "$expected_status" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  Expected status: $expected_status"
        log_error "  Actual status:   $actual_status"
        return 1
    fi
}

assert_container_healthy() {
    local container_name="$1"
    local message="${2:-Container should be healthy}"

    local health=$(docker inspect -f '{{.State.Health.Status}}' "$container_name" 2>/dev/null)

    if [ "$health" = "healthy" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  Container: $container_name"
        log_error "  Health status: $health"
        return 1
    fi
}

assert_container_running() {
    local container_name="$1"
    local message="${2:-Container should be running}"

    local status=$(docker inspect -f '{{.State.Status}}' "$container_name" 2>/dev/null)

    if [ "$status" = "running" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  Container: $container_name"
        log_error "  Status: $status"
        return 1
    fi
}

assert_json_contains() {
    local json="$1"
    local key="$2"
    local expected_value="$3"
    local message="${4:-JSON should contain expected value}"

    # Extract value using grep (simple approach)
    local actual_value=$(echo "$json" | grep -o "\"$key\":[^,}]*" | cut -d':' -f2 | tr -d '"' | tr -d ' ')

    if [ "$actual_value" = "$expected_value" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  Key: $key"
        log_error "  Expected: $expected_value"
        log_error "  Actual: $actual_value"
        return 1
    fi
}

# ============================================
# Test Environment Setup
# ============================================

# Generate a unique test run ID
generate_test_run_id() {
    echo "test-$(date +%Y%m%d-%H%M%S)-$$"
}

# Export test environment variables
setup_test_environment() {
    local test_id="${1:-$(generate_test_run_id)}"

    export TEST_RUN_ID="$test_id"
    export HTTPS_PORT="${HTTPS_PORT:-8443}"
    export HTTP_PORT="${HTTP_PORT:-8080}"
    export API_BASE_URL="https://$(default_install_test_host):${HTTPS_PORT}"

    log_info "Test environment setup complete"
    log_info "  TEST_RUN_ID: $TEST_RUN_ID"
    log_info "  API_BASE_URL: $API_BASE_URL"
}

# ============================================
# Migration Container Helpers
# ============================================

# Wait for migration container to complete
wait_for_migration_complete() {
    local timeout="${1:-120}"
    local start_time=$(date +%s)

    log_info "Waiting for database migration to complete (timeout: ${timeout}s)..."

    # Get migrate container name dynamically
    local migrate_container=$(get_container_name "migrate")
    if [ -z "$migrate_container" ]; then
        log_warning "Migrate container not found, checking by pattern..."
        migrate_container=$(docker ps -a --format '{{.Names}}' | grep -E '.*-migrate-[0-9]+$' | head -1)
    fi

    if [ -z "$migrate_container" ]; then
        log_error "Could not find migrate container"
        return 1
    fi

    while true; do
        # Check if migrate container exists and has finished
        local status=$(docker inspect -f '{{.State.Status}}' "$migrate_container" 2>/dev/null || echo "not_found")

        if [ "$status" = "exited" ]; then
            local exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$migrate_container" 2>/dev/null)
            if [ "$exit_code" = "0" ]; then
                log_success "Database migration completed successfully"
                return 0
            else
                log_error "Database migration failed with exit code: $exit_code"
                docker logs "$migrate_container" 2>&1 | tail -20
                return 1
            fi
        fi

        local elapsed=$(($(date +%s) - start_time))
        if [ $elapsed -ge $timeout ]; then
            log_error "Timeout waiting for database migration"
            return 1
        fi

        sleep 3
    done
}

# ============================================
# Database Helpers
# ============================================

# Check if admin user exists in database
check_admin_user_exists() {
    local service="${1:-postgres}"
    local max_attempts=15
    local attempt=1

    log_debug "Checking for admin user in database (max $max_attempts attempts)..."

    # Get container name for the service
    local container=$(get_container_name "$service")
    if [ -z "$container" ]; then
        log_debug "Container not found for service '$service', using direct compose exec"
        container="$service"
    fi

    # Retry multiple times since seeding might still be completing
    # Total wait time: up to 45 seconds (15 attempts × 3 seconds)
    while [ $attempt -le $max_attempts ]; do
        # Capture both stdout and stderr for debugging
        local result
        local error
        result=$(compose_exec postgres psql -U sanctuary -d sanctuary -t -c \
            "SELECT COUNT(*) FROM users WHERE username = 'admin';" 2>&1)
        local exit_code=$?

        # Clean up whitespace from result
        result=$(echo "$result" | tr -d ' \n\r\t')

        log_debug "Attempt $attempt: psql exit=$exit_code, result='$result'"

        # Check for successful query with count of 1
        if [ "$exit_code" = "0" ] && [ "$result" = "1" ]; then
            log_debug "Admin user found on attempt $attempt"
            return 0
        fi

        # If we got a number but it's 0, the table exists but user doesn't
        if [ "$exit_code" = "0" ] && [ "$result" = "0" ]; then
            log_debug "Table exists but admin user not found yet"
        fi

        # If result contains error text, log it
        if echo "$result" | grep -qi "error\|does not exist"; then
            log_debug "Query error: $result"
        fi

        if [ $attempt -lt $max_attempts ]; then
            sleep 3
        fi
        attempt=$((attempt + 1))
    done

    log_debug "Admin user not found after $max_attempts attempts"
    return 1
}

# Check if default password marker exists
check_default_password_marker() {
    local service="${1:-postgres}"

    local result=$(compose_exec postgres psql -U sanctuary -d sanctuary -t -c \
        "SELECT COUNT(*) FROM system_settings WHERE key LIKE 'initialPassword_%';" 2>/dev/null | tr -d ' ')

    if [ "$result" -ge "1" ]; then
        return 0
    else
        return 1
    fi
}

# ============================================
# Cleanup trap handler
# ============================================

# Set up cleanup traps for interrupted test runs.
setup_cleanup_trap() {
    local cleanup_func="${1:-cleanup_containers}"
    local project_dir="${2:-.}"

    trap "log_warning 'Caught signal, cleaning up...'; $cleanup_func '$project_dir'; exit 1" INT TERM
}

# Set up cleanup traps for interrupted and ordinary exit paths.
setup_exit_cleanup_trap() {
    local cleanup_func="${1:-cleanup_containers}"
    local project_dir="${2:-.}"

    setup_cleanup_trap "$cleanup_func" "$project_dir"
    trap "status=\$?; $cleanup_func '$project_dir'; trap - EXIT; exit \$status" EXIT
}

clear_cleanup_trap() {
    trap - INT TERM EXIT
}
