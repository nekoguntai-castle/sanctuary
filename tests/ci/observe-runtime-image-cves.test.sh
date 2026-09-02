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
  : > "$root/volume.labels"
  printf '0\n' > "$root/volume-inspect.count"
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
  [ "${FAKE_SCENARIO:-}" != volume-failure ] || exit 1
  shift 2
  : > "$VOLUME_LABELS"
  while [ "$#" -gt 0 ]; do
    if [ "$1" = --label ]; then
      printf '%s\n' "$2" >> "$VOLUME_LABELS"
      shift 2
    else
      shift
    fi
  done
  if [ "${FAKE_SCENARIO:-}" = volume-create-response-lost-foreign ]; then
    sed -i 's/io.sanctuary.owner-id=.*/io.sanctuary.owner-id=foreign-owner/' "$VOLUME_LABELS"
  fi
  : > "$VOLUME_STATE"
  case "${FAKE_SCENARIO:-}" in
    volume-create-response-lost|volume-create-response-lost-foreign|volume-create-response-lost-ambiguous) exit 1 ;;
  esac
  exit
fi
if [ "$1 $2" = 'volume inspect' ]; then
  count="$(cat "$VOLUME_INSPECT_COUNT")"
  count=$((count + 1))
  printf '%s\n' "$count" > "$VOLUME_INSPECT_COUNT"
  [ -f "$VOLUME_STATE" ] || exit 1
  [ "${FAKE_SCENARIO:-}" != identity-query-failure ] || exit 1
  [ "${FAKE_SCENARIO:-}" != volume-create-response-lost-ambiguous ] || exit 1
  if [ "$count" -gt 1 ]; then
    case "${FAKE_SCENARIO:-}" in
      cleanup-identity-query-failure) exit 1 ;;
      cleanup-already-absent) rm -f "$VOLUME_STATE"; exit 1 ;;
    esac
  fi
  labels='{}'
  while IFS= read -r label; do
    key="${label%%=*}"
    value="${label#*=}"
    labels="$(jq -c --arg key "$key" --arg value "$value" '. + {($key): $value}' <<< "$labels")"
  done < "$VOLUME_LABELS"
  jq -cn --arg name "$3" --argjson labels "$labels" \
    '[{Name:$name,Driver:"local",Scope:"local",Mountpoint:("/var/lib/docker/volumes/" + $name + "/_data"),CreatedAt:"2026-08-31T00:00:00Z",Options:null,Labels:$labels}]'
  exit 0
fi
if [ "$1 $2" = 'volume rm' ]; then
  case "${FAKE_SCENARIO:-}" in
    cleanup-rm-failure|scan-and-cleanup-failure) exit 7 ;;
    cleanup-rm-response-lost) rm -f "$VOLUME_STATE"; exit 7 ;;
    cleanup-survivor) exit 0 ;;
  esac
  rm -f "$VOLUME_STATE"
  exit 0
fi
if [ "$1 $2" = 'volume ls' ]; then
  [ "${FAKE_SCENARIO:-}" != cleanup-postcondition-ambiguity ] || exit 1
  [ ! -f "$VOLUME_STATE" ] || printf '%s\n' "$EXPECTED_CACHE_VOLUME"
  exit 0
