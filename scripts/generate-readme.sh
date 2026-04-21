#!/bin/bash
# Generate platform-specific README from template
# Usage: ./scripts/generate-readme.sh [github|gitlab]

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

case "$PLATFORM" in
    github)
        REPO_URL="https://github.com/nekoguntai-castle/sanctuary"
        CLONE_URL="https://github.com/nekoguntai-castle/sanctuary.git"
        RAW_URL="https://raw.githubusercontent.com/nekoguntai-castle/sanctuary/main"
        PLATFORM_NAME="GitHub"
        ;;
    gitlab)
        REPO_URL="https://gitlab.com/narusegawa-nekoworks/sanctuary"
        CLONE_URL="https://gitlab.com/narusegawa-nekoworks/sanctuary.git"
        RAW_URL="https://gitlab.com/narusegawa-nekoworks/sanctuary/-/raw/main"
        PLATFORM_NAME="GitLab"
        ;;
    *)
        echo "Error: Unknown platform '$PLATFORM'. Use 'github' or 'gitlab'."
        exit 1
        ;;
esac

echo "Generating README for $PLATFORM_NAME..."

sed -e "s|{{REPO_URL}}|$REPO_URL|g" \
    -e "s|{{CLONE_URL}}|$CLONE_URL|g" \
    -e "s|{{RAW_URL}}|$RAW_URL|g" \
    -e "s|{{PLATFORM}}|$PLATFORM_NAME|g" \
    "$TEMPLATE" > "$OUTPUT"

echo "Generated: $OUTPUT"
