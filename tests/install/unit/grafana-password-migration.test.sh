#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
MIGRATION_SCRIPT="$PROJECT_ROOT/scripts/ops/migrate-grafana-password.sh"
TEST_ROOT="$(mktemp -d)"
TEST_OWNER_PID="$$"
TEST_OWNER_START_TIME="$(sed 's/.*) //' "/proc/$TEST_OWNER_PID/stat" | awk '{print $20}')"

cleanup() {
    find "$TEST_ROOT" -type f -delete
    find "$TEST_ROOT" -depth -type d -empty -delete
}
trap cleanup EXIT

make_fake_cli() {
    local path="$1"
    cat > "$path" <<'SCRIPT'
#!/bin/sh
set -eu
for argument in "$@"; do
    password="$argument"
done
printf 'admin:%s\n' "$password" > "$GRAFANA_DATA_DIR/grafana.db"
rm -f "$GRAFANA_DATA_DIR/grafana.db-journal"
SCRIPT
    chmod +x "$path"
}

make_lease() {
    local root="$1"
    local token="$2"
    local expires_at="${3:-$(( $(date +%s) + 300 ))}"
    mkdir -p "$root/claims"
    chmod 777 "$root/claims"
    cat > "$root/lease-$token" <<EOF
version=1
token=$token
project=test-project
container_id=test-container
generation=test-generation
owner_pid=$TEST_OWNER_PID
owner_start_time=$TEST_OWNER_START_TIME
expires_at=$expires_at
EOF
}

run_with_lease() {
    local data="$1"
    local cli="$2"
    local lease_root="$3"
    local token="$4"
    shift 4
    GRAFANA_DATA_DIR="$data" GRAFANA_CLI_BIN="$cli" \
        GRAFANA_PASSWORD="independent-password" \
        SANCTUARY_GRAFANA_QUIESCENCE_DIR="$lease_root" \
        SANCTUARY_GRAFANA_QUIESCENCE_TOKEN="$token" \
        SANCTUARY_GRAFANA_QUIESCENCE_PROJECT="test-project" \
        SANCTUARY_GRAFANA_QUIESCENCE_CONTAINER_ID="test-container" \
        SANCTUARY_GRAFANA_QUIESCENCE_GENERATION="test-generation" \
        SANCTUARY_GRAFANA_QUIESCENCE_OWNER_PID="$TEST_OWNER_PID" \
        SANCTUARY_GRAFANA_QUIESCENCE_OWNER_START_TIME="$TEST_OWNER_START_TIME" \
        SANCTUARY_GRAFANA_QUIESCENCE_OWNER_PROC="/proc/$TEST_OWNER_PID" \
        SANCTUARY_GRAFANA_QUIESCENCE_OUTCOME_DIR="$lease_root" \
        env "$@" sh "$MIGRATION_SCRIPT"
}

assert_secret_absent() {
    local output="$1"
    local secret="$2"
    if [[ "$output" == *"$secret"* ]]; then
        echo "migration output disclosed a credential" >&2
        exit 1
    fi
}

test_fresh_volume_initialization() {
    local data="$TEST_ROOT/fresh"
    mkdir "$data"
    local output
    output="$(GRAFANA_DATA_DIR="$data" GRAFANA_PASSWORD="fresh-secret" sh "$MIGRATION_SCRIPT" 2>&1)"

    test -f "$data/.sanctuary-independent-password-v1"
    test ! -f "$data/grafana.db"
    assert_secret_absent "$output" "fresh-secret"
}

test_existing_volume_migration() {
    local data="$TEST_ROOT/existing"
    local cli="$TEST_ROOT/grafana-cli"
    local lease_root="$TEST_ROOT/existing-lease"
    local token="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    mkdir "$data"
    printf 'admin:legacy-encryption-key\n' > "$data/grafana.db"
    make_fake_cli "$cli"
    make_lease "$lease_root" "$token"

    local output
    output="$(run_with_lease "$data" "$cli" "$lease_root" "$token" 2>&1)"

    grep -Fqx 'admin:independent-password' "$data/grafana.db"
    ! grep -Fq 'legacy-encryption-key' "$data/grafana.db"
    test -f "$data/.sanctuary-independent-password-v1"
    assert_secret_absent "$output" "independent-password"
    assert_secret_absent "$output" "legacy-encryption-key"
}

