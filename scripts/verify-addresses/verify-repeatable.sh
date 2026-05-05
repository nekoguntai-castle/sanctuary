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
venv_dir="${VERIFY_ADDRESSES_VENV_DIR:-}"
rpc_user="${BITCOIN_RPC_USER:-verify}"
rpc_pass="${BITCOIN_RPC_PASS:-verify}"
started_bitcoind=0
created_python_venv=0

rpc_url="${BITCOIN_RPC_URL:-http://$(sanctuary_current_docker_published_host):18443}"

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  fi
}

cleanup() {
  if [[ "$created_python_venv" -eq 1 && -n "$venv_dir" && "${VERIFY_ADDRESSES_KEEP_PYTHON_VENV:-0}" != "1" ]]; then
    rm -rf "$venv_dir" || true
  fi
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

  local attempts="${VERIFY_ADDRESSES_PYTHON_INSTALL_ATTEMPTS:-3}"
  if [[ ! "$attempts" =~ ^[1-9][0-9]*$ ]]; then
    printf 'VERIFY_ADDRESSES_PYTHON_INSTALL_ATTEMPTS must be a positive integer\n' >&2
    exit 1
  fi

  local temp_parent="${VERIFY_ADDRESSES_VENV_PARENT:-}"
  if [ -z "$temp_parent" ]; then
    if [ -n "${RUNNER_TEMP:-}" ] || [ -n "${SANCTUARY_CI_TEMP_DIR_OVERRIDE:-}" ]; then
      temp_parent="$(ci_temp_dir)"
    else
      temp_parent="$repo_root/.tmp"
    fi
  fi
  mkdir -p "$temp_parent"

  local attempt status
  for attempt in $(seq 1 "$attempts"); do
    if [[ -z "${VERIFY_ADDRESSES_VENV_DIR:-}" ]]; then
      venv_dir="$(mktemp -d "$temp_parent/verify-addresses-python.XXXXXX")"
      created_python_venv=1
    else
      venv_dir="$VERIFY_ADDRESSES_VENV_DIR"
    fi

    printf 'Installing Python verifier dependencies, attempt %s\n' "$attempt"
    set +e
    install_python_dependencies_attempt "$attempt"
    status="$?"
    set -e

    if [[ "$status" -eq 0 ]]; then
      return
    fi

    if [[ "$created_python_venv" -eq 1 ]]; then
      rm -rf "$venv_dir" || true
      venv_dir=""
      created_python_venv=0
    fi

    if [[ "$attempt" -eq "$attempts" ]]; then
      exit "$status"
    fi

    sleep $((attempt * 10))
  done
}

install_python_dependencies_attempt() {
  local attempt="$1"
  local pip_flags=(--disable-pip-version-check)

  if [[ "$attempt" -gt 1 ]]; then
    pip_flags+=(--no-cache-dir)
  fi

  python3 -m venv --clear "$venv_dir" || return
  python_bin="$venv_dir/bin/python"
  "$python_bin" -m pip install "${pip_flags[@]}" --upgrade pip || return
  "$python_bin" -m pip install "${pip_flags[@]}" 'bip_utils==2.12.1' || return
  "$python_bin" -c 'import bip_utils; print(getattr(bip_utils, "__version__", "unknown"))' || return
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
