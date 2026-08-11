# PSBT Cross-Implementation Verification

This directory contains tools for verifying our PSBT (Partially Signed Bitcoin Transaction) implementation against multiple independent Bitcoin implementations.

## Purpose

PSBT bugs can result in **lost funds** or **stuck transactions**. This verification suite ensures our implementation matches:

1. **Bitcoin Core** - THE reference implementation
2. **bitcoinjs-lib** - Our current implementation
3. **BIP-174 Test Vectors** - Official protocol specification tests

## Quick Start

### 1. Start Bitcoin Core (for full verification)

```bash
cd scripts/verify-psbt
docker compose up -d
```

The compose file pins Bitcoin Core 29.0 by image digest. Generation fails unless
the operator explicitly attests that pinned-container mode and the exact image
from `proof-manifest.json` are in use:

```bash
export VERIFY_PSBT_CORE_PROVENANCE_MODE=pinned-container
export VERIFY_PSBT_CORE_IMAGE="$(node -p 'require("./proof-manifest.json").coreImage')"
```

### 2. Generate Extended Vectors

```bash
cd scripts/verify-psbt
npm ci --strict-allow-scripts
npm run generate
npm run generate:signed
npm run verify
```

The generator is walletless. It constructs deterministic P2WPKH,
P2SH-P2WPKH, P2TR, P2WSH, and P2SH-P2WSH PSBTs locally, then requires
Bitcoin Core `decodepsbt` and `analyzepsbt` to accept them before writing
`server/tests/fixtures/generated-psbt-vectors.ts`.

The signed-vector generator creates real regtest UTXOs with Bitcoin Core,
spends them with deterministic local software keys, finalizes the PSBTs, and
requires Core `testmempoolaccept` to accept the extracted transactions before
writing `server/tests/fixtures/generated-signed-psbt-vectors.ts`. It requires a
fresh chain at height zero, fixes block time, and mines coinbases directly to
the deterministic fixture scripts so independent clean Core instances produce
byte-identical fixtures. If the compose volume has already mined blocks, start
with a fresh disposable regtest volume before regenerating signed vectors.

Both fixture files embed the expected Core image digest, numeric version, and
subversion. The generators verify the live `getnetworkinfo` response before
writing anything. `npm run verify` fails if the fixture provenance, compose
image, required script-family rows, or signed-vector count drifts. The
always-running `verify-vectors` CI job executes this verifier and the signed
vector replay tests on pull requests, merge groups, main pushes, and schedule.
Its live pinned-Core lane regenerates both fixture files and fails if either
differs from the committed deterministic output.

### 3. Run PSBT Verification Tests

```bash
cd server
npm test -- --run tests/unit/services/bitcoin/psbt.verified.test.ts
```

## Directory Structure

```
scripts/verify-psbt/
├── docker-compose.yml      # Bitcoin Core container
├── proof-manifest.json     # Exact Core image digest and runtime identity
├── provenance.ts           # Fail-closed live runtime attestation
├── implementations/
│   ├── bitcoincore.ts     # Bitcoin Core RPC wrapper
│   └── sanctuary.ts       # Our bitcoinjs-lib wrapper
├── types.ts               # Type definitions
├── generate-vectors.ts    # Bitcoin Core-backed vector generator
├── generate-signed-vectors.ts # Funded Core-accepted signed vector generator
├── verify.ts              # Fails if generated vectors are missing or empty
└── README.md              # This file

server/tests/
├── fixtures/
│   ├── bip174-test-vectors.ts           # BIP-174 official vectors
│   ├── generated-psbt-vectors.ts        # Bitcoin Core-backed unsigned vectors
│   └── generated-signed-psbt-vectors.ts # Core-accepted signed vectors
└── unit/services/bitcoin/
    ├── psbt.verified.test.ts        # PSBT verification tests
    └── psbt.signed-vectors.test.ts  # Signed/finalized vector tests
```

## Test Categories

### BIP-174 Compliance Tests

Tests each PSBT role defined in BIP-174:

