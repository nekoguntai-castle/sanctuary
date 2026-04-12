# Phase 2 Gateway Audit Compose Smoke

Date: 2026-04-12T23:18:24.249Z
Status: Passed
Compose project: sanctuary-phase2-audit-2026-04-12t23-18-24-249z
Gateway URL (published): http://127.0.0.1:14000
Gateway URL (in-container proof): http://127.0.0.1:4000

## Results

- PASS compose stack started: project=sanctuary-phase2-audit-2026-04-12t23-18-24-249z gatewayPort=14000
- PASS gateway health: status=200 bodyStatus=ok
- PASS gateway protected route event: missing token request returned 401 and should emit AUTH_MISSING_TOKEN
- PASS backend audit persistence: persisted gateway.auth_missing_token for Phase2GatewayAuditComposeSmoke/2026-04-12T23-18-24-249Z
- PASS unsigned backend audit rejection: status=403 and no audit row persisted
- PASS gateway delivery logs: no audit delivery errors in recent gateway logs
- PASS compose container health: 5 service containers running and healthy

## Audit Row

- Action: gateway.auth_missing_token
- Username: gateway
- Category: gateway
- Success: false
- Error: AUTH_MISSING_TOKEN
- Source: gateway
- Path: /wallets
- Severity: info
- User-Agent: Phase2GatewayAuditComposeSmoke/2026-04-12T23-18-24-249Z

## Containers

- backend: state=running health=healthy
- gateway: state=running health=healthy
- postgres: state=running health=healthy
- redis: state=running health=healthy
- worker: state=running health=healthy

## Notes

- This proof starts the backend and gateway as separate Docker Compose services with the production-style shared `GATEWAY_SECRET` HMAC path.
- The local proof pins `GATEWAY_TLS_ENABLED=false`; TLS-specific gateway listener behavior should be exercised separately when TLS changes.
- The gateway receives a protected-route request without a bearer token, emits a gateway security event, signs the backend audit request, and the backend persists the row in PostgreSQL.
- The smoke also verifies that an unsigned in-network request to the backend gateway-audit endpoint returns 403 without creating a row.
- Alertmanager notification delivery remains pending until production receiver channels are chosen.
