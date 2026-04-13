# Phase 3 Compose Benchmark Smoke

Date: 2026-04-13T00:54:44.886Z
Status: Passed
Compose project: sanctuary-phase3-benchmark-2026-04-13t00-54-44-886z
API URL: https://127.0.0.1:18443
Gateway URL: http://127.0.0.1:14000
WebSocket URL: wss://127.0.0.1:18443/ws

## Results

- PASS compose stack started: project=sanctuary-phase3-benchmark-2026-04-13t00-54-44-886z apiPort=18443 gatewayPort=14000
- PASS database migration and seed: migrate exited with 0
- PASS compose container health: 6 service containers running and healthy
- PASS frontend health: status=200
- PASS gateway health: status=200
- PASS phase3 benchmark harness: npm run perf:phase3 completed in strict mode
- PASS benchmark evidence written: docs/plans/phase3-benchmark-2026-04-13T00-55-56-530Z.md and docs/plans/phase3-benchmark-2026-04-13T00-55-56-530Z.json
- PASS authenticated scenario proof: wallet list, large wallet transaction history, websocket subscription fanout, wallet sync queue, backup validate passed
- PASS worker queue proof: 6 jobs completed across sync, confirmations, notifications, maintenance, autopilot, intelligence; p95=17.75ms
- PASS backend scale-out websocket proof: sync event from sanctuary-phase3-benchmark-2026-04-13t00-54-44-886z-backend-2 reached WebSocket on sanctuary-phase3-benchmark-2026-04-13t00-54-44-886z-backend-1 via Redis in 12ms

## Benchmark Evidence

- Markdown: docs/plans/phase3-benchmark-2026-04-13T00-55-56-530Z.md
- JSON: docs/plans/phase3-benchmark-2026-04-13T00-55-56-530Z.json
- Dataset: local auto-provisioned benchmark fixture; not a large-wallet performance dataset

## Scenario Summary

| Scenario | Status | Requests | Successes | Errors | p95 ms | p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| frontend health | passed | 5 | 5 | 0 | 23.5 | 26.31 |
| api health | passed | 5 | 5 | 0 | 12.8 | 12.9 |
| gateway health | passed | 5 | 5 | 0 | 2.66 | 2.83 |
| websocket handshake | passed | 2 | 2 | 0 | 2.05 | 2.05 |
| wallet list | passed | 5 | 5 | 0 | 18.12 | 18.63 |
| websocket subscription fanout | passed | 2 | 2 | 0 | 9.7 | 9.7 |
| large wallet transaction history | passed | 5 | 5 | 0 | 11.89 | 12.07 |
| wallet sync queue | passed | 5 | 5 | 0 | 4.45 | 4.48 |
| backup validate | passed | 1 | 1 | 0 | 4.16 | 4.16 |

## Worker Queue Proof

Total duration: 105 ms
Job p95: 17.75 ms

| Category | Queue | Job | State | Duration ms |
| --- | --- | --- | --- | ---: |
| sync | sync | check-stale-wallets | completed | 18 |
| confirmations | confirmations | update-all-confirmations | completed | 13 |
| notifications | notifications | confirmation-notify | completed | 0 |
| maintenance | maintenance | cleanup:expired-tokens | completed | 4 |
| autopilot | maintenance | autopilot:evaluate | completed | 17 |
| intelligence | maintenance | intelligence:cleanup | completed | 8 |

Queue counts after proof:

- sync: waiting=0 active=0 delayed=1 failed=0 completed=1
- notifications: waiting=0 active=0 delayed=0 failed=0 completed=1
- confirmations: waiting=0 active=0 delayed=1 failed=0 completed=1
- maintenance: waiting=0 active=0 delayed=9 failed=0 completed=3

## Backend Scale-Out Proof

Backend replicas: 2
WebSocket target: sanctuary-phase3-benchmark-2026-04-13t00-54-44-886z-backend-1 (172.29.0.5)
Trigger target: sanctuary-phase3-benchmark-2026-04-13t00-54-44-886z-backend-2 (172.29.0.6)
Wallet: Phase 3 Scale-Out Wallet 2026-04-13T00-54-44-886Z (b1f733a8-b9cf-4470-b706-d9183ed2cf7f)
Trigger status: 200
Event: sync on wallet:b1f733a8-b9cf-4470-b706-d9183ed2cf7f in 12 ms

## Containers

- backend: state=running health=healthy
- backend: state=running health=healthy
- frontend: state=running health=healthy
- gateway: state=running health=healthy
- postgres: state=running health=healthy
- redis: state=running health=healthy
- worker: state=running health=healthy

## Notes

- This proof starts a disposable full-stack Docker Compose project with frontend, backend, gateway, worker, Redis, and PostgreSQL services.
- The smoke waits for database migration and seed completion, then runs the existing Phase 3 benchmark harness with local fixture provisioning.
- The run proves authenticated wallet list, transaction-history, WebSocket subscription fanout, wallet-sync queue, and admin backup-validation paths execute end to end on a local seeded stack.
- The worker queue proof enqueues and waits for BullMQ jobs across sync, confirmations, notifications, maintenance, autopilot, and intelligence handlers in the running worker container.
- The backend scale-out proof runs two backend replicas, opens a wallet subscription WebSocket on one replica, triggers wallet sync on the other replica, and requires the Redis bridge to deliver the sync event across instances.
- The local generated wallet and two-replica topology are smoke evidence only; representative large-wallet, load-level fanout, and capacity evidence remain required before claiming Phase 3 complete.
- Restore remains intentionally skipped because it is destructive unless `SANCTUARY_ALLOW_RESTORE=true` is set for a restore-safe environment.
