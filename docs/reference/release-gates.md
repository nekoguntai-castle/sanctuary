# Sanctuary Release Gates

Date: 2026-04-24 (Pacific/Honolulu)
Status: Phase 4 release-gate baseline; upgrade matrix promoted to release-blocking; Phase 3 generated capacity proof is current; PR-first CI/CD strategy active; merge-queue ready but blocked by current user-owned repository eligibility

This document records the checks that should protect the A-grade engineering goals in `docs/plans/codebase-health-assessment.md`. A release should not claim an A grade in a domain unless the matching gate has passed or the plan explicitly marks the gate as pending with an owner and date.

## Policy

- Required gates block a release when they fail.
- Pending gates do not prove an A-grade claim yet. They are tracked here so skipped data-dependent work is visible instead of silently ignored.
- Area-specific gates are required when the release touches that area or when the release notes claim an improvement in that area.
- Accepted dependency findings must remain documented in `docs/plans/dependency-audit-triage.md`; new high or critical production advisories require a fix or explicit risk acceptance before release.
- CI/CD tiering, required aggregate checks, merge-queue behavior, and emergency hotfix rules are documented in `docs/reference/ci-cd-strategy.md`.

## Required Gates

| Area | Gate | Evidence | Status |
| --- | --- | --- | --- |
| Frontend correctness | Strict app and test typecheck | `npm run typecheck:app` and `npm run typecheck:tests`; the Test Suite quick/full frontend lanes run both before frontend tests | Required |
| Frontend tests | Threshold-enforced coverage | `npm run test:coverage` or the `full-frontend-tests` CI job | Required for main/release |
| Backend build | TypeScript build and Prisma generation | `cd server && npm run build` | Required |
| Backend test typing | Server test-infrastructure typecheck | `cd server && npm run typecheck:tests`; `cd server && npm run typecheck:tests:full` tracks the broader historical test fixture debt until that full suite can become the required gate | Required for backend changes |
| Backend tests | Unit and integration coverage | `cd server && npm run test:unit -- --coverage` and `cd server && npm run test:integration`, or the `full-backend-tests` CI job | Required for main/release |
| Gateway build | TypeScript build | `cd gateway && npm run build` | Required |
| Gateway tests | Threshold-enforced coverage | `cd gateway && npm run test:coverage` or the `full-gateway-tests` CI job | Required for main/release |
| Critical security logic | Mutation gate for auth, access control, address derivation, and PSBT validation | `cd server && npm run test:mutation:critical:gate` or the `full-critical-mutation` CI job | Required when touched; required for main/nightly |
| Browser auth and CSP | API-client cookie auth, CSRF double-submit, refresh flow, and route-scoped Swagger CSP | `npx vitest run tests/api/client.test.ts tests/api/refresh.test.ts tests/services/websocket.test.ts tests/contexts/UserContext.test.tsx`; `cd server && npx vitest run tests/unit/middleware/csrf.test.ts tests/unit/middleware/auth.test.ts tests/unit/api/auth.test.ts tests/unit/api/openapi.test.ts tests/unit/websocket/auth.test.ts` when backend auth/CSP/docs routing changes | Required when touched |
| API/gateway contracts | Contract and drift-prone boundary tests | Targeted tests for gateway HMAC, WebSocket auth, mobile permission, request logging, body parsing, gateway whitelist, and new/touched schemas | Required when touched |
| Dependency security | Production advisory review | `npm audit --omit=dev` in root and `server/`; `cd gateway && npm audit --omit=dev --omit=optional`; plus documented accepted findings | Required before release |
| Container/install validation | Fresh install, install script, container health, auth flow | `.github/workflows/install-test.yml` release gate | Required for release candidates/releases |
| Upgrade preservation | Historical ref-to-ref upgrade matrix with fixture-backed user-visible smoke | `.github/workflows/release-candidate.yml` and release-tag `.github/workflows/install-test.yml` run `tests/install/e2e/upgrade-install.test.sh --mode core` across `latest-stable/baseline`, `n-2/baseline`, `latest-stable/browser-origin-ip`, `latest-stable/legacy-runtime-env`, and `latest-stable/notification-delivery`; failed lanes upload redacted upgrade artifacts | Required for release candidates/releases |
| Operations supportability | Runbook coverage and proof for backup/restore, gateway audit persistence, alert receiver delivery, and monitoring stack behavior | `docs/how-to/operations-runbooks.md` updated when alerts or operational flows change; `npm run test:ops:phase2` when backup/restore or in-process gateway audit paths are touched; `npm run ops:gateway-audit:phase2` when backend/gateway containers or gateway audit delivery paths are touched; `npm run ops:monitoring:phase2` when monitoring Compose, Prometheus/Loki/Grafana/Jaeger/Alertmanager, or Promtail paths are touched; `npm run ops:alert-receiver:phase2` when Alertmanager routing or receiver config is touched | Required when touched |
| Performance and scale | Phase 3 benchmark harness in strict mode | `npm run perf:phase3:compose-smoke` for disposable local authenticated generated-data capacity proof; `SANCTUARY_BENCHMARK_STRICT=true npm run perf:phase3` with operator-owned testnet/regtest or approved non-production scenario inputs for target-environment calibration | Generated proof complete; target-environment rerun required when topology/hardware differs |

