# Codebase Health Assessment

Date: 2026-04-11 (Pacific/Honolulu)
Owner: TBD
Status: Phase 3 scalability/performance work in progress; Phase 4 is not started

## Scope

This assessment reviews the repository across extensibility, scalability, performance, perpetual operations and monitoring/supportability, security, and technical debt.

Inputs used:

- Static review of the React/Vite frontend, Express backend, mobile gateway, AI proxy, Docker deployment, monitoring stack, route contracts, and tests.
- Existing coverage artifacts in `coverage/`, `server/coverage/`, and `gateway/coverage/`.
- Phase 3 local smoke benchmark record in `docs/plans/phase3-benchmark-2026-04-12T04-00-40-678Z.md`.
- Targeted build and typecheck checks:
  - `cd server && npm run build` passed.
  - `cd gateway && npm run build` passed.
  - Initial `npm run typecheck:app` failed on unused frontend symbols; Phase 0 restored it to passing.

Not performed:

- Full unit/integration/e2e suite rerun.
- Production-like load testing beyond the Phase 3 smoke harness.
- Monitoring stack exercise.
- Production log, incident, or runtime metric review.

## Executive Summary

Overall grade: **B**

The codebase is much stronger than average for a self-hosted financial app. It has clear service/repository layering, documented extension points, a dedicated worker process, Redis-backed coordination, comprehensive health checks, Prometheus/Grafana/Loki/Jaeger support, high recorded coverage, and strong security primitives around JWTs, encryption, 2FA, rate limiting, and internal-network controls.

The main risk is not broad architecture quality. After Phase 0, the highest-risk direct defects in gateway-to-backend HMAC signing, WebSocket JWT audience enforcement, backup/restore body-parser ordering, and frontend strict typecheck have been fixed. The remaining path to A grades is centered on preventing future boundary drift, especially through OpenAPI/shared schemas, gateway whitelist contract tests, runbooks, and repeatable performance/scale checks.

## Scorecard

| Domain | Grade | Rationale |
| --- | --- | --- |
| Extensibility | B+ | Strong route/service/repository boundaries, extension-point docs, registries for routes/tabs/backgrounds/flags/importers/providers, and a service lifecycle registry. Grade is held back by duplicate contracts and incomplete OpenAPI coverage. |
| Scalability | B | Dedicated worker, BullMQ/Redis, distributed lock patterns, WebSocket limits, Redis bridge for cross-instance broadcasts, Prisma indexes, and cache invalidation are solid. The default Compose deployment is still a single backend/worker topology and needs explicit HA/runbook guidance before relying on scale-out. |
| Performance | B | Caching, React Query discipline, Electrum pooling, database indexes, API aggregation work, and bounded WebSocket queues are good. Phase 0 fixed the backup/restore parser issue; missing load/perf budgets are now the main gap. |
| Perpetual operations and supportability | B+ | `/health`, `/api/v1/health`, `/metrics`, Prometheus alerts, Grafana/Loki/Jaeger, support-package collectors, Docker healthchecks, resource limits, and Nginx blocks for `/metrics` and `/internal/` are strong. Phase 0 fixed the gateway audit HMAC path; runbooks and restore drills remain the main supportability gaps. |
| Security | B | The baseline is good: JWT audiences exist, production secrets are required, 2FA is present, encryption uses AES-GCM, rate limiting fails closed, Helmet is configured, and internal routes are protected by Nginx. Phase 0 fixed WebSocket access-token enforcement and the internal gateway HMAC drift; remaining work is browser token/CSP hardening, broader schema validation, and ongoing release gates. |
| Technical debt | B | There is extensive test coverage and useful architecture docs. Phase 0 restored strict frontend typecheck and shared the gateway HMAC contract; remaining debt is concentrated in incomplete OpenAPI, duplicated API schemas/whitelist definitions, unused centralized validation middleware, and a few oversized modules. |

## Roadmap To A Grades

