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

# The requirement is the go.mod directive: the toolchain has to be at least what
# the module declares. Newer is fine, older cannot build it.
read_required_version() {
  local go_mod="${SANCTUARY_GO_MOD:-$SCRIPT_DIR/../verify-addresses/implementations/go.mod}"
  [ -f "$go_mod" ] || fail "go.mod not found at ${go_mod}"
  awk '$1 == "go" { print $2; exit }' "$go_mod"
}

main() {
  if [ "$#" -ne 0 ]; then
    fail 'unexpected arguments'
  fi

  local required
  required="$(read_required_version)"
  [ -n "$required" ] || fail 'could not read the go directive from go.mod'

  local go_bin
  go_bin="$(command -v go)" || fail 'go executable not found; the runner image is missing the Go toolchain'

  # Evaluate inside the module. GOTOOLCHAIN=auto reports the *base* toolchain
  # outside a module and the *effective* one inside it, so checking from
  # anywhere else reads a number that has nothing to do with what will build
  # go-verify.go. Reading it here also means a base toolchain too old to satisfy
  # the directive fails now -- on an image without network egress it could not
  # fetch the newer one at run time anyway.
  local module_dir
  module_dir="$(dirname "${SANCTUARY_GO_MOD:-$SCRIPT_DIR/../verify-addresses/implementations/go.mod}")"

  local actual
  actual="$(cd "$module_dir" && "$go_bin" env GOVERSION 2>/dev/null | sed 's/^go//')"
  [ -n "$actual" ] || fail 'could not determine the effective Go version'

  # sort -V puts the lower version first; if that is not the requirement, the
  # installed toolchain is older than the module needs.
  local lowest
  lowest="$(printf '%s\n%s\n' "$required" "$actual" | sort -V | head -n 1)"
  if [ "$lowest" != "$required" ] && [ "$actual" != "$required" ]; then
    fail "expected Go >= ${required}, got ${actual}"
  fi

  ci_emit_env "SANCTUARY_GO_BIN=$go_bin"
  echo "Go ${actual} (${go_bin})"
}

main "$@"
