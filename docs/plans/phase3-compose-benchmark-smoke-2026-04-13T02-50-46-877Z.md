# Phase 3 Compose Benchmark Smoke

Date: 2026-04-13T02:50:46.877Z
Status: Passed
Compose project: sanctuary-phase3-benchmark-2026-04-13t02-50-46-877z
API URL: https://127.0.0.1:18443
Gateway URL: http://127.0.0.1:14000
WebSocket URL: wss://127.0.0.1:18443/ws

## Results

- PASS compose stack started: project=sanctuary-phase3-benchmark-2026-04-13t02-50-46-877z apiPort=18443 gatewayPort=14000
- PASS database migration and seed: migrate exited with 0
- PASS compose container health: 6 service containers running and healthy
- PASS capacity baseline snapshot: postgres=10.01 MiB 4/100 connections, transactions=0; redis=2 MiB used, clients=25, keys=44
- PASS frontend health: status=200
- PASS gateway health: status=200
- PASS phase3 benchmark harness: npm run perf:phase3 completed in strict mode
- PASS benchmark evidence written: docs/plans/phase3-benchmark-2026-04-13T02-51-11-475Z.md and docs/plans/phase3-benchmark-2026-04-13T02-51-11-475Z.json
- PASS authenticated scenario proof: wallet list, large wallet transaction history, websocket subscription fanout, wallet sync queue, backup validate, backup restore passed
- PASS large-wallet transaction-history proof: 10000 synthetic transactions; 100 requests at concurrency 8; p95=37.8ms target<=2000ms
- PASS sized backup restore proof: 6.53 MiB backup with 10076 records (10000 transactions) restored in 3543ms
- PASS worker queue proof: 60 jobs (10x profile) completed across sync, confirmations, notifications, maintenance, autopilot, intelligence; p95=16.4ms
- PASS worker scale-out proof: 2 workers healthy; processors=ecb31cc51b7e, a6a10fd854e9; electrumOwner=sanctuary-phase3-benchmark-2026-04-13t02-50-46-877z-worker-1; lockedSkips=1
- PASS backend scale-out websocket proof: sync event from sanctuary-phase3-benchmark-2026-04-13t02-50-46-877z-backend-2 reached 64/64 WebSockets across 2 backend replicas via Redis; p95=17ms
- PASS capacity load snapshot: postgres=24.66 MiB 13/100 connections, transactions=10000; redis=2.95 MiB used, clients=49, keys=158

## Benchmark Evidence

- Markdown: docs/plans/phase3-benchmark-2026-04-13T02-51-11-475Z.md
- JSON: docs/plans/phase3-benchmark-2026-04-13T02-51-11-475Z.json
- Dataset: local auto-provisioned benchmark fixture; not a large-wallet performance dataset

## Capacity Snapshots

| Label | Postgres size | Connections | Transactions | Redis memory | Redis clients | Redis keys |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline-after-health | 10.01 MiB | 4/100 | 0 | 2 MiB | 25 | 44 |
| after-local-load-profile | 24.66 MiB | 13/100 | 10000 | 2.95 MiB | 49 | 158 |

## Scenario Summary

| Scenario | Status | Requests | Successes | Errors | p95 ms | p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| frontend health | passed | 5 | 5 | 0 | 24.26 | 27.5 |
| api health | passed | 5 | 5 | 0 | 9.08 | 9.2 |
| gateway health | passed | 5 | 5 | 0 | 2.36 | 2.5 |
| websocket handshake | passed | 2 | 2 | 0 | 2.67 | 2.67 |
| wallet list | passed | 5 | 5 | 0 | 16.93 | 17.44 |
| websocket subscription fanout | passed | 2 | 2 | 0 | 10.22 | 10.23 |
| large wallet transaction history | passed | 5 | 5 | 0 | 12.69 | 12.82 |
| wallet sync queue | passed | 5 | 5 | 0 | 4.48 | 4.57 |
| backup validate | passed | 1 | 1 | 0 | 5.05 | 5.05 |
| backup restore | passed | 1 | 1 | 0 | 51.24 | 51.24 |

## Large Wallet Transaction-History Proof

Dataset: 10000 synthetic transactions
Wallet: Phase 3 Large Wallet 2026-04-13T02-50-46-877Z (72d4540b-1cbc-42c3-8325-d795bc426f0e)
Traffic: 100 requests at concurrency 8
Page size: 50
p95: 37.8 ms
p99: 56 ms
Gate: p95 <= 2000 ms

