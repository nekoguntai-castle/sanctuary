#!/usr/bin/env bash
# Read-only wallet-sync diagnostics.
#
# Run this on the box where wallets are stuck. It only SELECTs and reads Redis
# keys — it never writes, deletes, resyncs, or restarts anything.
#
#   ./scripts/diagnose-wallet-sync.sh > sync-diagnosis.txt 2>&1
#
# See docs/plans/sync-failure-visibility.md §2 for how to read the output.
#
# FAIL-CLOSED CONTRACT. Every section either prints real data or prints
# "(UNREACHABLE — could not query)". It must never print a clean-looking
# negative it did not actually establish, and it exits non-zero if any section
# could not run. During the 2026-08-20 incident an earlier version printed
# "(none held)" / "(none matched)" after reaching nothing at all and exited 0,
# which ruled out the hypothesis that was true.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

# ---------------------------------------------------------------------------
# Environment. docker compose auto-loads only ./.env, but start.sh keeps the
# secrets in an external runtime file, and docker-compose.yml uses the
# fail-hard ${VAR:?} form. Without this the whole script reaches nothing.
# Precedence mirrors start.sh:27-36.
# ---------------------------------------------------------------------------
if [ -z "${SANCTUARY_DIAGNOSE_SKIP_ENV:-}" ]; then
  RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}"
  ENV_FILE="${SANCTUARY_ENV_FILE:-$RUNTIME_DIR/sanctuary.env}"
  [ -f "$ENV_FILE" ] || ENV_FILE="$REPO_DIR/.env"
  [ -f "$ENV_FILE" ] || ENV_FILE="$REPO_DIR/.env.local"
  if [ -f "$ENV_FILE" ]; then
    echo "# env file: $ENV_FILE"
    set -a
    # shellcheck disable=SC1090 -- operator-supplied runtime env path
    . "$ENV_FILE"
    set +a
  else
    echo "# env file: NOT FOUND (looked for \$SANCTUARY_ENV_FILE, $RUNTIME_DIR/sanctuary.env, ./.env, ./.env.local)"
    echo "# docker compose will fail to interpolate required secrets."
  fi
fi

PG_SERVICE="${PG_SERVICE:-postgres}"
REDIS_SERVICE="${REDIS_SERVICE:-redis}"
PG_USER="${PG_USER:-sanctuary}"
PG_DB="${PG_DB:-sanctuary}"
QUEUE_PREFIX="${QUEUE_PREFIX:-sanctuary:worker:sync}"
# Overridable so the test suite does not pay two real seconds per lock.
LOCK_SETTLE_SECONDS="${SANCTUARY_DIAGNOSE_LOCK_SETTLE_SECONDS:-2}"

FAILED_SECTIONS=()

note_failure() { FAILED_SECTIONS+=("$1"); }

unreachable() {
  echo "(UNREACHABLE — could not query: $1)"
  note_failure "$1"
}

# `</dev/null` is load-bearing, not defensive. `docker compose exec -T` attaches
# stdin, so without it a call inside a `while read` loop swallows the rest of
# the loop's input and the loop ends after one iteration. That is why an
# earlier version reported one lock on a box holding three.
redis_q() {
  if [ -n "${REDIS_PASSWORD:-}" ]; then
    docker compose exec -T "$REDIS_SERVICE" redis-cli -a "$REDIS_PASSWORD" --no-auth-warning "$@" </dev/null
  else
    docker compose exec -T "$REDIS_SERVICE" redis-cli "$@" </dev/null
  fi
}

# SQL comes in on stdin as a quoted heredoc. `psql -c '... ''x'' ...'` does NOT
# escape a quote in bash: inside a single-quoted string '' closes and reopens
# the quote, so ''retrying'' collapses to bare retrying and psql reports
# `column "retrying" does not exist`. Sections C and D failed that way for the
# entire life of the previous version.
psql_sql() {
  docker compose exec -T "$PG_SERVICE" psql -U "$PG_USER" -d "$PG_DB" -X -P pager=off -f -
}

hr() { printf '\n===== %s =====\n' "$1"; }

