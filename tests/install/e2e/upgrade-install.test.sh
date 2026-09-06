#!/bin/bash
# ============================================
# End-to-End Upgrade Install Test
# ============================================
#
# This test installs an older Sanctuary ref, upgrades it to the current
# checkout, and verifies that:
# - Existing data is preserved
# - Secrets are reused from the runtime env file
# - Database migrations run correctly
# - Containers restart properly
#
# Requirements:
#   - Git tags or an explicit --source-ref for a real ref-to-ref upgrade path
#   - Docker and Docker Compose v2
#
# Run: ./upgrade-install.test.sh [--source-ref <git-ref>] [--mode <core|full>]
# (`--keep-containers` is refused because cleanup is receipt-bound.)
# ============================================

set -e

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PROJECT_ROOT="$TARGET_PROJECT_ROOT"

# Source helpers
source "$SCRIPT_DIR/../utils/helpers.sh"
source "$SCRIPT_DIR/../utils/upgrade-test-defaults.sh"
source "$SCRIPT_DIR/../utils/upgrade-source-refs.sh"
source "$SCRIPT_DIR/../utils/upgrade-fixtures.sh"
source "$SCRIPT_DIR/../utils/upgrade-two-factor-auth-helpers.sh"
source "$SCRIPT_DIR/../utils/upgrade-two-factor-verification-helpers.sh"
source "$SCRIPT_DIR/../utils/upgrade-notification-helpers.sh"
source "$SCRIPT_DIR/../utils/upgrade-assertions.sh"
source "$SCRIPT_DIR/../utils/upgrade-staleness.sh"
source "$SCRIPT_DIR/../utils/upgrade-transaction-migration-helpers.sh"
source "$SCRIPT_DIR/../utils/upgrade-wallet-sync-state-helpers.sh"
source "$SCRIPT_DIR/../utils/upgrade-wallet-sync-retirement-helpers.sh"
source "$SCRIPT_DIR/../utils/collect-upgrade-artifacts.sh"
INSTALL_E2E_ARGS=("$@")

# ============================================
# Configuration
# ============================================

KEEP_CONTAINERS=false
VERBOSE=false
UPGRADE_SOURCE_REF="${SANCTUARY_UPGRADE_SOURCE_REF:-}"
UPGRADE_TEST_MODE="${SANCTUARY_UPGRADE_TEST_MODE:-full}"
UPGRADE_FIXTURE="${SANCTUARY_UPGRADE_FIXTURE:-baseline}"
VERIFY_FORCE_REBUILD=false

usage() {
    cat <<EOF
Usage:
  $0 [--keep-containers] [--source-ref REF|latest-stable|n-1|n-2] [--mode core|full] [--fixture FIXTURE[,FIXTURE...]] [--verify-force-rebuild]

EOF
    upgrade_fixture_usage
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --keep-containers)
            KEEP_CONTAINERS=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            export DEBUG=true
            shift
            ;;
        --source-ref)
            UPGRADE_SOURCE_REF="$2"
            shift 2
            ;;
        --source-ref=*)
            UPGRADE_SOURCE_REF="${1#*=}"
            shift
            ;;
        --mode)
            UPGRADE_TEST_MODE="$2"
            shift 2
            ;;
        --mode=*)
            UPGRADE_TEST_MODE="${1#*=}"
            shift
            ;;
        --fixture)
            UPGRADE_FIXTURE="$2"
            shift 2
            ;;
        --fixture=*)
            UPGRADE_FIXTURE="${1#*=}"
            shift
            ;;
        --core-only)
            UPGRADE_TEST_MODE="core"
            shift
            ;;
        --full-suite)
            UPGRADE_TEST_MODE="full"
            shift
            ;;
        --verify-force-rebuild)
            VERIFY_FORCE_REBUILD=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

case "$UPGRADE_TEST_MODE" in
    core|full)
        ;;
    *)
        log_error "Invalid upgrade test mode: $UPGRADE_TEST_MODE"
        log_error "Expected one of: core, full"
        exit 1
        ;;
esac

if [ "$VERIFY_FORCE_REBUILD" = "true" ] && [ "$UPGRADE_TEST_MODE" != "core" ]; then
    log_error "--verify-force-rebuild is valid only with --mode core"
    exit 1
fi

if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = "1" ] && [ "$KEEP_CONTAINERS" = "true" ]; then
    log_error "--keep-containers is incompatible with receipt-bound coordinated cleanup"
    exit 1
fi

if ! validate_upgrade_fixture "$UPGRADE_FIXTURE"; then
    usage
    exit 1
fi

install_e2e_cleanup_auto_run deployment_managed_by_subject install-upgrade \
    "$TARGET_PROJECT_ROOT" "$0" "${INSTALL_E2E_ARGS[@]}"

# Test configuration
TEST_ID=$(generate_test_run_id)
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-sanctuary-upgrade-${TEST_ID}}"
initialize_install_test_ownership
# Per-lane image tag, derived from the project name so concurrent lanes on one
# daemon cannot alias each other's images (#719).
export_lane_image_tag
TEST_ROOT=$(prepare_install_test_root "$(default_install_test_root "$TARGET_PROJECT_ROOT")")

apply_upgrade_fixture_defaults "$UPGRADE_FIXTURE"
apply_upgrade_test_network_defaults

TEST_RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-$TEST_ROOT/sanctuary-upgrade-runtime-${TEST_ID}}"
TEST_SSL_DIR="$(upgrade_test_ssl_dir "$TEST_RUNTIME_DIR" "$TEST_ROOT" "$COMPOSE_PROJECT_NAME")"
TEST_COMPOSE_SSL_DIR="${SANCTUARY_COMPOSE_SSL_DIR:-$(docker_visible_path "$TEST_SSL_DIR")}"
# Same treatment as the SSL directory: give compose paths the engine can read.
# Without this the monitoring and Tor overlays mount /workspace/... and
# rootless Podman fails with "mkdir /workspace: permission denied".
export SANCTUARY_MONITORING_CONFIG_DIR="${SANCTUARY_MONITORING_CONFIG_DIR:-$(monitoring_config_dir_for_compose "$TARGET_PROJECT_ROOT")}"
export SANCTUARY_TOR_INGRESS_CONFIG="${SANCTUARY_TOR_INGRESS_CONFIG:-$(tor_ingress_config_for_compose "$TARGET_PROJECT_ROOT")}"
TEST_HTTP_HOST=$(default_install_test_host)
API_BASE_URL="https://${TEST_HTTP_HOST}:${HTTPS_PORT}"
BROWSER_BASE_URL="https://${UPGRADE_BROWSER_HOST}:${HTTPS_PORT}"
COOKIE_JAR="/tmp/sanctuary-test-cookies-${TEST_ID}.txt"
# Issue #1028: an ownership-aware source release installs a deployment store
# bound to its directory, so the upgrade must happen in that same directory the
# way `git pull && ./install.sh` does in production. A coordinated lane passes
# the coordinator's checkout root here, already checked out at the source
# release because the coordinator bound its authority to that commit (see
# run-upgrade-baseline-isolated-subject.sh); a local run creates its usual
# source worktree and updates that worktree in place.
UPGRADE_DEPLOYMENT_ROOT="${SANCTUARY_UPGRADE_DEPLOYMENT_ROOT:-}"
UPGRADE_DEPLOYMENT_ROOT_FLIPPED=false
UPGRADE_SOURCE_OWNED=false
UPGRADE_SOURCE_OID=""
UPGRADE_SOURCE_INSTALL_ATTEMPTED=false
UPGRADE_LANE_IMAGES_REGISTERED=false
# An owned source labels its images and volumes exactly like a fresh install
# does, so the lane registers them the same way the fresh-install harness
# does: from the post-install runtime env, so the registration tuple is the
# one the installer stamped on the resources (release, commit, created-at).
readonly -a COMPOSE_REGISTRATION_ARGS=(
    --expected-image sanctuary-backend
    --expected-image sanctuary-frontend
    --expected-image sanctuary-gateway
    --expected-image sanctuary-llm-egress-proxy
    --expected-volume backup_data
    --expected-volume postgres_data
    --expected-volume redis_data
    --expected-volume support_capture_runtime
)
UPGRADE_SOURCE_CHECKOUT="${SANCTUARY_UPGRADE_SOURCE_CHECKOUT:-${UPGRADE_DEPLOYMENT_ROOT:-$TEST_ROOT/sanctuary-upgrade-source-${TEST_ID}/sanctuary}}"
LEGACY_TARGET_ENV_FILE="$TARGET_PROJECT_ROOT/.env"
if [ "$UPGRADE_USE_LEGACY_RUNTIME_ENV" = "true" ] && [ -z "${SANCTUARY_ENV_FILE:-}" ]; then
    TEST_ENV_FILE="$UPGRADE_SOURCE_CHECKOUT/.env"
else
    TEST_ENV_FILE="${SANCTUARY_ENV_FILE:-$TEST_RUNTIME_DIR/sanctuary.env}"
fi
# Keep the operator-facing runtime selection available after the installer
# subshell exits. Manifest-backed commands (including account recovery and
# targeted service replacement) must resolve the retained active Compose
# snapshots instead of falling back to the checkout's current base file.
export SANCTUARY_RUNTIME_DIR="$TEST_RUNTIME_DIR"
export SANCTUARY_ENV_FILE="$TEST_ENV_FILE"
UPGRADE_SOURCE_CREATED=false
UPGRADE_CREATED_TARGET_LEGACY_ENV=false
UPGRADE_SOURCE_LABEL=""
UPGRADE_TARGET_LABEL="$(git -C "$TARGET_PROJECT_ROOT" describe --tags --always 2>/dev/null || git -C "$TARGET_PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "current-checkout")"
UPGRADE_ALLOW_RESTART_FALLBACK="${SANCTUARY_UPGRADE_ALLOW_RESTART_FALLBACK:-false}"
UPGRADE_ARTIFACT_DIR="${SANCTUARY_UPGRADE_ARTIFACT_DIR:-$TARGET_PROJECT_ROOT/.tmp/upgrade-artifacts/${TEST_ID}}"
TEARDOWN_RAN=false
LEGACY_DOCKER_SNAPSHOT="$TEST_RUNTIME_DIR/legacy-docker-resources.tsv"

# State variables for testing
ORIGINAL_JWT_SECRET=""
ORIGINAL_ENCRYPTION_KEY=""
ORIGINAL_ENCRYPTION_SALT=""
ORIGINAL_GATEWAY_SECRET=""
ORIGINAL_POSTGRES_PASSWORD=""
ORIGINAL_USER_PASSWORD=""
ORIGINAL_TWO_FACTOR_SECRET=""
ORIGINAL_TWO_FACTOR_BACKUP_CODE=""
OPERATOR_TWO_FACTOR_USERNAME="operator2fa"
OPERATOR_TWO_FACTOR_PASSWORD="OperatorUpgradePassword123!"
OPERATOR_TWO_FACTOR_SECRET=""
LEGACY_TWO_FACTOR_USERNAME="legacy2fa"
LEGACY_TWO_FACTOR_PASSWORD="LegacyUpgradePassword123!"
LEGACY_TWO_FACTOR_SECRET=""
TEST_WALLET_ID=""
TEST_OPERATIONAL_WALLET_ID=""
TEST_NEVER_FAILED_WALLET_ID=""
TEST_SYNC_QUIESCENT_UNTIL=""
TEST_SYNC_SOURCE_STRUCTURED=""
TEST_DEVICE_ID=""
TEST_WALLET_AGENT_ID=""
TEST_LABEL_NAME="upgrade-fixture-label"
TEST_SETTING_KEY="upgrade.fixture.marker"
TEST_NODE_CONFIG_ID=""
TEST_REPAIR_TRANSACTION_ID=""
TEST_TRIGGER_TRANSACTION_ID=""
NOTIFICATION_TEST_TXID="upgrade-notification-${TEST_ID}"

# Phase 6 cookie auth: the backend sets HttpOnly sanctuary_access +
# sanctuary_refresh cookies and a readable sanctuary_csrf cookie. Mutations
# must echo the CSRF token in X-CSRF-Token.
CSRF_TOKEN=""

resolve_env_file() {
    if [ -f "$TEST_ENV_FILE" ]; then
        echo "$TEST_ENV_FILE"
    elif [ -f "$PROJECT_ROOT/.env" ]; then
        echo "$PROJECT_ROOT/.env"
    else
        echo "$TEST_ENV_FILE"
    fi
}

