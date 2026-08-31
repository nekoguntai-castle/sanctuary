#!/usr/bin/env bash
# Read-only wallet-sync diagnostics. Shareable, pseudonymous output is the
# default. Raw identifiers require an explicit on-box opt-in.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$SCRIPT_DIR/ownership/producer-hooks.sh"

ENV_LOAD_FAILED=0
if [ -z "${SANCTUARY_DIAGNOSE_SKIP_ENV:-}" ]; then
  RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}"
  ENV_FILE="${SANCTUARY_ENV_FILE:-$RUNTIME_DIR/sanctuary.env}"
  [ -f "$ENV_FILE" ] || ENV_FILE="$REPO_DIR/.env"
  [ -f "$ENV_FILE" ] || ENV_FILE="$REPO_DIR/.env.local"
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090 -- operator-supplied runtime env path
    if . "$ENV_FILE" >/dev/null 2>&1; then
      echo "# environment loaded from configured runtime file"
    else
      echo "# environment file could not be loaded"
      ENV_LOAD_FAILED=1
    fi
    set +a
  else
    echo "# environment file: NOT FOUND"
    echo "# docker compose may fail to interpolate required secrets."
  fi
fi

if [ -n "${SANCTUARY_DIAGNOSE_SKIP_ENV:-}" ]; then
  SANCTUARY_PROJECT_DIR="$REPO_DIR"
  SANCTUARY_PROJECT="${SANCTUARY_PROJECT:-${COMPOSE_PROJECT_NAME:-sanctuary}}"
  export SANCTUARY_PROJECT_DIR SANCTUARY_PROJECT
  ownership_initialize_build_identity
else
  ownership_prepare_operator_compose "$REPO_DIR"
fi

PG_SERVICE="${PG_SERVICE:-postgres}"
REDIS_SERVICE="${REDIS_SERVICE:-redis}"
PG_USER="${PG_USER:-sanctuary}"
PG_DB="${PG_DB:-sanctuary}"
QUEUE_PREFIX="${QUEUE_PREFIX:-sanctuary:worker:sync}"
LOCK_SETTLE_SECONDS="${SANCTUARY_DIAGNOSE_LOCK_SETTLE_SECONDS:-2}"
INCLUDE_IDENTIFIERS="${SANCTUARY_DIAGNOSE_INCLUDE_IDENTIFIERS:-0}"
FAILED_SECTIONS=()

note_failure() { FAILED_SECTIONS+=("$1"); }
unreachable() { echo "(UNREACHABLE — could not query: $1)"; note_failure "$1"; }
[ "$ENV_LOAD_FAILED" = "1" ] && note_failure "environment"

print_failure_detail() {
  local detail="$1" permit_classification="${2:-0}"
  if [ "$INCLUDE_IDENTIFIERS" = "1" ]; then
    printf '%s\n' "$detail" >&2
  elif [ "$permit_classification" = "1" ]; then
    case "$detail" in
      '{"schemaVersion":1,"status":"unsupported"}'\
      |'{"schemaVersion":1,"status":"timeout"}'\
      |'{"schemaVersion":1,"status":"unavailable"}') printf '%s\n' "$detail" ;;
      *) echo "(command error detail redacted; rerun only on-box with raw opt-in if needed)" >&2 ;;
    esac
  else
    echo "(command error detail redacted; rerun only on-box with raw opt-in if needed)" >&2
  fi
}

redis_q() {
  if [ -n "${REDIS_PASSWORD:-}" ]; then
    docker compose exec -T "$REDIS_SERVICE" redis-cli -a "$REDIS_PASSWORD" --no-auth-warning "$@" </dev/null
  else
    docker compose exec -T "$REDIS_SERVICE" redis-cli "$@" </dev/null
  fi
}

psql_sql() {
  docker compose exec -T "$PG_SERVICE" psql -U "$PG_USER" -d "$PG_DB" -X -P pager=off -f -
}

hr() { printf '\n===== %s =====\n' "$1"; }

section_psql() {
  local label="$1" sql out
  sql="$(cat)"
  if out="$(printf '%s\n' "$sql" | psql_sql 2>&1)" && ! printf '%s' "$out" | grep -qi '^ERROR:\|error while interpolating'; then
    printf '%s\n' "$out"
  else
    print_failure_detail "$out"
    unreachable "$label"
  fi
}

