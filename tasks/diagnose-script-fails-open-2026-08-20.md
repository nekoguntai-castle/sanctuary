# scripts/diagnose-wallet-sync.sh reports a clean box when it cannot reach anything

Status: plan, not yet implemented. Investigation date 2026-08-20.
Scope: `scripts/diagnose-wallet-sync.sh` (123 lines, zero test coverage).

Every claim below is cited `file:line`. Claims marked **[reproduced]** were executed in a
throwaway shell with a stub `docker` on `PATH`; no Docker daemon and no repo file was touched.

---

## Why this matters more than the sync bug it was written to diagnose

The script exists to answer one question from `docs/plans/sync-failure-visibility.md:611`:
is this hypothesis **B1** (a live hung lock pinning a full resync) or **B4** (a jobId
collision, which additionally implies a backup restore or Postgres rollback)? Three
sections carry that discrimination — G (delayed-ZSET membership), H (dedup keys with
`TTL == -1`), and I (a `PTTL` that rises back toward ~1,860,000 ms, per
`docs/plans/sync-failure-visibility.md:386`).

On the affected box, none of those three sections ran. All three printed the answer
"nothing found" anyway:

```
===== H. redis: deduplication keys (TTL -1 = persistent; these block full resync) =====
(none — no wallet is dedup-blocked)

===== I. redis: wallet sync locks (rising PTTL on re-read = a LIVE hung sync) =====
(none held)
```

**The wrong conclusion this invites, stated exactly:** an operator reading `(none held)`
concludes no lock is held, therefore B1 is ruled out, therefore the surviving hypothesis is
B4 — a jobId collision — whose remediation is to go looking for a backup restore or a
Postgres rollback that never happened. That is not a failure to confirm B1. It is an active
push toward an unrelated investigation, during a live incident, from an artefact that ends
with the word `Done.`

The script exited **0** **[reproduced]**. Any wrapper, cron, or support-bundle collector
that gates on `$?` treats a totally blind run as a healthy one.

A diagnostic that fails open is worse than no diagnostic: it launders absence of measurement
into evidence of absence, and it does so with a success-shaped footer
(`scripts/diagnose-wallet-sync.sh:122-123`).

---

## Confirmed defects

**[reproduced]** — full run under a stub `docker` that exits 1 with the real interpolation
error on stderr, `REDIS_PASSWORD` unset. `EXIT=0`. stdout was byte-identical in shape to the
operator's report. stderr held exactly **6** lines (sections A–E and G only).

