# Wallet Address And Signing Test Research - 2026-04-30

## Verdict

Sanctuary has a strong foundation for Bitcoin address and signing-related tests, but it is not yet at the confidence level I would want for the app's main funds-loss risk. The biggest issue is not a lack of local tests; it is that the most important cross-implementation checks are optional, incomplete, or currently satisfied by only two JavaScript-adjacent implementations.

Current coverage is good for deterministic address derivation, descriptor parsing shape, BIP-level library behavior, and mocked hardware signing flows. The gaps are concentrated around independent reference enforcement, end-to-end PSBT signing/finalization/broadcast validation, descriptor checksum fail-closed behavior, private extended key rejection, and change-chain policy.

## Standards Baseline

The relevant industry standards and reference vectors for this risk area are:

- BIP32: HD extended key and child public derivation rules, including hardened derivation limits. Source: https://bips.dev/32/
- BIP39: mnemonic-to-seed PBKDF2-HMAC-SHA512 rules and official test vectors. Source: https://bips.dev/39/
- BIP44: account path `m / purpose' / coin_type' / account' / change / address_index`, external chain `0`, internal/change chain `1`, and address gap-limit discovery. Source: https://bips.dev/44/
- BIP48: multisig path `m / 48' / coin_type' / account' / script_type' / change / address_index`, deterministic key sorting, and p2wsh/p2sh-p2wsh script types. Source: https://bips.dev/48/
- BIP49, BIP84, BIP86: official nested SegWit, native SegWit, and single-key Taproot derivation/address vectors. Sources: https://bips.dev/49/, https://bips.dev/84/, https://bips.dev/86/
- BIP173 and BIP350: Bech32 checksum rules and Bech32m requirement for witness v1+. Sources: https://bips.dev/173/, https://bips.dev/350/
- BIP340 and BIP341: Schnorr signatures, Taproot output construction, key-path spending vectors, and Bitcoin Core validation vectors. Sources: https://bips.dev/340/, https://bips.dev/341/
- BIP143: SegWit v0 signature digest commits to the spent amount, which matters for offline signers. Source: https://bips.dev/143/
- BIP174 and BIP370: PSBT v0 and PSBT v2 formats for offline and multi-party signing. Sources: https://bips.dev/174/, https://bips.dev/370/
- BIP380: descriptor checksum and key expression vectors. Source: https://bips.dev/380/
- Bitcoin Core `key_io` vectors: reference address encoding/decoding data. Source: https://github.com/bitcoin/bitcoin/tree/master/src/test/data

## What Is Strong

- The generated address-vector corpus covers 83 single-sig and 39 multisig vectors, with receive/change, mainnet/testnet, high indices, BIP44/49/84/86 single-sig paths, BIP48-like multisig paths, and key-ordering cases. See `scripts/verify-addresses/testCases.ts`.
- `addressDerivation.verified.test.ts` asserts the app's address derivation against those checked-in vectors.
- The standards test suite is broad: BIP32, BIP39, BIP173/BIP350, BIP340, BIP341, BIP143, BIP174, BIP380, and Bitcoin Core key_io tests exist and passed in focused verification.
- Recipient address validation in transaction creation uses `bitcoin.address.toOutputScript(...)`, not only regex format checks.
- Change-chain discovery uses parsed derivation paths for the main receive/change helpers, which aligns with BIP44/BIP48's external/internal chain model.
- Hardware signing adapters and QR/USB signing flows have mocked contract tests around path mapping, PSBT updates, partial signature handling, and error handling.

## Highest-Risk Gaps

### Critical: Address vectors are not independently enforced enough

The checked-in address fixture says the current vectors are verified by only `bitcoinjs-lib 7.0.1` and `Caravan 0.4.5` (`server/tests/fixtures/verified-address-vectors.ts`). The verifier imports Bitcoin Core, bitcoinjs-lib, Caravan, Python, and Go implementations, but `MIN_IMPLEMENTATIONS` is only `2` (`scripts/verify-addresses/generate-vectors.ts`).

