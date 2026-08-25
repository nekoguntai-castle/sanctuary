#!/bin/bash
# Unit tests for the recurring-completion ageing used by the upgrade gate.
#
# The transform is separated from the Redis plumbing precisely so it can be
# tested without a live stack. What matters is that it refuses to emit a record
# the worker would reject: parseRecurringCompletion drops a record whose identity
# does not match, and it does so *silently* — the schedule then simply reports as
# never completed. A lane built on a silently-dropped record would go green
# without testing anything, which is the failure this whole change exists to fix.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# shellcheck source=tests/install/utils/upgrade-staleness.sh
source "$PROJECT_ROOT/tests/install/utils/upgrade-staleness.sh"

PASS=0
FAIL=0
FAILURES=()

ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); echo "FAIL: $1" >&2; }

SID='maintenance:webhook:recover-due-deliveries'
valid_record() {
  printf '{"version":1,"schedulerId":"%s","recurrenceFingerprint":"fp","generationToken":"tok","lastCompletedAt":%s}' \
    "$SID" "$1"
}

# ----- 1. backdates lastCompletedAt by the requested age --------------------
now_ms=$(( $(date +%s) * 1000 ))
out="$(valid_record "$now_ms" | age_heartbeat_record_json "$SID" 660000)"
status=$?
if [ "$status" -ne 0 ]; then
  bad "ageing a valid record failed (exit $status)"
else
  aged="$(printf '%s' "$out" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const p=JSON.parse(r);process.stdout.write(String(Date.now()-p.lastCompletedAt))})')"
  # Requested 660s; allow generous slack for clock and process time.
  if [ "$aged" -ge 650000 ] && [ "$aged" -le 700000 ]; then
    ok "backdates lastCompletedAt by the requested age (${aged}ms)"
  else
    bad "expected an age near 660000ms, got ${aged}ms"
  fi
fi

# ----- 2. preserves the identity fields the worker validates ----------------
# generationToken and recurrenceFingerprint are what make the record acceptable.
# Regenerating instead of editing in place would pass this file's other checks
# and still be discarded at runtime.
for field in version schedulerId recurrenceFingerprint generationToken; do
  got="$(printf '%s' "$out" | node -e "let r='';process.stdin.on('data',c=>r+=c).on('end',()=>{process.stdout.write(String(JSON.parse(r)['$field']))})")"
  expected_map_version=1
  case "$field" in
    version)               expected="$expected_map_version" ;;
    schedulerId)           expected="$SID" ;;
    recurrenceFingerprint) expected="fp" ;;
    generationToken)       expected="tok" ;;
  esac
  if [ "$got" = "$expected" ]; then
    ok "preserves ${field}"
  else
    bad "${field} changed: expected '${expected}', got '${got}'"
  fi
done

# ----- 3. refuses records the worker would silently discard -----------------
refuses() {
  local label="$1" json="$2"
  local err
  if err="$(printf '%s' "$json" | age_heartbeat_record_json "$SID" 660000 2>&1 >/dev/null)"; then
    bad "accepted ${label}; the worker would have discarded it silently"
  else
    ok "refuses ${label}"
  fi
}

refuses 'a mismatched schedulerId' \
  '{"version":1,"schedulerId":"sync:other","recurrenceFingerprint":"fp","generationToken":"tok","lastCompletedAt":1}'
refuses 'an unexpected record version' \
  "{\"version\":2,\"schedulerId\":\"$SID\",\"recurrenceFingerprint\":\"fp\",\"generationToken\":\"tok\",\"lastCompletedAt\":1}"
refuses 'a missing generationToken' \
  "{\"version\":1,\"schedulerId\":\"$SID\",\"recurrenceFingerprint\":\"fp\",\"lastCompletedAt\":1}"
refuses 'a record that never completed' \
  "{\"version\":1,\"schedulerId\":\"$SID\",\"recurrenceFingerprint\":\"fp\",\"generationToken\":\"tok\"}"
refuses 'malformed JSON' \
  '{not json'

