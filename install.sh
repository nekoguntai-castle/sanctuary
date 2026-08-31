#!/bin/bash
# ============================================
# Sanctuary Bitcoin Wallet - Install Script
# ============================================
#
# One-liner installation:
#   curl -fsSL https://raw.githubusercontent.com/nekoguntai-castle/sanctuary/main/install.sh | bash
#
# Or download and run:
#   ./install.sh
#
# This script handles repository management (clone/update/version checkout),
# then delegates to scripts/setup.sh for configuration and startup.
#
# GitHub is the canonical online source for repository and release distribution.
# Offline bundle installation remains available without GitHub connectivity.
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
SOURCE_OPTION=""
REPO_URL="https://github.com/nekoguntai-castle/sanctuary.git"
RELEASE_API_URL="https://api.github.com/repos/nekoguntai-castle/sanctuary/releases/latest"
PLATFORM_NAME="GitHub"
INSTALL_DEPLOYMENT_LOCK_ACTIVE=false

install_cleanup() {
    local status=$?
    if [ "$INSTALL_DEPLOYMENT_LOCK_ACTIVE" = true ]; then
        install_deployment_lock_release || true
    fi
    if [ -n "$OFFLINE_STAGE_DIR" ] && [ -d "$OFFLINE_STAGE_DIR" ]; then
        rm -rf -- "$OFFLINE_STAGE_DIR"
    fi
    return "$status"
}
trap install_cleanup EXIT

install_lock_sanitize_id() {
    local value="${1,,}"
    value="${value//[^a-z0-9._:-]/-}"
    [[ "$value" =~ ^[a-z0-9] ]] || value="x-$value"
    while [ "${value%-}" != "$value" ]; do value="${value%-}"; done
    printf '%s' "$value"
}

install_deployment_lock_runtime() {
    node --input-type=module - "$1" <<'NODE'
import { randomUUID } from 'node:crypto';
import {
  closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const action = process.argv[2];
const runtimeDirectory = process.env.SANCTUARY_RUNTIME_DIR;
const deploymentId = process.env.SANCTUARY_DEPLOYMENT_ID;
const operationRunId = process.env.SANCTUARY_OPERATION_RUN_ID;
const controllerPid = Number(process.env.SANCTUARY_LOCK_CONTROLLER_PID);
if (!runtimeDirectory || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(deploymentId ?? '')
  || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(operationRunId ?? '')
  || !Number.isSafeInteger(controllerPid) || controllerPid < 1) {
  throw new Error('installer deployment lock identity is invalid');
}

const root = path.join(path.resolve(runtimeDirectory), 'ownership', 'deployments', deploymentId);
const lockPath = path.join(root, 'mutation-lock');
const ownerPath = path.join(lockPath, 'owner.json');
const processStartIdentity = (pid) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).split(' ');
    if (fields[19]) return `linux-boot-ticks:${fields[19]}`;
  } catch {}
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
  const start = result.status === 0 ? result.stdout.trim() : '';
  if (!start) throw new Error(`cannot determine process start identity for PID ${pid}`);
  return `ps-lstart:${start}`;
};
const canonical = (value) => JSON.stringify(value, Object.keys(value).sort());
const fsyncDirectory = (directory) => {
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
};

if (action === 'acquire') {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (realpathSync(root) !== path.resolve(root)) throw new Error('deployment lock path traverses a symlink');
  const rootInfo = lstatSync(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()
    || (typeof process.getuid === 'function' && rootInfo.uid !== process.getuid())
    || (rootInfo.mode & 0o077) !== 0) {
    throw new Error('deployment lock directory must be owner-only');
  }
  try { mkdirSync(lockPath, { mode: 0o700 }); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('deployment mutation lock is already held');
    throw error;
  }
  const now = new Date().toISOString();
  const owner = {
    acquiredAt: now,
    generation: null,
    heartbeatAt: now,
    journalPath: null,
    lockVersion: 1,
    operationRunId,
    pid: controllerPid,
    processStartIdentity: processStartIdentity(controllerPid),
    token: randomUUID(),
  };
  try {
    writeFileSync(ownerPath, canonical(owner), { flag: 'wx', mode: 0o600 });
    const descriptor = openSync(ownerPath, constants.O_RDONLY);
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    fsyncDirectory(lockPath);
    fsyncDirectory(root);
  } catch (error) {
    try { unlinkSync(ownerPath); } catch {}
    try { rmdirSync(lockPath); } catch {}
    throw error;
  }
  process.stdout.write(owner.token);
} else if (action === 'release') {
  const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
  if (owner.token !== process.env.SANCTUARY_DEPLOYMENT_LOCK_TOKEN
    || owner.operationRunId !== operationRunId || owner.pid !== controllerPid
    || owner.processStartIdentity !== processStartIdentity(controllerPid)) {
    throw new Error('installer deployment lock ownership changed');
  }
  unlinkSync(ownerPath);
  fsyncDirectory(lockPath);
  rmdirSync(lockPath);
  fsyncDirectory(root);
} else {
  throw new Error('installer deployment lock action is invalid');
}
NODE
}

