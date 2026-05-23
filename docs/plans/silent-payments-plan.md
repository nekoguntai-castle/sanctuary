# Silent Payments Implementation Plan

Status: proposed plan.

Date: 2026-05-22.

Goal: add BIP352 Silent Payments support in a way that matches Sparrow's current architecture: Sanctuary connects to a Silent Payments capable Electrum endpoint for discovery, keeps the spending keys on hardware wallets, and treats the scan key as privacy-sensitive watch-only material.

## Acceptance Criteria

- Existing BIP32 wallets continue to sync, subscribe, send, and classify transactions without behavior changes when `FEATURE_EXP_SILENT_PAYMENTS=false`.
- A feature-flagged receive-only Silent Payments wallet can import scan material, subscribe through a Frigate-compatible Electrum endpoint, discover historical and live payments, verify discovered outputs locally, and expose the resulting transactions and UTXOs in normal wallet views.
- The first implementation does not allow spending discovered Silent Payment UTXOs or sending to Silent Payment recipients until BIP376 and BIP375 signer/PSBT compatibility gates pass.
- Scan private keys, spend public keys, descriptors, and Silent Payment addresses are redacted from logs, support packages, and telemetry by default.
- Operator health checks fail clearly when the connected Electrum endpoint does not advertise Silent Payments support.
- Silent Payments scanning only acquires connections from a homogeneous feature-scoped pool whose enabled members all satisfy the required `silent_payments_v0` capability for the wallet network.

## Current Findings

- Sanctuary already has an `experimental.silentPayments` feature flag, but no BIP352 implementation is wired behind it.
- The current node client is ordinary Electrum scripthash based sync. It supports address history, UTXOs, transaction fetch, broadcast, fee estimates, header subscriptions, and scripthash subscriptions. It does not have `server.features` capability probing or Silent Payments RPCs.
- Wallet sync is address-table driven. Address discovery assumes BIP32 receive/change paths and a gap limit. Silent Payments discovery is different: the static address does not enumerate BIP32 receive paths; it discovers one-time Taproot outputs by scanning eligible transactions.
- The schema stores `Address.derivationPath` as required and uses `Address` rows to classify wallet transactions and UTXOs. Silent Payments need additional metadata: scan key, spend public key, labels, discovered output tweak, and a one-time output script/address for each found payment.
- Transaction construction currently requires a concrete Bitcoin output address before signing. Sending to an `sp1...`/`tsp1...` Silent Payment address needs BIP375 PSBT fields because the final output script depends on signer-side ECDH shares from the selected inputs.
- Spending a discovered Silent Payment UTXO needs BIP376 PSBT input fields so the signer can apply and verify the stored Silent Payment tweak.
- Normal electrs, Fulcrum, or ElectrumX alone are not enough for Sparrow-like receive support. Sparrow's current server-side discovery path is Frigate in front of a normal Electrum backend.

## External Requirements

Use a self-hosted Frigate topology for receive support:

1. Bitcoin Core 28+ with `txindex=1`.
2. Bitcoin Core ZMQ sequence publisher, for example `-zmqpubsequence=tcp://127.0.0.1:28336`.
3. A normal Electrum backend such as Fulcrum, electrs, or ElectrumX bound to a non-conflicting local port such as `60001`.
4. Frigate bound on the Electrum-facing port, usually `50001` TCP or `50002` TLS.
5. Frigate configured with:
   - `[core].zmqSequenceEndpoint = "tcp://127.0.0.1:28336"`
   - `[server].backendElectrumServer = "tcp://127.0.0.1:60001"`
   - TLS material if Sanctuary connects across a network.
6. Sanctuary connects to Frigate, not directly to the backend Electrum server, when Silent Payments is enabled for that network.

Frigate's ZMQ sequence integration is strongly recommended by Frigate when a backend Electrum server is configured. Sanctuary should treat it as required for the supported topology because otherwise backend scripthash notifications can race ahead of Silent Payments notifications and briefly produce incorrect wallet amounts.

Frigate should be treated as an optional external dependency first. Do not bundle it into the production compose path until release packaging and operational expectations are stable enough for Sanctuary's release gates.

## Architecture Decision

Add Silent Payments as a feature-flagged wallet account mode, not as a replacement for existing BIP32 address sync.

The implementation should have three separable layers:

