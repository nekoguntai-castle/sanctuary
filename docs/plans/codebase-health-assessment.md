# Codebase Health Assessment

Date: 2026-04-11 (Pacific/Honolulu)
Owner: TBD
Status: Refreshed assessment; Phase 3 benchmark and operations proof items are carried forward

## Scope

This assessment reviews the repository across extensibility, scalability, performance, perpetual operations and monitoring/supportability, security, and technical debt.

Inputs used:

- Static review of the React/Vite frontend, Express backend, mobile gateway, AI proxy, Docker deployment, monitoring stack, route contracts, and tests.
- Existing coverage artifacts in `coverage/`, `server/coverage/`, and `gateway/coverage/`.
- Phase 3 local smoke benchmark records in `docs/plans/phase3-benchmark-2026-04-12T04-00-40-678Z.md` and `docs/plans/phase3-benchmark-2026-04-12T05-12-14-935Z.md`.
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
- Production-like load testing beyond the Phase 3 smoke harness.
- Monitoring stack exercise.
- Production log, incident, or runtime metric review.
- Real backup/restore drill against a non-production database.
- Dependency audit rerun.

## Executive Summary

Overall grade: **B+**

The codebase is stronger than the previous baseline. It has clear service/repository layering, documented extension points, a dedicated worker process, Redis-backed coordination, comprehensive health checks, Prometheus/Grafana/Loki/Jaeger support, high recorded coverage, release-gate documentation, and strong security primitives around JWT audiences, encryption, 2FA, rate limiting, gateway HMAC auth, and internal-network controls.

The main risk is no longer broad architecture quality or known P0 correctness defects. The remaining path to A grades is centered on proof and drift prevention: complete OpenAPI/shared schema coverage, generated or route-backed gateway whitelist checks, authenticated performance/scale benchmarks, a non-production restore drill, monitoring-stack exercise, production alert receivers, and continued browser token/CSP hardening.

## Scorecard

| Domain | Grade | Rationale |
| --- | --- | --- |
| Extensibility | B+ | Strong route/service/repository boundaries, extension-point docs, registries for routes/tabs/backgrounds/flags/importers/providers, and a service lifecycle registry. Grade is held back by incomplete OpenAPI coverage outside the gateway surface and hand-maintained gateway/backend request contracts. |
| Scalability | B | Dedicated worker, BullMQ/Redis, distributed locks, WebSocket limits, Redis bridge broadcasts, Prisma indexes, cache invalidation, and a scale-out baseline are solid. The grade stays at B until backend scale-out, worker ownership, Redis/Postgres capacity, and WebSocket fanout are validated under non-production load. |
| Performance | B | Caching, React Query discipline, Electrum pooling, database indexes, API aggregation, bounded WebSocket queues, and a Phase 3 benchmark harness are good. Authenticated large-wallet, wallet-sync, WebSocket fanout, backup/restore, and worker queue benchmarks are still pending. |
| Perpetual operations and supportability | B+ | `/health`, `/api/v1/health`, `/metrics`, Prometheus alerts, Grafana/Loki/Jaeger, support-package collectors, Docker healthchecks, resource limits, monitoring exposure docs, and operations runbooks are strong. Restore drills, monitoring-stack exercise, production alert receivers, and runtime incident evidence are still missing. |
| Security | B | JWT audiences, token revocation, 2FA, production secret requirements, AES-GCM encryption, rate limiting, Helmet, gateway HMAC auth, redacted gateway logs, and internal routes are good. Browser token storage in `localStorage`, broad CSP exceptions for docs UI, partial validation/schema coverage, and unaudited dependency posture keep it below A. |
| Technical debt | B+ | Strict app typecheck, backend/gateway/AI builds, high recorded coverage, release gates, extension docs, shared gateway/redaction utilities, and shared mobile API request schemas are good. Remaining debt is concentrated in incomplete OpenAPI, remaining duplicated API request schemas, advisory-only test typecheck, and a few oversized modules. |

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