install_deployment_lock_release() {
    [ "${DEPLOYMENT_LOCK_OWNERSHIP:-}" = owned ] || return 0
    [ -n "${SANCTUARY_DEPLOYMENT_LOCK_TOKEN:-}" ] || return 0
    install_deployment_lock_runtime release
    DEPLOYMENT_LOCK_OWNERSHIP=released
    INSTALL_DEPLOYMENT_LOCK_ACTIVE=false
}

ensure_install_deployment_lock() {
    [ "$INSTALL_DEPLOYMENT_LOCK_ACTIVE" = true ] && return 0
    local node_major
    node_major="$(node --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\).*/\1/p')"
    if [ -z "$node_major" ] || [ "$node_major" -lt 24 ]; then
        echo -e "${RED}✗${NC} Node.js 24 or newer is required before upgrading Sanctuary."
        return 1
    fi
    SANCTUARY_PROJECT_DIR="$INSTALL_DIR"
    SANCTUARY_RUNTIME_DIR="$DEFAULT_RUNTIME_DIR"
    SANCTUARY_ENV_FILE="$(resolve_runtime_env_file)"
    SANCTUARY_PROJECT="$(install_lock_sanitize_id "${SANCTUARY_PROJECT:-${COMPOSE_PROJECT_NAME:-sanctuary}}")"
    SANCTUARY_DEPLOYMENT_ID="${SANCTUARY_DEPLOYMENT_ID:-deploy-$SANCTUARY_PROJECT}"
    SANCTUARY_OPERATION_RUN_ID="${SANCTUARY_OPERATION_RUN_ID:-run-$$}"
    SANCTUARY_LOCK_CONTROLLER_PID="${SANCTUARY_LOCK_CONTROLLER_PID:-$$}"
    export SANCTUARY_PROJECT_DIR SANCTUARY_RUNTIME_DIR SANCTUARY_ENV_FILE SANCTUARY_PROJECT
    export SANCTUARY_DEPLOYMENT_ID SANCTUARY_OPERATION_RUN_ID SANCTUARY_LOCK_CONTROLLER_PID
    SANCTUARY_DEPLOYMENT_LOCK_TOKEN="$(install_deployment_lock_runtime acquire)"
    DEPLOYMENT_LOCK_OWNERSHIP=owned
    export SANCTUARY_DEPLOYMENT_LOCK_TOKEN DEPLOYMENT_LOCK_OWNERSHIP
    INSTALL_DEPLOYMENT_LOCK_ACTIVE=true
}

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
                if [ $# -lt 2 ] || [ -z "$2" ]; then
                    echo -e "${RED}✗${NC} --source requires a value."
                    exit 1
                fi
                SOURCE_OPTION="$2"
                shift 2
                ;;
            --source=*)
                SOURCE_OPTION="${1#*=}"
                if [ -z "$SOURCE_OPTION" ]; then
                    echo -e "${RED}✗${NC} --source requires a value."
                    exit 1
                fi
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

validate_online_source_option() {
    [ "$OFFLINE_MODE" = true ] && return 0
    [ -z "$SOURCE_OPTION" ] && return 0

    case "$SOURCE_OPTION" in
        github|GitHub)
            return 0
            ;;
        *)
            echo -e "${RED}✗${NC} Online installation is GitHub-only; source '$SOURCE_OPTION' is not supported."
            echo "Remove --source and retry. GitHub source: $REPO_URL"
            exit 1
            ;;
    esac
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
validate_online_source_option

if [ "$OFFLINE_MODE" = true ]; then
    REPO_URL="${OFFLINE_BUNDLE:-preloaded offline bundle}"
    RELEASE_API_URL=""
    PLATFORM_NAME="Offline bundle"
fi

# ============================================
# Get latest release tag
# ============================================
git_no_prompt() {
    GIT_TERMINAL_PROMPT=0 git "$@"
}

get_latest_release() {
    local tag=""
    if command -v curl &> /dev/null; then
        tag=$(curl -fsSL "$RELEASE_API_URL" 2>/dev/null \
            | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
            | head -1)

        if [ -n "$tag" ]; then
            echo "$tag"
            return 0
        fi
    fi

    tag=$(
        git_no_prompt ls-remote --tags --sort=-v:refname "$REPO_URL" 2>/dev/null \
            | awk '$2 ~ /^refs\/tags\/v[0-9]+\.[0-9]+\.[0-9]+$/ {
                sub(/^refs\/tags\//, "", $2)
                print $2
                exit
            }'
    )
    if [ -n "$tag" ]; then
        echo "$tag"
        return 0
    fi

    return 1
}

