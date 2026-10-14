#!/usr/bin/env bash
# Regression: scripts/quality/jscpd-only.sh must be retryable. A transient npx
# failure on attempt 1 leaves the (empty) output directory behind; the stale-
# directory guard used to refuse it, so retry-command.sh could never retry.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

TMP="$(mktemp -d)"
trap 'rm -rf "'"$TMP"'"' EXIT
mkdir -p "$TMP/bin"

make_fixture_repo() {
  local repo="$1"
  mkdir -p "$repo/scripts/quality" "$repo/scripts/ci" "$repo/config/tooling"
  cp "$REPO_ROOT/scripts/quality/jscpd-only.sh" "$repo/scripts/quality/"
  cp "$REPO_ROOT/scripts/ci/provider-context.sh" "$REPO_ROOT/scripts/ci/retry-command.sh" "$repo/scripts/ci/"
  cp "$REPO_ROOT/config/tooling/jscpd.json" "$repo/config/tooling/"
  git -C "$repo" init -q
}

# Fake npx: fails on its first call, then writes a report of the shape the
# script's summary step reads. Every call is logged.
cat > "$TMP/bin/npx" <<'FAKE'
#!/usr/bin/env bash
printf 'call\n' >> "$FAKE_NPX_LOG"
if [ "$(wc -l < "$FAKE_NPX_LOG")" -lt "${FAKE_NPX_FAIL_UNTIL:-2}" ]; then
  exit 1
fi
while [ "$#" -gt 0 ]; do
  [ "$1" = "--output" ] && out="$2"
  shift
done
printf '{"statistics":{"total":{"percentage":0,"duplicatedLines":0,"lines":1,"clones":0,"sources":1}}}\n' \
  > "$out/jscpd-report.json"
FAKE
chmod +x "$TMP/bin/npx"

run_in_repo() {
  local repo="$1"
  shift
  (
    cd "$repo" || exit 99
    unset RUNNER_TEMP SANCTUARY_CI_TEMP_DIR_OVERRIDE
    PATH="$TMP/bin:$PATH" \
      FAKE_NPX_LOG="$repo/npx.log" \
      npm_config_cache="$TMP/npm-cache" \
      SANCTUARY_CLEANUP_COORDINATED=1 \
      SANCTUARY_RETRY_DELAY_SECONDS=0 \
      "$@"
  )
}

test_retry_reuses_empty_output_dir() {
  local repo="$TMP/retry-repo"
  make_fixture_repo "$repo"
  local status=0
  run_in_repo "$repo" scripts/ci/retry-command.sh jscpd scripts/quality/jscpd-only.sh \
    >"$TMP/retry.out" 2>&1 || status=$?
  local calls
  calls="$(wc -l < "$repo/npx.log")"
  if [ "$status" -eq 0 ] && [ "$calls" -eq 2 ]; then
    ok "attempt 2 reuses the empty output dir and reruns npx"
  else
    bad "expected exit 0 with 2 npx calls, got exit $status with $calls calls"
    cat "$TMP/retry.out" >&2
  fi
}

test_non_empty_output_dir_still_refused() {
  local repo="$TMP/stale-repo"
  make_fixture_repo "$repo"
  mkdir -p "$repo/reports/jscpd"
  printf 'stale\n' > "$repo/reports/jscpd/jscpd-report.json"
  local status=0
  run_in_repo "$repo" scripts/quality/jscpd-only.sh >"$TMP/stale.out" 2>&1 || status=$?
  if [ "$status" -ne 0 ] && grep -q 'Refusing stale jscpd output directory' "$TMP/stale.out" \
    && [ ! -e "$repo/npx.log" ]; then
    ok "a non-empty pre-existing output dir is still refused before npx runs"
  else
    bad "stale non-empty output dir was not refused (exit $status)"
    cat "$TMP/stale.out" >&2
  fi
}

test_retry_reuses_empty_output_dir
test_non_empty_output_dir_still_refused

echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
