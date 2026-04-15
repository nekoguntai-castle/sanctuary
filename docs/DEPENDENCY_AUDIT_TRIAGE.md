# Dependency Audit Triage

Snapshot date: 2026-04-14

Commands run:
- `npm audit` (repo root, `server/`, and `gateway/`) for the quality-gate view
- `npm audit --omit=dev` (repo root)
- `npm audit --omit=dev` (`server/`)
- `npm audit --omit=dev --omit=optional` (`gateway/`)

## Current state

- Root full install: `16 low`, `0 moderate`, `0 high`, `0 critical`
- Root production install (`--omit=dev`): `14 low`, `0 moderate`, `0 high`, `0 critical`
- Server full install and production install: `0 low`, `3 moderate`, `0 high`, `0 critical`
- Gateway full install: `8 low`, `0 moderate`, `0 high`, `0 critical`
- Gateway production install (`--omit=dev --omit=optional`): `0` vulnerabilities

## Root findings (14 production low, 16 full-install low)

Fixed in this refresh:
- Transitive `axios` from the Trezor/Stellar SDK chain was updated in `package-lock.json` from `1.14.0` to `1.15.0`, clearing the critical Axios SSRF/header-injection advisories reported by `npm audit --omit=dev`.
- Transitive `follow-redirects` from the Trezor/Stellar/Axios chain was updated in `package-lock.json` from `1.15.11` to `1.16.0` by the non-forced `npm audit fix` path, clearing the moderate custom-header redirect advisory.

Main chains:
- Trezor chain
  - Direct: `@trezor/connect-web`
  - Transitive: `@trezor/connect` -> `@trezor/utxo-lib`/`@trezor/blockchain-link*` -> `tiny-secp256k1`/`crypto-browserify`
- Ledger chain
  - Direct: `@ledgerhq/hw-app-btc`
  - Transitive: `bitcoinjs-lib`/`@ledgerhq/psbtv2` -> `bip32`/`tiny-secp256k1`
- Browser polyfill chain
  - Direct: `vite-plugin-node-polyfills`
  - Transitive: `node-stdlib-browser` -> `crypto-browserify` -> `browserify-sign`/`create-ecdh`
Notes:
- Several findings in `@trezor/*` currently have no available fix in-place.
- The remaining advisory is the low-severity `elliptic` primitive advisory inherited through hardware-wallet and browser-polyfill dependency trees; npm reports no non-force fix.
- The two extra full-install-only root findings are in the dev-time `vite-plugin-node-polyfills` chain. npm proposes a major downgrade to `vite-plugin-node-polyfills@0.2.0`, so this is not a safe remediation path.

## Server findings (3 moderate)

Fixed in this refresh:
- Transitive `follow-redirects` from the server Axios chain was updated in `server/package-lock.json` from `1.15.11` to `1.16.0`, clearing the moderate custom-header redirect advisory without a forced package downgrade.

Main chain:
- Direct dev dependency: `prisma`
- Transitive: `prisma` -> `@prisma/dev` -> `@hono/node-server`

Notes:
- `npm audit --omit=dev` reports `@hono/node-server <1.19.13` through the Prisma dev tooling chain.
- The suggested remediation is `npm audit fix --force`, which would install `prisma@6.19.3` and downgrade from the current Prisma 7 line. That is a breaking downgrade path, not a safe release fix.
- The vulnerable package is not used as an application static-file server in Sanctuary; it is inherited through Prisma tooling.

## Gateway findings

Fixed in this refresh:
- Transitive `follow-redirects` from the gateway Google/Firebase HTTP chain was updated in `gateway/package-lock.json` from `1.15.11` to `1.16.0`, clearing the moderate custom-header redirect advisory without a forced package downgrade.

Main chain:
- Direct: `firebase-admin`
- Transitive: `@google-cloud/firestore`, `@google-cloud/storage`, `google-gax`, `retry-request`, `teeny-request`, `http-proxy-agent`, `@tootallnate/once`

Notes:
- Full-install gateway audits have historically reported low findings in `firebase-admin` optional dependencies and suggested `firebase-admin@10.3.0`, which is a major backwards move, not a safe remediation path.
- The advisory chain is in `firebase-admin` optional dependencies (`@google-cloud/firestore`/`@google-cloud/storage` subtree).
- Production gateway image now prunes optional dependencies (`npm prune --production --omit=optional` in `gateway/Dockerfile`), which removes this chain from deployed runtime.
- Validation command: `npm audit --omit=dev --omit=optional` in `gateway/` reports `0` vulnerabilities.

## Decision

Disposition: `fix + monitor` for the root, server, and gateway Axios/`follow-redirects` advisories that had non-forced remediation paths; `accept + monitor` for the remaining root low-severity transitive advisories and server Prisma dev-chain moderate advisory; gateway optional-dependency findings are mitigated in production via optional-dependency pruning.

Reasoning:
- No moderate/high/critical root production findings remain after the Axios and `follow-redirects` lockfile updates.
- Remaining proposed `npm audit` remediation paths are unavailable, force/downgrade, or major-change paths that increase functional regression risk.
- Remaining root findings are in upstream hardware-wallet or browser-polyfill dependency trees where direct in-place fixes are unavailable or not safe.
- The server moderate advisory is inherited through Prisma tooling, and npm's proposed remediation would downgrade Prisma across a major version.
- The gateway low findings are in optional Firebase/Google dependency trees; the production install proof path omits optional dependencies and audits clean.

## Revisit triggers

Re-triage immediately if any of the following occur:
- Any root advisory severity rises above low.
- Any server advisory severity rises above moderate or reaches a runtime-exposed dependency path.
- A same-major, non-downgrade remediation path becomes available for `@ledgerhq/*`, `@trezor/*`, `vite-plugin-node-polyfills`, Prisma, or `firebase-admin`.
- Planned upgrades touching hardware-wallet stack, polyfill stack, Prisma, or Firebase stack.

Recommended cadence:
- Re-run audits on each release branch cut and at least once per month.
