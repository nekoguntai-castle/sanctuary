# Phase 3 Compose Benchmark Smoke

Date: 2026-04-13T00:40:08.363Z
Status: Passed
Compose project: sanctuary-phase3-benchmark-2026-04-13t00-40-08-363z
API URL: https://127.0.0.1:18443
Gateway URL: http://127.0.0.1:14000
WebSocket URL: wss://127.0.0.1:18443/ws

## Results

- PASS compose stack started: project=sanctuary-phase3-benchmark-2026-04-13t00-40-08-363z apiPort=18443 gatewayPort=14000
- PASS database migration and seed: migrate exited with 0
- PASS compose container health: 6 service containers running and healthy
- PASS frontend health: status=200
- PASS gateway health: status=200
- PASS phase3 benchmark harness: npm run perf:phase3 completed in strict mode
- PASS benchmark evidence written: docs/plans/phase3-benchmark-2026-04-13T00-40-31-291Z.md and docs/plans/phase3-benchmark-2026-04-13T00-40-31-291Z.json
- PASS authenticated scenario proof: wallet list, large wallet transaction history, websocket subscription fanout, wallet sync queue, backup validate passed
- PASS worker queue proof: 6 jobs completed across sync, confirmations, notifications, maintenance, autopilot, intelligence; p95=17.75ms

## Benchmark Evidence

- Markdown: docs/plans/phase3-benchmark-2026-04-13T00-40-31-291Z.md
- JSON: docs/plans/phase3-benchmark-2026-04-13T00-40-31-291Z.json
- Dataset: local auto-provisioned benchmark fixture; not a large-wallet performance dataset

## Scenario Summary

| Scenario | Status | Requests | Successes | Errors | p95 ms | p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| frontend health | passed | 5 | 5 | 0 | 23.2 | 25.96 |
| api health | passed | 5 | 5 | 0 | 9.84 | 9.85 |
| gateway health | passed | 5 | 5 | 0 | 2.18 | 2.28 |
| websocket handshake | passed | 2 | 2 | 0 | 2.08 | 2.09 |
| wallet list | passed | 5 | 5 | 0 | 18.16 | 18.66 |
| websocket subscription fanout | passed | 2 | 2 | 0 | 9.95 | 9.96 |
| large wallet transaction history | passed | 5 | 5 | 0 | 12.22 | 12.25 |
| wallet sync queue | passed | 5 | 5 | 0 | 4.78 | 4.82 |
| backup validate | passed | 1 | 1 | 0 | 3.55 | 3.55 |

## Worker Queue Proof

Total duration: 98 ms
Job p95: 17.75 ms

| Category | Queue | Job | State | Duration ms |
| --- | --- | --- | --- | ---: |
| sync | sync | check-stale-wallets | completed | 17 |
| confirmations | confirmations | update-all-confirmations | completed | 3 |
| notifications | notifications | confirmation-notify | completed | 1 |
| maintenance | maintenance | cleanup:expired-tokens | completed | 4 |
| autopilot | maintenance | autopilot:evaluate | completed | 18 |
| intelligence | maintenance | intelligence:cleanup | completed | 12 |

Queue counts after proof:

- sync: waiting=0 active=0 delayed=1 failed=0 completed=1
- notifications: waiting=0 active=0 delayed=0 failed=0 completed=1
- confirmations: waiting=0 active=0 delayed=1 failed=0 completed=1
- maintenance: waiting=0 active=0 delayed=9 failed=0 completed=3

## Containers

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
- The local generated wallet is smoke evidence only; a representative large-wallet dataset and backend scale-out proof remain required before claiming Phase 3 complete.
- Restore remains intentionally skipped because it is destructive unless `SANCTUARY_ALLOW_RESTORE=true` is set for a restore-safe environment.
