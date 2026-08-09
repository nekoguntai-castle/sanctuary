#!/usr/bin/env bash
#
# Create a Sanctuary offline install/upgrade bundle on a connected machine.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/bundle-common.sh"

TAG=""
PLATFORM="$(offline_detect_platform)"
OUTPUT=""
SIGNING_KEY="${SANCTUARY_OFFLINE_SIGNING_KEY:-}"
PUBLIC_KEY="${SANCTUARY_OFFLINE_PUBLIC_KEY:-$OFFLINE_DEFAULT_PUBLIC_KEY}"
UNSIGNED_FOR_DEV=false
CORE_ONLY=false
SKIP_BUILD=false
CREATE_TMP_ROOT=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/offline/create-bundle.sh --tag vX.Y.Z --output FILE [options]

Options:
  --tag TAG               Release tag to package
  --platform PLATFORM     Docker platform (default: detected host platform)
  --output FILE           Output .tar.gz bundle path
  --signing-key FILE      RSA private key for release bundle signing
  --public-key FILE       Public key to include for operator inspection
  --unsigned-for-dev      Create an unsigned development bundle
  --core-only             Dev/test bundle without monitoring and Tor images
  --skip-build            Use existing local Sanctuary images
  --help                  Show this help text

Release bundles are full bundles by default and require a signing key.
EOF
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --tag)
        [ -n "${2:-}" ] || offline_fail "$1 requires a value"
        TAG="$2"
        shift 2
        ;;
      --platform)
        [ -n "${2:-}" ] || offline_fail "$1 requires a value"
        PLATFORM="$2"
        shift 2
        ;;
      --output)
        [ -n "${2:-}" ] || offline_fail "$1 requires a value"
        OUTPUT="$2"
        shift 2
        ;;
      --signing-key)
        [ -n "${2:-}" ] || offline_fail "$1 requires a value"
        SIGNING_KEY="$2"
        shift 2
        ;;
      --public-key)
        [ -n "${2:-}" ] || offline_fail "$1 requires a value"
        PUBLIC_KEY="$2"
        shift 2
        ;;
      --unsigned-for-dev)
        UNSIGNED_FOR_DEV=true
        shift
        ;;
      --core-only)
        CORE_ONLY=true
        shift
        ;;
      --skip-build)
        SKIP_BUILD=true
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        offline_fail "Unknown option: $1"
        ;;
    esac
  done
}

validate_args() {
  [ -n "$TAG" ] || offline_fail "--tag is required"
  [ -n "$OUTPUT" ] || offline_fail "--output is required"

  case "$PLATFORM" in
    linux/amd64|linux/arm64)
      ;;
    *)
      offline_fail "unsupported platform: $PLATFORM"
      ;;
  esac

  if [ "$UNSIGNED_FOR_DEV" != "true" ]; then
    [ -s "$SIGNING_KEY" ] || offline_fail "release bundles require --signing-key or SANCTUARY_OFFLINE_SIGNING_KEY"
    [ -s "$PUBLIC_KEY" ] || offline_fail "release bundles require --public-key or SANCTUARY_OFFLINE_PUBLIC_KEY"
  fi

  if [ "$CORE_ONLY" = "true" ] && [ "$UNSIGNED_FOR_DEV" != "true" ]; then
    offline_fail "--core-only is allowed only with --unsigned-for-dev"
  fi
}

