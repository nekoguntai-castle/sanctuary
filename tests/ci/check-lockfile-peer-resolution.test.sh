#!/usr/bin/env bash
# Regression tests for scripts/quality/check-lockfile-peer-resolution.sh.
# The gate must fail closed when npm itself fails (registry error, timeout,
# crash) instead of reporting "peer resolution clean".
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_SRC="$ROOT_DIR/scripts/quality/check-lockfile-peer-resolution.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Build a temp tree holding a copy of the script (REPO_ROOT derives from $0),
# one root lockfile and a stub npm whose behaviour comes from STUB_* variables.
make_tree() {
  local tree="$1"
  mkdir -p "$tree/scripts/quality" "$tree/bin"
  cp "$SCRIPT_SRC" "$tree/scripts/quality/check-lockfile-peer-resolution.sh"
  printf '{}\n' > "$tree/package-lock.json"
  cat > "$tree/bin/npm" <<'EOF_NPM'
#!/usr/bin/env bash
if [ -n "${STUB_NPM_OUTPUT:-}" ]; then
  printf '%s\n' "$STUB_NPM_OUTPUT"
fi
exit "${STUB_NPM_EXIT:-0}"
EOF_NPM
  chmod +x "$tree/bin/npm"
}

# run_gate <tree> <npm-exit> <npm-output>; sets gate_status and gate_output.
run_gate() {
  local tree="$1"
  gate_status=0
  gate_output="$(
    STUB_NPM_EXIT="$2" STUB_NPM_OUTPUT="$3" PATH="$tree/bin:$PATH" \
      bash "$tree/scripts/quality/check-lockfile-peer-resolution.sh" 2>&1
  )" || gate_status=$?
}

main() {
  local tmp tree gate_status gate_output
  tmp="$(mktemp -d)"
  trap 'rm -rf "'"$tmp"'"' EXIT
  tree="$tmp/tree"
  make_tree "$tree"

  # 1. npm fails with no recognised peer output: fail closed.
  run_gate "$tree" 1 'npm ERR! code ECONNRESET'
  [ "$gate_status" -ne 0 ] || fail "npm failure was reported as clean: $gate_output"
  case "$gate_output" in
    *"peer resolution NOT verified"*) ;;
    *) fail "expected NOT verified message, got: $gate_output" ;;
  esac

  # 2. npm succeeds silently: clean.
  run_gate "$tree" 0 ''
  [ "$gate_status" -eq 0 ] || fail "clean run failed: $gate_output"

  # 3. A recognised peer warning with exit 0 is still drift.
  run_gate "$tree" 0 'npm WARN EBADPEER foo'
  [ "$gate_status" -ne 0 ] || fail "EBADPEER with exit 0 was accepted: $gate_output"

  # 4. Only allowlisted peer output with a non-zero exit is clean.
  printf '# justification: accepted optional peer\nEBADPEER allowed-pkg\n' \
    > "$tree/scripts/quality/lockfile-peer-resolution-allowlist.txt"
  run_gate "$tree" 1 'npm WARN EBADPEER allowed-pkg'
  [ "$gate_status" -eq 0 ] || fail "allowlisted-only peer output failed: $gate_output"

  # 5. Allowlisted plus non-allowlisted peer output is drift.
  run_gate "$tree" 1 "npm WARN EBADPEER allowed-pkg
npm WARN EBADPEER other-pkg"
  [ "$gate_status" -ne 0 ] || fail "non-allowlisted drift was accepted: $gate_output"
  case "$gate_output" in
    *other-pkg*) ;;
    *) fail "expected other-pkg in drift report, got: $gate_output" ;;
  esac

  echo "check-lockfile-peer-resolution regression checks passed"
}

main "$@"
