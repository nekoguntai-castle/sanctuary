#!/usr/bin/env bash
set -euo pipefail

# Keep a wedged actionlint/ShellCheck callback below the workflow step's
# three-minute runner context. The timeout's 124 status is preserved by exec;
# run-with-log.sh records the command output and sidecar as usual.
actionlint_bin="${SANCTUARY_ACTIONLINT_BIN:-/tmp/actionlint}"
actionlint_timeout_seconds="${SANCTUARY_ACTIONLINT_TIMEOUT_SECONDS:-150}"
timeout_bin="${SANCTUARY_TIMEOUT_BIN:-timeout}"

case "$actionlint_timeout_seconds" in
  ''|*[!0-9]*)
    echo "run-actionlint: timeout must be a non-negative integer (got: $actionlint_timeout_seconds)" >&2
    exit 64
    ;;
esac

exec "$timeout_bin" --kill-after=5s "${actionlint_timeout_seconds}s" \
  "$actionlint_bin" -color \
  -shellcheck='scripts/ci/actionlint-shellcheck.sh --severity=error' \
  -ignore 'specifying action "https://data\.forgejo\.org/forgejo/(upload|download)-artifact@v4" in invalid format'
