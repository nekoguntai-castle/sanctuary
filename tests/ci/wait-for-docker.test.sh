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
probe_file="${SANCTUARY_STUB_DOCKER_PROBES:-/dev/null}"

case "$1" in
  --version)
    echo 'Docker version stub'
    exit 0
    ;;
  version)
    printf '%s|%s|%s\n' "${DOCKER_HOST:-__default__}" "${DOCKER_TLS_VERIFY:-}" "${DOCKER_CERT_PATH:-}" >> "$probe_file"
    count="$(cat "$counter_file" 2>/dev/null || echo 0)"
    count=$((count + 1))
    echo "$count" > "$counter_file"
    if [ "$mode" = "delayed" ] && [ "$count" -lt 2 ]; then
      exit 1
    fi
    if [ "$mode" = "down" ]; then
      exit 1
    fi
    if [ "$mode" = "tls-down" ] && [[ "${DOCKER_HOST:-}" == *:2376 ]]; then
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

write_getent_stub() {
  # $1 = alias that resolves ("" for none). Mirrors `getent hosts <name>`.
  local resolves="$1"
  local bin_dir="$TEST_TEMP_DIR/bin"

  mkdir -p "$bin_dir"
  cat > "$bin_dir/getent" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "hosts" ] && [ -n "$resolves" ] && [ "\$2" = "$resolves" ]; then
  echo "10.88.0.1       $resolves"
  exit 0
