#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

readonly manifest='config/jade-emulator-proof.json'
readonly image='sanctuary-jade-qemu:proof'
readonly run_id="$(ci_run_id)"
readonly run_attempt="${SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE:-0}"
readonly run_identity="${run_id}-${run_attempt}-$$"
readonly container_prefix="sanctuary-jade-proof-${run_identity}"
readonly attempt_dir="$(ci_workspace)/.tmp/ci-evidence/jade-emulator/${run_identity}"
readonly proof_dir="$attempt_dir/proof"
readonly diagnostics_dir="$attempt_dir/diagnostics"
readonly source_dir="$attempt_dir/vendor-source"
readonly source_tarball="$attempt_dir/jade-source.tar.gz"
readonly source_commit="$(jq -r '.firmware.sourceCommit' "$manifest")"
readonly platform="$(jq -r '.platform' "$manifest")"
readonly serial_port="$(jq -r '.qemu.serialPort' "$manifest")"
readonly config_args="$(jq -r '.qemu.configArgs' "$manifest")"
forwarder_pid=0
container_started=0
active_container=''

case "$container_prefix" in
  sanctuary-jade-proof-[A-Za-z0-9._-]*) ;;
  *) echo "Unsafe Jade proof container prefix: $container_prefix" >&2; exit 1 ;;
esac

cleanup() {
  local status=$?
  jq -n --argjson exitCode "$status" '{exitCode: $exitCode}' > "$diagnostics_dir/run-status.json"
  if [ "$forwarder_pid" -ne 0 ]; then
    kill "$forwarder_pid" >/dev/null 2>&1 || true
    wait "$forwarder_pid" >/dev/null 2>&1 || true
  fi
  if [ "$container_started" -eq 1 ]; then
    timeout --foreground --kill-after=10s 30s docker logs "$active_container" \
      > "$diagnostics_dir/${active_container}.log" 2>&1 || true
    timeout --foreground --kill-after=10s 30s docker stop --timeout 10 "$active_container" >/dev/null || true
  fi
  return "$status"
}

if ! mkdir -p "$(dirname "$attempt_dir")" || ! mkdir "$attempt_dir"; then
  echo "Refusing stale Jade evidence directory $attempt_dir" >&2
  exit 1
fi
mkdir "$proof_dir" "$diagnostics_dir" "$source_dir"
trap cleanup EXIT INT TERM

readonly ci_environment_file="$(ci_env_file)"
if [ "$ci_environment_file" != '/dev/stdout' ]; then
  ci_emit_env \
    "JADE_EMULATOR_PROOF_DIR=$proof_dir" \
    "JADE_EMULATOR_DIAGNOSTICS_DIR=$diagnostics_dir"
fi

jq -e '
  .schemaVersion == 1
  and .platform == "linux/amd64"
  and .firmware.release == "1.0.40"
  and .firmware.buildVersionTag == .firmware.release
  and .firmware.runtimeVersion == .firmware.release
  and (.firmware.sourceCommit | test("^[0-9a-f]{40}$"))
  and (.firmware.sourceTarball | startswith("https://codeload.github.com/Blockstream/Jade/tar.gz/"))
  and ([.firmware.sourceTarballSha256, .firmware.dockerfileSha256] | all(test("^[0-9a-f]{64}$")))
  and (.builder.image | test("^blockstream/jade_builder@sha256:[0-9a-f]{64}$"))
  and (.submodules | length == 5)
  and (.submodules | all(
    (.path | test("^[A-Za-z0-9._/-]+$"))
    and (.sourceCommit | test("^[0-9a-f]{40}$"))
    and (.sourceTarball | test("^https://codeload[.]github[.]com/"))
    and (.sourceTarballSha256 | test("^[0-9a-f]{64}$"))))
  and .qemu.configArgs == "--dev --ci --psram"
  and .qemu.machine == "esp32"
  and .qemu.serialPort == 30121
  and .qemu.webDisplayPort == 30122
  and .sdk.cborX == "1.6.4"
  and (.sdk.cborXIntegrity | test("^sha512-[A-Za-z0-9+/]+={0,2}$"))
' "$manifest" >/dev/null

readonly actual_node="$(node --version | sed 's/^v//')"
readonly actual_npm="$(npm --version)"
readonly expected_node="$(jq -r '.runtimeCompatibility.node' "$manifest")"
readonly expected_npm="$(jq -r '.runtimeCompatibility.npm' "$manifest")"
readonly expected_os="$(jq -r '.runtimeCompatibility.runnerOs' "$manifest")"
readonly expected_arch="$(jq -r '.runtimeCompatibility.runnerArchitecture' "$manifest")"
readonly docker_server_os="$(docker version --format '{{.Server.Os}}')"
readonly docker_server_arch="$(docker version --format '{{.Server.Arch}}')"
if [ "$actual_node" != "$expected_node" ] || [ "$(tr -d '[:space:]' < .nvmrc)" != "$expected_node" ]; then
  echo "Jade proof Node drift: expected=$expected_node actual=$actual_node" >&2
  exit 1