The command I ran confirms this is the current state: Bitcoin Core, `bip_utils`, and Go were unavailable; verification passed using only bitcoinjs-lib and Caravan. That is useful, but not enough for funds-loss-grade address confidence because production address construction is also bitcoinjs-lib based.

Recommendation: require Bitcoin Core plus at least one non-JS implementation, and fail the vector job if only JS ecosystem implementations are available.

### Critical: Dedicated vector CI can miss actual derivation-code changes

`.github/workflows/verify-vectors.yml` watches `server/src/services/bitcoin/addressDerivation.ts`, but the implementation lives in `server/src/services/bitcoin/addressDerivation/**`. The same issue exists for descriptor parser directories. A PR that changes `singleSigDerivation.ts`, `multisigDerivation.ts`, `xpubConversion.ts`, or descriptor parser internals can bypass the dedicated vector workflow path filter.

Recommendation: update the path filters to include `server/src/services/bitcoin/addressDerivation/**`, `server/src/services/bitcoin/descriptorParser/**`, transaction PSBT builder files, and hardware-signing-critical tests.

### Critical: PSBT cross-implementation verifier is not currently real

`scripts/verify-psbt/package.json` defines `verify: tsx verify.ts`, but there is no `verify.ts`. The generator documents Bitcoin Core verification, but the P2WPKH and P2WSH generator functions currently return no vectors after printing TODO-style instructions. The checked-in extended PSBT vectors in `server/tests/fixtures/bip174-test-vectors.ts` are deterministic local vectors marked `verifiedBy: ['bitcoinjs-lib']`.

Recommendation: make PSBT cross-verification executable in CI with Bitcoin Core `decodepsbt`, `analyzepsbt`, `finalizepsbt`, and ideally `testmempoolaccept` on extracted transactions.

### High: Signing tests are mostly library-level or mocked adapter tests

BIP340 tests verify tiny-secp256k1 against official vectors for 32-byte messages and exact signatures, but variable-length vectors only check key derivation because the library API requires 32-byte messages. BIP341 tests verify Taproot tweaks, scriptPubKeys, addresses, and witness byte lengths, but they do not recompute the full BIP341 key-path sighash and validate witness signatures against official key-path-spending vectors.

Hardware wallet tests are useful contract tests, but they are mocked. They do not prove that a PSBT produced by `createTransaction` can be signed by Ledger/Trezor/BitBox/air-gapped flows, combined, finalized, extracted, and accepted by Bitcoin Core.

Recommendation: add deterministic end-to-end signing fixtures for P2WPKH, P2SH-P2WPKH, P2TR key path, P2WSH sortedmulti, and P2SH-P2WSH sortedmulti. Build with the real transaction service, sign with deterministic keys or vendor reference payloads, finalize, extract, and validate with Bitcoin Core.

### High: Multisig PSBT construction can fail open on signing metadata

`addInputsWithBip32` adds inputs even when derivation paths are missing or invalid, then logs skipped BIP32 metadata. Existing tests explicitly expect continuation when paths are empty/invalid or descriptor parsing fails (`transactionServiceCreate/multisig.contracts.ts`). For multisig and hardware signing, missing `bip32Derivation`, `witnessScript`, or `redeemScript` can produce a PSBT that looks created but cannot be safely verified or signed.

Recommendation: for spend creation, fail closed when a multisig input cannot attach all required signer metadata and scripts. Keep permissive parsing only for read-only/import diagnostics.

### High: Invalid descriptor checksum is reported but still stripped and consumed

`validateAndRemoveChecksum` returns `{ valid: false }` for a mismatch, but `removeChecksum` discards the validity bit. `parseDescriptorForImport` uses `removeChecksum`, so a tampered descriptor with a bad checksum can continue through import parsing. `industry/descriptorSafety.test.ts` already documents this attack scenario.

Recommendation: reject descriptors with invalid present checksums at import and derivation boundaries. Optional missing checksums can remain allowed with a warning, but present-and-wrong checksums should fail.

