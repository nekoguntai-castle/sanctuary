#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/bitcoin/mine-to-address.sh --address ADDRESS [options]

Options:
  --address ADDRESS       Required mining payout address.
  --blocks COUNT          Number of spend-target blocks to mine. Default: 1.
  --mature                Mine 100 additional blocks so the requested block
                          count has mature coinbase outputs.
  --network NETWORK       regtest, testnet, testnet4, or signet. Default: regtest.
  --maxtries COUNT        Optional maxtries argument for generatetoaddress.
  --container NAME        Run bitcoin-cli through docker exec NAME.
  --cli PATH              bitcoin-cli executable. Default: bitcoin-cli.
  --rpcuser USER          bitcoin-cli -rpcuser value.
  --rpcpassword PASS      bitcoin-cli -rpcpassword value.
  --rpcconnect HOST       bitcoin-cli -rpcconnect value.
  --rpcport PORT          bitcoin-cli -rpcport value.
  --skip-validate         Skip validateaddress before mining.
  --dry-run               Print the command that would run.
  -h, --help              Show this help.

Environment:
  BITCOIN_NETWORK, BITCOIN_CLI, BITCOIN_CONTAINER, BITCOIN_RPC_USER,
  BITCOIN_RPC_PASSWORD, BITCOIN_RPC_CONNECT, BITCOIN_RPC_PORT.

Notes:
  This is intended first for local regtest nodes. Public testnet/testnet4
  mining still requires real proof of work; use a faucet or mining software
  configured with your payout address if your node cannot generate blocks.
USAGE
}

fail() {
  echo "error: $*" >&2
  exit 1
}

is_positive_integer() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    0) return 1 ;;
    *) return 0 ;;
  esac
}

network_flag() {
  case "$1" in
    regtest) printf '%s\n' '-regtest' ;;
    testnet) printf '%s\n' '-testnet' ;;
    testnet4) printf '%s\n' '-testnet4' ;;
    signet) printf '%s\n' '-signet' ;;
    *) fail "unsupported network '$1'; expected regtest, testnet, testnet4, or signet" ;;
  esac
}

append_rpc_flag() {
  local -n target="$1"
  local name="$2"
  local value="$3"

  if [ -n "$value" ]; then
    target+=("-${name}=${value}")
  fi
}

quote_command() {
  local first=1
  local arg

  for arg in "$@"; do
    if [ "$first" -eq 0 ]; then
      printf ' '
    fi
    printf '%q' "$arg"
    first=0
  done
  printf '\n'
}

run_cli() {
  if [ "$DRY_RUN" -eq 1 ]; then
    quote_command "${CLI_CMD[@]}" "$@"
    return 0
  fi

  "${CLI_CMD[@]}" "$@"
}

ADDRESS=''
BLOCKS=1
MATURE=0
NETWORK="${BITCOIN_NETWORK:-regtest}"
MAXTRIES=''
CONTAINER="${BITCOIN_CONTAINER:-}"
CLI="${BITCOIN_CLI:-bitcoin-cli}"
RPCUSER="${BITCOIN_RPC_USER:-}"
RPCPASSWORD="${BITCOIN_RPC_PASSWORD:-}"
RPCCONNECT="${BITCOIN_RPC_CONNECT:-}"
RPCPORT="${BITCOIN_RPC_PORT:-}"
SKIP_VALIDATE=0
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --address)
      [ "$#" -ge 2 ] || fail "--address requires a value"
      ADDRESS="$2"
      shift 2
      ;;
    --blocks)
      [ "$#" -ge 2 ] || fail "--blocks requires a value"
      BLOCKS="$2"
      shift 2
      ;;
    --mature)
      MATURE=1
      shift
      ;;
    --network)
      [ "$#" -ge 2 ] || fail "--network requires a value"
      NETWORK="$2"
      shift 2
      ;;
    --maxtries)
      [ "$#" -ge 2 ] || fail "--maxtries requires a value"
      MAXTRIES="$2"
      shift 2
      ;;
    --container)
      [ "$#" -ge 2 ] || fail "--container requires a value"
      CONTAINER="$2"
      shift 2
      ;;
    --cli)
      [ "$#" -ge 2 ] || fail "--cli requires a value"
      CLI="$2"
      shift 2
      ;;
    --rpcuser)
      [ "$#" -ge 2 ] || fail "--rpcuser requires a value"
      RPCUSER="$2"
      shift 2
      ;;
    --rpcpassword)
      [ "$#" -ge 2 ] || fail "--rpcpassword requires a value"
      RPCPASSWORD="$2"
      shift 2
      ;;
    --rpcconnect)
      [ "$#" -ge 2 ] || fail "--rpcconnect requires a value"
      RPCCONNECT="$2"
      shift 2
      ;;
    --rpcport)
      [ "$#" -ge 2 ] || fail "--rpcport requires a value"
      RPCPORT="$2"
      shift 2
      ;;
    --skip-validate)
      SKIP_VALIDATE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option '$1'"
      ;;
  esac
done

[ -n "$ADDRESS" ] || fail "--address is required"
is_positive_integer "$BLOCKS" || fail "--blocks must be a positive integer"
[ -z "$MAXTRIES" ] || is_positive_integer "$MAXTRIES" || fail "--maxtries must be a positive integer"
[ -z "$RPCPORT" ] || is_positive_integer "$RPCPORT" || fail "--rpcport must be a positive integer"

TOTAL_BLOCKS="$BLOCKS"
if [ "$MATURE" -eq 1 ]; then
  TOTAL_BLOCKS=$((BLOCKS + 100))
fi

CLI_CMD=()
if [ -n "$CONTAINER" ]; then
  CLI_CMD=(docker exec "$CONTAINER" "$CLI")
else
  CLI_CMD=("$CLI")
fi

CLI_CMD+=("$(network_flag "$NETWORK")")
append_rpc_flag CLI_CMD rpcuser "$RPCUSER"
append_rpc_flag CLI_CMD rpcpassword "$RPCPASSWORD"
append_rpc_flag CLI_CMD rpcconnect "$RPCCONNECT"
append_rpc_flag CLI_CMD rpcport "$RPCPORT"

if [ "$SKIP_VALIDATE" -eq 0 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    quote_command "${CLI_CMD[@]}" validateaddress "$ADDRESS"
  else
    validation_json="$(run_cli validateaddress "$ADDRESS")"
    case "$validation_json" in
      *'"isvalid": true'*|*'"isvalid":true'*) ;;
      *) fail "address did not validate on $NETWORK: $ADDRESS" ;;
    esac
  fi
fi

mine_args=(generatetoaddress "$TOTAL_BLOCKS" "$ADDRESS")
if [ -n "$MAXTRIES" ]; then
  mine_args+=("$MAXTRIES")
fi

run_cli "${mine_args[@]}"
