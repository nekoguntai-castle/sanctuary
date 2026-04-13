# Sanctuary Operations Runbooks

Date: 2026-04-12 (Pacific/Honolulu)
Status: Phase 2 operations proof baseline

This document maps the existing monitoring stack and alert rules to concrete triage steps. It intentionally starts with the alerts and failure modes already present in the repo instead of inventing new operational processes.

## Phase 2 Proof Records

- 2026-04-12: `docs/plans/phase2-operations-proof-2026-04-12T08-44-39-1000.md` records a passing disposable PostgreSQL backup/restore drill and gateway audit persistence drill.
- 2026-04-12: `docs/plans/phase2-monitoring-smoke-2026-04-12T22-42-59-008Z.md` records a passing local monitoring stack smoke with Grafana, Prometheus, Alertmanager, Jaeger, Loki, Promtail container health, Prometheus rule loading, Promtail runtime log checks, and loopback-only host port bindings.
- 2026-04-12: `docs/plans/phase2-gateway-audit-compose-smoke-2026-04-12T23-18-24-249Z.md` records a passing full Compose backend/gateway audit smoke with signed audit persistence, unsigned audit rejection, gateway delivery-log checks, and container health.
- 2026-04-12: `docs/plans/phase2-alert-receiver-smoke-2026-04-12T23-33-46-561Z.md` records a passing disposable Alertmanager webhook receiver delivery smoke.
- Run repeatable local proof with `npm run test:ops:phase2`.
- If local port `5433` is already allocated, run with an alternate host port, for example `TEST_POSTGRES_PORT=55433 npm run test:ops:phase2`.
- Run repeatable monitoring proof with `npm run ops:monitoring:phase2` after starting the monitoring stack.
- Run repeatable Alertmanager receiver delivery proof with `npm run ops:alert-receiver:phase2`.
- Run repeatable full backend/gateway audit proof with `npm run ops:gateway-audit:phase2`.

## Monitoring Exposure

The optional monitoring stack in `docker-compose.monitoring.yml` binds host ports to `127.0.0.1` by default through `MONITORING_BIND_ADDR`.

Default local endpoints:

- Grafana: `http://127.0.0.1:3000`, authenticated as `admin` with `GRAFANA_PASSWORD` or `ENCRYPTION_KEY`.
- Prometheus: `http://127.0.0.1:9090`, no built-in auth.
- Alertmanager: `http://127.0.0.1:9093`, no built-in auth.
- Jaeger UI: `http://127.0.0.1:16686`, no built-in auth.
- Jaeger OTLP: `127.0.0.1:4317` and `127.0.0.1:4318`.
- Loki: `http://127.0.0.1:3100`, internal log API, no built-in auth.

Do not set `MONITORING_BIND_ADDR=0.0.0.0` unless the host is protected by firewall rules or the services sit behind an authenticated reverse proxy or private network. Prometheus, Alertmanager, Jaeger, and Loki should be treated as sensitive because they expose topology, labels, traces, and logs.

Recommended remote access:

- Prefer SSH tunnels or a private VPN.
- If browser access is required, expose only Grafana through authenticated HTTPS and keep Prometheus, Alertmanager, Jaeger, Loki, and OTLP ingestion private.
- Keep `GRAFANA_ANONYMOUS_ENABLED=false` for production.

## Monitoring Stack Exercise

Start the local monitoring stack before running the smoke:

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d prometheus alertmanager grafana loki jaeger promtail
npm run ops:monitoring:phase2
```

Use explicit loopback port overrides when defaults are already allocated. The 2026-04-12 smoke used this form because another local project already owned host port `3100`:

```bash
MONITORING_BIND_ADDR=127.0.0.1 \
GRAFANA_PORT=13000 \
PROMETHEUS_PORT=19090 \
ALERTMANAGER_PORT=19093 \
JAEGER_UI_PORT=16687 \
JAEGER_OTLP_GRPC_PORT=14317 \
JAEGER_OTLP_HTTP_PORT=14318 \
LOKI_PORT=13100 \
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d prometheus alertmanager grafana loki jaeger promtail

