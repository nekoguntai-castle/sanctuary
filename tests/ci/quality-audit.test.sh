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

assert_not_contains() {
  local file="$1"
  local needle="$2"
  local label="$3"

  if grep -Fq -- "$needle" "$file"; then
    fail "$label: unexpected '$needle'"
  fi
}

write_fake_npm() {
  local bin_dir="$1"

  mkdir -p "$bin_dir"
  cat >"$bin_dir/npm" <<'NPM'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "${NPM_AUDIT_CALL_LOG:?}"

if [ "${1:-}" = "audit" ] ||
  { [ "${1:-}" = "--prefix" ] && [ "${3:-}" = "audit" ]; }; then
  exit 0
fi

echo "unexpected npm invocation: $*" >&2
exit 99
NPM
  chmod +x "$bin_dir/npm"
}

main() {
  local fake_bin="$TMP_ROOT/bin"
  local call_log="$TMP_ROOT/npm-calls.log"
  write_fake_npm "$fake_bin"
  touch "$call_log"

  (
    cd "$REPO_ROOT"
    PATH="$fake_bin:$PATH" \
      NPM_AUDIT_CALL_LOG="$call_log" \
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

  assert_contains "$call_log" 'audit --audit-level=high' 'root audit'
  assert_contains "$call_log" 'audit --workspace server --audit-level=high' 'server workspace audit'
  assert_contains "$call_log" 'audit --workspace gateway --audit-level=high' 'gateway workspace audit'
  assert_contains "$call_log" '--prefix llm-egress-proxy audit --audit-level=high' 'llm egress proxy audit'
  assert_contains "$call_log" '--prefix website audit --audit-level=high' 'website audit'
  assert_contains "$call_log" '--prefix scripts/verify-addresses audit --audit-level=high' 'address verifier audit'
  assert_contains "$call_log" '--prefix scripts/verify-psbt audit --audit-level=high' 'psbt verifier audit'
  assert_not_contains "$call_log" '--prefix server audit' 'server package-local audit'
  assert_not_contains "$call_log" '--prefix gateway audit' 'gateway package-local audit'

  echo 'quality audit regression checks passed'
}

main "$@"
