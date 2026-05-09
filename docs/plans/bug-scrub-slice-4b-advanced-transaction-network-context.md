# Bug Scrub Slice 4B: Advanced Transaction Network Context

Date: 2026-05-08

## Scope

Slice 4B removes default-mainnet behavior from wallet-scoped advanced transaction creation and legacy PSBT previous-transaction fetches.

Covered paths:

- `/api/v1/bitcoin/transaction/:txid/rbf`
- `/api/v1/bitcoin/transaction/cpfp`
- `/api/v1/bitcoin/transaction/batch`
- RBF replaceability checks used during replacement creation
- Legacy single-recipient and batch PSBT raw previous-transaction fetches

## Contract

- Wallet-scoped advanced transaction creation derives the network from the authorized wallet row.
- Legacy wallet rows with `network = "testnet"` normalize to `testnet3`.
- Unsupported wallet network values fail with `InvalidInputError` before advanced transaction services or node clients are called.
- Legacy P2PKH PSBT construction fetches previous transaction hex from the same normalized wallet network used to build and validate the PSBT.

## Remaining Slice 4 Findings

The Bitcoin network-boundary guard now has 5 allowed findings:

- non-wallet raw broadcast endpoint
- non-wallet RBF check endpoint
- non-wallet transaction detail lookup
- address monitor helper
- real-time subscription bootstrap connectivity check

Those endpoints need explicit compatibility handling because they are not naturally wallet scoped.