fi
if [ "$actual_npm" != "$expected_npm" ] || [ "$(jq -r '.packageManager' package.json)" != "npm@$expected_npm" ]; then
  echo "Jade proof npm drift: expected=$expected_npm actual=$actual_npm" >&2
  exit 1
fi
if [ "$(uname -s)" != "$expected_os" ] || [ "$(uname -m)" != "$expected_arch" ]; then
  echo "Unsupported Jade proof runner platform" >&2
  exit 1
fi
if [ "$docker_server_os" != "$(jq -r '.runtimeCompatibility.dockerServerOs' "$manifest")" ] \
  || [ "$docker_server_arch" != "$(jq -r '.runtimeCompatibility.dockerServerArchitecture' "$manifest")" ]; then
  echo "Unsupported Jade proof Docker server platform: $docker_server_os/$docker_server_arch" >&2
  exit 1
fi

readonly locked_cbor_version="$(jq -r '.packages["node_modules/cbor-x"].version' package-lock.json)"
readonly locked_cbor_integrity="$(jq -r '.packages["node_modules/cbor-x"].integrity' package-lock.json)"
if [ "$locked_cbor_version" != "$(jq -r '.sdk.cborX' "$manifest")" ] \
  || [ "$locked_cbor_integrity" != "$(jq -r '.sdk.cborXIntegrity' "$manifest")" ]; then
  echo 'Jade protocol SDK lockfile drift' >&2
  exit 1
fi

readonly source_url="$(jq -r '.firmware.sourceTarball' "$manifest")"
scripts/ci/download-verified-source.sh \
  jade-firmware "$source_url" \
  "$(jq -r '.firmware.sourceTarballSha256' "$manifest")" "$source_tarball"
