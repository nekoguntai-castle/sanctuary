#!/usr/bin/env bash
# Regression: the Bitcoin Core RPC wait in scripts/verify-addresses/verify-repeatable.sh
# must be bounded per attempt.
#
# The loop reads as a 120s ceiling (60 attempts, 2s apart), but that only holds
# if each attempt can fail. A port that accepts the connection and never answers
# -- which is what the bridge gateway gives you under rootless Podman -- blocks
# curl indefinitely, so the wait never advances. Observed in verify-vectors run
# 8997: three attempts in eight minutes, then death by step timeout, instead of
# the loop exhausting in two minutes with "Bitcoin Core RPC did not become ready".

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WAIT_SCRIPT="$REPO_ROOT/scripts/verify-addresses/verify-repeatable.sh"

PASS=0
FAIL=0
FAILURES=()
LISTENER_PID=''

cleanup() {
  if [ -n "$LISTENER_PID" ]; then
    kill "$LISTENER_PID" 2>/dev/null || true
    wait "$LISTENER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

ok() {
  PASS=$((PASS + 1))
  echo "PASS: $1"
}

bad() {
  FAIL=$((FAIL + 1))
  FAILURES+=("$1")
  echo "FAIL: $1" >&2
}

bash -n "$WAIT_SCRIPT" || bad 'verify-repeatable.sh does not parse'

# ----- 1. the flags are actually present -----------------------------------
# Cheap, but it is the thing that regresses: the flags are easy to drop while
# editing the surrounding curl.
if grep -q -- '--max-time' "$WAIT_SCRIPT" && grep -q -- '--connect-timeout' "$WAIT_SCRIPT"; then
  ok 'RPC probe declares both connect and total timeouts'
else
  bad 'RPC probe is missing --connect-timeout/--max-time; the retry loop is unbounded'
fi

# ----- 2. those flags actually bound a black-hole endpoint ------------------
# Proves the flags do what the comment claims, rather than trusting curl
# semantics. A socket that accepts and never writes is the exact failure shape.
python3 - "$SCRIPT_DIR/.rpc-port" <<'PY' &
import socket, sys, time
srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(('127.0.0.1', 0))
srv.listen(8)
with open(sys.argv[1], 'w') as fh:
    fh.write(str(srv.getsockname()[1]))
deadline = time.time() + 60
while time.time() < deadline:
    try:
        srv.settimeout(1)
        conn, _ = srv.accept()
        # Accept and hold: never write, never close.
    except Exception:
        pass
PY
LISTENER_PID=$!

port=''
for _ in $(seq 1 50); do
  if [ -s "$SCRIPT_DIR/.rpc-port" ]; then
    port="$(cat "$SCRIPT_DIR/.rpc-port")"
    break
  fi
  sleep 0.1
done
rm -f "$SCRIPT_DIR/.rpc-port"

if [ -z "$port" ]; then
  bad 'test harness could not start the black-hole listener'
else
  start="$(date +%s)"
  curl -fsS --connect-timeout 3 --max-time 5 \
    --data-binary '{"jsonrpc":"1.0","method":"getblockchaininfo","params":[]}' \
    "http://127.0.0.1:${port}/" >/dev/null 2>&1
  elapsed=$(( $(date +%s) - start ))

  # 5s cap plus generous slack for a loaded runner; the point is that it
  # returns at all rather than blocking until the step is killed.
  if [ "$elapsed" -le 15 ]; then
    ok "a black-hole RPC endpoint fails in ${elapsed}s instead of hanging"
  else
    bad "RPC probe took ${elapsed}s against a black-hole endpoint; expected it to be bounded"
  fi
fi

echo
echo "===================="
echo "Total:  $((PASS + FAIL))"
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Failures:" >&2
  for f in "${FAILURES[@]}"; do
    echo "  - $f" >&2
  done
  exit 1
fi
