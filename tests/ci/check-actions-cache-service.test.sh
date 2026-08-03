#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECK_SCRIPT="$REPO_ROOT/scripts/ci/check-actions-cache-service.sh"
WRAPPER_ACTION="$REPO_ROOT/.github/actions/cache/action.yml"

tmp_dir="$(mktemp -d)"
trap 'find "$tmp_dir" -type f -delete; find "$tmp_dir" -depth -type d -exec rmdir {} +' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

run_check() {
  local endpoint="$1"
  local state_file="$2"
  local output_file="$3"
  local log_file="$4"
  local summary_file="$5"

  ACTIONS_CACHE_URL="$endpoint" \
    CACHE_HEALTH_STATE_FILE="$state_file" \
    SANCTUARY_CI_PROVIDER_OVERRIDE=forgejo \
    SANCTUARY_CI_OUTPUT_FILE="$output_file" \
    SANCTUARY_CI_STEP_SUMMARY_FILE="$summary_file" \
    bash "$CHECK_SCRIPT" > "$log_file"
}

assert_wrapper_contract() {
  grep -Fq 'if: steps.cache-health.outputs.available == '\''true'\''' "$WRAPPER_ACTION" \
    || fail "cache action is not gated by the health result"
  [ "$(grep -Fc 'uses: actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae' "$WRAPPER_ACTION")" -eq 1 ] \
    || fail "cache wrapper does not own exactly one reviewed actions/cache pin"
  grep -Fq 'value: ${{ steps.cache.outputs.cache-hit }}' "$WRAPPER_ACTION" \
    || fail "cache-hit output is not forwarded"
  grep -Fq 'path: ${{ inputs.path }}' "$WRAPPER_ACTION" \
    || fail "cache path input is not forwarded"
  grep -Fq 'key: ${{ inputs.key }}' "$WRAPPER_ACTION" \
    || fail "cache key input is not forwarded"
  grep -Fq 'restore-keys: ${{ inputs.restore-keys }}' "$WRAPPER_ACTION" \
    || fail "cache restore keys are not forwarded"
  if grep -Fq 'strategy.job-index' "$WRAPPER_ACTION"; then
    fail "cache wrapper uses a strategy context unsupported by Forgejo Runner"
  fi
  grep -Fq 'mktemp "$state_dir/sanctuary-cache-health.XXXXXX"' "$CHECK_SCRIPT" \
    || fail "cache health state is not generated uniquely per job"
  grep -Fq 'ci_emit_env "CACHE_HEALTH_STATE_FILE=$state_file"' "$CHECK_SCRIPT" \
    || fail "cache health state is not persisted for later job steps"
}

assert_url_parsing() {
  local parsed

  parsed="$(cache_endpoint_host_port 'http://cache.internal:3000/token?sig=secret')"
  [ "$(printf '%s\n' "$parsed" | sed -n '1p')" = cache.internal ] \
    || fail "cache host was not parsed"
  [ "$(printf '%s\n' "$parsed" | sed -n '2p')" = 3000 ] \
    || fail "cache port was not parsed"
  [ "$(cache_endpoint_host_port 'https://cache.internal/token')" = $'cache.internal\n443' ] \
    || fail "default HTTPS port was not selected"
  [ "$(cache_endpoint_origin 'https://cache.internal/token?sig=secret')" = 'https://cache.internal:443/' ] \
    || fail "cache origin retained capability path or query data"
  if cache_endpoint_host_port 'file:///tmp/cache'; then
    fail "unsupported cache scheme was accepted"
  fi
  if cache_endpoint_host_port 'http://cache.internal:70000/token'; then
    fail "out-of-range cache port was accepted"
  fi
  if cache_endpoint_host_port 'not-a-url'; then
    fail "malformed cache URL was accepted"
  fi
}

