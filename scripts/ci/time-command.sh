#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo 'Usage: scripts/ci/time-command.sh LABEL COMMAND [ARG...]' >&2
  exit 1
fi

label="$1"
shift

start_epoch="$(date +%s)"
echo "::group::$label"

set +e
"$@"
status="$?"
set -e

echo '::endgroup::'

end_epoch="$(date +%s)"
elapsed_seconds="$((end_epoch - start_epoch))"
elapsed_minutes="$((elapsed_seconds / 60))"
remaining_seconds="$((elapsed_seconds % 60))"
message="$label completed in ${elapsed_minutes}m ${remaining_seconds}s (${elapsed_seconds}s)"

if [ "$status" -eq 0 ]; then
  echo "::notice title=CI timing::$message"
else
  echo "::error title=CI timing::$message with exit code $status"
fi

exit "$status"
