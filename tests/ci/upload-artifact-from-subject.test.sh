#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
SCRIPT="$ROOT/scripts/ci/upload-artifact-from-subject.sh"
TEST_ROOT=$(mktemp -d "$ROOT/.tmp/upload-subject-test.XXXXXX")
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() { printf 'upload subject test: %s\n' "$*" >&2; exit 1; }

mkdir "$TEST_ROOT/artifact" "$TEST_ROOT/bin"
printf report > "$TEST_ROOT/artifact/report.json"
cat > "$TEST_ROOT/bin/node" <<'NODE'
#!/usr/bin/env bash
set -euo pipefail
missing_behavior=$(env | sed -n 's/^INPUT_IF-NO-FILES-FOUND=//p')
printf '%s\n' "$INPUT_NAME" "$INPUT_PATH" "$missing_behavior" > "$UPLOAD_CAPTURE"
NODE
chmod +x "$TEST_ROOT/bin/node"

if PATH="$TEST_ROOT/bin:$PATH" UPLOAD_CAPTURE="$TEST_ROOT/capture" \
    bash "$SCRIPT" report "$TEST_ROOT/artifact" 2>/dev/null; then
  fail 'uncoordinated upload was accepted'
fi

PATH="$TEST_ROOT/bin:$PATH" UPLOAD_CAPTURE="$TEST_ROOT/capture" \
  SANCTUARY_CLEANUP_COORDINATED=1 bash "$SCRIPT" report "$TEST_ROOT/artifact"
mapfile -t captured < "$TEST_ROOT/capture"
[[ ${captured[0]} == report && ${captured[1]} == "$TEST_ROOT/artifact" \
    && ${captured[2]} == error ]] || fail 'uploader inputs were not exact'

if PATH="$TEST_ROOT/bin:$PATH" UPLOAD_CAPTURE="$TEST_ROOT/capture" \
    SANCTUARY_CLEANUP_COORDINATED=1 bash "$SCRIPT" report /tmp 2>/dev/null; then
  fail 'artifact outside the coordinated checkout was accepted'
fi

printf 'upload from coordinated subject tests passed\n'
