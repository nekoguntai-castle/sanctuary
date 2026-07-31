#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_UNDER_TEST="$REPO_ROOT/scripts/release/publish-release.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-publish-release-test.XXXXXX")"
trap 'find "$TEST_ROOT" -type f -delete; find "$TEST_ROOT" -depth -type d -empty -delete' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq -- "$expected" "$file" || fail "$file does not contain: $expected"
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -Fq -- "$unexpected" "$file"; then
    fail "$file unexpectedly contains: $unexpected"
  fi
}

trace_line() {
  local file="$1"
  local pattern="$2"
  grep -nF -- "$pattern" "$file" | head -n 1 | cut -d: -f1
}

write_curl_stub() {
  local path="$1"
  cat > "$path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
for secret_name in FORGEJO_TOKEN GITHUB_RELEASE_TOKEN GHCR_TOKEN UMBREL_DISPATCH_TOKEN; do
  [[ -z "${!secret_name+x}" ]] || {
    echo "secret leaked to curl environment: $secret_name" >&2
    exit 97
  }
done
config_input="$(cat)"
[[ "$config_input" == *"Authorization:"* ]] || exit 98
method=GET
output_file=""
url=""
while (( $# > 0 )); do
  case "$1" in
    --config) shift 2 ;;
    -X) method="$2"; shift 2 ;;
    -o) output_file="$2"; shift 2 ;;
    -w|--max-time|-H|-d) shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf 'curl %s %s\n' "$method" "$url" >> "$TRACE_FILE"
code=200
body='{}'
if [[ "$url" == *"/actions/permissions" ]]; then
  body="$(jq -cn --argjson enabled "${RELEASE_TEST_ACTIONS_ENABLED:-false}" '{enabled:$enabled}')"
elif [[ "$url" == *"/actions/runs?"* ]]; then
  body='{"workflow_runs":[{"id":42,"workflow_id":"install-test.yml","event":"push","status":"success"}]}'
elif [[ "$url" == *"/actions/runs/42" ]]; then
  body="$(jq -cn \
    --arg status "${RELEASE_TEST_GATE_STATUS:-success}" \
    --arg tag "$RELEASE_TEST_TAG" \
    --arg sha "$RELEASE_TEST_SHA" \
    '{workflow_id:"install-test.yml",event:"push",status:$status,prettyref:$tag,commit_sha:$sha}')"
elif [[ "$url" == *"forgejo.test"*"/git/commits/"* ]]; then
  body="$(jq -cn --arg sha "$RELEASE_TEST_SHA" '{sha:$sha}')"
elif [[ "$url" == *"api.github.test"*"/git/ref/tags/"* ]]; then
  if [[ "${RELEASE_TEST_GITHUB_TAG_EXISTS:-false}" != "true" \
    && ! -f "$RELEASE_TEST_STATE/github-tag-created" ]]; then
    code=404
  else
    body="$(jq -cn --arg sha "${RELEASE_TEST_GITHUB_SHA:-$RELEASE_TEST_SHA}" \
      '{object:{type:"commit",sha:$sha}}')"
  fi
elif [[ "$url" == *"api.github.test"*"/commits/"* ]]; then
  body="$(jq -cn --arg sha "$RELEASE_TEST_SHA" '{sha:$sha}')"
elif [[ "$url" == *"api.github.test"*"/git/refs" && "$method" == "POST" ]]; then
  : > "$RELEASE_TEST_STATE/github-tag-created"
  code=201
fi
[[ -z "$output_file" ]] || printf '%s\n' "$body" > "$output_file"
printf '%s' "$code"
EOF
}

write_forbidden_docker_stub() {
  local path="$1"
  cat > "$path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\n' "$*" >> "$TRACE_FILE"
echo "release operator invoked Docker" >&2
exit 99
EOF
}

write_release_stub() {
  local path="$1"
  cat > "$path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ -n "${FORGEJO_TOKEN:-}" && -n "${GITHUB_RELEASE_TOKEN:-}" ]] || exit 96
for retired_name in GHCR_USER GHCR_TOKEN UMBREL_DISPATCH_TOKEN UMBREL_OWNER UMBREL_REPO; do
  [[ -z "${!retired_name+x}" ]] || exit 97
done
[[ "${SANCTUARY_FORGE_TOKENS:-}" == "/dev/null" ]] || exit 98
printf 'create-release %s\n' "$*" >> "$TRACE_FILE"
EOF
}

