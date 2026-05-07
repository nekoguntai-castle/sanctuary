#!/usr/bin/env bash
# Bit-identical regression for the shared redactor.
#
# The fixture and expected output were captured against the inline
# redact_stream implementation in tests/install/utils/collect-upgrade-artifacts.sh
# before any extraction. Any future shared redactor must produce
# bit-identical output for this input or this test fails.
#
# Note: the captured expected output preserves an existing behavior of the
# original redactor — the "Authorization:" header redaction only redacts
# the first token after the colon, leaving the rest of the line (e.g. a
# bearer JWT) visible. That is a separate redactor bug to address, but
# this test pins the historical behavior so extraction is provably
# behavior-preserving. If/when the underlying bug is fixed in a follow-up,
# this fixture's expected output should be regenerated in the same change.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

FIXTURE_DIR="$REPO_ROOT/tests/install/utils/fixtures/redactor"
INPUT_FILE="$FIXTURE_DIR/sample-input.txt"
EXPECTED_FILE="$FIXTURE_DIR/sample-expected.txt"

# Source the redactor through whichever helper currently provides redact_stream.
# Today that is collect-upgrade-artifacts.sh; if/when extracted into a
# dedicated shared helper this file's source path should follow that move.
# shellcheck disable=SC1091
source "$REPO_ROOT/tests/install/utils/collect-upgrade-artifacts.sh"

if ! type -t redact_stream >/dev/null; then
  echo "FAIL: redact_stream is not defined after sourcing collect-upgrade-artifacts.sh" >&2
  exit 1
fi

if [ ! -f "$INPUT_FILE" ]; then
  echo "FAIL: missing input fixture $INPUT_FILE" >&2
  exit 1
fi
if [ ! -f "$EXPECTED_FILE" ]; then
  echo "FAIL: missing expected fixture $EXPECTED_FILE" >&2
  exit 1
fi

actual_file="$(mktemp)"
trap 'rm -f "$actual_file"' EXIT
redact_stream < "$INPUT_FILE" > "$actual_file"

if ! diff -u "$EXPECTED_FILE" "$actual_file"; then
  echo "FAIL: redactor output does not match captured fixture" >&2
  exit 1
fi

echo "PASS: redactor produces bit-identical output for fixture"
