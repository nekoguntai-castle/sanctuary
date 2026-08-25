#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/report-workflow-durations.sh"
TEST_TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_TEMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  grep -Fq -- "$2" "$1" || fail "expected $1 to contain: $2"
}

mkdir -p "$TEST_TEMP_DIR/bin"
cat > "$TEST_TEMP_DIR/bin/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
config="$(cat)"
[[ "$config" == *'Authorization: token test-token'* ]] || {
  echo 'missing authorization in curl config stdin' >&2
  exit 1
}
[[ " $* " == *' --header Accept: application/json '* ]] || {
  echo 'JSON request used the wrong Accept media type' >&2
  exit 1
}
[[ " $* " != *'test-token'* ]] || {
  echo 'token leaked into curl argv' >&2
  exit 1
}
[ -z "${FORGEJO_REPORT_TOKEN+x}" ] || {
  echo 'internal token leaked into curl environment' >&2
  exit 1
}
[ -z "${FORGEJO_TOKEN+x}" ] || {
  echo 'public token leaked into curl environment' >&2
  exit 1
}
output=''
url="${!#}"
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--output' ]; then
    output="$2"
    shift 2
  else
    shift
  fi
done
[ -n "$output" ] || exit 1
printf '%s\n' "$url" >> "${DURATION_URL_LOG:?}"
case "$url" in
  */actions/runs/42)
    printf '{"id":42,"index_in_repo":900,"status":"%s"}\n' \
      "${DURATION_RUN_STATUS:-success}" > "$output"
    ;;
  */actions/runs/42/jobs)
    if [ "${DURATION_RUN_STATUS:-success}" = 'cancelled' ]; then
      printf '%s\n' '[{"id":501,"task_id":0,"name":"Cancelled before start","status":"cancelled"}]' > "$output"
    else
      printf '%s\n' '[{"task_id":101},{"task_id":102},{"task_id":103}]' > "$output"
    fi
    ;;
  */actions/tasks\?page=1\&limit=50)
    jq -n '{total_count:52, workflow_runs:
      ([{"id":101,"name":"Slow | Job","run_number":900,"status":"success","run_started_at":"2026-08-24T10:00:00-10:00","updated_at":"2026-08-24T10:02:05-10:00"}]
       + [range(1;50) | {id:(1000 + .), name:("filler-" + (.|tostring)), run_number:(800 - .), status:"success", run_started_at:null, updated_at:null}])}' > "$output"
    ;;
  */actions/tasks\?page=2\&limit=50)
    cat > "$output" <<'JSON'
{"total_count":52,"workflow_runs":[
  {"id":102,"name":"Clock skew","run_number":900,"status":"failure","run_started_at":"2026-08-24T10:00:02-10:00","updated_at":"2026-08-24T10:00:01-10:00"},
  {"id":103,"name":"Skipped","run_number":900,"status":"skipped","run_started_at":null,"updated_at":null}
]}
JSON
    ;;
  *) echo "unexpected URL: $url" >&2; exit 1 ;;
esac
printf '200'
CURL
chmod +x "$TEST_TEMP_DIR/bin/curl"

run_case() {
  local api_url="$1"
  : > "$TEST_TEMP_DIR/urls.log"
  PATH="$TEST_TEMP_DIR/bin:$PATH" \
    DURATION_URL_LOG="$TEST_TEMP_DIR/urls.log" \
    DURATION_RUN_STATUS='success' \
    FORGEJO_API_URL="$api_url" \
    FORGEJO_REPOSITORY='owner/repo' \
    FORGEJO_TOKEN='test-token' \
    FORGEJO_REPORT_TOKEN='preexported' \
    bash "$SCRIPT" 42 > "$TEST_TEMP_DIR/output.md"
  assert_contains "$TEST_TEMP_DIR/output.md" '2m 5s | success | Slow \| Job'
  assert_contains "$TEST_TEMP_DIR/output.md" 'n/a | failure | Clock skew'
  assert_contains "$TEST_TEMP_DIR/output.md" 'n/a | skipped | Skipped'
  assert_contains "$TEST_TEMP_DIR/urls.log" "$api_url"
  assert_contains "$TEST_TEMP_DIR/urls.log" 'actions/tasks?page=2&limit=50'
}

run_case 'https://forge.example/api/v1'
run_case 'https://forge.example'

PATH="$TEST_TEMP_DIR/bin:$PATH" DURATION_URL_LOG="$TEST_TEMP_DIR/urls.log" \
  DURATION_RUN_STATUS='cancelled' FORGEJO_API_URL='https://forge.example' \
  FORGEJO_REPOSITORY='owner/repo' FORGEJO_TOKEN='test-token' \
  bash "$SCRIPT" 42 > "$TEST_TEMP_DIR/cancelled.md"
assert_contains "$TEST_TEMP_DIR/cancelled.md" 'n/a | cancelled | Cancelled before start'

if FORGEJO_API_URL='https://forge.example' FORGEJO_REPOSITORY='owner/repo' \
  FORGEJO_TOKEN='test-token' bash "$SCRIPT" invalid >/dev/null 2>&1; then
  fail 'invalid run ID unexpectedly succeeded'
fi
if FORGEJO_API_URL='https://forge.example' FORGEJO_REPOSITORY='owner/repo/extra' \
  FORGEJO_TOKEN='test-token' bash "$SCRIPT" 42 >/dev/null 2>&1; then
  fail 'malformed repository unexpectedly succeeded'
fi
if PATH="$TEST_TEMP_DIR/bin:$PATH" DURATION_URL_LOG="$TEST_TEMP_DIR/urls.log" \
  DURATION_RUN_STATUS='running' FORGEJO_API_URL='https://forge.example' \
  FORGEJO_REPOSITORY='owner/repo' FORGEJO_TOKEN='test-token' \
  bash "$SCRIPT" 42 >/dev/null 2>&1; then
  fail 'running workflow unexpectedly produced final durations'
fi
if PATH="$TEST_TEMP_DIR/bin:$PATH" DURATION_URL_LOG="$TEST_TEMP_DIR/urls.log" \
  DURATION_RUN_STATUS='blocked' FORGEJO_API_URL='https://forge.example' \
  FORGEJO_REPOSITORY='owner/repo' FORGEJO_TOKEN='test-token' \
  bash "$SCRIPT" 42 >/dev/null 2>&1; then
  fail 'blocked workflow unexpectedly produced final durations'
fi

echo 'workflow duration reporter regression checks passed'
