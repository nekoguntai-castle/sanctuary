#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TIME_COMMAND="$ROOT_DIR/scripts/ci/time-command.sh"
RECORDER="$ROOT_DIR/scripts/ci/record-command-timing.mjs"
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

TEST_TEMP_DIR="$(mktemp -d)"
trap cleanup EXIT

budget_file="$TEST_TEMP_DIR/budgets.json"
timing_file="$TEST_TEMP_DIR/timings.jsonl"
cp "$ROOT_DIR/.github/ci-performance-budget.json" "$budget_file"

node -e '
  const fs = require("node:fs");
  const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const rolloutLabels = [
    "backend unit coverage shard 1",
    "backend unit coverage shard 2",
    "critical mutation shard 1",
    "critical mutation shard 2",
    "critical mutation shard 3",
    "frontend coverage shard 1/2",
    "frontend coverage shard 2/2",
    "frontend coverage merge",
    "frontend coverage npm ci",
    "fresh install e2e",
    "install script e2e",
    "render regression E2E",
    "upgrade baseline latest-stable baseline",
    "upgrade baseline n-2 baseline",
  ];
  for (const label of rolloutLabels) {
    const budget = config.budgets[label];
    if (!budget) throw new Error(`missing rollout budget: ${label}`);
    if (!(budget.warnSeconds < budget.hardSeconds)) {
      throw new Error(`rollout budget is not warning-first: ${label}`);
    }
    if (budget.hardSeconds !== 86400) {
      throw new Error(`rollout hard ceiling can preempt its owning job: ${label}`);
    }
  }
' "$budget_file" || fail 'shipped warning-first timing budgets are incomplete'

SANCTUARY_CI_PERFORMANCE_BUDGET_FILE="$budget_file" \
  SANCTUARY_CI_TIMING_FILE="$timing_file" \
  "$TIME_COMMAND" "unbudgeted smoke" true >/dev/null

node -e '
  const fs = require("node:fs");
  const records = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
  if (records.length !== 1 || records[0].label !== "unbudgeted smoke") process.exit(1);
  if (records[0].budgetLevel !== "unbudgeted" || records[0].exitCode !== 0) process.exit(1);
' "$timing_file" || fail 'expected a valid unbudgeted timing record'

hard_budget="$TEST_TEMP_DIR/hard-budget.json"
node -e '
  const fs = require("node:fs");
  const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  config.budgets["hard budget smoke"] = { warnSeconds: 0, hardSeconds: 0 };
  fs.writeFileSync(process.argv[2], JSON.stringify(config));
' "$budget_file" "$hard_budget"

set +e
SANCTUARY_CI_PERFORMANCE_BUDGET_FILE="$hard_budget" \
  SANCTUARY_CI_TIMING_FILE="$timing_file" \
  "$TIME_COMMAND" "hard budget smoke" sleep 1 >"$TEST_TEMP_DIR/hard-output" 2>&1
hard_status="$?"
set -e
[ "$hard_status" -eq 2 ] || fail "expected hard budget exit 2, got $hard_status"
grep -Fq 'hard budget is 0s' "$TEST_TEMP_DIR/hard-output" || fail 'missing hard budget diagnostic'

warning_budget="$TEST_TEMP_DIR/warning-budget.json"
node -e '
  const fs = require("node:fs");
  const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  config.budgets["warning budget smoke"] = { warnSeconds: 0, hardSeconds: 10 };
  fs.writeFileSync(process.argv[2], JSON.stringify(config));
' "$budget_file" "$warning_budget"
SANCTUARY_CI_PERFORMANCE_BUDGET_FILE="$warning_budget" \
  SANCTUARY_CI_TIMING_FILE="$timing_file" \
  "$TIME_COMMAND" "warning budget smoke" sleep 1 >"$TEST_TEMP_DIR/warning-output" 2>&1
grep -Fq 'warning budget is 0s' "$TEST_TEMP_DIR/warning-output" || fail 'missing warning budget diagnostic'

invalid_budget="$TEST_TEMP_DIR/invalid-budget.json"
printf '{"schemaVersion":1,"budgets":{"invalid":{"warnSeconds":2,"hardSeconds":1}}}\n' > "$invalid_budget"
set +e
node "$RECORDER" - "$invalid_budget" invalid 0 0 0 0 >/dev/null 2>&1
invalid_status="$?"
set -e
[ "$invalid_status" -eq 1 ] || fail "expected invalid budget exit 1, got $invalid_status"

set +e
SANCTUARY_CI_PERFORMANCE_BUDGET_FILE="$hard_budget" \
  SANCTUARY_CI_TIMING_FILE="$timing_file" \
  "$TIME_COMMAND" "hard budget smoke" bash -c 'sleep 1; exit 7' >/dev/null 2>&1
command_status="$?"
set -e
[ "$command_status" -eq 7 ] || fail "expected command exit 7 to take precedence, got $command_status"

node --check "$RECORDER"
echo 'time-command machine-readable budget checks passed'
