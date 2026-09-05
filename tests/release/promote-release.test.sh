#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-promote-release-test.XXXXXX")"
trap 'find "$TEST_ROOT" -type f -delete; find "$TEST_ROOT" -depth -type d -empty -delete' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_contains() { grep -Fq -- "$2" "$1" || fail "$1 does not contain: $2"; }
assert_not_contains() { [[ ! -f "$1" ]] || ! grep -Fq -- "$2" "$1" || fail "$1 unexpectedly contains: $2"; }

write_curl_stub() {
  cat > "$1" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
config_input="$(cat)"
[[ "$config_input" == *Authorization:* ]] || exit 98
output=""
url=""
while (( $# > 0 )); do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -w|--max-time|-X|-H) shift 2 ;;
    --config) shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf 'api %s\n' "$url" >> "$TRACE_FILE"
body='{}'
if [[ "$url" == *'/actions/runs?'* ]]; then
  body='{"workflow_runs":[{"id":41,"workflow_id":"release-candidate.yml","event":"push","status":"success"},{"id":42,"workflow_id":"install-test.yml","event":"push","status":"success"}]}'
elif [[ "$url" == *'/actions/runs/41' ]]; then
  body="$(jq -cn --arg status "${RC_GATE_STATUS:-success}" --arg ref "${RC_GATE_REF:-$PROMOTE_RC_TAG}" --arg sha "$PROMOTE_SHA" '{workflow_id:"release-candidate.yml",event:"push",status:$status,prettyref:$ref,commit_sha:$sha}')"
elif [[ "$url" == *'/actions/runs/42' ]]; then
  body="$(jq -cn --arg status "${INSTALL_GATE_STATUS:-success}" --arg ref "$PROMOTE_RC_TAG" --arg sha "$PROMOTE_SHA" '{workflow_id:"install-test.yml",event:"push",status:$status,prettyref:$ref,commit_sha:$sha}')"
elif [[ "$url" == *'/git/commits/'* ]]; then
  body="$(jq -cn --arg sha "$PROMOTE_SHA" '{sha:$sha}')"
elif [[ "$url" == *'/actions/permissions' ]]; then
  body="$(jq -cn --argjson enabled "${PROMOTE_ACTIONS_ENABLED:-false}" '{enabled:$enabled}')"
fi
printf '%s\n' "$body" > "$output"
printf '200'
EOF
  chmod +x "$1"
}

write_git_stub() {
  cat > "$1" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${PROMOTE_AMBIGUOUS_PUSH:-false}" == true && "$1" == push \
  && "$*" == *'refs/tags/v1.2.3:refs/tags/v1.2.3'* ]]; then
  /usr/bin/git "$@"
  echo 'simulated lost push response' >&2
  exit 75
fi
exec /usr/bin/git "$@"
EOF
  chmod +x "$1"
}

write_node_command_stub() {
  cat > "$1" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$(basename "$1")" in
  verify-release-candidate-canary.mjs) label=CANARY ;;
  prepare-release-assets.mjs) label=PREPARER ;;
  verify-prestable-rehearsal.mjs) label=REHEARSAL ;;
  *) exec /usr/bin/node "$@" ;;
esac
printf '%s %s\n' "$label" "$*" >> "$TRACE_FILE"
failure_name="${label}_FAIL"
[[ "${!failure_name:-false}" != true ]] || exit 7
if [[ "$label" == CANARY && -n "${MUTATE_RECEIPT_PATH:-}" \
  && "$(cat "$MUTATE_RECEIPT_PATH")" == mutated ]]; then
  exit 8
