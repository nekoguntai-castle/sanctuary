#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/wait-for-docker.sh"
ENDPOINT_LIB="$ROOT_DIR/scripts/ci/docker-endpoint-lib.sh"
TEST_TEMP_DIR=''

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TEST_TEMP_DIR" ]; then
    rm -rf "$TEST_TEMP_DIR"
  fi
}

write_docker_stub() {
  local bin_dir="$TEST_TEMP_DIR/bin"

  mkdir -p "$bin_dir"
  cat > "$bin_dir/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

mode="${SANCTUARY_STUB_DOCKER_MODE:-ready}"
counter_file="${SANCTUARY_STUB_DOCKER_COUNTER:?}"

case "$1" in
  --version)
    echo 'Docker version stub'
    exit 0
    ;;
  version)
    count="$(cat "$counter_file" 2>/dev/null || echo 0)"
    count=$((count + 1))
    echo "$count" > "$counter_file"
    if [ "$mode" = "delayed" ] && [ "$count" -lt 2 ]; then
      exit 1
    fi
    if [ "$mode" = "down" ]; then
      exit 1
    fi
    echo 'Docker version stub'
    exit 0
    ;;
  compose)
    if [ "$mode" = "down" ]; then
      exit 1
    fi
    echo 'Docker Compose version stub'
    exit 0
    ;;
esac

exit 1
EOF
  chmod +x "$bin_dir/docker"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  # shellcheck source=scripts/ci/docker-endpoint-lib.sh
  source "$ENDPOINT_LIB"
  bash -n "$SCRIPT"
  bash -n "$ENDPOINT_LIB"
  route_file="$TEST_TEMP_DIR/proc-route"
  cat > "$route_file" <<'EOF'
Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT
eth0 00000000 01020304 0003 0 0 0 00000000 0 0 0
EOF
  gateway_host="$(SANCTUARY_PROC_ROUTE_FILE="$route_file" sanctuary_default_gateway_ip)"
  [ "$(sanctuary_docker_published_host_for_endpoint 'tcp://docker-host:2375')" = "docker-host" ] ||
    fail 'expected TCP Docker endpoint host to be extracted'
  [ "$(
    SANCTUARY_ASSUME_CONTAINERIZED=0 \
      sanctuary_docker_published_host_for_endpoint 'unix:///var/run/docker.sock'
  )" = "127.0.0.1" ] ||
    fail 'expected Unix Docker socket to publish on local loopback'
  [ "$(
    SANCTUARY_ASSUME_CONTAINERIZED=1 \
      SANCTUARY_PROC_ROUTE_FILE="$route_file" \
      sanctuary_docker_published_host_for_endpoint 'unix:///var/run/docker.sock'
  )" = "$gateway_host" ] || fail 'expected containerized Unix socket to publish on the gateway'
  [ "$(
    SANCTUARY_DOCKER_PUBLISHED_HOST=published-host \
      DOCKER_HOST=tcp://docker-host:2375 \
      sanctuary_current_docker_published_host
  )" = "published-host" ] || fail 'expected explicit published host to win'
  write_docker_stub

  : > "$TEST_TEMP_DIR/counter"
  env -u DOCKER_HOST -u SANCTUARY_DOCKER_PUBLISHED_HOST \
    PATH="$TEST_TEMP_DIR/bin:$PATH" \
    SANCTUARY_STUB_DOCKER_MODE=delayed \
    SANCTUARY_STUB_DOCKER_COUNTER="$TEST_TEMP_DIR/counter" \
    SANCTUARY_DOCKER_WAIT_SECONDS=2 \
    SANCTUARY_DOCKER_WAIT_INTERVAL_SECONDS=0 \
    bash "$SCRIPT" >/dev/null
  [ "$(cat "$TEST_TEMP_DIR/counter")" = "2" ] || fail 'expected delayed docker retry'

  : > "$TEST_TEMP_DIR/counter"
  : > "$TEST_TEMP_DIR/github-env"
  PATH="$TEST_TEMP_DIR/bin:$PATH" \
    DOCKER_HOST=tcp://docker-host:2375 \
    SANCTUARY_DOCKER_ENV_FILE="$TEST_TEMP_DIR/github-env" \
    SANCTUARY_STUB_DOCKER_MODE=ready \
    SANCTUARY_STUB_DOCKER_COUNTER="$TEST_TEMP_DIR/counter" \
    SANCTUARY_DOCKER_WAIT_SECONDS=0 \
    SANCTUARY_DOCKER_WAIT_INTERVAL_SECONDS=0 \
    bash "$SCRIPT" >/dev/null
  grep -Fx 'DOCKER_HOST=tcp://docker-host:2375' "$TEST_TEMP_DIR/github-env" >/dev/null ||
    fail 'expected selected Docker endpoint to be exported'
  grep -Fx 'SANCTUARY_DOCKER_PUBLISHED_HOST=docker-host' "$TEST_TEMP_DIR/github-env" >/dev/null ||
    fail 'expected Docker published host to be exported'

  : > "$TEST_TEMP_DIR/counter"
  : > "$TEST_TEMP_DIR/github-env"
  env -u DOCKER_HOST -u SANCTUARY_DOCKER_PUBLISHED_HOST \
    PATH="$TEST_TEMP_DIR/bin:$PATH" \
    SANCTUARY_DOCKER_ENV_FILE="$TEST_TEMP_DIR/github-env" \
    SANCTUARY_ASSUME_CONTAINERIZED=1 \
    SANCTUARY_PROC_ROUTE_FILE="$route_file" \
    SANCTUARY_STUB_DOCKER_MODE=ready \
    SANCTUARY_STUB_DOCKER_COUNTER="$TEST_TEMP_DIR/counter" \
    SANCTUARY_DOCKER_WAIT_SECONDS=0 \
    SANCTUARY_DOCKER_WAIT_INTERVAL_SECONDS=0 \
    bash "$SCRIPT" >/dev/null
  grep -Fx 'DOCKER_HOST=' "$TEST_TEMP_DIR/github-env" >/dev/null ||
    fail 'expected default Docker endpoint to unset DOCKER_HOST'
  grep -Fx "SANCTUARY_DOCKER_PUBLISHED_HOST=$gateway_host" "$TEST_TEMP_DIR/github-env" >/dev/null ||
    fail 'expected containerized default endpoint to export gateway published host'

  : > "$TEST_TEMP_DIR/counter"
  if env -u DOCKER_HOST -u SANCTUARY_DOCKER_PUBLISHED_HOST \
    PATH="$TEST_TEMP_DIR/bin:$PATH" \
    SANCTUARY_STUB_DOCKER_MODE=down \
    SANCTUARY_STUB_DOCKER_COUNTER="$TEST_TEMP_DIR/counter" \
    SANCTUARY_DOCKER_WAIT_SECONDS=0 \
    SANCTUARY_DOCKER_WAIT_INTERVAL_SECONDS=0 \
    bash "$SCRIPT" >/dev/null 2>&1; then
    fail 'expected unavailable docker to fail'
  fi

  echo "docker readiness helper checks passed"
}

main "$@"
