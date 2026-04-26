# Container Diagram

Top-level processes and persistent stores inside Sanctuary. Click any container box to jump to its source entry point or per-service architecture doc.

```mermaid
graph TD
    Mobile["Mobile App<br/>iOS / Android"]
    Web["Web Frontend<br/>React + Vite"]

    Gateway["Gateway<br/>Express :4000<br/><i>JWT, rate limit, push fan-out</i>"]
    Backend["Backend API<br/>Express :3000<br/><i>routes, services, repositories</i>"]
    Worker["Worker<br/>BullMQ consumer<br/><i>notifications, sync jobs, DLQ</i>"]
    AiProxy["AI Proxy<br/><i>LLM gateway for intelligence features</i>"]

    Postgres[(Postgres<br/>via Prisma)]
    Redis[(Redis<br/>queue + cache + locks)]
    Electrum["Electrum Node<br/>(self-hosted)"]

    FCM["FCM"]
    APNs["APNs"]
    Telegram["Telegram Bot API"]

    Mobile -- "HTTPS Bearer JWT" --> Gateway
    Web -- "HTTPS session cookie" --> Backend
    Gateway -- "HTTP X-Gateway-* headers" --> Backend
    Gateway <-. "WebSocket events (HMAC)" .-> Backend

    Backend --> Postgres
    Backend --> Redis
    Backend --> Electrum
    Backend -- "enqueue" --> Redis
    Worker -- "consume" --> Redis
    Worker --> Postgres
    Worker --> Telegram
    Backend --> Telegram
    Backend --> AiProxy

    Gateway --> FCM
    Gateway --> APNs

    click Mobile href "../../README.md" "Mobile app repo"
    click Web href "../../src/" "Web frontend source"
    click Gateway href "../../gateway/ARCHITECTURE.md" "Gateway architecture"
    click Backend href "../../server/ARCHITECTURE.md" "Backend architecture"
    click Worker href "../../server/src/worker.ts" "Worker entry point"
    click AiProxy href "../../ai-proxy/ARCHITECTURE.md" "AI proxy architecture"
    click Telegram href "notification-pipeline.md" "Notification component view"
```

---

## Notable boundaries

| Edge | Auth | Notes |
|---|---|---|
| Mobile → Gateway | JWT Bearer (`sanctuary:access`) | Verified locally with shared `JWT_SECRET`; never reaches backend if invalid |
| Web → Backend | Session cookie | Bypasses gateway entirely |
| Gateway → Backend (HTTP) | HMAC headers (`X-Gateway-Signature`) | For internal endpoints (mobile permission check) |
| Gateway ↔ Backend (WS) | HMAC challenge-response with `GATEWAY_SECRET` | Long-lived; auto-reconnects every 5s |
| Backend → Telegram | Per-user bot token (Telegram API) | **Two distinct call paths exist** — see [`notification-pipeline.md`](notification-pipeline.md) |
| Worker → Redis | Redis password | Worker is the consumer of every BullMQ queue |

The cross-package boundary rules enforced statically by `scripts/check-architecture-boundaries.mjs` correspond to the edges *missing* from this diagram (e.g. browser code may not import server internals; gateway may not import server internals).
