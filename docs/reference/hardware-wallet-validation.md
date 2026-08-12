# Hardware Wallet Validation Runbook

This runbook separates repeatable software/emulator proof from manual physical
hardware proof. Run the physical procedure only after the deterministic gates
and the applicable pinned emulator gate pass.

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

### Proof tiers

| Tier | Execution                                                        | What it proves                                                                                                                                    | What it cannot prove                                                                                                              |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Immutable vectors and Bitcoin Core replay on every relevant PR   | Path, descriptor, PSBT, signature, and transaction invariants                                                                                     | Vendor transport, firmware, screen, or confirmation behavior                                                                      |
| 2    | Pinned vendor emulator/protocol integration                      | Production-adapter payload/session compatibility with exact emulated firmware, Bridge, Connect core protocol, display calls, and signing protocol | Connect-Web iframe/Suite orchestration, physical transport, production device possession, screen rendering, or human confirmation |
| 3    | Dedicated physical device with operator and independent reviewer | Physical transport, actual screen/confirmation behavior, and sanitized adapter-native artifacts                                                   | Future firmware/SDK revisions after the evidence expires                                                                          |

Tier 2 never satisfies a Tier 3 fixture row. Ledger Tier 2 builds a dedicated
`linux/amd64` Speculos image from the exact inputs recorded in
`config/ledger-emulator/proof.json`: Speculos 0.26.9 and the Ledger app-builder
base are OCI-digest pinned, and Bitcoin/Bitcoin Test app 2.4.2 is built from an
exact source commit and verified against separate ELF hashes. The production
`@ledgerhq/ledger-bitcoin` adapter then proves BIP44/49/84/86 account 0/7 export,
receive/change display at indexes 0/19, app/network rejection, signing, and
independent finalization on both coin families. Run it with:

```bash
npm run test:ledger-emulator-proof
```

The Ledger app binaries and Speculos runtime are baked into this dedicated proof
image; CI does not download or repair them after the container starts. The root
SDK and WebUSB versions are exact lockfile pins checked against the proof
manifest. Ledger multisig remains product-blocked and Tier 2 does not enable any
physical capability row.

Trezor Tier 2 currently pins the
OCI index, exact `linux/amd64` child and image-config digests in
`config/trezor-emulator-proof.json`, Model T (`T2T1`) firmware 2.12.2, Bridge
2.0.33, and Trezor Connect 9.7.3 with the exact `@trezor/connect` and
`@trezor/connect-web` lockfile integrity values. The firmware and Bridge
binaries are baked into that content-addressed emulator image. They are not
downloaded by the proof run. Run it with:

```bash
npm run test:trezor-emulator-proof
```

The emulator lane deliberately substitutes the Node `@trezor/connect` entrypoint
for the production adapter's `@trezor/connect-web` import so it can speak directly
to the pinned Bridge in a Node runner. A separate contract test loads the real
Connect-Web entrypoint, locks its version/integrity and `coreMode: auto`
initialization surface, but Tier 2 does not claim executable coverage of
Connect-Web iframe or Suite orchestration.
For both BIP48 `/1'` nested and `/2'` native multisig, the emulator proves two
distinct states: Trezor can add and persist the first cryptographically valid
partial signature without making the PSBT finalizable, and it can preserve an
existing cosigner signature while adding the quorum-completing signature whose
artifact independently replays to the exact serialized transaction.

The runner atomically claims
`.tmp/ci-evidence/trezor-emulator/<run-id>-<attempt>/`. Successful, immutable
derivation/display/signing proof is written only below `proof/`; JUnit and
mnemonic-redacted runtime logs are written separately below `diagnostics/`.
CI uploads the exact current attempt paths and never uploads partial proof as a
successful result.
The proof provenance records the checked-out commit, CI run and attempt, capture
time, package-lock hash, and hashes of every proof-critical adapter, fixture,
test, workflow, and toolchain-control source. Node 24.19.0 and npm 11.19.0 are
archive-checksum/version-pinned in `scripts/ci/images/go-runner.Dockerfile` and verified
exactly against `.nvmrc`, `package.json`, and the proof manifest. The proof
workflow disables the setup action's npm download fallback, so a stale runner
image fails closed instead of repairing itself over the network. The
runner OS/architecture and sanitized Docker client/server version, API, OS, and
architecture fields are attested in the artifact. Docker and the host runner are
environment-dependent rather than content-pinned, so the manifest declares and
enforces minimum Docker API and exact supported OS/architecture constraints.
Hostnames and Docker endpoints are not retained, and the diagnostics scrub the
runner hostname and the public emulator mnemonic.
Published controller and Bridge ports bind to loopback by default.
Remote Docker is rejected unless the operator explicitly supplies a non-wildcard
daemon bind address, the runner-reachable published host, and
`SANCTUARY_TREZOR_ALLOW_REMOTE_DOCKER=1`.

