#!/bin/bash
# Unit tests for the TOTP step-boundary guard in the upgrade 2FA test helpers.
#
# Finding upgrade-e2e-2fa-phases-reuse-totp-step (P2, 2026-09-15): the upgrade
# e2e phases (verify-preserved, reset-and-re-enroll, user-visible smoke) log in
# with 2FA back to back. generate_totp_code/generate_upgrade_totp_code mint a
# code for the current 30s RFC 6238 step with no step-boundary wait, so a
# second 2FA login inside the same step is rejected by the product's
# single-use step guard: postgres raises
# `Key (jti)=(totp-step:<user>:<step>) already exists`. No product change is
# involved -- the single-use guard is the intended behavior; only the test
# helpers need to avoid reusing a step.
#
# Follow-up finding (same day, PR CI for this fix): log_info/log_error
# (tests/install/utils/helpers.sh) write to STDOUT via plain `echo`, and
# generate_totp_code is always invoked through command substitution
# (`code=$(generate_totp_code ...)`), which bash runs in a subshell whose
# stdout IS the captured value. Every "Waiting for the TOTP step..." line
# wait_for_totp_step_boundary logged therefore landed inside $code and was
# POSTed as the verification code, turning the fix itself into a 500 on
# /api/v1/auth/2fa/verify. Section 4 below reproduces that with the REAL
# (unstubbed) log_info/log_error, proving generate_totp_code's stdout is
# exactly the digits even when a wait happens.
#
# This drives wait_for_totp_step_boundary/generate_totp_code with an
# injectable step source (SANCTUARY_TOTP_STEP_OVERRIDE) and stubbed
# `docker`/`sleep` so it proves the wait behavior without a live stack or a
# real 30s sleep.
#
# generate_totp_code is always invoked through command substitution by real
# callers, and bash runs command substitution in a subshell. Side effects
# (docker/sleep call counts, the recorded step) are therefore read back from
# files rather than from plain shell variables a subshell would silently
# drop -- exactly the class of bug this test would otherwise hide.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# PROJECT_ROOT is overridden below to keep generate_totp_code's (unused, since
# docker is stubbed) docker-compose.yml reference out of the real tree. Keep
# the real root separately for re-sourcing helpers.sh in section 4.
REAL_PROJECT_ROOT="$PROJECT_ROOT"

# shellcheck source=tests/install/utils/helpers.sh
source "$PROJECT_ROOT/tests/install/utils/helpers.sh"
# shellcheck source=tests/install/utils/upgrade-two-factor-auth-helpers.sh
source "$PROJECT_ROOT/tests/install/utils/upgrade-two-factor-auth-helpers.sh"

PASS=0
FAIL=0
FAILURES=()

ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); echo "FAIL: $1" >&2; }

TEST_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP_DIR"' EXIT

DOCKER_CALL_LOG="$TEST_TMP_DIR/docker-calls"
SLEEP_CALL_LOG="$TEST_TMP_DIR/sleep-calls"
INFO_LOG_FILE="$TEST_TMP_DIR/info-log"
: > "$DOCKER_CALL_LOG"
: > "$SLEEP_CALL_LOG"
: > "$INFO_LOG_FILE"

# Sections 1-3 use a lightweight stub so "the wait is logged" is cheap to
# assert on. Section 4 restores the real helpers.sh log_info/log_error (plain
# `echo`, which writes to stdout) to prove the bug and its fix directly.
log_info()  { printf '%s\n' "$*" >> "$INFO_LOG_FILE"; }
log_error() { printf '%s\n' "$*" >> "$INFO_LOG_FILE"; }

