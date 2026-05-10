#!/usr/bin/env bash
# WORKAROUND for Forgejo 15.0.1 missing the Gitea-upstream
# /api/v1/repos/<owner>/<repo>/actions/jobs/<job_id>/logs endpoint
# (Gitea issue #35176). Once that endpoint ships in a Forgejo version we
# run, this script and the entire tools/ci-log-sink/ tree should be
# removed — see tools/ci-log-sink/README.md "When to retire this service"
# for the deletion checklist.
#
# Publish failed-step log tails from a $DIAGNOSTIC_DIR to the LAN log sink so
# they're API-fetchable without browser / session-cookie access to Forgejo.
#
# No-op when SANCTUARY_CI_LOG_SINK_URL is unset, so unconfigured environments
# (local dev, third-party forks) pass through transparently.
#
# Usage:
#   scripts/ci/publish-failed-logs.sh DIAGNOSTIC_DIR JOB_SAFE_NAME
#
# Identifies failed logs the same way write-diagnostic-summary.sh does:
# parse each *.log.status.json sidecar and treat any wrapped_exit != 0 as
# failed. Each failed log's tail (256 KiB cap, matching the inline echo) is
# PUT to:
#
#   $SANCTUARY_CI_LOG_SINK_URL/runs/<run_id>/$JOB_SAFE_NAME/$log_basename
#
# Run ID is resolved through scripts/ci/provider-context.sh::ci_run_id so
# the script stays provider-agnostic (works under GitHub or Forgejo Actions
# without referencing provider-specific env vars directly).
#
# Failures from the sink are logged to stderr but never fail the calling
# step — diagnostics must not turn a green build red.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

usage() {
  cat >&2 <<'USAGE'
Usage: scripts/ci/publish-failed-logs.sh DIAGNOSTIC_DIR JOB_SAFE_NAME
USAGE
}

warn() {
  echo "publish-failed-logs: $*" >&2
}

if [ "$#" -ne 2 ]; then
  usage
  exit 0
fi

DIAGNOSTIC_DIR="$1"
JOB_SAFE_NAME="$2"

if [ -z "${SANCTUARY_CI_LOG_SINK_URL:-}" ]; then
  exit 0
fi

RUN_ID="$(ci_run_id 2>/dev/null || true)"
if [ -z "$RUN_ID" ]; then
  warn "no CI run id resolvable; nothing to publish"
  exit 0
fi
if [ ! -d "$DIAGNOSTIC_DIR" ]; then
  warn "diagnostic dir does not exist: $DIAGNOSTIC_DIR"
  exit 0
fi

case "$JOB_SAFE_NAME" in
  ''|*[!A-Za-z0-9._-]*)
    warn "JOB_SAFE_NAME must match [A-Za-z0-9._-]+ (got: $JOB_SAFE_NAME)"
    exit 0
    ;;
esac

TAIL_BYTES="${SANCTUARY_CI_LOG_TAIL_BYTES:-262144}"   # 256 KiB
SINK_URL="${SANCTUARY_CI_LOG_SINK_URL%/}"

published=0
skipped=0

# Find every captured log via its sidecar; a non-zero wrapped_exit is the
# failure signal we publish. We use python3 for JSON parsing portability.
while IFS= read -r -d '' status_path; do
  log_path="${status_path%.status.json}"
  [ -f "$log_path" ] || { skipped=$((skipped + 1)); continue; }

  wrapped_exit="$(
    python3 -c '
import json, sys
try:
  with open(sys.argv[1]) as f:
    print(json.load(f).get("wrapped_exit", 0))
except Exception:
  print(0)
' "$status_path" 2>/dev/null
  )"

  if [ "$wrapped_exit" = "0" ] || [ -z "$wrapped_exit" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  log_basename="$(basename "$log_path")"
  case "$log_basename" in
    ''|*[!A-Za-z0-9._-]*)
      warn "skipping log with unsafe basename: $log_basename"
      continue
      ;;
  esac

  url="${SINK_URL}/runs/${RUN_ID}/${JOB_SAFE_NAME}/${log_basename}"
  tmp="$(mktemp)"
  tail -c "$TAIL_BYTES" "$log_path" > "$tmp"

  # Pass the bearer token via a header file so it never appears in argv
  # (where `ps` could read it on a multi-tenant host). Header file is
  # mode-restricted and removed in the same trap as the body tmp.
  curl_header_args=()
  if [ -n "${SANCTUARY_CI_LOG_SINK_TOKEN:-}" ]; then
    auth_tmp="$(mktemp)"
    chmod 600 "$auth_tmp"
    printf 'Authorization: Bearer %s\n' "$SANCTUARY_CI_LOG_SINK_TOKEN" > "$auth_tmp"
    curl_header_args=(-H "@$auth_tmp")
  fi

  http_code="$(
    curl -sS -X PUT \
      --max-time 30 \
      --data-binary "@$tmp" \
      -H "Content-Type: text/plain; charset=utf-8" \
      "${curl_header_args[@]}" \
      -o /dev/null \
      -w "%{http_code}" \
      "$url" 2>&1 || echo "curl-failed"
  )"
  rm -f "$tmp" "${auth_tmp:-/dev/null}"
  unset auth_tmp

  case "$http_code" in
    2*)
      published=$((published + 1))
      echo "publish-failed-logs: PUT $url -> $http_code" >&2
      ;;
    *)
      warn "PUT $url failed: $http_code"
      ;;
  esac
done < <(find "$DIAGNOSTIC_DIR" -type f -name '*.log.status.json' -print0 2>/dev/null)

echo "publish-failed-logs: published=$published skipped=$skipped" >&2
exit 0
