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
echo 'producer ownership hooks passed'