# ----- 4. the schedule list matches what declares freshness -----------------
# Only one schedule declares freshness after wallet scheduler retirement. If that set changes, this helper covers
# less than it claims and the drift is otherwise invisible.
src="$PROJECT_ROOT/server/src/worker/recurringSchedules.ts"
declared=$(grep -c "syncFreshness(\|maxAgeMs:" "$src" 2>/dev/null || echo 0)
listed=${#UPGRADE_STALENESS_SCHEDULES[@]}
if [ "$listed" -eq 1 ]; then
  ok "covers the remaining freshness schedule"
else
  bad "expected 1 freshness schedule, helper lists ${listed}"
fi
# Follow schedule-name constants so the guard remains honest if a freshness
# schedule is declared indirectly.
schedule_is_defined() {
  local needle="$1"
  local table="$2"
  local server_src="$3"
  local const_name

  if grep -q "$needle" "$table"; then
    return 0
  fi

  const_name=$(grep -rhoE "export const [A-Za-z0-9_]+ *= *'[^']*${needle}'" "$server_src" 2>/dev/null \
    | sed -E "s/export const ([A-Za-z0-9_]+) *=.*/\\1/" | head -n 1)
  [ -n "$const_name" ] && grep -qE "(^|[^A-Za-z0-9_])${const_name}([^A-Za-z0-9_]|$)" "$table"
}

for entry in "${UPGRADE_STALENESS_SCHEDULES[@]}"; do
  sid="${entry%:*}"
  if schedule_is_defined "${sid##*:}" "$src" "$PROJECT_ROOT/server/src"; then
    ok "schedule ${sid} still exists in recurringSchedules.ts"
  else
    bad "schedule ${sid} is no longer defined — the helper would age a key nothing reads"
  fi
done

# The retired wallet schedule must remain absent from both the active schedule
# table and this upgrade helper. Its retained wire constant lives only in the
# compatibility/purge boundary and is not evidence of active registration.
if schedule_is_defined "check-stale-wallets" "$src" "$PROJECT_ROOT/server/src"; then
  bad "retired sync schedule is still active in recurringSchedules.ts"
else
  ok "retired sync schedule is absent from recurringSchedules.ts"
fi
if printf '%s\n' "${UPGRADE_STALENESS_SCHEDULES[@]}" | grep -q 'sync:check-stale-wallets'; then
  bad "upgrade helper still expects the retired sync freshness schedule"
else
  ok "upgrade helper no longer expects the retired sync freshness schedule"
fi

# The active-schedule check must still fail when the remaining schedule is
# removed. Prove that against a table with the webhook reference stripped out.
staleness_fixture_dir="$(mktemp -d)"

grep -v 'WEBHOOK_RECOVERY_JOB_NAME' "$src" > "$staleness_fixture_dir/without-webhook.ts"
if schedule_is_defined "recover-due-deliveries" "$staleness_fixture_dir/without-webhook.ts" "$PROJECT_ROOT/server/src"; then
  bad "drift check accepts a table that no longer references the webhook schedule"
else
  ok "drift check rejects a table that dropped the webhook schedule"
fi

printf "%s\n" "defineSchedule('maintenance:webhook', 'recover-due-deliveries', {});" > "$staleness_fixture_dir/literal.ts"
if schedule_is_defined "recover-due-deliveries" "$staleness_fixture_dir/literal.ts" "$PROJECT_ROOT/server/src"; then
  ok "drift check accepts a schedule declared with a plain literal"
else
  bad "drift check rejects a schedule declared with a plain literal"
fi

# Removed here rather than in an EXIT trap: a later section installs its own
# trap, which would replace this one and leak the directory.
rm -rf "$staleness_fixture_dir"

# ----- 5. the verdict logic, against synthetic /metrics payloads ------------
# These replay the shapes the 60-minute lane can produce, including the one that
# made run 9136 fail: the worker recovers within seconds of booting, so the
# completion is fresh again by the time anything reads it. The verdict must key
# off boot time instead, or it can never distinguish recovery from never-stale.
BOOT_MS=1786129523000            # 2026-08-07T19:05:23Z, run 9136's worker boot
BOOT_ISO='2026-08-07T19:05:23.000Z'

metrics_json() {
  # $1 = completionTimes object body, $2 = healthy, $3 = startedAt
  printf '{"worker":{"startedAt":"%s"},"recurringSchedules":{"healthy":%s,"stale":[],"heartbeatHealthy":true,"completionTimes":{%s}}}' \
    "$3" "$2" "$1"
}

web_aged=$((BOOT_MS - 223000))    # planted 223s before boot, past maxAge 120s
STATE="{\"schedules\":[{\"schedulerId\":\"maintenance:webhook:recover-due-deliveries\",\"agedTo\":${web_aged},\"maxAgeMs\":120000}]}"

verdict_is() {
  local label="$1" want="$2" state="$3" metrics="$4"
  local got
  got="$(evaluate_staleness_verdict "$state" "$metrics")"
  case "$got" in
    "$want"*) ok "$label" ;;
    *)        bad "$label -> got: ${got:0:150}" ;;
  esac
}

# The exact recovery shape: the schedule re-ran after boot and looks fresh now.
# Previously this was reported as "no schedule booted with a stale completion".
verdict_is 'accepts a schedule that recovered after booting stale' OK "$STATE" \
  "$(metrics_json '"maintenance:webhook:recover-due-deliveries":1786129560090' true "$BOOT_ISO")"

# Booted stale and not yet re-run: the planted value is still what is reported.
verdict_is 'accepts a planted completion that has not re-run yet' OK "$STATE" \
  "$(metrics_json "\"maintenance:webhook:recover-due-deliveries\":${web_aged}" true "$BOOT_ISO")"

# The #657 outcome itself must still be enforced.
verdict_is 'rejects an unhealthy worker' FAIL "$STATE" \
  "$(metrics_json '"maintenance:webhook:recover-due-deliveries":1786129560090' false "$BOOT_ISO")"

