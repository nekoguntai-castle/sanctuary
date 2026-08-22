#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/ci/observe-runtime-image-cves.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/observe-runtime-image-cves-test.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

readonly CANDIDATE='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
readonly PROJECT='sanctuary-rc-fresh-12345'
pass=0
failures=0

ok() { printf 'PASS: %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL: %s\n' "$1" >&2; failures=$((failures + 1)); }

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then ok "$label"; else bad "$label (expected $expected, got $actual)"; fi
}

assert_file_contains() {
  local label="$1" file="$2" text="$3"
  if grep -Fq -- "$text" "$file"; then ok "$label"; else bad "$label (missing: $text)"; fi
}

make_fixture() {
  local name="$1"
  local root="$TEST_ROOT/$name"
  mkdir -p "$root/bin" "$root/output"
  printf '{"schemaVersion":1}\n' > "$root/image-lock.json"
  printf 'stale report must not survive\n' > "$root/output/frontend.json"
  : > "$root/docker.calls"
  printf '%s\n' "$root"
}

install_fake_docker() {
  local root="$1"
  cat > "$root/bin/docker" <<'SH'
#!/usr/bin/env bash
set -u
printf '%q ' "$@" >> "$DOCKER_CALLS"
printf '\n' >> "$DOCKER_CALLS"

if [ "$1 $2" = 'volume create' ]; then
  [ "${FAKE_SCENARIO:-}" != volume-failure ]
  exit
fi
if [ "$1 $2 $3" = 'volume rm -f' ]; then exit 0; fi

if [ "$1 $2" = 'image inspect' ]; then
  image="${!#}"
  role="${image#sanctuary-}"
  role="${role%%:*}"
  [ "${FAKE_SCENARIO:-}" != missing-all ] || exit 1
  [ "${FAKE_SCENARIO:-}" != missing-gateway ] || [ "$role" != gateway ] || exit 1
  case "$role" in
    backend) digit=b ;;
    frontend) digit=f ;;
    gateway) digit=c ;;
    llm-egress-proxy) digit=d ;;
    *) exit 9 ;;
  esac
  revision="$EXPECTED_CANDIDATE"
  lock="$EXPECTED_LOCK_SHA"
  if [ "${FAKE_SCENARIO:-}" = revision-mismatch ] && [ "$role" = frontend ]; then revision="$(printf 'e%.0s' $(seq 1 40))"; fi
  if [ "${FAKE_SCENARIO:-}" = lock-mismatch ] && [ "$role" = frontend ]; then lock="$(printf 'e%.0s' $(seq 1 64))"; fi
  image_id="$(printf '%064d' 0 | tr 0 "$digit")"
  printf 'sha256:%s|%s|%s\n' "$image_id" "$revision" "$lock"
  exit 0
fi

if [ "$1" = run ]; then
  joined=" $* "
  if [[ "$joined" == *' --download-db-only '* ]]; then
    [ "${FAKE_SCENARIO:-}" != db-failure ]
    exit
  fi
  image_id="${!#}"
  if [ "${FAKE_SCENARIO:-}" = scan-failure ] && [[ "$image_id" == sha256:c* ]]; then exit 1; fi
  if [ "${FAKE_SCENARIO:-}" = invalid-json ] && [[ "$image_id" == sha256:c* ]]; then printf 'not-json\n'; exit 0; fi
  cat <<JSON
{"SchemaVersion":2,"ArtifactName":"$image_id","Results":[{"Vulnerabilities":[{"Severity":"CRITICAL","FixedVersion":"2.0.0"},{"Severity":"HIGH","FixedVersion":""}]}]}
JSON
  exit 0
fi

exit 8
SH
  chmod +x "$root/bin/docker"
}

run_observer() {
  local root="$1" scenario="${2:-observed}"
  EXPECTED_LOCK_SHA="$(sha256sum "$root/image-lock.json" | cut -d ' ' -f 1)" \
  EXPECTED_CANDIDATE="$CANDIDATE" FAKE_SCENARIO="$scenario" \
  DOCKER_CALLS="$root/docker.calls" SANCTUARY_CI_STEP_SUMMARY_FILE="$root/step-summary.md" \
  OBSERVER_TEST_SECRET='observer-test-secret' \
  PATH="$root/bin:$PATH" \
    "$SCRIPT" --project "$PROJECT" --candidate "$CANDIDATE" \
      --image-lock "$root/image-lock.json" --output "$root/output"
}

