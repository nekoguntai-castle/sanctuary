#!/bin/bash
# ============================================
# Sanctuary Bitcoin Wallet - Install Script
# ============================================
#
# One-liner installation:
#   # Codeberg (public, recommended)
#   curl -fsSL https://codeberg.org/nekoguntai-castle/sanctuary/raw/branch/main/install.sh | bash
#
#   # GitHub (works once any account flag is lifted)
#   curl -fsSL https://raw.githubusercontent.com/nekoguntai-castle/sanctuary/main/install.sh | bash
#
# Or download and run:
#   ./install.sh                       # auto-probes Codeberg, then GitHub, and uses the first reachable
#   ./install.sh --source codeberg     # force Codeberg
#   ./install.sh --source github       # force GitHub
#
# This script handles repository management (clone/update/version checkout),
# then delegates to scripts/setup.sh for configuration and startup.
#
# ============================================

set -e

INSTALL_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd 2>/dev/null || pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================
# Platform detection and configuration
# ============================================

# Repo metadata URL for a given source name. Used as a reachability probe
# (curl returns 200 when the repo is publicly visible) and lets the script
# fall through to alternate forges when the configured source is unreachable
# (e.g., a shadow-banned GitHub org returning 404 to anonymous requests).
_source_probe_url() {
    case "$1" in
        codeberg) echo "https://codeberg.org/api/v1/repos/nekoguntai-castle/sanctuary" ;;
        github)   echo "https://api.github.com/repos/nekoguntai-castle/sanctuary" ;;
    esac
}

_source_reachable() {
    local probe_url
    probe_url=$(_source_probe_url "$1")
    [ -n "$probe_url" ] || return 1
    command -v curl &> /dev/null || return 0   # can't probe → assume yes
    local code
    code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "$probe_url" 2>/dev/null || echo "000")
    [ "$code" = "200" ]
}

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

    # If source specified, use it (respect operator's explicit choice even if
    # the source happens to be unreachable — they may know something we don't,
    # like an upcoming reachability change or auth they'll provide later).
    if [ -n "$source" ]; then
        case "$source" in
            codeberg|Codeberg)
                echo "codeberg"
                return
                ;;
            github|GitHub)
                echo "github"
                return
                ;;
            *)
                echo -e "${YELLOW}Unknown source '$source', auto-detecting...${NC}" >&2
                ;;
        esac
    fi

    # Auto-detect from existing git remote, but only commit to it if the
    # source is actually reachable. If origin is GitHub but GitHub is
    # 404-ing the repo (account flagged, repo private, network blocked),
    # fall through to the auto-probe instead of trying to git ls-remote
    # against an unreachable endpoint and prompting for credentials.
    local detected=""
    if [ -d ".git" ] || [ -d "$INSTALL_DIR/.git" ]; then
        local remote_url
        if [ -d ".git" ]; then
            remote_url=$(git config --get remote.origin.url 2>/dev/null || true)
        else
            remote_url=$(git -C "$INSTALL_DIR" config --get remote.origin.url 2>/dev/null || true)
        fi

        if echo "$remote_url" | grep -qi "codeberg"; then
            detected="codeberg"
        elif echo "$remote_url" | grep -qi "github"; then
            detected="github"
        fi
    fi

    if [ -n "$detected" ] && _source_reachable "$detected"; then
        echo "$detected"
        return
    fi

    if [ -n "$detected" ]; then
        echo -e "${YELLOW}Detected source '$detected' from existing remote, but it is not reachable. Falling back to auto-probe.${NC}" >&2
    fi

    # Auto-probe public reachability — try each platform's repo metadata
    # endpoint and use the first one that responds. Codeberg first (public,
    # actively mirrored from Forgejo); GitHub second (shadow-banned accounts
    # will 404 here so we fall through naturally).
    if command -v curl &> /dev/null; then
        for candidate in codeberg github; do
            if _source_reachable "$candidate"; then
                echo "$candidate"
                return
            fi
        done
    fi

    # Last-resort default: Codeberg (the one we know is consistently public)
    echo "codeberg"
}

