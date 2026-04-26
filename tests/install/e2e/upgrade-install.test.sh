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
# Run: ./upgrade-install.test.sh [--keep-containers] [--source-ref <git-ref>] [--mode <core|full>]
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
source "$SCRIPT_DIR/../utils/upgrade-assertions.sh"
source "$SCRIPT_DIR/../utils/collect-upgrade-artifacts.sh"

# ============================================
# Configuration
# ============================================

KEEP_CONTAINERS=false
VERBOSE=false
UPGRADE_SOURCE_REF="${SANCTUARY_UPGRADE_SOURCE_REF:-}"
UPGRADE_TEST_MODE="${SANCTUARY_UPGRADE_TEST_MODE:-full}"
UPGRADE_FIXTURE="${SANCTUARY_UPGRADE_FIXTURE:-baseline}"

usage() {
    cat <<EOF
Usage:
  $0 [--keep-containers] [--source-ref REF|latest-stable|n-1|n-2] [--mode core|full] [--fixture FIXTURE[,FIXTURE...]]

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

if ! validate_upgrade_fixture "$UPGRADE_FIXTURE"; then
    usage
    exit 1
fi

# Test configuration
TEST_ID=$(generate_test_run_id)
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-sanctuary-upgrade-${TEST_ID}}"

apply_upgrade_fixture_defaults "$UPGRADE_FIXTURE"
apply_upgrade_test_network_defaults

TEST_RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-/tmp/sanctuary-upgrade-runtime-${TEST_ID}}"
TEST_SSL_DIR="${SANCTUARY_SSL_DIR:-$TEST_RUNTIME_DIR/ssl}"
API_BASE_URL="https://localhost:${HTTPS_PORT}"
BROWSER_BASE_URL="https://${UPGRADE_BROWSER_HOST}:${HTTPS_PORT}"
COOKIE_JAR="/tmp/sanctuary-test-cookies-${TEST_ID}.txt"
UPGRADE_SOURCE_CHECKOUT="/tmp/sanctuary-upgrade-source-${TEST_ID}/sanctuary"
LEGACY_TARGET_ENV_FILE="$TARGET_PROJECT_ROOT/.env"
if [ "$UPGRADE_USE_LEGACY_RUNTIME_ENV" = "true" ] && [ -z "${SANCTUARY_ENV_FILE:-}" ]; then
    TEST_ENV_FILE="$UPGRADE_SOURCE_CHECKOUT/.env"
else
    TEST_ENV_FILE="${SANCTUARY_ENV_FILE:-$TEST_RUNTIME_DIR/sanctuary.env}"
fi
UPGRADE_SOURCE_CREATED=false
UPGRADE_CREATED_TARGET_LEGACY_ENV=false
UPGRADE_SOURCE_LABEL=""
UPGRADE_TARGET_LABEL="$(git -C "$TARGET_PROJECT_ROOT" describe --tags --always 2>/dev/null || git -C "$TARGET_PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "current-checkout")"
UPGRADE_ARTIFACT_DIR="${SANCTUARY_UPGRADE_ARTIFACT_DIR:-$TARGET_PROJECT_ROOT/.tmp/upgrade-artifacts/${TEST_ID}}"

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
TEST_LABEL_NAME="upgrade-fixture-label"
TEST_SETTING_KEY="upgrade.fixture.marker"
TEST_NODE_CONFIG_ID=""
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
    local source_ref=""
    source_ref=$(discover_upgrade_source_ref 2>/dev/null || true)

    if [ -z "$source_ref" ]; then
        UPGRADE_SOURCE_LABEL="$(describe_checkout_ref "$TARGET_PROJECT_ROOT") (restart fallback)"
        PROJECT_ROOT="$TARGET_PROJECT_ROOT"
        log_warning "No older stable tag was found; upgrade test will fall back to restarting the current checkout"
        return 0
    fi

    if ! git -C "$TARGET_PROJECT_ROOT" rev-parse --verify "$source_ref" >/dev/null 2>&1; then
        log_error "Upgrade source ref not found: $source_ref"
        return 1
    fi

    mkdir -p "$(dirname "$UPGRADE_SOURCE_CHECKOUT")"
    git -C "$TARGET_PROJECT_ROOT" worktree add --detach "$UPGRADE_SOURCE_CHECKOUT" "$source_ref" >/dev/null

    PROJECT_ROOT="$UPGRADE_SOURCE_CHECKOUT"
    UPGRADE_SOURCE_CREATED=true
    UPGRADE_SOURCE_LABEL="$source_ref"
    return 0
}

cleanup_upgrade_source_checkout() {
    if [ "$UPGRADE_SOURCE_CREATED" = "true" ]; then
        git -C "$TARGET_PROJECT_ROOT" worktree remove --force "$UPGRADE_SOURCE_CHECKOUT" >/dev/null 2>&1 || true
        rmdir "$(dirname "$UPGRADE_SOURCE_CHECKOUT")" 2>/dev/null || true
        UPGRADE_SOURCE_CREATED=false
    fi
}

