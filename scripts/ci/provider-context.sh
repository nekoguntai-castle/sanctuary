#!/usr/bin/env bash
# Provider-agnostic CI context. Source this from helper scripts; do not exec.
#
# Provides shell functions that resolve "what CI am I in" and "where do I emit
# outputs/env/summary" so individual helpers do not hard-code GitHub Actions
# specifics. Each function falls through GitHub-style envs first (so existing
# fixtures and Forgejo's GHA-compat shims keep working), then provider-neutral
# overrides, then sensible local-shell defaults.
#
# Override points (read by every function, take precedence over provider envs):
#   SANCTUARY_CI_PROVIDER_OVERRIDE  — pin provider name regardless of detection
#   SANCTUARY_CI_OUTPUT_FILE        — path appended by ci_emit_output
#   SANCTUARY_CI_ENV_FILE           — path appended by ci_emit_env
#   SANCTUARY_CI_STEP_SUMMARY_FILE  — path appended by ci_emit_summary
#   SANCTUARY_CI_WORKSPACE_OVERRIDE — workspace root override
#   SANCTUARY_CI_RUN_ID_OVERRIDE    — run-id override (used for port allocation)
#   SANCTUARY_CI_TEMP_DIR_OVERRIDE  — temp dir override
#   SANCTUARY_CI_EVENT_NAME_OVERRIDE, SANCTUARY_CI_BASE_SHA_OVERRIDE,
#   SANCTUARY_CI_HEAD_SHA_OVERRIDE, SANCTUARY_CI_PR_NUMBER_OVERRIDE
#                                   — event envelope overrides

if [ "${SANCTUARY_CI_PROVIDER_CONTEXT_LOADED:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi
SANCTUARY_CI_PROVIDER_CONTEXT_LOADED=1

ci_provider() {
  if [ -n "${SANCTUARY_CI_PROVIDER_OVERRIDE:-}" ]; then
    printf '%s' "$SANCTUARY_CI_PROVIDER_OVERRIDE"
    return 0
  fi
  if [ "${FORGEJO_ACTIONS:-}" = "true" ] || [ -n "${FORGEJO_SERVER_URL:-}" ]; then
    printf '%s' "forgejo"
    return 0
  fi
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    printf '%s' "github"
    return 0
  fi
  if [ "${CI:-}" = "true" ]; then
    printf '%s' "unknown-ci"
    return 0
  fi
  printf '%s' "local"
}

# Destructive authority must never consume the test/display overrides above.
# These helpers expose only provider-owned runtime identity, keeping raw
# provider variables confined to this adapter without permitting downgrade.
ci_authority_provider() {
  if [ "${FORGEJO_ACTIONS:-}" = "true" ] || [ -n "${FORGEJO_SERVER_URL:-}" ]; then
    printf '%s' "forgejo"
  elif [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    printf '%s' "github"
  elif [ "${CI:-}" = "true" ]; then
    printf '%s' "unknown-ci"
  else
    printf '%s' "local"
  fi
}

ci_authority_run_id() { printf '%s' "${GITHUB_RUN_ID:-}"; }
ci_authority_run_attempt() { printf '%s' "${GITHUB_RUN_ATTEMPT:-}"; }
ci_authority_temp_dir() { printf '%s' "${RUNNER_TEMP:-}"; }

ci_event_name() {
  if [ -n "${SANCTUARY_CI_EVENT_NAME_OVERRIDE:-}" ]; then
    printf '%s' "$SANCTUARY_CI_EVENT_NAME_OVERRIDE"
    return 0
  fi
  printf '%s' "${EVENT_NAME:-${GITHUB_EVENT_NAME:-}}"
}

ci_event_base_sha() {
  if [ -n "${SANCTUARY_CI_BASE_SHA_OVERRIDE:-}" ]; then
    printf '%s' "$SANCTUARY_CI_BASE_SHA_OVERRIDE"
    return 0
  fi
  case "$(ci_event_name)" in
    pull_request) printf '%s' "${PR_BASE_SHA:-}" ;;
    merge_group)  printf '%s' "${MERGE_GROUP_BASE_SHA:-}" ;;
    push)         printf '%s' "${PUSH_BEFORE_SHA:-}" ;;
    *)            printf '%s' "" ;;
  esac
}

ci_event_head_sha() {
  if [ -n "${SANCTUARY_CI_HEAD_SHA_OVERRIDE:-}" ]; then
    printf '%s' "$SANCTUARY_CI_HEAD_SHA_OVERRIDE"
    return 0
  fi
  local fallback="${WORKFLOW_SHA:-${GITHUB_SHA:-HEAD}}"
  case "$(ci_event_name)" in
    pull_request) printf '%s' "${PR_HEAD_SHA:-$fallback}" ;;
    merge_group)  printf '%s' "${MERGE_GROUP_HEAD_SHA:-$fallback}" ;;
    *)            printf '%s' "$fallback" ;;
  esac
}

ci_event_pr_number() {
  if [ -n "${SANCTUARY_CI_PR_NUMBER_OVERRIDE:-}" ]; then
    printf '%s' "$SANCTUARY_CI_PR_NUMBER_OVERRIDE"
    return 0
  fi
  printf '%s' "${PR_NUMBER:-}"
}