# Configuration
INSTALL_DIR="${SANCTUARY_DIR:-$HOME/sanctuary}"
SKIP_GIT_CHECKOUT="${SKIP_GIT_CHECKOUT:-false}"  # Set to 'true' in CI to skip version checkout
DEFAULT_RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}"
DEFAULT_ENV_FILE="$DEFAULT_RUNTIME_DIR/sanctuary.env"
OFFLINE_BUNDLE="${SANCTUARY_OFFLINE_BUNDLE:-}"
OFFLINE_STAGE_DIR=""
OFFLINE_PREPARED=false
OFFLINE_PUBLIC_KEY="${SANCTUARY_OFFLINE_PUBLIC_KEY:-}"
ALLOW_UNSIGNED_DEV_BUNDLE=false
ALLOW_DOWNGRADE="${SANCTUARY_ALLOW_DOWNGRADE:-false}"
ASSUME_YES="${SANCTUARY_ASSUME_YES:-false}"
SKIP_UPGRADE_BACKUP="${SANCTUARY_SKIP_UPGRADE_BACKUP:-false}"
OFFLINE_TARGET_VERSION=""
OFFLINE_MODE=false

resolve_runtime_env_file() {
    local candidate="${SANCTUARY_ENV_FILE:-$DEFAULT_ENV_FILE}"
    local legacy="$INSTALL_DIR/.env"

    if [ -z "${SANCTUARY_ENV_FILE:-}" ] && [ ! -f "$candidate" ] && [ -f "$legacy" ]; then
        echo "$legacy"
    else
        echo "$candidate"
    fi
}

parse_install_options() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --offline-bundle)
                OFFLINE_BUNDLE="$2"
                OFFLINE_MODE=true
                shift 2
                ;;
            --offline-bundle=*)
                OFFLINE_BUNDLE="${1#*=}"
                OFFLINE_MODE=true
                shift
                ;;
            --offline-prepared)
                OFFLINE_PREPARED=true
                OFFLINE_MODE=true
                SKIP_GIT_CHECKOUT=true
                shift
                ;;
            --offline-public-key)
                OFFLINE_PUBLIC_KEY="$2"
                shift 2
                ;;
            --offline-public-key=*)
                OFFLINE_PUBLIC_KEY="${1#*=}"
                shift
                ;;
            --allow-unsigned-dev-bundle)
                ALLOW_UNSIGNED_DEV_BUNDLE=true
                shift
                ;;
            --allow-downgrade)
                ALLOW_DOWNGRADE=true
                shift
                ;;
            --yes|-y)
                ASSUME_YES=true
                shift
                ;;
            --skip-upgrade-backup)
                SKIP_UPGRADE_BACKUP=true
                shift
                ;;
            --source)
                shift 2
                ;;
            --source=*)
                shift
                ;;
            *)
                shift
                ;;
        esac
    done

    if [ -n "$OFFLINE_BUNDLE" ]; then
        OFFLINE_MODE=true
    fi
}

prepare_offline_bundle() {
    [ -n "$OFFLINE_BUNDLE" ] || return 0

    local apply_script="$INSTALL_SCRIPT_DIR/scripts/offline/apply-bundle.sh"
    if [ ! -x "$apply_script" ]; then
        apply_script="$INSTALL_DIR/scripts/offline/apply-bundle.sh"
    fi
    [ -x "$apply_script" ] || {
        echo -e "${RED}✗${NC} Offline bundle helper not found"
        echo "Run this from a bundle-aware Sanctuary checkout, or use the bundle's install-offline.sh bootstrap after verifying the signature."
        exit 1
    }

    OFFLINE_STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-offline-bundle.XXXXXX")"
    trap 'rm -rf "$OFFLINE_STAGE_DIR"' EXIT

    local args=(--bundle "$OFFLINE_BUNDLE" --stage-dir "$OFFLINE_STAGE_DIR" --prepare-only)
    [ -n "$OFFLINE_PUBLIC_KEY" ] && args+=(--public-key "$OFFLINE_PUBLIC_KEY")
    [ "$ALLOW_UNSIGNED_DEV_BUNDLE" = true ] && args+=(--allow-unsigned-dev-bundle)

    "$apply_script" "${args[@]}"
    # shellcheck disable=SC1091
    source "$OFFLINE_STAGE_DIR/manifest.env"
    RELEASE_TAG="${SANCTUARY_GIT_TAG:-}"
    OFFLINE_TARGET_VERSION="${SANCTUARY_VERSION:-$RELEASE_TAG}"
    [ -n "$RELEASE_TAG" ] || {
        echo -e "${RED}✗${NC} Offline bundle manifest is missing SANCTUARY_GIT_TAG"
        exit 1
    }
}

