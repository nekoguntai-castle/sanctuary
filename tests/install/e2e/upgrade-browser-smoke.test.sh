#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
source "$SCRIPT_DIR/../utils/helpers.sh"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../utils/upgrade-assertions.sh"

BASE_URL="${UPGRADE_BROWSER_BASE_URL:-${API_BASE_URL:-https://localhost:8443}}"
ORIGIN="${UPGRADE_BROWSER_ORIGIN:-$BASE_URL}"
USERNAME="${UPGRADE_SMOKE_USERNAME:-admin}"
PASSWORD="${UPGRADE_SMOKE_PASSWORD:-}"
EXPECT_WEBSOCKET="${UPGRADE_EXPECT_WEBSOCKET:-true}"
COOKIE_JAR="$(mktemp /tmp/sanctuary-upgrade-browser-XXXXXX.cookies)"
temp_password_suffix="$(openssl rand -hex 6 2>/dev/null || date +%s)"
TEMP_PASSWORD="UpgradeBrowser-${temp_password_suffix}-Aa1!"
websocket_key="$(openssl rand -base64 16 2>/dev/null || printf 'upgrade-browser-websocket-key' | base64)"

cleanup() {
    rm -f "$COOKIE_JAR"
}

trap cleanup EXIT

if [ -z "$PASSWORD" ]; then
    log_error "UPGRADE_SMOKE_PASSWORD is required for upgrade-browser-smoke.test.sh"
    exit 1
fi

if [ "$TEMP_PASSWORD" = "$PASSWORD" ]; then
    TEMP_PASSWORD="${TEMP_PASSWORD}-alt"
fi

login_response="$(upgrade_login_capture "$USERNAME" "$PASSWORD" "$COOKIE_JAR" "$BASE_URL" "$ORIGIN")"
if ! echo "$login_response" | grep -q '"user"'; then
    log_error "Browser login smoke failed"
    log_error "Response: $login_response"
    exit 1
fi

csrf_token="$(upgrade_extract_csrf_from_jar "$COOKIE_JAR")"
if [ -z "$csrf_token" ]; then
    log_error "Browser login smoke did not receive sanctuary_csrf cookie"
    exit 1
fi

me_response="$(upgrade_authenticated_json_request GET "/api/v1/auth/me" "" "$COOKIE_JAR" "$BASE_URL" "$ORIGIN")"
if ! echo "$me_response" | grep -q "\"username\":\"$USERNAME\""; then
    log_error "Browser GET /api/v1/auth/me smoke failed"
    log_error "Response: $me_response"
    exit 1
fi

refresh_response="$(upgrade_authenticated_json_request POST "/api/v1/auth/refresh" "{}" "$COOKIE_JAR" "$BASE_URL" "$ORIGIN")"
if ! echo "$refresh_response" | grep -q '"expiresIn"'; then
    log_error "Browser POST /api/v1/auth/refresh smoke failed"
    log_error "Response: $refresh_response"
    exit 1
fi

change_response="$(upgrade_authenticated_json_request \
    POST \
    "/api/v1/auth/me/change-password" \
    "{\"currentPassword\":\"$PASSWORD\",\"newPassword\":\"$TEMP_PASSWORD\"}" \
    "$COOKIE_JAR" \
    "$BASE_URL" \
    "$ORIGIN")"
if ! echo "$change_response" | grep -q 'Password changed successfully'; then
    log_error "Browser CSRF-protected password change smoke failed"
    log_error "Response: $change_response"
    exit 1
fi

rm -f "$COOKIE_JAR"
temp_login_response="$(upgrade_login_capture "$USERNAME" "$TEMP_PASSWORD" "$COOKIE_JAR" "$BASE_URL" "$ORIGIN")"
if ! echo "$temp_login_response" | grep -q '"user"'; then
    log_error "Browser login with temporary password failed"
    log_error "Response: $temp_login_response"
    exit 1
fi

revert_response="$(upgrade_authenticated_json_request \
    POST \
    "/api/v1/auth/me/change-password" \
    "{\"currentPassword\":\"$TEMP_PASSWORD\",\"newPassword\":\"$PASSWORD\"}" \
    "$COOKIE_JAR" \
    "$BASE_URL" \
    "$ORIGIN")"
if ! echo "$revert_response" | grep -q 'Password changed successfully'; then
    log_error "Browser password revert smoke failed"
    log_error "Response: $revert_response"
    exit 1
fi

rm -f "$COOKIE_JAR"
final_login_response="$(upgrade_login_capture "$USERNAME" "$PASSWORD" "$COOKIE_JAR" "$BASE_URL" "$ORIGIN")"
if ! echo "$final_login_response" | grep -q '"user"'; then
    log_error "Browser final login with restored password failed"
    log_error "Response: $final_login_response"
    exit 1
fi

if [ "$EXPECT_WEBSOCKET" = "true" ]; then
    ws_headers="$(curl -k -sS --http1.1 -D - -o /dev/null \
        -H "Connection: Upgrade" \
        -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Version: 13" \
        -H "Sec-WebSocket-Key: $websocket_key" \
        -H "Origin: $ORIGIN" \
        -b "$COOKIE_JAR" \
        "$BASE_URL/ws" || true)"

    if ! echo "$ws_headers" | grep -q '101 Switching Protocols'; then
        log_error "Browser WebSocket handshake smoke failed"
        log_error "Headers: $ws_headers"
        exit 1
    fi
fi

log_success "Browser-visible auth smoke checks passed"
