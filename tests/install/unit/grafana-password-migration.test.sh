#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
MIGRATION_SCRIPT="$PROJECT_ROOT/scripts/ops/migrate-grafana-password.sh"
TEST_ROOT="$(mktemp -d)"

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
    mkdir "$data"
    printf 'admin:legacy-encryption-key\n' > "$data/grafana.db"
    make_fake_cli "$cli"

    local output
    output="$(GRAFANA_DATA_DIR="$data" GRAFANA_CLI_BIN="$cli" \
        GRAFANA_PASSWORD="independent-password" sh "$MIGRATION_SCRIPT" 2>&1)"

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
    mkdir "$data"
    printf 'admin:legacy-encryption-key\nstate=preserved\n' > "$data/grafana.db"
    printf 'hot-journal-sentinel\n' > "$data/grafana.db-journal"
    cp "$data/grafana.db" "$TEST_ROOT/original.db"
    cp "$data/grafana.db-journal" "$TEST_ROOT/original.db-journal"
    make_fake_cli "$cli"

    local output
    if output="$(GRAFANA_DATA_DIR="$data" GRAFANA_CLI_BIN="$cli" \
        GRAFANA_PASSWORD="independent-password" \
        SANCTUARY_TEST_GRAFANA_MIGRATION_FAIL_AFTER_RESET=true \
        sh "$MIGRATION_SCRIPT" 2>&1)"; then
        echo "forced post-reset failure unexpectedly succeeded" >&2
        exit 1
    fi

    cmp "$TEST_ROOT/original.db" "$data/grafana.db"
    cmp "$TEST_ROOT/original.db-journal" "$data/grafana.db-journal"
    test ! -f "$data/.sanctuary-independent-password-v1"
    assert_secret_absent "$output" "independent-password"
    assert_secret_absent "$output" "legacy-encryption-key"
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
test_setup_generates_and_preserves_password

echo "Grafana password migration tests passed"
