#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

readonly proof_manifest='config/trezor-emulator-proof.json'
jq -e '
  .schemaVersion == 3
  and (.image | test("^ghcr\\.io/trezor/trezor-user-env@sha256:[0-9a-f]{64}$"))
  and (.imageDigest | test("^sha256:[0-9a-f]{64}$"))
  and (.imageIndexDigest | test("^sha256:[0-9a-f]{64}$"))
  and (.imageConfigDigest | test("^sha256:[0-9a-f]{64}$"))
  and .image == ("ghcr.io/trezor/trezor-user-env@" + .imageDigest)
  and .imageDigest != .imageIndexDigest
  and .platform == "linux/amd64"
  and (.connectIntegrity | test("^sha512-[A-Za-z0-9+/]+={0,2}$"))
  and (.connectWebIntegrity | test("^sha512-[A-Za-z0-9+/]+={0,2}$"))
  and (.runtimeCompatibility.node | test("^[0-9]+[.][0-9]+[.][0-9]+$"))
  and (.runtimeCompatibility.npm | test("^[0-9]+[.][0-9]+[.][0-9]+$"))
  and (.runtimeCompatibility.runnerOs | type == "string" and length > 0)
  and (.runtimeCompatibility.runnerArchitecture | type == "string" and length > 0)
  and (.runtimeCompatibility.dockerClientMinimumApiVersion | test("^[0-9]+[.][0-9]+$"))
  and (.runtimeCompatibility.dockerServerMinimumApiVersion | test("^[0-9]+[.][0-9]+$"))
  and (.runtimeCompatibility.dockerServerOs | type == "string" and length > 0)
  and (.runtimeCompatibility.dockerServerArchitecture | type == "string" and length > 0)
  and ([.model, .firmware, .bridge, .connect] | all(type == "string" and length > 0))
' "$proof_manifest" >/dev/null
readonly TREZOR_IMAGE="$(jq -r '.image' "$proof_manifest")"
readonly TREZOR_IMAGE_DIGEST="$(jq -r '.imageDigest' "$proof_manifest")"
readonly TREZOR_IMAGE_INDEX_DIGEST="$(jq -r '.imageIndexDigest' "$proof_manifest")"
readonly TREZOR_IMAGE_CONFIG_DIGEST="$(jq -r '.imageConfigDigest' "$proof_manifest")"
readonly TREZOR_PLATFORM="$(jq -r '.platform' "$proof_manifest")"
readonly TREZOR_MODEL="$(jq -r '.model' "$proof_manifest")"
readonly TREZOR_FIRMWARE="$(jq -r '.firmware' "$proof_manifest")"
readonly TREZOR_BRIDGE="$(jq -r '.bridge' "$proof_manifest")"
readonly TREZOR_CONNECT="$(jq -r '.connect' "$proof_manifest")"
readonly TREZOR_CONNECT_INTEGRITY="$(jq -r '.connectIntegrity' "$proof_manifest")"
readonly TREZOR_CONNECT_WEB_INTEGRITY="$(jq -r '.connectWebIntegrity' "$proof_manifest")"
readonly EXPECTED_NODE="$(jq -r '.runtimeCompatibility.node' "$proof_manifest")"
readonly EXPECTED_NPM="$(jq -r '.runtimeCompatibility.npm' "$proof_manifest")"
readonly EXPECTED_RUNNER_OS="$(jq -r '.runtimeCompatibility.runnerOs' "$proof_manifest")"
readonly EXPECTED_RUNNER_ARCH="$(jq -r '.runtimeCompatibility.runnerArchitecture' "$proof_manifest")"
readonly MIN_DOCKER_CLIENT_API="$(jq -r '.runtimeCompatibility.dockerClientMinimumApiVersion' "$proof_manifest")"
readonly MIN_DOCKER_SERVER_API="$(jq -r '.runtimeCompatibility.dockerServerMinimumApiVersion' "$proof_manifest")"
readonly EXPECTED_DOCKER_SERVER_OS="$(jq -r '.runtimeCompatibility.dockerServerOs' "$proof_manifest")"
readonly EXPECTED_DOCKER_SERVER_ARCH="$(jq -r '.runtimeCompatibility.dockerServerArchitecture' "$proof_manifest")"
readonly run_id="$(ci_run_id)"
readonly run_attempt="${SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE:-0}"
readonly run_identity="${run_id}-${run_attempt}"
readonly container_name="sanctuary-trezor-proof-${run_identity}"
readonly evidence_root="$(ci_workspace)/.tmp/ci-evidence/trezor-emulator"
readonly attempt_dir="${evidence_root}/${run_identity}"
readonly proof_dir="${attempt_dir}/proof"
readonly diagnostics_dir="${attempt_dir}/diagnostics"
readonly docker_metadata_timeout_seconds=60
readonly docker_start_timeout_seconds=180
readonly docker_pull_timeout_seconds=2100
container_started=0
forwarder_pid=0
published_host=''
controller_port=''
bridge_port=''
trezor_transport='published-port'

