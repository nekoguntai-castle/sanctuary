# Sanctuary Scalability And Performance Baseline

Date: 2026-04-14 (Pacific/Honolulu)
Status: Phase 3 privacy-safe generated capacity proof complete; target-environment calibration remains release evidence when topology or hardware differs

This document defines the supported scale-out topology and the first performance gates to use when proving scalability. It is intentionally conservative: it documents what the current code and Compose topology support today, and separates that from future benchmark automation.

## Supported Topology

| Component | Current default | Can be replicated now? | Coordination boundary | Notes |
| --- | --- | --- | --- | --- |
| Frontend/Nginx | One container | Yes | Stateless HTTP serving | Multiple frontends can sit behind a load balancer if they share the same backend/gateway URLs and TLS posture. |
| Backend API | One container | Yes, with Redis and shared Postgres | Redis cache/event bus, Redis WebSocket bridge, shared Postgres | Backend instances are request-scoped. WebSocket broadcasts require Redis for cross-instance fanout; without Redis, broadcasts are local to one backend instance. |
| Mobile gateway | One container | Yes | Stateless proxying plus shared backend HMAC secret | Gateway instances must use the same `JWT_SECRET` and `GATEWAY_SECRET` as backend. Push provider credentials must be mounted consistently. |
| Worker | One container | Non-production generated-load proof complete; production replica support still requires a current target-environment run | BullMQ/Redis queues, per-job distributed locks, retryable Electrum subscription ownership | The disposable two-worker proof now covers diagnostic BullMQ processing on both replicas, recurring job deduplication, one Electrum owner after retry recovery, a shared-lock skip, and a repeated local queue-handler profile. Keep production deployments at one worker unless the release has a current privacy-safe queue-load and Electrum ownership run for the target topology. |
| Redis | One container | No in current Compose | Cache, BullMQ, event bus, WebSocket bridge | Redis is the coordination dependency for backend and worker scale-out. Production HA requires an external managed Redis or sentinel/cluster design not represented in this Compose file. |
| Postgres | One container | No in current Compose | Primary data store | Production HA/read replicas are outside current Compose. Do not add backend replicas before Postgres connection limits and latency are observed under load. |
| Electrum connections | Worker-owned | Partly | Worker Electrum manager and node client pool | Mainnet can use pool mode; recurring subscriptions are worker-owned. Multiple workers need explicit subscription ownership validation. |
| AI proxy/Ollama | One proxy and optional local container | Not assumed | Backend-to-AI proxy secret | Treat as singleton until AI workloads have separate capacity tests. |
| Monitoring stack | One stack | Not assumed | Prometheus/Grafana/Loki/Jaeger local stack | Monitoring ports bind to loopback by default. Use it to observe scale runs, not as a scale target itself. |

## Scale-Out Rules

- Keep Redis healthy before adding backend or worker replicas. Redis is the bridge for cache coherence, event fanout, and BullMQ coordination.
- Add backend replicas before worker replicas. Backend APIs are closer to stateless; worker replication has more ownership risk around recurring jobs and Electrum subscriptions.
- Keep exactly one worker in default deployments until the release has a current worker scale-out proof and privacy-safe worker queue-load evidence for the target environment.
- Treat any worker replica count above one as non-production unless the worker scale-out proof for this release passes; for production, also require privacy-safe queue-load and Electrum subscription-volume evidence for the deployed topology.
- Do not scale Postgres by adding another Compose database container. Use a managed/external Postgres HA plan if database availability is the scaling problem.
- Do not scale around slow external dependencies. If Electrum, mempool.space, push providers, or AI providers are the bottleneck, add backpressure or provider capacity before adding app replicas.

## Required Metrics

Use these existing metrics and dashboards during every scale/performance run:

| Area | Metric or dashboard | Why it matters |
| --- | --- | --- |
| HTTP API | `sanctuary_http_request_duration_seconds`, `sanctuary_http_requests_total`, API Performance dashboard | Proves route-level p50/p95/p99 and 5xx behavior. |
| Database | `sanctuary_db_query_duration_seconds`, `sanctuary_db_pool_latency_ms`, Infrastructure dashboard | Shows whether backend replicas are saturating Postgres. |
| Wallet sync | `sanctuary_wallet_sync_duration_seconds`, `sanctuary_wallet_syncs_total`, Wallet Sync dashboard | Proves sync throughput and failure rate. |
| Worker queue | `sanctuary_job_queue_depth`, `sanctuary_job_processing_duration_seconds`, Worker dashboard | Shows queue backlog, processing latency, and worker saturation. |
| WebSocket | `sanctuary_websocket_connections`, `sanctuary_websocket_messages_total`, `sanctuary_websocket_rate_limit_hits_total` | Proves fanout capacity and abusive-client behavior. |
| Electrum | `sanctuary_electrum_server_healthy`, `sanctuary_electrum_pool_acquisition_duration_seconds`, Electrum Pool dashboard | Separates app bottlenecks from Electrum degradation. |
| Cache | `sanctuary_cache_operations_total`, Cache Efficiency dashboard | Shows whether cache behavior shifts under load and whether DB pressure is expected. |