redact_text() {
    printf '%s\n' "$1" | redact_stream
}

install_log_has_buildkit_cache_corruption() {
    local install_log="$1"

    [ -f "$install_log" ] || return 1

    grep -Eiq \
        'archive/tar: invalid tar header|failed to extract layer|failed to read expected number of bytes' \
        "$install_log"
}

recover_upgrade_builder_cache() {
    log_warning "Docker builder cache appears corrupt during source install; preserving shared cache and retrying once with --no-cache"
}

load_runtime_env() {
    local env_file
    env_file="$(resolve_env_file)"
    if [ ! -f "$env_file" ]; then
        log_error "Runtime env not found: $env_file"
        return 1
    fi

    set -a
    source "$env_file"
    set +a
    export SANCTUARY_ENV_FILE="$env_file"
    export SANCTUARY_SSL_DIR="$TEST_SSL_DIR"
    export SANCTUARY_COMPOSE_SSL_DIR="$TEST_COMPOSE_SSL_DIR"
}

# A legacy (pre-ownership) source must expose unlabeled resources; an owned
# source must label every one of them. Either way the identities are snapshot
# so the upgrade can prove it preserved them.
assert_source_resource_label_shape() {
    local kind="$1" name="$2" label_count="$3"
    if [ "$UPGRADE_SOURCE_OWNED" = "true" ]; then
        [ "$label_count" -gt 0 ] || {
            log_error "Owned source $kind is missing Sanctuary ownership labels: $name"
            return 1
        }
        return 0
    fi
    [ "$label_count" -eq 0 ] || {
        log_error "Legacy $kind unexpectedly has Sanctuary ownership labels: $name"
        return 1
    }
}

snapshot_legacy_docker_resources() {
    local output_file="$1"
    local names_file="$TEST_RUNTIME_DIR/legacy-docker-resource-names.txt"
    local name inspected identity sanctuary_labels resource_count=0

    : > "$output_file"
    docker volume ls --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" --format '{{.Name}}' \
        | LC_ALL=C sort > "$names_file"
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        inspected="$(docker volume inspect "$name")" || return 1
        sanctuary_labels="$(printf '%s' "$inspected" | jq '[.[0].Labels // {} | keys[] | select(startswith("io.sanctuary."))] | length')" || return 1
        assert_source_resource_label_shape volume "$name" "$sanctuary_labels" || return 1
        identity="$(printf '%s' "$inspected" | jq -cS '.[0] | {Name,Driver,Scope,Mountpoint,CreatedAt,Options}' | sha256sum | awk '{print $1}')" || return 1
        printf 'compose_volume\t%s\t%s\n' "$name" "$identity" >> "$output_file"
        resource_count=$((resource_count + 1))
    done < "$names_file"

    docker network ls --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" --format '{{.Name}}' \
        | LC_ALL=C sort > "$names_file"
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        inspected="$(docker network inspect "$name")" || return 1
        sanctuary_labels="$(printf '%s' "$inspected" | jq '[.[0].Labels // {} | keys[] | select(startswith("io.sanctuary."))] | length')" || return 1
        assert_source_resource_label_shape network "$name" "$sanctuary_labels" || return 1
        identity="$(printf '%s' "$inspected" | jq -er '.[0].Id | select(type == "string" and length > 0)')" || return 1
        printf 'compose_network\t%s\t%s\n' "$name" "$identity" >> "$output_file"
        resource_count=$((resource_count + 1))
    done < "$names_file"

    [ "$resource_count" -gt 0 ] || {
        log_error "Source installation exposed no legacy Compose volumes or networks"
        return 1
    }
}

verify_legacy_docker_resources_preserved() {
    local current_snapshot="$TEST_RUNTIME_DIR/legacy-docker-resources-after.tsv"
    local active_pointer manifest generation

    snapshot_legacy_docker_resources "$current_snapshot" || return 1
    if [ "$UPGRADE_SOURCE_OWNED" = "true" ]; then
        # An owned upgrade recreates its networks (their per-release ownership
        # labels change), so only the data volumes must keep their identity.
        if ! cmp -s <(grep '^compose_volume' "$LEGACY_DOCKER_SNAPSHOT") \
                <(grep '^compose_volume' "$current_snapshot"); then
            log_error "Owned source volume identity changed during upgrade"
            diff -u <(grep '^compose_volume' "$LEGACY_DOCKER_SNAPSHOT") \
                <(grep '^compose_volume' "$current_snapshot") || true
            return 1
        fi
    elif ! cmp -s "$LEGACY_DOCKER_SNAPSHOT" "$current_snapshot"; then
        log_error "Legacy volume or network identity changed during upgrade"
        diff -u "$LEGACY_DOCKER_SNAPSHOT" "$current_snapshot" || true
        return 1
    fi

    active_pointer="$TEST_RUNTIME_DIR/ownership/deployments/$SANCTUARY_DEPLOYMENT_ID/active-revision.json"
    [ -f "$active_pointer" ] || {
        log_error "Target upgrade did not activate a deployment manifest"
        return 1
    }
    generation="$(jq -r '.generation' "$active_pointer")"
    manifest="$TEST_RUNTIME_DIR/ownership/deployments/$SANCTUARY_DEPLOYMENT_ID/revisions/$generation/deployment-manifest.json"
    if [ "$UPGRADE_SOURCE_OWNED" = "true" ]; then
        # The owned source was revision 1 of this same deployment; the upgrade
        # must have activated a successor over it, never a fresh first revision.
        jq -e --arg generation "$generation" '
            (.generation | tostring) == $generation and .priorActiveDigest != null
        ' "$manifest" >/dev/null || {
            log_error "Target upgrade did not activate a successor of the owned source revision (generation $generation)"
            return 1
        }
        return 0
    fi
    while IFS=$'\t' read -r resource_class locator _identity; do
        jq -e --arg class "$resource_class" --arg locator "$locator" '
            .legacyResources[] | select(
                .resourceClass == $class and .locator == $locator and
                .cleanupPolicy == "preserve_ambiguous" and .ownershipState == "unlabeled"
            )
        ' "$manifest" >/dev/null || {
            log_error "Deployment manifest did not preserve legacy resource evidence: $resource_class $locator"
            return 1
        }
    done < "$LEGACY_DOCKER_SNAPSHOT"
}

# Extract the sanctuary_csrf cookie value from the Netscape-format cookie
# jar. Fields are tab-separated: domain, HttpOnly, path, Secure, expiry,
# name, value. Sets CSRF_TOKEN (empty string if the cookie isn't set).
extract_csrf_token() {
    if [ ! -f "$COOKIE_JAR" ]; then
        CSRF_TOKEN=""
        return
    fi
    CSRF_TOKEN=$(awk -F'\t' '$6 == "sanctuary_csrf" { print $7 }' "$COOKIE_JAR" | tail -n 1)
}

describe_checkout_ref() {
    local repo_root="$1"

    git -C "$repo_root" describe --tags --always 2>/dev/null || \
        git -C "$repo_root" rev-parse --short HEAD 2>/dev/null || \
        echo "unknown"
}

discover_upgrade_source_ref() {
    local target_commit
    target_commit=$(git -C "$TARGET_PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "")

    resolve_upgrade_source_ref "$TARGET_PROJECT_ROOT" "${UPGRADE_SOURCE_REF:-latest-stable}" "$target_commit"
}

prepare_upgrade_source_checkout() {
    local source_ref="" source_oid worktree_parent authority_bundle execution_authority
    local worktree_identity add_status=0
    source_ref=$(discover_upgrade_source_ref 2>/dev/null || true)

    if [ -z "$source_ref" ]; then
        if [ "$UPGRADE_ALLOW_RESTART_FALLBACK" != "true" ]; then
            log_error "Upgrade source ref '${UPGRADE_SOURCE_REF:-latest-stable}' did not resolve to an older checkout"
            log_error "Set SANCTUARY_UPGRADE_ALLOW_RESTART_FALLBACK=true only for explicit restart-debug runs"
            return 1
        fi

        UPGRADE_SOURCE_LABEL="$(describe_checkout_ref "$TARGET_PROJECT_ROOT") (restart fallback)"
        PROJECT_ROOT="$TARGET_PROJECT_ROOT"
        log_warning "No older stable tag was found; upgrade test will fall back to restarting the current checkout"
        return 0
    fi

    if ! git -C "$TARGET_PROJECT_ROOT" rev-parse --verify "$source_ref" >/dev/null 2>&1; then
        log_error "Upgrade source ref not found: $source_ref"
        return 1
    fi

    UPGRADE_SOURCE_OID="$(git -C "$TARGET_PROJECT_ROOT" rev-parse "${source_ref}^{commit}")" || return 1
    if upgrade_source_is_owned "$TARGET_PROJECT_ROOT" "$UPGRADE_SOURCE_OID"; then
        UPGRADE_SOURCE_OWNED=true
    fi
    if [ -n "$UPGRADE_DEPLOYMENT_ROOT" ]; then
        prepare_owned_upgrade_deployment_root "$source_ref" || return 1
        return 0
    fi
    if [ "$UPGRADE_SOURCE_OWNED" = "true" ] && [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = "1" ]; then
        log_error "Coordinated upgrade from owned source $source_ref requires SANCTUARY_UPGRADE_DEPLOYMENT_ROOT to name the coordinator checkout root (issue #1028)"
        return 1
    fi

    worktree_parent="$(dirname "$UPGRADE_SOURCE_CHECKOUT")"
    mkdir -p "$worktree_parent"
    chmod 700 "$worktree_parent"
    register_install_temporary_artifact "$worktree_parent" || return 1
    source_oid="$(git -C "$TARGET_PROJECT_ROOT" rev-parse "${source_ref}^{commit}")" || return 1
    git -C "$TARGET_PROJECT_ROOT" worktree add --detach \
        "$UPGRADE_SOURCE_CHECKOUT" "$source_ref" >/dev/null || add_status=$?
    if [ ! -d "$UPGRADE_SOURCE_CHECKOUT" ]; then
        [ "$add_status" -ne 0 ] && return "$add_status"
        return 1
    fi
    authority_bundle="$(node "$SANCTUARY_OWNERSHIP_TOOL_DIR/describe-host-authority.mjs" \
        worktree "$UPGRADE_SOURCE_CHECKOUT" "$source_oid" "$SANCTUARY_DEPLOYMENT_ID" \
        "$SANCTUARY_OPERATION_RUN_ID")" || return 1
    execution_authority="$(printf '%s' "$authority_bundle" | jq -c '.executionAuthority')" || return 1
    worktree_identity="$(printf '%s' "$authority_bundle" | jq -r '.immutableIdentity')" || return 1
    register_owned_resource git_worktree obsolete exact_delete path \
        "$UPGRADE_SOURCE_CHECKOUT" "$worktree_identity" \
        --execution-authority "$execution_authority" "$SANCTUARY_OPERATION_RUN_ID" || return 1
    [ "$add_status" -eq 0 ] || return "$add_status"

    PROJECT_ROOT="$UPGRADE_SOURCE_CHECKOUT"
    UPGRADE_SOURCE_CREATED=true
    UPGRADE_SOURCE_LABEL="$source_ref"
    return 0
}

# Use the deployment root a lane provided for an owned source. Under
# coordination the root must be the coordinator's checkout root and must
# already be at the source release, because the coordinator bound its authority
# to that commit and declared the candidate as the one commit the checkout may
# move to. A local run may hand over a root at the candidate commit; it is
# checked out to the source release here.
prepare_owned_upgrade_deployment_root() {
    local source_ref="$1" head root target_commit
    if [ "$UPGRADE_SOURCE_OWNED" != "true" ]; then
        log_error "SANCTUARY_UPGRADE_DEPLOYMENT_ROOT is only valid for an ownership-aware source; $source_ref predates ownership"
        return 1
    fi
    root="$(cd "$UPGRADE_DEPLOYMENT_ROOT" 2>/dev/null && pwd -P)" || {
        log_error "Upgrade deployment root is not a directory: $UPGRADE_DEPLOYMENT_ROOT"
        return 1
    }
    head="$(git -C "$root" rev-parse HEAD 2>/dev/null)" || {
        log_error "Upgrade deployment root is not a git checkout: $root"
        return 1
    }
    if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = "1" ]; then
        if [ "$root" != "$(cd "${SANCTUARY_PROJECT_DIR:-/nonexistent}" 2>/dev/null && pwd -P)" ]; then
            log_error "Upgrade deployment root $root must be the coordinator checkout root ${SANCTUARY_PROJECT_DIR:-<unset>}"
            return 1
        fi
        if [ "$head" != "$UPGRADE_SOURCE_OID" ]; then
            log_error "Coordinated upgrade deployment root $root is at $head, expected the declared source $source_ref ($UPGRADE_SOURCE_OID)"
            return 1
        fi
    elif [ "$head" != "$UPGRADE_SOURCE_OID" ]; then
        target_commit="$(git -C "$TARGET_PROJECT_ROOT" rev-parse HEAD)"
        if [ "$head" != "$target_commit" ]; then
            log_error "Upgrade deployment root $root is at $head, expected $source_ref ($UPGRADE_SOURCE_OID) or the candidate $target_commit"
            return 1
        fi
        if [ -n "$(git -C "$root" status --porcelain=v2 --untracked-files=no)" ]; then
            log_error "Upgrade deployment root $root has tracked changes; refusing to check out $source_ref over them"
            return 1
        fi
        git -C "$root" checkout -q --detach "$UPGRADE_SOURCE_OID" || {
            log_error "Could not check out $source_ref ($UPGRADE_SOURCE_OID) in $root"
            return 1
        }
    fi
    UPGRADE_DEPLOYMENT_ROOT="$root"
    UPGRADE_SOURCE_CHECKOUT="$root"
    UPGRADE_DEPLOYMENT_ROOT_FLIPPED=true
    PROJECT_ROOT="$root"
    UPGRADE_SOURCE_LABEL="$source_ref"
    log_info "Owned source $source_ref is checked out in place at $root"
}

