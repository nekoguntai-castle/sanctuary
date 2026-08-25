#!/bin/bash
# Force the restart-staleness path the upgrade gate is supposed to cover.
#
# #657 fixed a bug where a durable pre-restart completion, already older than
# maxAgeMs when the new worker booted, was reported stale -> worker /health 503
# -> the backend's critical worker-heartbeat service aborted startup -> the whole
# stack came down. The gate that protects against it only entered that branch if
# the rebuild happened to take the right amount of time.
#
# "The right amount of time" is a window, not a floor. The completion key is
# written with ttl = maxAgeMs * 2 + startupGraceMs, so downtime D selects a
# branch:
#
#     D < maxAgeMs     not stale, path not exercised
#     maxAgeMs < D < ttl   the stale-completion branch #657 fixed
#     D > ttl          key expired, lastCompletedAt undefined -- a DIFFERENT branch
#
# The remaining schedule that declares restart freshness has a 120s .. 330s
# window. A longer hold is not strictly better: past the ttl it stops testing
# this path at all. Waiting is therefore still the wrong instrument.
#
# Instead: age the completion record in place before the stack goes down, and
# give the key a long explicit TTL so the rebuild cannot outlast it. Editing the
# record in place preserves version/schedulerId/recurrenceFingerprint/
# generationToken, which parseRecurringCompletion checks -- a rebuilt record with
# a fresh token is silently discarded (recurringHeartbeatStore.ts:195-205).

# Keys: sanctuary:worker:recurring-heartbeat:v1:<encodeURIComponent(schedulerId)>
# (prefix workerJobQueue/index.ts:168, version recurringHeartbeatRecord.ts:4,
# schedulerId is `queue:name` per recurringSchedules.ts:51)
UPGRADE_STALENESS_KEY_PREFIX="sanctuary:worker:recurring-heartbeat:v1"

# Schedules that declare freshness, with the maxAgeMs each is judged against.
# Only webhook recovery remains after wallet scheduler retirement
# (recurringHeartbeatStore.ts filters on freshness). An unexpected key here means
# the schedule set changed and this helper needs revisiting rather than silently
# covering less.
UPGRADE_STALENESS_SCHEDULES=(
    "maintenance:webhook:recover-due-deliveries:120000"
)

# How far past maxAgeMs to backdate, and how long to keep the key alive. The TTL
# must exceed the whole rebuild; 6h is far past any plausible one and costs
# nothing because the stack is recreated immediately after.
UPGRADE_STALENESS_MARGIN_MS="${SANCTUARY_UPGRADE_STALENESS_MARGIN_MS:-60000}"
UPGRADE_STALENESS_KEY_TTL_MS="${SANCTUARY_UPGRADE_STALENESS_KEY_TTL_MS:-21600000}"

# Where the ageing step records exactly what it wrote, for the post-restart
# assertion to read back.
#
# The assertion cannot simply re-read the completion and check it still looks
# stale. Ageing the record makes the schedule immediately due, so the rebooted
# worker runs it within seconds and overwrites lastCompletedAt -- run 9136 saw
# both schedules refreshed 26s and 37s after boot. Recovering is the behaviour
# #657 wants, so the evidence erases itself, and an assertion that reads the
# completion afterwards can never tell "booted stale and recovered" apart from
# "was never stale".
#
# What does survive is the pair (timestamp we wrote, worker boot time): if the
# completion we planted is older than maxAgeMs at the instant the worker booted,
# the worker necessarily evaluated the #657 branch, no matter how fast it then
# recovered. worker.startedAt is fixed for the process lifetime, so reading it
# is race-free.
#
# The path is scoped to the compose project (unique per run and fixture) because
# /tmp survives between jobs on these runners. A leftover file from an earlier
# run would satisfy every check in the verdict -- its completion is even further
# past maxAge -- turning "the ageing step never ran" into a green lane, which is
# exactly the vacuous pass this change exists to eliminate.
#
# Resolved lazily rather than at source time: this file is sourced before the
# test exports COMPOSE_PROJECT_NAME, so binding it now would silently capture
# the fallback and drop the per-run scoping.
staleness_state_file() {
    printf '%s' "${SANCTUARY_UPGRADE_STALENESS_STATE_FILE:-${TMPDIR:-/tmp}/sanctuary-upgrade-staleness-${COMPOSE_PROJECT_NAME:-$$}.json}"
}