test_observed_contract() {
  local root
  root="$(make_fixture observed)"
  install_fake_docker "$root"
  run_observer "$root"

  assert_eq 'all four candidate images produce observed status' observed "$(jq -r .status "$root/output/status.json")"
  assert_eq 'exactly four immutable image reports are written' 4 "$(find "$root/output" -maxdepth 1 -name '*.json' ! -name status.json | wc -l | tr -d ' ')"
  assert_eq 'database downloads exactly once' 1 "$(grep -c -- '--download-db-only' "$root/docker.calls")"
  assert_eq 'four scans reuse the downloaded database' 4 "$(grep -c -- '--skip-db-update' "$root/docker.calls")"
  assert_eq 'each scan uses immutable image IDs' 4 "$(grep -- '--skip-db-update' "$root/docker.calls" | grep -c 'sha256:[bcdf]')"
  assert_eq 'exactly four candidate tags are inspected' 4 "$(grep -c '^image inspect ' "$root/docker.calls")"
  local role
  for role in backend frontend gateway llm-egress-proxy; do
    assert_file_contains "$role candidate tag is inspected" "$root/docker.calls" "sanctuary-$role:$PROJECT"
  done
  assert_file_contains 'scanner is digest pinned' "$root/docker.calls" 'docker.io/aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969'
  assert_file_contains 'scanner receives the daemon socket' "$root/docker.calls" '/var/run/docker.sock:/var/run/docker.sock'
  assert_file_contains 'cache volume is project labeled' "$root/docker.calls" "com.docker.compose.project=$PROJECT"
  assert_file_contains 'cache volume is removed by the cleanup trap' "$root/docker.calls" "volume rm -f ${PROJECT}-trivy-cache"
  if grep -Eq 'postgres|redis|docker-proxy|grafana' "$root/docker.calls"; then
    bad 'observer attempted to scan an external or non-RC image'
  else
    ok 'observer scans only the exact four RC application images'
  fi
  assert_eq 'critical findings are evidence, not execution failure' 4 "$(jq '[.roles[].findings.critical] | add' "$root/output/status.json")"
  assert_eq 'unfixed findings remain visible' 4 "$(jq '[.roles[].findings.unfixable] | add' "$root/output/status.json")"
  if grep -Rqs -- 'observer-test-secret' "$root/output" "$root/docker.calls"; then
    bad 'observer exposed an unrelated environment secret'
  else
    ok 'observer does not pass unrelated environment secrets to Docker or reports'
  fi
}

test_partial_contract() {
  local scenario="$1" expected_reason="$2"
  local root="$TEST_ROOT/$scenario"
  root="$(make_fixture "$scenario")"
  install_fake_docker "$root"
  if run_observer "$root" "$scenario" >/dev/null 2>&1; then
    bad "$scenario should exit nonzero"
  else
    ok "$scenario exits nonzero"
  fi
  assert_eq "$scenario records partial status" partial "$(jq -r .status "$root/output/status.json")"
  assert_eq "$scenario retains three valid reports" 3 "$(find "$root/output" -maxdepth 1 -name '*.json' ! -name status.json | wc -l | tr -d ' ')"
  assert_eq "$scenario records its unavailable reason" "$expected_reason" \
    "$(jq -r '.roles[] | select(.status == "unavailable") | .reason' "$root/output/status.json")"
  assert_file_contains "$scenario still removes its cache volume" "$root/docker.calls" \
    "volume rm -f ${PROJECT}-trivy-cache"
}

test_unavailable_contract() {
  local scenario="$1" expected_reason="$2"
  local root
  root="$(make_fixture "$scenario")"
  install_fake_docker "$root"
  if run_observer "$root" "$scenario" >/dev/null 2>&1; then
    bad "$scenario should exit nonzero"
  else
    ok "$scenario exits nonzero"
  fi
  assert_eq "$scenario records unavailable status" unavailable "$(jq -r .status "$root/output/status.json")"
  assert_eq "$scenario writes no image reports" 0 "$(find "$root/output" -maxdepth 1 -name '*.json' ! -name status.json | wc -l | tr -d ' ')"
  assert_eq "$scenario records all four role failures" 4 \
    "$(jq --arg reason "$expected_reason" '[.roles[] | select(.reason == $reason)] | length' "$root/output/status.json")"
}

test_invalid_inputs() {
  local root
  root="$(make_fixture invalid-inputs)"
  install_fake_docker "$root"
  if PATH="$root/bin:$PATH" "$SCRIPT" --project production --candidate "$CANDIDATE" \
    --image-lock "$root/image-lock.json" --output "$root/output" >/dev/null 2>&1; then
    bad 'unsafe project name was accepted'
  else
    ok 'unsafe project name is rejected before Docker access'
  fi
  if PATH="$root/bin:$PATH" "$SCRIPT" --project "$PROJECT" --candidate HEAD \
    --image-lock "$root/image-lock.json" --output "$root/output" >/dev/null 2>&1; then
    bad 'non-immutable candidate was accepted'
  else
    ok 'candidate must be an immutable lowercase commit SHA'
  fi
  if PATH="$root/bin:$PATH" "$SCRIPT" --project "$PROJECT" --candidate "$CANDIDATE" \
    --image-lock "$root/missing-lock.json" --output "$root/output" >/dev/null 2>&1; then
    bad 'missing image lock was accepted'
  else
    ok 'image lock must be a regular file'
  fi
  if PATH="$root/bin:$PATH" "$SCRIPT" --project "$PROJECT" --candidate "$CANDIDATE" \
    --image-lock "$root/image-lock.json" >/dev/null 2>&1; then
    bad 'missing required output argument was accepted'
  else
    ok 'missing required arguments are rejected'
  fi
  assert_eq 'invalid input performs no Docker operations' 0 "$(wc -l < "$root/docker.calls" | tr -d ' ')"
}

test_observed_contract
test_partial_contract revision-mismatch 'candidate revision label mismatch'
test_partial_contract lock-mismatch 'image-lock label mismatch'
test_partial_contract scan-failure 'scanner execution failed'
test_partial_contract invalid-json 'scanner returned invalid JSON'
test_unavailable_contract missing-all 'candidate image unavailable'
test_unavailable_contract db-failure 'vulnerability database unavailable'
test_unavailable_contract volume-failure 'vulnerability database unavailable'
test_invalid_inputs

printf '\nTotal: %s Passed: %s Failed: %s\n' "$((pass + failures))" "$pass" "$failures"
[ "$failures" -eq 0 ]
