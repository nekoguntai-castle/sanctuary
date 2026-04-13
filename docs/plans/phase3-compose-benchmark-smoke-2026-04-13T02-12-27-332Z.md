# Phase 3 Compose Benchmark Smoke

Date: 2026-04-13T02:12:27.332Z
Status: Passed
Compose project: sanctuary-phase3-benchmark-2026-04-13t02-12-27-332z
API URL: https://127.0.0.1:18443
Gateway URL: http://127.0.0.1:14000
WebSocket URL: wss://127.0.0.1:18443/ws

## Results

- PASS compose stack started: project=sanctuary-phase3-benchmark-2026-04-13t02-12-27-332z apiPort=18443 gatewayPort=14000
- PASS database migration and seed: migrate exited with 0
- PASS compose container health: 6 service containers running and healthy
- PASS frontend health: status=200
- PASS gateway health: status=200
- PASS phase3 benchmark harness: npm run perf:phase3 completed in strict mode
- PASS benchmark evidence written: docs/plans/phase3-benchmark-2026-04-13T02-12-50-588Z.md and docs/plans/phase3-benchmark-2026-04-13T02-12-50-588Z.json
- PASS authenticated scenario proof: wallet list, large wallet transaction history, websocket subscription fanout, wallet sync queue, backup validate, backup restore passed
- PASS large-wallet transaction-history proof: 1000 synthetic transactions; 20 requests at concurrency 4; p95=30.05ms target<=2000ms
- PASS worker queue proof: 6 jobs completed across sync, confirmations, notifications, maintenance, autopilot, intelligence; p95=15.5ms
- PASS worker scale-out proof: 2 workers healthy; processors=fa871c32dbbd, 0650d03c4daa; electrumOwner=sanctuary-phase3-benchmark-2026-04-13t02-12-27-332z-worker-1; lockedSkips=1
- PASS backend scale-out websocket proof: sync event from sanctuary-phase3-benchmark-2026-04-13t02-12-27-332z-backend-2 reached WebSocket on sanctuary-phase3-benchmark-2026-04-13t02-12-27-332z-backend-1 via Redis in 13ms

## Benchmark Evidence

- Markdown: docs/plans/phase3-benchmark-2026-04-13T02-12-50-588Z.md
- JSON: docs/plans/phase3-benchmark-2026-04-13T02-12-50-588Z.json
- Dataset: local auto-provisioned benchmark fixture; not a large-wallet performance dataset

## Scenario Summary

| Scenario | Status | Requests | Successes | Errors | p95 ms | p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| frontend health | passed | 5 | 5 | 0 | 24.3 | 27.09 |
| api health | passed | 5 | 5 | 0 | 8.46 | 8.48 |
| gateway health | passed | 5 | 5 | 0 | 2.34 | 2.44 |
| websocket handshake | passed | 2 | 2 | 0 | 2.05 | 2.05 |
| wallet list | passed | 5 | 5 | 0 | 17.23 | 17.71 |
| websocket subscription fanout | passed | 2 | 2 | 0 | 10.8 | 10.81 |
| large wallet transaction history | passed | 5 | 5 | 0 | 12.92 | 12.97 |
| wallet sync queue | passed | 5 | 5 | 0 | 5.98 | 6 |
| backup validate | passed | 1 | 1 | 0 | 4.7 | 4.7 |
| backup restore | passed | 1 | 1 | 0 | 56.23 | 56.23 |

## Large Wallet Transaction-History Proof

Dataset: 1000 synthetic transactions
Wallet: Phase 3 Large Wallet 2026-04-13T02-12-27-332Z (a24fd5eb-b0b2-4d65-aad7-9ba738795d56)
Traffic: 20 requests at concurrency 4
Page size: 50
p95: 30.05 ms
p99: 30.81 ms
Gate: p95 <= 2000 ms

## Worker Queue Proof

Total duration: 108 ms
Job p95: 15.5 ms

| Category | Queue | Job | State | Duration ms |
| --- | --- | --- | --- | ---: |
| sync | sync | check-stale-wallets | completed | 14 |
| confirmations | confirmations | update-all-confirmations | completed | 3 |
| notifications | notifications | confirmation-notify | completed | 0 |
| maintenance | maintenance | cleanup:expired-tokens | completed | 3 |
| autopilot | maintenance | autopilot:evaluate | completed | 16 |
| intelligence | maintenance | intelligence:cleanup | completed | 7 |

Queue counts after proof:

- sync: waiting=0 active=0 delayed=1 failed=0 completed=1
- notifications: waiting=0 active=0 delayed=0 failed=0 completed=1
- confirmations: waiting=0 active=0 delayed=1 failed=0 completed=1
- maintenance: waiting=0 active=0 delayed=9 failed=0 completed=3

## Worker Scale-Out Proof

Worker replicas: 2
Diagnostic job processors: fa871c32dbbd, 0650d03c4daa
Electrum subscription owner: sanctuary-phase3-benchmark-2026-04-13t02-12-27-332z-worker-1
Locked diagnostic result: 1 executed, 1 skipped by lock

| Category | Job | State | Processor | Duration ms |
| --- | --- | --- | --- | ---: |
| worker-distribution | diagnostics:worker-ping | completed | fa871c32dbbd | 300 |
| worker-distribution | diagnostics:worker-ping | completed | 0650d03c4daa | 300 |
| worker-distribution | diagnostics:worker-ping | completed | 0650d03c4daa | 600 |
| worker-distribution | diagnostics:worker-ping | completed | fa871c32dbbd | 600 |
| worker-distribution | diagnostics:worker-ping | completed | fa871c32dbbd | 902 |
| worker-distribution | diagnostics:worker-ping | completed | 0650d03c4daa | 902 |
| worker-distribution | diagnostics:worker-ping | completed | fa871c32dbbd | 1206 |
| worker-distribution | diagnostics:worker-ping | completed | 0650d03c4daa | 1206 |

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
WebSocket target: sanctuary-phase3-benchmark-2026-04-13t02-12-27-332z-backend-1 (172.29.0.6)
Trigger target: sanctuary-phase3-benchmark-2026-04-13t02-12-27-332z-backend-2 (172.29.0.9)
Wallet: Phase 3 Scale-Out Wallet 2026-04-13T02-12-27-332Z (324a5d62-c0b9-4f7f-b53e-4fa15eda2cbb)
Trigger status: 200
Event: sync on wallet:324a5d62-c0b9-4f7f-b53e-4fa15eda2cbb in 13 ms

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
- The backend scale-out proof runs two backend replicas, opens a wallet subscription WebSocket on one replica, triggers wallet sync on the other replica, and requires the Redis bridge to deliver the sync event across instances.
- The local generated wallets and two-replica topology are smoke evidence only; production-like largest-known-wallet, load-level fanout, and capacity evidence remain required before claiming Phase 3 complete.
- The disposable wrapper enables backup restore by default because the PostgreSQL database is temporary; set `PHASE3_COMPOSE_ALLOW_RESTORE=false` only when explicitly testing non-destructive mode.
