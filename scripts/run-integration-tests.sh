#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_ROOT/docker/compose/test.yml"
COMPOSE_COMMAND=("$PROJECT_ROOT/scripts/ownership/run-compose.sh")

# Derive a Compose project name unique to this checkout.
#
# docker/compose/test.yml used to pin container_name on every service, so two
# concurrent local runs — two worktrees, or a test run beside a debugging
# session — attached to or destroyed each other's database (sanctuary#714).
# Unlike a bound port, a fixed container name fails silently: you get a
# confusing test failure rather than a name-in-use error, which reads as
# flakiness and sends you looking in the wrong place.
#
# The basename alone is not enough — worktrees are frequently named after the
# repository — so the path hash is what actually separates two checkouts. The
# basename is kept only so `docker ps` stays readable.
default_compose_project_name() {
  local root="$1"
  local base hash

  # Compose requires [a-z0-9][a-z0-9_-]*. Fold anything else to a hyphen.
  base="$(basename "$root" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-')"
  base="${base%%-}"
  [ -n "$base" ] || base="sanctuary"

  hash="$(printf '%s' "$root" | sha256sum | cut -c1-8)"
  printf 'sanctuary-test-%s-%s' "${base:0:24}" "$hash"
}

# Exported so `docker compose` picks it up, and respected if already set: a
# caller who has chosen a project name (CI, or a developer pinning one) keeps
# it. `-p` is passed explicitly so the value is visible in the command rather
# than depending on the environment reaching every subshell.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(default_compose_project_name "$PROJECT_ROOT")}"
export COMPOSE_PROJECT_NAME

