#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_UNDER_TEST="$REPO_ROOT/scripts/release/publish-release.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-publish-release-test.XXXXXX")"
trap 'status=$?; if (( status != 0 )); then find "$TEST_ROOT" -name output.log -type f -exec sh -c '\''echo "--- $1" >&2; cat "$1" >&2'\'' _ {} \;; fi; find "$TEST_ROOT" -type f -delete; find "$TEST_ROOT" -depth -type d -empty -delete' EXIT

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
  body='{"workflow_runs":[{"id":41,"workflow_id":"release-candidate.yml","event":"push","status":"success"},{"id":42,"workflow_id":"install-test.yml","event":"push","status":"success"}]}'
elif [[ "$url" == *"/actions/runs/41" ]]; then
  body="$(jq -cn \
    --arg status "${RELEASE_TEST_RC_GATE_STATUS:-success}" \
    --arg tag "${RELEASE_TEST_TAG}-rc1" \
    --arg sha "$RELEASE_TEST_SHA" \
    '{workflow_id:"release-candidate.yml",event:"push",status:$status,prettyref:$tag,commit_sha:$sha}')"
elif [[ "$url" == *"/actions/runs/42" ]]; then
  default_gate_ref="$RELEASE_TEST_TAG"
  gate_count_file="$RELEASE_TEST_STATE/install-gate-count"
  gate_count=0
  [[ ! -f "$gate_count_file" ]] || gate_count="$(cat "$gate_count_file")"
  gate_count=$((gate_count + 1))
  printf '%s\n' "$gate_count" > "$gate_count_file"
  if [[ "$RELEASE_TEST_TAG" != *-* && "$gate_count" -eq 1 ]]; then
    default_gate_ref="${RELEASE_TEST_TAG}-rc1"
  else
    default_gate_ref="${RELEASE_TEST_GATE_REF:-$default_gate_ref}"
  fi
  body="$(jq -cn \
    --arg status "${RELEASE_TEST_GATE_STATUS:-success}" \
    --arg tag "$default_gate_ref" \
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

write_node_command_stub() {
  cat > "$1" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$(basename "$1")" in
  verify-release-candidate-canary.mjs|verify-prestable-rehearsal.mjs)
    printf 'evidence %s\n' "$*" >> "$TRACE_FILE"
    [[ "${RELEASE_TEST_EVIDENCE_FAIL:-false}" != true ]] || exit 9
    ;;
  *) exec /usr/bin/node "$@" ;;
esac
EOF
  chmod +x "$1"
}

