#!/usr/bin/env bash
set -euo pipefail

# Keep a wedged actionlint/ShellCheck callback below the workflow step's
# three-minute runner context.
#
# actionlint gets an empty stdin: the quality step feeds its script to bash
# through a heredoc, and inheriting that pipe is the leading suspect for the
# wedges seen on 2026-10-05 (runs 20181, 20245, 20268), where actionlint sat
# idle with no ShellCheck child until the cap. A wedged attempt receives
# SIGQUIT, so the Go runtime prints every goroutine's stack into the log, and
# is retried once. A real lint failure is never retried. Two attempts plus
# their kill grace stay inside the step's three minutes.
actionlint_bin="${SANCTUARY_ACTIONLINT_BIN:-/tmp/actionlint}"
actionlint_timeout_seconds="${SANCTUARY_ACTIONLINT_TIMEOUT_SECONDS:-75}"
timeout_bin="${SANCTUARY_TIMEOUT_BIN:-timeout}"

case "$actionlint_timeout_seconds" in
  ''|*[!0-9]*)
    echo "run-actionlint: timeout must be a non-negative integer (got: $actionlint_timeout_seconds)" >&2
    exit 64
    ;;
esac

run_actionlint_once() {
  "$timeout_bin" --signal=QUIT --kill-after=5s "${actionlint_timeout_seconds}s" \
    "$actionlint_bin" -color \
    -shellcheck='scripts/ci/actionlint-shellcheck.sh --severity=error' \
    -ignore 'specifying action "https://data\.forgejo\.org/forgejo/(upload|download)-artifact@v4" in invalid format' \
    </dev/null
}

status=0
run_actionlint_once || status=$?
if [ "$status" -eq 124 ]; then
  echo "::warning title=actionlint wedge::actionlint made no progress for ${actionlint_timeout_seconds}s; its goroutine dump is above. Retrying once."
  status=0
  run_actionlint_once || status=$?
fi
exit "$status"
