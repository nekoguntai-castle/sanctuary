#!/bin/sh

set -eu

data_dir="${GRAFANA_DATA_DIR:-/var/lib/grafana}"
database="$data_dir/grafana.db"
marker="$data_dir/.sanctuary-independent-password-v1"
grafana_cli="${GRAFANA_CLI_BIN:-/usr/share/grafana/bin/grafana}"
snapshot="$data_dir/.sanctuary-grafana-password-snapshot.$$"
snapshot_ready=false

cleanup_snapshot() {
    rm -f "$snapshot/grafana.db" "$snapshot/grafana.db-journal" \
        "$snapshot/grafana.db-wal" "$snapshot/grafana.db-shm"
    rmdir "$snapshot" 2>/dev/null || true
}

restore_snapshot() {
    rm -f "$database" "$database-journal" "$database-wal" "$database-shm"
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
        echo "Grafana credential migration failed; the database snapshot was restored." >&2
    fi
    [ ! -d "$snapshot" ] || cleanup_snapshot
    exit "$status"
}

trap finish EXIT
trap 'exit 1' HUP INT TERM

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

# Test-only fault injection proves that every post-reset failure restores the
# private snapshot. The Compose contract never supplies this variable.
if [ "${SANCTUARY_TEST_GRAFANA_MIGRATION_FAIL_AFTER_RESET:-false}" = "true" ]; then
    exit 1
fi

: > "$marker"
echo "Grafana independent credential migration completed."
