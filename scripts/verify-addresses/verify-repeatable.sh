#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s [verify|generate]\n' "${0##*/}" >&2
}

mode="${1:-verify}"
if [[ "$mode" != "verify" && "$mode" != "generate" ]]; then
  usage
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
# shellcheck source=scripts/ci/docker-endpoint-lib.sh
source "$repo_root/scripts/ci/docker-endpoint-lib.sh"
rpc_user=''
rpc_pass=''
core_identity=''
started_bitcoind=0
python_image_id=''
python_iid_file=''
python_image_loaded=0

published_host="$(sanctuary_current_docker_published_host)"
rpc_url_mainnet="http://${published_host}:19440"
rpc_url_testnet3="http://${published_host}:19441"
rpc_url_testnet4="http://${published_host}:19442"
rpc_url_signet="http://${published_host}:19443"
rpc_url_regtest="http://${published_host}:19444"
core_image='bitcoin/bitcoin:29.0@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78'
core_canonical_image="docker.io/bitcoin/bitcoin@${core_image##*@}"
pinned_node_version='24.19.0'
pinned_go_version='go1.25.13'
python_image_base='sanctuary/verify-addresses-python:3.13.5-bip-utils-2.12.1-v1'
python_image=''

reject_external_core_configuration() {
  local variable
  for variable in \
    VERIFY_ADDRESSES_SKIP_DOCKER \
    VERIFY_ADDRESSES_SKIP_NPM_CI \
    VERIFY_ADDRESSES_CORE_IDENTITY \
    BITCOIN_RPC_USER BITCOIN_RPC_PASS \
    BITCOIN_RPC_PORT_MAINNET BITCOIN_RPC_PORT_TESTNET3 BITCOIN_RPC_PORT_TESTNET4 \
    BITCOIN_RPC_PORT_SIGNET BITCOIN_RPC_PORT_REGTEST \
    BITCOIN_RPC_URL_MAINNET BITCOIN_RPC_URL_TESTNET3 BITCOIN_RPC_URL_TESTNET4 \
    BITCOIN_RPC_URL_SIGNET BITCOIN_RPC_URL_REGTEST; do
    if [[ -v "$variable" ]]; then
      printf '%s is not supported by the pinned address verifier\n' "$variable" >&2
      exit 1
    fi
  done
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "$python_iid_file" ]]; then
    rm -f "$python_iid_file" || true
  fi
  if [[ "$python_image_loaded" -eq 1 ]]; then
    docker image rm "$python_image" >/dev/null 2>&1 || true
  fi
  if [[ "$started_bitcoind" -eq 1 && "${VERIFY_ADDRESSES_KEEP_BITCOIND:-0}" != "1" ]]; then
    docker compose -f "$script_dir/docker-compose.yml" down
  fi
}

install_node_dependencies() {
  local bootstrap_node_version
  bootstrap_node_version="$(node -p 'process.versions.node')"
  if [[ "$bootstrap_node_version" != 24.* ]]; then
    printf 'Bootstrap Node runtime is %s, expected major 24\n' "$bootstrap_node_version" >&2
    exit 1
  fi
  npm --prefix "$script_dir" ci --strict-allow-scripts
  verifier_node="$script_dir/node_modules/.bin/node"
  if [[ ! -x "$verifier_node" ]]; then
    printf 'Locked verifier Node runtime is missing: %s\n' "$verifier_node" >&2
    exit 1
  fi
  if [[ "$("$verifier_node" -p 'process.versions.node')" != "$pinned_node_version" ]]; then
    printf 'Locked verifier Node runtime does not match %s\n' "$pinned_node_version" >&2
    exit 1
  fi
  PATH="$(dirname "$verifier_node"):$PATH"
  export PATH
  hash -r
}

generate_rpc_credentials() {
  local credential_nonce identity_nonce
  credential_nonce="$("$verifier_node" -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
  identity_nonce="$("$verifier_node" -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
  if [[ ! "$credential_nonce" =~ ^[0-9a-f]{64}$ || ! "$identity_nonce" =~ ^[0-9a-f]{64}$ ]]; then
    printf 'Failed to generate per-run Bitcoin Core credentials\n' >&2
    exit 1
  fi
  rpc_user="verify_${credential_nonce:0:16}"
  rpc_pass="${credential_nonce:16}"
  core_identity="sanctuary-verify-$identity_nonce"
  python_image="${python_image_base}-${identity_nonce}"
  export BITCOIN_RPC_USER="$rpc_user"
  export BITCOIN_RPC_PASS="$rpc_pass"
  export VERIFY_ADDRESSES_CORE_IDENTITY="$core_identity"
}

