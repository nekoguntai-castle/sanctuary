# Phase 3 Compose Benchmark Smoke

Date: 2026-04-13T02:21:10.302Z
Status: Passed
Compose project: sanctuary-phase3-benchmark-2026-04-13t02-21-10-302z
API URL: https://127.0.0.1:18443
Gateway URL: http://127.0.0.1:14000
WebSocket URL: wss://127.0.0.1:18443/ws

## Results

- PASS compose stack started: project=sanctuary-phase3-benchmark-2026-04-13t02-21-10-302z apiPort=18443 gatewayPort=14000
- PASS database migration and seed: migrate exited with 0
- PASS compose container health: 6 service containers running and healthy
- PASS frontend health: status=200
- PASS gateway health: status=200
- PASS phase3 benchmark harness: npm run perf:phase3 completed in strict mode
- PASS benchmark evidence written: docs/plans/phase3-benchmark-2026-04-13T02-21-33-723Z.md and docs/plans/phase3-benchmark-2026-04-13T02-21-33-723Z.json
- PASS authenticated scenario proof: wallet list, large wallet transaction history, websocket subscription fanout, wallet sync queue, backup validate, backup restore passed
- PASS large-wallet transaction-history proof: 1000 synthetic transactions; 20 requests at concurrency 4; p95=31.05ms target<=2000ms
- PASS worker queue proof: 6 jobs completed across sync, confirmations, notifications, maintenance, autopilot, intelligence; p95=15.5ms
- PASS worker scale-out proof: 2 workers healthy; processors=0c0bb91dbaa2, 8d73f3bfbe68; electrumOwner=sanctuary-phase3-benchmark-2026-04-13t02-21-10-302z-worker-1; lockedSkips=1
- PASS backend scale-out websocket proof: sync event from sanctuary-phase3-benchmark-2026-04-13t02-21-10-302z-backend-2 reached 8/8 WebSockets across 2 backend replicas via Redis; p95=14ms

## Benchmark Evidence

- Markdown: docs/plans/phase3-benchmark-2026-04-13T02-21-33-723Z.md
- JSON: docs/plans/phase3-benchmark-2026-04-13T02-21-33-723Z.json
- Dataset: local auto-provisioned benchmark fixture; not a large-wallet performance dataset

## Scenario Summary

| Scenario | Status | Requests | Successes | Errors | p95 ms | p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| frontend health | passed | 5 | 5 | 0 | 23.13 | 25.9 |
| api health | passed | 5 | 5 | 0 | 9.15 | 9.17 |
| gateway health | passed | 5 | 5 | 0 | 2.35 | 2.49 |
| websocket handshake | passed | 2 | 2 | 0 | 2.22 | 2.23 |
| wallet list | passed | 5 | 5 | 0 | 16.74 | 17.19 |
| websocket subscription fanout | passed | 2 | 2 | 0 | 9.33 | 9.33 |
| large wallet transaction history | passed | 5 | 5 | 0 | 11.76 | 11.8 |
| wallet sync queue | passed | 5 | 5 | 0 | 5.18 | 5.21 |
| backup validate | passed | 1 | 1 | 0 | 4.31 | 4.31 |
| backup restore | passed | 1 | 1 | 0 | 55.25 | 55.25 |

## Large Wallet Transaction-History Proof

Dataset: 1000 synthetic transactions
Wallet: Phase 3 Large Wallet 2026-04-13T02-21-10-302Z (4236aad2-187d-426f-8272-9852b12d443b)
Traffic: 20 requests at concurrency 4
Page size: 50
p95: 31.05 ms
p99: 31.81 ms
Gate: p95 <= 2000 ms

## Worker Queue Proof

Total duration: 98 ms
Job p95: 15.5 ms

| Category | Queue | Job | State | Duration ms |
| --- | --- | --- | --- | ---: |
| sync | sync | check-stale-wallets | completed | 14 |
| confirmations | confirmations | update-all-confirmations | completed | 4 |
| notifications | notifications | confirmation-notify | completed | 10 |
| maintenance | maintenance | cleanup:expired-tokens | completed | 4 |
| autopilot | maintenance | autopilot:evaluate | completed | 16 |
| intelligence | maintenance | intelligence:cleanup | completed | 7 |

Queue counts after proof:

- sync: waiting=0 active=0 delayed=1 failed=0 completed=1
- notifications: waiting=0 active=0 delayed=0 failed=0 completed=1
- confirmations: waiting=0 active=0 delayed=1 failed=0 completed=1
- maintenance: waiting=0 active=0 delayed=9 failed=0 completed=3

