#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then
  exec "$SCRIPT_DIR/cleanup-ci-callsite.sh" auto-run \
    --lane jade-emulator-proof --checkout-root "$PROJECT_ROOT" -- "$0" "$@"
fi
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$SCRIPT_DIR/../ownership/producer-hooks.sh"

readonly manifest='config/jade-emulator-proof.json'
readonly run_id="$(ci_run_id)"
readonly run_attempt="${SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE:-0}"
readonly run_identity="${run_id}-${run_attempt}-$$"
readonly image="localhost/sanctuary-jade-qemu:proof-${run_identity}"
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
forwarder_terminal=''
forwarder_control_token=''
forwarder_control_port=''
forwarder_start_token=''
forwarder_gate_fd=''
container_started=0
container_registered=0
active_container=''
active_container_id=''
proof_image_id=''
proof_image_registered=0

assert_registered_transient() {
  local container_id="$1"
  docker inspect "$container_id" | jq -e \
    --arg id "$container_id" --arg name "$active_container" \
    --arg project "$SANCTUARY_PROJECT" \
    --arg deployment "$SANCTUARY_DEPLOYMENT_ID" \
    --arg owner "$SANCTUARY_OWNER_ID" \
    --arg run "$SANCTUARY_OPERATION_RUN_ID" \
    --arg created "$SANCTUARY_CLEANUP_CREATED_AT" \
    --arg release "$SANCTUARY_RELEASE" --arg commit "$SANCTUARY_COMMIT" '
      length == 1 and .[0].Id == $id and .[0].Name == ("/" + $name)
      and .[0].Config.Labels["io.sanctuary.project"] == $project
      and .[0].Config.Labels["io.sanctuary.deployment-id"] == $deployment
      and .[0].Config.Labels["io.sanctuary.owner-id"] == $owner
      and .[0].Config.Labels["io.sanctuary.resource-class"] == "compose_container"
      and .[0].Config.Labels["io.sanctuary.lifecycle"] == "obsolete"
      and .[0].Config.Labels["io.sanctuary.cleanup-policy"] == "exact_delete"
      and .[0].Config.Labels["io.sanctuary.created-at"] == $created
      and .[0].Config.Labels["io.sanctuary.created-by-release"] == $release
      and .[0].Config.Labels["io.sanctuary.created-by-commit"] == $commit
      and .[0].Config.Labels["io.sanctuary.creation-run-id"] == $run
    ' >/dev/null
}

container_absence_proven() {
  local container_id="$1" listed
  if docker container inspect "$container_id" >/dev/null 2>&1; then
    return 1
  fi
  listed="$(docker container ls -a --no-trunc \
    --filter "id=$container_id" --format '{{.ID}}')" || return 2
  [ -z "$listed" ]
}

record_registered_transient_retirement() {
  local container_id="$1" evidence_name="$2" postcondition="$3"
  case "$postcondition" in
    absent|already-absent) ;;
    *) return 1 ;;
  esac
  jq -n --arg containerId "$container_id" --arg postcondition "$postcondition" \
    '{containerId: $containerId, ownership: "verified", postcondition: $postcondition}' \
    > "$diagnostics_dir/registered-transient-${evidence_name}.json"
}

retire_registered_transient() {
  local container_id="$1" evidence_name="$2" identity_was_verified="${3:-0}" absence_status=0 stop_status=0
  if ! assert_registered_transient "$container_id"; then
    container_absence_proven "$container_id" || absence_status=$?
    if [ "$absence_status" -ne 0 ]; then
      echo "Jade container absence is ambiguous: $container_id (exit=$absence_status)" >&2
      return 1
    fi
    if [ "$identity_was_verified" -ne 1 ]; then
      echo "Jade container disappeared before ownership was verified: $container_id" >&2
      return 1
    fi
    record_registered_transient_retirement "$container_id" "$evidence_name" already-absent
    return 0
  fi
  timeout --foreground --kill-after=10s 30s docker stop --timeout 10 "$container_id" >/dev/null \
    || stop_status=$?
  container_absence_proven "$container_id" || absence_status=$?
  if [ "$absence_status" -ne 0 ]; then
    echo "Daemon-atomic Jade container removal is unproven: $container_id (stop=$stop_status, inspect=$absence_status)" >&2
    return 1
  fi
  record_registered_transient_retirement "$container_id" "$evidence_name" absent
}

case "$container_prefix" in
  sanctuary-jade-proof-[A-Za-z0-9._-]*) ;;
  *) echo "Unsafe Jade proof container prefix: $container_prefix" >&2; exit 1 ;;
esac

