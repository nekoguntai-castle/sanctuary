#!/bin/bash
# Generate the canonical GitHub README from the template.
# Usage: ./scripts/generate-readme.sh [github]

set -e

PLATFORM="${1:-github}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

TEMPLATE="$REPO_ROOT/README.template.md"
OUTPUT="$REPO_ROOT/README.md"

if [[ ! -f "$TEMPLATE" ]]; then
    echo "Error: Template file not found: $TEMPLATE"
    exit 1
fi

if [[ "$PLATFORM" != "github" ]]; then
    echo "Error: Unknown platform '$PLATFORM'. GitHub is the only supported public distribution source." >&2
    exit 1
fi

CLONE_URL="https://github.com/nekoguntai-castle/sanctuary.git"
RAW_URL="https://raw.githubusercontent.com/nekoguntai-castle/sanctuary/main"

echo "Generating README for GitHub..."

sed -e "s|{{CLONE_URL}}|$CLONE_URL|g" \
    -e "s|{{RAW_URL}}|$RAW_URL|g" \
    "$TEMPLATE" > "$OUTPUT"

echo "Generated: $OUTPUT"