# Pure transform, kept separate so it is unit-testable without a live stack.
# Reads a completion record JSON on stdin, writes it back with lastCompletedAt
# backdated. Fails (non-zero, message on stderr) rather than emitting a record
# the worker would reject.
age_heartbeat_record_json() {
    local scheduler_id="$1"
    local age_ms="$2"

    node -e '
const [schedulerId, ageMs] = process.argv.slice(1);
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let record;
  try {
    record = JSON.parse(raw);
  } catch (error) {
    console.error(`not valid JSON for ${schedulerId}: ${error.message}`);
    process.exit(1);
  }
  // The worker rejects a record whose identity does not match, and does so
  // silently -- it simply reports the schedule as never completed. Refuse to
  // write one rather than produce a lane that passes for the wrong reason.
  if (record.version !== 1 || record.schedulerId !== schedulerId) {
    console.error(
      `identity mismatch for ${schedulerId}: version=${record.version} schedulerId=${record.schedulerId}`,
    );
    process.exit(1);
  }
  if (typeof record.generationToken !== "string" || !record.generationToken) {
    console.error(`missing generationToken for ${schedulerId}`);
    process.exit(1);
  }
  if (typeof record.lastCompletedAt !== "number") {
    console.error(
      `no lastCompletedAt for ${schedulerId} -- the schedule never completed, so there is no pre-restart completion to age`,
    );
    process.exit(1);
  }
  record.lastCompletedAt = Date.now() - Number(ageMs);
  process.stdout.write(JSON.stringify(record));
});
' "$scheduler_id" "$age_ms"
}

_staleness_redis() {
    compose_exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning "$@"
}

# Backdate every freshness schedule's completion so the next boot must take the
# stale-completion branch. Call while the stack is UP, immediately before stop.
force_recurring_completion_staleness() {
    local aged=0
    local entry scheduler_id max_age key raw updated age_ms aged_at
    local state_entries=()

    # Never inherit a previous attempt's state: the assertion treats the file's
    # presence as proof the ageing happened.
    rm -f "$(staleness_state_file)"

    if [ -z "${REDIS_PASSWORD:-}" ]; then
        log_error "REDIS_PASSWORD is not set; cannot age recurring completions"
        return 1
    fi

    for entry in "${UPGRADE_STALENESS_SCHEDULES[@]}"; do
        # schedulerId itself contains colons, so split on the LAST one only.
        scheduler_id="${entry%:*}"
        max_age="${entry##*:}"
        # encodeURIComponent escapes the colons in the scheduler id.
        key="${UPGRADE_STALENESS_KEY_PREFIX}:$(printf '%s' "$scheduler_id" | sed 's/:/%3A/g')"

        raw="$(_staleness_redis --raw GET "$key" 2>/dev/null || true)"
        if [ -z "$raw" ]; then
            log_warning "No completion record for $scheduler_id; it has not run yet, so there is nothing to age"
            continue
        fi

        age_ms=$((max_age + UPGRADE_STALENESS_MARGIN_MS))
        if ! updated="$(printf '%s' "$raw" | age_heartbeat_record_json "$scheduler_id" "$age_ms")"; then
            log_error "Could not age the completion record for $scheduler_id"
            return 1
        fi

        if ! _staleness_redis SET "$key" "$updated" PX "$UPGRADE_STALENESS_KEY_TTL_MS" >/dev/null; then
            log_error "Failed to write the aged completion record for $scheduler_id"
            return 1
        fi

        # Record what we actually wrote rather than recomputing it later: the
        # assertion compares this exact instant against the worker's boot time.
        aged_at="$(printf '%s' "$updated" | node -e 'let r="";process.stdin.on("data",(c)=>(r+=c)).on("end",()=>process.stdout.write(String(JSON.parse(r).lastCompletedAt)))')"
        state_entries+=("{\"schedulerId\":\"${scheduler_id}\",\"agedTo\":${aged_at},\"maxAgeMs\":${max_age}}")

        log_info "Aged $scheduler_id completion to ${age_ms}ms old (maxAge ${max_age}ms) so the restart must see it stale"
        aged=$((aged + 1))
    done

    if [ "$aged" -eq 0 ]; then
        log_error "No recurring completion records were aged"
        log_error "The upgrade lane cannot exercise the restart-staleness path #657 fixed."
        log_error "Either the worker never completed a scheduled run before the stop, or the"
        log_error "heartbeat key format changed (expected ${UPGRADE_STALENESS_KEY_PREFIX}:<schedulerId>)."
        return 1
    fi

    # Written only on success, so a missing state file is itself a failure
    # signal for the assertion rather than an ambiguous empty result.
    local IFS=,
    if ! printf '{"schedules":[%s]}' "${state_entries[*]}" > "$(staleness_state_file)"; then
        log_error "Could not record the staleness state to $(staleness_state_file)"
        return 1
    fi

    return 0
}