package_version() {
  sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$OFFLINE_REPO_ROOT/package.json" | head -n 1
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

target_commit() {
  git -C "$OFFLINE_REPO_ROOT" rev-parse --verify "$TAG^{commit}"
}

cleanup_create_tmp() {
  if [ -n "${CREATE_TMP_ROOT:-}" ] && [ -d "$CREATE_TMP_ROOT" ]; then
    find "$CREATE_TMP_ROOT" -type f -delete
    find "$CREATE_TMP_ROOT" -type l -delete
    find "$CREATE_TMP_ROOT" -depth -type d -empty -delete
  fi
}

validate_release_checkout() {
  local commit="$1"
  local head_commit
  head_commit="$(git -C "$OFFLINE_REPO_ROOT" rev-parse --verify HEAD)"

  if [ "$UNSIGNED_FOR_DEV" = "true" ]; then
    return 0
  fi

  [ "$head_commit" = "$commit" ] \
    || offline_fail "release bundle creation must run from the target tag checkout ($TAG)"

  if [ -n "$(git -C "$OFFLINE_REPO_ROOT" status --porcelain --untracked-files=all)" ]; then
    offline_fail "release bundle creation requires a clean worktree"
  fi
}

build_sanctuary_images() {
  if [ "$SKIP_BUILD" = "true" ]; then
    offline_log "Skipping Sanctuary image build."
    return
  fi

  offline_log "Building Sanctuary images for $PLATFORM..."
  # Compose interpolates required runtime secrets before it selects the build
  # targets. Offline assembly must neither require production secrets nor copy
  # values from the operator environment into build metadata, so override every
  # required runtime-only value with an explicit non-production placeholder.
  DOCKER_DEFAULT_PLATFORM="$PLATFORM" \
    POSTGRES_PASSWORD="offline-build-postgres-password" \
    REDIS_PASSWORD="offline-build-redis-password" \
    JWT_SECRET="offline-build-jwt-secret-not-for-runtime" \
    ENCRYPTION_KEY="offline-build-encryption-key-not-for-runtime" \
    ENCRYPTION_SALT="offline-build-encryption-salt" \
    WORKER_DIAGNOSTICS_SECRET="0000000000000000000000000000000000000000000000000000000000000000" \
    LLM_EGRESS_PROXY_SECRET="0000000000000000000000000000000000000000000000000000000000000000" \
    docker compose -f "$OFFLINE_REPO_ROOT/docker-compose.yml" build \
      backend frontend gateway llm-egress-proxy

  if [ "$CORE_ONLY" != "true" ]; then
    DOCKER_DEFAULT_PLATFORM="$PLATFORM" \
      POSTGRES_PASSWORD="offline-build-postgres-password" \
      REDIS_PASSWORD="offline-build-redis-password" \
      JWT_SECRET="offline-build-jwt-secret-not-for-runtime" \
      ENCRYPTION_KEY="offline-build-encryption-key-not-for-runtime" \
      ENCRYPTION_SALT="offline-build-encryption-salt" \
      GRAFANA_PASSWORD="offline-build-grafana-password" \
      WORKER_DIAGNOSTICS_SECRET="0000000000000000000000000000000000000000000000000000000000000000" \
      LLM_EGRESS_PROXY_SECRET="0000000000000000000000000000000000000000000000000000000000000000" \
      docker compose -f "$OFFLINE_REPO_ROOT/docker-compose.yml" \
        -f "$OFFLINE_REPO_ROOT/docker/compose/monitoring.yml" build \
        grafana-password-migration
  fi
}

external_images() {
  local image
  printf '%s\n' \
    "postgres:16-alpine" \
    "redis:7-alpine" \
    "tecnativa/docker-socket-proxy:latest"

  if [ "$CORE_ONLY" != "true" ]; then
    for image in "${MONITORING_IMAGES[@]}" "${TOR_IMAGES[@]}"; do
      case "$image" in
        sanctuary-*) continue ;;
      esac
      printf '%s\n' "$image"
    done
  fi
}

bundle_images() {
  if [ "$CORE_ONLY" = "true" ]; then
    offline_core_images
  else
    offline_all_release_images
  fi
}

pull_external_images() {
  local image

  while IFS= read -r image; do
    [ -n "$image" ] || continue
    offline_log "Pulling $image for $PLATFORM..."
    docker pull --platform "$PLATFORM" "$image" >/dev/null
  done < <(external_images)
}

