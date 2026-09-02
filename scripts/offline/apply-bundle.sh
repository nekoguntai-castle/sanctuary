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
APPLY_LOCK_ACTIVE=false
GENERATED_STAGE=false
CURRENT_LOADING_IMAGE_TAR=""

cleanup_apply() {
  local status=$? recovery_status=0 lock_status=0
  trap - EXIT
  if [ -n "$CURRENT_LOADING_IMAGE_TAR" ] && [ "$APPLY_LOCK_ACTIVE" = true ]; then
    recover_and_register_loaded_archive "$CURRENT_LOADING_IMAGE_TAR" || recovery_status=$?
    CURRENT_LOADING_IMAGE_TAR=""
  fi
  if [ "$APPLY_LOCK_ACTIVE" = true ]; then
    deployment_lock_release || lock_status=$?
  fi
  if [ "$GENERATED_STAGE" = true ] && [ -d "$STAGE_DIR" ]; then
    find "$STAGE_DIR" -type f -delete
    find "$STAGE_DIR" -type l -delete
    find "$STAGE_DIR" -depth -type d -empty -delete
  fi
  if [ "$status" -eq 0 ]; then
    if [ "$recovery_status" -ne 0 ]; then status="$recovery_status"
    elif [ "$lock_status" -ne 0 ]; then status="$lock_status"
    fi
  fi
  exit "$status"
}
trap cleanup_apply EXIT

ensure_apply_lock() {
  [ "$APPLY_LOCK_ACTIVE" = true ] && return 0
  # shellcheck source=scripts/ownership/producer-hooks.sh
  . "$SCRIPT_DIR/../ownership/producer-hooks.sh"
  # shellcheck source=scripts/ownership/deployment-lifecycle.sh
  . "$SCRIPT_DIR/../ownership/deployment-lifecycle.sh"
  SANCTUARY_PROJECT_DIR="$INSTALL_DIR"
  SANCTUARY_RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}"
  SANCTUARY_ENV_FILE="$(resolve_runtime_env_file)"
  SANCTUARY_PROJECT="${SANCTUARY_PROJECT:-${COMPOSE_PROJECT_NAME:-sanctuary}}"
  SANCTUARY_COMMIT="${SANCTUARY_GIT_COMMIT:-${SANCTUARY_COMMIT:-}}"
  SANCTUARY_RELEASE="${SANCTUARY_OFFLINE_VERSION:-${SANCTUARY_GIT_TAG:-${SANCTUARY_RELEASE:-unreleased}}}"
  export SANCTUARY_PROJECT_DIR SANCTUARY_RUNTIME_DIR SANCTUARY_ENV_FILE SANCTUARY_PROJECT
  export SANCTUARY_COMMIT SANCTUARY_RELEASE
  ownership_initialize
  deployment_lock_only_acquire
  APPLY_LOCK_ACTIVE=true
}

release_apply_lock() {
  [ "$APPLY_LOCK_ACTIVE" = true ] || return 0
  APPLY_LOCK_ACTIVE=false
  deployment_lock_release
}

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
  validate_image_inventory

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

bundle_expected_images() {
  printf '%s\n' "${CORE_IMAGES[@]}"
  if bundle_includes_profile monitoring; then
    printf '%s\n' "${MONITORING_IMAGES[@]}"
  fi
  if bundle_includes_profile tor; then
    printf '%s\n' "${TOR_IMAGES[@]}"
  fi
  return 0
}

