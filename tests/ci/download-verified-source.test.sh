#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/download-verified-source.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

mkdir "$TEST_DIR/bin"
export PATH="$TEST_DIR/bin:$PATH"
export SANCTUARY_DOWNLOAD_RETRY_DELAY_SECONDS=0
export SANCTUARY_DOWNLOAD_ATTEMPTS=3
export MOCK_CURL_STATE="$TEST_DIR/curl-state"
export MOCK_CURL_PAYLOAD="$TEST_DIR/payload"
printf '%s' 'verified pinned source' > "$MOCK_CURL_PAYLOAD"
EXPECTED_SHA="$(sha256sum "$MOCK_CURL_PAYLOAD" | awk '{print $1}')"

cat > "$TEST_DIR/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
output=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    *) shift ;;
  esac
done
attempt=0
if [ -f "$MOCK_CURL_STATE" ]; then attempt="$(cat "$MOCK_CURL_STATE")"; fi
attempt=$((attempt + 1))
printf '%s' "$attempt" > "$MOCK_CURL_STATE"
case "${MOCK_CURL_MODE:-success}" in
  transient-then-success)
    if [ "$attempt" -lt 3 ]; then printf '503'; exit 22; fi
    ;;
  timeout-then-success)
    if [ "$attempt" -eq 1 ]; then printf '200'; exit 28; fi
    ;;
  exhausted) printf '503'; exit 22 ;;
  permanent) printf '404'; exit 22 ;;
  local-error) printf '000'; exit 3 ;;
esac
cp "$MOCK_CURL_PAYLOAD" "$output"
printf '200'
MOCK
chmod +x "$TEST_DIR/bin/curl"

fail() {
  echo "download-verified-source test failed: $*" >&2
  exit 1
}

rm -f "$MOCK_CURL_STATE"
MOCK_CURL_MODE=transient-then-success "$SCRIPT" jade-firmware \
  https://example.invalid/source "$EXPECTED_SHA" "$TEST_DIR/source.tar.gz"
[ "$(cat "$MOCK_CURL_STATE")" = 3 ] || fail 'transient 503 did not retry'
cmp "$MOCK_CURL_PAYLOAD" "$TEST_DIR/source.tar.gz" || fail 'verified payload was not installed'

rm -f "$MOCK_CURL_STATE"
MOCK_CURL_MODE=timeout-then-success "$SCRIPT" jade-firmware \
  https://example.invalid/source "$EXPECTED_SHA" "$TEST_DIR/timeout-source.tar.gz"
[ "$(cat "$MOCK_CURL_STATE")" = 2 ] || fail 'transient transfer timeout did not retry'
cmp "$MOCK_CURL_PAYLOAD" "$TEST_DIR/timeout-source.tar.gz" || fail 'retried timeout payload was not installed'

rm -f "$MOCK_CURL_STATE" "$TEST_DIR/exhausted.tar.gz"
if MOCK_CURL_MODE=exhausted "$SCRIPT" jade-firmware \
  https://example.invalid/source "$EXPECTED_SHA" "$TEST_DIR/exhausted.tar.gz"; then
  fail 'exhausted 503 unexpectedly succeeded'
fi
[ "$(cat "$MOCK_CURL_STATE")" = 3 ] || fail '503 retry budget was not exhausted'
[ ! -e "$TEST_DIR/exhausted.tar.gz" ] || fail 'partial 503 payload was accepted'

rm -f "$MOCK_CURL_STATE" "$TEST_DIR/permanent.tar.gz"
if MOCK_CURL_MODE=permanent "$SCRIPT" jade-firmware \
  https://example.invalid/source "$EXPECTED_SHA" "$TEST_DIR/permanent.tar.gz"; then
  fail 'permanent 404 unexpectedly succeeded'
fi
[ "$(cat "$MOCK_CURL_STATE")" = 1 ] || fail 'permanent 404 was retried'
[ ! -e "$TEST_DIR/permanent.tar.gz" ] || fail 'partial 404 payload was accepted'

rm -f "$MOCK_CURL_STATE" "$TEST_DIR/local-error.tar.gz"
if MOCK_CURL_MODE=local-error "$SCRIPT" jade-firmware \
  https://example.invalid/source "$EXPECTED_SHA" "$TEST_DIR/local-error.tar.gz"; then
  fail 'local curl error unexpectedly succeeded'
fi
[ "$(cat "$MOCK_CURL_STATE")" = 1 ] || fail 'local curl error was retried'
[ ! -e "$TEST_DIR/local-error.tar.gz" ] || fail 'local curl error payload was accepted'

rm -f "$MOCK_CURL_STATE" "$TEST_DIR/bad-hash.tar.gz"
if MOCK_CURL_MODE=success "$SCRIPT" jade-firmware \
  https://example.invalid/source "$(printf '0%.0s' {1..64})" "$TEST_DIR/bad-hash.tar.gz"; then
  fail 'bad checksum unexpectedly succeeded'
fi
[ "$(cat "$MOCK_CURL_STATE")" = 1 ] || fail 'checksum mismatch was retried'
[ ! -e "$TEST_DIR/bad-hash.tar.gz" ] || fail 'bad checksum payload was accepted'

echo 'download-verified-source tests passed'
