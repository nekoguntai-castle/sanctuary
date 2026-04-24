#!/bin/bash
#
# Sanctuary Setup Script
#
# The core setup script that handles all configuration:
# - Prerequisite checks (Docker, Docker Compose, OpenSSL)
# - Secret generation and runtime environment file creation
# - SSL certificate generation
# - Optional features (monitoring, Tor)
# - Service startup and health checking
# - Completion banners and backup reminders
#
# Usage:
#   ./scripts/setup.sh [options]
#
# Options:
#   --force              Overwrite existing runtime env without prompting
#   --non-interactive    Don't prompt for any input (use defaults or env vars)
#   --no-start           Don't start services after setup
#   --upgrade            Force clean rebuild of Docker images (no cache)
#   --enable-monitoring  Enable monitoring stack (Grafana/Loki/Promtail)
#   --enable-tor         Enable Tor proxy
#   --skip-ssl           Skip SSL certificate generation
#   --skip-prereqs       Skip prerequisite checks
#   --from-install       Called from install.sh (adjusts messaging)
#   --help               Show this help message
#
# Environment Variables:
#   Existing secrets (for upgrades - will be preserved):
#     JWT_SECRET, ENCRYPTION_KEY, ENCRYPTION_SALT, GATEWAY_SECRET, POSTGRES_PASSWORD
#
#   Configuration:
#     SANCTUARY_RUNTIME_DIR (default: ~/.config/sanctuary)
#     SANCTUARY_ENV_FILE (default: $SANCTUARY_RUNTIME_DIR/sanctuary.env)
#     SANCTUARY_SSL_DIR (default: $SANCTUARY_RUNTIME_DIR/ssl)
#     HTTPS_PORT, HTTP_PORT, GATEWAY_PORT (default: 8443, 8080, 4000)
#     ENABLE_MONITORING, ENABLE_TOR (yes/no)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEFAULT_RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}"
DEFAULT_ENV_FILE="$DEFAULT_RUNTIME_DIR/sanctuary.env"
LEGACY_ENV_FILE="$PROJECT_DIR/.env"
LEGACY_LOCAL_ENV_FILE="$PROJECT_DIR/.env.local"
DEFAULT_SSL_DIR="$DEFAULT_RUNTIME_DIR/ssl"
LEGACY_SSL_DIR="$PROJECT_DIR/docker/nginx/ssl"
LEGACY_DEFAULT_ENCRYPTION_SALT="sanctuary-node-config"

ENV_FILE="${SANCTUARY_ENV_FILE:-$DEFAULT_ENV_FILE}"
ENV_FILE_IS_LEGACY=false
if [ -z "${SANCTUARY_ENV_FILE:-}" ] && [ ! -f "$ENV_FILE" ] && [ -f "$LEGACY_ENV_FILE" ]; then
    ENV_FILE="$LEGACY_ENV_FILE"
    ENV_FILE_IS_LEGACY=true
fi

SSL_DIR="${SANCTUARY_SSL_DIR:-$DEFAULT_SSL_DIR}"
SSL_DIR_IS_LEGACY=false
if [ -z "${SANCTUARY_SSL_DIR:-}" ] \
    && [ ! -f "$SSL_DIR/fullchain.pem" ] \
    && [ ! -f "$SSL_DIR/privkey.pem" ] \
    && { [ -f "$LEGACY_SSL_DIR/fullchain.pem" ] || [ -f "$LEGACY_SSL_DIR/privkey.pem" ]; }; then
    SSL_DIR="$LEGACY_SSL_DIR"
    SSL_DIR_IS_LEGACY=true
fi

# ============================================
# Default Options
# ============================================
OPT_FORCE=false
OPT_NON_INTERACTIVE=false
OPT_NO_START=false
OPT_SKIP_SSL=false
OPT_SKIP_PREREQS=false
OPT_FROM_INSTALL=false
OPT_UPGRADE=false
OPT_ENABLE_MONITORING="${ENABLE_MONITORING:-}"
OPT_ENABLE_TOR="${ENABLE_TOR:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================
# Argument Parsing
# ============================================
show_help() {
    sed -n '/^# Usage:/,/^#$/p' "$0" | sed 's/^# //' | sed 's/^#//'
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            OPT_FORCE=true
            shift
            ;;
        --non-interactive)
            OPT_NON_INTERACTIVE=true
            shift
            ;;
        --no-start)
            OPT_NO_START=true
            shift
            ;;
        --enable-monitoring)
            OPT_ENABLE_MONITORING="yes"
            shift
            ;;
        --enable-tor)
            OPT_ENABLE_TOR="yes"
            shift
            ;;
        --skip-ssl)
            OPT_SKIP_SSL=true
            shift
            ;;
        --skip-prereqs)
            OPT_SKIP_PREREQS=true
            shift
            ;;
        --from-install)
            OPT_FROM_INSTALL=true
            shift
            ;;
        --upgrade)
            OPT_UPGRADE=true
            shift
            ;;
        --help|-h)
            show_help
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use --help for usage information."
            exit 1
            ;;
    esac
