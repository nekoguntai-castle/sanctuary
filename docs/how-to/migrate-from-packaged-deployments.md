# Migrate From Umbrel Or Prebuilt GHCR Compose

Sanctuary supports two installation paths:

- an online installation from an immutable GitHub release tag, built locally
  with the main `docker-compose.yml` stack; or
- a signed offline bundle that contains the source and locally loadable images.

The former Umbrel community app and `docker-compose.ghcr.yml` deployment are
retired. They no longer receive release automation or compatibility testing.
Existing installations are not removed automatically, but operators should
migrate before removing their old deployment.

## Before You Start

1. Record the old installation's Sanctuary version. The target must use the
   same or a newer stable tag; do not restore into an older schema.
2. In **Administration -> Backup & Restore**, create and download a Sanctuary
   JSON backup.
3. Save `ENCRYPTION_KEY` and `ENCRYPTION_SALT` from the old runtime environment
   when you have access to them. Store them separately from the backup. Without
   matching values, encrypted node credentials and 2FA secrets may need to be
   configured again after a cross-instance restore.
4. Record deployment-local settings that are not recoverable from the backup,
   including provider credentials, TLS configuration, ports, DNS or proxy
   rules, and enabled optional profiles.
5. Keep the old installation and its volumes intact until the new installation
   has passed the verification checklist below.

Backups contain sensitive wallet metadata and account state. Protect them like
wallet backups. Do not copy raw database volumes between deployment types; use
the supported backup/restore boundary.

## Install From GitHub Source

For most operators, install the latest stable release into a new directory:

```bash
curl -fsSL https://raw.githubusercontent.com/nekoguntai-castle/sanctuary/main/install.sh \
  | SANCTUARY_DIR="$HOME/sanctuary-source" \
    SANCTUARY_RUNTIME_DIR="$HOME/.config/sanctuary-source" bash
```

To migrate to a specific stable tag instead, clone and build that tag locally:

```bash
git clone https://github.com/nekoguntai-castle/sanctuary.git "$HOME/sanctuary-source"
cd "$HOME/sanctuary-source"
git checkout vX.Y.Z
SANCTUARY_RUNTIME_DIR="$HOME/.config/sanctuary-source" ./scripts/setup.sh
```

Use a different Docker host for parallel validation. The Compose project name
and named volumes have shared defaults, so a second checkout on the same Docker
host is not an isolated migration target and can mutate the old deployment.

The supported runtime secrets live outside the checkout. The commands above
isolate them under `~/.config/sanctuary-source`; a normal single installation
uses `~/.config/sanctuary` by default. If you retained the old encryption key
and salt, stop the new stack, configure them in its `sanctuary.env`, and start
the stack again **before restoring**. Confirm the backend is healthy after the
restart; restore decryption uses the backend process environment, not merely the
saved file. See [Runtime Secrets](runtime-secrets.md).

## Install From A Signed Offline Bundle

On a disconnected machine with an existing Sanctuary checkout:

```bash
cd "$HOME/sanctuary"
./install.sh \
  --offline-bundle /path/to/sanctuary-offline-vX.Y.Z-linux-amd64.tar.gz \
  --offline-public-key /secure/path/sanctuary-offline-release-public.pem
```

For a new offline installation, download the bundle and its adjacent `.sig`
file. Verify the outer archive before extracting or running any bundled script:

```bash
openssl dgst -sha256 \
  -verify /secure/path/sanctuary-offline-release-public.pem \
  -signature sanctuary-offline-vX.Y.Z-linux-amd64.tar.gz.sig \
  sanctuary-offline-vX.Y.Z-linux-amd64.tar.gz
mkdir sanctuary-offline-vX.Y.Z
tar -xzf sanctuary-offline-vX.Y.Z-linux-amd64.tar.gz \
  -C sanctuary-offline-vX.Y.Z
cd sanctuary-offline-vX.Y.Z
```

Only after that verification succeeds, run the bundled bootstrap with the same
separately trusted public key:

```bash
SANCTUARY_RUNTIME_DIR="$HOME/.config/sanctuary-source" ./install-offline.sh \
  --install-dir "$HOME/sanctuary-source" \
  --public-key /secure/path/sanctuary-offline-release-public.pem
```

Do not use the public key copied inside the same bundle as the trust anchor.
See [Offline Bundles](../reference/offline-bundles.md) for signature,
checksum, platform, and downgrade rules.

## Restore And Verify

1. Open the new installation and complete its initial administrator setup.
2. Go to **Administration -> Backup & Restore**, upload the JSON backup, review
   every validation warning, and confirm the restore.
3. Re-enter provider and node credentials that were not recoverable. Restored
   MCP keys are intentionally revoked and must be replaced.
4. Verify:
   - administrator login, password, and 2FA behavior;
   - every wallet, descriptor, device, label, group, and policy;
   - expected balances and transaction history against the configured Electrum
     server;
   - audit logs, notifications, optional profiles, and proxy/TLS access; and
   - backup creation from the new installation.
5. Stop and investigate any missing wallet, network mismatch, decryption warning,
   migration error, or unexpected balance before changing the old deployment.

Only after verification succeeds should you stop and remove the old deployment.
Retain the original backup and old runtime-secret record through your normal
recovery retention window.

## What Not To Carry Forward

- Do not use `docker-compose.ghcr.yml` or its package URLs.
- Do not expect the retired Umbrel community-app repository to publish updates.
- Do not copy deployment-specific database volumes into the source installation.
- Do not downgrade to make an old package version match; migrate to the same or
  a newer supported stable tag.
