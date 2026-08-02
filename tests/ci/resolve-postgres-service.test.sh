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
[ "${FAKE_ALIAS_AVAILABLE:-true}" = true ]
FAKE_GETENT
  cat > "$TEST_TEMP_DIR/bin/node" <<'FAKE_NODE'
#!/usr/bin/env bash
case "${DATABASE_URL:-}" in
  *"${FAKE_REACHABLE_ENDPOINT:?}"*) exit 0 ;;
  *) exit 1 ;;
esac
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
  POSTGRES_PORT=45678 \
  FAKE_REACHABLE_ENDPOINT='postgres:5432'
assert_env_contains "$output" '@postgres:5432/sanctuary_test?schema=public'

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