apply_offline_bundle() {
    [ -n "$OFFLINE_BUNDLE" ] || return 0

    local apply_script="$INSTALL_SCRIPT_DIR/scripts/offline/apply-bundle.sh"
    if [ ! -x "$apply_script" ]; then
        apply_script="$INSTALL_DIR/scripts/offline/apply-bundle.sh"
    fi

    local args=(--staged-dir "$OFFLINE_STAGE_DIR" --install-dir "$INSTALL_DIR" --apply)
    [ -n "$OFFLINE_PUBLIC_KEY" ] && args+=(--public-key "$OFFLINE_PUBLIC_KEY")
    [ "$ALLOW_UNSIGNED_DEV_BUNDLE" = true ] && args+=(--allow-unsigned-dev-bundle)

    "$apply_script" "${args[@]}"
}

semver_parts() {
    local version="${1#v}"
    if [[ "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)([-+].*)?$ ]]; then
        echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]} ${BASH_REMATCH[3]}"
        return 0
    fi
    return 1
}

is_semver_downgrade() {
    local current="$1"
    local target="$2"
    local current_parts target_parts current_major current_minor current_patch target_major target_minor target_patch

    current_parts="$(semver_parts "$current")" || return 1
    target_parts="$(semver_parts "$target")" || return 1

    read -r current_major current_minor current_patch <<< "$current_parts"
    read -r target_major target_minor target_patch <<< "$target_parts"

    if [ "$target_major" -lt "$current_major" ]; then
        return 0
    elif [ "$target_major" -gt "$current_major" ]; then
        return 1
    fi

    if [ "$target_minor" -lt "$current_minor" ]; then
        return 0
    elif [ "$target_minor" -gt "$current_minor" ]; then
        return 1
    fi

    [ "$target_patch" -lt "$current_patch" ]
}

reject_downgrade_unless_allowed() {
    local current_version="$1"
    local target_version="$2"

    if [ "$ALLOW_DOWNGRADE" = "true" ]; then
        return 0
    fi

    if is_semver_downgrade "$current_version" "$target_version"; then
        echo -e "${RED}✗${NC} Refusing downgrade from $current_version to $target_version."
        echo "Database migrations may be irreversible. Restore from a backup or rerun with --allow-downgrade only for explicit recovery."
        exit 1
    fi
}

find_upgrade_backup_script() {
    if [ -x "$INSTALL_SCRIPT_DIR/scripts/create-upgrade-backup.sh" ]; then
        echo "$INSTALL_SCRIPT_DIR/scripts/create-upgrade-backup.sh"
    elif [ -x "$INSTALL_DIR/scripts/create-upgrade-backup.sh" ]; then
        echo "$INSTALL_DIR/scripts/create-upgrade-backup.sh"
    else
        echo ""
    fi
}

has_existing_database() {
    docker volume ls -q 2>/dev/null | grep -q "sanctuary.*postgres_data\|postgres_data"
}

create_upgrade_backup_or_prompt() {
    local target_version="$1"

    if ! has_existing_database; then
        return 0
    fi

    echo ""
    echo -e "${YELLOW}Existing database detected.${NC}"

    if [ "$SKIP_UPGRADE_BACKUP" = "true" ]; then
        echo -e "${YELLOW}Warning: skipping pre-upgrade backup by explicit request.${NC}"
        return 0
    fi

    if [ "$ASSUME_YES" != "true" ] && [ ! -t 0 ]; then
        echo -e "${RED}✗${NC} Non-interactive upgrade requires --yes or SANCTUARY_ASSUME_YES=true."
        echo "To skip the local backup explicitly, also set SANCTUARY_SKIP_UPGRADE_BACKUP=true."
        exit 1
    fi

    local make_backup=true
    if [ -t 0 ]; then
        echo ""
        echo "Create a local pre-upgrade backup before continuing? [Y/n] "
        read -r REPLY
        if [[ $REPLY =~ ^[Nn]$ ]]; then
            make_backup=false
            echo ""
            read -p "Continue without a backup? [y/N] " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo "Upgrade cancelled. Run again after backing up."
                exit 0
            fi
        fi
    fi

    if [ "$make_backup" = true ]; then
        local backup_script
        backup_script="$(find_upgrade_backup_script)"
        if [ -n "$backup_script" ]; then
            "$backup_script" --install-dir "$INSTALL_DIR" --target-version "$target_version"
        else
            echo -e "${YELLOW}Warning: automatic backup helper is not available.${NC}"
            echo "Before upgrading, we recommend backing up your database:"
            echo -e "  ${GREEN}docker exec \$(docker compose ps -q postgres) pg_dump -U sanctuary sanctuary > backup-\$(date +%Y%m%d).sql${NC}"
            if [ -t 0 ]; then
                read -p "Continue with upgrade? [Y/n] " -n 1 -r
                echo ""
                if [[ $REPLY =~ ^[Nn]$ ]]; then
                    echo "Upgrade cancelled. Run again after backing up."
                    exit 0
                fi
            fi
        fi
    fi
}