# Nothing was aged -> the lane proves nothing. This is the vacuous-pass case.
verdict_is 'rejects a missing state file' FAIL '' \
  "$(metrics_json '"maintenance:webhook:recover-due-deliveries":1786129560090' true "$BOOT_ISO")"
verdict_is 'rejects an empty schedule list' FAIL '{"schedules":[]}' \
  "$(metrics_json '"maintenance:webhook:recover-due-deliveries":1786129560090' true "$BOOT_ISO")"

# Without a boot time the comparison is impossible; it must not pass by default.
verdict_is 'rejects metrics with no worker.startedAt' FAIL "$STATE" \
  '{"recurringSchedules":{"healthy":true,"completionTimes":{"maintenance:webhook:recover-due-deliveries":1}}}'

# Planted, but not actually stale at boot -- a downtime shorter than maxAgeMs.
fresh_state="{\"schedules\":[{\"schedulerId\":\"maintenance:webhook:recover-due-deliveries\",\"agedTo\":$((BOOT_MS - 10000)),\"maxAgeMs\":120000}]}"
verdict_is 'rejects a completion that was still fresh at boot' FAIL "$fresh_state" \
  "$(metrics_json "\"maintenance:webhook:recover-due-deliveries\":$((BOOT_MS - 10000))" true "$BOOT_ISO")"

# A pre-boot completion we did not plant means our record never reached the
# worker -- the branch was not exercised even though we tried.
verdict_is 'rejects a pre-boot completion we did not plant' FAIL "$STATE" \
  "$(metrics_json "\"maintenance:webhook:recover-due-deliveries\":$((BOOT_MS - 5000))" true "$BOOT_ISO")"

# Record dropped entirely.
verdict_is 'rejects a worker reporting no completion' FAIL "$STATE" \
  "$(metrics_json '' true "$BOOT_ISO")"

verdict_is 'rejects malformed metrics' FAIL "$STATE" '{not json'

# ----- 6. the state file the assertion reads back --------------------------
# force_recurring_completion_staleness and the assertion are separated by a
# stack teardown, so the file between them is the contract. If it is malformed
# or lists the wrong instant, the assertion fails for a reason that looks
# nothing like the real cause. Exercised here with a stubbed Redis.
log_info()    { :; }
log_error()   { :; }
log_warning() { :; }
REDIS_PASSWORD='stub'

STUB_RECORD_TEMPLATE='{"version":1,"schedulerId":"%s","recurrenceFingerprint":"fp","generationToken":"tok","lastCompletedAt":%s}'
compose_exec() {
  # $1=redis $2=redis-cli -a ... ; the command verb lands after --no-auth-warning
  local args=("$@") i verb='' key=''
  for i in "${!args[@]}"; do
    case "${args[$i]}" in
      GET|SET) verb="${args[$i]}"; key="${args[$((i + 1))]}"; break ;;
    esac
  done
  if [ "$verb" = 'GET' ]; then
    local sid="${key#*recurring-heartbeat:v1:}"
    printf "$STUB_RECORD_TEMPLATE" "${sid//%3A/:}" "$(( $(date +%s) * 1000 ))"
  fi
  return 0
}

SANCTUARY_UPGRADE_STALENESS_STATE_FILE="$(mktemp)"
trap 'rm -f "$SANCTUARY_UPGRADE_STALENESS_STATE_FILE"' EXIT

if force_recurring_completion_staleness; then
  ok 'force_recurring_completion_staleness succeeds against a stubbed Redis'
else
  bad 'force_recurring_completion_staleness failed against a stubbed Redis'
fi

state_check="$(node -e '
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const ids = state.schedules.map((s) => s.schedulerId).sort().join(",");
const wellFormed = state.schedules.every(
  (s) => Number.isFinite(s.agedTo) && Number.isFinite(s.maxAgeMs) && s.agedTo < Date.now() - s.maxAgeMs,
);
process.stdout.write(`${state.schedules.length}|${ids}|${wellFormed}`);
' "$SANCTUARY_UPGRADE_STALENESS_STATE_FILE" 2>&1)"

case "$state_check" in
  '1|maintenance:webhook:recover-due-deliveries|true')
    ok 'state file records the remaining schedule already past its maxAge' ;;
  *)
    bad "state file is malformed: ${state_check}" ;;
esac

# A verdict built from the real state file must accept a worker that booted
# after it -- the end-to-end shape, without a stack.
boot_iso="$(node -e 'process.stdout.write(new Date(Date.now() + 1000).toISOString())')"
verdict_is 'state file drives an OK verdict against a later boot' OK \
  "$(cat "$SANCTUARY_UPGRADE_STALENESS_STATE_FILE")" \
  "$(metrics_json "\"maintenance:webhook:recover-due-deliveries\":$(( $(date +%s) * 1000 + 5000 ))" true "$boot_iso")"

echo
echo "===================="
echo "Total:  $((PASS + FAIL))"
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Failures:" >&2
  for f in "${FAILURES[@]}"; do echo "  - $f" >&2; done
  exit 1
fi
