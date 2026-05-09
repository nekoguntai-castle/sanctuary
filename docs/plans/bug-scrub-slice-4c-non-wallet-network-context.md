# Bug Scrub Slice 4C: Non-Wallet Network Context

Date: 2026-05-08

## Scope

Slice 4C removes the final Bitcoin network-boundary allowlist entries by making non-wallet and bootstrap paths pass explicit network context before they reach node-client selection.

Covered paths:

- `/api/v1/bitcoin/transaction/{txid}`
- `/api/v1/bitcoin/broadcast`
- `/api/v1/bitcoin/transaction/{txid}/rbf-check`
- blockchain transaction detail and address monitor helpers
- real-time Electrum subscription bootstrap and active subscription-client selection

## Compatibility Contract

- Missing network input remains compatible and resolves to `mainnet`.
- Legacy `testnet` input resolves to `testnet3`.
- Invalid network input fails with `InvalidInputError` before node-client work.
- The service layer receives explicit network arguments; default node-client selection is no longer permitted by the guard.

## Result

`scripts/quality/bitcoin-network-boundary-allowlist.json` is now empty, and `npm run check:bitcoin-network-boundaries` passes with zero findings.

Remaining network-hardening work should be tracked as new findings, not allowlist debt.