fi
exit 2
EOF
  chmod +x "$bin_dir/getent"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  # Runner-level Docker transport settings must not leak into fixtures that
  # intentionally exercise default, Unix-socket, or plaintext compatibility
  # paths. TLS fixtures below opt back in with a complete explicit contract.
  unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH
  unset SANCTUARY_REQUIRE_DOCKER_TLS SANCTUARY_DOCKER_PUBLISHED_HOST

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
  [ "$(sanctuary_docker_published_host_for_endpoint 'tcp://docker-in-docker:2376')" = "docker-in-docker" ] ||
    fail 'expected TLS TCP Docker endpoint host to be extracted'
  [ "$(
    SANCTUARY_ASSUME_CONTAINERIZED=0 \
      sanctuary_docker_published_host_for_endpoint 'unix:///var/run/docker.sock'
  )" = "127.0.0.1" ] ||
    fail 'expected Unix Docker socket to publish on local loopback'
  # Rootless Podman publishes container ports on the host, reachable from a job
  # container as host.containers.internal. The bridge gateway accepts the
  # connection and answers nothing, so preferring it strands every published-port
  # probe -- which is what wedged verify-vectors at the bitcoind RPC wait.
  write_getent_stub 'host.containers.internal'
  [ "$(
    PATH="$TEST_TEMP_DIR/bin:$PATH" \
      SANCTUARY_ASSUME_CONTAINERIZED=1 \
      SANCTUARY_PROC_ROUTE_FILE="$route_file" \
      sanctuary_docker_published_host_for_endpoint 'unix:///var/run/docker.sock'
  )" = "10.88.0.1" ] ||
    fail 'expected containerized Unix socket to publish on host.containers.internal'

  write_getent_stub 'host.docker.internal'
  [ "$(
    PATH="$TEST_TEMP_DIR/bin:$PATH" \
      SANCTUARY_ASSUME_CONTAINERIZED=1 \
      SANCTUARY_PROC_ROUTE_FILE="$route_file" \
      sanctuary_docker_published_host_for_endpoint 'unix:///var/run/docker.sock'
  )" = "10.88.0.1" ] ||
    fail 'expected the Docker host alias to be used when the Podman one is absent'

  # Neither alias resolves (plain Docker bridge): the gateway is still correct.
  write_getent_stub ''
  [ "$(
    PATH="$TEST_TEMP_DIR/bin:$PATH" \
      SANCTUARY_ASSUME_CONTAINERIZED=1 \
      SANCTUARY_PROC_ROUTE_FILE="$route_file" \
      sanctuary_docker_published_host_for_endpoint 'unix:///var/run/docker.sock'
  )" = "$gateway_host" ] || fail 'expected containerized Unix socket to fall back to the gateway'
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

  tls_certs="$TEST_TEMP_DIR/tls-certs"
  mkdir -p "$tls_certs"
  : > "$tls_certs/ca.pem"
  : > "$tls_certs/cert.pem"
  : > "$tls_certs/key.pem"
  : > "$TEST_TEMP_DIR/counter"
  : > "$TEST_TEMP_DIR/github-env"
  : > "$TEST_TEMP_DIR/probes"
  PATH="$TEST_TEMP_DIR/bin:$PATH" \
    DOCKER_HOST=tcp://docker-in-docker:2376 \
    DOCKER_TLS_VERIFY=1 \
    DOCKER_CERT_PATH="$tls_certs" \
    SANCTUARY_REQUIRE_DOCKER_TLS=1 \
    SANCTUARY_DOCKER_ENV_FILE="$TEST_TEMP_DIR/github-env" \
    SANCTUARY_STUB_DOCKER_MODE=ready \
    SANCTUARY_STUB_DOCKER_COUNTER="$TEST_TEMP_DIR/counter" \
    SANCTUARY_STUB_DOCKER_PROBES="$TEST_TEMP_DIR/probes" \
    SANCTUARY_DOCKER_WAIT_SECONDS=0 \
    SANCTUARY_DOCKER_WAIT_INTERVAL_SECONDS=0 \
    bash "$SCRIPT" >/dev/null
  grep -Fx 'DOCKER_HOST=tcp://docker-in-docker:2376' "$TEST_TEMP_DIR/github-env" >/dev/null ||
    fail 'expected selected TLS Docker endpoint to be exported'
  grep -Fx 'DOCKER_TLS_VERIFY=1' "$TEST_TEMP_DIR/github-env" >/dev/null ||
    fail 'expected Docker TLS verification to be exported'
  grep -Fx "DOCKER_CERT_PATH=$tls_certs" "$TEST_TEMP_DIR/github-env" >/dev/null ||
    fail 'expected Docker certificate path to be exported'
  grep -Fx 'SANCTUARY_DOCKER_PUBLISHED_HOST=docker-in-docker' "$TEST_TEMP_DIR/github-env" >/dev/null ||
    fail 'expected TLS Docker published host to be exported'
  grep -Fx "tcp://docker-in-docker:2376|1|$tls_certs" "$TEST_TEMP_DIR/probes" >/dev/null ||
    fail 'expected Docker probe to preserve TLS configuration'

  for missing_cert in ca.pem cert.pem key.pem; do
    mv "$tls_certs/$missing_cert" "$tls_certs/$missing_cert.missing"
    if PATH="$TEST_TEMP_DIR/bin:$PATH" \
      DOCKER_HOST=tcp://docker-in-docker:2376 \
      DOCKER_TLS_VERIFY=1 \
      DOCKER_CERT_PATH="$tls_certs" \
      SANCTUARY_REQUIRE_DOCKER_TLS=1 \
      SANCTUARY_STUB_DOCKER_MODE=ready \
      SANCTUARY_STUB_DOCKER_COUNTER="$TEST_TEMP_DIR/counter" \
      SANCTUARY_DOCKER_WAIT_SECONDS=0 \
      SANCTUARY_DOCKER_WAIT_INTERVAL_SECONDS=0 \
      bash "$SCRIPT" >/dev/null 2>&1; then
      fail "expected missing $missing_cert to fail closed"
    fi
    mv "$tls_certs/$missing_cert.missing" "$tls_certs/$missing_cert"
  done

  for malformed_env in \
    'SANCTUARY_REQUIRE_DOCKER_TLS=maybe' \
    'DOCKER_HOST=tcp://docker-in-docker:2375' \
    'DOCKER_TLS_VERIFY=0'; do
    if env PATH="$TEST_TEMP_DIR/bin:$PATH" \
      DOCKER_HOST=tcp://docker-in-docker:2376 \
      DOCKER_TLS_VERIFY=1 \
      DOCKER_CERT_PATH="$tls_certs" \
      SANCTUARY_REQUIRE_DOCKER_TLS=1 \
      SANCTUARY_STUB_DOCKER_MODE=ready \
      SANCTUARY_STUB_DOCKER_COUNTER="$TEST_TEMP_DIR/counter" \
      SANCTUARY_DOCKER_WAIT_SECONDS=0 \
      SANCTUARY_DOCKER_WAIT_INTERVAL_SECONDS=0 \
      "$malformed_env" bash "$SCRIPT" >/dev/null 2>&1; then
      fail "expected malformed TLS setting $malformed_env to fail"
    fi
  done

  : > "$TEST_TEMP_DIR/counter"
  : > "$TEST_TEMP_DIR/probes"
  if PATH="$TEST_TEMP_DIR/bin:$PATH" \
    DOCKER_HOST=tcp://docker-in-docker:2376 \
    DOCKER_TLS_VERIFY=1 \
    DOCKER_CERT_PATH="$tls_certs" \
    SANCTUARY_REQUIRE_DOCKER_TLS=1 \
    SANCTUARY_STUB_DOCKER_MODE=down \
    SANCTUARY_STUB_DOCKER_COUNTER="$TEST_TEMP_DIR/counter" \
    SANCTUARY_STUB_DOCKER_PROBES="$TEST_TEMP_DIR/probes" \
    SANCTUARY_DOCKER_WAIT_SECONDS=0 \
    SANCTUARY_DOCKER_WAIT_INTERVAL_SECONDS=0 \
    bash "$SCRIPT" >/dev/null 2>&1; then
    fail 'expected unavailable TLS Docker endpoint to fail closed'
  fi
  [ "$(sort -u "$TEST_TEMP_DIR/probes")" = "tcp://docker-in-docker:2376|1|$tls_certs" ] ||
    fail 'expected TLS-required mode to avoid plaintext and default fallbacks'

  : > "$TEST_TEMP_DIR/counter"
  : > "$TEST_TEMP_DIR/probes"
  if env -u SANCTUARY_REQUIRE_DOCKER_TLS \
    PATH="$TEST_TEMP_DIR/bin:$PATH" \
    DOCKER_HOST=tcp://docker-in-docker:2376 \
    DOCKER_TLS_VERIFY=1 \
    DOCKER_CERT_PATH="$tls_certs" \
    SANCTUARY_STUB_DOCKER_MODE=tls-down \
    SANCTUARY_STUB_DOCKER_COUNTER="$TEST_TEMP_DIR/counter" \
    SANCTUARY_STUB_DOCKER_PROBES="$TEST_TEMP_DIR/probes" \
    SANCTUARY_DOCKER_WAIT_SECONDS=0 \
    SANCTUARY_DOCKER_WAIT_INTERVAL_SECONDS=0 \
    bash "$SCRIPT" >/dev/null 2>&1; then
    fail 'expected configured TLS Docker endpoint to avoid fallback without the runner flag'
  fi
  [ "$(sort -u "$TEST_TEMP_DIR/probes")" = "tcp://docker-in-docker:2376|1|$tls_certs" ] ||
    fail 'expected standard Docker TLS variables to lock endpoint discovery to TLS'

  : > "$TEST_TEMP_DIR/counter"
  : > "$TEST_TEMP_DIR/probes"
  env -u SANCTUARY_REQUIRE_DOCKER_TLS \
    PATH="$TEST_TEMP_DIR/bin:$PATH" \
    DOCKER_HOST=tcp://custom-docker:4243 \
    DOCKER_TLS_VERIFY=1 \
    DOCKER_CERT_PATH="$tls_certs" \
    SANCTUARY_STUB_DOCKER_MODE=ready \
    SANCTUARY_STUB_DOCKER_COUNTER="$TEST_TEMP_DIR/counter" \
    SANCTUARY_STUB_DOCKER_PROBES="$TEST_TEMP_DIR/probes" \
    SANCTUARY_DOCKER_WAIT_SECONDS=0 \
    SANCTUARY_DOCKER_WAIT_INTERVAL_SECONDS=0 \
    bash "$SCRIPT" >/dev/null
  [ "$(sort -u "$TEST_TEMP_DIR/probes")" = "tcp://custom-docker:4243|1|$tls_certs" ] ||
    fail 'expected standard Docker TLS variables to permit a custom TCP port'

  : > "$TEST_TEMP_DIR/counter"
  : > "$TEST_TEMP_DIR/probes"
  if env -u SANCTUARY_REQUIRE_DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
    PATH="$TEST_TEMP_DIR/bin:$PATH" \
    DOCKER_HOST=tcp://docker-in-docker:2376 \
    SANCTUARY_STUB_DOCKER_MODE=ready \
    SANCTUARY_STUB_DOCKER_COUNTER="$TEST_TEMP_DIR/counter" \
    SANCTUARY_STUB_DOCKER_PROBES="$TEST_TEMP_DIR/probes" \
    SANCTUARY_DOCKER_WAIT_SECONDS=0 \
    SANCTUARY_DOCKER_WAIT_INTERVAL_SECONDS=0 \
    bash "$SCRIPT" >/dev/null 2>&1; then
    fail 'expected a host-only port 2376 configuration to fail closed'
  fi
  [ ! -s "$TEST_TEMP_DIR/probes" ] ||
    fail 'expected malformed port 2376 configuration to fail before probing fallbacks'

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
