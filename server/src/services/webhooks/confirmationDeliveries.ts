/**
 * Confirmation-path webhook deliveries.
 *
 * Transaction webhooks are built when a transaction is first stored. A
 * transaction first seen in the mempool has 0 confirmations then, so the
 * confirmed event (and every event for an endpoint with a confirmationThreshold)
 * is filtered out. The confirmation refresh calls this after it commits a
 * confirmation change, and each endpoint is admitted only for the change that
 * crosses its threshold. Event ids are stable, so a repeat is an upsert no-op.
 */
import type { ConfirmationUpdate } from '../bitcoin/sync/confirmations/types';
import { webhookRepository } from '../../repositories';
import { buildConfirmationWebhookEventsForBatch } from './eventBuilder';
import { queueWebhookEventsDeliveries, type QueueWebhookEventResult } from './deliveryService';
import { crossesEndpointConfirmationThreshold } from './subscriptions';

export async function queueTransactionConfirmationWebhooks(
  walletId: string,
  updates: ConfirmationUpdate[],
): Promise<QueueWebhookEventResult> {
  const rising = updates.filter(update => update.newConfirmations > update.oldConfirmations);
  if (rising.length === 0) return { queued: 0, errors: [] };

  const endpoints = (await webhookRepository.listEndpoints(walletId)).filter(endpoint => endpoint.enabled);
  if (endpoints.length === 0) return { queued: 0, errors: [] };

  const pairs = await buildConfirmationWebhookEventsForBatch(walletId, rising);
  return queueWebhookEventsDeliveries(
    pairs.map(({ event }) => event),
    (endpoint, eventIndex) => {
      const { update, event } = pairs[eventIndex];
      return crossesEndpointConfirmationThreshold(
        endpoint,
        event.eventType,
        update.oldConfirmations,
        update.newConfirmations,
      );
    },
    new Map([[walletId, endpoints]]),
  );
}
