import type { WebhookEndpoint } from '../../generated/prisma/client';
import { webhookRepository } from '../../repositories';
import { getFilterConfig } from './config';
import { createLogger } from '../../utils/logger';
import { WEBHOOK_EVENT_TRANSACTION_CONFIRMED, type WalletWebhookEvent } from './types';

const log = createLogger('WEBHOOK:SUBSCRIPTIONS');

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

  if (filters.invalidMinAmount && transaction) {
    // Fail closed for this endpoint only; the save-time 400 is the operator-facing signal.
    log.debug('Skipping webhook endpoint with invalid minAmountSats filter', { endpointId: endpoint.id });
    return false;
  }

  if (filters.minAmountSats && transaction) {
    const amount = BigInt(transaction.amountSats);
    const magnitude = amount < 0n ? -amount : amount;
    if (magnitude < BigInt(filters.minAmountSats)) return false;
  }

  if (filters.confirmationThreshold !== undefined && transaction) {
    if ((transaction.confirmations ?? 0) < filters.confirmationThreshold) return false;
  }

  return true;
}

/**
 * True when a confirmation change from `previousConfirmations` to
 * `confirmations` is the one that first makes `event` deliverable to
 * `endpoint`: the endpoint's threshold (at least 1 for the confirmed event) is
 * crossed by this change. Earlier changes were filtered by the threshold and
 * later ones were already delivered, so each endpoint gets each event once.
 */
export function crossesEndpointConfirmationThreshold(
  endpoint: WebhookEndpoint,
  eventType: string,
  previousConfirmations: number,
  confirmations: number,
): boolean {
  const configured = getFilterConfig(endpoint).confirmationThreshold ?? 0;
  const threshold = eventType === WEBHOOK_EVENT_TRANSACTION_CONFIRMED ? Math.max(configured, 1) : configured;
  return previousConfirmations < threshold && threshold <= confirmations;
}

function wildcardEventType(eventType: string): string {
  const lastDotIndex = eventType.lastIndexOf('.');
  return lastDotIndex === -1 ? '*' : `${eventType.slice(0, lastDotIndex)}.*`;
}