- `silentPayments/keys`: parsing, validating, and storing BIP352/BIP392 scan/spend material.
- `silentPayments/scanner`: Frigate Electrum RPC subscription, notification handling, local verification, and discovered-output persistence.
- `silentPayments/psbt`: BIP375 send-to-silent-payment output support and BIP376 spend-discovered-output input support.

Receiving should land before sending. The user's Electrum server concern is about discovery of incoming payments, and receive-only support exercises the Frigate topology, scan-key handling, output discovery, sync state, and reorg behavior before we add signer-specific PSBT behavior.

First-slice non-goals:

- no public scanner service bundled or recommended by default;
- no production compose profile for Frigate until operational gates are proven;
- no send-to-`sp1...` flow;
- no spending of discovered Silent Payment UTXOs;
- no Sanctuary-generated hot spend keys.

Resolved first-slice decisions:

- Sanctuary may persist scan private keys only as encrypted server-side watch-only material, behind the experimental feature flag and redaction rules. Plaintext scan keys must never be logged, exported, or included in support packages.
- Use `Address.source` plus nullable `derivationPath` for wallet-owned outputs. `derivationPath` is BIP32-only metadata, not a generic ownership marker.
- Frigate remains an external documented prerequisite for the first receive-only implementation. No production compose profile should ship until the receive-only slice is stable.
- Sanctuary imports Silent Payments key material only. It does not generate Silent Payment scan/spend keys in the first slice.
- Spending discovered Silent Payment UTXOs remains disabled until hardware signer compatibility is proven with BIP376 tests. No hardware vendor should be assumed compatible before that gate passes.

Deferred post-receive gates:

- decide whether an optional Frigate compose profile is worth shipping after the receive-only implementation proves stable;
- decide whether a broader owned-script/output registry should replace `Address.source` after Silent Payments and other non-BIP32 ownership paths are better understood;
- build the hardware wallet compatibility matrix before starting BIP376 spend support.

## Data Model

Add a wallet-scoped Silent Payments account table:

- `SilentPaymentAccount`
  - `id`
  - `walletId`
  - `network`
  - `address` (`sp1...` or `tsp1...`)
  - `descriptor` (`sp(spscan...)` where available)
  - `scanPrivateKeyEncrypted`
  - `spendPublicKey`
  - `labels` as `Int[]`, initially `[]` for requested extra labels; the scanner must still treat change label `0` as included by the server
  - `startHeight`
  - `lastCompleteScanHeight`
  - `lastSubscriptionStatus`
  - `lastError`
  - timestamps

Add discovered-output metadata:

- `SilentPaymentOutput`
  - `id`
  - `walletId`
  - `silentPaymentAccountId`
  - `txid`
  - `vout`
  - `derivedAddress`
  - `scriptPubKey`
  - `amount`
  - `blockHeight`
  - `label`
  - `tweak` as the BIP376 32-byte raw tweak needed to spend this output later
  - `tweakKey` as the Frigate-provided compressed transaction tweak key used for discovery verification
  - `status` (`unspent`, `spent`, `reorged`)
  - optional `addressId`
  - optional `utxoId`
  - timestamps
  - unique `[walletId, txid, vout]`

Add an `Address.source` enum-like string (`bip32`, `silent_payment`) and make `derivationPath` nullable or explicitly valid only for `bip32`. That prevents one-time Silent Payment outputs from polluting gap-limit receive/change logic. The migration must update repository and UI serializers that currently assume every `Address` row has a BIP32 path. Tests must prove `ensureGapLimit`, change-address lookup, receive-address lookup, and address-chain pagination ignore `source = silent_payment` rows. Do not use a reserved derivation-path prefix for the first implementation; if this migration proves too broad, stop and re-plan instead of encoding Silent Payments ownership into fake BIP32 paths.

## Implementation Phases

### Phase 1: Capability And Configuration

- Add Electrum `server.features` support and a typed capability model.
- Detect Frigate/Silent Payments support without relying only on server banner strings. A compatible server should expose `silent_payments: [0]` in `server.features`.
- Extend node configuration with per-network `silentPaymentsMode`: `disabled`, `feature_pool`, `dedicated_frigate`.
- Prefer a dedicated per-network Silent Payments endpoint in config, pointing at Frigate or an equivalent BIP352-aware Electrum front-end. If the ordinary server list is reused, Silent Payments scanning must still acquire from a feature-scoped homogeneous pool, never from the broad network pool.
- Keep ordinary node capability checks path-compatible with both singleton and pool mode. If capability checks are cached on `ElectrumServer`, they must be invalidated when host, port, TLS, or proxy settings change.
- Add admin UI copy that clearly says Silent Payments receive requires Frigate or an equivalent BIP352-capable Electrum extension.
- Add health status for Frigate readiness, including "index not at tip yet" when detectable.

