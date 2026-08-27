#!/usr/bin/env bash
# Shared upgrade CI selection contract.

upgrade_selection_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tests/install/utils/upgrade-source-refs.sh
. "$upgrade_selection_script_dir/upgrade-source-refs.sh"

upgrade_default_baseline_refs() {
    printf '%s\n' 'latest-stable,n-2'
}

upgrade_should_verify_force_rebuild() {
    local is_release="$1"
    local source_ref="$2"
    local already_selected="$3"

    [ "$is_release" = "true" ] \
        && [ "$source_ref" = "latest-stable" ] \
        && [ "$already_selected" != "true" ]
}

upgrade_active_extended_fixture_records() {
    cat <<'EOF'
browser-origin-ip 21
legacy-runtime-env 24
notification-delivery 27
optional-profiles 30
wallet-sync-retirement 33
EOF
}

upgrade_active_extended_fixtures_csv() {
    local fixture
    local output=""

    while read -r fixture _offset; do
        [ -n "$fixture" ] || continue
        if [ -n "$output" ]; then
            output="${output},${fixture}"
        else
            output="$fixture"
        fi
    done < <(upgrade_active_extended_fixture_records)

    printf '%s\n' "$output"
}

upgrade_extended_fixture_port_offset() {
    local requested="$1"
    local fixture offset

    while read -r fixture offset; do
        if [ "$fixture" = "$requested" ]; then
            printf '%s\n' "$offset"
            return 0
        fi
    done < <(upgrade_active_extended_fixture_records)

    return 1
}

upgrade_extended_fixture_source_ref() {
    local requested="$1"
    local default_ref="$2"

    if [ "$requested" = "wallet-sync-retirement" ]; then
        printf '%s\n' 'v0.8.66'
    else
        printf '%s\n' "$default_ref"
    fi
}

upgrade_validate_source_selector() {
    local selector="$1"

    case "$selector" in
        ''|*[!A-Za-z0-9._/@-]*)
            return 1
            ;;
    esac
}

upgrade_validate_baseline_ref_selection() {
    local ref_list="$1"
    local ref

    [ -n "$ref_list" ] || {
        echo "No upgrade baseline refs selected" >&2
        return 1
    }
    case "$ref_list" in
        ,*|*,|*,,*)
            echo "Upgrade baseline ref list contains an empty selector" >&2
            return 1
            ;;
    esac

    IFS=',' read -ra refs <<< "$ref_list"
    for ref in "${refs[@]}"; do
        if ! upgrade_validate_source_selector "$ref"; then
            echo "Unsupported upgrade source ref selector: $ref" >&2
            return 1
        fi
    done
}

upgrade_validate_extended_fixture_selection() {
    local fixture_list="$1"
    local fixture

    [ -n "$fixture_list" ] || {
        echo "No extended upgrade fixtures selected" >&2
        return 1
    }
    case "$fixture_list" in
        ,*|*,|*,,*)
            echo "Extended upgrade fixture list contains an empty selector" >&2
            return 1
            ;;
    esac

    IFS=',' read -ra fixtures <<< "$fixture_list"
    for fixture in "${fixtures[@]}"; do
        case "$fixture" in
            ''|*[!A-Za-z0-9._-]*)
                echo "Unsupported extended upgrade fixture selector: $fixture" >&2
                return 1
                ;;
        esac
        if ! upgrade_extended_fixture_port_offset "$fixture" >/dev/null; then
            echo "Unknown extended upgrade fixture: $fixture" >&2
            return 1
        fi
    done
}

upgrade_finish_with_cleanup() {
    local original_status="$1"
    local cleanup_function="$2"
    local project_label="${3:-upgrade fixture}"
    local cleanup_status=0

    if "$cleanup_function"; then
        cleanup_status=0
    else
        cleanup_status="$?"
    fi

    if [ "$original_status" -ne 0 ]; then
        if [ "$cleanup_status" -ne 0 ]; then
            echo "::warning::Label fallback could not fully clean $project_label" >&2
        fi
        return "$original_status"
    fi

    if [ "$cleanup_status" -ne 0 ]; then
        echo "::error::Label fallback could not fully clean $project_label" >&2
        return "$cleanup_status"
    fi

    return 0
}

