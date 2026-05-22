# Notification Pipeline (Component View)

This is the area where the **Telegram dual-path bug** was discovered: the same logical event was reaching Telegram via two divergent code paths depending on the entry point. Documenting this as a Component diagram makes new entry points visible in PR review.

---

## Two delivery paths

```mermaid
graph TD
    subgraph Callers
      ApiRoutes["src/api/**<br/>(REST endpoints)"]
      Worker["src/worker/jobs/notificationJobs.ts<br/>(BullMQ consumer)"]
      Autopilot["src/services/autopilot/evaluator.ts"]
      WalletSync["wallet sync hooks<br/>(transaction confirmed, draft created, ...)"]
    end

    Dispatcher["src/infrastructure/notificationDispatcher.ts<br/><b>Path A: queued, retry-capable</b>"]
    Queue[("Redis BullMQ<br/>'notifications' queue")]
    Registry["src/services/notifications/channels/registry.ts<br/>(channel multiplexer)"]
    ChannelTelegram["src/services/notifications/channels/telegram.ts"]
    ChannelPush["src/services/notifications/channels/push.ts"]
    ChannelAi["src/services/notifications/channels/aiInsights.ts"]
    ChannelWebhook["src/services/notifications/channels/webhook.ts"]
    WebhookOutbox[("PostgreSQL<br/>webhook_deliveries")]
    WebhookWorker["src/worker/jobs/webhookDeliveryJobs.ts"]

    DirectTg["src/services/telegram/notifications.ts<br/><b>Path B: direct, no retry</b>"]
    TelegramApi["src/services/telegram/api.ts<br/>(sendTelegramMessage)"]

    Telegram["Telegram Bot API"]
    GatewayPush["Gateway → FCM / APNs"]
    ExternalWebhook["Configured HTTPS/LAN webhook receiver"]

    %% Path A — preferred
    WalletSync --> Dispatcher
    ApiRoutes --> Dispatcher
    Worker --> Registry
    Dispatcher -- "enqueue" --> Queue
    Queue -- "consume" --> Worker
    Registry --> ChannelTelegram
    Registry --> ChannelPush
    Registry --> ChannelAi
    Registry --> ChannelWebhook
    ChannelTelegram --> TelegramApi
    ChannelPush --> GatewayPush
    ChannelAi --> TelegramApi
    ChannelWebhook --> WebhookOutbox
    WebhookOutbox --> WebhookWorker
    WebhookWorker --> ExternalWebhook

    %% Path B — direct
    Autopilot --> DirectTg
    ApiRoutes --> DirectTg
    DirectTg --> TelegramApi

    TelegramApi --> Telegram

    click Dispatcher href "../../server/src/infrastructure/notificationDispatcher.ts#queueTransactionNotification"
    click Registry href "../../server/src/services/notifications/channels/registry.ts#notificationChannelRegistry"
    click ChannelTelegram href "../../server/src/services/notifications/channels/telegram.ts#telegramChannelHandler"
    click ChannelPush href "../../server/src/services/notifications/channels/push.ts"
    click ChannelAi href "../../server/src/services/notifications/channels/aiInsights.ts"
    click ChannelWebhook href "../../server/src/services/notifications/channels/webhook.ts"
    click WebhookWorker href "../../server/src/worker/jobs/webhookDeliveryJobs.ts"
    click DirectTg href "../../server/src/services/telegram/notifications.ts#notifyNewTransactions"
    click TelegramApi href "../../server/src/services/telegram/api.ts#sendTelegramMessage"
    click Worker href "../../server/src/worker/jobs/notificationJobs.ts"
    click Autopilot href "../../server/src/services/autopilot/evaluator.ts"

    classDef pathA fill:#dbeafe,stroke:#1e3a8a;
    classDef pathB fill:#fee2e2,stroke:#991b1b;
    class Dispatcher,Queue,Registry,ChannelTelegram,ChannelPush,ChannelAi,ChannelWebhook,WebhookOutbox,WebhookWorker pathA;
    class DirectTg pathB;
```

---

## Why two paths exist

| Path | Origin | Properties |
|---|---|---|
| **A — Dispatcher → Queue → Worker → Channel registry** | Newer | Persisted in Redis; 5 retry attempts with exponential backoff for notification jobs; survives restarts; uniform entry point across channels (Telegram, push, AI insights, webhooks) |
| **B — Direct `services/telegram/notifications.ts`** | Older | Synchronous; no retry; no DLQ; bypasses channel registry entirely |

Both call into `services/telegram/api.ts → sendTelegramMessage`, so the Telegram API itself is reached the same way — but everything *upstream* (delivery guarantees, observability, gating) is different.

Webhook channel delivery has a second durable layer: the channel writes a `webhook_deliveries` outbox row and queues a `webhook-delivery` worker job per endpoint/event. That worker owns endpoint URL safety checks, payload mapping, signing, per-endpoint retries, dead-letter state, delivery history, replay, and max-retry wallet log alerts. This keeps webhook HTTP failures from being hidden by a successful Telegram or push channel result in the aggregate notification job.

## Convergence plan

The intent is for **Path B to be removed**. Every direct caller of `services/telegram/notifications` should be migrated to enqueue through `notificationDispatcher`, then the direct module deleted. This diagram exists so that:

1. New entry points are added to the diagram in the same PR — making divergence visible.
2. PRs that introduce a new caller of `services/telegram/notifications` are flagged for architectural review (the box is colored red on this diagram for a reason).
3. When the migration is complete, the red subgraph and this whole "Convergence plan" section get deleted.

## Update checklist for this diagram

- [ ] Adding a new caller of `notificationDispatcher`? Add a node in the `Callers` subgraph.
- [ ] Adding a new channel? Add it under the registry, with its target external system.
- [ ] Adding a *new* direct call to `services/telegram/api.ts` outside the channel registry? Stop. Either route via the dispatcher, or update this diagram with justification and an ADR.
