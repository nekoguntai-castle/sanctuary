#!/bin/bash
# Helpers for resolving upgrade source references.

is_stable_release_tag() {
    local ref="$1"
    [[ "$ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

list_upgrade_source_tags() {
    local repo_root="$1"
    local target_commit="${2:-}"

    while IFS= read -r tag; do
        [ -n "$tag" ] || continue
        is_stable_release_tag "$tag" || continue

        local tag_commit
        tag_commit=$(git -C "$repo_root" rev-list -n 1 "$tag" 2>/dev/null || echo "")
        if [ -n "$target_commit" ] && [ "$tag_commit" = "$target_commit" ]; then
            continue
        fi

        echo "$tag"
    done < <(git -C "$repo_root" tag --sort=-v:refname)
}

resolve_upgrade_source_ref() {
    local repo_root="$1"
    local selector="${2:-latest-stable}"
    local target_commit="${3:-}"
    local index=0

    case "$selector" in
        ""|auto|latest-stable|n-1|N-1)
            index=0
            ;;
        n-2|N-2)
            index=1
            ;;
        n-3|N-3)
            index=2
            ;;
        *)
            if git -C "$repo_root" rev-parse --verify "$selector" >/dev/null 2>&1; then
                echo "$selector"
                return 0
            fi
            return 1
            ;;
    esac

    local tags=()
    mapfile -t tags < <(list_upgrade_source_tags "$repo_root" "$target_commit")

    if [ "${#tags[@]}" -gt "$index" ]; then
        echo "${tags[$index]}"
        return 0
    fi

    return 1
}
