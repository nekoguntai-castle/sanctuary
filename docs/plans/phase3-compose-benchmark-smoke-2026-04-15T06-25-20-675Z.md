# Phase 3 Compose Benchmark Smoke

Date: 2026-04-15T06:25:20.675Z
Status: Passed
Compose project: sanctuary-phase3-benchmark-2026-04-15t06-25-20-675z
API URL: https://127.0.0.1:28443
Gateway URL: http://127.0.0.1:24000
WebSocket URL: wss://127.0.0.1:28443/ws

## Results

- PASS compose ssl certificates: SANCTUARY_SSL_DIR=/tmp/sanctuary-phase3-benchmark-2026-04-15t06-25-20-675z-ssl-mh7tWr
- PASS compose stack started: project=sanctuary-phase3-benchmark-2026-04-15t06-25-20-675z apiPort=28443 gatewayPort=24000
- PASS database migration and seed: migrate exited with 0
- PASS compose container health: 6 service containers running and healthy
- PASS capacity baseline snapshot: postgres=10.01 MiB 4/100 connections, transactions=0; redis=1.98 MiB used, clients=25, keys=44
- PASS frontend health: status=200
- PASS gateway health: status=200
- PASS phase3 benchmark harness: npm run perf:phase3 completed in strict mode
- PASS benchmark evidence written: docs/plans/phase3-benchmark-2026-04-15T06-25-45-349Z.md and docs/plans/phase3-benchmark-2026-04-15T06-25-45-349Z.json
- PASS authenticated scenario proof: wallet list, large wallet transaction history, websocket subscription fanout, wallet sync queue, backup validate, backup restore passed
- PASS large-wallet transaction-history proof: 25000 synthetic transactions; 100 requests at concurrency 10; p95=70ms target<=2000ms
- PASS sized backup restore proof: 16.3 MiB backup with 25076 records (25000 transactions) restored in 10515ms
- PASS worker queue proof: 6 jobs completed across sync, confirmations, notifications, maintenance, autopilot, intelligence; p95=14.25ms
- PASS worker scale-out proof: 2 workers healthy; processors=c56fc10e846e, 145417f5be27; electrumOwner=sanctuary-phase3-benchmark-2026-04-15t06-25-20-675z-worker-1; lockedSkips=1
- PASS backend scale-out websocket proof: sync event from sanctuary-phase3-benchmark-2026-04-15t06-25-20-675z-backend-2 reached 100/100 WebSockets across 2 backend replicas via Redis; p95=20ms
- PASS capacity load snapshot: postgres=46.26 MiB 23/100 connections, transactions=25000; redis=2.88 MiB used, clients=49, keys=76

## Benchmark Evidence

- Markdown: docs/plans/phase3-benchmark-2026-04-15T06-25-45-349Z.md
- JSON: docs/plans/phase3-benchmark-2026-04-15T06-25-45-349Z.json
- Dataset: local auto-provisioned benchmark fixture; not a large-wallet performance dataset

## Capacity Snapshots

| Label | Postgres size | Connections | Transactions | Redis memory | Redis clients | Redis keys |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline-after-health | 10.01 MiB | 4/100 | 0 | 1.98 MiB | 25 | 44 |
| after-local-load-profile | 46.26 MiB | 23/100 | 25000 | 2.88 MiB | 49 | 76 |

## Scenario Summary

| Scenario | Status | Requests | Successes | Errors | p95 ms | p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| frontend health | passed | 5 | 5 | 0 | 22.41 | 25.07 |
| api health | passed | 5 | 5 | 0 | 10.2 | 10.22 |
| gateway health | passed | 5 | 5 | 0 | 2.51 | 2.68 |
| websocket handshake | passed | 2 | 2 | 0 | 2.02 | 2.02 |
| wallet list | passed | 5 | 5 | 0 | 18.25 | 18.92 |
| websocket subscription fanout | passed | 2 | 2 | 0 | 9.94 | 9.94 |
| large wallet transaction history | passed | 5 | 5 | 0 | 17.38 | 17.79 |
| wallet sync queue | passed | 5 | 5 | 0 | 4.75 | 4.78 |
| backup validate | passed | 1 | 1 | 0 | 4.64 | 4.64 |
| backup restore | passed | 1 | 1 | 0 | 48.97 | 48.97 |

## Large Wallet Transaction-History Proof

Dataset: 25000 synthetic transactions
Wallet: Phase 3 Large Wallet 2026-04-15T06-25-20-675Z (47a75c94-38a7-4dad-a28f-96c7e76c80ac)
Traffic: 100 requests at concurrency 10
Page size: 50
p95: 70 ms
p99: 77.17 ms
Gate: p95 <= 2000 ms

## Sized Backup Restore Proof

Backup size: 16.3 MiB
Backup records: 25076
Transaction records: 25000
Backup create duration: 421 ms
Validation duration: 99 ms
Restore duration: 10515 ms
Restore result: success; tables=9; records=25076

## Worker Queue Proof

Total duration: 81 ms
Repeat profile: 1x
Job p95: 14.25 ms

| Repeat | Category | Queue | Job | State | Duration ms |
| ---: | --- | --- | --- | --- | ---: |
| 0 | sync | sync | check-stale-wallets | completed | 5 |
| 0 | confirmations | confirmations | update-all-confirmations | completed | 6 |
| 0 | notifications | notifications | confirmation-notify | completed | 1 |
| 0 | maintenance | maintenance | cleanup:expired-tokens | completed | 3 |
| 0 | autopilot | maintenance | autopilot:evaluate | completed | 17 |
| 0 | intelligence | maintenance | intelligence:cleanup | completed | 6 |

Queue counts after proof:

- sync: waiting=0 active=0 delayed=1 failed=0 completed=1
- notifications: waiting=0 active=0 delayed=0 failed=0 completed=1
- confirmations: waiting=0 active=0 delayed=1 failed=0 completed=2
- maintenance: waiting=0 active=0 delayed=9 failed=0 completed=3

## Worker Scale-Out Proof

Worker replicas: 2
Diagnostic job processors: c56fc10e846e, 145417f5be27
Electrum subscription owner: sanctuary-phase3-benchmark-2026-04-15t06-25-20-675z-worker-1
Locked diagnostic result: 1 executed, 1 skipped by lock

| Category | Job | State | Processor | Duration ms |
| --- | --- | --- | --- | ---: |
| worker-distribution | diagnostics:worker-ping | completed | c56fc10e846e | 287 |
| worker-distribution | diagnostics:worker-ping | completed | 145417f5be27 | 287 |
| worker-distribution | diagnostics:worker-ping | completed | c56fc10e846e | 588 |
| worker-distribution | diagnostics:worker-ping | completed | 145417f5be27 | 588 |
| worker-distribution | diagnostics:worker-ping | completed | 145417f5be27 | 889 |
| worker-distribution | diagnostics:worker-ping | completed | c56fc10e846e | 889 |
| worker-distribution | diagnostics:worker-ping | completed | 145417f5be27 | 1193 |
| worker-distribution | diagnostics:worker-ping | completed | c56fc10e846e | 1193 |

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
Trigger target: sanctuary-phase3-benchmark-2026-04-15t06-25-20-675z-backend-2 (172.26.0.9)
Wallet: Phase 3 Scale-Out Wallet 2026-04-15T06-25-20-675Z (27667272-4ad0-419f-a91c-dfce451cfbd5)
Trigger status: 200
Fanout p95: 20 ms

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