| # | Defect | Evidence file:line | What the operator sees | What they should see |
|---|---|---|---|---|
| 1 | Env file never loaded; bare `docker compose` cannot interpolate `${VAR:?}` | `scripts/diagnose-wallet-sync.sh:19`, `:23`, `:25`, `:114`, `:119` vs `start.sh:23-36`, `start.sh:52-56`, `start.sh:125` | 5 interpolation errors on stderr, then eleven empty/negative sections | Fail fast before section A: "no runtime env file resolved / `WORKER_DIAGNOSTICS_SECRET` missing", exit non-zero |
| 2 | Sections A–E write their only error to stderr, which the documented capture discards | `scripts/diagnose-wallet-sync.sh:7` (`> sync-diagnosis.txt`), `:32`, `:42`, `:51`, `:58`, `:65` | Five headers with empty bodies in the shared file | `!! PROBE FAILED (rc=1)` plus the compose error, inside the captured file |
| 3 | Section F collapses 3 states into `n/a` — key absent, compose broken, Redis `NOAUTH` | `scripts/diagnose-wallet-sync.sh:71` | `delayed n/a` ×6 | `delayed 0 (key absent)` or `delayed PROBE FAILED: <stderr>` |
| 4 | Section F line 70 runs an `EXISTS` probe and throws the result away | `scripts/diagnose-wallet-sync.sh:70` (`>/dev/null 2>&1`) | nothing — the one probe that could distinguish absent from unreachable is discarded | delete it; dispatch on `TYPE` instead |
| 5 | Section G has no guard at all; a failed probe renders as an empty section | `scripts/diagnose-wallet-sync.sh:75` | blank body, byte-identical to zero delayed jobs (redis-cli raw mode emits 0 bytes for an empty `ZRANGE`) | `(zero delayed jobs — scan exited 0)` or an explicit failure marker |
| 6 | Section H asserts in prose that no wallet is dedup-blocked whenever the probe fails | `scripts/diagnose-wallet-sync.sh:78-80` | `(none — no wallet is dedup-blocked)` | `!! dedup status UNKNOWN — do not conclude anything about dedup blocking` |
| 7 | Section I prints `(none held)` for an unreachable Redis — the exact inverse inference | `scripts/diagnose-wallet-sync.sh:98-100` | `(none held)` | `!! NOT MEASURED — redis scan exited N. Lock state is UNKNOWN, not clean.` |
| 8 | Section I's PTTL verdict defaults benign, and lies in **both** directions | `scripts/diagnose-wallet-sync.sh:107-108` | `orphaned (will self-heal)` for empty, `-1`, `-2`, and error-string samples; `LIVE HOLDER` when only the *first* sample fails | distinct verdicts: `UNKNOWN`, `PERSISTENT — never expires`, `key vanished`, `INCONCLUSIVE` |
| 9 | Section I's 2-second window cannot observe a refresh that happens every ~620 s | `scripts/diagnose-wallet-sync.sh:105` vs `server/src/worker/workerJobQueue/jobProcessor.ts:207`, `server/src/worker/jobs/jobOptions.ts:13-15`, `server/src/config/envSections.ts:79` | `orphaned (will self-heal)` for a genuinely hung sync ~99.7 % of the time | `INCONCLUSIVE — sampled 2s, refresh interval ~620s; re-run with --watch` |
| 10 | **Sections H and I read only the FIRST key and silently drop the rest** | `scripts/diagnose-wallet-sync.sh:82-94`, `:102-110` (here-string loop wrapping stdin-consuming `docker compose exec -T`) | one lock reported on a box holding five | every key reported |
| 11 | Sections J/K print `(none matched)` identically for a grep miss and a docker failure | `scripts/diagnose-wallet-sync.sh:114-116`, `:119-120` | `(none matched)` | `!! UNAVAILABLE — 'docker compose logs worker' failed (rc=N). This section proves NOTHING.` |
| 12 | `REDIS_PASSWORD` is never in the script's own scope, so F–I stay broken even after defect 1 is fixed | `scripts/diagnose-wallet-sync.sh:22`, `:25` vs `docker-compose.yml:47`, `docker-compose.yml:52` | same reassuring negatives, one layer down | authenticated `redis-cli`, or a preflight abort |
| 13 | The script exits 0 no matter how much failed | `scripts/diagnose-wallet-sync.sh:122-123` | `Done. Interpretation guide: …`, `$? == 0` | summary of failed sections, `exit 1` |

### Defect 10 deserves separate attention — it is new and it survives every other fix

`scripts/diagnose-wallet-sync.sh:94` and `:110` feed the loops with `<<< "$DEDUP_KEYS"` /
`<<< "$LOCKS"`. Inside those loops, `redis_q` (`:84-88`, `:104`, `:106`) invokes
`docker compose exec -T`, and `-T` exists precisely so stdin is forwarded to the container.
The first iteration's `PTTL` call therefore consumes the remainder of the here-string, and
the loop ends after one key.

**[reproduced]** with a stdin-consuming stand-in:

```
--- with a stdin-consuming child (models docker compose exec -T) ---
iter key=k1
--- with </dev/null on the child ---
iter key=k1
iter key=k2
iter key=k3
```

Consequence: on a box with several wedged wallets, section I reports **one** lock and section
H reports **one** dedup key, with no indication that anything was skipped. This is a false
negative that a working Redis connection does not fix, and it is the cheapest defect in this
document to close: add `</dev/null` inside `psql_q` and `redis_q`.

### Two corrections to the working notes