done

# ============================================
# Prerequisite Check Functions
# ============================================
PREREQ_ERRORS=""
PREREQ_WARNINGS=""

check_docker_installed() {
    if command -v docker &> /dev/null; then
        echo -e "${GREEN}✓${NC} Docker is installed"
        return 0
    else
        echo -e "${RED}✗${NC} Docker is not installed"
        PREREQ_ERRORS="${PREREQ_ERRORS}
  ${RED}Docker not installed${NC}
    Install Docker:
    - Windows/Mac: https://www.docker.com/products/docker-desktop
    - Linux: curl -fsSL https://get.docker.com | sh
"
        return 1
    fi
}

check_docker_access() {
    if ! command -v docker &> /dev/null; then
        return 1
    fi

    if docker info &> /dev/null; then
        echo -e "${GREEN}✓${NC} Docker daemon is accessible"
        return 0
    fi

    if [ -e /var/run/docker.sock ]; then
        echo -e "${RED}✗${NC} Cannot access Docker (permission denied)"
        if groups 2>/dev/null | grep -qw docker; then
            PREREQ_ERRORS="${PREREQ_ERRORS}
  ${RED}Docker group membership not active${NC}
    You are in the 'docker' group but it hasn't taken effect yet.
    Fix: Log out and back in, or run:
      newgrp docker
    Then run this script again.
"
        else
            PREREQ_ERRORS="${PREREQ_ERRORS}
  ${RED}User not in docker group${NC}
    Your user '$(whoami)' is not in the 'docker' group.
    Fix: Run these commands:
      sudo usermod -aG docker \$USER
      newgrp docker   # Or log out and back in
    Then run this script again.
"
        fi
        return 1
    else
        echo -e "${RED}✗${NC} Docker daemon is not running"
        PREREQ_ERRORS="${PREREQ_ERRORS}
  ${RED}Docker daemon not running${NC}
    The Docker service is not started.
    Fix: Start Docker:
      sudo systemctl start docker
      sudo systemctl enable docker  # Optional: start on boot
    Then run this script again.
"
        return 1
    fi
}

check_docker_compose() {
    if ! docker info &> /dev/null 2>&1; then
        return 1
    fi

    if docker compose version &> /dev/null; then
        local version=$(docker compose version --short 2>/dev/null || echo "unknown")
        echo -e "${GREEN}✓${NC} Docker Compose v2 is available (${version})"
        return 0
    else
        echo -e "${RED}✗${NC} Docker Compose v2 is not available"
        PREREQ_ERRORS="${PREREQ_ERRORS}
  ${RED}Docker Compose v2 not available${NC}
    Sanctuary requires Docker Compose v2 (the 'docker compose' command).
    Fix: Update Docker Desktop, or install the compose plugin:
      sudo apt-get update && sudo apt-get install docker-compose-plugin
"
        return 1
    fi
}

check_openssl() {
    if command -v openssl &> /dev/null; then
        echo -e "${GREEN}✓${NC} OpenSSL is available"
        return 0
    else
        echo -e "${YELLOW}⚠${NC} OpenSSL not found (optional)"
        PREREQ_WARNINGS="${PREREQ_WARNINGS}
  ${YELLOW}OpenSSL not installed${NC}
    SSL certificates cannot be generated without OpenSSL.
    HTTPS will not work, and hardware wallets require HTTPS.
    Fix: Install OpenSSL:
    - Linux: sudo apt install openssl
    - Mac: brew install openssl
"
        return 1
    fi
}

run_prerequisite_checks() {
    echo "Checking prerequisites..."
    echo ""

    # Run checks with || true to prevent set -e from exiting early
    # Errors are collected in PREREQ_ERRORS and shown at the end
    check_docker_installed || true
    check_docker_access || true
    check_docker_compose || true
    check_openssl || true

    echo ""

    if [ -n "$PREREQ_WARNINGS" ]; then
        echo -e "${YELLOW}Warnings:${NC}"
        echo -e "$PREREQ_WARNINGS"
    fi

    if [ -n "$PREREQ_ERRORS" ]; then
        echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
        echo -e "${RED}Prerequisites not met. Please fix these issues:${NC}"
        echo -e "$PREREQ_ERRORS"
        echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
        echo ""
        exit 1
    fi

    echo -e "${GREEN}All prerequisites met!${NC}"
    echo ""
}