# Stands in for `docker compose -f ... exec -T -e SANCTUARY_TOTP_SECRET=<secret>
# backend node -e '...'`. Prints "<6-digit code> <minted step>", matching the
# real command: the code has otplib generateSync's shape (a stub that returned
# anything else could never distinguish "clean digits" from "digits plus
# noise"), and the step is the one the backend minted it for. MINT_STEP_OVERRIDE
# models the exec landing in a later step than the caller last read; unset, the
# mint step is the caller's current step.
# Called from inside generate_totp_code's own command-substitution subshell,
# so the call counter lives in a file rather than an in-process counter.
docker() {
    local n
    printf 'x' >> "$DOCKER_CALL_LOG"
    n=$(wc -c < "$DOCKER_CALL_LOG")
    printf '%06d %s' "$n" "${MINT_STEP_OVERRIDE:-$SANCTUARY_TOTP_STEP_OVERRIDE}"
}

# Simulates the 30s step boundary advancing after one wait tick, so the test
# does not need to sleep for real. Runs inside the subshell too, so the call
# count is file-backed; SANCTUARY_TOTP_STEP_OVERRIDE is exported so the
# advance is visible to totp_current_step called again in the same subshell.
sleep() {
    printf 'x' >> "$SLEEP_CALL_LOG"
    SANCTUARY_TOTP_STEP_OVERRIDE=$((SANCTUARY_TOTP_STEP_OVERRIDE + 1))
}

sleep_call_count() { wc -c < "$SLEEP_CALL_LOG"; }
docker_call_count() { wc -c < "$DOCKER_CALL_LOG"; }

PROJECT_ROOT="/tmp/upgrade-totp-step-guard-test-unused"

# ----- 1. two logins in the same step wait and get distinct steps -----------
TOTP_STEP_STATE_FILE="$TEST_TMP_DIR/state-1"
rm -f "$TOTP_STEP_STATE_FILE"
export SANCTUARY_TOTP_STEP_OVERRIDE=1000
: > "$DOCKER_CALL_LOG"
: > "$SLEEP_CALL_LOG"
: > "$INFO_LOG_FILE"

first_code=$(generate_totp_code "secret-a")
first_step="$(totp_last_used_step "$(totp_step_tracking_key "secret-a")")"

second_code=$(generate_totp_code "secret-a")
second_step="$(totp_last_used_step "$(totp_step_tracking_key "secret-a")")"

if [ -n "$first_code" ] && [ -n "$second_code" ]; then
  ok "both logins in the same step still mint a code"
else
  bad "expected two non-empty codes, got '$first_code' and '$second_code'"
fi

if [ "$(sleep_call_count)" -ge 1 ]; then
  ok "second login in the same step waits for the step boundary"
else
  bad "second login in the same step did not wait (sleep was never called)"
fi

if [ -n "$first_step" ] && [ -n "$second_step" ] && [ "$first_step" != "$second_step" ]; then
  ok "consecutive logins in the same step record distinct TOTP steps ($first_step -> $second_step)"
else
  bad "consecutive logins recorded the same TOTP step ('$first_step' == '$second_step')"
fi

if grep -q "Waiting for the TOTP step" "$INFO_LOG_FILE"; then
  ok "the wait is logged"
else
  bad "no log line was emitted for the wait"
fi

# ----- 2. no wait when the step already advanced -----------------------------
TOTP_STEP_STATE_FILE="$TEST_TMP_DIR/state-2"
rm -f "$TOTP_STEP_STATE_FILE"
export SANCTUARY_TOTP_STEP_OVERRIDE=2000
: > "$DOCKER_CALL_LOG"
: > "$SLEEP_CALL_LOG"
: > "$INFO_LOG_FILE"

generate_totp_code "secret-b" > /dev/null
export SANCTUARY_TOTP_STEP_OVERRIDE=2001
third_code=$(generate_totp_code "secret-b")
third_step="$(totp_last_used_step "$(totp_step_tracking_key "secret-b")")"

if [ "$(sleep_call_count)" -eq 0 ]; then
  ok "no wait when the step had already advanced before the next mint"
else
  bad "unexpected wait when the step had already advanced ($(sleep_call_count) sleep calls)"
fi

