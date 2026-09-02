#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then
  exec "$SCRIPT_DIR/cleanup-ci-callsite.sh" auto-run \
    --lane ledger-emulator-proof --checkout-root "$PROJECT_ROOT" -- "$0" "$@"
fi
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$SCRIPT_DIR/../ownership/producer-hooks.sh"

readonly manifest='config/ledger-emulator/proof.json'
readonly run_id="$(ci_run_id)"
readonly run_attempt="${SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE:-0}"
readonly run_identity="${run_id}-${run_attempt}-$$"
readonly image="localhost/sanctuary-ledger-emulator:proof-${run_identity}"
readonly evidence_root="$(ci_workspace)/.tmp/ci-evidence/ledger-emulator/${run_identity}"
readonly diagnostics_dir="$evidence_root/diagnostics"
mkdir -p "$diagnostics_dir"
readonly ci_environment_file="$(ci_env_file)"
if [ "$ci_environment_file" != '/dev/stdout' ]; then
  ci_emit_env \
    "LEDGER_EMULATOR_PROOF_DIR=$evidence_root" \
    "LEDGER_EMULATOR_DIAGNOSTICS_DIR=$diagnostics_dir"
fi

proof_sources_text=''
if ! proof_sources_text="$(
  node scripts/ci/hardware-emulator-source-inventory.mjs \
    list --vendor ledger --format lines --require-clean
)"; then
  echo 'Failed to resolve Ledger proof-source inventory' >&2
  exit 1
fi
if [ -z "$proof_sources_text" ]; then
  echo 'Ledger proof-source inventory resolved empty' >&2
  exit 1
fi
mapfile -t proof_sources <<< "$proof_sources_text"
readonly -a proof_sources
sha256sum "${proof_sources[@]}" > "$evidence_root/proof-sources.sha256"

jq -e '
  .schemaVersion == 1
  and .platform == "linux/amd64"
  and .model == "nanosp"
  and .speculos.version == "0.26.9"
  and (.speculos.image | test("^ghcr\\.io/ledgerhq/speculos@sha256:[0-9a-f]{64}$"))
  and (.builder.image | test("^ghcr\\.io/ledgerhq/ledger-app-builder/ledger-app-builder-lite@sha256:[0-9a-f]{64}$"))
  and .bitcoinApp.version == "2.4.2"
  and (.bitcoinApp.sourceCommit | test("^[0-9a-f]{40}$"))
  and ([.bitcoinApp.sourceTarballSha256, .bitcoinApp.mainnetElfSha256,
        .bitcoinApp.testnetElfSha256] | all(test("^[0-9a-f]{64}$")))
  and .sdk.ledgerBitcoin == "0.3.1"
  and .sdk.webUsbTransport == "6.34.4"
' "$manifest" >/dev/null

cleanup_container=''
cleanup_container_registered=0
forwarder_pid=0
forwarder_terminal=''
forwarder_control_token=''
forwarder_control_port=''
forwarder_start_token=''
forwarder_gate_fd=''
proof_image_id=''
proof_image_registered=0

assert_registered_transient() {
  local container_id="$1"
  docker inspect "$container_id" | jq -e \
    --arg id "$container_id" --arg name "$container_name" --arg project "$SANCTUARY_PROJECT" \
    --arg deployment "$SANCTUARY_DEPLOYMENT_ID" --arg owner "$SANCTUARY_OWNER_ID" \
    --arg run "$SANCTUARY_OPERATION_RUN_ID" --arg created "$SANCTUARY_CLEANUP_CREATED_AT" \
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
      echo "Ledger container absence is ambiguous: $container_id (exit=$absence_status)" >&2
      return 1
    fi
    if [ "$identity_was_verified" -ne 1 ]; then
      echo "Ledger container disappeared before ownership was verified: $container_id" >&2
      return 1
    fi
    record_registered_transient_retirement "$container_id" "$evidence_name" already-absent
    return 0
  fi
  timeout --foreground --kill-after=5s 20s docker stop --timeout 5 "$container_id" >/dev/null \
    || stop_status=$?
  container_absence_proven "$container_id" || absence_status=$?
  if [ "$absence_status" -ne 0 ]; then
    echo "Daemon-atomic Ledger container removal is unproven: $container_id (stop=$stop_status, inspect=$absence_status)" >&2
    return 1
  fi
  record_registered_transient_retirement "$container_id" "$evidence_name" absent
}

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
  if [ -n "$cleanup_container" ]; then
    timeout --foreground --kill-after=5s 20s docker logs "$cleanup_container" \
      > "$diagnostics_dir/${cleanup_container}.log" 2>&1 || true
    retire_registered_transient \
      "$cleanup_container" failure "$cleanup_container_registered" || cleanup_status=$?
  fi
  if [ "$proof_image_registered" -eq 1 ]; then
    retire_exact_built_image "$image" "$proof_image_id" "$run_identity" || cleanup_status=$?
  fi
  final_status="$subject_status"
  if [ "$cleanup_status" -ne 0 ]; then
    echo "Ledger registered cleanup marker failed (exit=$cleanup_status)" >&2
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
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

