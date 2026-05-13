#!/usr/bin/env bash
set -euo pipefail

workflow_path='.github/workflows/install-test.yml'

emit_unknown() {
  echo unknown
}

usage() {
  cat >&2 <<'EOF'
Usage: classify-install-workflow-diff.sh BASE_SHA HEAD_SHA

Classifies install-test.yml-only content diffs as:
  static      only YAML comments or blank lines changed outside block scalars
  behavioral  executable or workflow behavior changed
  unknown     unsupported or ambiguous diff; caller should fail closed
EOF
}

line_in_block_scalar() {
  local commit_sha="$1"
  local line_number="$2"

  if ! [[ "$line_number" =~ ^[1-9][0-9]*$ ]]; then
    return 1
  fi

  git show "${commit_sha}:${workflow_path}" 2>/dev/null | awk -v target="$line_number" '
    function indent_width(value) {
      match(value, /^[ \t]*/)
      return RLENGTH
    }

    function is_blank(value) {
      return value ~ /^[ \t]*$/
    }

    function is_block_start(value) {
      return value ~ /^[ \t]*[^#].*:[ \t]*[|>][-+0-9]*([ \t]+#.*)?$/
    }

    {
      if (in_block && !is_blank($0) && indent_width($0) <= block_indent) {
        in_block = 0
      }

      if (NR == target) {
        print in_block ? "true" : "false"
        found = 1
        exit
      }

      if (!in_block && is_block_start($0)) {
        in_block = 1
        block_indent = indent_width($0)
      }
    }

    END {
      if (!found) {
        print "unknown"
      }
    }
  '
}

is_static_changed_line() {
  local commit_sha="$1"
  local line_number="$2"
  local content="$3"
  local in_block

  [[ "$content" =~ ^[[:space:]]*(#.*)?$ ]] || return 1

  in_block="$(line_in_block_scalar "$commit_sha" "$line_number")" || return 1
  [ "$in_block" = false ]
}

classify_diff_lines() {
  local base_sha="$1"
  local head_sha="$2"
  local old_line=0
  local new_line=0
  local changed=false
  local line prefix content

  while IFS= read -r line; do
    case "$line" in
      'diff --git '*|'index '*|'--- '*|'+++ '*)
        continue
        ;;
    esac

    if [[ "$line" =~ ^@@[[:space:]]-([0-9]+)(,([0-9]+))?[[:space:]]\+([0-9]+)(,([0-9]+))?[[:space:]]@@ ]]; then
      old_line="${BASH_REMATCH[1]}"
      new_line="${BASH_REMATCH[4]}"
      continue
    fi

    prefix="${line:0:1}"
    content="${line:1}"

    case "$prefix" in
      ' ')
        old_line=$((old_line + 1))
        new_line=$((new_line + 1))
        ;;
      '+')
        changed=true
        if ! is_static_changed_line "$head_sha" "$new_line" "$content"; then
          echo behavioral
          return 0
        fi
        new_line=$((new_line + 1))
        ;;
      '-')
        changed=true
        if ! is_static_changed_line "$base_sha" "$old_line" "$content"; then
          echo behavioral
          return 0
        fi
        old_line=$((old_line + 1))
        ;;
    esac
  done

  if [ "$changed" = true ]; then
    echo static
  else
    emit_unknown
  fi
}

main() {
  if [ "$#" -ne 2 ]; then
    usage
    emit_unknown
    return 0
  fi

  local base_sha="$1"
  local head_sha="$2"
  local name_status
  local numstat
  local diff_output

  if ! git rev-parse --verify "${base_sha}^{commit}" >/dev/null 2>&1 ||
     ! git rev-parse --verify "${head_sha}^{commit}" >/dev/null 2>&1; then
    emit_unknown
    return 0
  fi

  name_status="$(git diff --name-status --no-ext-diff "$base_sha" "$head_sha" -- "$workflow_path" 2>/dev/null || true)"
  if [ "$(printf '%s\n' "$name_status" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')" != "1" ]; then
    emit_unknown
    return 0
  fi
  case "$name_status" in
    M$'\t'"$workflow_path") ;;
    *)
      emit_unknown
      return 0
      ;;
  esac

  numstat="$(git diff --numstat --no-ext-diff "$base_sha" "$head_sha" -- "$workflow_path" 2>/dev/null || true)"
  case "$numstat" in
    '-'$'\t'-$'\t'*) emit_unknown; return 0 ;;
  esac

  diff_output="$(git diff --unified=0 --no-ext-diff "$base_sha" "$head_sha" -- "$workflow_path" 2>/dev/null || true)"
  if [ -z "$diff_output" ]; then
    emit_unknown
    return 0
  fi

  classify_diff_lines "$base_sha" "$head_sha" <<< "$diff_output"
}

main "$@"