### High: Private extended keys are accepted by xpub validation

`validateXpub` accepts any structurally valid extended key that `bip32.fromBase58` can parse. The test suite currently codifies that an `xprv` is valid. In a wallet import flow, accepting private extended keys is dangerous even if the app derives public addresses from them.

Recommendation: reject `xprv`, `yprv`, `zprv`, `tprv`, `uprv`, `vprv`, and multisig private extended variants at validation, descriptor parsing, storage, and API boundaries.

### Medium: Change-address policy has fallback paths that are not fully chain-scoped

The main change helper correctly prefers parsed change-chain addresses and falls back to parsed receive-chain addresses. The decoy output path first requests change addresses but then calls `findUnusedExcluding`, which is not chain-scoped. `generateAddress` chooses the next receive index from the highest address index across both chains, so a wallet with more generated change addresses can skip receive indexes.

Recommendation: add an explicit chain field or chain-scoped repository APIs everywhere change/receive semantics matter. Make fallback-to-receive an explicit policy with tests named as such, or reject transaction creation when no change-chain address is available.

### Medium: Bare P2SH multisig vectors are generated but not asserted against app derivation

The verifier test cases include `p2sh`, `p2sh_p2wsh`, and `p2wsh` multisig types. The app derivation tests assert only `p2wsh` and `p2sh_p2wsh`. If bare P2SH multisig is unsupported, tests should explicitly reject it. If supported, it needs derivation, PSBT, and signing coverage.

Recommendation: either remove/classify bare P2SH multisig from the verified corpus as unsupported, or implement and test it end to end.

### Medium: Regex address validation must remain non-authoritative

`isValidAddressFormat` is explicitly format-only. That is acceptable only if every funds-moving boundary uses checksum/script validation such as `bitcoin.address.toOutputScript`. Current transaction creation does that, but the frontend/shared regex tests should add "false positive" examples from BIP173/BIP350 and Bitcoin Core invalid vectors to guard against accidental backend reuse.

Recommendation: add tests proving malformed-checksum addresses can pass no funds-moving boundary, and consider renaming the helper to `hasBitcoinAddressLikeFormat`.

## Verification Performed

- `npm --prefix scripts/verify-addresses run typecheck` - passed.
- `npm --prefix scripts/verify-addresses run verify` - passed after running outside sandbox due a tsx IPC permission error; verified 83 single-sig and 39 multisig vectors, 0 disagreements, but only bitcoinjs-lib and Caravan were available.
- `npm --prefix scripts/verify-psbt run verify` - failed before verification because `tsx` was not installed in that script workspace; inspection also shows the configured `verify.ts` does not exist.
- `npm --prefix server run test -- --run ...` for address/BIP/descriptor/PSBT industry suites - 12 files, 570 tests passed.
- `npm --prefix server run test -- --run ...` for transaction creation, PSBT builder, PSBT validation, PSBT property, and hardware-wallet compatibility suites - 5 files, 327 tests passed.
- `npx vitest run ...` for Ledger/Trezor/QR/USB signing focused suites - 5 files, 118 tests passed.

## Recommended Next Work

1. Make address verification CI funds-loss-grade: Dockerized Bitcoin Core, Python `bip_utils`, and Go/btcd implementations available; require Bitcoin Core plus one non-JS implementation; include the actual implementation directories in workflow path filters.
2. Build real PSBT cross-verification: generate non-empty Bitcoin Core vectors, fix the missing `verify.ts`, and gate generated vectors in CI.
3. Add end-to-end signing fixtures from transaction service to signed/finalized/extracted transaction, validated by Bitcoin Core, for the script types Sanctuary supports.
4. Fail closed on invalid descriptor checksums, private extended keys, and missing multisig signing metadata.
5. Tighten change-chain policy by removing or explicitly testing receive-chain fallback behavior and making decoy output address selection chain-aware.
6. Add explicit official BIP49/BIP84/BIP86 extended-key/address vector assertions in the app derivation tests, not only generated-vector assertions.