export SANCTUARY_PROJECT='ledger-emulator-proof'
export SANCTUARY_PROJECT_DIR="$PROJECT_ROOT"
export SANCTUARY_OPERATION_RUN_ID="run-ledger-emulator-${run_identity}"
export SANCTUARY_RESOURCE_LIFECYCLE='obsolete'
ownership_label_args compose_container exact_delete
readonly -a container_ownership_labels=("${OWNERSHIP_LABEL_ARGS[@]}")

expected_ledger_version="$(jq -r '.sdk.ledgerBitcoin' "$manifest")"
expected_transport_version="$(jq -r '.sdk.webUsbTransport' "$manifest")"
locked_ledger_version="$(jq -r '.packages["node_modules/@ledgerhq/ledger-bitcoin"].version' package-lock.json)"
locked_transport_version="$(jq -r '.packages["node_modules/@ledgerhq/hw-transport-webusb"].version' package-lock.json)"
if [ "$expected_ledger_version" != "$locked_ledger_version" ] \
  || [ "$expected_transport_version" != "$locked_transport_version" ]; then
  echo 'Ledger SDK lockfile drift' >&2
  exit 1
fi

build_status=0
timeout --foreground --kill-after=30s 900s docker buildx build \
  --load \
  --platform "$(jq -r '.platform' "$manifest")" \
  --label "io.sanctuary.build-id=$run_identity" \
  --tag "$image" config/ledger-emulator || build_status=$?
if ! proof_image_id="$(recover_exact_loaded_image "$image" "$run_identity")"; then
  [ "$build_status" -eq 0 ] && exit 1
  exit "$build_status"
fi
register_exact_built_image "$image" "$proof_image_id"
proof_image_registered=1
[ "$build_status" -eq 0 ] || exit "$build_status"
docker image inspect "$image" > "$diagnostics_dir/image-inspect.json"

resolve_created_container() {
  local container_name="$1" cidfile="$2" create_status="$3"
  local cid_id='' recovered_id invalid_cidfile=false
  if [ -f "$cidfile" ]; then
    cid_id="$(tr -d '\r\n' < "$cidfile")"
    if ! [[ "$cid_id" =~ ^[0-9a-f]{64}$ ]]; then
      echo "Ledger emulator cidfile contains an invalid container ID" >&2
      cid_id=''
      invalid_cidfile=true
    fi
  fi
  recovered_id="$(recover_exact_created_container "$container_name")" || {
    [ "$create_status" -ne 0 ] && return "$create_status"
    return 1
  }
  if [ -n "$cid_id" ] && [ "$cid_id" != "$recovered_id" ]; then
    echo "Ledger emulator cidfile disagrees with the exact created container" >&2
    printf '%s\n' "$recovered_id"
    return 1
  fi
  printf '%s\n' "$recovered_id" > "$cidfile"
  printf '%s\n' "$recovered_id"
  [ "$invalid_cidfile" != true ] || return 1
}

