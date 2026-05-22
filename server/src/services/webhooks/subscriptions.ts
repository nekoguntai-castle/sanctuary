import type { WebhookEndpoint } from '../../generated/prisma/client';
import { webhookRepository } from '../../repositories';
import { getFilterConfig } from './config';
import type { WalletWebhookEvent } from './types';

export async function findMatchingWebhookEndpoints(
  event: WalletWebhookEvent,
): Promise<WebhookEndpoint[]> {
  const endpoints = await webhookRepository.findEnabledEndpointsForEvent(
    event.wallet.id,
    event.eventType,
  );
  return endpoints.filter(endpoint =>
    matchesEndpointEventType(endpoint, event.eventType) && matchesEndpointFilters(endpoint, event)
  );
}

export function matchesEndpointEventType(endpoint: WebhookEndpoint, eventType: string): boolean {
  return endpoint.enabled &&
    (
      endpoint.eventTypes.includes(eventType) ||
      endpoint.eventTypes.includes('*') ||
      endpoint.eventTypes.includes(wildcardEventType(eventType))
    );
}

export function matchesEndpointFilters(
  endpoint: WebhookEndpoint,
  event: WalletWebhookEvent,
): boolean {
  const filters = getFilterConfig(endpoint);
  const transaction = event.transaction;

  if (filters.transactionTypes?.length && transaction) {
    if (!filters.transactionTypes.includes(transaction.type)) return false;
  }

  if (filters.minAmountSats && transaction) {
    if (BigInt(transaction.amountSats) < BigInt(filters.minAmountSats)) return false;
  }

  if (filters.confirmationThreshold !== undefined && transaction) {
    if ((transaction.confirmations ?? 0) < filters.confirmationThreshold) return false;
  }

  return true;
}

function wildcardEventType(eventType: string): string {
  const lastDotIndex = eventType.lastIndexOf('.');
  return lastDotIndex === -1 ? '*' : `${eventType.slice(0, lastDotIndex)}.*`;
}