cleanup() {
  local subject_status=$? cleanup_status=0 final_status
  trap - EXIT
  if [ -n "$forwarder_gate_fd" ]; then
    exec {forwarder_gate_fd}>&-
    forwarder_gate_fd=''
    wait "$forwarder_pid" >/dev/null 2>&1 || true
    forwarder_pid=0
  fi
  if [ "$forwarder_pid" -ne 0 ]; then
    "$SCRIPT_DIR/registered-collector-process.sh" terminal "$forwarder_terminal" \
      || cleanup_status=$?
  fi
  if [ "$container_started" -eq 1 ]; then
    timeout --foreground --kill-after=10s 30s docker logs "$active_container_id" \
      > "$diagnostics_dir/${active_container}.log" 2>&1 || true
    retire_registered_transient \
      "$active_container_id" "$active_container" "$container_registered" || cleanup_status=$?
  fi
  if [ "$proof_image_registered" -eq 1 ]; then
    retire_exact_built_image "$image" "$proof_image_id" "$run_identity" || cleanup_status=$?
  fi
  final_status="$subject_status"
  if [ "$cleanup_status" -ne 0 ]; then
    echo "Jade registered cleanup marker failed (exit=$cleanup_status)" >&2
    [ "$final_status" -ne 0 ] || final_status="$cleanup_status"
  fi
  jq -n --argjson subjectExitCode "$subject_status" \
    --argjson cleanupExitCode "$cleanup_status" --argjson exitCode "$final_status" \
    '{subjectExitCode: $subjectExitCode, cleanupExitCode: $cleanupExitCode, exitCode: $exitCode}' \
    > "$diagnostics_dir/run-status.json"
  exit "$final_status"
}

register_forwarder() {
  local label=$1 registration
  registration=$("$SCRIPT_DIR/registered-collector-process.sh" register \
    "$forwarder_pid" "$SCRIPT_DIR/docker-exec-tcp-forwarder.mjs" "$label") || return
  IFS=$'\t' read -r _ forwarder_terminal <<< "$registration"
  [[ -n $forwarder_terminal ]]
}

finish_forwarder() {
  local poll
  timeout --foreground 5s curl --fail --silent --show-error \
    --request POST --header "Authorization: Bearer $forwarder_control_token" \
    "http://127.0.0.1:$forwarder_control_port/shutdown" >/dev/null || return
  for poll in $(seq 1 100); do
    if ! jobs -pr | grep -Fxq "$forwarder_pid"; then
      wait "$forwarder_pid"
      "$SCRIPT_DIR/registered-collector-process.sh" terminal "$forwarder_terminal"
      forwarder_pid=0
      forwarder_terminal=''
      forwarder_control_token=''
      forwarder_control_port=''
      unset SANCTUARY_FORWARDER SANCTUARY_FORWARDER_PID
      return 0
    fi
    sleep 0.1
  done
  return 1
}

if ! mkdir -p "$(dirname "$attempt_dir")" || ! mkdir "$attempt_dir"; then
  echo "Refusing stale Jade evidence directory $attempt_dir" >&2
  exit 1
fi
mkdir "$proof_dir" "$diagnostics_dir" "$source_dir"
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

export SANCTUARY_PROJECT='jade-emulator-proof'
export SANCTUARY_PROJECT_DIR="$PROJECT_ROOT"
export SANCTUARY_OPERATION_RUN_ID="run-jade-emulator-${run_identity}"
export SANCTUARY_RESOURCE_LIFECYCLE='obsolete'
ownership_label_args compose_container exact_delete
readonly -a container_ownership_labels=("${OWNERSHIP_LABEL_ARGS[@]}")

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

build_status=0
timeout --foreground --kill-after=30s 2700s docker buildx build \
  --load \
  --platform "$platform" \
  --label "io.sanctuary.build-id=$run_identity" \
  --build-arg "QEMU_CONFIG_ARGS=$config_args" \
  --file "$source_dir/Dockerfile.qemu" \
  --tag "$image" \
  "$source_dir" || build_status=$?
if ! proof_image_id="$(recover_exact_loaded_image "$image" "$run_identity")"; then
  [ "$build_status" -eq 0 ] && exit 1
  exit "$build_status"
