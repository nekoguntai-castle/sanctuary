import type { Mock } from 'vitest';
import type { WebhookDelivery, WebhookEndpoint } from '../../../../src/generated/prisma/client';
import type { WalletWebhookEvent } from '../../../../src/services/webhooks/types';

/** The default wallet transaction subscription (shared/constants/webhooks.ts). */
export const DEFAULT_EVENTS = [
  'wallet.transaction.received',
  'wallet.transaction.sent',
  'wallet.transaction.confirmed',
];

/** A stored transaction row as transactionRepository.findManyByTxids returns it. */
export function storedTx(confirmations: number, type = 'received', walletId = 'wallet-1') {
  return {
    id: 'row-1', txid: 'tx-1', walletId, type, amount: 50_000n, fee: 141n,
    confirmations, blockHeight: 900_000, blockTime: new Date('2026-10-01T00:00:00Z'),
    createdAt: new Date('2026-10-01T00:00:00Z'), memo: null, label: null, counterpartyAddress: null,
  };
}

/** Make a webhookRepository.createDelivery mock admit every delivery. */
export function acceptAllDeliveries(createDelivery: Mock): void {
  createDelivery.mockImplementation(async (input: { eventId: string }) => ({
    accepted: true, delivery: { id: `d:${input.eventId}`, attemptCount: 0 },
  }));
}

export function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: 'endpoint-1',
    walletId: 'wallet-1',
    name: 'Endpoint',
    enabled: true,
    url: 'https://93.184.216.34/webhook',
    eventTypes: ['wallet.transaction.received'],
    filters: null,
    payloadProfile: 'sanctuary_wallet_event_v1',
    authType: 'none',
    secretEncrypted: null,
    headerConfig: null,
    profileConfig: null,
    retryConfig: null,
    maxAttempts: 5,
    failureNotificationEnabled: true,
    createdByUserId: 'user-1',
    lastDeliveryStatus: null,
    lastDeliveredAt: null,
    lastError: null,
    createdAt: new Date('2026-05-22T00:00:00Z'),
    updatedAt: new Date('2026-05-22T00:00:00Z'),
    ...overrides,
  };
}

export function makeDelivery(
  overrides: Partial<WebhookDelivery> & { endpoint: WebhookEndpoint },
): WebhookDelivery & { endpoint: WebhookEndpoint } {
  return {
    id: 'delivery-1',
    endpointId: overrides.endpoint.id,
    walletId: 'wallet-1',
    eventId: 'event-1',
    eventType: 'wallet.transaction.received',
    payloadProfile: 'sanctuary_wallet_event_v1',
    targetUrl: overrides.endpoint.url,
    eventPayload: {
      schemaVersion: 'v1',
      eventId: 'event-1',
      eventType: 'wallet.transaction.received',
      occurredAt: '2026-05-22T10:00:00.000Z',
      wallet: { id: 'wallet-1', name: 'Treasury', network: 'mainnet' },
      transaction: { txid: 'tx-1', type: 'received', amountSats: '1' },
      source: { service: 'sanctuary', dispatchPath: 'test' },
    },
    requestBody: null,
    requestBodyHash: null,
    requestHeadersRedacted: null,
    status: 'failed',
    attemptCount: 0,
    nextAttemptAt: null,
    attemptLeaseToken: null,
    attemptLeaseExpiresAt: null,
    lastAttemptAt: null,
    deliveredAt: null,
    lastStatusCode: null,
    lastError: null,
    responseBodyHash: null,
    createdAt: new Date('2026-05-22T00:00:00Z'),
    updatedAt: new Date('2026-05-22T00:00:00Z'),
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<WalletWebhookEvent> = {}): WalletWebhookEvent {
  return {
    schemaVersion: 'v1',
    eventId: 'event-1',
    eventType: 'wallet.transaction.received',
    occurredAt: '2026-05-22T10:00:00.000Z',
    wallet: { id: 'wallet-1', name: 'Treasury', network: 'mainnet' },
    transaction: {
      txid: 'tx-1',
      type: 'received',
      amountSats: '1',
      feeSats: null,
      confirmations: 1,
      blockHeight: null,
      blockTime: null,
      memo: null,
      label: null,
      counterpartyAddress: null,
    },
    source: { service: 'sanctuary', dispatchPath: 'test' },
    ...overrides,
  };
}