test_completed_migration_is_idempotent() {
    local data="$TEST_ROOT/completed"
    mkdir "$data"
    printf 'admin:independent-password\nstate=preserved\n' > "$data/grafana.db"
    : > "$data/.sanctuary-independent-password-v1"
    cp "$data/grafana.db" "$TEST_ROOT/completed-original.db"

    local output
    output="$(GRAFANA_DATA_DIR="$data" GRAFANA_CLI_BIN="$TEST_ROOT/missing-cli" \
        GRAFANA_PASSWORD="independent-password" sh "$MIGRATION_SCRIPT" 2>&1)"

    cmp "$TEST_ROOT/completed-original.db" "$data/grafana.db"
    test -f "$data/.sanctuary-independent-password-v1"
    assert_secret_absent "$output" "independent-password"
}

test_failed_migration_rolls_back() {
    local data="$TEST_ROOT/rollback"
    local cli="$TEST_ROOT/grafana-cli-failure"
    local lease_root="$TEST_ROOT/rollback-lease"
    local token="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    mkdir "$data"
    printf 'admin:legacy-encryption-key\nstate=preserved\n' > "$data/grafana.db"
    printf 'hot-journal-sentinel\n' > "$data/grafana.db-journal"
    cp "$data/grafana.db" "$TEST_ROOT/original.db"
    cp "$data/grafana.db-journal" "$TEST_ROOT/original.db-journal"
    make_fake_cli "$cli"
    make_lease "$lease_root" "$token"

    local output
    if output="$(run_with_lease "$data" "$cli" "$lease_root" "$token" \
        SANCTUARY_TEST_GRAFANA_MIGRATION_FAIL_AFTER_RESET=true 2>&1)"; then
        echo "forced post-reset failure unexpectedly succeeded" >&2
        exit 1
    fi

    cmp "$TEST_ROOT/original.db" "$data/grafana.db"
    cmp "$TEST_ROOT/original.db-journal" "$data/grafana.db-journal"
    test ! -f "$data/.sanctuary-independent-password-v1"
    assert_secret_absent "$output" "independent-password"
    assert_secret_absent "$output" "legacy-encryption-key"
}

assert_existing_files_unchanged() {
    local data="$1"
    local originals="$2"
    for suffix in '' '-journal' '-wal' '-shm'; do
        cmp "$originals/grafana.db$suffix" "$data/grafana.db$suffix"
    done
    test ! -f "$data/.sanctuary-independent-password-v1"
}

prepare_existing_sidecars() {
    local data="$1"
    local originals="$2"
    mkdir "$data" "$originals"
    printf 'database-sentinel\n' > "$data/grafana.db"
    printf 'journal-sentinel\n' > "$data/grafana.db-journal"
    printf 'wal-sentinel\n' > "$data/grafana.db-wal"
    printf 'shm-sentinel\n' > "$data/grafana.db-shm"
    cp "$data"/grafana.db* "$originals/"
}

test_existing_volume_requires_current_lease() {
    local data="$TEST_ROOT/no-lease"
    local originals="$TEST_ROOT/no-lease-originals"
    prepare_existing_sidecars "$data" "$originals"

    if GRAFANA_DATA_DIR="$data" GRAFANA_PASSWORD="independent-password" \
        sh "$MIGRATION_SCRIPT" >/dev/null 2>&1; then
        echo "existing database migrated without quiescence proof" >&2
        exit 1
    fi
    assert_existing_files_unchanged "$data" "$originals"
}

test_stale_and_replayed_leases_refuse_before_mutation() {
    local data="$TEST_ROOT/stale"
    local originals="$TEST_ROOT/stale-originals"
    local lease_root="$TEST_ROOT/stale-lease"
    local token="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    prepare_existing_sidecars "$data" "$originals"
    make_lease "$lease_root" "$token" "$(( $(date +%s) - 1 ))"

    if run_with_lease "$data" "$TEST_ROOT/missing-cli" "$lease_root" "$token" >/dev/null 2>&1; then
        echo "stale lease unexpectedly succeeded" >&2
        exit 1
    fi
    assert_existing_files_unchanged "$data" "$originals"

    make_lease "$lease_root" "$token"
    mkdir "$lease_root/claims/$token"
    if run_with_lease "$data" "$TEST_ROOT/missing-cli" "$lease_root" "$token" >/dev/null 2>&1; then
        echo "replayed lease unexpectedly succeeded" >&2
        exit 1
    fi
    assert_existing_files_unchanged "$data" "$originals"
}

