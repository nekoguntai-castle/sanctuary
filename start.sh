#!/bin/bash
# ============================================
# Sanctuary Bitcoin Wallet - Start Script
# ============================================
# Use this script to start Sanctuary after initial installation.
#
# Usage:
#   ./start.sh                  # Start with defaults
#   ./start.sh --with-ai        # Deprecated: starts Sanctuary and prints external AI setup guidance
#   ./start.sh --with-monitoring # Start with monitoring (Grafana/Loki)
#   ./start.sh --with-tor       # Start with Tor proxy
#   ./start.sh --with-mcp       # Start read-only MCP server for local LLMs
#   ./start.sh --rebuild        # Rebuild containers (after updates)
#   ./start.sh --stop           # Stop all services
#   ./start.sh --logs           # View logs
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DEFAULT_RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}"
EXTERNAL_ENV_FILE="${SANCTUARY_ENV_FILE:-$DEFAULT_RUNTIME_DIR/sanctuary.env}"
DEFAULT_SSL_DIR="$SCRIPT_DIR/docker/nginx/ssl"
EXTERNAL_SSL_DIR="${SANCTUARY_SSL_DIR:-$DEFAULT_RUNTIME_DIR/ssl}"

if [ -f "$EXTERNAL_ENV_FILE" ]; then
    ENV_FILE="$EXTERNAL_ENV_FILE"
elif [ -f "$SCRIPT_DIR/.env" ]; then
    ENV_FILE="$SCRIPT_DIR/.env"
elif [ -f "$SCRIPT_DIR/.env.local" ]; then
    ENV_FILE="$SCRIPT_DIR/.env.local"
else
    ENV_FILE="$EXTERNAL_ENV_FILE"
fi

if [ -n "${SANCTUARY_SSL_DIR:-}" ]; then
    SSL_DIR="$SANCTUARY_SSL_DIR"
elif [ -f "$EXTERNAL_SSL_DIR/fullchain.pem" ] || [ -f "$EXTERNAL_SSL_DIR/privkey.pem" ]; then
    SSL_DIR="$EXTERNAL_SSL_DIR"
else
    SSL_DIR="$DEFAULT_SSL_DIR"
fi

# Default ports
HTTPS_PORT="${HTTPS_PORT:-8443}"
HTTP_PORT="${HTTP_PORT:-8080}"

# Load environment from the operator-owned runtime env file first, with
# root .env/.env.local kept as backwards-compatible fallbacks.
if [ -f "$ENV_FILE" ]; then
    set -a  # Export all variables
    source "$ENV_FILE"
    set +a
fi

persist_runtime_env_value() {
    local key="$1"
    local value="$2"

    if [ -z "$key" ] || [ -z "$value" ]; then
        return 0
    fi

    local env_dir
    env_dir="$(dirname "$ENV_FILE")"
    mkdir -p "$env_dir"
    touch "$ENV_FILE"
    chmod 600 "$ENV_FILE" 2>/dev/null || true

    if grep -q "^${key}=" "$ENV_FILE"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    else
        printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
}

IS_OFFLINE_INSTALL=false
if [ "${SANCTUARY_INSTALL_MODE:-}" = "offline" ]; then
    IS_OFFLINE_INSTALL=true
fi

if [ -n "${SANCTUARY_SSL_DIR:-}" ]; then
    SSL_DIR="$SANCTUARY_SSL_DIR"
fi

export SANCTUARY_ENV_FILE="$ENV_FILE"
export SANCTUARY_SSL_DIR="$SSL_DIR"
SANCTUARY_COMPOSE_SSL_DIR="${SANCTUARY_COMPOSE_SSL_DIR:-$SSL_DIR}"
export SANCTUARY_COMPOSE_SSL_DIR

# Check for required secrets
MISSING_SECRETS=""
[ -z "$JWT_SECRET" ] && MISSING_SECRETS="$MISSING_SECRETS JWT_SECRET"
[ -z "$ENCRYPTION_KEY" ] && MISSING_SECRETS="$MISSING_SECRETS ENCRYPTION_KEY"
[ -z "$GATEWAY_SECRET" ] && MISSING_SECRETS="$MISSING_SECRETS GATEWAY_SECRET"
[ -z "$POSTGRES_PASSWORD" ] && MISSING_SECRETS="$MISSING_SECRETS POSTGRES_PASSWORD"

