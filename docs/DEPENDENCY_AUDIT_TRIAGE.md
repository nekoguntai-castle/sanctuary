# Dependency Audit Triage

Snapshot date: 2026-04-06

Commands run:
- `npm audit --json` (repo root)
- `npm audit --json` (`server/`)
- `npm audit --json` (`gateway/`)

## Current state

- Root: `10 low`, `0 moderate`, `0 high`, `0 critical`
- Server: `0` vulnerabilities
- Gateway: `8 low` in full install; `0` when optional deps are omitted for production (`--omit=optional`)

## Root findings (10 low)

Main chains:
- Trezor chain
  - Direct: `@trezor/connect-web`
  - Transitive: `@trezor/connect` -> `@trezor/utxo-lib`/`@trezor/blockchain-link*` -> `tiny-secp256k1`/`crypto-browserify`
Notes:
- Several findings in `@trezor/*` currently have no available fix in-place.

## Gateway findings (8 low)

Main chain:
- Direct: `firebase-admin`
- Transitive: `@google-cloud/firestore`, `@google-cloud/storage`, `google-gax`, `retry-request`, `teeny-request`, `http-proxy-agent`, `@tootallnate/once`

Notes:
- `npm audit` suggests `firebase-admin@10.3.0` as a fix target, which is a major backwards move, not a safe remediation path.
- The advisory chain is in `firebase-admin` **optional** dependencies (`@google-cloud/firestore`/`@google-cloud/storage` subtree).
- Production gateway image now prunes optional dependencies (`npm prune --production --omit=optional` in `gateway/Dockerfile`), which removes this chain from deployed runtime.
- Validation command: `npm audit --omit=dev --omit=optional --json` in `gateway/` reports `0` vulnerabilities.

## Decision

Disposition: `accept + monitor` for root low-severity transitive advisories; gateway low findings are mitigated in production via optional-dependency pruning.

Reasoning:
- No high/critical findings.
- Proposed `npm audit` remediation paths are downgrade/major-change paths that increase functional regression risk.
- Remaining findings are in upstream dependency trees where direct in-place fixes are unavailable or not safe.

## Revisit triggers

Re-triage immediately if any of the following occur:
- Any advisory severity rises above low.
- A same-major, non-downgrade remediation path becomes available for `@ledgerhq/*`, `@trezor/*`, or `firebase-admin`.
- Planned upgrades touching hardware-wallet stack, polyfill stack, or Firebase stack.

Recommended cadence:
- Re-run audits on each release branch cut and at least once per month.
