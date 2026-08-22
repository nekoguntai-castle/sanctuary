#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUT="$ROOT_DIR/scripts/ci/resolve-redis-service.sh"
TEST_TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_TEMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

make_fakes() {
  mkdir -p "$TEST_TEMP_DIR/bin"
  cat > "$TEST_TEMP_DIR/bin/ip" <<'FAKE_IP'
#!/usr/bin/env bash
printf 'default via 172.30.0.1 dev eth0\n'
FAKE_IP
  cat > "$TEST_TEMP_DIR/bin/getent" <<'FAKE_GETENT'
#!/usr/bin/env bash
printf '172.30.0.8 STREAM redis\n'
printf '172.30.0.9 STREAM redis\n'
FAKE_GETENT
  cat > "$TEST_TEMP_DIR/bin/node" <<'FAKE_NODE'
#!/usr/bin/env bash
endpoint="${2:-}:${3:-}"
[ "${FAKE_ACCEPT_ALL_ENDPOINTS:-false}" = true ] \
  || [ "$endpoint" = "${FAKE_REACHABLE_ENDPOINT:-__unreachable__}" ] \
  || exit 1
[ "${4:-}" = "${FAKE_EXPECTED_TIMEOUT:-10}" ] || exit 1
[ "${5:-}" = "${FAKE_EXPECTED_PASSWORD:-}" ] || exit 1
printf '%s %s\n' "$endpoint" "${5:-}" >> "${FAKE_PROBE_LOG:?}"
FAKE_NODE
  chmod +x "$TEST_TEMP_DIR/bin/ip" "$TEST_TEMP_DIR/bin/getent" "$TEST_TEMP_DIR/bin/node"
}

run_resolver() {
  local output_file="$1"
  shift
  env -u FORGEJO_ENV -u SANCTUARY_CI_ENV_FILE \
    PATH="$TEST_TEMP_DIR/bin:$PATH" \
    GITHUB_ENV="$output_file" \
    FAKE_PROBE_LOG="$TEST_TEMP_DIR/probes.log" \
    "$@" \
    bash "$SUT" >/dev/null
}

assert_env_equals() {
  local output_file="$1"
  local expected="$2"
  [ "$(cat "$output_file")" = "$expected" ] \
    || fail "expected $output_file to equal $expected"
}

assert_no_env() {
  local output_file="$1"
  [ ! -s "$output_file" ] || fail "expected no environment output in $output_file"
}

make_fakes

output="$TEST_TEMP_DIR/container-published.env"
run_resolver "$output" \
  SANCTUARY_CONTAINERIZED_RUNNER=true \
  REDIS_PORT=45678 \
  REDIS_PASSWORD=container-password \
  FAKE_EXPECTED_PASSWORD=container-password \
  FAKE_REACHABLE_ENDPOINT='172.30.0.1:45678'
assert_env_equals "$output" 'REDIS_URL=redis://:container-password@172.30.0.1:45678'

output="$TEST_TEMP_DIR/container-override.env"
run_resolver "$output" \
  SANCTUARY_CONTAINERIZED_RUNNER=true \
  SANCTUARY_REDIS_GATEWAY=172.31.0.9 \
  REDIS_PORT=45679 \
  REDIS_PASSWORD=override-password \
  FAKE_EXPECTED_PASSWORD=override-password \
  FAKE_REACHABLE_ENDPOINT='172.31.0.9:45679'
assert_env_equals "$output" 'REDIS_URL=redis://:override-password@172.31.0.9:45679'

output="$TEST_TEMP_DIR/vm-published.env"
run_resolver "$output" \
  SANCTUARY_CONTAINERIZED_RUNNER=false \
  REDIS_PORT=45680 \
  SANCTUARY_REDIS_PROBE_TIMEOUT_SECONDS=7 \
  REDIS_PASSWORD=vm-password \
  FAKE_EXPECTED_PASSWORD=vm-password \
  FAKE_EXPECTED_TIMEOUT=7 \
  FAKE_REACHABLE_ENDPOINT='localhost:45680'
assert_env_equals "$output" 'REDIS_URL=redis://:vm-password@localhost:45680'