api_version_at_least() {
  local actual="$1"
  local minimum="$2"
  local actual_major actual_minor minimum_major minimum_minor
  IFS=. read -r actual_major actual_minor <<< "$actual"
  IFS=. read -r minimum_major minimum_minor <<< "$minimum"
  ((actual_major > minimum_major || (actual_major == minimum_major && actual_minor >= minimum_minor)))
}

case "$container_name" in
  sanctuary-trezor-proof-[A-Za-z0-9._-]*) ;;
  *) echo "Unsafe Trezor proof container name: $container_name" >&2; exit 1 ;;
esac

readonly actual_node="$(node --version | sed 's/^v//')"
readonly actual_npm="$(npm --version)"
readonly nvmrc_node="$(tr -d '[:space:]' < .nvmrc)"
readonly package_manager="$(jq -r '.packageManager' package.json)"
readonly runner_os="$(uname -s)"
readonly runner_arch="$(uname -m)"
if [ "$EXPECTED_NODE" != "$nvmrc_node" ] || [ "$actual_node" != "$EXPECTED_NODE" ]; then
  echo "Trezor proof Node drift: manifest=$EXPECTED_NODE .nvmrc=$nvmrc_node actual=$actual_node" >&2
  exit 1
fi
if [ "$package_manager" != "npm@$EXPECTED_NPM" ] || [ "$actual_npm" != "$EXPECTED_NPM" ]; then
  echo "Trezor proof npm drift: manifest=$EXPECTED_NPM packageManager=$package_manager actual=$actual_npm" >&2
  exit 1
fi
if [ "$runner_os" != "$EXPECTED_RUNNER_OS" ] || [ "$runner_arch" != "$EXPECTED_RUNNER_ARCH" ]; then
  echo "Unsupported Trezor proof runner: expected $EXPECTED_RUNNER_OS/$EXPECTED_RUNNER_ARCH, received $runner_os/$runner_arch" >&2
  exit 1
fi

cleanup() {
  local status=$?
  if [ -f "$diagnostics_dir/junit-trezor-emulator.xml" ]; then
    sed -i \
      -e 's/all all all all all all all all all all all all/[REDACTED TEST MNEMONIC]/g' \
      -e 's/ hostname="[^"]*"/ hostname="[REDACTED RUNNER]"/g' \
      "$diagnostics_dir/junit-trezor-emulator.xml"
  fi
  jq -n --argjson exitCode "$status" '{exitCode: $exitCode}' > "$diagnostics_dir/run-status.json"
  if [ "$forwarder_pid" -ne 0 ]; then
    kill "$forwarder_pid" >/dev/null 2>&1 || true
    for _ in $(seq 1 50); do
      if ! kill -0 "$forwarder_pid" >/dev/null 2>&1; then
        break
      fi
      sleep 0.1
    done
    if kill -0 "$forwarder_pid" >/dev/null 2>&1; then
      kill -KILL "$forwarder_pid" >/dev/null 2>&1 || true
    fi
    wait "$forwarder_pid" >/dev/null 2>&1 || true
  fi
  if [ "$container_started" -eq 1 ]; then
    timeout --foreground --kill-after=10s 30s docker logs "$container_name" 2>&1 \
      | sed 's/all all all all all all all all all all all all/[REDACTED TEST MNEMONIC]/g' \
      > "$diagnostics_dir/trezor-user-env.log" || true
    timeout --foreground --kill-after=10s 30s \
      docker stop --timeout 10 "$container_name" >/dev/null || true
  fi
  return "$status"
}

