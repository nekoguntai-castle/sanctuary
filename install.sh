#!/bin/bash
# ============================================
# Sanctuary Bitcoin Wallet - Install Script
# ============================================
#
# One-liner installation (GitHub):
#   curl -fsSL https://raw.githubusercontent.com/nekoguntai-castle/sanctuary/main/install.sh | bash
#
# Or download and run:
#   ./install.sh
#   ./install.sh --source github
#
# This script handles repository management (clone/update/version checkout),
# then delegates to scripts/setup.sh for configuration and startup.
#
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================
# Platform detection and configuration
# ============================================
detect_source() {
    local source=""
    # Check if --source argument was provided
    while [[ $# -gt 0 ]]; do
        case $1 in
            --source)
                source="$2"
                shift 2
                ;;
            --source=*)
                source="${1#*=}"
                shift
                ;;
            *)
                shift
                ;;
        esac
    done

    # If source specified, use it
    if [ -n "$source" ]; then
        case "$source" in
            github|GitHub)
                echo "github"
                return
                ;;
            gitlab|GitLab)
                echo "gitlab"
                return
                ;;
            *)
                echo -e "${YELLOW}Unknown source '$source', auto-detecting...${NC}" >&2
                ;;
        esac
    fi

    # Auto-detect from existing git remote
    if [ -d ".git" ] || [ -d "$INSTALL_DIR/.git" ]; then
        local remote_url
        if [ -d ".git" ]; then
            remote_url=$(git config --get remote.origin.url 2>/dev/null || true)
        else
            remote_url=$(git -C "$INSTALL_DIR" config --get remote.origin.url 2>/dev/null || true)
        fi

        if echo "$remote_url" | grep -qi "gitlab"; then
            echo "gitlab"
            return
        elif echo "$remote_url" | grep -qi "github"; then
            echo "github"
            return
        fi
    fi

    # Default to GitHub
    echo "github"
}

# Configuration
INSTALL_DIR="${SANCTUARY_DIR:-$HOME/sanctuary}"
SKIP_GIT_CHECKOUT="${SKIP_GIT_CHECKOUT:-false}"  # Set to 'true' in CI to skip version checkout
DEFAULT_RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}"
DEFAULT_ENV_FILE="$DEFAULT_RUNTIME_DIR/sanctuary.env"

resolve_runtime_env_file() {
    local candidate="${SANCTUARY_ENV_FILE:-$DEFAULT_ENV_FILE}"
    local legacy="$INSTALL_DIR/.env"

    if [ -z "${SANCTUARY_ENV_FILE:-}" ] && [ ! -f "$candidate" ] && [ -f "$legacy" ]; then
        echo "$legacy"
    else
        echo "$candidate"
    fi
}

# Detect source platform
SOURCE_PLATFORM=$(detect_source "$@")

# Set platform-specific URLs
case "$SOURCE_PLATFORM" in
    gitlab)
        REPO_URL="https://gitlab.com/narusegawa-nekoworks/sanctuary.git"
        API_URL="https://gitlab.com/api/v4/projects/narusegawa-nekoworks%2Fsanctuary/releases"
        PLATFORM_NAME="GitLab"
        ;;
    github|*)
        REPO_URL="https://github.com/nekoguntai-castle/sanctuary.git"
        API_URL="https://api.github.com/repos/nekoguntai-castle/sanctuary/releases/latest"
        PLATFORM_NAME="GitHub"
        ;;
esac

# ============================================
# Get latest release tag
# ============================================
get_latest_release() {
    local tag=""

    # Try platform-specific API first
    if command -v curl &> /dev/null; then
        case "$SOURCE_PLATFORM" in
            gitlab)
                tag=$(curl -fsSL "$API_URL" 2>/dev/null | grep -o '"tag_name":"[^"]*"' | head -1 | cut -d'"' -f4)
                ;;
            github|*)
                tag=$(curl -fsSL "$API_URL" 2>/dev/null | grep '"tag_name"' | head -1 | cut -d'"' -f4)
                ;;
        esac

        if [ -n "$tag" ]; then
            echo "$tag"
            return 0
        fi
    fi

    # Fallback: use git ls-remote to get latest tag
    tag=$(git ls-remote --tags --sort=-v:refname "$REPO_URL" 2>/dev/null | head -1 | sed 's/.*refs\/tags\///' | sed 's/\^{}//')
    if [ -n "$tag" ]; then
        echo "$tag"
        return 0
    fi

    # Last resort: return empty (will use main)
    echo ""
}