## Sized Backup Restore Proof

Backup size: 6.53 MiB
Backup records: 10076
Transaction records: 10000
Backup create duration: 204 ms
Validation duration: 41 ms
Restore duration: 3543 ms
Restore result: success; tables=9; records=10076

## Worker Queue Proof

Total duration: 282 ms
Repeat profile: 10x
Job p95: 16.4 ms

| Repeat | Category | Queue | Job | State | Duration ms |
| ---: | --- | --- | --- | --- | ---: |
| 0 | sync | sync | check-stale-wallets | completed | 24 |
| 0 | confirmations | confirmations | update-all-confirmations | completed | 6 |
| 0 | notifications | notifications | confirmation-notify | completed | 1 |
| 0 | maintenance | maintenance | cleanup:expired-tokens | completed | 3 |
| 0 | autopilot | maintenance | autopilot:evaluate | completed | 16 |
| 0 | intelligence | maintenance | intelligence:cleanup | completed | 7 |
| 1 | sync | sync | check-stale-wallets | completed | 4 |
| 1 | confirmations | confirmations | update-all-confirmations | completed | 4 |
| 1 | notifications | notifications | confirmation-notify | completed | 1 |
| 1 | maintenance | maintenance | cleanup:expired-tokens | completed | 3 |
| 1 | autopilot | maintenance | autopilot:evaluate | completed | 3 |
| 1 | intelligence | maintenance | intelligence:cleanup | completed | 3 |
| 2 | sync | sync | check-stale-wallets | completed | 2 |
| 2 | confirmations | confirmations | update-all-confirmations | completed | 2 |
| 2 | notifications | notifications | confirmation-notify | completed | 0 |
| 2 | maintenance | maintenance | cleanup:expired-tokens | completed | 1 |
| 2 | autopilot | maintenance | autopilot:evaluate | completed | 32 |
| 2 | intelligence | maintenance | intelligence:cleanup | completed | 2 |
| 3 | sync | sync | check-stale-wallets | completed | 2 |
| 3 | confirmations | confirmations | update-all-confirmations | completed | 2 |
| 3 | notifications | notifications | confirmation-notify | completed | 2 |
| 3 | maintenance | maintenance | cleanup:expired-tokens | completed | 1 |
| 3 | autopilot | maintenance | autopilot:evaluate | completed | 2 |
| 3 | intelligence | maintenance | intelligence:cleanup | completed | 2 |
| 4 | sync | sync | check-stale-wallets | completed | 1 |
| 4 | confirmations | confirmations | update-all-confirmations | completed | 2 |
| 4 | notifications | notifications | confirmation-notify | completed | 1 |
| 4 | maintenance | maintenance | cleanup:expired-tokens | completed | 2 |
| 4 | autopilot | maintenance | autopilot:evaluate | completed | 2 |
| 4 | intelligence | maintenance | intelligence:cleanup | completed | 1 |
| 5 | sync | sync | check-stale-wallets | completed | 0 |
| 5 | confirmations | confirmations | update-all-confirmations | completed | 2 |
| 5 | notifications | notifications | confirmation-notify | completed | 1 |
| 5 | maintenance | maintenance | cleanup:expired-tokens | completed | 1 |
| 5 | autopilot | maintenance | autopilot:evaluate | completed | 2 |
| 5 | intelligence | maintenance | intelligence:cleanup | completed | 2 |
| 6 | sync | sync | check-stale-wallets | completed | 1 |
| 6 | confirmations | confirmations | update-all-confirmations | completed | 2 |
| 6 | notifications | notifications | confirmation-notify | completed | 1 |
| 6 | maintenance | maintenance | cleanup:expired-tokens | completed | 1 |
| 6 | autopilot | maintenance | autopilot:evaluate | completed | 2 |
| 6 | intelligence | maintenance | intelligence:cleanup | completed | 2 |
| 7 | sync | sync | check-stale-wallets | completed | 1 |
| 7 | confirmations | confirmations | update-all-confirmations | completed | 2 |
| 7 | notifications | notifications | confirmation-notify | completed | 0 |
| 7 | maintenance | maintenance | cleanup:expired-tokens | completed | 1 |
| 7 | autopilot | maintenance | autopilot:evaluate | completed | 46 |
| 7 | intelligence | maintenance | intelligence:cleanup | completed | 2 |
| 8 | sync | sync | check-stale-wallets | completed | 1 |
| 8 | confirmations | confirmations | update-all-confirmations | completed | 2 |
| 8 | notifications | notifications | confirmation-notify | completed | 1 |
| 8 | maintenance | maintenance | cleanup:expired-tokens | completed | 1 |
| 8 | autopilot | maintenance | autopilot:evaluate | completed | 2 |
| 8 | intelligence | maintenance | intelligence:cleanup | completed | 2 |
| 9 | sync | sync | check-stale-wallets | completed | 1 |
| 9 | confirmations | confirmations | update-all-confirmations | completed | 2 |
| 9 | notifications | notifications | confirmation-notify | completed | 1 |
| 9 | maintenance | maintenance | cleanup:expired-tokens | completed | 1 |
| 9 | autopilot | maintenance | autopilot:evaluate | completed | 1 |
| 9 | intelligence | maintenance | intelligence:cleanup | completed | 2 |

