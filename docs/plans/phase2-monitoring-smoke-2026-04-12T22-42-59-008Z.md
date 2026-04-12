# Phase 2 Monitoring Stack Smoke

Date: 2026-04-12T22:42:59.008Z
Status: Passed

## Endpoints

- Grafana: http://127.0.0.1:13000
- Prometheus: http://127.0.0.1:19090
- Alertmanager: http://127.0.0.1:19093
- Jaeger: http://127.0.0.1:16687
- Loki: http://127.0.0.1:13100

## Probe Results

- PASS grafana health: version=10.2.0 database=ok
- PASS prometheus health: Prometheus Server is Healthy.
- PASS prometheus alert rules loaded: 5 rule groups: sanctuary.http, sanctuary.infrastructure, sanctuary.sync, sanctuary.wallet, sanctuary.websocket
- PASS alertmanager health: OK
- PASS alertmanager status: version=0.26.0
- PASS jaeger services api: 1 traced services visible
- PASS loki ready: ready

## Container Health

- PASS sanctuary-grafana: running=true health=healthy
- PASS sanctuary-prometheus: running=true health=healthy
- PASS sanctuary-alertmanager: running=true health=healthy
- PASS sanctuary-jaeger: running=true health=healthy
- PASS sanctuary-loki: running=true health=healthy
- PASS sanctuary-promtail: running=true health=healthy

## Runtime Log Checks

- PASS promtail Docker discovery compatibility: no Promtail Docker discovery compatibility errors in recent logs (window=10m)
- PASS promtail Loki push path: no Promtail-to-Loki push errors in recent logs (window=10m)

## Port Binding Check

- PASS all published monitoring ports bind to 127.0.0.1
- grafana: 127.0.0.1:13000->3000/tcp
- prometheus: 127.0.0.1:19090->9090/tcp
- alertmanager: 127.0.0.1:19093->9093/tcp
- jaeger: 127.0.0.1:16687->16686/tcp
- jaeger: 127.0.0.1:14317->4317/tcp
- jaeger: 127.0.0.1:14318->4318/tcp
- loki: 127.0.0.1:13100->3100/tcp

## Notes

- This smoke verifies the local monitoring stack endpoints, Prometheus rule loading, Alertmanager status, Jaeger API reachability, Loki readiness, and Compose loopback host bindings.
- Container health and recent Promtail logs are checked to catch image-level healthcheck drift and Docker API compatibility errors.
- Prometheus target health for backend and worker is intentionally not a pass/fail criterion here because this proof can run against the monitoring stack without requiring the full application stack.
- Alertmanager notification delivery remains pending until production receiver channels are chosen.
