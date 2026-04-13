# Phase 3 Compose Benchmark Smoke

Date: 2026-04-13T01:28:46.631Z
Status: Passed
Compose project: sanctuary-phase3-benchmark-2026-04-13t01-28-46-631z
API URL: https://127.0.0.1:18443
Gateway URL: http://127.0.0.1:14000
WebSocket URL: wss://127.0.0.1:18443/ws

## Results

- PASS compose stack started: project=sanctuary-phase3-benchmark-2026-04-13t01-28-46-631z apiPort=18443 gatewayPort=14000
- PASS database migration and seed: migrate exited with 0
- PASS compose container health: 6 service containers running and healthy
- PASS frontend health: status=200
- PASS gateway health: status=200
- PASS phase3 benchmark harness: npm run perf:phase3 completed in strict mode
- PASS benchmark evidence written: docs/plans/phase3-benchmark-2026-04-13T01-29-09-675Z.md and docs/plans/phase3-benchmark-2026-04-13T01-29-09-675Z.json
- PASS authenticated scenario proof: wallet list, large wallet transaction history, websocket subscription fanout, wallet sync queue, backup validate passed
- PASS worker queue proof: 6 jobs completed across sync, confirmations, notifications, maintenance, autopilot, intelligence; p95=15.5ms
- PASS worker scale-out proof: 2 workers healthy; processors=9c71a1bac3c8, 20725bb8a06e; electrumOwner=sanctuary-phase3-benchmark-2026-04-13t01-28-46-631z-worker-1; lockedSkips=1
- PASS backend scale-out websocket proof: sync event from sanctuary-phase3-benchmark-2026-04-13t01-28-46-631z-backend-2 reached WebSocket on sanctuary-phase3-benchmark-2026-04-13t01-28-46-631z-backend-1 via Redis in 18ms

## Benchmark Evidence

- Markdown: docs/plans/phase3-benchmark-2026-04-13T01-29-09-675Z.md
- JSON: docs/plans/phase3-benchmark-2026-04-13T01-29-09-675Z.json
- Dataset: local auto-provisioned benchmark fixture; not a large-wallet performance dataset

## Scenario Summary

| Scenario | Status | Requests | Successes | Errors | p95 ms | p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| frontend health | passed | 5 | 5 | 0 | 23.32 | 26.08 |
| api health | passed | 5 | 5 | 0 | 9.03 | 9.05 |
| gateway health | passed | 5 | 5 | 0 | 2.45 | 2.62 |
| websocket handshake | passed | 2 | 2 | 0 | 2.1 | 2.11 |
| wallet list | passed | 5 | 5 | 0 | 17.62 | 18.3 |
| websocket subscription fanout | passed | 2 | 2 | 0 | 11.64 | 11.64 |
| large wallet transaction history | passed | 5 | 5 | 0 | 15.8 | 15.87 |
| wallet sync queue | passed | 5 | 5 | 0 | 6.61 | 6.91 |
| backup validate | passed | 1 | 1 | 0 | 5.42 | 5.42 |

## Worker Queue Proof

Total duration: 99 ms
Job p95: 15.5 ms

| Category | Queue | Job | State | Duration ms |
| --- | --- | --- | --- | ---: |
| sync | sync | check-stale-wallets | completed | 8 |
| confirmations | confirmations | update-all-confirmations | completed | 3 |
| notifications | notifications | confirmation-notify | completed | 1 |
| maintenance | maintenance | cleanup:expired-tokens | completed | 3 |
| autopilot | maintenance | autopilot:evaluate | completed | 18 |
| intelligence | maintenance | intelligence:cleanup | completed | 6 |

Queue counts after proof:

- sync: waiting=0 active=0 delayed=1 failed=0 completed=1
- notifications: waiting=0 active=0 delayed=0 failed=0 completed=1
- confirmations: waiting=0 active=0 delayed=1 failed=0 completed=1
- maintenance: waiting=0 active=0 delayed=9 failed=0 completed=3

## Worker Scale-Out Proof

Worker replicas: 2
Diagnostic job processors: 9c71a1bac3c8, 20725bb8a06e
Electrum subscription owner: sanctuary-phase3-benchmark-2026-04-13t01-28-46-631z-worker-1
Locked diagnostic result: 1 executed, 1 skipped by lock

| Category | Job | State | Processor | Duration ms |
| --- | --- | --- | --- | ---: |
| worker-distribution | diagnostics:worker-ping | completed | 9c71a1bac3c8 | 301 |
| worker-distribution | diagnostics:worker-ping | completed | 20725bb8a06e | 301 |
| worker-distribution | diagnostics:worker-ping | completed | 20725bb8a06e | 601 |
| worker-distribution | diagnostics:worker-ping | completed | 9c71a1bac3c8 | 601 |
| worker-distribution | diagnostics:worker-ping | completed | 20725bb8a06e | 902 |
| worker-distribution | diagnostics:worker-ping | completed | 9c71a1bac3c8 | 902 |
| worker-distribution | diagnostics:worker-ping | completed | 9c71a1bac3c8 | 1205 |
| worker-distribution | diagnostics:worker-ping | completed | 20725bb8a06e | 1205 |

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
WebSocket target: sanctuary-phase3-benchmark-2026-04-13t01-28-46-631z-backend-1 (172.29.0.6)
Trigger target: sanctuary-phase3-benchmark-2026-04-13t01-28-46-631z-backend-2 (172.29.0.9)
Wallet: Phase 3 Scale-Out Wallet 2026-04-13T01-28-46-631Z (6e185406-e822-45bc-9a93-78a2a840bd83)
Trigger status: 200
Event: sync on wallet:6e185406-e822-45bc-9a93-78a2a840bd83 in 18 ms

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
- The worker queue proof enqueues and waits for BullMQ jobs across sync, confirmations, notifications, maintenance, autopilot, and intelligence handlers in the running worker container.
- The worker scale-out proof runs two worker replicas, verifies diagnostic BullMQ jobs complete on both replicas, proves a shared diagnostic lock skips one concurrent duplicate, checks recurring jobs have one repeatable definition, and requires exactly one worker to own Electrum subscriptions.
- The backend scale-out proof runs two backend replicas, opens a wallet subscription WebSocket on one replica, triggers wallet sync on the other replica, and requires the Redis bridge to deliver the sync event across instances.
- The local generated wallet and two-replica topology are smoke evidence only; representative large-wallet, load-level fanout, and capacity evidence remain required before claiming Phase 3 complete.
- Restore remains intentionally skipped because it is destructive unless `SANCTUARY_ALLOW_RESTORE=true` is set for a restore-safe environment.
