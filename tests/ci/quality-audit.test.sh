#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local needle="$2"
  local label="$3"

  grep -Fq -- "$needle" "$file" || fail "$label: missing '$needle'"
}

write_fake_node() {
  local bin_dir="$1"

  mkdir -p "$bin_dir"
  cat >"$bin_dir/node" <<'NODE'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "${AUDIT_GATE_CALL_LOG:?}"
if [ "${1:-}" = "scripts/ci/npm-audit-gate.mjs" ]; then
  exit 0
fi

exec "${REAL_NODE:?}" "$@"
exit 99
NODE
  chmod +x "$bin_dir/node"
}

main() {
  local fake_bin="$TMP_ROOT/bin"
  local call_log="$TMP_ROOT/audit-gate-calls.log"
  local real_node
  real_node="$(command -v node)"
  write_fake_node "$fake_bin"
  touch "$call_log"

  (
    cd "$REPO_ROOT"
    PATH="$fake_bin:$PATH" \
      AUDIT_GATE_CALL_LOG="$call_log" \
      REAL_NODE="$real_node" \
      QUALITY_SKIP_LINT=1 \
      QUALITY_SKIP_TYPECHECK=1 \
      QUALITY_SKIP_AUTH_CONTRACT=1 \
      QUALITY_SKIP_ARCH_BOUNDARIES=1 \
      QUALITY_SKIP_OPENAPI_ROUTE_COVERAGE=1 \
      QUALITY_SKIP_COVERAGE=1 \
      QUALITY_SKIP_GITLEAKS=1 \
      QUALITY_SKIP_SEMGREP=1 \
      QUALITY_SKIP_LIZARD=1 \
      QUALITY_SKIP_JSCPD=1 \
      QUALITY_SKIP_LARGE_FILES=1 \
      bash scripts/quality.sh
  ) >/dev/null

  assert_contains "$call_log" 'scripts/ci/npm-audit-gate.mjs' 'aggregate audit gate'
  if [ "$(wc -l < "$call_log")" -ne 1 ]; then
    fail "aggregate audit gate: expected exactly one invocation"
  fi

  echo 'quality audit regression checks passed'
}

main "$@"