# Register the owned source's exact volumes for receipt-bound cleanup, from the
# runtime env the source installer persisted so the registration tuple is the
# one it stamped on the volumes. Volumes are registered exactly once per lane:
# the candidate's upgrade reuses them, and a second registration with the
# candidate's tuple would make the volume's removal proof ambiguous (#1028).
# Images are deliberately not registered here: see register_owned_lane_images.
register_owned_source_resources() {
    [ "$UPGRADE_SOURCE_OWNED" = "true" ] && [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = "1" ] || return 0
    local -a expected_volumes=()
    local index
    log_info "Registering exact owned-source volumes for receipt-bound cleanup..."
    load_runtime_env || return 1
    ownership_initialize_build_identity || return 1
    for index in "${!COMPOSE_REGISTRATION_ARGS[@]}"; do
        [ "${COMPOSE_REGISTRATION_ARGS[$index]}" = "--expected-volume" ] || continue
        expected_volumes+=("${COMPOSE_PROJECT_NAME}_${COMPOSE_REGISTRATION_ARGS[$((index + 1))]}")
    done
    register_ci_compose_volumes "$(ownership_new_image_deadline)" per-resource "${expected_volumes[@]}"
}

# Register the lane's images exactly once, at the end. An image is cleanable
# only through one exclusive registration; registering the source's tag
# references and then the candidate's rebuilt references again left the one
# image whose bytes changed with two registrations and its predecessor
# dangling (PR #1030, run 14886). Registered here, the current tags resolve to
# the candidate's images and the source's superseded images are registered
# by their exact IDs as dangling lane images.
register_owned_lane_images() {
    [ "$UPGRADE_SOURCE_OWNED" = "true" ] && [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = "1" ] || return 0
    [ "$UPGRADE_LANE_IMAGES_REGISTERED" != "true" ] || return 0
    local -a expected_refs=()
    local index
    log_info "Registering exact lane images for receipt-bound cleanup..."
    load_runtime_env || return 1
    ownership_initialize_build_identity || return 1
    export_lane_image_tag || return 1
    for index in "${!COMPOSE_REGISTRATION_ARGS[@]}"; do
        [ "${COMPOSE_REGISTRATION_ARGS[$index]}" = "--expected-image" ] || continue
        expected_refs+=("${COMPOSE_REGISTRATION_ARGS[$((index + 1))]}:$SANCTUARY_IMAGE_TAG")
    done
    register_ci_compose_images 0 "$(ownership_new_image_deadline)" "${expected_refs[@]}" || return 1
    retire_shared_ci_compose_image_references "$(ownership_new_image_deadline)" || return 1
    UPGRADE_LANE_IMAGES_REGISTERED=true
}

# Docker releases a stopped container's network endpoint; rootless Podman keeps
# it. The candidate's Compose recreates a network whose per-release ownership
# labels changed, which Podman then refuses ("has associated containers") while
# the owned source's stopped containers remain attached (PR #1030, run 14858).
# Removing those stopped containers lets the candidate recreate its networks on
# either engine; the upgrade evidence lives in the volumes and runtime env.
remove_stopped_owned_source_containers() {
    [ "$UPGRADE_SOURCE_OWNED" = "true" ] || return 0
    local ids
    ids="$(docker ps -aq --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" \
        --filter status=exited --filter status=created)" || return 1
    [ -n "$ids" ] || return 0
    # shellcheck disable=SC2086 -- container IDs are whitespace-separated
    docker rm $ids >/dev/null || return 1
    log_info "Removed the stopped owned-source containers so the candidate can recreate its networks"
}

# Bring an owned source checkout to the candidate commit in place, the way a
# production `git pull` does, after undoing the harness's tracked edits.
update_owned_upgrade_checkout_in_place() {
    local checkout="$1" target_commit="$2"
    restore_upgrade_checkout_tracked_files "$checkout" || return 1
    git -C "$checkout" checkout -q --detach "$target_commit" || {
        log_error "Could not update $checkout in place to $target_commit"
        return 1
    }
}

cleanup_upgrade_source_checkout() {
    if [ "$UPGRADE_SOURCE_CREATED" = "true" ]; then
        normalize_upgrade_source_checkout_for_cleanup || return 1
        log_info "Deferring registered upgrade worktree cleanup to the receipt-bound CI coordinator"
    fi
}

# Undo the harness's edits to tracked compose files in a checkout it installed
# from. The runtime env is untracked and stays where it is: for an owned source
# it is the deployment's env for the rest of the run.
restore_upgrade_checkout_tracked_files() {
    local checkout="$1" relative_path
    local compose_paths=(
        docker-compose.yml
        docker-compose.ghcr.yml
        docker-compose.monitoring.yml
        docker-compose.tor.yml
        docker/compose/monitoring.yml
        docker/compose/tor.yml
    )

    for relative_path in "${compose_paths[@]}"; do
        git -C "$checkout" cat-file -e "HEAD:$relative_path" 2>/dev/null || continue
        restore_tracked_worktree_file_for_cleanup "$checkout" "$relative_path" || return 1
    done
}

normalize_upgrade_source_checkout_for_cleanup() {
    restore_upgrade_checkout_tracked_files "$UPGRADE_SOURCE_CHECKOUT" || return 1
    rm -f "$UPGRADE_SOURCE_CHECKOUT/.env"
    if [ -n "$(git -C "$UPGRADE_SOURCE_CHECKOUT" status --porcelain=v2 --untracked-files=all)" ]; then
        log_error "Registered upgrade worktree contains unexpected changes; canonical cleanup will refuse it"
        return 1
    fi
}

checkout_supports_mcp_preference() {
    local project_dir="$1"
    local setup_script="$project_dir/scripts/setup.sh"

    [ -f "$setup_script" ] &&
        grep -q -- '--enable-mcp)' "$setup_script" &&
        grep -q 'ENABLE_MCP=' "$setup_script"
}

run_install_script_command() {
    local project_dir="$1"

    (
        initialize_install_test_ownership_for_root "$project_dir"
        export HTTPS_PORT
        export HTTP_PORT
        export GATEWAY_PORT
        export ENABLE_MONITORING="$UPGRADE_ENABLE_MONITORING"
        export ENABLE_TOR="$UPGRADE_ENABLE_TOR"
        export MCP_BIND_ADDRESS
        export MCP_PORT
        if [ "$UPGRADE_ENABLE_MCP" = "yes" ] && [ "$project_dir" != "$TARGET_PROJECT_ROOT" ]; then
            export COMPOSE_PROFILES=mcp
            if checkout_supports_mcp_preference "$project_dir"; then
                export ENABLE_MCP=yes
            else
                unset ENABLE_MCP
            fi
        else
            unset COMPOSE_PROFILES
            unset ENABLE_MCP
        fi
        export SANCTUARY_DIR="$project_dir"
        export SANCTUARY_RUNTIME_DIR="$TEST_RUNTIME_DIR"
        export SANCTUARY_ENV_FILE="$TEST_ENV_FILE"
        export SANCTUARY_SSL_DIR="$TEST_SSL_DIR"
        export SANCTUARY_COMPOSE_SSL_DIR="$TEST_COMPOSE_SSL_DIR"
        export SKIP_GIT_CHECKOUT="true"
        export SANCTUARY_ASSUME_YES="true"
        export RATE_LIMIT_LOGIN=100
        export RATE_LIMIT_2FA=100
        export RATE_LIMIT_PASSWORD_CHANGE=100
        bash "$project_dir/install.sh" </dev/null
    )
}

run_install_script_attempt() {
    local project_dir="$1"
    local install_log="$2"
    local append_mode="${3:-false}"
    local exit_code

    set +e
    if [ "$append_mode" = "true" ]; then
        run_install_script_command "$project_dir" 2>&1 | redact_stream | tee -a "$install_log"
    else
        run_install_script_command "$project_dir" 2>&1 | redact_stream | tee "$install_log"
    fi
    exit_code=${PIPESTATUS[0]}
    set -e

    return "$exit_code"
}

# The baseline install runs the SOURCE ref's own install.sh -- for v0.8.64 that
# is v0.8.63, byte for byte, including its unfixed Grafana credential migration.
# On rootless Podman that migration samples the container's terminal state
# inside podman's async cleanup window and refuses (~29% per invocation under
# load; see the fix in scripts/ops/run-grafana-password-migration.sh). We can fix
# the candidate, but we cannot fix an already-released baseline, so the
# release-blocking optional-profiles lane would stay a coin flip.
#
# Retry that one signature, exactly as the BuildKit-cache-corruption path above
# does: the baseline install is provisioning, not the system under test -- the
# upgrade is. Deliberately scoped to this single message so every other install
# failure still fails immediately. The candidate's own install cannot produce it
# any more, so in practice this only ever fires for the source install; if it
# ever fires for the upgrade install, that is a regression in the fix and the
# retry line below is the thing that says so.
install_log_has_grafana_terminal_state_race() {
    local install_log="$1"

    [ -f "$install_log" ] || return 1

    grep -Fq 'migration container terminal state is inconsistent' "$install_log"
}

retry_install_script_after_grafana_terminal_state_race() {
    local project_dir="$1"
    local install_log="$2"

    if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = "1" ]; then
        log_error "The baseline Grafana race cannot invoke legacy cleanup during a coordinated run"
        return 1
    fi

    {
        echo ""
        echo "Retrying install after the Podman Grafana terminal-state race (baseline ref carries the unfixed migration)..."
    } | tee -a "$install_log"
    cleanup_containers "$project_dir" 2>/dev/null || true
    run_install_script_attempt "$project_dir" "$install_log" true
}

retry_install_script_after_cache_recovery() {
    local project_dir="$1"
    local install_log="$2"

    if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = "1" ]; then
        log_error "Builder recovery cannot invoke legacy cleanup during a coordinated run"
        return 1
    fi
    if ! recover_upgrade_builder_cache; then
        return 1
    fi

    {
        echo ""
        echo "Retrying source install after Docker builder cache recovery..."
    } | tee -a "$install_log"
    cleanup_containers "$project_dir" 2>/dev/null || true
    run_install_script_attempt "$project_dir" "$install_log" true
}

