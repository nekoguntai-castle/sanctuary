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
  if [[ ! -f "$RELEASE_TEST_STATE/github-tag-created" ]]; then
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
elif [[ "$url" == *"/update-on-dispatch.yml/dispatches" && "$method" == "POST" ]]; then
  code=204
fi
[[ -z "$output_file" ]] || printf '%s\n' "$body" > "$output_file"
printf '%s' "$code"
EOF
}

write_docker_stub() {
  local path="$1"
  cat > "$path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
for secret_name in FORGEJO_TOKEN GITHUB_RELEASE_TOKEN GHCR_TOKEN UMBREL_DISPATCH_TOKEN; do
  [[ -z "${!secret_name+x}" ]] || {
    echo "secret leaked to docker environment: $secret_name" >&2
    exit 97
  }
done
printf 'docker %s\n' "$*" >> "$TRACE_FILE"
if [[ "${1:-}" == "login" ]]; then
  cat >/dev/null
  mkdir -p "$DOCKER_CONFIG"
  printf '{"auths":{"ghcr.io":{"auth":"test"}}}\n' > "$DOCKER_CONFIG/config.json"
elif [[ "${1:-}" == "logout" && "${RELEASE_TEST_LOGOUT_FAIL:-false}" == "true" ]]; then
  exit 1
elif [[ "$*" == *"Image.Config.Labels"* ]]; then
  jq -cn \
    --arg revision "${RELEASE_TEST_IMAGE_REVISION:-$RELEASE_TEST_SHA}" \
    --arg version "$RELEASE_TEST_TAG" \
    '{
      "org.opencontainers.image.revision":$revision,
      "org.opencontainers.image.version":$version,
      "org.opencontainers.image.source":"https://github.com/nekoguntai-castle/sanctuary"
    }'
elif [[ "$*" == *"imagetools inspect --format"* ]]; then
  if [[ "$*" == *"frontend"* ]]; then
    role=frontend
    digest="sha256:$(printf 'a%.0s' {1..64})"
  else
    role=backend
    digest="sha256:$(printf 'b%.0s' {1..64})"
  fi
  if [[ ! -f "$RELEASE_TEST_STATE/${role}-published" ]]; then
    echo "manifest unknown" >&2
    exit 1
  fi
  if [[ "$role" == "frontend" ]]; then
    printf '%s\n' "sha256:$(printf 'a%.0s' {1..64})"
  else
    printf '%s\n' "sha256:$(printf 'b%.0s' {1..64})"
  fi
elif [[ "$*" == *"imagetools inspect --raw"* ]]; then
  jq -cn '{
    manifests: [
      {digest: ("sha256:" + ("c" * 64)), platform: {os:"linux",architecture:"amd64"}},
      {digest: ("sha256:" + ("d" * 64)), platform: {os:"linux",architecture:"arm64"}}
    ]
  }'
fi
EOF
}

write_helper_stubs() {
  local fixture="$1"
  cat > "$fixture/scripts/ci/build-and-push-images.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
for secret_name in FORGEJO_TOKEN GITHUB_RELEASE_TOKEN GHCR_TOKEN UMBREL_DISPATCH_TOKEN; do
  [[ -z "${!secret_name+x}" ]] || {
    echo "secret leaked to build environment: $secret_name" >&2
    exit 97
  }
done
printf 'build PUSH=%s TAG=%s IMAGES=%s\n' "$PUSH" "$IMAGE_TAG" "$IMAGES" >> "$TRACE_FILE"
mkdir -p "$DIST_DIR"
printf '{}\n' > "$DIST_DIR/image-digests-${IMAGE_TAG}.json"
for role in $IMAGES; do
  if [[ "$role" == "frontend" ]]; then
    digest="sha256:$(printf 'a%.0s' {1..64})"
  else
    digest="sha256:$(printf 'b%.0s' {1..64})"
  fi
  jq --arg role "$role" --arg digest "$digest" \
    '. + {($role): $digest}' "$DIST_DIR/image-digests-${IMAGE_TAG}.json" \
    > "$DIST_DIR/next.json"
  mv "$DIST_DIR/next.json" "$DIST_DIR/image-digests-${IMAGE_TAG}.json"
  : > "$RELEASE_TEST_STATE/${role}-published"
done
EOF
  cat > "$fixture/scripts/release/verify-release-artifacts.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
for secret_name in FORGEJO_TOKEN GITHUB_RELEASE_TOKEN GHCR_TOKEN UMBREL_DISPATCH_TOKEN; do
  [[ -z "${!secret_name+x}" ]] || {
    echo "secret leaked to verifier environment: $secret_name" >&2
    exit 97
  }
done
printf 'verify %s\n' "$*" >> "$TRACE_FILE"
[[ "$*" == *"--strict-images"* && "$*" == *"--verify-image-digests"* ]]
EOF
  cat > "$fixture/scripts/create-forge-release.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ -n "${FORGEJO_TOKEN:-}" && -n "${GITHUB_RELEASE_TOKEN:-}" ]] || exit 96
[[ -z "${GHCR_TOKEN+x}" \
  && -z "${UMBREL_DISPATCH_TOKEN+x}" \
  && -z "${DOCKER_CONFIG+x}" ]] || exit 97
[[ "${SANCTUARY_FORGE_TOKENS:-}" == "/dev/null" ]] || exit 98
printf 'create-release %s\n' "$*" >> "$TRACE_FILE"
EOF
}

