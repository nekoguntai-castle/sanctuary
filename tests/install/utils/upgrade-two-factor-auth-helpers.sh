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

# Tracks the RFC 6238 time step (30s window) used for the last code minted per
# *account* (falling back to the secret when no account is known). The
# product's single-use step guard (totp-code-replay-within-tolerance-window,
# server/src/.../verifyAndConsumeTotp) records a `totp-step:<userId>:<step>`
# marker on every successful call -- both /auth/2fa/verify and
# /auth/2fa/enable consume it, and it is keyed by the ACCOUNT, not the secret.
# A secret-keyed tracker therefore misses the re-enroll case: the admin logs
# in with the OLD secret, then re-enrolls a NEW secret and calls
# /auth/2fa/enable in the same step -- two different secrets, but the same
# account, so the product still rejects the second call. The key here must be
# the account whenever the caller knows it.
#
# generate_totp_code is always called through command substitution
# (`code=$(generate_totp_code ...)`), which bash runs in a subshell -- an
# in-process associative array written there would vanish when the subshell
# exits, silently disabling the guard for every real caller. A tab-separated
# state file survives the subshell because it is on disk, not in the
# subshell's copy of the parent's memory.
TOTP_STEP_STATE_FILE="${TOTP_STEP_STATE_FILE:-$(mktemp -t sanctuary-totp-step-state.XXXXXX)}"
# Only the two current sourcing sites are safe for this: neither sets its own
# top-level EXIT trap before sourcing this file, so nothing is clobbered here.
# A future sourcing site that installs its own EXIT trap after this one simply
# loses this cleanup (the file leaks, same as before this trap existed) rather
# than losing anything of its own.
trap 'rm -f "$TOTP_STEP_STATE_FILE"' EXIT

# The current RFC 6238 time step (floor(unix time / 30)), matching the
# product's step window. Tests inject a deterministic value via
# SANCTUARY_TOTP_STEP_OVERRIDE instead of waiting across a real 30s boundary.
totp_current_step() {
    if [ -n "${SANCTUARY_TOTP_STEP_OVERRIDE:-}" ]; then
        printf '%s\n' "$SANCTUARY_TOTP_STEP_OVERRIDE"
        return 0
    fi
    printf '%s\n' $(( $(date +%s) / 30 ))
}

# Resolves the tracking key for a mint: the account when one is known
# (prefixed to keep it from ever colliding with a bare-secret key), otherwise
# the secret itself. $1=secret $2=account (optional).
totp_step_tracking_key() {
    local secret="$1"
    local account="${2:-}"
    if [ -n "$account" ]; then
        printf 'account:%s\n' "$account"
    else
        printf 'secret:%s\n' "$secret"
    fi
}

# The TOTP step recorded for the last code minted for tracking key $1, or
# empty if none.
totp_last_used_step() {
    local key="$1"
    [ -f "$TOTP_STEP_STATE_FILE" ] || return 0
    awk -F'\t' -v k="$key" '$1 == k { step = $2 } END { if (step != "") print step }' \
        "$TOTP_STEP_STATE_FILE"
}

# Records that tracking key $1 minted a code at TOTP step $2, replacing any
# prior record.
record_totp_step_used() {
    local key="$1"
    local step="$2"
    local tmp
    tmp=$(mktemp)
    if [ -f "$TOTP_STEP_STATE_FILE" ]; then
        awk -F'\t' -v k="$key" '$1 != k' "$TOTP_STEP_STATE_FILE" > "$tmp"
    fi
    printf '%s\t%s\n' "$key" "$step" >> "$tmp"
    mv "$tmp" "$TOTP_STEP_STATE_FILE"
}

# Waits, bounded to one 30s step, until the current TOTP step differs from the
# step recorded for tracking key $1's last minted code (if any). Call before
# minting a new code for a key that may already have been used to log in this
# step.
#
# generate_totp_code's only contract with its callers is "stdout is exactly
# the minted code" -- every real caller reads it via `code=$(generate_totp_code
# ...)`. log_info/log_error (tests/install/utils/helpers.sh) write to stdout
# via plain `echo`, so anything they print on this call path would land inside
# $code and get POSTed as the verification code. Every log call reachable from
# generate_totp_code must therefore go to stderr explicitly.
wait_for_totp_step_boundary() {
    local key="$1"
    local last_step
    last_step=$(totp_last_used_step "$key")
    [ -z "$last_step" ] && return 0

    local current_step waited=0
    current_step=$(totp_current_step)
    while [ "$current_step" = "$last_step" ]; do
        if [ "$waited" -ge 30 ]; then
            log_error "Timed out waiting for the TOTP step to advance past $last_step" >&2
            return 1
        fi
        log_info "Waiting for the TOTP step to advance past $last_step before minting the next code..." >&2
        sleep 1
        waited=$((waited + 1))
        current_step=$(totp_current_step)
    done
    return 0
}

# $1=secret $2=account (optional). Pass the account (username) whenever the
# caller knows it -- see the TOTP_STEP_STATE_FILE comment above for why a
# secret-only key misses the re-enroll case, where the same account consumes
# codes from two different secrets inside one step.
generate_totp_code() {
    local secret="$1"
    local account="${2:-}"

    if [ -z "$secret" ]; then
        log_error "No pre-upgrade 2FA secret is available" >&2
        return 1
    fi

    local step_key
    step_key=$(totp_step_tracking_key "$secret" "$account")

    wait_for_totp_step_boundary "$step_key" || return 1

    local step
    step=$(totp_current_step)

    local code
    code=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "SANCTUARY_TOTP_SECRET=$secret" \
        backend node -e '
const { generateSync } = require("otplib");
const secret = process.env.SANCTUARY_TOTP_SECRET;
if (!secret) {
  process.stderr.write("SANCTUARY_TOTP_SECRET is required\n");
  process.exit(1);
}
process.stdout.write(generateSync({ secret }));
')

    if [ -z "$code" ]; then
        return 1
    fi

    record_totp_step_used "$step_key" "$step"
    printf '%s' "$code"
}

# $1=account (optional). Forwarded straight to generate_totp_code.
generate_upgrade_totp_code() {
    local account="${1:-}"
    generate_totp_code "$ORIGINAL_TWO_FACTOR_SECRET" "$account"
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
        code=$(generate_totp_code "$secret" "$username")
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
