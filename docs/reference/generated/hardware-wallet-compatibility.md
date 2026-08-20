# Hardware wallet compatibility statement

Generated: 2026-08-11T00:00:00.000Z
Revision: source-state artifact (release revision not supplied)
Application: 0.8.65
Decision: safe-fail-closed

All inventoried signer families (bitbox, coldcard, generic, jade, keystone, ledger, passport, seedsigner, specter, trezor) remain disabled unless a separately reviewed capability row says otherwise.

| Vendor | Script      | Status                            | Tier 3 freshness | Evidence |
| ------ | ----------- | --------------------------------- | ---------------- | -------- |
| ledger | p2pkh       | blocked-pending-physical-evidence | unverified       | none     |
| ledger | p2wpkh      | blocked-pending-physical-evidence | unverified       | none     |
| ledger | p2sh-p2wpkh | blocked-pending-physical-evidence | unverified       | none     |
| ledger | p2tr        | blocked-pending-physical-evidence | unverified       | none     |
| ledger | p2wsh       | unsupported-product-blocked       | unverified       | none     |
| ledger | p2sh-p2wsh  | unsupported-product-blocked       | unverified       | none     |
| trezor | p2wpkh      | blocked-pending-physical-evidence | unverified       | none     |
| trezor | p2sh-p2wpkh | blocked-pending-physical-evidence | unverified       | none     |
| trezor | p2tr        | blocked-pending-physical-evidence | unverified       | none     |
| trezor | p2wsh       | blocked-pending-physical-evidence | unverified       | none     |
| trezor | p2sh-p2wsh  | blocked-pending-physical-evidence | unverified       | none     |
| jade   | p2pkh       | blocked-pending-physical-evidence | unverified       | none     |
| jade   | p2wpkh      | blocked-pending-physical-evidence | unverified       | none     |
| jade   | p2sh-p2wpkh | blocked-pending-physical-evidence | unverified       | none     |
| jade   | p2tr        | blocked-pending-physical-evidence | unverified       | none     |
| jade   | p2wsh       | unsupported-product-blocked       | unverified       | none     |
| jade   | p2sh-p2wsh  | unsupported-product-blocked       | unverified       | none     |
| bitbox | p2wpkh      | blocked-pending-physical-evidence | unverified       | none     |
| bitbox | p2sh-p2wpkh | blocked-pending-physical-evidence | unverified       | none     |
| bitbox | p2tr        | blocked-pending-physical-evidence | unverified       | none     |
| bitbox | p2wsh       | unsupported-product-blocked       | unverified       | none     |
| bitbox | p2sh-p2wsh  | unsupported-product-blocked       | unverified       | none     |

## Proof counts

- Tier 1 address vectors: 480
- Tier 1 draft PSBT vectors: 5
- Tier 1 signed PSBT vectors: 6
- Tier 3 physical fixtures: 0