if [ -n "$MISSING_SECRETS" ]; then
    echo "Error: Missing required secrets:$MISSING_SECRETS"
    echo ""
    echo "Run install.sh first for initial setup, or run:"
    echo "  ./scripts/setup.sh"
    exit 1
fi

# Auto-generate LLM_EGRESS_PROXY_SECRET if not set
if [ -z "$LLM_EGRESS_PROXY_SECRET" ]; then
    export LLM_EGRESS_PROXY_SECRET=$(openssl rand -hex 32)
    persist_runtime_env_value "LLM_EGRESS_PROXY_SECRET" "$LLM_EGRESS_PROXY_SECRET"
fi

if [ -z "$WORKER_DIAGNOSTICS_SECRET" ]; then
    export WORKER_DIAGNOSTICS_SECRET=$(openssl rand -hex 32)
    persist_runtime_env_value "WORKER_DIAGNOSTICS_SECRET" "$WORKER_DIAGNOSTICS_SECRET"
fi

if [ -z "$GRAFANA_PASSWORD" ]; then
    export GRAFANA_PASSWORD=$(openssl rand -hex 24)
    persist_runtime_env_value "GRAFANA_PASSWORD" "$GRAFANA_PASSWORD"
fi

# Export for docker compose
export JWT_SECRET ENCRYPTION_KEY GATEWAY_SECRET WORKER_DIAGNOSTICS_SECRET POSTGRES_PASSWORD GRAFANA_PASSWORD LLM_EGRESS_PROXY_SECRET REDIS_PASSWORD
export LLM_EGRESS_PROXY_ALLOWED_HOSTS LLM_EGRESS_PROXY_ALLOWED_CIDRS LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS
export RATE_LIMIT_LOGIN RATE_LIMIT_2FA RATE_LIMIT_PASSWORD_CHANGE
export HTTPS_PORT HTTP_PORT ENABLE_MONITORING ENABLE_TOR ENABLE_MCP SANCTUARY_ENV_FILE SANCTUARY_SSL_DIR SANCTUARY_COMPOSE_SSL_DIR
export MCP_BIND_ADDRESS MCP_PORT MCP_ALLOWED_HOSTS MCP_RATE_LIMIT_PER_MINUTE MCP_DEFAULT_PAGE_SIZE MCP_MAX_PAGE_SIZE MCP_MAX_DATE_RANGE_DAYS

# Check SSL certificate expiry
check_ssl_expiry() {
    local cert_file="$SSL_DIR/fullchain.pem"

    if [ -f "$cert_file" ] && command -v openssl &> /dev/null; then
        local expiry_date=$(openssl x509 -enddate -noout -in "$cert_file" 2>/dev/null | cut -d= -f2)
        if [ -n "$expiry_date" ]; then
            # Calculate days until expiry (works on Linux and macOS)
            local expiry_epoch
            if date --version 2>/dev/null | grep -q GNU; then
                # GNU date (Linux)
                expiry_epoch=$(date -d "$expiry_date" +%s 2>/dev/null || echo "0")
            else
                # BSD date (macOS)
                expiry_epoch=$(date -j -f "%b %d %T %Y %Z" "$expiry_date" +%s 2>/dev/null || echo "0")
            fi

            if [ "$expiry_epoch" != "0" ]; then
                local now_epoch=$(date +%s)
                local days_left=$(( (expiry_epoch - now_epoch) / 86400 ))

                if [ "$days_left" -lt 30 ]; then
                    # Only auto-regenerate self-signed certs; warn for CA-signed
                    local issuer_dn=$(openssl x509 -issuer -noout -in "$cert_file" 2>/dev/null | sed 's/^issuer= *//')
                    local subject_dn=$(openssl x509 -subject -noout -in "$cert_file" 2>/dev/null | sed 's/^subject= *//')
                    local is_self_signed=false
                    if [ "$issuer_dn" = "$subject_dn" ]; then
                        is_self_signed=true
                    fi

                    if [ "$days_left" -le 0 ]; then
                        echo ""
                        if [ "$is_self_signed" = true ]; then
                            echo -e "\033[0;31mSSL certificate has expired — auto-regenerating...\033[0m"
                        else
                            echo -e "\033[0;31mWarning: SSL certificate has expired!\033[0m"
                            echo "  This is a CA-signed certificate — renew it with your certificate provider."
                            echo ""
                        fi
                    elif [ "$days_left" -lt 30 ]; then
                        echo ""
                        if [ "$is_self_signed" = true ]; then
                            echo -e "\033[1;33mSSL certificate expires in $days_left days — auto-regenerating...\033[0m"
                        else
                            echo -e "\033[1;33mWarning: SSL certificate expires in $days_left days.\033[0m"
                            echo "  This is a CA-signed certificate — renew it with your certificate provider."
                            echo ""
                        fi
                    fi

                    if [ "$is_self_signed" = true ]; then
                        SANCTUARY_SSL_DIR="$SSL_DIR" bash "$SCRIPT_DIR/docker/nginx/ssl/generate-certs.sh" localhost
                        echo -e "\033[0;32mSSL certificate regenerated.\033[0m"
                        echo ""
                    fi
                fi
            fi
        fi
    fi
}

