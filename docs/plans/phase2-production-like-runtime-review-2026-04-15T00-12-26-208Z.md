# Phase 2 Production-Like Runtime Review

Date: 2026-04-15T00:12:26.208Z
Status: Passed
Evidence source: `docs/plans/phase3-compose-benchmark-smoke-2026-04-15T00-12-26-208Z.md`

## Scope

This review uses the disposable Phase 3 Compose benchmark as production-like runtime evidence. The stack used frontend, gateway, backend, worker, PostgreSQL, and Redis containers, then scaled the backend and worker services to two replicas for the scale-out proofs.

This was not a production telemetry review. It used repository-generated fixture data only, excluded user wallet activity, and did not inspect or export sensitive logs.

## Runtime Window

- Compose project: `sanctuary-phase3-benchmark-2026-04-15t00-12-26-208z`
- API URL: `https://127.0.0.1:18443`
- Gateway URL: `http://127.0.0.1:14000`
- WebSocket URL: `wss://127.0.0.1:18443/ws`
- Initial stack health: migration/seed completed, frontend/API/gateway health checks passed, and all service groups were healthy before the load profile.
- Final topology: 2 backend containers, 2 worker containers, frontend, gateway, PostgreSQL, and Redis all reported `running` and `healthy` in the benchmark evidence.

## Workload Observed

- Authenticated wallet list, transaction history, WebSocket subscription fanout, wallet sync queue, backup validation, and backup restore scenarios all passed with 0 recorded errors.
- Large-wallet history proof inserted 25,000 synthetic transactions and passed 100 authenticated transaction-history requests at concurrency 10 with p95 70 ms and p99 77.02 ms against a 2,000 ms p95 gate.
- Sized backup restore proof created a 16.3 MiB generated backup with 25,076 records and restored it in 12,533 ms.
- Worker queue proof completed 30 jobs across sync, confirmations, notifications, maintenance, autopilot, and intelligence handlers with p95 16.2 ms and 0 failed queue entries.
- Worker scale-out proof observed two healthy workers, diagnostic jobs processed by both worker replicas, one shared-lock skip, and exactly one Electrum subscription owner.
- Backend scale-out proof delivered a Redis-bridged wallet sync event from backend-2 to 100/100 WebSocket clients across two backend replicas with p95 23 ms.

## Capacity Snapshot

| Point | PostgreSQL size | PostgreSQL connections | Transactions | Redis memory | Redis clients | Redis keys |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline after health | 10.01 MiB | 4/100 | 0 | 2 MiB | 25 | 44 |
| After local load profile | 46.14 MiB | 13/100 | 25,000 | 2.98 MiB | 49 | 94 |

## Incident Review

No production incident was reviewed. For this production-like runtime window:

- No benchmark scenario failed.
- Scenario tables recorded 0 errors for frontend health, API health, gateway health, WebSocket handshake, wallet list, WebSocket fanout, transaction history, wallet sync queue, backup validate, and backup restore.
- Queue counts after the worker proof showed 0 failed jobs for sync, notifications, confirmations, and maintenance queues.
- The disposable stack was stopped and removed after the proof completed.

## Decision

Production-like runtime evidence is complete for the local generated-data stack. A real production telemetry or incident review should still be attached to a release or operations handoff when an operator-controlled deployment exists, but the prior "no runtime evidence at all" gap is closed by this clean full-stack runtime window.
