#!/bin/bash

UPGRADE_FIXTURE_LABEL="seeded-app-state"
SEEDED_USER_ID=""
SEEDED_USERNAME=""
SEEDED_GROUP_ID=""
SEEDED_GROUP_NAME=""
SEEDED_NODE_HOST=""
SEEDED_NODE_PORT=""

upgrade_fixture_after_source_install() {
    local admin_password_hash=""
    local seeded_group_member_id=""
    local seeded_setting_id=""

    if ! seed_upgrade_baseline_admin_state; then
        return 1
    fi

    SEEDED_USERNAME="upgrade-user-${TEST_ID}"
    SEEDED_GROUP_NAME="upgrade-group-${TEST_ID}"
    SEEDED_NODE_HOST="electrum.upgrade-${TEST_ID}.internal"
    SEEDED_NODE_PORT="50002"
    SEEDED_USER_ID="$(node -e "console.log(require('node:crypto').randomUUID())")"
    SEEDED_GROUP_ID="$(node -e "console.log(require('node:crypto').randomUUID())")"
    seeded_group_member_id="$(node -e "console.log(require('node:crypto').randomUUID())")"
    seeded_setting_id="$(node -e "console.log(require('node:crypto').randomUUID())")"

    admin_password_hash="$(compose_exec postgres psql -U sanctuary -d sanctuary -At -c \
        "SELECT password FROM users WHERE username = 'admin' LIMIT 1;" 2>/dev/null | tr -d '\r')"
    if [ -z "$admin_password_hash" ]; then
        log_error "Failed to read the existing admin password hash for seeded app state"
        return 1
    fi

    if ! compose_exec postgres psql -U sanctuary -d sanctuary -c \
        "INSERT INTO users (id, username, password, email, \"isAdmin\", \"createdAt\", \"updatedAt\", \"emailVerified\", \"emailVerifiedAt\")
         VALUES ('$SEEDED_USER_ID', '$SEEDED_USERNAME', '$admin_password_hash', '$SEEDED_USERNAME@example.com', false, NOW(), NOW(), true, NOW());" >/dev/null 2>&1; then
        log_error "Failed to seed the upgrade user state"
        return 1
    fi

    if ! compose_exec postgres psql -U sanctuary -d sanctuary -c \
        "INSERT INTO groups (id, name, description, purpose, \"createdAt\", \"updatedAt\")
         VALUES ('$SEEDED_GROUP_ID', '$SEEDED_GROUP_NAME', 'Upgrade state fixture', 'upgrade-test', NOW(), NOW());" >/dev/null 2>&1; then
        log_error "Failed to seed the upgrade group state"
        return 1
    fi

    if ! compose_exec postgres psql -U sanctuary -d sanctuary -c \
        "INSERT INTO group_members (id, \"userId\", \"groupId\", role, \"createdAt\")
         VALUES ('$seeded_group_member_id', '$SEEDED_USER_ID', '$SEEDED_GROUP_ID', 'member', NOW());" >/dev/null 2>&1; then
        log_error "Failed to seed the upgrade group membership"
        return 1
    fi

    if ! compose_exec postgres psql -U sanctuary -d sanctuary -c \
        "INSERT INTO system_settings (id, key, value, \"createdAt\", \"updatedAt\")
         VALUES ('$seeded_setting_id', 'registrationEnabled', 'true', NOW(), NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, \"updatedAt\" = NOW();" >/dev/null 2>&1; then
        log_error "Failed to seed the upgrade system setting state"
        return 1
    fi

    if ! compose_exec postgres psql -U sanctuary -d sanctuary -c \
        "INSERT INTO node_configs (
            id, type, \"isDefault\", host, port, \"useSsl\", \"allowSelfSignedCert\",
            \"createdAt\", \"updatedAt\"
         ) VALUES (
            'default', 'electrum', true, '$SEEDED_NODE_HOST', $SEEDED_NODE_PORT, true, false,
            NOW(), NOW()
         )
         ON CONFLICT (id) DO UPDATE SET
            type = EXCLUDED.type,
            \"isDefault\" = EXCLUDED.\"isDefault\",
            host = EXCLUDED.host,
            port = EXCLUDED.port,
            \"useSsl\" = EXCLUDED.\"useSsl\",
            \"allowSelfSignedCert\" = EXCLUDED.\"allowSelfSignedCert\",
            \"updatedAt\" = NOW();" >/dev/null 2>&1; then
        log_error "Failed to seed the upgrade node configuration state"
        return 1
    fi

    return 0
}

upgrade_fixture_after_upgrade() {
    local users_response=""
    local groups_response=""
    local settings_response=""
    local node_config_response=""

    users_response="$(upgrade_authenticated_json_request GET "/api/v1/admin/users" "" "$COOKIE_JAR" "$API_BASE_URL")"
    if ! echo "$users_response" | grep -q "\"username\":\"$SEEDED_USERNAME\""; then
        log_error "Seeded user was not preserved after upgrade"
        return 1
    fi

    groups_response="$(upgrade_authenticated_json_request GET "/api/v1/admin/groups" "" "$COOKIE_JAR" "$API_BASE_URL")"
    if ! echo "$groups_response" | grep -q "\"name\":\"$SEEDED_GROUP_NAME\""; then
        log_error "Seeded group was not preserved after upgrade"
        return 1
    fi

    settings_response="$(upgrade_authenticated_json_request GET "/api/v1/admin/settings" "" "$COOKIE_JAR" "$API_BASE_URL")"
    if ! echo "$settings_response" | grep -q '"registrationEnabled":true'; then
        log_error "Seeded admin setting was not preserved after upgrade"
        return 1
    fi

    node_config_response="$(upgrade_authenticated_json_request GET "/api/v1/admin/node-config" "" "$COOKIE_JAR" "$API_BASE_URL")"
    if ! echo "$node_config_response" | grep -q "\"host\":\"$SEEDED_NODE_HOST\""; then
        log_error "Seeded node config was not preserved after upgrade"
        return 1
    fi

    return 0
}