assert_capability_is_absent_from_curl_argv() {
  local fake_bin="$tmp_dir/fake-bin"
  local curl_args="$tmp_dir/curl-args"
  local output_file="$tmp_dir/argv-output"

  mkdir -p "$fake_bin"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'printf '\''%s\n'\'' "$@" > "$FAKE_CURL_ARGS"' \
    'printf '\''404'\''' > "$fake_bin/curl"
  chmod +x "$fake_bin/curl"

  PATH="$fake_bin:$PATH" FAKE_CURL_ARGS="$curl_args" \
    run_check 'https://cache.internal:4443/run-capability?sig=secret' \
      "$tmp_dir/argv-state" "$output_file" \
      "$tmp_dir/argv-log" "$tmp_dir/argv-summary"

  grep -Fx 'https://cache.internal:4443/' "$curl_args" >/dev/null \
    || fail "curl did not probe the reconstructed cache origin"
  if grep -Eq 'run-capability|sig=secret' "$curl_args"; then
    fail "cache capability leaked into curl process arguments"
  fi
  grep -Fx 'available=true' "$output_file" >/dev/null \
    || fail "origin-only cache probe was not accepted"
}

assert_generated_state_is_job_scoped() {
  local job_env="$tmp_dir/job-env"
  local first_output="$tmp_dir/generated-first-output"
  local second_output="$tmp_dir/generated-second-output"
  local first_log="$tmp_dir/generated-first-log"
  local second_log="$tmp_dir/generated-second-log"
  local generated_state

  ACTIONS_CACHE_URL='http://127.0.0.1:1/cache' \
    SANCTUARY_CI_PROVIDER_OVERRIDE=forgejo \
    SANCTUARY_CI_TEMP_DIR_OVERRIDE="$tmp_dir" \
    SANCTUARY_CI_ENV_FILE="$job_env" \
    SANCTUARY_CI_OUTPUT_FILE="$first_output" \
    SANCTUARY_CI_STEP_SUMMARY_FILE="$tmp_dir/generated-summary" \
    bash "$CHECK_SCRIPT" > "$first_log"
  generated_state="$(sed -n 's/^CACHE_HEALTH_STATE_FILE=//p' "$job_env")"
  [ -n "$generated_state" ] && [ -f "$generated_state" ] \
    || fail "job-local cache health state was not generated"

  ACTIONS_CACHE_URL='http://127.0.0.1:1/cache' \
    CACHE_HEALTH_STATE_FILE="$generated_state" \
    SANCTUARY_CI_PROVIDER_OVERRIDE=forgejo \
    SANCTUARY_CI_TEMP_DIR_OVERRIDE="$tmp_dir" \
    SANCTUARY_CI_ENV_FILE="$job_env" \
    SANCTUARY_CI_OUTPUT_FILE="$second_output" \
    SANCTUARY_CI_STEP_SUMMARY_FILE="$tmp_dir/generated-summary" \
    bash "$CHECK_SCRIPT" > "$second_log"
  [ "$(grep -c '^CACHE_HEALTH_STATE_FILE=' "$job_env")" -eq 1 ] \
    || fail "cached state path was regenerated within one job"
  [ ! -s "$second_log" ] \
    || fail "job-local unavailable state emitted a duplicate warning"
}

assert_healthy_and_cached() {
  local state_file="$tmp_dir/healthy-state"
  local output_file="$tmp_dir/healthy-output"
  local first_log="$tmp_dir/healthy-first-log"
  local second_log="$tmp_dir/healthy-second-log"
  local summary_file="$tmp_dir/healthy-summary"
  local listener_port_file="$tmp_dir/listener-port"
  local listener_pid
  local listener_port

  node -e '
    const fs = require("node:fs");
    const http = require("node:http");
    const server = http.createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    server.listen(0, "127.0.0.1", () => {
      fs.writeFileSync(process.argv[1], String(server.address().port));
    });
    setTimeout(() => server.close(), 10000);
  ' "$listener_port_file" &
  listener_pid=$!
  for _ in {1..50}; do
    [ -s "$listener_port_file" ] && break
    sleep 0.02
  done
  [ -s "$listener_port_file" ] || fail "test listener did not start"
  listener_port="$(<"$listener_port_file")"

  run_check "http://127.0.0.1:$listener_port/cache" \
    "$state_file" "$output_file" "$first_log" "$summary_file"
  kill "$listener_pid" 2>/dev/null || true
  wait "$listener_pid" 2>/dev/null || true
  run_check 'http://127.0.0.1:1/cache' \
    "$state_file" "$output_file" "$second_log" "$summary_file"

  [ "$(grep -c '^available=true$' "$output_file")" -eq 2 ] \
    || fail "reachable cache result was not reused"
  [ ! -s "$first_log" ] && [ ! -s "$second_log" ] \
    || fail "healthy cache probe emitted a warning"
  [ ! -s "$summary_file" ] || fail "healthy cache probe wrote a warning summary"
}