fi
register_exact_built_image "$image" "$proof_image_id"
proof_image_registered=1
[ "$build_status" -eq 0 ] || exit "$build_status"
docker image inspect "$image" > "$proof_dir/image-inspect.json"
if [ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" != "$platform" ]; then
  echo 'Built Jade QEMU image platform drift' >&2
  exit 1
fi
timeout --foreground --kill-after=10s 60s docker run --rm --platform "$platform" \
  "${container_ownership_labels[@]}" \
  --entrypoint sha256sum "$image" /jade/build/jade.bin /jade/build/jade.elf /flash_image.bin \
  > "$proof_dir/firmware.sha256"
timeout --foreground --kill-after=10s 60s docker run --rm --platform "$platform" \
  "${container_ownership_labels[@]}" \
  "$image" qemu-system-xtensa --version > "$proof_dir/qemu-version.txt"

resolve_jade_created_container() {
  local container_name="$1" cidfile="$2" create_status="$3"
  local cid_id='' recovered_id invalid_cidfile=0 recovery_status=0
  if [ -f "$cidfile" ]; then
    cid_id="$(tr -d '\r\n' < "$cidfile")"
    if ! [[ "$cid_id" =~ ^[0-9a-f]{64}$ ]]; then
      echo "Jade QEMU cidfile contains an invalid container ID" >&2
      cid_id=''
      invalid_cidfile=1
    fi
  fi
  recovered_id="$(recover_exact_created_container "$container_name")" || recovery_status=$?
  if [ "$recovery_status" -ne 0 ]; then
    [ "$create_status" -ne 0 ] && return "$create_status"
    return "$recovery_status"
  fi
  if [ -n "$cid_id" ] && [ "$cid_id" != "$recovered_id" ]; then
    echo "Jade QEMU cidfile disagrees with the exact created container" >&2
    printf '%s\n' "$recovered_id"
    return 1
  fi
  printf '%s\n' "$recovered_id" > "$cidfile"
  printf '%s\n' "$recovered_id"
  [ "$invalid_cidfile" -eq 0 ] || return 1
}

for network in mainnet testnet; do
  active_container="${container_prefix}-${network}"
  active_cidfile="$attempt_dir/container-${network}.cid"
  active_create_output="$attempt_dir/container-${network}.create-output"
  if docker inspect "$active_container" >/dev/null 2>&1; then
    echo "Refusing to replace existing Jade proof container $active_container" >&2
    exit 1
  fi
  create_status=0
  timeout --foreground --kill-after=10s 60s docker create --rm \
    --cidfile "$active_cidfile" --name "$active_container" --platform "$platform" \
    "${container_ownership_labels[@]}" "$image" > "$active_create_output" || create_status=$?
  resolve_status=0
  active_container_id="$(resolve_jade_created_container \
    "$active_container" "$active_cidfile" "$create_status")" || resolve_status=$?
  if [[ "$active_container_id" =~ ^[0-9a-f]{64}$ ]]; then
    container_started=1
  fi
  [ "$container_started" -eq 1 ] \
    || {
      echo "Jade QEMU creation produced no durable container ID" >&2
      [ "$resolve_status" -ne 0 ] && exit "$resolve_status"
      [ "$create_status" -ne 0 ] && exit "$create_status"
      exit 1
    }
  assert_registered_transient "$active_container_id"
  register_owned_resource compose_container obsolete exact_delete engine_id \
    "$active_container_id" "$active_container_id" "$SANCTUARY_OPERATION_RUN_ID"
  container_registered=1
  [ "$resolve_status" -eq 0 ] || exit "$resolve_status"
  [ "$create_status" -eq 0 ] || exit "$create_status"
  [ "$(tr -d '\r\n' < "$active_create_output")" = "$active_container_id" ] \
    || { echo "Jade QEMU create output disagrees with its durable container ID" >&2; exit 1; }
  timeout --foreground --kill-after=10s 60s docker start "$active_container_id" >/dev/null
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
  forwarder_control_token="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  forwarder_start_token="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  coproc SANCTUARY_FORWARDER {
    SANCTUARY_COLLECTOR_START_TOKEN="$forwarder_start_token" exec setsid node \
      --import "$SCRIPT_DIR/registered-start-gate.mjs" \
      "$SCRIPT_DIR/docker-exec-tcp-forwarder.mjs" \
      --container "$active_container" \
      --controller-port "$serial_port" \
      --bridge-port "$serial_port" \
      --control-token "$forwarder_control_token" > "$forwarder_output"
  }
  forwarder_pid=$SANCTUARY_FORWARDER_PID
  forwarder_gate_fd=${SANCTUARY_FORWARDER[1]}
  forwarder_output_fd=${SANCTUARY_FORWARDER[0]}
  exec {forwarder_output_fd}<&-
  register_forwarder "jade-forwarder-$network"
  printf 'registered %s\n' "$forwarder_start_token" >&"$forwarder_gate_fd"
  exec {forwarder_gate_fd}>&-
  forwarder_gate_fd=''
  for _ in $(seq 1 300); do
    if [ -s "$forwarder_output" ] && jq -e \
      '.controllerPort > 0 and .controlPort > 0' "$forwarder_output" >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
  controller_port="$(jq -er '.controllerPort' "$forwarder_output")"
  forwarder_control_port="$(jq -er '.controlPort' "$forwarder_output")"
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
  finish_forwarder
  timeout --foreground --kill-after=10s 30s docker logs "$active_container_id" \
    > "$diagnostics_dir/${active_container}.log" 2>&1 || true
  retire_registered_transient "$active_container_id" "$network" "$container_registered"
  container_started=0
  container_registered=0
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
