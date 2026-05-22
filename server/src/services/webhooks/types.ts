import type { WebhookDelivery, WebhookEndpoint } from '../../generated/prisma/client';

export const WEBHOOK_EVENT_TRANSACTION_OBSERVED = 'wallet.transaction.observed';
export const WEBHOOK_EVENT_TRANSACTION_RECEIVED = 'wallet.transaction.received';
export const WEBHOOK_EVENT_TRANSACTION_SENT = 'wallet.transaction.sent';
export const WEBHOOK_EVENT_TRANSACTION_CONFIRMED = 'wallet.transaction.confirmed';

export const GENERIC_WEBHOOK_PROFILE = 'sanctuary_wallet_event_v1';
export const MAPPED_JSON_WEBHOOK_PROFILE = 'mapped_json_v1';

export const WEBHOOK_AUTH_NONE = 'none';
export const WEBHOOK_AUTH_BEARER = 'bearer';
export const WEBHOOK_AUTH_HMAC_SHA256 = 'hmac_sha256';
export const WEBHOOK_AUTH_CONFIGURED_HMAC_SHA256 = 'configured_hmac_sha256';

export type WebhookAuthType =
  | typeof WEBHOOK_AUTH_NONE
  | typeof WEBHOOK_AUTH_BEARER
  | typeof WEBHOOK_AUTH_HMAC_SHA256
  | typeof WEBHOOK_AUTH_CONFIGURED_HMAC_SHA256;

export type WebhookPayloadProfile =
  | typeof GENERIC_WEBHOOK_PROFILE
  | typeof MAPPED_JSON_WEBHOOK_PROFILE;

export interface WalletWebhookEvent {
  schemaVersion: 'v1';
  eventId: string;
  eventType: string;
  occurredAt: string;
  wallet: {
    id: string;
    name: string;
    network: string;
    label?: string;
  };
  transaction?: {
    txid: string;
    type: 'received' | 'sent' | 'consolidation' | 'self_transfer';
    amountSats: string;
    feeSats?: string | null;
    confirmations?: number;
    blockHeight?: number | null;
    blockTime?: string | null;
    memo?: string | null;
    label?: string | null;
    counterpartyAddress?: string | null;
  };
  source: {
    service: 'sanctuary';
    dispatchPath: string;
  };
  metadata?: Record<string, unknown>;
}

export interface WebhookFilterConfig {
  transactionTypes?: string[];
  minAmountSats?: string;
  confirmationThreshold?: number;
}

export interface WebhookRetryConfig {
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

export interface BuiltWebhookRequest {
  body: Record<string, unknown>;
  bodyHash: string;
}

export interface SignedWebhookRequest {
  headers: Record<string, string>;
  redactedHeaders: Record<string, string>;
}

export interface WebhookSendResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  responseBodyHash?: string;
}

export interface WebhookPayloadProfileHandler {
  id: WebhookPayloadProfile;
  build(endpoint: WebhookEndpoint, event: WalletWebhookEvent): Promise<BuiltWebhookRequest>;
}

export type WebhookDeliveryWithEndpoint = WebhookDelivery & {
  endpoint: WebhookEndpoint;
};

export class WebhookRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookRetryableError';
  }
}
