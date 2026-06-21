#!/usr/bin/env bash
# Robust backend-integration database setup for CI.
#
# Replaces a bare `prisma migrate deploy` in the integration lanes. The Forgejo
# `services: postgres` health gate (`pg_isready`) can report ready before the
# database is usable, so a plain migrate sometimes exits 0 without leaving the
# schema in place — the tests then fail en masse with
# `table public.users does not exist`. This wrapper:
#
#   1. Waits for a real `SELECT 1` (not just `pg_isready`).
#   2. Runs `prisma migrate deploy`.
#   3. Asserts the schema actually landed (`to_regclass('public.users')`).
#   4. On a racy/incomplete apply, re-runs the migrate + assert pair (bounded),
#      and fails loudly with the resolved (redacted) URL if it still can't.
#
# Run from `server/` (the workflow sets working-directory: server). Reads
# DATABASE_URL / TEST_DATABASE_URL from the environment.
set -uo pipefail

# Resolve the sibling check helper from this script's own location so the
# script stays provider-agnostic (no GitHub-Actions-specific env vars — the
# leak gate, scripts/ci/check-provider-leaks.sh, forbids GITHUB_WORKSPACE here).
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
check="${script_dir}/check-integration-db.mjs"

wait_seconds="${SANCTUARY_DB_WAIT_SECONDS:-90}"
attempts="${SANCTUARY_DB_MIGRATE_ATTEMPTS:-3}"
table="${SANCTUARY_DB_ASSERT_TABLE:-users}"

if [[ ! "$attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::prepare-integration-db: SANCTUARY_DB_MIGRATE_ATTEMPTS must be a positive integer" >&2
  exit 2
fi

# 1) Real readiness gate.
if ! node "$check" wait --timeout="$wait_seconds"; then
  exit 1
fi

# 2-4) migrate + verify, retrying the pair on a missing schema.
for attempt in $(seq 1 "$attempts"); do
  echo "prepare-integration-db: prisma migrate deploy (attempt ${attempt}/${attempts})"
  npx prisma migrate deploy

  if node "$check" assert --table="$table"; then
    echo "prepare-integration-db: schema verified after attempt ${attempt}."
    exit 0
  fi

  if [ "$attempt" -lt "$attempts" ]; then
    echo "::warning::prepare-integration-db: schema missing after migrate attempt ${attempt}; retrying" >&2
    sleep $((attempt * 5))
  fi
done

echo "::error::prepare-integration-db: schema still missing after ${attempts} migrate attempt(s)" >&2
exit 1
