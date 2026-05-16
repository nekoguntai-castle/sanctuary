# Hardware Wallet Validation Runbook

This runbook defines the manual hardware phase for wallet address, change-address,
and signing confidence. Run it only after the deterministic software gates pass.

## Scope

Software gates already cover deterministic derivation, PSBT construction,
finalization, Core acceptance, no-device hardware payloads, and negative cases.
Manual hardware validation covers the things mocks cannot prove:

- The physical device displays the same receive address Sanctuary expects.
- The physical device handles change outputs as internal wallet outputs.
- The physical device signs the exact PSBT or transaction Sanctuary built.
- Vendor transport flows work through WebUSB, WebHID, Trezor Connect, or bridge
  software with real user approval prompts.
- Vendor-signed artifacts replay through Sanctuary finalization and Bitcoin Core.

## Rerun Triggers

Run the full matrix when any of these change:

- Hardware-wallet adapter code, signing payload builders, or address display code.
- Wallet import, descriptor, derivation, change-address, transaction-building, PSBT,
  finalization, or broadcast code.
- `bitcoinjs-lib`, `@ledgerhq/*`, `@trezor/connect-web`, `bitbox02-api`, or vendor
  firmware/app major or minor versions.
- Supported script families, network handling, multisig policy handling, or wallet
  feature flags.
- Any committed hardware-signed fixture is regenerated or replaced.

For a narrow patch, rerun the affected device and script-family rows plus the
software gates listed below.

## Required Software Gates

Run these before connecting hardware:

```bash
npm --prefix scripts/verify-addresses run verify
npm --prefix scripts/verify-psbt run verify
npx vitest run tests/services/hardwareWallet.trezorAdapter.test.ts tests/services/hardwareWallet.ledgerAdapter.test.ts tests/services/hardwareWallet.jadeAdapter.test.ts tests/services/hardwareWallet.bitboxAdapter.test.ts
npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts
npm run typecheck:app
npm run typecheck:tests
npm --prefix server run typecheck:tests
npm run quality:lizard
```

## Safety Rules

- Use testnet, signet, or regtest-funded scripts only. Do not use mainnet funds.
- Use wipeable test devices or dedicated test accounts. Do not record seed words,
  passphrases, PINs, pairing secrets, or host-local auth tokens.
- Store only sanitized xpubs, fingerprints, paths, unsigned PSBTs, signed PSBTs,
  raw transaction hex, decoded transaction summaries, and device/app versions.
- Screenshots or photos are allowed only when they show addresses, amounts,
  wallet policy text, or output summaries without secrets.
- Any address or output mismatch is a release blocker until explained by a
  corrected test fixture or code change.

## Device Matrix

Required release-grade hardware rows:

| Device | Transport | Address display | Signing evidence |
| --- | --- | --- | --- |
| Ledger Nano S Plus or Nano X | WebUSB, Bitcoin app | `verifyAddress` must return the exact device-returned address | Signed PSBT plus Ledger wallet policy template/key origin |
| Trezor Model T/Safe 3/Safe 5 | Trezor Connect and bridge/Suite | `getAddress` with `showOnTrezor` must return the exact expected address | Raw transaction and, for multisig, PSBT with extracted partial signature |
| BitBox02 BTC-only or Multi | WebHID | `btcDisplayAddressSimple` must return the exact expected address | Signed PSBT from `btcSignSimple` |

Jade has adapter-level address comparison coverage, but it is not part of the
required release-grade signing matrix until it has the same no-device signing
payload assertions as Ledger, Trezor, and BitBox.

### Current Fixture Classification

As of 2026-05-08, no sanitized physical-device signing artifacts are committed
yet. The executable fixture intake therefore records required rows separately
from rows that Sanctuary currently blocks at the product level.

| Row | Classification | Evidence |
| --- | --- | --- |
| Ledger P2WPKH, P2SH-P2WPKH, P2TR | Required, missing physical fixture | Ledger adapter maps these to single-sig wallet policy templates and still needs vendor-signed artifacts. |
| Ledger P2WSH, P2SH-P2WSH | Unsupported, product blocked | Ledger adapter currently builds only single-sig `DefaultWalletPolicy` templates; multisig Ledger signing is not exposed. |
| Trezor P2WPKH, P2SH-P2WPKH, P2TR, P2WSH, P2SH-P2WSH | Required, missing physical fixture | Trezor adapter has raw-transaction and multisig payload/signature extraction paths, but no physical artifacts are committed. |
| BitBox02 P2WPKH, P2SH-P2WPKH, P2TR | Required, missing physical fixture | BitBox adapter maps these to `btcSignSimple` single-sig script configs and still needs vendor-signed artifacts. |
| BitBox02 P2WSH, P2SH-P2WSH | Unsupported, product blocked | BitBox adapter currently uses `btcSignSimple` single-sig script configs only; multisig BitBox signing is not exposed. |

