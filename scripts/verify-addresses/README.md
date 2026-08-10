# Bitcoin address verification

This package produces the checked-in address fixtures used by Sanctuary's
funds-safety tests. A case is accepted only when all four required
implementations agree exactly on both the address and output script:

| Implementation | Independent input |
| --- | --- |
| Bitcoin Core 29.0 | Root private key plus the complete hardened and unhardened path in a descriptor |
| bitcoinjs-lib | BIP-39 mnemonic seed |
| bip_utils (Python) | BIP-39 mnemonic seed |
| btcd/btcutil (Go) | BIP-39 mnemonic seed |

An unavailable implementation is a hard failure. Addresses are never rewritten
between networks to manufacture agreement.

## Locked derivation matrix

The schema-v2 matrix contains exactly 480 cases:

- five fixed BIP-39 seeds;
- mainnet, testnet3, testnet4, signet, and regtest;
- accounts 0 and 7;
- receive and change branches;
- child indices 0, 1, and `0x7fffffff`;
- BIP-44 legacy, BIP-49 nested SegWit, BIP-84 native SegWit, and BIP-86
  Taproot single-signature policies;
- BIP-48 nested and native SegWit multisig policies, each with 2-of-3 and
  3-of-5 quorums.

Legacy P2SH multisig is intentionally unsupported. The three seed-based
implementations check account keys at the serialized BIP-32 payload level,
including strict xpub/ypub/zpub/Ypub/Zpub and test-family
tpub/upub/vpub/Upub/Vpub version bytes. Bitcoin Core independently proves the
root-private-key-to-full-descriptor-path-to-output calculation; it deliberately
does not export account public metadata from its private descriptor. The
generated evidence records these scopes explicitly and records origin path,
master fingerprint, parent fingerprint, depth, child number, chain code, public
key, descriptor, address, and scriptPubKey where the verifier exposes them.
Core 29's `getdescriptorinfo` was also probed with a ranged account descriptor:
it canonicalized `root-tprv/84h/1h/0h/<0;1>/*` to a root tpub followed by the
same hardened suffix, rather than returning an account-level tpub. The literal
probe shape is locked in the provenance contract tests.

The mandatory adversarial corpus distinguishes four-way Core-derived output
evidence (reversed `sortedmulti` keys) from adapter input validation (duplicate
keys and invalid mnemonics). It separately rejects a checksum-valid extended
key containing an invalid, uncompressed public-key prefix at the verifier xpub
boundary; provenance never describes adapter-only rejection as a Core RPC
result.

## Repeatable verification

Prerequisites are a Node.js 24 bootstrap, Go 1.25.12, Docker Compose, and curl.
The verifier installs its exact Node 24.19.0 runtime from the npm lock and runs
Python 3.13.5 inside a digest-pinned, network-isolated local image. Run:

```bash
npm run verify:repeatable
```

The helper installs and executes the exact lockfile Node binary, builds the
Python verifier from the fully hashed transitive `requirements.lock`, executes
that build by immutable image ID, and checks the image-reported verifier source
digest against the checkout. It starts five Bitcoin Core services with fresh
per-run RPC credentials and a separate private identity nonce from this exact
multi-architecture image:

```text
bitcoin/bitcoin:29.0@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78
```

It checks that every RPC reports the expected chain before starting the
verifier. The default endpoints are:

| Environment | RPC URL | Core-reported chain |
| --- | --- | --- |
| mainnet | `http://<docker-host>:19440` | `main` |
| testnet3 | `http://<docker-host>:19441` | `test` |
| testnet4 | `http://<docker-host>:19442` | `testnet4` |
| signet | `http://<docker-host>:19443` | `signet` |
| regtest | `http://<docker-host>:19444` | `regtest` |

Regenerate the two fixtures with the identical stack:

```bash
npm run generate:repeatable
```

Generation writes `output/verified-vectors.ts` and
`../../server/tests/fixtures/verified-address-vectors.ts` with failure rollback
across both destinations. Verification
regenerates the complete content and requires a byte-for-byte match, including
the reproducible provenance block. There is no timestamp exception.

Use `VERIFY_ADDRESSES_KEEP_BITCOIND=1` only for local troubleshooting.

External Core RPC endpoints are deliberately unsupported. Both verification and
generation attest the exact Compose image digest, so accepting an endpoint whose
container identity cannot be inspected would create false provenance.

## Why exact consensus matters

A network substitution, wrong derivation path, wrong SLIP-132 version, Taproot
tweak error, or multisig key-ordering drift can create an address the intended
wallet cannot spend. Keeping seed-to-account and account-to-script evidence in
one locked matrix makes those failures visible before fixture or application
changes land.
