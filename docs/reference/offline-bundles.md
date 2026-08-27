# Offline Bundles

Sanctuary supports offline install and upgrade bundles for airgapped machines
or environments where GitHub access is unavailable.

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

This writes the bundle and an adjacent
`sanctuary-offline-vX.Y.Z-linux-amd64.tar.gz.sig`. Publish both files. A fresh
installation must verify that detached signature before extracting or executing
anything from the bundle:

```bash
openssl dgst -sha256 \
  -verify /secure/path/sanctuary-offline-release-public.pem \
  -signature sanctuary-offline-vX.Y.Z-linux-amd64.tar.gz.sig \
  sanctuary-offline-vX.Y.Z-linux-amd64.tar.gz
```

Official release bundles are full bundles: core Sanctuary images plus
monitoring and Tor profile images, including Sanctuary's packaged Grafana
credential-migration image. This lets an existing optional-profile
installation upgrade from one artifact.

On the installation machine, after the detached signature check above, extract
the archive and run the installer carried by that exact bundle:

```bash
mkdir sanctuary-offline-vX.Y.Z
tar -xzf /path/to/sanctuary-offline-vX.Y.Z-linux-amd64.tar.gz \
  -C sanctuary-offline-vX.Y.Z
cd sanctuary-offline-vX.Y.Z
./install-offline.sh \
  --public-key /secure/path/sanctuary-offline-release-public.pem
```

Always use the version-matched `install-offline.sh` from the target bundle,
including for upgrades. An older installed checkout's `./install.sh
--offline-bundle` helper may not understand a newer bundle format. The bundled
installer verifies the signed internal checksums, offers to create a local
pre-upgrade backup, loads images with `docker load`, checks out the bundled
release tag from a git bundle, then starts Sanctuary without network pulls or
Docker builds. Never execute it from an archive whose detached signature has
not been verified first.

## Release Manifest Verification

Stable releases must publish a release manifest next to the release assets. The
manifest is the operator-verifiable inventory for release trust: tag, commit,
builder workflow, signed `SHA256SUMS`, local artifact hashes, SBOM/provenance
references, and offline bundle metadata.

The trusted operator assembles that set with `npm run release:prepare-assets`.
The assembler accepts only the currently verified `linux/amd64` target, builds a
full signed bundle, creates the source archive, installer, release notes, SPDX
2.3 SBOM, subject-bound SLSA provenance, signed release-level checksums, and a
detached signature for the release manifest, then runs strict local
verification. Release signing keys remain operator-held and are never placed in
Forgejo or GitHub CI.

After downloading the manifest, `SHA256SUMS`, `SHA256SUMS.sig`, and the listed
release assets into one directory, verify the local artifact set from a trusted
checkout:

```bash
openssl dgst -sha256 \
  -verify scripts/offline/keys/sanctuary-offline-release-public.pem \
  -signature /path/to/release-assets/release-manifest.json.sig \
  /path/to/release-assets/release-manifest.json

npm run release:verify-artifacts -- \
  --manifest /path/to/release-assets/release-manifest.json \
  --strict-stable \
  --public-key scripts/offline/keys/sanctuary-offline-release-public.pem
```

This verification tool is release/operator evidence only. It does not add a
Bitcoin Core, hardware wallet, registry, or network dependency to Sanctuary's
offline runtime path.

Minimum manifest contract:

- `schema: 1`.
- `release.tag`, `release.version`, `release.commit`, and
  `release.stability`.
- `builder.workflow` and `builder.runId`.
- A `checksum-file` artifact for `SHA256SUMS` with an
  `openssl-rsa-sha256` detached signature.
- A detached `release-manifest.json.sig` verified against the separately trusted
  offline release key before trusting the manifest inventory.
- Stable-release artifacts for the offline bundle, source archive, install
  script, and release notes.
- Local artifact paths are relative to the manifest directory, must stay inside
  that directory, and must have `sha256` values matching both the file content
  and `SHA256SUMS`.
- Offline bundles must include local SBOM and provenance references.
- Images carried inside the offline bundle are covered by the bundle's signed
  checksums and platform metadata; no registry lookup is part of the current
  release contract.

Historical release manifests may contain registry-backed `container-image`
entries. The verifier retains compatibility with those records, but they are
not required for new releases and do not make the retired registry deployment
a supported installation path.

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

The only release-verified target is currently `linux/amd64`. Low-level bundle
scripts accept `--platform linux/arm64`, but the release assembler rejects it.
Enable ARM64 release assembly only after a trusted operator has completed the
full create, transfer, apply, startup, health, and upgrade path on a native ARM64
host. Cross-building on AMD64 is not acceptance evidence.