Readiness gate contract:

- Add a server-owned readiness service such as `getSilentPaymentReadiness(network)` and use it from both API endpoints and UI queries. The UI must not decide readiness by string matching host names, ports, or banners.
- The readiness result should include:
  - feature flag state;
  - per-network Silent Payments mode;
  - endpoint connection state;
  - network identity match;
  - parsed `server.features`;
  - advertised Silent Payments versions;
  - whether version `0` is supported;
  - feature-scoped pool key, healthy compatible member count, excluded member count, and exclusion reasons;
  - last capability check time and stale/unknown status;
  - scanner/indexing status once an account has subscribed;
  - machine-readable reason codes.
- Gate new Silent Payments setup/receive UI on `featureEnabled && mode !== "disabled" && connected && networkMatches && supportsSilentPaymentsV0 && featurePoolHealthy`. `featurePoolHealthy` means the scoped Silent Payments pool has at least one healthy compatible member, all required capability checks are fresh, and every member admitted to that scoped pool satisfies `silent_payments_v0`.
- Existing imported Silent Payments accounts should remain visible when readiness becomes degraded, but copy/receive and rescan controls should show the degraded status and avoid implying new payments will be discovered immediately.
- Server endpoints that import scan material, start scans, rescan, or return receive readiness must call the same readiness service and fail closed with typed configuration errors when the endpoint is absent, unsupported, stale, wrong-network, or unavailable.
- Do not run capability probes that submit a real scan private key. Use `server.version`, normal Electrum height/header checks, network identity checks, and `server.features` for preflight. Use `blockchain.silentpayments.subscribe` only when an imported account intentionally starts scanning.

Feature-parity pool plan:

- Extend the existing per-network pool registry into a feature-scoped pool registry. The current runtime already has per-network pool instances; add a second dimension so callers acquire by `(network, requiredFeatures, usage)`.
- Define a shared capability vocabulary:
  - `base_electrum`: connection, `server.version`, block height, headers, transaction get, scripthash calls;
  - `verbose_tx`: existing verbose transaction support;
  - `silent_payments_v0`: `server.features.silent_payments` includes `0`;
  - future capabilities should be added as named feature flags rather than inferred from banner strings.
- Add a normalized capability profile for every `ElectrumServer`:
  - parsed `server.features` JSON;
  - `serverVersion`;
  - `protocolVersion`;
  - `supportsVerbose`;
  - `silentPaymentVersions`;
  - `supportsSilentPaymentsV0`;
  - `capabilityProfileKey`;
  - `lastCapabilityCheck`;
  - `lastCapabilityError`.
- Keep a small indexed boolean for routing-critical capabilities such as `supportsSilentPaymentsV0`, while storing the full normalized profile as JSON for diagnostics and future feature gates.
- Add a migration for routing and diagnostics fields: `serverUsage`, `serverFeatures`, `serverVersion`, `protocolVersion`, `silentPaymentVersions`, `supportsSilentPaymentsV0`, `capabilityProfileKey`, and `lastCapabilityError`. Index the fields used by pool construction, at minimum network, enabled state, usage, and `supportsSilentPaymentsV0`.
- Migration defaults must be backward compatible: existing Electrum servers get `serverUsage = general`, capability fields start as unknown/null, and ordinary wallet sync routing behaves exactly as before until a server is explicitly marked `silent_payments` or `both`.
- Add a server usage/purpose field with values such as `general`, `silent_payments`, and `both`. A dedicated Frigate endpoint should default to `silent_payments`; a known BIP352-capable endpoint that operators also want for ordinary wallet sync can be marked `both`.
- Store dedicated Frigate endpoints in the existing `ElectrumServer` list with `serverUsage = silent_payments` instead of adding a parallel singleton configuration surface. This keeps health checks, duplicate detection, proxy handling, and priority ordering in one model.
- Pool construction rules:
  - general wallet sync pool: network match, enabled, usage `general` or `both`, base Electrum healthy;
  - verbose-required pool: same network and usage rules, plus `supportsVerbose = true`;
  - Silent Payments pool: same network, enabled, usage `silent_payments` or `both`, and `supportsSilentPaymentsV0 = true`;
  - unknown, stale, malformed, or incompatible capability profiles are excluded from feature-required pools until re-probed.