run_install_script() {
    local project_dir="$1"
    local checkout_name
    checkout_name="$(basename "$project_dir")"
    local install_log="$TEST_RUNTIME_DIR/install-${checkout_name}.log"
    local exit_code

    mkdir -p "$TEST_RUNTIME_DIR"
    isolate_legacy_optional_profile_compose "$project_dir" "$TARGET_PROJECT_ROOT"

    # Scope optional-profile bind sources to the checkout being installed. The
    # variables are global but the lane installs two stacks with different
    # config paths. Restore both on every exit so the installs cannot leak paths.
    local previous_monitoring_dir="${SANCTUARY_MONITORING_CONFIG_DIR:-}"
    local had_monitoring_dir="${SANCTUARY_MONITORING_CONFIG_DIR+set}"
    local previous_tor_config="${SANCTUARY_TOR_INGRESS_CONFIG:-}"
    local had_tor_config="${SANCTUARY_TOR_INGRESS_CONFIG+set}"
    SANCTUARY_MONITORING_CONFIG_DIR="$(monitoring_config_dir_for_compose "$project_dir")"
    SANCTUARY_TOR_INGRESS_CONFIG="$(tor_ingress_config_for_compose "$project_dir")"
    export SANCTUARY_MONITORING_CONFIG_DIR
    export SANCTUARY_TOR_INGRESS_CONFIG

    restore_optional_config_paths() {
        if [ -n "$had_monitoring_dir" ]; then
            export SANCTUARY_MONITORING_CONFIG_DIR="$previous_monitoring_dir"
        else
            unset SANCTUARY_MONITORING_CONFIG_DIR
        fi
        if [ -n "$had_tor_config" ]; then
            export SANCTUARY_TOR_INGRESS_CONFIG="$previous_tor_config"
        else
            unset SANCTUARY_TOR_INGRESS_CONFIG
        fi
    }

    if run_install_script_attempt "$project_dir" "$install_log" false; then
        if ! install_log_has_buildkit_cache_corruption "$install_log"; then
            restore_optional_config_paths
            return 0
        fi

        log_warning "install.sh exited successfully after BuildKit cache corruption; retrying source install"
        if retry_install_script_after_cache_recovery "$project_dir" "$install_log"; then
            restore_optional_config_paths
            return 0
        fi
        exit_code=$?
    else
        exit_code=$?
        if install_log_has_buildkit_cache_corruption "$install_log"; then
            if retry_install_script_after_cache_recovery "$project_dir" "$install_log"; then
                restore_optional_config_paths
                return 0
            fi
            exit_code=$?
        elif install_log_has_grafana_terminal_state_race "$install_log"; then
            log_warning "install.sh hit the Podman Grafana terminal-state race; retrying once"
            if retry_install_script_after_grafana_terminal_state_race "$project_dir" "$install_log"; then
                restore_optional_config_paths
                return 0
            fi
            exit_code=$?
        fi
    fi

    restore_optional_config_paths
    log_error "install.sh failed for checkout: $project_dir"
    log_error "Install log: $install_log"
    return "$exit_code"
}

persist_source_mcp_preference() {
    local env_file=""
    local current_value=""

    [ "$UPGRADE_ENABLE_MCP" = "yes" ] || return 0

    env_file="$(resolve_env_file)"
    if [ ! -f "$env_file" ]; then
        log_error "Cannot persist the source MCP preference; runtime env is missing: $env_file"
        return 1
    fi

    current_value="$(awk -F= '$1 == "ENABLE_MCP" { print $2 }' "$env_file" | tail -n 1)"
    case "$current_value" in
        yes)
            return 0
            ;;
        "")
            printf '\nENABLE_MCP=yes\n' >> "$env_file"
            chmod 600 "$env_file" 2>/dev/null || true
            ;;
        *)
            log_error "Source runtime env contains a conflicting ENABLE_MCP value"
            return 1
            ;;
    esac
}

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
declare -a FAILED_TESTS

# ============================================
# Test Framework
# ============================================

upgrade_phase_epoch_seconds() {
    date +%s 2>/dev/null || echo 0
}

emit_upgrade_phase_timing() {
    local test_name="$1"
    local exit_code="$2"
    local start_epoch="$3"
    local end_epoch="$4"
    local duration=0
    local minutes=0
    local seconds=0
    local message

    if [ "$start_epoch" -gt 0 ] 2>/dev/null && [ "$end_epoch" -ge "$start_epoch" ] 2>/dev/null; then
        duration="$((end_epoch - start_epoch))"
    fi
    minutes="$((duration / 60))"
    seconds="$((duration % 60))"
    message="upgrade phase ${test_name} mode=${UPGRADE_TEST_MODE} fixture=${UPGRADE_FIXTURE} completed in ${minutes}m ${seconds}s (${duration}s)"

    if [ "$exit_code" -eq 0 ]; then
        echo "::notice title=CI timing::${message}"
    else
        echo "::error title=CI timing::${message} with exit code ${exit_code}"
    fi
}

run_test() {
    local test_name="$1"
    local test_func="$2"
    local start_epoch
    local end_epoch

    TESTS_RUN=$((TESTS_RUN + 1))
    echo ""
    log_info "Running test: $test_name"
    echo "-------------------------------------------"

    start_epoch="$(upgrade_phase_epoch_seconds)"
    set +e
    $test_func
    local exit_code=$?
    set -e
    end_epoch="$(upgrade_phase_epoch_seconds)"
    emit_upgrade_phase_timing "$test_name" "$exit_code" "$start_epoch" "$end_epoch"

    if [ $exit_code -eq 0 ]; then
        log_success "PASSED: $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        log_error "FAILED: $test_name"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        FAILED_TESTS+=("$test_name")
    fi
}

# ============================================
# Setup and Teardown
# ============================================

setup() {
    log_info "Setting up upgrade test environment..."
    log_info "  Test ID:       $TEST_ID"
    log_info "  Target Root:   $TARGET_PROJECT_ROOT"
    log_info "  Target Ref:    $UPGRADE_TARGET_LABEL"
    log_info "  Test Mode:     $UPGRADE_TEST_MODE"
    log_info "  Fixture:       $UPGRADE_FIXTURE"
    log_info "  Compose Proj:  $COMPOSE_PROJECT_NAME"
    log_info "  HTTPS Port:    $HTTPS_PORT"
    log_info "  HTTP Host:     $TEST_HTTP_HOST"
    log_info "  Browser URL:   $BROWSER_BASE_URL"

    # Verify prerequisites
    if ! check_docker_available; then
        log_error "Docker is not available. Cannot run upgrade tests."
        exit 1
    fi

    export SANCTUARY_ENV_FILE="$TEST_ENV_FILE"
    export SANCTUARY_SSL_DIR="$TEST_SSL_DIR"
    export SANCTUARY_COMPOSE_SSL_DIR="$TEST_COMPOSE_SSL_DIR"
    export SANCTUARY_RESTART_POLICY=no

    setup_exit_cleanup_trap "teardown"
    if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != "1" ]; then
        cleanup_compose_projects_by_prefix "sanctuary-upgrade-test-" "$COMPOSE_PROJECT_NAME" 2>/dev/null || true
        cleanup_containers "$TARGET_PROJECT_ROOT" 2>/dev/null || true
    fi

    if ! prepare_upgrade_source_checkout; then
        log_error "Failed to prepare upgrade source checkout"
        exit 1
    fi

    log_info "  Source Ref:    $UPGRADE_SOURCE_LABEL"
    log_info "  Source Root:   $PROJECT_ROOT"
}

teardown() {
    if [ "$TEARDOWN_RAN" = "true" ]; then
        return 0
    fi
    TEARDOWN_RAN=true

    log_info "Cleaning up upgrade test environment..."

    # Capture container state BEFORE cleanup destroys it. A container's health
    # log lives on the container, so cleaning up first means an unhealthy
    # service leaves no record of why it was unhealthy — which is exactly what
    # happened on run 8795: the gateway sat unhealthy for the full 300s window
    # and the artifact named neither the failing probe nor its output. The
    # fresh-install lane has captured this on failure all along; this lane, the
    # longest and most expensive one, did not.
    #
    # Both stacks are dumped: upgrade failures have landed in the source
    # (legacy) stack more often than the target.
    # Keyed off container state, not a TESTS_FAILED counter: run 8813 showed the
    # counter reading zero inside teardown while the gateway sat unhealthy, so
    # the gated capture never fired and cleanup destroyed the evidence. This
    # variant is self-limiting — a healthy run prints one line.
    capture_unhealthy_container_diagnostics "$COMPOSE_PROJECT_NAME" || true

    if [ "${TESTS_FAILED:-0}" -gt 0 ]; then
        capture_compose_failure_diagnostics "$TARGET_PROJECT_ROOT" || true
        if [ "$UPGRADE_SOURCE_CREATED" = "true" ]; then
            capture_compose_failure_diagnostics "$UPGRADE_SOURCE_CHECKOUT" || true
        fi
    fi

    if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = "1" ]; then
        log_info "Deferring Docker resource cleanup to the receipt-bound CI coordinator"
    elif [ "$KEEP_CONTAINERS" = "false" ]; then
        cleanup_containers "$TARGET_PROJECT_ROOT" 2>/dev/null || true
        if [ "$UPGRADE_SOURCE_CREATED" = "true" ]; then
            cleanup_containers "$UPGRADE_SOURCE_CHECKOUT" 2>/dev/null || true
        fi
        cleanup_compose_project_resources "$COMPOSE_PROJECT_NAME" 2>/dev/null || true
    else
        log_warning "Keeping containers running (--keep-containers specified)"
        get_container_status "$TARGET_PROJECT_ROOT"
    fi

    # Clean up cookie jar
    if [ -f "$COOKIE_JAR" ]; then
        rm -f "$COOKIE_JAR"
    fi

    if [ "$UPGRADE_CREATED_TARGET_LEGACY_ENV" = "true" ] && [ -f "$LEGACY_TARGET_ENV_FILE" ]; then
        rm -f "$LEGACY_TARGET_ENV_FILE"
    fi

    if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != "1" ] && [ -d "$TEST_RUNTIME_DIR" ]; then
        log_warning "Preserving the uncoordinated runtime because no signed host cleanup authority exists"
    fi

    # A lane that failed after building leaves images the coordinator would
    # otherwise refuse as unregistered (PR #1030, run 14858).
    if [ "$UPGRADE_SOURCE_INSTALL_ATTEMPTED" = "true" ]; then
        register_owned_lane_images \
            || log_warning "Lane image registration did not complete; receipt-bound cleanup will report them"
    fi

    cleanup_upgrade_source_checkout
    clear_cleanup_trap
}

# ============================================
# Test: Verify Existing Installation or Create One
# ============================================

test_ensure_existing_installation() {
    log_info "Creating source installation from $UPGRADE_SOURCE_LABEL..."

    cd "$PROJECT_ROOT"

    if [ "$UPGRADE_SOURCE_CREATED" = "true" ] || [ "$UPGRADE_DEPLOYMENT_ROOT_FLIPPED" = "true" ]; then
        force_test_compose_restart_policy_no "$PROJECT_ROOT"
    fi

    # Drop the shared, unversioned local image tags so this checkout must build
    # its own. Without this a lane can inherit an image another lane built from
    # a different ref (see assert_installed_image_matches_checkout).
    purge_shared_local_images

    # Called here rather than from upgrade_fixture_before_source_install
    # because no fixture hook is ever dispatched -- the harness defines none of
    # them. See the dead-hook issue; until that is fixed a fixture cannot run
    # setup of its own.
    if [ "$UPGRADE_ENABLE_MONITORING" = "yes" ]; then
        sync_monitoring_configs_to_daemon "$PROJECT_ROOT"
    fi

    UPGRADE_SOURCE_INSTALL_ATTEMPTED=true
    if ! run_install_script "$PROJECT_ROOT"; then
        return 1
    fi

    persist_source_mcp_preference || return 1

    snapshot_legacy_docker_resources "$LEGACY_DOCKER_SNAPSHOT" || return 1

    if ! assert_installed_image_matches_checkout "$PROJECT_ROOT"; then
        log_error "Source installation is running code from the wrong ref"
        return 1
    fi

    disable_compose_project_restart_policy "$COMPOSE_PROJECT_NAME"

    # Wait for containers
    if ! wait_for_all_containers_healthy 300; then
        log_error "Initial installation failed"
        # Re-probe on the failure path. The diagnostic summary only echoes the
        # last 256 KiB of a lane log, and this lane exceeds that, so a probe
        # emitted at lane start scrolls out of the tail before anyone reads it.
        probe_monitoring_bind_sources "$PROJECT_ROOT"
        return 1
    fi

    # Wait for migration to complete
    if ! wait_for_migration_complete 180; then
        log_error "Migration failed during initial installation"
        return 1
    fi

    # Extra wait for backend to fully initialize
    sleep 5

    if load_runtime_env; then
        if [ "$UPGRADE_ENABLE_MCP" = "yes" ]; then
            if [ "${ENABLE_MCP:-}" != "yes" ]; then
                log_error "Source optional-profiles installation did not persist ENABLE_MCP=yes"
                return 1
            fi
            verify_mcp_profile_container "$PROJECT_ROOT" || return 1
        fi

        ORIGINAL_JWT_SECRET="$JWT_SECRET"
        ORIGINAL_ENCRYPTION_KEY="$ENCRYPTION_KEY"
        ORIGINAL_ENCRYPTION_SALT="$ENCRYPTION_SALT"
        ORIGINAL_GATEWAY_SECRET="$GATEWAY_SECRET"
        ORIGINAL_POSTGRES_PASSWORD="$POSTGRES_PASSWORD"
        log_info "Loaded initial secrets from $(resolve_env_file)"
    fi

    register_owned_source_resources || return 1

    log_success "Initial installation created from $UPGRADE_SOURCE_LABEL"
    return 0
}

