#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTEXT_SCRIPT="$ROOT_DIR/scripts/ci/provider-context.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local what="$1"
  local expected="$2"
  local actual="$3"
  [ "$actual" = "$expected" ] || fail "$what: expected '$expected', got '$actual'"
}

# Run a snippet in a fresh subshell where every override and provider env is
# unset, so we can drive each test from a clean slate.
fresh_eval() {
  env -i \
    HOME="${HOME:-}" \
    PATH="${PATH:-}" \
    bash -c "set -euo pipefail; source '$CONTEXT_SCRIPT'; $1"
}

main() {
  # ---- ci_provider sniffing -------------------------------------------------
  assert_eq "default provider with no env" "local" "$(fresh_eval 'ci_provider')"
  assert_eq "CI=true alone" "unknown-ci" "$(fresh_eval 'export CI=true; ci_provider')"
  assert_eq "GITHUB_ACTIONS=true" "github" "$(fresh_eval 'export GITHUB_ACTIONS=true; ci_provider')"
  assert_eq "FORGEJO_ACTIONS=true" "forgejo" "$(fresh_eval 'export FORGEJO_ACTIONS=true; ci_provider')"
  assert_eq "FORGEJO_SERVER_URL alone" "forgejo" \
    "$(fresh_eval 'export FORGEJO_SERVER_URL=https://example; ci_provider')"
  # Forgejo's GitHub-compat shim sets both vars; we must report forgejo.
  assert_eq "forgejo wins over github when both set" "forgejo" \
    "$(fresh_eval 'export GITHUB_ACTIONS=true; export FORGEJO_ACTIONS=true; ci_provider')"
  assert_eq "explicit override wins" "custom-ci" \
    "$(fresh_eval 'export GITHUB_ACTIONS=true; export SANCTUARY_CI_PROVIDER_OVERRIDE=custom-ci; ci_provider')"

  # ---- ci_event_name --------------------------------------------------------
  assert_eq "no event" "" "$(fresh_eval 'ci_event_name')"
  assert_eq "EVENT_NAME wins" "push" "$(fresh_eval 'export EVENT_NAME=push; ci_event_name')"
  assert_eq "GITHUB_EVENT_NAME fallback" "pull_request" \
    "$(fresh_eval 'export GITHUB_EVENT_NAME=pull_request; ci_event_name')"
  assert_eq "EVENT_NAME wins over GITHUB_EVENT_NAME" "merge_group" \
    "$(fresh_eval 'export EVENT_NAME=merge_group; export GITHUB_EVENT_NAME=push; ci_event_name')"
  assert_eq "event override wins" "schedule" \
    "$(fresh_eval 'export EVENT_NAME=push; export SANCTUARY_CI_EVENT_NAME_OVERRIDE=schedule; ci_event_name')"

  # ---- ci_event_base_sha and ci_event_head_sha ------------------------------
  assert_eq "pull_request base" "abc123" "$(fresh_eval '
    export EVENT_NAME=pull_request
    export PR_BASE_SHA=abc123
    ci_event_base_sha
  ')"
  assert_eq "pull_request head" "def456" "$(fresh_eval '
    export EVENT_NAME=pull_request
    export PR_HEAD_SHA=def456
    ci_event_head_sha
  ')"
  assert_eq "pull_request head falls back to WORKFLOW_SHA" "wf-sha" "$(fresh_eval '
    export EVENT_NAME=pull_request
    export WORKFLOW_SHA=wf-sha
    ci_event_head_sha
  ')"
  assert_eq "merge_group base" "mg-base" "$(fresh_eval '
    export EVENT_NAME=merge_group
    export MERGE_GROUP_BASE_SHA=mg-base
    ci_event_base_sha
  ')"
  assert_eq "merge_group head" "mg-head" "$(fresh_eval '
    export EVENT_NAME=merge_group
    export MERGE_GROUP_HEAD_SHA=mg-head
    ci_event_head_sha
  ')"
  assert_eq "push base" "push-before" "$(fresh_eval '
    export EVENT_NAME=push
    export PUSH_BEFORE_SHA=push-before
    ci_event_base_sha
  ')"
  assert_eq "push head from WORKFLOW_SHA" "push-head" "$(fresh_eval '
    export EVENT_NAME=push
    export WORKFLOW_SHA=push-head
    ci_event_head_sha
  ')"
  assert_eq "head falls through to GITHUB_SHA" "gh-sha" "$(fresh_eval '
    export EVENT_NAME=push
    export GITHUB_SHA=gh-sha
    ci_event_head_sha
  ')"
  assert_eq "head HEAD when nothing set" "HEAD" \
    "$(fresh_eval 'export EVENT_NAME=push; ci_event_head_sha')"
  assert_eq "schedule has no base" "" \
    "$(fresh_eval 'export EVENT_NAME=schedule; ci_event_base_sha')"
  assert_eq "base override wins" "override-base" "$(fresh_eval '
    export EVENT_NAME=pull_request
    export PR_BASE_SHA=ignored
    export SANCTUARY_CI_BASE_SHA_OVERRIDE=override-base
    ci_event_base_sha
  ')"

  # ---- ci_event_pr_number ---------------------------------------------------
  assert_eq "PR number" "42" "$(fresh_eval 'export PR_NUMBER=42; ci_event_pr_number')"
  assert_eq "PR number override" "99" \
    "$(fresh_eval 'export PR_NUMBER=42; export SANCTUARY_CI_PR_NUMBER_OVERRIDE=99; ci_event_pr_number')"

  # ---- ci_workspace ---------------------------------------------------------
  local workspace_dir
  workspace_dir="$(mktemp -d)"
  trap 'rm -rf "'"$workspace_dir"'"' EXIT
  assert_eq "GITHUB_WORKSPACE wins" "$workspace_dir" \
    "$(fresh_eval "export GITHUB_WORKSPACE='$workspace_dir'; ci_workspace")"
  assert_eq "workspace override wins" "/somewhere/else" \
    "$(fresh_eval "export GITHUB_WORKSPACE='$workspace_dir'; export SANCTUARY_CI_WORKSPACE_OVERRIDE=/somewhere/else; ci_workspace")"

  # ---- ci_run_id ------------------------------------------------------------
  assert_eq "GITHUB_RUN_ID wins" "1234" \
    "$(fresh_eval 'export GITHUB_RUN_ID=1234; ci_run_id')"
  assert_eq "GITHUB_RUN_NUMBER fallback" "57" \
    "$(fresh_eval 'export GITHUB_RUN_NUMBER=57; ci_run_id')"
  assert_eq "run id override wins" "manual-run-id" \
    "$(fresh_eval 'export GITHUB_RUN_ID=ignored; export SANCTUARY_CI_RUN_ID_OVERRIDE=manual-run-id; ci_run_id')"
  # Local fallback should at least produce a non-empty value.
  local local_run_id
  local_run_id="$(fresh_eval 'ci_run_id')"
  [ -n "$local_run_id" ] || fail "local ci_run_id was empty"

  # ---- ci_run_attempt -------------------------------------------------------
  assert_eq "GITHUB_RUN_ATTEMPT wins" "3" \
    "$(fresh_eval 'export GITHUB_RUN_ATTEMPT=3; ci_run_attempt')"
  assert_eq "run attempt override wins" "7" \
    "$(fresh_eval 'export GITHUB_RUN_ATTEMPT=3; export SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE=7; ci_run_attempt')"
  assert_eq "run attempt defaults to one" "1" "$(fresh_eval 'ci_run_attempt')"

  # ---- ci_temp_dir ----------------------------------------------------------
  assert_eq "RUNNER_TEMP wins" "/runner/tmp" \
    "$(fresh_eval 'export RUNNER_TEMP=/runner/tmp; ci_temp_dir')"
  assert_eq "TMPDIR fallback" "/scratch" \
    "$(fresh_eval 'export TMPDIR=/scratch; ci_temp_dir')"
  assert_eq "temp dir override wins" "/test-tmp" \
    "$(fresh_eval 'export RUNNER_TEMP=ignored; export SANCTUARY_CI_TEMP_DIR_OVERRIDE=/test-tmp; ci_temp_dir')"
  assert_eq "default temp dir is /tmp" "/tmp" "$(fresh_eval 'ci_temp_dir')"
  if fresh_eval 'ci_temp_is_ephemeral'; then
    fail "local default temp must not be treated as durable ownership storage"
  fi
  fresh_eval 'export RUNNER_TEMP=/runner/tmp; ci_temp_is_ephemeral' || \
    fail "runner temp should be treated as ephemeral CI storage"
  fresh_eval 'export SANCTUARY_CI_TEMP_DIR_OVERRIDE=/test-tmp; ci_temp_is_ephemeral' || \
    fail "explicit CI temp should be treated as ephemeral CI storage"

  # ---- ci_output_file -------------------------------------------------------
  assert_eq "GITHUB_OUTPUT wins" "/gh/output" \
    "$(fresh_eval 'export GITHUB_OUTPUT=/gh/output; ci_output_file')"
  assert_eq "FORGEJO_OUTPUT fallback" "/fj/output" \
    "$(fresh_eval 'export FORGEJO_OUTPUT=/fj/output; ci_output_file')"
  assert_eq "output override wins" "/test/output" \
    "$(fresh_eval 'export GITHUB_OUTPUT=ignored; export SANCTUARY_CI_OUTPUT_FILE=/test/output; ci_output_file')"
  assert_eq "output default is stdout" "/dev/stdout" "$(fresh_eval 'ci_output_file')"

  # ---- ci_env_file ----------------------------------------------------------
  assert_eq "GITHUB_ENV wins" "/gh/env" "$(fresh_eval 'export GITHUB_ENV=/gh/env; ci_env_file')"
  assert_eq "FORGEJO_ENV fallback" "/fj/env" \
    "$(fresh_eval 'export FORGEJO_ENV=/fj/env; ci_env_file')"
  assert_eq "env override wins" "/test/env" \
    "$(fresh_eval 'export GITHUB_ENV=ignored; export SANCTUARY_CI_ENV_FILE=/test/env; ci_env_file')"
  assert_eq "env default is stdout" "/dev/stdout" "$(fresh_eval 'ci_env_file')"

  # ---- ci_step_summary_file -------------------------------------------------
  assert_eq "GITHUB_STEP_SUMMARY wins" "/gh/summary" \
    "$(fresh_eval 'export GITHUB_STEP_SUMMARY=/gh/summary; ci_step_summary_file')"
  assert_eq "FORGEJO_STEP_SUMMARY fallback" "/fj/summary" \
    "$(fresh_eval 'export FORGEJO_STEP_SUMMARY=/fj/summary; ci_step_summary_file')"
  assert_eq "summary override wins" "/test/summary" \
    "$(fresh_eval 'export GITHUB_STEP_SUMMARY=ignored; export SANCTUARY_CI_STEP_SUMMARY_FILE=/test/summary; ci_step_summary_file')"
  assert_eq "summary default is stderr" "/dev/stderr" "$(fresh_eval 'ci_step_summary_file')"

  # ---- ci_emit_output (args and stdin) --------------------------------------
  local out_file
  out_file="$(mktemp)"
  fresh_eval "export SANCTUARY_CI_OUTPUT_FILE='$out_file'; ci_emit_output 'foo=1' 'bar=2'"
  local first_line
  first_line="$(sed -n '1p' "$out_file")"
  assert_eq "emit_output line 1" "foo=1" "$first_line"
  local second_line
  second_line="$(sed -n '2p' "$out_file")"
  assert_eq "emit_output line 2" "bar=2" "$second_line"

  : > "$out_file"
  printf 'baz=3\nqux=4\n' | fresh_eval "export SANCTUARY_CI_OUTPUT_FILE='$out_file'; ci_emit_output"
  assert_eq "emit_output stdin line 1" "baz=3" "$(sed -n '1p' "$out_file")"
  assert_eq "emit_output stdin line 2" "qux=4" "$(sed -n '2p' "$out_file")"
  rm -f "$out_file"

  # ---- ci_emit_env ----------------------------------------------------------
  local env_file
  env_file="$(mktemp)"
  fresh_eval "export SANCTUARY_CI_ENV_FILE='$env_file'; ci_emit_env 'KEY=value'"
  assert_eq "emit_env line" "KEY=value" "$(sed -n '1p' "$env_file")"
  rm -f "$env_file"

  # ---- ci_emit_summary ------------------------------------------------------
  local sum_file
  sum_file="$(mktemp)"
  fresh_eval "export SANCTUARY_CI_STEP_SUMMARY_FILE='$sum_file'; ci_emit_summary '## hello'"
  assert_eq "emit_summary line" "## hello" "$(sed -n '1p' "$sum_file")"
  rm -f "$sum_file"

  # ---- annotation helpers ---------------------------------------------------
  local out
  out="$(fresh_eval 'export GITHUB_ACTIONS=true; ci_emit_warning "hot"')"
  assert_eq "warning on github" "::warning::hot" "$out"
  out="$(fresh_eval 'export FORGEJO_ACTIONS=true; ci_emit_notice "fyi"')"
  assert_eq "notice on forgejo" "::notice::fyi" "$out"
  out="$(fresh_eval 'export GITHUB_ACTIONS=true; ci_emit_error "boom"')"
  assert_eq "error on github" "::error::boom" "$out"
  # Local provider sends to stderr, not stdout.
  out="$(fresh_eval 'ci_emit_warning "softly" 2>&1 1>/dev/null')"
  assert_eq "warning on local goes to stderr" "warning: softly" "$out"

  # ---- idempotent sourcing --------------------------------------------------
  out="$(fresh_eval '
    source "'"$CONTEXT_SCRIPT"'"
    source "'"$CONTEXT_SCRIPT"'"
    ci_provider
  ')"
  assert_eq "double-source is safe" "local" "$out"

  echo "provider-context regression checks passed"
}

main "$@"