if [ -n "$third_code" ]; then
  ok "the mint after an advanced step still returns a code"
else
  bad "expected a non-empty code after the step advanced"
fi

if [ "$third_step" = "2001" ]; then
  ok "the recorded step reflects the advanced step"
else
  bad "expected the recorded step to be 2001, got '$third_step'"
fi

# Same shape as pre-upgrade seeding followed by a post-upgrade login: the
# first tracked login records a step, and a much later login (a real upgrade
# spans more than one 30s step) must never wait just because a step was
# recorded earlier for that secret.
TOTP_STEP_STATE_FILE="$TEST_TMP_DIR/state-2b"
rm -f "$TOTP_STEP_STATE_FILE"
export SANCTUARY_TOTP_STEP_OVERRIDE=5000
: > "$SLEEP_CALL_LOG"

generate_totp_code "secret-preupgrade" > /dev/null   # e.g. the pre-upgrade fixture login
export SANCTUARY_TOTP_STEP_OVERRIDE=5137              # post-upgrade, well past that step
post_upgrade_code=$(generate_totp_code "secret-preupgrade")
post_upgrade_step="$(totp_last_used_step "$(totp_step_tracking_key "secret-preupgrade")")"

if [ "$(sleep_call_count)" -eq 0 ]; then
  ok "a post-upgrade login in a different step never waits on the pre-upgrade record"
else
  bad "post-upgrade login waited even though the step had long since advanced ($(sleep_call_count) sleep calls)"
fi
if [ -n "$post_upgrade_code" ] && [ "$post_upgrade_step" = "5137" ]; then
  ok "post-upgrade login mints a code and records the new step"
else
  bad "post-upgrade login did not mint/record correctly (code='$post_upgrade_code' step='$post_upgrade_step')"
fi

# ----- 3. distinct secrets do not block each other ---------------------------
TOTP_STEP_STATE_FILE="$TEST_TMP_DIR/state-3"
rm -f "$TOTP_STEP_STATE_FILE"
export SANCTUARY_TOTP_STEP_OVERRIDE=3000
: > "$DOCKER_CALL_LOG"
: > "$SLEEP_CALL_LOG"
: > "$INFO_LOG_FILE"

generate_totp_code "secret-c" > /dev/null
generate_totp_code "secret-d" > /dev/null

if [ "$(sleep_call_count)" -eq 0 ]; then
  ok "a different secret in the same step does not wait"
else
  bad "unexpected wait for an unrelated secret ($(sleep_call_count) sleep calls)"
fi

# ----- 4. command-substitution stdout is exactly the code -------------------
# Restores the REAL log_info/log_error from tests/install/utils/helpers.sh
# (plain `echo`, which writes to stdout) instead of the file-backed stubs
# above. generate_totp_code must still keep every log line off its stdout,
# because that stdout is what every real caller POSTs as the verification
# code. This is red without the `>&2` redirects on the log calls inside
# wait_for_totp_step_boundary/generate_totp_code.
unset -f log_info log_error
source "$REAL_PROJECT_ROOT/tests/install/utils/helpers.sh"

TOTP_STEP_STATE_FILE="$TEST_TMP_DIR/state-4"
rm -f "$TOTP_STEP_STATE_FILE"
export SANCTUARY_TOTP_STEP_OVERRIDE=4000
: > "$DOCKER_CALL_LOG"
: > "$SLEEP_CALL_LOG"

cs_first_code=$(generate_totp_code "secret-cs" 2>"$TEST_TMP_DIR/cs-first-stderr")
cs_second_code=$(generate_totp_code "secret-cs" 2>"$TEST_TMP_DIR/cs-second-stderr")

if [[ "$cs_first_code" =~ ^[0-9]{6}$ ]]; then
  ok "first command-substitution capture is exactly six digits"
else
  bad "first captured code is not clean digits: '$cs_first_code'"
fi

