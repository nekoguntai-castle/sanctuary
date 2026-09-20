# Prometheus client compatibility evidence

Reviewed metrics change `14e756cb` in integrated candidate `4686887e` using
Node 24.19.0. Real compiled Sanctuary registries, MCP metrics and the Express
metrics middleware/HTTP handler were exercised with `prom-client` 15.1.3 and
`@prometheus-io/client` 0.16.1 in separate processes.

Both HTTP endpoints returned 200 with the same Prometheus 0.0.4 text content
type. All 78 existing metric definitions retained their names, types, label
names and help strings. The replacement adds two Node event-loop utilization
families. No existing captured sample series or histogram buckets disappeared;
GC observation labels vary with process activity. CPU/memory/timing values
were intentionally not compared.

An isolated three-service stack then ran the candidate's actual compiled HTTP
handler with the pinned production Prometheus 2.47 and Alertmanager 0.26 images.
It used unchanged production `prometheus.yml`, `alert_rules.yml` and
`alertmanager.yml`. The existing wallet-sync test clock parameter produced a
400-second `initial_network` stage, without changing production alert rules.

All checks passed: `promtool` validated 17 rules, Prometheus scraped the real
handler, the expected metric labels/value appeared, the production
`WalletSyncActiveStageOverBudget` alert fired, and Alertmanager received it.
The stack used an internal network, unique test names, no host ports and no
external alert receivers. This is a focused metrics/alert compatibility proof,
not a Grafana UI or complete optional-monitoring-profile test.

The signed coordinator finished with subject exit 0, cleanup exit 0 and
`cleanupState=cleaned`. An earlier harness attempt failed before the smoke
because the existing no-owned-image registration path rejects an empty image
listing; its cleanup also completed. The successful stack produced no owned
images or volumes and used coordinator discovery of labeled containers/network.

Evidence is retained at operator-local `/tmp/sanctuary-metrics-evidence`, not
a durable CI URL. It includes both HTTP scrapes, definition manifests, scripts,
raw logs and signed public cleanup artifacts. SHA-256 hashes:

| Relative path | SHA-256 |
| --- | --- |
| `metrics-before.json` | `5a907a79fbed7bf500dfd5fb0068d89b7b11ef676601bf39025e50e8f40a8977` |
| `metrics-after.json` | `2ec708211855e5bf368599b6fdcad5360e8289fe9b301cd41153db7f1a72ebad` |
| `sanctuary-metrics-proof2.log` | `0a64842bc4720866edb1fe3d4a3a689d22b34ac1c33d819bba41913d32977c4b` |
| `sanctuary-cleanup-local.7uEQka/artifacts/final-upload.json` | `85887f68cc3dcbd21155c6df917ee1fced1306ab9d815f83041dc64c6a8887e0` |