# ============================================
# Pre-flight resource checks (warnings only)
# ============================================
check_disk_space() {
    local required_gb=6
    local install_dir="${1:-$HOME}"

    if command -v df &> /dev/null; then
        local available_kb=$(df -k "$install_dir" 2>/dev/null | tail -1 | awk '{print $4}')
        if [ -n "$available_kb" ] && [ "$available_kb" -gt 0 ] 2>/dev/null; then
            local available_gb=$((available_kb / 1024 / 1024))
            if [ "$available_kb" -lt $((required_gb * 1024 * 1024)) ]; then
                echo -e "${YELLOW}Warning: Low disk space detected.${NC}"
                echo "  Available: ${available_gb}GB (recommended: ${required_gb}GB+)"
                echo "  Docker images and build cache require significant space."
                echo ""
            else
                echo -e "${GREEN}✓${NC} Disk space: ${available_gb}GB available"
            fi
        fi
    fi
}

check_memory() {
    local required_gb=4

    # Linux: read from /proc/meminfo
    if [ -f /proc/meminfo ]; then
        local total_kb=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}')
        if [ -n "$total_kb" ] && [ "$total_kb" -gt 0 ] 2>/dev/null; then
            local total_gb=$((total_kb / 1024 / 1024))
            if [ "$total_kb" -lt $((required_gb * 1024 * 1024)) ]; then
                echo -e "${YELLOW}Warning: Low memory detected.${NC}"
                echo "  Available: ${total_gb}GB RAM (recommended: ${required_gb}GB+)"
                echo "  Sanctuary containers require approximately 4GB RAM."
                echo ""
            else
                echo -e "${GREEN}✓${NC} Memory: ${total_gb}GB RAM available"
            fi
        fi
    # macOS: use sysctl
    elif command -v sysctl &> /dev/null; then
        local total_bytes=$(sysctl -n hw.memsize 2>/dev/null)
        if [ -n "$total_bytes" ] && [ "$total_bytes" -gt 0 ] 2>/dev/null; then
            local total_gb=$((total_bytes / 1024 / 1024 / 1024))
            if [ "$total_gb" -lt "$required_gb" ]; then
                echo -e "${YELLOW}Warning: Low memory detected.${NC}"
                echo "  Available: ${total_gb}GB RAM (recommended: ${required_gb}GB+)"
                echo ""
            else
                echo -e "${GREEN}✓${NC} Memory: ${total_gb}GB RAM available"
            fi
        fi
    fi
}

check_wsl() {
    if uname -r 2>/dev/null | grep -qi "wsl\|microsoft"; then
        echo -e "${BLUE}ℹ${NC} WSL detected - ensure Docker Desktop for Windows is running"
    fi
}

check_architecture() {
    local arch=$(uname -m 2>/dev/null)
    case "$arch" in
        arm64|aarch64)
            echo -e "${BLUE}ℹ${NC} ARM64 architecture detected"
            if [ "$(uname -s)" = "Darwin" ]; then
                echo "  Apple Silicon Mac - Docker Desktop includes Rosetta for x86 images"
            else
                echo "  Some images may need ARM64 variants or emulation"
            fi
            ;;
        x86_64|amd64)
            # Standard architecture, no message needed
            ;;
        *)
            echo -e "${YELLOW}ℹ${NC} Unusual architecture detected: $arch"
            echo "  Some Docker images may not be available for this platform"
            ;;
    esac
}

