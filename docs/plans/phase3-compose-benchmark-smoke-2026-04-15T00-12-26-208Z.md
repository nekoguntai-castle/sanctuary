# Phase 3 Compose Benchmark Smoke

Date: 2026-04-15T00:12:26.208Z
Status: Passed
Compose project: sanctuary-phase3-benchmark-2026-04-15t00-12-26-208z
API URL: https://127.0.0.1:18443
Gateway URL: http://127.0.0.1:14000
WebSocket URL: wss://127.0.0.1:18443/ws

## Results

- PASS compose stack started: project=sanctuary-phase3-benchmark-2026-04-15t00-12-26-208z apiPort=18443 gatewayPort=14000
- PASS database migration and seed: migrate exited with 0
- PASS compose container health: 6 service containers running and healthy
- PASS capacity baseline snapshot: postgres=10.01 MiB 4/100 connections, transactions=0; redis=2 MiB used, clients=25, keys=44
- PASS frontend health: status=200
- PASS gateway health: status=200
- PASS phase3 benchmark harness: npm run perf:phase3 completed in strict mode
- PASS benchmark evidence written: docs/plans/phase3-benchmark-2026-04-15T00-12-49-889Z.md and docs/plans/phase3-benchmark-2026-04-15T00-12-49-889Z.json
- PASS authenticated scenario proof: wallet list, large wallet transaction history, websocket subscription fanout, wallet sync queue, backup validate, backup restore passed
- PASS large-wallet transaction-history proof: 25000 synthetic transactions; 100 requests at concurrency 10; p95=70ms target<=2000ms
- PASS sized backup restore proof: 16.3 MiB backup with 25076 records (25000 transactions) restored in 12533ms
- PASS worker queue proof: 30 jobs (5x profile) completed across sync, confirmations, notifications, maintenance, autopilot, intelligence; p95=16.2ms
- PASS worker scale-out proof: 2 workers healthy; processors=7f3cc1aa8a95, 5a984dc76c10; electrumOwner=sanctuary-phase3-benchmark-2026-04-15t00-12-26-208z-worker-1; lockedSkips=1
- PASS backend scale-out websocket proof: sync event from sanctuary-phase3-benchmark-2026-04-15t00-12-26-208z-backend-2 reached 100/100 WebSockets across 2 backend replicas via Redis; p95=23ms
- PASS capacity load snapshot: postgres=46.14 MiB 13/100 connections, transactions=25000; redis=2.98 MiB used, clients=49, keys=94

## Benchmark Evidence

- Markdown: docs/plans/phase3-benchmark-2026-04-15T00-12-49-889Z.md
- JSON: docs/plans/phase3-benchmark-2026-04-15T00-12-49-889Z.json
- Dataset: local auto-provisioned benchmark fixture; not a large-wallet performance dataset

## Capacity Snapshots

| Label | Postgres size | Connections | Transactions | Redis memory | Redis clients | Redis keys |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline-after-health | 10.01 MiB | 4/100 | 0 | 2 MiB | 25 | 44 |
| after-local-load-profile | 46.14 MiB | 13/100 | 25000 | 2.98 MiB | 49 | 94 |

## Scenario Summary

| Scenario | Status | Requests | Successes | Errors | p95 ms | p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| frontend health | passed | 5 | 5 | 0 | 22.46 | 25.06 |
| api health | passed | 5 | 5 | 0 | 9.09 | 9.11 |
| gateway health | passed | 5 | 5 | 0 | 2.35 | 2.49 |
| websocket handshake | passed | 2 | 2 | 0 | 2.25 | 2.25 |
| wallet list | passed | 5 | 5 | 0 | 17.6 | 18.12 |
| websocket subscription fanout | passed | 2 | 2 | 0 | 11.3 | 11.31 |
| large wallet transaction history | passed | 5 | 5 | 0 | 12.66 | 12.78 |
| wallet sync queue | passed | 5 | 5 | 0 | 4.73 | 4.78 |
| backup validate | passed | 1 | 1 | 0 | 3.98 | 3.98 |
| backup restore | passed | 1 | 1 | 0 | 44.69 | 44.69 |

## Large Wallet Transaction-History Proof

Dataset: 25000 synthetic transactions
Wallet: Phase 3 Large Wallet 2026-04-15T00-12-26-208Z (33fe6aae-3a40-4619-9c45-5f16f992111c)
Traffic: 100 requests at concurrency 10
Page size: 50
p95: 70 ms
p99: 77.02 ms
Gate: p95 <= 2000 ms

## Sized Backup Restore Proof

Backup size: 16.3 MiB
Backup records: 25076
Transaction records: 25000
Backup create duration: 464 ms
Validation duration: 102 ms
Restore duration: 12533 ms
Restore result: success; tables=9; records=25076

## Worker Queue Proof

Total duration: 201 ms
Repeat profile: 5x
Job p95: 16.2 ms

