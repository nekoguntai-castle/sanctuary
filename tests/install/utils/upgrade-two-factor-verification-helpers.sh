#!/bin/bash
# 2FA verification helpers for ref-to-ref upgrade tests.

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
