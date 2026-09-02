#!/usr/bin/env bash
# One receipt-bound lifetime for the pinned Bitcoin Core PSBT proof container.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
mode="${1:-}"
case "$mode" in live|regenerate) ;; *) echo 'run-psbt-core-subject: expected live or regenerate' >&2; exit 2 ;; esac
[ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = 1 ] && [ -n "${SANCTUARY_OWNERSHIP_ROOT:-}" ] || {
  echo 'PSBT Core subject requires the signed cleanup coordinator' >&2
  exit 2
}
: "${VERIFY_PSBT_CORE_IMAGE:?VERIFY_PSBT_CORE_IMAGE is required}"
: "${DIAGNOSTIC_DIR:?DIAGNOSTIC_DIR is required}"

# shellcheck source=scripts/ownership/producer-hooks.sh
source "$PROJECT_ROOT/scripts/ownership/producer-hooks.sh"
# shellcheck source=scripts/ci/provider-context.sh
source "$SCRIPT_DIR/provider-context.sh"
SANCTUARY_PROJECT_DIR="$PROJECT_ROOT"
export SANCTUARY_PROJECT_DIR
ownership_label_args compose_container exact_delete

container_name="${COMPOSE_PROJECT_NAME}-bitcoin-core"
cidfile="$(ci_temp_dir)/${container_name}.cid"

create_core() {
  local create_status=0 create_output durable_id='' durable_status=0 recovered_id register_status=0
  [ ! -e "$cidfile" ] || { echo 'PSBT Core cidfile already exists before create' >&2; return 1; }
  docker pull "$VERIFY_PSBT_CORE_IMAGE" >&2
  # The signed coordinator is the sole cleanup authority for this container.
  # Docker --rm would race the approved stop -> remove sequence by introducing
  # an independent daemon-side remover as soon as the stop completes.
  create_output="$(docker create --cidfile "$cidfile" --name "$container_name" -p 18443/tcp \
    "${OWNERSHIP_LABEL_ARGS[@]}" "$VERIFY_PSBT_CORE_IMAGE" \
    -regtest=1 -server=1 -rpcuser=sanctuary -rpcpassword=sanctuary-verify \
    -rpcallowip=0.0.0.0/0 -rpcbind=0.0.0.0 -fallbackfee=0.00001 \
    -txindex=1 -printtoconsole=1)" || create_status=$?
  if [ -f "$cidfile" ]; then
    durable_id="$(tr -d '\r\n' < "$cidfile")"
    [[ "$durable_id" =~ ^[0-9a-f]{64}$ ]] || durable_status=1
  else
    durable_status=1
  fi

  # Neither stdout nor the cidfile is authority. Reinspect the exact name and
  # full immutable ownership tuple on both normal and response-loss paths, then
  # durably arm the coordinator/local diagnostics with only that verified ID.
  recovered_id="$(recover_exact_created_container "$container_name")" || {
    [ "$create_status" -ne 0 ] && return "$create_status"
    return 1
  }
  printf '%s\n' "$recovered_id" > "$cidfile"
  register_owned_resource compose_container obsolete exact_delete engine_id \
    "$recovered_id" "$recovered_id" "$SANCTUARY_OPERATION_RUN_ID" || register_status=$?
  if [ "$register_status" -ne 0 ]; then
    printf '%s\n' "$recovered_id"
    return "$register_status"
  fi
  [ "$create_status" -eq 0 ] || return "$create_status"
  [ "$durable_status" -eq 0 ] \
    || { echo 'PSBT Core create did not write a valid durable cidfile' >&2; return 1; }
  [ "$durable_id" = "$recovered_id" ] \
    || { echo 'PSBT Core cidfile did not bind the verified created ID' >&2; return 1; }
  [ "$create_output" = "$recovered_id" ] \
    || { echo 'PSBT Core create output did not bind the verified created ID' >&2; return 1; }
  printf '%s\n' "$recovered_id"
}

attest_and_start_core() {
  local container_id="$1" expected_image_id actual_image_id expected_digest
  expected_image_id="$(docker image inspect "$VERIFY_PSBT_CORE_IMAGE" --format '{{.Id}}')"
  actual_image_id="$(docker inspect "$container_id" --format '{{.Image}}')"
  [ "$actual_image_id" = "$expected_image_id" ] || {
    echo "Bitcoin Core image drift: expected ID $expected_image_id, received $actual_image_id" >&2
    return 1
  }
  expected_digest="${VERIFY_PSBT_CORE_IMAGE##*@}"
  docker image inspect "$VERIFY_PSBT_CORE_IMAGE" --format '{{join .RepoDigests "\n"}}' \
    | grep -Fq "@$expected_digest" || {
      echo "Pulled Bitcoin Core image does not attest expected digest $expected_digest" >&2
      return 1
    }
  docker start "$container_id" >/dev/null
}

