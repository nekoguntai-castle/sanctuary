# Compatible verifier library maintenance

The address verifier updates btcec/v2 2.3.6 → 2.5.0 and btcutil 1.1.6 →
1.2.0, keeping btcd 0.25.0 and the reviewed Go 1.27.1 / x/crypto 0.56.0
security floor. The Go proxy records the new btcec and btcutil releases on
2026-05-15 and 2026-05-14, respectively, satisfying the release-age policy.
`go get` and `go mod tidy` resolve the required chainhash/v2, anet and Decred
crypto changes and remove stale go.sum entries. `go test ./...` compiles
successfully (no Go unit tests in this module), and `go mod verify` passes.

The standalone address project also aligns TypeScript's manifest to the
already-installed 6.0.3, moves tsx 4.21.0 → 4.23.13 and Valibot 1.4.2 →
1.5.0. The tsx update removes its obsolete get-tsconfig/resolve-pkg-maps
closure; its esbuild range now matches the existing 0.28.1 override. Clean
install with the existing script policy, TypeScript check and npm audit pass
with zero advisories.

## btcd 0.26.2 is a migration, not compatible maintenance

A disposable copy tested all three proposed btcsuite targets together. The
package manager fails before compilation:

```
github.com/btcsuite/btcd/btcutil imports
    github.com/btcsuite/btcd/chaincfg: cannot find module providing package github.com/btcsuite/btcd/chaincfg
github.com/btcsuite/btcd/btcutil imports
    github.com/btcsuite/btcd/wire: cannot find module providing package github.com/btcsuite/btcd/wire
```

btcd 0.26.2 moved these packages into new /v2 modules, while btcutil 1.2.0
still imports the old paths. Moving btcd therefore belongs with the separately
planned btcutil/v2 and verifier import-path/API migration. Keeping btcd 0.25.0
allows the two compatible library updates to compile independently. The
failed combined candidate was discarded; no failed module graph is shipped.

## Remaining verifier image candidates

Python 3.14.7-slim-bookworm's proposed manifest
`sha256:82bc3c539b8813ada9d68c63b40158fa002f7f33de9bf3312a3dfdc0620dff56`
was pushed at 2026-09-19T08:11:26Z, so it is below the three-day cooldown.
It is not eligible for the current run even before the Python minor-version
wheel and corpus compatibility review.

Bitcoin Core 29.4 manifest
`sha256:96b6aae8a8efa8985b8aa64b40b5eeaac42c09f81acbc9da70e3634fe9274dfe`
was pushed 2026-07-15T15:01:29Z and is age-eligible. Promotion must coordinate
the shared address/Core Compose image with the independent PSBT proof manifest,
both address and PSBT generated provenance, and both full proof lanes. It is
not part of this library-only batch.

## Final library proof

The full pinned 480-case address generator and a second independent
byte-for-byte verification both succeed. Derived results are unchanged;
both fixture files change only their source provenance digest. Generation
cleanup returns `cleaned`. Supply-chain locks, npm install-script policy and
npm ci callsite checks pass. Fresh OSV inspection of the 13-package Go graph
reports only GO-2026-5932, the previously documented unreachable openpgp
package advisory, and no new findings from the upgraded graph.

## Remaining manifest and GHCR dispositions

`@types/node` 24.21.0 does not exist in the npm registry's published version
map; Node's 24.21.0 runtime proposal must not be interpreted as a matching
DefinitelyTyped release. The standalone tiny-secp256k1 lock already resolves
2.2.4 (published 2025-06-21) under its compatible ^2.2.3 range. Raising this
range floor alone changes no installed code or security finding.

Public GHCR manifests were read without credentials. Their exact candidate
identity and amd64 image build times are:

| Image | Candidate index / manifest | amd64 image created (UTC) |
| --- | --- | --- |
| catthehacker/ubuntu:act-22.04 | sha256:f5f5c29208c4fd541704fe7b8df33d3bf620ce4ac46f36853b7abeb0159705c4 | 2026-08-15T12:56:18Z |
| ledgerhq/speculos:latest | sha256:6ed9eefd51cddd862b746719af4cd7a3265fe43d0588c388359753cab8d46d11 | 2026-09-01T10:16:20Z |
| ledgerhq/ledger-app-builder/ledger-app-builder-lite:latest (amd64) | sha256:85e029ee342feabeb99d34f4c450d7b60336497b5804c11953b9a8736d9b9f29 | 2026-09-18T16:20:54Z |

The builder is definitively younger than three days. The other two build
timestamps are older, but build time is not registry publication time.
GitHub's container-package version endpoints for all three returned HTTP 401
without an authenticated lookup token, so publication-age verification
remains externally blocked. Preserve the existing proven images until that
metadata is available, then rebuild/canary the runner parent update and run
the paired Speculos/app-builder signing proofs before changing those pins.
