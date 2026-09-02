#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_ROOT="$(mktemp -d)"

cleanup() {
  find "$TEST_ROOT" -type f -delete
  find "$TEST_ROOT" -depth -type d -empty -delete
}
trap cleanup EXIT

cat > "$TEST_ROOT/probe.sh" <<'PROBE'
#!/usr/bin/env bash
set -euo pipefail

for name in \
  SANCTUARY_CLEANUP_COORDINATED SANCTUARY_CLEANUP_AUTHORITY_MODE \
  SANCTUARY_DEPLOYMENT_SCOPE SANCTUARY_CLEANUP_STATE \
  SANCTUARY_CI_RUN_IDENTITY_DIGEST SANCTUARY_PROJECT \
  COMPOSE_PROJECT_NAME SANCTUARY_PROJECT_DIR SANCTUARY_DEPLOYMENT_ID \
  SANCTUARY_OWNER_ID SANCTUARY_OPERATION_RUN_ID SANCTUARY_RELEASE \
  SANCTUARY_COMMIT SANCTUARY_CLEANUP_CREATED_AT SANCTUARY_SOURCE_COMMIT \
  SANCTUARY_IMAGE_LOCK_SHA256 SANCTUARY_VERSION SANCTUARY_BUILD_ID \
  SANCTUARY_OWNERSHIP_ROOT SANCTUARY_ENV_FILE SANCTUARY_IMAGE_TAG \
  SANCTUARY_RESOURCE_LIFECYCLE SANCTUARY_RUNTIME_DIR \
  SANCTUARY_VOLUME_CLEANUP_POLICY
do
  if [[ -v $name ]]; then
    echo "inherited outer authority variable: $name" >&2
    exit 1
  fi
done

test "${INSTALL_UNIT_PRESERVED_INPUT:-}" = preserved
PROBE

env \
  SANCTUARY_CLEANUP_COORDINATED=1 \
  SANCTUARY_CLEANUP_AUTHORITY_MODE=outer-incomplete \
  SANCTUARY_DEPLOYMENT_SCOPE=ci_ephemeral \
  SANCTUARY_CLEANUP_STATE=/tmp/outer-state \
  SANCTUARY_CI_RUN_IDENTITY_DIGEST=outer-digest \
  SANCTUARY_PROJECT=outer-project \
  COMPOSE_PROJECT_NAME=outer-compose-project \
  SANCTUARY_PROJECT_DIR=/tmp/outer-project \
  SANCTUARY_DEPLOYMENT_ID=outer-deployment \
  SANCTUARY_OWNER_ID=outer-owner \
  SANCTUARY_OPERATION_RUN_ID=outer-run \
  SANCTUARY_RELEASE=outer-release \
  SANCTUARY_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  SANCTUARY_CLEANUP_CREATED_AT=2026-09-01T00:00:00.000Z \
  SANCTUARY_SOURCE_COMMIT=cccccccccccccccccccccccccccccccccccccccc \
  SANCTUARY_IMAGE_LOCK_SHA256=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
  SANCTUARY_VERSION=outer-version \
  SANCTUARY_BUILD_ID=outer-build \
  SANCTUARY_OWNERSHIP_ROOT=/tmp/outer-ownership \
  SANCTUARY_ENV_FILE=/tmp/outer.env \
  SANCTUARY_IMAGE_TAG=outer-image-tag \
  SANCTUARY_RESOURCE_LIFECYCLE=outer-lifecycle \
  SANCTUARY_RUNTIME_DIR=/tmp/outer-runtime \
  SANCTUARY_VOLUME_CLEANUP_POLICY=outer-volume-policy \
  INSTALL_UNIT_PRESERVED_INPUT=preserved \
  "$PROJECT_ROOT/scripts/ci/run-install-unit-suite.sh" "$TEST_ROOT/probe.sh"

echo "Install unit suite runner authority isolation passed"
