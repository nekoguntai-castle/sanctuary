#!/usr/bin/env bash
# Run a command with combined stdout+stderr redacted, capped, and tee'd
# into a per-step diagnostic log. Writes an atomic sidecar status file
# next to the log so consumers can tell a complete-but-failed wrapped
# command apart from a truncated or infrastructure-failed log pipeline.
#
# Usage:
#   scripts/ci/run-with-log.sh LOG_PATH COMMAND [ARG...]
#
# Behavior contract:
#   - LOG_PATH must be writable; the wrapper creates parent directories.
#   - The wrapped command's combined stdout+stderr is captured. Wrapper
#     diagnostics go to /dev/tty when available, otherwise stderr — they
#     do not pollute the captured log.
#   - The redactor (scripts/ci/redactor.sh) is mandatory. If missing or
#     unsourceable, the wrapper fails closed BEFORE running the wrapped
#     command rather than risking a secret leak through unredacted tee.
#   - Output is bounded by SANCTUARY_CI_LOG_CAP_BYTES (default 32 MiB).
#     The cap filter drains stdin to EOF; it does not SIGPIPE upstream.
#   - The wrapped command's exit status is preserved verbatim; pipeline
#     plumbing failures are reported through the sidecar `sink_status`
#     and `redactor_exit`, not by clobbering the wrapped exit.
#   - A sidecar `<log>.status.json` is written atomically (`*.tmp`+rename)
#     with schema_version=1. If the wrapper is killed by SIGTERM/SIGINT
#     before the pipeline completes, a best-effort sidecar with
#     `sink_status: "interrupted"` is written; absence of the sidecar is
#     a valid "truncated/incomplete" signal because the runner can
#     hard-kill before traps run.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REDACTOR_PATH="$SCRIPT_DIR/redactor.sh"
SCHEMA_VERSION=1
DEFAULT_CAP_BYTES=$((32 * 1024 * 1024))
CAP_BYTES="${SANCTUARY_CI_LOG_CAP_BYTES:-$DEFAULT_CAP_BYTES}"

usage() {
  cat >&2 <<'USAGE'
Usage: scripts/ci/run-with-log.sh LOG_PATH COMMAND [ARG...]
USAGE
}

wrapper_diag() {
  # Write wrapper-internal diagnostics to the parent's stderr. The
  # captured log only contains output from the wrapped pipeline (which
  # has its stderr merged into stdout via 2>&1 inside the brace group),
  # so wrapper diagnostics on stderr stay out of the log file.
  echo "run-with-log: $*" >&2
}

fail_closed() {
  wrapper_diag "$*"
  exit 64
}

if [ "$#" -lt 2 ]; then
  usage
  fail_closed 'expected a log path and a command'
fi

LOG_PATH="$1"
shift

if [ -z "$LOG_PATH" ]; then
  fail_closed 'log path is empty'
fi

case "$CAP_BYTES" in
  ''|*[!0-9]*)
    fail_closed "SANCTUARY_CI_LOG_CAP_BYTES must be a non-negative integer (got: $CAP_BYTES)"
    ;;
esac

if [ ! -f "$REDACTOR_PATH" ]; then
  fail_closed "redactor not found at $REDACTOR_PATH (fail-closed; refusing unredacted tee)"
fi

# Source redactor in a subshell first to validate it before committing.
if ! ( . "$REDACTOR_PATH" && type -t redact_stream >/dev/null && type -t redact_file >/dev/null ); then
  fail_closed "redactor at $REDACTOR_PATH did not export redact_stream/redact_file"
fi

LOG_DIR="$(dirname "$LOG_PATH")"
if ! mkdir -p "$LOG_DIR"; then
  fail_closed "cannot create log directory: $LOG_DIR"
fi

if ! ( : > "$LOG_PATH" ) 2>/dev/null; then
  fail_closed "log path is not writable: $LOG_PATH"
fi

SIDECAR="${LOG_PATH}.status.json"
SIDECAR_TMP="${SIDECAR}.$$.tmp"
TRUNC_FLAG="${LOG_PATH}.trunc.$$"
EXIT_FILE="${LOG_PATH}.exit.$$"

cleanup_tmp() {
  rm -f "$SIDECAR_TMP" "$TRUNC_FLAG" "$EXIT_FILE" 2>/dev/null || true
}