assert_unavailable_and_cached() {
  local state_file="$tmp_dir/unavailable-state"
  local output_file="$tmp_dir/unavailable-output"
  local first_log="$tmp_dir/unavailable-first-log"
  local second_log="$tmp_dir/unavailable-second-log"
  local summary_file="$tmp_dir/unavailable-summary"

  run_check 'http://127.0.0.1:1/token?sig=secret' \
    "$state_file" "$output_file" "$first_log" "$summary_file"
  run_check 'http://127.0.0.1:1/token?sig=secret' \
    "$state_file" "$output_file" "$second_log" "$summary_file"

  [ "$(grep -c '^available=false$' "$output_file")" -eq 2 ] \
    || fail "unavailable cache result was not reused"
  [ "$(grep -c '^::warning' "$first_log")" -eq 1 ] \
    || fail "first unavailable probe did not emit one warning"
  [ ! -s "$second_log" ] || fail "cached unavailable state emitted another warning"
  [ "$(grep -c '^### Action cache unavailable$' "$summary_file")" -eq 1 ] \
    || fail "unavailable cache did not write one job summary"
  if grep -Fq 'sig=secret' "$first_log" "$summary_file"; then
    fail "cache URL secret leaked into diagnostics"
  fi
}

assert_broken_protocol_is_unavailable() {
  local port_file="$tmp_dir/broken-port"
  local server_pid
  local port
  local output_file="$tmp_dir/broken-output"

  node -e '
    const fs = require("node:fs");
    const http = require("node:http");
    const server = http.createServer((_request, response) => {
      response.writeHead(503);
      response.end();
    });
    server.listen(0, "127.0.0.1", () => {
      fs.writeFileSync(process.argv[1], String(server.address().port));
    });
    setTimeout(() => server.close(), 10000);
  ' "$port_file" &
  server_pid=$!
  for _ in {1..50}; do
    [ -s "$port_file" ] && break
    sleep 0.02
  done
  [ -s "$port_file" ] || fail "broken HTTP fixture did not start"
  port="$(<"$port_file")"

  run_check "http://127.0.0.1:$port/cache" \
    "$tmp_dir/http-503-state" "$output_file" \
    "$tmp_dir/http-503-log" "$tmp_dir/http-503-summary"
  run_check "https://127.0.0.1:$port/cache" \
    "$tmp_dir/plaintext-tls-state" "$output_file" \
    "$tmp_dir/plaintext-tls-log" "$tmp_dir/plaintext-tls-summary"
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true

  [ "$(grep -c '^available=false$' "$output_file")" -eq 2 ] \
    || fail "HTTP 503 or invalid TLS endpoint was accepted"
}

assert_missing_provider_contract_is_unavailable() {
  local state_file="$tmp_dir/missing-state"
  local output_file="$tmp_dir/missing-output"
  local log_file="$tmp_dir/missing-log"
  local summary_file="$tmp_dir/missing-summary"

  run_check '' "$state_file" "$output_file" "$log_file" "$summary_file"
  grep -Fx 'available=false' "$output_file" >/dev/null \
    || fail "missing cache runtime URL was not contained"
  [ "$(grep -c '^::warning' "$log_file")" -eq 1 ] \
    || fail "missing cache runtime URL did not emit one warning"
}

assert_corrupt_state_is_reprobed() {
  local state_file="$tmp_dir/corrupt-state"
  local output_file="$tmp_dir/corrupt-output"
  local log_file="$tmp_dir/corrupt-log"
  local summary_file="$tmp_dir/corrupt-summary"

  printf '%s\n' corrupt > "$state_file"
  run_check 'http://127.0.0.1:1/cache' \
    "$state_file" "$output_file" "$log_file" "$summary_file"
  grep -Fx unavailable "$state_file" >/dev/null \
    || fail "corrupt state was not replaced after probing"
}

source "$CHECK_SCRIPT"
assert_wrapper_contract
assert_url_parsing
assert_capability_is_absent_from_curl_argv
assert_generated_state_is_job_scoped
assert_healthy_and_cached
assert_unavailable_and_cached
assert_broken_protocol_is_unavailable
assert_missing_provider_contract_is_unavailable
assert_corrupt_state_is_reprobed

printf 'PASS: action cache service health checks\n'
