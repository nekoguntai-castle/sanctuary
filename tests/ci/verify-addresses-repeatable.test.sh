#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/verify-addresses/verify-repeatable.sh"
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

write_stubs() {
  local bin_dir="$TEST_TEMP_DIR/bin"
  mkdir -p "$bin_dir"

  cat > "$bin_dir/node" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "-p" ] && [ "${2:-}" = "process.versions.node" ]; then
  printf '%s\n' "${VERIFY_STUB_BOOTSTRAP_VERSION:-24.18.1}"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  printf 'v%s\n' "${VERIFY_STUB_BOOTSTRAP_VERSION:-24.18.1}"
  exit 0
fi
exit 2
EOF
  chmod +x "$bin_dir/node"

  cat > "$bin_dir/go" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "env" ] && [ "${2:-}" = "GOVERSION" ] && [ "$#" -eq 2 ]; then
  printf '%s\n' "${VERIFY_STUB_GO_VERSION:-go1.25.12}"
  exit 0
fi
exit 2
EOF
  chmod +x "$bin_dir/go"

  cat > "$bin_dir/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--prefix" ] && [ "${3:-}" = "ci" ]; then
  if [ "${VERIFY_STUB_SKIP_LOCKED_NODE:-0}" = "1" ]; then
    exit 0
  fi
  mkdir -p "$2/node_modules/.bin"
  cat > "$2/node_modules/.bin/node" <<'NODEEOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "-p" ] && [ "${2:-}" = "process.versions.node" ]; then
  printf '%s\n' "${VERIFY_STUB_LOCKED_NODE_VERSION:-24.19.0}"
  exit 0
fi
if [ "${1:-}" = "-e" ]; then
  counter_file="${VERIFY_STUB_RANDOM_COUNTER:?}"
  count="$(cat "$counter_file" 2>/dev/null || echo 0)"
  count=$((count + 1))
  printf '%s\n' "$count" > "$counter_file"
  printf '%064x' "$count"
  exit 0
fi
exit 2
NODEEOF
  chmod +x "$2/node_modules/.bin/node"
  exit 0
fi

if [ "${1:-}" = "run" ] && { [ "${2:-}" = "verify" ] || [ "${2:-}" = "generate" ]; }; then
  [[ "${VERIFY_ADDRESSES_PYTHON_IMAGE_ID:?}" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
  [ "${VERIFY_ADDRESSES_PYTHON_PROVENANCE_MODE:?}" = 'local-iid' ] || exit 1
  [ "$(node -p 'process.versions.node')" = '24.19.0' ] || exit 1
  if [ -n "${VERIFY_STUB_DOCKER_STATE_DIR:-}" ]; then
    if [ -n "${VERIFY_STUB_NPM_READY_FILE:-}" ]; then
      touch "$VERIFY_STUB_NPM_READY_FILE"
    fi
    if [ -n "${VERIFY_STUB_NPM_RELEASE_FILE:-}" ]; then
      for _ in $(seq 1 500); do
        [ -e "$VERIFY_STUB_NPM_RELEASE_FILE" ] && break
        /usr/bin/sleep 0.01
      done
      [ -e "$VERIFY_STUB_NPM_RELEASE_FILE" ] || exit 96
    fi
    [ -e "$VERIFY_STUB_DOCKER_STATE_DIR/images/${VERIFY_ADDRESSES_PYTHON_IMAGE_ID#sha256:}" ] || exit 97
  fi
  {
    printf 'mainnet=%s\n' "${BITCOIN_RPC_URL_MAINNET:?}"
    printf 'testnet3=%s\n' "${BITCOIN_RPC_URL_TESTNET3:?}"
    printf 'testnet4=%s\n' "${BITCOIN_RPC_URL_TESTNET4:?}"
    printf 'signet=%s\n' "${BITCOIN_RPC_URL_SIGNET:?}"
    printf 'regtest=%s\n' "${BITCOIN_RPC_URL_REGTEST:?}"
    printf 'image=%s\n' "${VERIFY_ADDRESSES_CORE_IMAGE:?}"
    printf 'runtime_node=%s\n' "$(node -p 'process.versions.node')"
    printf 'python_image_id=%s\n' "$VERIFY_ADDRESSES_PYTHON_IMAGE_ID"
  } > "${VERIFY_STUB_ENDPOINT_LOG:?}"
  exit 0
fi

exit 2
EOF
  chmod +x "$bin_dir/npm"

  cat > "$bin_dir/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1" = "compose" ]; then
  shift
  while [ "${1:-}" = "-f" ]; do shift 2; done
  case "${1:-}" in
    up)
      printf '%s\n' "${VERIFY_ADDRESSES_CORE_IDENTITY:?}" > "${VERIFY_STUB_CORE_LAUNCH_ID:?}"
      printf '%s:%s\n' "${BITCOIN_RPC_USER:?}" "${BITCOIN_RPC_PASS:?}" > "${VERIFY_STUB_CORE_LAUNCH_AUTH:?}"
      exit 0
      ;;
    down|logs) exit 0 ;;
    ps)
      [ "${2:-}" = "-q" ] || exit 2
      printf 'fixture-%s\n' "${3:?}"
      exit 0
      ;;
  esac
