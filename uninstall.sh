#!/bin/bash
# ============================================
# Sanctuary Bitcoin Wallet - Uninstall Script
# ============================================
#
# This script removes the exact active Sanctuary deployment. Data deletion is
# separately confirmed; shared or name-only image/volume cleanup is forbidden.
#
# Usage:
#   ./uninstall.sh                 # Remove containers and preserve all data
#   ./uninstall.sh --delete-data   # Separately confirm active-deployment data deletion
#   ./uninstall.sh --force         # Skip the keep-data confirmation prompt
#
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$SCRIPT_DIR/scripts/ownership/producer-hooks.sh"

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Options
FORCE=false
KEEP_DATA=true
DATA_OPTION=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --force|-f)
            FORCE=true
            shift
            ;;
        --keep-data)
            [ -z "$DATA_OPTION" ] || { echo "Choose only one data option." >&2; exit 1; }
            KEEP_DATA=true
            DATA_OPTION=keep
            shift
            ;;
        --delete-data)
            [ -z "$DATA_OPTION" ] || { echo "Choose only one data option." >&2; exit 1; }
            KEEP_DATA=false
            DATA_OPTION=delete
            shift
            ;;
        --help|-h)
            echo "Usage: ./uninstall.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --force, -f    Skip confirmation prompts"
            echo "  --keep-data    Remove containers and preserve all volumes (default)"
            echo "  --delete-data  Delete non-external volumes managed by the exact active deployment"
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

ownership_prepare_operator_compose "$SCRIPT_DIR"

echo ""
echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║              SANCTUARY UNINSTALL                          ║${NC}"
echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$KEEP_DATA" = true ]; then
    echo -e "${YELLOW}This will remove:${NC}"
    echo "  - All Docker containers"
    echo ""
    echo -e "${GREEN}This will KEEP:${NC}"
    echo "  - All Docker volumes, including database and Redis data"
    echo "  - Docker images and shared build cache"
    echo "  - Your .env file"
    echo ""
else
    echo -e "${YELLOW}This will permanently delete:${NC}"
    echo "  - All Docker containers"
    echo "  - Non-external volumes managed by the exact active deployment (database and Redis)"
    echo "  - Your .env file with secrets"
    echo "  - SSL certificates"
    echo ""
    echo -e "${RED}YOUR WALLET DATA WILL BE PERMANENTLY LOST!${NC}"
    echo ""
    echo "Consider backing up first:"
    echo -e "  ${GREEN}docker exec \$(./scripts/ownership/run-operator-compose.sh ps -q postgres) pg_dump -U sanctuary sanctuary > backup.sql${NC}"
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

operator_compose=("$SCRIPT_DIR/scripts/ownership/run-operator-compose.sh")
if [ "$KEEP_DATA" = false ]; then
    operator_compose+=(--confirm-data-delete)
fi
operator_compose+=(down --remove-orphans)
if [ "$KEEP_DATA" = false ]; then
    operator_compose+=(--volumes)
fi
if ! "${operator_compose[@]}"; then
    echo -e "${RED}Failed to stop the Sanctuary Compose project; uninstall aborted before data removal.${NC}" >&2
    exit 1
fi

echo "Docker images, external or unregistered legacy volumes, and shared build cache were preserved."

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
    echo "To delete active-deployment data: ./uninstall.sh --delete-data"
else
    echo "Deployment-managed data was removed; external or legacy volumes were preserved."
    echo ""
    echo "The checkout was preserved. Review it and any external volumes separately before"
    echo "using your operating system's recoverable trash action."
    echo ""
    echo "To reinstall: ./install.sh"
fi
echo ""
