#!/usr/bin/env bash
#
# Generate a Sanctuary support package for diagnostic purposes.
#
# Usage:
#   ./scripts/support-package.sh [output-file]
#
# If no output file is specified, writes to sanctuary-support-<timestamp>.json
# in the current directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$SCRIPT_DIR/ownership/producer-hooks.sh"
ownership_prepare_operator_compose "$PROJECT_DIR"

# Determine output file
if [ -n "${1:-}" ]; then
  OUTPUT_FILE="$1"
else
  TIMESTAMP="$(date -u +%Y-%m-%d-%H-%M-%S)"
  OUTPUT_FILE="sanctuary-support-${TIMESTAMP}.json"
fi

echo "Generating support package..."

docker compose --project-directory "$PROJECT_DIR" --env-file "$SANCTUARY_ENV_FILE" \
  -p "$SANCTUARY_PROJECT" -f "$PROJECT_DIR/docker-compose.yml" exec -T backend node --input-type=module - \
  < "$SCRIPT_DIR/support-package-runner.mjs" > "$OUTPUT_FILE"

echo "Support package written to: $OUTPUT_FILE"