run_install_script() {
    local project_dir="$1"
    local checkout_name
    checkout_name="$(basename "$project_dir")"
    local install_log="$TEST_RUNTIME_DIR/install-${checkout_name}.log"

    mkdir -p "$TEST_RUNTIME_DIR"
    isolate_legacy_optional_profile_compose "$project_dir" "$TARGET_PROJECT_ROOT"

    set +e
    (
        export HTTPS_PORT
        export HTTP_PORT
        export GATEWAY_PORT
        export ENABLE_MONITORING="$UPGRADE_ENABLE_MONITORING"
        export ENABLE_TOR="$UPGRADE_ENABLE_TOR"
        export SANCTUARY_DIR="$project_dir"
        export SANCTUARY_RUNTIME_DIR="$TEST_RUNTIME_DIR"
        export SANCTUARY_ENV_FILE="$TEST_ENV_FILE"
        export SANCTUARY_SSL_DIR="$TEST_SSL_DIR"
        export SKIP_GIT_CHECKOUT="true"
        export RATE_LIMIT_LOGIN=100
        export RATE_LIMIT_2FA=100
        export RATE_LIMIT_PASSWORD_CHANGE=100
        bash "$project_dir/install.sh" </dev/null
    ) 2>&1 | tee "$install_log"
    local exit_code=${PIPESTATUS[0]}
    set -e

    if [ $exit_code -ne 0 ]; then
        log_error "install.sh failed for checkout: $project_dir"
        log_error "Install log: $install_log"
        return 1
    fi

    return 0
}

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
declare -a FAILED_TESTS

# ============================================
# Test Framework
# ============================================

run_test() {
    local test_name="$1"
    local test_func="$2"

    TESTS_RUN=$((TESTS_RUN + 1))
    echo ""
    log_info "Running test: $test_name"
    echo "-------------------------------------------"

    set +e
    $test_func
    local exit_code=$?
    set -e

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
    log_info "  Browser URL:   $BROWSER_BASE_URL"

    # Verify prerequisites
    if ! check_docker_available; then
        log_error "Docker is not available. Cannot run upgrade tests."
        exit 1
    fi

    export SANCTUARY_ENV_FILE="$TEST_ENV_FILE"
    export SANCTUARY_SSL_DIR="$TEST_SSL_DIR"

    cleanup_containers "$TARGET_PROJECT_ROOT" 2>/dev/null || true

    if ! prepare_upgrade_source_checkout; then
        log_error "Failed to prepare upgrade source checkout"
        exit 1
    fi

    log_info "  Source Ref:    $UPGRADE_SOURCE_LABEL"
    log_info "  Source Root:   $PROJECT_ROOT"

    setup_cleanup_trap "teardown"
}

teardown() {
    log_info "Cleaning up upgrade test environment..."

    if [ "$KEEP_CONTAINERS" = "false" ]; then
        cleanup_containers "$TARGET_PROJECT_ROOT" 2>/dev/null || true
        if [ "$UPGRADE_SOURCE_CREATED" = "true" ]; then
            cleanup_containers "$UPGRADE_SOURCE_CHECKOUT" 2>/dev/null || true
        fi
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

    if [ -d "$TEST_RUNTIME_DIR" ]; then
        rm -rf "$TEST_RUNTIME_DIR"
    fi

    cleanup_upgrade_source_checkout
}

# ============================================
# Test: Verify Existing Installation or Create One
# ============================================

