# Bitcoin Core 29.4 verifier upgrade

The address verifier's shared five-network Core Compose stack advances from
29.0 to 29.4. The Docker Hub candidate was published 2026-07-15T15:01:29Z,
well outside the release cooldown. Its immutable manifest is:

```
bitcoin/bitcoin:29.4@sha256:96b6aae8a8efa8985b8aa64b40b5eeaac42c09f81acbc9da70e3634fe9274dfe
```

Pulling that digest and running `bitcoind --version` reports v29.4.0. The
shared Compose image, image inventory, pinned address oracle/runtime checks,
documentation and regression expectations are coordinated. The standalone
tiny-secp256k1 minimum is also aligned to its already-resolved 2.2.4 version;
this floor alignment installs no new cryptographic code.

The complete 480-case address generator succeeds against fresh mainnet,
testnet3, testnet4, signet and regtest RPC services. Comparing both generated
fixture files against the prior revision after masking only Core version,
Core image digest and source provenance shows every other byte unchanged.
Thus derived addresses, scripts, keys and multisig results are unchanged.
A second independent pinned verification matches both fixtures byte for byte.
Generation completes with signed cleanup state `cleaned`.
The supply-chain inventory and repeatable-helper regressions pass. The
address-provenance and Trezor-config unit suites pass all 18 assertions.

This shared Core Compose change must land with the separately prepared PSBT
proof-manifest and generated-provenance update. The primary integration agent
owns combining both commits and running the full paired CI lanes. It is not
a request to migrate or replace a deployed Bitcoin node or data volume.
