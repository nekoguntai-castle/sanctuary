# Self-Built Bitcoin Core Docker Images

This directory contains scripts to build Bitcoin Core Docker images from **verified official source**, eliminating trust in third-party Docker images.

## Why Build From Source?

Third-party Docker images (like `ruimarinho/bitcoin-core`) are convenient but require trusting:
1. The image maintainer hasn't modified the code
2. The image maintainer's build process is secure
3. The image hasn't been compromised

By building from source with signature verification, we only need to trust:
1. The Bitcoin Core project itself
2. The official release signatures
3. Our own build process (which is auditable)

## How It Works

The build process:

1. **Downloads** the official Bitcoin Core source tarball from `bitcoincore.org`
2. **Downloads** the SHA256SUMS and signature files
3. **Imports** Bitcoin Core maintainer GPG keys from multiple keyservers
4. **Verifies** the signature on SHA256SUMS using maintainer keys
5. **Verifies** the tarball checksum matches SHA256SUMS
6. **Builds** from the verified source with minimal dependencies
7. **Creates** a slim runtime image with only the binaries needed

## Usage

### Build an Image

```bash
# Build default version (27.0)
./build.sh

# Build specific version
./build.sh 26.2

# List available versions
./build.sh --list-versions
```

### Run the Container

```bash
# Test the build
docker run --rm sanctuary-bitcoind:27.0 --version

# Run a daemon-atomic regtest node in the foreground for testing.
# Press Ctrl-C when finished; --rm makes the daemon retire this exact container.
docker run --rm --name bitcoind-test \
  -p 18443:18443 \
  sanctuary-bitcoind:27.0 \
  -regtest -server \
  -rpcuser=test -rpcpassword=test \
  -rpcallowip=0.0.0.0/0 -rpcbind=0.0.0.0

# Test RPC
curl --user test:test --data-binary \
  '{"jsonrpc":"1.0","id":"test","method":"getblockchaininfo","params":[]}' \
  -H 'content-type: text/plain;' \
  http://127.0.0.1:18443/
```

Keep that command attached in its terminal while issuing the RPC and mining
commands below from another terminal. Do not detach the ad hoc container; a
long-lived node belongs in Sanctuary's manifest-backed application lifecycle.

### Mine Regtest Blocks To A Chosen Address

For local development, mine directly to the address you want funded. The address
can change each run; pass the new address with `--address`.

```bash
# Mine one regtest block to the address.
../../scripts/bitcoin/mine-to-address.sh \
  --container bitcoind-test \
  --address bcrt1...

# Mine enough blocks for the requested coinbase output to be spendable.
../../scripts/bitcoin/mine-to-address.sh \
  --container bitcoind-test \
  --address bcrt1... \
  --blocks 1 \
  --mature
```

Coinbase outputs need 100 confirmations before they are spendable, so
`--mature` mines 100 additional blocks after the requested block count.

Public testnet/testnet4 is different from local regtest: it still requires real
proof of work. Use a faucet, or mining software/pool configuration with the
desired payout address, if your node cannot generate blocks directly.

## Maintainer Keys

The following Bitcoin Core maintainer keys are trusted for signature verification:

| Maintainer | Key Fingerprint | Status |
|------------|-----------------|--------|
| Wladimir van der Laan | `71A3B16735405025D447E8F274810B012346C9A6` | Retired |
| Pieter Wuille | `133EAC179436F14A5CF1B794860FEB804E669320` | Active |
| Michael Ford (fanquake) | `E777299FC265DD04793070EB944D35F9AC3DB76A` | Active |
| Hennadii Stepanov | `D1DBF2C4B96F2DEBF4C16654410108112E7EA81F` | Active |
| Andrew Chow | `152812300785C96444D3334D17565732E08E5E41` | Active |
| Gloria Zhao | `6B002C6EA3F91B1B0DF0C9BC8F617F1200A6D25C` | Active |
| Ryan Ofsky | `F4FC70F07310028424EFC20A8E4256593F177720` | Active |

Keys are automatically fetched from:
- keys.openpgp.org
- keyserver.ubuntu.com
- bitcoin-core/guix.sigs repository

## Build Configuration

The built binaries are configured for minimal testing use:
- **No wallet** - Not needed for address derivation
- **No GUI** - CLI only
- **No ZMQ** - Not needed for RPC
- **No tests/benchmarks** - Smaller build

This produces a minimal image suitable for `deriveaddresses` RPC calls.

## Security Considerations

1. **Signature verification is mandatory** - Build fails if signatures don't verify
2. **Checksum verification is mandatory** - Build fails if checksums don't match
3. **Multi-stage build** - Build tools are not in the final image
4. **Non-root user** - Bitcoin Core runs as `bitcoin` user
5. **Minimal runtime** - Only essential libraries included

## Updating to New Versions

When a new Bitcoin Core version is released:

1. Add the version to `AVAILABLE_VERSIONS` in `build.sh`
2. Verify the new version's release notes and changelog
3. Run `./build.sh NEW_VERSION` to build and verify
4. Update `DEFAULT_VERSION` if this becomes the new default

## Troubleshooting

### Signature verification fails
- Ensure you have network access to keyservers
- Check if new maintainer keys need to be added
- Verify the version number is correct

### Build fails
- Check available disk space (needs ~2GB)
- Ensure Docker has enough memory allocated
- Check build logs for specific errors

### Image won't run
- Verify the image was built successfully
- Check Docker daemon is running
- Ensure ports aren't already in use
