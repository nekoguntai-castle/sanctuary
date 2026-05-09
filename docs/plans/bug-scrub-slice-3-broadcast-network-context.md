# Bug Scrub Slice 3: Broadcast Network Context

Slice 3 removes the wallet-scoped broadcast path from the Bitcoin network-boundary allowlist.

## Contract

Wallet broadcast routes must resolve the authorized wallet network before:

- parsing signed PSBT outputs for policy evaluation,
- extracting PSBT recipient/fee/UTXO metadata for `/wallets/:walletId/psbt/broadcast`,
- submitting the final raw transaction to the configured node client.

Legacy wallet records with network `testnet` are normalized to `testnet3`. Unsupported wallet network values fail before policy evaluation or node submission.

## Compatibility

This slice does not change the walletless `POST /api/v1/bitcoin/broadcast` contract. That endpoint still has no request-level network source and remains tracked in the Slice 4 allowlist as a compatibility decision: either require an explicit network, version the contract, or route UI callers through wallet-scoped broadcast APIs.

## Guardrail

`npm run check:bitcoin-network-boundaries` now passes with 21 allowed findings, down from 25. The remaining findings are Slice 4 fee, advanced transaction, legacy PSBT previous-transaction fetch, non-wallet Bitcoin endpoint, and subscription bootstrap items.
