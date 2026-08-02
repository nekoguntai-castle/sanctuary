#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUT="$ROOT_DIR/scripts/ci/resolve-postgres-service.sh"
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
[ "${FAKE_ALIAS_AVAILABLE:-true}" = true ] || exit 1
if [ "${1:-}" = ahostsv4 ] && [ "${2:-}" = postgres ]; then
  for host in ${FAKE_ALIAS_HOSTS:-172.31.0.2}; do
    printf '%s STREAM postgres\n' "$host"
  done
fi
FAKE_GETENT
  cat > "$TEST_TEMP_DIR/bin/node" <<'FAKE_NODE'
#!/usr/bin/env bash
case "${DATABASE_URL:-}" in
  *"${FAKE_REACHABLE_ENDPOINT:-__no_single_endpoint__}"*) exit 0 ;;
esac
for endpoint in ${FAKE_REACHABLE_ENDPOINTS:-}; do
  case "${DATABASE_URL:-}" in
    *"$endpoint"*) exit 0 ;;
  esac
done
exit 1
FAKE_NODE
  chmod +x "$TEST_TEMP_DIR/bin/ip" "$TEST_TEMP_DIR/bin/getent" "$TEST_TEMP_DIR/bin/node"
}

run_resolver() {
  local output_file="$1"
  shift
  env -u FORGEJO_ENV -u SANCTUARY_CI_ENV_FILE \
    PATH="$TEST_TEMP_DIR/bin:$PATH" \
    GITHUB_ENV="$output_file" \
    SANCTUARY_POSTGRES_PROBE_TIMEOUT_SECONDS=1 \
    "$@" \
    bash "$SUT" >/dev/null
}

assert_env_contains() {
  local output_file="$1"
  local expected="$2"
  grep -Fq "$expected" "$output_file" \
    || fail "expected $output_file to contain $expected"
}

make_fakes

output="$TEST_TEMP_DIR/container-published.env"
run_resolver "$output" \
  SANCTUARY_CONTAINERIZED_RUNNER=true \
  POSTGRES_PORT=45678 \
  FAKE_REACHABLE_ENDPOINT='172.30.0.1:45678'
assert_env_contains "$output" '@172.30.0.1:45678/sanctuary_test?schema=public'

output="$TEST_TEMP_DIR/container-alias.env"
run_resolver "$output" \
  SANCTUARY_CONTAINERIZED_RUNNER=true \
  FAKE_ALIAS_HOSTS='172.31.0.2 172.31.0.3' \
  FAKE_REACHABLE_ENDPOINT='172.31.0.3:5432'
assert_env_contains "$output" '@172.31.0.3:5432/sanctuary_test?schema=public'

output="$TEST_TEMP_DIR/container-duplicate-alias.env"
run_resolver "$output" \
  SANCTUARY_CONTAINERIZED_RUNNER=true \
  SANCTUARY_POSTGRES_ALIAS_RESOLUTION_ATTEMPTS=1 \
  FAKE_ALIAS_HOSTS='172.31.0.3 172.31.0.3' \
  FAKE_REACHABLE_ENDPOINT='172.31.0.3:5432'
assert_env_contains "$output" '@172.31.0.3:5432/sanctuary_test?schema=public'

if run_resolver "$TEST_TEMP_DIR/container-multiple-matches.env" \
  SANCTUARY_CONTAINERIZED_RUNNER=true \
  SANCTUARY_POSTGRES_ALIAS_RESOLUTION_ATTEMPTS=1 \
  FAKE_ALIAS_HOSTS='172.31.0.2 172.31.0.3' \
  FAKE_REACHABLE_ENDPOINTS='172.31.0.2:5432 172.31.0.3:5432'; then
  fail 'containerized runner should reject multiple authenticated services'
fi

if run_resolver "$TEST_TEMP_DIR/container-no-matching-service.env" \
  SANCTUARY_CONTAINERIZED_RUNNER=true \
  SANCTUARY_POSTGRES_ALIAS_RESOLUTION_ATTEMPTS=1 \
  FAKE_ALIAS_HOSTS='172.31.0.2 172.31.0.3' \
  FAKE_REACHABLE_ENDPOINT='postgres:5432'; then
  fail 'containerized runner should not select the rotating shared service alias'
fi

output="$TEST_TEMP_DIR/vm-published.env"
run_resolver "$output" \
  SANCTUARY_CONTAINERIZED_RUNNER=false \
  POSTGRES_PORT=45678 \
  FAKE_REACHABLE_ENDPOINT='localhost:45678'
assert_env_contains "$output" '@localhost:45678/sanctuary_test?schema=public'

if env PATH="$TEST_TEMP_DIR/bin:$PATH" \
  GITHUB_ENV="$TEST_TEMP_DIR/invalid.env" \
  SANCTUARY_CONTAINERIZED_RUNNER=maybe \
  POSTGRES_PORT=45678 \
  FAKE_REACHABLE_ENDPOINT='nowhere' \
  bash "$SUT" >/dev/null 2>&1; then
  fail 'invalid containerized-runner mode should fail'
fi

if env -u GITHUB_ENV -u FORGEJO_ENV -u SANCTUARY_CI_ENV_FILE \
  PATH="$TEST_TEMP_DIR/bin:$PATH" \
  SANCTUARY_CONTAINERIZED_RUNNER=false \
  POSTGRES_PORT=45678 \
  FAKE_REACHABLE_ENDPOINT='localhost:45678' \
  bash "$SUT" >/dev/null 2>&1; then
  fail 'missing GITHUB_ENV should fail'
fi

echo 'resolve-postgres-service.test.sh: all checks passed'