# Run SSL check (suppress errors for missing cert - handled at startup)
check_ssl_expiry 2>/dev/null || true

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Docker prerequisites
check_docker_prerequisites() {
    local has_errors=false

    # Check if docker command exists
    if ! command -v docker &>/dev/null; then
        echo -e "${RED}✗${NC} Docker is not installed"
        echo ""
        echo "  Install Docker:"
        echo "    - Windows/Mac: https://www.docker.com/products/docker-desktop"
        echo "    - Linux: curl -fsSL https://get.docker.com | sh"
        echo ""
        exit 1
    fi

    # Check if we can connect to Docker
    if ! docker info &>/dev/null; then
        if [ -e "${SANCTUARY_DOCKER_SOCKET:-/var/run/docker.sock}" ]; then
            # Socket exists but no permission
            echo -e "${RED}✗${NC} Cannot access Docker (permission denied)"
            echo ""

            # Check if user is in docker group
            if groups 2>/dev/null | grep -qw docker; then
                # User is in docker group but still can't access - group not active
                echo "  You are in the 'docker' group but it hasn't taken effect yet."
                echo ""
                echo "  Fix: Log out and back in, or run:"
                echo "    newgrp docker"
                echo ""
            else
                # User is not in docker group
                echo "  Your user '$(whoami)' is not in the 'docker' group."
                echo ""
                echo "  Fix: Run these commands:"
                echo "    sudo usermod -aG docker \$USER"
                echo "    newgrp docker   # Or log out and back in"
                echo ""
            fi
            echo "  Then run this script again."
            echo ""
        else
            # Socket doesn't exist - daemon not running
            echo -e "${RED}✗${NC} Docker daemon is not running"
            echo ""
            echo "  Fix: Start Docker:"
            echo "    sudo systemctl start docker"
            echo "    sudo systemctl enable docker  # Optional: start on boot"
            echo ""
        fi
        exit 1
    fi

    # Check Docker Compose v2
    if ! docker compose version &>/dev/null; then
        echo -e "${RED}✗${NC} Docker Compose v2 is not available"
        echo ""
        echo "  Sanctuary requires Docker Compose v2 (the 'docker compose' command)."
        echo "  Fix: Update Docker Desktop, or install the compose plugin:"
        echo "    sudo apt-get update && sudo apt-get install docker-compose-plugin"
        echo ""
        exit 1
    fi
}

# Run Docker checks
check_docker_prerequisites

# Check if local images exist - if not, we need to build
NEED_BUILD="no"
if ! docker image inspect sanctuary-backend:${SANCTUARY_IMAGE_TAG:-local} &>/dev/null; then
    NEED_BUILD="yes"
fi
if ! docker image inspect sanctuary-frontend:${SANCTUARY_IMAGE_TAG:-local} &>/dev/null; then
    NEED_BUILD="yes"
fi
if ! docker image inspect sanctuary-gateway:${SANCTUARY_IMAGE_TAG:-local} &>/dev/null; then
    NEED_BUILD="yes"
fi

