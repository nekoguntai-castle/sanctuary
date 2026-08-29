#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  wallet-sync-replay-image.sh build SOURCE_ROOT REVISION IMAGE_REF OUTPUT_DIR
  wallet-sync-replay-image.sh load RECEIPT IMAGE_REF REVISION
EOF
  exit 2
}

require_revision() {
  if ! printf '%s' "$1" | grep -Eq '^[0-9a-f]{40}$'; then
    echo "wallet-sync replay image revision must be a full lowercase SHA" >&2
    exit 1
  fi
}

inspect_label() {
  docker image inspect --format "{{index .Config.Labels \"$2\"}}" "$1"
}

verify_loaded_image() {
  local image_ref="$1"
  local revision="$2"
  local image_lock_sha256="$3"
  local actual_revision actual_image_lock

  actual_revision="$(inspect_label "$image_ref" org.opencontainers.image.revision)"
  actual_image_lock="$(inspect_label "$image_ref" dev.sanctuary.image-lock-sha256)"
  if [ "$actual_revision" != "$revision" ] || [ "$actual_image_lock" != "$image_lock_sha256" ]; then
    echo "wallet-sync replay image identity mismatch for $image_ref" >&2
    echo "expected revision=$revision image_lock=$image_lock_sha256" >&2
    echo "actual revision=$actual_revision image_lock=$actual_image_lock" >&2
    exit 1
  fi
}

build_image() {
  [ "$#" -eq 4 ] || usage
  local source_root="$1"
  local revision="$2"
  local image_ref="$3"
  local output_dir="$4"
  local image_lock="$source_root/config/container-image-lock.json"
  local image_lock_sha256 temporary_archive manifest_digest digest_hex archive archive_sha256 receipt

  require_revision "$revision"
  [ -f "$source_root/server/Dockerfile" ] || { echo "missing server Dockerfile under $source_root" >&2; exit 1; }
  [ -f "$image_lock" ] || { echo "missing image lock under $source_root" >&2; exit 1; }
  mkdir -p "$output_dir"
  if find "$output_dir" -mindepth 1 -print -quit | grep -q .; then
    echo "wallet-sync replay image output directory must be empty: $output_dir" >&2
    exit 1
  fi

  image_lock_sha256="$(sha256sum "$image_lock" | cut -d ' ' -f 1)"
  temporary_archive="$output_dir/.wallet-sync-replay-$revision.oci.tar"
  # The Docker exporter emits an OCI layout (oci-layout/index.json/blobs) plus
  # manifest.json, allowing the exact archived bytes to be loaded by the
  # production Docker daemon without a registry or a second conversion build.
  docker buildx build \
    --file "$source_root/server/Dockerfile" \
    --platform linux/amd64 \
    --tag "$image_ref" \
    --build-arg "SANCTUARY_SOURCE_COMMIT=$revision" \
    --build-arg "SANCTUARY_IMAGE_LOCK_SHA256=$image_lock_sha256" \
    --provenance=false \
    --sbom=false \
    --output "type=docker,dest=$temporary_archive" \
    "$source_root"

  for required_entry in oci-layout index.json manifest.json; do
    if ! tar -tf "$temporary_archive" | grep -Fx "$required_entry" >/dev/null; then
      echo "wallet-sync replay archive is missing OCI/Docker entry: $required_entry" >&2
      exit 1
    fi
  done

  manifest_digest="$(tar -xOf "$temporary_archive" index.json | node -e '
    let input = "";
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      const index = JSON.parse(input);
      const digest = index.manifests?.[0]?.digest;
      if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? "")) process.exit(1);
      process.stdout.write(digest);
    });
  ')"
  digest_hex="${manifest_digest#sha256:}"
  archive="$output_dir/wallet-sync-replay-$revision-$digest_hex.oci.tar"
  mv "$temporary_archive" "$archive"
  archive_sha256="$(sha256sum "$archive" | cut -d ' ' -f 1)"

  docker load --input "$archive"
  verify_loaded_image "$image_ref" "$revision" "$image_lock_sha256"

  receipt="$output_dir/image-receipt.json"
  node - "$receipt" "$archive" "$archive_sha256" "$manifest_digest" "$image_ref" "$revision" "$image_lock_sha256" <<'NODE'
const { writeFileSync } = require('node:fs');
const [receipt, archive, archiveSha256, manifestDigest, imageRef, revision, imageLockSha256] = process.argv.slice(2);
writeFileSync(receipt, `${JSON.stringify({
  schemaVersion: 'sanctuary.wallet-sync-replay-image.v1',
  archive: require('node:path').basename(archive),
  archiveSha256,
  manifestDigest,
  imageRef,
  revision,
  imageLockSha256,
}, null, 2)}\n`);
NODE
}

load_image() {
  [ "$#" -eq 3 ] || usage
  local receipt="$1"
  local image_ref="$2"
  local revision="$3"
  local receipt_dir archive archive_sha256 manifest_digest image_lock_sha256 actual_archive_sha actual_manifest

  require_revision "$revision"
  [ -f "$receipt" ] || { echo "missing wallet-sync replay image receipt: $receipt" >&2; exit 1; }
  receipt_dir="$(cd "$(dirname "$receipt")" && pwd)"
  readarray -t fields < <(node - "$receipt" "$image_ref" "$revision" <<'NODE'
const { readFileSync } = require('node:fs');
const { basename } = require('node:path');
const receipt = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (receipt.schemaVersion !== 'sanctuary.wallet-sync-replay-image.v1') process.exit(1);
if (receipt.imageRef !== process.argv[3] || receipt.revision !== process.argv[4]) process.exit(1);
if (basename(receipt.archive ?? '') !== receipt.archive) process.exit(1);
if (!/^[0-9a-f]{64}$/.test(receipt.archiveSha256 ?? '')) process.exit(1);
if (!/^sha256:[0-9a-f]{64}$/.test(receipt.manifestDigest ?? '')) process.exit(1);
if (!/^[0-9a-f]{64}$/.test(receipt.imageLockSha256 ?? '')) process.exit(1);
for (const key of ['archive', 'archiveSha256', 'manifestDigest', 'imageLockSha256']) {
  process.stdout.write(`${receipt[key]}\n`);
}
NODE
  )
  [ "${#fields[@]}" -eq 4 ] || { echo "invalid wallet-sync replay image receipt" >&2; exit 1; }
  archive="$receipt_dir/${fields[0]}"
  archive_sha256="${fields[1]}"
  manifest_digest="${fields[2]}"
  image_lock_sha256="${fields[3]}"
  [ -f "$archive" ] || { echo "missing OCI archive named by receipt: $archive" >&2; exit 1; }

  actual_archive_sha="$(sha256sum "$archive" | cut -d ' ' -f 1)"
  actual_manifest="$(tar -xOf "$archive" index.json | node -e '
    let input = "";
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => process.stdout.write(JSON.parse(input).manifests[0].digest));
  ')"
  if [ "$actual_archive_sha" != "$archive_sha256" ] || [ "$actual_manifest" != "$manifest_digest" ]; then
    echo "wallet-sync replay OCI artifact digest mismatch" >&2
    exit 1
  fi

  docker load --input "$archive"
  verify_loaded_image "$image_ref" "$revision" "$image_lock_sha256"
}

command="${1:-}"
[ "$#" -gt 0 ] || usage
shift
case "$command" in
  build) build_image "$@" ;;
  load) load_image "$@" ;;
  *) usage ;;
esac