| Repeat | Category | Queue | Job | State | Duration ms |
| ---: | --- | --- | --- | --- | ---: |
| 0 | sync | sync | check-stale-wallets | completed | 14 |
| 0 | confirmations | confirmations | update-all-confirmations | completed | 9 |
| 0 | notifications | notifications | confirmation-notify | completed | 1 |
| 0 | maintenance | maintenance | cleanup:expired-tokens | completed | 4 |
| 0 | autopilot | maintenance | autopilot:evaluate | completed | 18 |
| 0 | intelligence | maintenance | intelligence:cleanup | completed | 7 |
| 1 | sync | sync | check-stale-wallets | completed | 2 |
| 1 | confirmations | confirmations | update-all-confirmations | completed | 6 |
| 1 | notifications | notifications | confirmation-notify | completed | 1 |
| 1 | maintenance | maintenance | cleanup:expired-tokens | completed | 2 |
| 1 | autopilot | maintenance | autopilot:evaluate | completed | 3 |
| 1 | intelligence | maintenance | intelligence:cleanup | completed | 3 |
| 2 | sync | sync | check-stale-wallets | completed | 1 |
| 2 | confirmations | confirmations | update-all-confirmations | completed | 4 |
| 2 | notifications | notifications | confirmation-notify | completed | 1 |
| 2 | maintenance | maintenance | cleanup:expired-tokens | completed | 2 |
| 2 | autopilot | maintenance | autopilot:evaluate | completed | 2 |
| 2 | intelligence | maintenance | intelligence:cleanup | completed | 2 |
| 3 | sync | sync | check-stale-wallets | completed | 1 |
| 3 | confirmations | confirmations | update-all-confirmations | completed | 4 |
| 3 | notifications | notifications | confirmation-notify | completed | 1 |
| 3 | maintenance | maintenance | cleanup:expired-tokens | completed | 2 |
| 3 | autopilot | maintenance | autopilot:evaluate | completed | 3 |
| 3 | intelligence | maintenance | intelligence:cleanup | completed | 50 |
| 4 | sync | sync | check-stale-wallets | completed | 1 |
| 4 | confirmations | confirmations | update-all-confirmations | completed | 4 |
| 4 | notifications | notifications | confirmation-notify | completed | 1 |
| 4 | maintenance | maintenance | cleanup:expired-tokens | completed | 1 |
| 4 | autopilot | maintenance | autopilot:evaluate | completed | 1 |
| 4 | intelligence | maintenance | intelligence:cleanup | completed | 2 |

Queue counts after proof:

- sync: waiting=0 active=0 delayed=1 failed=0 completed=5
- notifications: waiting=0 active=0 delayed=0 failed=0 completed=5
- confirmations: waiting=0 active=0 delayed=1 failed=0 completed=5
- maintenance: waiting=0 active=0 delayed=9 failed=0 completed=15

## Worker Scale-Out Proof

Worker replicas: 2
Diagnostic job processors: 7f3cc1aa8a95, 5a984dc76c10
Electrum subscription owner: sanctuary-phase3-benchmark-2026-04-15t00-12-26-208z-worker-1
Locked diagnostic result: 1 executed, 1 skipped by lock

| Category | Job | State | Processor | Duration ms |
| --- | --- | --- | --- | ---: |
| worker-distribution | diagnostics:worker-ping | completed | 7f3cc1aa8a95 | 301 |
| worker-distribution | diagnostics:worker-ping | completed | 5a984dc76c10 | 301 |
| worker-distribution | diagnostics:worker-ping | completed | 7f3cc1aa8a95 | 601 |
| worker-distribution | diagnostics:worker-ping | completed | 5a984dc76c10 | 601 |
| worker-distribution | diagnostics:worker-ping | completed | 7f3cc1aa8a95 | 902 |
| worker-distribution | diagnostics:worker-ping | completed | 5a984dc76c10 | 902 |
| worker-distribution | diagnostics:worker-ping | completed | 5a984dc76c10 | 1207 |
| worker-distribution | diagnostics:worker-ping | completed | 7f3cc1aa8a95 | 1207 |

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
WebSocket clients: 100/100 received the event across 2 backend replicas
Trigger target: sanctuary-phase3-benchmark-2026-04-15t00-12-26-208z-backend-2 (172.30.0.9)
Wallet: Phase 3 Scale-Out Wallet 2026-04-15T00-12-26-208Z (922ddd78-3261-4182-9084-9930b29fed90)
Trigger status: 200
Fanout p95: 23 ms

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
- The local generated wallets and two-replica topology are repository-controlled proof; A-grade scale claims still require privacy-safe calibrated datasets and topologies, such as synthetic/regtest fixtures or operator-owned testnet wallets, without third-party wallet profiling.
- The disposable wrapper enables backup restore by default because the PostgreSQL database is temporary; set `PHASE3_COMPOSE_ALLOW_RESTORE=false` only when explicitly testing non-destructive mode.