validate_image_inventory() {
  local inventory="$STAGE_DIR/image-inventory.tsv"
  local expected actual image archive_ref expected_digest image_tar image_tar_count expected_count
  local row row_count row_image row_archive_ref row_id row_os row_arch row_digest row_extra archive_manifest

  [ -s "$inventory" ] || offline_fail "bundle is missing image-inventory.tsv"
  [ "$(sed -n '1p' "$inventory")" = "SANCTUARY_IMAGE_INVENTORY_SCHEMA=1" ] \
    && [ "$(sed -n '2p' "$inventory")" = "SANCTUARY_IMAGE_INVENTORY_PLATFORM=$SANCTUARY_PLATFORM" ] \
    || offline_fail "offline bundle image inventory header is invalid"
  awk -F '\t' 'NR > 2 && NF != 6 { exit 1 } END { if (NR <= 2) exit 1 }' "$inventory" \
    || offline_fail "offline bundle image inventory rows are invalid"

  expected="$(bundle_expected_images | LC_ALL=C sort)"
  actual="$(tail -n +3 "$inventory" | cut -f1 | LC_ALL=C sort)"
  [ "$actual" = "$expected" ] \
    || offline_fail "offline bundle image inventory does not match its declared profiles"
  [ "$(tail -n +3 "$inventory" | cut -f1 | LC_ALL=C sort -u | wc -l)" \
    -eq "$(tail -n +3 "$inventory" | wc -l)" ] \
    || offline_fail "offline bundle image inventory contains duplicate images"

  expected_count="$(printf '%s\n' "$expected" | sed '/^$/d' | wc -l)"
  image_tar_count="$(find "$STAGE_DIR/images" -type f -name '*.tar' | wc -l)"
  [ "$image_tar_count" -eq "$expected_count" ] \
    || offline_fail "offline bundle image archive count does not match inventory"

  while IFS= read -r image; do
    [ -n "$image" ] || continue
    archive_ref="$(offline_archive_image_ref "$image")"
    row="$(awk -F '\t' -v image="$image" '$1 == image { print }' "$inventory")"
    row_count="$(awk -F '\t' -v image="$image" '$1 == image { count++ } END { print count + 0 }' "$inventory")"
    [ "$row_count" -eq 1 ] || offline_fail "offline bundle image inventory entry is invalid: $image"
    IFS=$'\t' read -r row_image row_archive_ref row_id row_os row_arch row_digest row_extra <<< "$row"
    [ -z "${row_extra:-}" ] && [ "$row_image" = "$image" ] && [ "$row_archive_ref" = "$archive_ref" ] \
      && [[ "$row_id" =~ ^sha256:[a-f0-9]{64}$ ]] \
      && [ "$row_os/$row_arch" = "$SANCTUARY_PLATFORM" ] \
      || offline_fail "offline bundle image inventory entry is invalid: $image"

    if [[ "$image" == *@sha256:* ]]; then
      expected_digest="$(offline_repo_digest_ref "$image")"
      [ "$row_digest" = "$expected_digest" ] \
        || offline_fail "offline bundle image inventory lacks immutable digest: $image"
    else
      [ "$row_digest" = "-" ] \
        || offline_fail "offline bundle local image inventory is invalid: $image"
    fi

    image_tar="$(find "$STAGE_DIR/images" -type f -name "$(offline_image_file_name "$image").tar")"
    [ "$(printf '%s\n' "$image_tar" | sed '/^$/d' | wc -l)" -eq 1 ] \
      || offline_fail "offline bundle image archive is missing or duplicated: $image"
    archive_manifest="$(tar -xOf "$image_tar" manifest.json | tr -d '[:space:]')" \
      || offline_fail "offline image archive manifest is unreadable: $image"
    grep -Fq "\"RepoTags\":[\"$archive_ref\"]" <<< "$archive_manifest" \
      && [ "$(grep -o '"RepoTags":' <<< "$archive_manifest" | wc -l)" -eq 1 ] \
      || offline_fail "offline image archive does not restore exactly $archive_ref: $image"
  done < <(bundle_expected_images)
}

images_present() {
  local image archive_ref
  for image in "$@"; do
    archive_ref="$(offline_archive_image_ref "$image")"
    docker image inspect "$archive_ref" >/dev/null 2>&1 || return 1
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
  local image_tar load_status recovery_status

  offline_require_tool docker

  while IFS= read -r image_tar; do
    [ -n "$image_tar" ] || continue
    offline_log "Loading image: ${image_tar#$STAGE_DIR/}"
    CURRENT_LOADING_IMAGE_TAR="$image_tar"
    load_status=0
    docker load -i "$image_tar" >/dev/null || load_status=$?
    recovery_status=0
    recover_and_register_loaded_archive "$image_tar" || recovery_status=$?
    if [ "$recovery_status" -ne 0 ]; then
      echo "Error: offline image load exact registration was refused: ${image_tar#$STAGE_DIR/}" >&2
      [ "$load_status" -eq 0 ] || return "$load_status"
      return "$recovery_status"
    fi
    CURRENT_LOADING_IMAGE_TAR=""
    [ "$load_status" -eq 0 ] || return "$load_status"
  done < <(find "$STAGE_DIR/images" -type f -name '*.tar' | LC_ALL=C sort)
}

