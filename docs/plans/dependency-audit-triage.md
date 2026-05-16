# Dependency Audit Triage

Snapshot date: 2026-05-16 Pacific/Honolulu

Commands run:
- `npm audit --json` (repo root workspace lock)
- `npm audit --omit=dev --workspaces=false --json` (root application package without workspaces)
- `npm --prefix server audit --json`
- `npm --prefix gateway audit --json`
- `npm --prefix llm-egress-proxy audit --json`
- `npm --prefix website audit --json`
- `npm --prefix scripts/verify-addresses audit --json`
- `npm --prefix scripts/verify-psbt audit --json`

Latest freshness check:
- Phase 4 refresh on 2026-05-16 Pacific/Honolulu: website `mermaid` moved from `11.14.0` to `11.15.0` in `website/package-lock.json`, clearing the Docusaurus docs-site moderate Mermaid advisories.
- Root workspace full audit still reports the Prisma dev-tool chain `prisma -> @prisma/dev -> @hono/node-server@1.19.11` as 3 moderate advisory records. The deployed app does not use Hono for runtime HTTP serving, and the vulnerable package is under Prisma's dev tooling. npm's proposed fix is a major downgrade to `prisma@6.19.3`; current `@prisma/dev@0.24.7` still pins `@hono/node-server@1.19.11`, so there is no safe same-major package fix today.
- Root application audit without workspaces reports `10 low`, `0 moderate`, `0 high`, and `0 critical`.
- Package-local `server/` and `gateway/` audits return `ENOLOCK` because those workspaces intentionally rely on the root workspace lockfile; treat the root workspace audit as the evidence owner for those dependency trees.
- Targeted P2-01/P2-01a refresh on 2026-05-09 Pacific/Honolulu: root production audit at moderate threshold passes with only the accepted low-severity Trezor `elliptic` chain; server and LLM egress proxy production audits report `0` vulnerabilities.
- Full unskipped `npm run quality` passed on 2026-04-15 Pacific/Honolulu. Its high-severity audit lane passed for root, server, and gateway while still surfacing the accepted lower-severity findings below.
- `npm audit --omit=dev --audit-level=moderate` at the repo root reports `10 low` advisories in the Trezor hardware-wallet `elliptic` chain and no moderate/high/critical advisories.
- `npm --prefix server audit --omit=dev --audit-level=moderate` reports `0` vulnerabilities after bumping the `hono` override from `4.12.14` to `4.12.18`.
- `npm audit --json` in `gateway/` reports `8 low` advisories through Firebase/Google optional dependency trees; `npm audit --omit=dev --omit=optional --json` reports `0` vulnerabilities.
- `npm --prefix llm-egress-proxy audit --omit=dev --audit-level=moderate` reports `0` vulnerabilities after updating `express-rate-limit` to `8.5.1` and transitive `ip-address` to `10.2.0`.
- Disposition is updated: `fixed` for the server Prisma/MCP Hono moderate chain and LLM egress proxy `ip-address` moderate chain; `accept + monitor` for the remaining root low and gateway optional-dependency low advisories.

## Current State

- Root full workspace install: `20 low`, `3 moderate`, `0 high`, `0 critical`; the 3 moderate records are the single Prisma dev-tool Hono chain.
- Root application package without workspaces (`--omit=dev --workspaces=false`): `10 low`, `0 moderate`, `0 high`, `0 critical`.
- Server and gateway package-local audit commands: `ENOLOCK`; covered by the root workspace lockfile.
- Website full install: `0` vulnerabilities after the Mermaid lockfile refresh.
- LLM egress proxy full install: `0` vulnerabilities
- `scripts/verify-addresses`: `5 low`, `0 moderate`, `0 high`, `0 critical`
- `scripts/verify-psbt`: `0` vulnerabilities

## Root Findings

Fixed in recent refreshes:
- Website Mermaid moved to `11.15.0`, clearing the Docusaurus docs-site moderate Mermaid Gantt DoS and CSS/HTML injection advisories without changing Docusaurus itself.
- Transitive `axios` from the Trezor/Stellar SDK chain was updated from `1.14.0` to `1.15.0`, clearing the critical Axios SSRF/header-injection advisories reported by `npm audit --omit=dev`.
- Transitive `follow-redirects` from the Trezor/Stellar/Axios chain was updated from `1.15.11` to `1.16.0`, clearing the moderate custom-header redirect advisory.
- Safe non-forced package updates were applied across Ledger, React, router, virtualized-list, Stryker, and Node type packages. These kept the tree current without accepting npm's force/downgrade remediation paths.