Upgrade-path policy: upgrade regressions can lock operators out of existing nodes, so the ref-to-ref upgrade matrix is now a release-blocking gate. The core lane preserves encrypted admin 2FA, encrypted secondary-user 2FA, legacy plaintext 2FA, backup-code state, representative app data, runtime secrets, legacy `.env` compatibility, browser/proxy login and refresh, CSRF-protected support-package generation, worker health, notification worker DLQ diagnostics, and migration completion. The script's `--mode full` path remains available for local stress passes that include older recovery scenarios such as password drift, rebuild, and volume persistence.

## Phase 3 Target-Environment Evidence

Repository-controlled generated-data evidence is current enough for the local scalability/performance claim. These gates are required before broadening production scale-out support or claiming that a specific deployment topology has the same capacity:

- Current cleanup status as of 2026-04-14 HST: no target-environment calibration run was performed in this cleanup batch because no release target topology, hardware, load balancer, Postgres, Redis, or worker sizing was provided. The local generated proof remains current; deployment-specific capacity claims remain pending until the release record captures the topology and evidence fields below.
- Last generated capacity evidence was produced 2026-04-15 UTC (proof artifacts removed from repo; available in git history at `docs/plans/phase3-compose-benchmark-smoke-2026-04-15T06-25-20-675Z.md` and `docs/plans/phase3-benchmark-2026-04-15T06-25-45-349Z.md`). Regenerate with `npm run perf:phase3:compose-smoke` when Compose startup, seeded auth, benchmark provisioning, synthetic large-wallet history, WebSocket fanout, backup validation/restore, worker queue handler, worker scale-out, Electrum ownership, Redis-backed backend scale-out, backend fanout paths, Nginx backup payload limits, runtime TLS material handling, or Postgres/Redis capacity snapshot logic change.
- The current generated profile covers 25,000 synthetic transactions, 100 authenticated transaction-history requests at concurrency 10, p95 70 ms, p99 77.17 ms, a 16.3 MiB generated restore with 25,076 records, 6 worker queue proof jobs, two-worker diagnostic processing/ownership, 100/100 Redis-bridged WebSocket clients across two backend replicas, and Postgres/Redis capacity snapshots.
- Repeat transaction history, wallet sync queue, WebSocket fanout, worker queue, backend scale-out, and worker scale-out checks on the target non-production topology when hardware, load balancer, Postgres, Redis, or worker sizing differs from the local Compose proof.
- Use approved backup restore only in a restore-safe environment, with `SANCTUARY_ADMIN_TOKEN`, `SANCTUARY_BACKUP_FILE`, and `SANCTUARY_ALLOW_RESTORE=true`, when the supported backup size exceeds the 16.3 MiB generated proof.

Do not benchmark third-party real-world wallets, addresses, or public wallet histories. Public testnet availability can be used for operator-owned fixture wallets, but scale should come from generated/regtest data or approved non-production testnet wallets rather than profiling someone else's wallet activity.

Target-environment calibration is not complete until the release record names the exact non-production topology and captures all of the following:

- Hardware or instance class, CPU count, memory, disk class, and network placement for backend, gateway, worker, Postgres, and Redis.
- Replica counts and load-balancer behavior for frontend, backend, gateway, and worker containers.
- Database and Redis connection limits, pool settings, and observed p95 latency during the run.
- Benchmark input shape: generated transaction count, history request count/concurrency/page size, WebSocket client count, worker queue job count, worker replica count, backend replica count, and approved backup size if restore is claimed.
- Strict-mode command and environment overrides, including whether the run used generated/regtest data or operator-owned testnet fixtures.
- Pass/fail decision against the initial performance gates, with any release-specific thresholds called out explicitly.

Record benchmark output under `docs/plans/` and link it from `docs/plans/codebase-health-assessment.md`.

## Phase 4 Typecheck Gate

`npm run typecheck:tests` passed after the Phase 4 unused-symbol fixture cleanup and is now a required frontend correctness gate alongside `npm run typecheck:app`.

## Backend Coverage Policy

Backend unit coverage is enforced at literal 100% statements, branches, functions, and lines through `server/vitest.config.ts`. New reachable logic should be covered with focused unit tests before thresholds are updated or code is merged.

Allowed backend coverage exclusions are limited to generated Prisma output, type-only files, zero-logic compatibility re-export shims, side-effect-only daemon entrypoints whose behavior is covered through modules they wire together, and external-service producers that require live infrastructure and are covered by integration tests. Any `v8 ignore` pragma must state the unreachable or externally covered condition in the comment. Prefer adding a test and removing the pragma whenever the branch is reachable without live infrastructure.

The main backend coverage command is:

```bash
cd server && npm run test:unit -- --coverage
```

The server test type gate is intentionally split while historical fixture drift is paid down:

```bash
cd server && npm run typecheck:tests
cd server && npm run typecheck:tests:full
```

The first command is the required CI gate for server test infrastructure and representative typed tests. The second command is the expansion target for the full server test suite and should be run during cleanup work that touches shared test fixtures, mocks, route harnesses, or DTO-heavy tests.

## Phase 4 Browser Auth Gate

**Resolved as of 2026-04-13.** The HttpOnly cookie migration (ADR 0001) and Web Locks-coordinated refresh flow (ADR 0002) shipped together. See ADR 0001/0002 Resolution sections and `docs/how-to/operations-runbooks.md` "Browser Auth Cookies" for the full behavior.

- The access token lives in a `sanctuary_access` HttpOnly, Secure, SameSite=Strict cookie. Scripts cannot read it.
- The refresh token lives in a `sanctuary_refresh` HttpOnly cookie scoped to `Path=/api/v1/auth/refresh`. The browser never sends it to any other endpoint.
- CSRF is enforced via a `sanctuary_csrf` readable double-submit cookie echoed as `X-CSRF-Token` on POST/PUT/PATCH/DELETE when the request authenticates via cookie. `Authorization: Bearer` requests (mobile/gateway) are exempt.
- Proactive refresh fires 60s before `X-Access-Expires-At`; reactive refresh on 401 retries the request once; `navigator.locks` serializes refresh across same-origin tabs; BroadcastChannel propagates `refresh-complete` and `logout-broadcast` state.
- Refresh-on-401 exempt list is only the four credential-presentation endpoints: `/auth/login`, `/auth/register`, `/auth/2fa/verify`, `/auth/refresh`. `/auth/me`, `/auth/logout`, and `/auth/logout-all` refresh-and-retry on 401 so valid-session recovery and server-side revocation both work.
- The WebSocket upgrade reads `sanctuary_access` from the `Cookie` header; the deprecated `?token=` query parameter path is removed. The client waits for the server's `'connected'` welcome message before sending any subscribe/unsubscribe frames (gating on `readyState === OPEN` races the server's async cookie auth).

Gate: `tests/api/client.test.ts`, `tests/api/refresh.test.ts`, `tests/services/websocket.test.ts`, `tests/contexts/UserContext.test.tsx`, `server/tests/unit/middleware/csrf.test.ts`, `server/tests/unit/middleware/auth.test.ts`, `server/tests/unit/api/auth.test.ts`, and `server/tests/unit/websocket/auth.test.ts` must all pass. The 100% frontend coverage gate must stay green for `src/api/refresh.ts`, the 401 interceptor branches in `src/api/client.ts`, and the `isServerReady` branches in `services/websocket.ts`.