fi

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
  if [[ "$joined" == *' --entrypoint /bin/sh '* ]] && [[ "$joined" == *' test -S /var/run/docker.sock '* ]]; then
    case "${FAKE_SOCKET_MODE:-default}" in
      rootless) [[ "$joined" == *'source=/run/user/1001/podman/podman.sock,target='* ]] ;;
      default) [[ "$joined" == *'source=/var/run/docker.sock,target='* ]] ;;
      override) [[ "$joined" == *"source=${EXPECTED_SOCKET_OVERRIDE:-},target="* ]] ;;
      ambiguous) [[ "$joined" == *'source=/run/user/1001/podman/podman.sock,target='* || "$joined" == *'source=/var/run/docker.sock,target='* ]] ;;
      none) false ;;
      *) exit 10 ;;
    esac
    exit
  fi
  if [[ "$joined" == *' --download-db-only '* ]]; then
    [ "${FAKE_SCENARIO:-}" != db-failure ]
    exit
  fi
  image_id="${!#}"
  if [[ "${FAKE_SCENARIO:-}" =~ ^(scan-failure|scan-and-cleanup-failure)$ ]] \
      && [[ "$image_id" == sha256:c* ]]; then exit 1; fi
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
  local root="$1" scenario="${2:-observed}" socket_mode="${3:-default}"
  local override="${4-__unset__}"
  local -a environment=(env -u SANCTUARY_DOCKER_SOCKET_PATH
    "EXPECTED_LOCK_SHA=$(sha256sum "$root/image-lock.json" | cut -d ' ' -f 1)"
    "EXPECTED_CANDIDATE=$CANDIDATE" "FAKE_SCENARIO=$scenario"
    "FAKE_SOCKET_MODE=$socket_mode" "DOCKER_CALLS=$root/docker.calls"
    "VOLUME_STATE=$root/volume.state" "SANCTUARY_OWNERSHIP_ROOT=$root/ownership"
    "VOLUME_LABELS=$root/volume.labels"
    "VOLUME_INSPECT_COUNT=$root/volume-inspect.count"
    "EXPECTED_CACHE_VOLUME=${PROJECT}-trivy-cache"
    "SANCTUARY_CI_STEP_SUMMARY_FILE=$root/step-summary.md"
    'OBSERVER_TEST_SECRET=observer-test-secret' "PATH=$root/bin:$PATH")
  if [ "$override" != __unset__ ]; then
    environment+=("SANCTUARY_DOCKER_SOCKET_PATH=$override" "EXPECTED_SOCKET_OVERRIDE=$override")
  fi
  "${environment[@]}" "$SCRIPT" --project "$PROJECT" --candidate "$CANDIDATE" \
    --image-lock "$root/image-lock.json" --output "$root/output"
}

