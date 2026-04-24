#!/bin/bash

upgrade_cookie_value() {
    local jar_file="$1"
    local cookie_name="$2"

    if [ ! -f "$jar_file" ]; then
        return 0
    fi

    awk -F'\t' -v cookie_name="$cookie_name" '$6 == cookie_name { print $7 }' "$jar_file" | tail -n 1
}

upgrade_extract_csrf_from_jar() {
    local jar_file="$1"
    upgrade_cookie_value "$jar_file" "sanctuary_csrf"
}

upgrade_json_value() {
    local expression="$1"

    node -e '
const fs = require("node:fs");
const input = fs.readFileSync(0, "utf8");
const obj = JSON.parse(input);
const value = (() => '"$expression"')();
if (value === undefined || value === null) {
  process.exit(1);
}
process.stdout.write(typeof value === "object" ? JSON.stringify(value) : String(value));
'
}

upgrade_login_capture() {
    local username="$1"
    local password="$2"
    local cookie_jar="$3"
    local base_url="${4:-$API_BASE_URL}"
    local origin="${5:-}"
    local -a curl_opts

    curl_opts=(-k -s -c "$cookie_jar" -b "$cookie_jar" -X POST -H "Content-Type: application/json")
    if [ -n "$origin" ]; then
        curl_opts+=(-H "Origin: $origin")
    fi
    curl_opts+=(-d "{\"username\":\"$username\",\"password\":\"$password\"}")

    curl "${curl_opts[@]}" "$base_url/api/v1/auth/login"
}

upgrade_authenticated_json_request() {
    local method="$1"
    local endpoint="$2"
    local body="${3:-}"
    local cookie_jar="${4:-$COOKIE_JAR}"
    local base_url="${5:-$API_BASE_URL}"
    local origin="${6:-}"
    local csrf_token=""
    local -a curl_opts

    curl_opts=(-k -s -b "$cookie_jar" -c "$cookie_jar" -X "$method" -H "Content-Type: application/json")
    if [ -n "$origin" ]; then
        curl_opts+=(-H "Origin: $origin")
    fi

    case "$method" in
        GET|HEAD)
            ;;
        *)
            csrf_token="$(upgrade_extract_csrf_from_jar "$cookie_jar")"
            if [ -n "$csrf_token" ]; then
                curl_opts+=(-H "X-CSRF-Token: $csrf_token")
            fi
            ;;
    esac

    if [ -n "$body" ]; then
        curl_opts+=(-d "$body")
    fi

    curl "${curl_opts[@]}" "${base_url}${endpoint}"
}

assert_upgrade_worker_ready() {
    local container=""
    local ready_response=""

    container="$(get_container_name "worker")"
    if [ -z "$container" ]; then
        log_error "Worker container not found"
        return 1
    fi

    if ! wait_for_container_healthy "$container" 120; then
        log_error "Worker container did not become healthy"
        return 1
    fi

    ready_response="$(compose_exec worker wget -q -O - http://localhost:3002/ready 2>/dev/null || true)"
    if [ -z "$ready_response" ]; then
        log_error "Worker /ready endpoint did not respond"
        return 1
    fi

    return 0
}

assert_upgrade_support_package_json() {
    local project_root="$1"
    local output_file="$2"

    if ! "$project_root/scripts/support-package.sh" "$output_file" >/dev/null 2>&1; then
        log_error "Support package generation failed"
        return 1
    fi

    if [ ! -s "$output_file" ]; then
        log_error "Support package output file is empty: $output_file"
        return 1
    fi

    if ! node -e '
const fs = require("node:fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (typeof data !== "object" || !data || typeof data.generatedAt !== "string" || typeof data.version !== "string") {
  process.exit(1);
}
if (!data.collectors || typeof data.collectors !== "object" || !data.meta || typeof data.meta !== "object") {
  process.exit(1);
}
' "$output_file"; then
        log_error "Support package JSON shape was invalid"
        return 1
    fi

    return 0
}
