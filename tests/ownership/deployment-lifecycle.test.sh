#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d)"
PROJECT="$TEST_ROOT/project"
RUNTIME="$TEST_ROOT/runtime"
export SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT=true
export SANCTUARY_TEST_PROJECT_LOCK_ROOT="$TEST_ROOT/project-locks"
mkdir -p "$PROJECT/config" "$RUNTIME"
chmod 700 "$RUNTIME"
mkdir -p "$TEST_ROOT/bin"
cat > "$TEST_ROOT/bin/docker" <<'EOF'
#!/usr/bin/env bash
if [ -n "${FAKE_DOCKER_LOG:-}" ]; then printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"; fi
if [ -n "${FAKE_REQUIRE_LOCK:-}" ] && [ ! -e "$FAKE_REQUIRE_LOCK" ]; then
  printf 'deployment lock was not held during Docker command\n' >&2
  exit 65
fi
if [ "${FAKE_DOCKER_COMMAND_FAIL:-no}" = yes ]; then exit 19; fi
case " $* " in
  *" compose "*" exec -T postgres "*)
    input="$(cat)"
    if [ -n "${FAKE_DOCKER_LOG:-}" ]; then printf '%s\n' "$input" >> "$FAKE_DOCKER_LOG"; fi
    if [[ "$input" == *'COUNT(*)'* ]]; then printf '1\n'
    elif [[ "$input" == *'row_to_json'* ]]; then printf '%s\n' '{"id":"user-1","username":"admin","twoFactorEnabled":true}'
    elif [[ "$input" == *'UPDATE users'* ]]; then
      [ "${FAKE_DOCKER_RESET_FAIL:-no}" != yes ] || exit 23
      printf 'admin|false|true|true\n'
    else printf 'admin|true|true|true\n'
    fi
    ;;
  *" compose "*" config --format json "*)
    if [[ " $* " == *" -f - "* ]] && [ "${FAKE_DOCKER_OVERRIDE_UNSUPPORTED:-no}" = yes ]; then
      exit 15
    elif [[ " $* " == *" -f - "* ]]; then
      printf '%s\n' '{"services":{"app":{}},"networks":{"default":{"name":"lifecycle-test_default","external":true}},"volumes":{"data":{"name":"lifecycle-test_data","external":true}}}'
    elif [ "${FAKE_DOCKER_LEGACY:-no}" = yes ]; then
      printf '%s\n' '{"services":{"app":{}},"networks":{"default":{"name":"lifecycle-test_default"}},"volumes":{"data":{"name":"lifecycle-test_data"}}}'
    else
      printf '%s\n' '{"services":{"app":{}},"networks":{},"volumes":{}}'
    fi
    ;;
  " volume ls "*)
    if [ "${FAKE_DOCKER_LEGACY:-no}" = yes ]; then printf '%s\n' lifecycle-test_data; fi
    ;;
  " network ls "*)
    if [ "${FAKE_DOCKER_LEGACY:-no}" = yes ]; then printf 'legacy-network\tlifecycle-test_default\n'; fi
    ;;
  " container ls "*)
    ;;
  " volume inspect lifecycle-test_data ")
    printf '%s\n' '[{"Name":"lifecycle-test_data","Driver":"local","Scope":"local","Mountpoint":"/var/lib/docker/volumes/lifecycle-test_data/_data","CreatedAt":"2026-08-30T00:00:00Z","Options":{},"Labels":{"com.docker.compose.project":"lifecycle-test","com.docker.compose.volume":"data"}}]'
    ;;
  " network inspect legacy-network "|" network inspect lifecycle-test_default ")
    printf '%s\n' '[{"Id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","Labels":{"com.docker.compose.project":"lifecycle-test","com.docker.compose.network":"default"}}]'
    ;;
  *)
    printf 'unexpected fake Docker inspection: %s\n' "$*" >&2
    exit 64
    ;;
esac
EOF
chmod +x "$TEST_ROOT/bin/docker"
export PATH="$TEST_ROOT/bin:$PATH"
printf 'services:\n  app:\n    image: example:test\n' > "$PROJECT/docker-compose.yml"
printf 'JWT_SECRET=not-recorded\n' > "$RUNTIME/sanctuary.env"
cp "$ROOT_DIR/config/resource-ownership-contract.json" "$PROJECT/config/"

export SANCTUARY_PROJECT_DIR="$PROJECT"
export SANCTUARY_RUNTIME_DIR="$RUNTIME"
export SANCTUARY_ENV_FILE="$RUNTIME/sanctuary.env"
export SANCTUARY_PROJECT=lifecycle-test
export SANCTUARY_DEPLOYMENT_ID=deployment-test
export SANCTUARY_OWNER_ID=owner-test
export SANCTUARY_OPERATION_RUN_ID=run-test
export SANCTUARY_RELEASE=v0.8.69
export SANCTUARY_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