## Initial Performance Gates

These gates are intentionally modest until a real benchmark history exists. Tighten them only after collecting repeatable results on known hardware.

| Workflow | Initial gate | Query or evidence |
| --- | --- | --- |
| General HTTP API | p95 under `2s`, p99 tracked, 5xx under `5%` for non-error test traffic | `histogram_quantile(0.95, sum(rate(sanctuary_http_request_duration_seconds_bucket[5m])) by (le))` and `sum(rate(sanctuary_http_requests_total{status=~"5.."}[5m])) / sum(rate(sanctuary_http_requests_total[5m]))` |
| Database queries | p95 under `500ms` during steady state | `histogram_quantile(0.95, sum(rate(sanctuary_db_query_duration_seconds_bucket[5m])) by (le))` |
| Wallet sync | p95 recorded by wallet size tier; no sustained failure rate above `10%` | Wallet Sync dashboard and `sanctuary_wallet_syncs_total{status="failure"}` ratio |
| Worker queue | Queue depth returns to baseline after the test window; no sustained stalled-job pattern | Worker dashboard, `sanctuary_job_queue_depth`, and worker logs |
| WebSocket fanout | No unexpected rate-limit spike; connection count returns to baseline after test | `sanctuary_websocket_connections` and `sanctuary_websocket_rate_limit_hits_total` |
| Electrum acquisition | p95 acquisition latency recorded; no `ElectrumPoolUnhealthy` during unrelated API tests | Electrum Pool dashboard |
| Backup/restore | Validate and restore complete for the tested backup size without 413/body-parser errors | Backend logs and admin backup/restore response codes |

## Privacy-Safe Benchmark Data

Do not benchmark third-party real-world wallets, addresses, or usage patterns. The supported benchmark inputs are:

- Synthetic or regtest fixtures generated by the harness.
- Operator-owned testnet wallets created specifically for benchmark proof.
- Restore-safe non-production backups whose owners have approved use for capacity testing.

Public testnet network availability may be used to exercise sync and transport paths for operator-owned fixture wallets. Do not select third-party testnet addresses or public wallet histories as proxies for large-wallet behavior; when scale is needed, use generated transaction/address volume and record the fixture size.

## Benchmark Matrix

Run the smallest relevant subset for each release that changes the touched area.

| Scenario | Minimum run | Required capture |
| --- | --- | --- |
| Large wallet list and transaction history | Load a wallet list and transaction history using a documented privacy-safe fixture size | HTTP p95/p99 by route, DB p95 by operation, frontend responsiveness notes |
| Wallet sync | Trigger sync on stale wallets across an operator-owned testnet/regtest fixture or generated address/transaction set | Sync p95/p99, failure ratio, Electrum health, worker queue depth |
| WebSocket fanout | Maintain multiple clients subscribed to wallet updates while triggering sync or transaction events | Connection count, message rates, rate-limit hits, Redis bridge errors |
| Queue processing | Enqueue privacy-safe sync, notification, maintenance, autopilot, and intelligence jobs | Queue depth, job processing p95, failed/stalled jobs |
| Backup/restore | Validate and restore a generated or approved backup near the intended support size in non-production | Duration, memory/disk observations, HTTP status, restore validation result |
| Backend scale-out smoke | Run two backend instances behind a load balancer with Redis enabled | WebSocket cross-instance delivery, cache coherence, HTTP p95, DB pool latency |
| Worker scale-out smoke | Run two workers only in non-production | Duplicate-job absence, lock-loss handling, recurring job ownership, Electrum subscription behavior |

## Benchmark Harness

Use the Phase 3 harness for repeatable smoke and data-dependent benchmark records:

```bash
npm run perf:phase3
```

By default, the harness targets the local HTTPS stack at `https://127.0.0.1:8443`, the local gateway at `https://127.0.0.1:4000`, and the proxied WebSocket endpoint at `wss://127.0.0.1:8443/ws`. It writes Markdown and JSON records under `docs/plans/`.

