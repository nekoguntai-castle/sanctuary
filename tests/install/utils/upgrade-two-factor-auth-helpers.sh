#!/bin/bash
# 2FA seeding and login helpers for ref-to-ref upgrade tests.

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

format_backup_code_for_login() {
    local code="$1"
    local lower_code

    lower_code=$(printf '%s' "$code" | tr '[:upper:]' '[:lower:]')
    printf '%s-%s' "${lower_code:0:3}" "${lower_code:3}"
}