- A mixed configured server list is allowed, but no feature-specific operation may use a mixed pool. The registry must build a separate homogeneous pool for each required feature set, or fail closed if no compatible members exist.
- Add APIs like `getElectrumPoolForNetworkAndFeatures(network, requiredFeatures)` and `getSubscriptionConnectionForFeatures(network, requiredFeatures)`. Silent Payments scanning must use the `silent_payments_v0` subscription connection, not the ordinary network subscription connection.
- Pool keys should be deterministic, for example `mainnet|general|base_electrum` and `mainnet|silent_payments|base_electrum+silent_payments_v0`, so config reloads and metrics are easy to reason about.
- Capability checks should run:
  - when a server is added;
  - when a saved server is manually tested;
  - when host, port, TLS, network, proxy-affecting config, or usage changes;
  - on a slow background refresh interval with stale profiles marked unknown/degraded before they are trusted for feature pools.
- Define a single capability staleness policy, for example `capabilityStaleAfterMs`, with test override support. Stale capability profiles may remain visible for diagnostics, but must not admit servers into feature-required pools.
- Saved-server manual tests must pass the server's network into the node test path before persisting capability results. The current saved-server test path only passes host, port, and TLS, so this must be corrected before network identity results are trusted.
- Editing host, port, TLS, network, usage, or proxy-affecting settings must clear cached capability fields before the next probe. Existing `supportsVerbose`/`lastCapabilityCheck` behavior should be migrated into the normalized profile rather than leaving old booleans stale.
- Config reload must reset only affected scoped pools when possible. Changing one signet Silent Payments endpoint should not reset mainnet general sync connections.
- Replace the current reload behavior that only refreshes the legacy pool instance with scoped registry invalidation for all affected network/feature pools. This prevents stale per-network pools from continuing to route to removed or reclassified servers.
- Metrics and support packages should report pool health by network and feature profile without exposing scan keys or Silent Payment addresses.
- UI should show the pool partition explicitly: normal Electrum servers, Silent Payments-capable servers, capability unknown, and incompatible servers. The Silent Payments setup button should be enabled when the Silent Payments feature pool has at least one healthy member and no required capability is stale.

Migration and backout safety:

- The pool/capability migration must be additive and nullable except for backward-compatible defaults. Rolling the feature off should require only `FEATURE_EXP_SILENT_PAYMENTS=false` or `silentPaymentsMode = disabled`; ordinary Electrum sync should continue to use the general pool.
- If scoped routing causes production issues, the backout path is to disable Silent Payments mode, clear scoped pool instances, and leave existing general pools active. Do not require dropping capability columns or deleting server rows as the first rollback step.
- Existing servers marked `general` must not be excluded from ordinary sync because their Silent Payments capability is missing, stale, or incompatible.

### Phase 2: Key And Descriptor Support

- Add shared/server validators for `sp1...`, `tsp1...`, `spscan...`, `tspscan...`, `spspend...`, and `tspspend...`.
- Add BIP392 `sp()` descriptor parsing sufficient for watch-only import. Treat BIP392 as draft material and re-check the current BIP text before implementation begins.
- Store scan private keys encrypted with the existing secret-encryption utility.
- Extend the existing redaction utility and support-package collectors for Silent Payments-specific field names: `scanPrivateKey`, `scanPrivateKeyEncrypted`, `spendPrivateKey`, `spendPublicKey`, `spscan`, `spspend`, `silentPaymentAddress`, and `silentPaymentDescriptor`.
- Redact scan keys, spend keys, descriptors, and Silent Payment addresses from support packages and logs unless explicitly marked safe.
- Add wallet import flow for watch-only `sp(spscan...)` or separate scan private key plus spend public key.
- Do not add Sanctuary-generated Silent Payments key material in this phase. Import only.

### Phase 3: Receive Scanner