## Worker Scale-Out Proof

Worker replicas: 2
Diagnostic job processors: 0c0bb91dbaa2, 8d73f3bfbe68
Electrum subscription owner: sanctuary-phase3-benchmark-2026-04-13t02-21-10-302z-worker-1
Locked diagnostic result: 1 executed, 1 skipped by lock

| Category | Job | State | Processor | Duration ms |
| --- | --- | --- | --- | ---: |
| worker-distribution | diagnostics:worker-ping | completed | 0c0bb91dbaa2 | 301 |
| worker-distribution | diagnostics:worker-ping | completed | 8d73f3bfbe68 | 301 |
| worker-distribution | diagnostics:worker-ping | completed | 0c0bb91dbaa2 | 602 |
| worker-distribution | diagnostics:worker-ping | completed | 8d73f3bfbe68 | 602 |
| worker-distribution | diagnostics:worker-ping | completed | 0c0bb91dbaa2 | 903 |
| worker-distribution | diagnostics:worker-ping | completed | 8d73f3bfbe68 | 903 |
| worker-distribution | diagnostics:worker-ping | completed | 8d73f3bfbe68 | 1207 |
| worker-distribution | diagnostics:worker-ping | completed | 0c0bb91dbaa2 | 1207 |

Repeatable job ownership:

- sync:check-stale-wallets: repeatable definitions=1
- confirmations:update-all-confirmations: repeatable definitions=1
- maintenance:cleanup:expired-drafts: repeatable definitions=1
- maintenance:cleanup:expired-transfers: repeatable definitions=1
- maintenance:cleanup:audit-logs: repeatable definitions=1
- maintenance:cleanup:price-data: repeatable definitions=1
- maintenance:cleanup:fee-estimates: repeatable definitions=1
- maintenance:cleanup:expired-tokens: repeatable definitions=1
- maintenance:maintenance:weekly-vacuum: repeatable definitions=1
- maintenance:maintenance:monthly-cleanup: repeatable definitions=1
- maintenance:backup:scheduled: repeatable definitions=1

## Backend Scale-Out Proof

Backend replicas: 2
WebSocket clients: 8/8 received the event across 2 backend replicas
Trigger target: sanctuary-phase3-benchmark-2026-04-13t02-21-10-302z-backend-2 (172.29.0.9)
Wallet: Phase 3 Scale-Out Wallet 2026-04-13T02-21-10-302Z (adb86300-c195-46e8-ba74-db0faa6cf335)
Trigger status: 200
Fanout p95: 14 ms

## Containers

- backend: state=running health=healthy
- backend: state=running health=healthy
- frontend: state=running health=healthy
- gateway: state=running health=healthy
- postgres: state=running health=healthy
- redis: state=running health=healthy
- worker: state=running health=healthy
- worker: state=running health=healthy

## Notes

- This proof starts a disposable full-stack Docker Compose project with frontend, backend, gateway, worker, Redis, and PostgreSQL services.
- The smoke waits for database migration and seed completion, then runs the existing Phase 3 benchmark harness with local fixture provisioning.
- The run proves authenticated wallet list, transaction-history, WebSocket subscription fanout, wallet-sync queue, and admin backup-validation paths execute end to end on a local seeded stack.
- The large-wallet transaction-history proof seeds synthetic transaction rows into the disposable PostgreSQL database and measures the authenticated wallet transaction-history endpoint against a strict local p95 gate.
- The worker queue proof enqueues and waits for BullMQ jobs across sync, confirmations, notifications, maintenance, autopilot, and intelligence handlers in the running worker container.
- The worker scale-out proof runs two worker replicas, verifies diagnostic BullMQ jobs complete on both replicas, proves a shared diagnostic lock skips one concurrent duplicate, checks recurring jobs have one repeatable definition, and requires exactly one worker to own Electrum subscriptions.
- The backend scale-out proof runs two backend replicas, opens multiple wallet subscription WebSockets across the replicas, triggers wallet sync on one replica, and requires the Redis bridge to deliver the sync event to every client.
- The local generated wallets and two-replica topology are smoke evidence only; production-like largest-known-wallet, load-level fanout, and capacity evidence remain required before claiming Phase 3 complete.
- The disposable wrapper enables backup restore by default because the PostgreSQL database is temporary; set `PHASE3_COMPOSE_ALLOW_RESTORE=false` only when explicitly testing non-destructive mode.