# Decide whether the restart demonstrably entered the #657 branch.
#
# Pure: takes the state JSON written before the stop ($1) and the worker's
# /metrics payload ($2), prints "OK ..." or "FAIL ...". Separated from the HTTP
# and compose plumbing so the verdict logic is unit-testable against synthetic
# payloads instead of only against a 60-minute lane.
evaluate_staleness_verdict() {
    node -e '
const [stateRaw, metricsRaw] = process.argv.slice(1);
const fail = (m) => { console.log(`FAIL ${m}`); process.exit(0); };

let state;
try {
  state = JSON.parse(stateRaw);
} catch (error) {
  fail(`staleness state is not JSON (was the completion ever aged?): ${error.message}`);
}
const planted = Array.isArray(state?.schedules) ? state.schedules : [];
if (planted.length === 0) fail("no completion was aged before the restart, so the lane proves nothing");

let metrics;
try {
  metrics = JSON.parse(metricsRaw);
} catch (error) {
  fail(`/metrics is not JSON: ${error.message}`);
}

const schedules = metrics?.recurringSchedules;
if (!schedules) fail("/metrics carried no recurringSchedules block");
// The #657 outcome itself: a stale pre-restart completion must not leave the
// worker unhealthy, because the backend aborts startup on that.
if (schedules.healthy !== true) {
  fail(`worker reports recurring schedules unhealthy: stale=${JSON.stringify(schedules.stale)} heartbeatHealthy=${schedules.heartbeatHealthy}`);
}

const startedAtRaw = metrics?.worker?.startedAt;
const bootMs = Date.parse(startedAtRaw ?? "");
if (!Number.isFinite(bootMs)) fail(`/metrics carried no usable worker.startedAt (got ${JSON.stringify(startedAtRaw)})`);

const times = schedules.completionTimes || {};
const exercised = [];
const problems = [];
for (const { schedulerId, agedTo, maxAgeMs } of planted) {
  const staleByMs = bootMs - agedTo;
  if (!(staleByMs > maxAgeMs)) {
    problems.push(`${schedulerId}: planted completion was only ${staleByMs}ms old at boot, not past maxAge ${maxAgeMs}ms`);
    continue;
  }
  // Guard against the record having been dropped rather than read: whatever the
  // worker reports must be either the value we planted (not re-run yet) or a
  // post-boot completion (re-run after booting stale). A pre-boot value we did
  // not write would mean our record never reached the worker.
  const observed = times[schedulerId];
  if (typeof observed !== "number") {
    problems.push(`${schedulerId}: worker reports no completion at all, so the planted record was lost`);
    continue;
  }
  if (observed !== agedTo && observed < bootMs) {
    problems.push(`${schedulerId}: worker reports a pre-boot completion ${observed} that we did not plant (expected ${agedTo} or >= ${bootMs})`);
    continue;
  }
  const recovered = observed >= bootMs ? "recovered after boot" : "not yet re-run";
  exercised.push(`${schedulerId}(stale by ${Math.round(staleByMs / 1000)}s > ${maxAgeMs / 1000}s at boot, ${recovered})`);
}

if (exercised.length === 0) fail(`no schedule booted with an already-stale completion: ${problems.join("; ")}`);
console.log(`OK ${exercised.join(" ")}`);
' "$1" "$2"
}
