#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d)"
PROJECT="$TEST_ROOT/project"
RUNTIME="$TEST_ROOT/runtime"
mkdir -p "$PROJECT/config" "$RUNTIME"
mkdir -p "$TEST_ROOT/bin"
cat > "$TEST_ROOT/bin/docker" <<'EOF'
#!/usr/bin/env bash
case " $* " in
  *" compose "*" config --format json "*)
    if [ "${FAKE_DOCKER_LEGACY:-no}" = yes ]; then
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
  " volume inspect lifecycle-test_data "|" network inspect legacy-network ")
    printf '%s\n' '[{"Labels":{"com.docker.compose.project":"lifecycle-test"}}]'
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

export FAKE_DOCKER_LEGACY=no
deployment_begin no no no
[ "$SANCTUARY_DEPLOYMENT_STATE" = pending ]
[ "${#COMPOSE_FILE_ARGS[@]}" -ge 8 ]
for stage in build_started build_completed postgres_started password_reconciled stack_started health_verified; do
  deployment_transition "$stage"
done
deployment_activate
deployment_lock_release

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
# Already-completed work is an idempotent no-op; later stages continue.
digest_before="$SANCTUARY_PENDING_DIGEST"
deployment_transition build_started
[ "$SANCTUARY_PENDING_DIGEST" = "$digest_before" ]
for stage in password_reconciled stack_started health_verified; do
  deployment_transition "$stage"
done
deployment_activate
deployment_lock_release

grep -RIl 'not-recorded' "$RUNTIME/ownership" | grep -q . && {
  echo 'deployment state leaked environment contents' >&2
  exit 1
}
echo 'deployment lifecycle shell bridge passed'