new_fixture() {
  local name="$1"
  local tag="$2"
  local fixture="$TEST_ROOT/$name"
  mkdir -p "$fixture/config" "$fixture/scripts/ci" "$fixture/scripts/release" \
    "$fixture/bin" "$fixture/state" "$fixture/tmp" "$fixture/external/assets"
  cp "$SCRIPT_UNDER_TEST" "$fixture/scripts/release/publish-release.sh"
  cp "$REPO_ROOT/scripts/release/release-operator-api.sh" \
    "$fixture/scripts/release/release-operator-api.sh"
  cp "$REPO_ROOT/scripts/release/previous-release-tag.sh" \
    "$fixture/scripts/release/previous-release-tag.sh"
  cp "$REPO_ROOT/scripts/release/verify-wallet-safety-audit-review.mjs" \
    "$fixture/scripts/release/verify-wallet-safety-audit-review.mjs"
  cp "$REPO_ROOT/scripts/ci/check-wallet-safety-classifier.mjs" \
    "$fixture/scripts/ci/check-wallet-safety-classifier.mjs"
  cp "$REPO_ROOT/config/wallet-safety-critical-paths.json" \
    "$fixture/config/wallet-safety-critical-paths.json"
  printf '%s\n' 'trace.log' 'output.log' 'review.json' 'missing.env' 'origin.git/' 'state/' 'tmp/' > "$fixture/.gitignore"
  write_curl_stub "$fixture/bin/curl"
  write_forbidden_docker_stub "$fixture/bin/docker"
  write_node_command_stub "$fixture/bin/node"
  write_release_stub "$fixture/scripts/create-forge-release.sh"
  printf 'receipt\n' > "$fixture/external/receipt.json"
  printf 'evidence\n' > "$fixture/external/evidence.log"
  printf '{}\n' > "$fixture/external/assets/release-manifest.json"
  printf 'public\n' > "$fixture/external/public.pem"
  chmod +x "$fixture/scripts/release/publish-release.sh" \
    "$fixture/scripts/release/previous-release-tag.sh" \
    "$fixture/scripts/create-forge-release.sh" \
    "$fixture/bin/curl" "$fixture/bin/docker"
  git -C "$fixture" init -q
  git -C "$fixture" config user.name "Release Test"
  git -C "$fixture" config user.email "release-test@example.invalid"
  git -C "$fixture" add .
  git -C "$fixture" commit -qm "fixture"
  git -C "$fixture" branch -M main
  git init -q --bare "$fixture/origin.git"
  git -C "$fixture" remote add origin "$fixture/origin.git"
  git -C "$fixture" push -q origin main
  git -C "$fixture" tag "$tag"
  if [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    git -C "$fixture" tag "${tag}-rc1"
  fi
  printf '%s\n' "$fixture"
}

run_publish() {
  local fixture="$1"
  local tag="$2"
  shift 2
  local sha
  local promotion_args=()
  sha="$(git -C "$fixture" rev-parse HEAD)"
  if [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ \
    && "${RELEASE_TEST_WITHOUT_PROMOTION:-false}" != true ]]; then
    promotion_args=(
      --candidate "${tag}-rc1"
      --receipt "$fixture/external/receipt.json"
      --evidence "$fixture/external/evidence.log"
      --rehearsal-manifest "$fixture/external/assets/release-manifest.json"
      --public-key "$fixture/external/public.pem"
    )
  fi
  # publish-release.sh no longer reads SANCTUARY_WALLET_SAFETY_AUDIT_REVIEW: the
  # release-time attestation gate is suspended (see the runbook). This generator
  # is kept rather than deleted so reinstating the gate is wiring, not a rewrite
  # of the harness — until then the variable it exports is simply ignored.
  local evidence_path=""
  if [[ "${RELEASE_TEST_WITHOUT_REVIEW:-false}" != "true" ]]; then
    local reviewed_at
    reviewed_at="$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')"
    evidence_path="$fixture/review.json"
    jq -n \
      --arg source_commit "$sha" \
      --arg reviewed_at "$reviewed_at" \
      '{
        schemaVersion: "sanctuary.wallet-safety-release-review.v1",
        sourceCommit: $source_commit,
        audit: {
          schemaVersion: "sanctuary.wallet-safety-audit.v2",
          generatedAt: $reviewed_at,
          result: "clean",
          exitCode: 0,
          findingCount: 0,
          reportSha256: ("b" * 64),
          operatorId: "release-test-operator"
        },
        review: {
          decision: "approved",
          reviewedAt: $reviewed_at,
          reviewerId: "release-test-reviewer",
          reference: "release-test-review"
        }
      }' > "$evidence_path"
  fi
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
    SANCTUARY_WALLET_SAFETY_AUDIT_REVIEW="$evidence_path" \
    TMPDIR="$fixture/tmp" \
    "$fixture/scripts/release/publish-release.sh" "$tag" "${promotion_args[@]}" "$@"
  )
}

# The stable tag and its final RC are the same commit, and install-test.yml gives every
# refs/tags/v* the identical release-critical scope -- so the RC run already validated these
# exact bytes. v0.8.64 re-ran that ~2h matrix on the stable tag and lost it three times to
# infrastructure (issue #837), which is pure wall clock for zero added signal.
test_rc_tag_run_at_same_commit_satisfies_gate() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture rc-gate "$tag")"
  RELEASE_TEST_GATE_REF="$tag-rc3" run_publish "$fixture" "$tag" > "$fixture/output.log"
  assert_contains "$fixture/output.log" "published to Forgejo and GitHub"
  assert_contains "$fixture/output.log" "Forgejo release gate is green"
}

# The widening must stay tight: only <tag>-rc<digits>, never an arbitrary suffix.
test_non_numeric_rc_suffix_does_not_satisfy_gate() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture rc-gate-bad-suffix "$tag")"
  if RELEASE_TEST_GATE_REF="$tag-rcX" run_publish "$fixture" "$tag" \
    > "$fixture/output.log" 2>&1; then
    fail "a non-numeric rc suffix unexpectedly satisfied the release gate"
  fi
  assert_contains "$fixture/output.log" "no successful install-test.yml"
  assert_not_contains "$fixture/trace.log" "create-release"
}

# An unrelated tag's run must never satisfy the gate, however green it is.
test_foreign_tag_run_does_not_satisfy_gate() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture rc-gate-foreign "$tag")"
  if RELEASE_TEST_GATE_REF="v9.9.9" run_publish "$fixture" "$tag" \
    > "$fixture/output.log" 2>&1; then
    fail "a foreign tag's run unexpectedly satisfied the release gate"
  fi
  assert_contains "$fixture/output.log" "no successful install-test.yml"
  assert_not_contains "$fixture/trace.log" "create-release"
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
  printf '%s\n' 'TAG=v9.9.9' 'CANDIDATE_TAG=v9.9.9-rc9' 'DRY_RUN=true' > "$fixture/missing.env"
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

