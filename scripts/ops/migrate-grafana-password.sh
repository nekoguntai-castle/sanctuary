#!/bin/sh

set -eu

data_dir="${GRAFANA_DATA_DIR:-/var/lib/grafana}"
database="$data_dir/grafana.db"
marker="$data_dir/.sanctuary-independent-password-v1"
grafana_cli="${GRAFANA_CLI_BIN:-/usr/share/grafana/bin/grafana}"
snapshot="$data_dir/.sanctuary-grafana-password-snapshot.$$"
snapshot_ready=false
quiescence_dir="${SANCTUARY_GRAFANA_QUIESCENCE_DIR:-/var/lib/sanctuary-grafana-quiescence}"
owner_proc="${SANCTUARY_GRAFANA_QUIESCENCE_OWNER_PROC:-$quiescence_dir/owner-proc}"
outcome_dir="${SANCTUARY_GRAFANA_QUIESCENCE_OUTCOME_DIR:-/var/lib/sanctuary-grafana-quiescence-outcomes}"
outcome_file=""

cleanup_snapshot() {
    rm -f "$snapshot/grafana.db" "$snapshot/grafana.db-journal" \
        "$snapshot/grafana.db-wal" "$snapshot/grafana.db-shm"
    rmdir "$snapshot" 2>/dev/null || true
}

restore_snapshot() {
    rm -f "$database" "$database-journal" "$database-wal" "$database-shm" "$marker"
    cp "$snapshot/grafana.db" "$database"
    [ ! -f "$snapshot/grafana.db-journal" ] || cp "$snapshot/grafana.db-journal" "$database-journal"
    [ ! -f "$snapshot/grafana.db-wal" ] || cp "$snapshot/grafana.db-wal" "$database-wal"
    [ ! -f "$snapshot/grafana.db-shm" ] || cp "$snapshot/grafana.db-shm" "$database-shm"
}

finish() {
    status=$?
    trap - EXIT HUP INT TERM
    if [ "$status" -ne 0 ] && [ "$snapshot_ready" = "true" ]; then
        restore_snapshot
        [ -z "$outcome_file" ] || printf 'rolled-back\n' > "$outcome_file"
        echo "Grafana credential migration failed; the database snapshot was restored." >&2
    fi
    [ ! -d "$snapshot" ] || cleanup_snapshot
    exit "$status"
}

trap finish EXIT
trap 'exit 1' HUP INT TERM

read_lease_value() {
    key="$1"
    sed -n "s/^${key}=//p" "$lease_file"
}

read_owner_start_time() {
    sed 's/.*) //' "$owner_proc/stat" 2>/dev/null | awk '{print $20}'
}

require_live_lease_owner() {
    expected_owner_pid="${SANCTUARY_GRAFANA_QUIESCENCE_OWNER_PID:-}"
    expected_owner_start_time="${SANCTUARY_GRAFANA_QUIESCENCE_OWNER_START_TIME:-}"
    case "$expected_owner_pid:$expected_owner_start_time" in
        *[!0-9:]*|:|*:)
            echo "The Grafana quiescence owner identity is invalid." >&2
            return 1
            ;;
    esac
    [ "$(awk '{print $1}' "$owner_proc/stat" 2>/dev/null)" = "$expected_owner_pid" ] \
        && [ "$(read_owner_start_time)" = "$expected_owner_start_time" ] || {
        echo "The Grafana quiescence owner is no longer live." >&2
        return 1
    }
}