# ============================================
# Main installation
# ============================================
main() {
    # Show welcome banner
    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}              ${GREEN}Sanctuary Bitcoin Wallet${NC}                    ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}           Your keys, your coins, your server.             ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GREEN}✓${NC} Source: ${PLATFORM_NAME} (${REPO_URL})"
    echo ""

    # Check git is installed (required for cloning)
    if ! command -v git &> /dev/null; then
        echo -e "${RED}✗${NC} Git is not installed"
        echo ""
        echo "Git is required to download Sanctuary."
        echo "Install Git:"
        echo "  - Windows: https://git-scm.com/download/win"
        echo "  - Mac: brew install git"
        echo "  - Linux: sudo apt install git"
        exit 1
    fi
    echo -e "${GREEN}✓${NC} Git is installed"

    # Run optional resource/environment checks (warnings only)
    check_disk_space "$HOME"
    check_memory
    check_wsl
    check_architecture

    echo ""

    # Track if this is an upgrade
    IS_UPGRADE=false
    SETUP_FLAGS="--from-install"

    # Get the latest release tag (skip in CI to test current code)
    if [ "$SKIP_GIT_CHECKOUT" = "true" ]; then
        echo -e "${GREEN}✓${NC} Skipping git checkout (SKIP_GIT_CHECKOUT=true)"
        RELEASE_TAG=""
        cd "$INSTALL_DIR"
    else
        echo "Fetching latest release..."
        RELEASE_TAG=$(get_latest_release)
        if [ -n "$RELEASE_TAG" ]; then
            echo -e "${GREEN}✓${NC} Latest release: $RELEASE_TAG"
        else
            echo -e "${YELLOW}⚠${NC} Could not determine latest release, using main branch"
        fi

        # Clone or update repository
        if [ -d "$INSTALL_DIR" ]; then
            IS_UPGRADE=true
            echo -e "${YELLOW}Directory $INSTALL_DIR already exists.${NC}"

            # Show version information
            cd "$INSTALL_DIR"
            CURRENT_VERSION=$(git describe --tags 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "unknown")
            echo ""
            echo "  Current version: $CURRENT_VERSION"
            if [ -n "$RELEASE_TAG" ]; then
                echo "  New version:     $RELEASE_TAG"
            fi

            # Check if database container exists with data
            if docker volume ls -q 2>/dev/null | grep -q "sanctuary.*postgres_data\|postgres_data"; then
                echo ""
                echo -e "${YELLOW}Existing database detected.${NC}"
                echo ""
                echo "Before upgrading, we recommend backing up your database:"
                echo -e "  ${GREEN}docker exec \$(docker compose ps -q postgres) pg_dump -U sanctuary sanctuary > backup-\$(date +%Y%m%d).sql${NC}"
                echo ""
                if [ -t 0 ]; then
                    read -p "Continue with upgrade? [Y/n] " -n 1 -r
                    echo ""
                    if [[ $REPLY =~ ^[Nn]$ ]]; then
                        echo "Upgrade cancelled. Run again after backing up."
                        exit 0
                    fi
                fi
            fi

            echo ""
            echo "Updating existing installation..."
            git fetch --tags 2>/dev/null || true
            if [ -n "$RELEASE_TAG" ]; then
                git checkout "$RELEASE_TAG" 2>/dev/null || {
                    echo -e "${YELLOW}Could not checkout $RELEASE_TAG. Continuing with current version.${NC}"
                }
            fi
        else
            echo "Cloning Sanctuary to $INSTALL_DIR..."
            git clone "$REPO_URL" "$INSTALL_DIR"
            cd "$INSTALL_DIR"
            if [ -n "$RELEASE_TAG" ]; then
                git checkout "$RELEASE_TAG" 2>/dev/null || {
                    echo -e "${YELLOW}Could not checkout $RELEASE_TAG. Using main branch.${NC}"
                }
            fi
        fi
    fi

    echo -e "${GREEN}✓${NC} Repository ready"
    echo ""

    # For upgrades, load existing secrets so setup.sh preserves them.
    # Prefer the operator-owned runtime env, with repo-root .env kept as
    # a backwards-compatible fallback for older installations.
    UPGRADE_ENV_FILE="$(resolve_runtime_env_file)"
    if [ "$IS_UPGRADE" = true ] && [ -f "$UPGRADE_ENV_FILE" ]; then
        echo -e "${GREEN}✓${NC} Loading existing configuration..."
        set -a
        source "$UPGRADE_ENV_FILE"
        set +a
        # Force overwrite since we're upgrading, and force clean rebuild
        SETUP_FLAGS="$SETUP_FLAGS --force --upgrade"
    fi

    # Pass through optional feature flags if set via environment
    if [ -n "$ENABLE_MONITORING" ]; then
        if [ "$ENABLE_MONITORING" = "yes" ] || [ "$ENABLE_MONITORING" = "true" ]; then
            SETUP_FLAGS="$SETUP_FLAGS --enable-monitoring"
        fi
    fi
    if [ -n "$ENABLE_TOR" ]; then
        if [ "$ENABLE_TOR" = "yes" ] || [ "$ENABLE_TOR" = "true" ]; then
            SETUP_FLAGS="$SETUP_FLAGS --enable-tor"
        fi
    fi

    # Delegate to setup.sh for the rest
    echo "Running setup..."
    echo ""

    # Export secrets so setup.sh can use them (but NOT feature flags - let setup.sh prompt)
    export JWT_SECRET ENCRYPTION_KEY ENCRYPTION_SALT GATEWAY_SECRET POSTGRES_PASSWORD AI_CONFIG_SECRET REDIS_PASSWORD
    export HTTPS_PORT HTTP_PORT GATEWAY_PORT

    # Run setup.sh
    "$INSTALL_DIR/scripts/setup.sh" $SETUP_FLAGS
}

# Run main function
main "$@"