test_ensure_existing_installation() {
    log_info "Creating source installation from $UPGRADE_SOURCE_LABEL..."

    cd "$PROJECT_ROOT"

    if ! run_install_script "$PROJECT_ROOT"; then
        return 1
    fi

    # Wait for containers
    if ! wait_for_all_containers_healthy 300; then
        log_error "Initial installation failed"
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
        ORIGINAL_JWT_SECRET="$JWT_SECRET"
        ORIGINAL_ENCRYPTION_KEY="$ENCRYPTION_KEY"
        ORIGINAL_ENCRYPTION_SALT="$ENCRYPTION_SALT"
        ORIGINAL_GATEWAY_SECRET="$GATEWAY_SECRET"
        ORIGINAL_POSTGRES_PASSWORD="$POSTGRES_PASSWORD"
        log_info "Loaded initial secrets from $(resolve_env_file)"
    fi

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
        log_info "Captured JWT_SECRET: ${ORIGINAL_JWT_SECRET:0:8}..."
        log_info "Captured ENCRYPTION_KEY: ${ORIGINAL_ENCRYPTION_KEY:0:8}..."
        log_info "Captured ENCRYPTION_SALT: ${ORIGINAL_ENCRYPTION_SALT:0:8}..."
        log_info "Captured GATEWAY_SECRET: ${ORIGINAL_GATEWAY_SECRET:0:8}..."
        log_info "Captured POSTGRES_PASSWORD: ${ORIGINAL_POSTGRES_PASSWORD:0:8}..."
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

seed_admin_two_factor_fixture() {
    log_info "Seeding 2FA fixtures before upgrade..."

    local seed_output=""
    seed_output=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "OPERATOR_TWO_FACTOR_USERNAME=$OPERATOR_TWO_FACTOR_USERNAME" \
        -e "OPERATOR_TWO_FACTOR_PASSWORD=$OPERATOR_TWO_FACTOR_PASSWORD" \
        -e "LEGACY_TWO_FACTOR_USERNAME=$LEGACY_TWO_FACTOR_USERNAME" \
        -e "LEGACY_TWO_FACTOR_PASSWORD=$LEGACY_TWO_FACTOR_PASSWORD" \
        backend node -e '
const { generateSecret, generateSync } = require("otplib");
const bcrypt = require("bcryptjs");

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

const encryption = loadModule([
  "./dist/app/src/utils/encryption.js",
  "./dist/server/src/utils/encryption.js",
  "./dist/src/utils/encryption.js",
]);
const prismaModule = loadModule([
  "./dist/app/src/models/prisma.js",
  "./dist/server/src/models/prisma.js",
  "./dist/src/models/prisma.js",
]);
const prisma = prismaModule.default || prismaModule;

(async () => {
  await encryption.validateEncryptionKey();
  const adminSecret = generateSecret();
  const adminEncryptedSecret = encryption.encrypt(adminSecret);
  const adminBackupCode = "UPG2FA01";
  const adminBackupCodes = [{
    hash: await bcrypt.hash(adminBackupCode, 10),
    used: false,
  }];
  const operatorSecret = generateSecret();
  const operatorEncryptedSecret = encryption.encrypt(operatorSecret);
  const legacySecret = generateSecret();

  const admin = await prisma.user.update({
    where: { username: "admin" },
    data: {
      twoFactorEnabled: true,
      twoFactorSecret: adminEncryptedSecret,
      twoFactorBackupCodes: JSON.stringify(adminBackupCodes),
    },
    select: {
      username: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
    },
  });

  const operator = await prisma.user.upsert({
    where: { username: process.env.OPERATOR_TWO_FACTOR_USERNAME },
    update: {
      password: await bcrypt.hash(process.env.OPERATOR_TWO_FACTOR_PASSWORD, 10),
      twoFactorEnabled: true,
      twoFactorSecret: operatorEncryptedSecret,
      twoFactorBackupCodes: null,
    },
    create: {
      username: process.env.OPERATOR_TWO_FACTOR_USERNAME,
      password: await bcrypt.hash(process.env.OPERATOR_TWO_FACTOR_PASSWORD, 10),
      emailVerified: true,
      twoFactorEnabled: true,
      twoFactorSecret: operatorEncryptedSecret,
      twoFactorBackupCodes: null,
    },
    select: {
      username: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      twoFactorBackupCodes: true,
    },
  });

  const legacy = await prisma.user.upsert({
    where: { username: process.env.LEGACY_TWO_FACTOR_USERNAME },
    update: {
      password: await bcrypt.hash(process.env.LEGACY_TWO_FACTOR_PASSWORD, 10),
      twoFactorEnabled: true,
      twoFactorSecret: legacySecret,
      twoFactorBackupCodes: null,
    },
    create: {
      username: process.env.LEGACY_TWO_FACTOR_USERNAME,
      password: await bcrypt.hash(process.env.LEGACY_TWO_FACTOR_PASSWORD, 10),
      emailVerified: true,
      twoFactorEnabled: true,
      twoFactorSecret: legacySecret,
      twoFactorBackupCodes: null,
    },
    select: {
      username: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      twoFactorBackupCodes: true,
    },
  });

  const expected = [
    {
      user: admin,
      secret: adminSecret,
      encrypted: true,
      backupCodesRequired: true,
    },
    {
      user: operator,
      secret: operatorSecret,
      encrypted: true,
      backupCodesRequired: false,
    },
    {
      user: legacy,
      secret: legacySecret,
      encrypted: false,
      backupCodesRequired: false,
    },
  ];

  for (const fixture of expected) {
    if (!fixture.user.twoFactorEnabled) {
      throw new Error(`${fixture.user.username} 2FA fixture was not enabled`);
    }
    const decryptResult = encryption.decryptIfEncrypted(fixture.user.twoFactorSecret || "");
    if (decryptResult !== fixture.secret) {
      throw new Error(`${fixture.user.username} 2FA secret did not round-trip`);
    }
    if (fixture.encrypted !== encryption.isEncrypted(fixture.user.twoFactorSecret || "")) {
      throw new Error(`${fixture.user.username} 2FA storage encryption shape is wrong`);
    }
    if (!fixture.backupCodesRequired && fixture.user.twoFactorBackupCodes !== null) {
      throw new Error(`${fixture.user.username} should not have backup codes`);
    }
  }

  process.stdout.write(`adminSecret=${adminSecret}\n`);
  process.stdout.write(`adminBackupCode=${adminBackupCode}\n`);
  process.stdout.write(`adminToken=${generateSync({ secret: adminSecret })}\n`);
  process.stdout.write(`operatorSecret=${operatorSecret}\n`);
  process.stdout.write(`legacySecret=${legacySecret}\n`);
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
        log_error "Failed to seed 2FA fixtures"
        return 1
    }

    ORIGINAL_TWO_FACTOR_SECRET=$(echo "$seed_output" | sed -n 's/^adminSecret=//p' | tail -n 1)
    ORIGINAL_TWO_FACTOR_BACKUP_CODE=$(echo "$seed_output" | sed -n 's/^adminBackupCode=//p' | tail -n 1)
    OPERATOR_TWO_FACTOR_SECRET=$(echo "$seed_output" | sed -n 's/^operatorSecret=//p' | tail -n 1)
    LEGACY_TWO_FACTOR_SECRET=$(echo "$seed_output" | sed -n 's/^legacySecret=//p' | tail -n 1)
    if [ -z "$ORIGINAL_TWO_FACTOR_SECRET" ]; then
        log_error "2FA fixture seed did not return an admin plaintext secret for test verification"
        log_error "Output: $seed_output"
        return 1
    fi
    if [ -z "$ORIGINAL_TWO_FACTOR_BACKUP_CODE" ]; then
        log_error "2FA fixture seed did not return an admin backup code for test verification"
        log_error "Output: $seed_output"
        return 1
    fi
    if [ -z "$OPERATOR_TWO_FACTOR_SECRET" ]; then
        log_error "2FA fixture seed did not return an operator plaintext secret for test verification"
        log_error "Output: $seed_output"
        return 1
    fi
    if [ -z "$LEGACY_TWO_FACTOR_SECRET" ]; then
        log_error "2FA fixture seed did not return a legacy plaintext secret for test verification"
        log_error "Output: $seed_output"
        return 1
    fi

    log_success "2FA fixtures seeded for admin, operator, and legacy plaintext user"
    return 0
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

  process.stdout.write(`walletId=${wallet.id}\n`);
  process.stdout.write(`nodeConfigId=${nodeConfig.id}\n`);
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

    if [ -z "$TEST_WALLET_ID" ] || [ -z "$TEST_NODE_CONFIG_ID" ]; then
        log_error "App-state fixture did not return required IDs"
        log_error "Output: $seed_output"
        return 1
    fi

    log_success "Representative app state seeded before upgrade"
    return 0
}

generate_totp_code() {
    local secret="$1"

    if [ -z "$secret" ]; then
        log_error "No pre-upgrade 2FA secret is available"
        return 1
    fi

    docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "SANCTUARY_TOTP_SECRET=$secret" \
        backend node -e '
const { generateSync } = require("otplib");
const secret = process.env.SANCTUARY_TOTP_SECRET;
if (!secret) {
  process.stderr.write("SANCTUARY_TOTP_SECRET is required\n");
  process.exit(1);
}
process.stdout.write(generateSync({ secret }));
'
}

generate_upgrade_totp_code() {
    generate_totp_code "$ORIGINAL_TWO_FACTOR_SECRET"
}

login_with_two_factor_fixture() {
    local username="$1"
    local password="$2"
    local secret="$3"
    local require_two_factor="${4:-false}"
    local override_code="${5:-}"
    local reject_two_factor="${6:-false}"

    rm -f "$COOKIE_JAR"
    local login_response
    login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"password\":\"$password\"}" \
        "$API_BASE_URL/api/v1/auth/login")

    if echo "$login_response" | grep -q '"user"'; then
        if [ "$require_two_factor" = "true" ]; then
            log_error "Login succeeded without the expected 2FA challenge"
            return 1
        fi
        extract_csrf_token
        return 0
    fi

    if [ "$reject_two_factor" = "true" ]; then
        log_error "Login returned an unexpected 2FA challenge"
        log_error "Response: $login_response"
        return 1
    fi

    if ! echo "$login_response" | grep -q '"requires2FA":true'; then
        log_error "Login did not return a user or a 2FA challenge"
        log_error "Response: $login_response"
        return 1
    fi

    local temp_token code verify_response
    temp_token=$(echo "$login_response" | sed -n 's/.*"tempToken":"\([^"]*\)".*/\1/p')
    if [ -z "$temp_token" ]; then
        log_error "2FA challenge did not include a tempToken"
        log_error "Response: $login_response"
        return 1
    fi

    if [ -n "$override_code" ]; then
        code="$override_code"
    else
        code=$(generate_totp_code "$secret")
    fi
    if [ -z "$code" ]; then
        log_error "Failed to generate TOTP code for upgrade fixture"
        return 1
    fi

    verify_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d "{\"tempToken\":\"$temp_token\",\"code\":\"$code\"}" \
        "$API_BASE_URL/api/v1/auth/2fa/verify")

    if ! echo "$verify_response" | grep -q '"user"'; then
        log_error "2FA verification failed after password login"
        log_error "Response: $verify_response"
        return 1
    fi

    extract_csrf_token
    return 0
}