test_observed_contract() {
  local root
  root="$(make_fixture observed)"
  install_fake_docker "$root"
  run_observer "$root"

  assert_eq 'all four candidate images produce observed status' observed "$(jq -r .status "$root/output/status.json")"
  assert_eq 'exactly four immutable image reports are written' 4 "$(find "$root/output" -maxdepth 1 -name '*.json' ! -name status.json ! -name cache-volume-cleanup.json | wc -l | tr -d ' ')"
  assert_eq 'database downloads exactly once' 1 "$(grep -c -- '--download-db-only' "$root/docker.calls")"
  assert_eq 'four scans reuse the downloaded database' 4 "$(grep -c -- '--skip-db-update' "$root/docker.calls")"
  assert_eq 'each scan uses immutable image IDs' 4 "$(grep -- '--skip-db-update' "$root/docker.calls" | grep -c 'sha256:[bcdf]')"
  assert_eq 'exactly four candidate tags are inspected' 4 "$(grep -c '^image inspect ' "$root/docker.calls")"
  local role
  for role in backend frontend gateway llm-egress-proxy; do
    assert_file_contains "$role candidate tag is inspected" "$root/docker.calls" "sanctuary-$role:$PROJECT"
  done
  assert_file_contains 'scanner is digest pinned' "$root/docker.calls" 'docker.io/aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969'
  assert_eq 'all scans receive the discovered default socket' 4 \
    "$(grep -- '--skip-db-update' "$root/docker.calls" | grep -c '/var/run/docker.sock:/var/run/docker.sock:ro')"
  assert_file_contains 'default discovery probes the rootless candidate first' "$root/docker.calls" \
    'type=bind\,source=/run/user/1001/podman/podman.sock'
  assert_file_contains 'default discovery falls back to the Docker socket' "$root/docker.calls" \
    'type=bind\,source=/var/run/docker.sock'
  assert_file_contains 'cache volume is project labeled' "$root/docker.calls" "com.docker.compose.project=$PROJECT"
  assert_file_contains 'cache volume is removed by registered immutable identity' "$root/docker.calls" "volume rm ${PROJECT}-trivy-cache"
  assert_file_contains 'cache volume receives the full ownership tuple' "$root/docker.calls" 'io.sanctuary.resource-class=compose_volume'
  assert_file_contains 'transient scan containers receive the full ownership tuple' "$root/docker.calls" 'io.sanctuary.resource-class=compose_container'
  assert_eq 'cache cleanup emits an absent postcondition' absent \
    "$(jq -r .postcondition "$root/output/cache-volume-cleanup.json")"
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

test_socket_selection() {
  local name="$1" mode="$2" expected="$3" override="${4-__unset__}"
  local root
  root="$(make_fixture "$name")"
  install_fake_docker "$root"
  run_observer "$root" observed "$mode" "$override"

  assert_eq "$name produces observed evidence" observed "$(jq -r .status "$root/output/status.json")"
  assert_eq "$name mounts its exact discovered source in all scans" 4 \
    "$(grep -- '--skip-db-update' "$root/docker.calls" | grep -F -c -- "$expected:/var/run/docker.sock:ro")"
  if [ "$mode" = override ]; then
    assert_eq 'an override suppresses default candidate probes' 1 \
      "$(grep -c -- '--entrypoint /bin/sh' "$root/docker.calls")"
  fi
}

test_socket_unavailable() {
  local name="$1" mode="$2" override="${3-__unset__}"
  local root
  root="$(make_fixture "$name")"
  install_fake_docker "$root"
  if run_observer "$root" observed "$mode" "$override" >/dev/null 2>&1; then
    bad "$name should exit nonzero"
  else
    ok "$name exits nonzero"
  fi
  assert_eq "$name records unavailable status" unavailable "$(jq -r .status "$root/output/status.json")"
  assert_eq "$name records all four socket failures" 4 \
    "$(jq '[.roles[] | select(.reason == "Docker daemon socket unavailable or ambiguous")] | length' "$root/output/status.json")"
  assert_eq "$name does not start a vulnerability DB download" 0 \
    "$(grep -c -- '--download-db-only' "$root/docker.calls" || true)"
  assert_eq "$name records a categorical no-attempt cleanup result" not_attempted \
    "$(jq -r .result "$root/output/cache-volume-cleanup.json")"
  assert_eq "$name binds no-attempt to an unavailable identity" unavailable \
    "$(jq -r .immutableIdentity "$root/output/cache-volume-cleanup.json")"
  assert_eq "$name records the no-attempt postcondition" not_attempted \
    "$(jq -r .postcondition "$root/output/cache-volume-cleanup.json")"
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
  assert_eq "$scenario retains three valid reports" 3 "$(find "$root/output" -maxdepth 1 -name '*.json' ! -name status.json ! -name cache-volume-cleanup.json | wc -l | tr -d ' ')"
  assert_eq "$scenario records its unavailable reason" "$expected_reason" \
    "$(jq -r '.roles[] | select(.status == "unavailable") | .reason' "$root/output/status.json")"
  assert_file_contains "$scenario still removes its cache volume" "$root/docker.calls" \
    "volume rm ${PROJECT}-trivy-cache"
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
  assert_eq "$scenario writes no image reports" 0 "$(find "$root/output" -maxdepth 1 -name '*.json' ! -name status.json ! -name cache-volume-cleanup.json | wc -l | tr -d ' ')"
  assert_eq "$scenario records all four role failures" 4 \
    "$(jq --arg reason "$expected_reason" '[.roles[] | select(.reason == $reason)] | length' "$root/output/status.json")"
}

test_cleanup_failure() {
  local scenario="$1" expected_failure="$2" expected_postcondition="$3" expected_message="$4"
  local expected_exit="${5:-3}" expected_observer_status="${6:-observed}" root exit_status=0
  root="$(make_fixture "$scenario")"
  install_fake_docker "$root"
  run_observer "$root" "$scenario" >"$root/stdout.log" 2>"$root/stderr.log" || exit_status=$?

  assert_eq "$scenario exits with the required status" "$expected_exit" "$exit_status"
  assert_eq "$scenario preserves its observer evidence" "$expected_observer_status" \
    "$(jq -r .status "$root/output/status.json")"
  assert_eq "$scenario records its cleanup failure class" "$expected_failure" \
    "$(jq -r .failureClass "$root/output/cache-volume-cleanup.json")"
  assert_eq "$scenario records its bounded postcondition" "$expected_postcondition" \
    "$(jq -r .postcondition "$root/output/cache-volume-cleanup.json")"
  assert_file_contains "$scenario reports cleanup failure visibly" "$root/stderr.log" "$expected_message"
}

test_cleanup_already_absent() {
  local root exit_status=0
  root="$(make_fixture cleanup-already-absent)"
  install_fake_docker "$root"
  run_observer "$root" cleanup-already-absent >"$root/stdout.log" 2>"$root/stderr.log" || exit_status=$?
  assert_eq 'a failed inspect plus an authoritative empty list is proven absence' 0 "$exit_status"
  assert_eq 'proven prior absence is recorded without a cleanup failure' absent \
    "$(jq -r .result "$root/output/cache-volume-cleanup.json")"
  assert_eq 'proven prior absence has no failure class' none \
    "$(jq -r .failureClass "$root/output/cache-volume-cleanup.json")"
}

test_initial_identity_query_failure() {
  local root exit_status=0
  root="$(make_fixture identity-query-failure)"
  install_fake_docker "$root"
  run_observer "$root" identity-query-failure >"$root/stdout.log" 2>"$root/stderr.log" || exit_status=$?
  assert_eq 'initial identity failure preserves the unavailable observer exit' 1 "$exit_status"
  assert_eq 'initial identity failure is visible in cleanup evidence' unregistered \
    "$(jq -r .failureClass "$root/output/cache-volume-cleanup.json")"
  assert_eq 'an unregistered cache volume is not deleted by name' 0 \
    "$(grep -c '^volume rm ' "$root/docker.calls" || true)"
  assert_file_contains 'initial identity failure reports the retained unregistered volume' \
    "$root/stderr.log" 'created volume has no registered immutable identity'
}

test_create_response_loss_recovery() {
  local root registration
  root="$(make_fixture volume-create-response-lost)"
  install_fake_docker "$root"
  run_observer "$root" volume-create-response-lost

  assert_eq 'create response loss is recovered into observed evidence' observed \
    "$(jq -r .status "$root/output/status.json")"
  registration="$(find "$root/ownership/registrations/compose_volume" -name '*.json' -print -quit)"
  assert_eq 'recovered cache volume is registered exactly once' 1 \
    "$(find "$root/ownership/registrations/compose_volume" -name '*.json' | wc -l | tr -d ' ')"
  assert_eq 'recovered registration binds the exact cache name' "${PROJECT}-trivy-cache" \
    "$(jq -r .locator "$registration")"
  assert_file_contains 'recovered cache volume runs exact removal' "$root/docker.calls" \
    "volume rm ${PROJECT}-trivy-cache"
  assert_eq 'recovered cache cleanup proves absence' absent \
    "$(jq -r .postcondition "$root/output/cache-volume-cleanup.json")"
}

test_create_response_loss_refusal() {
  local scenario="$1" root exit_status=0
  root="$(make_fixture "$scenario")"
  install_fake_docker "$root"
  run_observer "$root" "$scenario" >"$root/stdout.log" 2>"$root/stderr.log" || exit_status=$?

  assert_eq "$scenario remains a non-observed execution failure" 1 "$exit_status"
  assert_eq "$scenario records fail-closed cleanup evidence" unregistered \
    "$(jq -r .failureClass "$root/output/cache-volume-cleanup.json")"
  assert_eq "$scenario does not register the unproven volume" 0 \
    "$(find "$root/ownership/registrations/compose_volume" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
  assert_eq "$scenario does not delete the unproven volume" 0 \
    "$(grep -c '^volume rm ' "$root/docker.calls" || true)"
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
test_socket_selection rootless-socket rootless /run/user/1001/podman/podman.sock
test_socket_selection override-socket override /run/sanctuary/custom.sock /run/sanctuary/custom.sock
test_socket_unavailable no-socket none
test_socket_unavailable ambiguous-socket ambiguous
test_socket_unavailable unsafe-override none '/tmp/socket path.sock'
test_partial_contract revision-mismatch 'candidate revision label mismatch'
test_partial_contract lock-mismatch 'image-lock label mismatch'
test_partial_contract scan-failure 'scanner execution failed'
test_partial_contract invalid-json 'scanner returned invalid JSON'
test_unavailable_contract missing-all 'candidate image unavailable'
test_unavailable_contract db-failure 'vulnerability database unavailable'
test_unavailable_contract volume-failure 'vulnerability database unavailable'
test_cleanup_failure cleanup-identity-query-failure query_failed present \
  'immutable identity query failed for a present volume'
test_cleanup_failure cleanup-rm-failure mutation_failed present \
  'volume removal command failed with status 7 and the volume survived'
test_cleanup_failure cleanup-rm-response-lost mutation_failed absent \
  'volume removal command failed with status 7 although absence was proven'
test_cleanup_failure cleanup-survivor postcondition_failed present \
  'volume removal returned success but the volume survived'
test_cleanup_failure cleanup-postcondition-ambiguity query_failed unknown \
  'postcondition presence query was ambiguous'
test_cleanup_failure scan-and-cleanup-failure mutation_failed present \
  'volume removal command failed with status 7 and the volume survived' 1 partial
test_cleanup_already_absent
test_initial_identity_query_failure
test_create_response_loss_recovery
test_create_response_loss_refusal volume-create-response-lost-foreign
test_create_response_loss_refusal volume-create-response-lost-ambiguous
test_invalid_inputs

printf '\nTotal: %s Passed: %s Failed: %s\n' "$((pass + failures))" "$pass" "$failures"
[ "$failures" -eq 0 ]