set_start_flags() {
    BUILD_FLAG=""
    UP_FLAGS="-d"

    if [ "$NEED_BUILD" = "yes" ]; then
        if [ "$IS_OFFLINE_INSTALL" = true ]; then
            echo "Error: local Sanctuary images are missing on an offline install."
            echo "Apply a signed offline bundle instead of rebuilding or pulling images."
            exit 1
        fi
        echo "Local images not found - building..."
        BUILD_FLAG="--build"
    fi

    if [ "$IS_OFFLINE_INSTALL" = true ]; then
        UP_FLAGS="-d --no-build"
        if docker compose up --help 2>&1 | grep -q -- '--pull'; then
            UP_FLAGS="$UP_FLAGS --pull never"
        fi
    else
        UP_FLAGS="-d $BUILD_FLAG"
    fi
}

configure_compose_files() {
    local include_monitoring="${1:-no}"
    local include_tor="${2:-no}"

    COMPOSE_FILE_ARGS=(--project-directory "$SCRIPT_DIR" -f "$SCRIPT_DIR/docker-compose.yml")
    [ "$include_monitoring" = "yes" ] && COMPOSE_FILE_ARGS+=(-f "$SCRIPT_DIR/docker/compose/monitoring.yml")
    [ "$include_tor" = "yes" ] && COMPOSE_FILE_ARGS+=(-f "$SCRIPT_DIR/docker/compose/tor.yml")
    return 0
}

detect_enabled_stacks() {
    local include_stopped="${1:-no}"
    local project_name="${COMPOSE_PROJECT_NAME:-sanctuary}"
    local service
    local -a docker_ps_args=(ps)

    [ "$include_stopped" = "yes" ] && docker_ps_args+=(-a)

    HAS_MONITORING="no"
    HAS_TOR="no"
    HAS_MCP="no"
    [ "${ENABLE_MONITORING:-no}" = "yes" ] && HAS_MONITORING="yes"
    [ "${ENABLE_TOR:-no}" = "yes" ] && HAS_TOR="yes"
    [ "${ENABLE_MCP:-no}" = "yes" ] && HAS_MCP="yes"

    while IFS= read -r service; do
        case "$service" in
            grafana|loki|promtail|prometheus|alertmanager|jaeger)
                HAS_MONITORING="yes"
                ;;
            tor|tor-ingress)
                HAS_TOR="yes"
                ;;
            mcp)
                HAS_MCP="yes"
                ;;
        esac
    done < <(docker "${docker_ps_args[@]}" \
        --filter "label=com.docker.compose.project=$project_name" \
        --format '{{.Label "com.docker.compose.service"}}')
}

configure_enabled_stacks() {
    configure_compose_files "$HAS_MONITORING" "$HAS_TOR"
    MCP_PROFILE=""
    if [ "$HAS_MCP" = "yes" ]; then
        MCP_PROFILE="--profile mcp"
    fi
    return 0
}

ensure_grafana_migration_image() {
    local image="sanctuary-grafana-migration:${SANCTUARY_IMAGE_TAG:-local}"
    docker image inspect "$image" >/dev/null 2>&1 && return 0
    if [ "$IS_OFFLINE_INSTALL" = true ]; then
        echo "Error: packaged Grafana migration image is missing on an offline install." >&2
        echo "Apply the official full offline bundle before starting monitoring." >&2
        exit 1
    fi
    echo "Packaged Grafana migration image not found - building..."
    docker compose "${COMPOSE_FILE_ARGS[@]}" build grafana-password-migration
}

start_compose_stack() {
    local profiles="$1"
    local up_flags="$2"
    local postgres_up_flags="-d"

    if [ "$IS_OFFLINE_INSTALL" = true ] && docker compose up --help 2>&1 | grep -q -- '--pull'; then
        postgres_up_flags="$postgres_up_flags --pull never"
    fi

    if docker compose "${COMPOSE_FILE_ARGS[@]}" config --services | grep -qx grafana; then
        ensure_grafana_migration_image
        bash "$SCRIPT_DIR/scripts/ops/run-grafana-password-migration.sh" \
            "$SCRIPT_DIR" "${COMPOSE_FILE_ARGS[@]}"
    fi

    docker compose "${COMPOSE_FILE_ARGS[@]}" $profiles up $postgres_up_flags postgres
    SANCTUARY_PROJECT_DIR="$SCRIPT_DIR" bash "$SCRIPT_DIR/scripts/reconcile-postgres-password.sh"
    docker compose "${COMPOSE_FILE_ARGS[@]}" $profiles up $up_flags
}