# shellcheck source=scripts/ownership/deployment-lifecycle.sh
. "$ROOT_DIR/scripts/ownership/deployment-lifecycle.sh"
export FAKE_DOCKER_LEGACY=yes
if deployment_begin no no no 2>"$TEST_ROOT/legacy.err"; then
  echo 'first manifest unexpectedly accepted legacy Docker resources' >&2
  exit 1
fi
grep -q 'first deployment manifest refused existing legacy Docker resources' "$TEST_ROOT/legacy.err"
[ ! -e "$RUNTIME/ownership/deployments/deployment-test/pending-revision.json" ]
[ ! -e "$RUNTIME/ownership/deployments/deployment-test/mutation-lock" ]
[ -z "$(find "$SANCTUARY_TEST_PROJECT_LOCK_ROOT" -type d -name mutation-lock -print 2>/dev/null)" ]

export FAKE_DOCKER_OVERRIDE_UNSUPPORTED=yes
if deployment_begin no no no true 2>"$TEST_ROOT/unsupported.err"; then
  echo 'legacy upgrade unexpectedly accepted unsupported Compose override semantics' >&2
  exit 1
fi
grep -q 'Docker Compose 2.24.4 or newer' "$TEST_ROOT/unsupported.err"
[ ! -e "$RUNTIME/ownership/deployments/deployment-test/pending-revision.json" ]
[ ! -e "$RUNTIME/ownership/deployments/deployment-test/mutation-lock" ]
unset FAKE_DOCKER_OVERRIDE_UNSUPPORTED

deployment_begin no no no true
[ "$SANCTUARY_DEPLOYMENT_STATE" = pending ]
[ -n "$(find "$SANCTUARY_TEST_PROJECT_LOCK_ROOT" -type d -name mutation-lock -print 2>/dev/null)" ]
[ "${#COMPOSE_FILE_ARGS[@]}" -ge 8 ]
grep -q '"resourceClass":"compose_volume"' "$RUNTIME/ownership/deployments/deployment-test/revisions/1/deployment-manifest.json"
grep -q '"resourceClass":"compose_network"' "$RUNTIME/ownership/deployments/deployment-test/revisions/1/deployment-manifest.json"
deployment_finalize_prepared
deployment_lock_release
[ -z "$(find "$SANCTUARY_TEST_PROJECT_LOCK_ROOT" -type d -name mutation-lock -print 2>/dev/null)" ]

unset SANCTUARY_DEPLOYMENT_LOCK_TOKEN DEPLOYMENT_LOCK_OWNERSHIP SANCTUARY_PENDING_DIGEST
export SANCTUARY_OPERATION_RUN_ID=run-prepared-resume
deployment_begin no no no
[ "$SANCTUARY_DEPLOYMENT_STATE" = pending ]
[ "$SANCTUARY_DEPLOYMENT_GENERATION" = 1 ]
[ "$SANCTUARY_DEPLOYMENT_STAGE" = prepared ]
[ ! -e "$RUNTIME/ownership/deployments/deployment-test/prepared-revision.json" ]
for stage in build_started build_completed postgres_started password_reconciled stack_started health_verified; do
  deployment_transition "$stage"
done
deployment_verify_legacy_upgrade
deployment_activate
deployment_lock_release

# Operator commands must replay the retained active revision, including the
# generated external-resource overlay, instead of reconstructing base Compose.
operator_log="$TEST_ROOT/operator-compose.log"
env -u SANCTUARY_DEPLOYMENT_LOCK_TOKEN -u DEPLOYMENT_LOCK_OWNERSHIP \
  FAKE_DOCKER_LOG="$operator_log" "$ROOT_DIR/scripts/ownership/run-operator-compose.sh" \
    config --format json >/dev/null
grep -q '/ownership/deployments/deployment-test/revisions/1/compose/' "$operator_log"
[ "$(grep -o '/ownership/deployments/deployment-test/revisions/1/compose/' "$operator_log" | wc -l)" -eq 2 ]
grep -R -q 'external: true' "$RUNTIME/ownership/deployments/deployment-test/revisions/1/compose"
[ ! -e "$RUNTIME/ownership/deployments/deployment-test/mutation-lock" ]

if env -u SANCTUARY_DEPLOYMENT_LOCK_TOKEN -u DEPLOYMENT_LOCK_OWNERSHIP \
  FAKE_DOCKER_COMMAND_FAIL=yes "$ROOT_DIR/scripts/ownership/run-operator-compose.sh" \
    config --format json >/dev/null 2>&1; then
  echo 'operator Compose unexpectedly ignored Docker failure' >&2
  exit 1
fi
[ ! -e "$RUNTIME/ownership/deployments/deployment-test/mutation-lock" ]

