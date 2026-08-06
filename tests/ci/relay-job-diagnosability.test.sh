#!/usr/bin/env bash
#
# Relay lanes in install-test.yml run no tests of their own: they inspect an
# upstream job's `needs.*.result` and fail if it is not success. When such a
# lane fails, the run page shows a red check named after an E2E suite that never
# executed, and the job uploads no diagnostic artifact because it has nothing to
# collect.
#
# That happened on run 8614: `Install Script E2E Test` went red while the lane
# had not run at all — the combined install job upstream was skipped after an
# unrelated unit-test failure. The failure text said "failed in the combined
# install job" without naming the upstream result, which reads as an E2E
# regression and sends the reader hunting for logs that do not exist.
#
# These assertions keep relay lanes self-describing:
#   1. the upstream result reaches the shell through env:, not ${{ }}
#      interpolation inside run: (also the shell-injection class Semgrep flags)
#   2. the failure text surfaces the upstream result value
#   3. skipped/cancelled is distinguished from a genuine upstream failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKFLOW="$REPO_ROOT/.github/workflows/install-test.yml"

PASS=0
FAILURES=()

check() {
  local description="$1"
  shift
  if "$@"; then
    PASS=$((PASS + 1))
    printf 'PASS: %s\n' "$description"
  else
    FAILURES+=("$description")
    printf 'FAIL: %s\n' "$description" >&2
  fi
}

[ -f "$WORKFLOW" ] || { printf 'FAIL: %s not found\n' "$WORKFLOW" >&2; exit 1; }

# Extract a job's block: from "  <job>:" to the next top-level job key.
job_block() {
  local job="$1"
  awk -v job="  ${job}:" '
    $0 == job { capture = 1; next }
    capture && /^  [a-z0-9_-]+:$/ { exit }
    capture { print }
  ' "$WORKFLOW"
}

relay_uses_env_not_interpolation() {
  local block
  block="$(job_block "$1")"
  # No ${{ needs.*.result }} may appear inside a run: block. Interpolations are
  # fine under env:, so look only at lines that are shell body.
  ! awk '
    /^      *run: \|/ { in_run = 1; next }
    /^      - name:/  { in_run = 0 }
    in_run && /\$\{\{[^}]*needs\.[^}]*result/ { found = 1 }
    END { exit(found ? 0 : 1) }
  ' <<<"$block"
}

relay_reports_upstream_result() {
  local block var
  block="$(job_block "$1")"
  grep -q '::error::' <<<"$block" || return 1

  # Find the env var names this job binds from an upstream job result, then
  # require at least one of them to appear in an ::error:: line. Matching on the
  # binding rather than on a name pattern keeps the check about the property
  # (the reader is told the upstream result) rather than a naming convention.
  while IFS= read -r var; do
    [ -n "$var" ] || continue
    if grep -E '::error::' <<<"$block" | grep -qF "\$${var}" ||
       grep -E '::error::' <<<"$block" | grep -qF "\${${var}}"; then
      return 0
    fi
  done < <(grep -oE '^\s*([A-Z_][A-Z0-9_]*): \$\{\{ needs\.[^}]*\.result \}\}' <<<"$block" \
             | sed -E 's/^\s*([A-Z_][A-Z0-9_]*):.*/\1/')

  return 1
}

relay_distinguishes_skipped() {
  local block
  block="$(job_block "$1")"
  grep -qE '(skipped\|cancelled|skipped\))' <<<"$block"
}

for job in install-script-test upgrade-extended-test; do
  check "$job passes the upstream result through env, not run: interpolation" \
    relay_uses_env_not_interpolation "$job"
  check "$job surfaces the upstream result in its error text" \
    relay_reports_upstream_result "$job"
done

# Only install-script-test relays a job that can legitimately be skipped by an
# unrelated upstream failure; upgrade-extended-test already guards that case in
# its `if:` expression.
check "install-script-test distinguishes a skipped upstream from a failed one" \
  relay_distinguishes_skipped install-script-test

printf '\n====================\n'
printf 'Passed: %d\n' "$PASS"
printf 'Failed: %d\n' "${#FAILURES[@]}"

if [ "${#FAILURES[@]}" -gt 0 ]; then
  printf 'Failing checks:\n'
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
