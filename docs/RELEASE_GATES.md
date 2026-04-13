# Sanctuary Release Gates

Date: 2026-04-12 (Pacific/Honolulu)
Status: Phase 4 release-gate baseline; frontend test typecheck now promoted to a required gate

This document records the checks that should protect the A-grade engineering goals in `docs/plans/codebase-health-assessment.md`. A release should not claim an A grade in a domain unless the matching gate has passed or the plan explicitly marks the gate as pending with an owner and date.

## Policy

- Required gates block a release when they fail.
- Pending gates do not prove an A-grade claim yet. They are tracked here so skipped data-dependent work is visible instead of silently ignored.
- Area-specific gates are required when the release touches that area or when the release notes claim an improvement in that area.
- Accepted dependency findings must remain documented in `docs/DEPENDENCY_AUDIT_TRIAGE.md`; new high or critical production advisories require a fix or explicit risk acceptance before release.

## Required Gates

| Area | Gate | Evidence | Status |
| --- | --- | --- | --- |
| Frontend correctness | Strict app and test typecheck | `npm run typecheck:app` and `npm run typecheck:tests`; the Test Suite quick/full frontend lanes run both before frontend tests | Required |
| Frontend tests | Threshold-enforced coverage | `npm run test:coverage` or the `full-frontend-tests` CI job | Required for main/release |
| Backend build | TypeScript build and Prisma generation | `cd server && npm run build` | Required |
| Backend tests | Unit and integration coverage | `cd server && npm run test:unit -- --coverage` and `cd server && npm run test:integration`, or the `full-backend-tests` CI job | Required for main/release |
| Gateway build | TypeScript build | `cd gateway && npm run build` | Required |
| Gateway tests | Threshold-enforced coverage | `cd gateway && npm run test:coverage` or the `full-gateway-tests` CI job | Required for main/release |
| Critical security logic | Mutation gate for auth, access control, address derivation, and PSBT validation | `cd server && npm run test:mutation:critical:gate` or the `full-critical-mutation` CI job | Required when touched; required for main/nightly |
| Browser auth and CSP | API-client cookie auth, CSRF double-submit, refresh flow, and route-scoped Swagger CSP | `npx vitest run tests/api/client.test.ts tests/api/refresh.test.ts tests/services/websocket.test.ts tests/contexts/UserContext.test.tsx`; `cd server && npx vitest run tests/unit/middleware/csrf.test.ts tests/unit/middleware/auth.test.ts tests/unit/api/auth.test.ts tests/unit/api/openapi.test.ts tests/unit/websocket/auth.test.ts` when backend auth/CSP/docs routing changes | Required when touched |
| API/gateway contracts | Contract and drift-prone boundary tests | Targeted tests for gateway HMAC, WebSocket auth, mobile permission, request logging, body parsing, gateway whitelist, and new/touched schemas | Required when touched |
| Dependency security | Production advisory review | `npm audit --omit=dev` in root and `server/`; `cd gateway && npm audit --omit=dev --omit=optional`; plus documented accepted findings | Required before release |
| Container/install validation | Fresh install, install script, container health, auth flow | `.github/workflows/install-test.yml` release gate | Required for release candidates/releases |
| Operations supportability | Runbook coverage and proof for backup/restore, gateway audit persistence, alert receiver delivery, and monitoring stack behavior | `docs/OPERATIONS_RUNBOOKS.md` updated when alerts or operational flows change; `npm run test:ops:phase2` when backup/restore or in-process gateway audit paths are touched; `npm run ops:gateway-audit:phase2` when backend/gateway containers or gateway audit delivery paths are touched; `npm run ops:monitoring:phase2` when monitoring Compose, Prometheus/Loki/Grafana/Jaeger/Alertmanager, or Promtail paths are touched; `npm run ops:alert-receiver:phase2` when Alertmanager routing or receiver config is touched | Required when touched |
| Performance and scale | Phase 3 benchmark harness in strict mode | `npm run perf:phase3:compose-smoke` for disposable local authenticated capacity proof; `SANCTUARY_BENCHMARK_STRICT=true npm run perf:phase3` with privacy-safe calibrated scenario inputs | Local proof complete; pending privacy-safe calibrated evidence |

## Phase 3 Pending Privacy-Safe Evidence

These gates are required before the scalability/performance domain can move to A:

- Local authenticated capacity coverage now has disposable Compose proof in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T02-50-46-877Z.md`, with benchmark output in `docs/plans/phase3-benchmark-2026-04-13T02-51-11-475Z.md`; keep rerunning `npm run perf:phase3:compose-smoke` when Compose startup, seeded auth, benchmark provisioning, synthetic large-wallet history, WebSocket fanout, backup validation/restore, worker queue handler, worker scale-out, Electrum ownership, Redis-backed backend scale-out, backend fanout paths, Nginx backup payload limits, or Postgres/Redis capacity snapshot logic change.
- Privacy-safe transaction history and wallet sync queue benchmarks with `SANCTUARY_TOKEN` and `SANCTUARY_WALLET_ID`, using generated/regtest data or operator-owned testnet wallets only; the local synthetic 10,000-transaction gate is repository-controlled regression evidence, not calibrated target-environment evidence.
- Approved backup restore only in a restore-safe environment, with `SANCTUARY_ADMIN_TOKEN`, `SANCTUARY_BACKUP_FILE`, and `SANCTUARY_ALLOW_RESTORE=true`; the disposable Compose smoke proves a generated 6.53 MiB backup with 10,076 restored records, but not an approved support-size backup.
- Privacy-safe WebSocket fanout with expected client counts and generated or operator-owned testnet sync/transaction events; the local Compose smoke now proves the authenticated wallet-specific subscription path and 64-client two-backend Redis bridge delivery.
- Privacy-safe worker queue processing under generated sync, notification, maintenance, autopilot, and intelligence job volume; the local Compose smoke now proves a repeated 60-job handler profile and proves two-worker diagnostic processing/ownership.
- Privacy-safe backend scale-out load/capacity evidence; the local 64-client two-backend Redis WebSocket smoke is recorded in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T02-50-46-877Z.md`.
- Privacy-safe worker scale-out queue-load and Electrum subscription-volume evidence before production worker replica support is broadened beyond the local smoke boundary.

Do not benchmark third-party real-world wallets, addresses, or public wallet histories. Public testnet availability can be used for operator-owned fixture wallets, but scale should come from generated/regtest data or approved non-production testnet wallets rather than profiling someone else's wallet activity.

Record benchmark output under `docs/plans/` and link it from `docs/plans/codebase-health-assessment.md`.

## Phase 4 Typecheck Gate

`npm run typecheck:tests` passed after the Phase 4 unused-symbol fixture cleanup and is now a required frontend correctness gate alongside `npm run typecheck:app`.

## Phase 4 Browser Auth Gate

**Resolved as of 2026-04-13.** The HttpOnly cookie migration (ADR 0001) and Web Locks-coordinated refresh flow (ADR 0002) shipped together. See ADR 0001/0002 Resolution sections and `docs/OPERATIONS_RUNBOOKS.md` "Browser Auth Cookies" for the full behavior.

- The access token lives in a `sanctuary_access` HttpOnly, Secure, SameSite=Strict cookie. Scripts cannot read it.
- The refresh token lives in a `sanctuary_refresh` HttpOnly cookie scoped to `Path=/api/v1/auth/refresh`. The browser never sends it to any other endpoint.
- CSRF is enforced via a `sanctuary_csrf` readable double-submit cookie echoed as `X-CSRF-Token` on POST/PUT/PATCH/DELETE when the request authenticates via cookie. `Authorization: Bearer` requests (mobile/gateway) are exempt.
- Proactive refresh fires 60s before `X-Access-Expires-At`; reactive refresh on 401 retries the request once; `navigator.locks` serializes refresh across same-origin tabs; BroadcastChannel propagates `refresh-complete` and `logout-broadcast` state.
- Refresh-on-401 exempt list is only the four credential-presentation endpoints: `/auth/login`, `/auth/register`, `/auth/2fa/verify`, `/auth/refresh`. `/auth/me`, `/auth/logout`, and `/auth/logout-all` refresh-and-retry on 401 so valid-session recovery and server-side revocation both work.
- The WebSocket upgrade reads `sanctuary_access` from the `Cookie` header; the deprecated `?token=` query parameter path is removed. The client waits for the server's `'connected'` welcome message before sending any subscribe/unsubscribe frames (gating on `readyState === OPEN` races the server's async cookie auth).

Gate: `tests/api/client.test.ts`, `tests/api/refresh.test.ts`, `tests/services/websocket.test.ts`, `tests/contexts/UserContext.test.tsx`, `server/tests/unit/middleware/csrf.test.ts`, `server/tests/unit/middleware/auth.test.ts`, `server/tests/unit/api/auth.test.ts`, and `server/tests/unit/websocket/auth.test.ts` must all pass. The 100% frontend coverage gate must stay green for `src/api/refresh.ts`, the 401 interceptor branches in `src/api/client.ts`, and the `isServerReady` branches in `services/websocket.ts`.