run_bounded_docker() {
  local label="$1"
  local timeout_seconds="$2"
  shift 2
  echo "Starting bounded Trezor Docker operation: $label (${timeout_seconds}s)" >&2
  if timeout --foreground --kill-after=10s "${timeout_seconds}s" docker "$@"; then
    echo "Completed bounded Trezor Docker operation: $label" >&2
    return 0
  else
    local status=$?
    echo "Trezor Docker operation failed: $label (exit=$status)" >&2
    return "$status"
  fi
}

controller_command() {
  local payload="$1"
  run_bounded_docker "Trezor controller request" 30 \
    exec -e TREZOR_CONTROLLER_PAYLOAD="$payload" "$container_name" \
    .venv/bin/python -c '
import asyncio
import json
import os
import websockets

async def main():
    payload = json.loads(os.environ["TREZOR_CONTROLLER_PAYLOAD"])
    async with websockets.connect("ws://127.0.0.1:9001") as websocket:
        await websocket.recv()
        await websocket.send(json.dumps(payload))
        response = json.loads(await websocket.recv())
        print(json.dumps(response, sort_keys=True))
        if response.get("id") != payload.get("id"):
            raise SystemExit(1)
        if not response.get("success"):
            raise SystemExit(1)

asyncio.run(main())
'
}

trezor_image_is_attested() {
  local inspect_json="$1"
  local image_id image_platform
  if ! jq -e --arg image "$TREZOR_IMAGE" \
    'length == 1 and ((.[0].RepoDigests // []) | index($image) != null)' \
    <<< "$inspect_json" >/dev/null; then
    echo "Trezor User Env image does not attest $TREZOR_IMAGE_DIGEST" >&2
    return 1
  fi
  image_id="$(jq -er '.[0].Id' <<< "$inspect_json")"
  if [ "$image_id" != "$TREZOR_IMAGE_CONFIG_DIGEST" ]; then
    echo "Trezor User Env config drift: expected $TREZOR_IMAGE_CONFIG_DIGEST, received $image_id" >&2
    return 1
  fi
  image_platform="$(jq -er '.[0].Os + "/" + .[0].Architecture' <<< "$inspect_json")"
  if [ "$image_platform" != "$TREZOR_PLATFORM" ]; then
    echo "Trezor User Env platform drift: expected $TREZOR_PLATFORM, received $image_platform" >&2
    return 1
  fi
}

if [ -n "${DOCKER_HOST:-}" ]; then
  docker_endpoint="$DOCKER_HOST"
else
  docker_endpoint="$(
    docker context inspect --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null \
      || printf '%s' 'unix:///var/run/docker.sock'
  )"
