# Issue #696 applicability audit

Date: 2026-08-08

Baseline: `origin/main` at `0114fe55`

Issue snapshot: live Forgejo body, scan target `9b273b4c`, updated
2026-08-08T17:17Z

## Conclusion

The scanner's current headline is 0 critical, 10 high, 14 medium, 22 low,
34 unknown, 1 secret, and 20 suppressed. Those counts do not represent 101
distinct Sanctuary vulnerabilities. No current critical/high shipped-runtime
exploit was confirmed. Most findings are build/docs/test-only, operation-specific
code paths Sanctuary does not call, duplicate package fan-out, or static-analysis
false positives.

Two residuals matter:

1. `elliptic@6.6.1` is in the shipped lazy Trezor browser path. It is key-adjacent,
   has no fixed upstream release, and remains a real watch item already tracked
   by #537.
2. The shipped wallet UI executes remote Tailwind CDN JavaScript and loads two
   external font stylesheets without a Content Security Policy. The scanner only
   reports the Fontshare stylesheet, so it understates the real supply-chain
   surface. This deserves a separate fix to remove/self-host those assets and add
   CSP.

## Critical/high applicability

| Finding | Current evidence | Disposition |
|---|---|---|
| Former 7 critical `golang.org/x/crypto@0.50.0` findings | #699 pins `v0.54.0`. `go list -deps` shows only `ripemd160` and `sha3`; the cited SSH/OpenPGP paths are absent. The verifier is CI/vector tooling, not a shipped component. | Resolved and was not reachable through the cited code paths. |
| 1 reported secret | `.github/workflows/verify-vectors.yml:321-324` uses the literal `sanctuary:sanctuary-verify` for ephemeral regtest RPC on port 18443. | False secret; add a scanner suppression with the regtest rationale. |
| 2 `image-size` DoS findings | Existing audit exceptions prove they are reached only by the Docusaurus docs build and are absent from shipped containers. | Build-only, already accepted. |
| 6 insecure-WebSocket findings | Three are prose/drawio, one is a config doc comment, one is a local performance proof, and the executable default is a cleartext gateway-to-backend WebSocket on port 3001 within the private Compose network while external gateway traffic defaults to TLS. | No external cleartext WebSocket exposure. Keep a precise architectural suppression; require TLS-secured WebSockets if the backend URL ever crosses an untrusted network. |
| `child_process` in the PSBT verifier | `spawn(cliPath, cliArgs)` does not invoke a shell. The tool is not copied into runtime images, and the vector generator currently uses direct RPC. | Developer-tool false positive, not a shipped injection path. |

## Dependency findings that reach runtime but not the vulnerable operation

- Hono and `@hono/node-server` arrive through the MCP SDK, but Sanctuary uses
  the SDK's Express transport/request listener, not Hono `serveStatic`, JSX,
  memo, language/CORS, or API Gateway adapters named by the advisories.
- `qs` is present, but the reported crash requires `qs.stringify()` with comma
  format and `encodeValuesOnly`; Sanctuary/Express uses parsing and does not call
  that operation.
- `body-parser@2.2.2` is in the LLM proxy runtime, but the finding requires an
  invalid limit; Sanctuary supplies the fixed valid value `1mb`.
- `uuid@9` is under Firebase Admin's optional storage chain. The gateway runtime
  omits optional dependencies and uses Firebase app/messaging, while the finding
  requires v3/v5/v6 with a caller-provided undersized buffer.
- `valibot@1.4.1` reaches bitcoinjs/bip32 validation, but its advisory requires
  `record()` issue paths followed by `flatten()`; the runtime dependency path
  does not call `flatten()`.
- `elliptic@6.6.1` is different: it reaches hardware-wallet crypto code and has
  no fixed version. Preserve #537 as the explicit watch item.

## Medium findings

Most are false positives or tooling-only: static route regexes, an escaped cache
regex, `df` percentage parsing, a backup filename sourced from `readdir()` with a
fixed prefix/suffix, preference paths that explicitly reject prototype keys,
fixed attachment content types, CI shell parsing, and Prisma-check tooling.

Three deserve differentiated treatment:

- `server/src/services/webhooks/payloadProfiles/mappedJson.ts` writes
  administrator-configured keys into a plain local object. A `__proto__` key can
  alter that output object's prototype, though it does not pollute global state
  and the object is immediately serialized. Minor hardening is reasonable.
- The gateway logger passes a dynamic format string plus a second console
  argument; `%` sequences can affect log rendering. This is a low-grade
  log-integrity hardening candidate.
- `src/index.html:213-233` is a real shipped boundary. It injects
  `https://cdn.tailwindcss.com/3.4.17` JavaScript and loads Google/Fontshare CSS.
  `docker/frontend/Dockerfile:48,68-69` builds and ships that HTML, and neither
  Nginx template sets CSP. The source and current `dist/index.html` both contain
  the remote URLs.

## Verification performed

- Live issue body/comments were compared with current `origin/main`.
- `npm audit --omit=dev --json`: 0 high and 0 critical; newer moderate/low
  advisories remain for normal dependency triage.
- `go mod why -m golang.org/x/crypto` and
  `go list -buildvcs=false -deps ./...` confirmed the Go dependency closure.
- Runtime Dockerfile copy stages, Vite input/output, Compose networking, router
  mode, and current scanner baseline were inspected directly.

## Recommended issue disposition

Keep #696 only as a rolling monitor, not as a count of project vulnerabilities.
Suppress the regtest credential and prose/tooling findings in scanner config;
open a focused frontend CDN/CSP issue; retain #537 for `elliptic`; optionally
harden mapped webhook keys and logger formatting; then refresh the scan against
current `main` and classify the 34 unknowns before using its aggregate counts.
