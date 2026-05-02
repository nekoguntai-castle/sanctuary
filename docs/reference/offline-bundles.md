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
