# Wallet Address And Signing Test Hardening Plan - 2026-04-30

## Position

We are ready to start execution, but not ready to claim the wallet testing posture is funds-loss-grade. The current test base is useful and broad, but the highest-value proof points need independent references and end-to-end signing validation.

Target grade: move from C+ to A-/A by making address derivation, change derivation, PSBT construction, signing, finalization, and broadcast validation provable against Bitcoin Core and at least one independent non-JS implementation.

## Principles

- Fail closed at funds-moving boundaries.
- Treat Bitcoin Core as the reference implementation wherever possible.
- Do not accept test vectors as "verified" unless the verifier proves which implementations participated.
- Prefer deterministic fixtures over broad mocks for signing-critical behavior.
- Keep mocked hardware adapter tests, but do not treat them as signing correctness proof.

## Phase 0 - Immediate Gates

Goal: stop false confidence from optional or incomplete verification.

Tasks:

- Update `.github/workflows/verify-vectors.yml` path filters to include:
  - `server/src/services/bitcoin/addressDerivation/**`
  - `server/src/services/bitcoin/descriptorParser/**`
  - `server/src/services/bitcoin/transactions/**`
  - `server/src/services/bitcoin/psbtBuilder/**`
  - signing adapter and QR/USB signing test paths.
- Change `scripts/verify-addresses/generate-vectors.ts` so a passing run requires:
  - Bitcoin Core available.
  - At least one independent non-JS implementation available, preferably Python `bip_utils` or Go/btcd.
  - bitcoinjs-lib still included as the production-library comparison.
- Make address verification fail when only bitcoinjs-lib and Caravan are available.
- Add verifier metadata assertions in checked-in fixtures so CI fails if `verifiedBy` lacks required implementations.
- Fix or remove `scripts/verify-psbt`'s broken `verify` command. A broken verification script should fail loudly in CI rather than appear available.

Acceptance criteria:

- A PR touching derivation, descriptor parsing, PSBT construction, or signing paths triggers the dedicated vector workflow.
- `npm --prefix scripts/verify-addresses run verify` fails if Bitcoin Core or the required non-JS implementation is missing.
- CI output explicitly shows the implementation set used for address verification.

Verification:

- `npm --prefix scripts/verify-addresses run typecheck`
- `npm --prefix scripts/verify-addresses run verify`
- GitHub Actions workflow dry-run/path-filter confirmation by PR or local actionlint-equivalent review.

## Phase 1 - Fail-Closed Safety Fixes

Goal: remove behaviors that let invalid or incomplete signing-critical data continue.

Tasks:

- Reject private extended keys at validation/import boundaries:
  - `xprv`, `yprv`, `zprv`, `tprv`, `uprv`, `vprv`, and multisig/private variants.
  - Replace the current test that accepts `xprv` with rejection coverage.
- Reject descriptors when a checksum is present but invalid:
  - Preserve optional no-checksum descriptors if product policy allows it.
  - Add import/parse tests proving present-and-wrong checksums fail.
- Fail closed when multisig spend PSBT construction cannot attach required metadata:
  - `bip32Derivation`
  - `witnessScript`
  - `redeemScript` for P2SH-P2WSH
  - quorum/key-path information.
- Convert current "continue when metadata is missing" tests into explicit failure tests for spend creation.
- Add explicit tests that format-only address regex helpers are never authoritative for transaction creation.

Acceptance criteria:

- Invalid descriptor checksum cannot import or derive spendable wallet state.
- Private extended keys cannot pass xpub validation or import.
- Multisig transaction creation errors before producing a PSBT if signer metadata is incomplete.
- Recipient address validation remains checksum/script-based at backend funds-moving boundaries.

Verification:

- Focused xpub validation tests.
- Descriptor checksum/import tests.
- Transaction creation multisig tests.
- Existing address/BIP verified suite.

## Phase 2 - Address Vector Expansion

Goal: make address derivation proof explicit and independent.

Tasks:

- Add explicit official BIP49, BIP84, and BIP86 address-vector tests against app derivation, not only generated vectors.
- Clarify bare P2SH multisig support:
  - If unsupported, add explicit rejection tests and remove/classify those vectors as unsupported.
  - If supported, implement address derivation and PSBT/signing tests.
- Add network-mismatch and checksum-invalid recipient tests from BIP173/BIP350 and Bitcoin Core `key_io_invalid`.
- Add fixture invariants:
  - Every checked-in vector has required independent `verifiedBy` entries.
  - Receive and change vectors exist for every supported script/network combination.
  - High-index vectors remain present.