- Add `blockchain.silentpayments.subscribe(scan_private_key, spend_public_key, start, labels)` and unsubscribe methods to the Electrum client.
- Add Zod schemas for `server.features`, Silent Payments subscription results, and notification payloads. Invalid server responses must fail closed.
- Extend `dataHandler` to route `blockchain.silentpayments.subscribe` notifications without breaking existing header and scripthash notifications.
- Add a long-lived scanner service in the worker. Do not reuse the current single configured-network subscription lock as-is; Silent Payments scanner ownership must be per network so mainnet, testnet3, testnet4, signet, and regtest wallets cannot cross-wire notifications.
- Treat the returned `start_height` from the subscription response as authoritative. The server can widen an existing subscription instead of accepting the requested start.
- On notification:
  - buffer historical results until `progress = 1.0`;
  - flush buffered historical results on every `progress = 1.0` notification;
  - handle empty `history` progress notifications without changing wallet state;
  - fetch each transaction with `blockchain.transaction.get`;
  - locally verify that a tx output belongs to the account using BIP352 rules and the returned `tweak_key`;
  - persist `SilentPaymentOutput`;
  - register the one-time Taproot output as wallet-owned;
  - subscribe to its scripthash so ordinary confirmation and spend tracking still flows through the existing sync model.
- Resubscribe from `lastCompleteScanHeight - 100` after reconnects to cover reorgs.
- Fail closed when the server announces a tx but local verification cannot prove ownership.

### Phase 4: Sync Integration

- Teach the sync pipeline to merge Silent Payment discovered outputs into `Transaction`, `TransactionOutput`, and `UTXO` records without relying on gap-limit discovery.
- Keep ordinary BIP32 address sync unchanged for existing wallets.
- Update UTXO selection to include spendable Silent Payment outputs only when their tweak metadata exists.
- Update labels and transaction detail views so users can tell an output was discovered through Silent Payments without exposing scan-key material.

### Phase 5: Spend Discovered Outputs

- Add BIP376 fields to PSBT inputs that spend Silent Payment outputs:
  - `PSBT_IN_SP_TWEAK`
  - `PSBT_IN_SP_SPEND_BIP32_DERIVATION` when derivation is known.
- Verify hardware adapters preserve or intentionally consume these fields through QR, file, USB, and browser signing flows. Pass-through PSBT signers such as Jade-style flows can preserve fields; adapters that convert PSBTs into vendor transaction payloads, such as Trezor-style flows, need explicit Silent Payments payload support or must be marked unsupported.
- Add compatibility gates per hardware vendor. If a device cannot sign BIP376 Silent Payment spends, hide or disable those UTXOs for that signing route with a clear error.
- Finalization must reject Silent Payment inputs if the signature does not match the tweaked Taproot output key.

### Phase 6: Send To Silent Payment Addresses

- Add address parsing for `sp1...` and `tsp1...` to frontend and backend validation.
- Verify whether `bitcoinjs-lib` can construct and serialize the required PSBTv2 Silent Payments fields. If not, add a small PSBTv2 field-preserving layer or keep sending disabled.
- Convert a Silent Payment recipient into BIP375 PSBTv2 output fields instead of an immediate concrete output address.
- Freeze the selected input set before signing. If RBF, coin selection, fee bumping, or policy review changes inputs, re-run Silent Payment output construction.
- Require `SIGHASH_ALL` for BIP375 Silent Payment PSBTs. Do not rely on Taproot `SIGHASH_DEFAULT` for this path.
- Disable or explicitly revalidate interactions with Payjoin, batch outputs, decoy change, and raw-transaction policy evaluation until each path has BIP375-specific tests.

### Phase 7: UI And Operator Experience

UI principle: the first release is receive-only and watch-only. Do not present Silent Payments as a normal generated-address chain, and do not expose spend or send-to-`sp1...` controls until the BIP376 and BIP375 phases pass.

Feature gating and entry points:

- Hide all Silent Payments UI unless `FEATURE_EXP_SILENT_PAYMENTS=true`.
- In wallet detail, prefer integrating into the existing `Addresses` tab before adding a new top-level tab. The current wallet detail surface already routes `addresses`, `utxos`, transactions, receive modal state, and wallet settings through `components/WalletDetail`.
- Add a separate `silentPayments` query key and API client surface instead of overloading ordinary address queries. Silent Payment account state is not paginated BIP32 address state.
- Treat `Address.source = silent_payment` rows as discovered one-time owned outputs. They should be visible as wallet-owned outputs, but excluded from receive/change sub-tab counts, gap-limit address generation, and consolidation destination dropdowns unless explicitly supported.