run_network() {
  local network="$1"
  local app_name app_path container container_name cidfile create_output create_status resolve_status
  local forwarder_output apdu_port junit_path
  if [ "$network" = mainnet ]; then
    app_name='Bitcoin'
    app_path='/apps/bitcoin-2.4.2-nanosp.elf'
  else
    app_name='Bitcoin Test'
    app_path='/apps/bitcoin-test-2.4.2-nanosp.elf'
  fi
  container_name="sanctuary-ledger-proof-${network}-${run_identity}"
  case "$container_name" in
    sanctuary-ledger-proof-[A-Za-z0-9._-]*) ;;
    *) echo "Unsafe Ledger proof container name: $container" >&2; exit 1 ;;
  esac
  local automation_json
  automation_json="$(jq -c . config/ledger-emulator/automation.json)"
  cidfile="$evidence_root/container-${network}.cid"
  create_output="$evidence_root/container-${network}.create-output"
  create_status=0
  timeout --foreground --kill-after=10s 60s docker create --rm --cidfile "$cidfile" \
    --name "$container_name" \
    "${container_ownership_labels[@]}" \
    --platform linux/amd64 \
    "$image" \
    --model nanosp \
    --display headless \
    --automation "$automation_json" \
    --apdu-port 9999 \
    "$app_path" > "$create_output" || create_status=$?
  resolve_status=0
  container="$(resolve_created_container "$container_name" "$cidfile" "$create_status")" \
    || resolve_status=$?
  if [[ "$container" =~ ^[0-9a-f]{64}$ ]]; then
    cleanup_container="$container"
  else
    echo "Ledger emulator creation produced no durable container ID" >&2
    [ "$resolve_status" -ne 0 ] && exit "$resolve_status"
    exit 1
  fi
  assert_registered_transient "$container"
  register_owned_resource compose_container obsolete exact_delete engine_id \
    "$container" "$container" "$SANCTUARY_OPERATION_RUN_ID"
  cleanup_container_registered=1
  [ "$resolve_status" -eq 0 ] || exit "$resolve_status"
  [ "$create_status" -eq 0 ] || exit "$create_status"
  [ "$(tr -d '\r\n' < "$create_output")" = "$container" ] \
    || { echo "Ledger emulator create output disagrees with its durable container ID" >&2; exit 1; }
  timeout --foreground --kill-after=10s 60s docker start "$container" >/dev/null

  forwarder_output="$diagnostics_dir/forwarder-${network}.json"
  forwarder_control_token="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  forwarder_start_token="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  coproc SANCTUARY_FORWARDER {
    SANCTUARY_COLLECTOR_START_TOKEN="$forwarder_start_token" exec setsid node \
      --import "$SCRIPT_DIR/registered-start-gate.mjs" \
      "$SCRIPT_DIR/docker-exec-tcp-forwarder.mjs" \
      --container "$container" \
      --controller-port 9999 \
      --bridge-port 9999 \
      --control-token "$forwarder_control_token" > "$forwarder_output"
  }
  forwarder_pid=$SANCTUARY_FORWARDER_PID
  forwarder_gate_fd=${SANCTUARY_FORWARDER[1]}
  forwarder_output_fd=${SANCTUARY_FORWARDER[0]}
  exec {forwarder_output_fd}<&-
  register_forwarder "ledger-forwarder-$network"
  printf 'registered %s\n' "$forwarder_start_token" >&"$forwarder_gate_fd"
  exec {forwarder_gate_fd}>&-
  forwarder_gate_fd=''
  for _ in $(seq 1 100); do
    if [ -s "$forwarder_output" ] && jq -e \
      '.controllerPort > 0 and .controlPort > 0' "$forwarder_output" >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
  apdu_port="$(jq -er '.controllerPort' "$forwarder_output")"
  forwarder_control_port="$(jq -er '.controlPort' "$forwarder_output")"
  junit_path="$diagnostics_dir/junit-ledger-${network}.xml"
  LEDGER_EMULATOR_PROOF=1 \
  LEDGER_EMULATOR_HOST=127.0.0.1 \
  LEDGER_EMULATOR_APDU_PORT="$apdu_port" \
  LEDGER_EMULATOR_NETWORK="$network" \
  LEDGER_EMULATOR_APP_NAME="$app_name" \
  LEDGER_EMULATOR_APP_VERSION="$(jq -r '.bitcoinApp.version' "$manifest")" \
  LEDGER_EMULATOR_SPECULOS_VERSION="$(jq -r '.speculos.version' "$manifest")" \
  LEDGER_EMULATOR_JUNIT_PATH="$junit_path" \
    timeout --foreground --kill-after=30s 900s \
      npx vitest run --config config/tooling/vitest.ledger-emulator.config.ts

  finish_forwarder
  timeout --foreground --kill-after=5s 20s docker logs "$container" \
    > "$diagnostics_dir/${container}.log" 2>&1 || true
  retire_registered_transient "$container" "$network" "$cleanup_container_registered"
  cleanup_container=''
  cleanup_container_registered=0
}

readonly proof_networks="${LEDGER_EMULATOR_NETWORKS:-mainnet testnet}"
case " $proof_networks " in
  *' mainnet '*|*' testnet '*) ;;
  *) echo 'LEDGER_EMULATOR_NETWORKS must select mainnet and/or testnet' >&2; exit 1 ;;
esac
for proof_network in $proof_networks; do
  case "$proof_network" in
    mainnet|testnet) run_network "$proof_network" ;;
    *) echo "Unsupported Ledger proof network: $proof_network" >&2; exit 1 ;;
  esac
done
source_tree_state='clean'
if [ -n "$(git status --porcelain -- "${proof_sources[@]}")" ]; then
  source_tree_state='dirty'
fi
jq -n --arg status passed \
  --arg commit "$(git rev-parse HEAD)" \
  --arg sourceTreeState "$source_tree_state" \
  --arg appVersion "$(jq -r '.bitcoinApp.version' "$manifest")" \
  --arg speculosVersion "$(jq -r '.speculos.version' "$manifest")" \
  --arg imageId "$(docker image inspect --format '{{.Id}}' "$image")" \
  --arg packageLockSha256 "$(sha256sum package-lock.json | cut -d ' ' -f1)" \
  --arg sourceManifestSha256 "$(sha256sum "$evidence_root/proof-sources.sha256" | cut -d ' ' -f1)" \
  '{
    status: $status,
    commit: $commit,
    sourceTreeState: $sourceTreeState,
    appVersion: $appVersion,
    speculosVersion: $speculosVersion,
    imageId: $imageId,
    packageLockSha256: $packageLockSha256,
    sourceManifestSha256: $sourceManifestSha256
  }' \
  > "$evidence_root/summary.json"