Acceptance criteria:

- Official BIP49/BIP84/BIP86 vector tests fail if app derivation regresses.
- Unsupported script types fail explicitly, not silently by omission.
- Fixture metadata proves independent verification.

Verification:

- `npm --prefix server run test -- --run tests/unit/services/bitcoin/addressDerivation.verified.test.ts ...`
- Address vector verifier with required implementation set.

## Phase 3 - PSBT Cross-Implementation Verification

Goal: prove that PSBTs produced by Sanctuary match Bitcoin Core expectations.

Tasks:

- Implement `scripts/verify-psbt/verify.ts`.
- Generate non-empty Bitcoin Core-backed PSBT vectors for:
  - P2WPKH
  - P2SH-P2WPKH
  - P2TR key path
  - P2WSH sortedmulti
  - P2SH-P2WSH sortedmulti.
- Use Bitcoin Core RPC checks:
  - `decodepsbt`
  - `analyzepsbt`
  - `finalizepsbt` where applicable
  - `decoderawtransaction`
  - `testmempoolaccept` for extracted signed transactions.
- Store generated vectors only when Sanctuary and Bitcoin Core agree on structure, fees, vsize, inputs, outputs, and completion state.
- Add CI job that fails on vector drift or disagreement.

Acceptance criteria:

- PSBT verifier is runnable locally and in CI.
- Checked-in PSBT vectors are non-empty and include Bitcoin Core in `verifiedBy`.
- The PSBT suite covers both unsigned construction and signed/finalized transaction validation.

Verification:

- `npm --prefix scripts/verify-psbt run verify`
- Focused PSBT unit/property suites.
- Bitcoin Core regtest CI job.

## Phase 4 - End-To-End Signing Proof

Goal: prove the actual app flow can create signable transactions and verify signatures.

Tasks:

- Build deterministic end-to-end signing fixtures using known private keys and controlled UTXOs:
  - Create PSBT through `createTransaction` or batch equivalent.
  - Sign with deterministic local signer.
  - Combine multisig signatures.
  - Finalize.
  - Extract raw transaction.
  - Validate with Bitcoin Core.
- Cover:
  - Single-sig P2WPKH
  - Nested SegWit P2SH-P2WPKH
  - Taproot key path P2TR
  - 2-of-3 P2WSH sortedmulti
  - 2-of-3 P2SH-P2WSH sortedmulti.
- Add negative signing cases:
  - Wrong fingerprint.
  - Wrong derivation path.
  - Missing witness UTXO.
  - Network mismatch.
  - Invalid signature.
  - Partial multisig below quorum.
- Keep hardware adapters mocked for UI and transport behavior, but add golden payload tests for Ledger/Trezor/BitBox request construction where possible.

Acceptance criteria:

- Every supported wallet script type has at least one app-created PSBT that signs, finalizes, extracts, and passes Bitcoin Core validation.
- Invalid signatures and wrong signer metadata fail before broadcast.
- Multisig quorum behavior is proven with both insufficient and sufficient signatures.

Verification:

- End-to-end signing suite.
- PSBT verifier.
- Existing hardware adapter contract tests.

## Phase 5 - Change Address And Discovery Hardening

Goal: make receive/change semantics unambiguous and testable.

Tasks:

- Add or derive an explicit chain classification for stored addresses.
- Make all receive/change repository methods chain-aware.
- Decide policy for fallback-to-receive when no change address exists:
  - Either reject transaction creation.
  - Or allow fallback only with explicit tests and a visible policy reason.
- Fix decoy change outputs so fallback selection cannot silently use arbitrary unused addresses.
- Add tests for:
  - Receive index generation when change index is ahead.
  - Change index generation when receive index is ahead.
  - Gap-limit discovery separately for receive and change.
  - Decoy output address chain selection.

Acceptance criteria:

- Change outputs use change-chain addresses unless an explicitly tested policy says otherwise.
- Generating receive addresses does not depend on max index across both chains.
- Discovery and repository behavior agree on chain semantics.

Verification:

- Address repository tests.
- Address generation service tests.
- Transaction output builder tests.
- Sync discovery gap-limit tests.

## Phase 6 - Ongoing Assurance

Goal: keep this from regressing.

Tasks:

- Add a wallet safety CI summary that reports:
  - Address vector implementation set.
  - PSBT vector implementation set.
  - Number of official BIP vector suites run.
  - Number of end-to-end signing cases run.
- Add mutation or property tests around:
  - Change-chain parsing.
  - Descriptor checksum enforcement.
  - Private key rejection.
  - Multisig metadata completeness.
- Document the supported script-type matrix and exact standards covered.

Acceptance criteria:

- A reviewer can see, from CI output, whether funds-safety tests ran and which references were used.
- New wallet script types cannot be added without test matrix updates.

## Suggested Execution Order

1. Phase 0: CI/vector gating and PSBT verifier truthfulness.
2. Phase 1: fail-closed safety fixes.
3. Phase 3: PSBT verifier implementation.
4. Phase 4: end-to-end signing proof.
5. Phase 5: change-chain hardening.
6. Phase 2 and Phase 6 can run alongside the main work once Phase 0 is complete.

## Hardware Dependency Split

The remaining work should be split into software-only proof and hardware-in-loop proof. Software-only proof is still valuable because it validates our derivation, PSBT, signing, finalization, and broadcast-readiness logic against deterministic keys and Bitcoin Core. Hardware-in-loop proof is a separate confidence layer for physical device transports, device prompts, and vendor-specific signing behavior.

### Can Build And Test Without Hardware

- Regenerate address fixtures with Bitcoin Core plus an independent non-JS verifier, and make CI fail if either verifier is missing.
- Add official BIP49, BIP84, and BIP86 address-vector tests directly against app derivation.
- Add network-mismatch, checksum-invalid recipient, unsupported-script, receive/change, high-index, and fixture-provenance tests.
- Keep expanding Core-backed unsigned PSBT vectors and verifier drift checks.
- Build funded deterministic regtest signing/finalization vectors with local software keys:
  - P2WPKH.
  - P2SH-P2WPKH.
  - P2WSH sorted multisig.
  - P2SH-P2WSH sorted multisig.
  - P2TR only if app-level Taproot signing is in product scope.
- Run those software-signed transactions through finalization, extraction, `decoderawtransaction`, and `testmempoolaccept`.
- Add negative signing and broadcast-preflight cases:
  - Wrong fingerprint.
  - Wrong derivation path.
  - Missing witness UTXO.
  - Network mismatch.
  - Invalid signature.
  - Multisig below quorum.
  - Tampered recipient output.
  - Tampered change output.
- Harden change-chain behavior, decoy change selection, repository chain queries, and receive/change discovery tests.
- Add golden payload tests for Ledger/Trezor/BitBox request construction without connecting devices.
- Keep mocked hardware adapter UI, QR, USB, transport error, and permission tests.
- Add wallet safety CI summary and supported script-type/standards documentation.

### Requires Actual Hardware Or Hardware-In-Loop Fixtures

- Prove real Ledger, Trezor, and BitBox devices sign the app-produced PSBTs for each supported script family.
- Verify hardware-produced signatures finalize, extract, and pass Bitcoin Core validation.
- Validate device-specific address display and change-output recognition on the device screen.
- Validate multisig registration, wallet policy, cosigner ordering, and fingerprint/path handling on devices that require pre-registration.
- Validate Taproot hardware signing only if Taproot spending is supported by both the app and target devices.
- Exercise real HID/WebUSB/bridge transport flows:
  - Pairing and permission prompts.
  - Disconnect/reconnect.
  - Device locked/unlocked states.
  - Wrong app open on device.
  - Firmware/app-version compatibility edges.
- Capture vendor-specific golden signed PSBT fixtures from physical devices and replay them in normal CI as committed fixtures.

### Practical Queue

1. Finish the software-only path first: address verifier regeneration, funded regtest signing vectors, negative signing cases, and change-chain hardening.
2. Add hardware golden payload tests in parallel because they do not need devices.
3. Schedule hardware-in-loop validation as a separate gate with real devices and store the resulting signed fixtures for repeatable CI replay.

## Definition Of Done

- Address vectors require Bitcoin Core plus an independent non-JS implementation.
- PSBT verifier is real, non-empty, and CI-gated.
- End-to-end signing/finalization/Bitcoin Core validation exists for every supported script type.
- Invalid descriptors, private extended keys, missing multisig metadata, bad signatures, and network mismatches fail closed.
- Change-chain behavior is explicit, chain-scoped, and tested.
- Focused wallet safety CI passes on every PR that touches wallet derivation, import, PSBT construction, signing, or broadcast.
