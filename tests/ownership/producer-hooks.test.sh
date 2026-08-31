#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$ROOT_DIR/scripts/ownership/producer-hooks.sh"

export SANCTUARY_PROJECT_DIR="$ROOT_DIR"
export SANCTUARY_PROJECT=test-project
export SANCTUARY_DEPLOYMENT_ID=deploy-test
export SANCTUARY_OWNER_ID=owner-test
export SANCTUARY_OPERATION_RUN_ID=run-test
export SANCTUARY_RELEASE=v0.8.69
export SANCTUARY_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
export SANCTUARY_CLEANUP_CREATED_AT=2026-08-30T00:00:00.000Z
export SANCTUARY_OWNERSHIP_ROOT="$(mktemp -d)/ownership"

ownership_label_args compose_container exact_delete
[ "${#OWNERSHIP_LABEL_ARGS[@]}" -eq 20 ]
printf '%s\n' "${OWNERSHIP_LABEL_ARGS[@]}" | grep -q '^io.sanctuary.deployment-id=deploy-test$'

register_owned_resource temporary_artifact active exact_delete path /tmp/owned path-123 run-test
test "$(find "$SANCTUARY_OWNERSHIP_ROOT/registrations/temporary_artifact" -name '*.json' | wc -l)" -eq 1

runtime_dir="$(mktemp -d)/runtime"
local_root="$(env -i \
  HOME="${HOME:-}" PATH="$PATH" \
  SANCTUARY_RUNTIME_DIR="$runtime_dir" \
  bash -c 'set -eu; source "$1"; ownership_initialize; printf "%s" "$SANCTUARY_OWNERSHIP_ROOT"' \
  _ "$ROOT_DIR/scripts/ownership/producer-hooks.sh")"
[ "$local_root" = "$runtime_dir/ownership" ]

ci_root="$(env -i \
  HOME="${HOME:-}" PATH="$PATH" \
  SANCTUARY_CI_PROVIDER_OVERRIDE=fixture-ci \
  SANCTUARY_CI_RUN_ID_OVERRIDE=fixture-run \
  SANCTUARY_CI_TEMP_DIR_OVERRIDE=/tmp/sanctuary-fixture-temp \
  bash -c 'set -eu; source "$1"; ownership_initialize; printf "%s" "$SANCTUARY_OWNERSHIP_ROOT"' \
  _ "$ROOT_DIR/scripts/ownership/producer-hooks.sh")"
[ "$ci_root" = /tmp/sanctuary-fixture-temp/sanctuary-ownership/run-fixture-run ]

build_identity="$(env -i \
  HOME="${HOME:-}" PATH="$PATH" \
  SANCTUARY_PROJECT_DIR="$ROOT_DIR" \
  SANCTUARY_PROJECT=test-build \
  SANCTUARY_OPERATION_RUN_ID=run-build \
  SANCTUARY_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)" \
  bash -c 'set -eu; source "$1"; ownership_initialize_build_identity; for name in SANCTUARY_PROJECT SANCTUARY_DEPLOYMENT_ID SANCTUARY_OWNER_ID SANCTUARY_OPERATION_RUN_ID SANCTUARY_RELEASE SANCTUARY_COMMIT SANCTUARY_CLEANUP_CREATED_AT SANCTUARY_SOURCE_COMMIT SANCTUARY_IMAGE_LOCK_SHA256 SANCTUARY_VERSION SANCTUARY_BUILD_ID; do test -n "${!name:-}"; export -p | grep -q "declare -x $name="; done; printf "%s\n%s\n%s\n%s" "$SANCTUARY_SOURCE_COMMIT" "$SANCTUARY_IMAGE_LOCK_SHA256" "$SANCTUARY_VERSION" "$SANCTUARY_BUILD_ID"' \
  _ "$ROOT_DIR/scripts/ownership/producer-hooks.sh")"
expected_lock_sha="$(ownership_sha256 < "$ROOT_DIR/config/container-image-lock.json")"
expected_version="$(awk -F'"' '/"version":/{print $4; exit}' "$ROOT_DIR/package.json")"
expected_commit="$(git -C "$ROOT_DIR" rev-parse HEAD)"
test "$build_identity" = "$expected_commit
$expected_lock_sha
$expected_version
run-build"