resolve_latest_release() {
    RELEASE_TAG=""
    RELEASE_TAG="$(get_latest_release || true)"
    [ -n "$RELEASE_TAG" ]
}

ensure_origin_url() {
    local repo_url="$1"

    if git remote get-url origin >/dev/null 2>&1; then
        git remote set-url origin "$repo_url"
    else
        git remote add origin "$repo_url"
    fi
}

fetch_existing_installation() {
    local fetch_output

    ensure_origin_url "$REPO_URL" || {
        echo -e "${RED}✗${NC} Could not configure the GitHub origin: $REPO_URL"
        exit 1
    }
    if fetch_output="$(git_no_prompt fetch --tags origin 2>&1)"; then
        return 0
    fi

    if [[ "$fetch_output" == *"would clobber existing tag"* ]]; then
        echo -e "${YELLOW}Local release tags differ from GitHub. Refreshing tags from the canonical source...${NC}" >&2
        if git_no_prompt fetch --tags --force origin >/dev/null 2>&1; then
            return 0
        fi
    fi

    echo -e "${RED}✗${NC} Could not fetch updates from GitHub."
    echo "Check GitHub connectivity and repository access: $REPO_URL"
    exit 1
}

clone_repository() {
    local parent_dir temp_dir
    parent_dir="$(dirname "$INSTALL_DIR")"
    mkdir -p "$parent_dir" || {
        echo -e "${RED}✗${NC} Could not create the installation parent directory: $parent_dir"
        exit 1
    }
    temp_dir="$(mktemp -d "$parent_dir/.sanctuary-clone.XXXXXX")" || {
        echo -e "${RED}✗${NC} Could not create a temporary clone directory under: $parent_dir"
        exit 1
    }

    if git_no_prompt clone "$REPO_URL" "$temp_dir" >/dev/null 2>&1; then
        mv "$temp_dir" "$INSTALL_DIR"
        return 0
    fi

    rm -rf "$temp_dir"
    echo -e "${RED}✗${NC} Could not clone Sanctuary from GitHub."
    echo "Check GitHub connectivity and repository access: $REPO_URL"
    exit 1
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
            ensure_install_deployment_lock
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
            ensure_install_deployment_lock
            echo -e "${GREEN}✓${NC} Existing runtime env detected: $UPGRADE_ENV_FILE"
        fi
    else
        echo "Fetching latest release..."
        resolve_latest_release || true
        if [ -n "$RELEASE_TAG" ]; then
            echo -e "${GREEN}✓${NC} Latest release: $RELEASE_TAG"
        else
            echo -e "${YELLOW}⚠${NC} Could not determine latest release, using main branch"
        fi

        # Clone or update repository
        if [ -d "$INSTALL_DIR" ]; then
            IS_UPGRADE=true
            ensure_install_deployment_lock
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
            fetch_existing_installation
            if [ -n "$RELEASE_TAG" ]; then
                git checkout "$RELEASE_TAG" 2>/dev/null || {
                    echo -e "${YELLOW}Could not checkout $RELEASE_TAG. Continuing with current version.${NC}"
                }
            fi
        else
            echo "Cloning Sanctuary to $INSTALL_DIR..."
            clone_repository
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
    export JWT_SECRET ENCRYPTION_KEY ENCRYPTION_SALT GATEWAY_SECRET WORKER_DIAGNOSTICS_SECRET POSTGRES_PASSWORD GRAFANA_PASSWORD LLM_EGRESS_PROXY_SECRET REDIS_PASSWORD
    export LLM_EGRESS_PROXY_ALLOWED_HOSTS LLM_EGRESS_PROXY_ALLOWED_CIDRS LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS
    export HTTPS_PORT HTTP_PORT GATEWAY_PORT
    if [ "$OFFLINE_MODE" = true ]; then
        export SANCTUARY_INSTALL_MODE=offline
        export SANCTUARY_OFFLINE_VERSION="${OFFLINE_TARGET_VERSION:-${SANCTUARY_OFFLINE_VERSION:-$RELEASE_TAG}}"
        export SANCTUARY_COMMIT="${SANCTUARY_GIT_COMMIT:-${SANCTUARY_COMMIT:-}}"
    fi

    # Run setup.sh
    "$INSTALL_DIR/scripts/setup.sh" $SETUP_FLAGS
}

# Run main function
main "$@"