fi
readonly docker_endpoint
readonly docker_version_json="$(docker version --format '{{json .}}')"
readonly docker_runtime_json="$(
  jq -ce '
    {client: {version: .Client.Version, apiVersion: .Client.ApiVersion,
              os: .Client.Os, architecture: .Client.Arch},
     server: {version: .Server.Version, apiVersion: .Server.ApiVersion,
              minimumApiVersion: .Server.MinAPIVersion, os: .Server.Os,
              architecture: .Server.Arch,
              platformName: (.Server.Platform.Name // ""),
              componentNames: [(.Server.Components // [])[].Name]}}
    | select([
        .client.version, .client.apiVersion, .client.os, .client.architecture,
        .server.version, .server.apiVersion, .server.minimumApiVersion,
        .server.os, .server.architecture
      ] | all(type == "string" and length > 0))
  ' <<< "$docker_version_json"
)"
readonly docker_client_api="$(jq -r '.client.apiVersion' <<< "$docker_runtime_json")"
readonly docker_server_api="$(jq -r '.server.apiVersion' <<< "$docker_runtime_json")"
readonly docker_server_os="$(jq -r '.server.os' <<< "$docker_runtime_json")"
readonly docker_server_arch="$(jq -r '.server.architecture' <<< "$docker_runtime_json")"
readonly docker_is_podman="$(
  jq -r '.server.componentNames | any(. == "Podman Engine")' <<< "$docker_runtime_json"
)"
if ! [[ "$docker_client_api" =~ ^[0-9]+[.][0-9]+$ && "$docker_server_api" =~ ^[0-9]+[.][0-9]+$ ]]; then
  echo 'Docker API versions are not numeric major.minor values' >&2
  exit 1
fi
if ! api_version_at_least "$docker_client_api" "$MIN_DOCKER_CLIENT_API" \
  || ! api_version_at_least "$docker_server_api" "$MIN_DOCKER_SERVER_API"; then
  echo "Unsupported Docker APIs: client=$docker_client_api server=$docker_server_api" >&2
  exit 1
fi
if [ "$docker_server_os" != "$EXPECTED_DOCKER_SERVER_OS" ] \
  || [ "$docker_server_arch" != "$EXPECTED_DOCKER_SERVER_ARCH" ]; then
  echo "Unsupported Docker server: expected $EXPECTED_DOCKER_SERVER_OS/$EXPECTED_DOCKER_SERVER_ARCH, received $docker_server_os/$docker_server_arch" >&2
  exit 1
fi
case "$docker_endpoint" in
  unix://*|npipe://*|tcp://127.0.0.1:*|tcp://localhost:*) ;;
  *)
    if [ -z "${SANCTUARY_DOCKER_PUBLISHED_HOST:-}" ] \
      || [ "${SANCTUARY_TREZOR_ALLOW_REMOTE_DOCKER:-0}" != '1' ]; then
      echo 'Remote Docker requires SANCTUARY_DOCKER_PUBLISHED_HOST and SANCTUARY_TREZOR_ALLOW_REMOTE_DOCKER=1' >&2
      exit 1
    fi
    ;;
esac

readonly checked_out_commit="$(git rev-parse --verify HEAD)"
if ! [[ "$checked_out_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Unable to resolve a full checked-out commit SHA: $checked_out_commit" >&2
  exit 1
fi
readonly workflow_commit="$(ci_event_head_sha)"
if [ "$workflow_commit" != 'HEAD' ] && [ "$workflow_commit" != "$checked_out_commit" ]; then
  echo "Workflow commit differs from checked-out HEAD: $workflow_commit != $checked_out_commit" >&2
  exit 1
fi

mkdir -p "$evidence_root"
if ! mkdir "$attempt_dir"; then
  echo "Refusing stale Trezor evidence directory $attempt_dir" >&2
  exit 1
fi
mkdir "$proof_dir" "$diagnostics_dir"
readonly ci_environment_file="$(ci_env_file)"
if [ "$ci_environment_file" != '/dev/stdout' ]; then
  ci_emit_env \
    "TREZOR_EMULATOR_PROOF_DIR=$proof_dir" \
    "TREZOR_EMULATOR_DIAGNOSTICS_DIR=$diagnostics_dir"
fi
trap cleanup EXIT

if docker inspect "$container_name" >/dev/null 2>&1; then
  echo "Refusing to replace existing container $container_name" >&2
  exit 1
fi

trezor_image_inspect_json=''
if trezor_image_inspect_json="$(
  run_bounded_docker "inspect preloaded Trezor image" \
    "$docker_metadata_timeout_seconds" image inspect "$TREZOR_IMAGE"
)"; then
  if ! trezor_image_is_attested "$trezor_image_inspect_json"; then
    exit 1
  fi
  echo "Using preloaded Trezor User Env image $TREZOR_IMAGE"
else
  run_bounded_docker "pull exact Trezor image" "$docker_pull_timeout_seconds" \
    pull --platform "$TREZOR_PLATFORM" "$TREZOR_IMAGE"
  trezor_image_inspect_json="$(
    run_bounded_docker "inspect pulled Trezor image" \
      "$docker_metadata_timeout_seconds" image inspect "$TREZOR_IMAGE"
  )"
  if ! trezor_image_is_attested "$trezor_image_inspect_json"; then
    exit 1
  fi
fi
printf '%s\n' "$trezor_image_inspect_json" > "$proof_dir/image-inspect.json"

trezor_run_args=(run --rm -d --platform "$TREZOR_PLATFORM")
if [ "$docker_is_podman" = 'true' ]; then
  trezor_transport='docker-exec-loopback'
else
  publish_binding="$(scripts/ci/resolve-trezor-publish-binding.sh)"
  readonly publish_binding
  IFS=$'\t' read -r publish_bind_ip published_host <<< "$publish_binding"
  readonly publish_bind_ip
  trezor_run_args+=(
    -p "${publish_bind_ip}::9001/tcp"
    -p "${publish_bind_ip}::21326/tcp"
  )
fi
trezor_run_args+=(--name "$container_name" "$TREZOR_IMAGE")

if run_bounded_docker "start Trezor User Env container" "$docker_start_timeout_seconds" \
  "${trezor_run_args[@]}" >/dev/null; then
  container_started=1
else
  start_status=$?
  timeout --foreground --kill-after=10s 30s docker rm -f "$container_name" >/dev/null 2>&1 || true
  exit "$start_status"
fi
readonly container_inspect_json="$(
  run_bounded_docker "inspect Trezor User Env container" \
    "$docker_metadata_timeout_seconds" inspect "$container_name"
)"
readonly container_image_id="$(jq -er '.[0].Image' <<< "$container_inspect_json")"
if [ "$container_image_id" != "$TREZOR_IMAGE_CONFIG_DIGEST" ]; then
  echo "Trezor container image drift: expected $TREZOR_IMAGE_CONFIG_DIGEST, received $container_image_id" >&2
  exit 1
fi
printf '%s\n' "$container_inspect_json" > "$proof_dir/container-inspect.json"

for attempt in $(seq 1 120); do
  if controller_command '{"type":"ping","id":1}' >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 120 ]; then
    echo "Trezor User Env controller did not become ready" >&2
    docker logs "$container_name" >&2 || true
    exit 1
  fi
  sleep 1