ci_workspace() {
  if [ -n "${SANCTUARY_CI_WORKSPACE_OVERRIDE:-}" ]; then
    printf '%s' "$SANCTUARY_CI_WORKSPACE_OVERRIDE"
    return 0
  fi
  if [ -n "${GITHUB_WORKSPACE:-}" ]; then
    printf '%s' "$GITHUB_WORKSPACE"
    return 0
  fi
  if git rev-parse --show-toplevel >/dev/null 2>&1; then
    git rev-parse --show-toplevel
    return 0
  fi
  pwd
}

ci_run_id() {
  if [ -n "${SANCTUARY_CI_RUN_ID_OVERRIDE:-}" ]; then
    printf '%s' "$SANCTUARY_CI_RUN_ID_OVERRIDE"
    return 0
  fi
  if [ -n "${GITHUB_RUN_ID:-}" ]; then
    printf '%s' "$GITHUB_RUN_ID"
    return 0
  fi
  if [ -n "${GITHUB_RUN_NUMBER:-}" ]; then
    printf '%s' "$GITHUB_RUN_NUMBER"
    return 0
  fi
  printf '%s-%s' "$$" "$(date +%s)"
}

ci_run_attempt() {
  if [ -n "${SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE:-}" ]; then
    printf '%s' "$SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE"
    return 0
  fi
  if [ -n "${GITHUB_RUN_ATTEMPT:-}" ]; then
    printf '%s' "$GITHUB_RUN_ATTEMPT"
    return 0
  fi
  printf '1'
}

ci_temp_dir() {
  if [ -n "${SANCTUARY_CI_TEMP_DIR_OVERRIDE:-}" ]; then
    printf '%s' "$SANCTUARY_CI_TEMP_DIR_OVERRIDE"
    return 0
  fi
  if [ -n "${RUNNER_TEMP:-}" ]; then
    printf '%s' "$RUNNER_TEMP"
    return 0
  fi
  printf '%s' "${TMPDIR:-/tmp}"
}

ci_temp_is_ephemeral() {
  if [ -n "${SANCTUARY_CI_TEMP_DIR_OVERRIDE:-}" ] || [ -n "${RUNNER_TEMP:-}" ]; then
    return 0
  fi
  [ "$(ci_provider)" != local ]
}

ci_output_file() {
  if [ -n "${SANCTUARY_CI_OUTPUT_FILE:-}" ]; then
    printf '%s' "$SANCTUARY_CI_OUTPUT_FILE"
    return 0
  fi
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s' "$GITHUB_OUTPUT"
    return 0
  fi
  if [ -n "${FORGEJO_OUTPUT:-}" ]; then
    printf '%s' "$FORGEJO_OUTPUT"
    return 0
  fi
  printf '%s' "/dev/stdout"
}

ci_env_file() {
  if [ -n "${SANCTUARY_CI_ENV_FILE:-}" ]; then
    printf '%s' "$SANCTUARY_CI_ENV_FILE"
    return 0
  fi
  if [ -n "${GITHUB_ENV:-}" ]; then
    printf '%s' "$GITHUB_ENV"
    return 0
  fi
  if [ -n "${FORGEJO_ENV:-}" ]; then
    printf '%s' "$FORGEJO_ENV"
    return 0
  fi
  printf '%s' "/dev/stdout"
}

ci_step_summary_file() {
  if [ -n "${SANCTUARY_CI_STEP_SUMMARY_FILE:-}" ]; then
    printf '%s' "$SANCTUARY_CI_STEP_SUMMARY_FILE"
    return 0
  fi
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s' "$GITHUB_STEP_SUMMARY"
    return 0
  fi
  if [ -n "${FORGEJO_STEP_SUMMARY:-}" ]; then
    printf '%s' "$FORGEJO_STEP_SUMMARY"
    return 0
  fi
  printf '%s' "/dev/stderr"
}

# Append KEY=VALUE pairs to the output file. Each argument is one line, or
# read all lines from stdin when called with no arguments.
ci_emit_output() {
  local target
  target="$(ci_output_file)"
  if [ "$#" -eq 0 ]; then
    cat >> "$target"
  else
    printf '%s\n' "$@" >> "$target"
  fi
}

ci_emit_env() {
  local target
  target="$(ci_env_file)"
  if [ "$#" -eq 0 ]; then
    cat >> "$target"
  else
    printf '%s\n' "$@" >> "$target"
  fi
}

ci_emit_summary() {
  local target
  target="$(ci_step_summary_file)"
  if [ "$#" -eq 0 ]; then
    cat >> "$target"
  else
    printf '%s\n' "$@" >> "$target"
  fi
}

# Annotation helpers. On github/forgejo (and unknown CI), emit GHA-style
# `::warning::`/`::notice::`/`::error::` markers; locally, emit prefixed lines
# on stderr.
_ci_annotation_supported() {
  case "$(ci_provider)" in
    github|forgejo|unknown-ci) return 0 ;;
    *) return 1 ;;
  esac
}

ci_emit_warning() {
  if _ci_annotation_supported; then
    printf '::warning::%s\n' "$*"
  else
    printf 'warning: %s\n' "$*" >&2
  fi
}

ci_emit_notice() {
  if _ci_annotation_supported; then
    printf '::notice::%s\n' "$*"
  else
    printf 'notice: %s\n' "$*" >&2
  fi
}

ci_emit_error() {
  if _ci_annotation_supported; then
    printf '::error::%s\n' "$*"
  else
    printf 'error: %s\n' "$*" >&2
  fi
}