new_fixture() {
  local name="$1"
  local tag="$2"
  local fixture="$TEST_ROOT/$name"
  mkdir -p "$fixture/scripts/release" "$fixture/bin" "$fixture/state" "$fixture/tmp"
  cp "$SCRIPT_UNDER_TEST" "$fixture/scripts/release/publish-release.sh"
  cp "$REPO_ROOT/scripts/release/release-operator-api.sh" \
    "$fixture/scripts/release/release-operator-api.sh"
  printf '%s\n' 'trace.log' 'output.log' 'state/' 'tmp/' > "$fixture/.gitignore"
  write_curl_stub "$fixture/bin/curl"
  write_forbidden_docker_stub "$fixture/bin/docker"
  write_release_stub "$fixture/scripts/create-forge-release.sh"
  chmod +x "$fixture/scripts/release/publish-release.sh" \
    "$fixture/scripts/create-forge-release.sh" \
    "$fixture/bin/curl" "$fixture/bin/docker"
  git -C "$fixture" init -q
  git -C "$fixture" config user.name "Release Test"
  git -C "$fixture" config user.email "release-test@example.invalid"
  git -C "$fixture" add .
  git -C "$fixture" commit -qm "fixture"
  git -C "$fixture" tag "$tag"
  printf '%s\n' "$fixture"
}

run_publish() {
  local fixture="$1"
  local tag="$2"
  shift 2
  local sha
  sha="$(git -C "$fixture" rev-parse HEAD)"
  (
    cd "$fixture"
    PATH="$fixture/bin:$PATH" \
    TRACE_FILE="$fixture/trace.log" \
    RELEASE_TEST_STATE="$fixture/state" \
    RELEASE_TEST_TAG="$tag" \
    RELEASE_TEST_SHA="$sha" \
    SANCTUARY_RELEASE_CONFIG="$fixture/missing.env" \
    FORGEJO_URL="https://forgejo.test" \
    FORGEJO_OWNER="nekoguntai-castle" \
    FORGEJO_REPO="sanctuary" \
    FORGEJO_TOKEN="forge-token" \
    GITHUB_API_URL="https://api.github.test" \
    GITHUB_OWNER="nekoguntai-castle" \
    GITHUB_REPO="sanctuary" \
    GITHUB_RELEASE_TOKEN="github-token" \
    GHCR_USER="retired-user" \
    GHCR_TOKEN="retired-package-token" \
    UMBREL_DISPATCH_TOKEN="retired-dispatch-token" \
    UMBREL_OWNER="retired-owner" \
    UMBREL_REPO="retired-repo" \
    TMPDIR="$fixture/tmp" \
    "$fixture/scripts/release/publish-release.sh" "$tag" "$@"
  )
}

test_dry_run_verifies_without_mutation() {
  local tag="v1.2.3-rc.1"
  local fixture
  fixture="$(new_fixture dry-run "$tag")"
  RELEASE_TEST_GITHUB_TAG_EXISTS=true run_publish "$fixture" "$tag" --dry-run \
    > "$fixture/output.log"
  assert_contains "$fixture/trace.log" "/actions/permissions"
  assert_contains "$fixture/trace.log" "/git/ref/tags/$tag"
  assert_not_contains "$fixture/trace.log" "curl POST"
  assert_not_contains "$fixture/trace.log" "create-release"
  assert_not_contains "$fixture/trace.log" "docker "
  assert_contains "$fixture/output.log" "no API mutations"
}

test_real_publish_orders_release_gates() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture publish "$tag")"
  run_publish "$fixture" "$tag" > "$fixture/output.log"
  assert_contains "$fixture/trace.log" "curl POST https://api.github.test/repos/nekoguntai-castle/sanctuary/git/refs"
  assert_contains "$fixture/trace.log" "create-release $tag"
  assert_not_contains "$fixture/trace.log" "docker "
  assert_contains "$fixture/output.log" "published to Forgejo and GitHub"

  local forgejo_tag_line gate_line actions_line github_tag_line create_line
  forgejo_tag_line="$(trace_line "$fixture/trace.log" "forgejo.test/api/v1/repos/nekoguntai-castle/sanctuary/git/commits/$tag")"
  gate_line="$(trace_line "$fixture/trace.log" "forgejo.test/api/v1/repos/nekoguntai-castle/sanctuary/actions/runs?")"
  actions_line="$(trace_line "$fixture/trace.log" "api.github.test/repos/nekoguntai-castle/sanctuary/actions/permissions")"
  github_tag_line="$(trace_line "$fixture/trace.log" "api.github.test/repos/nekoguntai-castle/sanctuary/git/ref/tags/$tag")"
  create_line="$(trace_line "$fixture/trace.log" "create-release $tag")"
  (( forgejo_tag_line < gate_line \
    && gate_line < actions_line \
    && actions_line < github_tag_line \
    && github_tag_line < create_line )) \
    || fail "release gates and release creation are out of order"
}

