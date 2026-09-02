#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TIMING_SCRIPT="$ROOT_DIR/scripts/ci/report-timing-notices.sh"
COORDINATOR="$ROOT_DIR/scripts/ci/cleanup-ci-callsite.sh"
TEST_TEMP_DIR=''

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TEST_TEMP_DIR" ]; then
    rm -rf "$TEST_TEMP_DIR"
  fi
}

assert_contains() {
  local file="$1"
  local expected="$2"

  grep -Fq -- "$expected" "$file" || fail "expected output to contain: $expected"
}

assert_fails_with() {
  local expected="$1"
  shift

  local output_file="$TEST_TEMP_DIR/failure-output"
  if "$@" >"$output_file" 2>&1; then
    fail "expected command to fail: $*"
  fi

  assert_contains "$output_file" "$expected"
}

run_coordinated_timing() {
  local provider="$TEST_TEMP_DIR/provider-timing"
  mkdir -m 700 "$provider"
  SANCTUARY_LOCAL_CLEANUP_AUTHORITY=1 \
  SANCTUARY_LOCAL_CLEANUP_RUN_ID=report-timing-notices-test \
  SANCTUARY_CI_TEMP_DIR_OVERRIDE="$provider" \
    bash "$COORDINATOR" run --engine host --lane report-timing-notices-test \
      --runtime "$provider/runtime" --artifact-dir "$TEST_TEMP_DIR/timing-artifacts" \
      --checkout-root "$ROOT_DIR" -- "$@"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  local log_file output_file
  log_file="$TEST_TEMP_DIR/github.log"
  output_file="$TEST_TEMP_DIR/output"

  cat > "$log_file" <<'LOG'
Full Browser E2E Tests (wallet-experience)	Install frontend dependencies	2026-04-30T02:47:56Z ##[notice]browser npm ci completed in 0m 23s (23s)
Full Browser E2E Tests (wallet-experience)	Run browser-flow E2E tests	2026-04-30T02:50:10Z ##[notice]browser-flow E2E wallet-experience completed in 1m 7s (67s)
Quick Browser Smoke	Run browser smoke	2026-04-30T02:50:10Z ::notice title=CI timing::quick browser smoke completed in 0m 8s (8s)
Upgrade Baseline	Compose build	2026-05-13T02:50:10Z ::error title=CI timing::compose build completed in 0m 2s (2s) upgrade=true no_cache=true with exit code 1
LOG

  bash "$TIMING_SCRIPT" --log-file "$log_file" > "$output_file"

  assert_contains "$output_file" 'Seconds | Duration | Job | Label'
  assert_contains "$output_file" '67 | 1m 7s | Full Browser E2E Tests (wallet-experience) | browser-flow E2E wallet-experience'
  assert_contains "$output_file" '23 | 0m 23s | Full Browser E2E Tests (wallet-experience) | browser npm ci'
  assert_contains "$output_file" '8 | 0m 8s | Quick Browser Smoke | quick browser smoke'
  assert_contains "$output_file" '2 | 0m 2s | Upgrade Baseline | compose build'

  local empty_log_file
  empty_log_file="$TEST_TEMP_DIR/empty.log"
  : > "$empty_log_file"
  assert_fails_with 'no CI timing notices found' bash "$TIMING_SCRIPT" --log-file "$empty_log_file"

  local archive_file url_log
  archive_file="$TEST_TEMP_DIR/run-logs.zip"
  url_log="$TEST_TEMP_DIR/urls.log"
  python3 - "$archive_file" <<'PY'
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1], "w") as archive:
    archive.writestr(
        "Full Browser E2E Tests-101-attempt-1.log",
        "2026-08-24T00:00:00Z ::notice title=CI timing::browser npm ci completed in 0m 19s (19s)\n",
    )
    archive.writestr(
        "Backend Tests-102-attempt-1.log",
        "2026-08-24T00:00:00Z ::notice title=CI timing::backend tests completed in 0m 42s (42s)\n",
    )
    archive.writestr("../unsafe-103-attempt-1.log", "must not be read\n")