done

controller_command "{\"type\":\"bridge-start\",\"version\":\"$TREZOR_BRIDGE\",\"id\":2}"
run_bounded_docker "start Trezor Bridge forwarder" 30 \
  exec -d "$container_name" python3 -c '
import socket
import socketserver
import threading

class Proxy(socketserver.BaseRequestHandler):
    def handle(self):
        upstream = socket.create_connection(("127.0.0.1", 21325))
        def forward(source, target):
            try:
                while data := source.recv(65536):
                    target.sendall(data)
            finally:
                source.close()
                target.close()
        thread = threading.Thread(target=forward, args=(self.request, upstream), daemon=True)
        thread.start()
        forward(upstream, self.request)

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

Server(("0.0.0.0", 21326), Proxy).serve_forever()
'
for attempt in $(seq 1 30); do
  if docker exec "$container_name" python3 -c \
    'import socket; socket.create_connection(("127.0.0.1", 21326), 1).close()' 2>/dev/null; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo 'Trezor Bridge forwarder did not become ready' >&2
    exit 1
  fi
  sleep 1
done
controller_command "{\"type\":\"emulator-start\",\"model\":\"$TREZOR_MODEL\",\"version\":\"$TREZOR_FIRMWARE\",\"wipe\":true,\"save_screenshots\":true,\"id\":3}"
controller_command '{"type":"emulator-setup","mnemonic":"all all all all all all all all all all all all","pin":"","passphrase_protection":false,"label":"Sanctuary CI","needs_backup":false,"id":4}' >/dev/null
controller_command '{"type":"background-check","id":5}' | tee "$proof_dir/runtime-status.json"
jq -e --arg bridge "$TREZOR_BRIDGE" --arg firmware "$TREZOR_FIRMWARE ($TREZOR_MODEL)" '
  .bridge_status == {is_running: true, version: $bridge}
  and .emulator_status == {is_running: true, version: $firmware}
