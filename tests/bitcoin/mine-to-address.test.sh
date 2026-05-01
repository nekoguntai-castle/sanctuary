#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/bitcoin/mine-to-address.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"

  case "$haystack" in
    *"$needle"*) ;;
    *) fail "expected output to contain '$needle', got: $haystack" ;;
  esac
}

assert_line_equals() {
  local file="$1"
  local line_number="$2"
  local expected="$3"
  local actual

  actual="$(sed -n "${line_number}p" "$file")"
  [ "$actual" = "$expected" ] || fail "expected line $line_number to be '$expected', got '$actual'"
}

assert_fails_with() {
  local expected="$1"
  shift

  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e

  [ "$status" -ne 0 ] || fail "expected command to fail"
  assert_contains "$output" "$expected"
}

create_fake_cli() {
  local dir="$1"
  local log_file="$2"
  local cli="$dir/bitcoin-cli"

  cat > "$cli" <<'EOF_FAKE_CLI'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "$FAKE_BITCOIN_CLI_LOG"

for arg in "$@"; do
  if [ "$arg" = "validateaddress" ]; then
    printf '{"isvalid": true}\n'
    exit 0
  fi
  if [ "$arg" = "generatetoaddress" ]; then
    printf '["blockhash"]\n'
    exit 0
  fi
done

printf 'unknown fake command\n' >&2
exit 1
EOF_FAKE_CLI

  chmod +x "$cli"
  printf '%s\n' "$cli"
}

main() {
  local temp_dir log_file fake_cli output

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "'"$temp_dir"'"' EXIT
  log_file="$temp_dir/cli.log"
  fake_cli="$(create_fake_cli "$temp_dir" "$log_file")"
  export FAKE_BITCOIN_CLI_LOG="$log_file"

  assert_fails_with "--address is required" bash "$SCRIPT" --dry-run
  assert_fails_with "--blocks must be a positive integer" bash "$SCRIPT" --address bcrt1target --blocks 0 --dry-run

  output="$(bash "$SCRIPT" --address bcrt1target --blocks 2 --mature --network testnet --maxtries 500 --dry-run)"
  assert_contains "$output" "bitcoin-cli -testnet validateaddress bcrt1target"
  assert_contains "$output" "bitcoin-cli -testnet generatetoaddress 102 bcrt1target 500"

  bash "$SCRIPT" \
    --address bcrt1target \
    --blocks 3 \
    --network regtest \
    --rpcuser user \
    --rpcpassword pass \
    --rpcconnect 127.0.0.1 \
    --rpcport 18443 \
    --cli "$fake_cli" > "$temp_dir/result.json"

  assert_line_equals "$log_file" 1 "-regtest -rpcuser=user -rpcpassword=pass -rpcconnect=127.0.0.1 -rpcport=18443 validateaddress bcrt1target"
  assert_line_equals "$log_file" 2 "-regtest -rpcuser=user -rpcpassword=pass -rpcconnect=127.0.0.1 -rpcport=18443 generatetoaddress 3 bcrt1target"
  assert_contains "$(cat "$temp_dir/result.json")" "blockhash"

  : > "$log_file"
  bash "$SCRIPT" \
    --address bcrt1target \
    --blocks 1 \
    --container bitcoin-core \
    --cli "$fake_cli" \
    --skip-validate \
    --dry-run > "$temp_dir/docker-dry-run.txt"

  assert_contains "$(cat "$temp_dir/docker-dry-run.txt")" "docker exec bitcoin-core $fake_cli -regtest generatetoaddress 1 bcrt1target"

  echo "mine-to-address tests passed"
}

main "$@"