# ============================================
# Secret Generation Functions
# ============================================
generate_secret() {
    if command -v openssl &> /dev/null; then
        openssl rand -base64 32 | tr -d '=/+' | head -c 48
    elif [ -f /dev/urandom ]; then
        cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c 48
    else
        echo "$(date +%s%N)$$" | sha256sum | head -c 48
    fi
}

generate_password() {
    if command -v openssl &> /dev/null; then
        openssl rand -base64 16 | tr -d '=/+' | head -c 24
    elif [ -f /dev/urandom ]; then
        cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c 24
    else
        echo "$(date +%s%N)$$" | sha256sum | head -c 24
    fi
}

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

get_container_env_value() {
    local container_id="$1"
    local key="$2"

    [ -n "$container_id" ] || return 1
    [ -n "$key" ] || return 1

    docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" 2>/dev/null \
        | sed -n "s/^${key}=//p" \
        | tail -n 1
}

get_container_network_name() {
    local container_id="$1"

    [ -n "$container_id" ] || return 1

    docker inspect --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$container_id" 2>/dev/null \
        | head -n 1
}

validate_postgres_password() {
    local container_id="$1"
    local password="$2"
    local db_user="${POSTGRES_USER:-sanctuary}"
    local db_name="${POSTGRES_DB:-sanctuary}"
    local network_name=""
    local result=""

    [ -n "$container_id" ] || return 1
    [ -n "$password" ] || return 1

    network_name="$(get_container_network_name "$container_id")"
    [ -n "$network_name" ] || return 1

    result=$(docker run --rm \
        --network "$network_name" \
        -e "PGPASSWORD=$password" \
        postgres:16-alpine \
        psql -w -h postgres -U "$db_user" -d "$db_name" -tAc "SELECT 1" 2>/dev/null || true)

    [ "$result" = "1" ]
}

escape_sql_literal() {
    printf "%s" "$1" | sed "s/'/''/g"
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
    local container_password=""
    local escaped_password

    [ -n "$container_id" ] || return 1

    escaped_password="$(escape_sql_literal "$POSTGRES_PASSWORD")"
    container_password="$(get_container_env_value "$container_id" "POSTGRES_PASSWORD" || true)"

    if run_local_postgres_command "$container_id" "" \
        "ALTER USER \"$db_user\" WITH PASSWORD '$escaped_password';"; then
        return 0
    fi

    if [ -n "$container_password" ] && [ "$container_password" != "$POSTGRES_PASSWORD" ] \
        && run_local_postgres_command "$container_id" "$container_password" \
            "ALTER USER \"$db_user\" WITH PASSWORD '$escaped_password';"; then
        return 0
    fi

    docker exec \
        -u postgres \
        "$container_id" \
        psql -d postgres -v ON_ERROR_STOP=1 -c "ALTER USER \"$db_user\" WITH PASSWORD '$escaped_password';" \
        >/dev/null 2>&1
}