- The claim that J/K's `|| echo "(none matched)"` "can never fire because the pipeline ends
  in `tail`" is **wrong**. `set -o pipefail` (`:11`) returns the rightmost *non-zero* status,
  which is grep's 1, so the `||` does fire. **[reproduced]**: `bash -c 'exit 42' | grep -E x |
  tail -3` → `rc=1`; `printf 'a\nb\n' | grep -E x | tail -3` → `rc=1`. The defect is worse
  than described: docker's own exit code (42) is *structurally unrecoverable* at the `||`,
  masked by grep before anything can branch on it. Splitting fetch from filter is mandatory,
  not stylistic.
- The wrong-service-name trigger for J/K is **latent, not live**. `grep -nE '^  [a-z0-9_-]+:'
  docker-compose.yml` confirms `backend:` at `:172` and `worker:` at `:317`, and there is only
  one compose file. The defaults `${WORKER_SERVICE:-worker}` / `${API_SERVICE:-backend}`
  (`:114`, `:119`) are correct.

---

## The immediate unblock (operator, today, no code change)

`docker compose` auto-loads only `./.env`. `start.sh:23-36` resolves a different file on a
standard install, and `start.sh:52-56` does `set -a; source "$ENV_FILE"; set +a` before any
compose call. Reproduce that in your own shell, then run the script unchanged. This is a
**sourced env**, not an inline `VAR=x docker compose` prefix, so it satisfies CLAUDE.md.

```bash
cd /path/to/sanctuary          # the directory containing docker-compose.yml

# start.sh:23-36 precedence, exactly
ENV_FILE="${SANCTUARY_ENV_FILE:-${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}/sanctuary.env}"
[ -f "$ENV_FILE" ] || ENV_FILE="./.env"
[ -f "$ENV_FILE" ] || ENV_FILE="./.env.local"
[ -f "$ENV_FILE" ] || { echo "FATAL: no runtime env file found" >&2; exit 78; }

set -a; . "$ENV_FILE"; set +a          # start.sh:52-56

# 2>&1 is REQUIRED today: sections A-E and G report failure only on stderr,
# and the header comment at :7 captures stdout alone.
./scripts/diagnose-wallet-sync.sh > sync-diagnosis.txt 2>&1
```

Sanity-check before trusting the output — if either line is wrong, the report is not evidence:

```bash
[ -n "${REDIS_PASSWORD:-}" ] && echo "REDIS_PASSWORD: present" || echo "REDIS_PASSWORD: MISSING"
docker compose config -q && echo "compose: interpolates OK"
```

Why sourcing and not `--env-file`: `--env-file` fixes compose interpolation only. The script
also reads `$REDIS_PASSWORD` in its own shell at `scripts/diagnose-wallet-sync.sh:22` to decide
whether to pass `-a`, and `docker-compose.yml:52` starts Redis with `--requirepass "$$REDIS_PASSWORD"`
unconditionally. With `--env-file` alone the variable reaches the container but not the calling
shell, the unauthenticated branch at `:25` is taken, and sections H and I print the same
reassuring negatives one layer down (defect 12).

**Even with this unblock, sections H and I still under-report** (defect 10) and section I's
verdict is still near-useless for a live hung sync (defects 8, 9). Treat a single reported
lock as "at least one", and cross-check section A's `syncInProgress` before believing
`orphaned (will self-heal)`.

`WORKER_DIAGNOSTICS_SECRET`, `LLM_EGRESS_PROXY_SECRET` and `GRAFANA_PASSWORD` are
auto-generated and persisted by `start.sh:108-122` on a normal start. If the file predates
that, the values are simply absent; running `./start.sh` once populates them.

---

## The fix

Principle throughout: **a reassuring string may be printed only on rc == 0 with empty
output.** Every section must still run even when an earlier one failed — a partial diagnosis
is useful; a silent one is not — but the process must exit non-zero.

Total change is ~40 net lines in one file. The script stays read-only and paste-back-able.

### Fix 1 — env-file resolution, in `scripts/diagnose-wallet-sync.sh`, before line 13

**Change.** `cd` to the repo root as `start.sh:21` does, resolve `ENV_FILE` with the exact
precedence of `start.sh:23-36`, `set -a; . "$ENV_FILE"; set +a`, and build a shared wrapper:

```bash
COMPOSE=(docker compose --env-file "$ENV_FILE" --project-directory "$REPO_ROOT" \
         -f "$REPO_ROOT/docker-compose.yml")
