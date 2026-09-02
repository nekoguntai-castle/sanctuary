#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="$ROOT_DIR/.github/workflows/podman-socket-canary.yml"
ACTION="$ROOT_DIR/.github/actions/verify-cleanup-receipt/action.yml"
UPLOAD_ACTION="$ROOT_DIR/.github/actions/upload-cleanup-evidence/action.yml"

assert_contains() {
  local needle="$1"
  grep -Fq -- "$needle" "$WORKFLOW" || {
    echo "missing Podman canary contract: $needle" >&2
    exit 1
  }
}

assert_absent() {
  local needle="$1"
  if grep -Fq -- "$needle" "$WORKFLOW"; then
    echo "retired Podman canary cleanup remains: $needle" >&2
    exit 1
  fi
}

assert_count() {
  local needle="$1" expected="$2" actual
  actual="$(grep -Fc -- "$needle" "$WORKFLOW" || true)"
  if [ "$actual" -ne "$expected" ]; then
    echo "expected $expected occurrences of '$needle', found $actual" >&2
    exit 1
  fi
}

assert_count 'scripts/ci/cleanup-ci-callsite.sh run' 5
assert_count '--engine docker' 5
assert_count '--artifact-dir "$CLEANUP_ARTIFACT_ROOT/' 5
assert_contains 'CLEANUP_RUNTIME_ROOT=$RUNNER_TEMP/sanctuary-cleanup/podman-canary-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}'
assert_contains 'CLEANUP_ARTIFACT_ROOT=$RUNNER_TEMP/sanctuary-cleanup-artifacts/podman-canary-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}'
assert_contains 'source scripts/ownership/producer-hooks.sh'
assert_contains 'ownership_label_args compose_container exact_delete'
assert_contains 'ownership_label_args compose_volume exact_delete'
assert_contains 'create_and_register_owned_volume "$PG_NAME"'
assert_contains 'io.sanctuary.resource-class: compose_container'
assert_contains 'network_mode: none'
assert_contains '--network "container:$PROXY_NAME"'
assert_contains 'svc="$1"'
assert_contains 'pub_port="$((20000 + (GITHUB_RUN_ID % 20000)))"'
assert_absent 'want_healthy="$2"'
assert_absent '--engine podman'
assert_absent '18099:80'
assert_absent ':18099/'

assert_absent 'docker compose -f /tmp/hc-canary.yml -p "$HC_PROJECT" down'
assert_absent 'docker rm -f'
assert_absent 'docker volume rm'
assert_absent 'docker network rm'
assert_absent 'docker system prune'
assert_absent 'docker builder prune'
assert_absent 'podman system prune'
assert_absent 'podman builder prune'

assert_contains '- name: Upload canary results'
assert_contains 'path: .tmp/canary-results/'
assert_contains '- name: Verify signed cleanup evidence'
assert_contains 'id: verify_cleanup_receipt'
assert_contains 'uses: ./.github/actions/verify-cleanup-receipt'
assert_contains 'root: ${{ runner.temp }}/sanctuary-cleanup-artifacts/podman-canary-${{ github.run_id }}-${{ github.run_attempt }}'
assert_contains "children: 'true'"
assert_contains '- name: Upload signed cleanup evidence'
assert_contains "if: always() && steps.verify_cleanup_receipt.outcome == 'success'"
assert_contains 'uses: ./.github/actions/upload-cleanup-evidence'
assert_contains 'cleanup-root: ${{ runner.temp }}/sanctuary-cleanup-artifacts/podman-canary-${{ github.run_id }}-${{ github.run_attempt }}'
assert_contains 'path: ${{ runner.temp }}/sanctuary-cleanup-artifacts/podman-canary-${{ github.run_id }}-${{ github.run_attempt }}/'
assert_contains 'if-no-files-found: error'
assert_contains 'include-hidden-files: true'
assert_contains 'retention-days: 90'

grep -Fq "require-cleanup-success: 'true'" "$UPLOAD_ACTION" || {
  echo 'cleanup evidence uploader must fail after upload when cleanup is unsuccessful' >&2
  exit 1
}

assert_absent 'verifySignedArtifact({'
assert_absent 'publicKeyFingerprint(readFileSync'

