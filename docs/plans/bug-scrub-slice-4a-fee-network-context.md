# Bug Scrub Slice 4A: Fee Network Context

Slice 4A removes the fee-estimation path from the Bitcoin network-boundary allowlist.

## Contract

The fee endpoints now accept optional network context:

- `GET /api/v1/bitcoin/fees?network=...`
- `GET /api/v1/bitcoin/fees/advanced?network=...`
- `POST /api/v1/bitcoin/utils/estimate-optimal-fee` with optional `network`

Missing network preserves the existing default-mainnet contract. Legacy `testnet` request values normalize to `testnet3`. Invalid network values fail with `400` before calling mempool or Electrum services.

## Runtime Behavior

`getCurrentFeeEstimates(network)` uses the configured mempool fee estimator for that network when one is set and falls back to Electrum fee estimates for the same network. Regtest always uses Electrum because no mempool.space network exists for it.

The send page now requests fee estimates for the wallet network. Dashboard and UTXO fee hooks key React Query cache entries by network, so fee estimates cannot bleed between network tabs.

## Guardrail

`npm run check:bitcoin-network-boundaries` now passes with 14 allowed findings, down from 21. Remaining findings are non-wallet transaction lookup/broadcast contracts, advanced transaction RBF/CPFP/batch network derivation, legacy PSBT previous-transaction fetches, and subscription bootstrap.
