#!/usr/bin/env bash
# Regression: two concurrent local integration runs must not collide.
#
# docker/compose/test.yml pinned container_name on every service, so a second
# run from another worktree attached to or destroyed the first run's database
# (sanctuary#714). The port was already overridable — "${TEST_POSTGRES_PORT:-55433}"
# — which made the isolation look handled when only half of it was.
#
# The failure is silent: a fixed container_name does not produce a name-in-use
# error the way a bound port does. You get a confusing test failure instead,
# which reads as flakiness. sanctuary#612 shows what that misdiagnosis costs.
#
# CI is unaffected (each job has its own container namespace); this is local
# developer ergonomics, and the reason to guard it is that the symptom points
# away from the cause.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="$REPO_ROOT/docker/compose/test.yml"
RUNNER="$REPO_ROOT/scripts/run-integration-tests.sh"

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

[ -r "$COMPOSE" ] || { echo "FATAL: missing $COMPOSE" >&2; exit 1; }
[ -r "$RUNNER" ]  || { echo "FATAL: missing $RUNNER" >&2; exit 1; }

# --- 1. no service pins a container name -------------------------------------
# Compose namespaces containers by project when container_name is absent. Any
# reintroduction re-opens the collision for every service that carries it.
pinned="$(grep -nE '^[[:space:]]*container_name:' "$COMPOSE")"
if [ -z "$pinned" ]; then
    ok 'no service in docker/compose/test.yml pins container_name'
else
    bad 'container_name is pinned again — concurrent local runs will collide:'
    printf '%s\n' "$pinned" | sed 's/^/    /' >&2
fi

# --- 2. the runner does not hardcode a container name ------------------------
if grep -qE '^[[:space:]]*TEST_DB_CONTAINER=("|'"'"')?sanctuary-' "$RUNNER"; then
    bad 'run-integration-tests.sh hardcodes a container name again'
else
    ok 'run-integration-tests.sh does not hardcode a container name'
fi

# --- 3. the runner resolves the container through compose --------------------
# Resolving by project is what makes the name irrelevant. Without this the
# absence of container_name would simply break the health probe instead.
if grep -qE 'compose .*ps( |.*)-q|ps -q' "$RUNNER"; then
    ok 'run-integration-tests.sh resolves the db container via compose ps -q'
else
    bad 'run-integration-tests.sh must resolve the container via compose, not a fixed name'
fi

# --- 4. a per-checkout project name is derived and exported ------------------
if grep -q 'COMPOSE_PROJECT_NAME' "$RUNNER"; then
    ok 'run-integration-tests.sh sets COMPOSE_PROJECT_NAME'
else
    bad 'run-integration-tests.sh must set COMPOSE_PROJECT_NAME to isolate runs'
fi

# --- 5. the derivation is actually distinct per checkout path ----------------
# A derivation that returns the same value for two paths isolates nothing. Run
# the runner's own helper rather than reimplementing it here.
if grep -q 'default_compose_project_name' "$RUNNER"; then
    a="$(bash -c '
        set -uo pipefail
        SANCTUARY_TEST_SOURCE_ONLY=1
        export SANCTUARY_TEST_SOURCE_ONLY
        source "'"$RUNNER"'" 2>/dev/null || true
        default_compose_project_name /home/someone/sanctuary
    ' 2>/dev/null)"
    b="$(bash -c '
        set -uo pipefail
        SANCTUARY_TEST_SOURCE_ONLY=1
        export SANCTUARY_TEST_SOURCE_ONLY
        source "'"$RUNNER"'" 2>/dev/null || true
        default_compose_project_name /tmp/worktrees/sanctuary
    ' 2>/dev/null)"

    if [ -z "$a" ] || [ -z "$b" ]; then
        bad "could not evaluate default_compose_project_name (a='$a' b='$b')"
    elif [ "$a" = "$b" ]; then
        bad "two checkout paths derive the same project name ('$a') — no isolation"
    else
        ok "distinct checkouts derive distinct project names ($a vs $b)"
    fi

    # Compose project names must be lowercase alphanumeric, underscore or
    # hyphen, starting with a letter or digit. An invalid name fails at
    # `docker compose up`, long after the developer has stopped looking here.
    if printf '%s' "$a" | grep -qE '^[a-z0-9][a-z0-9_-]*$'; then
        ok "derived project name is compose-legal ($a)"
    else
        bad "derived project name is not compose-legal: '$a'"
    fi

    # Same path twice must be stable, or cleanup targets the wrong project.
    a2="$(bash -c '
        SANCTUARY_TEST_SOURCE_ONLY=1
        export SANCTUARY_TEST_SOURCE_ONLY
        source "'"$RUNNER"'" 2>/dev/null || true
        default_compose_project_name /home/someone/sanctuary
    ' 2>/dev/null)"
    if [ "$a" = "$a2" ]; then
        ok 'derivation is stable for the same path'
    else
        bad "derivation is not stable ('$a' then '$a2')"
    fi
else
    bad 'run-integration-tests.sh must expose default_compose_project_name'
fi

# --- 6. an explicit COMPOSE_PROJECT_NAME still wins --------------------------
if grep -qE 'COMPOSE_PROJECT_NAME:?[-=]' "$RUNNER" || grep -q '\${COMPOSE_PROJECT_NAME:-' "$RUNNER"; then
    ok 'an explicit COMPOSE_PROJECT_NAME is respected'
else
    bad 'COMPOSE_PROJECT_NAME must be overridable, not forced'
fi

echo
echo "===================="
echo "Passed: $PASS"
echo "Failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "integration compose isolation checks passed"
