#!/usr/bin/env bash
# One supervised subject for disposable CI Compose stacks. Cleanup is owned by
# cleanup-ci-callsite.sh run; this script never tears resources down.
set -euo pipefail

workspace=
mode=
run_health=false
run_auth=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --workspace) workspace="${2:-}"; shift 2 ;;
    --mode) mode="${2:-}"; shift 2 ;;
    --run-health) run_health="${2:-}"; shift 2 ;;
    --run-auth) run_auth="${2:-}"; shift 2 ;;
    *) echo "run-compose-e2e-subject: unknown option: $1" >&2; exit 2 ;;
  esac
done

[ -n "$workspace" ] || { echo 'run-compose-e2e-subject: --workspace is required' >&2; exit 2; }
case "$mode" in install-stack|container-health|auth-flow) ;; *)
  echo 'run-compose-e2e-subject: invalid --mode' >&2; exit 2 ;;
esac
case "$run_health:$run_auth" in
  true:true|true:false|false:true|false:false) ;;
  *) echo 'run-compose-e2e-subject: test selectors must be true or false' >&2; exit 2 ;;
esac
[ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = 1 ] && [ -n "${SANCTUARY_OWNERSHIP_ROOT:-}" ] || {
  echo 'run-compose-e2e-subject requires the signed cleanup coordinator' >&2
  exit 2
}

cd "$workspace"
# The install-test helpers resolve the ownership producer hook and the
# install-test root from PROJECT_ROOT; this subject's project is the
# isolated workspace it was pointed at (v0.8.70-rc2, run 14662).
PROJECT_ROOT="$PWD"
export PROJECT_ROOT

readonly -a compose_registration_args=(
  --expected-image sanctuary-backend
  --expected-image sanctuary-frontend
  --expected-image sanctuary-gateway
  --expected-image sanctuary-llm-egress-proxy
)

diagnose_failure() {
  local status="$?"
  local registration_status=0
  if [ "${compose_registered:-false}" != true ] \
      && declare -F register_ci_compose_resources >/dev/null; then
    register_ci_compose_resources "${compose_registration_args[@]}" || registration_status=$?
  fi
  if [ "$status" -ne 0 ]; then
    docker compose ps >&2 || true
    docker compose logs --tail 100 postgres backend frontend gateway migrate >&2 || true
  fi
  if [ "$status" -eq 0 ] && [ "$registration_status" -ne 0 ]; then
    return "$registration_status"
  fi
  return "$status"
}
trap diagnose_failure EXIT

random_base64() { openssl rand -base64 "$1" | tr -d '=/+' | head -c "$2"; }
JWT_SECRET="$(random_base64 32 48)"
ENCRYPTION_KEY="$(random_base64 32 48)"
ENCRYPTION_SALT="$(random_base64 16 24)"
GATEWAY_SECRET="$(random_base64 32 48)"
WORKER_DIAGNOSTICS_SECRET="$(openssl rand -hex 32)"
POSTGRES_PASSWORD="$(random_base64 16 24)"
LLM_EGRESS_PROXY_SECRET="$(openssl rand -hex 32)"
REDIS_PASSWORD="$(random_base64 16 24)"

# shellcheck source=tests/install/utils/helpers.sh
source tests/install/utils/helpers.sh
initialize_install_test_ownership
export_lane_image_tag
SANCTUARY_SSL_DIR="$(default_install_test_root "$PWD")/ssl-${COMPOSE_PROJECT_NAME}"
mkdir -p "$SANCTUARY_SSL_DIR"
SANCTUARY_COMPOSE_SSL_DIR="$(docker_visible_path "$SANCTUARY_SSL_DIR")"
export SANCTUARY_SSL_DIR SANCTUARY_COMPOSE_SSL_DIR
bash docker/nginx/ssl/generate-certs.sh localhost

compose_env=(
  "JWT_SECRET=$JWT_SECRET" "ENCRYPTION_KEY=$ENCRYPTION_KEY"
  "ENCRYPTION_SALT=$ENCRYPTION_SALT" "GATEWAY_SECRET=$GATEWAY_SECRET"
  "WORKER_DIAGNOSTICS_SECRET=$WORKER_DIAGNOSTICS_SECRET"
  "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
  "LLM_EGRESS_PROXY_SECRET=$LLM_EGRESS_PROXY_SECRET" "REDIS_PASSWORD=$REDIS_PASSWORD"
  "SANCTUARY_SSL_DIR=$SANCTUARY_SSL_DIR"
  "SANCTUARY_COMPOSE_SSL_DIR=$SANCTUARY_COMPOSE_SSL_DIR"
  "HTTPS_PORT=${HTTPS_PORT:?}" "HTTP_PORT=${HTTP_PORT:?}"
)
if [ "$mode" != container-health ]; then
  compose_env+=(RATE_LIMIT_LOGIN=100 RATE_LIMIT_PASSWORD_CHANGE=100)
fi
env "${compose_env[@]}" docker compose up -d --build
register_ci_compose_resources "${compose_registration_args[@]}"
compose_registered=true

timeout 120 bash -c \
  'until docker compose ps migrate --format "{{.Status}}" 2>/dev/null | grep -q "Exited"; do sleep 5; done' \
  || true
sleep 30

if [ "$mode" = container-health ] || [ "$run_health" = true ]; then
  ./tests/install/e2e/container-health.test.sh --verbose
fi
if [ "$mode" = auth-flow ] || [ "$run_auth" = true ]; then
  ./tests/install/e2e/auth-flow.test.sh --verbose
fi
