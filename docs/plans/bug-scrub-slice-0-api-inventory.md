# Bug Scrub Slice 0 API Compatibility Inventory

Date: 2026-05-08

Scope: Slice 0 of the bug scrub remediation backlog. This slice adds enforceable guardrails and records compatibility decisions. It does not change runtime transaction behavior yet.

## Compatibility Rules

- Do not tighten broadcast or network request schemas in Slice 0.
- Wallet-scoped endpoints should derive network from the authorized wallet record in later slices.
- Non-wallet Bitcoin endpoints need an explicit compatibility decision before they require `network` or move behind wallet-scoped contracts.
- Existing web/mobile-style callers remain supported until the endpoint migration is implemented and documented.

## Endpoint And Caller Inventory

| Surface | Current request contract | Current network source | Current callers | Compatibility decision |
| --- | --- | --- | --- | --- |
| `POST /api/v1/wallets/:walletId/transactions/broadcast` | `signedPsbtBase64` or `rawTxHex`; optional `recipient`, `amount`, `fee`, `utxos`, `label`, `memo` through `MobileTransactionBroadcastRequestSchema`; frontend type currently requires metadata. | Wallet route has `walletId`, but broadcast/PSBT parsing still reaches default-mainnet helpers. | `hooks/send/useBroadcast.ts`, `src/api/transactions/transactions.ts`, shared mobile request schema, OpenAPI `TransactionBroadcastRequest`. | Compatible staged change: first add optional `draftId` and derive network from wallet server-side; later tighten metadata by mode after current callers are updated. |
| `POST /api/v1/wallets/:walletId/psbt/broadcast` | `signedPsbt`, optional `label`, `memo`. | Wallet route has `walletId`, but PSBT output extraction uses default parsing. | OpenAPI `PsbtBroadcastRequest`; wallet/mobile PSBT broadcast style callers. | Compatible server-side fix: derive wallet network and parse with network. Later broadcast validation can add structured errors without changing the request body. |
| `POST /api/v1/bitcoin/broadcast` | `rawTx` only. | No request network; low-level helper defaults node client. | `src/api/bitcoin.ts` `broadcastTransaction`. | Migration required: either add explicit `network` as a breaking/versioned contract or replace UI use with wallet-scoped broadcast where wallet context exists. |
| `GET /api/v1/bitcoin/transaction/:txid` | path `txid` only. | No request network; low-level transaction lookup defaults node client. | `src/api/bitcoin.ts` `getTransactionDetails`. | Migration required: require network query for global lookups or add wallet-scoped transaction lookup for UI flows. |
| `POST /api/v1/bitcoin/transaction/:txid/rbf-check` | path `txid`; empty body. | No request network; `canReplaceTransaction(txid)` defaults node client. | `src/api/bitcoin.ts` `checkRBF`. | Migration required: prefer wallet-scoped RBF check when wallet context exists; otherwise require explicit network. |
| `POST /api/v1/bitcoin/transaction/:txid/rbf` | body has `newFeeRate`, `walletId`. | Wallet is authorized, but route passes literal `mainnet` and internal precheck omits network. | `src/api/bitcoin.ts` `createRBFTransaction`. | Compatible server-side fix: derive network from authorized wallet; no caller shape change needed unless response examples change. |
| `POST /api/v1/bitcoin/transaction/cpfp` | body has parent outpoint, target fee rate, recipient, `walletId`. | Wallet is authorized, but route passes literal `mainnet`. | `src/api/bitcoin.ts` `createCPFPTransaction`. | Compatible server-side fix: derive network from authorized wallet. |
| `POST /api/v1/bitcoin/transaction/batch` | body has recipients, fee rate, `walletId`, optional selected UTXOs. | Wallet is authorized, but route passes literal `mainnet`; legacy previous-transaction fetches also default. | `src/api/bitcoin.ts` `createBatchTransaction`; wallet send flows use wallet-scoped batch creation too. | Compatible server-side fix for network derivation; legacy PSBT previous-transaction fetch must receive wallet network. |
| `GET /api/v1/bitcoin/fees` | no query/body network. | `getCurrentFeeEstimates()` calls default fee helper. | `src/api/bitcoin.ts` `getFeeEstimates`; send page data loaders and UTXO fee/dust consumers. | Staged compatibility needed: add optional network query first or move wallet-context callers to wallet-scoped/network-scoped fee APIs; React Query keys must include network. |
| `GET /api/v1/bitcoin/fees/advanced` | no query/body network. | Advanced fee service defaults node client. | `src/api/bitcoin.ts` `getAdvancedFeeEstimates`. | Staged compatibility needed: add explicit network source and update cache keys/callers. |
| `POST /api/v1/bitcoin/utils/estimate-optimal-fee` | body has input/output counts, priority, script type; no network. | Calls advanced fee estimates without network. | `src/api/bitcoin.ts` fee helpers. | Staged compatibility needed if endpoint remains network-backed; otherwise document it as pure local calculation. |
| Electrum subscription bootstrap | config-driven service startup; no public API. | `setupRealTimeSubscriptions` calls `getNodeClient()` before using configured network state. | Worker/service bootstrap. | Internal follow-up: make the bootstrap node-client check explicit about configured network or remove the redundant default-client check. |

## Guard Baseline

`scripts/check-bitcoin-network-boundaries.mjs` scans production Bitcoin paths for default-mainnet-prone calls and hardcoded wallet-scope mainnet calls. It is wired into `npm run lint:server` through `npm run check:bitcoin-network-boundaries`.

The initial allowlist has 25 entries in `scripts/quality/bitcoin-network-boundary-allowlist.json`. Each entry names the file, function, callee, issue, reason, owner task, and target removal slice. Stale allowlist entries fail the check, so later slices must remove entries as they fix call sites.

## Slice 0 Result

- Runtime API behavior is unchanged.
- Future no-network Bitcoin I/O calls in scanned production paths fail blocking lint unless deliberately allow-listed.
- Later slices have a concrete inventory for compatibility, schema, OpenAPI, frontend caller, and cache-key changes.