output="$TEST_TEMP_DIR/alias-candidate.env"
run_resolver "$output" \
  SANCTUARY_CONTAINERIZED_RUNNER=true \
  REDIS_PASSWORD=alias-password \
  FAKE_EXPECTED_PASSWORD=alias-password \
  FAKE_REACHABLE_ENDPOINT='172.30.0.9:6379'
assert_env_equals "$output" 'REDIS_URL=redis://:alias-password@172.30.0.9:6379'

output="$TEST_TEMP_DIR/ambiguous-alias.env"
if run_resolver "$output" \
  SANCTUARY_CONTAINERIZED_RUNNER=true \
  REDIS_PASSWORD=ambiguous-password \
  FAKE_EXPECTED_PASSWORD=ambiguous-password \
  FAKE_ACCEPT_ALL_ENDPOINTS=true; then
  fail 'multiple authenticated Redis alias candidates should fail'
fi
assert_no_env "$output"

output="$TEST_TEMP_DIR/unreachable.env"
if run_resolver "$output" \
  SANCTUARY_CONTAINERIZED_RUNNER=false \
  REDIS_PORT=45681 \
  REDIS_PASSWORD=unreachable-password \
  FAKE_EXPECTED_PASSWORD=unreachable-password \
  FAKE_REACHABLE_ENDPOINT='nowhere:1'; then
  fail 'unreachable published and alias Redis candidates should fail'
fi
assert_no_env "$output"

for invalid_port in '' 0 65536 abc; do
  output="$TEST_TEMP_DIR/invalid-${invalid_port:-empty}.env"
  if run_resolver "$output" \
    SANCTUARY_CONTAINERIZED_RUNNER=false \
    REDIS_PORT="$invalid_port" \
    REDIS_PASSWORD=invalid-port-password \
    FAKE_REACHABLE_ENDPOINT='localhost:1'; then
    fail "invalid Redis port should fail: ${invalid_port:-empty}"
  fi
  assert_no_env "$output"
done

output="$TEST_TEMP_DIR/missing-password.env"
if run_resolver "$output" \
  SANCTUARY_CONTAINERIZED_RUNNER=false \
  REDIS_PORT=45680 \
  FAKE_REACHABLE_ENDPOINT='localhost:45680'; then
  fail 'missing Redis password should fail'
fi
assert_no_env "$output"

if env PATH="$TEST_TEMP_DIR/bin:$PATH" \
  GITHUB_ENV="$TEST_TEMP_DIR/invalid-mode.env" \
  FAKE_PROBE_LOG="$TEST_TEMP_DIR/probes.log" \
  SANCTUARY_CONTAINERIZED_RUNNER=maybe \
  REDIS_PORT=45678 \
  REDIS_PASSWORD=invalid-mode-password \
  bash "$SUT" >/dev/null 2>&1; then
  fail 'invalid containerized-runner mode should fail'
fi

if env -u GITHUB_ENV -u FORGEJO_ENV -u SANCTUARY_CI_ENV_FILE \
  PATH="$TEST_TEMP_DIR/bin:$PATH" \
  FAKE_PROBE_LOG="$TEST_TEMP_DIR/probes.log" \
  SANCTUARY_CONTAINERIZED_RUNNER=false \
  REDIS_PORT=45678 \
  REDIS_PASSWORD=missing-env-password \
  FAKE_REACHABLE_ENDPOINT='localhost:45678' \
  bash "$SUT" >/dev/null 2>&1; then
  fail 'missing CI environment file should fail'
fi

grep -Fq '172.30.0.1:45678' "$TEST_TEMP_DIR/probes.log" \
  || fail 'expected the default container gateway to be probed'
grep -Fq '172.31.0.9:45679' "$TEST_TEMP_DIR/probes.log" \
  || fail 'expected the explicit container gateway to be probed'
grep -Fq 'localhost:45680' "$TEST_TEMP_DIR/probes.log" \
  || fail 'expected the VM published endpoint to be probed'
grep -Fq '172.30.0.9:6379 alias-password' "$TEST_TEMP_DIR/probes.log" \
  || fail 'expected the job-authenticated alias candidate to be selected'

echo 'resolve-redis-service.test.sh: all checks passed'