parse_install_options "$@"

# Detect source platform
SOURCE_PLATFORM=$(detect_source "$@")

# Set platform-specific URLs
case "$SOURCE_PLATFORM" in
    codeberg)
        REPO_URL="https://codeberg.org/nekoguntai-castle/sanctuary.git"
        API_URL="https://codeberg.org/api/v1/repos/nekoguntai-castle/sanctuary/releases/latest"
        PLATFORM_NAME="Codeberg"
        ;;
    github|*)
        REPO_URL="https://github.com/nekoguntai-castle/sanctuary.git"
        API_URL="https://api.github.com/repos/nekoguntai-castle/sanctuary/releases/latest"
        PLATFORM_NAME="GitHub"
        ;;
esac

if [ "$OFFLINE_MODE" = true ]; then
    REPO_URL="${OFFLINE_BUNDLE:-preloaded offline bundle}"
    API_URL=""
    PLATFORM_NAME="Offline bundle"
fi

# ============================================
# Get latest release tag
# ============================================
get_latest_release() {
    local tag=""

    # Try platform-specific API first
    if command -v curl &> /dev/null; then
        # Single sed parser handles both JSON formats:
        #   GitHub:   "tag_name": "v0.8.49"   (formatted, with whitespace)
        #   Codeberg: "tag_name":"v0.8.49"    (compact)
        case "$SOURCE_PLATFORM" in
            codeberg|github|*)
                tag=$(curl -fsSL "$API_URL" 2>/dev/null \
                    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
                    | head -1)
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
    if [ "$OFFLINE_MODE" = true ]; then
        SETUP_FLAGS="$SETUP_FLAGS --offline"
    fi
    UPGRADE_ENV_FILE="$(resolve_runtime_env_file)"

    # Get the latest release tag (skip in CI to test current code)
    if [ -n "$OFFLINE_BUNDLE" ]; then
        echo "Verifying offline bundle..."
        prepare_offline_bundle
        echo -e "${GREEN}✓${NC} Offline bundle target: ${RELEASE_TAG}"

        if [ -d "$INSTALL_DIR" ] || [ -f "$UPGRADE_ENV_FILE" ]; then
            IS_UPGRADE=true
            echo -e "${YELLOW}Existing installation detected.${NC}"
            if [ -d "$INSTALL_DIR/.git" ]; then
                CURRENT_VERSION=$(git -C "$INSTALL_DIR" describe --tags 2>/dev/null || git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
                echo ""
                echo "  Current version: $CURRENT_VERSION"
                echo "  New version:     $RELEASE_TAG"
                reject_downgrade_unless_allowed "$CURRENT_VERSION" "$RELEASE_TAG"
            fi
            create_upgrade_backup_or_prompt "$RELEASE_TAG"
        fi

        echo ""
        echo "Applying offline bundle..."
        apply_offline_bundle
        cd "$INSTALL_DIR"
    elif [ "$SKIP_GIT_CHECKOUT" = "true" ]; then
        echo -e "${GREEN}✓${NC} Skipping git checkout (SKIP_GIT_CHECKOUT=true)"
        RELEASE_TAG=""
        cd "$INSTALL_DIR"
        if [ -f "$UPGRADE_ENV_FILE" ]; then
            IS_UPGRADE=true
            echo -e "${GREEN}✓${NC} Existing runtime env detected: $UPGRADE_ENV_FILE"
        fi
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

            create_upgrade_backup_or_prompt "${RELEASE_TAG:-latest}"

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
    if [ "$OFFLINE_MODE" = true ]; then
        export SANCTUARY_INSTALL_MODE=offline
        export SANCTUARY_OFFLINE_VERSION="${OFFLINE_TARGET_VERSION:-${SANCTUARY_OFFLINE_VERSION:-$RELEASE_TAG}}"
    fi

    # Run setup.sh
    "$INSTALL_DIR/scripts/setup.sh" $SETUP_FLAGS
}

# Run main function
main "$@"