test_existing_github_tag_is_idempotent() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture existing-tag "$tag")"
  RELEASE_TEST_GITHUB_TAG_EXISTS=true run_publish "$fixture" "$tag" > "$fixture/output.log"
  assert_not_contains "$fixture/trace.log" "curl POST"
  assert_contains "$fixture/trace.log" "create-release $tag"
}

test_dirty_checkout_fails_before_network() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture dirty "$tag")"
  printf 'dirty\n' > "$fixture/untracked.txt"
  if run_publish "$fixture" "$tag" > "$fixture/output.log" 2>&1; then
    fail "dirty checkout unexpectedly passed"
  fi
  assert_contains "$fixture/output.log" "release checkout must be clean"
  [[ ! -f "$fixture/trace.log" ]] || fail "dirty checkout reached an external command"
}

test_failed_gate_blocks_all_publication() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture failed-gate "$tag")"
  if RELEASE_TEST_GATE_STATUS=failure run_publish "$fixture" "$tag" \
    > "$fixture/output.log" 2>&1; then
    fail "failed Forgejo release gate unexpectedly passed"
  fi
  assert_contains "$fixture/output.log" "no successful install-test.yml"
  assert_not_contains "$fixture/trace.log" "curl POST"
  assert_not_contains "$fixture/trace.log" "create-release"
  assert_not_contains "$fixture/trace.log" "docker "
}

test_github_actions_drift_blocks_tag_creation() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture actions-enabled "$tag")"
  if RELEASE_TEST_ACTIONS_ENABLED=true run_publish "$fixture" "$tag" \
    > "$fixture/output.log" 2>&1; then
    fail "publication unexpectedly passed with GitHub Actions enabled"
  fi
  assert_contains "$fixture/output.log" "GitHub Actions must be disabled"
  assert_not_contains "$fixture/trace.log" "curl POST"
  assert_not_contains "$fixture/trace.log" "create-release"
  assert_not_contains "$fixture/trace.log" "docker "
}

test_mismatched_github_tag_blocks_release() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture mismatched-tag "$tag")"
  if RELEASE_TEST_GITHUB_TAG_EXISTS=true \
    RELEASE_TEST_GITHUB_SHA="$(printf 'f%.0s' {1..40})" \
    run_publish "$fixture" "$tag" > "$fixture/output.log" 2>&1; then
    fail "mismatched GitHub tag unexpectedly passed"
  fi
  assert_contains "$fixture/output.log" "expected"
  assert_not_contains "$fixture/trace.log" "create-release"
  assert_not_contains "$fixture/trace.log" "docker "
}

test_dry_run_requires_existing_github_tag() {
  local tag="v1.2.3-rc.1"
  local fixture
  fixture="$(new_fixture missing-dry-run-tag "$tag")"
  if run_publish "$fixture" "$tag" --dry-run > "$fixture/output.log" 2>&1; then
    fail "dry run unexpectedly repaired a missing GitHub tag"
  fi
  assert_contains "$fixture/output.log" "GitHub tag lookup returned HTTP 404"
  assert_not_contains "$fixture/trace.log" "curl POST"
  assert_not_contains "$fixture/trace.log" "create-release"
}

test_exact_tag_lookup_ignores_branch_name_collision() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture branch-collision "$tag")"
  run_publish "$fixture" "$tag" > "$fixture/output.log"
  assert_contains "$fixture/trace.log" "/git/ref/tags/$tag"
  assert_contains "$fixture/trace.log" "curl POST https://api.github.test/repos/nekoguntai-castle/sanctuary/git/refs"
  assert_not_contains "$fixture/trace.log" "api.github.test/repos/nekoguntai-castle/sanctuary/commits/$tag"
}

test_dry_run_verifies_without_mutation
test_real_publish_orders_release_gates
test_existing_github_tag_is_idempotent
test_dirty_checkout_fails_before_network
test_failed_gate_blocks_all_publication
test_github_actions_drift_blocks_tag_creation
test_mismatched_github_tag_blocks_release
test_dry_run_requires_existing_github_tag
test_exact_tag_lookup_ignores_branch_name_collision
echo "publish-release operator tests passed"
