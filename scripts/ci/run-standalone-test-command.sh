#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 COMMAND [ARG...]" >&2
  exit 2
fi

# Standalone fixtures are not subjects of the outer workspace coordinator or
# its provider run. Tests that exercise coordinated mode construct their own
# complete authority, including any provider identity they need.
unset SANCTUARY_CI_PROVIDER_CONTEXT_LOADED
# shellcheck source=scripts/ci/provider-context.sh
source "$(dirname "$0")/provider-context.sh"

ci_exec_without_provider_authority env \
  -u SANCTUARY_CI_PROVIDER_OVERRIDE \
  -u SANCTUARY_CLEANUP_COORDINATED \
  -u SANCTUARY_CLEANUP_AUTHORITY_MODE \
  -u SANCTUARY_DEPLOYMENT_SCOPE \
  -u SANCTUARY_CLEANUP_STATE \
  -u SANCTUARY_CI_RUN_IDENTITY_DIGEST \
  -u SANCTUARY_PROJECT \
  -u COMPOSE_PROJECT_NAME \
  -u SANCTUARY_PROJECT_DIR \
  -u SANCTUARY_DEPLOYMENT_ID \
  -u SANCTUARY_OWNER_ID \
  -u SANCTUARY_OPERATION_RUN_ID \
  -u SANCTUARY_RELEASE \
  -u SANCTUARY_COMMIT \
  -u SANCTUARY_CLEANUP_CREATED_AT \
  -u SANCTUARY_SOURCE_COMMIT \
  -u SANCTUARY_IMAGE_LOCK_SHA256 \
  -u SANCTUARY_VERSION \
  -u SANCTUARY_BUILD_ID \
  -u SANCTUARY_OWNERSHIP_ROOT \
  -u SANCTUARY_ENV_FILE \
  -u SANCTUARY_IMAGE_TAG \
  -u SANCTUARY_RESOURCE_LIFECYCLE \
  -u SANCTUARY_RUNTIME_DIR \
  -u SANCTUARY_VOLUME_CLEANUP_POLICY \
  "$@"