| Role | Purpose |
|------|---------|
| Creator | Creates unsigned transaction |
| Updater | Adds UTXO data, scripts, derivation paths |
| Signer | Adds partial signatures |
| Combiner | Merges multiple PSBTs |
| Finalizer | Creates final scriptSig/witness |
| Extractor | Extracts signed transaction |

### Invalid PSBT Tests

Ensures we correctly reject malformed PSBTs:

- Invalid magic bytes
- Missing required fields
- Duplicate keys
- Malformed structures

### Extended Verification Tests

Real-world scenarios verified against Bitcoin Core:

- Single-sig native SegWit (P2WPKH)
- Nested single-sig SegWit (P2SH-P2WPKH)
- Taproot key-path draft metadata (P2TR)
- Multisig SegWit (P2WSH)
- Nested multisig SegWit (P2SH-P2WSH)
- Fee calculation accuracy
- Virtual size estimation

### Signed Transaction Acceptance Tests

Funded regtest spends verified with Bitcoin Core `testmempoolaccept`:

- Legacy single-sig (P2PKH)
- Native SegWit single-sig (P2WPKH)
- Nested SegWit single-sig (P2SH-P2WPKH)
- Native SegWit sorted multisig (P2WSH)
- Nested SegWit sorted multisig (P2SH-P2WSH)

## Bitcoin Core RPC Commands

The verification uses these Bitcoin Core RPC methods:

| Command | Purpose |
|---------|---------|
| `decodepsbt` | Parse and display PSBT structure |
| `analyzepsbt` | Get fee, vsize, completion status |
| `sendtoaddress` | Fund deterministic regtest script templates |
| `generatetoaddress` | Mature and confirm regtest funding UTXOs |
| `testmempoolaccept` | Prove finalized signed transactions pass Core policy |
| `getnetworkinfo` | Confirm Bitcoin Core availability and version |

## Implementation Details

### Bitcoin Core Wrapper

Located at `implementations/bitcoincore.ts`:

- Supports CLI mode (docker exec) and direct RPC
- Handles regtest, testnet, and mainnet
- Timeout handling for hanging RPC calls

### Sanctuary Wrapper

Located at `implementations/sanctuary.ts`:

- Wraps bitcoinjs-lib Psbt class
- Provides consistent interface with Bitcoin Core wrapper
- Enables direct comparison of outputs

## Adding New Test Vectors

1. Add a deterministic draft vector in `scripts/verify-psbt/generate-vectors.ts`.
2. Run `npm run generate` with Bitcoin Core running.
3. Add a deterministic funded signed vector in `scripts/verify-psbt/generate-signed-vectors.ts` if the script family is spendable before hardware enters the loop.
4. Run `npm run generate:signed`.
5. Run `npm run verify`.
6. Run `npm --prefix ../../server run test -- --run tests/unit/services/bitcoin/psbt.verified.test.ts tests/unit/services/bitcoin/psbt.signed-vectors.test.ts`.

## Troubleshooting

### Bitcoin Core Not Starting

```bash
# Check container logs
docker compose logs bitcoin-core

# Restart container
docker compose restart bitcoin-core
```

### RPC Connection Failed

```bash
# Verify Bitcoin Core is ready
docker exec bitcoin-core bitcoin-cli -regtest getblockchaininfo
```

### Tests Failing on Valid PSBTs

1. Check that the PSBT is complete base64 (not truncated)
2. Verify against Bitcoin Core manually:
   ```bash
   docker exec bitcoin-core bitcoin-cli -regtest decodepsbt "<psbt>"
   ```
3. Check for version incompatibilities in bitcoinjs-lib

## References

- [BIP-174: PSBT](https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki)
- [BIP-370: PSBT Version 2](https://github.com/bitcoin/bips/blob/master/bip-0370.mediawiki)
- [bitcoinjs-lib PSBT](https://github.com/bitcoinjs/bitcoinjs-lib/blob/master/src/psbt.js)
- [Bitcoin Core RPC](https://developer.bitcoin.org/reference/rpc/)
