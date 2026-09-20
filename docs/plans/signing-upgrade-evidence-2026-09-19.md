# Signing upgrade evidence

This record covers the approved signing dependency batches prepared on 2026-09-19.

## Package review

| Package | Change | Published | Age at review | Tarball review |
| --- | --- | --- | --- | --- |
| `cbor-x` | `1.6.4` -> `1.6.6` | 2026-08-25 | 24 days | Decoder, encoder, declarations, maps, and package metadata changed; focused CBOR/UR/PSBT tests passed. |
| `@ledgerhq/hw-transport-webusb` | `6.34.4` -> `6.35.0` | 2026-06-30 | 80 days | WebUSB transport changed and the release adds `hid-framing` source, declarations, maps, and tests; Ledger emulator proof passed. |
| `@keystonehq/bc-ur-registry` | `0.7.1` -> `0.8.0` | 2026-06-04 | 107 days | UR parser and decoder compatibility suite passed 78/78. |

The tarballs were obtained with `npm pack` and extracted into separate directories. The Ledger `6.34.4` -> `6.35.0` diff was reviewed for its inlined HID framing implementation and new `hid-framing` files. The cbor-x diff was reviewed across runtime, declarations, and generated bundles. Registry integrity and lockfile pins are the source of the exact versions in the commits.

## PSBT provenance

The PSBT verifier toolchain is pinned to TypeScript `6.0.3`, tsx `4.23.13`, and Valibot `1.5.0`. The Core proof manifest is pinned to Bitcoin Core `29.4`, digest `sha256:96b6aae8a8efa8985b8aa64b40b5eeaac42c09f81acbc9da70e3634fe9274dfe`.

Signed and unsigned PSBT provenance was regenerated through the supported `scripts/ci/run-psbt-core-subject.sh regenerate` workflow. The generated diff changed only Core provenance/version labels; the PSBT payload strings and signed artifact data were unchanged. The standalone verifier then reported 5 Core-backed unsigned vectors and 6 Core-accepted signed vectors.

## Verification

The following checks passed:

```text
node --test tests/release/bump-funds-critical.test.mjs       # remote GNU runner: 18/18
npm run verify                                                # scripts/verify-psbt
npm run test:run -- tests/utils/urPsbt.test.ts tests/utils/urDeviceDecoder.test.ts tests/components/DeviceDetail/accounts/urHelpers.test.ts  # 78/78
```

The Ledger proof used the canonical cleanup coordinator and pinned external sources. Mainnet and testnet each passed four emulator tests, for eight live Ledger proof tests total. The proof built both pinned Bitcoin app ELFs and validated their configured hashes.

## Open proof limits

Jade image construction and firmware compilation succeeded, but the QEMU container did not expose its configured serial controller port before the readiness deadline; no Jade test ran. Final CI must run the Jade lane with the Docker-compatible runner engine.

The subject proof completed for Ledger, but the local Podman compatibility run produced an ambiguous cleanup receipt because the coordinator's Docker inspect contract differs from Podman's normalized output. The archived evidence is under `/tmp/sanctuary-parent-proof.t5tkE8/.tmp/ci-evidence/ledger-emulator/843018-1789872370-0-843018/` and the signed coordinator state under `/tmp/sanctuary-parent-authority-ledger.sanctuary-parent-proof.t5tkE8/runtime/coordinator-state.json`. Receipt hashes are: `summary.json` `a466976d1223fc05634d7e7cb81e3cc615759144a4669f7b11b3d1b38ee35967`, mainnet JUnit `60230622e3d9004cacd930d404b86bbe906402b2ab9156d495a37c96c8dfba86`, testnet JUnit `e7566e77c27b4e22689e1621b60fe640abccb186df32d34bf5aee1c60c895dd6`, and coordinator state `cd8ef7c87cf3d2a417b87bf8a64738ed77a7d125502e93310b1d5123cd836b64`. The run's labeled Ledger containers and images were inspected and absent afterward. Final Forgejo CI should publish the canonical ownership receipt using the runner's established engine wrapper.