COMPOSE_ARGS=(--project-directory "$PROJECT_ROOT" -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME")

# Sourced by tests/ci/integration-compose-isolation.test.sh to exercise
# default_compose_project_name without starting Docker.
if [ -n "${SANCTUARY_TEST_SOURCE_ONLY:-}" ]; then
  return 0 2>/dev/null || exit 0
fi

if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then
  exec "$PROJECT_ROOT/scripts/ci/cleanup-ci-callsite.sh" auto-run \
    --lane integration-tests --checkout-root "$PROJECT_ROOT" -- "$0" "$@"
fi

# A unique project name stops two checkouts sharing a container, but both would
# still bind the same default host port (55433) and the second would die with
# "port is already allocated". Isolating one half and not the other just moves
# the collision, so when the caller has not pinned a port we ask the kernel for
# an ephemeral one and discover it after startup.
#
# Pin TEST_POSTGRES_PORT to get the old fixed behaviour when attaching an
# external client during the test run.
PORT_WAS_PINNED="${TEST_POSTGRES_PORT:+yes}"
DATABASE_URL_WAS_PINNED="${TEST_DATABASE_URL:+yes}"
if [ -z "$PORT_WAS_PINNED" ]; then
  TEST_POSTGRES_PORT=0
  export TEST_POSTGRES_PORT
fi

source "$SCRIPT_DIR/integration-test-defaults.sh"
apply_integration_test_defaults

if [[ "$KEEP_DB" == "true" ]]; then
  echo "INTEGRATION_KEEP_DB=true is incompatible with mandatory receipt-bound cleanup." >&2
  echo "Use a separately managed development database when post-test retention is required." >&2
  exit 2
fi

cleanup() {
  if [[ "${SANCTUARY_CLEANUP_COORDINATED:-0}" == "1" ]]; then
    echo "Integration resources are retained for receipt-bound coordinator cleanup."
  else
    echo "Refusing unregistered local integration cleanup; exact cleanup authority is unavailable." >&2
    echo "The isolated Compose project remains: ${COMPOSE_PROJECT_NAME}" >&2
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_command docker
require_command npm

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not available. Start Docker and retry."
  exit 1
fi

trap cleanup EXIT INT TERM

echo "Starting integration test database (project: ${COMPOSE_PROJECT_NAME})..."
"${COMPOSE_COMMAND[@]}" "${COMPOSE_ARGS[@]}" up -d test-db >/dev/null

# Resolve the container by project rather than by a fixed name. With
# container_name gone this is the only way to find it, and it is what keeps
# two checkouts from inspecting each other's database.
TEST_DB_CONTAINER="$("${COMPOSE_COMMAND[@]}" "${COMPOSE_ARGS[@]}" ps -q test-db)"
if [ -z "$TEST_DB_CONTAINER" ]; then
  echo "Could not resolve the test-db container for project ${COMPOSE_PROJECT_NAME}."
  "${COMPOSE_COMMAND[@]}" "${COMPOSE_ARGS[@]}" ps || true
  exit 1
fi

# Discover the ephemeral port Docker chose and rebuild the connection string.
# Compose reports the mapping as host:port, and the host half may be 0.0.0.0 or
# an IPv6 form, so take the last colon-separated field rather than splitting.
if [ -z "$PORT_WAS_PINNED" ]; then
  port_mapping="$("${COMPOSE_COMMAND[@]}" "${COMPOSE_ARGS[@]}" port test-db 5432 2>/dev/null | tail -1)"
  resolved_port="${port_mapping##*:}"

  if [[ ! "$resolved_port" =~ ^[1-9][0-9]*$ ]]; then
    echo "Could not resolve the published port for test-db (got '${port_mapping}')."
    "${COMPOSE_COMMAND[@]}" "${COMPOSE_ARGS[@]}" ps || true
    exit 1
  fi

  TEST_POSTGRES_PORT="$resolved_port"
  export TEST_POSTGRES_PORT

  # Only rebuild a URL we generated. A caller-supplied TEST_DATABASE_URL is
  # left alone, since it may point somewhere else entirely.
  if [ -z "$DATABASE_URL_WAS_PINNED" ]; then
    TEST_DATABASE_URL="postgresql://${TEST_DATABASE_USER}:${TEST_DATABASE_PASSWORD}@localhost:${TEST_POSTGRES_PORT}/${TEST_DATABASE_NAME}?schema=${TEST_DATABASE_SCHEMA}"
    export TEST_DATABASE_URL
  fi

  echo "Integration database published on localhost:${TEST_POSTGRES_PORT}"
fi

echo "Waiting for PostgreSQL health..."
start_time="$(date +%s)"
while true; do
  health_status="$(
    docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' \
      "$TEST_DB_CONTAINER" 2>/dev/null || echo "starting"
  )"

  if [[ "$health_status" == "healthy" ]]; then
    break
  fi

  current_time="$(date +%s)"
  elapsed_seconds="$((current_time - start_time))"

  if [[ "$elapsed_seconds" -ge "$DB_HEALTH_TIMEOUT_SECONDS" ]]; then
    echo "Timed out waiting for test-db health after ${DB_HEALTH_TIMEOUT_SECONDS}s."
    "${COMPOSE_COMMAND[@]}" "${COMPOSE_ARGS[@]}" logs --no-color --tail 120 test-db || true
    exit 1
  fi

  sleep 1
done

echo "Running Prisma generate + migrate deploy..."
(
  cd "$PROJECT_ROOT/server"
  TEST_DATABASE_URL="$TEST_DATABASE_URL" \
  DATABASE_URL="$TEST_DATABASE_URL" \
  JWT_SECRET="$TEST_JWT_SECRET" \
  ENCRYPTION_KEY="$TEST_ENCRYPTION_KEY" \
  ENCRYPTION_SALT="$TEST_ENCRYPTION_SALT" \
  GATEWAY_SECRET="$TEST_GATEWAY_SECRET" \
  NODE_ENV=test \
  npx prisma generate >/dev/null

  TEST_DATABASE_URL="$TEST_DATABASE_URL" \
  DATABASE_URL="$TEST_DATABASE_URL" \
  JWT_SECRET="$TEST_JWT_SECRET" \
  ENCRYPTION_KEY="$TEST_ENCRYPTION_KEY" \
  ENCRYPTION_SALT="$TEST_ENCRYPTION_SALT" \
  GATEWAY_SECRET="$TEST_GATEWAY_SECRET" \
  NODE_ENV=test \
  npx prisma migrate deploy
)

echo "Running server integration tests..."
(
  cd "$PROJECT_ROOT/server"
  if [[ "$#" -gt 0 ]]; then
    TEST_DATABASE_URL="$TEST_DATABASE_URL" \
    DATABASE_URL="$TEST_DATABASE_URL" \
    JWT_SECRET="$TEST_JWT_SECRET" \
    ENCRYPTION_KEY="$TEST_ENCRYPTION_KEY" \
    ENCRYPTION_SALT="$TEST_ENCRYPTION_SALT" \
    GATEWAY_SECRET="$TEST_GATEWAY_SECRET" \
    NODE_ENV=test \
    npx vitest run --no-file-parallelism --maxWorkers 1 "$@"
  else
    TEST_DATABASE_URL="$TEST_DATABASE_URL" \
    DATABASE_URL="$TEST_DATABASE_URL" \
    JWT_SECRET="$TEST_JWT_SECRET" \
    ENCRYPTION_KEY="$TEST_ENCRYPTION_KEY" \
    ENCRYPTION_SALT="$TEST_ENCRYPTION_SALT" \
    GATEWAY_SECRET="$TEST_GATEWAY_SECRET" \
    NODE_ENV=test \
    npm run test:integration
  fi
)

echo "Integration tests completed."
