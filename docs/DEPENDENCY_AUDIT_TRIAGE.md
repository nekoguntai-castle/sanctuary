# Dependency Audit Triage

Snapshot date: 2026-04-15 Pacific/Honolulu

Commands run:
- `npm run quality` for the full quality-gate view
- `npm audit --omit=dev --json` (repo root)
- `npm audit --json` and `npm audit --omit=dev --json` (`server/`)
- `npm audit --json` and `npm audit --omit=dev --omit=optional --json` (`gateway/`)
- `npm audit --json` (`ai-proxy/`)

Latest freshness check:
- Full unskipped `npm run quality` passed on 2026-04-15 Pacific/Honolulu. Its high-severity audit lane passed for root, server, and gateway while still surfacing the accepted lower-severity findings below.
- `npm audit --omit=dev --json` at the repo root reports `14 low` advisories in the hardware-wallet/browser-polyfill `elliptic` chain and no moderate/high/critical advisories.
- `npm audit --json` and `npm audit --omit=dev --json` in `server/` report `0` vulnerabilities after the Prisma/tooling refresh and `@hono/node-server` override.
- `npm audit --json` in `gateway/` reports `8 low` advisories through Firebase/Google optional dependency trees; `npm audit --omit=dev --omit=optional --json` reports `0` vulnerabilities.
- `npm audit --json` in `ai-proxy/` reports `0` vulnerabilities after adding direct request-schema validation.
- Disposition is updated: `fixed` for the previous server Prisma-tooling moderate chain; `accept + monitor` for the remaining root low and gateway optional-dependency low advisories.

## Current State

- Root full install: `16 low`, `0 moderate`, `0 high`, `0 critical`
- Root production install (`--omit=dev`): `14 low`, `0 moderate`, `0 high`, `0 critical`
- Server full install and production install: `0` vulnerabilities
- Gateway full install: `8 low`, `0 moderate`, `0 high`, `0 critical`
- Gateway production install (`--omit=dev --omit=optional`): `0` vulnerabilities
- AI proxy full install: `0` vulnerabilities

## Root Findings

Fixed in recent refreshes:
- Transitive `axios` from the Trezor/Stellar SDK chain was updated from `1.14.0` to `1.15.0`, clearing the critical Axios SSRF/header-injection advisories reported by `npm audit --omit=dev`.
- Transitive `follow-redirects` from the Trezor/Stellar/Axios chain was updated from `1.15.11` to `1.16.0`, clearing the moderate custom-header redirect advisory.
- Safe non-forced package updates were applied across Ledger, React, router, virtualized-list, Stryker, and Node type packages. These kept the tree current without accepting npm's force/downgrade remediation paths.

Remaining chains:
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
- The Ledger audit remediation path proposes a major-version move to `@ledgerhq/hw-app-btc@6.7.0`, which is not a safe automatic fix from the current tree.
- The remaining advisory is the low-severity `elliptic` primitive advisory inherited through hardware-wallet and browser-polyfill dependency trees.
- The two extra full-install-only root findings are in the dev-time `vite-plugin-node-polyfills` chain. npm proposes a major downgrade to `vite-plugin-node-polyfills@0.2.0`, so this remains an unsafe remediation path.

## Server Findings

Fixed in this refresh:
- Prisma and related server packages were refreshed on the current major line.
- `server/package.json` now overrides `@hono/node-server` to `1.19.14`, clearing the Prisma dev-tooling moderate advisory without a forced downgrade to Prisma 6.
- `npm audit --json` and `npm audit --omit=dev --json` in `server/` both report `0` vulnerabilities.

Notes:
- The previous moderate chain was `prisma` -> `@prisma/dev` -> `@hono/node-server`.
- npm's former proposed remediation path was a force/downgrade to `prisma@6.19.3`; that path is no longer needed.
- Keep the override under review during Prisma upgrades so it can be removed once upstream pins a safe version directly.

## Gateway Findings

Fixed in recent refreshes:
- Transitive `follow-redirects` from the gateway Google/Firebase HTTP chain was updated from `1.15.11` to `1.16.0`, clearing the moderate custom-header redirect advisory without a forced package downgrade.
- Safe non-forced updates were applied to `firebase-admin`, `@parse/node-apn`, and Node type packages.

Remaining full-install chain:
- Direct: `firebase-admin`
- Transitive: `@google-cloud/firestore`, `@google-cloud/storage`, `google-gax`, `retry-request`, `teeny-request`, `http-proxy-agent`, `@tootallnate/once`

Notes:
- Full-install gateway audits still report low findings in `firebase-admin` optional dependency paths and suggest `firebase-admin@10.3.0`, which is a major backwards move.
- Production gateway image pruning omits optional dependencies (`npm prune --production --omit=optional` in `gateway/Dockerfile`), which removes this advisory chain from deployed runtime.
- Validation command: `npm audit --omit=dev --omit=optional --json` in `gateway/` reports `0` vulnerabilities.

## AI Proxy Findings

Current state:
- `zod@^4.3.4` is now a direct runtime dependency for request body schemas in `ai-proxy/src/requestSchemas.ts`.
- `npm audit --json` reported `0` vulnerabilities for the AI proxy package.

Notes:
- Keep AI proxy on the same Zod major line as `server/` and `gateway/` unless a deliberate compatibility reason appears.
- Re-run `npm audit --json` in `ai-proxy/` whenever AI proxy dependencies change; it is a small package and should stay at `0` advisories.

## Decision

Disposition: `fixed` for the server Prisma-tooling moderate advisory; `fix + monitor` for already-remediated Axios/`follow-redirects` advisories; `accept + monitor` for the remaining root low-severity transitive advisories and gateway optional-dependency low advisories.

Reasoning:
- No high or critical findings remain in any audited package tree.
- No moderate findings remain in the root production tree, server tree, or gateway tree.
- AI proxy remains clean after adding direct Zod validation.
- Remaining root findings are low-severity upstream hardware-wallet or browser-polyfill dependency paths where npm's proposed remediations are unavailable, force/downgrade, or major-change paths.
- Gateway low findings are in optional Firebase/Google dependency trees; the production install proof path omits optional dependencies and audits clean.
- The former server moderate advisory is cleared without downgrading Prisma.

## Revisit Triggers

Re-triage immediately if any of the following occur:
- Any root advisory severity rises above low.
- Any gateway advisory reaches a runtime-exposed dependency path or severity rises above low.
- A same-major, non-downgrade remediation path becomes available for `@ledgerhq/*`, `@trezor/*`, `vite-plugin-node-polyfills`, Prisma, or `firebase-admin`.
- Planned upgrades touch the hardware-wallet stack, polyfill stack, Prisma, Firebase stack, or AI proxy validation stack.
- The `@hono/node-server` override conflicts with a future Prisma upgrade or becomes redundant.

Recommended cadence:
- Re-run audits on each release branch cut and at least once per month.