1. Keep Phase 1 as the highest-leverage next engineering slice because it prevents recurring gateway/API drift.
2. Finish Phase 2 proof work before claiming A-grade operations.
3. Finish Phase 3 authenticated and scale-out benchmarks before claiming A-grade scalability or performance.
4. Continue Phase 4 hygiene as normal engineering practice when routes, schemas, gateway logging, and oversized files are touched.

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
| P1 | Make API/gateway contracts source-of-truth driven. | A broad Phase 1 checkpoint now covers every current gateway whitelist route in OpenAPI, the whitelist/OpenAPI test matrix is derived from gateway route metadata, and shared mobile request schemas now feed gateway validation plus OpenAPI limits/constants across auth, push, labels, mobile permissions, drafts, transaction/PSBT, and device write bodies. Generation/shared schemas are still preferable for broader backend contracts and request bodies. | `server/src/api/openapi/spec.ts` now includes gateway-exposed auth/session, wallet sync, transaction, address, UTXO, label, Bitcoin status/fees, price, push, device, draft, and mobile-permission routes. Implemented but non-gateway domains such as admin, payjoin, transfers, and broader internal contracts still need coverage decisions. |
| P1 | Align gateway mobile request validation with backend route bodies. | Phase 1 now covers shared auth login/refresh/logout/2FA/preferences, push register/unregister, wallet label create/update, mobile-permission update, draft signing update, transaction/PSBT create-broadcast-estimate, and device create/update schemas for the gateway path. Broader work remains for backend route adoption or generated OpenAPI from Zod where it reduces drift. | `shared/schemas/mobileApiRequests.ts` provides shared Zod schemas, mobile action constants, draft status constants, device constants, and request limits; `gateway/src/middleware/validateRequest.ts` consumes them for gateway validation; OpenAPI auth/push/label/mobile-permission/draft/transaction/device schemas reuse the same constants where applicable. |
| P1 | Add generated or route-backed gateway whitelist contract tests. | Completed for current gateway routes: `ALLOWED_ROUTES` is derived from `GATEWAY_ROUTE_CONTRACTS`, and the test uses that same metadata to assert OpenAPI path/method coverage. The remaining improvement is eventual codegen/shared route registration from backend/OpenAPI if route churn justifies it. | `gateway/src/routes/proxy/whitelist.ts` owns the route regex, sample path, and OpenAPI path metadata; `gateway/tests/unit/routes/proxy.test.ts` asserts each current gateway whitelist route is allowed and has a matching OpenAPI path/method. It also blocks stale routes for wallet-scoped sync, legacy label item updates, and legacy draft-signing POST paths. |
| P1 | Start using centralized request validation for backend APIs in new and touched routes. | Started in Phase 4 with the authenticated user-search route. Schema-first validation improves security, error consistency, and generated contract quality; broader route adoption should continue as files are touched. | `server/src/api/auth/profile.ts` now uses `validate({ query: UserSearchQuerySchema })`; `server/src/middleware/validate.ts` now safely replaces getter-backed Express 5 query objects; `server/tests/unit/middleware/validate.test.ts` and `server/tests/unit/api/auth.routes.registration.test.ts` cover the behavior. |
| P1 | Harden browser token handling and CSP. | Access tokens in localStorage make XSS higher impact, and the backend CSP has broad inline/CDN exceptions. Moving docs UI exceptions to a narrower route or self-hosting assets reduces exposure. | `src/api/client.ts` stores `sanctuary_token` in `localStorage`. `server/src/index.ts` allows `'unsafe-inline'` and `https://unpkg.com` for scripts/styles. |
| P1 | Add gateway log redaction before metadata volume grows. | Completed in Phase 4. Keep it as a release gate when new gateway metadata is added because it reduces token, secret, and credential leakage risk. | `shared/utils/redact.ts`, `gateway/src/utils/logger.ts`, and fresh `cd gateway && npx vitest run tests/unit/utils/logger.test.ts` passed. |
| P1 | Complete operations proof, not just operations docs. | Runbooks now exist, but A-grade operations still need a non-production restore drill, monitoring-stack exercise, alert receiver configuration, and recorded gateway audit persistence evidence. | `docs/OPERATIONS_RUNBOOKS.md` maps alerts and failure modes to triage; `docker-compose.monitoring.yml` binds monitoring ports to loopback by default; no restore-drill record was found in this assessment. |
| P2 | Run authenticated performance and scale gates for high-risk workflows. | The Phase 3 harness and scale topology docs exist, but skipped authenticated scenarios do not prove production-like performance. Load evidence would catch regressions in wallet sync, large wallet transaction history, WebSocket fanout, backup/restore, and worker queues. | `docs/SCALABILITY_AND_PERFORMANCE.md` and `npm run perf:phase3` exist; Phase 3 records show health/WebSocket smoke passed while authenticated and data-dependent scenarios were skipped or blocked by invalid local credentials. |
| P2 | Validate the supported scale-out topology. | Redis bridge, distributed locks, worker queues, health checks, and scale-out docs show intent. Operators still need evidence for two backend/WebSocket instances sharing Redis and for worker replica safety, or an explicit production singleton worker policy. | `docker-compose.yml` runs one backend service and one worker service by default; `docs/SCALABILITY_AND_PERFORMANCE.md` keeps worker scale-out non-production only until validated. |
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

