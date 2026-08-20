#!/usr/bin/env bash
# Read-only wallet-sync diagnostics.
#
# Run this on the box where wallets are stuck. It only SELECTs and reads Redis
# keys — it never writes, deletes, resyncs, or restarts anything.
#
#   ./scripts/diagnose-wallet-sync.sh > sync-diagnosis.txt
#
# See docs/plans/sync-failure-visibility.md §2 for how to read the output.

set -uo pipefail

PG_SERVICE="${PG_SERVICE:-postgres}"
REDIS_SERVICE="${REDIS_SERVICE:-redis}"
PG_USER="${PG_USER:-sanctuary}"
PG_DB="${PG_DB:-sanctuary}"
QUEUE_PREFIX="${QUEUE_PREFIX:-sanctuary:worker:sync}"

psql_q() { docker compose exec -T "$PG_SERVICE" psql -U "$PG_USER" -d "$PG_DB" -X -P pager=off "$@"; }

redis_q() {
  if [ -n "${REDIS_PASSWORD:-}" ]; then
    docker compose exec -T "$REDIS_SERVICE" redis-cli -a "$REDIS_PASSWORD" --no-auth-warning "$@"
  else
    docker compose exec -T "$REDIS_SERVICE" redis-cli "$@"
  fi
}

hr() { printf '\n===== %s =====\n' "$1"; }

hr "A. generation drift + sync state (start here)"
psql_q -c '
SELECT id, name, network, "lastSyncStatus", "syncInProgress", "lastSyncedAt",
       "requestedFullResyncGeneration" AS req,
       "processedFullResyncGeneration" AS proc,
       "requestedFullResyncGeneration" - "processedFullResyncGeneration" AS drift,
       left("lastSyncError", 200) AS err
FROM wallets
ORDER BY drift DESC, "lastSyncedAt" NULLS FIRST;'

hr "B. did the destructive reset run? (tx_count=0 means history was deleted)"
psql_q -c '
SELECT w.id, w.name, w."lastSyncStatus", w."syncInProgress", w."lastSyncedAt",
       count(t.id) AS tx_count
FROM wallets w
LEFT JOIN transactions t ON t."walletId" = w.id
GROUP BY w.id, w.name, w."lastSyncStatus", w."syncInProgress", w."lastSyncedAt"
ORDER BY tx_count ASC;'

hr "C. stranded orphan states (cleared flag, orphan status, no reason)"
psql_q -c '
SELECT id, name, "lastSyncStatus", "syncInProgress", "lastSyncedAt", left("lastSyncError",200) AS err
FROM wallets
WHERE "lastSyncStatus" IN (''resyncing'',''retrying'')
  AND "syncInProgress" = false;'

hr "D. reassuring-green-badge wallets (status=success but long stale)"
psql_q -c '
SELECT id, name, "lastSyncStatus", "lastSyncedAt", now() - "lastSyncedAt" AS age
FROM wallets
WHERE "lastSyncStatus" = ''success'' AND "lastSyncedAt" < now() - interval ''1 hour''
ORDER BY age DESC;'

hr "E. network distribution (regtest rows are excluded from every network resync)"
psql_q -c 'SELECT network, count(*) FROM wallets GROUP BY network ORDER BY 2 DESC;'

hr "F. redis: queue depth"
for k in delayed active completed failed wait prioritized; do
  printf '%-12s ' "$k"
  redis_q EXISTS "${QUEUE_PREFIX}:${k}" >/dev/null 2>&1
  redis_q ZCARD "${QUEUE_PREFIX}:${k}" 2>/dev/null || redis_q LLEN "${QUEUE_PREFIX}:${k}" 2>/dev/null || echo "n/a"
done

hr "G. redis: delayed jobs (a full-resync stuck here with atm=0 confirms the pin)"
redis_q ZRANGE "${QUEUE_PREFIX}:delayed" 0 -1 WITHSCORES

hr "H. redis: deduplication keys (TTL -1 = persistent; these block full resync)"
DEDUP_KEYS=$(redis_q --scan --pattern "${QUEUE_PREFIX}:de:*" 2>/dev/null)
if [ -z "$DEDUP_KEYS" ]; then
  echo "(none — no wallet is dedup-blocked)"
else
  while IFS= read -r key; do
    [ -z "$key" ] && continue
    ttl=$(redis_q TTL "$key" 2>/dev/null | tr -d '\r')
    jobid=$(redis_q GET "$key" 2>/dev/null | tr -d '\r')
    exists=$(redis_q EXISTS "${QUEUE_PREFIX}:${jobid}" 2>/dev/null | tr -d '\r')
    atm=$(redis_q HGET "${QUEUE_PREFIX}:${jobid}" atm 2>/dev/null | tr -d '\r')
    ts=$(redis_q HGET "${QUEUE_PREFIX}:${jobid}" timestamp 2>/dev/null | tr -d '\r')
    echo "key=$key ttl=$ttl job=$jobid job_hash_exists=$exists attemptsMade=${atm:-?} timestamp=${ts:-?}"
    # decode the base64url job id back to the readable name
    printf '  decoded: '
    printf '%s' "$jobid" | tr '_-' '/+' | base64 -d 2>/dev/null || echo "(not base64)"
    echo
  done <<< "$DEDUP_KEYS"
fi

hr "I. redis: wallet sync locks (rising PTTL on re-read = a LIVE hung sync)"
LOCKS=$(redis_q --scan --pattern '*lock*sync:wallet*' 2>/dev/null)
if [ -z "$LOCKS" ]; then
  echo "(none held)"
else
  while IFS= read -r key; do
    [ -z "$key" ] && continue
    p1=$(redis_q PTTL "$key" 2>/dev/null | tr -d '\r')
    sleep 2
    p2=$(redis_q PTTL "$key" 2>/dev/null | tr -d '\r')
    verdict="orphaned (will self-heal)"
    if [ "${p2:-0}" -gt "${p1:-0}" ] 2>/dev/null; then verdict="LIVE HOLDER — hung sync"; fi
    echo "$key pttl1=$p1 pttl2=$p2 -> $verdict"
  done <<< "$LOCKS"
fi

hr "J. worker logs (last 2h)"
docker compose logs --since 2h "${WORKER_SERVICE:-worker}" 2>/dev/null | grep -E \
  "Reset stuck syncInProgress|lock held|Prepared full resync|synced successfully|sync failed|Auto-unstuck|Safety-net" \
  | tail -60 || echo "(none matched)"

hr "K. api logs (last 2h) — in-memory activeSyncs leak signature"
docker compose logs --since 2h "${API_SERVICE:-backend}" 2>/dev/null | grep -E \
  "already syncing, skipping queue|Sync already in progress" | tail -30 || echo "(none matched)"

echo
echo "Done. Interpretation guide: docs/plans/sync-failure-visibility.md section 2."