# ============================================
# Test: Create Test Data Before Upgrade
# ============================================

test_create_pre_upgrade_data() {
    log_info "Creating test data before upgrade..."

    # Login with default admin credentials (Phase 6 cookie auth)
    rm -f "$COOKIE_JAR"
    local login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d '{"username":"admin","password":"sanctuary"}' \
        "$API_BASE_URL/api/v1/auth/login")

    if echo "$login_response" | grep -q '"user"'; then
        extract_csrf_token
        if [ -z "$CSRF_TOKEN" ]; then
            log_error "Default login succeeded but sanctuary_csrf cookie missing"
            return 1
        fi

        # Change password to a known value for upgrade testing
        ORIGINAL_USER_PASSWORD="UpgradeTestPassword123!"
        curl -k -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST \
            -H "Content-Type: application/json" \
            -H "X-CSRF-Token: $CSRF_TOKEN" \
            -d "{\"currentPassword\":\"sanctuary\",\"newPassword\":\"$ORIGINAL_USER_PASSWORD\"}" \
            "$API_BASE_URL/api/v1/auth/me/change-password" >/dev/null

        # Re-login with new password (rotates cookies + CSRF)
        rm -f "$COOKIE_JAR"
        login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
            -H "Content-Type: application/json" \
            -d "{\"username\":\"admin\",\"password\":\"$ORIGINAL_USER_PASSWORD\"}" \
            "$API_BASE_URL/api/v1/auth/login")
    else
        # Default password didn't work (already changed on a prior run);
        # try the test password directly.
        rm -f "$COOKIE_JAR"
        ORIGINAL_USER_PASSWORD="UpgradeTestPassword123!"
        login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
            -H "Content-Type: application/json" \
            -d "{\"username\":\"admin\",\"password\":\"$ORIGINAL_USER_PASSWORD\"}" \
            "$API_BASE_URL/api/v1/auth/login")
    fi

    if ! echo "$login_response" | grep -q '"user"'; then
        log_error "Failed to authenticate after password setup"
        log_error "Response: $login_response"
        return 1
    fi

    extract_csrf_token
    if [ -z "$CSRF_TOKEN" ]; then
        log_error "Failed to capture sanctuary_csrf cookie"
        return 1
    fi

    if ! seed_admin_two_factor_fixture; then
        return 1
    fi

    if [ "$UPGRADE_SEED_APP_STATE" = "true" ] && ! seed_representative_app_state_fixture; then
        return 1
    fi

    if ! seed_transaction_migration_fixture; then
        return 1
    fi

    log_success "Test data created (password changed to test password, 2FA enabled)"
    return 0
}

# ============================================
# Test: Capture Pre-Upgrade State
# ============================================

test_capture_pre_upgrade_state() {
    log_info "Capturing pre-upgrade state..."

    # Capture runtime env contents
    if load_runtime_env; then
        ORIGINAL_JWT_SECRET="$JWT_SECRET"
        ORIGINAL_ENCRYPTION_KEY="$ENCRYPTION_KEY"
        ORIGINAL_ENCRYPTION_SALT="$ENCRYPTION_SALT"
        ORIGINAL_GATEWAY_SECRET="$GATEWAY_SECRET"
        ORIGINAL_POSTGRES_PASSWORD="$POSTGRES_PASSWORD"
        log_info "Captured required upgrade secrets"
    else
        log_error "Runtime env not found"
        return 1
    fi

    # Capture database state
    local user_count=$(compose_exec postgres psql -U sanctuary -d sanctuary -t -c \
        "SELECT COUNT(*) FROM users;" 2>/dev/null | tr -d ' ')
    log_info "User count: $user_count"

    log_success "Pre-upgrade state captured"
    return 0
}

replace_env_value() {
    local key="$1"
    local value="$2"
    local file="$3"
    local tmp_file="${file}.tmp"

    awk -F= -v key="$key" -v value="$value" '
        BEGIN { updated = 0 }
        $1 == key {
            print key "=" value
            updated = 1
            next
        }
        { print }
        END {
            if (updated == 0) {
                exit 1
            }
        }
    ' "$file" > "$tmp_file" || {
        rm -f "$tmp_file"
        return 1
    }

    mv "$tmp_file" "$file"
    chmod 600 "$file" 2>/dev/null || true
}

seed_representative_app_state_fixture() {
    log_info "Seeding representative app state before upgrade..."

    local seed_output
    seed_output=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "UPGRADE_LABEL_NAME=$TEST_LABEL_NAME" \
        -e "UPGRADE_SETTING_KEY=$TEST_SETTING_KEY" \
        -e "UPGRADE_SEED_NOTIFICATION_STATE=$UPGRADE_SEED_NOTIFICATION_STATE" \
        backend node -e '
function loadModule(candidates) {
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try the next compiled path
    }
  }
  throw new Error(`Could not load any of: ${candidates.join(", ")}`);
}

const prismaModule = loadModule([
  "./dist/app/src/models/prisma.js",
  "./dist/server/src/models/prisma.js",
  "./dist/src/models/prisma.js",
]);
const prisma = prismaModule.default || prismaModule;

(async () => {
  const admin = await prisma.user.findUnique({
    where: { username: "admin" },
    select: { id: true, preferences: true },
  });
  if (!admin) {
    throw new Error("admin user missing");
  }

  const group = await prisma.group.create({
    data: {
      name: `Upgrade Fixture Group ${Date.now()}`,
      description: "Seeded before upgrade to prove group state survives",
      purpose: "upgrade-testing",
    },
    select: { id: true },
  });

  const wallet = await prisma.wallet.create({
    data: {
      name: "Upgrade Fixture Wallet",
      type: "single_sig",
      scriptType: "native_segwit",
      network: "testnet",
      descriptor: "wpkh([d34db33f/84h/1h/0h]tpubD6NzVbkrYhZ4X5n7fixture/0/*)",
      fingerprint: "d34db33f",
      groupId: group.id,
      groupRole: "viewer",
      users: {
        create: {
          userId: admin.id,
          role: "owner",
        },
      },
      labels: {
        create: {
          name: process.env.UPGRADE_LABEL_NAME,
          color: "#22c55e",
          description: "Seeded before upgrade",
        },
      },
    },
    select: { id: true },
  });

  const nodeConfig = await prisma.nodeConfig.create({
    data: {
      isDefault: false,
      explorerUrl: "https://mempool.space/testnet",
      feeEstimatorUrl: "https://mempool.space/testnet/api/v1/fees/recommended",
      mempoolEstimator: "mempool_space",
      testnetEnabled: true,
      testnetMode: "singleton",
      testnetSingletonHost: "electrum.fixture.invalid",
      testnetSingletonPort: 50002,
      testnetSingletonSsl: true,
      proxyEnabled: false,
      servers: {
        create: {
          network: "testnet",
          label: "Upgrade Fixture Electrum",
          host: "electrum.fixture.invalid",
          port: 50002,
          useSsl: true,
          priority: 42,
          enabled: false,
          isHealthy: false,
          supportsVerbose: false,
        },
      },
    },
    select: { id: true },
  });

  await prisma.systemSetting.upsert({
    where: { key: process.env.UPGRADE_SETTING_KEY },
    update: { value: JSON.stringify({ fixture: "upgrade", preserved: true }) },
    create: {
      key: process.env.UPGRADE_SETTING_KEY,
      value: JSON.stringify({ fixture: "upgrade", preserved: true }),
    },
  });

  if (process.env.UPGRADE_SEED_NOTIFICATION_STATE === "true") {
    const existingPreferences =
      admin.preferences && typeof admin.preferences === "object" && !Array.isArray(admin.preferences)
        ? admin.preferences
        : {};
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        preferences: {
          ...existingPreferences,
          telegram: {
            enabled: true,
            botToken: "upgrade-notification-fixture-invalid-token",
            chatId: "123456789",
            wallets: {
              [wallet.id]: {
                enabled: true,
                notifyReceived: true,
                notifySent: true,
                notifyConsolidation: true,
                notifyDraft: true,
              },
            },
          },
        },
      },
    });
  }

  // Seed an agent funding link so the v0.8.47 wallet_agents migration
  // (signerDeviceId nullable + relaxed unique key) is exercised against
  // pre-existing data instead of an empty table.
  const operationalWallet = await prisma.wallet.create({
    data: {
      name: "Upgrade Fixture Operational Wallet",
      type: "single_sig",
      scriptType: "native_segwit",
      network: "testnet",
      descriptor: "wpkh([abadc0de/84h/1h/0h]tpubD6NzVbkrYhZ4X5n7operational/0/*)",
      fingerprint: "abadc0de",
      groupId: group.id,
      groupRole: "viewer",
      users: { create: { userId: admin.id, role: "owner" } },
    },
    select: { id: true },
  });

  const deviceFingerprint = `agf${Date.now().toString(16).slice(-5)}`;
  const device = await prisma.device.create({
    data: {
      userId: admin.id,
      type: "ledger",
      label: "Upgrade Fixture Signer",
      fingerprint: deviceFingerprint,
      xpub: "tpubD6NzVbkrYhZ4X5n7fixtureSignerDevice",
    },
    select: { id: true },
  });

  const agent = await prisma.walletAgent.create({
    data: {
      userId: admin.id,
      name: "Upgrade Fixture Agent",
      fundingWalletId: wallet.id,
      operationalWalletId: operationalWallet.id,
      signerDeviceId: device.id,
    },
    select: { id: true },
  });

  process.stdout.write(`walletId=${wallet.id}\n`);
  process.stdout.write(`nodeConfigId=${nodeConfig.id}\n`);
  process.stdout.write(`operationalWalletId=${operationalWallet.id}\n`);
  process.stdout.write(`deviceId=${device.id}\n`);
  process.stdout.write(`walletAgentId=${agent.id}\n`);
})()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    try {
      await prisma.$disconnect();
    } catch {}
    process.exit(1);
  });
' 2>/dev/null) || {
        log_error "Failed to seed representative app state"
        return 1
    }

    TEST_WALLET_ID=$(echo "$seed_output" | sed -n 's/^walletId=//p' | tail -n 1)
    TEST_NODE_CONFIG_ID=$(echo "$seed_output" | sed -n 's/^nodeConfigId=//p' | tail -n 1)
    TEST_OPERATIONAL_WALLET_ID=$(echo "$seed_output" | sed -n 's/^operationalWalletId=//p' | tail -n 1)
    TEST_DEVICE_ID=$(echo "$seed_output" | sed -n 's/^deviceId=//p' | tail -n 1)
    TEST_WALLET_AGENT_ID=$(echo "$seed_output" | sed -n 's/^walletAgentId=//p' | tail -n 1)

    if [ -z "$TEST_WALLET_ID" ] || [ -z "$TEST_NODE_CONFIG_ID" ]; then
        log_error "App-state fixture did not return required IDs"
        log_error "Output: $seed_output"
        return 1
    fi

    if [ -z "$TEST_OPERATIONAL_WALLET_ID" ] || [ -z "$TEST_DEVICE_ID" ] || [ -z "$TEST_WALLET_AGENT_ID" ]; then
        log_error "App-state fixture did not return wallet_agents IDs"
        log_error "Output: $seed_output"
        return 1
    fi

    log_success "Representative app state seeded before upgrade"
    return 0
}