Admin and operator UI:

- Extend `NodeConfig` / `NetworkConnectionCard` with a per-network Silent Payments capability row:
  - mode: `disabled`, `feature_pool`, or `dedicated_frigate`;
  - endpoint capability: unsupported, supported, unknown, or error;
  - advertised versions from `server.features.silent_payments`;
  - last capability check time;
  - initial index readiness when Frigate exposes it.
- Extend each Electrum server row with a compact capability badge when health checks have probed `server.features`.
- Add a dashboard/node status detail that distinguishes "Electrum connected" from "Silent Payments capable" so a normal server is not shown as ready for Silent Payments receive.
- Add operator documentation for the Frigate topology, including Bitcoin Core `txindex=1`, ZMQ sequence, backend Electrum port separation, TLS, and initial index readiness.
- Add a hard warning when the configured endpoint appears public or remote without TLS/proxy expectations. Public Silent Payments scanners are a privacy leak because the scan private key reveals incoming payment discovery.

Wallet setup/import UI:

- Extend the import flow with a Silent Payments watch-only option after descriptor validation supports BIP392. Supported import forms should be:
  - BIP392 `sp(spscan...)` descriptor;
  - separate scan private key plus spend public key;
  - optional scan start height.
- Keep hardware wallet spend-key custody explicit. The UI should say the scan key can discover payments but cannot spend funds; it should not ask for or generate a spend private key in the first slice.
- Add validation states for wrong network, unsupported descriptor, missing scan key, missing spend public key, and feature-disabled server response.
- After import, route to the wallet `Addresses` tab with the Silent Payments section expanded and scanner status visible.

Wallet receive UI:

- Add a `SilentPaymentReceiveCard` in the `Addresses` tab that shows the static `sp1...` or `tsp1...` address, QR code, copy button, network badge, optional label controls, and scanner status.
- The card should not use "Generate Address" language. Silent Payment receive addresses are static; newly received outputs are discovered by scanning.
- Reuse the receive modal only after it can cleanly choose between standard BIP32 receive addresses and the Silent Payment address. The initial receive modal can show a segmented receive-source control: standard address vs Silent Payment, with Payjoin hidden for Silent Payment.
- Keep static Silent Payment address and discovered one-time Taproot output display separate. The static address is what the user shares; the one-time derived address/script is what Sanctuary owns and tracks after discovery.

Wallet address and output lists:

- Update `AddressesTab` splitting so `source = silent_payment` rows do not fall into normal receive/change buckets by virtue of `isChange=false` or a missing derivation path.
- Add a Silent Payments outputs table or section for discovered one-time outputs: amount, status, txid/vout, label, block height, and verification status. Do not display scan keys, spend public keys, descriptors, raw tweaks, or Frigate tweak keys.
- Add a source badge in address/UTXO/transaction rows for discovered Silent Payment outputs.
- In the UTXO tab, show Silent Payment UTXOs but disable send-selection until BIP376 spending is supported for the selected signing route.
- Transaction detail views should show "discovered by Silent Payments" and the label, without exposing scanner material.

Send UI:

- In the receive-only slice, frontend and backend address validation may recognize `sp1...` and `tsp1...`, but the send wizard must reject them with a specific disabled-feature error. Do not let them fall through to generic "Invalid Bitcoin address" if parsing can identify them.
- When BIP375 support is implemented, extend `OutputEntry` with recipient type (`standard`, `silent_payment`) instead of forcing every recipient into a concrete script address.
- Disable or revalidate Payjoin, decoy change, batch outputs, RBF mutation, and send-max behavior for Silent Payment recipients until each has BIP375-specific tests.
- QR scanning should accept Silent Payment addresses and BIP21 payloads only after the send path has a safe disabled-state or implemented BIP375 flow.

Client API and query shape:

- Add `src/api/silentPayments.ts` or a `wallets` sub-client with:
  - `getSilentPaymentAccounts(walletId)`;
  - `importSilentPaymentAccount(walletId, input)`;
  - `getSilentPaymentStatus(walletId)`;
  - `rescanSilentPayments(walletId, startHeight)`;
  - `getSilentPaymentOutputs(walletId, params)`.
- Add React Query keys under `walletKeys.silentPayments(id)` and invalidate wallet balance, transactions, UTXOs, and Silent Payments queries when scanner notifications discover or update outputs.
- Extend shared/frontend Bitcoin address helpers with Silent Payment address detection while keeping normal output-address validation distinct from send-enabled validation.