This roadmap focuses on changes that are objectively good for the codebase: they remove demonstrated defects, prevent recurring contract drift, improve production diagnosability, or prove scale/performance assumptions. It intentionally avoids framework rewrites, broad microservice splits, and file-splitting campaigns that do not directly reduce current risk.

| Phase | Target | Work | Exit Criteria | Expected Grade Movement |
| --- | --- | --- | --- | --- |
| 0 | Stabilize correctness and security | Fix gateway/backend HMAC contract drift, WebSocket JWT audience enforcement, backup/restore large-body parsing, and the current frontend strict typecheck failures. | Gateway-signed requests verify in backend contract tests; WebSocket refresh and 2FA tokens are rejected; admin restore/validate accepts payloads above 10MB and below the intended limit; `npm run typecheck:app`, `cd server && npm run build`, and `cd gateway && npm run build` pass. | Security and technical debt move out of B- territory; supportability improves because known broken operational paths are fixed. |
| 1 | Make boundary contracts source-of-truth driven | Complete OpenAPI coverage for implemented API domains; share or generate request schemas for drift-prone gateway/backend routes; contract-test the gateway whitelist against backend routes/OpenAPI; align push registration and transaction-detail route patterns. | New or changed public/gateway API routes cannot merge without OpenAPI/schema coverage or explicit contract tests; gateway whitelist tests prove allowed mobile routes still exist and blocked routes remain blocked. | Extensibility reaches A- or A; security and technical debt improve because contract drift becomes mechanically harder. |
| 2 | Bring operations to production-grade | Add runbooks for existing alerts, queue stalls, Electrum degradation, sync failures, DB saturation, backup/restore failures, and gateway audit failures; verify gateway audit persistence; document and secure monitoring exposure; run a backup/restore drill. | Each critical alert has an owner-facing triage doc; monitoring ports are documented as local/private or protected; a restore drill result is recorded; gateway audit events persist through the HMAC path. | Perpetual operations and supportability reaches A- or A. |
| 3 | Prove scalability and performance | Document supported scale-out topology; define what can be replicated and what remains singleton; add load/perf checks for wallet sync, large wallet list views, transaction history aggregation, WebSocket fanout, backup/restore, and queue processing. | A repeatable benchmark or scheduled perf suite records p95/p99 targets; scale-out docs cover backend, worker, Redis, Postgres, WebSocket broadcasts, and Electrum ownership; regressions have a clear threshold. | Scalability and performance reach A- or A. |
| 4 | Institutionalize maintainability | Adopt centralized validation for new and touched backend routes; add gateway log redaction; modularize oversized files only when already changing them; keep dependency/security/container checks in release gates; maintain the A-grade contract and runbook checks. | New API work follows validation and contract guardrails; gateway logs use shared redaction; large-file cleanup is tied to active edits; release gates include typecheck, builds, contract checks, security checks, and targeted perf/ops checks. | Technical debt reaches A- or A and the earlier grade gains become durable. |

Suggested sequencing:

1. Phase 0 first. It fixes known defects and restores baseline signal.
2. Phase 1 second. It prevents the same gateway/API drift from returning.
3. Phase 2 and Phase 3 can run partly in parallel after Phase 0 if ownership is split.
4. Phase 4 should start after Phase 1 guardrails exist and then continue as normal engineering hygiene.

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
| P1 | Make API/gateway contracts source-of-truth driven. | The gateway whitelist, request validators, backend route schemas, and OpenAPI spec are drifting. Generating or sharing route schemas prevents repeat defects. | `server/src/api/openapi/spec.ts` assembles auth, wallets, devices, sync, bitcoin, and price, but omits many implemented domains such as transactions, drafts, push, mobile permissions, admin, payjoin, transfers, and gateway contracts. |
| P1 | Align gateway mobile request validation with backend route bodies. | First Phase 1 slice completed for push registration; broader shared/generated schemas still remain. | `gateway/src/middleware/validateRequest.ts` now validates `token`, matching backend `POST /api/v1/push/register`. |
| P1 | Add gateway whitelist contract tests against real backend route definitions or OpenAPI. | First Phase 1 slice completed for transaction detail route alignment; broader generated/OpenAPI-backed contract tests still remain. | Gateway whitelist now exposes backend `GET /api/v1/transactions/:txid` and blocks the old non-existent wallet-scoped detail route. |
| P1 | Start using centralized request validation for backend APIs in new and touched routes. | `req.body`, `req.params`, and `req.query` are read directly in many routes. Schema-first validation improves security, error consistency, and generated contract quality. | `server/src/middleware/validate.ts` exists, but no `validate(...)` use was found in `server/src/api`. |
| P1 | Harden browser token handling and CSP. | Access tokens in localStorage make XSS higher impact, and the backend CSP has broad inline/CDN exceptions. Moving docs UI exceptions to a narrower route or self-hosting assets reduces exposure. | `src/api/client.ts` stores `sanctuary_token` in `localStorage`. `server/src/index.ts` allows `'unsafe-inline'` and `https://unpkg.com` for scripts/styles. |
| P1 | Add gateway log redaction before metadata volume grows. | Server logging has structured redaction, but gateway logging stringifies metadata directly. Shared redaction reduces the chance of leaking tokens, device IDs, or other sensitive fields as gateway features expand. | `server/src/utils/logger.ts` uses `redactObject`; `gateway/src/utils/logger.ts` logs `JSON.stringify(meta)`. |
| P1 | Add runbooks for alerts and routine operations. | The monitoring stack is present, but operators need triage steps for wallet sync failures, Electrum degradation, queue stalls, restore failures, DB saturation, and gateway audit failures. | `docker-compose.monitoring.yml`, `docker/monitoring/alert_rules.yml`, health checks, and support-package collectors exist; no obvious runbook ties alerts to actions. |
| P2 | Add a small load/performance gate for high-risk workflows. | The architecture is performance-aware, but load tests would catch regressions in wallet sync, large wallet list views, WebSocket fanout, backup/restore, and transaction-history aggregation. | Existing code has caching, indexes, and queues, but this assessment did not find a repeatable perf budget or load-test gate. |
| P2 | Document the supported scale-out topology. | Redis bridge, distributed locks, worker queues, and health checks suggest scale-out intent, but the default Compose topology is single backend and single worker. Operators need clear guidance on what can be replicated and what must stay singleton. | `docker-compose.yml` runs one backend service and one worker service by default; worker comments describe single ownership of background processing. |
| P2 | Modularize oversized files only when touching them for product work. | Splitting purely for aesthetics can add churn. Splitting when changing the file reduces review risk and makes future edits easier. | Large production files include `ai-proxy/src/index.ts`, `server/src/repositories/transactionRepository.ts`, `server/src/services/bitcoin/electrumPool/electrumPool.ts`, and `server/src/worker.ts`. |

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

Status: **Contract checkpoint complete as of 2026-04-11**

Completed in the first Phase 1 slice:

- Aligned gateway push registration validation with the backend request body by validating `token` instead of the gateway-only `deviceToken` field.
- Replaced the gateway whitelist's non-existent wallet-scoped transaction-detail path with the backend's canonical `GET /api/v1/transactions/:txid` path; server-side `findByTxidWithAccess` remains the wallet-access boundary for transaction detail.
- Added gateway tests that reject the old push registration body field, allow the backend transaction-detail route, and keep raw transaction detail blocked unless deliberately exposed.
- Fixed gateway validation path reconstruction so schema validation uses the same `baseUrl + path` model as whitelist checks for routes mounted through the general `/api/v1` proxy.

Remaining Phase 1 work:

- Complete OpenAPI coverage for implemented public and gateway-relevant domains.
- Add broader gateway whitelist contract checks against backend route definitions or generated OpenAPI.
- Share or generate schemas for more drift-prone gateway/backend request bodies.

