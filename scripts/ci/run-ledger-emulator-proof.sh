#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

readonly manifest='config/ledger-emulator/proof.json'
readonly image='sanctuary-ledger-emulator:proof'
readonly run_id="$(ci_run_id)"
readonly run_attempt="${SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE:-0}"
readonly run_identity="${run_id}-${run_attempt}-$$"
readonly evidence_root="$(ci_workspace)/.tmp/ci-evidence/ledger-emulator/${run_identity}"
readonly diagnostics_dir="$evidence_root/diagnostics"
mkdir -p "$diagnostics_dir"
readonly ci_environment_file="$(ci_env_file)"
if [ "$ci_environment_file" != '/dev/stdout' ]; then
  ci_emit_env \
    "LEDGER_EMULATOR_PROOF_DIR=$evidence_root" \
    "LEDGER_EMULATOR_DIAGNOSTICS_DIR=$diagnostics_dir"
fi

readonly -a proof_sources=(
  package-lock.json
  config/ledger-emulator/Dockerfile
  config/ledger-emulator/automation.json
  config/ledger-emulator/proof.json
  config/tooling/vitest.ledger-emulator.config.ts
  scripts/ci/docker-exec-tcp-forwarder.mjs
  scripts/ci/run-ledger-emulator-proof.sh
  src/services/hardwareWallet/adapters/ledger/ledgerAdapter.ts
  src/services/hardwareWallet/adapters/ledger/session.ts
  src/services/hardwareWallet/adapters/ledger/signPsbt.ts
  src/services/hardwareWallet/adapters/ledger/walletPolicy.ts
  tests/integration/ledgerEmulator.integration.test.ts
  tests/integration/ledgerEmulator/fixtures.ts
  .github/workflows/verify-vectors.yml
)
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
forwarder_pid=0
cleanup() {
  local status=$?
  if [ "$forwarder_pid" -ne 0 ]; then
    kill "$forwarder_pid" >/dev/null 2>&1 || true
    wait "$forwarder_pid" >/dev/null 2>&1 || true
    forwarder_pid=0
  fi
  if [ -n "$cleanup_container" ]; then
    timeout --foreground --kill-after=5s 20s docker logs "$cleanup_container" \
      > "$diagnostics_dir/${cleanup_container}.log" 2>&1 || true
    timeout --foreground --kill-after=5s 20s docker stop --timeout 5 "$cleanup_container" \
      >/dev/null 2>&1 || true
    timeout --foreground --kill-after=5s 20s docker rm "$cleanup_container" \
      >/dev/null 2>&1 || true
  fi
  return "$status"
}
trap cleanup EXIT INT TERM

expected_ledger_version="$(jq -r '.sdk.ledgerBitcoin' "$manifest")"
expected_transport_version="$(jq -r '.sdk.webUsbTransport' "$manifest")"
locked_ledger_version="$(jq -r '.packages["node_modules/@ledgerhq/ledger-bitcoin"].version' package-lock.json)"
locked_transport_version="$(jq -r '.packages["node_modules/@ledgerhq/hw-transport-webusb"].version' package-lock.json)"
if [ "$expected_ledger_version" != "$locked_ledger_version" ] \
  || [ "$expected_transport_version" != "$locked_transport_version" ]; then
  echo 'Ledger SDK lockfile drift' >&2
  exit 1
fi

timeout --foreground --kill-after=30s 900s docker buildx build \
  --load \
  --platform "$(jq -r '.platform' "$manifest")" \
  --tag "$image" config/ledger-emulator
docker image inspect "$image" > "$diagnostics_dir/image-inspect.json"

run_network() {
  local network="$1"
  local app_name app_path container forwarder_output apdu_port junit_path
  if [ "$network" = mainnet ]; then
    app_name='Bitcoin'
    app_path='/apps/bitcoin-2.4.2-nanosp.elf'
  else
    app_name='Bitcoin Test'
    app_path='/apps/bitcoin-test-2.4.2-nanosp.elf'
  fi
  container="sanctuary-ledger-proof-${network}-${run_identity}"
  case "$container" in
    sanctuary-ledger-proof-[A-Za-z0-9._-]*) ;;
    *) echo "Unsafe Ledger proof container name: $container" >&2; exit 1 ;;
  esac
  cleanup_container="$container"
  local automation_json
  automation_json="$(jq -c . config/ledger-emulator/automation.json)"
  timeout --foreground --kill-after=10s 60s docker run --detach \
    --name "$container" \
    --platform linux/amd64 \
    "$image" \
    --model nanosp \
    --display headless \
    --automation "$automation_json" \
    --apdu-port 9999 \
    "$app_path" >/dev/null

  forwarder_output="$diagnostics_dir/forwarder-${network}.json"
  node scripts/ci/docker-exec-tcp-forwarder.mjs \
    --container "$container" \
    --controller-port 9999 \
    --bridge-port 9999 > "$forwarder_output" &
  forwarder_pid=$!
  for _ in $(seq 1 100); do
    [ -s "$forwarder_output" ] && break
    kill -0 "$forwarder_pid" >/dev/null 2>&1 || break
    sleep 0.1
  done
  apdu_port="$(jq -er '.controllerPort' "$forwarder_output")"
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

  kill "$forwarder_pid" >/dev/null 2>&1 || true
  wait "$forwarder_pid" >/dev/null 2>&1 || true
  forwarder_pid=0
  timeout --foreground --kill-after=5s 20s docker logs "$container" \
    > "$diagnostics_dir/${container}.log" 2>&1 || true
  timeout --foreground --kill-after=5s 20s docker stop --timeout 5 "$container" >/dev/null
  timeout --foreground --kill-after=5s 20s docker rm "$container" >/dev/null
  cleanup_container=''
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