' "$proof_dir/runtime-status.json" >/dev/null
controller_command '{"type":"emulator-get-features","id":6}' | tee "$proof_dir/firmware-features.json"

if [ "$docker_is_podman" = 'true' ]; then
  readonly forwarder_endpoints="$diagnostics_dir/docker-exec-forwarder.json"
  node scripts/ci/docker-exec-tcp-forwarder.mjs \
    --container "$container_name" \
    --controller-port 9001 \
    --bridge-port 21326 \
    > "$forwarder_endpoints" \
    2> "$diagnostics_dir/docker-exec-forwarder.log" &
  forwarder_pid=$!
  for attempt in $(seq 1 30); do
    if jq -e '
      .host == "127.0.0.1"
      and (.controllerPort | type == "number" and . > 0 and . <= 65535)
      and (.bridgePort | type == "number" and . > 0 and . <= 65535)
    ' "$forwarder_endpoints" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$forwarder_pid" >/dev/null 2>&1; then
      echo 'Trezor Docker-exec loopback forwarder exited before readiness' >&2
      exit 1
    fi
    if [ "$attempt" -eq 30 ]; then
      echo 'Trezor Docker-exec loopback forwarder did not become ready' >&2
      exit 1
    fi
    sleep 1
  done
  published_host="$(jq -r '.host' "$forwarder_endpoints")"
  controller_port="$(jq -r '.controllerPort' "$forwarder_endpoints")"
  bridge_port="$(jq -r '.bridgePort' "$forwarder_endpoints")"
else
  readonly published_ports="$(
    run_bounded_docker "resolve Trezor published ports" \
      "$docker_metadata_timeout_seconds" port "$container_name"
  )"
  controller_port="$(grep '^9001/tcp' <<< "$published_ports" | head -1 | sed 's/.*://')"
  bridge_port="$(grep '^21326/tcp' <<< "$published_ports" | head -1 | sed 's/.*://')"
fi
if ! [[ "$controller_port" =~ ^[0-9]+$ && "$bridge_port" =~ ^[0-9]+$ ]]; then
  echo 'Unable to resolve Trezor proof ports' >&2
  exit 1
fi
readonly published_host controller_port bridge_port trezor_transport

readonly installed_connect="$(node -p "require('@trezor/connect/package.json').version")"
readonly installed_connect_web="$(node -p "require('@trezor/connect-web/package.json').version")"
if [ "$installed_connect" != "$TREZOR_CONNECT" ] || [ "$installed_connect_web" != "$TREZOR_CONNECT" ]; then
  echo "Installed Trezor Connect drift: node=$installed_connect web=$installed_connect_web" >&2
  exit 1
fi
jq -e \
  --arg version "$TREZOR_CONNECT" \
  --arg connectIntegrity "$TREZOR_CONNECT_INTEGRITY" \
  --arg connectWebIntegrity "$TREZOR_CONNECT_WEB_INTEGRITY" '
  .packages["node_modules/@trezor/connect"].version == $version
  and .packages["node_modules/@trezor/connect"].integrity == $connectIntegrity
  and .packages["node_modules/@trezor/connect-web"].version == $version
  and .packages["node_modules/@trezor/connect-web"].integrity == $connectWebIntegrity
' package-lock.json >/dev/null

