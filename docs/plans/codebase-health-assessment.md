# Codebase Health Assessment

Date: 2026-04-14 (Pacific/Honolulu)
Owner: TBD
Status: Refreshed assessment; the `/grade` implementation-adjusted score is 82/100 (B), Phase 3 repository-controlled local capacity proof is complete, Phase 4 test typecheck and dependency-audit triage gates are current, and the next score-moving work is lizard baseline reduction plus secret-scan false-positive cleanup

## Scope

This assessment reviews the repository across extensibility, scalability, performance, perpetual operations and monitoring/supportability, security, and technical debt.

Inputs used:

- Static review of the React/Vite frontend, Express backend, mobile gateway, AI proxy, Docker deployment, monitoring stack, route contracts, and tests.
- Existing coverage artifacts in `coverage/`, `server/coverage/`, and `gateway/coverage/`.
- Phase 3 local smoke benchmark records in `docs/plans/phase3-benchmark-2026-04-12T04-00-40-678Z.md`, `docs/plans/phase3-benchmark-2026-04-12T05-12-14-935Z.md`, `docs/plans/phase3-benchmark-2026-04-13T00-06-30-381Z.md`, `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T00-04-57-821Z.md`, `docs/plans/phase3-benchmark-2026-04-13T00-24-08-028Z.md`, `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T00-23-45-258Z.md`, `docs/plans/phase3-benchmark-2026-04-13T00-40-31-291Z.md`, `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T00-40-08-363Z.md`, `docs/plans/phase3-benchmark-2026-04-13T00-55-56-530Z.md`, `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T00-54-44-886Z.md`, `docs/plans/phase3-benchmark-2026-04-13T01-29-09-675Z.md`, `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T01-28-46-631Z.md`, `docs/plans/phase3-benchmark-2026-04-13T01-50-09-677Z.md`, `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T01-49-46-785Z.md`, `docs/plans/phase3-benchmark-2026-04-13T02-12-50-588Z.md`, `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T02-12-27-332Z.md`, `docs/plans/phase3-benchmark-2026-04-13T02-21-33-723Z.md`, and `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T02-21-10-302Z.md`.
- Latest Phase 3 local capacity profile in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T02-50-46-877Z.md`, with underlying benchmark output in `docs/plans/phase3-benchmark-2026-04-13T02-51-11-475Z.md`.
- Phase 2 operations proof records in `docs/plans/phase2-operations-proof-2026-04-12T08-44-39-1000.md`, `docs/plans/phase2-monitoring-smoke-2026-04-12T22-42-59-008Z.md`, `docs/plans/phase2-gateway-audit-compose-smoke-2026-04-12T23-18-24-249Z.md`, and `docs/plans/phase2-alert-receiver-smoke-2026-04-12T23-33-46-561Z.md`.
- Operations, scalability, extension-point, and release-gate documentation in `docs/OPERATIONS_RUNBOOKS.md`, `docs/SCALABILITY_AND_PERFORMANCE.md`, `docs/EXTENSION_POINTS.md`, and `docs/RELEASE_GATES.md`.
- Fresh lightweight verification:
  - `npm run typecheck:app` passed.
  - `cd server && npm run build` passed.
  - `cd gateway && npm run build` passed.
  - `cd ai-proxy && npm run build` passed.
  - Targeted server contract/security tests passed: gateway HMAC, shared gateway auth, body parsing, WebSocket auth, validation middleware, and OpenAPI.
  - Targeted gateway contract/security tests passed: mobile permission HMAC, request validation, proxy whitelist, request logger, and logger redaction.

Not performed:

- Full unit/integration/e2e suite rerun.
- Privacy-safe calibrated load testing beyond the Phase 3 local capacity proof.
- Production log, incident, or runtime metric review.

## Executive Summary

Overall grade: **B+**

The codebase is stronger than the previous baseline. It has clear service/repository layering, documented extension points, a dedicated worker process, Redis-backed coordination, comprehensive health checks, Prometheus/Grafana/Loki/Jaeger support, high recorded coverage, release-gate documentation, and strong security primitives around JWT audiences, encryption, 2FA, rate limiting, gateway HMAC auth, and internal-network controls.

The main risk is no longer broad architecture quality or known P0 correctness defects. The remaining path to A grades is centered on proof and drift prevention: keep OpenAPI/shared schema coverage current, keep route-backed gateway whitelist checks green, collect privacy-safe calibrated performance/scale benchmarks, wire durable production alert receivers, capture production incident/runtime evidence, and continue browser token/CSP hardening.

## /grade Follow-Up - 2026-04-14

Current `/grade` state:

- Latest quality report: `tasks/grade-report-2026-04-13-c76.md`.
- Current `/grade` score: **82/100 (B)** after lint, body-validation, largest-file, quality-gate, and lizard extraction work.
- Latest committed lizard gate before this addendum: `298c7754 Reduce Trezor connect lizard baseline`, which lowered the repo-wide baseline from 55 to 54 warnings. The gateway backend event notification and Coldcard nested parser account extraction passes lower the measured baseline again to 52 warnings.
- Completed P1 items from the quality report: first-pass lint gate, blocking CI quality gates, scoped largest-file threshold, API body-validation guard, and the named transaction typing gaps.
- Remaining score-moving local work: reduce the measured lizard baseline and clean up current-tree/full-history gitleaks false positives. Performance and operations A-grade movement still requires environment evidence, not broad local refactoring.

Recommended next sequence:

| Priority | Work | Start With | Exit Criteria |
| --- | --- | --- | --- |
| P1 | Keep reducing lizard warnings, but prioritize production source before tests, E2E fixtures, benchmark scripts, and animations. | `gateway/src/services/backendEvents/notifications.ts` and `services/deviceParsers/parsers/coldcardNested.ts` are now complete. Continue the same one-warning-per-commit cadence on `services/deviceParsers/parsers/keystone.ts`, `utils/urDeviceDecoder.ts`, `utils/urPsbt.ts`, `contexts/send/reducer.ts`, and `hooks/send/*`. | Each slice removes exactly the targeted lizard warning, lowers `.github/workflows/quality.yml` and `scripts/quality.sh` by one, updates `tasks/grade-report-2026-04-13-c76.md`, and passes the focused tests, target lizard check, `npm run typecheck:app`, and `npm run lint`. |
| P1 | Clean up the secret-scan signal without weakening real secret detection. | Current-tree `gitleaks detect --no-git` reports 34 findings, mostly ignored local artifacts (`.env`, `server/dist`, `server/coverage`, `docker/nginx/ssl/privkey.pem`) plus test placeholders. Do not broadly allowlist `.env`; instead define a tracked-tree/current-tree scan that excludes ignored build/coverage artifacts while keeping committed fixtures explicit. | `gitleaks git --log-opts -1` remains clean, and the chosen current-tree/tracked-tree scan is clean or has narrow fixture allowlists with comments explaining why each path is non-secret test data. |
| P1 | Decide whether the architecture gate should split production-source complexity from repo-wide cleanup debt. | The repo-wide lizard count now includes E2E route handlers, test helpers, animation draw loops, benchmark scripts, and generated-output-adjacent local artifacts. That is useful debt signal, but it can obscure product architecture work. | `scripts/quality.sh`, `.github/workflows/quality.yml`, and the grade report clearly distinguish "production-source complexity must not regress" from "whole-repo debt baseline must trend down" if the team chooses to split the signal. |
| P2 | Keep A-grade operations and performance evidence moving outside the lizard loop. | Durable production alert receiver proof, production/prod-like runtime evidence, and privacy-safe calibrated load benchmarks remain the main non-local blockers. | Evidence is recorded in `docs/plans/` with p95/p99, failure rates, dataset/topology notes, alert delivery proof, and sensitive data excluded. |
| P2 | Run routine dependency-audit maintenance separately from architecture refactors. | Nonbreaking `follow-redirects`/transitive updates and accepted Prisma/polyfill chains should not be mixed into lizard refactor commits. | Audit triage stays current, high/critical production advisories remain unaccepted, and breaking audit-fix paths are handled in their own decision record. |

Practical next patch: refactor `services/deviceParsers/parsers/keystone.ts` by extracting Keystone standard account collection, primary-account selection, and multisig account construction while keeping both parser exports unchanged. Run `npx vitest run tests/services/deviceParsers/keystone.branches.test.ts tests/services/deviceParsers/deviceParsers.test.ts`, a target lizard check for `services/deviceParsers/parsers/keystone.ts`, `npm run typecheck:app`, and `npm run lint`.

## Scorecard

| Domain | Grade | Rationale |
| --- | --- | --- |
| Extensibility | B+ | Strong route/service/repository boundaries, extension-point docs, registries for routes/tabs/backgrounds/flags/importers/providers, and a service lifecycle registry. Grade is held back by incomplete OpenAPI coverage outside the gateway surface and hand-maintained gateway/backend request contracts. |
| Scalability | B+ | Dedicated worker, BullMQ/Redis, distributed locks, WebSocket limits, Redis bridge broadcasts, Prisma indexes, cache invalidation, and a scale-out baseline are solid. Disposable two-backend and two-worker smokes now prove Redis-backed WebSocket delivery to 64 local clients across backend replicas, BullMQ diagnostic processing on both worker replicas, recurring job deduplication, one Electrum subscription owner after retry recovery, a shared-lock skip, and Postgres/Redis capacity snapshots before and after the local load profile. The grade stays below A until privacy-safe backend load-balanced capacity, worker queue load, Electrum subscription volume, and expected WebSocket fanout are validated under non-production load. |
| Performance | B+ | Caching, React Query discipline, Electrum pooling, database indexes, API aggregation, bounded WebSocket queues, and a Phase 3 benchmark harness are good. The disposable full-stack authenticated capacity profile now covers wallet list, transaction history, a synthetic 10,000-transaction wallet-history gate with 100 requests at concurrency 8, wallet-specific WebSocket sync fanout, wallet-sync queueing, WebSocket handshake, generated backup validation and 10,076-record restore, 60 worker proof jobs, two-worker diagnostic scale-out, and 64-client two-backend Redis WebSocket fanout. Privacy-safe calibrated wallet/load data, approved support-size backup restore, worker queue load, and target topology benchmarks are still pending. |
| Perpetual operations and supportability | B+ | `/health`, `/api/v1/health`, `/metrics`, Prometheus alerts, Grafana/Loki/Jaeger, support-package collectors, Docker healthchecks, resource limits, monitoring exposure docs, and operations runbooks are strong. A disposable restore drill, full Compose gateway audit persistence proof, local monitoring stack smoke, and disposable Alertmanager receiver delivery smoke now exist. Durable production alert receivers and runtime incident evidence are still missing. |
| Security | A- | JWT audiences, token revocation, 2FA, production secret requirements, AES-GCM encryption, rate limiting, Helmet, gateway HMAC auth, redacted gateway logs, route-scoped Swagger CSP allowances, and internal routes are good. Browser access tokens are now held in an HttpOnly, Secure, SameSite=Strict `sanctuary_access` cookie with double-submit CSRF via `sanctuary_csrf`; the refresh token lives in an HttpOnly `sanctuary_refresh` cookie scoped to `/api/v1/auth/refresh`; a Web Locks-coordinated refresh flow makes 1-hour expiry invisible across tabs (ADR 0001 / ADR 0002, resolved 2026-04-13). Partial schema coverage and accepted upstream dependency audit findings are the only items keeping Security below a clean A. |
| Technical debt | B+ | Strict app/test typecheck, backend/gateway/AI builds, high recorded coverage, release gates, extension docs, shared gateway/redaction utilities, and shared mobile API request schemas are good. Remaining debt is concentrated in incomplete OpenAPI, remaining duplicated API request schemas, and a few oversized modules. |

## Roadmap To A Grades

This roadmap focuses on changes that are objectively good for the codebase: they remove demonstrated defects, prevent recurring contract drift, improve production diagnosability, or prove scale/performance assumptions. It intentionally avoids framework rewrites, broad microservice splits, and file-splitting campaigns that do not directly reduce current risk.

| Phase | Target | Work | Exit Criteria | Expected Grade Movement |
| --- | --- | --- | --- | --- |
| 0 | Stabilize correctness and security | Fix gateway/backend HMAC contract drift, WebSocket JWT audience enforcement, backup/restore large-body parsing, and the current frontend strict typecheck failures. | Gateway-signed requests verify in backend contract tests; WebSocket refresh and 2FA tokens are rejected; admin restore/validate accepts payloads above 10MB and below the intended limit; `npm run typecheck:app`, `cd server && npm run build`, and `cd gateway && npm run build` pass. | Security and technical debt move out of B- territory; supportability improves because known broken operational paths are fixed. |
| 1 | Make boundary contracts source-of-truth driven | Complete OpenAPI coverage for implemented API domains; share or generate request schemas for drift-prone gateway/backend routes; contract-test the gateway whitelist against backend routes/OpenAPI. | New or changed public/gateway API routes cannot merge without OpenAPI/schema coverage or explicit contract tests; gateway whitelist tests prove allowed mobile routes still exist and blocked routes remain blocked. | Extensibility reaches A- or A; security and technical debt improve because contract drift becomes mechanically harder. |
| 2 | Bring operations proof to production-grade | Keep runbooks current, run a backup/restore drill, exercise the monitoring stack, verify alert receiver configuration, and record gateway audit persistence evidence. | Critical alerts have triage docs and tested notification paths; monitoring ports remain private/protected; a restore drill result is recorded; gateway audit events persist through the HMAC path. | Perpetual operations and supportability reaches A- or A. |
| 3 | Prove scalability and performance | Run authenticated load/perf checks for wallet sync, large wallet list views, transaction history aggregation, WebSocket fanout, backup/restore, queue processing, backend scale-out, and worker scale-out or explicitly keep worker scale-out unsupported. | Benchmark records include p95/p99 targets, failure rates, dataset/topology notes, and strict release thresholds; Redis-backed WebSocket delivery works across backend instances. | Scalability and performance reach A- or A. |
| 4 | Institutionalize maintainability | Continue adopting centralized validation for new and touched backend routes; keep gateway log redaction; modularize oversized files only when already changing them; keep dependency/security/container checks in release gates; maintain the A-grade contract and runbook checks. | New API work follows validation and contract guardrails; gateway logs use shared redaction; large-file cleanup is tied to active edits; release gates include typecheck, builds, contract checks, security checks, and targeted perf/ops checks. | Technical debt reaches A- or A and the earlier grade gains become durable. |

Suggested sequencing:

1. Phase 1 is closed for the current route surface; keep its OpenAPI/schema/whitelist guardrails in release-gate hygiene as routes change.
2. Finish Phase 2 production alert receiver selection and proof before claiming A-grade operations.
3. Treat the Phase 3 local proof as complete for repository-controlled evidence, and collect privacy-safe load/capacity calibration before claiming A-grade scalability or performance.
4. Continue Phase 4 hygiene as normal engineering practice when routes, schemas, gateway logging, and oversized files are touched.

## Outstanding Items

These are the remaining known blockers before claiming A-grade status. Repository-controlled local proof is complete for Phase 2/3/4 where noted; the remaining items are either target-environment evidence, production-channel choices, or architecture decisions.

| Area | Outstanding item | Required evidence / exit criteria |
| --- | --- | --- |
| Phase 2 operations | Choose durable external production alert receiver channels and credentials. | Alertmanager/receiver configuration is committed without secrets, credential ownership is documented, and a production-safe test alert is delivered to the chosen channel. The disposable local webhook receiver remains smoke evidence only. |
| Phase 2 operations | Capture production runtime or incident evidence. | A production or production-like review records relevant metrics/logs/incidents or a clean runtime window, with sensitive data excluded and runbook adjustments captured. |
| Phase 3 scalability/performance | Run privacy-safe calibrated load benchmarks. | Benchmark records cover wallet sync, transaction history, WebSocket fanout, worker queue processing, backend scale-out, and backup validation/restore using synthetic/regtest fixtures, operator-owned testnet wallets created for proof, or approved restore-safe non-production backups. Do not use third-party wallets, public wallet histories, or private user wallet activity. |
| Phase 3 topology | Validate target non-production topology under expected capacity. | Load-balanced backend capacity, worker queue load, Electrum subscription ownership/volume, expected WebSocket fanout, p95/p99, failure rates, dataset size, and topology notes are recorded with strict go/no-go thresholds. |
| Security/dependencies | Monitor accepted dependency audit findings. | No unaccepted high/critical production advisories remain; revisit root hardware-wallet/polyfill chains, server Prisma tooling, and gateway optional dependency findings when same-major, non-downgrade fixes are available. |
| Phase 4 hygiene | Keep contract, validation, redaction, and release-gate guardrails current. | New or touched routes keep OpenAPI/shared-schema/gateway whitelist coverage; gateway logs continue to use shared redaction; large-file cleanup stays tied to files already being changed. |
| Release verification | Run remaining release-scope checks when cutting a release or touching covered areas. | Full backend/gateway coverage, backend integration, Playwright e2e, install/container workflows, and the critical mutation gate are rerun according to `docs/RELEASE_GATES.md`. |

Domain-specific A-grade criteria:

- Extensibility: API/gateway contracts are complete, tested, and easy to extend without hand-updating multiple divergent lists.
- Scalability: scale-out topology is documented and validated by tests or controlled load runs.
- Performance: high-risk workflows have repeatable budgets and regression checks.
- Perpetual operations and supportability: alerts map to runbooks, restore drills are practiced, and audit/monitoring paths are verified.
- Security: access-token boundaries, internal HMAC auth, CSP/token handling, validation, and redacted logs are enforced by tests or release gates.
- Technical debt: strict typecheck is clean, shared contracts replace duplicated logic, and cleanup happens where it reduces real future change cost.

### Phase 0 Completion Notes

Status: **Complete as of 2026-04-11**

Implemented:

- Added a shared gateway HMAC utility in `shared/utils/gatewayAuth.ts`.
- Hardened gateway body hashing so only empty plain objects collapse to an empty body hash; arrays and other bodies are signed distinctly.
- Switched backend gateway verification to the full original request path so mounted internal routers verify the same path the gateway signs.
- Updated mobile permission checks, backend event device-token calls, and gateway audit forwarding to use the shared HMAC signing contract.
- Removed legacy fallback headers from internal gateway device-token calls.
- Updated WebSocket authentication to require `TokenAudience.ACCESS` and reject `pending2FA` tokens.
- Added a route-aware default body parser so admin backup validation and restore can use their 200MB route parser instead of being rejected by the global 10MB parser.
- Cleared the frontend strict typecheck unused-symbol failures.

Verification:

```text
cd server && npx vitest run tests/unit/middleware/gatewayAuth.test.ts tests/unit/middleware/bodyParsing.test.ts tests/unit/websocket/auth.test.ts tests/integration/websocket/websocket.integration.test.ts
cd gateway && npx vitest run tests/unit/services/backendEvents.auth.test.ts tests/unit/services/backendEvents.deviceTokens.test.ts tests/unit/middleware/mobilePermission.test.ts tests/unit/middleware/requestLogger.test.ts
cd gateway && npx vitest run tests/unit/config.test.ts
npm run typecheck:app
cd server && npm run build
cd gateway && npm run build
```

All checks above passed.

## Priority Recommendations

Priority meanings:

- P0: Fix before depending on the affected workflow in production or mobile gateway use.
- P1: High leverage, should be scheduled soon because it reduces proven risk or recurring drift.
- P2: Useful hardening or maintainability work, best done opportunistically or after P0/P1.

| Priority | Recommendation | Why this is objectively good | Evidence |
| --- | --- | --- | --- |
| P0 | Unify gateway-to-backend internal authentication and add cross-package contract tests. | Completed in Phase 0. The shared signer/verifier contract reduces security drift and operational blind spots. | `shared/utils/gatewayAuth.ts`, `server/src/middleware/gatewayAuth.ts`, `gateway/src/middleware/mobilePermission.ts`, `gateway/src/services/backendEvents/auth.ts`, `gateway/src/middleware/requestLogger.ts`. |
| P0 | Fix WebSocket JWT verification to require access tokens and reject pending 2FA tokens. | Completed in Phase 0. HTTP and WebSocket auth now enforce the same access-token boundary. | `server/src/websocket/auth.ts`, `server/tests/unit/websocket/auth.test.ts`. |
| P0 | Fix admin backup/restore request parsing so 200MB payloads actually reach the route parser. | Completed in Phase 0. Large backup validate/restore requests now bypass the global 10MB parser and hit the route-specific parser. | `server/src/middleware/bodyParsing.ts`, `server/src/index.ts`, `server/tests/unit/middleware/bodyParsing.test.ts`. |
| P1 | Keep strict frontend typecheck green. | Completed in Phase 0 and should remain a release gate. | `npm run typecheck:app` passes after removing unused symbols in `components/AISettings/components/EnableModal.tsx`, `components/AISettings/hooks/useContainerLifecycle.ts`, `components/ui/EmptyState.tsx`, and `hooks/queries/factory.ts`. |
| P1 | Make API/gateway contracts source-of-truth driven. | Completed for the current Phase 1 route surface. The broad checkpoint covers every current gateway whitelist route in OpenAPI, derives the whitelist/OpenAPI test matrix from gateway route metadata, feeds gateway validation and OpenAPI limits/constants from shared mobile request schemas, and covers the first non-gateway public/admin/internal domains. Further route-surface sweeps should continue as release-gate hygiene when routes change. | `server/src/api/openapi/spec.ts` now includes gateway-exposed auth/session, wallet sync, transaction, address, UTXO, label, Bitcoin status/fees, price, push, device, draft, mobile-permission routes, Payjoin management/BIP78 receiver routes, authenticated ownership transfer routes, Treasury Intelligence insight/conversation/settings routes, public AI assistant/model/container/resource routes, price current/multiple/provider/conversion/provider-health/history/cache-admin routes, Bitcoin mempool/block/address/advanced-fee/RBF/CPFP/batch/node-test/sync-management routes, transaction batch/raw/recent/balance-history/stats/pending/export/recalculate, UTXO freeze/selection, privacy-analysis routes, public device model/manufacturer catalog, device account/share routes, transaction/address label association routes, auth registration/profile/password/email/Telegram/2FA-management routes, health/readiness/circuit-breaker routes, global pending-approval listing, wallet user/group sharing routes, wallet import/XPUB validation routes, wallet balance-history/device attachment/address-generation/repair helper routes, wallet export/label-export routes, wallet Telegram/Autopilot settings/status routes, wallet vault-policy/approval routes, admin version/settings/feature-flag/audit-log/user/group/system-policy/backup/support-package/node-configuration/proxy-test, Electrum server, infrastructure/DLQ, monitoring routes, and root-mounted internal mobile-permission plus AI context/treasury routes with explicit root-server overrides. |
| P1 | Align gateway mobile request validation with backend route bodies. | Completed for the current gateway-backed mobile surface. Phase 1 covers shared auth login/refresh/logout/2FA/preferences, push register/unregister, wallet label create/update, mobile-permission update, draft signing update, transaction/PSBT create-broadcast-estimate, and device create/update schemas for the gateway path. Backend transaction/PSBT and device write routes parse the shared schemas, and the close-out slice extends shared-schema parsing to high-risk admin bodies. | `shared/schemas/mobileApiRequests.ts` provides shared Zod schemas, mobile action constants, draft status constants, device constants, and request limits; `gateway/src/middleware/validateRequest.ts` consumes them for gateway validation; OpenAPI auth/push/label/mobile-permission/draft/transaction/device schemas reuse the same constants where applicable; `server/src/api/transactions/drafting.ts`, `server/src/api/transactions/broadcasting.ts`, and `server/src/api/devices/crud.ts` consume the shared schemas for their write routes; admin user/group/Electrum/backup/settings routes parse `server/src/api/schemas/admin.ts` schemas through the admin request parser. |
| P1 | Add generated or route-backed gateway whitelist contract tests. | Completed for current gateway routes: `ALLOWED_ROUTES` is derived from `GATEWAY_ROUTE_CONTRACTS`, and the test uses that same metadata to assert OpenAPI path/method coverage. Code generation from backend/OpenAPI is not needed for the current route churn level; revisit it only if manual metadata updates become a recurring cost. | `gateway/src/routes/proxy/whitelist.ts` owns the route regex, sample path, and OpenAPI path metadata; `gateway/tests/unit/routes/proxy.test.ts` asserts each current gateway whitelist route is allowed and has a matching OpenAPI path/method. It also blocks stale routes for wallet-scoped sync, legacy label item updates, and legacy draft-signing POST paths. |
| P1 | Start using centralized request validation for backend APIs in new and touched routes. | Completed for the planned Phase 1 baseline and moved to Phase 4 hygiene for future/touched routes. Schema-first validation now covers gateway-backed transaction/device bodies, high-risk auth bodies, and high-risk admin write bodies while preserving established response envelopes. | `server/src/api/auth/profile.ts` uses `validate({ query: UserSearchQuerySchema })`; `server/src/api/transactions/drafting.ts`, `server/src/api/transactions/broadcasting.ts`, and `server/src/api/devices/crud.ts` parse shared write schemas; `server/src/api/auth/login.ts`, `tokens.ts`, `email.ts`, `telegram.ts`, `password.ts`, and the 2FA route modules validate high-risk auth bodies through `server/src/middleware/validate.ts`; `server/src/api/admin/requestValidation.ts` parses admin user/group/Electrum/backup/settings bodies against `server/src/api/schemas/admin.ts`; targeted route and middleware tests cover the behavior. |
| P1 | Harden browser token handling and CSP. | Partially completed in Phase 4: Swagger UI inline/CDN allowances are now scoped to the `/api/v1/docs` route, and the frontend API client now stores access tokens in `sessionStorage` by default instead of durable `localStorage`, with `VITE_AUTH_TOKEN_STORAGE=memory` and `VITE_AUTH_TOKEN_STORAGE=local` as explicit modes. A-grade browser token handling still needs a separate HttpOnly-cookie/session architecture decision because that affects refresh, CSRF, WebSocket auth, and mobile/gateway behavior. | `server/src/index.ts` now uses default API `script-src` and `style-src` values of `'self'`; `server/src/api/openapi/index.ts` sets the Swagger UI-specific CSP only for the docs HTML route; `server/tests/unit/api/openapi.test.ts` covers the docs CSP. `src/api/client.ts` owns session-scoped token storage, legacy `localStorage` cleanup, and the explicit storage mode switch; `tests/api/client.test.ts` covers the client behavior. |
| P1 | Add gateway log redaction before metadata volume grows. | Completed in Phase 4. Keep it as a release gate when new gateway metadata is added because it reduces token, secret, and credential leakage risk. | `shared/utils/redact.ts`, `gateway/src/utils/logger.ts`, and fresh `cd gateway && npx vitest run tests/unit/utils/logger.test.ts` passed. |
| P1 | Complete operations proof, not just operations docs. | Non-production restore, full Compose gateway audit persistence, local monitoring-stack proof, and disposable Alertmanager webhook receiver delivery proof now exist. A-grade operations still need durable production alert receiver configuration and runtime incident evidence. | `docs/OPERATIONS_RUNBOOKS.md` maps alerts and failure modes to triage; `docs/plans/phase2-operations-proof-2026-04-12T08-44-39-1000.md` records backup/restore plus in-process gateway audit proof; `docs/plans/phase2-monitoring-smoke-2026-04-12T22-42-59-008Z.md` records monitoring stack proof with loopback bindings; `docs/plans/phase2-gateway-audit-compose-smoke-2026-04-12T23-18-24-249Z.md` records the multi-container backend/gateway HMAC audit proof; `docs/plans/phase2-alert-receiver-smoke-2026-04-12T23-33-46-561Z.md` records local Alertmanager receiver delivery proof. |
| P2 | Run authenticated performance and scale gates for high-risk workflows. | The Phase 3 harness and disposable Compose smoke now prove local authenticated paths end to end, including a synthetic 10,000-transaction wallet-history gate, a generated 10,076-record backup restore, wallet-specific WebSocket sync fanout, 60 worker proof jobs, two-worker diagnostic scale-out, 64-client two-backend Redis WebSocket fanout, and Postgres/Redis capacity snapshots. Generated fixture data proves repository-controlled regressions; the remaining A-grade evidence should use privacy-safe calibrated datasets/topologies, such as synthetic/regtest fixtures, operator-owned testnet wallets, and approved non-production backup files. Third-party real-world wallet usage and public wallet-history profiling are out of scope. | `docs/SCALABILITY_AND_PERFORMANCE.md`, `npm run perf:phase3`, and `npm run perf:phase3:compose-smoke` exist; `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T02-50-46-877Z.md` records the latest full-stack local capacity profile, with benchmark output in `docs/plans/phase3-benchmark-2026-04-13T02-51-11-475Z.md`. |
| P2 | Validate the supported scale-out topology. | Redis bridge, distributed locks, worker queues, health checks, and scale-out docs show intent. Local two-backend and two-worker smokes now exist; operators still need privacy-safe backend/load-balancer capacity evidence and worker queue load before production worker replica support is broadened beyond the proven smoke boundary. | `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T02-50-46-877Z.md` proves a wallet-specific sync event reached 64/64 WebSocket clients across two backend replicas through Redis with p95 17 ms, and proves two worker replicas process diagnostic BullMQ jobs while only one owns Electrum subscriptions. `docker-compose.yml` now forwards `MAX_WEBSOCKET_PER_USER` and `MAX_WEBSOCKET_CONNECTIONS` into the backend service for repeatable local fanout proof; it still runs one backend service and one worker service by default. |
| P2 | Modularize oversized files only when touching them for product work. | Splitting purely for aesthetics can add churn. Splitting when changing the file reduces review risk and makes future edits easier. | Large production files include `ai-proxy/src/index.ts` (962 lines), `server/src/repositories/transactionRepository.ts` (891), `server/src/services/bitcoin/electrumPool/electrumPool.ts` (841), and `server/src/worker.ts` (646). |

## P0 Detail

### Gateway/Internal Auth Contract

Original issues fixed together in Phase 0:

- `gateway/src/middleware/mobilePermission.ts` signs only `timestamp` and JSON payload.
- `server/src/middleware/gatewayAuth.ts` verifies `method`, `req.path`, `timestamp`, and a body hash.
- `gateway/src/services/backendEvents/auth.ts` has a separate implementation that resembles the server format, but it signs full upstream paths such as `/api/v1/push/by-user/:userId`.
- The server verifier runs inside routers mounted at `/api/v1/push` and `/internal`, so `req.path` is the mounted-router path, not necessarily the full upstream URL.
- `gateway/src/middleware/requestLogger.ts` sends gateway audit events with only `X-Gateway-Request: true`, while the backend audit endpoint uses `verifyGatewayRequest`.
- `gateway/src/services/backendEvents/deviceTokens.ts` falls back to `X-Gateway-Request` when no gateway secret exists, but the backend verifier rejects missing HMAC headers.

Implemented fix:

1. Move HMAC request signing and body hashing into one shared package or shared source file consumed by both gateway and backend tests.
2. Decide whether signatures bind to `req.originalUrl`, a normalized full path, or the mounted route path. Use the same value on both sides.
3. Remove legacy `X-Gateway-Request` fallback unless the backend deliberately supports it behind a migration flag.
4. Update mobile permission checks, backend event device-token calls, and gateway audit calls to use the same signer.
5. Add a contract test that signs in gateway code and verifies with server middleware for:
   - `POST /internal/mobile-permissions/check`
   - `GET /api/v1/push/by-user/:userId`
   - `DELETE /api/v1/push/device/:deviceId`
   - `POST /api/v1/push/gateway-audit`

### WebSocket JWT Audience

Implemented fix:

1. Change both token verification sites in `server/src/websocket/auth.ts` to call `verifyToken(token, TokenAudience.ACCESS)`.
2. Reject `decoded.pending2FA` the same way HTTP auth does.
3. Add tests that refresh tokens and 2FA temporary tokens cannot authenticate WebSocket connections or subscriptions.

### Backup/Restore Parser Ordering

Implemented fix:

1. Exclude `/api/v1/admin/backup/validate` and `/api/v1/admin/restore` from the global 10MB JSON parser, or mount the admin backup router with its large parser before the global parser.
2. Add route tests for payloads above 10MB and below 200MB.
3. Confirm Nginx/client body limits are also aligned with the intended maximum.

## Phase 1 Progress Notes

Status: **Complete as of 2026-04-12**

Completed in Phase 1:

- Aligned gateway push registration validation with the backend request body by validating `token` instead of the gateway-only `deviceToken` field.
- Replaced the gateway whitelist's non-existent wallet-scoped transaction-detail path with the backend's canonical `GET /api/v1/transactions/:txid` path; server-side `findByTxidWithAccess` remains the wallet-access boundary for transaction detail.
- Added gateway tests that reject the old push registration body field, allow the backend transaction-detail route, and keep raw transaction detail blocked unless deliberately exposed.
- Fixed gateway validation path reconstruction so schema validation uses the same `baseUrl + path` model as whitelist checks for routes mounted through the general `/api/v1` proxy.
- Added OpenAPI coverage for every current gateway whitelist route, including auth/session, wallet sync, transaction, address, UTXO, label, Bitcoin status/fees, price, push, device, draft, and mobile-permission routes.
- Replaced stale gateway whitelist routes with backend-backed routes: `POST /api/v1/sync/wallet/:walletId`, `PUT/DELETE /api/v1/wallets/:walletId/labels/:labelId`, and `PATCH /api/v1/wallets/:walletId/drafts/:draftId`.
- Added a full gateway whitelist-to-OpenAPI matrix test and server OpenAPI tests for the newly covered route families.
- Replaced the hand-authored whitelist/OpenAPI test matrix with gateway route metadata: `GATEWAY_ROUTE_CONTRACTS` now carries regex, sample path, and OpenAPI path data, and `ALLOWED_ROUTES` is derived from it.
- Added shared mobile request schemas for auth login/refresh/logout/2FA/preferences, push register/unregister, and wallet label create/update payloads, then reused their request limits in OpenAPI auth/push/label schemas.
- Expanded gateway request validation to cover `POST /api/v1/auth/2fa/verify`, `PATCH /api/v1/auth/me/preferences`, and `DELETE /api/v1/push/unregister`.
- Added shared mobile action constants and mobile-permission update validation, then reused them in the backend mobile-permission route, gateway request validation, and OpenAPI mobile-permission schemas.
- Added shared draft status constants and a gateway draft update schema for `PATCH /api/v1/wallets/:walletId/drafts/:draftId`, with OpenAPI `UpdateDraftRequest` using the same status values.
- Added shared transaction/PSBT and device write-body schemas, wired them into gateway request validation, and reused fee-rate/device enum constants in OpenAPI. This also corrected transaction/PSBT OpenAPI fee-rate minimums to the backend-aligned `0.1` value.
- Adopted the shared transaction/PSBT schemas in backend write routes for transaction create, estimate, broadcast, PSBT create, and PSBT broadcast. The transaction broadcast path now passes PSBT-derived recipient/amount metadata into persistence when the client omits it.
- Adopted the shared device create/update schemas in backend device CRUD routes while preserving existing tested validation messages.
- Added OpenAPI coverage for Payjoin management endpoints and the unauthenticated BIP78 text/plain receiver endpoint.
- Added OpenAPI coverage for authenticated ownership transfer list/create/count/detail/action endpoints, with transfer status/resource/filter enum values exported from the transfer service type module.
- Added OpenAPI coverage for Treasury Intelligence status, insight, conversation, message, and per-wallet settings endpoints, with insight/message enum values exported from the intelligence service type module.
- Added OpenAPI coverage for public AI assistant status, label suggestion, natural query, Ollama detection, model management, container management, and system-resource endpoints, with natural-query result enum values exported from the AI service type module.
- Added OpenAPI coverage for the full price API route surface, including current/multiple/provider-specific price lookup, sats/fiat conversion, currency/provider listing, provider health, historical/history lookup, and admin-only cache stats/clear/duration controls. The price contract validator now follows the aggregate price response shape used by the service and OpenAPI schema.
- Added OpenAPI coverage for broader Bitcoin utility, node-test, and sync-management routes, including mempool/block lookups, address validation/lookup/sync, advanced fee estimation, RBF/CPFP/batch helpers, legacy Bitcoin wallet sync/confirmation updates, node connection testing, and non-gateway sync queue/status/log/reset/resync/network routes. This also corrected stale Bitcoin broadcast, RBF-check, confirmation-update, wallet sync, and sync-status schemas to match the service contracts.
- Added OpenAPI coverage for transaction helper and read routes outside the original gateway matrix, including transaction batch PSBT creation, raw transaction lookup, cross-wallet recent transaction and balance-history reads, wallet pending/stats/export/recalculate helpers, UTXO freeze and selection strategy routes, and wallet/UTXO spend privacy analysis.
- Added OpenAPI coverage for device catalog/account/sharing and transaction/address label association routes outside the original gateway matrix, including public device model/manufacturer lookup, device account add/remove, device user/group sharing, wallet label detail, and label attach/replace/remove flows for transactions and addresses.
- Added OpenAPI coverage for secondary auth routes, including registration status, user group/search helpers, password change, email verification/resend/update, Telegram chat ID/test helpers, and 2FA setup/enable/disable/backup-code management. The public registration request schema now requires `email` to match the route contract.
- Added OpenAPI coverage for the API health/readiness/circuit-breaker route family and the global pending-approvals helper for approver-capable wallets.
- Added OpenAPI coverage for root-mounted internal gateway and AI container contracts, including the HMAC-authenticated mobile-permission check, model pull-progress callback, sanitized transaction/wallet context reads, and aggregate UTXO health, fee-history, spending-velocity, and UTXO-age profile routes.
- Added OpenAPI coverage for wallet user/group sharing endpoints, exported wallet role constants from the wallet service type module, and reused those constants in the sharing route validation and OpenAPI schemas so the `approver` role stays aligned.
- Added OpenAPI coverage for wallet import format discovery, import validation, import creation, and XPUB descriptor validation endpoints, with import format/network/script/wallet-type enum values exported from the wallet import service type module.
- Added OpenAPI coverage for wallet balance history, next-address generation, device attachment, and descriptor repair endpoints. The next-address POST was added to the existing `/wallets/{walletId}/addresses` path item so the gateway-covered GET address listing contract remains intact.
- Added OpenAPI coverage for wallet BIP 329 label export, available export format listing, and wallet export file downloads, with export format enum values exported from the export service type module.
- Added OpenAPI coverage for wallet Telegram settings and feature-gated Treasury Autopilot settings/status endpoints, with Autopilot defaults reused from the service type module.
- Added OpenAPI coverage for wallet vault-policy event listing, evaluation preview, CRUD, address allow/deny-list management, draft approval listing/voting, and owner override endpoints, with policy and vote enum values reused from the vault-policy type module.
- Added OpenAPI coverage for admin version, settings, and feature flag endpoints. The version endpoint remains unauthenticated in the spec, the settings response schema omits `smtp.password` while allowing password updates, and feature flag key enums reuse the service definition module.
- Added OpenAPI coverage for admin audit-log listing and statistics endpoints. The audit-log username filter now flows through the audit service and repository instead of being silently dropped before query execution.
- Fixed admin audit-log statistics so `byCategory` and `byAction` aggregates use the same requested day window as `totalEvents` and `failedEvents`, and preserved explicit `limit: 0` count-only repository queries instead of expanding them to the default page size.
- Added OpenAPI coverage for admin user listing, creation, update, and deletion. The admin create-user client type and modal now treat email as required to match the backend route contract, and non-empty admin email updates now validate email format before duplicate checks.
- Added OpenAPI coverage for admin group listing, creation, update, deletion, member add, and member removal routes, including group member response schemas and `member`/`admin` role validation for direct member additions.
- Added OpenAPI coverage for admin system-policy listing, creation, update, and deletion routes. The spec reuses the shared vault-policy schemas and intentionally omits unmounted group-policy admin paths.
- Added OpenAPI coverage for admin encryption-key reauthentication, backup creation/download, backup validation, destructive restore, and support-package generation/download routes, including the custom restore failure envelopes and support-package concurrency response.
- Added OpenAPI coverage for admin node-configuration get/update, Electrum connection test, and SOCKS5/Tor proxy test routes, including masked proxy passwords, pooled Electrum server entries, string-or-integer request ports, and custom connection failure envelopes.
- Added OpenAPI coverage for admin Electrum server listing, network listing, creation, update, deletion, reorder, ad hoc connection testing, and configured-server health testing routes, including network enums, string-or-integer request ports, reorder/delete responses, and the shared `networkOrServerId` path template needed to avoid duplicate OpenAPI templates for the runtime `/:network` and `/:id` routes.
- Added OpenAPI coverage for admin infrastructure and monitoring routes, including Tor container status/start/stop, cache metrics, WebSocket stats, DLQ list/delete/retry/category clear, monitoring service URL management, and Grafana configuration.
- Expanded centralized auth request validation for login, token refresh/logout, email verification/update, Telegram helpers, 2FA enable/verify/management, and password-change required-field checks, while preserving route-specific error messages through the validation middleware.
- Aligned the exported `RegisterSchema` with the public registration route and OpenAPI contract by requiring `email`.
- Added a shared admin request parser that applies the existing admin Zod schemas inside legacy admin route handlers while preserving the established `InvalidInputError` response envelope and route stack shape.
- Adopted shared admin schemas in high-risk admin write routes for user create/update, group create/update/member-add, Electrum test/reorder/create/update, encryption-key reauthentication, backup creation/validation, destructive restore confirmation, and system settings updates.
- Corrected the admin Zod schemas to match the route/OpenAPI contracts for string repository IDs in group/Electrum requests, admin email clearing, ad hoc Electrum connection-test TCP defaults, and object-shaped backup payloads.
- Closed the route-metadata generation question for now: `GATEWAY_ROUTE_CONTRACTS` is already the route-backed source for whitelist/OpenAPI checks, so OpenAPI/backend code generation is not needed until route churn makes the manual metadata meaningfully costly.

Latest Phase 1 auth validation verification:

```text
cd server && npx vitest run tests/unit/middleware/validate.test.ts tests/unit/api/schemas.test.ts tests/unit/api/auth-telegram-routes.test.ts tests/unit/api/email.test.ts tests/unit/api/auth.routes.2fa.test.ts tests/unit/api/auth-password-routes.test.ts tests/unit/api/auth.routes.registration.test.ts
cd server && npx vitest run tests/unit/api/auth.test.ts tests/unit/api/schemas/email.test.ts
cd server && npm run build
```

The targeted validation and auth route checks passed: 7 files / 182 tests, then 2 files / 49 tests. The server build passed.

Latest Phase 1 close-out verification:

```text
cd server && npx vitest run tests/unit/api/schemas.test.ts tests/unit/api/admin-routes.test.ts tests/unit/api/admin.test.ts tests/unit/api/admin-groups-routes.test.ts tests/unit/api/admin-groupRoles.test.ts tests/unit/api/electrumServers.test.ts tests/unit/api/admin-backup-routes.test.ts tests/unit/api/admin-features-routes.test.ts
cd server && npx vitest run tests/unit/api/openapi.test.ts
cd server && npm run build
```

The targeted admin schema/route checks passed: 8 files / 253 tests. The OpenAPI check passed: 1 file / 42 tests. The server build passed.

Phase 1 is closed for the current route surface. Continue route-surface sweeps and schema adoption as Phase 4 hygiene for new or touched routes; root `/health`, `/metrics`, and `/api/v1/docs` remain operational/documentation surfaces rather than client API contracts.

## Phase 2 Progress Notes

Status: **Restore, gateway audit, monitoring stack, and local alert receiver proof complete; production alert receiver proof pending**

Completed in the first Phase 2 slice:

- Added `docs/OPERATIONS_RUNBOOKS.md` with triage and mitigation steps for HTTP errors, wallet sync failures, transaction broadcast failures, worker/queue stalls, Electrum degradation, DB saturation, cache hit-rate drops, WebSocket alerts, backup/restore failures, and gateway audit failures.
- Bound optional monitoring stack host ports to `127.0.0.1` by default via `MONITORING_BIND_ADDR`, with explicit documentation for intentional remote exposure.
- Updated server push route tests so gateway-internal HMAC verification preserves `originalUrl` and signs the same full `/api/v1/push/...` paths the gateway uses, including gateway audit persistence.

Completed in the 2026-04-12 Phase 2 proof slice:

- Added `npm run test:ops:phase2`, backed by `server/tests/integration/ops/phase2OperationsProof.integration.test.ts`, to run a disposable PostgreSQL operations drill through the existing integration test database runner.
- Made the integration-test Postgres host port configurable with `TEST_POSTGRES_PORT` after the local default `5433` port was already allocated during the drill.
- Ran and recorded a non-production backup/restore drill against `sanctuary-test-db` on `localhost:55433`. The drill seeded user/group/wallet/wallet-user/audit rows, created and validated a backup, deleted the rows, restored through `backupService.restoreFromBackup(...)`, and verified the rows and relationship were restored.
- Recorded gateway audit persistence proof using the real backend push router and the actual gateway `logSecurityEvent` helper with a shared `GATEWAY_SECRET`. The drill verified a signed `RATE_LIMIT_EXCEEDED` event persisted as a gateway audit row and an unsigned audit request returned `403` without persistence.
- Added evidence in `docs/plans/phase2-operations-proof-2026-04-12T08-44-39-1000.md` and linked the repeatable proof command from `docs/OPERATIONS_RUNBOOKS.md` and `docs/RELEASE_GATES.md`.

Completed in the 2026-04-12 Phase 2 monitoring proof slice:

- Added `npm run ops:monitoring:phase2`, backed by `scripts/ops/phase2-monitoring-smoke.mjs`, to probe Grafana, Prometheus health and alert-rule loading, Alertmanager health/status, Jaeger service API reachability, Loki readiness, monitoring container health, Promtail runtime logs, and Compose loopback host bindings.
- Ran and recorded a passing local monitoring smoke using alternate loopback ports because another local project already owned the default Loki host port `3100`.
- Made Jaeger OTLP and Loki host ports configurable, upgraded Promtail to `grafana/promtail:3.5.0` after `2.9.0` failed against this host's Docker API floor, replaced the Promtail `wget` healthcheck with `promtail -check-syntax`, and constrained Promtail discovery to the Sanctuary Compose project with a stable `job=sanctuary` Loki label.
- Added evidence in `docs/plans/phase2-monitoring-smoke-2026-04-12T22-42-59-008Z.md` and linked the repeatable proof command from `docs/OPERATIONS_RUNBOOKS.md` and `docs/RELEASE_GATES.md`.

Completed in the 2026-04-12 Phase 2 gateway audit Compose proof slice:

- Added `npm run ops:gateway-audit:phase2`, backed by `scripts/ops/phase2-gateway-audit-compose-smoke.mjs`, to start a temporary Docker Compose project with backend, gateway, Postgres, Redis, and worker services, then tear it down after the proof.
- Fixed backend gateway audit classification so security events such as `AUTH_MISSING_TOKEN` persist as failed audit rows with `errorMsg` set, rather than as successful audit entries.
- Fixed the backend and gateway container builds for shared TypeScript imports that resolve package dependencies from the repo-level `shared/` sibling directory during Docker builds.
- Ran and recorded a passing full-stack gateway audit smoke. The proof hit the live gateway protected route without a token, verified the gateway-signed backend audit row persisted in PostgreSQL as `gateway.auth_missing_token`, verified an unsigned in-network backend audit request returned `403` without persistence, checked gateway delivery logs for audit send failures, and waited for all five Compose service containers to be healthy.
- Captured the local environment adjustment that the proof pins `GATEWAY_TLS_ENABLED=false` because this drill targets the production-style HMAC audit path, not TLS listener behavior.
- Added evidence in `docs/plans/phase2-gateway-audit-compose-smoke-2026-04-12T23-18-24-249Z.md` and linked the repeatable proof command from `docs/OPERATIONS_RUNBOOKS.md` and `docs/RELEASE_GATES.md`.

Completed in the 2026-04-12 Phase 2 alert receiver delivery proof slice:

- Added `npm run ops:alert-receiver:phase2`, backed by `scripts/ops/phase2-alert-receiver-smoke.mjs`, to start a disposable Alertmanager container with a generated webhook receiver and a local webhook sink.
- Ran and recorded a passing receiver delivery smoke. The proof generated a `phase2-webhook` receiver, started Alertmanager, submitted a real `Phase2AlertReceiverProof` alert through the Alertmanager v2 API, verified delivery to the webhook sink with `status=firing`, and waited for the Alertmanager container to become healthy.
- Added evidence in `docs/plans/phase2-alert-receiver-smoke-2026-04-12T23-33-46-561Z.md` and linked the repeatable proof command from `docs/OPERATIONS_RUNBOOKS.md` and `docs/RELEASE_GATES.md`.

Remaining Phase 2 work:

- Add durable external alert receiver configuration and record delivery proof once production notification channels and credentials are chosen.

## Phase 3 Progress Notes

Status: **Repository-controlled local proof complete as of 2026-04-12 (Pacific/Honolulu); privacy-safe calibrated evidence still gates A-grade scalability/performance**

Completed so far:

- Added `docs/SCALABILITY_AND_PERFORMANCE.md` with the current supported scale-out topology, component replication boundaries, required metrics, initial p95/p99 gates, and a benchmark run record template.
- Documented that backend and gateway replicas are the safer first scale-out targets, while worker replicas require non-production validation of recurring job ownership, distributed locks, and Electrum subscriptions before production use.
- Mapped existing Prometheus metrics and dashboards to the Phase 3 benchmark scenarios for HTTP APIs, database queries, wallet sync, worker queues, WebSocket fanout, Electrum pool behavior, cache behavior, and backup/restore.
- Added `npm run perf:phase3`, a dependency-free benchmark harness that records Markdown and JSON run evidence under `docs/plans/`.
- Recorded the first unauthenticated local smoke run in `docs/plans/phase3-benchmark-2026-04-12T04-00-40-678Z.md`. Frontend health, API health, gateway health, and WebSocket protocol readiness passed; authenticated wallet list, large wallet transaction history, wallet sync queueing, backup validation, and restore were skipped because no operator token, wallet ID, or backup file was provided.
- Added opt-in local fixture provisioning for the Phase 3 harness with `SANCTUARY_BENCHMARK_PROVISION=true`: the harness can log into a local seeded instance, create or reuse a testnet benchmark wallet, and optionally generate an in-memory backup with `SANCTUARY_BENCHMARK_CREATE_BACKUP=true`.
- Recorded a private local smoke run against `https://10.14.23.93:8443` in `docs/plans/phase3-benchmark-2026-04-12T05-12-14-935Z.md`. Frontend health, API health, gateway health, and WebSocket handshake passed; authenticated fixture provisioning was skipped because the default `admin` / `sanctuary` credentials returned `401 Invalid username or password`.
- Initially kept production worker scale-out unsupported until a non-production worker scale-out smoke could prove recurring ownership, distributed locks, and Electrum subscriptions are safe.
- Added `npm run perf:phase3:compose-smoke`, backed by `scripts/perf/phase3-compose-benchmark-smoke.mjs`, to start a disposable full-stack Compose project, wait for migration/seed and service health, run the existing Phase 3 harness in strict local-fixture mode, assert authenticated wallet list, transaction-history, wallet-specific WebSocket sync fanout, wallet-sync queue, and admin backup-validation scenarios, prove local worker queue handler execution, then tear the stack down.
- Recorded a passing full-stack auto-provisioned smoke in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T00-04-57-821Z.md`, with underlying benchmark evidence in `docs/plans/phase3-benchmark-2026-04-13T00-06-30-381Z.md`. The smoke passed frontend health, API health, gateway health, WebSocket handshake, wallet list, local transaction-history query, wallet sync queueing, and backup validation. The local fixture created one testnet wallet with 40 addresses and generated a backup through the admin API; it remains smoke evidence rather than large-wallet performance proof.
- Added wallet-specific WebSocket subscription fanout to `npm run perf:phase3`: authenticated runs now open multiple WebSocket clients, authenticate through the message path, subscribe to `wallet:<id>`, `wallet:<id>:sync`, and `sync:all`, trigger a wallet sync queue request, and require a wallet-channel sync event before the scenario passes.
- Recorded a passing stricter full-stack smoke in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T00-23-45-258Z.md`, with underlying benchmark evidence in `docs/plans/phase3-benchmark-2026-04-13T00-24-08-028Z.md`. The run passed wallet-specific WebSocket sync fanout with 2 authenticated clients, p95 10.05 ms, and a recorded `sync:wallet:<id>` message from a `POST /api/v1/sync/queue/:walletId` trigger.
- Extended the Compose smoke with a worker-container BullMQ proof that enqueues and waits for local no-op jobs across sync, confirmations, notifications, maintenance, autopilot, and intelligence handlers.
- Recorded a passing full-stack smoke with worker queue proof in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T00-40-08-363Z.md`, with underlying benchmark evidence in `docs/plans/phase3-benchmark-2026-04-13T00-40-31-291Z.md`. The worker proof completed 6 jobs with p95 17.75 ms and zero failed jobs; it remains handler smoke evidence rather than privacy-safe queue load proof.
- Fixed the Redis WebSocket bridge to wait for duplicate Redis clients to be command-ready, including already-ready clients, before subscribing to the cross-instance broadcast channel.
- Extended the Compose smoke to scale the backend service to two replicas and require a wallet-specific sync event triggered on one backend to arrive on a WebSocket subscribed through the other backend via Redis.
- Recorded a passing full-stack smoke with backend scale-out proof in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T00-54-44-886Z.md`, with underlying benchmark evidence in `docs/plans/phase3-benchmark-2026-04-13T00-55-56-530Z.md`. The scale-out proof delivered `sync` on `wallet:b1f733a8-b9cf-4470-b706-d9183ed2cf7f` from backend-2 to a WebSocket on backend-1 in 12 ms; it remains local smoke evidence rather than load-balanced capacity proof.
- Added internal diagnostic worker jobs and retryable Electrum subscription ownership so a worker that misses a stale ownership lock keeps retrying instead of staying permanently non-owning.
- Extended the Compose smoke to scale the worker service to two replicas, prove diagnostic BullMQ jobs complete on both worker replicas, prove a shared diagnostic lock skips one concurrent duplicate, verify each recurring job has one repeatable definition, and require exactly one worker to own Electrum subscriptions after retry recovery.
- Recorded a passing full-stack smoke with worker scale-out proof in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T01-28-46-631Z.md`, with underlying benchmark evidence in `docs/plans/phase3-benchmark-2026-04-13T01-29-09-675Z.md`. The worker scale-out proof observed two healthy workers, diagnostic processors `9c71a1bac3c8` and `20725bb8a06e`, Electrum owner `sanctuary-phase3-benchmark-2026-04-13t01-28-46-631z-worker-1`, one locked diagnostic execution, one `lock_held` skip, and one repeatable definition for each core recurring job. The backend scale-out proof in the same run delivered the wallet sync event across backend replicas in 18 ms; this remains local smoke evidence rather than privacy-safe load/capacity proof.
- Extended the Compose smoke with a synthetic large-wallet transaction-history proof that creates a dedicated testnet proof wallet, inserts 1,000 synthetic transactions into the disposable PostgreSQL database, then measures 20 authenticated transaction-history requests at concurrency 4 against a p95 <= 2,000 ms local gate.
- Recorded a passing full-stack smoke with synthetic large-wallet, worker queue, worker scale-out, and backend scale-out proof in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T01-49-46-785Z.md`, with underlying benchmark evidence in `docs/plans/phase3-benchmark-2026-04-13T01-50-09-677Z.md`. The synthetic large-wallet proof inserted 1,000 transactions and passed 20 authenticated transaction-history requests with p95 28 ms and p99 28 ms. The worker scale-out proof observed two healthy workers, diagnostic processors `d2a0d29682f6` and `400e1aa03f10`, one Electrum owner, one locked diagnostic execution, one `lock_held` skip, and one repeatable definition for each core recurring job. The backend scale-out proof delivered the wallet sync event across backend replicas in 12 ms; this remains local smoke evidence rather than privacy-safe load-balanced capacity proof.
- Enabled backup restore inside the disposable Phase 3 Compose wrapper by default because the PostgreSQL database is temporary; `PHASE3_COMPOSE_ALLOW_RESTORE=false` can still force non-destructive mode for targeted checks.
- Recorded a passing full-stack smoke with backup restore, synthetic large-wallet, worker queue, worker scale-out, and backend scale-out proof in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T02-12-27-332Z.md`, with underlying benchmark evidence in `docs/plans/phase3-benchmark-2026-04-13T02-12-50-588Z.md`. The generated backup validate and restore scenarios passed with restore p95 56.23 ms; the synthetic large-wallet proof inserted 1,000 transactions and passed 20 authenticated transaction-history requests with p95 30.05 ms and p99 30.81 ms. The worker scale-out proof observed two healthy workers, diagnostic processors `fa871c32dbbd` and `0650d03c4daa`, one Electrum owner, one locked diagnostic execution, one `lock_held` skip, and one repeatable definition for each core recurring job. The backend scale-out proof delivered the wallet sync event across backend replicas in 13 ms; this remains local smoke evidence rather than privacy-safe load-balanced capacity proof.
- Extended the backend scale-out proof from a single cross-instance WebSocket to multiple wallet subscription WebSockets distributed across backend replicas. The Compose wrapper now requires every backend fanout client to receive the Redis-bridged sync event and records fanout latency.
- Recorded a passing full-stack smoke with backup restore, synthetic large-wallet, worker queue, worker scale-out, and multi-client backend fanout proof in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T02-21-10-302Z.md`, with underlying benchmark evidence in `docs/plans/phase3-benchmark-2026-04-13T02-21-33-723Z.md`. The generated backup validate and restore scenarios passed with restore p95 55.25 ms; the synthetic large-wallet proof inserted 1,000 transactions and passed 20 authenticated transaction-history requests with p95 31.05 ms and p99 31.81 ms. The worker scale-out proof observed two healthy workers, diagnostic processors `0c0bb91dbaa2` and `8d73f3bfbe68`, one Electrum owner, one locked diagnostic execution, one `lock_held` skip, and one repeatable definition for each core recurring job. The backend fanout proof delivered the wallet sync event to 8/8 WebSocket clients across 2 backend replicas via Redis with p95 14 ms; this remains local smoke evidence rather than privacy-safe load-balanced capacity proof.
- Extended the Compose wrapper into a heavier local capacity profile with configurable worker queue repeats, generated sized backup create/validate/restore proof, Postgres/Redis capacity snapshots, and disposable backend WebSocket limit overrides.
- Forwarded `MAX_WEBSOCKET_PER_USER` and `MAX_WEBSOCKET_CONNECTIONS` through `docker-compose.yml` so the backend can exercise repeatable local fanout profiles above the default per-user limit, and aligned Nginx `/api/` `client_max_body_size` with the backend's 200MB admin backup validate/restore parser.
- Recorded the repository-controlled Phase 3 close-out profile in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T02-50-46-877Z.md`, with underlying benchmark evidence in `docs/plans/phase3-benchmark-2026-04-13T02-51-11-475Z.md`. The run inserted 10,000 synthetic transactions, passed 100 authenticated transaction-history requests at concurrency 8 with p95 37.8 ms and p99 56 ms, created/validated/restored a 6.53 MiB generated backup with 10,076 records in 3,543 ms, completed 60 worker proof jobs with p95 16.4 ms, proved two-worker diagnostic processing and one Electrum owner, delivered the Redis-bridged sync event to 64/64 WebSocket clients across two backend replicas with p95 17 ms, and captured capacity snapshots from 10.01 MiB Postgres/2 MiB Redis at baseline to 24.66 MiB Postgres/2.95 MiB Redis after the local load profile.

Privacy-safe calibrated evidence still required before an A-grade scalability/performance claim:

- Run and record privacy-safe calibrated benchmark results for wallet sync, transaction history, WebSocket fanout with expected client counts and generated/operator-owned testnet update traffic, approved backup restore size in non-production, and worker queue processing.
- Keep the local auto-provisioned Compose smoke as endpoint-coverage and local capacity evidence; it now includes a synthetic 10,000-transaction wallet-history gate, 64-client two-backend Redis WebSocket fanout, 60 worker proof jobs, generated 10,076-record backup restore, and Postgres/Redis capacity snapshots, but still does not replace privacy-safe calibrated dataset/topology evidence for A-grade claims.
- Calibrate the scripted benchmark harness with fixture size, request counts, concurrency, and strict release thresholds after the first privacy-safe calibrated dataset run.
- Validate backend and worker scale-out capacity with privacy-safe non-production load-balanced and queue-load topologies; the local two-backend Redis WebSocket fanout smoke and two-worker BullMQ/Electrum ownership smoke are now recorded.
- Do not use third-party real-world wallets, addresses, public wallet histories, or private user wallet activity as benchmark targets. Use synthetic/regtest fixtures, operator-owned testnet wallets created for this purpose, or approved non-production backups.

Phase 3 action items carried forward after Phase 4:

- Use `npm run perf:phase3:compose-smoke` for repeatable disposable local seeded smoke evidence. For a manually managed private local target such as `https://10.14.23.93:8443`, use `SANCTUARY_BENCHMARK_PROVISION=true`; include `SANCTUARY_BENCHMARK_ALLOW_PRIVATE_PROVISION=true` and `SANCTUARY_INSECURE_TLS=true` when it uses the local development certificate.
- Provide valid local benchmark credentials via `SANCTUARY_BENCHMARK_USERNAME` and `SANCTUARY_BENCHMARK_PASSWORD`, or provide `SANCTUARY_TOKEN` plus `SANCTUARY_WALLET_ID`, so the authenticated local fixture path can create/reuse the benchmark wallet.
- Obtain a privacy-safe non-production `SANCTUARY_TOKEN` and `SANCTUARY_WALLET_ID` for transaction history and wallet sync queue benchmarks, using generated/regtest data or an operator-owned testnet wallet created for this purpose.
- Obtain a non-production `SANCTUARY_ADMIN_TOKEN` and approved `SANCTUARY_BACKUP_FILE` for backup validation and restore timing, with `SANCTUARY_ALLOW_RESTORE=true` only in a restore-safe environment.
- Use the disposable Compose smoke for repeatable local capacity and regression proof, including two-backend Redis WebSocket fanout, two-worker BullMQ/Electrum ownership, synthetic transaction-history, generated backup restore, worker queue repeats, and capacity snapshots; stand up or identify privacy-safe non-production load-balanced and worker queue-load topologies for capacity evidence.
- Record the next benchmark output under `docs/plans/` and update this plan with the resulting p95/p99, failure rate, and go/no-go decision.

## Phase 4 Start Notes

Status: **Baseline complete as of 2026-04-12**

Phase 4 is not dependent on completing the remaining Phase 3 benchmark runs. It should focus on maintainability guardrails that are objectively good regardless of benchmark timing: centralized validation for new and touched backend routes, gateway log redaction, release-gate documentation, and opportunistic cleanup only where files are already being changed.

Dependency note:

- Phase 4 can add the release-gate structure now.
- Phase 4 should reference the Phase 3 local capacity proof as complete, while keeping privacy-safe load, restore, and scale-out capacity calibration pending.
- The final A-grade scalability/performance claim remains blocked by the Phase 3 action items above.

Completed in the first Phase 4 slice:

- Added shared dependency-free metadata redaction in `shared/utils/redact.ts`.
- Updated the gateway logger to serialize metadata through shared redaction instead of raw `JSON.stringify(meta)`.
- Added gateway logger tests for sensitive field redaction, circular metadata, and bigint-safe serialization.

Completed in the second Phase 4 slice:

- Wired the authenticated user-search route through centralized request validation with `UserSearchQuerySchema`.
- Fixed the validation middleware to safely replace getter-backed Express 5 query objects after parsing.
- Added middleware coverage for getter-backed query validation and updated route coverage for structured validation errors.

Completed in the third Phase 4 slice:

- Added `docs/RELEASE_GATES.md` to map A-grade domains to required release checks.
- Marked the Phase 3 performance and scale gate as pending privacy-safe calibrated evidence instead of treating skipped authenticated benchmarks as proof.
- Documented that `npm run typecheck:tests` is advisory until its existing unused-symbol baseline is cleaned up.

Completed in the fourth Phase 4 slice:

- Cleaned the strict test typecheck baseline by fixing a stale `AdminUser` fixture, removing an unused test import, and making the UTXO summary grade-color assertion exercise the rendered class instead of leaving an unused query.
- Promoted `npm run typecheck:tests` from advisory to required frontend correctness evidence in `docs/RELEASE_GATES.md`.
- Added `npm run typecheck:app` and `npm run typecheck:tests` to the Test Suite quick and full frontend CI lanes so test fixture/type drift fails mechanically before frontend tests run.

Completed in the fifth Phase 4 slice:

- Reframed remaining scalability/performance evidence as privacy-safe calibration instead of real-world wallet benchmarking.
- Documented approved benchmark inputs: synthetic/regtest fixtures, operator-owned testnet wallets created for benchmark proof, and approved restore-safe non-production backups.
- Marked third-party wallets, addresses, public wallet histories, and private user wallet activity out of scope for benchmark targets.
- Updated the Phase 3 benchmark harness output language to match the privacy-safe evidence policy.

Completed in the sixth Phase 4 slice:

- Removed Swagger UI inline/CDN allowances from the default backend API CSP.
- Added a route-specific `/api/v1/docs` CSP that preserves the current Swagger UI CDN and inline bootstrap requirements only for the docs HTML response.
- Added OpenAPI route coverage that verifies the docs CSP is present for Swagger UI and absent from the raw OpenAPI JSON router response.

Completed in the seventh Phase 4 slice:

- Fixed the frontend coverage gate after CI showed root coverage including shared server/gateway contract files that are not frontend runtime code.
- Excluded `shared/schemas/mobileApiRequests.ts` and `shared/utils/gatewayAuth.ts` from the frontend coverage denominator because they are covered by server/gateway package-level contract tests.
- Added missing branch coverage for shared redaction utilities so the frontend coverage gate remains at 100%.

Completed in the eighth Phase 4 slice:

- Moved frontend API access-token persistence from durable `localStorage` to `sessionStorage` by default.
- Added an explicit `VITE_AUTH_TOKEN_STORAGE` switch for `session`, `memory`, and legacy `local` modes so more restrictive deployments can run memory-only without changing API-client call sites.
- Added legacy `localStorage` token migration/cleanup into session-scoped storage. This reduces durable browser token exposure, but it is not the final HttpOnly-cookie/session architecture.
- Added focused coverage for stored session token initialization, legacy local-mode initialization, and blocked `sessionStorage` memory fallback so the 100% frontend coverage gate stays green after the storage hardening.

Completed in the ninth Phase 4 slice (2026-04-13):

- Shipped ADR 0001 (HttpOnly cookies) and ADR 0002 (Web Locks-coordinated refresh flow) as a single coherent Phase 4. Browser access tokens now live in `sanctuary_access` (HttpOnly/Secure/SameSite=Strict), the refresh token in `sanctuary_refresh` (scoped to `/api/v1/auth/refresh`), and CSRF is enforced via `sanctuary_csrf` double-submit + `X-CSRF-Token`. The 1-hour access-token TTL is now invisible to the user: a proactive scheduled refresh fires 60s before expiry, a reactive 401 interceptor retries once, and `navigator.locks` serializes refresh across same-origin tabs with `BroadcastChannel('sanctuary-auth')` carrying state propagation only (no coordination). The WebSocket upgrade reads the cookie same-origin and the deprecated `?token=` query parameter path was removed. See ADR 0001/0002 Resolution sections.
- The previously undocumented gap "frontend has no refresh flow at all" is also resolved — the proactive + reactive + cross-tab Web Lock primitive is unit-tested with 27 tests in `tests/api/refresh.test.ts`, the 100% frontend coverage gate stays green, and `tests/setup.ts` now has pure-memory `navigator.locks` and `BroadcastChannel` mocks that support multi-instance "tab" simulation.
- Codex stop-time review caught and fixed six production bugs before merge: refresh precedence inverted, cookie-eviction on transient server failures, CSRF skip rule not mirroring auth precedence, refresh-on-401 exempt list too broad, BroadcastChannel-as-mutex race (ADR 0002 revised from Option C to Option E), and WebSocket ad-hoc subscription race across async cookie auth. All documented in `tasks/lessons.md`.

Ongoing post-Phase 4 hygiene:

- Continue adopting centralized backend request validation as routes are touched.
- Keep strict app and test typecheck green as frontend and test fixtures evolve.
- Phase 6 deprecation removal: one release after Phase 2 (i.e., when the JSON-token rollback window closes), remove the legacy `token`/`refreshToken` JSON fields from browser-mounted `/auth/login`, `/auth/2fa/verify`, and `/auth/refresh` responses; remove `VITE_AUTH_TOKEN_STORAGE` from `vite.config.ts` and `.env.example`; audit `src/api/client.ts` for Phase-4-era dead code.
- Keep large-file cleanup opportunistic and tied to files already being changed.

## Strengths To Preserve

- Keep the existing layered backend shape: routes, services, repositories, infrastructure, and lifecycle registry.
- Preserve the gateway whitelist model; generate or test it instead of removing it.
- Preserve worker ownership for background work and the Redis/BullMQ queue model.
- Preserve health, metrics, support packages, and monitoring dashboards; improve runbooks around them.
- Preserve extension-point documentation and the local registry patterns.

## Work To Defer Or Avoid

- Do not rewrite the backend into a new framework just to improve grades. The main problems are boundary contracts, not Express itself.
- Do not split large files as a standalone cleanup campaign unless the file is actively blocking work.
- Do not add new microservices for current issues. Gateway/backend contract sharing and tests should come first.
- Do not chase additional coverage percentage as the main goal. Existing artifacts already report very high coverage; prioritize contract tests and real failure modes.
- Do not optimize UI rendering or background animations without a measured regression or target budget.

## Verification Notes

Existing coverage artifacts reviewed:

- Frontend `coverage/lcov.info`: 100.00% lines (12980/12980), 100.00% branches (10616/10616), 100.00% functions (3430/3430).
- Server `server/coverage/lcov.info`: 99.20% lines (19101/19255), 98.49% branches (10165/10321), 99.22% functions (3555/3583).
- Gateway `gateway/coverage/lcov.info`: 100.00% lines (457/457), 100.00% branches (297/297), 98.72% functions (77/78).

The frontend artifact was regenerated during the Phase 4 coverage gate fix; server and gateway coverage artifacts were not regenerated during this refresh.

Fresh checks run in this refresh:

```text
npm run typecheck:app
cd server && npm run build
cd gateway && npm run build
cd ai-proxy && npm run build
cd server && npx vitest run tests/unit/middleware/gatewayAuth.test.ts tests/unit/middleware/bodyParsing.test.ts tests/unit/websocket/auth.test.ts tests/unit/middleware/validate.test.ts tests/unit/api/openapi.test.ts tests/unit/shared/gatewayAuth.test.ts
cd gateway && npx vitest run tests/unit/middleware/mobilePermission.test.ts tests/unit/middleware/validateRequest.test.ts tests/unit/routes/proxy.test.ts tests/unit/middleware/requestLogger.test.ts tests/unit/utils/logger.test.ts
TEST_POSTGRES_PORT=55433 npm run test:ops:phase2
MONITORING_BIND_ADDR=127.0.0.1 GRAFANA_PORT=13000 PROMETHEUS_PORT=19090 ALERTMANAGER_PORT=19093 JAEGER_UI_PORT=16687 JAEGER_OTLP_GRPC_PORT=14317 JAEGER_OTLP_HTTP_PORT=14318 LOKI_PORT=13100 npm run ops:monitoring:phase2
npm run ops:alert-receiver:phase2
npm run ops:gateway-audit:phase2
COMPOSE_PARALLEL_LIMIT=1 PHASE3_COMPOSE_BENCHMARK_TIMEOUT_MS=900000 SANCTUARY_TIMEOUT_MS=60000 PHASE3_LARGE_WALLET_TRANSACTION_COUNT=10000 PHASE3_LARGE_WALLET_HISTORY_REQUESTS=100 PHASE3_LARGE_WALLET_HISTORY_CONCURRENCY=8 PHASE3_WORKER_QUEUE_PROOF_REPEATS=10 PHASE3_WORKER_SCALE_OUT_JOB_COUNT=32 PHASE3_BACKEND_SCALE_OUT_WS_CLIENTS=64 npm run perf:phase3:compose-smoke
node --check scripts/perf/phase3-benchmark.mjs
node --check scripts/perf/phase3-compose-benchmark-smoke.mjs
docker compose config
npm run typecheck:tests
npm run typecheck:app
npx vitest run tests/components/UTXOList/UTXOSummaryBanners.test.tsx tests/components/UsersGroups/EditUserModal.branches.test.tsx tests/components/WalletDetail/modals/ReceiveModal.test.tsx
npm run test:hygiene -- tests/components/UTXOList/UTXOSummaryBanners.test.tsx tests/components/UsersGroups/EditUserModal.branches.test.tsx tests/components/WalletDetail/modals/ReceiveModal.test.tsx
rg -n "largest[-]known|production[-]like largest|operator eviden[c]e|representative operato[r]|largest expecte[d]|load[-]level" docs/plans/codebase-health-assessment.md docs/SCALABILITY_AND_PERFORMANCE.md docs/RELEASE_GATES.md scripts/perf -S
cd server && npx vitest run tests/unit/api/openapi.test.ts
cd server && npm run build
npx vitest run tests/config/coveragePolicy.test.ts tests/shared/redact.test.ts
npm run test:coverage
npm run typecheck:tests
npx vitest run tests/api/client.test.ts
npm run typecheck:app
git diff --check
npm audit --omit=dev
cd server && npm audit --omit=dev
cd gateway && npm audit --omit=dev --omit=optional
```

Fresh check outcomes:

```text
All non-audit checks above passed; audit commands completed with the accepted findings noted below.
Server targeted tests: 6 files passed, 52 tests passed.
Gateway targeted tests: 5 files passed, 178 tests passed in the initial refresh; the latest Phase 1 gateway route/request-validation/mobile-permission rerun passed 3 files, 158 tests after shared mobile-permission and draft schema expansion.
Phase 2 ops proof passed on disposable PostgreSQL: 1 integration file / 3 tests, using `sanctuary-test-db` on `localhost:55433` after the default `5433` port was already allocated.
Phase 2 monitoring smoke passed against the local Compose monitoring stack using alternate loopback ports: Grafana, Prometheus, Alertmanager, Jaeger, Loki, Promtail container health, Prometheus alert-rule loading, Promtail runtime log checks, and loopback host bindings passed. Evidence: `docs/plans/phase2-monitoring-smoke-2026-04-12T22-42-59-008Z.md`.
Phase 2 alert receiver delivery smoke passed against a disposable Alertmanager webhook receiver: receiver config generation, Alertmanager health/status, test alert submission, webhook payload delivery, and Alertmanager container health passed. Evidence: `docs/plans/phase2-alert-receiver-smoke-2026-04-12T23-33-46-561Z.md`.
Phase 2 gateway audit Compose smoke passed against a temporary backend/gateway/Postgres/Redis/worker stack: gateway health, missing-token protected-route event, signed backend audit persistence, unsigned audit rejection, gateway delivery logs, and Compose container health passed. Evidence: `docs/plans/phase2-gateway-audit-compose-smoke-2026-04-12T23-18-24-249Z.md`.
Phase 3 Compose benchmark smoke passed against a temporary frontend/backend/gateway/worker/Postgres/Redis stack: migration/seed, service health, frontend/API/gateway health, WebSocket handshake, local authenticated wallet list, wallet-specific WebSocket sync fanout, transaction-history, synthetic 10,000-transaction wallet-history gate, wallet-sync queueing, admin backup validation and restore, generated 10,076-record backup restore, 60 worker proof jobs, two-worker BullMQ/Electrum ownership proof, 64-client two-backend Redis WebSocket fanout, and Postgres/Redis capacity snapshots passed. Latest evidence: `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T02-50-46-877Z.md` and `docs/plans/phase3-benchmark-2026-04-13T02-51-11-475Z.md`.
Phase 3 close-out harness syntax, Compose config rendering, and diff whitespace checks passed: `node --check scripts/perf/phase3-compose-benchmark-smoke.mjs`, `docker compose config`, and `git diff --check`.
Phase 4 strict test typecheck gate passed: `npm run typecheck:tests`. Strict app typecheck also passed: `npm run typecheck:app`. The touched frontend test files passed: `npx vitest run tests/components/UTXOList/UTXOSummaryBanners.test.tsx tests/components/UsersGroups/EditUserModal.branches.test.tsx tests/components/WalletDetail/modals/ReceiveModal.test.tsx`. Test hygiene passed for those three files.
Phase 4 privacy-safe benchmark policy checks passed: `node --check scripts/perf/phase3-benchmark.mjs`, `node --check scripts/perf/phase3-compose-benchmark-smoke.mjs`, and `git diff --check` passed. The stale benchmark-target language scan returned no matches.
Phase 4 CSP hardening checks passed: `cd server && npx vitest run tests/unit/api/openapi.test.ts` passed 42 tests; `cd server && npm run build` passed.
Phase 4 frontend coverage gate fix passed: `npx vitest run tests/config/coveragePolicy.test.ts tests/shared/redact.test.ts` passed 2 files / 14 tests, `npm run test:coverage` passed 384 files / 5,432 tests with 100% statements/branches/functions/lines, and `npm run typecheck:tests` passed.
Phase 4 browser token storage hardening checks passed: `npx vitest run tests/api/client.test.ts` passed 56 tests, `npm run typecheck:app` passed, `npm run typecheck:tests` passed, and the pre-commit `npm run test:run` frontend suite passed 384 files / 5,432 tests.
Dependency audit refresh completed: root `npm audit --omit=dev` is down to 14 low upstream `elliptic` findings after the transitive Axios lockfile update; `server/` reports 3 moderate Prisma dev-chain `@hono/node-server` findings where npm suggests a force/breaking Prisma downgrade; `gateway/` production audit with optional deps omitted reports 0 vulnerabilities. Accepted findings are documented in `docs/DEPENDENCY_AUDIT_TRIAGE.md`.
Redis WebSocket bridge readiness targeted test passed after the duplicate-client ready-state fix: `npx vitest run tests/unit/websocket/redisBridge.connected.test.ts` from `server/` passed 17 tests.
The latest Phase 1 server OpenAPI/mobile-permission/types rerun passed 3 files, 72 tests after shared mobile-permission and draft schema expansion.
The latest Phase 1 gateway request-validation/proxy rerun passed 2 files, 149 tests after transaction/PSBT/device schema expansion.
The latest Phase 1 server OpenAPI/device rerun passed 2 files, 87 tests after transaction/PSBT/device schema expansion.
The latest Phase 1 backend transaction-schema adoption rerun passed `server/tests/unit/api/transactions-http-routes.test.ts` (60 tests), `gateway/tests/unit/middleware/validateRequest.test.ts` (75 tests), `server/tests/unit/api/openapi.test.ts` (13 tests), `cd server && npm run build`, and `cd gateway && npm run build`.
The latest Phase 1 backend device-schema adoption rerun passed `server/tests/unit/api/devices.test.ts` (74 tests), `gateway/tests/unit/middleware/validateRequest.test.ts` (75 tests), `cd server && npm run build`, and `cd gateway && npm run build`.
The latest Phase 1 Payjoin OpenAPI coverage rerun passed `server/tests/unit/api/openapi.test.ts` (14 tests), `server/tests/unit/api/payjoin.test.ts` (49 tests), and `cd server && npm run build`.
The latest Phase 1 transfer OpenAPI coverage rerun passed `server/tests/unit/api/openapi.test.ts` (15 tests), `server/tests/unit/api/transfers.test.ts` (48 tests), and `cd server && npm run build`.
The latest Phase 1 Treasury Intelligence OpenAPI coverage rerun passed `server/tests/unit/api/openapi.test.ts` (16 tests), `server/tests/unit/api/intelligence.test.ts` (22 tests), and `cd server && npm run build`.
The latest Phase 1 AI OpenAPI coverage rerun passed `server/tests/unit/api/openapi.test.ts` (17 tests), `server/tests/unit/api/ai.test.ts` (58 tests), and `cd server && npm run build`.
The latest Phase 1 wallet-sharing OpenAPI coverage rerun passed `server/tests/unit/api/openapi.test.ts` (18 tests), `server/tests/unit/api/wallet-sharing-routes.test.ts` (24 tests), `server/tests/unit/api/wallets.test.ts` (77 tests), `server/tests/contract/api.contract.test.ts` (27 tests), and `cd server && npm run build`.
The latest Phase 1 wallet import/XPUB OpenAPI coverage rerun passed `server/tests/unit/api/openapi.test.ts` (19 tests), `server/tests/unit/api/wallets-import-routes.test.ts` (11 tests), `server/tests/unit/api/wallets-xpubValidation-routes.test.ts` (10 tests), and `cd server && npm run build`.
The latest Phase 1 wallet analytics/device helper OpenAPI coverage rerun passed `server/tests/unit/api/openapi.test.ts` (20 tests), `server/tests/unit/api/wallets.test.ts` (77 tests), and `cd server && npm run build`.
The latest Phase 1 wallet export OpenAPI coverage rerun passed `server/tests/unit/api/openapi.test.ts` (21 tests), `server/tests/unit/api/wallets-export-routes.test.ts` (17 tests), and `cd server && npm run build`.
The latest Phase 1 wallet Telegram/Autopilot OpenAPI coverage rerun passed `server/tests/unit/api/openapi.test.ts` (22 tests), `server/tests/unit/api/wallets-telegram-routes.test.ts` (6 tests), `server/tests/unit/api/wallets-autopilot-routes.test.ts` (11 tests), and `cd server && npm run build`.
The latest Phase 1 wallet policy/approval OpenAPI coverage rerun passed `server/tests/unit/api/openapi.test.ts` (23 tests), `server/tests/unit/api/wallets-policies-routes.test.ts` (60 tests), `server/tests/unit/api/wallets-approvals-routes.test.ts` (24 tests), and `cd server && npm run build`.
The latest Phase 1 admin core OpenAPI coverage rerun passed `server/tests/unit/api/openapi.test.ts` (24 tests), `server/tests/unit/api/admin-version-routes.test.ts` (6 tests), `server/tests/unit/api/admin-features-routes.test.ts` (28 tests), `server/tests/unit/api/admin-routes.test.ts` (57 tests), and `cd server && npm run build`.
The latest Phase 1 admin audit-log OpenAPI/filter coverage rerun passed `server/tests/unit/api/openapi.test.ts` (25 tests), `server/tests/unit/api/admin-routes.test.ts` (58 tests), `server/tests/unit/services/auditService.test.ts` (38 tests), `server/tests/unit/repositories/auditLogRepository.test.ts` (34 tests), and `cd server && npm run build`.
The latest Phase 1 admin audit-stats consistency rerun passed `server/tests/unit/services/auditService.test.ts` (38 tests), `server/tests/unit/repositories/auditLogRepository.test.ts` (37 tests), and `cd server && npm run build`.
The latest Phase 1 admin user-management OpenAPI/client-contract rerun passed `server/tests/unit/api/openapi.test.ts` (26 tests), `server/tests/unit/api/admin-routes.test.ts` (59 tests), `tests/components/UsersGroups.test.tsx` (24 tests), `tests/components/UsersGroups.branches.test.tsx` (8 tests), `cd server && npm run build`, and `npm run typecheck:app`.
The latest Phase 1 admin group-management OpenAPI rerun passed `server/tests/unit/api/openapi.test.ts` (27 tests), `server/tests/unit/api/admin-groups-routes.test.ts` (27 tests), `server/tests/unit/api/admin-groupRoles.test.ts` (3 tests), `server/tests/unit/api/admin-routes.test.ts` (59 tests), `server/tests/unit/api/admin.test.ts` (71 tests), and `cd server && npm run build`.
The latest Phase 1 admin system-policy OpenAPI rerun passed `server/tests/unit/api/openapi.test.ts` (28 tests), `server/tests/unit/api/admin-policies-routes.test.ts` (25 tests), and `cd server && npm run build`.
The latest Phase 1 admin backup/restore/support-package OpenAPI rerun passed `server/tests/unit/api/openapi.test.ts` (29 tests), `server/tests/unit/api/admin-backup-routes.test.ts` (18 tests), `server/tests/unit/api/admin/supportPackage.test.ts` (5 tests), and `cd server && npm run build`.
The latest Phase 1 admin node-configuration/proxy OpenAPI rerun passed `server/tests/unit/api/openapi.test.ts` (30 tests), `server/tests/unit/api/admin-nodeConfig-routes.test.ts` (24 tests), and `cd server && npm run build`.
The latest Phase 1 admin Electrum-server OpenAPI rerun passed `server/tests/unit/api/openapi.test.ts` (31 tests), `server/tests/unit/api/electrumServers.test.ts` (35 tests), and `cd server && npm run build`.
The latest Phase 1 admin infrastructure/monitoring OpenAPI rerun passed `server/tests/unit/api/openapi.test.ts` (33 tests), `server/tests/unit/api/admin-infrastructure-routes.test.ts` (20 tests), `server/tests/unit/api/admin-monitoring-routes.test.ts` (16 tests), and `cd server && npm run build`.
The latest Phase 1 price OpenAPI/admin-cache rerun passed `server/tests/unit/api/openapi.test.ts` (34 tests), `server/tests/unit/api/price.test.ts` (46 tests), `server/tests/contract/api.contract.test.ts` (32 tests), and `cd server && npm run build`.
The latest Phase 1 Bitcoin utility/node/sync OpenAPI rerun passed `server/tests/unit/api/openapi.test.ts` (36 tests), `server/tests/unit/api/bitcoin.test.ts` (88 tests), `server/tests/unit/api/node.test.ts` (25 tests), `server/tests/unit/api/sync.test.ts` (38 tests), and `cd server && npm run build`.
The latest Phase 1 transaction helper OpenAPI rerun passed `server/tests/unit/api/openapi.test.ts` (37 tests), `server/tests/unit/api/transactions-coinSelection-routes.test.ts` (10 tests), `server/tests/unit/api/transactions-privacy-routes.test.ts` (11 tests), `server/tests/unit/api/transactions-transactionDetail-routes.test.ts` (8 tests), `server/tests/unit/api/transactions-http-routes.test.ts` (60 tests), `server/tests/unit/api/transactionsCrossWallet.test.ts` (20 tests), and `cd server && npm run build`.
The latest Phase 1 device secondary/label association OpenAPI rerun passed `server/tests/unit/api/openapi.test.ts` (39 tests), `server/tests/unit/api/devices.test.ts` (74 tests), `server/tests/unit/api/labels.test.ts` (39 tests), and `cd server && npm run build`.
The latest Phase 1 auth secondary OpenAPI rerun passed `server/tests/unit/api/openapi.test.ts` (40 tests), `server/tests/unit/api/auth.routes.registration.test.ts` (81 tests), `server/tests/unit/api/auth.routes.2fa.test.ts` (42 tests), `server/tests/unit/api/email.test.ts` (29 tests), `server/tests/unit/api/auth-telegram-routes.test.ts` (8 tests), `server/tests/unit/api/auth-password-routes.test.ts` (2 tests), and `cd server && npm run build`.
The latest Phase 1 health/global approval-helper OpenAPI rerun passed `server/tests/unit/api/openapi.test.ts` (41 tests), `server/tests/unit/api/health.test.ts` (47 tests), `server/tests/unit/api/approvals-routes.test.ts` (10 tests), and `cd server && npm run build`.
The latest Phase 1 internal gateway/AI OpenAPI rerun passed `server/tests/unit/api/openapi.test.ts` (42 tests), `server/tests/unit/api/mobilePermissions.test.ts` (36 tests), `server/tests/unit/api/ai-internal.test.ts` (77 tests), `server/tests/unit/api/ai-internal.intelligence.test.ts` (14 tests), and `cd server && npm run build`.
The Phase 1 close-out admin schema adoption rerun passed `server/tests/unit/api/schemas.test.ts`, `server/tests/unit/api/admin-routes.test.ts`, `server/tests/unit/api/admin.test.ts`, `server/tests/unit/api/admin-groups-routes.test.ts`, `server/tests/unit/api/admin-groupRoles.test.ts`, `server/tests/unit/api/electrumServers.test.ts`, `server/tests/unit/api/admin-backup-routes.test.ts`, and `server/tests/unit/api/admin-features-routes.test.ts` (8 files / 253 tests), plus `server/tests/unit/api/openapi.test.ts` (42 tests) and `cd server && npm run build`.
```

Not run in this refresh:

- Full backend/gateway coverage suites.
- Backend integration suite.
- Playwright e2e suite.
- Install/container workflows.
- Critical mutation gate.
- Phase 3 privacy-safe calibrated wallet/load benchmark, WebSocket fanout under expected client counts and generated/operator-owned testnet events, worker queue load benchmark, approved backup restore-size benchmark, and backend scale-out load/capacity benchmark.
- Durable production external alert receiver delivery.