Recommended component seams:

- `components/WalletDetail/tabs/AddressesTab/SilentPaymentReceiveCard.tsx`
- `components/WalletDetail/tabs/AddressesTab/SilentPaymentStatusPanel.tsx`
- `components/WalletDetail/tabs/AddressesTab/SilentPaymentOutputsTable.tsx`
- `components/WalletDetail/modals/ReceiveSourceSelector.tsx` if the receive modal is extended.
- `components/ImportWallet/steps/SilentPaymentImport.tsx`
- `components/NodeConfig/SilentPaymentCapabilityPanel.tsx`
- `components/UTXOList/UTXORow/SilentPaymentSourceBadge.tsx`

### Phase 8: Verification

- Unit tests:
  - BIP352 address parsing and output verification against official vectors.
  - BIP392 descriptor parsing.
  - Electrum Silent Payments request and notification parsing.
  - Reorg resubscribe window calculations.
  - Redaction of scan-key-bearing data.
- Service tests:
  - `server.features` detects `silent_payments: [0]` and rejects absent or unsupported versions.
  - Feature-scoped pool construction excludes incompatible, unknown, stale, disabled, wrong-network, and wrong-usage servers.
  - Silent Payments scanner acquisition uses the `silent_payments_v0` pool and never the broad network pool.
  - Mixed server lists route ordinary sync through the general pool while Silent Payments fail closed unless a homogeneous compatible feature pool exists.
  - Saved-server manual tests persist capability results using the server's network, and server edits clear stale capability profiles.
  - Scoped pool reload invalidates only affected network/feature pools after server add, edit, delete, priority, usage, or capability changes.
  - Migration defaults keep existing servers in `general` usage with unknown Silent Payments capabilities and do not change ordinary sync behavior.
  - Disabling `FEATURE_EXP_SILENT_PAYMENTS` or setting Silent Payments mode to `disabled` leaves ordinary Electrum sync usable and prevents Silent Payments setup/scan endpoints from starting work.
  - Frigate notification creates exactly one discovered output and idempotently ignores duplicates.
  - Out-of-order notifications, empty progress notifications, repeated `progress = 1.0`, and reconnect resubscribe windows are handled deterministically.
  - Locally unverified Frigate results do not create UTXOs.
  - Discovered outputs enter wallet balance and transaction history.
  - Spending a Silent Payment UTXO adds BIP376 fields.
  - Sending to `sp1...` adds BIP375 fields and rejects unsafe mutation after signing starts.
- Integration tests:
  - Regtest or signet Frigate fixture for historical scan, live mempool discovery, confirmation, spend, reconnect, and reorg.
  - Hardware adapter preservation tests for PSBT unknown/standard fields.
- Release gates:
  - focused server tests;
  - app/test/server typechecks;
  - lint;
  - lizard on touched logic;
  - `git diff --check`;
  - manual operator smoke against a self-hosted Frigate endpoint before enabling beyond experimental.

## Rollout

1. Keep `FEATURE_EXP_SILENT_PAYMENTS=false` by default.
2. Land receive-only watch-only support first, requiring self-hosted Frigate as an external documented prerequisite.
3. Add spending of discovered outputs only after BIP376 signer compatibility is proven.
4. Add sending to Silent Payment addresses after BIP375 PSBT and hardware-device behavior is proven.
5. Only consider enabling by default after at least one release cycle with successful Frigate receive, spend, and send smoke tests.

## Deferred Decisions

- Whether to ship an optional Frigate compose profile after receive-only support proves stable.
- Whether to replace `Address.source` with a broader owned-script/output registry after the first implementation.
- Which hardware wallets in Sanctuary's supported set can sign BIP376 Silent Payment spends.

## Primary References

- BIP352 Silent Payments: https://bips.dev/352/
- BIP375 Sending Silent Payments with PSBTs: https://bips.dev/375/
- BIP376 Spending Silent Payment outputs with PSBTs: https://bips.dev/376/
- BIP392 Silent Payment Output Script Descriptors: https://bips.dev/392/
- Frigate Electrum Server: https://github.com/sparrowwallet/frigate
- Sparrow 2.4.0 release notes: https://github.com/sparrowwallet/sparrow/releases/tag/2.4.0