For a disposable local full-stack smoke, use the Compose wrapper:

```bash
npm run perf:phase3:compose-smoke
```

The wrapper starts a temporary Docker Compose project with frontend, backend, gateway, worker, Redis, and PostgreSQL, waits for migration/seed and service health, then runs `npm run perf:phase3` with strict local fixture provisioning, wallet-specific WebSocket sync fanout, generated backup validation and restore, synthetic large-wallet transaction-history proof, local worker queue handler proof, sized generated-backup restore proof, Postgres/Redis capacity snapshots, two-worker scale-out proof, and multi-client two-backend Redis WebSocket fanout proof. It creates disposable TLS material in a temporary `SANCTUARY_SSL_DIR` before Compose starts, preserving the runtime-secret contract without requiring repo-local PEM files. It chooses loopback host ports automatically unless `PHASE3_COMPOSE_BENCHMARK_HTTP_PORT`, `PHASE3_COMPOSE_BENCHMARK_HTTPS_PORT`, or `PHASE3_COMPOSE_BENCHMARK_GATEWAY_PORT` are set. Backup restore is enabled by default because this wrapper uses a temporary database; set `PHASE3_COMPOSE_ALLOW_RESTORE=false` only when explicitly testing non-destructive mode. Set `PHASE3_LARGE_WALLET_TRANSACTION_COUNT`, `PHASE3_LARGE_WALLET_HISTORY_REQUESTS`, `PHASE3_LARGE_WALLET_HISTORY_CONCURRENCY`, `PHASE3_LARGE_WALLET_HISTORY_PAGE_SIZE`, and `PHASE3_LARGE_WALLET_HISTORY_P95_MS` to adjust the synthetic large-wallet transaction-history proof. Set `PHASE3_SIZED_BACKUP_RESTORE_PROOF=false` to skip the generated sized backup create/validate/restore proof, and set `PHASE3_CAPACITY_SNAPSHOTS=false` to skip the Postgres/Redis capacity snapshots. Set `PHASE3_WORKER_QUEUE_PROOF_TIMEOUT_MS` to adjust the per-job wait timeout for the worker queue proof, and set `PHASE3_WORKER_QUEUE_PROOF_REPEATS` to repeat the local queue-handler profile. Set `PHASE3_WORKER_SCALE_OUT_REPLICAS`, `PHASE3_WORKER_SCALE_OUT_PROOF_TIMEOUT_MS`, `PHASE3_WORKER_SCALE_OUT_JOB_COUNT`, and `PHASE3_WORKER_SCALE_OUT_JOB_DELAY_MS` to adjust the worker scale-out proof. The wrapper also sets shorter proof-only Electrum ownership lock/retry intervals by default through `PHASE3_ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS`, `PHASE3_ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS`, and `PHASE3_ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS`; production defaults remain more conservative unless those core env vars are overridden. Set `PHASE3_BACKEND_SCALE_OUT_REPLICAS`, `PHASE3_BACKEND_SCALE_OUT_PROOF_TIMEOUT_MS`, and `PHASE3_BACKEND_SCALE_OUT_WS_CLIENTS` to adjust the backend scale-out proof. For disposable fanout profiles above the default backend per-user limit, set `PHASE3_MAX_WEBSOCKET_PER_USER` and `PHASE3_MAX_WEBSOCKET_CONNECTIONS`; the Compose service forwards the corresponding backend `MAX_WEBSOCKET_PER_USER` and `MAX_WEBSOCKET_CONNECTIONS` values. The backend config schema currently caps `MAX_WEBSOCKET_PER_USER` at 100, so higher generated profiles require a deliberate config-policy change before they can be valid proof. Set `PHASE3_COMPOSE_BENCHMARK_KEEP_STACK=true` only when you need to inspect the disposable stack after a failed run. If repeated local runs hit Docker image tag races on this host, `COMPOSE_PARALLEL_LIMIT=1` serializes Compose build/start work.

Configure authenticated and data-dependent scenarios with environment variables:

```bash
SANCTUARY_API_URL=https://127.0.0.1:8443 \
SANCTUARY_GATEWAY_URL=https://127.0.0.1:4000 \
SANCTUARY_TOKEN=<access-token> \
SANCTUARY_WALLET_ID=<wallet-id> \
SANCTUARY_ADMIN_TOKEN=<admin-access-token> \
SANCTUARY_BACKUP_FILE=/path/to/backup.json \
npm run perf:phase3
```