```

routed through by `psql_q` (`:19`), `redis_q` (`:23`, `:25`) and both `docker compose logs`
calls (`:114`, `:119`).

**Why this is the smallest correct one.** Sourcing alone would suffice for compose (compose
interpolates from the inherited process env — that is exactly how `start.sh` works today), and
`--env-file` alone would not suffice for the script's own `$REDIS_PASSWORD` read at `:22`.
Doing both costs one extra array element and removes any dependence on which mechanism the
reader assumes. No inline `VAR=x docker compose` prefix appears, per CLAUDE.md.

An explicit `SANCTUARY_ENV_FILE` must be honoured verbatim and must exist — never fall through
to `./.env`. Silently diagnosing against a different secret set is how you diagnose the wrong
box. `start.sh:35` deliberately falls through for a *creatable* path (it writes secrets); a
read-only diagnostic has no such need and should exit `78` (`EX_CONFIG`), which is
distinguishable from both "ran fine, found nothing" (0) and "probes failed" (1).

**Preflight, before section A.** `"${COMPOSE[@]}" config -q`; `ps` shows `postgres` and `redis`
up; `SELECT 1`; `redis-cli PING` returns `PONG`; `REDIS_PASSWORD` non-empty. Any failure →
loud banner naming the missing variable or service → `exit 78`. Every section depends on this,
and a partial run under a broken connection is precisely what produced the misleading report.
The seven variables that can abort compose interpolation, verified by
`grep -n ':?' docker-compose.yml`, are `REDIS_PASSWORD` (`:47`, `:212`, `:340`, `:424`),
`POSTGRES_PASSWORD` (`:99`, `:209`, `:337`, `:423`, `:486`), `JWT_SECRET` (`:215`, `:358`,
`:426`, `:606`), `ENCRYPTION_KEY` (`:224`, `:359`, `:427`), `ENCRYPTION_SALT` (`:225`, `:360`,
`:428`), `WORKER_DIAGNOSTICS_SECRET` (`:243`, `:346`, `:432`), `LLM_EGRESS_PROXY_SECRET`
(`:270`, `:715`). Derive the preflight list mechanically from that grep rather than hardcoding
it, so the check cannot drift from the compose file.

### Fix 2 — `exec 2>&1` immediately after line 11

**Change.** One line.

**Why.** The documented invocation at `:7` redirects stdout alone, and the only sections that
surface the compose error at all (A–E, G) write it to stderr. **[reproduced]**: the failing run
produced 6 stderr lines and a stdout capture containing none of them. This single line puts
every error into the artefact the operator pastes. It does not, on its own, fix anything —
the per-command `2>/dev/null` redirections at `:70`, `:71`, `:78`, `:84-88`, `:92`, `:98`,
`:104`, `:106`, `:114`, `:119` survive it — which is why Fix 3 is also required.

### Fix 3 — one `probe()` wrapper, and a `PROBE_FAILURES` counter

**Change.**

```bash
PROBE_FAILURES=0
probe() {                      # usage: probe VARNAME cmd...
  local __var=$1; shift
  local __err __out __rc
  __err=$(mktemp)
  __out=$("$@" 2>"$__err"); __rc=$?
  if [ "$__rc" -ne 0 ]; then
    PROBE_FAILURES=$((PROBE_FAILURES + 1))
    printf '!! PROBE FAILED (rc=%s): %s\n' "$__rc" "$*"
    sed 's/^/   /' "$__err"
  fi
  printf -v "$__var" '%s' "$__out"
  rm -f "$__err"
  return "$__rc"
}
```

Route all eleven probe sites through it. Keep stderr in a separate file rather than folding it
into the captured value with `2>&1` — a compose warning folded into `$LOCKS` would be
mis-parsed as a key.

**Why this is the smallest correct one.** There is no existing rc-checking wrapper to reuse:
every section today uses an ad-hoc construct (`|| echo "n/a"` at `:71`; `|| echo "(none matched)"`
at `:116`, `:120`; `$(… 2>/dev/null)` capture plus `[ -z … ]` at `:78-80` and `:98-100`), and all
of them conflate "probe failed" with "nothing found". One wrapper replaces three patterns and
makes the rule mechanically checkable in review.

Per-section empty tokens, printed **only** on rc == 0:

| Section | line | today | after |
|---|---|---|---|
| A–E | `:32`,`:42`,`:51`,`:58`,`:65` | *(blank)* | `(zero rows)` |
| F | `:71` | `n/a` | `0 (key absent)` / the actual count |
| G | `:75` | *(blank)* | `(zero delayed jobs — scan exited 0)` |
| H | `:80` | `(none — no wallet is dedup-blocked)` | `(scan OK, zero keys — no wallet is dedup-blocked)` |
| I | `:100` | `(none held)` | `(none held — scan exited 0, zero matching keys)` |
| J/K | `:116`,`:120` | `(none matched)` | `(none matched — logs read OK)` |

The wording change matters: each sentence now states a fact about the *measurement* as well as
about the system.

### Fix 4 — section F: delete line 70, dispatch on `TYPE`

**Change.** Replace `:70-71` with one rc-checked `TYPE` call per key, dispatching `zset`→`ZCARD`,
`list`→`LLEN`, `none`→`0 (key absent)`, anything else→print the type. On a transport failure,
`break` — one failure means all six will fail.

**Why.** `:70`'s `EXISTS` result is discarded by `>/dev/null 2>&1`, so the one probe that could
distinguish "absent" from "unreachable" contributes nothing. The `TYPE` dispatch is 1 spawn per
key instead of 3 (18 → 6), and it is what makes absent and unreachable visually distinct. Note
the cost today is 18 *process spawns*, not container round trips: compose aborts during
`${WORKER_DIAGNOSTICS_SECRET:?}` interpolation and never reaches the daemon, so the failure is
instant. The operator gets no latency cue that anything is wrong, which makes the six lies more
convincing, not less.

### Fix 5 — sections H and I: `</dev/null` on every in-loop probe

**Change.** Add `</dev/null` inside `psql_q` and `redis_q`. Optionally replace the here-strings
at `:94` and `:110` with a redirect from a temp file.

**Why.** Closes defect 10 at its source — one redirect in two functions fixes both loops and
every future loop, whereas patching the here-strings would leave the next caller exposed.
**[reproduced]** above.

### Fix 6 — section I: make the verdict honest, and the window long enough to mean anything

**Change.** Extract the verdict into a sourceable function `pttl_verdict p1 p2`, then:

1. Validate each sample before comparing — `case "$p" in ''|*[!0-9-]*) verdict="UNKNOWN — PTTL probe failed";; esac` —
   and **drop the `${p:-0}` defaults** at `:108` so a missing value can never masquerade as 0.
   Remove the `2>/dev/null` on the `[` so a residual type error is visible.
2. Distinct verdicts for `-1` (`PERSISTENT — no expiry, will NOT self-heal, needs manual
   intervention`) and `-2` (`key vanished between probes`).
3. Replace the fixed 2 s sleep at `:105`. Read the TTL first, derive the interval from it, and
   report `INCONCLUSIVE — sampled Ns, refresh interval ~Ms; re-run with --watch` when the window
   is shorter than the refresh interval. Add a `--watch` mode that polls until it sees a rise or
   the lock expires.
4. Because `server/src/services/sync/walletSync.ts:67` acquires `sync:wallet:<id>` and never
   extends it, a falling PTTL on the API-initiated path cannot distinguish orphaned from live.
   Label it `orphaned OR live-non-renewing — correlate with section A` and cross-check
   `syncInProgress`.

**Why this is the smallest correct one.** Defects 8 and 9 are one line and one `sleep`, but they
are the difference between a verdict and a coin flip. The arithmetic: lock TTL is
30 min + 60 s = 1,860,000 ms (`server/src/worker/jobs/jobOptions.ts:13-15` plus
`server/src/config/envSections.ts:79`), refreshed at
`Math.max(1, Math.min(lockTtlMs - 1, Math.floor(lockTtlMs / 3)))` ≈ 620,000 ms
(`server/src/worker/workerJobQueue/jobProcessor.ts:207`). A 2-second window catches a refresh
about 0.3 % of the time. `docs/plans/sync-failure-visibility.md:386` specifies the signal as a
PTTL "rising back toward ~1_860_000 ms on repeated reads" — two samples 2 s apart do not
implement that. Extraction into a function is what makes the whole thing testable without Redis.

**[reproduced]**, current behaviour:

```
empty/empty  -> orphaned (will self-heal)
-1/-1        -> orphaned (will self-heal)     # a lock that never expires
err/err      -> orphaned (will self-heal)     # [ rc=2, message suppressed by 2>/dev/null
empty/58000  -> LIVE HOLDER                   # false POSITIVE — ${p1:-0} substitutes 0
```

`-1` is defensive hardening rather than a live path: acquisition uses `SET … PX ttl NX`
(`server/src/infrastructure/distributedLock.ts:178-180`), extension uses `pexpire` (`:289`), and
there is no `PERSIST` anywhere in `server/src`. It costs one `case` arm.

### Fix 7 — sections J/K: split fetch from filter

**Change.**

```bash
logs_section() {                       # svc, pattern, tail_n
  local svc=$1 pattern=$2 n=$3 out
  if ! probe out "${COMPOSE[@]}" logs --since 2h "$svc"; then
    echo "!! UNAVAILABLE — 'docker compose logs $svc' failed. This section proves NOTHING."
    return 1
  fi
  local hits
  hits=$(printf '%s\n' "$out" | grep -E "$pattern" | tail -"$n")
  [ -n "$hits" ] && printf '%s\n' "$hits" || echo "(none matched — logs read OK)"
}
```

**Why the split is mandatory, not stylistic.** `pipefail` returns the rightmost non-zero status.
**[reproduced]**: `bash -c 'exit 42' | grep -E x | tail -3` → `rc=1`, and
`printf 'a\nb\n' | grep -E x | tail -3` → `rc=1`. Grep's 1 masks docker's 42 *before* the `||`
can see it. Dropping `2>/dev/null` while keeping one pipeline would surface the error text but
still leave the two cases indistinguishable to the script.

The service defaults are correct and need no change (`docker-compose.yml:172` `backend:`,
`:317` `worker:`). All nine grep patterns at `:115` and `:120` match real source strings —
verified: `Reset stuck syncInProgress`, `Prepared full resync`, `Safety-net`
(`server/src/worker/jobs/syncJobs.ts`); `lock held`
(`server/src/worker/workerJobQueue/jobProcessor.ts`); `synced successfully`
(`server/src/services/sync/syncCoordinator.ts`); `sync failed`
(`server/src/services/sync/walletSync.ts`); `Auto-unstuck`
(`server/src/services/sync/staleWalletChecker.ts`, `syncService.ts`);
`already syncing, skipping queue` (`server/src/services/sync/syncQueue.ts`);
`Sync already in progress` (`server/src/services/sync/syncService.ts`). One caveat worth a
comment in the script: `Auto-unstuck` originates in code reachable from both processes
(`server/src/worker.ts:322` schedules `check-stale-wallets`, while
`server/src/services/sync/syncService.ts:150` documents a backend fallback), so its absence
from section J alone is not proof it did not fire.

### Fix 8 — conditional footer and a load-bearing exit status

**Change.** Replace `:122-123` with a summary naming the failed sections and
`exit $(( PROBE_FAILURES > 0 ))`. Update the "Interpretation guide" pointer in
`docs/plans/sync-failure-visibility.md` §2 to describe the new `UNKNOWN` / `PROBE FAILED`
states, so a reader knows `(none held)` is now a positive measurement.

**Why.** The current unconditional `exit 0` certifies a run in which nothing was probed
**[reproduced]**. Without this, every other fix improves the text an operator might read past
and leaves automation just as deceived.

### Explicitly **not** changed — verified correct, do not "fix" these

- `QUEUE_PREFIX` default `sanctuary:worker:sync` (`:17`) is right:
  `server/src/services/workerSyncQueue.ts:23-24` sets prefix `sanctuary:worker` and queue name
  `sync`, applied at `:67-69`.
- The lock pattern `*lock*sync:wallet*` (`:98`) matches:
  `server/src/infrastructure/distributedLock.ts:178` writes `lock:${key}` and
  `server/src/services/sync/walletSync.ts:67` passes `sync:wallet:${walletId}`.
- The `:de:` dedup key shape, the `TTL -1 = persistent` reading, and the `atm` field are correct
  per `docs/plans/sync-failure-visibility.md:375`.
- All SQL identifiers at `:32-65`; service names `postgres`/`redis` (`docker-compose.yml:94`, `:43`).

---

## Non-regression test (write this FIRST)

CLAUDE.md: *"when a bug is encountered, write a non-regression test first, then fix it."*
`grep -rn diagnose-wallet-sync` across the repo matches **only the script's own file** — it has
never had a single test.

**Path:** `/home/nekoguntai/sanctuary/tests/scripts/diagnoseWalletSync.test.ts`

**Harness to copy:** `tests/ci/dockerExecTcpForwarder.test.ts:123-160`, which already
`mkdtempSync`es a bin dir, `writeFileSync`s an executable `docker` stub, `chmodSync(…, 0o755)`,
and passes `PATH: \`${mockBin}:${process.env.PATH ?? ""}\`` into `spawn`. For richer stubs, the
mode-switch pattern in `tests/ci/wait-for-docker.test.sh:20-60`
(`SANCTUARY_STUB_DOCKER_MODE=ready|delayed|down`) is the better model for failure modes.

**Shimming a failing `docker`:** write the stub into a temp dir, prepend it to `PATH`, and run
the real script with `spawnSync('bash', [scriptPath], { env: { ...process.env, PATH: stubDir + ':' + process.env.PATH } })`.
Delete `REDIS_PASSWORD` from the child env so the unauthenticated branch at `:22-25` is exercised.
Stub body for the incident case:

```bash
#!/usr/bin/env bash
echo "error while interpolating services.backend.environment.WORKER_DIAGNOSTICS_SECRET: required variable WORKER_DIAGNOSTICS_SECRET is missing a value" >&2
exit 1
```

**Assertions.** Assert on `result.stdout` **alone**, not on combined output — that mirrors the
documented `> sync-diagnosis.txt` at `:7` and is what makes defect 2 testable.

*Case 1 — docker fails (the reproduced incident).* This is the essential case; every assertion
below fails against the current script.
- `expect(result.status).not.toBe(0)`
- stdout **must contain**: a `PROBE FAILED` (or `UNAVAILABLE`) marker for **each** of the eleven
  sections A–K — asserting all eleven is what stops a fix that only hardens F/H/I from passing —
  and the string `WORKER_DIAGNOSTICS_SECRET`, proving the real cause reached the captured file.
- stdout **must NOT contain**, exactly:
  - `n/a`
  - `(none — no wallet is dedup-blocked)`  ← note U+2014 EM DASH, copy it from `:80`
  - `(none held)`
  - `(none matched)`
  - `orphaned (will self-heal)`
  - `Done. Interpretation guide`

*Case 2 — healthy but idle box* (stub exits 0, empty stdout). Asserts `status === 0` and that the
reassuring negatives **do** appear. This is what stops the fix over-correcting into
always-shouting, and it is not optional.

*Case 3 — env-file resolution.* Stub appends `"$@"` to a probe file. Assert `--env-file <path>`
appears and that no `VAR=value` prefix form is used (CLAUDE.md). Cover all four precedence
branches from `start.sh:23-36`: `SANCTUARY_ENV_FILE` set; `$SANCTUARY_RUNTIME_DIR/sanctuary.env`
present; `./.env`; `./.env.local`; none present → explicit error naming the searched paths, not a
silent bare `docker compose`. Add: `SANCTUARY_ENV_FILE` pointing at a nonexistent path is fatal,
never a fallback.

*Case 4 — PTTL verdicts, no Docker needed.* Source the extracted `pttl_verdict` and assert
`('' '')`, `('-1' '-1')`, `('-2' '-2')`, `('(error) NOAUTH…' '(error) NOAUTH…')`, `('58000' '')`,
`('' '58000')`, falling, and rising each map to a **distinct** verdict, and that no failure input
yields either the benign string or `LIVE HOLDER`.

*Case 5 — multi-key loops (defect 10).* Stub returns three keys from `--scan`. Assert all three
appear in section I's output. Fails today.

**Coverage threshold: this does NOT touch it.** Definitive. `config/tooling/vitest.config.ts:37`
sets `coverage.include: ['src/**/*.{ts,tsx}', 'shared/**/*.ts']`. A bash script under `scripts/`
is outside that set, so it contributes no instrumented lines and cannot move the 100 % thresholds
at `:79-82`. The test file itself lives under `tests/`, also outside the include set.

**CI registration: nothing to do.** `config/tooling/vitest.config.ts:33` sets
`include: ['tests/**/*.test.{ts,tsx}']`, so a `.ts` test under `tests/scripts/` is auto-discovered
by `npm run test:run`. The three hand-maintained registration lists in
`.github/workflows/quality.yml` (sweep block ~`:749`, execution block ~`:838`) and the guard in
`tests/ci/ci-registration-completeness.test.sh:81`, `:124`, `:204-213` all glob `*.test.sh` only —
they do not govern `.ts` files. Sibling `.ts` tests already live in `tests/ci/`
(`dockerExecTcpForwarder.test.ts` and four others) with no workflow entry.

*If you write it as `tests/ci/diagnose-wallet-sync.test.sh` instead*, registration becomes
mandatory or `ci-registration-completeness.test.sh` goes red: add `bash -n
tests/ci/diagnose-wallet-sync.test.sh` **and** `bash -n scripts/diagnose-wallet-sync.sh` to the
sweep block, and `bash tests/ci/diagnose-wallet-sync.test.sh` to the execution block. The `.ts`
path avoids this entirely and is recommended.

Add `bash -n "$SCRIPT"` as the first assertion either way.

---

## Other scripts with the same env-file bug

Enumerated by auditing every `docker compose` call site against `docker-compose.yml`'s
`${VAR:?}` interpolations. **`scripts/diagnose-wallet-sync.sh` is the only confirmed instance.**

Audited and cleared, with the reason each is safe:

| Script | Why it is fine |
|---|---|
| `scripts/ops/run-grafana-password-migration.sh` | invoked only from `start.sh` / `setup.sh`; inherits the exported env |
| `scripts/ci/wait-for-migration.sh`, `run-extended-upgrade-fixtures.sh`, `run-e2e-lane-phases.sh` | CI-only; the workflow supplies the env |
| `scripts/run-tests.sh`, `scripts/run-integration-tests.sh`, `package.json` `test:docker*` | target `docker/compose/test.yml`, which has no `:?` vars |
| `scripts/verify-addresses/*`, `scripts/verify-psbt/*`, `scripts/bitcoin-core-docker/*` | self-contained compose files |
| `scripts/offline/create-bundle.sh`, `scripts/secrets/migrate-runtime-secrets.sh`, `scripts/setup.sh` | already source the env file correctly (`setup.sh` uses `set -a`) |

**Honest limitation:** this enumeration was done by inspection of call sites, not by executing
each script against a bare environment. It is high-confidence for the scripts listed and does not
claim exhaustiveness for scripts added after 2026-08-20.

**Recommended follow-up, not required for this fix:** extract the resolver into
`scripts/lib/compose-env.sh` and have `diagnose-wallet-sync.sh` source it, so the next
operator-facing script inherits the correct behaviour by default rather than by discipline. Pair
it with a contract test deriving the required-variable list from
`grep -o '\${[A-Z_]*:?' docker-compose.yml`, so the preflight cannot drift from the compose file.

---

## Ruled out

- **`QUEUE_PREFIX` is wrong** — refuted; `server/src/services/workerSyncQueue.ts:23-24`, `:67-69` agree with `scripts/diagnose-wallet-sync.sh:17`.
- **The lock scan pattern misses the real key** — refuted; `distributedLock.ts:178` + `walletSync.ts:67` produce `lock:sync:wallet:<uuid>`, which `*lock*sync:wallet*` matches.
- **Wrong Redis db index** — refuted; `docker-compose.yml:212`/`:340` use `redis://…@redis:6379` with no db suffix, and `server/src/infrastructure/redis.ts` configures no `keyPrefix`, so keys are in db 0 where `redis-cli` looks.
- **Wrong service names in J/K** — refuted as a live trigger; `docker-compose.yml:172` and `:317` define `backend` and `worker`. Latent only for customised deploys.
- **Section J/K's `|| echo` can never fire because the pipeline ends in `tail`** — refuted **[reproduced]**; `pipefail` returns grep's rc 1 and the `||` does fire. The real defect is that docker's rc is masked by grep, which is worse.
- **A wrong queue prefix would be caught by the rc check** — refuted; a wrong prefix makes `SCAN` succeed with zero keys (rc 0). Only a positive liveness assertion (`PING` plus `DBSIZE`/`EXISTS "${QUEUE_PREFIX}:meta"`) distinguishes "scanned and found nothing" from "scanned the wrong keyspace". Fix 3 alone does not cover this; add the sanity line next to H's result.
- **NOAUTH silently blanks sections F and G too** — refuted for those two; ordinary `redis-cli` commands write error replies to **stdout**, so F prints the NOAUTH text before `n/a` and G prints it instead of a blank. Only `--scan` mode (`:78`, `:98`) writes to stderr and exits 1, which is why H and I are the silent ones. The pristine `n/a` in the operator's report is explained by defect 1 aborting compose before `redis-cli` ever ran; defect 12 is the *next* layer, latent until defect 1 is fixed.
- **PTTL `-1` is a live failure mode** — refuted as reachable through this codebase; acquisition is `SET … PX … NX` (`distributedLock.ts:178-180`), extension is `pexpire` (`:289`), and no `PERSIST` exists in `server/src`. Handle it as one-line defensive hardening for a manually-created key, not as an incident hypothesis.
