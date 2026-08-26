#!/usr/bin/env bash
# Regression: the Go toolchain check must require the exact module toolchain,
# disable automatic downloads, and fail closed when the binary is absent.
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
required="$(awk '$1 == "toolchain" { sub(/^go/, "", $2); print $2; exit }' "$GO_MOD")"
if [ -n "$required" ] && grep -q 'go\.mod' "$ENSURE_GO"; then
  ok "requirement is read from go.mod (currently ${required})"
else
  bad 'ensure-go.sh does not derive its requirement from go.mod'
fi

# ----- 2. fails closed when the toolchain is absent --------------------------
# A PATH with the coreutils the script needs but no `go`.
stub_bin="$TEST_TEMP_DIR/bin"
mkdir -p "$stub_bin"
for tool in bash env dirname awk sed grep printf; do
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

# ----- 3. exact version passes; older and newer versions fail ----------------
cat > "$stub_bin/go" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ "${GOTOOLCHAIN:-}" = local ] || { echo 'automatic toolchain selection was not disabled' >&2; exit 3; }
[ "${1:-}" = env ] && [ "${2:-}" = GOVERSION ] || exit 4
printf 'go%s\n' "${STUB_GO_VERSION:?}"
EOF
chmod +x "$stub_bin/go"

if PATH="$stub_bin" STUB_GO_VERSION="$required" bash "$ENSURE_GO" >/dev/null; then
  ok 'exact module toolchain is accepted with automatic downloads disabled'
else
  bad 'exact module toolchain was rejected'
fi

for drift in 1.25.11 1.25.14; do
  out="$(PATH="$stub_bin" STUB_GO_VERSION="$drift" bash "$ENSURE_GO" 2>&1)"
  status=$?
  if [ "$status" -ne 0 ] && printf '%s' "$out" | grep -q "expected exact Go ${required}, got ${drift}"; then
    ok "Go ${drift} drift is rejected"
  else
    bad "Go ${drift} drift did not fail with the exact-version message: ${out}"
  fi
done

# ----- 4. a real local toolchain is either exact or rejected clearly --------
if command -v go >/dev/null 2>&1; then
  if out="$(bash "$ENSURE_GO" 2>&1)"; then
    if printf '%s' "$out" | grep -qE 'Go [0-9]+\.[0-9]+'; then
      ok 'present toolchain is accepted and its version reported'
    else
      bad "accepted the toolchain without reporting a version: ${out}"
    fi
  else
    if printf '%s' "$out" | grep -q 'expected exact Go'; then
      ok 'non-exact local toolchain is rejected with the required version named'
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