This leaves 11 required rows awaiting physical evidence and 4 explicitly blocked
unsupported rows. The executable source of truth is
`server/tests/fixtures/hardware-signed-psbt-vectors.ts`.

The unsupported Ledger and BitBox multisig rows are enforced in the product, not
only documented. USB signing refuses those device/script combinations before
connecting from the send flow, and the Ledger and BitBox adapters reject direct
multisig PSBT signing requests before constructing wallet-policy or
`btcSignSimple` payloads. The focused evidence is:

```bash
npx vitest run tests/services/hardwareWallet.signingSupport.test.ts tests/hooks/useUsbSigning.test.tsx tests/services/hardwareWallet.ledgerAdapter.test.ts tests/services/hardwareWallet.bitboxAdapter.test.ts
```

## Script Matrix

Run each required device through these rows when the vendor supports the script
family. If Sanctuary exposes a script family that a device cannot safely sign,
the feature must be blocked or clearly marked unsupported for that device.

| Script family | Account path | Required checks |
| --- | --- | --- |
| Native SegWit single-sig P2WPKH | `m/84'/1'/0'` | receive display, change display, one-input spend, wrong-address negative |
| Nested SegWit single-sig P2SH-P2WPKH | `m/49'/1'/0'` | receive display, change display, one-input spend, wrong-network negative |
| Taproot single-sig P2TR | `m/86'/1'/0'` | receive display and signing when firmware/app support it; otherwise record unsupported and block Taproot hardware signing |
| Native sorted multisig P2WSH | `m/48'/1'/0'/2'` | policy/account registration, change recognition, one vendor partial signature, final transaction Core acceptance |
| Nested sorted multisig P2SH-P2WSH | `m/48'/1'/0'/1'` | policy/account registration, change recognition, one vendor partial signature, final transaction Core acceptance |

Legacy P2PKH is required only if it is exposed in the production hardware-wallet
UI for the release being validated.

## Address Procedure

For each device and script-family row:

1. Import the device account xpub into Sanctuary and record the master
   fingerprint, account path, xpub prefix, device model, firmware, Bitcoin app,
   and transport library versions.
2. Derive and display receive paths `/0/0`, `/0/1`, `/0/19`, and `/0/999`.
3. Derive and display change paths `/1/0`, `/1/1`, and `/1/19`.
4. Independently derive the same addresses with Bitcoin Core descriptors, using
   the same fingerprint, account path, xpub, script wrapper, branch, and index.
5. Pass only when all three values are identical: Sanctuary expected address,
   device-returned/displayed address, and Bitcoin Core-derived address.
6. Run one wrong-address negative case per script family. The adapter must return
   `false` or the user must reject on the device. It must not return `true`.

Core descriptor examples:

```text
wpkh([FPR/84h/1h/0h]tpub.../0/0)
sh(wpkh([FPR/49h/1h/0h]tpub.../0/0))
tr([FPR/86h/1h/0h]tpub.../0/0)
wsh(sortedmulti(2,[FPR1/48h/1h/0h/2h]tpub1.../0/0,[FPR2/48h/1h/0h/2h]tpub2.../0/0))
```

Use `deriveaddresses` or `getdescriptorinfo` plus `deriveaddresses` in Bitcoin
Core. Normalize SLIP-132 xpub variants to standard `xpub`/`tpub` when Core
requires standard BIP-32 version bytes.

## Signing Procedure

For each signing row:

1. Build a Sanctuary PSBT with exactly one external recipient and one internal
   change output. Use a small testnet/regtest amount.
2. Record the unsigned PSBT, expected recipient address/amount, expected change
   path/address/amount, fee, version, locktime, input paths, and previous-output
   values.
3. Approve signing on the physical device only if the screen matches the expected
   external recipient and amount. When the device exposes change details, confirm
   the change path/address matches the internal output.
4. Save the returned signed PSBT or raw transaction. Trezor returns raw
   transaction hex; Ledger and BitBox return signed PSBTs.