# Run a query read from stdin; on failure say so instead of printing nothing.
#
# SQL always arrives via a QUOTED heredoc (<<'SQL'), never as a bash string
# literal. Inside a single-quoted bash string '' does not escape a quote - it
# closes and reopens - so ''resyncing'' becomes bare resyncing. That silently
# broke sections C and D and is what tests/scripts/diagnoseWalletSync.test.ts
# now pins.
section_psql() {
  local label="$1"
  local sql out
  sql="$(cat)"
  if out="$(printf '%s\n' "$sql" | psql_sql 2>&1)" && ! printf '%s' "$out" | grep -qi '^ERROR:\|error while interpolating'; then
    printf '%s\n' "$out"
  else
    printf '%s\n' "$out" >&2
    unreachable "$label"
  fi
}

hr "A. generation drift + sync state (start here)"
section_psql "A" <<'SQL'
SELECT id, name, network, "lastSyncStatus", "syncInProgress", "lastSyncedAt",
       "requestedFullResyncGeneration" AS req,
       "processedFullResyncGeneration" AS proc,
       "requestedFullResyncGeneration" - "processedFullResyncGeneration" AS drift,
       left("lastSyncError", 200) AS err
FROM wallets
ORDER BY drift DESC, "lastSyncedAt" NULLS FIRST;
SQL

hr "B. did the destructive reset run? (tx_count=0 means history was deleted)"
section_psql "B" <<'SQL'
SELECT w.id, w.name, w."lastSyncStatus", w."syncInProgress", w."lastSyncedAt",
       count(t.id) AS tx_count
FROM wallets w
LEFT JOIN transactions t ON t."walletId" = w.id
GROUP BY w.id, w.name, w."lastSyncStatus", w."syncInProgress", w."lastSyncedAt"
ORDER BY tx_count ASC;
SQL

hr "C. stranded orphan states (cleared flag, orphan status, no reason)"
section_psql "C" <<'SQL'
SELECT id, name, "lastSyncStatus", "syncInProgress", "lastSyncedAt", left("lastSyncError",200) AS err
FROM wallets
WHERE "lastSyncStatus" IN ('resyncing','retrying')
  AND "syncInProgress" = false;
SQL

hr "D. reassuring-green-badge wallets (status=success but long stale)"
section_psql "D" <<'SQL'
SELECT id, name, "lastSyncStatus", "lastSyncedAt", now() - "lastSyncedAt" AS age
FROM wallets
WHERE "lastSyncStatus" = 'success' AND "lastSyncedAt" < now() - interval '1 hour'
ORDER BY age DESC;
SQL

hr "E. network distribution (regtest rows are excluded from every network resync)"
section_psql "E" <<'SQL'
SELECT network, count(*) FROM wallets GROUP BY network ORDER BY 2 DESC;
SQL

hr "F. redis: queue depth"
for k in delayed active completed failed wait prioritized; do
  printf '%-12s ' "$k"
  if out="$(redis_q ZCARD "${QUEUE_PREFIX}:${k}" 2>/dev/null)" && [ -n "$out" ]; then
    printf '%s\n' "$out" | tr -d '\r'
  elif out="$(redis_q LLEN "${QUEUE_PREFIX}:${k}" 2>/dev/null)" && [ -n "$out" ]; then
    printf '%s\n' "$out" | tr -d '\r'
  else
    printf '(UNREACHABLE)\n'
    note_failure "F:$k"
  fi
done
echo "NOTE: 'failed' and 'completed' saturate at removeOnFail/removeOnComplete."
echo "      A value of exactly 250 or 10 is a retention cap, not a count."

hr "G. redis: delayed jobs (a full-resync stuck here with atm=0 confirms the pin)"
if out="$(redis_q ZRANGE "${QUEUE_PREFIX}:delayed" 0 -1 WITHSCORES 2>&1)"; then
  if [ -z "$out" ]; then echo "(empty — no delayed jobs)"; else printf '%s\n' "$out"; fi
else
  printf '%s\n' "$out" >&2
  unreachable "G"
fi

