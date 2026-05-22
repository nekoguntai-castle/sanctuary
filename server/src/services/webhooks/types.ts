import type { WebhookDelivery, WebhookEndpoint } from '../../generated/prisma/client';
import {
  WEBHOOK_AUTH_TYPE_BEARER,
  WEBHOOK_AUTH_TYPE_CONFIGURED_HMAC_SHA256,
  WEBHOOK_AUTH_TYPE_HMAC_SHA256,
  WEBHOOK_AUTH_TYPE_NONE,
  WEBHOOK_EVENT_TRANSACTION_CONFIRMED,
  WEBHOOK_EVENT_TRANSACTION_OBSERVED,
  WEBHOOK_EVENT_TRANSACTION_RECEIVED,
  WEBHOOK_EVENT_TRANSACTION_SENT,
  WEBHOOK_PAYLOAD_PROFILE_GENERIC,
  WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON,
  type WebhookAuthType,
  type WebhookPayloadProfile,
} from '@sanctuary/shared/constants/webhooks';

export {
  WEBHOOK_EVENT_TRANSACTION_CONFIRMED,
  WEBHOOK_EVENT_TRANSACTION_OBSERVED,
  WEBHOOK_EVENT_TRANSACTION_RECEIVED,
  WEBHOOK_EVENT_TRANSACTION_SENT,
};

export const GENERIC_WEBHOOK_PROFILE = WEBHOOK_PAYLOAD_PROFILE_GENERIC;
export const MAPPED_JSON_WEBHOOK_PROFILE = WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON;

export const WEBHOOK_AUTH_NONE = WEBHOOK_AUTH_TYPE_NONE;
export const WEBHOOK_AUTH_BEARER = WEBHOOK_AUTH_TYPE_BEARER;
export const WEBHOOK_AUTH_HMAC_SHA256 = WEBHOOK_AUTH_TYPE_HMAC_SHA256;
export const WEBHOOK_AUTH_CONFIGURED_HMAC_SHA256 = WEBHOOK_AUTH_TYPE_CONFIGURED_HMAC_SHA256;
export type { WebhookAuthType, WebhookPayloadProfile };

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