5. Replay the artifact through Sanctuary finalization/extraction and Bitcoin Core
   decoding. For finalized transactions, `testmempoolaccept` must return
   `allowed=true` on the local Core chain used for the fixture.
6. For multisig, each required vendor must produce at least one valid partial
   signature for its cosigner key. Finalization may combine that vendor signature
   with deterministic software cosigner signatures, but the vendor signature must
   be independently present and matched to the vendor fingerprint/pubkey.

## Negative Signing Controls

Run these at least once per device, and once per multisig policy type:

- Wrong network/account path: signing must fail or show an unacceptable address.
- Wrong cosigner/fingerprint: multisig signing must fail before producing a
  usable signature.
- Tampered recipient address after PSBT presentation: finalization or replay must
  fail, or the device must display the changed external recipient.
- Tampered amount or fee: the device display and decoded transaction must expose
  the change; approving the original expectation must be impossible.
- Missing change derivation metadata: Sanctuary must not silently classify the
  output as internal change.
- Below-quorum multisig: final transaction extraction must fail.

## Artifact Manifest

Record one sanitized manifest per run, for example
`tasks/hardware-wallet-validation-YYYY-MM-DD.md`.

| Field | Required value |
| --- | --- |
| Commit | Git commit under test |
| Device | Model, firmware, Bitcoin app, transport package version |
| Wallet | Fingerprint, account path, script family, xpub prefix |
| Address evidence | Path, Sanctuary address, device-returned address, Core-derived address |
| Signing evidence | Unsigned PSBT hash, signed PSBT/raw tx hash, decoded outputs, fee, vsize, txid |
| Core replay | `decodepsbt`, `decoderawtransaction`, and `testmempoolaccept` result |
| Negative controls | Case name, expected failure, observed failure |
| Operator notes | Manual observations, screenshots/photos paths if sanitized |

Do not commit raw evidence that contains secrets. Testnet/regtest PSBTs, raw
transactions, xpubs, and decoded summaries may be committed after review.

## Executable Fixture Intake Checklist

Before adding a row to `server/tests/fixtures/hardware-signed-psbt-vectors.ts`,
the lab operator and reviewer must satisfy the executable intake schema used by
`server/tests/helpers/hardwareSignedFixtureIntake.ts`.

Each committed row must include:

- Address evidence for receive paths `/0/0`, `/0/1`, `/0/19`, `/0/999` and
  change paths `/1/0`, `/1/1`, `/1/19`, with exact Sanctuary/device/Core
  agreement for every path.
- Passed negative controls for wrong network or account path, tampered recipient,
  tampered amount or fee, and missing change metadata. Multisig rows must also
  include wrong cosigner/fingerprint and below-quorum failures.
- Passed software-gate evidence for address vectors, PSBT vectors, hardware
  adapter tests, existing hardware fixture replay, app/test/server typechecks,
  and lizard.
- Sanitization review affirming non-mainnet funds, wipeable or dedicated test
  device/account use, no seed/PIN/passphrase/pairing material, no host auth
  tokens, and reviewer-approved artifacts.
- Bitcoin Core replay metadata, including Core version and
  `testmempoolaccept` allowed status.

The intake schema rejects duplicate device/script rows, rows that conflict with
an unsupported product decision, missing required paths or controls, failed or
missing software gates, non-test networks, and secret-shaped text such as
mnemonics, passphrases, PINs, auth tokens, private keys, or xprv/tprv material.

Committed hardware-signed artifacts go in
`server/tests/fixtures/hardware-signed-psbt-vectors.ts`. Each row must include
exactly one signed PSBT or raw transaction, the total input value, expected fee,
expected vsize, expected txid, expected outputs, signer metadata, and device/app
versions, plus the intake checklist fields above. The replay harness is
`server/tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts`.

To turn the harness into a full hardware evidence gate after physical capture:

```bash
REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts
```

## Acceptance Criteria

The hardware phase passes only when:

- Every required device/script row either passes or is explicitly blocked in the
  product for unsupported hardware.
- Every address row has exact Sanctuary/device/Core agreement.
- Every signing row produces a Sanctuary-replayable artifact accepted by Bitcoin
  Core policy.
- Every negative control fails closed.
- The manifest records the commit, device versions, software-gate outputs, and
  any unsupported rows with the product decision.

Until this runbook is completed on physical devices, the wallet safety posture is
software-vector-grade, not full hardware-in-loop funds-loss-grade.