Status: **Broad OpenAPI-backed gateway checkpoint complete as of 2026-04-11**

Completed in the first Phase 1 slice:

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

Remaining Phase 1 work:

- Decide which non-gateway public domains should be documented next, including payjoin, transfers, intelligence, AI, and remaining wallet/admin surfaces.
- Adopt shared schemas directly in more backend routes or generate OpenAPI from Zod for high-risk write bodies where that would reduce drift beyond the gateway path.
- Consider generating gateway route metadata from OpenAPI or backend route registration if future route churn makes manual metadata updates costly.

## Phase 2 Progress Notes

Status: **Runbook baseline complete; proof work pending**

Completed in the first Phase 2 slice:

- Added `docs/OPERATIONS_RUNBOOKS.md` with triage and mitigation steps for HTTP errors, wallet sync failures, transaction broadcast failures, worker/queue stalls, Electrum degradation, DB saturation, cache hit-rate drops, WebSocket alerts, backup/restore failures, and gateway audit failures.
- Bound optional monitoring stack host ports to `127.0.0.1` by default via `MONITORING_BIND_ADDR`, with explicit documentation for intentional remote exposure.
- Updated server push route tests so gateway-internal HMAC verification preserves `originalUrl` and signs the same full `/api/v1/push/...` paths the gateway uses, including gateway audit persistence.

Remaining Phase 2 work:

- Run and record a real backup/restore drill against a non-production database.
- Exercise the monitoring stack locally and capture any environment-specific runbook adjustments.
- Add durable alert receiver configuration once production notification channels are chosen.
- Record gateway audit persistence evidence in an environment with backend and gateway using the production-style HMAC path.

## Phase 3 Progress Notes

Status: **In progress as of 2026-04-12**

Completed so far:

- Added `docs/SCALABILITY_AND_PERFORMANCE.md` with the current supported scale-out topology, component replication boundaries, required metrics, initial p95/p99 gates, and a benchmark run record template.
- Documented that backend and gateway replicas are the safer first scale-out targets, while worker replicas require non-production validation of recurring job ownership, distributed locks, and Electrum subscriptions before production use.
- Mapped existing Prometheus metrics and dashboards to the Phase 3 benchmark scenarios for HTTP APIs, database queries, wallet sync, worker queues, WebSocket fanout, Electrum pool behavior, cache behavior, and backup/restore.
- Added `npm run perf:phase3`, a dependency-free benchmark harness that records Markdown and JSON run evidence under `docs/plans/`.
- Recorded the first unauthenticated local smoke run in `docs/plans/phase3-benchmark-2026-04-12T04-00-40-678Z.md`. Frontend health, API health, gateway health, and WebSocket protocol readiness passed; authenticated wallet list, large wallet transaction history, wallet sync queueing, backup validation, and restore were skipped because no operator token, wallet ID, or backup file was provided.
- Added opt-in local fixture provisioning for the Phase 3 harness with `SANCTUARY_BENCHMARK_PROVISION=true`: the harness can log into a local seeded instance, create or reuse a testnet benchmark wallet, and optionally generate an in-memory backup with `SANCTUARY_BENCHMARK_CREATE_BACKUP=true`.
- Recorded a private local smoke run against `https://10.14.23.93:8443` in `docs/plans/phase3-benchmark-2026-04-12T05-12-14-935Z.md`. Frontend health, API health, gateway health, and WebSocket handshake passed; authenticated fixture provisioning was skipped because the default `admin` / `sanctuary` credentials returned `401 Invalid username or password`.
- Explicitly kept production worker scale-out unsupported until a non-production worker scale-out smoke test proves recurring ownership, distributed locks, and Electrum subscriptions are safe.

Remaining Phase 3 work:

- Run and record authenticated benchmark results for wallet sync, large wallet transaction history, WebSocket fanout with subscriptions/events, backup validation, backup restore in non-production, and worker queue processing.
- Record a local auto-provisioned smoke run, then separately record a representative large-wallet run because the local generated wallet proves end-to-end behavior but not scale characteristics.
- Calibrate the scripted benchmark harness with realistic dataset size, request counts, concurrency, and strict release thresholds after the first authenticated run.
- Validate backend scale-out with at least two backend instances and Redis-backed WebSocket broadcast delivery.

Phase 3 action items carried forward after Phase 4:

- Use `SANCTUARY_BENCHMARK_PROVISION=true` against a local seeded instance to capture wallet list, transaction history, wallet sync queue, and optional backup validation smoke evidence without manually obtaining a token and wallet ID. For the private local target at `https://10.14.23.93:8443`, include `SANCTUARY_BENCHMARK_ALLOW_PRIVATE_PROVISION=true` and `SANCTUARY_INSECURE_TLS=true` when it uses the local development certificate.
- Provide valid local benchmark credentials via `SANCTUARY_BENCHMARK_USERNAME` and `SANCTUARY_BENCHMARK_PASSWORD`, or provide `SANCTUARY_TOKEN` plus `SANCTUARY_WALLET_ID`, so the authenticated local fixture path can create/reuse the benchmark wallet.
- Obtain a representative non-production `SANCTUARY_TOKEN` and `SANCTUARY_WALLET_ID` for large-wallet transaction history and wallet sync queue benchmarks.
- Obtain a non-production `SANCTUARY_ADMIN_TOKEN` and representative `SANCTUARY_BACKUP_FILE` for backup validation, with `SANCTUARY_ALLOW_RESTORE=true` only in a restore-safe environment.
- Stand up or identify two backend/WebSocket endpoints sharing Redis so the Redis-backed cross-instance WebSocket broadcast smoke test can be recorded.
- Record the next benchmark output under `docs/plans/` and update this plan with the resulting p95/p99, failure rate, and go/no-go decision.

## Phase 4 Start Notes

Status: **Baseline complete as of 2026-04-12**

Phase 4 is not dependent on completing the remaining Phase 3 benchmark runs. It should focus on maintainability guardrails that are objectively good regardless of benchmark timing: centralized validation for new and touched backend routes, gateway log redaction, release-gate documentation, and opportunistic cleanup only where files are already being changed.

Dependency note:

- Phase 4 can add the release-gate structure now.
- Phase 4 should reference Phase 3 benchmark artifacts as optional or pending until the authenticated and scale-out runs are recorded.
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
- Marked the Phase 3 performance and scale gate as pending operator evidence instead of treating skipped authenticated benchmarks as proof.
- Documented that `npm run typecheck:tests` is advisory until its existing unused-symbol baseline is cleaned up.

Ongoing post-Phase 4 hygiene:

- Continue adopting centralized backend request validation as routes are touched.
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

- Frontend `coverage/lcov.info`: 100.00% lines (12908/12908), 100.00% branches (10548/10548), 100.00% functions (3418/3418).
- Server `server/coverage/lcov.info`: 99.20% lines (19101/19255), 98.49% branches (10165/10321), 99.22% functions (3555/3583).
- Gateway `gateway/coverage/lcov.info`: 100.00% lines (457/457), 100.00% branches (297/297), 98.72% functions (77/78).

These artifacts were not regenerated during this assessment.

Fresh checks run in this refresh:

```text
npm run typecheck:app
cd server && npm run build
cd gateway && npm run build
cd ai-proxy && npm run build
cd server && npx vitest run tests/unit/middleware/gatewayAuth.test.ts tests/unit/middleware/bodyParsing.test.ts tests/unit/websocket/auth.test.ts tests/unit/middleware/validate.test.ts tests/unit/api/openapi.test.ts tests/unit/shared/gatewayAuth.test.ts
cd gateway && npx vitest run tests/unit/middleware/mobilePermission.test.ts tests/unit/middleware/validateRequest.test.ts tests/unit/routes/proxy.test.ts tests/unit/middleware/requestLogger.test.ts tests/unit/utils/logger.test.ts
```

Fresh check outcomes:

```text
All checks above passed.
Server targeted tests: 6 files passed, 52 tests passed.
Gateway targeted tests: 5 files passed, 178 tests passed in the initial refresh; the latest Phase 1 gateway route/request-validation/mobile-permission rerun passed 3 files, 158 tests after shared mobile-permission and draft schema expansion.
The latest Phase 1 server OpenAPI/mobile-permission/types rerun passed 3 files, 72 tests after shared mobile-permission and draft schema expansion.
The latest Phase 1 gateway request-validation/proxy rerun passed 2 files, 149 tests after transaction/PSBT/device schema expansion.
The latest Phase 1 server OpenAPI/device rerun passed 2 files, 87 tests after transaction/PSBT/device schema expansion.
```

Not run in this refresh:

- Full frontend/backend/gateway coverage suites.
- Backend integration suite.
- Playwright e2e suite.
- Install/container workflows.
- Critical mutation gate.
- Dependency audits.
- Phase 3 authenticated benchmark or scale-out smoke.
- Monitoring stack exercise.
- Non-production backup/restore drill.
