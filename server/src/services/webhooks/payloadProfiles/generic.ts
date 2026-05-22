import type { WebhookEndpoint } from '../../../generated/prisma/client';
import { hashWebhookBody } from '../json';
import {
  GENERIC_WEBHOOK_PROFILE,
  type BuiltWebhookRequest,
  type WalletWebhookEvent,
  type WebhookPayloadProfileHandler,
} from '../types';

export const genericWebhookPayloadProfile: WebhookPayloadProfileHandler = {
  id: GENERIC_WEBHOOK_PROFILE,

  async build(_endpoint: WebhookEndpoint, event: WalletWebhookEvent): Promise<BuiltWebhookRequest> {
    const body = {
      schemaVersion: event.schemaVersion,
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      wallet: event.wallet,
      transaction: event.transaction,
      source: event.source,
      metadata: event.metadata ?? {},
    };

    return {
      body,
      bodyHash: hashWebhookBody(body),
    };
  },
};