recover_and_register_loaded_archive() {
  local image_tar="$1" inventory="$STAGE_DIR/image-inventory.tsv"
  local archive_ref row image expected_id expected_os expected_arch expected_digest extra inspection
  archive_ref="$(tar -xOf "$image_tar" manifest.json | jq -er \
    'if length == 1 and (.[0].RepoTags | type == "array" and length == 1) then .[0].RepoTags[0] else error("ambiguous archive reference") end')" \
    || return 1
  row="$(awk -F '\t' -v ref="$archive_ref" '$2 == ref { count += 1; row = $0 } END { if (count == 1) print row }' "$inventory")"
  [ -n "$row" ] || return 1
  IFS=$'\t' read -r image _ expected_id expected_os expected_arch expected_digest extra <<< "$row"
  [ -z "${extra:-}" ] || return 1
  inspection="$(docker image inspect "$archive_ref")" || return 1
  printf '%s' "$inspection" | jq -e --arg ref "$archive_ref" --arg id "$expected_id" \
    --arg os "$expected_os" --arg arch "$expected_arch" '
      length == 1 and .[0].Id == $id and ($id | test("^sha256:[0-9a-f]{64}$"))
      and .[0].Os == $os and .[0].Architecture == $arch
      and ((.[0].RepoTags // []) | index($ref) != null)
    ' >/dev/null || return 1
  local created_checkout_root=false registration_status=0
  if [ ! -e "$INSTALL_DIR" ]; then
    mkdir -p -- "$INSTALL_DIR" || return 1
    created_checkout_root=true
  fi
  [ -d "$INSTALL_DIR" ] || return 1
  register_owned_resource oci_image active exact_delete reference \
    "$archive_ref" "$expected_id" "$SANCTUARY_OPERATION_RUN_ID" || registration_status=$?
  if [ "$created_checkout_root" = true ]; then
    rmdir -- "$INSTALL_DIR" || return 1
  fi
  return "$registration_status"
}

verify_loaded_images() {
  local inventory="$STAGE_DIR/image-inventory.tsv"
  local image archive_ref expected_id expected_os expected_arch inspection actual_id actual_os actual_arch

  while IFS= read -r image; do
    [ -n "$image" ] || continue
    archive_ref="$(offline_archive_image_ref "$image")"
    inspection="$(docker image inspect --format '{{.Id}} {{.Os}} {{.Architecture}}' "$archive_ref")" \
      || offline_fail "loaded offline image is missing: $archive_ref"
    IFS=$'\t' read -r _ _ expected_id expected_os expected_arch _ <<< \
      "$(awk -F '\t' -v image="$image" '$1 == image { print }' "$inventory")"
    read -r actual_id actual_os actual_arch <<< "$inspection"
    [ "$actual_id" = "$expected_id" ] && [ "$actual_os" = "$expected_os" ] \
      && [ "$actual_arch" = "$expected_arch" ] \
      || offline_fail "loaded offline image does not match signed inventory: $archive_ref"
  done < <(bundle_expected_images)
}

register_loaded_images() {
  local inventory="$STAGE_DIR/image-inventory.tsv"
  local image archive_ref image_id
  while IFS= read -r image; do
    [ -n "$image" ] || continue
    archive_ref="$(offline_archive_image_ref "$image")"
    image_id="$(awk -F '\t' -v image="$image" '$1 == image { print $3 }' "$inventory")"
    register_owned_resource oci_image active exact_delete reference "$archive_ref" "$image_id" \
      "$SANCTUARY_OPERATION_RUN_ID"
  done < <(bundle_expected_images)
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
  validate_image_inventory
}

apply_prepared_bundle() {
  verify_staged_bundle
  validate_profile_coverage
  ensure_apply_lock
  load_bundle_images
  verify_loaded_images
  checkout_bundle_source
  register_loaded_images
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
    release_apply_lock
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
    GENERATED_STAGE=true
  fi

  prepare_bundle
  apply_prepared_bundle
  release_apply_lock
}

main "$@"