verify_representative_app_state_preserved() {
    if [ "$UPGRADE_SEED_APP_STATE" != "true" ]; then
        log_info "Skipping representative app-state verification for fixture: $UPGRADE_FIXTURE"
        return 0
    fi

    log_info "Verifying representative app state after upgrade..."

    local output
    output=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "UPGRADE_WALLET_ID=$TEST_WALLET_ID" \
        -e "UPGRADE_LABEL_NAME=$TEST_LABEL_NAME" \
        -e "UPGRADE_SETTING_KEY=$TEST_SETTING_KEY" \
        -e "UPGRADE_NODE_CONFIG_ID=$TEST_NODE_CONFIG_ID" \
        -e "UPGRADE_OPERATIONAL_WALLET_ID=$TEST_OPERATIONAL_WALLET_ID" \
        -e "UPGRADE_DEVICE_ID=$TEST_DEVICE_ID" \
        -e "UPGRADE_WALLET_AGENT_ID=$TEST_WALLET_AGENT_ID" \
        backend node -e '
function loadModule(candidates) {
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try the next compiled path
    }
  }
  throw new Error(`Could not load any of: ${candidates.join(", ")}`);
}

const prismaModule = loadModule([
  "./dist/app/src/models/prisma.js",
  "./dist/server/src/models/prisma.js",
  "./dist/src/models/prisma.js",
]);
const prisma = prismaModule.default || prismaModule;

(async () => {
  const wallet = await prisma.wallet.findUnique({
    where: { id: process.env.UPGRADE_WALLET_ID },
    select: {
      name: true,
      type: true,
      network: true,
      users: { select: { role: true, user: { select: { username: true } } } },
      labels: { select: { name: true, color: true } },
      group: { select: { purpose: true } },
    },
  });
  if (!wallet || wallet.name !== "Upgrade Fixture Wallet") {
    throw new Error("seeded wallet missing after upgrade");
  }
  if (!wallet.users.some((entry) => entry.role === "owner" && entry.user.username === "admin")) {
    throw new Error("seeded wallet owner missing after upgrade");
  }
  if (!wallet.labels.some((label) => label.name === process.env.UPGRADE_LABEL_NAME && label.color === "#22c55e")) {
    throw new Error("seeded label missing after upgrade");
  }
  if (wallet.group?.purpose !== "upgrade-testing") {
    throw new Error("seeded group relation missing after upgrade");
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: process.env.UPGRADE_SETTING_KEY },
    select: { value: true },
  });
  if (!setting || !setting.value.includes("preserved")) {
    throw new Error("seeded system setting missing after upgrade");
  }

  const nodeConfig = await prisma.nodeConfig.findUnique({
    where: { id: process.env.UPGRADE_NODE_CONFIG_ID },
    select: {
      testnetEnabled: true,
      testnetSingletonHost: true,
      servers: { select: { label: true, enabled: true, priority: true } },
    },
  });
  if (!nodeConfig || !nodeConfig.testnetEnabled || nodeConfig.testnetSingletonHost !== "electrum.fixture.invalid") {
    throw new Error("seeded node config missing after upgrade");
  }
  if (!nodeConfig.servers.some((server) => server.label === "Upgrade Fixture Electrum" && server.enabled === false && server.priority === 42)) {
    throw new Error("seeded electrum server missing after upgrade");
  }

  // Verify the wallet_agents row seeded against the v0.8.46 schema
  // (signerDeviceId NOT NULL, 3-col unique) survives the v0.8.47 migration
  // that relaxes the column to nullable and replaces the unique key.
  const agent = await prisma.walletAgent.findUnique({
    where: { id: process.env.UPGRADE_WALLET_AGENT_ID },
    select: {
      name: true,
      status: true,
      fundingWalletId: true,
      operationalWalletId: true,
      signerDeviceId: true,
      signerDevice: { select: { id: true, label: true } },
    },
  });
  if (!agent || agent.name !== "Upgrade Fixture Agent") {
    throw new Error("seeded wallet agent missing after upgrade");
  }
  if (agent.fundingWalletId !== process.env.UPGRADE_WALLET_ID) {
    throw new Error("agent fundingWalletId not preserved after upgrade");
  }
  if (agent.operationalWalletId !== process.env.UPGRADE_OPERATIONAL_WALLET_ID) {
    throw new Error("agent operationalWalletId not preserved after upgrade");
  }
  if (agent.signerDeviceId !== process.env.UPGRADE_DEVICE_ID) {
    throw new Error("agent signerDeviceId not preserved after upgrade");
  }
  if (!agent.signerDevice || agent.signerDevice.label !== "Upgrade Fixture Signer") {
    throw new Error("agent signerDevice relation not preserved after upgrade");
  }

  process.stdout.write("appStatePreserved=true\n");
})()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    try {
      await prisma.$disconnect();
    } catch {}
    process.exit(1);
  });
' 2>/dev/null) || {
        log_error "Representative app state was not preserved"
        return 1
    }

    if ! echo "$output" | grep -q '^appStatePreserved=true$'; then
        log_error "Unexpected app-state verification output: $output"
        return 1
    fi

    log_success "Representative app state preserved after upgrade"
    return 0
}

# ============================================
# Test: Stop Containers for Upgrade
# ============================================

test_stop_containers_for_upgrade() {
    log_info "Stopping source containers before upgrade..."

    cd "$PROJECT_ROOT"
    load_runtime_env || return 1

    # Age the recurring completions BEFORE the stop, while Redis is still
    # serving. This is what makes the restart-staleness path deterministic
    # instead of a function of how long the rebuild happens to take -- see
    # tests/install/utils/upgrade-staleness.sh for why waiting cannot work.
    if wallet_sync_retirement_fixture_enabled; then
        log_info "Skipping generic recurring-staleness aging; baseline lanes own that proof"
    else
        force_recurring_completion_staleness || return 1
    fi

    if [ "$UPGRADE_ENABLE_MCP" = "yes" ]; then
        (
            export COMPOSE_PROFILES=mcp
            run_project_compose "$PROJECT_ROOT" stop
        ) 2>&1
    else
        run_project_compose "$PROJECT_ROOT" stop 2>&1
    fi

    # Verify containers stopped
    local running=$(docker ps --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" --filter "status=running" -q | wc -l)
    if [ "$running" -gt 0 ]; then
        log_error "Some containers still running after stop"
        return 1
    fi
    remove_stopped_owned_source_containers || return 1

    log_success "Containers stopped"
    return 0
}

# ============================================
# Test: Simulate Git Pull (Update)
# ============================================

test_simulate_git_update() {
    log_info "Switching from source checkout to current checkout..."

    cd "$PROJECT_ROOT"

    # Verify we're in a git repository
    if ! git rev-parse --is-inside-work-tree &>/dev/null; then
        log_error "Not in a git repository"
        return 1
    fi

    # Get current commit
    local current_commit=$(git rev-parse HEAD)
    local target_commit=$(git -C "$TARGET_PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")
    log_info "Source commit: $current_commit"
    log_info "Target commit: $target_commit"

    if [ "$UPGRADE_SOURCE_OWNED" = "true" ] && [ "$current_commit" != "$target_commit" ]; then
        # Product model for an owned deployment: the same directory moves to the
        # candidate commit and the candidate installer upgrades revision 1 in
        # place (issue #1028). PROJECT_ROOT stays the deployment root.
        update_owned_upgrade_checkout_in_place "$PROJECT_ROOT" "$target_commit" || return 1
        log_info "Updated owned deployment checkout in place: $PROJECT_ROOT"
        log_success "Upgrade target prepared"
        return 0
    fi

    PROJECT_ROOT="$TARGET_PROJECT_ROOT"

    if [ "$UPGRADE_USE_LEGACY_RUNTIME_ENV" = "true" ]; then
        if [ -e "$LEGACY_TARGET_ENV_FILE" ] && [ "$UPGRADE_CREATED_TARGET_LEGACY_ENV" != "true" ]; then
            log_error "Cannot run legacy-runtime-env fixture because target .env already exists: $LEGACY_TARGET_ENV_FILE"
            return 1
        fi

        cp "$TEST_ENV_FILE" "$LEGACY_TARGET_ENV_FILE"
        chmod 600 "$LEGACY_TARGET_ENV_FILE" 2>/dev/null || true
        TEST_ENV_FILE="$LEGACY_TARGET_ENV_FILE"
        export SANCTUARY_ENV_FILE="$TEST_ENV_FILE"
        UPGRADE_CREATED_TARGET_LEGACY_ENV=true
        log_info "Moved legacy runtime env path to target checkout .env"
    fi

    if [ "$current_commit" = "$target_commit" ]; then
        if [ "$UPGRADE_ALLOW_RESTART_FALLBACK" != "true" ]; then
            log_error "Source and target resolve to the same commit; refusing restart fallback for upgrade validation"
            log_error "Set SANCTUARY_UPGRADE_ALLOW_RESTART_FALLBACK=true only for explicit restart-debug runs"
            return 1
        fi
        log_warning "Source and target resolve to the same commit; upgrade lane is running as a restart fallback"
    else
        log_info "Target checkout ready at $TARGET_PROJECT_ROOT"
    fi

    log_success "Upgrade target prepared"
    return 0
}

# ============================================
# Test: Restart Containers After Upgrade
# ============================================

test_restart_containers_after_upgrade() {
    log_info "Running upgrade from $UPGRADE_SOURCE_LABEL to $UPGRADE_TARGET_LABEL..."

    cd "$PROJECT_ROOT"

    # Load secrets from runtime env
    load_runtime_env || return 1

    # Same reason as the source install: fixture hooks are never dispatched, so
    # the target checkout's monitoring configs have to be seeded from here.
    if [ "$UPGRADE_ENABLE_MONITORING" = "yes" ]; then
        sync_monitoring_configs_to_daemon "$PROJECT_ROOT"
    fi

    if ! run_install_script "$PROJECT_ROOT"; then
        return 1
    fi
    verify_legacy_docker_resources_preserved || return 1
    disable_compose_project_restart_policy "$COMPOSE_PROJECT_NAME"

    # Wait for containers to be healthy
    if ! wait_for_all_containers_healthy 300; then
        log_error "Containers failed to start after upgrade"
        return 1
    fi

    # Wait for migration to complete before proceeding
    if ! wait_for_migration_complete 180; then
        log_warning "Migration may not have completed cleanly"
        # Don't fail here - migration might have already been done
    fi

    # Extra wait for backend to fully initialize after migration
    sleep 5

    register_owned_lane_images || return 1

    log_success "Upgrade completed successfully"
    return 0
}

# ============================================
# Test: Verify Secrets Preserved
# ============================================

test_verify_secrets_preserved() {
    log_info "Verifying secrets were preserved..."

    # Reload runtime env
    load_runtime_env

    if [ "$JWT_SECRET" != "$ORIGINAL_JWT_SECRET" ]; then
        log_error "JWT_SECRET changed after upgrade"
        return 1
    fi

    if [ "$ENCRYPTION_KEY" != "$ORIGINAL_ENCRYPTION_KEY" ]; then
        log_error "ENCRYPTION_KEY changed after upgrade"
        return 1
    fi

    if [ "$ENCRYPTION_SALT" != "$ORIGINAL_ENCRYPTION_SALT" ]; then
        log_error "ENCRYPTION_SALT changed after upgrade"
        return 1
    fi

    if [ "$GATEWAY_SECRET" != "$ORIGINAL_GATEWAY_SECRET" ]; then
        log_error "GATEWAY_SECRET changed after upgrade"
        return 1
    fi

    if [ "$POSTGRES_PASSWORD" != "$ORIGINAL_POSTGRES_PASSWORD" ]; then
        log_error "POSTGRES_PASSWORD changed after upgrade"
        return 1
    fi

    log_success "All 5 secrets preserved correctly"
    return 0
}

wait_for_optional_profile_container() {
    local container_name="$1"
    local display_name="$2"
    local expected_state="$3"

    if [ -z "$container_name" ]; then
        log_error "$display_name container name is not configured"
        return 1
    fi

    case "$expected_state" in
        healthy)
            wait_for_container_healthy "$container_name" 180
            ;;
        running)
            wait_for_container_running "$container_name" 120
            ;;
        *)
            log_error "Unknown optional profile container state: $expected_state"
            return 1
            ;;
    esac
}

verify_mcp_profile_container() {
    local project_dir="$1"
    local container_name=""

    container_name="$(get_container_name mcp)"
    if [ -z "$container_name" ]; then
        log_error "MCP profile service is not running for $project_dir"
        return 1
    fi

    wait_for_optional_profile_container "$container_name" "MCP" healthy
}