For a local seeded instance, the harness can create or reuse a benchmark fixture instead of requiring a pre-collected token and wallet ID:

```bash
SANCTUARY_BENCHMARK_PROVISION=true npm run perf:phase3
```

Local fixture provisioning is intentionally limited to `localhost`, `127.0.0.1`, and `::1` API targets by default. For a private non-production LAN target such as `https://10.14.23.93:8443`, set `SANCTUARY_BENCHMARK_ALLOW_PRIVATE_PROVISION=true`; if the target uses the local development certificate, also set `SANCTUARY_INSECURE_TLS=true`. It logs in with `admin` / `sanctuary` by default, unless `SANCTUARY_BENCHMARK_USERNAME` and `SANCTUARY_BENCHMARK_PASSWORD` are set, and creates or reuses a testnet wallet named `Phase 3 Benchmark Wallet`. Set `SANCTUARY_BENCHMARK_WALLET_NAME`, `SANCTUARY_BENCHMARK_WALLET_NETWORK`, or `SANCTUARY_BENCHMARK_WALLET_DESCRIPTOR` to override the fixture. Set `SANCTUARY_BENCHMARK_CREATE_BACKUP=true` to generate an in-memory backup for backup validation in the same run. Set `SANCTUARY_WS_FANOUT_CLIENTS` to change the number of authenticated WebSocket clients used for the subscription fanout scenario; it defaults to `SANCTUARY_WS_CLIENTS`.

The auto-provisioned local fixture is repository-controlled capacity evidence. It is useful for proving the authenticated paths, generated backup validation and restore, a synthetic large-wallet transaction-history query, worker queue handlers, two-worker BullMQ/Electrum ownership behavior, multi-client two-backend Redis WebSocket fanout, and Postgres/Redis capacity snapshots end to end without requiring a pre-existing local stack. The last passing disposable evidence was generated 2026-04-15 UTC (proof artifacts removed from repo; available in git history). Results: 25,000 synthetic transactions, 100 authenticated history requests at concurrency 10, p95 70 ms, p99 77.17 ms, a 16.3 MiB generated restore, 6 worker queue proof jobs, two worker replicas, and 100/100 Redis-bridged WebSocket clients across two backend replicas. Regenerate with `npm run perf:phase3:compose-smoke`.

Restore testing is destructive and remains opt-in:

```bash
SANCTUARY_ALLOW_RESTORE=true SANCTUARY_BACKUP_FILE=/path/to/backup.json npm run perf:phase3
```

For release gates, set `SANCTUARY_BENCHMARK_STRICT=true` so failed measured scenarios fail the command. Skipped scenarios are recorded in the run output because they indicate missing input data or intentionally disabled destructive work.

## Run Record Template

Create one record per meaningful run under `docs/plans/` or the release notes.

```text
Date:
Commit:
Environment:
Topology:
Dataset:
Scenario:
Duration:
Traffic shape:
HTTP p95/p99:
DB p95:
Wallet sync p95/p99:
Worker queue depth start/peak/end:
WebSocket connections/messages/rate-limit hits:
Electrum healthy servers and acquisition p95:
Failure rate:
Known bottleneck:
Decision:
```

## Phase 3 Exit Criteria

Repository-controlled Phase 3 generated capacity proof is complete as of the 2026-04-15 UTC evidence run:

- Last generated capacity evidence was produced 2026-04-15 UTC (proof artifact removed from repo; available in git history). Regenerate with `npm run perf:phase3:compose-smoke`.
- The run recorded wallet list, transaction history, WebSocket subscription fanout, wallet sync queueing, backup validation and restore, a synthetic 25,000-transaction wallet-history gate, a 16.3 MiB generated backup with 25,076 restored records, 6 worker queue proof jobs, two-worker diagnostic processing/ownership, 100-client two-backend Redis WebSocket fanout, and Postgres/Redis capacity snapshots.
- `docker-compose.yml` now forwards backend WebSocket limit env vars for repeatable local fanout proof, and the Nginx `/api/` proxy body limit matches the backend 200MB backup validate/restore parser.

The following remain required before broadening production scale-out support beyond the generated proof boundary:

- Repeat the generated-data profile or an operator-owned testnet/regtest equivalent on the target non-production topology when hardware, load balancer, database, Redis, or worker sizing differs from the local Compose proof.
- Record approved restore-safe backup timing when the supported backup size exceeds the 16.3 MiB generated proof.
- Calibrate strict release thresholds from the target topology after the first repeatable run on that environment.
- Ensure any regression gate used in release checks points to the exact metric or test evidence it depends on.