MONITORING_BIND_ADDR=127.0.0.1 \
GRAFANA_PORT=13000 \
PROMETHEUS_PORT=19090 \
ALERTMANAGER_PORT=19093 \
JAEGER_UI_PORT=16687 \
JAEGER_OTLP_GRPC_PORT=14317 \
JAEGER_OTLP_HTTP_PORT=14318 \
LOKI_PORT=13100 \
npm run ops:monitoring:phase2
```

Environment-specific adjustments captured in the 2026-04-12 drill:

- `LOKI_PORT`, `JAEGER_OTLP_GRPC_PORT`, and `JAEGER_OTLP_HTTP_PORT` are configurable so the stack can be exercised without conflicting with other local services.
- Promtail is pinned to `grafana/promtail:3.5.0`; `2.9.0` used an older Docker API client and failed against this host's Docker daemon.
- Promtail health uses `/bin/promtail -config.file=/etc/promtail/config.yml -check-syntax` because the image does not include `wget`.
- Promtail Docker discovery is filtered to `com.docker.compose.project=sanctuary`, and the pipeline adds `job=sanctuary` so local unrelated containers are not collected and Loki streams always have at least one label.

## Alert Receiver Delivery Exercise

Run the disposable receiver delivery smoke when Alertmanager routing or receiver configuration changes:

```bash
npm run ops:alert-receiver:phase2
```

Expected behavior:

- The smoke starts a temporary Alertmanager container with a generated `phase2-webhook` receiver that points at a local webhook sink.
- The smoke submits a real `Phase2AlertReceiverProof` alert to Alertmanager's v2 API.
- Alertmanager routes the alert to the webhook sink, and the smoke verifies the delivered payload has `status=firing`, `receiver=phase2-webhook`, and the expected proof labels.
- The temporary container and generated config are removed after the proof unless `PHASE2_ALERT_RECEIVER_KEEP_STACK=true`.

This proves Alertmanager receiver routing and webhook delivery in a disposable local environment. It does not prove production Telegram, email, Slack, PagerDuty, or other external delivery; run a real production-channel delivery proof after the notification channel and credentials are chosen.

## First Checks

Run these before drilling into a specific alert:

```bash
docker compose ps
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml ps
docker compose logs --tail=200 backend
docker compose logs --tail=200 worker
docker compose logs --tail=200 gateway
```

Confirm the metrics endpoints from inside the Compose network when possible:

```bash
docker compose exec backend wget -qO- http://localhost:3001/health
docker compose exec backend wget -qO- http://localhost:3001/metrics
docker compose exec worker wget -qO- http://localhost:3002/metrics/prometheus
```

## HTTP Errors And Latency

Alerts:

- `HighErrorRate`
- `CriticalErrorRate`
- `HighLatency`

Immediate triage:

- Open Grafana API Performance and Overview dashboards.
- Check backend logs for request IDs, route names, 5xx errors, and upstream timeout messages.
- Compare latency by route before restarting services; a single slow route usually points to DB, Electrum, or external API behavior rather than a whole-service failure.
- Check database latency and Electrum health alerts in the same window.

Mitigation:

- If one route is failing, disable the affected UI/mobile workflow operationally before restarting the whole stack.
- If most routes are failing and health checks are unhealthy, restart backend after capturing logs.
- If restarts temporarily recover the system, keep the incident open until the underlying route, database, or Electrum cause is identified.

## Wallet Sync Failures

Alert:

- `WalletSyncFailures`

Immediate triage:

- Open Grafana Wallet Sync and Worker dashboards.
- Check worker logs for sync job failures, lock contention, Electrum errors, and queue retry loops.
- Check backend logs for API-triggered sync requests that might be falling back to in-process polling.
- Confirm at least one Electrum server is healthy.

Mitigation:

- If Electrum is degraded, follow the Electrum runbook first.
- If the worker is unhealthy or stuck, inspect queue and worker logs before restart.
- Avoid repeatedly forcing full resyncs until Electrum health and worker ownership are understood.

## Transaction Broadcast Failures

Alert:

- `TransactionBroadcastFailures`

Immediate triage:

- Check backend logs for policy denial, insufficient funds, PSBT finalization, Electrum broadcast, and mempool rejection errors.
- Compare failures against wallet policy changes and recent fee-rate changes.
- Check Electrum health; broadcast failures during Electrum outages may be infrastructure rather than transaction-construction bugs.

Mitigation:

- If failures are policy or validation related, do not retry blindly; surface the specific rejection to the user workflow owner.
- If failures are Electrum transport related, follow the Electrum runbook and retry after healthy broadcast connectivity returns.
- Preserve the transaction/draft identifiers and request ID from logs for incident follow-up.

## Worker Or Queue Stall

Related alert:

- `SyncInProcessFallback`

Immediate triage:

- Check worker container health and logs.
- Check Redis container health and connectivity.
- Look for repeated BullMQ failures, stalled jobs, lock acquisition failures, or maintenance job loops.
- Open Grafana Worker dashboard.

Mitigation:

- Restart the worker only after capturing logs around the first stall.
- If Redis is unhealthy, recover Redis first; worker restarts will not fix a broken queue backend.
- If the API entered in-process fallback, confirm it returns to worker-owned polling after worker recovery.

## Electrum Degradation

Alerts:

- `ElectrumPoolUnhealthy`
- `ElectrumPoolDegraded`

Immediate triage:

- Open Grafana Electrum Pool dashboard.
- Check worker logs for connection failures, timeout messages, subscription churn, and server-specific failures.
- Identify whether all servers are failing or only a subset.

Mitigation:

- If all servers fail, check host network/DNS before changing app config.
- If one server fails, remove or deprioritize that server from config and restart the worker during a maintenance window.
- Treat `ElectrumPoolUnhealthy` as blocking for sync and transaction freshness.

## Database Saturation

Alert:

- `HighDatabaseLatency`

Immediate triage:

- Open Grafana Infrastructure dashboard.
- Check backend logs for slow route clusters and Prisma errors.
- Check Postgres container CPU, memory, disk pressure, and connection limits.
- Look for concurrent backup/restore, export, sync, or maintenance jobs.

Mitigation:

- Stop or delay non-critical jobs that increase DB pressure.
- Restarting backend without resolving DB latency can amplify retries; prefer reducing load first.
- If disk is near full, address disk capacity before running cleanup jobs that write more data.

## Cache Hit Rate

Alert:

- `LowCacheHitRate`

Immediate triage:

- Open Grafana Cache Efficiency dashboard.
- Check whether the drop started after deploy, restart, Redis issue, or a workload shift.
- Confirm Redis is healthy.

Mitigation:

- Treat this as informational unless paired with latency, DB pressure, or worker failures.
- If paired with DB latency, recover Redis/cache behavior before scaling backend.

## WebSocket Alerts

Alerts:

- `WebSocketConnectionSpike`
- `NoWebSocketConnections`

Immediate triage:

- Check backend WebSocket logs and Grafana Overview dashboard.
- For connection spikes, check gateway/frontend traffic sources and auth failures.
- For zero connections, confirm whether this is expected during maintenance or low traffic.

Mitigation:

- If a spike is legitimate load, watch Redis bridge and backend memory before scaling.
- If a spike is abusive, tighten gateway/rate-limit controls and block the source at the edge.
- If zero connections are unexpected, check frontend routing, backend WebSocket health, and auth token issuance.

## Backup And Restore Failures

Signals:

- Backend 5xx logs on `/api/v1/admin/backup/*` or `/api/v1/admin/restore`.
- Support requests reporting failed validation, failed restore, or truncated uploads.

Immediate triage:

- Check backend logs for body-size errors, JSON parse errors, password verification errors, and Prisma restore failures.
- Confirm frontend/Nginx/client body limits match the intended 200MB admin restore limit. The default Nginx `/api/` proxy templates set `client_max_body_size 200m` to match the backend admin backup validate/restore parser.
- Confirm disk capacity before retrying restore.

Verification:

```bash
npm run test:ops:phase2
```

Expected behavior:

- The disposable PostgreSQL backup/restore drill creates, validates, deletes, restores, and rechecks representative rows.
- The test database uses `docker-compose.test.yml`; set `TEST_POSTGRES_PORT` when the default local port is unavailable.

Mitigation:

- Do not retry a restore against production until the backup file validates.
- Preserve the failing backup file and backend logs for diagnosis.
- Run a restore drill against a non-production database before retrying risky production restore paths.

## Gateway Audit Failures

Signals:

- Gateway warnings containing `Failed to send audit event to backend`.
- Gateway warnings containing `Error sending audit event to backend`.
- Backend 403 responses for `/api/v1/push/gateway-audit`.
- Missing gateway events from the admin audit log during known blocked-route or rate-limit activity.

Immediate triage:

- Check `GATEWAY_SECRET` is configured and identical in backend and gateway.
- Check backend availability from the gateway container.
- Check gateway logs for HMAC timestamp, timeout, or non-OK response warnings.
- Check backend logs for `MW:GATEWAY_AUTH` warnings.
- Confirm the gateway signs `/api/v1/push/gateway-audit` and the backend verifies the full original URL.

Verification:

```bash
cd server && npx vitest run tests/unit/api/push.test.ts tests/unit/middleware/gatewayAuth.test.ts
cd gateway && npx vitest run tests/unit/middleware/requestLogger.test.ts
npm run test:ops:phase2
npm run ops:gateway-audit:phase2
```

Expected behavior:

- Gateway audit delivery is fire-and-forget and should not break client requests.
- Backend `POST /api/v1/push/gateway-audit` must reject unsigned requests.
- Signed gateway audit events must create `auditLogRepository` entries with `source: gateway`.
- The Phase 2 ops proof sends an event through the actual gateway `logSecurityEvent` helper and verifies the persisted backend audit-log row in PostgreSQL.
- The Phase 2 Compose proof starts separate backend, gateway, Postgres, Redis, and worker containers, triggers a live gateway missing-token security event, verifies signed backend persistence, verifies unsigned backend audit rejection, and checks gateway logs for audit delivery errors.
- The local Compose proof pins `GATEWAY_TLS_ENABLED=false`; run TLS-specific gateway checks separately when TLS listener behavior changes.

Mitigation:

- If HMAC verification fails, rotate only after confirming both services are updated together.
- If backend is down or timing out, recover backend first; gateway retries are not currently durable.
- If audit persistence is failing while requests still work, keep the incident open because admin visibility and security forensics are degraded.