fi
if [ "$1" = "build" ]; then
  touch "${VERIFY_STUB_LEGACY_BUILD_USED:?}"
  exit 98
fi
if [ "$1" = "buildx" ] && [ "${2:-}" = "version" ]; then
  [ "${VERIFY_STUB_BUILDX_UNAVAILABLE:-0}" != "1" ] || exit 1
  printf '%s\n' 'github.com/docker/buildx v0.35.0 fixture'
  exit 0
fi
if [ "$1" = "buildx" ] && [ "${2:-}" = "build" ]; then
  printf '%s\n' "$*" >> "${VERIFY_STUB_DOCKER_BUILD_LOG:?}"
  build_tag=''
  iid_file=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --tag) build_tag="$2"; shift 2 ;;
      --iidfile) iid_file="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  if [ -n "${VERIFY_STUB_DOCKER_STATE_DIR:-}" ]; then
    image_id="${VERIFY_STUB_IMAGE_ID:?}"
    tag_key="$(printf '%s' "$build_tag" | tr '/:' '__')"
    mkdir -p "$VERIFY_STUB_DOCKER_STATE_DIR/tags" "$VERIFY_STUB_DOCKER_STATE_DIR/images"
    old_image_id="$(cat "$VERIFY_STUB_DOCKER_STATE_DIR/tags/$tag_key" 2>/dev/null || true)"
    printf '%s\n' "$image_id" > "$VERIFY_STUB_DOCKER_STATE_DIR/tags/$tag_key"
    touch "$VERIFY_STUB_DOCKER_STATE_DIR/images/${image_id#sha256:}"
    if [ -n "$old_image_id" ] && [ "$old_image_id" != "$image_id" ]; then
      old_referenced=0
      for tag_file in "$VERIFY_STUB_DOCKER_STATE_DIR"/tags/*; do
        [ -e "$tag_file" ] || continue
        [ "$(cat "$tag_file")" != "$old_image_id" ] || old_referenced=1
      done
      [ "$old_referenced" -eq 1 ] || rm -f "$VERIFY_STUB_DOCKER_STATE_DIR/images/${old_image_id#sha256:}"
    fi
    printf '%s\n' "$image_id" > "$iid_file"
  else
    printf '%s\n' 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' > "$iid_file"
  fi
  [ "${VERIFY_STUB_BUILDX_FAIL_AFTER_LOAD:-0}" != "1" ] || exit 97
  exit 0
fi
if [ "$1" = "image" ] && [ "${2:-}" = "rm" ]; then
  printf '%s\n' "$*" >> "${VERIFY_STUB_DOCKER_CLEANUP_LOG:?}"
  if [ -n "${VERIFY_STUB_DOCKER_STATE_DIR:-}" ]; then
    tag_key="$(printf '%s' "$3" | tr '/:' '__')"
    image_id="$(cat "$VERIFY_STUB_DOCKER_STATE_DIR/tags/$tag_key" 2>/dev/null || true)"
    rm -f "$VERIFY_STUB_DOCKER_STATE_DIR/tags/$tag_key"
    if [ -n "$image_id" ]; then
      image_referenced=0
      for tag_file in "$VERIFY_STUB_DOCKER_STATE_DIR"/tags/*; do
        [ -e "$tag_file" ] || continue
        [ "$(cat "$tag_file")" != "$image_id" ] || image_referenced=1
      done
      [ "$image_referenced" -eq 1 ] || rm -f "$VERIFY_STUB_DOCKER_STATE_DIR/images/${image_id#sha256:}"
    fi
  fi
  exit 0
fi
if [ "$1" = "inspect" ] && [ "$2" = "--format" ]; then
  if [ "$3" = '{{.Config.Image}}' ]; then
    printf '%s\n' "${VERIFY_STUB_CORE_CONFIG_IMAGE:-bitcoin/bitcoin:29.0@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78}"
  else
    if [[ -v VERIFY_STUB_INSPECTED_CORE_IDENTITY ]]; then
      printf '["-uacomment=%s"]\n' "$VERIFY_STUB_INSPECTED_CORE_IDENTITY"
    else
      printf '["-uacomment=%s"]\n' "$(cat "${VERIFY_STUB_CORE_LAUNCH_ID:?}")"
    fi
  fi
  exit 0
fi
exit 2
EOF
  chmod +x "$bin_dir/docker"

  cat > "$bin_dir/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$bin_dir/sleep"

  cat > "$bin_dir/python3" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
touch "${VERIFY_STUB_HOST_PYTHON_USED:?}"
exit 99
EOF
  chmod +x "$bin_dir/python3"

  cat > "$bin_dir/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

url="${!#}"
printf '%s\n' "$url" >> "${VERIFY_STUB_CURL_LOG:?}"
expected_auth="$(cat "${VERIFY_STUB_CORE_LAUNCH_AUTH:?}")"
actual_auth=''
payload=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --user) actual_auth="$2"; shift 2 ;;
    --data-binary) payload="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[ "$actual_auth" = "$expected_auth" ] || exit 1
if [[ "$payload" == *getnetworkinfo* ]]; then
  if [[ "$url" == http://203.0.113.10:* ]]; then
    printf '{"result":{"subversion":"/Satoshi:29.0.0(fake-external)/"}}\n'
  else
    printf '{"result":{"subversion":"/Satoshi:29.0.0(%s)/"}}\n' "$(cat "${VERIFY_STUB_CORE_LAUNCH_ID:?}")"
  fi
  exit 0
fi
case "$url" in
  *:"${VERIFY_STUB_WRONG_CHAIN_PORT:-never}"/) printf '{"result":{"chain":"wrong"}}\n' ;;
  *:19440/) printf '{"result":{"chain":"main"}}\n' ;;
  *:19441/) printf '{"result":{"chain":"test"}}\n' ;;
  *:19442/) printf '{"result":{"chain":"testnet4"}}\n' ;;
  *:19443/) printf '{"result":{"chain":"signet"}}\n' ;;
  *:19444/) printf '{"result":{"chain":"regtest"}}\n' ;;
  *) exit 1 ;;
esac
EOF
  chmod +x "$bin_dir/curl"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  local fixture_root="$TEST_TEMP_DIR/repo"
  mkdir -p "$fixture_root/scripts/verify-addresses/implementations" "$fixture_root/scripts/ci"
  cp "$SCRIPT" "$fixture_root/scripts/verify-addresses/verify-repeatable.sh"
  cp "$ROOT_DIR/scripts/ci/docker-endpoint-lib.sh" "$fixture_root/scripts/ci/docker-endpoint-lib.sh"
  cp "$ROOT_DIR/scripts/verify-addresses/implementations/go.mod" \
    "$fixture_root/scripts/verify-addresses/implementations/go.mod"
  cp "$ROOT_DIR/scripts/verify-addresses/implementations/go.sum" \
    "$fixture_root/scripts/verify-addresses/implementations/go.sum"
  SCRIPT="$fixture_root/scripts/verify-addresses/verify-repeatable.sh"
  bash -n "$SCRIPT"
  write_stubs
  mkdir -p "$TEST_TEMP_DIR/runner"
  : > "$TEST_TEMP_DIR/random-counter"
  : > "$TEST_TEMP_DIR/core-launch-id"
  : > "$TEST_TEMP_DIR/core-launch-auth"

  run_with_core_image() {
    local inspected_image="$1"
    local endpoint_log="$2"
    PATH="$TEST_TEMP_DIR/bin:$PATH" \
      RUNNER_TEMP="$TEST_TEMP_DIR/runner" \
      VERIFY_STUB_CORE_CONFIG_IMAGE="$inspected_image" \
      VERIFY_STUB_DOCKER_BUILD_LOG="$TEST_TEMP_DIR/docker-build-log" \
      VERIFY_STUB_DOCKER_CLEANUP_LOG="$TEST_TEMP_DIR/docker-cleanup-log" \
      VERIFY_STUB_LEGACY_BUILD_USED="$TEST_TEMP_DIR/legacy-build-used" \
      VERIFY_STUB_CORE_LAUNCH_ID="$TEST_TEMP_DIR/core-launch-id" \
      VERIFY_STUB_CORE_LAUNCH_AUTH="$TEST_TEMP_DIR/core-launch-auth" \
      VERIFY_STUB_HOST_PYTHON_USED="$TEST_TEMP_DIR/host-python-used" \
      VERIFY_STUB_RANDOM_COUNTER="$TEST_TEMP_DIR/random-counter" \
      VERIFY_STUB_ENDPOINT_LOG="$endpoint_log" \
      VERIFY_STUB_CURL_LOG="$TEST_TEMP_DIR/curl-log" \
      bash "$SCRIPT" verify
  }

  run_overlapping_verifier() {
    local lane="$1"
    local image_id="$2"
    local ready_file="$3"
    local release_file="$4"
    local lane_root="$TEST_TEMP_DIR/overlap-$lane"
    mkdir -p "$lane_root"
    if [ "$lane" = a ]; then printf '0\n' > "$lane_root/random-counter"; else printf '2\n' > "$lane_root/random-counter"; fi
    : > "$lane_root/core-launch-id"
    : > "$lane_root/core-launch-auth"
    : > "$lane_root/curl-log"
    : > "$lane_root/docker-build-log"
    : > "$lane_root/docker-cleanup-log"
    PATH="$TEST_TEMP_DIR/bin:$PATH" \
      RUNNER_TEMP="$TEST_TEMP_DIR/runner" \
      VERIFY_STUB_CORE_CONFIG_IMAGE='docker.io/bitcoin/bitcoin@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78' \
      VERIFY_STUB_DOCKER_BUILD_LOG="$lane_root/docker-build-log" \
      VERIFY_STUB_DOCKER_CLEANUP_LOG="$lane_root/docker-cleanup-log" \
      VERIFY_STUB_LEGACY_BUILD_USED="$lane_root/legacy-build-used" \
      VERIFY_STUB_CORE_LAUNCH_ID="$lane_root/core-launch-id" \
      VERIFY_STUB_CORE_LAUNCH_AUTH="$lane_root/core-launch-auth" \
      VERIFY_STUB_HOST_PYTHON_USED="$lane_root/host-python-used" \
      VERIFY_STUB_RANDOM_COUNTER="$lane_root/random-counter" \
      VERIFY_STUB_ENDPOINT_LOG="$lane_root/endpoint-log" \
      VERIFY_STUB_CURL_LOG="$lane_root/curl-log" \
      VERIFY_STUB_DOCKER_STATE_DIR="$TEST_TEMP_DIR/docker-state" \
      VERIFY_STUB_IMAGE_ID="$image_id" \
      VERIFY_STUB_NPM_READY_FILE="$ready_file" \
      VERIFY_STUB_NPM_RELEASE_FILE="$release_file" \
      bash "$SCRIPT" verify
  }

  : > "$TEST_TEMP_DIR/curl-log"
  : > "$TEST_TEMP_DIR/docker-build-log"
  : > "$TEST_TEMP_DIR/docker-cleanup-log"
  PATH="$TEST_TEMP_DIR/bin:$PATH" \
    DOCKER_BUILDKIT=0 \
    RUNNER_TEMP="$TEST_TEMP_DIR/runner" \
    VERIFY_STUB_DOCKER_BUILD_LOG="$TEST_TEMP_DIR/docker-build-log" \
    VERIFY_STUB_DOCKER_CLEANUP_LOG="$TEST_TEMP_DIR/docker-cleanup-log" \
    VERIFY_STUB_LEGACY_BUILD_USED="$TEST_TEMP_DIR/legacy-build-used" \
    VERIFY_STUB_CORE_LAUNCH_ID="$TEST_TEMP_DIR/core-launch-id" \
    VERIFY_STUB_CORE_LAUNCH_AUTH="$TEST_TEMP_DIR/core-launch-auth" \
    VERIFY_STUB_HOST_PYTHON_USED="$TEST_TEMP_DIR/host-python-used" \
    VERIFY_STUB_RANDOM_COUNTER="$TEST_TEMP_DIR/random-counter" \
    VERIFY_STUB_ENDPOINT_LOG="$TEST_TEMP_DIR/endpoint-log" \
    VERIFY_STUB_CURL_LOG="$TEST_TEMP_DIR/curl-log" \
    bash "$SCRIPT" verify >/dev/null

  [ ! -e "$TEST_TEMP_DIR/host-python-used" ] ||
    fail 'expected Python verification to be isolated from the host interpreter'
  grep -F -- 'buildx build --pull' "$TEST_TEMP_DIR/docker-build-log" >/dev/null ||
    fail 'expected the Python verifier image build to use explicit Buildx and refresh its pinned base'
  [ ! -e "$TEST_TEMP_DIR/legacy-build-used" ] ||
    fail 'expected DOCKER_BUILDKIT=0 to leave the explicit Buildx path unchanged'
  grep -F -- '--load' "$TEST_TEMP_DIR/docker-build-log" >/dev/null ||
    fail 'expected the Python verifier image build to load its IID into the local engine'
  grep -F -- "--file $fixture_root/scripts/verify-addresses/python-verifier.Dockerfile" \
    "$TEST_TEMP_DIR/docker-build-log" >/dev/null ||
    fail 'expected the Python verifier build to use its committed Dockerfile'
  verifier_identity="$(cat "$TEST_TEMP_DIR/core-launch-id")"
  verifier_tag="sanctuary/verify-addresses-python:3.13.5-bip-utils-2.12.1-v1-${verifier_identity#sanctuary-verify-}"
  grep -F -- "--tag $verifier_tag" "$TEST_TEMP_DIR/docker-build-log" >/dev/null ||
    fail 'expected a unique per-run Python verifier tag to retain the immutable image'
  [ "$(cat "$TEST_TEMP_DIR/docker-cleanup-log")" = "image rm $verifier_tag" ] ||
    fail 'expected cleanup to remove only the unique per-run Python verifier tag'
  grep -F -- '--iidfile' "$TEST_TEMP_DIR/docker-build-log" >/dev/null ||
    fail 'expected the Python verifier build to capture its immutable image ID'

  [ "$(wc -l < "$TEST_TEMP_DIR/curl-log")" = "10" ] ||
    fail 'expected chain and identity checks for all five Core environments'
  for port in 19440 19441 19442 19443 19444; do
    grep -F -- ":$port/" "$TEST_TEMP_DIR/curl-log" >/dev/null ||
      fail "expected readiness check on port $port"
  done
  grep -F -- 'image=bitcoin/bitcoin:29.0@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78' \
    "$TEST_TEMP_DIR/endpoint-log" >/dev/null ||
    fail 'expected the exact Core image provenance to reach the verifier'
  grep -F -- 'runtime_node=24.19.0' "$TEST_TEMP_DIR/endpoint-log" >/dev/null ||
    fail 'expected Node 24 bootstrap to hand off to locked verifier Node 24.19.0'
  grep -F -- 'python_image_id=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' \
    "$TEST_TEMP_DIR/endpoint-log" >/dev/null ||
    fail 'expected the immutable Python image ID to reach the verifier'
  [[ "$(cut -d: -f1 "$TEST_TEMP_DIR/core-launch-auth")" == verify_* ]] ||
    fail 'expected internally generated Core RPC credentials'
  grep -E '^sanctuary-verify-[0-9a-f]{64}$' "$TEST_TEMP_DIR/core-launch-id" >/dev/null ||
    fail 'expected a separate per-run Core identity nonce'

  : > "$TEST_TEMP_DIR/curl-log"
  canonical_image='docker.io/bitcoin/bitcoin@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78'
  run_with_core_image "$canonical_image" "$TEST_TEMP_DIR/canonical-endpoint-log" >/dev/null
  [ -s "$TEST_TEMP_DIR/canonical-endpoint-log" ] ||
    fail 'expected Docker Hub canonical image rendering to be accepted'
  second_verifier_identity="$(cat "$TEST_TEMP_DIR/core-launch-id")"
  second_verifier_tag="sanctuary/verify-addresses-python:3.13.5-bip-utils-2.12.1-v1-${second_verifier_identity#sanctuary-verify-}"
  [ "$second_verifier_tag" != "$verifier_tag" ] ||
    fail 'expected consecutive verifier runs to use distinct retention tags'
  grep -F -- "--tag $second_verifier_tag" "$TEST_TEMP_DIR/docker-build-log" >/dev/null ||
    fail 'expected the second verifier build to use its own retention tag'
  [ "$(grep -Fxc -- "image rm $verifier_tag" "$TEST_TEMP_DIR/docker-cleanup-log")" = 1 ] ||
    fail 'expected the first verifier run to remove its own tag exactly once'
  [ "$(grep -Fxc -- "image rm $second_verifier_tag" "$TEST_TEMP_DIR/docker-cleanup-log")" = 1 ] ||
    fail 'expected the second verifier run to remove its own tag exactly once'

  : > "$TEST_TEMP_DIR/docker-cleanup-log"
  if VERIFY_STUB_BUILDX_FAIL_AFTER_LOAD=1 \
    run_with_core_image "$canonical_image" "$TEST_TEMP_DIR/failed-buildx-endpoint-log" >/dev/null 2>&1; then
    fail 'expected the interrupted Buildx fixture to fail'
  fi
  interrupted_cleanup="$(cat "$TEST_TEMP_DIR/docker-cleanup-log")"
  [[ "$interrupted_cleanup" =~ ^image\ rm\ sanctuary/verify-addresses-python:3\.13\.5-bip-utils-2\.12\.1-v1-[0-9a-f]{64}$ ]] ||
    fail 'expected an interrupted Buildx load to release its unique retention tag'
  [ "$interrupted_cleanup" != "image rm $second_verifier_tag" ] ||
    fail 'expected interrupted cleanup not to remove another invocation tag'

  mkdir -p "$TEST_TEMP_DIR/docker-state"
  overlap_ready="$TEST_TEMP_DIR/overlap-a-ready"
  overlap_release="$TEST_TEMP_DIR/overlap-a-release"
  run_overlapping_verifier a \
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
    "$overlap_ready" "$overlap_release" >"$TEST_TEMP_DIR/overlap-a.log" 2>&1 &
  overlap_a_pid=$!
  for _ in $(seq 1 500); do
    [ -e "$overlap_ready" ] && break
    /usr/bin/sleep 0.01
  done
  if [ ! -e "$overlap_ready" ]; then
    touch "$overlap_release"
    wait "$overlap_a_pid" || true
    fail 'expected the first overlapping verifier to pause after loading its image'
  fi
  if ! run_overlapping_verifier b \
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' \
    '' '' >"$TEST_TEMP_DIR/overlap-b.log" 2>&1; then
    touch "$overlap_release"
    wait "$overlap_a_pid" || true
    fail 'expected the second overlapping verifier to retain and execute its own image'
  fi
  touch "$overlap_release"
  if ! wait "$overlap_a_pid"; then
    fail 'expected the first verifier image to remain reachable while the second invocation retargeted and cleaned up'
  fi
  [ -z "$(find "$TEST_TEMP_DIR/docker-state/tags" -type f -print -quit)" ] ||
    fail 'expected overlapping verifier cleanup to leave no owned retention tags'
  [ -z "$(find "$TEST_TEMP_DIR/docker-state/images" -type f -print -quit)" ] ||
    fail 'expected overlapping verifier cleanup to release both uniquely retained images'

  if failure_output="$(VERIFY_STUB_BUILDX_UNAVAILABLE=1 \
    run_with_core_image "$canonical_image" "$TEST_TEMP_DIR/no-buildx-endpoint-log" 2>&1)"; then
    fail 'expected missing Docker Buildx to fail closed'
  fi
  grep -F -- 'Docker Buildx is required for immutable verifier image loading:' <<<"$failure_output" >/dev/null ||
    fail 'expected missing Buildx to report the immutable-image requirement'

  for rejected_image in \
    'docker.io/example/bitcoin@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78' \
    'bitcoin/bitcoin:28.0@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78' \
    'docker.io/bitcoin/bitcoin@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; do
    if failure_output="$(run_with_core_image "$rejected_image" "$TEST_TEMP_DIR/rejected-endpoint-log" 2>&1)"; then
      fail "expected Core image identity rejection for $rejected_image"
    fi
    grep -F -- "uses $rejected_image" <<<"$failure_output" >/dev/null ||
      fail "expected exact rejected Core image identity in failure for $rejected_image"
  done

  for rejected_identity in '' 'sanctuary-verify-wrong'; do
    if failure_output="$(VERIFY_STUB_INSPECTED_CORE_IDENTITY="$rejected_identity" \
      run_with_core_image "$canonical_image" "$TEST_TEMP_DIR/rejected-identity-log" 2>&1)"; then
      fail 'expected missing or wrong inspected Core identity to fail closed'
    fi
    grep -F -- 'missing the per-run identity binding' <<<"$failure_output" >/dev/null ||
      fail 'expected exact container identity rejection cause'
  done

  if failure_output="$(PATH="$TEST_TEMP_DIR/bin:$PATH" \
    RUNNER_TEMP="$TEST_TEMP_DIR/runner" \
    VERIFY_STUB_BOOTSTRAP_VERSION=23.11.0 \
    bash "$SCRIPT" verify 2>&1)"; then
    fail 'expected a non-24 bootstrap Node runtime to fail closed'
  fi
  grep -F -- 'Bootstrap Node runtime is 23.11.0, expected major 24' <<<"$failure_output" >/dev/null ||
    fail 'expected the non-24 bootstrap guard to report its exact cause'
  if failure_output="$(PATH="$TEST_TEMP_DIR/bin:$PATH" \
    RUNNER_TEMP="$TEST_TEMP_DIR/runner" \
    VERIFY_STUB_GO_VERSION=go1.25.11 \
    bash "$SCRIPT" verify 2>&1)"; then
    fail 'expected a wrong Go runtime version to fail closed'
  fi
  grep -F -- 'Go runtime is go1.25.11, expected go1.25.12' <<<"$failure_output" >/dev/null ||
    fail 'expected the wrong Go runtime guard to report its exact cause'
  mv "$fixture_root/scripts/verify-addresses/node_modules/.bin/node" \
    "$fixture_root/scripts/verify-addresses/node.modules-node.saved"
  if failure_output="$(PATH="$TEST_TEMP_DIR/bin:$PATH" \
    RUNNER_TEMP="$TEST_TEMP_DIR/runner" \
    VERIFY_STUB_SKIP_LOCKED_NODE=1 \
    bash "$SCRIPT" verify 2>&1)"; then
    fail 'expected a missing locked verifier Node runtime to fail closed'
  fi
  grep -F -- 'Locked verifier Node runtime is missing:' <<<"$failure_output" >/dev/null ||
    fail 'expected the missing locked runtime guard to report its exact cause'
  if failure_output="$(PATH="$TEST_TEMP_DIR/bin:$PATH" \
    RUNNER_TEMP="$TEST_TEMP_DIR/runner" \
    VERIFY_STUB_LOCKED_NODE_VERSION=24.18.1 \
    VERIFY_ADDRESSES_LOCKED_NODE_BIN="$TEST_TEMP_DIR/bin/node" \
    bash "$SCRIPT" verify 2>&1)"; then
    fail 'expected a wrong locked verifier Node version to fail closed'
  fi
  grep -F -- 'Locked verifier Node runtime does not match 24.19.0' <<<"$failure_output" >/dev/null ||
    fail 'expected the wrong locked runtime guard to report its exact cause'

  : > "$TEST_TEMP_DIR/curl-log"
  if PATH="$TEST_TEMP_DIR/bin:$PATH" \
    RUNNER_TEMP="$TEST_TEMP_DIR/runner" \
    VERIFY_STUB_DOCKER_BUILD_LOG="$TEST_TEMP_DIR/docker-build-log" \
    VERIFY_STUB_CORE_LAUNCH_ID="$TEST_TEMP_DIR/core-launch-id" \
    VERIFY_STUB_CORE_LAUNCH_AUTH="$TEST_TEMP_DIR/core-launch-auth" \
    VERIFY_STUB_HOST_PYTHON_USED="$TEST_TEMP_DIR/host-python-used" \
    VERIFY_STUB_RANDOM_COUNTER="$TEST_TEMP_DIR/random-counter" \
    VERIFY_STUB_ENDPOINT_LOG="$TEST_TEMP_DIR/should-not-exist" \
    VERIFY_STUB_CURL_LOG="$TEST_TEMP_DIR/curl-log" \
    VERIFY_STUB_WRONG_CHAIN_PORT=19442 \
    bash "$SCRIPT" verify >/dev/null 2>&1; then
    fail 'expected a wrong Core chain to fail closed'
  fi
  [ ! -e "$TEST_TEMP_DIR/should-not-exist" ] ||
    fail 'expected wrong-chain rejection before vector generation'

  : > "$TEST_TEMP_DIR/curl-log"
  if failure_output="$(PATH="$TEST_TEMP_DIR/bin:$PATH" \
    RUNNER_TEMP="$TEST_TEMP_DIR/runner" \
    SANCTUARY_DOCKER_PUBLISHED_HOST=203.0.113.10 \
    VERIFY_STUB_DOCKER_BUILD_LOG="$TEST_TEMP_DIR/docker-build-log" \
    VERIFY_STUB_CORE_LAUNCH_ID="$TEST_TEMP_DIR/core-launch-id" \
    VERIFY_STUB_CORE_LAUNCH_AUTH="$TEST_TEMP_DIR/core-launch-auth" \
    VERIFY_STUB_HOST_PYTHON_USED="$TEST_TEMP_DIR/host-python-used" \
    VERIFY_STUB_RANDOM_COUNTER="$TEST_TEMP_DIR/random-counter" \
    VERIFY_STUB_ENDPOINT_LOG="$TEST_TEMP_DIR/external-endpoint-log" \
    VERIFY_STUB_CURL_LOG="$TEST_TEMP_DIR/curl-log" \
    bash "$SCRIPT" verify 2>&1)"; then
    fail 'expected an external published-host target without the private run identity to fail'
  fi
  grep -F -- 'did not return this run identity' <<<"$failure_output" >/dev/null ||
    fail 'expected external endpoint rejection to identify the private nonce mismatch'
  [ ! -e "$TEST_TEMP_DIR/external-endpoint-log" ] ||
    fail 'expected external target rejection before vector generation'

  for rejected_override in \
    VERIFY_ADDRESSES_SKIP_DOCKER VERIFY_ADDRESSES_SKIP_NPM_CI \
    VERIFY_ADDRESSES_CORE_IDENTITY \
    BITCOIN_RPC_USER BITCOIN_RPC_PASS \
    BITCOIN_RPC_PORT_MAINNET BITCOIN_RPC_PORT_TESTNET3 BITCOIN_RPC_PORT_TESTNET4 \
    BITCOIN_RPC_PORT_SIGNET BITCOIN_RPC_PORT_REGTEST \
    BITCOIN_RPC_URL_MAINNET BITCOIN_RPC_URL_TESTNET3 BITCOIN_RPC_URL_TESTNET4 \
    BITCOIN_RPC_URL_SIGNET BITCOIN_RPC_URL_REGTEST; do
    if env PATH="$TEST_TEMP_DIR/bin:$PATH" "$rejected_override=caller" \
      bash "$SCRIPT" verify >/dev/null 2>&1; then
      fail "expected caller override $rejected_override to be rejected"
    fi
  done

  echo 'verify-addresses repeatable helper checks passed'
}

main "$@"
