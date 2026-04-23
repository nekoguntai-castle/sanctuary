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

# Determine output file
if [ -n "${1:-}" ]; then
  OUTPUT_FILE="$1"
else
  TIMESTAMP="$(date -u +%Y-%m-%d-%H-%M-%S)"
  OUTPUT_FILE="sanctuary-support-${TIMESTAMP}.json"
fi

echo "Generating support package..."

docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T backend node -e "
  const candidates = [
    './dist/app/src/services/supportPackage',
    './dist/server/src/services/supportPackage',
    './dist/services/supportPackage',
  ];
  const modulePath = candidates.find((candidate) => {
    try {
      require.resolve(candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!modulePath) {
    process.stderr.write('Error: could not locate compiled support package module\n');
    process.exit(1);
  }
  require(modulePath).generateSupportPackage()
    .then((pkg) => process.stdout.write(JSON.stringify(pkg, null, 2)))
    .catch(err => { process.stderr.write('Error: ' + err.message + '\n'); process.exit(1); });
" > "$OUTPUT_FILE"

echo "Support package written to: $OUTPUT_FILE"