if [[ "$cs_second_code" =~ ^[0-9]{6}$ ]]; then
  ok "second command-substitution capture (which waits) is exactly six digits"
else
  bad "second captured code is not clean digits: '$cs_second_code'"
fi

if [ "$(sleep_call_count)" -ge 1 ]; then
  ok "the second same-step capture still waited (the log-pollution repro is real)"
else
  bad "the second capture did not wait -- this section is not exercising the wait path"
fi

if grep -q "Waiting for the TOTP step" "$TEST_TMP_DIR/cs-second-stderr"; then
  ok "the wait log line went to stderr, not into the captured code"
else
  bad "expected the wait log line on stderr for the second capture"
fi

# Restore the file-backed stubs for the remaining section.
log_info()  { printf '%s\n' "$*" >> "$INFO_LOG_FILE"; }
log_error() { printf '%s\n' "$*" >> "$INFO_LOG_FILE"; }

# ----- 5. a wait on the same secret cannot exceed one step -------------------
# A sleep stub that never advances the step simulates a stuck clock. The wait
# must give up after one step's worth of ticks rather than looping forever.
TOTP_STEP_STATE_FILE="$TEST_TMP_DIR/state-5"
rm -f "$TOTP_STEP_STATE_FILE"
export SANCTUARY_TOTP_STEP_OVERRIDE=6000
: > "$SLEEP_CALL_LOG"
: > "$INFO_LOG_FILE"

# Records step 6000 for the secret's tracking key without spending a real
# mint -- the same key generate_totp_code will compute for this secret since
# no account is passed here.
record_totp_step_used "$(totp_step_tracking_key "secret-stuck")" "6000"

# shellcheck disable=SC2317 # invoked indirectly by wait_for_totp_step_boundary
sleep() { printf 'x' >> "$SLEEP_CALL_LOG"; }   # step never advances

stuck_code=$(generate_totp_code "secret-stuck" 2>"$TEST_TMP_DIR/stuck-stderr")
stuck_status=$?

if [ "$stuck_status" -ne 0 ] && [ -z "$stuck_code" ]; then
  ok "a wait that never sees the step advance fails closed with no code"
else
  bad "expected a failure with no code, got status=$stuck_status code='$stuck_code'"
fi

if [ "$(sleep_call_count)" -eq 30 ]; then
  ok "the wait is bounded to exactly one step's worth of ticks (30)"
else
  bad "expected exactly 30 sleep ticks before giving up, got $(sleep_call_count)"
fi

if grep -q "Timed out waiting for the TOTP step" "$INFO_LOG_FILE"; then
  ok "the timeout is logged"
else
  bad "expected a timeout log line"
fi

# Restore the step-advancing sleep stub for the remaining section.
sleep() {
    printf 'x' >> "$SLEEP_CALL_LOG"
    SANCTUARY_TOTP_STEP_OVERRIDE=$((SANCTUARY_TOTP_STEP_OVERRIDE + 1))
}

# ----- 6. tracking is keyed by the account, not the secret -------------------
# Finding: the admin's re-enroll flow logs in with the OLD secret, then
# enables a NEW secret in the same step. The product's single-use step guard
# is keyed by account (totp-step:<userId>:<step>), not by secret, and
# consumes it on both /auth/2fa/verify and /auth/2fa/enable -- so a
# secret-keyed tracker never waits and the enable call 500s with "Invalid
# verification code". Passing the account threads the SAME tracking key
# across both mints even though the secret changed.
TOTP_STEP_STATE_FILE="$TEST_TMP_DIR/state-6"
rm -f "$TOTP_STEP_STATE_FILE"
export SANCTUARY_TOTP_STEP_OVERRIDE=7000
: > "$SLEEP_CALL_LOG"
: > "$INFO_LOG_FILE"

admin_login_code=$(generate_totp_code "old-secret" "admin")
admin_reenroll_code=$(generate_totp_code "new-secret" "admin")
admin_key="$(totp_step_tracking_key "old-secret" "admin")"
admin_step_after="$(totp_last_used_step "$admin_key")"

