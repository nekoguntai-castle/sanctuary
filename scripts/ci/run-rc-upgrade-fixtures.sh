#!/usr/bin/env bash
# Run every release-candidate upgrade fixture sequentially in one job. The
# matrix shape that this replaces caused fan-out parallelism on the
# self-hosted Forgejo runner because runner.capacity (4) takes precedence
# over strategy.max-parallel and over job-level concurrency, leading to
# 6 docker stacks contending for a single dind daemon. A single sequential
# job removes the contention without losing fixture coverage.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Pairs of source_ref|fixture|port_offset, matching the prior matrix.
fixtures=(
  "latest-stable|baseline|10"
  "n-2|baseline|11"
  "latest-stable|browser-origin-ip|12"
  "latest-stable|legacy-runtime-env|13"
  "latest-stable|notification-delivery|14"
  "latest-stable|optional-profiles|15"
)

JOB_LOG_DIR="${JOB_LOG_DIR:-$ROOT_DIR/.tmp/job-logs/upgrade-rc}"
mkdir -p "$JOB_LOG_DIR"

failures=()

for entry in "${fixtures[@]}"; do
  IFS='|' read -r source_ref fixture port_offset <<< "$entry"
  echo "::group::upgrade ${source_ref} / ${fixture}"

  fixture_log_dir="$JOB_LOG_DIR/${source_ref}-${fixture}"
  artifact_dir="$ROOT_DIR/.tmp/upgrade-artifacts/${source_ref}-${fixture}"
  mkdir -p "$fixture_log_dir" "$artifact_dir"

  if (
    cd "$ROOT_DIR"
    workspace="$(scripts/ci/create-isolated-workspace.sh --docker-visible "upgrade-${source_ref}-${fixture}")"
    cd "$workspace"
    bash scripts/ci/install-test-ports.sh "$port_offset"
    SANCTUARY_UPGRADE_SOURCE_REF="${SANCTUARY_UPGRADE_SOURCE_REF_OVERRIDE:-$source_ref}" \
      SANCTUARY_UPGRADE_FIXTURE="$fixture" \
      SANCTUARY_UPGRADE_ARTIFACT_DIR="$artifact_dir" \
      ./tests/install/e2e/upgrade-install.test.sh --mode core --fixture "$fixture" --verbose
  ) > >(tee "$fixture_log_dir/upgrade.log") 2>&1; then
    echo "::endgroup::"
    echo "upgrade ${source_ref} / ${fixture}: PASSED"
  else
    rc=$?
    echo "::endgroup::"
    echo "::error::upgrade ${source_ref} / ${fixture} failed with exit ${rc}"
    failures+=("${source_ref}/${fixture}")
  fi
done

if [ "${#failures[@]}" -gt 0 ]; then
  printf 'Upgrade fixture failures: %s\n' "${failures[*]}" >&2
  exit 1
fi