mapfile -t proof_sources < <(
  {
    printf '%s\n' \
      '.github/actions/setup-node-toolchain/action.yml' \
      '.github/workflows/verify-vectors.yml' \
      '.nvmrc' \
      'package.json' \
      'package-lock.json' \
      'scripts/ci/ensure-node.sh' \
      'scripts/ci/check-trezor-transport-provenance.sh' \
      'scripts/ci/images/go-runner.Dockerfile' \
      'scripts/ci/provider-context.sh' \
      'scripts/ci/docker-exec-tcp-forwarder.mjs' \
      'scripts/ci/resolve-trezor-publish-binding.sh' \
      'shared/constants/hardwareWalletCapabilities.ts' \
      'shared/constants/walletPolicy.ts' \
      'src/hooks/send/types.ts' \
      'src/hooks/send/useUsbSigning.ts' \
      'src/hooks/useHardwareWallet.ts' \
      'src/services/hardwareWallet/identity.ts' \
      'src/services/hardwareWallet/psbtAccountBinding.ts' \
      'src/services/hardwareWallet/service.ts' \
      'src/services/hardwareWallet/types.ts' \
      'src/services/hardwareWallet/adapters/trezor/trezorAdapter.ts' \
      'config/tooling/vitest.trezor-emulator.config.ts' \
      'config/trezor-emulator-proof.json' \
      'scripts/ci/run-trezor-emulator-proof.sh' \
      'tests/fixtures/trezorEmulatorProof.ts' \
      'tests/ci/dockerExecTcpForwarder.test.ts' \
      'tests/ci/trezorEmulatorRunnerPreflight.test.ts' \
      'tests/config/trezorEmulatorProofBinding.test.ts' \
      'tests/config/trezorEmulatorProofConfig.test.ts' \
      'tests/integration/trezorEmulator.integration.test.ts' \
      'tests/integration/trezorEmulator/proofReplay.ts'
    find src/services/hardwareWallet/adapters/trezor \
      tests/integration/trezorEmulator -type f -name '*.ts' -print
  } | LC_ALL=C sort -u
)
source_manifest='[]'
for source_path in "${proof_sources[@]}"; do
  if [ ! -f "$source_path" ]; then
    echo "Trezor proof-critical source is missing: $source_path" >&2
    exit 1
  fi
  source_sha256="$(sha256sum "$source_path" | awk '{print $1}')"
  source_manifest="$(
    jq -c --arg path "$source_path" --arg sha256 "$source_sha256" \
      '. + [{path: $path, sha256: $sha256}]' <<< "$source_manifest"
  )"
done
readonly package_lock_sha256="$(sha256sum package-lock.json | awk '{print $1}')"
readonly captured_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
jq -n \
  --arg image "$TREZOR_IMAGE" \
  --arg imageDigest "$TREZOR_IMAGE_DIGEST" \
  --arg imageIndexDigest "$TREZOR_IMAGE_INDEX_DIGEST" \
  --arg imageConfigDigest "$TREZOR_IMAGE_CONFIG_DIGEST" \
  --arg platform "$TREZOR_PLATFORM" \
  --arg connect "$installed_connect" \
  --arg connectWeb "$installed_connect_web" \
  --arg connectIntegrity "$TREZOR_CONNECT_INTEGRITY" \
  --arg connectWebIntegrity "$TREZOR_CONNECT_WEB_INTEGRITY" \
  --arg commitSha "$checked_out_commit" \
  --arg runId "$run_id" \
  --arg runAttempt "$run_attempt" \
  --arg capturedAt "$captured_at" \
  --arg packageLockSha256 "$package_lock_sha256" \
  --arg nodeVersion "$actual_node" \
  --arg npmVersion "$actual_npm" \
  --arg runnerOs "$runner_os" \
  --arg runnerArchitecture "$runner_arch" \
  --arg trezorTransport "$trezor_transport" \
  --argjson dockerRuntime "$docker_runtime_json" \
  --argjson sourceManifest "$source_manifest" \
  '{image: $image, imageDigest: $imageDigest, imageIndexDigest: $imageIndexDigest,
    imageConfigDigest: $imageConfigDigest, platform: $platform, connect: $connect,
    connectWeb: $connectWeb, connectIntegrity: $connectIntegrity,
    connectWebIntegrity: $connectWebIntegrity, commitSha: $commitSha, runId: $runId,
    runAttempt: $runAttempt, capturedAt: $capturedAt,
    packageLockSha256: $packageLockSha256,
    runtime: {nodeVersion: $nodeVersion, npmVersion: $npmVersion,
      runner: {os: $runnerOs, architecture: $runnerArchitecture},
      docker: $dockerRuntime, trezorTransport: $trezorTransport},
    sourceManifest: $sourceManifest}' \
  > "$proof_dir/provenance.json"