fi
if [[ "$label" == PREPARER ]]; then
  while (( $# > 0 )); do
    if [[ "$1" == --output-dir ]]; then
      mkdir "$2"
      printf '{}\n' > "$2/release-manifest.json"
      printf 'sig\n' > "$2/release-manifest.json.sig"
      [[ -z "${MUTATE_RECEIPT_PATH:-}" ]] || printf 'mutated' > "$MUTATE_RECEIPT_PATH"
      break
    fi
    shift
  done
fi
EOF
  chmod +x "$1"
}

new_fixture() {
  local name="$1"
  local rc_tag_kind="${2:-annotated}"
  local fixture="$TEST_ROOT/$name"
  mkdir -p "$fixture/scripts/release" "$fixture/scripts/ci" "$fixture/bin" "$fixture.external"
  cp "$REPO_ROOT/scripts/release/promote-release.sh" "$fixture/scripts/release/"
  cat > "$fixture/scripts/ci/create-registered-staging.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mktemp -d "${TMPDIR:-/tmp}/registered-${1}.XXXXXX"
EOF
  chmod +x "$fixture/scripts/ci/create-registered-staging.sh"
  cp "$REPO_ROOT/scripts/release/release-operator-api.sh" "$fixture/scripts/release/"
  write_curl_stub "$fixture/bin/curl"
  write_git_stub "$fixture/bin/git"
  write_node_command_stub "$fixture/bin/node"
  printf 'receipt\n' > "$fixture.external/receipt.json"
  printf 'evidence\n' > "$fixture.external/evidence.log"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$fixture.external/private.pem" >/dev/null 2>&1
  openssl pkey -in "$fixture.external/private.pem" -pubout -out "$fixture.external/public.pem" >/dev/null 2>&1
  git init -q --bare "$fixture/origin.git"
  git -C "$fixture" init -q
  git -C "$fixture" config user.name 'Promotion Test'
  git -C "$fixture" config user.email 'promotion@example.invalid'
  printf '%s\n' trace.log output.log missing.env origin.git/ bin/ > "$fixture/.gitignore"
  git -C "$fixture" add .
  git -C "$fixture" commit -qm fixture
  git -C "$fixture" branch -M main
  if [[ "$rc_tag_kind" == lightweight ]]; then
    git -C "$fixture" tag v1.2.3-rc1
  else
    git -C "$fixture" tag -a v1.2.3-rc1 -m rc1
  fi
  git -C "$fixture" remote add origin "$fixture/origin.git"
  git -C "$fixture" push -q origin main refs/tags/v1.2.3-rc1
  cat > "$fixture/.git/hooks/pre-push" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
while read -r _local_ref _local_sha remote_ref _remote_sha; do
  [[ "$remote_ref" != refs/tags/v1.2.3 || -z "${TRACE_FILE:-}" ]] || {
    [[ "$(grep -c '^CANARY ' "$TRACE_FILE")" -ge 2 ]]
    grep -Fq 'PREPARER ' "$TRACE_FILE"
    [[ "$(grep -c '^REHEARSAL ' "$TRACE_FILE")" -ge 2 ]]
    [[ "$(grep -c '/actions/permissions' "$TRACE_FILE")" -ge 2 ]]
    printf 'stable-push-after-gates\n' >> "$TRACE_FILE"
  }
done
EOF
  chmod +x "$fixture/.git/hooks/pre-push"
  printf '%s\n' "$fixture"
}

run_promote() {
  local fixture="$1"
  local sha
  sha="$(git -C "$fixture" rev-parse HEAD)"
  (
    cd "$fixture"
    PATH="$fixture/bin:$PATH" TRACE_FILE="$fixture/trace.log" \
    PROMOTE_RC_TAG=v1.2.3-rc1 PROMOTE_SHA="$sha" \
    SANCTUARY_RELEASE_CONFIG="$fixture/missing.env" \
    FORGEJO_URL=https://forgejo.test FORGEJO_TOKEN=token \
    GITHUB_API_URL=https://api.github.test GITHUB_RELEASE_TOKEN=token \
    SANCTUARY_CLEANUP_COORDINATED=1 TMPDIR="$fixture.external" \
    "$fixture/scripts/release/promote-release.sh" \
      --rc-tag v1.2.3-rc1 --stable-tag v1.2.3 \
      --receipt "$fixture.external/receipt.json" --evidence "$fixture.external/evidence.log" \
      --output-dir "${PROMOTE_OUTPUT_DIR:-$fixture.external/assets}" --signing-key "$fixture.external/private.pem" \
      --public-key "$fixture.external/public.pem"
  )
}

test_happy_path_proves_everything_before_stable_tag() {
  local fixture sha remote
  fixture="$(new_fixture happy)"
  printf '%s\n' 'RC_TAG=v9.9.9-rc9' 'STABLE_TAG=v9.9.9' 'TAG=v9.9.9-rc9' \
    'OUTPUT_DIR=/tmp/wrong-promotion-output' > "$fixture/missing.env"
  sha="$(git -C "$fixture" rev-parse HEAD)"
  run_promote "$fixture" > "$fixture/output.log"
  remote="$(git -C "$fixture" ls-remote origin 'refs/tags/v1.2.3^{}' | awk '{print $1}')"
  [[ "$remote" == "$sha" ]] || fail 'stable tag does not peel to accepted RC commit'
  assert_contains "$fixture/output.log" 'Forgejo release-candidate.yml gate is green'
  assert_contains "$fixture/output.log" 'Forgejo install-test.yml gate is green'
  assert_contains "$fixture/trace.log" 'CANARY '
  assert_contains "$fixture/trace.log" 'PREPARER '
  assert_contains "$fixture/trace.log" 'REHEARSAL '
  assert_contains "$fixture/trace.log" 'stable-push-after-gates'
}

test_output_inside_any_worktree_is_rejected() {
  local fixture
  fixture="$(new_fixture output-in-worktree)"
  if PROMOTE_OUTPUT_DIR="$fixture/assets" run_promote "$fixture" \
    > "$fixture/output.log" 2>&1; then
    fail 'worktree-owned output directory unexpectedly passed'
  fi
  assert_contains "$fixture/output.log" 'outside every Git worktree'
  [[ -z "$(git -C "$fixture" ls-remote origin refs/tags/v1.2.3)" ]] || fail 'invalid output location pushed stable tag'
}

test_failed_rehearsal_blocks_tag_mutation() {
  local fixture
  fixture="$(new_fixture failed-rehearsal)"
  if REHEARSAL_FAIL=true run_promote "$fixture" > "$fixture/output.log" 2>&1; then
    fail 'failed rehearsal unexpectedly promoted stable'
  fi
  [[ -z "$(git -C "$fixture" ls-remote origin refs/tags/v1.2.3)" ]] || fail 'failed rehearsal pushed stable tag'
  assert_not_contains "$fixture/trace.log" 'stable-push-after-gates'
}

test_evidence_changed_during_rehearsal_blocks_tag_mutation() {
  local fixture
  fixture="$(new_fixture changed-evidence)"
  if MUTATE_RECEIPT_PATH="$fixture.external/receipt.json" run_promote "$fixture" \
    > "$fixture/output.log" 2>&1; then
    fail 'evidence changed during rehearsal unexpectedly promoted stable'
  fi
  [[ -z "$(git -C "$fixture" ls-remote origin refs/tags/v1.2.3)" ]] \
    || fail 'changed evidence pushed stable tag'
  [[ "$(grep -c '^CANARY ' "$fixture/trace.log")" -eq 2 ]] \
    || fail 'promotion did not recheck changed canary evidence'
}

test_github_actions_drift_blocks_tag_mutation() {
  local fixture
  fixture="$(new_fixture github-actions-enabled)"
  if PROMOTE_ACTIONS_ENABLED=true run_promote "$fixture" > "$fixture/output.log" 2>&1; then
    fail 'enabled GitHub Actions unexpectedly promoted stable'
  fi
  assert_contains "$fixture/output.log" 'GitHub Actions must be disabled'
  assert_not_contains "$fixture/trace.log" 'PREPARER '
}

test_ambiguous_push_reconciles_exact_remote_tag() {
  local fixture sha remote
  fixture="$(new_fixture ambiguous-push)"
  sha="$(git -C "$fixture" rev-parse HEAD)"
  PROMOTE_AMBIGUOUS_PUSH=true run_promote "$fixture" > "$fixture/output.log" 2>&1
  remote="$(git -C "$fixture" ls-remote origin 'refs/tags/v1.2.3^{}' | awk '{print $1}')"
  [[ "$remote" == "$sha" ]] || fail 'ambiguous push did not reconcile exact stable identity'
  assert_contains "$fixture/output.log" 'Promoted v1.2.3-rc1'
}

test_failed_canary_blocks_tag_mutation() {
  local fixture
  fixture="$(new_fixture failed-canary)"
  if CANARY_FAIL=true run_promote "$fixture" > "$fixture/output.log" 2>&1; then
    fail 'failed canary unexpectedly promoted stable'
  fi
  [[ -z "$(git -C "$fixture" ls-remote origin refs/tags/v1.2.3)" ]] || fail 'failed canary pushed stable tag'
  assert_not_contains "$fixture/trace.log" 'PREPARER '
}

test_failed_exact_workflow_blocks_expensive_rehearsal() {
  local fixture
  fixture="$(new_fixture failed-workflow)"
  if RC_GATE_STATUS=failure run_promote "$fixture" > "$fixture/output.log" 2>&1; then
    fail 'failed release-candidate workflow unexpectedly promoted stable'
  fi
  assert_contains "$fixture/output.log" 'no successful release-candidate.yml'
  assert_not_contains "$fixture/trace.log" 'CANARY '
  assert_not_contains "$fixture/trace.log" 'PREPARER '
}

test_wrong_workflow_ref_blocks_expensive_rehearsal() {
  local fixture
  fixture="$(new_fixture wrong-workflow-ref)"
  if RC_GATE_REF=v1.2.3-rc2 run_promote "$fixture" > "$fixture/output.log" 2>&1; then
    fail 'wrong workflow ref unexpectedly promoted stable'
  fi
  assert_contains "$fixture/output.log" 'no successful release-candidate.yml'
  assert_not_contains "$fixture/trace.log" 'CANARY '
}

test_existing_nonidentical_stable_tag_blocks_promotion() {
  local fixture
  fixture="$(new_fixture stable-conflict)"
  git -C "$fixture" tag v1.2.3
  git -C "$fixture" push -q origin refs/tags/v1.2.3
  git -C "$fixture" tag -d v1.2.3 >/dev/null
  if run_promote "$fixture" > "$fixture/output.log" 2>&1; then
    fail 'nonidentical existing stable tag unexpectedly passed'
  fi
  assert_contains "$fixture/output.log" 'stable tag already exists with a different identity'
}

test_retry_reuses_exact_local_unpushed_tag() {
  local fixture sha remote
  fixture="$(new_fixture local-tag-retry)"
  sha="$(git -C "$fixture" rev-parse HEAD)"
  git -C "$fixture" tag -a v1.2.3 -m stable
  run_promote "$fixture" > "$fixture/output.log"
  remote="$(git -C "$fixture" ls-remote origin 'refs/tags/v1.2.3^{}' | awk '{print $1}')"
  [[ "$remote" == "$sha" ]] || fail 'exact local stable retry was not pushed'
}

test_retry_fetches_exact_remote_tag_when_local_missing() {
  local fixture remote_object local_object
  fixture="$(new_fixture remote-tag-retry)"
  git -C "$fixture" tag -a v1.2.3 -m stable
  git -C "$fixture" push -q origin refs/tags/v1.2.3
  remote_object="$(git -C "$fixture" ls-remote origin refs/tags/v1.2.3 | awk '{print $1}')"
  git -C "$fixture" tag -d v1.2.3 >/dev/null
  run_promote "$fixture" > "$fixture/output.log"
  local_object="$(git -C "$fixture" rev-parse refs/tags/v1.2.3)"
  [[ "$local_object" == "$remote_object" ]] || fail 'remote stable retry did not import the exact tag object'
  assert_contains "$fixture/output.log" 'already promoted'
}

test_lightweight_rc_tag_is_promoted_on_identical_commit() {
  local fixture sha remote
  fixture="$(new_fixture lightweight lightweight)"
  sha="$(git -C "$fixture" rev-parse HEAD)"
  [[ "$(git -C "$fixture" cat-file -t v1.2.3-rc1)" == commit ]] || fail 'fixture RC tag is not lightweight'
  run_promote "$fixture" > "$fixture/output.log"
  remote="$(git -C "$fixture" ls-remote origin 'refs/tags/v1.2.3^{}' | awk '{print $1}')"
  [[ "$remote" == "$sha" ]] || fail 'lightweight RC did not promote to the accepted commit'
  assert_contains "$fixture/trace.log" 'stable-push-after-gates'
}

test_lightweight_rc_tag_pointing_elsewhere_on_remote_is_refused() {
  local fixture other
  fixture="$(new_fixture lightweight-drift lightweight)"
  git -C "$fixture" commit -q --allow-empty -m drift
  other="$(git -C "$fixture" rev-parse HEAD)"
  git -C "$fixture" push -q origin "HEAD:refs/heads/drift"
  git -C "$fixture/origin.git" update-ref refs/tags/v1.2.3-rc1 "$other"
  git -C "$fixture" reset -q --hard v1.2.3-rc1
  if run_promote "$fixture" > "$fixture/output.log" 2>&1; then
    fail 'drifted remote RC tag was promoted'
  fi
  assert_contains "$fixture/output.log" 'remote RC tag identity does not match checkout'
  [[ -z "$(git -C "$fixture" ls-remote origin refs/tags/v1.2.3)" ]] || fail 'drifted RC pushed stable tag'
}

test_operator_scripts_do_not_expose_verifier_overrides() {
  assert_not_contains "$REPO_ROOT/scripts/release/promote-release.sh" 'SANCTUARY_CANARY_VERIFIER'
  assert_not_contains "$REPO_ROOT/scripts/release/promote-release.sh" 'SANCTUARY_ASSET_PREPARER'
  assert_not_contains "$REPO_ROOT/scripts/release/promote-release.sh" 'SANCTUARY_REHEARSAL_VERIFIER'
}

test_happy_path_proves_everything_before_stable_tag
test_lightweight_rc_tag_is_promoted_on_identical_commit
test_lightweight_rc_tag_pointing_elsewhere_on_remote_is_refused
test_failed_canary_blocks_tag_mutation
test_output_inside_any_worktree_is_rejected
test_failed_rehearsal_blocks_tag_mutation
test_evidence_changed_during_rehearsal_blocks_tag_mutation
test_github_actions_drift_blocks_tag_mutation
test_failed_exact_workflow_blocks_expensive_rehearsal
test_wrong_workflow_ref_blocks_expensive_rehearsal
test_existing_nonidentical_stable_tag_blocks_promotion
test_retry_reuses_exact_local_unpushed_tag
test_retry_fetches_exact_remote_tag_when_local_missing
test_ambiguous_push_reconciles_exact_remote_tag
test_operator_scripts_do_not_expose_verifier_overrides
echo 'promote-release operator tests passed'
