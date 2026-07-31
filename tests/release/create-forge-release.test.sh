#!/usr/bin/env bash

set -euo pipefail

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-create-release-test.XXXXXX")"
trap 'find "$TEST_ROOT" -type f -delete; find "$TEST_ROOT" -type l -delete; find "$TEST_ROOT" -depth -type d -empty -delete' EXIT

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO="$TEST_ROOT/repo"
BIN_DIR="$TEST_ROOT/bin"
CURL_LOG_DIR="$TEST_ROOT/curl-logs"
RESPONSE_TMP="$TEST_ROOT/responses"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq -- "$expected" "$file" \
    || fail "expected '$expected' in $file"
}

assert_call_count() {
  local expected="$1"
  local actual
  actual="$(find "$CURL_LOG_DIR" -name 'args-*' -type f | wc -l)"
  [[ "$actual" -eq "$expected" ]] \
    || fail "expected $expected curl calls, got $actual"
}

reset_run_state() {
  if [[ -d "$CURL_LOG_DIR" ]]; then
    find "$CURL_LOG_DIR" -type f -delete
    find "$CURL_LOG_DIR" -type l -delete
    find "$CURL_LOG_DIR" -depth -type d -empty -delete
  fi
  if [[ -d "$RESPONSE_TMP" ]]; then
    find "$RESPONSE_TMP" -type f -delete
    find "$RESPONSE_TMP" -type l -delete
    find "$RESPONSE_TMP" -depth -type d -empty -delete
  fi
  mkdir -p "$CURL_LOG_DIR" "$RESPONSE_TMP"
}

mkdir -p "$REPO/scripts" "$BIN_DIR"
cp "$SOURCE_ROOT/scripts/create-forge-release.sh" "$REPO/scripts/create-forge-release.sh"
chmod +x "$REPO/scripts/create-forge-release.sh"

git -C "$REPO" init -q
git -C "$REPO" config user.name "Release Test"
git -C "$REPO" config user.email "release-test@example.invalid"
printf 'base\n' > "$REPO/history.txt"
git -C "$REPO" add history.txt
git -C "$REPO" commit -qm "base"
git -C "$REPO" tag v0.9.0
for commit_number in $(seq 1 105); do
  printf '%s\n' "$commit_number" >> "$REPO/history.txt"
  git -C "$REPO" add history.txt
  git -C "$REPO" commit -qm "release change $commit_number"
done
git -C "$REPO" tag v1.0.0
git -C "$REPO" tag v1.1.0-rc1

cat > "$BIN_DIR/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail

for secret_name in FORGEJO_TOKEN GITHUB_RELEASE_TOKEN; do
  [[ -z "${!secret_name+x}" ]] || {
    echo "secret leaked to curl environment: $secret_name" >&2
    exit 97
  }
done

count_file="$CURL_LOG_DIR/count"
count=0
[[ ! -f "$count_file" ]] || count="$(cat "$count_file")"
count=$((count + 1))
printf '%s\n' "$count" > "$count_file"

args_file="$CURL_LOG_DIR/args-$count"
printf '%s\n' "$@" > "$args_file"
cat > "$CURL_LOG_DIR/auth-$count"

method=""
output_file=""
payload=""
url=""
while (( $# > 0 )); do
  case "$1" in
    --config)
      shift 2
      ;;
    -X)
      method="$2"
      shift 2
      ;;
    -o)
      output_file="$2"
      shift 2
      ;;
    -w|--max-time|-H)
      shift 2
      ;;
    -d)
      payload="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

printf '%s' "$payload" > "$CURL_LOG_DIR/payload-$count"

http_code=404
response='{"message":"Not Found"}'
if [[ "$method" == "POST" ]]; then
  http_code=201
  response='{"id":1}'
elif [[ "${STUB_MODE:-success}" == "exists" || "${STUB_MODE:-success}" == "mismatch" ]]; then
  http_code=200
  response="$(jq -cn \
    --arg tag "$STUB_EXPECTED_TAG" \
    --arg name "$STUB_EXPECTED_TAG" \
    --arg body "$STUB_EXPECTED_BODY" \
    --argjson draft false \
    --argjson prerelease "$STUB_EXPECTED_PRERELEASE" \
    '{id:1,tag_name:$tag,name:$name,body:$body,draft:$draft,prerelease:$prerelease}')"
  if [[ "${STUB_MODE:-success}" == "mismatch" ]]; then
    response="$(jq -c '.name = "stale release"' <<<"$response")"
  fi
