#!/usr/bin/env bash
# Provider-portability gate. Fails if a script or workflow file references a
# GitHub-Actions-specific env var or action URL outside the designated
# abstraction layer. Run on every PR via the ci-classifier-tests gate.
#
# Allowed callsites for raw provider references:
#   * scripts/ci/provider-context.sh / provider-context.mjs (the adapter)
#   * .github/actions/**/action.yml      (composite action integration layer)
#   * .github/workflows/**/*.yml         (workflow YAML naturally references
#                                         ${{ github.* }} expressions)
#   * tests/ci/**/*.test.{sh,mjs}        (tests drive scripts by exporting
#                                         provider envs as fixtures)
#
# Anything else triggers a failure. Add a SANCTUARY_LEAK_ALLOW_FILE override
# pointing at a file with one path per line if a one-off exemption is needed
# (the file is checked into git so the exemption is reviewed).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$ROOT_DIR"

# Patterns that are ONLY allowed in the adapter, composite actions, workflows,
# and CI-test fixtures. Anywhere else they're a leak.
LEAK_PATTERNS=(
  'GITHUB_ENV'
  'GITHUB_OUTPUT'
  'GITHUB_RUN_ID'
  'GITHUB_RUN_NUMBER'
  'GITHUB_WORKSPACE'
  'GITHUB_ACTIONS'
  'GITHUB_EVENT_NAME'
  'GITHUB_STEP_SUMMARY'
  'RUNNER_TEMP'
)

# Forgejo-only artifact action URLs must go through the upload-artifact /
# download-artifact composite, never inline in a workflow.
URL_PATTERNS=(
  'https://data.forgejo.org/forgejo/upload-artifact'
  'https://data.forgejo.org/forgejo/download-artifact'
)

allow_file_path() {
  local p="$1"
  case "$p" in
    # The adapter itself
    scripts/ci/provider-context.sh|scripts/ci/provider-context.mjs)
      return 0 ;;
    # Composite actions are the integration boundary
    .github/actions/*/action.yml)
      return 0 ;;
    # The reviewed Forgejo artifact actions are vendored local JavaScript
    # actions. Their generated bundles legitimately consume the provider
    # action environment at this same integration boundary.
    .github/actions/vendor/forgejo-artifact-v4/*)
      return 0 ;;
    # The isolated-workspace bridge intentionally re-exports GITHUB_WORKSPACE
    # so downstream Sanctuary scripts and any external composite actions see
    # the per-job clone path. That export IS the abstraction boundary.
    scripts/ci/run-in-isolated-workspace.sh)
      return 0 ;;
    # CI helper tests legitimately export GITHUB_* envs as fixtures
    tests/ci/*.test.sh|tests/ci/*.test.mjs)
      return 0 ;;
    # Documentation discusses these names; not load-bearing
    *.md|*.mdx)
      return 0 ;;
    # The action-runtime guard knows the URL strings by design (it validates
    # them against a hardcoded list)
    scripts/ci/check-github-action-runtimes.mjs)
      return 0 ;;
    # The leak gate itself encodes the pattern strings it searches for
    scripts/ci/check-provider-leaks.sh)
      return 0 ;;
    scripts/ci/vendor/forgejo-artifact-v4/*)
      return 0 ;;
    # Install-test subsystem has its own classify-install-scope contract and
    # workspace-detection helpers; carved out from this gate. (See
    # tests/install/utils/classify-install-scope.sh.)
    tests/install/*)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

allow_workflow_url() {
  local p="$1"
  case "$p" in
    .github/actions/upload-artifact/action.yml|.github/actions/download-artifact/action.yml)
      return 0 ;;
    .github/actions/vendor/forgejo-artifact-v4/*)
      return 0 ;;
    scripts/ci/check-github-action-runtimes.mjs|tests/ci/check-github-action-runtimes.test.mjs)
      return 0 ;;
    scripts/ci/check-provider-leaks.sh)
      return 0 ;;
    scripts/ci/vendor/forgejo-artifact-v4/*)
      return 0 ;;
    *.md|*.mdx)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

# Skip lines that are pure comments — the leak gate is about runtime reads,
# not docstring mentions.
is_comment_line() {
  local content="$1"
  # Trim leading whitespace, then check first non-whitespace char.
  local trimmed="${content#"${content%%[![:space:]]*}"}"
  case "$trimmed" in
    \#*|//*|\**) return 0 ;;
  esac
  return 1
}

# Skip lines that gate on whether a provider env is set, rather than reading
# its value. `if [ -n "${X:-}" ]`, `${X:+default}`, etc. are feature-detection
# checks and are part of the abstraction layer's contract.
is_detection_line() {
  local content="$1"
  case "$content" in
    *'[ -n "${'*':-}"'*) return 0 ;;
    *'[ -z "${'*':-}"'*) return 0 ;;
    *'${'*':+'*) return 0 ;;
    *'[[ -n "${'*':-}"'*) return 0 ;;
    *'[[ -z "${'*':-}"'*) return 0 ;;
  esac
  return 1
}

custom_allowlist=()
if [ -n "${SANCTUARY_LEAK_ALLOW_FILE:-}" ] && [ -f "${SANCTUARY_LEAK_ALLOW_FILE}" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in '#'*) continue ;; esac
    custom_allowlist+=("$line")
  done < "$SANCTUARY_LEAK_ALLOW_FILE"
fi
allow_custom() {
  local p="$1"
  local entry
  for entry in "${custom_allowlist[@]:-}"; do
    [ "$p" = "$entry" ] && return 0
  done
  return 1
}

leaks=()

scan_env_leaks() {
  local pattern
  for pattern in "${LEAK_PATTERNS[@]}"; do
    # `git grep` walks the index directly, so no xargs portability concerns
    # and no FS traversal; -I skips binaries; the regex anchors on word
    # boundaries so a substring match doesn't trip the gate.
    while IFS=: read -r file lineno match; do
      [ -n "$file" ] || continue
      case "$file" in
        .github/workflows/*) continue ;;
      esac
      if allow_file_path "$file"; then continue; fi
      if allow_custom "$file"; then continue; fi
      if is_comment_line "$match"; then continue; fi
      if is_detection_line "$match"; then continue; fi
      leaks+=("$file:$lineno: $pattern leaked: $match")
    done < <(git grep -nIE "\\b${pattern}\\b" -- ':!*.lock' 2>/dev/null || true)
  done
}

scan_workflow_url_leaks() {
  local pattern
  for pattern in "${URL_PATTERNS[@]}"; do
    while IFS=: read -r file lineno match; do
      [ -n "$file" ] || continue
      if allow_workflow_url "$file"; then continue; fi
      if allow_custom "$file"; then continue; fi
      leaks+=("$file:$lineno: forgejo artifact URL leaked: $match")
    done < <(git grep -nIF "$pattern" -- ':!*.lock' 2>/dev/null || true)
  done
}

scan_env_leaks
scan_workflow_url_leaks

if [ "${#leaks[@]}" -eq 0 ]; then
  echo "check-provider-leaks: no provider-leak references found outside the adapter"
  exit 0
fi

printf 'check-provider-leaks: %d leak(s) found:\n' "${#leaks[@]}" >&2
for entry in "${leaks[@]}"; do
  printf '  %s\n' "$entry" >&2
done
exit 1
