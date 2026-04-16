#!/bin/bash
# ============================================
# Sanctuary Bitcoin Wallet - Start Script
# ============================================
# Use this script to start Sanctuary after initial installation.
#
# Usage:
#   ./start.sh                  # Start with defaults
#   ./start.sh --with-ai        # Start with bundled AI (Ollama)
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

if [ -n "${SANCTUARY_SSL_DIR:-}" ]; then
    SSL_DIR="$SANCTUARY_SSL_DIR"
fi

export SANCTUARY_ENV_FILE="$ENV_FILE"
export SANCTUARY_SSL_DIR="$SSL_DIR"

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

# Auto-generate AI_CONFIG_SECRET if not set
if [ -z "$AI_CONFIG_SECRET" ]; then
    export AI_CONFIG_SECRET=$(openssl rand -hex 32)
fi

# Export for docker compose
export JWT_SECRET ENCRYPTION_KEY GATEWAY_SECRET POSTGRES_PASSWORD AI_CONFIG_SECRET REDIS_PASSWORD
export HTTPS_PORT HTTP_PORT ENABLE_MONITORING ENABLE_TOR ENABLE_MCP SANCTUARY_ENV_FILE SANCTUARY_SSL_DIR
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
        if [ -e /var/run/docker.sock ]; then
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

MCP_PROFILE=""
[ "$ENABLE_MCP" = "yes" ] && MCP_PROFILE="--profile mcp"

# Check if local images exist - if not, we need to build
NEED_BUILD="no"
if ! docker image inspect sanctuary-backend:local &>/dev/null; then
    NEED_BUILD="yes"
fi
if ! docker image inspect sanctuary-frontend:local &>/dev/null; then
    NEED_BUILD="yes"
fi
if ! docker image inspect sanctuary-gateway:local &>/dev/null; then
    NEED_BUILD="yes"
fi