configure_compose_files

case "${1:-}" in
    --stop)
        echo "Stopping Sanctuary..."
        detect_enabled_stacks yes
        configure_enabled_stacks
        docker compose "${COMPOSE_FILE_ARGS[@]}" $MCP_PROFILE down
        echo "Sanctuary stopped."
        ;;
    --logs)
        detect_enabled_stacks yes
        configure_enabled_stacks
        docker compose "${COMPOSE_FILE_ARGS[@]}" $MCP_PROFILE logs -f
        ;;
    --with-ai)
        echo "Starting Sanctuary..."
        echo ""
        echo "Note: --with-ai no longer starts a bundled model container."
        echo "      Run Ollama, LM Studio, or another trusted provider outside Sanctuary,"
        echo "      then configure its endpoint in Admin → AI Settings."
        echo ""
        detect_enabled_stacks
        configure_enabled_stacks
        set_start_flags
        start_compose_stack "$MCP_PROFILE" "$UP_FLAGS"
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        echo ""
        echo "AI Setup:"
        echo "  1. Start a provider outside Sanctuary, for example: ollama serve"
        echo "  2. Go to Admin → Feature Flags and enable aiAssistant"
        echo "  3. Go to Admin → AI Settings and enable AI Features"
        echo "  4. Set the provider endpoint, for example http://host.docker.internal:11434"
        echo "  5. Detect/select a model and save"
        ;;
    --with-mcp)
        echo "Starting Sanctuary with read-only MCP server..."
        echo ""
        echo "MCP will bind to ${MCP_BIND_ADDRESS:-127.0.0.1}:${MCP_PORT:-3003}."
        echo "Create an MCP API key from Admin before connecting an LLM client."
        echo ""
        detect_enabled_stacks
        HAS_MCP="yes"
        ENABLE_MCP="yes"
        export ENABLE_MCP
        persist_runtime_env_value "ENABLE_MCP" "yes"
        configure_enabled_stacks
        set_start_flags
        start_compose_stack "$MCP_PROFILE" "$UP_FLAGS"
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        echo "MCP endpoint: http://${MCP_BIND_ADDRESS:-127.0.0.1}:${MCP_PORT:-3003}/mcp"
        ;;
    --with-monitoring)
        echo "Starting Sanctuary with monitoring stack (Grafana/Loki/Promtail)..."
        echo ""
        echo "Note: First-time setup will download monitoring images (~500MB total)."
        echo ""
        detect_enabled_stacks
        HAS_MONITORING="yes"
        ENABLE_MONITORING="yes"
        export ENABLE_MONITORING
        persist_runtime_env_value "ENABLE_MONITORING" "yes"
        configure_enabled_stacks
        set_start_flags
        start_compose_stack "$MCP_PROFILE" "$UP_FLAGS"
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        echo ""
        echo "Monitoring:"
        echo "  Grafana: http://localhost:${GRAFANA_PORT:-3000}"
        echo "    Username: admin"
        echo "    Password: (your GRAFANA_PASSWORD)"
        echo ""
        echo "  Dashboards are pre-configured with Sanctuary logs."
        ;;
    --with-tor)
        echo "Starting Sanctuary with Tor proxy..."
        echo ""
        echo "Note: First-time setup will download the Tor image (~50MB)."
        echo ""
        detect_enabled_stacks
        HAS_TOR="yes"
        ENABLE_TOR="yes"
        export ENABLE_TOR
        persist_runtime_env_value "ENABLE_TOR" "yes"
        configure_enabled_stacks
        set_start_flags
        start_compose_stack "$MCP_PROFILE" "$UP_FLAGS"
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        echo ""
        echo "Tor Setup (Electrum privacy):"
        echo "  1. Go to Admin → Node Configuration"
        echo "  2. Enable 'Proxy / Tor'"
        echo "  3. Select 'Tor Container' preset (tor:9050)"
        echo "  4. Save and test connection"
        echo ""
        echo "Payjoin over Tor:"
        echo "  1. Wait ~30s for the hidden service to initialize"
        echo "  2. Get your .onion address:"
        echo "       docker exec sanctuary-tor cat /var/lib/tor/hidden_service/hostname"
        echo "  3. Add to your .env:"
        echo "       PAYJOIN_PUBLIC_URL=http://<your-onion-address>.onion"
        echo "  4. Enable the payjoinSupport feature flag in Admin → Feature Flags"
        ;;
    --rebuild)
        if [ "$IS_OFFLINE_INSTALL" = true ] && [ "${SANCTUARY_ALLOW_OFFLINE_REBUILD:-false}" != "true" ]; then
            echo "Error: --rebuild is disabled for offline installs."
            echo "Apply a newer signed offline bundle with ./install.sh --offline-bundle <bundle.tar.gz>."
            echo "Set SANCTUARY_ALLOW_OFFLINE_REBUILD=true only for deliberate development recovery."
            exit 1
        fi

        echo "Rebuilding and starting Sanctuary..."

        # Generate SSL certificates if missing and openssl is available
        if [ ! -f "$SSL_DIR/fullchain.pem" ] || [ ! -f "$SSL_DIR/privkey.pem" ]; then
            if command -v openssl &>/dev/null; then
                echo "Generating SSL certificates..."
                mkdir -p "$SSL_DIR"
                chmod +x "$SCRIPT_DIR/docker/nginx/ssl/generate-certs.sh" 2>/dev/null || true
                if SANCTUARY_SSL_DIR="$SSL_DIR" bash "$SCRIPT_DIR/docker/nginx/ssl/generate-certs.sh" localhost; then
                    echo "SSL certificates generated successfully"
                else
                    echo "Warning: Failed to generate SSL certificates"
                fi
            else
                echo "Warning: SSL certificates missing and openssl not available"
                echo "  Install openssl to enable HTTPS: sudo apt install openssl"
            fi
        fi

        detect_enabled_stacks
        configure_enabled_stacks

        # Force clean rebuild to ensure all code changes are included
        echo "Building fresh images (no cache)..."
        docker compose "${COMPOSE_FILE_ARGS[@]}" build --no-cache

        start_compose_stack "$MCP_PROFILE" "-d"
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        ;;
    --help|-h)
        echo "Usage: ./start.sh [option]"
        echo ""
        echo "Options:"
        echo "  (none)            Start Sanctuary"
        echo "  --with-ai         Deprecated: start Sanctuary and print external AI setup guidance"
        echo "  --with-monitoring Start with monitoring (Grafana/Loki/Promtail)"
        echo "  --with-tor        Start with Tor proxy for privacy"
        echo "  --with-mcp        Start read-only MCP server for local LLM clients"
        echo "  --rebuild         Rebuild containers (use after updates)"
        echo "  --stop            Stop all services"
        echo "  --logs            View container logs"
        echo "  --help            Show this help"
        echo ""
        echo "Environment variables:"
        echo "  HTTPS_PORT    HTTPS port (default: 8443)"
        echo "  HTTP_PORT     HTTP redirect port (default: 8080)"
        echo "  GRAFANA_PORT  Grafana port (default: 3000)"
        echo "  MCP_PORT      MCP host port (default: 3003)"
        echo "  MCP_BIND_ADDRESS Host bind address for MCP (default: 127.0.0.1)"
        echo ""
        echo "AI Setup:"
        echo "  Run Ollama, LM Studio, or another provider outside Sanctuary."
        echo "  Then configure the endpoint in Admin → AI Settings."
        echo ""
        echo "Monitoring:"
        echo "  Run './start.sh --with-monitoring' to enable monitoring."
        echo "  Access Grafana at http://localhost:3000 (admin / your GRAFANA_PASSWORD)"
        echo ""
        echo "Tor Privacy:"
        echo "  Run './start.sh --with-tor' to enable Tor proxy."
        echo "  Then enable in Admin → Node Configuration → Proxy / Tor."
        echo ""
        echo "MCP:"
        echo "  Run './start.sh --with-mcp' to enable read-only MCP access."
        echo "  Endpoint: http://127.0.0.1:3003/mcp"
        ;;
    *)
        echo "Starting Sanctuary..."
        detect_enabled_stacks
        configure_enabled_stacks

        set_start_flags
        start_compose_stack "$MCP_PROFILE" "$UP_FLAGS"
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        ;;
esac