Jade Tier 2 downloads the exact Blockstream Jade 1.0.40 source commit and
SHA-256-verified tarball recorded in `config/jade-emulator-proof.json`, verifies
the vendor `Dockerfile.qemu` and its digest-pinned `jade_builder` parent, then
builds the `linux/amd64` QEMU image without a host bind mount. The runner attests
the firmware, ELF, flash image, QEMU runtime, source inventory, Node/npm, and
locked `cbor-x` integrity. Sanctuary's production `JadeProtocolSession` then
uses serial-over-TCP to prove authentication, BIP44/49/84/86 account 0/7 xpubs,
receive/change display, and binary signed-PSBT reconstruction on both Bitcoin
coin families. Run it with:

```bash
npm run test:jade-emulator-proof
```

This debug unattended firmware auto-confirms prompts and uses a public test
mnemonic. It does not prove WebSerial, Jade Plus hardware, its screen, or human
approval and therefore cannot enable a capability row.

## Rerun Triggers

Run the full matrix when any of these change:

- Hardware-wallet adapter code, signing payload builders, or address display code.
- Wallet import, descriptor, derivation, change-address, transaction-building, PSBT,
  finalization, or broadcast code.
- `bitcoinjs-lib`, `@ledgerhq/*`, `@trezor/connect-web`, `cbor-x`, `bitbox02-api`, or vendor
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
npm run test:ledger-emulator-proof
npm run test:jade-emulator-proof
npm run test:run -- tests/services/hardwareWallet.trezorAdapter.test.ts tests/services/hardwareWallet.ledgerAdapter.test.ts tests/services/hardwareWallet.jadeAdapter.test.ts tests/services/hardwareWallet.bitboxAdapter.test.ts
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

| Device                       | Transport                 | Address display                                                         | Signing evidence                                                           |
| ---------------------------- | ------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Ledger Nano S Plus or Nano X | WebUSB, Bitcoin app       | `verifyAddress` must return the exact device-returned address           | Signed PSBT plus Ledger wallet policy template/key origin                  |
| Trezor Model T/Safe 3/Safe 5 | Trezor Connect and Bridge | `getAddress` with `showOnTrezor` must return the exact expected address | Exact source PSBT + Connect signature array + serialized transaction tuple |
| Jade Plus                    | WebSerial                 | `get_receive_address` must return the exact address displayed by Jade   | Adapter-returned binary signed PSBT plus reconstructed/final transaction   |
| BitBox02 BTC-only or Multi   | WebHID                    | `btcDisplayAddressSimple` must return the exact expected address        | Signed PSBT from `btcSignSimple`                                           |

### Current Fixture Classification

As of 2026-08-11, no sanitized physical-device signing artifacts are committed
yet. The executable fixture intake therefore records required rows separately
from rows that Sanctuary currently blocks at the product level.

| Row                                                 | Classification                                     | Evidence                                                                                                                                                                                                            |
| --------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ledger P2PKH, P2WPKH, P2SH-P2WPKH, P2TR             | Required, product blocked pending physical fixture | The pinned emulator proves production-adapter BIP44, BIP49, BIP84, and BIP86 conformance on both coin families, but cannot satisfy physical display/transport evidence. All Ledger capability rows remain disabled. |
| Ledger P2WSH, P2SH-P2WSH                            | Unsupported, product blocked                       | Ledger adapter currently builds only single-sig `DefaultWalletPolicy` templates; multisig Ledger signing is not exposed.                                                                                            |
| Trezor P2WPKH, P2SH-P2WPKH, P2TR, P2WSH, P2SH-P2WSH | Required, product blocked pending physical fixture | The pinned emulator proves production-adapter BIP49, BIP84, BIP86, and both BIP48 `/1'` and `/2'` conformance, but cannot satisfy physical display/transport evidence. All Trezor capability rows remain disabled.  |
| Jade Plus P2PKH, P2WPKH, P2SH-P2WPKH, P2TR          | Required, product blocked pending physical fixture | Pinned QEMU proves production-session single-signature protocol conformance, but cannot satisfy physical WebSerial/display evidence. All Jade rows remain disabled.                                                 |
| Jade Plus P2WSH, P2SH-P2WSH                         | Unsupported, product blocked                       | The Jade adapter explicitly rejects multisig signing before sending a PSBT.                                                                                                                                         |
| BitBox02 P2WPKH, P2SH-P2WPKH, P2TR                  | Required, missing physical fixture                 | BitBox adapter maps these to `btcSignSimple` single-sig script configs and still needs vendor-signed artifacts.                                                                                                     |
| BitBox02 P2WSH, P2SH-P2WSH                          | Unsupported, product blocked                       | BitBox adapter currently uses `btcSignSimple` single-sig script configs only; multisig BitBox signing is not exposed.                                                                                               |