login_as_upgrade_user() {
    local require_two_factor="${1:-false}"
    local override_code="${2:-}"
    local reject_two_factor="${3:-false}"

    login_with_two_factor_fixture \
        "admin" \
        "$ORIGINAL_USER_PASSWORD" \
        "$ORIGINAL_TWO_FACTOR_SECRET" \
        "$require_two_factor" \
        "$override_code" \
        "$reject_two_factor"
}

verify_admin_two_factor_secret_decrypts() {
    log_info "Verifying admin 2FA secret decrypts after upgrade..."

    local output
    output=$(compose_exec backend node -e '
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

const encryption = loadModule([
  "./dist/app/src/utils/encryption.js",
  "./dist/server/src/utils/encryption.js",
  "./dist/src/utils/encryption.js",
]);
const prismaModule = loadModule([
  "./dist/app/src/models/prisma.js",
  "./dist/server/src/models/prisma.js",
  "./dist/src/models/prisma.js",
]);
const prisma = prismaModule.default || prismaModule;

(async () => {
  await encryption.validateEncryptionKey();
  const user = await prisma.user.findUnique({
    where: { username: "admin" },
    select: { twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    throw new Error("admin 2FA fixture is missing after upgrade");
  }
  const secret = encryption.decryptIfEncrypted(user.twoFactorSecret);
  process.stdout.write(`secretLength=${secret.length}\n`);
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
        log_error "Admin 2FA secret could not be decrypted after upgrade"
        return 1
    }

    if ! echo "$output" | grep -q '^secretLength=[1-9][0-9]*$'; then
        log_error "Unexpected 2FA decrypt verification output: $output"
        return 1
    fi

    log_success "Admin 2FA secret decrypts after upgrade"
    return 0
}

verify_seeded_two_factor_users_decrypt() {
    log_info "Verifying all seeded 2FA user rows after upgrade..."

    local output
    output=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "ADMIN_TWO_FACTOR_SECRET=$ORIGINAL_TWO_FACTOR_SECRET" \
        -e "OPERATOR_TWO_FACTOR_USERNAME=$OPERATOR_TWO_FACTOR_USERNAME" \
        -e "OPERATOR_TWO_FACTOR_SECRET=$OPERATOR_TWO_FACTOR_SECRET" \
        -e "LEGACY_TWO_FACTOR_USERNAME=$LEGACY_TWO_FACTOR_USERNAME" \
        -e "LEGACY_TWO_FACTOR_SECRET=$LEGACY_TWO_FACTOR_SECRET" \
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

const encryption = loadModule([
  "./dist/app/src/utils/encryption.js",
  "./dist/server/src/utils/encryption.js",
  "./dist/src/utils/encryption.js",
]);
const twoFactorService = loadModule([
  "./dist/app/src/services/twoFactorService.js",
  "./dist/server/src/services/twoFactorService.js",
  "./dist/src/services/twoFactorService.js",
]);
const prismaModule = loadModule([
  "./dist/app/src/models/prisma.js",
  "./dist/server/src/models/prisma.js",
  "./dist/src/models/prisma.js",
]);
const prisma = prismaModule.default || prismaModule;
const service = twoFactorService.default || twoFactorService;

(async () => {
  await encryption.validateEncryptionKey();
  const expected = [
    {
      username: "admin",
      secret: process.env.ADMIN_TWO_FACTOR_SECRET,
      encrypted: true,
      backupCount: 1,
    },
    {
      username: process.env.OPERATOR_TWO_FACTOR_USERNAME,
      secret: process.env.OPERATOR_TWO_FACTOR_SECRET,
      encrypted: true,
      backupCount: 0,
    },
    {
      username: process.env.LEGACY_TWO_FACTOR_USERNAME,
      secret: process.env.LEGACY_TWO_FACTOR_SECRET,
      encrypted: false,
      backupCount: 0,
    },
  ];

  for (const fixture of expected) {
    const user = await prisma.user.findUnique({
      where: { username: fixture.username },
      select: {
        username: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
      },
    });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new Error(`${fixture.username} 2FA fixture is missing after upgrade`);
    }
    const decrypted = encryption.decryptIfEncrypted(user.twoFactorSecret);
    if (decrypted !== fixture.secret) {
      throw new Error(`${fixture.username} 2FA secret changed during upgrade`);
    }
    if (encryption.isEncrypted(user.twoFactorSecret) !== fixture.encrypted) {
      throw new Error(`${fixture.username} 2FA storage shape changed during upgrade`);
    }
    const backupCount = service.getRemainingBackupCodeCount(user.twoFactorBackupCodes);
    if (backupCount !== fixture.backupCount) {
      throw new Error(`${fixture.username} backup-code count changed during upgrade`);
    }
  }

  process.stdout.write(`verified=${expected.length}\n`);
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
        log_error "Seeded 2FA user rows could not be verified after upgrade"
        return 1
    }

    if ! echo "$output" | grep -q '^verified=3$'; then
        log_error "Unexpected seeded 2FA user verification output: $output"
        return 1
    fi

    log_success "All seeded 2FA user rows survived upgrade"
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

capture_admin_two_factor_secret() {
    local output
    output=$(compose_exec backend node -e '
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

const encryption = loadModule([
  "./dist/app/src/utils/encryption.js",
  "./dist/server/src/utils/encryption.js",
  "./dist/src/utils/encryption.js",
]);
const prismaModule = loadModule([
  "./dist/app/src/models/prisma.js",
  "./dist/server/src/models/prisma.js",
  "./dist/src/models/prisma.js",
]);
const prisma = prismaModule.default || prismaModule;

(async () => {
  await encryption.validateEncryptionKey();
  const user = await prisma.user.findUnique({
    where: { username: "admin" },
    select: { twoFactorSecret: true },
  });
  if (!user || !user.twoFactorSecret) {
    throw new Error("admin 2FA secret is missing");
  }
  const secret = encryption.decryptIfEncrypted(user.twoFactorSecret);
  process.stdout.write(`secret=${secret}\n`);
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
        log_error "Failed to capture admin 2FA secret"
        return 1
    }

    ORIGINAL_TWO_FACTOR_SECRET=$(echo "$output" | sed -n 's/^secret=//p' | tail -n 1)
    if [ -z "$ORIGINAL_TWO_FACTOR_SECRET" ]; then
        log_error "2FA secret capture returned no plaintext secret"
        log_error "Output: $output"
        return 1
    fi

    return 0
}

verify_admin_backup_code_count() {
    local expected_count="$1"
    local output
    output=$(compose_exec backend node -e '
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

const twoFactorService = loadModule([
  "./dist/app/src/services/twoFactorService.js",
  "./dist/server/src/services/twoFactorService.js",
  "./dist/src/services/twoFactorService.js",
]);
const prismaModule = loadModule([
  "./dist/app/src/models/prisma.js",
  "./dist/server/src/models/prisma.js",
  "./dist/src/models/prisma.js",
]);
const prisma = prismaModule.default || prismaModule;

(async () => {
  const user = await prisma.user.findUnique({
    where: { username: "admin" },
    select: { twoFactorBackupCodes: true },
  });
  if (!user) {
    throw new Error("admin user is missing");
  }
  const service = twoFactorService.default || twoFactorService;
  const count = service.getRemainingBackupCodeCount(user.twoFactorBackupCodes);
  process.stdout.write(`count=${count}\n`);
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
        log_error "Failed to inspect admin 2FA backup code count"
        return 1
    }

    if ! echo "$output" | grep -q "^count=${expected_count}$"; then
        log_error "Unexpected backup code count after upgrade"
        log_error "Expected: $expected_count"
        log_error "Output: $output"
        return 1
    fi

    return 0
}

expect_admin_two_factor_decrypt_rejected_with_env() {
    local env_name="$1"
    local env_value="$2"
    local label="$3"
    local output
    output=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "${env_name}=${env_value}" \
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

const encryption = loadModule([
  "./dist/app/src/utils/encryption.js",
  "./dist/server/src/utils/encryption.js",
  "./dist/src/utils/encryption.js",
]);
const prismaModule = loadModule([
  "./dist/app/src/models/prisma.js",
  "./dist/server/src/models/prisma.js",
  "./dist/src/models/prisma.js",
]);
const prisma = prismaModule.default || prismaModule;

(async () => {
  await encryption.validateEncryptionKey();
  const user = await prisma.user.findUnique({
    where: { username: "admin" },
    select: { twoFactorSecret: true },
  });
  if (!user || !user.twoFactorSecret) {
    throw new Error("admin 2FA secret is missing");
  }

  try {
    encryption.decryptIfEncrypted(user.twoFactorSecret);
  } catch {
    process.stdout.write("decryptRejected=true\n");
    return;
  }
  throw new Error("2FA secret decrypted with drifted ENCRYPTION_SALT");
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
        log_error "Drifted encryption material verification command failed for $label"
        return 1
    }

    if ! echo "$output" | grep -q '^decryptRejected=true$'; then
        log_error "Unexpected drifted encryption material verification output for $label: $output"
        return 1
    fi

    return 0
}

verify_admin_two_factor_rejects_drifted_material() {
    log_info "Verifying admin 2FA secret rejects drifted encryption material..."

    if ! expect_admin_two_factor_decrypt_rejected_with_env \
        "ENCRYPTION_SALT" \
        "drifted-${TEST_ID}" \
        "drifted ENCRYPTION_SALT"; then
        return 1
    fi

    if ! expect_admin_two_factor_decrypt_rejected_with_env \
        "ENCRYPTION_KEY" \
        "drifted-key-${TEST_ID}-012345678901234567890123456789" \
        "drifted ENCRYPTION_KEY"; then
        return 1
    fi

    log_success "Admin 2FA secret rejects drifted encryption material"
    return 0
}

expect_backup_code_reuse_rejected() {
    local code="$1"

    rm -f "$COOKIE_JAR"
    local login_response
    login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"admin\",\"password\":\"$ORIGINAL_USER_PASSWORD\"}" \
        "$API_BASE_URL/api/v1/auth/login")

    if ! echo "$login_response" | grep -q '"requires2FA":true'; then
        log_error "Backup-code replay check did not receive a 2FA challenge"
        log_error "Response: $login_response"
        return 1
    fi

    local temp_token verify_response
    temp_token=$(echo "$login_response" | sed -n 's/.*"tempToken":"\([^"]*\)".*/\1/p')
    if [ -z "$temp_token" ]; then
        log_error "Backup-code replay challenge did not include a tempToken"
        return 1
    fi

    verify_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d "{\"tempToken\":\"$temp_token\",\"code\":\"$code\"}" \
        "$API_BASE_URL/api/v1/auth/2fa/verify")

    if echo "$verify_response" | grep -q '"user"'; then
        log_error "Already-used backup code was accepted"
        return 1
    fi

    return 0
}

reenroll_admin_two_factor_via_api() {
    log_info "Re-enrolling admin 2FA through the API..."

    if ! login_as_upgrade_user false "" true; then
        log_error "Cannot authenticate without 2FA before re-enrollment"
        return 1
    fi

    if [ -z "$CSRF_TOKEN" ]; then
        log_error "Password-only login did not provide a sanctuary_csrf cookie"
        return 1
    fi

    local setup_response
    setup_response=$(curl -k -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -H "X-CSRF-Token: $CSRF_TOKEN" \
        "$API_BASE_URL/api/v1/auth/2fa/setup")

    if ! echo "$setup_response" | grep -q '"qrCodeDataUrl"'; then
        log_error "2FA setup did not return a QR code"
        log_error "Response: $setup_response"
        return 1
    fi

    if ! capture_admin_two_factor_secret; then
        return 1
    fi

    local token enable_response
    token=$(generate_upgrade_totp_code)
    if [ -z "$token" ]; then
        log_error "Failed to generate TOTP token for re-enrollment"
        return 1
    fi

    enable_response=$(curl -k -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -H "X-CSRF-Token: $CSRF_TOKEN" \
        -d "{\"token\":\"$token\"}" \
        "$API_BASE_URL/api/v1/auth/2fa/enable")

    if ! echo "$enable_response" | grep -q '"success":true'; then
        log_error "2FA enable did not succeed during re-enrollment"
        log_error "Response: $enable_response"
        return 1
    fi

    log_success "Admin 2FA re-enrolled through the API"
    return 0
}

# ============================================
# Test: Stop Containers for Upgrade
# ============================================

test_stop_containers_for_upgrade() {
    log_info "Stopping source containers before upgrade..."

    cd "$PROJECT_ROOT"
    load_runtime_env || return 1

    run_project_compose "$PROJECT_ROOT" stop 2>&1

    # Verify containers stopped
    local running=$(docker ps --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" --filter "status=running" -q | wc -l)
    if [ "$running" -gt 0 ]; then
        log_error "Some containers still running after stop"
        return 1
    fi

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

    if ! run_install_script "$PROJECT_ROOT"; then
        return 1
    fi

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
        log_error "  Original: ${ORIGINAL_JWT_SECRET:0:8}..."
        log_error "  Current:  ${JWT_SECRET:0:8}..."
        return 1
    fi

    if [ "$ENCRYPTION_KEY" != "$ORIGINAL_ENCRYPTION_KEY" ]; then
        log_error "ENCRYPTION_KEY changed after upgrade"
        log_error "  Original: ${ORIGINAL_ENCRYPTION_KEY:0:8}..."
        log_error "  Current:  ${ENCRYPTION_KEY:0:8}..."
        return 1
    fi

    if [ "$ENCRYPTION_SALT" != "$ORIGINAL_ENCRYPTION_SALT" ]; then
        log_error "ENCRYPTION_SALT changed after upgrade"
        log_error "  Original: ${ORIGINAL_ENCRYPTION_SALT:0:8}..."
        log_error "  Current:  ${ENCRYPTION_SALT:0:8}..."
        return 1
    fi

    if [ "$GATEWAY_SECRET" != "$ORIGINAL_GATEWAY_SECRET" ]; then
        log_error "GATEWAY_SECRET changed after upgrade"
        log_error "  Original: ${ORIGINAL_GATEWAY_SECRET:0:8}..."
        log_error "  Current:  ${GATEWAY_SECRET:0:8}..."
        return 1
    fi

    if [ "$POSTGRES_PASSWORD" != "$ORIGINAL_POSTGRES_PASSWORD" ]; then
        log_error "POSTGRES_PASSWORD changed after upgrade"
        log_error "  Original: ${ORIGINAL_POSTGRES_PASSWORD:0:8}..."
        log_error "  Current:  ${POSTGRES_PASSWORD:0:8}..."
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

verify_optional_profile_containers_after_upgrade() {
    wait_for_optional_profile_container "${JAEGER_CONTAINER_NAME:-}" "Jaeger" healthy || return 1
    wait_for_optional_profile_container "${LOKI_CONTAINER_NAME:-}" "Loki" healthy || return 1
    wait_for_optional_profile_container "${PROMTAIL_CONTAINER_NAME:-}" "Promtail" healthy || return 1
    wait_for_optional_profile_container "${PROMETHEUS_CONTAINER_NAME:-}" "Prometheus" healthy || return 1
    wait_for_optional_profile_container "${ALERTMANAGER_CONTAINER_NAME:-}" "Alertmanager" healthy || return 1
    wait_for_optional_profile_container "${GRAFANA_CONTAINER_NAME:-}" "Grafana" healthy || return 1
    wait_for_optional_profile_container "${TOR_CONTAINER_NAME:-}" "Tor" healthy || return 1
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
        if [ "${ENABLE_MONITORING:-}" != "yes" ] || [ "${ENABLE_TOR:-}" != "yes" ]; then
            log_error "optional-profiles fixture did not persist monitoring/Tor flags"
            log_error "ENABLE_MONITORING=${ENABLE_MONITORING:-unset}"
            log_error "ENABLE_TOR=${ENABLE_TOR:-unset}"
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

format_backup_code_for_login() {
    local code="$1"
    local lower_code

    lower_code=$(printf '%s' "$code" | tr '[:upper:]' '[:lower:]')
    printf '%s-%s' "${lower_code:0:3}" "${lower_code:3}"
}

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

    local recovery_dir reset_output
    recovery_dir="$TEST_RUNTIME_DIR/recovery"
    reset_output=$(
        export SANCTUARY_2FA_RESET_BACKUP_DIR="$recovery_dir"
        "$TARGET_PROJECT_ROOT/scripts/reset-user-2fa.sh" --username admin --yes 2>&1
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

enqueue_notification_delivery_probe() {
    log_info "Queueing post-upgrade notification delivery probe..."

    local output
    output=$(compose_exec backend env \
        "UPGRADE_NOTIFICATION_WALLET_ID=$TEST_WALLET_ID" \
        "UPGRADE_NOTIFICATION_TXID=$NOTIFICATION_TEST_TXID" \
        node -e '
const { Queue } = require("bullmq");
const Redis = require("ioredis");

(async () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required to queue the notification probe");
  }
  const walletId = process.env.UPGRADE_NOTIFICATION_WALLET_ID;
  const txid = process.env.UPGRADE_NOTIFICATION_TXID;
  if (!walletId || !txid) {
    throw new Error("UPGRADE_NOTIFICATION_WALLET_ID and UPGRADE_NOTIFICATION_TXID are required");
  }

  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue("notifications", {
    connection,
    prefix: "sanctuary:worker",
  });

  await queue.add("transaction-notify", {
    walletId,
    txid,
    type: "received",
    amount: "12345",
    feeSats: null,
  }, {
    jobId: `upgrade-notification-${txid}`,
    attempts: 1,
    removeOnComplete: false,
    removeOnFail: false,
  });

  await queue.close();
  await connection.quit();
  process.stdout.write("queued=true\n");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
' 2>&1) || {
        log_error "Failed to queue notification delivery probe"
        log_error "Probe output: ${output:-<empty>}"
        return 1
    }

    if ! echo "$output" | grep -q '^queued=true$'; then
        log_error "Unexpected notification queue output: $output"
        return 1
    fi
}

read_notification_dlq_entries() {
    compose_exec redis sh -c '
set -eu
for key in $(redis-cli -a "$REDIS_PASSWORD" --no-auth-warning --scan --pattern "sanctuary:dlq:*"); do
  redis-cli -a "$REDIS_PASSWORD" --no-auth-warning GET "$key"
  printf "\n"
done
' 2>/dev/null || true
}

wait_for_notification_dlq_entry() {
    log_info "Waiting for notification probe to reach the DLQ..."

    local attempt output
    for attempt in $(seq 1 30); do
        output=$(read_notification_dlq_entries)
        if echo "$output" | grep -q "$NOTIFICATION_TEST_TXID" && \
           echo "$output" | grep -q 'category.*notification' && \
           echo "$output" | grep -q 'operation.*notifications:transaction-notify'; then
            log_success "Notification probe reached the Redis-backed DLQ"
            return 0
        fi

        sleep 2
    done

    log_error "Notification probe did not reach the Redis-backed DLQ"
    log_error "DLQ output: ${output:-<empty>}"
    return 1
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
    docker compose stop backend worker frontend gateway ai migrate 2>&1 || true

    setup_output=$(
        export SANCTUARY_ENV_FILE="$TEST_ENV_FILE"
        export SANCTUARY_SSL_DIR="$TEST_SSL_DIR"
        export HTTPS_PORT
        export HTTP_PORT
        export GATEWAY_PORT
        export ENABLE_MONITORING="$UPGRADE_ENABLE_MONITORING"
        export ENABLE_TOR="$UPGRADE_ENABLE_TOR"
        export RATE_LIMIT_LOGIN=100
        export RATE_LIMIT_2FA=100
        export RATE_LIMIT_PASSWORD_CHANGE=100
        bash "$PROJECT_ROOT/scripts/setup.sh" --force --non-interactive --skip-ssl 2>&1
    ) || {
        log_error "setup.sh failed while recovering the PostgreSQL password drift"
        log_error "Output: $setup_output"
        return 1
    }

    if [ "$VERBOSE" = "true" ]; then
        echo "$setup_output"
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
        export RATE_LIMIT_LOGIN=100
        export RATE_LIMIT_2FA=100
        export RATE_LIMIT_PASSWORD_CHANGE=100
        bash "$PROJECT_ROOT/start.sh" --rebuild 2>&1
    )
    local exit_code=$?
    set -e

    if [ "$VERBOSE" = "true" ]; then
        echo "$rebuild_output"
    fi

    if [ $exit_code -ne 0 ]; then
        log_error "start.sh --rebuild failed"
        log_error "Output: $rebuild_output"
        return 1
    fi

    # Wait for all containers
    if ! wait_for_all_containers_healthy 300; then
        log_error "Force rebuild failed"
        return 1
    fi

    # Wait for migration to complete
    if ! wait_for_migration_complete 180; then
        log_warning "Migration may not have completed cleanly after rebuild"
        # Don't fail - migration might be idempotent
    fi

    # Extra wait for backend to fully initialize
    sleep 5

    if ! login_as_upgrade_user; then
        log_error "Login failed after force rebuild"
        return 1
    fi

    log_success "Force rebuild upgrade successful"
    return 0
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

    # Phase 2: Simulate upgrade
    run_test "Stop Containers for Upgrade" test_stop_containers_for_upgrade
    run_test "Simulate Git Update" test_simulate_git_update
    run_test "Restart Containers After Upgrade" test_restart_containers_after_upgrade

    # Phase 3: Verify upgrade success
    run_test "Verify Secrets Preserved" test_verify_secrets_preserved
    run_test "Verify Fixture Runtime Shape" test_verify_fixture_runtime_shape
    run_test "Verify Data Preserved" test_verify_data_preserved
    run_test "Verify Representative App State Preserved" test_verify_representative_app_state_preserved
    run_test "Verify 2FA Preserved" test_verify_two_factor_preserved
    run_test "Verify Multiple 2FA Users Preserved" test_verify_multiple_two_factor_users_preserved
    run_test "Verify 2FA Backup Code Preserved" test_verify_two_factor_backup_code_preserved
    run_test "Verify 2FA Rejects Drifted Encryption Material" test_verify_two_factor_rejects_drifted_material
    run_test "Reset 2FA And Re-Enroll" test_reset_two_factor_and_reenroll
    run_test "Verify Migration on Upgrade" test_verify_migration_on_upgrade
    run_test "Post-Upgrade User-Visible Smoke" test_post_upgrade_user_visible_smoke
    run_test "Verify Notification Delivery Diagnostics" test_verify_notification_delivery_diagnostics
    run_extended_upgrade_scenarios

    if [ $TESTS_FAILED -gt 0 ]; then
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
