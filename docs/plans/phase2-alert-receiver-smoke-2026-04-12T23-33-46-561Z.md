# Phase 2 Alert Receiver Delivery Smoke

Date: 2026-04-12T23:33:46.561Z
Status: Passed
Compose project: sanctuary-phase2-alert-2026-04-12t23-33-46-561z
Alertmanager URL: http://127.0.0.1:19193
Webhook receiver URL (host): http://127.0.0.1:19199/alerts
Webhook receiver URL (container): http://host.docker.internal:19199/alerts

## Results

- PASS receiver config generated: receiver=phase2-webhook url=http://host.docker.internal:19199/alerts
- PASS webhook receiver started: listening at http://127.0.0.1:19199/alerts
- PASS alertmanager started: project=sanctuary-phase2-alert-2026-04-12t23-33-46-561z alertmanagerPort=19193
- PASS alertmanager health: OK
- PASS alertmanager status: version=0.26.0
- PASS test alert submitted: status=200 alert=Phase2AlertReceiverProof
- PASS webhook delivery received: alerts=1 receiver=phase2-webhook
- PASS alertmanager container health: 1 service containers running and healthy

## Delivered Alert

- Alert: Phase2AlertReceiverProof
- Severity: critical
- Status: firing
- Receiver: phase2-webhook
- Run: 2026-04-12T23-33-46-561Z

## Containers

- alertmanager: state=running health=healthy

## Notes

- This proof starts a disposable Alertmanager container with a temporary webhook receiver and posts a real alert to the Alertmanager v2 API.
- The proof verifies receiver routing and delivery to the webhook sink; it does not choose or validate the production external notification channel.
- Production durable receiver delivery remains pending until the notification channel and credentials are chosen.
