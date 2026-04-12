# Sanctuary Scalability And Performance Baseline

Date: 2026-04-11 (Pacific/Honolulu)
Status: Phase 3 baseline

This document defines the supported scale-out topology and the first performance gates to use when proving scalability. It is intentionally conservative: it documents what the current code and Compose topology support today, and separates that from future benchmark automation.

## Supported Topology

| Component | Current default | Can be replicated now? | Coordination boundary | Notes |
| --- | --- | --- | --- | --- |
| Frontend/Nginx | One container | Yes | Stateless HTTP serving | Multiple frontends can sit behind a load balancer if they share the same backend/gateway URLs and TLS posture. |
| Backend API | One container | Yes, with Redis and shared Postgres | Redis cache/event bus, Redis WebSocket bridge, shared Postgres | Backend instances are request-scoped. WebSocket broadcasts require Redis for cross-instance fanout; without Redis, broadcasts are local to one backend instance. |
| Mobile gateway | One container | Yes | Stateless proxying plus shared backend HMAC secret | Gateway instances must use the same `JWT_SECRET` and `GATEWAY_SECRET` as backend. Push provider credentials must be mounted consistently. |
| Worker | One container | Non-production only until validated | BullMQ/Redis queues and per-job distributed locks | Multiple workers can process BullMQ jobs, but recurring ownership, Electrum subscriptions, and lock behavior must be tested before production scale-out. Production support remains one worker. |
| Redis | One container | No in current Compose | Cache, BullMQ, event bus, WebSocket bridge | Redis is the coordination dependency for backend and worker scale-out. Production HA requires an external managed Redis or sentinel/cluster design not represented in this Compose file. |
| Postgres | One container | No in current Compose | Primary data store | Production HA/read replicas are outside current Compose. Do not add backend replicas before Postgres connection limits and latency are observed under load. |
| Electrum connections | Worker-owned | Partly | Worker Electrum manager and node client pool | Mainnet can use pool mode; recurring subscriptions are worker-owned. Multiple workers need explicit subscription ownership validation. |
| AI proxy/Ollama | One proxy and optional local container | Not assumed | Backend-to-AI proxy secret | Treat as singleton until AI workloads have separate capacity tests. |
| Monitoring stack | One stack | Not assumed | Prometheus/Grafana/Loki/Jaeger local stack | Monitoring ports bind to loopback by default. Use it to observe scale runs, not as a scale target itself. |

## Scale-Out Rules

- Keep Redis healthy before adding backend or worker replicas. Redis is the bridge for cache coherence, event fanout, and BullMQ coordination.
- Add backend replicas before worker replicas. Backend APIs are closer to stateless; worker replication has more ownership risk around recurring jobs and Electrum subscriptions.
- Keep exactly one worker in default deployments until a scale test proves recurring maintenance jobs, stale-wallet polling, confirmation updates, and Electrum subscriptions are not duplicated.
- Treat any worker replica count above one as non-production unless the worker scale-out smoke test for this release passes.
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

## Benchmark Matrix

Run the smallest relevant subset for each release that changes the touched area.

| Scenario | Minimum run | Required capture |
| --- | --- | --- |
| Large wallet list and transaction history | Load a wallet list and transaction history at realistic largest-known wallet size | HTTP p95/p99 by route, DB p95 by operation, frontend responsiveness notes |
| Wallet sync | Trigger sync on stale wallets across the largest-known address/transaction set | Sync p95/p99, failure ratio, Electrum health, worker queue depth |
| WebSocket fanout | Maintain multiple clients subscribed to wallet updates while triggering sync or transaction events | Connection count, message rates, rate-limit hits, Redis bridge errors |
| Queue processing | Enqueue representative sync, notification, maintenance, autopilot, and intelligence jobs | Queue depth, job processing p95, failed/stalled jobs |
| Backup/restore | Validate and restore a backup near the largest expected support size in non-production | Duration, memory/disk observations, HTTP status, restore validation result |
| Backend scale-out smoke | Run two backend instances behind a load balancer with Redis enabled | WebSocket cross-instance delivery, cache coherence, HTTP p95, DB pool latency |
| Worker scale-out smoke | Run two workers only in non-production | Duplicate-job absence, lock-loss handling, recurring job ownership, Electrum subscription behavior |

## Benchmark Harness

Use the Phase 3 harness for repeatable smoke and data-dependent benchmark records:

```bash
npm run perf:phase3
```

By default, the harness targets the local HTTPS stack at `https://127.0.0.1:8443`, the local gateway at `https://127.0.0.1:4000`, and the proxied WebSocket endpoint at `wss://127.0.0.1:8443/ws`. It writes Markdown and JSON records under `docs/plans/`.

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

Local fixture provisioning is intentionally limited to `localhost`, `127.0.0.1`, and `::1` API targets. It logs in with `admin` / `sanctuary` by default, unless `SANCTUARY_BENCHMARK_USERNAME` and `SANCTUARY_BENCHMARK_PASSWORD` are set, and creates or reuses a testnet wallet named `Phase 3 Benchmark Wallet`. Set `SANCTUARY_BENCHMARK_WALLET_NAME`, `SANCTUARY_BENCHMARK_WALLET_NETWORK`, or `SANCTUARY_BENCHMARK_WALLET_DESCRIPTOR` to override the fixture. Set `SANCTUARY_BENCHMARK_CREATE_BACKUP=true` to generate an in-memory backup for backup validation in the same run.

The auto-provisioned local fixture is smoke evidence only. It is useful for proving the authenticated paths run end to end, but it does not replace the production-like large-wallet dataset needed for the final scalability/performance gate.

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

Phase 3 should not be considered complete until:

- At least one benchmark run is recorded for wallet sync, transaction history, WebSocket fanout, backup/restore, and worker queue processing.
- The backend scale-out smoke test proves Redis-backed WebSocket broadcast delivery across at least two backend instances.
- Worker scale-out is either validated in non-production or remains explicitly unsupported for production.
- Postgres and Redis capacity limits are captured for the tested topology.
- Any regression gate used in release checks points to the exact metric or test evidence it depends on.