hr "H. redis: deduplication keys (TTL -1 = persistent; these block full resync)"
if DEDUP_KEYS="$(redis_q --scan --pattern "${QUEUE_PREFIX}:de:*" 2>&1)"; then
  if [ -z "$DEDUP_KEYS" ]; then
    echo "(none — scan succeeded and returned no dedup keys)"
  else
    while IFS= read -r key; do
      [ -z "$key" ] && continue
      ttl=$(redis_q TTL "$key" 2>/dev/null | tr -d '\r')
      jobid=$(redis_q GET "$key" 2>/dev/null | tr -d '\r')
      exists=$(redis_q EXISTS "${QUEUE_PREFIX}:${jobid}" 2>/dev/null | tr -d '\r')
      atm=$(redis_q HGET "${QUEUE_PREFIX}:${jobid}" atm 2>/dev/null | tr -d '\r')
      ts=$(redis_q HGET "${QUEUE_PREFIX}:${jobid}" timestamp 2>/dev/null | tr -d '\r')
      echo "key=$key ttl=$ttl job=$jobid job_hash_exists=$exists attemptsMade=${atm:-?} timestamp=${ts:-?}"
      printf '  decoded: '
      printf '%s' "$jobid" | tr '_-' '/+' | base64 -d 2>/dev/null || echo "(not base64)"
      echo
    done <<< "$DEDUP_KEYS"
  fi
else
  printf '%s\n' "$DEDUP_KEYS" >&2
  unreachable "H"
fi

hr "I. redis: wallet sync locks"
# Verdict note: a decaying PTTL does NOT by itself prove an orphan. The worker
# refreshes at ~ttl/3 (jobProcessor.ts), but the API in-process path
# (walletSync.ts) never calls extendLock at all, so a live API-path sync also
# decays. Compare the magnitude against the TTL instead of trusting the slope.
if LOCKS="$(redis_q --scan --pattern '*lock*sync:wallet*' 2>&1)"; then
  if [ -z "$LOCKS" ]; then
    echo "(none — scan succeeded and returned no lock keys)"
  else
    while IFS= read -r key; do
      [ -z "$key" ] && continue
      p1=$(redis_q PTTL "$key" 2>/dev/null | tr -d '\r')
      [ "$LOCK_SETTLE_SECONDS" != "0" ] && sleep "$LOCK_SETTLE_SECONDS"
      p2=$(redis_q PTTL "$key" 2>/dev/null | tr -d '\r')
      verdict="decaying — holder is not refreshing (worker-orphan, or a live API-path sync)"
      if [ "${p2:-0}" -gt "${p1:-0}" ] 2>/dev/null; then
        verdict="RISING — a live worker holder is refreshing it; a sync is running or hung"
      fi
      echo "$key pttl1=$p1 pttl2=$p2 -> $verdict"
    done <<< "$LOCKS"
  fi
else
  printf '%s\n' "$LOCKS" >&2
  unreachable "I"
fi

hr "J. worker logs (last 2h)"
if out="$(docker compose logs --since 2h "${WORKER_SERVICE:-worker}" 2>&1)"; then
  matched="$(printf '%s\n' "$out" | grep -E \
    "Reset stuck syncInProgress|lock held|Prepared full resync|synced successfully|sync failed|Auto-unstuck|Safety-net|Lost distributed lock|Redis lock (release|extension|acquisition) failed|Failed to extend lock|Syncing wallet|Rejected unauthenticated|Rejected incomplete address-history" \
    | tail -80)"
  if [ -z "$matched" ]; then
    echo "(logs read successfully; no lines matched the filter)"
  else
    printf '%s\n' "$matched"
  fi
else
  printf '%s\n' "$out" >&2
  unreachable "J"
fi

hr "K. api logs (last 2h) — in-memory activeSyncs leak signature"
echo "NOTE: 'Could not acquire lock for wallet' is logged at debug; needs LOG_LEVEL=debug."
if out="$(docker compose logs --since 2h "${API_SERVICE:-backend}" 2>&1)"; then
  matched="$(printf '%s\n' "$out" | grep -E \
    "already syncing, skipping queue|Sync already in progress|Could not acquire lock for wallet" | tail -30)"
  if [ -z "$matched" ]; then
    echo "(logs read successfully; no lines matched the filter)"
  else
    printf '%s\n' "$matched"
  fi
else
  printf '%s\n' "$out" >&2
  unreachable "K"
fi

echo
if [ ${#FAILED_SECTIONS[@]} -gt 0 ]; then
  echo "INCOMPLETE. Sections that could not be queried: ${FAILED_SECTIONS[*]}"
  echo "Do NOT read a missing section as a negative result."
  exit 1
fi

echo "Done — every section queried successfully."
echo "Interpretation guide: docs/plans/sync-failure-visibility.md section 2."
