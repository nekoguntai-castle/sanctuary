#!/usr/bin/env bash
# Wait for a lane's migration container to finish, then for its backend to
# answer. This helper keeps migration waiting consistent across callers and can be
# tested against a stubbed docker.
#
# It was previously an inline `bash -c` string, and carried a defect that the
# inline form made effectively untestable (#741): the lookup ran
#
#     docker compose ps migrate --format '{{.Status}}'
#
# without `--all`. `docker compose ps` lists only *running* containers, and
# migrate is a one-shot that exits as soon as it finishes, so the loop waited for
# a state it could never observe. Every attempt reported `not_found`, the loop
# always exhausted its 60 attempts, and the lane paid 300s before continuing.
#
# Worse than the time: the failure branch was unreachable. A migration that
# exited non-zero looked exactly like one that succeeded -- the loop timed out
# either way and the lane carried on -- so `Migration failed:` and its log dump
# never ran.
#
# Attempt counts and intervals are overridable so the tests do not sleep for
# five minutes.
#
# Usage: wait-for-migration.sh <workspace>

set -uo pipefail

WORKSPACE="${1:?usage: wait-for-migration.sh <workspace>}"

MIGRATION_ATTEMPTS="${SANCTUARY_MIGRATION_ATTEMPTS:-60}"
MIGRATION_INTERVAL="${SANCTUARY_MIGRATION_INTERVAL:-5}"
BACKEND_ATTEMPTS="${SANCTUARY_BACKEND_ATTEMPTS:-30}"
BACKEND_INTERVAL="${SANCTUARY_BACKEND_INTERVAL:-2}"

cd "$WORKSPACE"
if [ -f "$WORKSPACE/scripts/ownership/producer-hooks.sh" ]; then
    # shellcheck source=scripts/ownership/producer-hooks.sh
    . "$WORKSPACE/scripts/ownership/producer-hooks.sh"
    SANCTUARY_PROJECT_DIR="$WORKSPACE"
    SANCTUARY_PROJECT="${SANCTUARY_PROJECT:-${COMPOSE_PROJECT_NAME:-sanctuary-e2e}}"
    export SANCTUARY_PROJECT_DIR SANCTUARY_PROJECT
    ownership_initialize_build_identity
fi

# --all is load-bearing: without it an exited one-shot is invisible.
migrate_status() {
    docker compose ps --all migrate --format '{{.Status}}' 2>/dev/null
}

echo "Waiting for migration container to finish..."
migration_seen=false
for i in $(seq 1 "$MIGRATION_ATTEMPTS"); do
    full_status="$(migrate_status)"
    status="$(printf '%s' "$full_status" | grep -oE '^[A-Za-z]+' || echo 'not_found')"

    if [ "$status" = "Exited" ]; then
        migration_seen=true
        if printf '%s' "$full_status" | grep -q '(0)'; then
            echo "Migration completed successfully"
        else
            echo "Migration failed: $full_status"
            docker compose logs --tail 50 migrate || true
            exit 1
        fi
        break
    fi

    echo "Waiting for migration... (attempt $i/$MIGRATION_ATTEMPTS, status: $status)"
    sleep "$MIGRATION_INTERVAL"
done

# Distinguish "finished" from "gave up". The old loop could not tell these
# apart, which is how a lane whose migrate container never appeared still
# reported its way to the next phase.
if [ "$migration_seen" != "true" ]; then
    echo "Migration container never reached Exited after ${MIGRATION_ATTEMPTS} attempts" >&2
    docker compose ps --all || true
    exit 1
fi

# Backend readiness stays advisory, exactly as before. If it never answers the
# lane's own test runs next and fails with far better context than a bare
# timeout here would give. Deliberately not upgraded to a hard failure: that
# would move where backend problems surface, which is a separate change from
# #741.
echo "Waiting for backend to be healthy..."
for i in $(seq 1 "$BACKEND_ATTEMPTS"); do
    if docker compose exec backend wget -q -O - http://localhost:3001/health >/dev/null 2>&1; then
        echo "Backend is healthy"
        break
    fi
    echo "Waiting for backend... (attempt $i/$BACKEND_ATTEMPTS)"
    sleep "$BACKEND_INTERVAL"
done