elif [[ "${STUB_MODE:-success}" == "forgejo_lookup_fail" && "$url" == *"/api/v1/"* ]]; then
  http_code=503
  response='{"message":"unavailable"}'
fi

if [[ "${STUB_MODE:-success}" == "github_post_fail" \
  && "$method" == "POST" \
  && "$url" == *"/repos/github-owner/"* ]]; then
  http_code=500
  response='{"message":"failed"}'
fi

if [[ "${STUB_MODE:-success}" == "github_transport_fail" \
  && "$method" == "POST" \
  && "$url" == *"/repos/github-owner/"* ]]; then
  exit 7
fi

printf '%s\n' "$response" > "$output_file"
printf '%s' "$http_code"
STUB
chmod +x "$BIN_DIR/curl"

run_release() {
  local mode="$1"
  local tag="$2"
  local output_file="$3"

  local prev_tag body prerelease=false
  prev_tag="$(git -C "$REPO" describe --tags --abbrev=0 "${tag}^" 2>/dev/null || true)"
  if [[ -n "$prev_tag" ]]; then
    body="$(git -C "$REPO" log --oneline --no-decorate -n 100 "${prev_tag}..${tag}")"
  else
    body="$(git -C "$REPO" log --oneline --no-decorate -n 20 "$tag")"
  fi
  [[ "$tag" =~ -(rc|alpha|beta|dev) ]] && prerelease=true

  (
    cd "$REPO"
    PATH="$BIN_DIR:$PATH" \
      TMPDIR="$RESPONSE_TMP" \
      CURL_LOG_DIR="$CURL_LOG_DIR" \
      STUB_MODE="$mode" \
      STUB_EXPECTED_TAG="$tag" \
      STUB_EXPECTED_BODY="$body" \
      STUB_EXPECTED_PRERELEASE="$prerelease" \
      SANCTUARY_FORGE_TOKENS="$TEST_ROOT/no-config.env" \
      FORGEJO_URL="https://forgejo.example.invalid/" \
      FORGEJO_OWNER="forge-owner" \
      FORGEJO_REPO="sanctuary" \
      FORGEJO_TOKEN="forge-secret" \
      GITHUB_API_URL="https://api.github.example/" \
      GITHUB_OWNER="github-owner" \
      GITHUB_REPO="sanctuary" \
      GITHUB_RELEASE_TOKEN="github-secret" \
      ./scripts/create-forge-release.sh "$tag"
  ) >"$output_file" 2>&1
}

test_stable_release_uses_provider_apis_and_bounded_notes() {
  reset_run_state
  local output="$TEST_ROOT/stable-output"
  run_release success v1.0.0 "$output"

  assert_call_count 4
  assert_contains "$CURL_LOG_DIR/args-1" "https://forgejo.example.invalid/api/v1/repos/forge-owner/sanctuary/releases/tags/v1.0.0"
  assert_contains "$CURL_LOG_DIR/auth-1" "Authorization: token forge-secret"
  if grep -Fq "forge-secret" "$CURL_LOG_DIR/args-1"; then
    fail "Forgejo token leaked into curl argv"
  fi
  assert_contains "$CURL_LOG_DIR/args-3" "https://api.github.example/repos/github-owner/sanctuary/releases/tags/v1.0.0"
  assert_contains "$CURL_LOG_DIR/auth-3" "Authorization: Bearer github-secret"
  if grep -Fq "github-secret" "$CURL_LOG_DIR/args-3"; then
    fail "GitHub token leaked into curl argv"
  fi
  assert_contains "$CURL_LOG_DIR/args-3" "Accept: application/vnd.github+json"
  assert_contains "$CURL_LOG_DIR/args-3" "X-GitHub-Api-Version: 2022-11-28"

  python3 - "$CURL_LOG_DIR/payload-2" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as payload_file:
    payload = json.load(payload_file)
assert payload["tag_name"] == "v1.0.0"
assert payload["name"] == "v1.0.0"
assert payload["draft"] is False
assert payload["prerelease"] is False
assert len(payload["body"].splitlines()) == 100
assert "release change 105" in payload["body"]
assert not any(line.endswith("release change 5") for line in payload["body"].splitlines())
PY

  cmp "$CURL_LOG_DIR/payload-2" "$CURL_LOG_DIR/payload-4" \
    || fail "Forgejo and GitHub payloads differ"
  [[ -z "$(find "$RESPONSE_TMP" -type f -print -quit)" ]] \
    || fail "response temporary file was not removed"
}