action_body="$(awk '
  found { sub(/^        /, ""); print }
  /^      run: \|$/ { found = 1 }
' "$ACTION")"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT
export RUNNER_TEMP="$fixture_root"
mkdir -p "$fixture_root/bin" "$fixture_root/receipts/mount"
cat > "$fixture_root/bin/node" <<'NODE'
#!/usr/bin/env bash
exit 0
NODE
chmod +x "$fixture_root/bin/node"
for name in planning-upload final-upload; do
  printf '%s\n' '{"signerKeyId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","state":"no_op"}' \
    > "$fixture_root/receipts/mount/$name.json"
  printf '%s\n' signature > "$fixture_root/receipts/mount/$name.json.sig"
  printf '%064d\n' 0 > "$fixture_root/receipts/mount/$name.sha256"
done
printf '%s\n' public-key > "$fixture_root/receipts/mount/evidence-public.pem"
PATH="$fixture_root/bin:$PATH" GITHUB_WORKSPACE="$ROOT_DIR" \
  CLEANUP_RECEIPT_CHILDREN=true CLEANUP_RECEIPT_REQUIRE_SUCCESS=true \
  CLEANUP_RECEIPT_ROOT="$fixture_root/receipts" bash -c "$action_body"
sed -i 's/"no_op"/"ambiguous"/' "$fixture_root/receipts/mount/final-upload.json"
if PATH="$fixture_root/bin:$PATH" GITHUB_WORKSPACE="$ROOT_DIR" \
    CLEANUP_RECEIPT_CHILDREN=true CLEANUP_RECEIPT_REQUIRE_SUCCESS=true \
    CLEANUP_RECEIPT_ROOT="$fixture_root/receipts" bash -c "$action_body"; then
  echo 'strict cleanup receipt action accepted an ambiguous final state' >&2
  exit 1
fi
sed -i 's/"ambiguous"/"no_op"/' "$fixture_root/receipts/mount/final-upload.json"
mkdir "$fixture_root/receipts/proxy"
if PATH="$fixture_root/bin:$PATH" GITHUB_WORKSPACE="$ROOT_DIR" \
    CLEANUP_RECEIPT_CHILDREN=true CLEANUP_RECEIPT_REQUIRE_SUCCESS=true \
    CLEANUP_RECEIPT_ROOT="$fixture_root/receipts" bash -c "$action_body"; then
  echo 'strict cleanup receipt action skipped an incomplete child directory' >&2
  exit 1
fi
rmdir "$fixture_root/receipts/proxy"
mkdir "$fixture_root/receipts/.hidden"
if PATH="$fixture_root/bin:$PATH" GITHUB_WORKSPACE="$ROOT_DIR" \
    CLEANUP_RECEIPT_CHILDREN=true CLEANUP_RECEIPT_REQUIRE_SUCCESS=true \
    CLEANUP_RECEIPT_ROOT="$fixture_root/receipts" bash -c "$action_body"; then
  echo 'strict cleanup receipt action skipped an incomplete hidden child directory' >&2
  exit 1
fi
rmdir "$fixture_root/receipts/.hidden"
ln -s "$fixture_root/receipts/mount" "$fixture_root/receipts/symlink"
if PATH="$fixture_root/bin:$PATH" GITHUB_WORKSPACE="$ROOT_DIR" \
    CLEANUP_RECEIPT_CHILDREN=true CLEANUP_RECEIPT_REQUIRE_SUCCESS=true \
    CLEANUP_RECEIPT_ROOT="$fixture_root/receipts" bash -c "$action_body"; then
  echo 'strict cleanup receipt action followed a symlink child directory' >&2
  exit 1
fi
unlink "$fixture_root/receipts/symlink"
if PATH="$fixture_root/bin:$PATH" GITHUB_WORKSPACE="$ROOT_DIR" \
    CLEANUP_RECEIPT_CHILDREN=false CLEANUP_RECEIPT_REQUIRE_SUCCESS=invalid \
    CLEANUP_RECEIPT_ROOT="$fixture_root/receipts/mount" bash -c "$action_body"; then
  echo 'strict cleanup receipt action accepted an invalid success requirement' >&2
  exit 1
fi

echo 'Podman socket canary composition checks passed.'