override_identity="$(env -i \
  HOME="${HOME:-}" PATH="$PATH" \
  SANCTUARY_PROJECT_DIR="$ROOT_DIR" \
  SANCTUARY_PROJECT=explicit-project \
  SANCTUARY_DEPLOYMENT_ID=explicit-deployment \
  SANCTUARY_OWNER_ID=explicit-owner \
  SANCTUARY_OPERATION_RUN_ID=explicit-run \
  SANCTUARY_RELEASE=explicit-release \
  SANCTUARY_COMMIT="$expected_commit" \
  SANCTUARY_CLEANUP_CREATED_AT=2000-01-01T00:00:00.000Z \
  SANCTUARY_SOURCE_COMMIT=explicit-source \
  SANCTUARY_IMAGE_LOCK_SHA256=explicit-lock \
  SANCTUARY_VERSION=explicit-version \
  SANCTUARY_BUILD_ID=explicit-build \
  bash -c 'set -eu; source "$1"; ownership_initialize_build_identity; printf "%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s" "$SANCTUARY_PROJECT" "$SANCTUARY_DEPLOYMENT_ID" "$SANCTUARY_OWNER_ID" "$SANCTUARY_OPERATION_RUN_ID" "$SANCTUARY_RELEASE" "$SANCTUARY_COMMIT" "$SANCTUARY_CLEANUP_CREATED_AT" "$SANCTUARY_SOURCE_COMMIT" "$SANCTUARY_IMAGE_LOCK_SHA256" "$SANCTUARY_VERSION" "$SANCTUARY_BUILD_ID"' \
  _ "$ROOT_DIR/scripts/ownership/producer-hooks.sh")"
test "$override_identity" = "explicit-project
explicit-deployment
explicit-owner
explicit-run
explicit-release
$expected_commit
2000-01-01T00:00:00.000Z
explicit-source
explicit-lock
explicit-version
explicit-build"

refreshed_identity="$(SANCTUARY_PROJECT_DIR="$ROOT_DIR" \
  SANCTUARY_PROJECT=refresh-project \
  SANCTUARY_OPERATION_RUN_ID=refresh-run \
  SANCTUARY_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  SANCTUARY_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  SANCTUARY_IMAGE_LOCK_SHA256=stale-lock \
  SANCTUARY_VERSION=stale-version \
  SANCTUARY_BUILD_ID=stale-build \
  bash -c 'set -eu; source "$1"; ownership_refresh_checkout_build_identity; printf "%s\n%s\n%s\n%s\n%s" "$SANCTUARY_COMMIT" "$SANCTUARY_SOURCE_COMMIT" "$SANCTUARY_IMAGE_LOCK_SHA256" "$SANCTUARY_VERSION" "$SANCTUARY_BUILD_ID"' \
  _ "$ROOT_DIR/scripts/ownership/producer-hooks.sh")"
test "$refreshed_identity" = "$expected_commit
$expected_commit
$expected_lock_sha
$expected_version
refresh-run"

rendered_test_compose="$(env -i HOME="${HOME:-}" PATH="$PATH" \
  "$ROOT_DIR/scripts/ownership/run-compose.sh" --project-directory "$ROOT_DIR" \
  -f "$ROOT_DIR/docker/compose/test.yml" config --format json)"
RENDERED_TEST_COMPOSE="$rendered_test_compose" node - <<'NODE'
const rendered = JSON.parse(process.env.RENDERED_TEST_COMPOSE);
const projects = new Set(Object.values(rendered.services).map((service) => service.labels['io.sanctuary.project']));
if (projects.size !== 1 || !projects.has(rendered.name)) {
  throw new Error(`Compose project ${rendered.name} does not match ownership labels: ${[...projects].join(',')}`);
}
NODE

rendered_operator_compose="$(env -i HOME="${HOME:-}" PATH="$PATH" \
  SANCTUARY_RUNTIME_DIR="$runtime_dir/operator" \
  SANCTUARY_ENV_FILE=/dev/null \
  SANCTUARY_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  SANCTUARY_SOURCE_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  SANCTUARY_IMAGE_LOCK_SHA256=stale-lock SANCTUARY_VERSION=stale-version SANCTUARY_BUILD_ID=stale-build \
  JWT_SECRET=test-jwt ENCRYPTION_KEY=12345678901234567890123456789012 ENCRYPTION_SALT=test-salt \
  GATEWAY_SECRET=test-gateway POSTGRES_PASSWORD=test-postgres GRAFANA_PASSWORD=test-grafana REDIS_PASSWORD=test-redis \
  WORKER_DIAGNOSTICS_SECRET=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
  LLM_EGRESS_PROXY_SECRET=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
  "$ROOT_DIR/scripts/ownership/run-operator-compose.sh" config --format json)"
RENDERED_OPERATOR_COMPOSE="$rendered_operator_compose" EXPECTED_COMMIT="$expected_commit" \
  EXPECTED_LOCK="$expected_lock_sha" EXPECTED_VERSION="$expected_version" node - <<'NODE'
const rendered = JSON.parse(process.env.RENDERED_OPERATOR_COMPOSE);
const args = rendered.services.backend.build.args;
if (args.SANCTUARY_SOURCE_COMMIT !== process.env.EXPECTED_COMMIT
  || args.SANCTUARY_IMAGE_LOCK_SHA256 !== process.env.EXPECTED_LOCK
  || args.SANCTUARY_BUILD_VERSION !== process.env.EXPECTED_VERSION
  || args.SANCTUARY_BUILD_ID === 'stale-build') {
  throw new Error(`operator Compose retained stale provenance: ${JSON.stringify(args)}`);
}
if (rendered.services.backend.labels['io.sanctuary.created-by-commit'] !== process.env.EXPECTED_COMMIT) {
  throw new Error('operator Compose retained a stale creation commit');
}
NODE
echo 'producer ownership hooks passed'
