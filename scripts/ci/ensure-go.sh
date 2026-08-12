#!/usr/bin/env bash
# Verify the Go toolchain matches what the address cross-verification lane needs.
#
# Verifies; never installs. Every ensure-* helper in this repo asserts that the
# runner image already carries the toolchain, so a mismatch is an image problem
# surfaced immediately rather than a download on the critical path. The image is
# built by runner-infra scripts/ops/build-runner-image.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

fail() {
  echo "ensure-go: $*" >&2
  exit 1
}

# The funds-safety verifier uses the exact toolchain directive. Accepting a newer
# compiler would make the proof depend on whichever runner image happened to
# execute it and could silently change generated evidence.
read_required_version() {
  local go_mod="${SANCTUARY_GO_MOD:-$SCRIPT_DIR/../verify-addresses/implementations/go.mod}"
  [ -f "$go_mod" ] || fail "go.mod not found at ${go_mod}"
  awk '$1 == "toolchain" { sub(/^go/, "", $2); print $2; exit }' "$go_mod"
}

main() {
  if [ "$#" -ne 0 ]; then
    fail 'unexpected arguments'
  fi

  local required
  required="$(read_required_version)"
  [ -n "$required" ] || fail 'could not read the exact toolchain directive from go.mod'

  local go_bin
  go_bin="$(command -v go)" || fail 'go executable not found; the runner image is missing the Go toolchain'

  # Disable Go's automatic toolchain download. The proof must use the binary
  # baked into the content-addressed job image and fail if that image drifts.
  local module_dir
  module_dir="$(dirname "${SANCTUARY_GO_MOD:-$SCRIPT_DIR/../verify-addresses/implementations/go.mod}")"

  local actual
  actual="$(cd "$module_dir" && GOTOOLCHAIN=local "$go_bin" env GOVERSION 2>/dev/null | sed 's/^go//')"
  [ -n "$actual" ] || fail 'could not determine the effective Go version'

  if [ "$actual" != "$required" ]; then
    fail "expected exact Go ${required}, got ${actual}"
  fi

  ci_emit_env "SANCTUARY_GO_BIN=$go_bin"
  echo "Go ${actual} (${go_bin})"
}

main "$@"