Remaining chains:
- Prisma dev-tool Hono chain
  - Direct workspace owner: `server` dev dependency `prisma`
  - Transitive: `prisma@7.8.0` -> `@prisma/dev@0.24.3` -> exact `@hono/node-server@1.19.11`
  - Disposition: accept and monitor until Prisma updates `@prisma/dev`; do not downgrade Prisma to `6.19.3`.
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
- No server runtime package change was needed in the 2026-05-16 refresh.
- `@modelcontextprotocol/sdk` already resolves to `@hono/node-server@1.19.14`.
- The remaining moderate Hono record is isolated to Prisma dev tooling under the root workspace lock, not the Express runtime server path.

Notes:
- `npm --prefix server audit --json` and `npm --prefix server audit --omit=dev --json` currently return `ENOLOCK` because `server/` is a root-lockfile workspace. Use the root workspace audit for server dependency evidence.
- npm's proposed remediation path for the Prisma dev-tool chain is a force/downgrade to `prisma@6.19.3`; that path is not acceptable for this codebase.
- Keep the Hono overrides under review during Prisma and MCP SDK upgrades so they can be removed once upstream pins safe versions directly.

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

## LLM Egress Proxy Findings

Current state:
- `zod@^4.3.4` is now a direct runtime dependency for request body schemas in `llm-egress-proxy/src/requestSchemas.ts`.
- `express-rate-limit` is updated to `8.5.1`, which pulls `ip-address@10.2.0` and clears the moderate XSS advisory in older `ip-address` HTML-emitting helpers.
- `npm --prefix llm-egress-proxy audit --omit=dev --audit-level=moderate` reports `0` vulnerabilities for the LLM egress proxy package.

Notes:
- Keep LLM egress proxy on the same Zod major line as `server/` and `gateway/` unless a deliberate compatibility reason appears.
- Re-run `npm audit --json` in `llm-egress-proxy/` whenever LLM egress proxy dependencies change; it is a small package and should stay at `0` advisories.

## Decision

Disposition: `fixed` for website Mermaid and LLM egress proxy `ip-address` moderate advisories; `accept + monitor` for the Prisma dev-tool Hono moderate chain until Prisma ships a safe same-major fix; `fix + monitor` for already-remediated Axios/`follow-redirects` advisories; `accept + monitor` for the remaining root low-severity transitive advisories and gateway optional-dependency low advisories.

Reasoning:
- No high or critical findings remain in any audited package tree.
- No moderate findings remain in the root application package without workspaces, website tree, LLM egress proxy tree, or hardware verification scripts.
- The remaining moderate records are all the same dev-tool Prisma Hono chain and npm's proposed fix is a major Prisma downgrade.
- LLM egress proxy remains clean after direct Zod validation and the `express-rate-limit` refresh.
- Remaining root findings are low-severity upstream hardware-wallet dependency paths where npm reports no available fix.
- Gateway low findings are in optional Firebase/Google dependency trees; the production install proof path omits optional dependencies and audits clean.
- The Prisma dev-tool Hono chain is accepted only for this dated snapshot and must be revisited when Prisma or `@prisma/dev` publishes a patched nested `@hono/node-server`.

## Revisit Triggers

Re-triage immediately if any of the following occur:
- Any root advisory severity rises above low.
- Any gateway advisory reaches a runtime-exposed dependency path or severity rises above low.
- A same-major, non-downgrade remediation path becomes available for `@ledgerhq/*`, `@trezor/*`, `vite-plugin-node-polyfills`, Prisma, MCP SDK, Hono, or `firebase-admin`.
- Planned upgrades touch the hardware-wallet stack, polyfill stack, Prisma/MCP/Hono stack, Firebase stack, or LLM egress proxy validation stack.
- The Hono overrides conflict with a future Prisma/MCP upgrade or become redundant.

Recommended cadence:
- Re-run audits on each release branch cut and at least once per month.