Queue counts after proof:

- sync: waiting=0 active=0 delayed=1 failed=0 completed=10
- notifications: waiting=0 active=0 delayed=0 failed=0 completed=10
- confirmations: waiting=0 active=0 delayed=1 failed=0 completed=10
- maintenance: waiting=0 active=0 delayed=9 failed=0 completed=30

## Worker Scale-Out Proof

Worker replicas: 2
Diagnostic job processors: ecb31cc51b7e, a6a10fd854e9
Electrum subscription owner: sanctuary-phase3-benchmark-2026-04-13t02-50-46-877z-worker-1
Locked diagnostic result: 1 executed, 1 skipped by lock

| Category | Job | State | Processor | Duration ms |
| --- | --- | --- | --- | ---: |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 280 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 280 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 580 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 581 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 882 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 882 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 1186 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 1186 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 1487 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 1486 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 1787 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 1787 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 2089 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 2089 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 2389 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 2389 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 2691 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 2691 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 2992 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 2992 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 3296 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 3296 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 3597 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 3596 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 3898 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 3898 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 4202 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 4202 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 4503 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 4503 |
| worker-distribution | diagnostics:worker-ping | completed | ecb31cc51b7e | 4804 |
| worker-distribution | diagnostics:worker-ping | completed | a6a10fd854e9 | 4804 |

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
WebSocket clients: 64/64 received the event across 2 backend replicas
Trigger target: sanctuary-phase3-benchmark-2026-04-13t02-50-46-877z-backend-2 (172.29.0.9)
Wallet: Phase 3 Scale-Out Wallet 2026-04-13T02-50-46-877Z (6fe26f76-f046-44ab-85ce-cf712e387da7)
Trigger status: 200
Fanout p95: 17 ms

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
- Capacity snapshots capture PostgreSQL row counts, database size, connection use, selected memory settings, Redis memory, client count, and keyspace counts for the tested local topology.
- The large-wallet transaction-history proof seeds synthetic transaction rows into the disposable PostgreSQL database and measures the authenticated wallet transaction-history endpoint against a strict local p95 gate.
- The sized backup restore proof creates, validates, and restores a generated backup after the synthetic transaction data is present in the disposable PostgreSQL database.
- The worker queue proof enqueues and waits for BullMQ jobs across sync, confirmations, notifications, maintenance, autopilot, and intelligence handlers in the running worker container.
- The worker scale-out proof runs two worker replicas, verifies diagnostic BullMQ jobs complete on both replicas, proves a shared diagnostic lock skips one concurrent duplicate, checks recurring jobs have one repeatable definition, and requires exactly one worker to own Electrum subscriptions.
- The backend scale-out proof runs two backend replicas, opens multiple wallet subscription WebSockets across the replicas, triggers wallet sync on one replica, and requires the Redis bridge to deliver the sync event to every client.
- The local generated wallets and two-replica topology are smoke evidence only; production-like largest-known-wallet, load-level fanout, and capacity evidence remain required before claiming Phase 3 complete.
- The disposable wrapper enables backup restore by default because the PostgreSQL database is temporary; set `PHASE3_COMPOSE_ALLOW_RESTORE=false` only when explicitly testing non-destructive mode.