This leaves 16 required rows awaiting physical evidence and 6 explicitly blocked
unsupported rows. The executable source of truth is
`server/tests/fixtures/hardware-signed-psbt-vectors.ts`.

The unsupported Ledger and BitBox multisig rows are enforced in the product, not
only documented. USB signing refuses those device/script combinations before
connecting from the send flow, and the Ledger and BitBox adapters reject direct
multisig PSBT signing requests before constructing wallet-policy or
`btcSignSimple` payloads. The focused evidence is:

```bash
npm run test:run -- tests/services/hardwareWallet.signingSupport.test.ts tests/hooks/useUsbSigning.test.tsx tests/services/hardwareWallet.ledgerAdapter.test.ts tests/services/hardwareWallet.bitboxAdapter.test.ts
```

## Script Matrix

Run each required device through these rows when the vendor supports the script
family. If Sanctuary exposes a script family that a device cannot safely sign,
the feature must be blocked or clearly marked unsupported for that device.

| Script family                        | Account path     | Required checks                                                                                                           |
| ------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Native SegWit single-sig P2WPKH      | `m/84'/1'/0'`    | receive display, change display, one-input spend, wrong-address negative                                                  |
| Nested SegWit single-sig P2SH-P2WPKH | `m/49'/1'/0'`    | receive display, change display, one-input spend, wrong-network negative                                                  |
| Taproot single-sig P2TR              | `m/86'/1'/0'`    | receive display and signing when firmware/app support it; otherwise record unsupported and block Taproot hardware signing |
| Native sorted multisig P2WSH         | `m/48'/1'/0'/2'` | policy/account registration, change recognition, one vendor partial signature, final transaction Core acceptance          |
| Nested sorted multisig P2SH-P2WSH    | `m/48'/1'/0'/1'` | policy/account registration, change recognition, one vendor partial signature, final transaction Core acceptance          |

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
4. Save the adapter-native artifact. Ledger retains the exact source PSBT and
   Ledger-returned per-input signature records; Sanctuary's resulting signed PSBT
   is stored separately and labeled as reconstructed application state. Jade and
   BitBox retain the adapter-returned signed PSBT. Trezor retains the exact source
   PSBT, Connect signature array, and serialized transaction as its native
   evidence tuple. Sanctuary may also persist a locally reconstructed PSBT after
   every Connect signature has been origin-bound and cryptographically validated;
   that PSBT is application state, not a claim that Connect returned a PSBT.
   Evidence-only tuples never advance signer or draft state.
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

| Field              | Required value                                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Commit             | Git commit under test                                                                                                                                                                                                                                                                                              |
| Device             | Model, firmware, Bitcoin app, transport package version                                                                                                                                                                                                                                                            |
| Runtime provenance | Reachable tested commit; exact frontend/backend OCI manifest and config subjects; application version; package-lock and funds-safety source-manifest digests; complete vendor SDK tuple with lockfile SRI; host OS, browser, transport/companion versions, capture ID, expiry, and trusted Ed25519 capture receipt |
| Wallet             | Fingerprint, full account xpub/path, canonical policy ID/version, and complete multisig threshold/cosigner set when applicable                                                                                                                                                                                     |
| Address evidence   | Path, Sanctuary address, device-returned address, Core-derived address                                                                                                                                                                                                                                             |
| Signing evidence   | Unsigned PSBT hash, signed PSBT/raw tx hash, decoded outputs, fee, vsize, txid                                                                                                                                                                                                                                     |
| Core replay        | Exact `testmempoolaccept` request/response transcript, current pinned Core image/subversion, and an Ed25519 receipt from a separately provisioned trusted evidence key                                                                                                                                             |
| Negative controls  | Case name, expected failure, observed failure                                                                                                                                                                                                                                                                      |
| Operator notes     | Manual observations, screenshots/photos paths if sanitized                                                                                                                                                                                                                                                         |

Do not commit raw evidence that contains secrets. Testnet/regtest PSBTs, raw
transactions, xpubs, and decoded summaries may be committed after review.

## Executable Fixture Intake Checklist

Before adding a row to `server/tests/fixtures/hardware-signed-psbt-vectors.ts`,
the lab operator and reviewer must satisfy the executable intake schema used by
`server/tests/helpers/hardwareSignedFixtureIntake.ts`.

Each committed row must include:

- `fixtureSchemaVersion: 4`, `evidenceTier: physical-device`, and
  `device.emulated: false`. Emulator or simulator provenance is rejected.
- A tested commit that is a reachable ancestor; exactly one frontend and one
  backend OCI subject whose revision, application version, package-lock digest,
  and funds-safety source-manifest digest agree; and a trusted Ed25519 receipt
  over those subjects plus the device/runtime tuple and artifact hashes.
