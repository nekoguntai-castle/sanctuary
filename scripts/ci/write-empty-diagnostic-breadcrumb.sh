#!/usr/bin/env bash
# Create a diagnostic failure breadcrumb when a job failed without a failed
# scripts/ci/run-with-log.sh sidecar. This preserves a publishable failure log
# for setup/teardown/action failures that happen outside wrapped commands.

set -euo pipefail

SCHEMA_VERSION=1

usage() {
  cat >&2 <<'USAGE'
Usage: scripts/ci/write-empty-diagnostic-breadcrumb.sh DIAGNOSTIC_DIR LOG_BASENAME TITLE
USAGE
}

fail() {
  echo "write-empty-diagnostic-breadcrumb: $*" >&2
  exit 1
}

if [ "$#" -ne 3 ]; then
  usage
  fail 'expected a diagnostic directory, log basename, and title'
fi

DIAGNOSTIC_DIR="$1"
LOG_BASENAME="$2"
TITLE="$3"

if [ -z "$DIAGNOSTIC_DIR" ]; then
  fail 'diagnostic directory is empty'
fi

case "$LOG_BASENAME" in
  ''|*[!A-Za-z0-9._-]*|*.status.json)
    fail "log basename must use only A-Z, a-z, 0-9, dot, underscore, and dash (got: $LOG_BASENAME)"
    ;;
esac

case "$LOG_BASENAME" in
  *.log)
    ;;
  *)
    fail "log basename must end in .log (got: $LOG_BASENAME)"
    ;;
esac

if [ -z "$TITLE" ]; then
  fail 'title is empty'
fi

has_failed_sidecar() {
  local status_path
  local wrapped_exit

  if [ ! -d "$DIAGNOSTIC_DIR" ]; then
    return 1
  fi

  while IFS= read -r -d '' status_path; do
    wrapped_exit="$(
      sed -n 's/^[[:space:]]*"wrapped_exit"[[:space:]]*:[[:space:]]*\(-\{0,1\}[0-9][0-9]*\).*/\1/p' "$status_path" 2>/dev/null |
        head -n 1
    )"
    if [ -n "$wrapped_exit" ] && [ "$wrapped_exit" -ne 0 ]; then
      return 0
    fi
  done < <(find "$DIAGNOSTIC_DIR" -type f -name '*.log.status.json' -print0 2>/dev/null)

  return 1
}

# sanctuary#1009: verify-vectors run 14568 failed via a podman "context
# deadline exceeded" copying SUMMARY.md out of the job container, after every
# wrapped verification step had already exited 0. That failure looked
# identical, in the generic breadcrumb below, to an actual proof regression.
# Count succeeded sidecars so the breadcrumb can name the run as a
# post-verification runner/infrastructure fault instead.
count_succeeded_sidecars() {
  local status_path
  local wrapped_exit
  local count=0

  if [ ! -d "$DIAGNOSTIC_DIR" ]; then
    echo 0
    return 0
  fi

  while IFS= read -r -d '' status_path; do
    wrapped_exit="$(
      sed -n 's/^[[:space:]]*"wrapped_exit"[[:space:]]*:[[:space:]]*\(-\{0,1\}[0-9][0-9]*\).*/\1/p' "$status_path" 2>/dev/null |
        head -n 1
    )"
    if [ -n "$wrapped_exit" ] && [ "$wrapped_exit" -eq 0 ]; then
      count=$((count + 1))
    fi
  done < <(find "$DIAGNOSTIC_DIR" -type f -name '*.log.status.json' -print0 2>/dev/null)

  echo "$count"
}

if has_failed_sidecar; then
  echo "write-empty-diagnostic-breadcrumb: failed diagnostic sidecar already exists; breadcrumb not needed"
  exit 0
fi

mkdir -p "$DIAGNOSTIC_DIR"

LOG_PATH="$DIAGNOSTIC_DIR/$LOG_BASENAME"
SIDECAR_PATH="$LOG_PATH.status.json"
SIDECAR_TMP="$SIDECAR_PATH.$$.tmp"
STARTED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
ENDED_AT="$STARTED_AT"

SUCCEEDED_SIDECARS="$(count_succeeded_sidecars)"

if [ "$SUCCEEDED_SIDECARS" -gt 0 ]; then
  cat >"$LOG_PATH" <<LOG
Diagnostic breadcrumb: $TITLE failed without a failed run-with-log.sh sidecar.
Diagnostic directory: $DIAGNOSTIC_DIR

All $SUCCEEDED_SIDECARS captured verification step(s) succeeded (wrapped_exit
0); this job failure is a post-verification runner/infrastructure fault --
not a proof regression. Known causes on this repo: the runner's own
container-to-host artifact copy (e.g. SUMMARY.md, GITHUB_PATH) timing out
against a hung podman/docker socket, or job teardown being interrupted after
verification finished.

Inspect the Forgejo task output and the runner/DIND state for the missing
failure context.
LOG
else
  cat >"$LOG_PATH" <<LOG
Diagnostic breadcrumb: $TITLE failed without a failed run-with-log.sh sidecar.
Diagnostic directory: $DIAGNOSTIC_DIR

This usually means the failure happened before setup completed, after a
wrapped command succeeded, inside a workflow action, or while the runner was
terminating the job before run-with-log.sh could write a failed sidecar.

Inspect the Forgejo task output and the runner/DIND state for the missing
failure context.
LOG
fi

cat >"$SIDECAR_TMP" <<JSON
{
  "schema_version": $SCHEMA_VERSION,
  "wrapped_exit": 1,
  "redactor_exit": 0,
  "cap_exit": 0,
  "sink_status": "ok",
  "started_at": "$STARTED_AT",
  "ended_at": "$ENDED_AT",
  "truncated": false
}
JSON
mv "$SIDECAR_TMP" "$SIDECAR_PATH"

echo "write-empty-diagnostic-breadcrumb: wrote $LOG_PATH"