reconcile_postgres_password_with_running_database() {
    local container_id

    container_id="$(find_existing_postgres_container)"
    [ -n "$container_id" ] || return 0

    if ! is_container_running "$container_id"; then
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

# ============================================
# Port Conflict Detection
# ============================================
check_port_conflict() {
    local port="$1"
    local name="$2"
    if command -v ss &> /dev/null; then
        if ss -tuln 2>/dev/null | grep -q ":${port} "; then
            echo -e "${YELLOW}Warning: $name port ${port} is already in use.${NC}"
            return 1
        fi
    elif command -v netstat &> /dev/null; then
        if netstat -tuln 2>/dev/null | grep -q ":${port} "; then
            echo -e "${YELLOW}Warning: $name port ${port} is already in use.${NC}"
            return 1
        fi
    fi
    return 0
}

check_all_ports() {
    local conflicts=false
    local https_port="${HTTPS_PORT:-8443}"
    local http_port="${HTTP_PORT:-8080}"
    local gateway_port="${GATEWAY_PORT:-4000}"

    check_port_conflict "$https_port" "HTTPS" || conflicts=true
    check_port_conflict "$http_port" "HTTP" || conflicts=true
    check_port_conflict "$gateway_port" "Gateway" || conflicts=true

    if [ "$OPT_ENABLE_MONITORING" = "yes" ]; then
        check_port_conflict "${GRAFANA_PORT:-3000}" "Grafana" || conflicts=true
    fi

    if [ "$conflicts" = true ]; then
        echo "  Set alternative ports via environment variables if Sanctuary fails to start."
        echo "  Example: HTTPS_PORT=9443 HTTP_PORT=9080 ./scripts/setup.sh"
        echo ""
    fi
}

# ============================================
# Optional Features Prompts
# ============================================
prompt_optional_features() {
    # Skip prompts in non-interactive mode
    if [ "$OPT_NON_INTERACTIVE" = true ]; then
        # Use defaults if not set (|| true prevents set -e exit when already set)
        [ -z "$OPT_ENABLE_MONITORING" ] && OPT_ENABLE_MONITORING="no" || true
        [ -z "$OPT_ENABLE_TOR" ] && OPT_ENABLE_TOR="no" || true
        return
    fi

    # Skip if not a terminal
    if [ ! -t 0 ]; then
        [ -z "$OPT_ENABLE_MONITORING" ] && OPT_ENABLE_MONITORING="no" || true
        [ -z "$OPT_ENABLE_TOR" ] && OPT_ENABLE_TOR="no" || true
        return
    fi

    # Monitoring prompt
    if [ -z "$OPT_ENABLE_MONITORING" ]; then
        echo -e "${BLUE}Optional Features${NC}"
        echo ""
        echo "Would you like to enable monitoring? (Grafana/Loki/Promtail)"
        echo "  - View logs and metrics in a web dashboard"
        echo "  - Uses ~500MB additional disk space and ~512MB RAM"
        echo ""
        read -p "Enable monitoring? [y/N] " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            OPT_ENABLE_MONITORING="yes"
            echo -e "${GREEN}✓${NC} Monitoring will be enabled"
        else
            OPT_ENABLE_MONITORING="no"
            echo -e "${GREEN}✓${NC} Monitoring skipped (run './start.sh --with-monitoring' later to enable)"
        fi
        echo ""
    fi

    # Tor prompt
    if [ -z "$OPT_ENABLE_TOR" ]; then
        echo "Would you like to enable the built-in Tor proxy?"
        echo "  - Route Electrum connections through Tor for privacy"
        echo "  - Hides your IP address from Electrum servers"
        echo "  - Uses ~50MB additional disk space and ~128MB RAM"
        echo ""
        read -p "Enable Tor? [y/N] " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            OPT_ENABLE_TOR="yes"
            echo -e "${GREEN}✓${NC} Tor proxy will be enabled"
        else
            OPT_ENABLE_TOR="no"
            echo -e "${GREEN}✓${NC} Tor skipped (run './start.sh --with-tor' later to enable)"
        fi
        echo ""
    fi
}

# ============================================
# SSL Certificate Generation
# ============================================
generate_ssl_certificates() {
    if [ ! -f "$SSL_DIR/fullchain.pem" ] || [ ! -f "$SSL_DIR/privkey.pem" ]; then
        echo -e "${GREEN}Generating SSL certificates...${NC}"
        if command -v openssl &> /dev/null; then
            mkdir -p "$SSL_DIR"
            chmod 755 "$SSL_DIR" 2>/dev/null || true
            chmod +x "$LEGACY_SSL_DIR/generate-certs.sh" 2>/dev/null || true
            if SANCTUARY_SSL_DIR="$SSL_DIR" bash "$LEGACY_SSL_DIR/generate-certs.sh" localhost; then
                echo -e "${GREEN}✓${NC} SSL certificates generated"
            else
                echo -e "${YELLOW}⚠${NC} Could not generate SSL certificates"
                echo "  Run manually: SANCTUARY_SSL_DIR=\"$SSL_DIR\" bash docker/nginx/ssl/generate-certs.sh localhost"
            fi
        else
            echo -e "${YELLOW}⚠${NC} OpenSSL not found - cannot generate SSL certificates"
            echo "  Install openssl and run: SANCTUARY_SSL_DIR=\"$SSL_DIR\" bash docker/nginx/ssl/generate-certs.sh localhost"
        fi
    else
        echo -e "${GREEN}✓${NC} SSL certificates already exist"
        chmod 644 "$SSL_DIR/privkey.pem" "$SSL_DIR/fullchain.pem" 2>/dev/null || true
    fi
    echo ""
}

# ============================================
# Secret Loading and Generation
# ============================================
load_or_generate_secrets() {
    # Check for .env.local migration (backwards compatibility)
    if [ -f "$LEGACY_LOCAL_ENV_FILE" ] && [ ! -f "$ENV_FILE" ]; then
        echo -e "${YELLOW}!${NC} Migrating secrets from .env.local to $ENV_FILE"
        set -a
        source "$LEGACY_LOCAL_ENV_FILE"
        set +a
    fi

    # Load existing runtime env if present
    if [ -f "$ENV_FILE" ]; then
        set -a
        source "$ENV_FILE"
        set +a
    fi

    # Use existing secrets from environment, or generate new ones
    echo -e "${GREEN}Configuring secrets...${NC}"

    local had_existing_encryption_key=false

    if [ -n "$JWT_SECRET" ]; then
        echo "  - JWT_SECRET: using existing"
    else
        JWT_SECRET=$(generate_secret)
        echo "  - JWT_SECRET: generated"
    fi

    if [ -n "$ENCRYPTION_KEY" ]; then
        had_existing_encryption_key=true
        echo "  - ENCRYPTION_KEY: using existing"
    else
        ENCRYPTION_KEY=$(generate_secret)
        echo "  - ENCRYPTION_KEY: generated"
    fi

    if [ -n "$ENCRYPTION_SALT" ]; then
        echo "  - ENCRYPTION_SALT: using existing"
    elif [ "$had_existing_encryption_key" = true ]; then
        ENCRYPTION_SALT="$LEGACY_DEFAULT_ENCRYPTION_SALT"
        echo "  - ENCRYPTION_SALT: using legacy default for existing encryption key"
    else
        ENCRYPTION_SALT=$(openssl rand -base64 16 2>/dev/null || generate_password)
        echo "  - ENCRYPTION_SALT: generated"
    fi

    if [ -n "$GATEWAY_SECRET" ]; then
        echo "  - GATEWAY_SECRET: using existing"
    else
        GATEWAY_SECRET=$(generate_secret)
        echo "  - GATEWAY_SECRET: generated"
    fi

    if [ -n "$POSTGRES_PASSWORD" ]; then
        echo "  - POSTGRES_PASSWORD: using existing"
    else
        POSTGRES_PASSWORD=$(generate_password)
        echo "  - POSTGRES_PASSWORD: generated"
    fi

    if [ -n "$AI_CONFIG_SECRET" ]; then
        echo "  - AI_CONFIG_SECRET: using existing"
    else
        AI_CONFIG_SECRET=$(openssl rand -hex 32 2>/dev/null || generate_secret)
        echo "  - AI_CONFIG_SECRET: generated"
    fi

    if [ -n "$REDIS_PASSWORD" ]; then
        echo "  - REDIS_PASSWORD: using existing"
    else
        REDIS_PASSWORD=$(generate_password)
        echo "  - REDIS_PASSWORD: generated"
    fi

    reconcile_postgres_password_with_running_database

    echo ""
}

# ============================================
# Runtime Env File Creation
# ============================================
write_env_file() {
    local https_port="${HTTPS_PORT:-8443}"
    local http_port="${HTTP_PORT:-8080}"
    local gateway_port="${GATEWAY_PORT:-4000}"

    local env_dir
    env_dir="$(dirname "$ENV_FILE")"
    mkdir -p "$env_dir"
    if [ "$env_dir" != "$PROJECT_DIR" ]; then
        chmod 700 "$env_dir" 2>/dev/null || true
    fi

    cat > "$ENV_FILE" << EOF
# Sanctuary Bitcoin Wallet - Environment Configuration
# Generated by setup.sh on $(date)
#
# IMPORTANT: Keep this file secure and never commit to version control

# ============================================
# REQUIRED SECRETS (auto-generated)
# ============================================

JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
ENCRYPTION_SALT=$ENCRYPTION_SALT
GATEWAY_SECRET=$GATEWAY_SECRET
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
AI_CONFIG_SECRET=$AI_CONFIG_SECRET
REDIS_PASSWORD=$REDIS_PASSWORD

# ============================================
# PORTS
# ============================================

HTTPS_PORT=$https_port
HTTP_PORT=$http_port
GATEWAY_PORT=$gateway_port

# Gateway TLS - enabled by default for secure mobile connections
GATEWAY_TLS_ENABLED=true

# ============================================
# OPTIONAL FEATURES
# ============================================

ENABLE_MONITORING=${OPT_ENABLE_MONITORING:-no}
ENABLE_TOR=${OPT_ENABLE_TOR:-no}

# ============================================
# BITCOIN NETWORK
# ============================================

# Options: mainnet, testnet, signet, regtest
BITCOIN_NETWORK=${BITCOIN_NETWORK:-mainnet}

# ============================================
# LOGGING
# ============================================

# Options: debug, info, warn, error
LOG_LEVEL=${LOG_LEVEL:-info}
EOF

    chmod 600 "$ENV_FILE" 2>/dev/null || true

    echo -e "${GREEN}✓${NC} Configuration saved to $ENV_FILE"

    # Clean up old .env.local if we migrated
    if [ -f "$LEGACY_LOCAL_ENV_FILE" ]; then
        rm -f "$LEGACY_LOCAL_ENV_FILE"
        echo -e "${GREEN}✓${NC} Cleaned up old .env.local"
    fi

    echo ""
}

export_runtime_environment() {
    export SANCTUARY_ENV_FILE="$ENV_FILE"
    export SANCTUARY_SSL_DIR="$SSL_DIR"
    export JWT_SECRET ENCRYPTION_KEY ENCRYPTION_SALT GATEWAY_SECRET POSTGRES_PASSWORD AI_CONFIG_SECRET REDIS_PASSWORD
    export HTTPS_PORT HTTP_PORT GATEWAY_PORT ENABLE_MONITORING ENABLE_TOR
}

# ============================================
# Service Startup
# ============================================
start_services() {
    echo "Starting Sanctuary..."
    echo -e "${YELLOW}Note: First-time build may take 2-5 minutes.${NC}"
    echo ""

    cd "$PROJECT_DIR"
    export_runtime_environment

    # Build compose files list
    COMPOSE_FILES="-f docker-compose.yml"
    [ "$OPT_ENABLE_MONITORING" = "yes" ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.monitoring.yml"
    [ "$OPT_ENABLE_TOR" = "yes" ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.tor.yml"

    # Step 1: Build all images first (ensures all build output completes before continuing)
    BUILD_ARGS=""
    if [ "$OPT_UPGRADE" = true ]; then
        echo "Upgrading — rebuilding containers from scratch..."
        echo -e "${YELLOW}This ensures all code changes are included in the new images.${NC}"
        BUILD_ARGS="--no-cache"
    else
        echo "Building containers..."
    fi
    # Note: parallel builds can sometimes fail with "already exists" race condition
    # but the images are still built successfully, so we continue on error
    if ! docker compose $COMPOSE_FILES build $BUILD_ARGS; then
        echo ""
        echo -e "${YELLOW}Build completed with warnings (this is usually fine).${NC}"
    fi

    # Step 2: Start containers
    echo ""
    echo "Starting containers..."

    # Check if --wait flag is supported (docker compose v2.1+)
    if docker compose up --help 2>&1 | grep -q -- '--wait'; then
        # Use --wait to wait for health checks before returning
        # Note: We don't use --no-build here. If the previous build step had a race
        # condition error and some images weren't built, docker compose will build
        # only the missing ones. If all images exist, it won't rebuild.
        if docker compose $COMPOSE_FILES up -d --wait; then
            FRONTEND_RUNNING=true
            WORKER_RUNNING=true
        else
            echo ""
            echo -e "${YELLOW}Note: Some services may still be starting.${NC}"
            # Check if key services are actually running despite the timeout
            if docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -q "frontend.*healthy"; then
                FRONTEND_RUNNING=true
            fi
            if docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -q "worker.*healthy"; then
                WORKER_RUNNING=true
            fi
        fi
        USED_WAIT_FLAG=true
    else
        # Fallback for older docker compose versions
        docker compose $COMPOSE_FILES up -d
        USED_WAIT_FLAG=false
    fi
}

wait_for_healthy() {
    # Skip if --wait flag was used (already waited)
    if [ "$USED_WAIT_FLAG" = true ]; then
        echo ""
        return
    fi

    echo ""
    echo "Waiting for services to start..."

    MAX_WAIT=120
    WAITED=0
    INTERVAL=5

    while [ $WAITED -lt $MAX_WAIT ]; do
        if docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -q "frontend.*healthy"; then
            FRONTEND_RUNNING=true
        fi

        if docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -q "worker.*healthy"; then
            WORKER_RUNNING=true
        fi

        if [ "$FRONTEND_RUNNING" = true ] && [ "$WORKER_RUNNING" = true ]; then
            break
        fi

        if docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -qE "(Exit|exited)"; then
            echo -e "${YELLOW}Some containers exited. Checking status...${NC}"
            FAILED=$(docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -E "(Exit|exited)" | grep -v "migrate" || true)
            if [ -n "$FAILED" ]; then
                echo -e "${RED}Container failures detected:${NC}"
                echo "$FAILED"
                break
            fi
        fi

        sleep $INTERVAL
        WAITED=$((WAITED + INTERVAL))
        echo "  Still starting... ($WAITED/${MAX_WAIT}s)"
    done

    if [ $WAITED -ge $MAX_WAIT ] && { [ "$FRONTEND_RUNNING" = false ] || [ "$WORKER_RUNNING" = false ]; }; then
        echo -e "${YELLOW}Timeout waiting for services. They may still be starting.${NC}"
        echo "  Check status with: docker compose ps"
        echo "  View logs with: docker compose logs -f"
    fi

    echo ""
}

# ============================================
# Completion Banner
# ============================================
show_completion_banner() {
    local https_port="${HTTPS_PORT:-8443}"
    local ssl_exists=false
    [ -f "$SSL_DIR/fullchain.pem" ] && ssl_exists=true

    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"

    if [ "$FRONTEND_RUNNING" = true ] && [ "$WORKER_RUNNING" = true ]; then
        echo -e "${BLUE}║${NC}            ${GREEN}Setup complete! Sanctuary is running.${NC}       ${BLUE}║${NC}"
    elif [ "$STARTED" = true ]; then
        echo -e "${BLUE}║${NC}          ${YELLOW}Setup complete! Services starting...${NC}          ${BLUE}║${NC}"
    else
        echo -e "${BLUE}║${NC}                    ${GREEN}Setup complete!${NC}                      ${BLUE}║${NC}"
    fi

    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}  Open your browser:                                       ${BLUE}║${NC}"

    if [ "$ssl_exists" = true ]; then
        printf "${BLUE}║${NC}    ${GREEN}https://localhost:%-5s${NC}                             ${BLUE}║${NC}\n" "$https_port"
        echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}  ${YELLOW}Accept the self-signed certificate warning${NC}              ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}  ${YELLOW}(click Advanced → Proceed)${NC}                               ${BLUE}║${NC}"
    else
        printf "${BLUE}║${NC}    ${GREEN}http://localhost:%-5s${NC}                               ${BLUE}║${NC}\n" "${HTTP_PORT:-8080}"
        echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}  ${RED}HTTPS unavailable - SSL certs missing${NC}                   ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}  ${YELLOW}Install openssl and run: ./start.sh --rebuild${NC}          ${BLUE}║${NC}"
    fi

    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}  Default login:                                           ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}    Username: ${GREEN}admin${NC}                                        ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}    Password: ${GREEN}sanctuary${NC}                                    ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}  ${YELLOW}You'll be asked to change the password on first login${NC}   ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"

    # Monitoring section
    if [ "$OPT_ENABLE_MONITORING" = "yes" ]; then
        echo -e "${BLUE}╠═══════════════════════════════════════════════════════════╣${NC}"
        echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}  Monitoring (Grafana):                                    ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}    ${GREEN}http://localhost:3000${NC}                                 ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}    Username: ${GREEN}admin${NC}                                        ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}    Password: ${GREEN}(your ENCRYPTION_KEY from config)${NC}           ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    fi

    # Tor section
    if [ "$OPT_ENABLE_TOR" = "yes" ]; then
        echo -e "${BLUE}╠═══════════════════════════════════════════════════════════╣${NC}"
        echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}  Tor Proxy:                                               ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}    Go to ${GREEN}Admin → Node Configuration${NC}                      ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}    Enable ${GREEN}Proxy / Tor${NC} and select ${GREEN}Tor Container${NC}         ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    fi

    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Show "Next Steps" checklist
    echo -e "${GREEN}┌─────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${GREEN}│${NC}                       ${GREEN}Next Steps${NC}                           ${GREEN}│${NC}"
    echo -e "${GREEN}├─────────────────────────────────────────────────────────────┤${NC}"

    if [ "$ssl_exists" = true ]; then
        echo -e "${GREEN}│${NC}  1. Open ${GREEN}https://localhost:${https_port}${NC} in your browser           ${GREEN}│${NC}"
    else
        echo -e "${GREEN}│${NC}  1. Open ${GREEN}http://localhost:${HTTP_PORT:-8080}${NC} in your browser            ${GREEN}│${NC}"
    fi

    echo -e "${GREEN}│${NC}  2. Log in with ${GREEN}admin${NC} / ${GREEN}sanctuary${NC}                        ${GREEN}│${NC}"
    echo -e "${GREEN}│${NC}  3. Change your password when prompted                      ${GREEN}│${NC}"
    echo -e "${GREEN}│${NC}  4. Connect to a Bitcoin node (Settings → Electrum)         ${GREEN}│${NC}"
    echo -e "${GREEN}│${NC}  5. ${YELLOW}Back up your encryption keys${NC} (see below)                ${GREEN}│${NC}"

    echo -e "${GREEN}└─────────────────────────────────────────────────────────────┘${NC}"
    echo ""

    echo "Useful commands:"
    echo -e "  ${GREEN}./start.sh${NC}           Start Sanctuary"
    echo -e "  ${GREEN}./start.sh --stop${NC}    Stop Sanctuary"
    echo -e "  ${GREEN}./start.sh --logs${NC}    View logs"
    echo -e "  ${GREEN}docker compose logs -f${NC}  Follow all container logs"
    echo ""
}

