#!/usr/bin/env bash
#
# Create a Sanctuary offline install/upgrade bundle on a connected machine.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/bundle-common.sh"
REGISTERED_STAGING="$SCRIPT_DIR/../ci/create-registered-staging.sh"
CLEANUP_COORDINATOR="$SCRIPT_DIR/../ci/cleanup-ci-callsite.sh"

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
  : # Registered temporary artifacts are removed only by the cleanup coordinator.
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
  local commit="$1"
  if [ "$SKIP_BUILD" = "true" ]; then
    offline_log "Skipping Sanctuary image build."
    return
  fi

  initialize_bundle_build_identity "$commit"

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

initialize_bundle_build_identity() {
  local commit="$1"
  # shellcheck source=scripts/ownership/producer-hooks.sh
  source "$OFFLINE_REPO_ROOT/scripts/ownership/producer-hooks.sh"
  SANCTUARY_PROJECT="offline-bundle-${TAG#v}"
  SANCTUARY_PROJECT_DIR="$OFFLINE_REPO_ROOT"
  SANCTUARY_RELEASE="$TAG"
  SANCTUARY_COMMIT="$commit"
  SANCTUARY_OPERATION_RUN_ID="offline-${commit:0:12}"
  SANCTUARY_SOURCE_COMMIT="$commit"
  SANCTUARY_IMAGE_LOCK_SHA256="$(ownership_sha256 < "$OFFLINE_REPO_ROOT/config/container-image-lock.json")"
  SANCTUARY_VERSION="$(awk -F'"' '/"version":/{print $4; exit}' "$OFFLINE_REPO_ROOT/package.json")"
  SANCTUARY_BUILD_ID="$SANCTUARY_OPERATION_RUN_ID"
  export SANCTUARY_PROJECT SANCTUARY_PROJECT_DIR SANCTUARY_RELEASE
  export SANCTUARY_COMMIT SANCTUARY_OPERATION_RUN_ID
  export SANCTUARY_SOURCE_COMMIT SANCTUARY_IMAGE_LOCK_SHA256 SANCTUARY_VERSION SANCTUARY_BUILD_ID
  ownership_initialize_build_identity
}

