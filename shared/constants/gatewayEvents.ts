/**
 * Push event vocabulary shared by the server and the push gateway.
 *
 * These are the event types the server sends over the gateway channel that
 * the gateway turns into push notifications. The server forwards other
 * WebSocket events too (e.g. `balance`, `sync`); the gateway ignores them.
 */

/**
 * Wallet-level events produced only for the gateway (never sent to browser
 * clients, since they carry a private recipient list).
 */
export const GATEWAY_PUSH_EVENT_TYPES = ['ai_insight', 'consolidation_suggestion'] as const;
export type GatewayPushEventType = (typeof GATEWAY_PUSH_EVENT_TYPES)[number];

/** Every event type the gateway turns into a push notification. */
export const GATEWAY_NOTIFIED_EVENT_TYPES = [
  'transaction',
  'confirmation',
  ...GATEWAY_PUSH_EVENT_TYPES,
] as const;
export type GatewayNotifiedEventType = (typeof GATEWAY_NOTIFIED_EVENT_TYPES)[number];