wait_for_core() {
  local container_id="$1" rpc_port="$2" rpc_url attempt
  # gitleaks:allow -- fixed credential for the isolated, disposable regtest node only.
  local rpc_auth='sanctuary:sanctuary-verify'
  rpc_url="http://${SANCTUARY_DOCKER_PUBLISHED_HOST:-127.0.0.1}:$rpc_port/"
  for attempt in $(seq 1 60); do
    if curl -fsS --user "$rpc_auth" \
      --data-binary '{"jsonrpc":"1.0","id":"readiness","method":"getnetworkinfo","params":[]}' \
      "$rpc_url" >/dev/null; then return 0; fi
    sleep 2
  done
  echo 'Pinned Bitcoin Core did not become ready' >&2
  docker logs "$container_id" >&2 || true
  return 1
}

run_live_proof() {
  (cd "$PROJECT_ROOT/scripts/verify-psbt" && \
    BITCOIN_RPC_HOST="${SANCTUARY_DOCKER_PUBLISHED_HOST:-127.0.0.1}" BITCOIN_RPC_PORT="$rpc_port" \
    BITCOIN_RPC_USER=sanctuary BITCOIN_RPC_PASS=sanctuary-verify \
    VERIFY_PSBT_CORE_PROVENANCE_MODE=pinned-container \
    "$SCRIPT_DIR/run-with-log.sh" "$DIAGNOSTIC_DIR/live-psbt-proof.log" \
    "$SCRIPT_DIR/with-runner-lock.sh" node-toolchain bash -c '
      set -euo pipefail
      npm run generate
      npm run generate:signed
      npm run verify
      git -C "$SANCTUARY_PROJECT_DIR" diff --exit-code -- server/tests/fixtures/generated-psbt-vectors.ts server/tests/fixtures/generated-signed-psbt-vectors.ts
    ')
  (cd "$PROJECT_ROOT/server" && "$SCRIPT_DIR/run-with-log.sh" \
    "$DIAGNOSTIC_DIR/live-psbt-replay-tests.log" "$SCRIPT_DIR/with-runner-lock.sh" \
    node-toolchain npm run test:run:ci -- tests/unit/services/bitcoin/psbt.verified.test.ts \
    tests/unit/services/bitcoin/psbt.signed-vectors.test.ts)
}

run_regenerate_proof() {
  (cd "$PROJECT_ROOT/scripts/verify-psbt" && \
    BITCOIN_RPC_HOST="${SANCTUARY_DOCKER_PUBLISHED_HOST:-127.0.0.1}" BITCOIN_RPC_PORT="$rpc_port" \
    BITCOIN_RPC_USER=sanctuary BITCOIN_RPC_PASS=sanctuary-verify \
    VERIFY_PSBT_CORE_PROVENANCE_MODE=pinned-container \
    "$SCRIPT_DIR/run-with-log.sh" "$DIAGNOSTIC_DIR/generate-psbt-vectors.log" \
    "$SCRIPT_DIR/with-runner-lock.sh" node-toolchain npm run generate && \
    BITCOIN_RPC_HOST="${SANCTUARY_DOCKER_PUBLISHED_HOST:-127.0.0.1}" BITCOIN_RPC_PORT="$rpc_port" \
    BITCOIN_RPC_USER=sanctuary BITCOIN_RPC_PASS=sanctuary-verify \
    VERIFY_PSBT_CORE_PROVENANCE_MODE=pinned-container \
    "$SCRIPT_DIR/run-with-log.sh" "$DIAGNOSTIC_DIR/generate-signed-psbt-vectors.log" \
    "$SCRIPT_DIR/with-runner-lock.sh" node-toolchain npm run generate:signed && \
    "$SCRIPT_DIR/run-with-log.sh" "$DIAGNOSTIC_DIR/verify-generated-psbt-vectors.log" \
    "$SCRIPT_DIR/with-runner-lock.sh" node-toolchain npm run verify)
  git -C "$PROJECT_ROOT" diff -- server/tests/fixtures/generated-psbt-vectors.ts \
    server/tests/fixtures/generated-signed-psbt-vectors.ts || true
  (cd "$PROJECT_ROOT/server" && "$SCRIPT_DIR/run-with-log.sh" \
    "$DIAGNOSTIC_DIR/run-psbt-vector-tests.log" "$SCRIPT_DIR/with-runner-lock.sh" node-toolchain \
    npm run test:run:ci -- tests/unit/services/bitcoin/psbt.verified.test.ts \
    tests/unit/services/bitcoin/psbt.signed-vectors.test.ts)
}

container_id="$(create_core)"
attest_and_start_core "$container_id"
rpc_port="$(docker inspect "$container_id" --format '{{(index (index .NetworkSettings.Ports "18443/tcp") 0).HostPort}}')"
case "$rpc_port" in ''|*[!0-9]*) echo "Invalid Bitcoin Core RPC port: $rpc_port" >&2; exit 1 ;; esac
export VERIFY_PSBT_CORE_PROVENANCE_MODE=pinned-container BITCOIN_RPC_PORT="$rpc_port"
wait_for_core "$container_id" "$rpc_port"
if [ "$mode" = live ]; then run_live_proof; else run_regenerate_proof; fi
