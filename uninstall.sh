#!/bin/bash
# ============================================
# Sanctuary Bitcoin Wallet - Uninstall Script
# ============================================
#
# This script removes all Sanctuary Docker containers, volumes,
# images, and configuration files.
#
# Usage:
#   ./uninstall.sh           # Interactive uninstall
#   ./uninstall.sh --force   # Skip confirmation prompts
#   ./uninstall.sh --keep-data  # Remove containers but keep database
#
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Options
FORCE=false
KEEP_DATA=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --force|-f)
            FORCE=true
            shift
            ;;
        --keep-data)
            KEEP_DATA=true
            shift
            ;;
        --help|-h)
            echo "Usage: ./uninstall.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --force, -f    Skip confirmation prompts"
            echo "  --keep-data    Remove containers but keep database volume"
            echo "  --help, -h     Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Run ./uninstall.sh --help for usage"
            exit 1
            ;;
    esac
done

echo ""
echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║              SANCTUARY UNINSTALL                          ║${NC}"
echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$KEEP_DATA" = true ]; then
    echo -e "${YELLOW}This will remove:${NC}"
    echo "  - All Docker containers"
    echo "  - Redis cache volume"
    echo "  - Locally built Docker images"
    echo ""
    echo -e "${GREEN}This will KEEP:${NC}"
    echo "  - Database volume (your wallet data)"
    echo "  - Legacy Ollama model volumes, if present"
    echo "  - Your .env file"
    echo ""
else
    echo -e "${YELLOW}This will permanently delete:${NC}"
    echo "  - All Docker containers"
    echo "  - All Docker volumes (database, Redis, legacy Ollama model volumes)"
    echo "  - All locally built images"
    echo "  - Your .env file with secrets"
    echo "  - SSL certificates"
    echo ""
    echo -e "${RED}YOUR WALLET DATA WILL BE PERMANENTLY LOST!${NC}"
    echo ""
    echo "Consider backing up first:"
    echo -e "  ${GREEN}docker exec \$(docker compose ps -q postgres) pg_dump -U sanctuary sanctuary > backup.sql${NC}"
    echo ""
fi

if [ "$FORCE" = false ]; then
    if [ "$KEEP_DATA" = true ]; then
        read -p "Continue with uninstall (keeping data)? [y/N] " -n 1 -r
    else
        read -p "Type 'DELETE' to confirm complete uninstallation: " confirm
    fi
    echo ""

    if [ "$KEEP_DATA" = true ]; then
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Uninstall cancelled."
            exit 0
        fi
    else
        if [ "$confirm" != "DELETE" ]; then
            echo "Uninstall cancelled."
            exit 0
        fi
    fi
fi

echo ""
echo "Stopping and removing containers..."

# Stop main containers
docker compose down --remove-orphans 2>/dev/null || true

# Stop optional compose files
docker compose -f docker-compose.monitoring.yml down 2>/dev/null || true
docker compose -f docker-compose.tor.yml down 2>/dev/null || true

if [ "$KEEP_DATA" = false ]; then
    echo "Removing Docker volumes..."
    # Remove volumes explicitly (in case compose down -v missed some)
    docker volume rm sanctuary_postgres_data 2>/dev/null || true
    docker volume rm sanctuary_redis_data 2>/dev/null || true
    # Legacy cleanup from the removed Sanctuary-managed model runtime.
    docker volume rm sanctuary_ollama_data 2>/dev/null || true
    # Also try without project prefix
    docker volume rm postgres_data 2>/dev/null || true
    docker volume rm redis_data 2>/dev/null || true
    # Legacy cleanup from the removed Sanctuary-managed model runtime.
    docker volume rm ollama_data 2>/dev/null || true
else
    echo "Removing Redis cache volume (keeping database)..."
    docker volume rm sanctuary_redis_data 2>/dev/null || true
    docker volume rm redis_data 2>/dev/null || true
fi

echo "Removing locally built images..."
docker rmi sanctuary-backend:local 2>/dev/null || true
docker rmi sanctuary-frontend:local 2>/dev/null || true
docker rmi sanctuary-gateway:local 2>/dev/null || true
docker rmi sanctuary-llm-egress-proxy:local 2>/dev/null || true

# Clean up any dangling images from builds
docker image prune -f 2>/dev/null || true

if [ "$KEEP_DATA" = false ]; then
    echo "Removing configuration files..."
    rm -f .env .env.local 2>/dev/null || true

    echo "Removing SSL certificates..."
    rm -f docker/nginx/ssl/fullchain.pem docker/nginx/ssl/privkey.pem 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              UNINSTALL COMPLETE                           ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$KEEP_DATA" = true ]; then
    echo "Containers removed. Your database and configuration are preserved."
    echo ""
    echo "To reinstall: ./install.sh"
    echo "To fully remove: ./uninstall.sh (without --keep-data)"
else
    echo "All Sanctuary data has been removed."
    echo ""
    echo "To fully remove Sanctuary, delete this directory:"
    echo -e "  ${YELLOW}rm -rf $SCRIPT_DIR${NC}"
    echo ""
    echo "To reinstall: ./install.sh"
fi
echo ""