case "${1:-}" in
    --stop)
        echo "Stopping Sanctuary..."
        # Stop monitoring stack if running
        if docker ps --format '{{.Names}}' | grep -qE '.*-(grafana|loki|promtail)'; then
            docker compose -f docker-compose.yml -f docker-compose.monitoring.yml --profile ai --profile mcp down
        else
            docker compose --profile ai --profile mcp down
        fi
        echo "Sanctuary stopped."
        ;;
    --logs)
        docker compose logs -f
        ;;
    --with-ai)
        echo "Starting Sanctuary with bundled AI (Ollama)..."
        echo ""
        echo "Note: First-time AI setup will download the Ollama image (~1GB)."
        echo "      Models are downloaded separately when you pull them in settings."
        echo ""
        # Auto-build if images are missing
        BUILD_FLAG=""
        if [ "$NEED_BUILD" = "yes" ]; then
            echo "Local images not found - building..."
            BUILD_FLAG="--build"
        fi
        docker compose --profile ai $MCP_PROFILE up -d $BUILD_FLAG
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        echo ""
        echo "AI Setup:"
        echo "  1. Go to Admin → AI Assistant"
        echo "  2. Enable AI Features"
        echo "  3. Click 'Detect' - it will find the bundled Ollama automatically"
        echo "  4. Pull a model (llama3.2:3b recommended for most systems)"
        ;;
    --with-mcp)
        echo "Starting Sanctuary with read-only MCP server..."
        echo ""
        echo "MCP will bind to ${MCP_BIND_ADDRESS:-127.0.0.1}:${MCP_PORT:-3003}."
        echo "Create an MCP API key from Admin before connecting an LLM client."
        echo ""
        # Auto-build if images are missing
        BUILD_FLAG=""
        if [ "$NEED_BUILD" = "yes" ]; then
            echo "Local images not found - building..."
            BUILD_FLAG="--build"
        fi
        docker compose --profile mcp up -d $BUILD_FLAG
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        echo "MCP endpoint: http://${MCP_BIND_ADDRESS:-127.0.0.1}:${MCP_PORT:-3003}/mcp"
        ;;
    --with-monitoring)
        echo "Starting Sanctuary with monitoring stack (Grafana/Loki/Promtail)..."
        echo ""
        echo "Note: First-time setup will download monitoring images (~500MB total)."
        echo ""
        # Auto-build if images are missing
        BUILD_FLAG=""
        if [ "$NEED_BUILD" = "yes" ]; then
            echo "Local images not found - building..."
            BUILD_FLAG="--build"
        fi
        docker compose -f docker-compose.yml -f docker-compose.monitoring.yml $MCP_PROFILE up -d $BUILD_FLAG
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        echo ""
        echo "Monitoring:"
        echo "  Grafana: http://localhost:${GRAFANA_PORT:-3000}"
        echo "    Username: admin"
        echo "    Password: (your GRAFANA_PASSWORD or ENCRYPTION_KEY)"
        echo ""
        echo "  Dashboards are pre-configured with Sanctuary logs."
        ;;
    --with-tor)
        echo "Starting Sanctuary with Tor proxy..."
        echo ""
        echo "Note: First-time setup will download the Tor image (~50MB)."
        echo ""
        # Auto-build if images are missing
        BUILD_FLAG=""
        if [ "$NEED_BUILD" = "yes" ]; then
            echo "Local images not found - building..."
            BUILD_FLAG="--build"
        fi
        docker compose -f docker-compose.yml -f docker-compose.tor.yml $MCP_PROFILE up -d $BUILD_FLAG
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

        # Detect which stacks are running (check containers or env preference)
        HAS_AI=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-ollama-[0-9]+$' && echo "yes" || echo "no")
        HAS_MONITORING=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-(grafana|loki|promtail)' && echo "yes" || echo "no")
        HAS_TOR=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-tor' && echo "yes" || echo "no")
        HAS_MCP=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-mcp-[0-9]+$' && echo "yes" || echo "no")
        # Also check env preference from install
        [ "$ENABLE_MONITORING" = "yes" ] && HAS_MONITORING="yes"
        [ "$ENABLE_TOR" = "yes" ] && HAS_TOR="yes"
        [ "$ENABLE_MCP" = "yes" ] && HAS_MCP="yes"

        COMPOSE_FILES="-f docker-compose.yml"
        [ "$HAS_MONITORING" = "yes" ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.monitoring.yml"
        [ "$HAS_TOR" = "yes" ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.tor.yml"

        # Force clean rebuild to ensure all code changes are included
        echo "Building fresh images (no cache)..."
        docker compose $COMPOSE_FILES build --no-cache

        PROFILES=""
        [ "$HAS_AI" = "yes" ] && PROFILES="$PROFILES --profile ai"
        [ "$HAS_MCP" = "yes" ] && PROFILES="$PROFILES --profile mcp"

        if [ -n "$PROFILES" ]; then
            docker compose $COMPOSE_FILES $PROFILES up -d
        else
            docker compose $COMPOSE_FILES up -d
        fi
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        ;;
    --help|-h)
        echo "Usage: ./start.sh [option]"
        echo ""
        echo "Options:"
        echo "  (none)            Start Sanctuary"
        echo "  --with-ai         Start with bundled AI (Ollama container)"
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
        echo "  Run './start.sh --with-ai' to enable bundled AI features."
        echo "  This starts an Ollama container - no external setup needed."
        echo ""
        echo "Monitoring:"
        echo "  Run './start.sh --with-monitoring' to enable monitoring."
        echo "  Access Grafana at http://localhost:3000 (admin / your ENCRYPTION_KEY)"
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
        # Detect which stacks were previously running (check containers or env preference)
        HAS_AI=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-ollama-[0-9]+$' && echo "yes" || echo "no")
        HAS_MONITORING=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-(grafana|loki|promtail)' && echo "yes" || echo "no")
        HAS_TOR=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-tor' && echo "yes" || echo "no")
        HAS_MCP=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-mcp-[0-9]+$' && echo "yes" || echo "no")
        # Also check env preference from install
        [ "$ENABLE_MONITORING" = "yes" ] && HAS_MONITORING="yes"
        [ "$ENABLE_TOR" = "yes" ] && HAS_TOR="yes"
        [ "$ENABLE_MCP" = "yes" ] && HAS_MCP="yes"

        COMPOSE_FILES="-f docker-compose.yml"
        [ "$HAS_MONITORING" = "yes" ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.monitoring.yml"
        [ "$HAS_TOR" = "yes" ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.tor.yml"

        # Auto-build if images are missing
        BUILD_FLAG=""
        if [ "$NEED_BUILD" = "yes" ]; then
            echo "Local images not found - building..."
            BUILD_FLAG="--build"
        fi

        PROFILES=""
        [ "$HAS_AI" = "yes" ] && PROFILES="$PROFILES --profile ai"
        [ "$HAS_MCP" = "yes" ] && PROFILES="$PROFILES --profile mcp"

        if [ -n "$PROFILES" ]; then
            docker compose $COMPOSE_FILES $PROFILES up -d $BUILD_FLAG
        else
            docker compose $COMPOSE_FILES up -d $BUILD_FLAG
        fi
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        ;;
esac