write_sidecar_atomic() {
  # Args: wrapped_exit redactor_exit cap_exit sink_status truncated ended_at
  local wrapped_exit="$1"
  local redactor_exit="$2"
  local cap_exit="$3"
  local sink_status="$4"
  local truncated="$5"
  local ended_at="$6"

  # All inputs are controlled (integers or fixed-vocabulary strings); a
  # hand-built JSON document is safe. If free-form fields are added later
  # they MUST go through a real JSON encoder rather than this template.
  cat >"$SIDECAR_TMP" <<JSON
{
  "schema_version": $SCHEMA_VERSION,
  "wrapped_exit": $wrapped_exit,
  "redactor_exit": $redactor_exit,
  "cap_exit": $cap_exit,
  "sink_status": "$sink_status",
  "started_at": "$STARTED_AT",
  "ended_at": "$ended_at",
  "truncated": $truncated
}
JSON
  if ! mv "$SIDECAR_TMP" "$SIDECAR"; then
    wrapper_diag "failed to rename sidecar $SIDECAR_TMP -> $SIDECAR"
    return 1
  fi
  return 0
}

INTERRUPTED=0
on_signal() {
  local sig="$1"
  INTERRUPTED=1
  local now
  now="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo '')"
  # Best-effort sidecar; runner may still hard-kill before this completes.
  write_sidecar_atomic -1 -1 -1 "interrupted" "false" "$now" 2>/dev/null || true
  trap - "$sig"
  cleanup_tmp
  # Re-raise so the parent sees the original signal.
  kill "-$sig" "$$" 2>/dev/null || exit 130
}

trap 'on_signal TERM' TERM
trap 'on_signal INT' INT

STARTED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# Source the redactor for the actual run (validated above).
# shellcheck source=./redactor.sh
. "$REDACTOR_PATH"

# Cap filter: count bytes including newlines, write the first CAP_BYTES,
# then drain stdin to EOF without writing further (so upstream is never
# SIGPIPEd). On truncation, append a single marker line and touch the
# truncation flag file so the parent knows to set sidecar.truncated=true.
cap_filter() {
  awk -v cap="$1" -v flag_file="$2" '
    BEGIN { written = 0; truncated = 0 }
    {
      line = $0
      n = length(line) + 1
      if (truncated) {
        next
      }
      if (written + n <= cap) {
        print line
        written += n
      } else {
        remaining = cap - written
        if (remaining > 0) {
          printf "%s", substr(line, 1, remaining)
        }
        printf "\n[run-with-log] LOG TRUNCATED AT %d BYTES\n", cap
        truncated = 1
      }
    }
    END {
      if (truncated) {
        printf "TRUNCATED" > flag_file
      }
    }
  '
}

# Run the wrapped command. Capture exit status via a side-channel file so
# the pipeline plumbing cannot clobber it. Stderr is merged into stdout
# inside the brace group so the redactor sees both streams.
rm -f "$EXIT_FILE" "$TRUNC_FLAG"

run_wrapped() {
  set +e
  "$@"
  local rc="$?"
  set -e
  printf '%s' "$rc" > "$EXIT_FILE"
}

# We deliberately do not enable `set -o pipefail` for this pipeline because
# the wrapped exit is captured out-of-band; pipefail would mask the wrapped
# status with a downstream pipe failure that we already report through the
# sidecar.
{ run_wrapped "$@"; } 2>&1 | redact_stream | cap_filter "$CAP_BYTES" "$TRUNC_FLAG" | tee "$LOG_PATH" >/dev/null
PIPELINE_RC=("${PIPESTATUS[@]}")

WRAPPED_EXIT=0
if [ -f "$EXIT_FILE" ]; then
  WRAPPED_EXIT="$(cat "$EXIT_FILE" 2>/dev/null || echo 0)"
  case "$WRAPPED_EXIT" in
    ''|*[!0-9]*) WRAPPED_EXIT=0 ;;
  esac
fi

REDACTOR_EXIT="${PIPELINE_RC[1]:-0}"
CAP_EXIT="${PIPELINE_RC[2]:-0}"
SINK_EXIT="${PIPELINE_RC[3]:-0}"

TRUNCATED="false"
if [ -f "$TRUNC_FLAG" ]; then
  TRUNCATED="true"
fi

if [ "$REDACTOR_EXIT" -ne 0 ] || [ "$CAP_EXIT" -ne 0 ] || [ "$SINK_EXIT" -ne 0 ]; then
  SINK_STATUS="failed"
else
  SINK_STATUS="ok"
fi

ENDED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
if ! write_sidecar_atomic "$WRAPPED_EXIT" "$REDACTOR_EXIT" "$CAP_EXIT" "$SINK_STATUS" "$TRUNCATED" "$ENDED_AT"; then
  wrapper_diag "failed to write sidecar $SIDECAR"
fi

cleanup_tmp

# If the pipeline plumbing itself broke (redactor or sink failure), surface
# that as a wrapper-infrastructure failure (exit 65) distinct from the
# wrapped command's own exit. The sidecar still records both for analysis.
if [ "$SINK_STATUS" = "failed" ] && [ "$WRAPPED_EXIT" -eq 0 ]; then
  exit 65
fi

exit "$WRAPPED_EXIT"