new_fixture() {
  local name="$1"
  local tag="$2"
  local fixture="$TEST_ROOT/$name"
  mkdir -p "$fixture/scripts/release" "$fixture/scripts/ci" "$fixture/bin" \
    "$fixture/state" "$fixture/tmp"
  cp "$SCRIPT_UNDER_TEST" "$fixture/scripts/release/publish-release.sh"
  cp "$REPO_ROOT/scripts/release/release-operator-api.sh" \
    "$fixture/scripts/release/release-operator-api.sh"
  printf '%s\n' 'trace.log' 'output.log' 'state/' 'tmp/' > "$fixture/.gitignore"
  write_curl_stub "$fixture/bin/curl"
  write_docker_stub "$fixture/bin/docker"
  write_helper_stubs "$fixture"
  chmod +x "$fixture/scripts/release/publish-release.sh" \
    "$fixture/scripts/release/verify-release-artifacts.sh" \
    "$fixture/scripts/ci/build-and-push-images.sh" \
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
    GHCR_USER="release-user" \
    GHCR_TOKEN="package-token" \
    UMBREL_DISPATCH_TOKEN="umbrel-token" \
    TMPDIR="$fixture/tmp" \
    "$fixture/scripts/release/publish-release.sh" "$tag" "$@"
  )
}

test_dry_run_has_no_external_mutations() {
  local tag="v1.2.3-rc.1"
  local fixture
  fixture="$(new_fixture dry-run "$tag")"
  run_publish "$fixture" "$tag" --dry-run > "$fixture/output.log"
  assert_contains "$fixture/trace.log" "build PUSH=false TAG=$tag IMAGES=frontend backend"
  assert_not_contains "$fixture/trace.log" "curl POST"
  assert_not_contains "$fixture/trace.log" "docker login"
  assert_not_contains "$fixture/trace.log" "create-release"
  assert_contains "$fixture/output.log" "no registry or API mutations"
}

test_real_publish_orders_verified_distribution() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture publish "$tag")"
  run_publish "$fixture" "$tag" > "$fixture/output.log"
  assert_contains "$fixture/trace.log" "curl POST https://api.github.test/repos/nekoguntai-castle/sanctuary/git/refs"
  assert_contains "$fixture/trace.log" "docker login ghcr.io -u release-user --password-stdin"
  assert_contains "$fixture/trace.log" "build PUSH=true TAG=$tag IMAGES=frontend backend"
  assert_contains "$fixture/trace.log" "verify --manifest"
  assert_contains "$fixture/trace.log" "create-release $tag"
  assert_contains "$fixture/trace.log" "curl POST https://forgejo.test/api/v1/repos/nekoguntai-castle/sanctuary-umbrel/actions/workflows/update-on-dispatch.yml/dispatches"
  [[ -z "$(find "$fixture/tmp" -name config.json -print -quit)" ]] \
    || fail "temporary Docker credentials were not removed"

  local verify_line create_line dispatch_line
  verify_line="$(grep -n '^verify ' "$fixture/trace.log" | cut -d: -f1)"
  create_line="$(grep -n '^create-release ' "$fixture/trace.log" | cut -d: -f1)"
  dispatch_line="$(grep -n '/update-on-dispatch.yml/dispatches$' "$fixture/trace.log" | cut -d: -f1)"
  (( verify_line < create_line && create_line < dispatch_line )) \
    || fail "verification, release creation, and dispatch are out of order"
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
  assert_not_contains "$fixture/trace.log" "docker "
}

test_partial_retry_reuses_existing_image() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture partial-retry "$tag")"
  : > "$fixture/state/frontend-published"
  run_publish "$fixture" "$tag" > "$fixture/output.log"
  assert_contains "$fixture/output.log" "Reusing immutable published image"
  assert_contains "$fixture/trace.log" "build PUSH=true TAG=$tag IMAGES=backend"
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
  assert_not_contains "$fixture/trace.log" "docker "
}

test_wrong_image_revision_blocks_release_and_dispatch() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture wrong-revision "$tag")"
  if RELEASE_TEST_IMAGE_REVISION="$(printf 'f%.0s' {1..40})" \
    run_publish "$fixture" "$tag" > "$fixture/output.log" 2>&1; then
    fail "image with the wrong revision label unexpectedly passed"
  fi
  assert_contains "$fixture/output.log" "OCI source/version/revision labels do not match"
  assert_not_contains "$fixture/trace.log" "create-release"
  assert_not_contains "$fixture/trace.log" "update-on-dispatch.yml/dispatches"
}

test_exact_tag_lookup_ignores_branch_name_collision() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture branch-collision "$tag")"
  RELEASE_TEST_BRANCH_COLLISION=true run_publish "$fixture" "$tag" \
    > "$fixture/output.log"
  assert_contains "$fixture/trace.log" "/git/ref/tags/$tag"
  assert_contains "$fixture/trace.log" "curl POST https://api.github.test/repos/nekoguntai-castle/sanctuary/git/refs"
  assert_not_contains "$fixture/trace.log" "api.github.test/repos/nekoguntai-castle/sanctuary/commits/$tag"
}

test_cleanup_failure_changes_success_to_failure() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture cleanup-failure "$tag")"
  if RELEASE_TEST_LOGOUT_FAIL=true run_publish "$fixture" "$tag" \
    > "$fixture/output.log" 2>&1; then
    fail "cleanup failure unexpectedly preserved a successful exit"
  fi
  assert_contains "$fixture/output.log" "GHCR logout did not complete"
  [[ -z "$(find "$fixture/tmp" -name config.json -print -quit)" ]] \
    || fail "temporary Docker credentials remained after logout failure"
}

test_dry_run_has_no_external_mutations
test_real_publish_orders_verified_distribution
test_dirty_checkout_fails_before_network
test_failed_gate_blocks_all_publication
test_partial_retry_reuses_existing_image
test_github_actions_drift_blocks_tag_creation
test_wrong_image_revision_blocks_release_and_dispatch
test_exact_tag_lookup_ignores_branch_name_collision
test_cleanup_failure_changes_success_to_failure
echo "publish-release operator tests passed"
