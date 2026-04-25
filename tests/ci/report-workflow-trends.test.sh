#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TREND_SCRIPT="$ROOT_DIR/scripts/ci/report-workflow-trends.sh"
TEST_TEMP_DIR=''

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TEST_TEMP_DIR" ]; then
    rm -rf "$TEST_TEMP_DIR"
  fi
}

assert_contains() {
  local file="$1"
  local expected="$2"

  grep -Fq -- "$expected" "$file" || fail "expected output to contain: $expected"
}

assert_fails_with() {
  local expected="$1"
  shift

  local output_file="$TEST_TEMP_DIR/failure-output"
  if "$@" >"$output_file" 2>&1; then
    fail "expected command to fail: $*"
  fi

  assert_contains "$output_file" "$expected"
}

write_fixture() {
  local fixture_file="$1"

  cat > "$fixture_file" <<'JSON'
{
  "runs": [
    {
      "databaseId": 101,
      "event": "merge_group",
      "conclusion": "success",
      "createdAt": "2026-04-25T00:00:00Z",
      "updatedAt": "2026-04-25T00:05:00Z",
      "jobs": [
        {
          "name": "Backend",
          "startedAt": "2026-04-25T00:00:00Z",
          "completedAt": "2026-04-25T00:02:00Z"
        },
        {
          "name": "Frontend",
          "startedAt": "2026-04-25T00:00:00Z",
          "completedAt": "2026-04-25T00:03:00Z"
        }
      ]
    },
    {
      "databaseId": 102,
      "event": "merge_group",
      "conclusion": "success",
      "createdAt": "2026-04-25T01:00:00Z",
      "updatedAt": "2026-04-25T01:08:00Z",
      "jobs": [
        {
          "name": "Backend",
          "startedAt": "2026-04-25T01:00:00Z",
          "completedAt": "2026-04-25T01:03:20Z"
        },
        {
          "name": "Frontend",
          "startedAt": "2026-04-25T01:00:00Z",
          "completedAt": "2026-04-25T01:04:40Z"
        }
      ]
    },
    {
      "databaseId": 103,
      "event": "merge_group",
      "conclusion": "success",
      "createdAt": "2026-04-25T02:00:00Z",
      "updatedAt": "2026-04-25T02:10:00Z",
      "jobs": [
        {
          "name": "Browser E2E",
          "startedAt": "2026-04-25T02:00:00Z",
          "completedAt": "2026-04-25T02:06:40Z"
        },
        {
          "name": "Render E2E",
          "startedAt": "2026-04-25T02:00:00Z",
          "completedAt": "2026-04-25T02:03:20Z"
        }
      ]
    },
    {
      "databaseId": 104,
      "event": "pull_request",
      "conclusion": "success",
      "createdAt": "2026-04-25T03:00:00Z",
      "updatedAt": "2026-04-25T03:02:00Z",
      "jobs": [
        {
          "name": "PR Required Checks",
          "startedAt": "2026-04-25T03:00:00Z",
          "completedAt": "2026-04-25T03:02:00Z"
        }
      ]
    },
    {
      "databaseId": 105,
      "event": "merge_group",
      "conclusion": "failure",
      "createdAt": "2026-04-25T04:00:00Z",
      "updatedAt": "2026-04-25T04:30:00Z",
      "jobs": [
        {
          "name": "Failed Job",
          "startedAt": "2026-04-25T04:00:00Z",
          "completedAt": "2026-04-25T04:30:00Z"
        }
      ]
    }
  ]
}
JSON
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  local fixture_file output_file
  fixture_file="$TEST_TEMP_DIR/runs.json"
  output_file="$TEST_TEMP_DIR/output"
  write_fixture "$fixture_file"

  bash -n "$TREND_SCRIPT"

  assert_fails_with '--workflow is required unless --runs-json is used' bash "$TREND_SCRIPT"
  assert_fails_with '--limit must be a positive integer' bash "$TREND_SCRIPT" --runs-json "$fixture_file" --limit 0
  assert_fails_with 'runs JSON file not found' bash "$TREND_SCRIPT" --runs-json "$TEST_TEMP_DIR/missing.json"

  bash "$TREND_SCRIPT" --runs-json "$fixture_file" --event merge_group > "$output_file"
  assert_contains "$output_file" 'Workflow Duration Trend'
  assert_contains "$output_file" 'Event filter | merge_group'
  assert_contains "$output_file" 'Runs | 3'
  assert_contains "$output_file" 'Wall p50 | 8m 0s'
  assert_contains "$output_file" 'Wall p90 | 10m 0s'
  assert_contains "$output_file" 'Runner p50 | 8m 0s'
  assert_contains "$output_file" 'Runner p90 | 10m 0s'
  assert_contains "$output_file" '103 | merge_group | 10m 0s | 10m 0s | Browser E2E (6m 40s)'

  bash "$TREND_SCRIPT" --runs-json "$fixture_file" --event pull_request > "$output_file"
  assert_contains "$output_file" 'Runs | 1'
  assert_contains "$output_file" 'Wall p50 | 2m 0s'
  assert_contains "$output_file" '104 | pull_request | 2m 0s | 2m 0s | PR Required Checks (2m 0s)'

  echo 'workflow trend report regression checks passed'
}

main "$@"