## Phase 2 Start Notes

Status: **In progress as of 2026-04-12**

Completed in the first Phase 2 slice:

- Added `docs/OPERATIONS_RUNBOOKS.md` with triage and mitigation steps for HTTP errors, wallet sync failures, transaction broadcast failures, worker/queue stalls, Electrum degradation, DB saturation, cache hit-rate drops, WebSocket alerts, backup/restore failures, and gateway audit failures.
- Bound optional monitoring stack host ports to `127.0.0.1` by default via `MONITORING_BIND_ADDR`, with explicit documentation for intentional remote exposure.
- Updated server push route tests so gateway-internal HMAC verification preserves `originalUrl` and signs the same full `/api/v1/push/...` paths the gateway uses, including gateway audit persistence.

Remaining Phase 2 work:

- Run and record a real backup/restore drill against a non-production database.
- Exercise the monitoring stack locally and capture any environment-specific runbook adjustments.
- Add durable alert receiver configuration once production notification channels are chosen.

## Phase 3 Start Notes

Status: **In progress as of 2026-04-12**

Completed so far:

- Added `docs/SCALABILITY_AND_PERFORMANCE.md` with the current supported scale-out topology, component replication boundaries, required metrics, initial p95/p99 gates, and a benchmark run record template.
- Documented that backend and gateway replicas are the safer first scale-out targets, while worker replicas require non-production validation of recurring job ownership, distributed locks, and Electrum subscriptions before production use.
- Mapped existing Prometheus metrics and dashboards to the Phase 3 benchmark scenarios for HTTP APIs, database queries, wallet sync, worker queues, WebSocket fanout, Electrum pool behavior, cache behavior, and backup/restore.
- Added `npm run perf:phase3`, a dependency-free benchmark harness that records Markdown and JSON run evidence under `docs/plans/`.
- Recorded the first unauthenticated local smoke run in `docs/plans/phase3-benchmark-2026-04-12T04-00-40-678Z.md`. Frontend health, API health, gateway health, and WebSocket protocol readiness passed; authenticated wallet list, large wallet transaction history, wallet sync queueing, backup validation, and restore were skipped because no operator token, wallet ID, or backup file was provided.
- Explicitly kept production worker scale-out unsupported until a non-production worker scale-out smoke test proves recurring ownership, distributed locks, and Electrum subscriptions are safe.

Remaining Phase 3 work:

- Run and record authenticated benchmark results for wallet sync, large wallet transaction history, WebSocket fanout with subscriptions/events, backup validation, backup restore in non-production, and worker queue processing.
- Calibrate the scripted benchmark harness with realistic dataset size, request counts, concurrency, and strict release thresholds after the first authenticated run.
- Validate backend scale-out with at least two backend instances and Redis-backed WebSocket broadcast delivery.

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

- Frontend coverage artifact reports 100% lines/statements/functions/branches.
- Server `lcov.info` reports about 99.2% lines and 98.49% branches.
- Gateway `lcov.info` reports 100% lines and 100% branches, with 98.72% functions.

These artifacts were not regenerated during this assessment.

Current known check failures from this assessment:

```text
None after Phase 0 verification.
```

Current known passing checks from this assessment:

```text
cd server && npx vitest run tests/unit/middleware/gatewayAuth.test.ts tests/unit/middleware/bodyParsing.test.ts tests/unit/websocket/auth.test.ts tests/integration/websocket/websocket.integration.test.ts
cd gateway && npx vitest run tests/unit/services/backendEvents.auth.test.ts tests/unit/services/backendEvents.deviceTokens.test.ts tests/unit/middleware/mobilePermission.test.ts tests/unit/middleware/requestLogger.test.ts
cd gateway && npx vitest run tests/unit/config.test.ts
npm run typecheck:app
cd server && npm run build
cd gateway && npm run build
```