mkdir -p "$TEST_ROOT/failing-node"
cat > "$TEST_ROOT/failing-node/node" <<'EOF'
#!/usr/bin/env bash
if [ "${2:-}" = compose-args ]; then exit 17; fi
exec "$SANCTUARY_REAL_NODE" "$@"
EOF
chmod +x "$TEST_ROOT/failing-node/node"
if env -u SANCTUARY_DEPLOYMENT_LOCK_TOKEN -u DEPLOYMENT_LOCK_OWNERSHIP \
  SANCTUARY_REAL_NODE="$(command -v node)" PATH="$TEST_ROOT/failing-node:$PATH" \
  "$ROOT_DIR/scripts/ownership/run-operator-compose.sh" config --format json >/dev/null 2>&1; then
  echo 'operator Compose unexpectedly ignored active argument resolution failure' >&2
  exit 1
fi
[ ! -e "$RUNTIME/ownership/deployments/deployment-test/mutation-lock" ]

reset_log="$TEST_ROOT/reset-compose.log"
reset_lock="$RUNTIME/ownership/deployments/deployment-test/mutation-lock"
env -u SANCTUARY_DEPLOYMENT_LOCK_TOKEN -u DEPLOYMENT_LOCK_OWNERSHIP \
  FAKE_DOCKER_LOG="$reset_log" FAKE_REQUIRE_LOCK="$reset_lock" \
  SANCTUARY_2FA_RESET_BACKUP_DIR="$TEST_ROOT/recovery-success" \
  "$ROOT_DIR/scripts/reset-user-2fa.sh" --username admin --yes >/dev/null
[ "$(grep -c ' exec -T postgres ' "$reset_log")" -eq 4 ]
[ "$(grep ' exec -T postgres ' "$reset_log" | grep -c '/ownership/deployments/deployment-test/revisions/1/compose/')" -eq 4 ]
[ ! -e "$reset_lock" ]

if env -u SANCTUARY_DEPLOYMENT_LOCK_TOKEN -u DEPLOYMENT_LOCK_OWNERSHIP \
  FAKE_DOCKER_RESET_FAIL=yes FAKE_REQUIRE_LOCK="$reset_lock" \
  SANCTUARY_2FA_RESET_BACKUP_DIR="$TEST_ROOT/recovery-failure" \
  "$ROOT_DIR/scripts/reset-user-2fa.sh" --username admin --yes >/dev/null 2>&1; then
  echo '2FA reset unexpectedly ignored database mutation failure' >&2
  exit 1
fi
[ ! -e "$reset_lock" ]

unset SANCTUARY_DEPLOYMENT_LOCK_TOKEN DEPLOYMENT_LOCK_OWNERSHIP SANCTUARY_PENDING_DIGEST
export SANCTUARY_OPERATION_RUN_ID=run-second
export FAKE_DOCKER_LEGACY=yes
deployment_begin no no no
[ "$SANCTUARY_DEPLOYMENT_STATE" = active ]
[ "$SANCTUARY_DEPLOYMENT_GENERATION" = 1 ]
deployment_lock_release

# A new controller can resume the exact pending generation after interruption.
printf 'services:\n  app:\n    image: example:second\n' > "$PROJECT/docker-compose.yml"
unset SANCTUARY_DEPLOYMENT_LOCK_TOKEN DEPLOYMENT_LOCK_OWNERSHIP SANCTUARY_PENDING_DIGEST
export SANCTUARY_OPERATION_RUN_ID=run-interrupted
deployment_begin no no no
[ "$SANCTUARY_DEPLOYMENT_GENERATION" = 2 ]
deployment_transition build_started
deployment_transition build_completed
deployment_transition postgres_started
deployment_lock_release

unset SANCTUARY_DEPLOYMENT_LOCK_TOKEN DEPLOYMENT_LOCK_OWNERSHIP SANCTUARY_PENDING_DIGEST
export SANCTUARY_OPERATION_RUN_ID=run-recovery
deployment_begin no no no
[ "$SANCTUARY_DEPLOYMENT_GENERATION" = 2 ]
[ "$SANCTUARY_DEPLOYMENT_STAGE" = postgres_started ]
grep -q '"resourceClass":"compose_volume"' "$RUNTIME/ownership/deployments/deployment-test/revisions/2/deployment-manifest.json"
grep -q '"resourceClass":"compose_network"' "$RUNTIME/ownership/deployments/deployment-test/revisions/2/deployment-manifest.json"
# Already-completed work is an idempotent no-op; later stages continue.
digest_before="$SANCTUARY_PENDING_DIGEST"
deployment_transition build_started
[ "$SANCTUARY_PENDING_DIGEST" = "$digest_before" ]
for stage in password_reconciled stack_started health_verified; do
  deployment_transition "$stage"
done
deployment_verify_legacy_upgrade
deployment_activate
deployment_lock_release

grep -RIl 'not-recorded' "$RUNTIME/ownership" | grep -q . && {
  echo 'deployment state leaked environment contents' >&2
  exit 1
}
echo 'deployment lifecycle shell bridge passed'
