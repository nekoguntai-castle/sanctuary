# Trust And Verification

Date: 2026-05-09
Status: current operator-facing trust posture; do not treat as an audit report

Sanctuary's trust model is "prove what can be proven, state what remains
pending, and never ask users to trust a fund-moving shortcut." This page
summarizes what the current gates prove and how operators or reviewers can
reproduce the main evidence.

## What Sanctuary Proves Today

| Claim | Evidence |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sanctuary is a watch-only coordinator | Private keys, seed phrases, passphrases, and hardware PINs are not stored by Sanctuary; wallet state is built from descriptors, xpubs, and hardware-wallet outputs |
| Browser or API metadata is not authoritative for broadcast | Broadcast paths decode the signed PSBT or raw transaction server-side, reject metadata conflicts, and run policy before audit success, persistence, or propagation |
| Production broadcast preflight stays Electrum-only | The configured Electrum backend must witness each final input prevout and unspent state before propagation; Bitcoin Core remains lab evidence, not a runtime requirement |
| Descriptor and xpub imports fail closed on unsafe domains | Raw descriptors plus parsed JSON, BlueWallet, and Coldcard imports reject private extended keys, wrong-network keys/paths, unsupported branches, malformed multisig suffixes, quorum overflow, duplicates, and script/path mismatches |
| New safety-module catches cannot silently continue | `npm run check:safety-catch-guards` scans safety paths and fails on new non-terminal catches unless they return, throw, call an approved fail-closed helper, or update the accountable baseline |
| Stable releases have an operator verification path | Stable release manifests must cover release identity, builder evidence, signed `SHA256SUMS`, local checksums, offline bundle evidence, and subject-bound SBOM/provenance references; registry image digests remain historical evidence only |
| Unsupported hardware signing rows are product-blocked | Ledger and BitBox multisig USB signing is blocked in the send flow and adapter boundaries until physical fixture coverage exists for those device/script families |
| AI, Console, and MCP are read-only | Tool execution is authenticated and scoped; DTOs exclude private keys, descriptors, xpubs, PSBTs, bearer tokens, and provider API keys; restored MCP keys are revoked |
| Browser auth is protected against script-readable token theft | Access and refresh tokens use HttpOnly cookies, CSRF protects mutating cookie-auth requests, and WebSocket auth uses cookies instead of query tokens |

## What Is Not Yet Proven

- Full physical hardware-in-loop funds-loss-grade confidence is pending until the
  required Ledger, Trezor, and BitBox signed artifacts are captured or
  product-blocked. Trezor now has pinned Tier 2 production-adapter emulator proof,
  but it does not prove physical transport, screen rendering, or confirmation and
  does not enable any Trezor capability row.
- Physical fixture intake also remains fail-closed until a reviewed Ed25519 Core
  evidence key is provisioned. Arbitrary commit SHAs, stale source manifests,
  unsigned RPC transcripts, emulator evidence, and self-asserted acceptance
  booleans cannot satisfy Tier 3.
- Sanctuary has not completed a formal independent security audit.
- A public responsible-disclosure or bug-bounty process is not yet published.
- Target-environment performance claims require a benchmark rerun on the
  operator's actual non-production topology.
- Optional Bitcoin Core descriptor and `testmempoolaccept` checks are release-lab
  evidence while Sanctuary remains Electrum-only at runtime.
- The legacy safety-catch baseline still needs reduction and typed error taxonomy
  expansion.

## Operator Verification Commands

Run the smallest command set that matches the claim being reviewed.

| Area | Command |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release artifact manifest | `npm run release:verify-artifacts -- --manifest release-manifest.json --strict-stable --public-key scripts/offline/keys/sanctuary-offline-release-public.pem` |
| Release verifier tests | `npm run test:release-artifacts` |
| Broadcast canonicality and Electrum preflight | `npm --prefix server run test -- --run tests/unit/api/transactions-http-routes.test.ts tests/unit/services/bitcoin/transactionServiceBroadcast/broadcastContracts.test.ts tests/unit/services/bitcoin/blockchain/broadcastPreflight.test.ts tests/unit/services/bitcoin/industry/broadcastSafety.test.ts tests/unit/services/bitcoin/validationEvidenceContracts.test.ts` |
| Critical mutation gate | `npm --prefix server run test:mutation:critical:gate` |
| Descriptor/xpub import safety | `npm --prefix server run test -- --run tests/unit/services/bitcoin/descriptorParser.test.ts` |
| Safety catch guard | `npm run check:safety-catch-guards` |
| Hardware fixture replay | `REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts` |
| Trezor pinned Connect core/Bridge emulator proof | `npm run test:trezor-emulator-proof`                                                                                                                                                                                                                                                                                                                                      |
| Trezor physical-fixture completeness          | `REQUIRE_TREZOR_PHYSICAL_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts` (expected to fail until reviewed physical artifacts land)                                                                                                                                                                     |
| Ledger pinned Bitcoin-app/Speculos emulator proof | `npm run test:ledger-emulator-proof` |
| Ledger physical-fixture completeness | `REQUIRE_LEDGER_PHYSICAL_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts` (expected to fail until reviewed physical artifacts land) |
| Hardware unsupported-row product blocks | `npm run test:run -- tests/services/hardwareWallet.signingSupport.test.ts tests/hooks/useUsbSigning.test.tsx tests/services/hardwareWallet.ledgerAdapter.test.ts tests/services/hardwareWallet.bitboxAdapter.test.ts` |
| Address vectors | `npm --prefix scripts/verify-addresses run verify` |
| Docs links and Mermaid rewrite tests | `npm run test:run -- tests/docs/readme-links.test.ts tests/docs/remarkMermaidClickRewrite.test.ts` |

The hardware fixture replay command is expected to remain a pending full gate
until physical artifacts are captured or the unsupported rows are product-blocked
as described in [Hardware Wallet Validation](hardware-wallet-validation.md).

## Spend Verification Rules

Before approving a transaction, the operator still has to verify the hardware
wallet screen. Sanctuary's server-side checks reduce software and API risk, but
the hardware display is the final human-verifiable boundary.

- The recipient address and amount on the device must match the intended payment.
- The fee must be acceptable for the operator's policy.
- Any displayed change or wallet-policy information must match the expected
  wallet.
- Any mismatch is a release blocker for validation work and a user blocker for
  real spending.

## What Sanctuary Refuses To Do

- No default production mode that disables authentication.
- No hot-wallet private-key custody.
- No blind raw broadcast or metadata-authoritative broadcast.
- No AI-initiated signing, policy approval, wallet mutation, or broadcast.
- No public unauthenticated MCP endpoint.
- No stable release promotion without the required manifest and verification
  evidence.
- No hardware signing claim beyond the rows with replayable physical evidence or
  explicit product blocks.

## Where To Read More

- [Wallet Threat Model](wallet-threat-model.md)
- [Release Gates](release-gates.md)
- [External Review Package](external-review-package.md)
- [Hardware Wallet Validation](hardware-wallet-validation.md)
- [Offline Bundles](offline-bundles.md)
- [AI Settings, Sanctuary Console, And MCP Access](../how-to/ai-mcp-console.md)