upgrade_sanitize_label() {
    local raw="$1"
    local lower sanitized hash prefix

    lower="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
    sanitized="$(printf '%s' "$lower" | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')"
    sanitized="${sanitized:-ref}"

    if [ "$raw" != "$lower" ] || [ "$sanitized" != "$lower" ] || [ "${#sanitized}" -gt 48 ]; then
        hash="$(printf '%s' "$raw" | cksum | awk '{print $1}')"
        prefix="${sanitized:0:40}"
        prefix="${prefix%-}"
        sanitized="${prefix}-${hash}"
    fi

    printf '%s\n' "$sanitized"
}

upgrade_manifest_ref_line() {
    local repo_root="$1"
    local selector="$2"
    local target_commit="$3"
    local resolved_ref=""
    local resolved_commit=""

    resolved_ref="$(resolve_upgrade_source_ref "$repo_root" "$selector" "$target_commit" 2>/dev/null || true)"
    if [ -n "$resolved_ref" ]; then
        resolved_commit="$(git -C "$repo_root" rev-list -n 1 "$resolved_ref" 2>/dev/null || true)"
    fi

    printf -- '- selector: `%s`; label: `%s`; resolved: `%s`; commit: `%s`\n' \
        "$selector" \
        "$(upgrade_sanitize_label "$selector")" \
        "${resolved_ref:-unresolved}" \
        "${resolved_commit:-unresolved}"
}

upgrade_write_selection_manifest() {
    local repo_root="$1"
    local artifact_root="$2"
    local baseline_refs="$3"
    local extended_fixtures="$4"
    local extended_source_ref="$5"
    local run_id="${6:-}"
    local manifest="$artifact_root/selection-manifest.md"
    local target_commit
    local selector
    local selectors=()
    local fixture port_offset fixture_source_ref

    mkdir -p "$artifact_root"
    target_commit="$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || true)"

    {
        echo "# Upgrade Selection Manifest"
        echo ""
        echo "- Run id: ${run_id:-unknown}"
        echo "- Target commit: ${target_commit:-unknown}"
        echo "- Baseline refs: ${baseline_refs:-none}"
        echo "- Extended fixtures: ${extended_fixtures:-none}"
        echo "- Default extended source ref: ${extended_source_ref:-none}"
        echo ""
        echo "## Baseline Source Refs"
        echo ""
        if [ -n "$baseline_refs" ]; then
            IFS=',' read -ra selectors <<< "$baseline_refs"
            for selector in "${selectors[@]}"; do
                upgrade_manifest_ref_line "$repo_root" "$selector" "$target_commit"
            done
        else
            echo "- none"
        fi
        echo ""
        echo "## Selected Extended Fixture Sources"
        echo ""
        if [ -n "$extended_fixtures" ]; then
            IFS=',' read -ra selectors <<< "$extended_fixtures"
            for fixture in "${selectors[@]}"; do
                fixture_source_ref="$(upgrade_extended_fixture_source_ref "$fixture" "$extended_source_ref")"
                echo "### $fixture"
                echo ""
                echo "- effective source ref: \`$fixture_source_ref\`"
                upgrade_manifest_ref_line "$repo_root" "$fixture_source_ref" "$target_commit"
                echo ""
            done
        else
            echo "- none"
        fi
        echo ""
        echo "## Active Extended Fixture Registry"
        echo ""
        while read -r fixture port_offset; do
            fixture_source_ref="$(upgrade_extended_fixture_source_ref "$fixture" "$extended_source_ref")"
            echo "- $fixture: port offset $port_offset; source ref $fixture_source_ref"
        done < <(upgrade_active_extended_fixture_records)
    } > "$manifest"
}
