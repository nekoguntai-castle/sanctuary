#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLEANUP_SCRIPT="$ROOT_DIR/scripts/ci/cleanup-docker-resources.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_DIR"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

assert_fails_with() {
  local expected="$1"
  shift
  local output
  if output="$($CLEANUP_SCRIPT "$@" 2>&1)"; then
    fail "command unexpectedly succeeded: $*"
  fi
  case "$output" in
    *"$expected"*) ;;
    *) fail "expected '$expected' in: $output" ;;
  esac
}

help_output="$($CLEANUP_SCRIPT --help 2>&1)"
case "$help_output" in
  *'Legacy --project, --prefix, and --runner-leftovers modes'* ) ;;
  *) fail 'help does not explain removal of legacy mutation modes' ;;
esac

assert_fails_with 'a manifest mode is required'
for option in --project --prefix --exclude-project --runner-leftovers --verify-empty --dry-run; do
  assert_fails_with "$option was removed" "$option"
done
assert_fails_with 'unknown mode' --unknown
assert_fails_with 'requires exactly one request file' --manifest-plan
assert_fails_with 'request file does not exist' --manifest-plan "$TMP_DIR/missing.json"

printf '{}\n' > "$TMP_DIR/request.json"
mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/bin/node" <<'FAKE_NODE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "${FAKE_NODE_LOG:?}"
FAKE_NODE
chmod +x "$TMP_DIR/bin/node"

for pair in '--manifest-inventory inventory' '--manifest-plan plan'; do
  read -r option command <<< "$pair"
  FAKE_NODE_LOG="$TMP_DIR/node.log" PATH="$TMP_DIR/bin:$PATH" \
    "$CLEANUP_SCRIPT" "$option" "$TMP_DIR/request.json"
  invocation="$(cat "$TMP_DIR/node.log")"
  expected="$ROOT_DIR/scripts/ownership/cleanup-cli.mjs $command $TMP_DIR/request.json"
  [ "$invocation" = "$expected" ] || fail "unexpected dispatch: $invocation"
done

if grep -Eq '(^|[[:space:]])(docker|podman)([[:space:]]|$)' "$CLEANUP_SCRIPT"; then
  fail 'read-only facade must not invoke a container engine'
fi

printf 'PASS: cleanup facade exposes only manifest inventory and signed planning\n'
