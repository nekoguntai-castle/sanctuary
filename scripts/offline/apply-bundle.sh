#!/usr/bin/env bash
#
# Verify, stage, and apply a Sanctuary offline bundle.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/bundle-common.sh"

BUNDLE_PATH=""
STAGE_DIR=""
INSTALL_DIR="${SANCTUARY_DIR:-$HOME/sanctuary}"
PUBLIC_KEY=""
ALLOW_UNSIGNED_DEV=false
PREPARE_ONLY=false
APPLY_ONLY=false
VERIFY_ONLY=false

usage() {
  cat <<'EOF'
Usage:
  ./scripts/offline/apply-bundle.sh --bundle FILE --install-dir DIR
  ./scripts/offline/apply-bundle.sh --bundle FILE --stage-dir DIR --prepare-only
  ./scripts/offline/apply-bundle.sh --staged-dir DIR --verify-only
  ./scripts/offline/apply-bundle.sh --staged-dir DIR --install-dir DIR --apply

Options:
  --bundle FILE                  Offline bundle tar.gz
  --stage-dir DIR, --staged-dir DIR
                                 Directory used for verified extracted bundle contents
  --install-dir DIR              Sanctuary install directory
  --public-key FILE              Trusted public key for signature verification
  --allow-unsigned-dev-bundle    Accept unsigned development bundles
  --prepare-only                 Verify/extract only; no docker load or git checkout
  --verify-only                  Verify an already staged bundle; no docker load or git checkout
  --apply                        Apply an already staged bundle
  --help                         Show this help text
EOF
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --bundle)
        [ -n "${2:-}" ] || offline_fail "$1 requires a value"
        BUNDLE_PATH="$2"
        shift 2
        ;;
      --stage-dir|--staged-dir)
        [ -n "${2:-}" ] || offline_fail "$1 requires a value"
        STAGE_DIR="$2"
        shift 2
        ;;
      --install-dir)
        [ -n "${2:-}" ] || offline_fail "$1 requires a value"
        INSTALL_DIR="$2"
        shift 2
        ;;
      --public-key)
        [ -n "${2:-}" ] || offline_fail "$1 requires a value"
        PUBLIC_KEY="$2"
        shift 2
        ;;
      --allow-unsigned-dev-bundle)
        ALLOW_UNSIGNED_DEV=true
        shift
        ;;
      --prepare-only)
        PREPARE_ONLY=true
        shift
        ;;
      --verify-only)
        VERIFY_ONLY=true
        shift
        ;;
      --apply)
        APPLY_ONLY=true
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

prepare_bundle() {
  [ -n "$BUNDLE_PATH" ] || offline_fail "--bundle is required"
  [ -n "$STAGE_DIR" ] || offline_fail "--stage-dir is required"

  offline_require_tool tar
  offline_require_tool sha256sum

  offline_extract_bundle "$BUNDLE_PATH" "$STAGE_DIR"
  offline_verify_signature_and_checksums "$STAGE_DIR" "$PUBLIC_KEY" "$ALLOW_UNSIGNED_DEV"
  offline_load_manifest "$STAGE_DIR"
  offline_verify_platform "${SANCTUARY_PLATFORM:?SANCTUARY_PLATFORM missing from manifest}"

  offline_log "Offline bundle verified and staged at: $STAGE_DIR"
}

resolve_runtime_env_file() {
  local runtime_dir default_env legacy_env
  runtime_dir="${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}"
  default_env="$runtime_dir/sanctuary.env"
  legacy_env="$INSTALL_DIR/.env"

  if [ -f "$default_env" ]; then
    echo "$default_env"
  elif [ -f "$legacy_env" ]; then
    echo "$legacy_env"
  else
    echo "$default_env"
  fi
}

