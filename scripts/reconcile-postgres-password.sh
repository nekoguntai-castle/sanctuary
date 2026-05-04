#!/bin/bash
#
# Reconcile a running Sanctuary Postgres role password with the runtime env.
# This validates the app-relevant TCP path through the Compose service name,
# because localhost checks inside the Postgres container can be false positives.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SANCTUARY_PROJECT_DIR:-$(dirname "$SCRIPT_DIR")}"

GREEN="${GREEN:-\\033[0;32m}"
YELLOW="${YELLOW:-\\033[1;33m}"
NC="${NC:-\\033[0m}"

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    echo "Error: POSTGRES_PASSWORD is required for PostgreSQL password reconciliation." >&2
    exit 1
fi

get_compose_project_name() {
    if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
        echo "$COMPOSE_PROJECT_NAME"
    else
        basename "$PROJECT_DIR"
    fi
}

find_existing_postgres_container() {
    local project_name container_id
    project_name="$(get_compose_project_name)"

    container_id=$(docker ps -q \
        --filter "label=com.docker.compose.project=${project_name}" \
        --filter "label=com.docker.compose.service=postgres" \
        | head -n 1)

    if [ -z "$container_id" ]; then
        container_id=$(docker ps -aq \
            --filter "label=com.docker.compose.project=${project_name}" \
            --filter "label=com.docker.compose.service=postgres" \
            | head -n 1)
    fi

    echo "$container_id"
}

is_container_running() {
    local container_id="$1"

    [ -n "$container_id" ] || return 1

    [ "$(docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null || echo "false")" = "true" ]
}

wait_for_postgres_ready() {
    local container_id="$1"
    local max_wait="${POSTGRES_RECONCILE_WAIT_SECONDS:-60}"
    local waited=0
    local status=""

    [ -n "$container_id" ] || return 1

    while [ "$waited" -lt "$max_wait" ]; do
        status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo "missing")"

        case "$status" in
            healthy|none)
                return 0
                ;;
            missing)
                return 1
                ;;
        esac

        sleep 2
        waited=$((waited + 2))
    done

    return 1
}

get_container_env_value() {
    local container_id="$1"
    local key="$2"

    [ -n "$container_id" ] || return 1
    [ -n "$key" ] || return 1

    docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" 2>/dev/null \
        | sed -n "s/^${key}=//p" \
        | tail -n 1
}

validate_postgres_password() {
    local container_id="$1"
    local password="$2"
    local db_user="${POSTGRES_USER:-sanctuary}"
    local db_name="${POSTGRES_DB:-sanctuary}"
    local result=""

    [ -n "$container_id" ] || return 1
    [ -n "$password" ] || return 1

    result=$(docker exec \
        -e "PGPASSWORD=$password" \
        "$container_id" \
        psql -w -h postgres -U "$db_user" -d "$db_name" -tAc "SELECT 1" 2>/dev/null || true)

    [ "$result" = "1" ]
}

escape_sql_literal() {
    printf "%s" "$1" | sed "s/'/''/g"
}

escape_sql_identifier() {
    printf "%s" "$1" | sed 's/"/""/g'
}

run_local_postgres_command() {
    local container_id="$1"
    local password="$2"
    local sql="$3"
    local db_user="${POSTGRES_USER:-sanctuary}"
    local db_name="${POSTGRES_DB:-sanctuary}"

    [ -n "$container_id" ] || return 1
    [ -n "$sql" ] || return 1

    if [ -n "$password" ]; then
        docker exec \
            -e "PGPASSWORD=$password" \
            "$container_id" \
            psql -w -h 127.0.0.1 -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 -c "$sql" \
            >/dev/null 2>&1
    else
        docker exec \
            "$container_id" \
            psql -w -h 127.0.0.1 -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 -c "$sql" \
            >/dev/null 2>&1
    fi
}

sync_postgres_password_to_runtime_env() {
    local container_id="$1"
    local db_user="${POSTGRES_USER:-sanctuary}"
    local escaped_user
    local escaped_password
    local container_password=""
    local sql

    [ -n "$container_id" ] || return 1

    escaped_user="$(escape_sql_identifier "$db_user")"
    escaped_password="$(escape_sql_literal "$POSTGRES_PASSWORD")"
    sql="ALTER USER \"$escaped_user\" WITH PASSWORD '$escaped_password';"
    container_password="$(get_container_env_value "$container_id" "POSTGRES_PASSWORD" || true)"

    if run_local_postgres_command "$container_id" "" "$sql"; then
        return 0
    fi

    if [ -n "$container_password" ] && [ "$container_password" != "$POSTGRES_PASSWORD" ] \
        && run_local_postgres_command "$container_id" "$container_password" "$sql"; then
        return 0
    fi

    docker exec \
        -u postgres \
        "$container_id" \
        psql -d postgres -v ON_ERROR_STOP=1 -c "$sql" \
        >/dev/null 2>&1
}

reconcile_postgres_password_with_running_database() {
    local container_id

    container_id="$(find_existing_postgres_container)"
    [ -n "$container_id" ] || return 0

    if ! is_container_running "$container_id"; then
        return 0
    fi

    if ! wait_for_postgres_ready "$container_id"; then
        echo -e "${YELLOW}Warning: PostgreSQL did not become ready for password reconciliation.${NC}"
        echo "  Startup may still fail if the database credentials are out of sync."
        echo ""
        return 0
    fi

    if validate_postgres_password "$container_id" "$POSTGRES_PASSWORD"; then
        return 0
    fi

    echo -e "${YELLOW}Warning: runtime POSTGRES_PASSWORD does not match the running PostgreSQL database.${NC}"
    echo "  Updating the database user password to match the current runtime env before startup."

    if sync_postgres_password_to_runtime_env "$container_id" \
        && validate_postgres_password "$container_id" "$POSTGRES_PASSWORD"; then
        echo -e "${GREEN}✓${NC} PostgreSQL password synchronized with runtime configuration"
    else
        echo -e "${YELLOW}Warning: could not synchronize the PostgreSQL password automatically.${NC}"
        echo "  Startup may still fail if the database credentials are out of sync."
    fi

    echo ""
}

reconcile_postgres_password_with_running_database