jq -e \
  --arg commitSha "$checked_out_commit" \
  --arg runId "$run_id" \
  --arg runAttempt "$run_attempt" \
  --arg packageLockSha256 "$package_lock_sha256" \
  --arg nodeVersion "$EXPECTED_NODE" \
  --arg npmVersion "$EXPECTED_NPM" \
  --arg runnerOs "$EXPECTED_RUNNER_OS" \
  --arg runnerArchitecture "$EXPECTED_RUNNER_ARCH" \
  --arg dockerServerOs "$EXPECTED_DOCKER_SERVER_OS" \
  --arg dockerServerArchitecture "$EXPECTED_DOCKER_SERVER_ARCH" \
  --argjson sourceCount "${#proof_sources[@]}" '
  .commitSha == $commitSha
  and .runId == $runId
  and .runAttempt == $runAttempt
  and .packageLockSha256 == $packageLockSha256
  and .runtime.nodeVersion == $nodeVersion
  and .runtime.npmVersion == $npmVersion
  and .runtime.runner == {os: $runnerOs, architecture: $runnerArchitecture}
  and .runtime.docker.server.os == $dockerServerOs
  and .runtime.docker.server.architecture == $dockerServerArchitecture
  and (.runtime.trezorTransport | type == "string" and length > 0)
  and ([.runtime.docker.client.version, .runtime.docker.server.version] | all(type == "string" and length > 0))
  and ([.runtime.docker.client.apiVersion, .runtime.docker.server.apiVersion,
        .runtime.docker.server.minimumApiVersion] | all(test("^[0-9]+[.][0-9]+$")))
  and (.capturedAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
  and (.sourceManifest | length) == $sourceCount
  and ([.sourceManifest[].sha256] | all(test("^[0-9a-f]{64}$")))
' "$proof_dir/provenance.json" >/dev/null
scripts/ci/check-trezor-transport-provenance.sh "$proof_dir/provenance.json"

export TREZOR_EMULATOR_PROOF=1
# nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket -- Trezor User Env exposes only ws; the endpoint is either validated private publishing or an unexposed Docker-exec loopback tunnel carrying test-seed traffic only.
export TREZOR_EMULATOR_CONTROLLER_URL="ws://${published_host}:${controller_port}"
export TREZOR_EMULATOR_BRIDGE_HOST="$published_host"
export TREZOR_EMULATOR_BRIDGE_PORT="$bridge_port"
export TREZOR_EMULATOR_IMAGE="$TREZOR_IMAGE"
export TREZOR_EMULATOR_MODEL="$TREZOR_MODEL"
export TREZOR_EMULATOR_FIRMWARE="$TREZOR_FIRMWARE"
export TREZOR_EMULATOR_BRIDGE_VERSION="$TREZOR_BRIDGE"
export TREZOR_EMULATOR_CONNECT_VERSION="$TREZOR_CONNECT"
export TREZOR_EMULATOR_EVIDENCE_DIR="$proof_dir"
export TREZOR_EMULATOR_JUNIT_PATH="$diagnostics_dir/junit-trezor-emulator.xml"

npx vitest run --config config/tooling/vitest.trezor-emulator.config.ts \
  tests/integration/trezorEmulator.integration.test.ts \
  --pool threads --maxWorkers=1 --no-file-parallelism
