#!/bin/sh

set -eu

data_dir="${GRAFANA_DATA_DIR:-/var/lib/grafana}"
database="$data_dir/grafana.db"
marker="$data_dir/.sanctuary-independent-password-v1"
grafana_cli="${GRAFANA_CLI_BIN:-/usr/share/grafana/bin/grafana}"
snapshot="$data_dir/.sanctuary-grafana-password-snapshot.$$"
snapshot_ready=false
lease_claimed=false
marker_created=false
control_dir="${SANCTUARY_GRAFANA_CONTROL_DIR:-/var/lib/sanctuary-grafana-control}"
outcome_file=""
lease_file=""

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

read_record_value() {
    key="$1"
    file="$2"
    sed -n "s/^${key}=//p" "$file"
}

write_outcome() {
    outcome_status="$1"
    temporary="$outcome_file.tmp.$$"
    umask 077
    {
        printf 'version=1\n'
        printf 'status=%s\n' "$outcome_status"
        printf 'token=%s\n' "$token"
        printf 'project=%s\n' "$expected_project"
        printf 'data_volume=%s\n' "$expected_data_volume"
        printf 'control_volume=%s\n' "$expected_control_volume"
        printf 'container_id=%s\n' "$expected_container_id"
        printf 'generation=%s\n' "$expected_generation"
    } > "$temporary"
    mv "$temporary" "$outcome_file"
}

finish() {
    exit_status=$?
    trap - EXIT HUP INT TERM
    if [ "$exit_status" -ne 0 ] && [ "$lease_claimed" = "true" ]; then
        if [ "$snapshot_ready" = "true" ]; then
            restore_snapshot
            echo "Grafana credential migration failed; the database snapshot was restored." >&2
        elif [ "$marker_created" = "true" ]; then
            rm -f "$marker"
        fi
        write_outcome rolled-back
    fi
    [ ! -d "$snapshot" ] || cleanup_snapshot
    exit "$exit_status"
}

trap finish EXIT
trap 'exit 1' HUP INT TERM

require_scoped_value() {
    value="$1"
    label="$2"
    case "$value" in
        ''|*[!A-Za-z0-9_.:-]*)
            echo "The Grafana quiescence $label is invalid." >&2
            return 1
            ;;
    esac
}

require_quiescence_lease() {
    token="${SANCTUARY_GRAFANA_QUIESCENCE_TOKEN:-}"
    expected_project="${SANCTUARY_GRAFANA_QUIESCENCE_PROJECT:-}"
    expected_data_volume="${SANCTUARY_GRAFANA_DATA_VOLUME:-}"
    expected_control_volume="${SANCTUARY_GRAFANA_CONTROL_VOLUME:-}"
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
    require_scoped_value "$expected_project" project
    require_scoped_value "$expected_data_volume" data-volume
    require_scoped_value "$expected_control_volume" control-volume
    require_scoped_value "$expected_container_id" container
    require_scoped_value "$expected_generation" generation

    lease_file="$control_dir/leases/lease-$token"
    outcome_file="$control_dir/outcomes/outcome-$token"
    [ -f "$lease_file" ] || {
        echo "The Grafana quiescence lease is missing or already consumed." >&2
        return 1
    }
    [ "$(read_record_value version "$lease_file")" = "2" ] \
        && [ "$(read_record_value token "$lease_file")" = "$token" ] \
        && [ "$(read_record_value project "$lease_file")" = "$expected_project" ] \
        && [ "$(read_record_value data_volume "$lease_file")" = "$expected_data_volume" ] \
        && [ "$(read_record_value control_volume "$lease_file")" = "$expected_control_volume" ] \
        && [ "$(read_record_value container_id "$lease_file")" = "$expected_container_id" ] \
        && [ "$(read_record_value generation "$lease_file")" = "$expected_generation" ] || {
        echo "The Grafana quiescence lease does not match this Compose instance." >&2
        return 1
    }

    expires_at="$(read_record_value expires_at "$lease_file")"
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
    claim_status=0
    trap '' HUP INT TERM
    mkdir "$control_dir/claims/$token" 2>/dev/null || claim_status=$?
    [ "$claim_status" -ne 0 ] || lease_claimed=true
    trap 'exit 1' HUP INT TERM
    [ "$claim_status" -eq 0 ] || {
        echo "The Grafana quiescence lease is stale or has already been used." >&2
        return 1
    }
}

publish_success() {
    write_outcome success
    echo "$1"
}

if [ -z "${GRAFANA_PASSWORD:-}" ]; then
    echo "GRAFANA_PASSWORD is required for Grafana startup." >&2
    exit 1
fi

token="${SANCTUARY_GRAFANA_QUIESCENCE_TOKEN:-}"
if [ -n "$token" ]; then
    require_quiescence_lease
    if [ "${SANCTUARY_TEST_GRAFANA_MIGRATION_FAIL_AFTER_CLAIM:-false}" = "true" ]; then
        exit 1
    fi
elif [ -f "$marker" ]; then
    echo "Grafana independent credential is already initialized."
    exit 0
elif [ ! -f "$database" ]; then
    umask 077
    marker_created=true
    : > "$marker"
    echo "Grafana fresh-volume credential initialization is ready."
    exit 0
else
    echo "A current Grafana quiescence lease is required for existing data." >&2
    exit 1
fi

if [ -f "$marker" ]; then
    publish_success "Grafana independent credential is already initialized."
    exit 0
fi

if [ ! -f "$database" ]; then
    umask 077
    marker_created=true
    : > "$marker"
    publish_success "Grafana fresh-volume credential initialization is ready."
    exit 0
fi

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

if [ "${SANCTUARY_TEST_GRAFANA_MIGRATION_FAIL_AFTER_RESET:-false}" = "true" ]; then
    exit 1
fi

: > "$marker"
write_outcome success
echo "Grafana independent credential migration completed."