# The three cases that asserted publication blocks on reviewed audit evidence
# (a server wallet-safety path, a Jade QR path and a Ledger parser path) are gone
# with the gate they exercised. See docs/reference/wallet-safety-audit-review-runbook.md
# for why it is suspended and what reinstating it restores. The verifier they
# drove still exists and is still unit-tested by
# tests/release/wallet-safety-audit-review.test.mjs, so reinstatement is wiring,
# not a rewrite.

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

test_manual_stable_tag_without_promotion_evidence_fails_before_network() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture missing-promotion "$tag")"
  if RELEASE_TEST_WITHOUT_PROMOTION=true run_publish "$fixture" "$tag" \
    > "$fixture/output.log" 2>&1; then
    fail "stable publication without promotion evidence unexpectedly passed"
  fi
  assert_contains "$fixture/output.log" "requires explicit accepted RC"
  [[ ! -f "$fixture/trace.log" ]] || fail "missing promotion evidence reached the network"
}

test_failed_promotion_evidence_blocks_publication() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture failed-promotion "$tag")"
  if RELEASE_TEST_EVIDENCE_FAIL=true run_publish "$fixture" "$tag" \
    > "$fixture/output.log" 2>&1; then
    fail "failed promotion evidence unexpectedly published"
  fi
  assert_not_contains "$fixture/trace.log" "curl POST"
  assert_not_contains "$fixture/trace.log" "create-release"
}

test_similar_but_nonmatching_candidate_is_rejected() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture mismatched-candidate-spelling "$tag")"
  local receipt="$fixture/external/receipt.json"
  if (
    cd "$fixture"
    SANCTUARY_RELEASE_CONFIG="$fixture/missing.env" \
    FORGEJO_URL=https://forgejo.test FORGEJO_TOKEN=token \
    GITHUB_API_URL=https://api.github.test GITHUB_RELEASE_TOKEN=token \
    "$fixture/scripts/release/publish-release.sh" "$tag" \
      --candidate v1x2x3-rc1 --receipt "$receipt" --evidence "$receipt" \
      --rehearsal-manifest "$receipt" --public-key "$receipt"
  ) > "$fixture/output.log" 2>&1; then
    fail "similar nonmatching candidate spelling unexpectedly passed"
  fi
  assert_contains "$fixture/output.log" "requires explicit accepted RC"
  [[ ! -f "$fixture/trace.log" ]] || fail "bad candidate spelling reached the network"
}

test_non_main_release_commit_fails_before_publication_apis() {
  local tag="v1.2.3"
  local fixture
  fixture="$(new_fixture non-main-release "$tag")"
  git -C "$fixture" tag -d "$tag" "${tag}-rc1" >/dev/null
  printf 'not landed\n' > "$fixture/not-landed.txt"
  git -C "$fixture" add not-landed.txt
  git -C "$fixture" commit -qm 'unlanded release commit'
  git -C "$fixture" tag "$tag"
  git -C "$fixture" tag "${tag}-rc1"
  if run_publish "$fixture" "$tag" > "$fixture/output.log" 2>&1; then
    fail "non-main release commit unexpectedly published"
  fi
  assert_contains "$fixture/output.log" "not an ancestor of fresh origin/main"
  [[ ! -f "$fixture/trace.log" ]] || fail "non-main release reached publication APIs"
}

test_operator_script_has_no_verifier_override_seam() {
  assert_not_contains "$SCRIPT_UNDER_TEST" "SANCTUARY_CANARY_VERIFIER"
  assert_not_contains "$SCRIPT_UNDER_TEST" "SANCTUARY_REHEARSAL_VERIFIER"
}

test_dry_run_verifies_without_mutation
test_rc_tag_run_at_same_commit_satisfies_gate
test_non_numeric_rc_suffix_does_not_satisfy_gate
test_foreign_tag_run_does_not_satisfy_gate
test_real_publish_orders_release_gates
test_existing_github_tag_is_idempotent
test_dirty_checkout_fails_before_network
test_failed_gate_blocks_all_publication
test_github_actions_drift_blocks_tag_creation
test_mismatched_github_tag_blocks_release
test_dry_run_requires_existing_github_tag
test_exact_tag_lookup_ignores_branch_name_collision
test_manual_stable_tag_without_promotion_evidence_fails_before_network
test_failed_promotion_evidence_blocks_publication
test_similar_but_nonmatching_candidate_is_rejected
test_non_main_release_commit_fails_before_publication_apis
test_operator_script_has_no_verifier_override_seam
echo "publish-release operator tests passed"
