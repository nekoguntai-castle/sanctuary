#!/bin/bash

list_upgrade_source_tags() {
    local repo_root="${1:-.}"
    local target_commit="${2:-$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo "")}"
    local tag=""
    local tag_commit=""

    while IFS= read -r tag; do
        [ -z "$tag" ] && continue
        if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            continue
        fi

        tag_commit="$(git -C "$repo_root" rev-list -n 1 "$tag" 2>/dev/null || echo "")"
        if [ -n "$tag_commit" ] && [ "$tag_commit" != "$target_commit" ]; then
            echo "$tag"
        fi
    done < <(git -C "$repo_root" tag --sort=-v:refname)
}

resolve_named_upgrade_source_ref() {
    local requested_ref="$1"
    local repo_root="${2:-.}"
    local target_commit="${3:-$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo "")}"
    local line_number=""

    case "$requested_ref" in
        ""|latest-stable)
            line_number=1
            ;;
        n-1)
            line_number=2
            ;;
        n-2)
            line_number=3
            ;;
        *)
            echo "$requested_ref"
            return 0
            ;;
    esac

    list_upgrade_source_tags "$repo_root" "$target_commit" | sed -n "${line_number}p"
}
