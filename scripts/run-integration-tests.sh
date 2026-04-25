#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.test.yml"
TEST_DB_CONTAINER="sanctuary-test-db"

source "$SCRIPT_DIR/integration-test-defaults.sh"
apply_integration_test_defaults

cleanup() {
  if [[ "$KEEP_DB" == "true" ]]; then
    echo "Keeping integration database container running (INTEGRATION_KEEP_DB=true)."
    return
  fi

  docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
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

echo "Starting integration test database..."
docker compose -f "$COMPOSE_FILE" up -d test-db >/dev/null

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
    docker compose -f "$COMPOSE_FILE" logs --no-color --tail 120 test-db || true
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