require_quiescence_lease() {
    token="${SANCTUARY_GRAFANA_QUIESCENCE_TOKEN:-}"
    expected_project="${SANCTUARY_GRAFANA_QUIESCENCE_PROJECT:-}"
    expected_container_id="${SANCTUARY_GRAFANA_QUIESCENCE_CONTAINER_ID:-}"
    expected_generation="${SANCTUARY_GRAFANA_QUIESCENCE_GENERATION:-}"
    case "$token" in
        ''|*[!0-9a-f]*)
            echo "A current Grafana quiescence lease is required for existing data." >&2
            return 1
            ;;
    esac
    [ "${#token}" -eq 64 ] || {
        echo "A current Grafana quiescence lease is required for existing data." >&2
        return 1
    }
    outcome_file="$outcome_dir/outcome-$token"
    [ -n "$expected_project" ] && [ -n "$expected_container_id" ] \
        && [ -n "$expected_generation" ] || {
        echo "The Grafana quiescence lease is missing its scoped identity." >&2
        return 1
    }

    lease_file="$quiescence_dir/lease-$token"
    [ -f "$lease_file" ] || {
        echo "The Grafana quiescence lease is missing or already consumed." >&2
        return 1
    }
    require_live_lease_owner

    [ "$(read_lease_value version)" = "1" ] \
        && [ "$(read_lease_value token)" = "$token" ] \
        && [ "$(read_lease_value project)" = "$expected_project" ] \
        && [ "$(read_lease_value container_id)" = "$expected_container_id" ] \
        && [ "$(read_lease_value generation)" = "$expected_generation" ] \
        && [ "$(read_lease_value owner_pid)" = "$expected_owner_pid" ] \
        && [ "$(read_lease_value owner_start_time)" = "$expected_owner_start_time" ] || {
        echo "The Grafana quiescence lease does not match this Compose instance." >&2
        return 1
    }

    expires_at="$(read_lease_value expires_at)"
    case "$expires_at" in
        ''|*[!0-9]*)
            echo "The Grafana quiescence lease has an invalid expiry." >&2
            return 1
            ;;
    esac
    [ "$(date +%s)" -le "$expires_at" ] || {
        echo "The Grafana quiescence lease has expired." >&2
        return 1
    }

    mkdir "$quiescence_dir/claims/$token" 2>/dev/null || {
        echo "The Grafana quiescence lease is stale or has already been used." >&2
        return 1
    }
    require_live_lease_owner
}

if [ -z "${GRAFANA_PASSWORD:-}" ]; then
    echo "GRAFANA_PASSWORD is required for Grafana startup." >&2
    exit 1
fi

if [ -f "$marker" ]; then
    echo "Grafana independent credential is already initialized."
    exit 0
fi

if [ ! -f "$database" ]; then
    umask 077
    : > "$marker"
    echo "Grafana fresh-volume credential initialization is ready."
    exit 0
fi

# An existing database must never be inspected or copied unless the host-side
# wrapper has stopped and positively identified the matching Compose instance.
# The atomic claim makes the short-lived lease single use across concurrent
# migration containers.
require_quiescence_lease

umask 077
mkdir "$snapshot"
cp "$database" "$snapshot/grafana.db"
[ ! -f "$database-journal" ] || cp "$database-journal" "$snapshot/grafana.db-journal"
[ ! -f "$database-wal" ] || cp "$database-wal" "$snapshot/grafana.db-wal"
[ ! -f "$database-shm" ] || cp "$database-shm" "$snapshot/grafana.db-shm"
snapshot_ready=true

if ! "$grafana_cli" cli \
    --homepath /usr/share/grafana \
    --config /etc/grafana/grafana.ini \
    admin reset-admin-password "$GRAFANA_PASSWORD" >/dev/null 2>&1; then
    exit 1
fi

# The Docker Compose client inherits the host kernel lock for the entire
# migration command. Rechecking its live owner here makes owner death fail into
# the snapshot rollback path before a completion marker can be published.
require_live_lease_owner

# Test-only fault injection proves that every post-reset failure restores the
# private snapshot. The Compose contract never supplies this variable.
if [ "${SANCTUARY_TEST_GRAFANA_MIGRATION_FAIL_AFTER_RESET:-false}" = "true" ]; then
    exit 1
fi

require_live_lease_owner
: > "$marker"
printf 'success\n' > "$outcome_file"
echo "Grafana independent credential migration completed."
