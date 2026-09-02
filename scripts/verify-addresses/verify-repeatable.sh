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
# shellcheck source=scripts/ci/provider-context.sh
source "$repo_root/scripts/ci/provider-context.sh"
# shellcheck source=scripts/ownership/producer-hooks.sh
source "$repo_root/scripts/ownership/producer-hooks.sh"

if [[ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]]; then
  cleanup_lane="address-$mode"
  exec "$repo_root/scripts/ci/cleanup-ci-callsite.sh" auto-run \
    --lane "$cleanup_lane" \
    --checkout-root "$repo_root" \
    -- "$script_dir/verify-repeatable.sh" "$mode"
fi

rpc_user=''
rpc_pass=''
core_identity=''
started_bitcoind=0
core_override_file=''
core_compose=()
python_image_id=''
python_iid_file=''
python_image_loaded=0
python_image_registered=0

published_host="$(sanctuary_current_docker_published_host)"
rpc_url_mainnet=''
rpc_url_testnet3=''
rpc_url_testnet4=''
rpc_url_signet=''
rpc_url_regtest=''
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

resolve_cleanup_image_id() {
  local cleanup_image_id="$python_image_id" listed invalid_iid=0
  if [[ -z "$cleanup_image_id" && -n "$python_iid_file" && -f "$python_iid_file" ]]; then
    cleanup_image_id="$(tr -d '\r\n' < "$python_iid_file")"
  fi
  if [[ -n "$cleanup_image_id" ]]; then
    if [[ "$cleanup_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      printf '%s\n' "$cleanup_image_id"
      return 0
    fi
    cleanup_image_id=''
    invalid_iid=1
  fi
  cleanup_image_id="$(docker image inspect --format '{{.Id}}' "$python_image" 2>/dev/null)" \
    || cleanup_image_id=''
  if [[ -n "$cleanup_image_id" ]]; then
    [[ "$cleanup_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
    printf '%s\n' "$cleanup_image_id"
    return 0
  fi
  listed="$(docker image ls --no-trunc --filter "reference=$python_image" --format '{{.ID}}')" \
    || return 1
  if [[ -z "$listed" ]]; then
    [[ "$invalid_iid" -eq 0 ]] || return 1
    return 0
  fi
  [[ "$listed" != *$'\n'* && "$listed" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' "$listed"
}

image_reference_is_absent() {
  local exact_reference="$1" exact_id="$2" listed observed
  if observed="$(docker image inspect --format '{{.Id}}' "$exact_reference" 2>/dev/null)"; then
    [[ "$observed" == "$exact_id" ]] || return 1
    return 1
  fi
  listed="$(docker image ls --no-trunc --filter "reference=$exact_reference" --format '{{.ID}}')" \
    || return 2
  while IFS= read -r observed; do
    [[ -z "$observed" ]] && continue
    [[ "$observed" =~ ^sha256:[0-9a-f]{64}$ ]] || return 2
    return 1
  done <<< "$listed"
}

register_python_image() {
  local image_registration_root
  image_registration_root="$(ci_temp_dir)/sanctuary-image-registrations/$SANCTUARY_OPERATION_RUN_ID"
  (
    SANCTUARY_OWNERSHIP_ROOT="$image_registration_root"
    export SANCTUARY_OWNERSHIP_ROOT
    register_owned_resource oci_image obsolete exact_delete name \
      "$python_image" "$python_image_id" "$SANCTUARY_OPERATION_RUN_ID"
  )
}

cleanup_python_image() {
  local cleanup_image_id='' removal_status=0 absence_status=0
  [[ "$python_image_loaded" -eq 1 ]] || return 0
  cleanup_image_id="$(resolve_cleanup_image_id)" || {
    printf 'Python verifier image identity is unavailable or ambiguous.\n' >&2
    return 1
  }
  if [[ -n "$python_iid_file" ]]; then
    rm -f "$python_iid_file" || true
  fi
  [[ -n "$cleanup_image_id" ]] || return 0
  if [[ "$python_image_registered" -eq 0 ]]; then
    python_image_id="$cleanup_image_id"
    register_python_image >/dev/null \
      || {
        printf 'Refusing unregistered Python verifier image cleanup: %s\n' "$cleanup_image_id" >&2
        return 1
      }
  fi
  # The run owns only its unique reference. The immutable image content may also
  # be retained by a shared base tag, so deleting by ID would cross that boundary.
  docker image rm "$python_image" >/dev/null 2>&1 || removal_status=$?
  image_reference_is_absent "$python_image" "$cleanup_image_id" || absence_status=$?
  if [[ "$absence_status" -ne 0 ]]; then
    printf 'Registered Python verifier image reference absence is unproven: %s at %s (exit=%s)\n' \
      "$python_image" "$cleanup_image_id" "$absence_status" >&2
    return 1
  fi
  if [[ "$removal_status" -ne 0 ]]; then
    printf 'Python verifier image removal failed even though exact absence reconciled: %s (exit=%s)\n' \
      "$cleanup_image_id" "$removal_status" >&2
    return 1
  fi
}

cleanup() {
  local subject_status=$? cleanup_status=0 final_status
  trap - EXIT
  cleanup_python_image || cleanup_status=$?
  if [[ "$started_bitcoind" -eq 1 && "${VERIFY_ADDRESSES_KEEP_BITCOIND:-0}" != "1" ]]; then
    printf 'Bitcoin Core resources are retained for receipt-bound coordinator cleanup.\n'
  fi
  [[ -z "$core_override_file" ]] || rm -f "$core_override_file"
  final_status="$subject_status"
  if [[ "$cleanup_status" -ne 0 ]]; then
    printf 'Address verifier registered cleanup failed (exit=%s).\n' "$cleanup_status" >&2
    [[ "$final_status" -ne 0 ]] || final_status="$cleanup_status"
  fi
  exit "$final_status"
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
  if [[ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]]; then
    export SANCTUARY_PROJECT="$(ownership_sanitize_id "$core_identity")"
    export SANCTUARY_OPERATION_RUN_ID="run-${identity_nonce}"
    export SANCTUARY_RESOURCE_LIFECYCLE='obsolete'
  fi
  ownership_initialize
}

prepare_core_compose() {
  core_override_file="$(mktemp "${TMPDIR:-/tmp}/sanctuary-address-core-ownership.XXXXXX.yml")"
  chmod 600 "$core_override_file"
  cat > "$core_override_file" <<'YAML'
x-sanctuary-container-ownership: &sanctuary-container-ownership
  io.sanctuary.project: ${SANCTUARY_PROJECT:?}
  io.sanctuary.deployment-id: ${SANCTUARY_DEPLOYMENT_ID:?}
  io.sanctuary.owner-id: ${SANCTUARY_OWNER_ID:?}
  io.sanctuary.resource-class: compose_container
  io.sanctuary.lifecycle: ${SANCTUARY_RESOURCE_LIFECYCLE:?}
  io.sanctuary.cleanup-policy: exact_delete
  io.sanctuary.created-at: ${SANCTUARY_CLEANUP_CREATED_AT:?}
  io.sanctuary.created-by-release: ${SANCTUARY_RELEASE:?}
  io.sanctuary.created-by-commit: ${SANCTUARY_COMMIT:?}
  io.sanctuary.creation-run-id: ${SANCTUARY_OPERATION_RUN_ID:?}
x-sanctuary-network-ownership: &sanctuary-network-ownership
  <<: *sanctuary-container-ownership
  io.sanctuary.resource-class: compose_network
services:
  core-mainnet:
    labels: *sanctuary-container-ownership
  core-testnet3:
    labels: *sanctuary-container-ownership
  core-testnet4:
    labels: *sanctuary-container-ownership
  core-signet:
    labels: *sanctuary-container-ownership
  core-regtest:
    labels: *sanctuary-container-ownership
networks:
  default:
    labels: *sanctuary-network-ownership
YAML
  core_compose=(docker compose -f "$script_dir/docker-compose.yml" -f "$core_override_file")
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
  register_python_image
  python_image_registered=1
}

start_bitcoin_core() {
  require_command docker
  prepare_core_compose
  started_bitcoind=1
  "${core_compose[@]}" up -d --pull always
  assert_pinned_core_containers
  resolve_core_rpc_urls
}

resolve_published_rpc_url() {
  local service="$1" mapping port url_host
  mapping="$("${core_compose[@]}" port "$service" 18443)"
  if [[ -z "$mapping" || "$mapping" == *$'\n'* ]]; then
    printf 'Bitcoin Core service %s has an unavailable or ambiguous RPC mapping\n' "$service" >&2
    return 1
  fi
  port="${mapping##*:}"
  if [[ ! "$port" =~ ^[0-9]+$ || "$port" -lt 1 || "$port" -gt 65535 ]]; then
    printf 'Bitcoin Core service %s returned an invalid RPC mapping: %s\n' \
      "$service" "$mapping" >&2
    return 1
  fi
  url_host="$published_host"
  if [[ "$url_host" == *:* && "$url_host" != \[*\] ]]; then
    url_host="[$url_host]"
  fi
  printf 'http://%s:%s\n' "$url_host" "$port"
}

resolve_core_rpc_urls() {
  rpc_url_mainnet="$(resolve_published_rpc_url core-mainnet)"
  rpc_url_testnet3="$(resolve_published_rpc_url core-testnet3)"
  rpc_url_testnet4="$(resolve_published_rpc_url core-testnet4)"
  rpc_url_signet="$(resolve_published_rpc_url core-signet)"
  rpc_url_regtest="$(resolve_published_rpc_url core-regtest)"
}

assert_pinned_core_containers() {
  local service container_id configured_image configured_command
  for service in core-mainnet core-testnet3 core-testnet4 core-signet core-regtest; do
    container_id="$("${core_compose[@]}" ps -q "$service")"
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
    "${core_compose[@]}" logs
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