test_existing_release_is_idempotent() {
  reset_run_state
  local output="$TEST_ROOT/existing-output"
  run_release exists v1.0.0 "$output"

  assert_call_count 2
  assert_contains "$output" "Forgejo: matching release already exists"
  assert_contains "$output" "GitHub: matching release already exists"
}

test_existing_release_mismatch_fails_closed() {
  reset_run_state
  local output="$TEST_ROOT/mismatch-output"

  if run_release mismatch v1.0.0 "$output"; then
    fail "mismatched existing release unexpectedly passed"
  fi

  assert_call_count 2
  assert_contains "$output" "existing release metadata does not match"
  assert_contains "$output" "Release creation failed."
}

test_prerelease_payload() {
  reset_run_state
  local output="$TEST_ROOT/prerelease-output"
  run_release success v1.1.0-rc1 "$output"

  python3 - "$CURL_LOG_DIR/payload-2" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as payload_file:
    payload = json.load(payload_file)
assert payload["tag_name"] == "v1.1.0-rc1"
assert payload["prerelease"] is True
PY
}

test_missing_config_fails_before_requests() {
  reset_run_state
  local output="$TEST_ROOT/missing-output"

  if (
    cd "$REPO"
    PATH="$BIN_DIR:$PATH" \
      TMPDIR="$RESPONSE_TMP" \
      CURL_LOG_DIR="$CURL_LOG_DIR" \
      SANCTUARY_FORGE_TOKENS="$TEST_ROOT/no-config.env" \
      FORGEJO_URL="" FORGEJO_OWNER="" FORGEJO_REPO="" FORGEJO_TOKEN="" \
      GITHUB_API_URL="" GITHUB_OWNER="" GITHUB_REPO="" GITHUB_RELEASE_TOKEN="" \
      ./scripts/create-forge-release.sh v1.0.0
  ) >"$output" 2>&1; then
    fail "missing configuration unexpectedly succeeded"
  fi

  assert_contains "$output" "missing required release configuration"
  assert_contains "$output" "FORGEJO_URL"
  assert_contains "$output" "GITHUB_RELEASE_TOKEN"
  assert_call_count 0
}

test_one_target_failure_fails_overall_after_attempting_both() {
  reset_run_state
  local output="$TEST_ROOT/failure-output"

  if run_release github_post_fail v1.0.0 "$output"; then
    fail "GitHub failure unexpectedly succeeded"
  fi

  assert_call_count 4
  assert_contains "$output" "Forgejo: created"
  assert_contains "$output" "GitHub: release creation failed (HTTP 500)"
  assert_contains "$output" "Release creation failed."
}

test_lookup_failure_is_not_treated_as_absent() {
  reset_run_state
  local output="$TEST_ROOT/lookup-failure-output"

  if run_release forgejo_lookup_fail v1.0.0 "$output"; then
    fail "Forgejo lookup failure unexpectedly succeeded"
  fi

  assert_call_count 3
  assert_contains "$output" "Forgejo: tag lookup failed (HTTP 503)"
  assert_contains "$output" "GitHub: created"
}

test_transport_failure_fails_closed() {
  reset_run_state
  local output="$TEST_ROOT/transport-failure-output"

  if run_release github_transport_fail v1.0.0 "$output"; then
    fail "GitHub transport failure unexpectedly succeeded"
  fi

  assert_call_count 4
  assert_contains "$output" "GitHub: release creation failed (HTTP 000)"
}

test_stable_release_uses_provider_apis_and_bounded_notes
test_existing_release_is_idempotent
test_existing_release_mismatch_fails_closed
test_prerelease_payload
test_missing_config_fails_before_requests
test_one_target_failure_fails_overall_after_attempting_both
test_lookup_failure_is_not_treated_as_absent
test_transport_failure_fails_closed

echo "create-forge-release tests passed"