show_backup_reminder() {
    echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║${NC}  ${YELLOW}⚠  IMPORTANT: Back up your encryption keys!${NC}              ${RED}║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "Your encryption keys are stored in: ${GREEN}$ENV_FILE${NC}"
    echo ""
    echo "These keys encrypt sensitive data (2FA secrets, node passwords)."
    echo -e "${RED}If lost, encrypted data cannot be recovered!${NC}"
    echo ""
    echo -e "${YELLOW}Critical secrets to back up:${NC}"
    echo "┌─────────────────────────────────────────────────────────────┐"
    echo "│ ENCRYPTION_KEY=$ENCRYPTION_KEY"
    echo "│ ENCRYPTION_SALT=$ENCRYPTION_SALT"
    echo "└─────────────────────────────────────────────────────────────┘"
    echo ""
    echo "Back up options:"
    echo "  1. Copy the runtime env file to a secure location"
    echo "  2. Save the keys above to a password manager"
    echo "  3. Print and store in a safe place"
    echo ""
    echo -e "${YELLOW}Note:${NC} You'll need these keys if you:"
    echo "  - Restore from a backup on a new system"
    echo "  - Reinstall Sanctuary"
    echo "  - Move to a different server"
    echo ""
}

# ============================================
# Main Script
# ============================================
main() {
    # Show banner (unless called from install.sh which has its own)
    if [ "$OPT_FROM_INSTALL" != true ]; then
        echo -e "${BLUE}"
        echo "╔═══════════════════════════════════════════════════════════╗"
        echo "║                                                           ║"
        echo "║              Sanctuary Bitcoin Wallet                     ║"
        echo "║           Your keys, your coins, your server.             ║"
        echo "║                                                           ║"
        echo "╚═══════════════════════════════════════════════════════════╝"
        echo -e "${NC}"
    fi

    # Run prerequisite checks
    if [ "$OPT_SKIP_PREREQS" != true ]; then
        run_prerequisite_checks
    fi

    # Check for existing runtime env
    if [ -f "$ENV_FILE" ] && [ "$OPT_FORCE" != true ]; then
        if [ "$OPT_NON_INTERACTIVE" = true ]; then
            echo -e "${YELLOW}Warning: runtime env already exists at $ENV_FILE. Use --force to overwrite.${NC}"
            echo "Continuing with existing configuration..."
            echo ""
        elif [ -t 0 ]; then
            echo -e "${YELLOW}Warning: runtime env already exists at $ENV_FILE.${NC}"
            read -p "Overwrite with new secrets? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo "Setup cancelled. Your existing runtime env is unchanged."
                exit 0
            fi
            echo ""
        fi
    fi

    # Load existing secrets or generate new ones
    load_or_generate_secrets

    # Prompt for optional features
    prompt_optional_features

    # Check for port conflicts
    check_all_ports

    # Write runtime env file
    write_env_file
    export_runtime_environment

    # Generate SSL certificates
    if [ "$OPT_SKIP_SSL" != true ]; then
        generate_ssl_certificates
    fi

    # Start services
    STARTED=false
    FRONTEND_RUNNING=false
    WORKER_RUNNING=false

    if [ "$OPT_NO_START" != true ]; then
        if [ "$OPT_NON_INTERACTIVE" = true ] || [ ! -t 0 ]; then
            # Non-interactive: start automatically
            start_services
            STARTED=true
            wait_for_healthy
        else
            # Interactive: ask user
            read -p "Start Sanctuary now? [Y/n] " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                start_services
                STARTED=true
                wait_for_healthy
            fi
        fi
    fi

    # Show completion banner
    show_completion_banner

    # Show backup reminder
    show_backup_reminder
}

# Run main function
main
