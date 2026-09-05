#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$SCRIPT_DIR/../ownership/producer-hooks.sh"

# Provenance labels the cleanup coordinator needs before it will treat an
# unlabeled image as externally registered (docker-observation.mjs
# validImageProvenance). The current server/Dockerfile emits them itself; the
# pinned historical rc10 tree emits only revision and image lock, so the build
# stamps all five with --label for every source tree. Printed one argument per
# line for mapfile.
replay_provenance_label_args() {
  local revision="$1" image_lock_sha256="$2" build_version="$3" build_id="$4"
  printf '%s\n' \
    --label "org.opencontainers.image.source=https://github.com/nekoguntai-castle/sanctuary" \
    --label "org.opencontainers.image.revision=$revision" \
    --label "dev.sanctuary.image-lock-sha256=$image_lock_sha256" \
    --label "org.opencontainers.image.version=$build_version" \
    --label "io.sanctuary.build-id=$build_id"
}

# Read the package version of a source root given as any path (relative to the
# caller's working directory or absolute). A bare require(path) would be a
# module-name lookup and fail for relative roots such as the workflow's
# `.tmp/wallet-sync-replay/rc10-source`.
replay_source_version() {
  node -e '
    const { resolve } = require("node:path");
    const { readFileSync } = require("node:fs");
    const manifest = JSON.parse(readFileSync(resolve(process.argv[1], "package.json"), "utf8"));
    if (typeof manifest.version !== "string" || manifest.version === "") process.exit(1);
    process.stdout.write(manifest.version);
  ' "$1"
}

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

archive_image_id() {
  tar -xOf "$1" manifest.json | node -e '
    let input = "";
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      const manifest = JSON.parse(input);
      const config = manifest.length === 1 ? manifest[0]?.Config : null;
      const match = /^blobs\/sha256\/([0-9a-f]{64})$/.exec(config ?? "");
      if (!match) process.exit(1);
      process.stdout.write(`sha256:${match[1]}`);
    });
  '
}