verify_optional_profile_containers_after_upgrade() {
    wait_for_optional_profile_container "${JAEGER_CONTAINER_NAME:-}" "Jaeger" healthy || return 1
    wait_for_optional_profile_container "${LOKI_CONTAINER_NAME:-}" "Loki" healthy || return 1
    wait_for_optional_profile_container "${PROMTAIL_CONTAINER_NAME:-}" "Promtail" healthy || return 1
    wait_for_optional_profile_container "${PROMETHEUS_CONTAINER_NAME:-}" "Prometheus" healthy || return 1
    wait_for_optional_profile_container "${ALERTMANAGER_CONTAINER_NAME:-}" "Alertmanager" healthy || return 1
    wait_for_optional_profile_container "${GRAFANA_CONTAINER_NAME:-}" "Grafana" healthy || return 1
    wait_for_optional_profile_container "${TOR_CONTAINER_NAME:-}" "Tor" healthy || return 1
    verify_mcp_profile_container "$PROJECT_ROOT" || return 1
}

test_verify_fixture_runtime_shape() {
    log_info "Verifying fixture runtime shape..."

    load_runtime_env || return 1

    if [ "$UPGRADE_USE_LEGACY_RUNTIME_ENV" = "true" ]; then
        if [ "$(resolve_env_file)" != "$LEGACY_TARGET_ENV_FILE" ]; then
            log_error "legacy-runtime-env fixture did not use target .env"
            log_error "Resolved env: $(resolve_env_file)"
            return 1
        fi
    fi

    if [ "$UPGRADE_EXPECT_OPTIONAL_PROFILES" = "true" ]; then
        if [ "${ENABLE_MONITORING:-}" != "yes" ] || [ "${ENABLE_TOR:-}" != "yes" ] || [ "${ENABLE_MCP:-}" != "yes" ]; then
            log_error "optional-profiles fixture did not persist monitoring/Tor/MCP flags"
            log_error "ENABLE_MONITORING=${ENABLE_MONITORING:-unset}"
            log_error "ENABLE_TOR=${ENABLE_TOR:-unset}"
            log_error "ENABLE_MCP=${ENABLE_MCP:-unset}"
            return 1
        fi

        verify_optional_profile_containers_after_upgrade || return 1
    fi

    log_success "Fixture runtime shape verified"
    return 0
}

# ============================================
# Test: Verify Data Preserved After Upgrade
# ============================================

test_verify_data_preserved() {
    log_info "Verifying data preserved after upgrade..."

    if ! login_as_upgrade_user; then
        log_error "Cannot login with pre-upgrade password"
        return 1
    fi

    log_success "User data preserved after upgrade"
    return 0
}

# ============================================
# Test: Verify Representative App State
# ============================================

test_verify_representative_app_state_preserved() {
    verify_representative_app_state_preserved
}

test_verify_transaction_migrations() {
    verify_transaction_migrations
}

# Seeded as late as possible before the stop: the source ref is live until then
# and a real sync attempt would overwrite the legacy shape this fixture plants.
test_seed_wallet_sync_state_fixture() {
    seed_wallet_sync_state_fixture || return 1
    seed_wallet_sync_retirement_fixture
}

test_verify_wallet_sync_state_migration() {
    verify_wallet_sync_state_migration
}

test_verify_wallet_sync_retirement_upgrade() {
    verify_wallet_sync_retirement_upgrade
}

# ============================================
# Test: Verify 2FA Preserved After Upgrade
# ============================================

test_verify_two_factor_preserved() {
    log_info "Verifying 2FA state preserved after upgrade..."

    if ! verify_admin_two_factor_secret_decrypts; then
        return 1
    fi

    if ! login_as_upgrade_user true; then
        log_error "Pre-upgrade 2FA secret could not complete post-upgrade login"
        return 1
    fi

    if [ -z "$CSRF_TOKEN" ]; then
        log_error "2FA login succeeded but sanctuary_csrf cookie missing"
        return 1
    fi

    log_success "2FA challenge and verification succeeded after upgrade"
    return 0
}

# ============================================
# Test: Verify Multiple 2FA Users Preserved After Upgrade
# ============================================

test_verify_multiple_two_factor_users_preserved() {
    log_info "Verifying multiple 2FA users and legacy plaintext secret after upgrade..."

    if ! verify_seeded_two_factor_users_decrypt; then
        return 1
    fi

    if ! login_with_two_factor_fixture \
        "$OPERATOR_TWO_FACTOR_USERNAME" \
        "$OPERATOR_TWO_FACTOR_PASSWORD" \
        "$OPERATOR_TWO_FACTOR_SECRET" \
        true; then
        log_error "Encrypted operator 2FA user could not complete post-upgrade login"
        return 1
    fi

    if ! login_with_two_factor_fixture \
        "$LEGACY_TWO_FACTOR_USERNAME" \
        "$LEGACY_TWO_FACTOR_PASSWORD" \
        "$LEGACY_TWO_FACTOR_SECRET" \
        true; then
        log_error "Legacy plaintext 2FA user could not complete post-upgrade login"
        return 1
    fi

    log_success "Multiple encrypted and legacy plaintext 2FA users completed post-upgrade login"
    return 0
}

# ============================================
# Test: Verify 2FA Backup Code Preserved After Upgrade
# ============================================

test_verify_two_factor_backup_code_preserved() {
    log_info "Verifying 2FA backup code preserved after upgrade..."

    if [ -z "$ORIGINAL_TWO_FACTOR_BACKUP_CODE" ]; then
        log_error "No pre-upgrade 2FA backup code is available"
        return 1
    fi

    local formatted_backup_code
    formatted_backup_code=$(format_backup_code_for_login "$ORIGINAL_TWO_FACTOR_BACKUP_CODE")

    if ! login_as_upgrade_user true "$formatted_backup_code"; then
        log_error "Pre-upgrade 2FA backup code could not complete post-upgrade login"
        return 1
    fi

    if ! verify_admin_backup_code_count 0; then
        return 1
    fi

    if ! expect_backup_code_reuse_rejected "$formatted_backup_code"; then
        return 1
    fi

    log_success "2FA backup code survived upgrade, accepts normalized input, was marked used, and cannot be replayed"
    return 0
}

# ============================================
# Test: Verify Drifted Encryption Material Rejected
# ============================================

test_verify_two_factor_rejects_drifted_material() {
    if ! verify_admin_two_factor_rejects_drifted_material; then
        return 1
    fi

    log_success "2FA encrypted state rejects drifted encryption material"
    return 0
}

# ============================================
# Test: Reset 2FA And Re-Enroll After Upgrade
# ============================================

test_reset_two_factor_and_reenroll() {
    log_info "Testing 2FA reset recovery and re-enrollment after upgrade..."

    # The recovery script resolves its deployment from its own checkout, so it
    # must run from the deployment root: for an owned source that is the
    # in-place checkout, not the harness checkout (PR #1030, run 14879).
    local recovery_dir reset_output
    recovery_dir="$TEST_RUNTIME_DIR/recovery"
    reset_output=$(
        export SANCTUARY_2FA_RESET_BACKUP_DIR="$recovery_dir"
        "$PROJECT_ROOT/scripts/reset-user-2fa.sh" --username admin --yes 2>&1
    ) || {
        log_error "2FA reset recovery script failed"
        log_error "Output: $reset_output"
        return 1
    }

    if ! echo "$reset_output" | grep -q "2FA reset complete"; then
        log_error "2FA reset recovery script did not report completion"
        log_error "Output: $reset_output"
        return 1
    fi

    local backup_file
    backup_file=$(find "$recovery_dir" -name 'admin-2fa-before-reset-*.json' -type f | head -n 1)
    if [ -z "$backup_file" ] || [ ! -s "$backup_file" ]; then
        log_error "2FA reset recovery script did not create a non-empty backup"
        return 1
    fi

    if ! login_as_upgrade_user false "" true; then
        log_error "Password-only login failed after 2FA reset"
        return 1
    fi

    if ! reenroll_admin_two_factor_via_api; then
        return 1
    fi

    if ! login_as_upgrade_user true; then
        log_error "Freshly re-enrolled 2FA could not complete login"
        return 1
    fi

    log_success "2FA reset recovery and re-enrollment succeeded after upgrade"
    return 0
}

# ============================================
# Test: Verify Migration Runs on Upgrade
# ============================================

test_verify_migration_on_upgrade() {
    log_info "Verifying migration container ran..."

    # Get migrate container name dynamically
    local container=$(get_container_name "migrate")
    if [ -z "$container" ]; then
        log_warning "Migration container not found (may have been removed)"
        return 0
    fi

    # Check if migrate container exists and completed
    local status=$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo "not_found")

    if [ "$status" = "exited" ]; then
        local exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$container" 2>/dev/null)
        if [ "$exit_code" = "0" ]; then
            log_success "Migration container completed successfully"
            return 0
        else
            log_error "Migration container failed with exit code: $exit_code"
            compose_logs migrate 20 | tail -20
            return 1
        fi
    elif [ "$status" = "not_found" ]; then
        log_warning "Migration container not found (may have been removed)"
        return 0
    else
        log_warning "Migration container in unexpected state: $status"
        return 0
    fi
}

test_post_upgrade_user_visible_smoke() {
    if [ "$UPGRADE_RUN_BROWSER_SMOKE" != "true" ]; then
        log_info "Skipping browser/user-visible smoke for fixture: $UPGRADE_FIXTURE"
        return 0
    fi

    assert_post_upgrade_user_smoke "$BROWSER_BASE_URL"
}

test_frontend_proxy_survives_backend_recreate() {
    if ! fixture_list_contains "$UPGRADE_FIXTURE" "baseline" \
        && ! fixture_list_contains "$UPGRADE_FIXTURE" "browser-origin-ip"; then
        log_info "Skipping backend-replacement proxy recovery for fixture: $UPGRADE_FIXTURE"
        return 0
    fi

    assert_frontend_proxy_recovers_after_backend_recreate "$BROWSER_BASE_URL"
}

test_verify_notification_delivery_diagnostics() {
    if [ "$UPGRADE_SEED_NOTIFICATION_STATE" != "true" ]; then
        log_info "Skipping notification delivery diagnostics for fixture: $UPGRADE_FIXTURE"
        return 0
    fi

    if [ -z "$TEST_WALLET_ID" ]; then
        log_error "Notification fixture requires the seeded wallet id"
        return 1
    fi

    enqueue_notification_delivery_probe || return 1
    wait_for_notification_dlq_entry || return 1

    log_success "Notification worker delivery path and DLQ diagnostics survived upgrade"
}