load_existing_runtime_env() {
  local env_file
  env_file="$(resolve_runtime_env_file)"
  if [ -f "$env_file" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

bundle_includes_profile() {
  local profile="$1"
  case ",${SANCTUARY_INCLUDED_PROFILES:-}," in
    *",$profile,"*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

images_present() {
  local image
  for image in "$@"; do
    docker image inspect "$image" >/dev/null 2>&1 || return 1
  done
}

validate_profile_coverage() {
  load_existing_runtime_env

  if [ "${ENABLE_MONITORING:-no}" = "yes" ] && ! bundle_includes_profile "monitoring"; then
    if ! images_present "${MONITORING_IMAGES[@]}"; then
      offline_fail "this install has monitoring enabled; use the official full offline bundle"
    fi
  fi

  if [ "${ENABLE_TOR:-no}" = "yes" ] && ! bundle_includes_profile "tor"; then
    if ! images_present "${TOR_IMAGES[@]}"; then
      offline_fail "this install has Tor enabled; use the official full offline bundle"
    fi
  fi
}

load_bundle_images() {
  local image_tar

  offline_require_tool docker

  while IFS= read -r image_tar; do
    [ -n "$image_tar" ] || continue
    offline_log "Loading image: ${image_tar#$STAGE_DIR/}"
    docker load -i "$image_tar" >/dev/null
  done < <(find "$STAGE_DIR/images" -type f -name '*.tar' | LC_ALL=C sort)
}

verify_required_images() {
  local image missing=false

  for image in "${CORE_IMAGES[@]}"; do
    if ! docker image inspect "$image" >/dev/null 2>&1; then
      echo "Missing required image: $image" >&2
      missing=true
    fi
  done

  if bundle_includes_profile "monitoring"; then
    for image in "${MONITORING_IMAGES[@]}"; do
      if ! docker image inspect "$image" >/dev/null 2>&1; then
        echo "Missing monitoring image: $image" >&2
        missing=true
      fi
    done
  fi

  if bundle_includes_profile "tor"; then
    for image in "${TOR_IMAGES[@]}"; do
      if ! docker image inspect "$image" >/dev/null 2>&1; then
        echo "Missing Tor image: $image" >&2
        missing=true
      fi
    done
  fi

  [ "$missing" = "false" ] || offline_fail "offline bundle image validation failed"
}

checkout_bundle_source() {
  local git_bundle="$STAGE_DIR/repo/sanctuary.git.bundle"
  local target_tag="${SANCTUARY_GIT_TAG:-}"

  [ -s "$git_bundle" ] || offline_fail "git bundle not found: $git_bundle"
  [ -n "$target_tag" ] || offline_fail "SANCTUARY_GIT_TAG is required for source checkout"
  offline_require_tool git

  if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
    offline_fail "install directory exists but is not a git checkout: $INSTALL_DIR"
  fi

  if [ ! -d "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR"
  fi

  if [ ! -d "$INSTALL_DIR/.git" ]; then
    git -C "$INSTALL_DIR" init >/dev/null
  fi

  git -C "$INSTALL_DIR" fetch "$git_bundle" "+refs/tags/$target_tag:refs/tags/$target_tag" >/dev/null
  git -C "$INSTALL_DIR" checkout --detach "$target_tag" >/dev/null
  offline_log "Repository checked out at offline bundle tag: $target_tag"
}

verify_staged_bundle() {
  [ -n "$STAGE_DIR" ] || offline_fail "--staged-dir is required"
  [ -d "$STAGE_DIR" ] || offline_fail "staged bundle directory not found: $STAGE_DIR"

  offline_require_tool sha256sum
  offline_verify_signature_and_checksums "$STAGE_DIR" "$PUBLIC_KEY" "$ALLOW_UNSIGNED_DEV"
  offline_load_manifest "$STAGE_DIR"
  offline_verify_platform "${SANCTUARY_PLATFORM:?SANCTUARY_PLATFORM missing from manifest}"
}

apply_prepared_bundle() {
  verify_staged_bundle
  validate_profile_coverage
  load_bundle_images
  verify_required_images
  checkout_bundle_source
}

main() {
  parse_args "$@"

  local selected_modes=0
  [ "$PREPARE_ONLY" = "true" ] && selected_modes=$((selected_modes + 1))
  [ "$VERIFY_ONLY" = "true" ] && selected_modes=$((selected_modes + 1))
  [ "$APPLY_ONLY" = "true" ] && selected_modes=$((selected_modes + 1))
  if [ "$selected_modes" -gt 1 ]; then
    offline_fail "choose only one of --prepare-only, --verify-only, or --apply"
  fi

  if [ "$PREPARE_ONLY" = "true" ]; then
    prepare_bundle
    exit 0
  fi

  if [ "$APPLY_ONLY" = "true" ]; then
    apply_prepared_bundle
    exit 0
  fi

  if [ "$VERIFY_ONLY" = "true" ]; then
    verify_staged_bundle
    offline_log "Offline bundle staged contents verified at: $STAGE_DIR"
    exit 0
  fi

  [ -n "$BUNDLE_PATH" ] || offline_fail "--bundle is required"
  if [ -z "$STAGE_DIR" ]; then
    STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-offline-bundle.XXXXXX")"
    trap 'rm -rf "$STAGE_DIR"' EXIT
  fi

  prepare_bundle
  apply_prepared_bundle
}

main "$@"