# Prove the daemon holds exactly the archived image under exactly one tag, and
# print the identity the daemon uses for it. The classic graphdriver store
# reports the config digest (manifest.json Config); the containerd image store
# reports the manifest digest (index.json) and lists it as a repo digest. Both
# are content addresses of the same archived bytes, so either is exact.
verify_exact_loaded_image() {
  local image_ref="$1" expected_image_id="$2" revision="$3" image_lock_sha256="$4"
  local manifest_digest="${5:-}" listed inspection identity_failure=''
  listed="$(docker image ls --no-trunc --filter "reference=$image_ref" --format '{{.ID}}')" || return 1
  # Evaluate every check and report all failures in one run: v0.8.70-rc2
  # through rc5 each surfaced exactly one of identity, tags, digests, and
  # labels per ~2.5 h release cycle because the first mismatch returned early
  # (issue #1020).
  if [ "$listed" != "$expected_image_id" ] && { [ -z "$manifest_digest" ] || [ "$listed" != "$manifest_digest" ]; }; then
    identity_failure="daemon lists '$listed', archive config $expected_image_id, archive manifest ${manifest_digest:-unknown}"
  fi
  inspection="$(docker image inspect "$image_ref")" || return 1
  INSPECTION="$inspection" IDENTITY_FAILURE="$identity_failure" \
    node - "$image_ref" "$listed" "$manifest_digest" "$revision" "$image_lock_sha256" <<'NODE' || return 1
const [reference, listedId, manifestDigest, revision, imageLock] = process.argv.slice(2);
const failures = [];
if (process.env.IDENTITY_FAILURE) failures.push(`identity mismatch: ${process.env.IDENTITY_FAILURE}`);
let records;
try { records = JSON.parse(process.env.INSPECTION); } catch { records = null; }
const image = Array.isArray(records) && records.length === 1 ? records[0] : null;
if (!image) {
  failures.push(`inspect returned ${Array.isArray(records) ? records.length : 'no'} records, expected exactly 1`);
} else {
  const labels = image.Config?.Labels ?? {};
  const repository = reference.replace(/:[^/:]+$/, '');
  // The containerd image store reports references fully qualified
  // (docker.io/library/name:tag); the classic store reports them as given.
  // Both name the same single image, so accept exactly one of the two forms.
  const qualify = (name) => {
    const first = name.split('/')[0];
    const hasRegistry = name.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost');
    if (hasRegistry) return name;
    return name.includes('/') ? `docker.io/${name}` : `docker.io/library/${name}`;
  };
  const repoTags = image.RepoTags ?? [];
  const repoTagsExact = repoTags.length === 1 && (repoTags[0] === reference || repoTags[0] === qualify(reference));
  const repoDigests = image.RepoDigests ?? [];
  const repoDigestsExact = repoDigests.length === 0
    || (repoDigests.length === 1 && manifestDigest !== ''
      && (repoDigests[0] === `${repository}@${manifestDigest}` || repoDigests[0] === `${qualify(repository)}@${manifestDigest}`));
  if (image.Id !== listedId) failures.push(`inspect Id ${image.Id} differs from listed ${listedId}`);
  if (!repoTagsExact) failures.push(`RepoTags ${JSON.stringify(repoTags)}`);
  if (!repoDigestsExact) failures.push(`RepoDigests ${JSON.stringify(repoDigests)}`);
  // Every source tree labels revision and image lock (the build-arg contract).
  // The source, version, and build-id labels arrived with producer stamping;
  // the pinned historical rc10 tree predates them, so require them exactly
  // when present and tolerate their absence.
  if (labels['org.opencontainers.image.revision'] !== revision) failures.push('revision label');
  if (labels['dev.sanctuary.image-lock-sha256'] !== imageLock) failures.push('image-lock label');
  if ('org.opencontainers.image.source' in labels
    && labels['org.opencontainers.image.source'] !== 'https://github.com/nekoguntai-castle/sanctuary') failures.push('source label');
  if ('org.opencontainers.image.version' in labels
    && !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(labels['org.opencontainers.image.version'])) failures.push('version label');
  if ('io.sanctuary.build-id' in labels
    && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(labels['io.sanctuary.build-id'])) failures.push('build-id label');
}
if (failures.length > 0) {
  process.stderr.write(`wallet-sync replay image inspection rejected for ${reference} (${failures.length} failing check${failures.length === 1 ? '' : 's'}):\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}
NODE
  printf '%s' "$listed"
}

register_loaded_image() (
  local image_ref="$1" source_root="$2" image_id="$3"
  SANCTUARY_PROJECT_DIR="$source_root"
  ownership_initialize
  SANCTUARY_PROJECT_DIR="$source_root" \
    register_owned_resource oci_image obsolete \
      exact_delete reference "$image_ref" "$image_id" "$SANCTUARY_OPERATION_RUN_ID"
)

load_and_register_image() {
  local archive="$1" image_ref="$2" expected_image_id="$3" revision="$4"
  local image_lock_sha256="$5" source_root="$6" manifest_digest="${7:-}"
  local load_status=0 registration_status=0 daemon_image_id
  docker load --input "$archive" || load_status=$?
  if ! daemon_image_id="$(verify_exact_loaded_image "$image_ref" "$expected_image_id" "$revision" "$image_lock_sha256" "$manifest_digest")"; then
    echo "wallet-sync replay image recovery is ambiguous for $image_ref" >&2
    [ "$load_status" -ne 0 ] && return "$load_status"
    return 1
  fi
  # Register the identity the daemon reports so exact_delete cleanup resolves it.
  register_loaded_image "$image_ref" "$source_root" "$daemon_image_id" || registration_status=$?
  if [ "$load_status" -ne 0 ]; then
    [ "$registration_status" -eq 0 ] \
      || echo "wallet-sync replay image recovery registration failed for $image_ref" >&2
    return "$load_status"
  fi
  return "$registration_status"
}

register_replay_evidence() {
  local source_root="$1" artifact_path="$2" artifact_sha="$3"
  SANCTUARY_PROJECT_DIR="$source_root"
  ownership_initialize
  SANCTUARY_PROJECT_DIR="$source_root" \
    register_owned_resource cleanup_evidence retained retain path "$artifact_path" "sha256:$artifact_sha" "$SANCTUARY_OPERATION_RUN_ID"
}

build_image() {
  [ "$#" -eq 4 ] || usage
  local source_root="$1"
  local revision="$2"
  local image_ref="$3"
  local output_dir="$4"
  local image_lock="$source_root/config/container-image-lock.json"
  local image_lock_sha256 temporary_archive manifest_digest digest_hex archive archive_sha256 receipt build_version build_id expected_image_id

  require_revision "$revision"
  [ -f "$source_root/server/Dockerfile" ] || { echo "missing server Dockerfile under $source_root" >&2; exit 1; }
  [ -f "$image_lock" ] || { echo "missing image lock under $source_root" >&2; exit 1; }
  mkdir -p "$output_dir"
  if find "$output_dir" -mindepth 1 -print -quit | grep -q .; then
    echo "wallet-sync replay image output directory must be empty: $output_dir" >&2
    exit 1
  fi

  image_lock_sha256="$(sha256sum "$image_lock" | cut -d ' ' -f 1)"
  build_version="$(replay_source_version "$source_root")"
  build_id="${SANCTUARY_OPERATION_RUN_ID:-replay-${revision:0:12}}"
  local -a provenance_label_args
  mapfile -t provenance_label_args < <(replay_provenance_label_args "$revision" "$image_lock_sha256" "$build_version" "$build_id")
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
    --build-arg "SANCTUARY_BUILD_VERSION=$build_version" \
    --build-arg "SANCTUARY_BUILD_ID=$build_id" \
    "${provenance_label_args[@]}" \
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
  expected_image_id="$(archive_image_id "$archive")"

  load_and_register_image "$archive" "$image_ref" "$expected_image_id" \
    "$revision" "$image_lock_sha256" "$source_root" "$manifest_digest"
  register_replay_evidence "$source_root" "$archive" "$archive_sha256"

  receipt="$output_dir/image-receipt.json"
  node - "$receipt" "$archive" "$archive_sha256" "$manifest_digest" "$image_ref" "$revision" "$image_lock_sha256" "$expected_image_id" <<'NODE'
const { writeFileSync } = require('node:fs');
const [receipt, archive, archiveSha256, manifestDigest, imageRef, revision, imageLockSha256, imageId] = process.argv.slice(2);
writeFileSync(receipt, `${JSON.stringify({
  schemaVersion: 'sanctuary.wallet-sync-replay-image.v1',
  archive: require('node:path').basename(archive),
  archiveSha256,
  manifestDigest,
  imageRef,
  revision,
  imageLockSha256,
  imageId,
}, null, 2)}\n`);
NODE
}

load_image() {
  [ "$#" -eq 3 ] || usage
  local receipt="$1"
  local image_ref="$2"
  local revision="$3"
  local receipt_dir archive archive_sha256 manifest_digest image_lock_sha256 expected_image_id actual_archive_sha actual_manifest

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
if (!/^sha256:[0-9a-f]{64}$/.test(receipt.imageId ?? '')) process.exit(1);
for (const key of ['archive', 'archiveSha256', 'manifestDigest', 'imageLockSha256', 'imageId']) {
  process.stdout.write(`${receipt[key]}\n`);
}
NODE
  )
  [ "${#fields[@]}" -eq 5 ] || { echo "invalid wallet-sync replay image receipt" >&2; exit 1; }
  archive="$receipt_dir/${fields[0]}"
  archive_sha256="${fields[1]}"
  manifest_digest="${fields[2]}"
  image_lock_sha256="${fields[3]}"
  expected_image_id="${fields[4]}"
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
  [ "$(archive_image_id "$archive")" = "$expected_image_id" ] \
    || { echo "wallet-sync replay archive image identity mismatch" >&2; exit 1; }

  load_and_register_image "$archive" "$image_ref" "$expected_image_id" \
    "$revision" "$image_lock_sha256" "$(git rev-parse --show-toplevel)" "$manifest_digest"
  register_replay_evidence "$(git rev-parse --show-toplevel)" "$archive" "$archive_sha256"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  command="${1:-}"
  [ "$#" -gt 0 ] || usage
  shift
  case "$command" in
    build) build_image "$@" ;;
    load) load_image "$@" ;;
    *) usage ;;
  esac
fi