test_mismatched_lease_identity_refuses_before_mutation() {
    local data="$TEST_ROOT/mismatch"
    local originals="$TEST_ROOT/mismatch-originals"
    local lease_root="$TEST_ROOT/mismatch-lease"
    local token="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    prepare_existing_sidecars "$data" "$originals"
    make_lease "$lease_root" "$token"
    sed -i 's/^project=.*/project=other-project/' "$lease_root/lease-$token"

    if run_with_lease "$data" "$TEST_ROOT/missing-cli" "$lease_root" "$token" >/dev/null 2>&1; then
        echo "mismatched lease identity unexpectedly succeeded" >&2
        exit 1
    fi
    assert_existing_files_unchanged "$data" "$originals"
}

test_dead_lease_owner_refuses_before_mutation() {
    local data="$TEST_ROOT/dead-owner"
    local originals="$TEST_ROOT/dead-owner-originals"
    local lease_root="$TEST_ROOT/dead-owner-lease"
    local token="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    prepare_existing_sidecars "$data" "$originals"
    make_lease "$lease_root" "$token"
    sed -i 's/^owner_pid=.*/owner_pid=999999999/' "$lease_root/lease-$token"
    sed -i 's/^owner_start_time=.*/owner_start_time=1/' "$lease_root/lease-$token"

    if GRAFANA_DATA_DIR="$data" GRAFANA_CLI_BIN="$TEST_ROOT/missing-cli" \
        GRAFANA_PASSWORD="independent-password" \
        SANCTUARY_GRAFANA_QUIESCENCE_DIR="$lease_root" \
        SANCTUARY_GRAFANA_QUIESCENCE_TOKEN="$token" \
        SANCTUARY_GRAFANA_QUIESCENCE_PROJECT="test-project" \
        SANCTUARY_GRAFANA_QUIESCENCE_CONTAINER_ID="test-container" \
        SANCTUARY_GRAFANA_QUIESCENCE_GENERATION="test-generation" \
        SANCTUARY_GRAFANA_QUIESCENCE_OWNER_PID="999999999" \
        SANCTUARY_GRAFANA_QUIESCENCE_OWNER_START_TIME="1" \
        SANCTUARY_GRAFANA_QUIESCENCE_OWNER_PROC="$TEST_ROOT/missing-owner-proc" \
        SANCTUARY_GRAFANA_QUIESCENCE_OUTCOME_DIR="$lease_root" \
        sh "$MIGRATION_SCRIPT" >/dev/null 2>&1; then
        echo "dead lease owner unexpectedly authorized migration" >&2
        exit 1
    fi
    assert_existing_files_unchanged "$data" "$originals"
}

test_setup_generates_and_preserves_password() {
    local runtime="$TEST_ROOT/runtime"
    local env_file="$runtime/sanctuary.env"
    mkdir "$runtime"

    env -u GRAFANA_PASSWORD \
        SANCTUARY_RUNTIME_DIR="$runtime" SANCTUARY_ENV_FILE="$env_file" \
        HTTPS_PORT=59343 HTTP_PORT=59080 GATEWAY_PORT=59400 \
        bash "$PROJECT_ROOT/scripts/setup.sh" --force --non-interactive \
        --no-start --skip-ssl --skip-prereqs >/dev/null

    local generated
    generated="$(sed -n 's/^GRAFANA_PASSWORD=//p' "$env_file")"
    test -n "$generated"

    env -u GRAFANA_PASSWORD \
        SANCTUARY_RUNTIME_DIR="$runtime" SANCTUARY_ENV_FILE="$env_file" \
        HTTPS_PORT=59343 HTTP_PORT=59080 GATEWAY_PORT=59400 \
        bash "$PROJECT_ROOT/scripts/setup.sh" --force --upgrade --non-interactive \
        --no-start --skip-ssl --skip-prereqs >/dev/null

    test "$(sed -n 's/^GRAFANA_PASSWORD=//p' "$env_file")" = "$generated"
}

test_fresh_volume_initialization
test_existing_volume_migration
test_completed_migration_is_idempotent
test_failed_migration_rolls_back
test_existing_volume_requires_current_lease
test_stale_and_replayed_leases_refuse_before_mutation
test_mismatched_lease_identity_refuses_before_mutation
test_dead_lease_owner_refuses_before_mutation
test_setup_generates_and_preserves_password

echo "Grafana password migration tests passed"