tar -xzf "$source_tarball" --strip-components=1 -C "$source_dir"
echo "$(jq -r '.firmware.dockerfileSha256' "$manifest")  $source_dir/Dockerfile.qemu" | sha256sum --check
submodule_index=0
while IFS=$'\t' read -r submodule_path submodule_url submodule_sha; do
  case "$submodule_path" in
    components/*) ;;
    *) echo "Unsafe Jade submodule path: $submodule_path" >&2; exit 1 ;;
  esac
  submodule_tarball="$attempt_dir/submodule-${submodule_index}.tar.gz"
  scripts/ci/download-verified-source.sh \
    "jade-submodule-$submodule_index" "$submodule_url" "$submodule_sha" "$submodule_tarball"
  mkdir -p "$source_dir/$submodule_path"
  tar -xzf "$submodule_tarball" --strip-components=1 -C "$source_dir/$submodule_path"
  submodule_index=$((submodule_index + 1))
done < <(jq -r '.submodules[] | [.path, .sourceTarball, .sourceTarballSha256] | @tsv' "$manifest")
# GitHub source archives omit Git metadata, but ESP-IDF derives JADE_VERSION via
# git describe. Reconstruct a local metadata-only tag after every byte-bearing
# source input has been independently hash verified.
git -C "$source_dir" init --quiet
git -C "$source_dir" add --all
GIT_AUTHOR_NAME='Sanctuary QEMU Proof' \
GIT_AUTHOR_EMAIL='proof@invalid.example' \
GIT_AUTHOR_DATE='2000-01-01T00:00:00Z' \
GIT_COMMITTER_NAME='Sanctuary QEMU Proof' \
GIT_COMMITTER_EMAIL='proof@invalid.example' \
GIT_COMMITTER_DATE='2000-01-01T00:00:00Z' \
  git -C "$source_dir" commit --quiet --message "Verified Jade source $source_commit"
git -C "$source_dir" update-index --assume-unchanged Dockerfile.qemu
git -C "$source_dir" tag "$(jq -r '.firmware.buildVersionTag' "$manifest")"
readonly expected_builder="$(jq -r '.builder.image' "$manifest")"
if ! grep -Fxq "FROM $expected_builder" "$source_dir/Dockerfile.qemu"; then
  echo 'Jade QEMU builder parent drift' >&2
  exit 1
fi

timeout --foreground --kill-after=30s 2700s docker buildx build \
  --load \
  --platform "$platform" \
  --build-arg "QEMU_CONFIG_ARGS=$config_args" \
  --file "$source_dir/Dockerfile.qemu" \
  --tag "$image" \
  "$source_dir"
docker image inspect "$image" > "$proof_dir/image-inspect.json"
if [ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" != "$platform" ]; then
  echo 'Built Jade QEMU image platform drift' >&2
  exit 1
fi
timeout --foreground --kill-after=10s 60s docker run --rm --platform "$platform" \
  --entrypoint sha256sum "$image" /jade/build/jade.bin /jade/build/jade.elf /flash_image.bin \
  > "$proof_dir/firmware.sha256"
timeout --foreground --kill-after=10s 60s docker run --rm --platform "$platform" \
  "$image" qemu-system-xtensa --version > "$proof_dir/qemu-version.txt"

for network in mainnet testnet; do
  active_container="${container_prefix}-${network}"
  if docker inspect "$active_container" >/dev/null 2>&1; then
    echo "Refusing to replace existing Jade proof container $active_container" >&2
    exit 1
  fi
  timeout --foreground --kill-after=10s 60s docker run --rm --detach \
    --name "$active_container" --platform "$platform" "$image" >/dev/null
  container_started=1
  controller_ready=0
  for _ in $(seq 1 300); do
    if timeout --foreground --kill-after=2s 3s docker exec "$active_container" \
      python3 -c 'import socket, sys; connection = socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=1); connection.close()' \
      "$serial_port" >/dev/null 2>&1; then
      controller_ready=1
      break
    fi
    if [ "$(docker inspect --format '{{.State.Running}}' "$active_container" 2>/dev/null || true)" != true ]; then
      break
    fi
    sleep 0.1
  done
  if [ "$controller_ready" -ne 1 ]; then
    echo "Jade QEMU controller did not become ready for $network" >&2
    exit 1
  fi
  forwarder_output="$diagnostics_dir/forwarder-${network}.json"
  node scripts/ci/docker-exec-tcp-forwarder.mjs \
    --container "$active_container" \
    --controller-port "$serial_port" \
    --bridge-port "$serial_port" > "$forwarder_output" &
  forwarder_pid=$!
  for _ in $(seq 1 300); do
    if [ -s "$forwarder_output" ] && jq -e '.controllerPort > 0' "$forwarder_output" >/dev/null 2>&1; then break; fi
    kill -0 "$forwarder_pid" >/dev/null 2>&1 || break
    sleep 0.1
  done
  controller_port="$(jq -er '.controllerPort' "$forwarder_output")"
  JADE_EMULATOR_PROOF=1 \
  JADE_EMULATOR_HOST=127.0.0.1 \
  JADE_EMULATOR_SERIAL_PORT="$controller_port" \
  JADE_EMULATOR_NETWORK="$network" \
  JADE_EMULATOR_FIRMWARE="$(jq -r '.firmware.runtimeVersion' "$manifest")" \
  JADE_EMULATOR_JUNIT_PATH="$diagnostics_dir/junit-jade-${network}.xml" \
    timeout --foreground --kill-after=30s 900s \
      npx vitest run --config config/tooling/vitest.jade-emulator.config.ts
  verified_junit="$diagnostics_dir/verified-junit-jade-${network}.json"
  node scripts/ci/verify-jade-junit.mjs \
    "$diagnostics_dir/junit-jade-${network}.xml" > "$verified_junit"
  jq -n \
    --arg network "$network" \
    --arg runtimeVersion "$(jq -r '.firmware.runtimeVersion' "$manifest")" \
    --arg junitSha256 "$(sha256sum "$diagnostics_dir/junit-jade-${network}.xml" | cut -d ' ' -f1)" \
    --slurpfile verifiedJunit "$verified_junit" \
    '($verifiedJunit[0] + {
      network: $network,
      cleanBoot: true,
      runtimeVersion: $runtimeVersion,
      junitSha256: $junitSha256
    })' \
    > "$proof_dir/network-${network}.json"
  kill "$forwarder_pid" >/dev/null 2>&1 || true
  wait "$forwarder_pid" >/dev/null 2>&1 || true
  forwarder_pid=0
  timeout --foreground --kill-after=10s 30s docker logs "$active_container" \
    > "$diagnostics_dir/${active_container}.log" 2>&1 || true
  timeout --foreground --kill-after=10s 30s docker stop --timeout 10 "$active_container" >/dev/null
  container_started=0
done

proof_sources_text=''
if ! proof_sources_text="$(
  node scripts/ci/hardware-emulator-source-inventory.mjs \
    list --vendor jade --format lines --require-clean
)"; then
  echo 'Failed to resolve Jade proof-source inventory' >&2
  exit 1
fi
if [ -z "$proof_sources_text" ]; then
  echo 'Jade proof-source inventory resolved empty' >&2
  exit 1
fi
mapfile -t proof_sources <<< "$proof_sources_text"
readonly -a proof_sources
sha256sum "${proof_sources[@]}" > "$proof_dir/proof-sources.sha256"
jq -n \
  --arg status passed \
  --arg commitSha "$(git rev-parse HEAD)" \
  --arg runId "$run_id" \
  --arg runAttempt "$run_attempt" \
  --arg capturedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg sourceCommit "$source_commit" \
  --arg sourceTarballSha256 "$(sha256sum "$source_tarball" | cut -d ' ' -f1)" \
  --arg imageId "$(docker image inspect --format '{{.Id}}' "$image")" \
  --arg packageLockSha256 "$(sha256sum package-lock.json | cut -d ' ' -f1)" \
  --arg platform "$platform" \
  --slurpfile mainnetProof "$proof_dir/network-mainnet.json" \
  --slurpfile testnetProof "$proof_dir/network-testnet.json" \
  '{status: $status, commitSha: $commitSha, runId: $runId, runAttempt: $runAttempt,
    capturedAt: $capturedAt, sourceCommit: $sourceCommit,
    sourceTarballSha256: $sourceTarballSha256, imageId: $imageId,
    packageLockSha256: $packageLockSha256, platform: $platform,
    cleanBootPerNetwork: true, networkProofs: [$mainnetProof[0], $testnetProof[0]]}' \
  > "$proof_dir/summary.json"
