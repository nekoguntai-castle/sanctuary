# Phase 3 Compose Benchmark Smoke

Date: 2026-04-13T00:04:57.821Z
Status: Passed
Compose project: sanctuary-phase3-benchmark-2026-04-13t00-04-57-821z
API URL: https://127.0.0.1:18443
Gateway URL: http://127.0.0.1:14000
WebSocket URL: wss://127.0.0.1:18443/ws

## Results

- PASS compose stack started: project=sanctuary-phase3-benchmark-2026-04-13t00-04-57-821z apiPort=18443 gatewayPort=14000
- PASS database migration and seed: migrate exited with 0
- PASS compose container health: 6 service containers running and healthy
- PASS frontend health: status=200
- PASS gateway health: status=200
- PASS phase3 benchmark harness: npm run perf:phase3 completed in strict mode
- PASS benchmark evidence written: docs/plans/phase3-benchmark-2026-04-13T00-06-30-381Z.md and docs/plans/phase3-benchmark-2026-04-13T00-06-30-381Z.json
- PASS authenticated scenario proof: wallet list, large wallet transaction history, wallet sync queue, backup validate passed

## Benchmark Evidence

- Markdown: docs/plans/phase3-benchmark-2026-04-13T00-06-30-381Z.md
- JSON: docs/plans/phase3-benchmark-2026-04-13T00-06-30-381Z.json
- Dataset: local auto-provisioned benchmark fixture; not a large-wallet performance dataset

## Scenario Summary

| Scenario | Status | Requests | Successes | Errors | p95 ms | p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| frontend health | passed | 5 | 5 | 0 | 23.57 | 26.75 |
| api health | passed | 5 | 5 | 0 | 8.62 | 8.64 |
| gateway health | passed | 5 | 5 | 0 | 2.15 | 2.15 |
| websocket handshake | passed | 2 | 2 | 0 | 2.24 | 2.25 |
| wallet list | passed | 5 | 5 | 0 | 21.04 | 21.49 |
| large wallet transaction history | passed | 5 | 5 | 0 | 9.68 | 9.92 |
| wallet sync queue | passed | 5 | 5 | 0 | 7.85 | 7.93 |
| backup validate | passed | 1 | 1 | 0 | 4.47 | 4.47 |

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
- The run proves authenticated wallet list, transaction-history, wallet-sync queue, and admin backup-validation paths execute end to end on a local seeded stack.
- The local generated wallet is smoke evidence only; a representative large-wallet dataset and backend scale-out proof remain required before claiming Phase 3 complete.
- Restore remains intentionally skipped because it is destructive unless `SANCTUARY_ALLOW_RESTORE=true` is set for a restore-safe environment.