if [ "$(sleep_call_count)" -ge 1 ]; then
  ok "the same account re-enrolling a different secret in the same step waits"
else
  bad "the same account with a new secret in the same step did not wait"
fi

if [ -n "$admin_login_code" ] && [ -n "$admin_reenroll_code" ] && [ "$admin_step_after" = "7001" ]; then
  ok "the account-keyed re-enroll mint records a distinct (advanced) step ($admin_step_after)"
else
  bad "expected step 7001 recorded for the account key, got '$admin_step_after' (codes: '$admin_login_code' / '$admin_reenroll_code')"
fi

# Distinct accounts in the same step must never block each other, even when
# they happen to mint from secrets that collide as strings.
TOTP_STEP_STATE_FILE="$TEST_TMP_DIR/state-6b"
rm -f "$TOTP_STEP_STATE_FILE"
export SANCTUARY_TOTP_STEP_OVERRIDE=8000
: > "$SLEEP_CALL_LOG"

operator_code=$(generate_totp_code "secret-x" "operator")
legacy_code=$(generate_totp_code "secret-y" "legacy-user")

if [ "$(sleep_call_count)" -eq 0 ]; then
  ok "distinct accounts in the same step do not wait"
else
  bad "unexpected wait for distinct accounts ($(sleep_call_count) sleep calls)"
fi

if [ -n "$operator_code" ] && [ -n "$legacy_code" ]; then
  ok "both distinct-account mints still return a code"
else
  bad "expected two non-empty codes, got '$operator_code' and '$legacy_code'"
fi

# ----- 7. the recorded step is the step the code was minted for --------------
# v0.8.75-rc4 install-test attempt 2 (run 18785, job 234789, kumo): the
# optional-profiles "Verify 2FA Preserved" phase failed in 1s with
# `auth.2fa_failed ... Invalid 2FA code`. The previous admin login read the
# host step at 18:37:29.8 (step N-1), but the `docker compose exec` that
# minted its code ran past 18:37:30, so the backend minted -- and the product
# consumed -- step N. With N-1 recorded, the next login at 18:37:32 saw a
# "new" step, skipped the wait, and minted a second step-N code, which the
# single-use guard rejected as a replay.
TOTP_STEP_STATE_FILE="$TEST_TMP_DIR/state-7"
rm -f "$TOTP_STEP_STATE_FILE"
export SANCTUARY_TOTP_STEP_OVERRIDE=9000
export MINT_STEP_OVERRIDE=9001          # the exec crosses into the next step
: > "$SLEEP_CALL_LOG"

straddle_code=$(generate_totp_code "secret-straddle" "admin")
straddle_step="$(totp_last_used_step "$(totp_step_tracking_key "secret-straddle" "admin")")"
unset MINT_STEP_OVERRIDE

if [[ "$straddle_code" =~ ^[0-9]{6}$ ]]; then
  ok "a mint that crosses a step boundary still returns exactly the 6-digit code"
else
  bad "expected exactly a 6-digit code from the boundary-crossing mint, got '$straddle_code'"
fi

if [ "$straddle_step" = "9001" ]; then
  ok "the recorded step is the step the backend minted for, not the caller's earlier reading"
else
  bad "expected the minted step 9001 to be recorded, got '$straddle_step'"
fi

export SANCTUARY_TOTP_STEP_OVERRIDE=9001   # the next login lands in the minted step
next_code=$(generate_totp_code "secret-straddle" "admin")

if [ "$(sleep_call_count)" -ge 1 ]; then
  ok "the next login in the minted step waits instead of replaying it"
else
  bad "the next login in the minted step did not wait, so it would replay step 9001"
fi
if [ -n "$next_code" ]; then
  ok "the login after the wait still mints a code"
else
  bad "expected a code from the login after the wait"
fi

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
