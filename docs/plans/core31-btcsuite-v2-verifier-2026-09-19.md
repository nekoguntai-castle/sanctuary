# Bitcoin Core 31.1 and btcsuite v2 verifier migration

This changes isolated verification tooling, not a production Bitcoin node or wallet data directory. Bitcoin Core 31.1 is pinned to the DockerHub manifest published July 8, 2026:

`bitcoin/bitcoin:31.1@sha256:da25cedc66b1daefff9f412ee196c901a899c3fa68a33b20849c3e08b5c40d63`

The address and PSBT manifests, workflow, repeatable helper and provenance assertions move together. No application signer or finalizer source changes are part of this migration.

## btcsuite split modules

The btcd 0.26.2 module separates the packages this verifier uses. Addresses, Hash160 and Base58 now come from address/v2; chain parameters and script construction come from chaincfg/v2 and txscript/v2. HD derivation remains in btcutil/v2. The verifier explicitly imports these APIs and selects address/chaincfg/txscript 2.0.0, btcutil 2.0.1 and btcec 2.5.0. Those releases predate the three-day cooldown.

Go's module tidy removes the no-longer-imported monolithic btcd module, obsolete chaincfg/chainhash v1 and anet. This is a migration to the packages actually used, not an ignored btcd update. x/crypto remains 0.56.0. Linux Go 1.27.1 completed tidy, readonly build and module checksum verification.

## Actual proof results

On an isolated Linux runner using the published Node 24.21.0/npm 12.0.2/Go 1.27.1 image:

- All 480 address vectors regenerated with agreement among Core 31.1, bitcoinjs-lib, Python bip_utils and the new Go implementation, covering mainnet, testnet3, testnet4, signet and regtest. Adversarial checks passed.
- Comparing all address-vector fields except verifiedBy against the previous corpus found no differences: addresses, scripts, account keys and derivation evidence are unchanged.
- All five unsigned PSBT vector data rows are unchanged except Core attribution/provenance.
- All six signed PSBT rows passed Core decode/analyze/finalize, decoded-transaction agreement and testmempoolaccept. All 67 server replay assertions passed on each of two fresh chains.
- The second fresh-chain generation produced byte-identical complete unsigned and signed fixture files to the first Core31 generation (SHA-256 comparison).
- Fifteen generated-address/provenance assertions and repeatable-helper checks passed. Workflow composition and Linux RPC readiness checks passed.

## Why signed fixture bytes changed

Core 31.1's [miner implementation](https://github.com/bitcoin/bitcoin/blob/v31.1/src/node/miner.cpp) creates coinbase inputs with MAX_SEQUENCE_NONFINAL (0xfffffffe), and sets coinbase locktime to height minus one. The previous Core29 corpus has final coinbase input sequence 0xffffffff. The generator's existing generatetoaddress funding therefore produces new funding transaction IDs, which change PSBT outpoints, signatures, finalized transactions and some signature-dependent sizes. This is expected upstream funding behavior; the generator and application signing algorithms were not changed to obtain the new values.

The old and newly generated corpora were compared before accepting this change. Constructing custom blocks solely to preserve old coinbase bytes would add unnecessary mining logic to the harness. Fresh-chain repeatability and real Core acceptance instead establish the new deterministic corpus.

## Integration and cleanup

The isolated proof used the primary branch's candidate standalone verifier manifests. Its generated address fixture is evidence only until final combined source provenance is regenerated; hashes must never be hand-edited. The final generation must include the final workflow, manifests, locks, Go source and module files.

The first local address attempt lacked an explicit Docker endpoint and selected container loopback; its bounded readiness failed and signed coordinator cleanup completed. The successful rerun used the correct host-published endpoint. All live Core proof resources use the receipt-bound cleanup coordinator. Evidence is retained under /tmp/sanctuary-npm12-evidence; final cleanup receipts and complete logs accompany the integration report.