PY
  mkdir -p "$TEST_TEMP_DIR/bin"
  cat > "$TEST_TEMP_DIR/bin/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
config="$(cat)"
[[ "$config" == *'Authorization: token test-token'* ]] || exit 1
[[ " $* " != *'test-token'* ]] || exit 1
[ -z "${FORGEJO_REPORT_TOKEN+x}" ] || exit 1
[ -z "${FORGEJO_TOKEN+x}" ] || exit 1
[[ " $* " == *' --header Accept: application/zip '* ]] || {
  echo 'log request used the wrong Accept media type' >&2
  exit 1
}
output=''
header_file=''
url="${!#}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --dump-header) header_file="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s\n' "$url" >> "${TIMING_URL_LOG:?}"
[ -n "$header_file" ] && printf 'HTTP/1.1 200 OK\r\n\r\n' > "$header_file"
if [ "$output" = '-' ]; then
  if [ "${TIMING_STREAM_OVERSIZE:-0}" = '1' ]; then
    printf '0123456789abcdef'
  else
    cat "${TIMING_ZIP_FIXTURE:?}"
  fi
else
  cp "${TIMING_ZIP_FIXTURE:?}" "$output"
  printf '200'
fi
CURL
  chmod +x "$TEST_TEMP_DIR/bin/curl"
  : > "$url_log"
  assert_fails_with 'could not create registered report staging' env \
    PATH="$TEST_TEMP_DIR/bin:$PATH" TIMING_URL_LOG="$url_log" \
    TIMING_ZIP_FIXTURE="$archive_file" FORGEJO_API_URL='https://forge.example/api/v1' \
    FORGEJO_REPOSITORY='owner/repo' FORGEJO_TOKEN='test-token' \
    bash "$TIMING_SCRIPT" --run 42 --job-filter 'Browser E2E'
  PATH="$TEST_TEMP_DIR/bin:$PATH" \
    TIMING_URL_LOG="$url_log" \
    TIMING_ZIP_FIXTURE="$archive_file" \
    FORGEJO_API_URL='https://forge.example/api/v1' \
    FORGEJO_REPOSITORY='owner/repo' \
    FORGEJO_TOKEN='test-token' \
    FORGEJO_REPORT_TOKEN='preexported' \
    run_coordinated_timing bash "$TIMING_SCRIPT" --run 42 --job-filter 'Browser E2E' > "$output_file"
  [ ! -e "$TEST_TEMP_DIR/provider-timing/runtime/subject-staging" ] \
    || fail 'coordinator left registered timing-report staging behind'
  assert_contains "$output_file" '19 | 0m 19s | Full Browser E2E Tests | browser npm ci'
  if grep -Fq 'backend tests' "$output_file"; then
    fail 'job filter admitted an unrelated Forgejo log'
  fi
  assert_contains "$url_log" 'https://forge.example/api/v1/repos/owner/repo/actions/runs/42/logs'
  local bounded_output
  bounded_output="$TEST_TEMP_DIR/bounded.zip"
  assert_fails_with 'failed at the transport boundary' env \
    PATH="$TEST_TEMP_DIR/bin:$PATH" TIMING_URL_LOG="$url_log" \
    TIMING_ZIP_FIXTURE="$archive_file" TIMING_STREAM_OVERSIZE=1 \
    FORGEJO_API_URL='https://forge.example' FORGEJO_REPOSITORY='owner/repo' \
    FORGEJO_TOKEN='test-token' bash -c \
    'source "$1"; forgejo_report_resolve_context; forgejo_report_get "actions/runs/42/logs" "$2" 8 application/zip' \
    _ "$ROOT_DIR/scripts/ci/forgejo-report-api.sh" "$bounded_output"
  [ ! -e "$bounded_output" ] || fail 'oversized streamed response was promoted'
  assert_fails_with '--run must be a positive integer' env \
    FORGEJO_API_URL='https://forge.example' FORGEJO_REPOSITORY='owner/repo' \
    FORGEJO_TOKEN='test-token' bash "$TIMING_SCRIPT" --run invalid

  echo 'report-timing-notices tests passed.'
}

main "$@"
