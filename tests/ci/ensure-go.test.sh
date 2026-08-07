#!/usr/bin/env bash
# Regression: the Go toolchain check must read the *effective* version and fail
# closed when the toolchain is absent.
#
# The effective version matters because GOTOOLCHAIN=auto reports the base
# toolchain outside a module and the module-selected one inside it. Reading it
# from the wrong directory compares against a number that has nothing to do with
# what will build go-verify.go.
#
# Failing closed matters because the address verifier treats a missing Go as
# [UNAVAILABLE] and carries on with a weaker cross-check -- see #708. If the
# image loses Go, this must say so rather than let the lane quietly degrade.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENSURE_GO="$REPO_ROOT/scripts/ci/ensure-go.sh"
GO_MOD="$REPO_ROOT/scripts/verify-addresses/implementations/go.mod"

PASS=0
FAIL=0
FAILURES=()
TEST_TEMP_DIR="$(mktemp -d)"

cleanup() { rm -rf "$TEST_TEMP_DIR"; }
trap cleanup EXIT

ok() { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); echo "FAIL: $1" >&2; }

bash -n "$ENSURE_GO" || bad 'ensure-go.sh does not parse'

# ----- 1. the requirement tracks go.mod, not a hardcoded number --------------
required="$(awk '$1 == "go" { print $2; exit }' "$GO_MOD")"
if [ -n "$required" ] && grep -q 'go\.mod' "$ENSURE_GO"; then
  ok "requirement is read from go.mod (currently ${required})"
else
  bad 'ensure-go.sh does not derive its requirement from go.mod'
fi

# ----- 2. fails closed when the toolchain is absent --------------------------
# A PATH with the coreutils the script needs but no `go`.
stub_bin="$TEST_TEMP_DIR/bin"
mkdir -p "$stub_bin"
for tool in bash env dirname awk sed sort head grep printf; do
  target="$(command -v "$tool" 2>/dev/null)" || continue
  ln -sf "$target" "$stub_bin/$tool"
done

if command -v "$stub_bin/go" >/dev/null 2>&1; then
  bad 'test harness leaked a go binary into the stub PATH'
else
  out="$(PATH="$stub_bin" "$(command -v bash)" "$ENSURE_GO" 2>&1)"
  status=$?
  if [ "$status" -eq 0 ]; then
    bad 'ensure-go.sh reported success with no Go toolchain present'
  elif printf '%s' "$out" | grep -q 'Go toolchain'; then
    ok 'absent toolchain fails closed and names the image as the cause'
  else
    bad "absent toolchain failed without a usable message: ${out}"
  fi
fi

# ----- 3. passes against a real toolchain, when one is present ---------------
if command -v go >/dev/null 2>&1; then
  if out="$(bash "$ENSURE_GO" 2>&1)"; then
    if printf '%s' "$out" | grep -qE 'Go [0-9]+\.[0-9]+'; then
      ok 'present toolchain is accepted and its version reported'
    else
      bad "accepted the toolchain without reporting a version: ${out}"
    fi
  else
    # Older-than-required is a legitimate local state; only assert the message.
    if printf '%s' "$out" | grep -q 'expected Go >='; then
      ok 'too-old toolchain is rejected with the required version named'
    else
      bad "rejected the toolchain without a usable message: ${out}"
    fi
  fi
else
  echo "SKIP: no Go toolchain on this host to accept"
fi

echo
echo "===================="
echo "Total:  $((PASS + FAIL))"
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Failures:" >&2
  for f in "${FAILURES[@]}"; do echo "  - $f" >&2; done
  exit 1
fi
