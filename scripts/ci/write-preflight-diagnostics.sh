#!/usr/bin/env bash
# Emit a small fixed payload describing the runner state at the moment
# this script runs. Designed to be invoked through scripts/ci/run-with-log.sh
# so its output is captured and redacted alongside other diagnostic logs.
#
# The payload is a deliberately minimal set of host-shape checks plus a
# narrowly allowlisted CI environment summary. It must NOT dump full
# `env`, container internals, or anything that grows proportionally to
# host complexity. Each unbounded command is bounded with `head -n N`
# so total output stays small even on hosts with many networks/containers.
#
# Usage: scripts/ci/write-preflight-diagnostics.sh
#   (intended to be wrapped by run-with-log.sh in CI workflows)
#
# Behavior:
#   - Always exits 0. Diagnostic helpers should never themselves fail
#     a build by being unable to gather information; the absence of a
#     section is itself diagnostic.
#   - Each tool invocation is wrapped in `|| true` so a missing tool
#     (e.g. docker not installed) does not abort.
#   - Each section is annotated with a clear header.

# Note: do NOT enable `set -e`. Diagnostic gathering must be best-effort.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
source "$SCRIPT_DIR/provider-context.sh"

SECTION_LIMIT_LINES="${SANCTUARY_CI_PREFLIGHT_LINES:-200}"
case "$SECTION_LIMIT_LINES" in
  ''|*[!0-9]*)
    SECTION_LIMIT_LINES=200
    ;;
esac

# Allowlist of CI/runtime env vars considered safe to surface for
# diagnostic context. Anything matching the redactor's secret patterns
# (KEY/PASSWORD/TOKEN/etc.) is redacted by run-with-log's redactor stack
# anyway, but the allowlist keeps unexpected names from sneaking in.
ENV_ALLOWLIST=(
  CI
  RUNNER_NAME
  RUNNER_OS
  RUNNER_ARCH
  RUNNER_LABELS
  COMPOSE_PROJECT_NAME
  HTTPS_PORT
  HTTP_PORT
  GATEWAY_PORT
  PORT_OFFSET
  SANCTUARY_INSTALL_WORKSPACE
  SANCTUARY_CI_DEBUG_TRACE
  DOCKER_HOST
  PATH
  HOME
  USER
  SHELL
  TMPDIR
)

section() {
  printf '\n===== %s =====\n' "$1"
}

run_bounded() {
  # Bound each section's captured output. Drains stdin via head's
  # fixed-line cap; downstream tools that produce huge output are not
  # SIGPIPE-killed because we discard their tail explicitly via cat.
  local label="$1"
  shift
  section "$label"
  ( "$@" 2>&1 || true ) | { head -n "$SECTION_LIMIT_LINES"; cat >/dev/null; }
}

section "preflight-diagnostics"
echo "captured_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || true)"
echo "host=$(uname -n 2>/dev/null || echo unknown)"
echo "kernel=$(uname -srm 2>/dev/null || echo unknown)"
echo "uid=$(id -u 2>/dev/null || echo unknown) gid=$(id -g 2>/dev/null || echo unknown)"
echo "section_limit_lines=$SECTION_LIMIT_LINES"
echo "ci_provider=$(ci_provider)"
echo "ci_event_name=$(ci_event_name)"
echo "ci_run_id=$(ci_run_id)"
echo "ci_workspace=$(ci_workspace)"
echo "ci_temp_dir=$(ci_temp_dir)"

run_bounded "docker version" docker version
run_bounded "docker info" docker info
run_bounded "df -h /tmp /var/tmp" df -h /tmp /var/tmp
run_bounded "mount" mount

section "env (allowlisted)"
for var in "${ENV_ALLOWLIST[@]}"; do
  if [ "${!var+isset}" = "isset" ]; then
    printf '%s=%s\n' "$var" "${!var}"
  fi
done

section "preflight-diagnostics-end"
exit 0
