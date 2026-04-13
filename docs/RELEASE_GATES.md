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
| API/gateway contracts | Contract and drift-prone boundary tests | Targeted tests for gateway HMAC, WebSocket auth, mobile permission, request logging, body parsing, gateway whitelist, and new/touched schemas | Required when touched |
| Dependency security | Production advisory review | `npm audit --omit=dev` in root and `server/`; `cd gateway && npm audit --omit=dev --omit=optional`; plus documented accepted findings | Required before release |
| Container/install validation | Fresh install, install script, container health, auth flow | `.github/workflows/install-test.yml` release gate | Required for release candidates/releases |
| Operations supportability | Runbook coverage and proof for backup/restore, gateway audit persistence, alert receiver delivery, and monitoring stack behavior | `docs/OPERATIONS_RUNBOOKS.md` updated when alerts or operational flows change; `npm run test:ops:phase2` when backup/restore or in-process gateway audit paths are touched; `npm run ops:gateway-audit:phase2` when backend/gateway containers or gateway audit delivery paths are touched; `npm run ops:monitoring:phase2` when monitoring Compose, Prometheus/Loki/Grafana/Jaeger/Alertmanager, or Promtail paths are touched; `npm run ops:alert-receiver:phase2` when Alertmanager routing or receiver config is touched | Required when touched |
| Performance and scale | Phase 3 benchmark harness in strict mode | `npm run perf:phase3:compose-smoke` for disposable local authenticated capacity proof; `SANCTUARY_BENCHMARK_STRICT=true npm run perf:phase3` with representative scenario inputs for production-like datasets | Local proof complete; pending representative operator evidence |

## Phase 3 Pending Evidence

These gates are required before the scalability/performance domain can move to A:

- Local authenticated capacity coverage now has disposable Compose proof in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T02-50-46-877Z.md`, with benchmark output in `docs/plans/phase3-benchmark-2026-04-13T02-51-11-475Z.md`; keep rerunning `npm run perf:phase3:compose-smoke` when Compose startup, seeded auth, benchmark provisioning, synthetic large-wallet history, WebSocket fanout, backup validation/restore, worker queue handler, worker scale-out, Electrum ownership, Redis-backed backend scale-out, backend fanout paths, Nginx backup payload limits, or Postgres/Redis capacity snapshot logic change.
- Production-like largest-known-wallet transaction history and wallet sync queue benchmarks with `SANCTUARY_TOKEN` and `SANCTUARY_WALLET_ID`; the local synthetic 10,000-transaction gate is repository-controlled regression evidence, not representative operator evidence.
- Representative backup restore only in a restore-safe environment, with `SANCTUARY_ADMIN_TOKEN`, `SANCTUARY_BACKUP_FILE`, and `SANCTUARY_ALLOW_RESTORE=true`; the disposable Compose smoke proves a generated 6.53 MiB backup with 10,076 restored records, but not the largest expected support backup size.
- Representative WebSocket fanout with operator client counts and production-like sync or transaction events; the local Compose smoke now proves the authenticated wallet-specific subscription path and 64-client two-backend Redis bridge delivery.
- Representative worker queue processing under production-like sync, notification, maintenance, autopilot, and intelligence job volume; the local Compose smoke now proves a repeated 60-job handler profile and proves two-worker diagnostic processing/ownership.
- Representative backend scale-out load/capacity evidence; the local 64-client two-backend Redis WebSocket smoke is recorded in `docs/plans/phase3-compose-benchmark-smoke-2026-04-13T02-50-46-877Z.md`.
- Representative worker scale-out queue-load and Electrum subscription-volume evidence before production worker replica support is broadened beyond the local smoke boundary.

Record benchmark output under `docs/plans/` and link it from `docs/plans/codebase-health-assessment.md`.

## Phase 4 Typecheck Gate

`npm run typecheck:tests` passed after the Phase 4 unused-symbol fixture cleanup and is now a required frontend correctness gate alongside `npm run typecheck:app`.
