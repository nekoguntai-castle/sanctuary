# Signing upgrade evidence (2026-11-18)

This record covers the signing-scope dependency bump prepared on 2026-11-18.

## Package review

Each tarball pair was fetched with `npm pack`, extracted into its own directory and compared with `diff -r`.

| Package | Change | Published | Age at review | What changed |
| --- | --- | --- | --- | --- |
| `bitcoinjs-lib` | `7.0.2` -> `7.0.5` | 2026-10-26 | 23 days | `psbt.js`: one shared previous-output lookup. Fee calculation now checks the non-witness UTXO hash against the input, rejects a missing output index, rejects a witness UTXO that disagrees with the non-witness UTXO, and throws when an input has no UTXO. Fee caches are cleared when a UTXO is added. `block.js`: compact-target bounds in `checkProofOfWork`. |
| `tiny-secp256k1` | `2.2.4` -> `2.2.5` | 2026-10-26 | 23 days | Every WASM call result goes through a validity check; `recover` validates the recovery id. The WASM binary is rebuilt (1,242,788 -> 1,242,474 bytes) and was not reviewed as source. |
| `bip39` | `3.1.0` -> `3.1.2` | 2026-10-13 | 36 days | Hex entropy must be even-length hex; word lists are looked up by own property only. |
| `cbor-x` | `1.6.6` -> `1.6.9` | 2026-11-02 | 16 days | Decoder: truncation detection, container and property limits, break-code handling, nested-decode state. New `scan.js`. Optional native `cbor-extract` `2.2.2` -> `2.2.3` (its install script stays disallowed; the JavaScript decoder is used). |
| `@keystonehq/bc-ur-registry` | `0.8.0` -> `0.8.1` | 2026-10-13 | 36 days | Bundled CBOR decoder gains depth, size, UTF-8 and safe-integer checks. `CryptoPSBTExtend` validates the coin id and renumbers Dash (not used here). |

Transitive packages that changed with `bitcoinjs-lib`: `bip174` `3.0.0` -> `3.0.1` and `varuint-bitcoin` `2.0.0` -> `2.0.1` (dependency ranges only), and in the verifier lockfiles `uint8array-tools` `0.0.9` -> `0.0.10` (bounds-checked index reads replace `Buffer.from` copies; the root lockfile already overrode it to `0.0.10`).

## Vector provenance

Address vectors were regenerated with `npm run generate:repeatable` in `scripts/verify-addresses` (Bitcoin Core 31.1 on five networks, Go 1.27.1, the pinned Python image) and then passed `npm run verify:repeatable`. Compared with the previous files, `scripts/verify-addresses/output/verified-vectors.ts` and `server/tests/fixtures/verified-address-vectors.ts` each differ in 486 lines: 485 `bitcoinjs-lib` version labels (`7.0.2` -> `7.0.5`) and one `sourceSha256` value. No address, key or path changed.

PSBT vectors were regenerated with `scripts/ci/run-psbt-core-subject.sh regenerate` under the cleanup coordinator. `generated-psbt-vectors.ts` differs in five version labels; `generated-signed-psbt-vectors.ts` is byte-identical.

## Pins updated

- `config/ci-toolchain-lock.json` (`bitcoinjs-lib`, `cbor-x` version and integrity).
- `docs/reference/generated/hardware-wallet-compatibility.{json,md}` (signing dependency digest).
- `config/jade-emulator-proof.json` and `scripts/ci/run-jade-emulator-proof.sh` (`cbor-x` version and integrity).
- `scripts/ci/npm-install-script-policy.json` (`cbor-extract` `2.2.3`; scripts unchanged).

## Verification

Passed locally: `check:supply-chain-locks`, the install-script policy (lockfile and installed tree), the deprecation inventory, the audit gate, all typechecks, lint, the production build, the frontend suite (10,262 tests), the server unit suite (18,551), the gateway suite (564) and the `tests/ci` shell suites.

## Open proof limits

The Ledger, Trezor and Jade emulator proofs, the wallet-safety mutation proofs and the Playwright suites were not run locally. The pull request's CI is the evidence for those, and for `tiny-secp256k1`'s rebuilt WASM binary in particular.
