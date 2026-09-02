#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 SUITE" >&2
  exit 2
fi

exec "$(dirname "$0")/run-standalone-test-command.sh" bash "$1"