external_images() {
  local image
  printf '%s\n' \
    "postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777" \
    "redis:7-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2" \
    "tecnativa/docker-socket-proxy:latest@sha256:1f5038b54f06c3e18422902cf00ba21803d1c97805aae032e5e6673d532d3459"

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

verify_archive_alias() {
  local image="$1" archive_ref="$2" source archive expected_digest=''
  source="$(docker image inspect "$image")" || return 1
  archive="$(docker image inspect "$archive_ref")" || return 1
  if [[ "$image" == *@sha256:* ]]; then expected_digest="$(offline_repo_digest_ref "$image")"; fi
  printf '%s' "$archive" | jq -e \
    --arg ref "$archive_ref" --arg digest "$expected_digest" --argjson source "$source" '
      length == 1 and ($source | length == 1)
      and (.[0].Id | test("^sha256:[0-9a-f]{64}$"))
      and .[0].Id == $source[0].Id and .[0].Os == $source[0].Os
      and .[0].Architecture == $source[0].Architecture
      and ((.[0].RepoTags // []) | index($ref) != null)
      and ($digest == "" or (($source[0].RepoDigests // []) | index($digest) != null))
    ' >/dev/null
}

save_images() {
  local stage_dir="$1"
  local image archive_ref image_id archive_id file_name bucket image_tar tag_status alias_status

  mkdir -p "$stage_dir/images/core" "$stage_dir/images/monitoring" "$stage_dir/images/tor"

  while IFS= read -r image; do
    [ -n "$image" ] || continue
    docker image inspect "$image" >/dev/null 2>&1 || offline_fail "image not available locally: $image"
    archive_ref="$(offline_archive_image_ref "$image")"

    if [ "$archive_ref" != "$image" ]; then
      tag_status=0
      docker image tag "$image" "$archive_ref" || tag_status=$?
      alias_status=0
      verify_archive_alias "$image" "$archive_ref" || alias_status=$?
      [ "$tag_status" -eq 0 ] || return "$tag_status"
      [ "$alias_status" -eq 0 ] \
        || offline_fail "could not prove bundled image alias $image as $archive_ref"
    fi
    image_id="$(docker image inspect --format '{{.Id}}' "$image")" \
      || offline_fail "could not resolve bundled image ID: $image"
    archive_id="$(docker image inspect --format '{{.Id}}' "$archive_ref")" \
      || offline_fail "could not resolve archive image ID: $archive_ref"
    [ "$archive_id" = "$image_id" ] \
      || offline_fail "archive image ref does not match immutable source: $image"

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
    image_tar="$stage_dir/images/$bucket/$file_name"
    offline_log "Saving $image as $archive_ref..."
    docker save -o "$image_tar" "$archive_ref"
    tar -xOf "$image_tar" manifest.json \
      | jq -e --arg archive_ref "$archive_ref" \
        '[.[].RepoTags[]?] == [$archive_ref]' >/dev/null \
      || offline_fail "saved image archive does not restore exactly $archive_ref: $image"
  done < <(bundle_images)
}

write_image_inventory() {
  local stage_dir="$1"
  local expected_arch image archive_ref inspection archive_inspection actual_platform expected_repo_digest repo_digest source_identity archive_identity
  local inventory_lines="$CREATE_TMP_ROOT/image-inventory.jsonl"
  local inventory_tsv="$stage_dir/image-inventory.tsv"

  case "$PLATFORM" in
    linux/amd64) expected_arch="amd64" ;;
    linux/arm64) expected_arch="arm64" ;;
    *) offline_fail "unsupported image inventory platform: $PLATFORM" ;;
  esac

  : > "$inventory_lines"
  printf 'SANCTUARY_IMAGE_INVENTORY_SCHEMA=1\nSANCTUARY_IMAGE_INVENTORY_PLATFORM=%s\n' \
    "$PLATFORM" > "$inventory_tsv"
  while IFS= read -r image; do
    [ -n "$image" ] || continue
    inspection="$(docker image inspect "$image")" \
      || offline_fail "could not inspect bundled image: $image"
    archive_ref="$(offline_archive_image_ref "$image")"
    archive_inspection="$(docker image inspect "$archive_ref")" \
      || offline_fail "could not inspect named archive image: $archive_ref"
    actual_platform="$(printf '%s' "$inspection" | jq -r '.[0] | "\(.Os)/\(.Architecture)"')"
    [ "$actual_platform" = "linux/$expected_arch" ] \
      || offline_fail "bundled image $image has platform $actual_platform, expected $PLATFORM"

    source_identity="$(printf '%s' "$inspection" | jq -r '.[0] | [.Id, .Os, .Architecture] | @tsv')"
    archive_identity="$(printf '%s' "$archive_inspection" | jq -r '.[0] | [.Id, .Os, .Architecture] | @tsv')"
    [ "$source_identity" = "$archive_identity" ] \
      || offline_fail "named archive image does not match immutable source: $image"

    repo_digest="-"
    if [[ "$image" == *@sha256:* ]]; then
      expected_repo_digest="$(offline_repo_digest_ref "$image")"
      if ! printf '%s' "$inspection" | jq -e --arg digest "$expected_repo_digest" \
        '.[0].RepoDigests | type == "array" and index($digest) != null' >/dev/null; then
        offline_fail "external bundled image is not bound to its immutable digest: $image"
      fi
      repo_digest="$expected_repo_digest"
    fi

    printf '%s' "$inspection" | jq -c --arg image "$image" --arg archive_ref "$archive_ref" \
      '.[0] | {image: $image, archiveRef: $archive_ref, id: .Id, os: .Os, architecture: .Architecture, repoDigests: (.RepoDigests // [])}' \
      >> "$inventory_lines"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$image" "$archive_ref" \
      "$(printf '%s' "$inspection" | jq -r '.[0].Id')" \
      "$(printf '%s' "$inspection" | jq -r '.[0].Os')" \
      "$(printf '%s' "$inspection" | jq -r '.[0].Architecture')" "$repo_digest" \
      >> "$inventory_tsv"
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

  mkdir -p "$stage_dir/tools" "$stage_dir/keys" \
    "$stage_dir/authority/scripts/ci" "$stage_dir/authority/scripts/ownership"
  cp "$SCRIPT_DIR/bundle-common.sh" "$stage_dir/tools/bundle-common.sh"
  cp "$SCRIPT_DIR/apply-bundle.sh" "$stage_dir/tools/apply-bundle.sh"
  cp "$OFFLINE_REPO_ROOT/scripts/create-upgrade-backup.sh" "$stage_dir/tools/create-upgrade-backup.sh"
  cp "$OFFLINE_REPO_ROOT/scripts/ci/cleanup-ci-callsite.sh" \
    "$OFFLINE_REPO_ROOT/scripts/ci/create-registered-staging.sh" \
    "$OFFLINE_REPO_ROOT/scripts/ci/provider-context.sh" \
    "$OFFLINE_REPO_ROOT/scripts/ci/provider-context.mjs" \
    "$stage_dir/authority/scripts/ci/"
  cp -R "$OFFLINE_REPO_ROOT/scripts/ownership/." "$stage_dir/authority/scripts/ownership/"
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

After verifying the adjacent detached archive signature with a separately
trusted public key, extract the bundle and use its version-matched installer:

\`\`\`bash
mkdir sanctuary-offline-$TAG
tar -xzf /path/to/$(basename "$OUTPUT") -C sanctuary-offline-$TAG
cd sanctuary-offline-$TAG
./install-offline.sh --public-key /secure/path/sanctuary-offline-release-public.pem
\`\`\`

Always use the installer carried by the target bundle, including for upgrades;
an older installed checkout may not understand a newer bundle format. The copy
under \`keys/\` is for operator inspection only.
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
  [ ! -e "$OUTPUT" ] || offline_fail "bundle output already exists: $OUTPUT"
  (set -o noclobber; tar -cz -C "$stage_dir" . > "$OUTPUT")
}

sign_archive() {
  if [ "$UNSIGNED_FOR_DEV" = "true" ]; then
    return
  fi
  [ ! -e "${OUTPUT}.sig" ] || offline_fail "bundle signature already exists: ${OUTPUT}.sig"
  (set -o noclobber; openssl dgst -sha256 -sign "$SIGNING_KEY" "$OUTPUT" > "${OUTPUT}.sig")
}

main() {
  if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then
    exec "$CLEANUP_COORDINATOR" auto-run --lane offline-create --engine docker \
      --checkout-root "$OFFLINE_REPO_ROOT" -- bash "$0" "$@"
  fi
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

  CREATE_TMP_ROOT="$($REGISTERED_STAGING offline-create)"
  stage_dir="$CREATE_TMP_ROOT/stage"
  mkdir -p "$stage_dir"
  trap cleanup_create_tmp EXIT

  build_sanctuary_images "$commit"
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
