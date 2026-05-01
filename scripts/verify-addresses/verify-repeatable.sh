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
venv_dir="${VERIFY_ADDRESSES_VENV_DIR:-$repo_root/.tmp/verify-addresses-python}"
rpc_url="${BITCOIN_RPC_URL:-http://127.0.0.1:18443}"
rpc_user="${BITCOIN_RPC_USER:-verify}"
rpc_pass="${BITCOIN_RPC_PASS:-verify}"
started_bitcoind=0

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  fi
}

cleanup() {
  if [[ "$started_bitcoind" -eq 1 && "${VERIFY_ADDRESSES_KEEP_BITCOIND:-0}" != "1" ]]; then
    docker compose -f "$script_dir/docker-compose.yml" down
  fi
}

install_node_dependencies() {
  if [[ "${VERIFY_ADDRESSES_SKIP_NPM_CI:-0}" == "1" ]]; then
    return
  fi

  npm --prefix "$script_dir" ci
}

install_python_dependencies() {
  if [[ -n "${VERIFY_ADDRESSES_PYTHON:-}" ]]; then
    python_bin="$VERIFY_ADDRESSES_PYTHON"
    return
  fi

  require_command python3
  python3 -m venv "$venv_dir"
  python_bin="$venv_dir/bin/python"
  "$python_bin" -m pip install --upgrade pip
  "$python_bin" -m pip install 'bip_utils==2.12.1'
}

start_bitcoin_core() {
  if [[ "${VERIFY_ADDRESSES_SKIP_DOCKER:-0}" == "1" ]]; then
    return
  fi

  require_command docker
  docker compose -f "$script_dir/docker-compose.yml" up -d
  started_bitcoind=1
}

wait_for_bitcoin_core() {
  require_command curl

  printf 'Waiting for Bitcoin Core RPC at %s\n' "$rpc_url"
  for attempt in $(seq 1 60); do
    if curl -fsS \
      --user "$rpc_user:$rpc_pass" \
      --data-binary '{"jsonrpc":"1.0","method":"getblockchaininfo","params":[]}' \
      "$rpc_url/" >/dev/null 2>&1; then
      printf 'Bitcoin Core RPC is ready.\n'
      return
    fi

    printf 'Waiting... (%s/60)\n' "$attempt"
    sleep 2
  done

  if [[ "$started_bitcoind" -eq 1 ]]; then
    docker compose -f "$script_dir/docker-compose.yml" logs bitcoind
  fi
  printf 'Bitcoin Core RPC did not become ready.\n' >&2
  exit 1
}

run_verifier() {
  local npm_script="$mode"

  (
    cd "$script_dir"
    BITCOIN_RPC_URL="$rpc_url" \
      BITCOIN_RPC_USER="$rpc_user" \
      BITCOIN_RPC_PASS="$rpc_pass" \
      VERIFY_ADDRESSES_PYTHON="$python_bin" \
      npm run "$npm_script"
  )
}

python_bin=""
trap cleanup EXIT

install_node_dependencies
install_python_dependencies
start_bitcoin_core
wait_for_bitcoin_core
run_verifier