# This one boundary owns every shareable byte from SQL, Redis, the diagnostics
# client, and container logs. UUIDs receive stable per-report references.
pseudonymize_report() {
  awk '
    function repeat_ere(atom, count, result, i) {
      result = ""
      for (i = 0; i < count; i++) result = result atom
      return result
    }
    function wallet_ref(raw) {
      if (!(raw in wallet_refs)) {
        wallet_count++
        wallet_refs[raw] = sprintf("wallet_ref_%03d", wallet_count)
      }
      return wallet_refs[raw]
    }
    BEGIN {
      hex = "[[:xdigit:]]"
      uuid_pattern = repeat_ere(hex, 8) "-" repeat_ere(hex, 4) "-[1-5]" repeat_ere(hex, 3) "-[89abAB]" repeat_ere(hex, 3) "-" repeat_ere(hex, 12)
      hash_pattern = repeat_ere(hex, 64)
      bech32_character = "[023456789acdefghjklmnpqrstuvwxyz]"
      bech32_pattern = "(bc1|tb1|bcrt1)" repeat_ere(bech32_character, 10) bech32_character "*"
      base58_character = "[1-9A-HJ-NP-Za-km-z]"
      base58_pattern = "[13mn2]" repeat_ere(base58_character, 25) base58_character "*"
      ipv4_octet = "[0-9][0-9]?[0-9]?"
      ipv4_pattern = ipv4_octet "\\." ipv4_octet "\\." ipv4_octet "\\." ipv4_octet
      onion_pattern = "[a-zA-Z0-9.-]+\\.onion(:[0-9][0-9]*)?"
      hostname_pattern = "[[:alnum:]][[:alnum:]-]*(\\.[[:alnum:]-]+)*\\.[[:alpha:]][[:alpha:]][[:alpha:]]*"
    }
    {
      line = $0
      gsub(/"(jobId|leaseToken|token|secret|password|credential)"[[:space:]]*:[[:space:]]*"[^"]*"/, "\"sensitive_identity\":\"<redacted>\"", line)
      while (match(line, uuid_pattern)) {
        raw = substr(line, RSTART, RLENGTH)
        line = substr(line, 1, RSTART - 1) wallet_ref(tolower(raw)) substr(line, RSTART + RLENGTH)
      }
      gsub(/key=[^[:space:]]+/, "key=<redacted_key>", line)
      gsub(/job=[^[:space:]]+/, "job=<redacted_job>", line)
      gsub(/jobId[=:][^[:space:],}]*/, "jobId=<redacted_job>", line)
      gsub(/lock:[^[:space:]]+/, "lock:<redacted_lock>", line)
      gsub(/lease(Token)?[=:][^[:space:],}]*/, "lease=<redacted_lease>", line)
      gsub(hash_pattern, "<redacted_hash>", line)
      gsub(bech32_pattern, "<redacted_address>", line)
      gsub(base58_pattern, "<redacted_address>", line)
      gsub(/https?:\/\/[^[:space:]|",;]+/, "<redacted_endpoint>", line)
      gsub(onion_pattern, "<redacted_endpoint>", line)
      gsub(ipv4_pattern, "<redacted_endpoint>", line)
      gsub(hostname_pattern, "<redacted_endpoint>", line)
      gsub(/"(error|message|name|hostname|endpoint)"[[:space:]]*:[[:space:]]*"[^"]*"/, "\"redacted_detail\":\"<redacted>\"", line)
      gsub(/(secret|password|token|credential)[=:][^[:space:]|",;]+/, "secret=<redacted>", line)
      print line
      fflush()
    }
  '
}

classify_sync_logs() {
  awk '
    /stage_started/ { print "event=stage_started"; next }
    /stage_completed/ { print "event=stage_completed"; next }
    /stage_failed/ { print "event=stage_failed"; next }
    /stage_aborted/ { print "event=stage_aborted"; next }
    /budget[._ -]*expir/ { print "event=budget_expired"; next }
    /fallback/ { print "event=fallback"; next }
    /abort[._ -]*grace/ { print "event=abort_grace"; next }
    /timed out|timeout/ { print "event=timeout"; next }
    /Lost distributed lock|lock ownership/ { print "event=lock_lost"; next }
    /cleanup outcome/ { print "event=cleanup"; next }
    /already syncing, skipping queue|Sync already in progress|Could not acquire lock for wallet|lock authority/ { print "event=ownership_contention"; next }
  '
}

collect_report() {
  hr "A. generation, claim, lease, retry, and action-required state"
  section_psql "A" <<'SQL'
SELECT id AS wallet_ref, network, "lastSyncStatus", "syncInProgress",
       "requestedIncrementalSyncGeneration" AS inc_req,
       "claimedIncrementalSyncGeneration" AS inc_claim,
       "processedIncrementalSyncGeneration" AS inc_proc,
       "requestedIncrementalSyncGeneration" - "processedIncrementalSyncGeneration" AS inc_drift,
       "requestedFullResyncGeneration" AS full_req,
       "preparedFullResyncGeneration" AS full_prepared,
       "processedFullResyncGeneration" AS full_proc,
       "requestedFullResyncGeneration" - "processedFullResyncGeneration" AS full_drift,
       COALESCE("syncExecutionOwner", 'none') AS owner,
       CASE WHEN "syncStartedAt" IS NULL THEN NULL ELSE now() - "syncStartedAt" END AS attempt_age,
       CASE WHEN "incrementalSyncClaimedAt" IS NULL THEN NULL ELSE now() - "incrementalSyncClaimedAt" END AS claim_age,
       "incrementalSyncLeaseExpiresAt" AS lease_expires_at,
       CASE WHEN "incrementalSyncLeaseExpiresAt" IS NULL THEN NULL
            ELSE "incrementalSyncLeaseExpiresAt" - now() END AS lease_remaining,
       CASE WHEN "claimedIncrementalSyncGeneration" <= "processedIncrementalSyncGeneration"
                 AND num_nonnulls("incrementalSyncLeaseToken", "incrementalSyncClaimedAt", "incrementalSyncLeaseExpiresAt") = 0 THEN 'none'
            WHEN "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
                 AND "incrementalSyncLeaseToken" IS NOT NULL
                 AND "incrementalSyncClaimedAt" IS NOT NULL
                 AND "incrementalSyncLeaseExpiresAt" > now() THEN 'active'
            WHEN "claimedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"
                 AND "incrementalSyncLeaseToken" IS NOT NULL
                 AND "incrementalSyncClaimedAt" IS NOT NULL
                 AND "incrementalSyncLeaseExpiresAt" <= now() THEN 'expired'
            ELSE 'incoherent' END AS lease_state,
       "syncRetryCount" AS retry_count, "syncNextRetryAt" AS next_retry_at,
       "syncActionRequiredAt" AS action_required_at
FROM wallets
ORDER BY id;
SQL

  hr "B. transaction-history state (zero can mean a destructive reset ran)"
  section_psql "B" <<'SQL'
SELECT w.id AS wallet_ref, w."lastSyncStatus", w."syncInProgress", w."lastSyncedAt",
       count(t.id) AS tx_count
FROM wallets w
LEFT JOIN transactions t ON t."walletId" = w.id
GROUP BY w.id, w."lastSyncStatus", w."syncInProgress", w."lastSyncedAt"
ORDER BY w.id;
SQL

  hr "C. stranded orphan states"
  section_psql "C" <<'SQL'
SELECT id AS wallet_ref, "lastSyncStatus", "syncInProgress", "lastSyncedAt",
       "lastSyncFailureClass" AS failure_class
FROM wallets
WHERE "lastSyncStatus" IN ('resyncing','retrying') AND "syncInProgress" = false;
SQL

  hr "D. stale success evidence"
  section_psql "D" <<'SQL'
SELECT id AS wallet_ref, "lastSyncStatus", "lastSyncedAt", now() - "lastSyncedAt" AS age
FROM wallets
WHERE "lastSyncStatus" = 'success' AND "lastSyncedAt" < now() - interval '1 hour'
ORDER BY id;
SQL

  hr "E. network distribution"
  section_psql "E" <<'SQL'
SELECT network, count(*) FROM wallets GROUP BY network ORDER BY 2 DESC;
SQL

  hr "F. authenticated sampled-worker execution snapshot"
  local snapshot_out
  if snapshot_out="$(docker compose exec -T "${API_SERVICE:-backend}" node dist/server/src/workerDiagnosticsCli.js 2>&1)"; then
    printf '%s\n' "$snapshot_out"
  else
    print_failure_detail "$snapshot_out" 1
    unreachable "F"
  fi

  hr "G. redis queue depth"
  local k out
  for k in delayed active completed failed wait prioritized; do
    printf '%-12s ' "$k"
    if out="$(redis_q ZCARD "${QUEUE_PREFIX}:${k}" 2>/dev/null)" && [ -n "$out" ]; then
      printf '%s\n' "$out" | tr -d '\r'
    elif out="$(redis_q LLEN "${QUEUE_PREFIX}:${k}" 2>/dev/null)" && [ -n "$out" ]; then
      printf '%s\n' "$out" | tr -d '\r'
    else
      printf '(UNREACHABLE)\n'
      note_failure "G:$k"
    fi
  done
  echo "NOTE: failed/completed values at retention caps are not total historical counts."

  hr "H. redis delayed and deduplication evidence"
  if out="$(redis_q ZRANGE "${QUEUE_PREFIX}:delayed" 0 -1 WITHSCORES 2>&1)"; then
    if [ -z "$out" ]; then echo "delayed: empty (query succeeded)"; else printf 'delayed: %s\n' "$out"; fi
  else
    print_failure_detail "$out"
    unreachable "H:delayed"
  fi
  local dedup_keys key ttl jobid exists atm ts
  if dedup_keys="$(redis_q --scan --pattern "${QUEUE_PREFIX}:de:*" 2>&1)"; then
    if [ -z "$dedup_keys" ]; then
      echo "deduplication: none (scan succeeded)"
    else
      while IFS= read -r key; do
        [ -z "$key" ] && continue
        if ! ttl="$(redis_q TTL "$key" 2>&1)" \
          || ! jobid="$(redis_q GET "$key" 2>&1)" \
          || ! exists="$(redis_q EXISTS "${QUEUE_PREFIX}:${jobid}" 2>&1)" \
          || ! atm="$(redis_q HGET "${QUEUE_PREFIX}:${jobid}" atm 2>&1)" \
          || ! ts="$(redis_q HGET "${QUEUE_PREFIX}:${jobid}" timestamp 2>&1)"; then
          print_failure_detail "${ttl:-}${jobid:-}${exists:-}${atm:-}${ts:-}"
          unreachable "H:dedup-detail"
          continue
        fi
        ttl="${ttl//$'\r'/}"; jobid="${jobid//$'\r'/}"; exists="${exists//$'\r'/}"
        atm="${atm//$'\r'/}"; ts="${ts//$'\r'/}"
        echo "key=$key ttl=$ttl job=$jobid job_hash_exists=$exists attemptsMade=${atm:-?} timestamp=${ts:-?}"
      done <<< "$dedup_keys"
    fi
  else
    print_failure_detail "$dedup_keys"
    unreachable "H:dedup"
  fi

  hr "I. redis wallet-sync locks"
  local locks p1 p2 verdict
  if locks="$(redis_q --scan --pattern '*lock*sync:wallet*' 2>&1)"; then
    if [ -z "$locks" ]; then
      echo "locks: none (scan succeeded)"
    else
      while IFS= read -r key; do
        [ -z "$key" ] && continue
        if ! p1="$(redis_q PTTL "$key" 2>&1)"; then
          print_failure_detail "$p1"
          unreachable "I:lock-detail"
          continue
        fi
        p1="${p1//$'\r'/}"
        [ "$LOCK_SETTLE_SECONDS" != "0" ] && sleep "$LOCK_SETTLE_SECONDS"
        if ! p2="$(redis_q PTTL "$key" 2>&1)"; then
          print_failure_detail "$p2"
          unreachable "I:lock-detail"
          continue
        fi
        p2="${p2//$'\r'/}"
        verdict="decaying — not proof of an orphan; API-path work also decays"
        if [ "${p2:-0}" -gt "${p1:-0}" ] 2>/dev/null; then
          verdict="rising — a worker holder refreshed the lock"
        fi
        echo "$key pttl1=$p1 pttl2=$p2 -> $verdict"
      done <<< "$locks"
    fi
  else
    print_failure_detail "$locks"
    unreachable "I"
  fi

  hr "J. worker typed sync lifecycle logs (last 2h)"
  if out="$(docker compose logs --since 2h "${WORKER_SERVICE:-worker}" 2>&1)"; then
    local matched
    matched="$(printf '%s\n' "$out" | classify_sync_logs | tail -120)"
    if [ -z "$matched" ]; then echo "logs read successfully; no typed lifecycle lines matched"; else printf '%s\n' "$matched"; fi
  else
    print_failure_detail "$out"
    unreachable "J"
  fi

  hr "K. api sync ownership logs (last 2h)"
  if out="$(docker compose logs --since 2h "${API_SERVICE:-backend}" 2>&1)"; then
    local api_matched
    api_matched="$(printf '%s\n' "$out" | classify_sync_logs | tail -60)"
    if [ -z "$api_matched" ]; then echo "logs read successfully; no ownership/lifecycle lines matched"; else printf '%s\n' "$api_matched"; fi
  else
    print_failure_detail "$out"
    unreachable "K"
  fi

  echo
  if [ ${#FAILED_SECTIONS[@]} -gt 0 ]; then
    echo "INCOMPLETE. Sections that could not be queried: ${FAILED_SECTIONS[*]}"
    echo "Do NOT read a missing section as a negative result."
    return 1
  fi

  echo "Done — every section queried successfully."
  echo "Interpretation guide: docs/plans/sync-failure-visibility.md section 2."
}

if [ "$INCLUDE_IDENTIFIERS" = "1" ]; then
  echo "NON-SHAREABLE: RAW IDENTIFIERS INCLUDED (on-box use only)"
  collect_report
  report_status=$?
  echo "NON-SHAREABLE: RAW IDENTIFIERS INCLUDED (on-box use only)"
  exit "$report_status"
fi

set +e
collect_report 2>&1 | pseudonymize_report
pipeline_status=("${PIPESTATUS[@]}")
set -e
if [ "${pipeline_status[1]}" -ne 0 ]; then
  echo "INCOMPLETE. The pseudonymization boundary failed; report output is invalid." >&2
  exit 1
fi
exit "${pipeline_status[0]}"
