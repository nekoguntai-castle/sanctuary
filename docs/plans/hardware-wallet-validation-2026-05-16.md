# Hardware Wallet Validation Readiness - 2026-05-16

Status: blocked on physical hardware evidence.

Commit under test: `9edf7a62e2afe4eb9a4c7c3ad43077b2d529d73d`

Runbook: `docs/reference/hardware-wallet-validation.md`

Executable fixture source: `server/tests/fixtures/hardware-signed-psbt-vectors.ts`

## Summary

The deterministic software gates for hardware-wallet validation are ready, but
the full hardware-in-loop phase has not passed because no sanitized physical
Ledger, Trezor, or BitBox signing artifacts are committed.

The strict fixture gate was run with `REQUIRE_HARDWARE_SIGNED_FIXTURES=1` and
failed only on the expected missing-row assertion. This confirms the remaining
Phase 5 blocker is evidence capture from real devices, not an unclassified
software harness failure.

## Software Gate Evidence

| Gate | Result | Notes |
| --- | --- | --- |
| `npm --prefix scripts/verify-addresses run verify` | pass | Required Bitcoin Core plus an independent non-JS implementation. Ran with `bitcoin/bitcoin:27.0` regtest container and a local `.tmp/phase5-bip-utils-venv` containing `bip_utils@2.12.1`; 122 vectors verified, 0 disagreements. |
| `npm --prefix scripts/verify-psbt run verify` | pass | 5 generated Bitcoin Core-backed PSBT vectors and 4 generated Bitcoin Core-accepted signed vectors passed. |
| `npx vitest run tests/services/hardwareWallet.trezorAdapter.test.ts tests/services/hardwareWallet.ledgerAdapter.test.ts tests/services/hardwareWallet.jadeAdapter.test.ts tests/services/hardwareWallet.bitboxAdapter.test.ts` | pass | 4 files, 100 tests. |
| `npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts` | pass | 1 file, 16 tests. Non-strict mode accounts for missing physical rows. |
| `npm run typecheck:app` | pass | App TypeScript gate passed. |
| `npm run typecheck:tests` | pass | Frontend test TypeScript gate passed. |
| `npm --prefix server run typecheck:tests` | pass | Server test TypeScript gate passed. |
| `npm run quality:lizard` | pass | Lizard quality gate passed. |
| `REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts` | expected fail | 15 of 16 tests passed; strict missing-row assertion failed with the 11 required physical evidence rows listed below. |

## Missing Required Physical Rows

| Vendor | Script type | Status |
| --- | --- | --- |
| Ledger | P2WPKH | Missing signed physical artifact |
| Ledger | P2SH-P2WPKH | Missing signed physical artifact |
| Ledger | P2TR | Missing signed physical artifact |
| Trezor | P2WPKH | Missing signed physical artifact |
| Trezor | P2SH-P2WPKH | Missing signed physical artifact |
| Trezor | P2TR | Missing signed physical artifact |
| Trezor | P2WSH | Missing signed physical artifact |
| Trezor | P2SH-P2WSH | Missing signed physical artifact |
| BitBox02 | P2WPKH | Missing signed physical artifact |
| BitBox02 | P2SH-P2WPKH | Missing signed physical artifact |
| BitBox02 | P2TR | Missing signed physical artifact |

## Product-Blocked Rows

| Vendor | Script type | Product decision |
| --- | --- | --- |
| Ledger | P2WSH | Blocked; the current Ledger signing adapter exposes single-sig `DefaultWalletPolicy` signing only. |
| Ledger | P2SH-P2WSH | Blocked; the current Ledger signing adapter exposes single-sig `DefaultWalletPolicy` signing only. |
| BitBox02 | P2WSH | Blocked; the current BitBox02 adapter exposes `btcSignSimple` single-sig signing only. |
| BitBox02 | P2SH-P2WSH | Blocked; the current BitBox02 adapter exposes `btcSignSimple` single-sig signing only. |

## Next Physical Evidence Step

Use the runbook to capture sanitized signed PSBT or raw transaction artifacts
from physical devices. Each committed row must include device model, firmware,
transport, network, descriptor/script type, unsigned PSBT hash, signed artifact
hash, expected outputs, Core replay evidence, negative controls, and
sanitization review.

Do not mark the hardware-in-loop phase as passed until the strict fixture gate
passes:

```bash
REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts
```
