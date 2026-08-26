#!/usr/bin/env bash
#
# Shared helpers for Sanctuary offline bundle scripts.

set -euo pipefail

OFFLINE_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFLINE_REPO_ROOT="$(cd "$OFFLINE_COMMON_DIR/../.." && pwd)"
OFFLINE_DEFAULT_PUBLIC_KEY="$OFFLINE_COMMON_DIR/keys/sanctuary-offline-release-public.pem"

CORE_IMAGES=(
  "sanctuary-backend:local"
  "sanctuary-frontend:local"
  "sanctuary-gateway:local"
  "sanctuary-llm-egress-proxy:local"
  "postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
  "redis:7-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2"
  "tecnativa/docker-socket-proxy:latest@sha256:1f5038b54f06c3e18422902cf00ba21803d1c97805aae032e5e6673d532d3459"
)

MONITORING_IMAGES=(
  "sanctuary-grafana-migration:local"
  "jaegertracing/all-in-one:1.53@sha256:60e65bfffe1f66aee96d6fc8b6bf65afd42016be5dcc09d2e15d8462f7d9409c"
  "grafana/loki:2.9.0@sha256:b025a0220f390baaab01578aea2fe0ba677584d9f248c3fe5af15f84dd1de60d"
  "grafana/promtail:3.5.0@sha256:507dfecd2f0949475d071c124bea1c26fc4f8c1cff0372eee57478d5b1c5fbff"
  "prom/prometheus:v2.47.0@sha256:c5dd3503828713c4949ae1bccd1d8d69f382c33d441954674a6b78ebe69c3331"
  "prom/alertmanager:v0.26.0@sha256:361db356b33041437517f1cd298462055580585f26555c317df1a3caf2868552"
  "grafana/grafana:10.4.19-security-01@sha256:5584505cb75be8cb14c19d7473a87e2675c68b34b546bc1923ef74300c337111"
)

TOR_IMAGES=(
  "dperson/torproxy:latest@sha256:d8b5f1cf24f1b7a0aa334929a264b2606a107223dd0d51eb1cda8aae6fbeec53"
)

offline_fail() {
  echo "Error: $*" >&2
  exit 1
}

offline_log() {
  echo "$*"
}

offline_require_tool() {
  command -v "$1" >/dev/null 2>&1 || offline_fail "$1 is required"
}

offline_detect_platform() {
  local os arch
  os="$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m 2>/dev/null)"

  case "$os" in
    linux)
      ;;
    *)
      offline_fail "unsupported offline bundle host OS: $os"
      ;;
  esac

  case "$arch" in
    x86_64|amd64)
      echo "linux/amd64"
      ;;
    aarch64|arm64)
      echo "linux/arm64"
      ;;
    *)
      offline_fail "unsupported offline bundle host architecture: $arch"
      ;;
  esac
}

offline_sanitize_component() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-'
}

offline_image_file_name() {
  offline_sanitize_component "$1"
}

offline_all_release_images() {
  printf '%s\n' "${CORE_IMAGES[@]}" "${MONITORING_IMAGES[@]}" "${TOR_IMAGES[@]}"
}

offline_core_images() {
  printf '%s\n' "${CORE_IMAGES[@]}"
}

offline_validate_tar_entries() {
  local archive="$1"

  if tar -tvzf "$archive" | awk '$1 !~ /^[-d]/ { exit 1 }'; then
    :
  else
    offline_fail "bundle contains links or special files; refusing to extract"
  fi

  tar -tzf "$archive" | while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    case "$entry" in
      /*|../*|*/../*|*'/..'|'.'|'..')
        offline_fail "unsafe bundle path: $entry"
        ;;
    esac
  done
}

offline_extract_bundle() {
  local archive="$1"
  local stage_dir="$2"

  [ -f "$archive" ] || offline_fail "bundle not found: $archive"
  mkdir -p "$stage_dir"
  offline_validate_tar_entries "$archive"
  tar -xzf "$archive" -C "$stage_dir"
}

offline_public_key_path() {
  local explicit_path="${1:-}"

  if [ -n "$explicit_path" ]; then
    echo "$explicit_path"
  elif [ -n "${SANCTUARY_OFFLINE_PUBLIC_KEY:-}" ]; then
    echo "$SANCTUARY_OFFLINE_PUBLIC_KEY"
  else
    echo "$OFFLINE_DEFAULT_PUBLIC_KEY"
  fi
}

offline_verify_signature_and_checksums() {
  local stage_dir="$1"
  local public_key="${2:-}"
  local allow_unsigned="${3:-false}"
  local checksums="$stage_dir/checksums.sha256"
  local signature="$stage_dir/checksums.sha256.sig"
  local key_path

  [ -s "$checksums" ] || offline_fail "bundle is missing checksums.sha256"

  if [ -s "$signature" ]; then
    key_path="$(offline_public_key_path "$public_key")"
    [ -s "$key_path" ] || offline_fail "offline release public key not found: $key_path"
    offline_require_tool openssl
    openssl dgst -sha256 -verify "$key_path" -signature "$signature" "$checksums" >/dev/null \
      || offline_fail "bundle signature verification failed"
  elif [ "$allow_unsigned" = "true" ]; then
    echo "Warning: unsigned development bundle accepted by explicit override." >&2
  else
    offline_fail "bundle is unsigned; refusing without --allow-unsigned-dev-bundle"
  fi

  (
    cd "$stage_dir"
    sha256sum -c checksums.sha256 >/dev/null
  ) || offline_fail "bundle checksum verification failed"
}

offline_load_manifest() {
  local stage_dir="$1"
  local manifest="$stage_dir/manifest.env"

  [ -s "$manifest" ] || offline_fail "bundle is missing manifest.env"
  # shellcheck disable=SC1090
  source "$manifest"
}

offline_verify_platform() {
  local expected="$1"
  local actual
  actual="$(offline_detect_platform)"

  [ "$expected" = "$actual" ] || offline_fail "bundle platform $expected does not match host platform $actual"
}

offline_checksum_stage() {
  local stage_dir="$1"

  (
    cd "$stage_dir"
    find . -type f ! -name checksums.sha256 ! -name checksums.sha256.sig | LC_ALL=C sort | while IFS= read -r file; do
      sha256sum "$file"
    done > checksums.sha256
  )
}