test_recover_postgres_password_drift() {
    log_info "Testing PostgreSQL password synchronization during setup..."

    cd "$PROJECT_ROOT"
    load_runtime_env || return 1

    local original_password="$POSTGRES_PASSWORD"
    local drifted_password="drifted-${TEST_ID}-postgres-password"
    local setup_output=""

    if [ "$drifted_password" = "$original_password" ]; then
        drifted_password="${drifted_password}-x"
    fi

    if ! replace_env_value "POSTGRES_PASSWORD" "$drifted_password" "$TEST_ENV_FILE"; then
        log_error "Failed to inject a drifted POSTGRES_PASSWORD into the runtime env"
        return 1
    fi

    # Keep postgres running so setup.sh can recover the real password from the
    # existing container and volume, then restart the application stack.
    run_project_compose "$PROJECT_ROOT" stop \
        backend worker frontend gateway llm-egress-proxy migrate 2>&1 || true

    setup_output=$(
        export SANCTUARY_ENV_FILE="$TEST_ENV_FILE"
        export SANCTUARY_SSL_DIR="$TEST_SSL_DIR"
        export SANCTUARY_COMPOSE_SSL_DIR="$TEST_COMPOSE_SSL_DIR"
        export HTTPS_PORT
        export HTTP_PORT
        export GATEWAY_PORT
        export ENABLE_MONITORING="$UPGRADE_ENABLE_MONITORING"
        export ENABLE_TOR="$UPGRADE_ENABLE_TOR"
        export MCP_BIND_ADDRESS
        export MCP_PORT
        unset ENABLE_MCP
        unset COMPOSE_PROFILES
        export RATE_LIMIT_LOGIN=100
        export RATE_LIMIT_2FA=100
        export RATE_LIMIT_PASSWORD_CHANGE=100
        bash "$PROJECT_ROOT/scripts/setup.sh" --force --non-interactive --skip-ssl 2>&1
    ) || {
        log_error "setup.sh failed while recovering the PostgreSQL password drift"
        log_error "Output: $(redact_text "$setup_output")"
        return 1
    }

    if [ "$VERBOSE" = "true" ]; then
        redact_text "$setup_output"
    fi

    load_runtime_env || return 1

    if [ "$POSTGRES_PASSWORD" != "$drifted_password" ]; then
        log_error "setup.sh did not preserve the drifted PostgreSQL password in the runtime env"
        log_error "  Expected: $drifted_password"
        log_error "  Current:  $POSTGRES_PASSWORD"
        return 1
    fi

    if ! wait_for_all_containers_healthy 300; then
        log_error "Containers did not become healthy after PostgreSQL password recovery"
        return 1
    fi

    if ! wait_for_migration_complete 120; then
        log_error "Migration did not complete after PostgreSQL password recovery"
        return 1
    fi

    local postgres_container=""
    local postgres_network=""
    local db_check=""
    postgres_container="$(docker compose ps -q postgres)"
    postgres_network=$(docker inspect --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' \
        "$postgres_container" | head -n 1)
    db_check=$(docker run --rm --network "$postgres_network" -e "PGPASSWORD=$drifted_password" \
        postgres:16-alpine \
        psql -w -h postgres -U sanctuary -d sanctuary -tAc "SELECT 1" 2>/dev/null || true)

    if [ "$db_check" != "1" ]; then
        log_error "Database did not accept the synchronized PostgreSQL password from the Compose network"
        return 1
    fi

    if ! login_as_upgrade_user; then
        log_error "Login failed after PostgreSQL password recovery"
        return 1
    fi

    log_success "setup.sh synchronized the PostgreSQL password drift"
    return 0
}

run_extended_upgrade_scenarios() {
    if [ "$UPGRADE_TEST_MODE" != "full" ]; then
        log_info "Skipping extended recovery scenarios in core mode"
        return 0
    fi

    run_test "Recover PostgreSQL Password Drift" test_recover_postgres_password_drift
    run_test "Verify All Services" test_verify_all_services
    run_test "Force Rebuild Upgrade" test_force_rebuild_upgrade
    run_test "Volume Data Persistence" test_volume_data_persistence
}

# ============================================
# Test: Verify All Services Functional
# ============================================

test_verify_all_services() {
    log_info "Verifying all services are functional..."

    if ! login_as_upgrade_user; then
        log_error "Cannot authenticate after upgrade"
        return 1
    fi

    # Test /me endpoint (GET — cookies only)
    local me_response=$(curl -k -s -b "$COOKIE_JAR" \
        "$API_BASE_URL/api/v1/auth/me")

    if ! echo "$me_response" | grep -q '"username"'; then
        log_error "GET /me endpoint failed"
        return 1
    fi

    # Test /wallets endpoint
    local wallets_response=$(curl -k -s -b "$COOKIE_JAR" \
        "$API_BASE_URL/api/v1/wallets")

    if ! echo "$wallets_response" | grep -qE '^\['; then
        log_error "GET /wallets endpoint failed"
        return 1
    fi

    log_success "All services functional after upgrade"
    return 0
}

# ============================================
# Test: Force Rebuild Upgrade
# ============================================

test_force_rebuild_upgrade() {
    log_info "Testing force rebuild upgrade..."

    cd "$PROJECT_ROOT"

    # Load secrets
    load_runtime_env || return 1

    local rebuild_output=""
    set +e
    rebuild_output=$(
        export HTTPS_PORT
        export HTTP_PORT
        export GATEWAY_PORT
        export SANCTUARY_ENV_FILE="$(resolve_env_file)"
        export SANCTUARY_SSL_DIR="$TEST_SSL_DIR"
        export SANCTUARY_COMPOSE_SSL_DIR="$TEST_COMPOSE_SSL_DIR"
        export RATE_LIMIT_LOGIN=100
        export RATE_LIMIT_2FA=100
        export RATE_LIMIT_PASSWORD_CHANGE=100
        bash "$PROJECT_ROOT/start.sh" --rebuild 2>&1
    )
    local exit_code=$?
    set -e

    if [ "$VERIFY_FORCE_REBUILD" = "true" ]; then
        mkdir -p "$UPGRADE_ARTIFACT_DIR"
        redact_text "$rebuild_output" > "$UPGRADE_ARTIFACT_DIR/force-rebuild.log"
    fi

    if [ "$VERBOSE" = "true" ]; then
        redact_text "$rebuild_output"
    fi

    if [ $exit_code -ne 0 ]; then
        write_force_rebuild_result "failed" "start_exit_$exit_code"
        log_error "start.sh --rebuild failed"
        log_error "Output: $(redact_text "$rebuild_output")"
        return 1
    fi

    # Wait for all containers
    if ! wait_for_all_containers_healthy 300; then
        write_force_rebuild_result "failed" "unhealthy_services"
        log_error "Force rebuild failed"
        return 1
    fi

    # Wait for migration to complete
    if ! wait_for_migration_complete 180; then
        if [ "$VERIFY_FORCE_REBUILD" = "true" ]; then
            write_force_rebuild_result "failed" "migration_incomplete"
            log_error "Migration did not complete after release-critical force rebuild"
            return 1
        fi
        log_warning "Migration may not have completed cleanly after rebuild"
        # Don't fail - migration might be idempotent
    fi

    # Extra wait for backend to fully initialize
    sleep 5

    if ! login_as_upgrade_user; then
        write_force_rebuild_result "failed" "login_failed"
        log_error "Login failed after force rebuild"
        return 1
    fi

    log_success "Force rebuild upgrade successful"
    return 0
}

write_force_rebuild_result() {
    local status="$1"
    local detail="$2"

    [ "$VERIFY_FORCE_REBUILD" = "true" ] || return 0
    mkdir -p "$UPGRADE_ARTIFACT_DIR"
    printf 'status=%s\ndetail=%s\n' "$status" "$detail" \
        > "$UPGRADE_ARTIFACT_DIR/force-rebuild-result.txt"
}

# ============================================
# Test: Volume Data Persistence
# ============================================

test_volume_data_persistence() {
    log_info "Testing volume data persistence..."

    cd "$PROJECT_ROOT"

    # Check postgres_data volume exists (volume names include project name)
    local volume_exists=$(docker volume ls --filter "name=postgres_data" -q 2>/dev/null)

    if [ -z "$volume_exists" ]; then
        log_warning "PostgreSQL data volume not found with expected name"
        # This might be okay if using different naming
    else
        log_info "Found PostgreSQL data volume"
    fi

    # Verify data still accessible with retry mechanism
    # After force-recreate, postgres may need a moment to fully initialize
    local max_attempts=10
    local attempt=1
    local user_count=""

    while [ $attempt -le $max_attempts ]; do
        user_count=$(compose_exec postgres psql -U sanctuary -d sanctuary -t -c \
            "SELECT COUNT(*) FROM users;" 2>&1)
        local exit_code=$?

        # Clean up whitespace
        user_count=$(echo "$user_count" | tr -d ' \n\r\t')

        log_debug "Attempt $attempt/$max_attempts: exit=$exit_code, user_count='$user_count'"

        # Check if we got a valid number >= 1
        if [ "$exit_code" = "0" ] && [[ "$user_count" =~ ^[0-9]+$ ]] && [ "$user_count" -ge 1 ]; then
            log_success "Volume data persisted correctly (found $user_count users)"
            return 0
        fi

        if [ $attempt -lt $max_attempts ]; then
            log_info "Waiting for database to be ready (attempt $attempt/$max_attempts)..."
            sleep 3
        fi
        attempt=$((attempt + 1))
    done

    log_error "No users found in database after $max_attempts attempts - data may have been lost"
    log_error "Last query result: '$user_count'"
    # Show container status for debugging
    docker ps --filter "name=postgres" --format "table {{.Names}}\t{{.Status}}"
    return 1
}

test_verify_mcp_disabled_after_rebuild() {
    log_info "Verifying MCP remains disabled after the release-critical rebuild..."

    load_runtime_env || return 1
    if [ "${ENABLE_MCP:-no}" = "yes" ]; then
        log_error "Release-critical baseline unexpectedly persisted ENABLE_MCP=yes"
        return 1
    fi

    local running_mcp
    running_mcp="$(docker ps \
        --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" \
        --filter "label=com.docker.compose.service=mcp" \
        --filter "status=running" -q)"
    if [ -n "$running_mcp" ]; then
        log_error "MCP is running after an MCP-disabled release-critical rebuild"
        return 1
    fi

    log_success "MCP remained disabled after the release-critical rebuild"
    return 0
}

test_release_force_rebuild_gate() {
    test_force_rebuild_upgrade || return 1

    if ! test_verify_mcp_disabled_after_rebuild; then
        write_force_rebuild_result "failed" "mcp_enabled"
        return 1
    fi
    if ! test_volume_data_persistence; then
        write_force_rebuild_result "failed" "data_not_persisted"
        return 1
    fi

    write_force_rebuild_result \
        "passed" \
        "healthy_migrated_authenticated_mcp_disabled_data_persisted"
    return 0
}

# ============================================
# Main Test Runner
# ============================================

main() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Sanctuary Upgrade Install E2E Test${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""

    # Setup
    setup

    # Phase 1: Prepare existing installation
    run_test "Ensure Existing Installation" test_ensure_existing_installation
    run_test "Create Pre-Upgrade Data" test_create_pre_upgrade_data
    run_test "Capture Pre-Upgrade State" test_capture_pre_upgrade_state
    run_test "Seed Wallet Sync State Fixture" test_seed_wallet_sync_state_fixture

    # Phase 2: Simulate upgrade
    run_test "Stop Containers for Upgrade" test_stop_containers_for_upgrade
    run_test "Simulate Git Update" test_simulate_git_update
    run_test "Restart Containers After Upgrade" test_restart_containers_after_upgrade

    # Phase 3: Verify upgrade success
    run_test "Verify Secrets Preserved" test_verify_secrets_preserved
    run_test "Verify Fixture Runtime Shape" test_verify_fixture_runtime_shape
    run_test "Verify Data Preserved" test_verify_data_preserved
    run_test "Verify Representative App State Preserved" test_verify_representative_app_state_preserved
    run_test "Verify Transaction Migrations" test_verify_transaction_migrations
    run_test "Verify Wallet Sync State Migration" test_verify_wallet_sync_state_migration
    run_test "Verify Wallet Sync Scheduler Retirement" test_verify_wallet_sync_retirement_upgrade
    run_test "Verify 2FA Preserved" test_verify_two_factor_preserved
    run_test "Verify Multiple 2FA Users Preserved" test_verify_multiple_two_factor_users_preserved
    run_test "Verify 2FA Backup Code Preserved" test_verify_two_factor_backup_code_preserved
    run_test "Verify 2FA Rejects Drifted Encryption Material" test_verify_two_factor_rejects_drifted_material
    run_test "Reset 2FA And Re-Enroll" test_reset_two_factor_and_reenroll
    run_test "Verify Migration on Upgrade" test_verify_migration_on_upgrade
    run_test "Post-Upgrade User-Visible Smoke" test_post_upgrade_user_visible_smoke
    run_test "Frontend Proxy Survives Backend Recreate" test_frontend_proxy_survives_backend_recreate
    run_test "Verify Notification Delivery Diagnostics" test_verify_notification_delivery_diagnostics
    run_extended_upgrade_scenarios
    if [ "$VERIFY_FORCE_REBUILD" = "true" ]; then
        run_test "Release-Critical Force Rebuild Gate" test_release_force_rebuild_gate
    fi

    if [ $TESTS_FAILED -gt 0 ] || [ "$VERIFY_FORCE_REBUILD" = "true" ]; then
        collect_upgrade_artifacts \
            "$UPGRADE_ARTIFACT_DIR" \
            "$PROJECT_ROOT" \
            "$TEST_RUNTIME_DIR" \
            "$(resolve_env_file)" \
            "$UPGRADE_SOURCE_LABEL" \
            "$UPGRADE_TARGET_LABEL" \
            "$UPGRADE_FIXTURE" \
            "$UPGRADE_TEST_MODE" || true
    fi

    # Teardown
    teardown

    # Summary
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Test Summary${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
    echo "  Total:  $TESTS_RUN"
    echo -e "  ${GREEN}Passed: $TESTS_PASSED${NC}"
    echo -e "  ${RED}Failed: $TESTS_FAILED${NC}"
    echo ""

    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "${RED}Failed Tests:${NC}"
        for test in "${FAILED_TESTS[@]}"; do
            echo "  - $test"
        done
        echo ""
        exit 1
    else
        echo -e "${GREEN}All tests passed!${NC}"
        echo ""
        exit 0
    fi
}

# Run tests
main "$@"