save_images() {
  local stage_dir="$1"
  local image file_name bucket

  mkdir -p "$stage_dir/images/core" "$stage_dir/images/monitoring" "$stage_dir/images/tor"

  while IFS= read -r image; do
    [ -n "$image" ] || continue
    docker image inspect "$image" >/dev/null 2>&1 || offline_fail "image not available locally: $image"

    bucket="core"
    case "$image" in
      sanctuary-grafana-migration:*)
        bucket="monitoring"
        ;;
      jaegertracing/*|grafana/*|prom/*)
        bucket="monitoring"
        ;;
      dperson/torproxy:*)
        bucket="tor"
        ;;
    esac

    file_name="$(offline_image_file_name "$image").tar"
    offline_log "Saving $image..."
    docker save -o "$stage_dir/images/$bucket/$file_name" "$image"
  done < <(bundle_images)
}

write_image_inventory() {
  local stage_dir="$1"
  local expected_arch image inspection actual_platform
  local inventory_lines="$CREATE_TMP_ROOT/image-inventory.jsonl"

  case "$PLATFORM" in
    linux/amd64) expected_arch="amd64" ;;
    linux/arm64) expected_arch="arm64" ;;
    *) offline_fail "unsupported image inventory platform: $PLATFORM" ;;
  esac

  : > "$inventory_lines"
  while IFS= read -r image; do
    [ -n "$image" ] || continue
    inspection="$(docker image inspect "$image")" \
      || offline_fail "could not inspect bundled image: $image"
    actual_platform="$(printf '%s' "$inspection" | jq -r '.[0] | "\(.Os)/\(.Architecture)"')"
    [ "$actual_platform" = "linux/$expected_arch" ] \
      || offline_fail "bundled image $image has platform $actual_platform, expected $PLATFORM"

    if [[ "$image" != sanctuary-* ]] \
      && ! printf '%s' "$inspection" | jq -e '.[0].RepoDigests | type == "array" and length > 0' >/dev/null; then
      offline_fail "external bundled image lacks immutable RepoDigests: $image"
    fi

    printf '%s' "$inspection" | jq -c --arg image "$image" \
      '.[0] | {image: $image, id: .Id, os: .Os, architecture: .Architecture, repoDigests: (.RepoDigests // [])}' \
      >> "$inventory_lines"
  done < <(bundle_images)

  jq -s --arg platform "$PLATFORM" \
    '{schema: 1, platform: $platform, images: .}' "$inventory_lines" \
    > "$stage_dir/image-inventory.json"
}

write_manifests() {
  local stage_dir="$1"
  local commit="$2"
  local version="$3"
  local created_at profiles flavor

  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  flavor="full"
  profiles="core,monitoring,tor"
  if [ "$CORE_ONLY" = "true" ]; then
    flavor="core-dev"
    profiles="core"
  fi

  cat > "$stage_dir/manifest.env" <<EOF
SANCTUARY_OFFLINE_BUNDLE_SCHEMA=1
SANCTUARY_VERSION=$version
SANCTUARY_GIT_TAG=$TAG
SANCTUARY_GIT_COMMIT=$commit
SANCTUARY_PLATFORM=$PLATFORM
SANCTUARY_BUNDLE_FLAVOR=$flavor
SANCTUARY_INCLUDED_PROFILES=$profiles
SANCTUARY_BUNDLE_CREATED_AT=$created_at
EOF

  cat > "$stage_dir/manifest.json" <<EOF
{
  "schema": 1,
  "version": "$(json_escape "$version")",
  "gitTag": "$(json_escape "$TAG")",
  "gitCommit": "$(json_escape "$commit")",
  "platform": "$(json_escape "$PLATFORM")",
  "flavor": "$(json_escape "$flavor")",
  "includedProfiles": "$(json_escape "$profiles")",
  "createdAt": "$(json_escape "$created_at")"
}
EOF
}

write_git_bundle() {
  local stage_dir="$1"

  mkdir -p "$stage_dir/repo"
  git -C "$OFFLINE_REPO_ROOT" bundle create "$stage_dir/repo/sanctuary.git.bundle" "refs/tags/$TAG" >/dev/null
}

copy_bootstrap_tools() {
  local stage_dir="$1"

  mkdir -p "$stage_dir/tools" "$stage_dir/keys"
  cp "$SCRIPT_DIR/bundle-common.sh" "$stage_dir/tools/bundle-common.sh"
  cp "$SCRIPT_DIR/apply-bundle.sh" "$stage_dir/tools/apply-bundle.sh"
  cp "$OFFLINE_REPO_ROOT/scripts/create-upgrade-backup.sh" "$stage_dir/tools/create-upgrade-backup.sh"
  chmod +x "$stage_dir/tools/apply-bundle.sh"
  chmod +x "$stage_dir/tools/create-upgrade-backup.sh"

  if [ -s "$PUBLIC_KEY" ]; then
    cp "$PUBLIC_KEY" "$stage_dir/keys/sanctuary-offline-release-public.pem"
  fi

  cat > "$stage_dir/install-offline.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${SANCTUARY_DIR:-$HOME/sanctuary}"
PUBLIC_KEY="${SANCTUARY_OFFLINE_PUBLIC_KEY:-}"

usage() {
  cat <<'USAGE'
Usage:
  ./install-offline.sh [--install-dir DIR] [--public-key FILE] [options]

Verify this extracted bundle with a trusted Sanctuary offline-release public key
before running this script.

Options:
  --allow-unsigned-dev-bundle    Accept an unsigned development bundle
  --yes, -y                      Non-interactive acknowledgement
  --skip-upgrade-backup          Skip the local pre-upgrade backup explicitly
USAGE
}

ALLOW_UNSIGNED=""
ASSUME_YES="${SANCTUARY_ASSUME_YES:-false}"
SKIP_UPGRADE_BACKUP="${SANCTUARY_SKIP_UPGRADE_BACKUP:-false}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --public-key)
      PUBLIC_KEY="$2"
      shift 2
      ;;
    --allow-unsigned-dev-bundle)
      ALLOW_UNSIGNED="--allow-unsigned-dev-bundle"
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
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [ -s "$BUNDLE_DIR/manifest.env" ]; then
  # shellcheck disable=SC1091
  source "$BUNDLE_DIR/manifest.env"
fi

resolve_compose_project_name() {
  local compose_file project_name

  if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
    printf '%s\n' "$COMPOSE_PROJECT_NAME"
    return
  fi

  compose_file="$INSTALL_DIR/docker-compose.yml"
  if [ -f "$compose_file" ]; then
    project_name="$(awk '
      /^name:[[:space:]]*/ {
        sub(/^name:[[:space:]]*/, "")
        sub(/[[:space:]]+#.*$/, "")
        gsub(/^[[:space:]\"]+|[[:space:]\"]+$/, "")
        print
        exit
      }
    ' "$compose_file")"
    if [ -n "$project_name" ]; then
      printf '%s\n' "$project_name"
      return
    fi
  fi

  basename "$INSTALL_DIR"
}

has_existing_database() {
  local project_name
  command -v docker >/dev/null 2>&1 || return 1
  project_name="$(resolve_compose_project_name)"
  docker volume ls -q \
    --filter "label=com.docker.compose.project=$project_name" \
    --filter "label=com.docker.compose.volume=postgres_data" \
    2>/dev/null | grep -q .
}

create_upgrade_backup_or_prompt() {
  if ! has_existing_database; then
    return 0
  fi

  echo "Existing database detected."
  if [ "$SKIP_UPGRADE_BACKUP" = "true" ]; then
    echo "Warning: skipping pre-upgrade backup by explicit request."
    return 0
  fi

  if [ "$ASSUME_YES" != "true" ] && [ ! -t 0 ]; then
    echo "Non-interactive upgrade requires --yes or SANCTUARY_ASSUME_YES=true." >&2
    echo "To skip the local backup explicitly, also set SANCTUARY_SKIP_UPGRADE_BACKUP=true." >&2
    exit 1
  fi

  local make_backup=true
  if [ -t 0 ]; then
    echo "Create a local pre-upgrade backup before continuing? [Y/n] "
    read -r REPLY
    if [[ $REPLY =~ ^[Nn]$ ]]; then
      make_backup=false
      read -p "Continue without a backup? [y/N] " -n 1 -r
      echo ""
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Upgrade cancelled. Run again after backing up."
        exit 0
      fi
    fi
  fi

  if [ "$make_backup" = "true" ]; then
    "$BUNDLE_DIR/tools/create-upgrade-backup.sh" \
      --install-dir "$INSTALL_DIR" \
      --target-version "${SANCTUARY_GIT_TAG:-offline-bundle}"
  fi
}

if [ -z "$PUBLIC_KEY" ] && [ -z "$ALLOW_UNSIGNED" ]; then
  echo "A trusted public key is required. The key inside the bundle is for inspection only." >&2
  echo "Pass --public-key /path/to/sanctuary-offline-release-public.pem." >&2
  exit 1
fi

PUBLIC_KEY_ARGS=()
[ -n "$PUBLIC_KEY" ] && PUBLIC_KEY_ARGS=(--public-key "$PUBLIC_KEY")
"$BUNDLE_DIR/tools/apply-bundle.sh" --staged-dir "$BUNDLE_DIR" "${PUBLIC_KEY_ARGS[@]}" --verify-only $ALLOW_UNSIGNED
create_upgrade_backup_or_prompt
"$BUNDLE_DIR/tools/apply-bundle.sh" --staged-dir "$BUNDLE_DIR" --install-dir "$INSTALL_DIR" "${PUBLIC_KEY_ARGS[@]}" --apply $ALLOW_UNSIGNED

SANCTUARY_INSTALL_MODE=offline \
SANCTUARY_OFFLINE_VERSION="${SANCTUARY_VERSION:-${SANCTUARY_GIT_TAG:-}}" \
SANCTUARY_OFFLINE_MODE=yes \
SANCTUARY_ASSUME_YES="$ASSUME_YES" \
SANCTUARY_SKIP_UPGRADE_BACKUP="$SKIP_UPGRADE_BACKUP" \
SKIP_GIT_CHECKOUT=true \
  "$INSTALL_DIR/install.sh" --offline-prepared
EOF
  chmod +x "$stage_dir/install-offline.sh"

  cat > "$stage_dir/README-offline.md" <<EOF
# Sanctuary Offline Bundle

Tag: \`$TAG\`
Platform: \`$PLATFORM\`

Preferred upgrade path from an installed checkout:

\`\`\`bash
./install.sh --offline-bundle /path/to/$(basename "$OUTPUT")
\`\`\`

For a freshly extracted bundle, first verify the adjacent detached archive
signature with a separately trusted public key. Only then run:

\`\`\`bash
./install-offline.sh --public-key /secure/path/sanctuary-offline-release-public.pem
\`\`\`

The copy under \`keys/\` is for operator inspection only.
EOF
}

sign_checksums() {
  local stage_dir="$1"

  offline_checksum_stage "$stage_dir"

  if [ "$UNSIGNED_FOR_DEV" = "true" ]; then
    offline_log "Creating unsigned development bundle."
    return
  fi

  offline_require_tool openssl
  openssl dgst -sha256 -sign "$SIGNING_KEY" -out "$stage_dir/checksums.sha256.sig" "$stage_dir/checksums.sha256"
}

create_archive() {
  local stage_dir="$1"
  local output_dir
  output_dir="$(dirname "$OUTPUT")"
  mkdir -p "$output_dir"
  tar -czf "$OUTPUT" -C "$stage_dir" .
}

sign_archive() {
  if [ "$UNSIGNED_FOR_DEV" = "true" ]; then
    return
  fi
  openssl dgst -sha256 -sign "$SIGNING_KEY" -out "${OUTPUT}.sig" "$OUTPUT"
}

main() {
  parse_args "$@"
  validate_args

  offline_require_tool git
  offline_require_tool docker
  offline_require_tool tar
  offline_require_tool sha256sum
  offline_require_tool jq

  local commit version stage_dir
  commit="$(target_commit)"
  version="$(package_version)"
  [ -n "$version" ] || offline_fail "could not read package version"

  validate_release_checkout "$commit"

  CREATE_TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-offline-create.XXXXXX")"
  stage_dir="$CREATE_TMP_ROOT/stage"
  mkdir -p "$stage_dir"
  trap cleanup_create_tmp EXIT

  build_sanctuary_images
  pull_external_images
  save_images "$stage_dir"
  write_image_inventory "$stage_dir"
  write_manifests "$stage_dir" "$commit" "$version"
  write_git_bundle "$stage_dir"
  copy_bootstrap_tools "$stage_dir"
  sign_checksums "$stage_dir"
  create_archive "$stage_dir"
  sign_archive

  offline_log "Offline bundle written to: $OUTPUT"
  if [ "$UNSIGNED_FOR_DEV" != "true" ]; then
    offline_log "Detached archive signature written to: ${OUTPUT}.sig"
  fi
}

main "$@"