- The complete vendor tuple: Ledger model/firmware/Bitcoin app plus locked
  Ledger Bitcoin and WebUSB packages; Trezor model/firmware/Connect,
  Connect-Web, and Bridge-or-Suite companion; Jade Plus firmware/browser/
  WebSerial plus locked `cbor-x`; or BitBox02 model/firmware/WebHID plus its
  locked SDK. Host OS, browser, capture ID, capture/expiry times within 180 days,
  and distinct accountable operator and sanitization reviewer are mandatory.

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
- The exact Bitcoin Core JSON-RPC request/response transcript bound to the
  current pinned proof manifest and replayed raw transaction. Its receipt must
  verify with a separately provisioned trusted Ed25519 evidence key. The trusted
  key set is intentionally empty until the PR12 operator ceremony provisions
  and reviews it, so no physical fixture can pass intake prematurely.
- Hashes of the unsigned PSBT and complete adapter-native signed artifact, plus
  explicit proof that the physical device recognized the change output.

The intake schema rejects duplicate device/script rows, rows that conflict with
an unsupported product decision, missing required paths or controls, failed or
missing software gates, non-test networks, and secret-shaped text such as
mnemonics, passphrases, PINs, auth tokens, private keys, or xprv/tprv material.

Committed hardware-signed artifacts go in
`server/tests/fixtures/hardware-signed-psbt-vectors.ts`. Ledger rows contain the
source PSBT, exact Ledger signature records, and an explicitly labeled
Sanctuary-reconstructed PSBT. Jade and BitBox rows contain the adapter-returned
signed PSBT. Each Trezor row contains the source PSBT, Connect signature array,
and serialized transaction. Replay authenticates input
values from PSBT UTXOs, requires exact complete outputs, binds every signer to a
full account xpub/path and PSBT origin, verifies every signature, enforces
canonical policy IDs and BIP-371 key-path-only Taproot metadata, reconstructs
multisig scripts from the exact threshold/cosigner set, derives every recorded
address, authenticates fetched reference-transaction txids/selected scripts and
amounts, and rejects any tuple/intent/Core-evidence mismatch. The replay harness is
`server/tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts`.

## Machine-Generated Compatibility Statement

`scripts/ci/hardware-compatibility-report.ts` converts the checked-in capability
manifest, required physical-device matrix, immutable derivation and PSBT vectors,
emulator manifests, and reviewed physical fixtures into deterministic JSON and
Markdown. The generated statement is evidence inventory, not a product-support
override: a row remains disabled or unverified until its full proof chain and
fresh physical evidence pass the existing fail-closed gates.

Regenerate the checked-in source-state statement with an explicit timestamp and
revision:

```bash
npx tsx scripts/ci/hardware-compatibility-report.ts \
  --as-of 2026-08-11T00:00:00.000Z \
  --revision "$(git rev-parse HEAD)" \
  --json docs/reference/generated/hardware-wallet-compatibility.json \
  --markdown docs/reference/generated/hardware-wallet-compatibility.md
```

The checked-in artifacts use a fixed generation timestamp so CI can reproduce
them byte-for-byte. A release operator may additionally generate a revision-bound
statement for the candidate under review; changing the timestamp or revision does
not promote a capability or substitute for signed physical evidence.

To require only the five Trezor physical rows during a Trezor lab capture:

```bash
REQUIRE_TREZOR_PHYSICAL_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts
```

That command is expected to fail until all current Trezor physical artifacts
are reviewed. The ordinary CI emulator run does not reduce its missing count.

To require only the four Ledger physical rows during a Ledger lab capture:

```bash
REQUIRE_LEDGER_PHYSICAL_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts
```

That command is expected to fail until all current Ledger physical artifacts
are independently reviewed. The ordinary Speculos proof does not reduce its
missing count.

To require only the four Jade Plus single-signature physical rows during a lab capture:

```bash
REQUIRE_JADE_PHYSICAL_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts
```

That command is expected to fail until all current Jade Plus WebSerial/display
artifacts are independently reviewed. QEMU proof never reduces its missing count.

To turn the harness into a full hardware evidence gate after physical capture:

```bash
REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts
```

## Acceptance Criteria

The hardware phase passes only when:

- Every enabled device/script row has current Tier 3 evidence. Missing Tier 3
  evidence leaves the corresponding capability explicitly disabled even when
  Tier 2 passes.
- Every address row has exact Sanctuary/device/Core agreement.
- Every signing row produces a Sanctuary-replayable artifact accepted by Bitcoin
  Core policy.
- Every negative control fails closed.
- The manifest records the commit, device versions, software-gate outputs, and
  any unsupported rows with the product decision.

Until this runbook is completed on physical devices, the wallet safety posture is
software-vector-grade, not full hardware-in-loop funds-loss-grade.