build_python_verifier() {
  local buildx_version
  require_command docker
  if ! buildx_version="$(docker buildx version 2>&1)"; then
    printf 'Docker Buildx is required for immutable verifier image loading: %s\n' "$buildx_version" >&2
    exit 1
  fi
  printf 'Using Docker Buildx: %s\n' "$buildx_version"
  python_iid_file="$(mktemp)"
  # The tag is unique to this invocation, so cleanup owns it even when Buildx
  # loads the image but reports a late export/finalization failure.
  python_image_loaded=1
  docker buildx build --pull \
    --load \
    --file "$script_dir/python-verifier.Dockerfile" \
    --tag "$python_image" \
    --iidfile "$python_iid_file" \
    "$script_dir"
  python_image_id="$(tr -d '\r\n' < "$python_iid_file")"
  if [[ ! "$python_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    printf 'Python verifier build returned invalid image ID: %s\n' "$python_image_id" >&2
    exit 1
  fi
}

start_bitcoin_core() {
  require_command docker
  started_bitcoind=1
  docker compose -f "$script_dir/docker-compose.yml" up -d --pull always
  assert_pinned_core_containers
}

assert_pinned_core_containers() {
  local service container_id configured_image configured_command
  for service in core-mainnet core-testnet3 core-testnet4 core-signet core-regtest; do
    container_id="$(docker compose -f "$script_dir/docker-compose.yml" ps -q "$service")"
    if [[ -z "$container_id" ]]; then
      printf 'Pinned Bitcoin Core service %s has no container\n' "$service" >&2
      exit 1
    fi
    configured_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
    # Docker may canonicalize the Docker Hub repository and omit the tag when
    # a digest is present. Accept only that exact normalization or the literal
    # Compose reference; repository and digest remain fail-closed.
    if [[ "$configured_image" != "$core_image" && "$configured_image" != "$core_canonical_image" ]]; then
      printf 'Bitcoin Core service %s uses %s, expected %s (or canonical %s)\n' \
        "$service" "$configured_image" "$core_image" "$core_canonical_image" >&2
      exit 1
    fi
    configured_command="$(docker inspect --format '{{json .Config.Cmd}}' "$container_id")"
    if [[ "$configured_command" != *"-uacomment=$core_identity"* ]]; then
      printf 'Bitcoin Core service %s is missing the per-run identity binding\n' "$service" >&2
      exit 1
    fi
  done
}

wait_for_bitcoin_core() {
  local environment="$1"
  local rpc_url="$2"
  local expected_chain="$3"
  local response='' identity_response=''

  require_command curl

  printf 'Waiting for Bitcoin Core %s RPC at %s\n' "$environment" "$rpc_url"
  for attempt in $(seq 1 60); do
    # Bounded per attempt. Without these the 60-attempt loop is not a 120s
    # ceiling at all: a port that accepts the connection and never answers --
    # exactly what a wrong published host gives you -- blocks curl forever, so
    # the wait dies on the step timeout having made three attempts.
    if response="$(curl -fsS \
      --connect-timeout 3 \
      --max-time 5 \
      --user "$rpc_user:$rpc_pass" \
      --data-binary '{"jsonrpc":"1.0","method":"getblockchaininfo","params":[]}' \
      "$rpc_url/" 2>/dev/null)"; then
      if [[ "$response" == *"\"chain\":\"$expected_chain\""* ]]; then
        if identity_response="$(curl -fsS \
          --connect-timeout 3 \
          --max-time 5 \
          --user "$rpc_user:$rpc_pass" \
          --data-binary '{"jsonrpc":"1.0","method":"getnetworkinfo","params":[]}' \
          "$rpc_url/" 2>/dev/null)" \
          && [[ "$identity_response" == *"($core_identity)"* ]]; then
          printf 'Bitcoin Core %s RPC is ready and bound to this run (reported chain: %s).\n' \
            "$environment" "$expected_chain"
          return
        fi
        printf 'Bitcoin Core %s did not return this run identity.\n' "$environment" >&2
      else
        printf 'Bitcoin Core %s returned the wrong chain; expected %s.\n' "$environment" "$expected_chain" >&2
      fi
    fi

    printf 'Waiting for %s... (%s/60)\n' "$environment" "$attempt"
    sleep 2
  done

  if [[ "$started_bitcoind" -eq 1 ]]; then
    docker compose -f "$script_dir/docker-compose.yml" logs
  fi
  printf 'Bitcoin Core %s RPC did not become ready on the expected chain.\n' "$environment" >&2
  exit 1
}

wait_for_all_bitcoin_core_chains() {
  wait_for_bitcoin_core mainnet "$rpc_url_mainnet" main
  wait_for_bitcoin_core testnet3 "$rpc_url_testnet3" test
  wait_for_bitcoin_core testnet4 "$rpc_url_testnet4" testnet4
  wait_for_bitcoin_core signet "$rpc_url_signet" signet
  wait_for_bitcoin_core regtest "$rpc_url_regtest" regtest
}

run_verifier() {
  local npm_script="$mode"

  (
    cd "$script_dir"
    BITCOIN_RPC_URL_MAINNET="$rpc_url_mainnet" \
      BITCOIN_RPC_URL_TESTNET3="$rpc_url_testnet3" \
      BITCOIN_RPC_URL_TESTNET4="$rpc_url_testnet4" \
      BITCOIN_RPC_URL_SIGNET="$rpc_url_signet" \
      BITCOIN_RPC_URL_REGTEST="$rpc_url_regtest" \
      BITCOIN_RPC_USER="$rpc_user" \
      BITCOIN_RPC_PASS="$rpc_pass" \
      VERIFY_ADDRESSES_CORE_IMAGE="$core_image" \
      VERIFY_ADDRESSES_CORE_PROVENANCE_MODE=pinned-compose \
      VERIFY_ADDRESSES_PYTHON_IMAGE_ID="$python_image_id" \
      VERIFY_ADDRESSES_PYTHON_PROVENANCE_MODE=local-iid \
      npm run "$npm_script"
  )
}

assert_go_runtime() {
  local actual_go_version
  actual_go_version="$(cd "$script_dir/implementations" && go env GOVERSION)"
  if [[ "$actual_go_version" != "$pinned_go_version" ]]; then
    printf 'Go runtime is %s, expected %s\n' "$actual_go_version" "$pinned_go_version" >&2
    exit 1
  fi
}

trap cleanup EXIT

reject_external_core_configuration
assert_go_runtime
install_node_dependencies
generate_rpc_credentials
build_python_verifier
start_bitcoin_core
wait_for_all_bitcoin_core_chains
run_verifier
