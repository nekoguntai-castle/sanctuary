# Offline Bundles

Sanctuary supports offline install and upgrade bundles for airgapped machines
or environments where GitHub/GHCR access is blocked.

## Operator Flow

On a connected release machine:

```bash
./scripts/offline/create-bundle.sh \
  --tag vX.Y.Z \
  --platform linux/amd64 \
  --signing-key /secure/path/sanctuary-offline-release-private.pem \
  --public-key /secure/path/sanctuary-offline-release-public.pem \
  --output sanctuary-offline-vX.Y.Z-linux-amd64.tar.gz
```

Official release bundles are full bundles: core Sanctuary images plus
monitoring and Tor profile images. This lets an existing optional-profile
installation upgrade from one artifact.

On the installation machine:

```bash
cd ~/sanctuary
./install.sh --offline-bundle /path/to/sanctuary-offline-vX.Y.Z-linux-amd64.tar.gz
```

If the installed checkout does not already include the pinned offline-release
public key, pass it explicitly:

```bash
./install.sh \
  --offline-bundle /path/to/sanctuary-offline-vX.Y.Z-linux-amd64.tar.gz \
  --offline-public-key /secure/path/sanctuary-offline-release-public.pem
```

The offline path verifies the bundle signature and checksums, offers to create
a local pre-upgrade backup, loads images with `docker load`, checks out the
bundled release tag from a git bundle, then starts Sanctuary without network
pulls or Docker builds.

The bundle bootstrap script, `install-offline.sh`, includes the same backup
prompt for machines whose installed checkout predates offline bundle support.

## Release Manifest Verification

Stable releases must publish a release manifest next to the release assets. The
manifest is the operator-verifiable inventory for release trust: tag, commit,
builder workflow, signed `SHA256SUMS`, local artifact hashes, SBOM/provenance
references, offline bundle metadata, and container image digests.

After downloading the manifest, `SHA256SUMS`, `SHA256SUMS.sig`, and the listed
release assets into one directory, verify the local artifact set from a trusted
checkout:

```bash
npm run release:verify-artifacts -- \
  --manifest /path/to/release-assets/release-manifest.json \
  --strict-stable \
  --public-key scripts/offline/keys/sanctuary-offline-release-public.pem
```

If the verifying machine has registry access and Docker Buildx available, also
compare the published container manifest-list digests:

```bash
npm run release:verify-artifacts -- \
  --manifest /path/to/release-assets/release-manifest.json \
  --strict-stable \
  --public-key scripts/offline/keys/sanctuary-offline-release-public.pem \
  --verify-image-digests
```

This verification tool is release/operator evidence only. It does not add a
Bitcoin Core, hardware wallet, registry, or Docker dependency to Sanctuary's
runtime path.

Minimum manifest contract:

- `schema: 1`.
- `release.tag`, `release.version`, `release.commit`, and
  `release.stability`.
- `builder.workflow` and `builder.runId`.
- A `checksum-file` artifact for `SHA256SUMS` with an
  `openssl-rsa-sha256` detached signature.
- Stable-release artifacts for the offline bundle, source archive, install
  script, release notes, frontend container image, and backend container image.
- Local artifact paths are relative to the manifest directory, must stay inside
  that directory, and must have `sha256` values matching both the file content
  and `SHA256SUMS`.
- Offline bundles must include local SBOM and provenance references.
- Container image artifacts must include the manifest-list digest, linux/amd64
  and linux/arm64 digests, and local SBOM plus provenance or attestation
  references.

## Trust Anchor

The bundle contains a copy of the public key for operator inspection, but that
copy is not the trust anchor. Verification must use a public key already pinned
in the installed checkout or supplied from a separately trusted path:

```bash
SANCTUARY_OFFLINE_PUBLIC_KEY=/secure/path/sanctuary-offline-release-public.pem \
  ./install.sh --offline-bundle /path/to/bundle.tar.gz
```

Unsigned bundles are accepted only with `--allow-unsigned-dev-bundle`, and only
for development or local tests.

Downgrades are refused by default because migrations may be irreversible. Use
`--allow-downgrade` only for an explicit recovery flow after taking a backup.

## Pre-Upgrade Backup

Before modifying an existing installation, the installer offers to create one
local backup archive:

```text
~/.config/sanctuary/backups/offline-upgrades/<timestamp>-<version>/
  sanctuary-upgrade-backup-<timestamp>-from-<version>.tar.gz
```

The archive contains:

- PostgreSQL custom-format dump.
- Runtime env file with encryption material.
- TLS material when present.
- Restore metadata and internal checksums.

This file is sensitive. Store it like a wallet backup.

Non-interactive upgrades require explicit acknowledgement:

```bash
SANCTUARY_ASSUME_YES=true ./install.sh --offline-bundle /path/to/bundle.tar.gz
```

Skipping the backup is explicit:

```bash
SANCTUARY_ASSUME_YES=true SANCTUARY_SKIP_UPGRADE_BACKUP=true \
  ./install.sh --offline-bundle /path/to/bundle.tar.gz
```

## Offline Runtime Rules

Offline mode must not make network calls:

- no release API lookup
- no `git ls-remote`
- no `docker pull`
- no `docker compose build`
- no package manager install

For offline installs, `./start.sh --rebuild` is disabled by default. Apply a
newer signed offline bundle instead.

## Platform Scope

The first target platform is `linux/amd64`. The bundle scripts accept
`--platform linux/arm64`, but treat arm64 as verified only after release CI or a
trusted operator has run the full create/apply path for that platform.
